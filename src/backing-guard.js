/*
 * ─────────────────────────────────────────────────────────────────────────
 * UNA VOCE SOLA: la guardia sull'avvio del motore nativo.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * IL DIFETTO, per intero. Sul desktop il brano lo suona JUCE, e tutto il
 * trasporto passa da due IPC: `startBacking()` e `stopBacking()`. Nessuna
 * delle due e' idempotente: `startBacking()` chiesta due volte avvia il brano
 * DUE volte. Due voci sfasate di qualche decina di millisecondi — l'effetto
 * "metallico" che si sente meglio con la scheda in secondo piano e' un filtro
 * a pettine, cioe' la firma acustica di due copie dello stesso segnale.
 *
 * E i richiedenti sono TRE, nessuno dei quali sa degli altri:
 *
 *   1. `togglePlay()` — il tasto play, la barra spaziatrice, noi.
 *   2. lo shim di `#audio.play()` — la strada dei plugin, quella con cui il
 *      rilevatore fa partire il drill.
 *   3. `startCountIn()` — il conteggio a quattro del ritorno del loop.
 *
 * Il terzo e' quello che mancava, ed e' il peggiore, perche' MENTE. A ogni
 * giro di loop l'app chiama `startCountIn()`, che ferma il motore
 * (`jucePlayer.pause()`) ma NON tocca `S.isPlaying`; poi conta quattro
 * battiti; poi riavvia con un `jucePlayer.play()` senza guardie. Per quei
 * ~2,4 secondi `#audio.paused` e `feedBack.isPlaying` dicono "sto suonando"
 * mentre il motore e' fermo. Chi decide in quella finestra decide sul falso,
 * noi compresi.
 *
 * Da li' i due sintomi:
 *   · musica che va avanti mentre il trasporto risulta in pausa — il
 *     conteggio riavvia il motore per conto suo, nessuno ha premuto niente;
 *   · doppio audio dopo un po' che si lavora col repeater — un conteggio
 *     rimasto in volo (`_cancelCountIn` scatta solo allo smontaggio, non
 *     quando un drill finisce o il loop cambia) atterra il suo
 *     `jucePlayer.play()` sopra un motore gia' avviato da qualcun altro.
 *
 * PERCHE' LA CORREZIONE STA QUI. La correzione giusta e' un `startBacking()`
 * idempotente nell'app, ed e' una riga; ma e' una riga in un repo che non
 * possiamo rilasciare. Pero' tutte e tre le strade finiscono nella STESSA
 * funzione, e `transport.js` la risolve a ogni chiamata
 * (`window.feedBackDesktop.audio.startBacking()`, non un riferimento
 * catturato all'avvio). Una guardia messa li' le copre tutte e tre, da dentro
 * un plugin.
 *
 * IL PATTO, perche' questa e' una toppa su un globale dell'ospite e va detto
 * cosa promette:
 *   · sopprime un avvio SOLO se ne risulta gia' uno in corso;
 *   · non sopprime mai un avvio che segue un arresto;
 *   · se sbaglia se ne accorge da sola — dopo una soppressione guarda se la
 *     posizione avanza davvero e, se non avanza, avvia lei. Il caso peggiore
 *     e' un ritardo di ~150 ms, non un silenzio.
 *
 * QUANDO SI INSTALLA. Alla presenza del ponte desktop, NON a `_juceMode`. La
 * tentazione era gia' scritta e sbagliata: `window._juceMode` si accende quando
 * l'app dirotta il brano sul motore nativo, cioe' al caricamento della canzone,
 * che e' DOPO l'avvio dei plugin — una guardia condizionata a quel flag non si
 * sarebbe installata quasi mai, e in silenzio. Al ponte invece si arriva sempre:
 * `window.feedBackDesktop` c'e' da prima che parta qualunque plugin.
 *
 * Nel browser, o in modalita' HTML5, resta inerte da se': `startBacking` la
 * chiama solo la strada JUCE, e `<audio>.play()` e' gia' idempotente per
 * contratto. Una guardia inerte non costa niente; una guardia mai installata
 * costa il difetto.
 */

const MARK = '__rrBackingGuard';

/** Quanto passa tra i due campioni di posizione della verifica. */
const VERIFY_MS = 150;

/** Il motore e' fermo se in VERIFY_MS la posizione si muove meno di questo. */
const VERIFY_EPS = 0.01;

function desktopAudio() {
    const d = window.feedBackDesktop;
    return (d && d.audio) || null;
}

/** Lo stato del trasporto secondo l'app, al momento dell'installazione. */
function seemsPlaying() {
    const el = document.getElementById('audio');
    return !!(el && el.paused === false);
}

function wait(ms) {
    return new Promise((done) => setTimeout(done, ms));
}

/** Ogni nome esposto dall'oggetto, enumerabile o no. */
function everyKey(obj) {
    const seen = new Set();
    for (const k in obj) seen.add(k);
    for (const k of Object.getOwnPropertyNames(obj)) seen.add(k);
    seen.delete('constructor');
    return [...seen];
}

let guard = null;

/**
 * Installa la guardia. Idempotente, e non lancia mai: se non riesce a mettersi
 * in mezzo lo DICE nel rapporto, cosi' chi la chiama lo scrive in console
 * invece di credere a una protezione che non c'e'.
 */
export function installBackingGuard() {
    if (window[MARK]) return { installed: true, mode: window[MARK].mode, already: true };

    const api = desktopAudio();
    if (!api || typeof api.startBacking !== 'function' || typeof api.stopBacking !== 'function') {
        // Nel browser non c'e' ponte desktop, e non c'e' niente da proteggere.
        return { installed: false, mode: 'niente-ponte' };
    }

    const realStart = api.startBacking.bind(api);
    const realStop = api.stopBacking.bind(api);
    const realPos = typeof api.getBackingPosition === 'function'
        ? api.getBackingPosition.bind(api)
        : null;
    const realLoad = typeof api.loadBackingTrack === 'function'
        ? api.loadBackingTrack.bind(api)
        : null;

    const state = {
        running: seemsPlaying(),
        inFlight: null,
        dropped: 0,
        rescued: 0,
        verifying: false,
        mode: null,
    };

    /*
     * Dopo una soppressione: la posizione avanza davvero?
     *
     * E' la rete di sicurezza dell'intera toppa. Se `running` restasse acceso
     * per sbaglio, senza questa la canzone resterebbe muta finche' qualcuno
     * non ferma e riavvia a mano. Con questa il danno massimo e' un avvio
     * ritardato di VERIFY_MS.
     */
    async function verify() {
        if (!realPos || state.verifying) return;
        state.verifying = true;
        try {
            const a = Number(await realPos());
            await wait(VERIFY_MS);
            const b = Number(await realPos());
            const fermo = Number.isFinite(a) && Number.isFinite(b)
                && Math.abs(b - a) < VERIFY_EPS;
            if (fermo && state.running && !state.inFlight) {
                state.rescued++;
                state.running = false;
                console.warn('[riffrepeater] avevo soppresso un avvio ma il motore era fermo: avvio io');
                await guardedStart();
            }
        } catch (_) {
            /* se la posizione non si legge, meglio non fare niente */
        } finally {
            state.verifying = false;
        }
    }

    function guardedStart(...args) {
        // Due chiamate nella stessa raffica: una sola IPC, e la seconda
        // aspetta l'esito della prima invece di aprire una seconda voce.
        if (state.inFlight) return state.inFlight;
        if (state.running) {
            state.dropped++;
            console.warn('[riffrepeater] startBacking soppresso (n. ' + state.dropped
                + '): il motore stava gia suonando');
            verify();
            return Promise.resolve(true);
        }
        const p = Promise.resolve(realStart(...args)).then(
            (r) => { state.running = true; return r; },
            (err) => { state.running = false; throw err; },
        );
        state.inFlight = p;
        const clear = () => { if (state.inFlight === p) state.inFlight = null; };
        p.then(clear, clear);
        return p;
    }

    function guardedStop(...args) {
        state.running = false;
        // Un avvio ancora in volo non deve piu' fare da capofila: dopo un
        // arresto il prossimo avvio e' un avvio nuovo, non una replica.
        state.inFlight = null;
        return realStop(...args);
    }

    // Caricare un'altra traccia azzera il motore: quello che sapevamo dello
    // stato non vale piu'.
    function guardedLoad(...args) {
        state.running = false;
        state.inFlight = null;
        return realLoad(...args);
    }

    const patch = { startBacking: guardedStart, stopBacking: guardedStop };
    if (realLoad) patch.loadBackingTrack = guardedLoad;

    state.mode = place(api, patch);
    if (!state.mode) return { installed: false, mode: 'oggetto-sigillato' };

    guard = {
        mode: state.mode,
        isRunning: () => state.running,
        stats: () => ({ dropped: state.dropped, rescued: state.rescued }),
    };
    window[MARK] = guard;
    return { installed: true, mode: state.mode };
}

/*
 * Tre modi di mettersi in mezzo, dal meno al piu' invasivo. Il primo di solito
 * basta; gli altri due esistono perche' un oggetto passato dal contextBridge di
 * Electron puo' essere congelato, e in quel caso l'assegnazione fallisce in
 * silenzio. Ogni tentativo si RILEGGE: nessuno dei tre viene dato per riuscito.
 *
 * Il secondo e il terzo funzionano solo perche' `transport.js` risolve
 * `window.feedBackDesktop.audio` a ogni chiamata invece di catturarlo all'avvio.
 * Se un giorno lo catturasse, `installBackingGuard` tornerebbe comunque un modo
 * ma quel modo non coprirebbe piu' niente: e' la prima cosa da ricontrollare se
 * il doppio audio tornasse dopo un aggiornamento dell'app.
 */
function place(api, patch) {
    const names = Object.keys(patch);
    const done = () => {
        const live = desktopAudio();
        return !!live && names.every((n) => live[n] === patch[n]);
    };

    try { for (const n of names) api[n] = patch[n]; } catch (_) { /* congelato */ }
    if (done()) return 'in-posto';

    try {
        for (const n of names) {
            Object.defineProperty(api, n, { value: patch[n], configurable: true, writable: true });
        }
    } catch (_) { /* non configurabile */ }
    if (done()) return 'ridefinito';

    // Una copia semplice, non un Proxy: su un oggetto congelato una trappola
    // `get` che restituisce qualcosa di diverso dal valore reale viola gli
    // invarianti dei Proxy e lancia.
    const copia = {};
    for (const k of everyKey(api)) {
        const v = api[k];
        copia[k] = (typeof v === 'function') ? v.bind(api) : v;
    }
    Object.assign(copia, patch);

    try { window.feedBackDesktop.audio = copia; } catch (_) { /* congelato */ }
    if (done()) return 'audio-sostituito';

    try {
        const d = window.feedBackDesktop;
        const fuori = {};
        for (const k of everyKey(d)) {
            const v = d[k];
            fuori[k] = (typeof v === 'function') ? v.bind(d) : v;
        }
        fuori.audio = copia;
        window.feedBackDesktop = fuori;
    } catch (_) { /* nemmeno */ }
    if (done()) return 'desktop-sostituito';

    return null;
}

/**
 * Il motore sta suonando davvero?
 *
 * `null` quando la guardia non e' installata — e in quel caso NON c'e' una
 * risposta migliore da dare: durante un conteggio `#audio.paused` mente, e
 * inventare una certezza sarebbe peggio del non sapere.
 */
export function backingIsRunning() {
    return guard ? guard.isRunning() : null;
}

/** Quante volte ha soppresso, e quante volte ha dovuto rimediare. */
export function backingGuardStats() {
    return guard ? guard.stats() : null;
}
