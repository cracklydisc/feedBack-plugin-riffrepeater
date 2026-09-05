/*
 * ─────────────────────────────────────────────────────────────────────────
 * UNA VOCE SOLA: la guardia sull'avvio del motore nativo.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * IL DIFETTO, per intero. Sul desktop il brano lo suona JUCE, e avviarlo due
 * volte lo fa suonare due volte: ne' `jucePlayer.play()` ne' l'IPC che chiama,
 * `startBacking()`, sono idempotenti. Due voci sfasate di qualche decina di
 * millisecondi — l'effetto "metallico", piu' netto con la scheda in secondo
 * piano, e' un filtro a pettine: la firma acustica di due copie dello stesso
 * segnale.
 *
 * E i richiedenti sono TRE, nessuno dei quali sa degli altri:
 *
 *   1. `togglePlay()` — il tasto play, la barra spaziatrice, noi.
 *   2. lo shim di `#audio.play()` — la strada dei plugin, quella con cui il
 *      rilevatore fa partire il drill.
 *   3. `startCountIn()` — il conteggio a quattro del ritorno del loop, che
 *      ferma il motore, conta su un timer e riavvia senza guardare piu'
 *      niente.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DOVE SI METTE, e perche' il primo posto che avevo scelto non andava.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Il primo tentativo era `window.feedBackDesktop.audio.startBacking`, l'imbuto
 * piu' in basso di tutti. Sull'app vera non si installa: quell'oggetto arriva
 * dal `contextBridge` di Electron ed e' SIGILLATO — assegnazione, defineProperty
 * e sostituzione dell'oggetto fallirono tutte e tre, e la riga in console diceva
 * `oggetto-sigillato`. Un vicolo cieco documentato, perche' e' il primo posto in
 * cui verrebbe voglia di tornare.
 *
 * Il posto giusto sta una spanna piu' in alto: `app.js` fa
 * `window.jucePlayer = jucePlayer`, e quello e' LO STESSO OGGETTO che
 * `count-in.js`, `transport.js` e lo shim importano dal modulo. Un'importazione
 * ESM condivide l'identita' dell'oggetto, e tutti e tre chiamano
 * `jucePlayer.play()` — cioe' risolvono la proprieta' al momento della chiamata.
 * Quindi basta sostituire la PROPRIETA' `play` su quell'oggetto e la vedono
 * tutti, conteggio compreso.
 *
 * La proprieta', mai il riferimento: `window.jucePlayer = altro` non lo
 * vedrebbe nessuno di loro, perche' chi importa il modulo tiene il vecchio
 * oggetto. E' la differenza fra correggere il difetto e credere di averlo
 * corretto.
 *
 * IL PATTO, perche' questa e' una toppa su un globale dell'ospite e va detto
 * cosa promette:
 *   · sopprime un avvio SOLO se il motore risulta gia' in moto;
 *   · non sopprime mai un avvio che segue un arresto;
 *   · se sbaglia se ne accorge da sola — dopo una soppressione guarda se la
 *     posizione avanza davvero e, se non avanza, avvia lei. Il caso peggiore e'
 *     un ritardo di ~150 ms, non un silenzio.
 *
 * Fuori dal desktop non c'e' niente da proteggere e non si installa:
 * `<audio>.play()` e' gia' idempotente per contratto.
 */

import { appSaysPaused } from './transport-truth.js';

const MARK = '__rrBackingGuard';

/** Quanto passa tra i due campioni di posizione della verifica. */
const VERIFY_MS = 150;

/** Il motore e' fermo se in VERIFY_MS la posizione si muove meno di questo. */
const VERIFY_EPS = 0.01;

function desktopAudio() {
    const d = window.feedBackDesktop;
    return (d && d.audio) || null;
}

/**
 * La posizione secondo il motore. Letta dal ponte sigillato: sigillato vuol
 * dire che non si SCRIVE, leggere e chiamare si puo' benissimo.
 */
function enginePosition() {
    const api = desktopAudio();
    if (!api || typeof api.getBackingPosition !== 'function') return null;
    try { return api.getBackingPosition(); } catch (_) { return null; }
}

/** Lo stato del trasporto secondo l'app, al momento dell'installazione. */
function seemsPlaying() {
    return !appSaysPaused();
}

/** Lo stesso, girato: l'app dichiara di essere in pausa? */
function enginePaused() {
    return appSaysPaused();
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
 * Il cancello: la coppia avvio/arresto che tiene il conto di cosa sta suonando.
 *
 * Uno solo, condiviso dai due posti in cui puo' essere montato, perche' la
 * regola e' la stessa e due copie della stessa regola sono due posti da cui
 * puo' divergere.
 */
function makeGate({ start, stop, onSuppress, veto }) {
    const state = {
        running: seemsPlaying(),
        inFlight: null,
        dropped: 0,
        rescued: 0,
        verifying: false,
    };

    /*
     * Dopo una soppressione: la posizione avanza davvero?
     *
     * E' la rete di sicurezza dell'intera toppa. Se `running` restasse acceso
     * per sbaglio, senza questa la canzone resterebbe muta finche' qualcuno non
     * ferma e riavvia a mano. Con questa il danno massimo e' un avvio ritardato
     * di VERIFY_MS.
     */
    async function verify() {
        if (state.verifying) return;
        const first = enginePosition();
        if (first === null) return;
        state.verifying = true;
        try {
            const a = Number(await first);
            await wait(VERIFY_MS);
            const b = Number(await enginePosition());
            const fermo = Number.isFinite(a) && Number.isFinite(b)
                && Math.abs(b - a) < VERIFY_EPS;
            // Non si rimedia contro la volonta' di chi ascolta: se il
            // trasporto dichiara pausa, il motore fermo e' quello che deve
            // essere. Senza questa riga la rete di sicurezza diventerebbe un
            // terzo avviatore, cioe' il difetto che stiamo curando.
            if (fermo && state.running && !state.inFlight && !enginePaused()
                && !(veto && veto())) {
                state.rescued++;
                state.running = false;
                console.warn('[riffrepeater] avevo soppresso un avvio ma il motore era fermo: avvio io');
                await gate.start();
            }
        } catch (_) {
            /* se la posizione non si legge, meglio non fare niente */
        } finally {
            state.verifying = false;
        }
    }

    const gate = {
        state,
        start(...args) {
            /*
             * PRIMA DI TUTTO: qualcuno vuole silenzio?
             *
             * `false` non e' un ripiego, e' l'esito di contratto di
             * `jucePlayer.play()` quando il motore non parte, e ogni chiamante
             * lo gestisce lasciando lo stato dov'e' — `count-in.js:287`,
             * `transport.js:320`, `juce-audio.js:1003`. Percio' negare qui e'
             * pulito: nessun suono e nessuna bugia di stato. Rincorrere l'avvio
             * dopo, invece, e' una gara contro un motore nativo che da JS non
             * si legge.
             */
            if (veto && veto()) {
                console.warn('[riffrepeater] avvio del backing negato: il trasporto e in pausa e nessuno lo ha chiesto');
                return Promise.resolve(false);
            }
            // Due chiamate nella stessa raffica: una sola partenza, e la seconda
            // aspetta l'esito della prima invece di aprire una seconda voce.
            if (state.inFlight) return state.inFlight;
            if (state.running) {
                state.dropped++;
                console.warn('[riffrepeater] avvio del backing soppresso (n. ' + state.dropped
                    + '): il motore stava gia suonando');
                if (onSuppress) { try { onSuppress(); } catch (_) { /* accessorio */ } }
                verify();
                return Promise.resolve(true);
            }
            const p = Promise.resolve(start(...args)).then(
                // `state.inFlight === p` e non solo `r !== false`: se nel
                // frattempo e' passato un arresto, `stop()` ha gia' azzerato
                // tutto e questo avvio e' vecchio. Scrivere `running = true`
                // qui direbbe "sta suonando" sopra un motore appena fermato, e
                // il prossimo avvio verrebbe soppresso a torto.
                (r) => { if (r !== false && state.inFlight === p) state.running = true; return r; },
                (err) => { state.running = false; throw err; },
            );
            state.inFlight = p;
            const clear = () => { if (state.inFlight === p) state.inFlight = null; };
            p.then(clear, clear);
            return p;
        },
        stop(...args) {
            state.running = false;
            // Un avvio ancora in volo non deve piu' fare da capofila: dopo un
            // arresto il prossimo avvio e' un avvio nuovo, non una replica.
            state.inFlight = null;
            /*
             * E l'arresto si tiene, perche' non e' istantaneo: su questa
             * macchina `stopBacking()` ci mette 1,3 secondi a tornare, e in quel
             * tempo l'app crede ancora di suonare (il pulsante lo aggiorna DOPO
             * l'await). Chi deve decidere qualcosa in mezzo puo' aspettare la
             * fine invece di leggere uno stato a meta'.
             */
            const p = Promise.resolve(stop(...args));
            state.settling = p;
            const done = () => { if (state.settling === p) state.settling = null; };
            p.then(done, done);
            return p;
        },
        forget() { state.running = false; state.inFlight = null; },
    };
    return gate;
}

/**
 * Installa la guardia. Idempotente, e non lancia mai: se non riesce a mettersi
 * in mezzo lo DICE nel rapporto, cosi' chi la chiama lo scrive in console
 * invece di credere a una protezione che non c'e'.
 */
export function installBackingGuard(opts = {}) {
    const prev = guard || window[MARK];
    if (prev) return { installed: true, mode: prev.mode, already: true };

    const veto = typeof opts.veto === 'function' ? opts.veto : null;
    const built = onPlayer(veto) || onBridge(veto);
    if (!built) return { installed: false, mode: 'oggetto-sigillato' };

    guard = {
        mode: built.mode,
        isRunning: () => built.gate.state.running,
        settling: () => built.gate.state.settling || null,
        stats: () => ({ dropped: built.gate.state.dropped, rescued: built.gate.state.rescued }),
    };
    window[MARK] = guard;
    return { installed: true, mode: built.mode };
}

/*
 * Primo posto: `window.jucePlayer`, la proprieta' `play`.
 *
 * E' il vero imbuto — ci passano il tasto play, lo shim dei plugin, l'API
 * pubblica di playback E il conteggio del loop, che e' il solo che non passa da
 * nessun'altra parte. E' un oggetto letterale del modulo, non congelato.
 */
function onPlayer(veto) {
    const p = window.jucePlayer;
    if (!p || typeof p.play !== 'function' || typeof p.pause !== 'function') return null;

    const realPlay = p.play.bind(p);
    const realPause = p.pause.bind(p);

    const gate = makeGate({
        veto,
        start: () => realPlay(),
        stop: () => realPause(),
        /*
         * Sopprimere l'avvio non deve sopprimere il polling della posizione.
         * `play()` fa due cose — avvia il motore e accende il campionamento che
         * muove l'autostrada — e se la seconda salta, la vista si ferma mentre
         * l'audio va. Di norma il polling e' gia' acceso da chi ha avviato per
         * primo; questo e' il caso in cui non lo fosse.
         */
        onSuppress: () => {
            if (p._polling === false && typeof p._startPolling === 'function') p._startPolling();
        },
    });

    const play = function () { return gate.start(); };
    const pause = function () { return gate.stop(); };
    try { p.play = play; p.pause = pause; } catch (_) { return null; }
    if (p.play !== play || p.pause !== pause) return null;
    return { mode: 'jucePlayer', gate };
}

/*
 * Secondo posto: l'IPC del ponte desktop. Sull'app di oggi non ci si arriva —
 * `contextBridge` sigilla l'oggetto — ma resta perche' e' l'imbuto piu' basso e
 * un domani in cui `window.jucePlayer` non ci fosse piu' lo troverebbe qui.
 *
 * Tre tentativi, dal meno al piu' invasivo, e ognuno si RILEGGE: su un oggetto
 * congelato l'assegnazione fallisce in silenzio, quindi nessuno dei tre viene
 * dato per riuscito. Il secondo e il terzo funzionano solo perche'
 * `transport.js` risolve `window.feedBackDesktop.audio` a ogni chiamata invece
 * di catturarlo all'avvio.
 */
function onBridge(veto) {
    const api = desktopAudio();
    if (!api || typeof api.startBacking !== 'function' || typeof api.stopBacking !== 'function') {
        return null;
    }

    const realStart = api.startBacking.bind(api);
    const realStop = api.stopBacking.bind(api);
    const realLoad = typeof api.loadBackingTrack === 'function'
        ? api.loadBackingTrack.bind(api)
        : null;

    const gate = makeGate({ veto, start: (...a) => realStart(...a), stop: (...a) => realStop(...a) });

    const patch = {
        startBacking: (...a) => gate.start(...a),
        stopBacking: (...a) => gate.stop(...a),
    };
    // Caricare un'altra traccia azzera il motore: quello che sapevamo dello
    // stato non vale piu'.
    if (realLoad) patch.loadBackingTrack = (...a) => { gate.forget(); return realLoad(...a); };

    const names = Object.keys(patch);
    const done = () => {
        const live = desktopAudio();
        return !!live && names.every((n) => live[n] === patch[n]);
    };

    try { for (const n of names) api[n] = patch[n]; } catch (_) { /* congelato */ }
    if (done()) return { mode: 'ponte', gate };

    try {
        for (const n of names) {
            Object.defineProperty(api, n, { value: patch[n], configurable: true, writable: true });
        }
    } catch (_) { /* non configurabile */ }
    if (done()) return { mode: 'ponte-ridefinito', gate };

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
    if (done()) return { mode: 'ponte-audio-sostituito', gate };

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
    if (done()) return { mode: 'ponte-desktop-sostituito', gate };

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
    /*
     * Fuori da JUCE la guardia non sa NIENTE, e deve dirlo.
     *
     * Si installa sempre — `window.jucePlayer` esiste dal primo istante e
     * `_juceMode` si accende solo al caricamento del brano, quindi aspettare
     * quel flag vorrebbe dire non installarsi quasi mai. Ma se il brano poi
     * finisce sull'elemento HTML5, nessuno chiama piu' `jucePlayer.*` e
     * `running` resta fermo al valore con cui e' partita: una risposta vecchia,
     * data con la faccia di una misura. `null` manda chi chiede al pulsante,
     * che li' e' la verita'.
     */
    if (!window._juceMode) return null;
    return guard ? guard.isRunning() : null;
}

/** L'arresto ancora in volo, se ce n'e' uno; `null` altrimenti. */
export function backingSettling() {
    return guard ? guard.settling() : null;
}

/** Quante volte ha soppresso, e quante volte ha dovuto rimediare. */
export function backingGuardStats() {
    return guard ? guard.stats() : null;
}

/** Solo per le prove: dimentica l'installazione. */
export function _resetBackingGuard() {
    guard = null;
    try { delete window[MARK]; } catch (_) { /* niente */ }
}
