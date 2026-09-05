/*
 * ─────────────────────────────────────────────────────────────────────────
 * LA PORTA `#audio`: un brano, un trasporto.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * IL DIFETTO, e non era quello che inseguivo. Su questa installazione lo stesso
 * `full.ogg` ha DUE trasporti indipendenti che non si parlano:
 *
 *   · il motore nativo JUCE, guidato da `jucePlayer.*`;
 *   · il trasporto WebAudio del plugin `stems`, guidato da `#audio.play()`.
 *
 * Ci si arriva perche' un feedpak con UN solo stem viene contato come "ha
 * stem" — `partition_stems` tiene `full.ogg` come stem unico — quindi `stems`
 * lo prende in carico (`S.sloppakActive = true`, e non guarda mai
 * `window._juceMode`), mentre `highway.js` manda LO STESSO file al motore
 * nativo perche' l'uscita e' esclusiva. Due padroni per un file.
 *
 * COME SI MANIFESTA. Il rilevatore chiude `startDrill` con `audio.play()`
 * (`notedetect/screen.js:12880`). Quella chiamata non arriva piu' allo shim
 * JUCE: la intercetta stems, che avvia la SUA copia dal proprio playhead — un
 * punto che i seek JUCE non hanno mai mosso, perche' in modalita' JUCE
 * `_audioSeek` non scrive `audio.currentTime`. Poi stems manda un evento
 * `play` sintetico sull'elemento (`stems/src/transport.js:299`), e il listener
 * di `app.js:999` — che NON tocca `S.isPlaying` — scrive
 * `feedBack.isPlaying = true` ed emette `song:play`.
 *
 * Ecco, riga per riga, la traccia che l'utente ha catturato:
 *   · musica che riparte DA UN PUNTO DIVERSO mentre il pulsante dice pausa;
 *   · un `song:play` senza nessuna chiamata a `jucePlayer.play`;
 *   · il motore fermo a 150.87 per cinque secondi e mezzo mentre l'app dice
 *     "sto suonando";
 *   · e, quando si preme play, una SECONDA voce che si somma alla prima —
 *     l'effetto metallico.
 *
 * PERCHE' LA GUARDIA NON POTEVA VEDERLO. `backing-guard.js` sta su
 * `window.jucePlayer.play`, ed e' il posto giusto per tutto cio' che passa dal
 * motore nativo. Questo avvio non ci passa affatto. Nessuna guardia su quel
 * punto avrebbe mai potuto intercettarlo: era il posto sbagliato per questo
 * difetto, non una guardia scritta male.
 *
 * ── LA CORREZIONE ───────────────────────────────────────────────────────
 *
 * In modalita' JUCE la porta `#audio` deve portare al trasporto dell'app, non
 * alla copia di stems. Quindi `play()` e `pause()` vengono reindirizzati su
 * `window.togglePlay()`, che e' la porta canonica: aggiorna `S.isPlaying`, il
 * pulsante, gli eventi, e passa da `jucePlayer.play()` — cioe' dalla guardia e
 * dal veto, che tornano cosi' a valere anche per il drill.
 *
 * SI FA DA PARTE QUANDO NON SERVE. La porta interviene solo se sopra lo shim
 * JUCE si e' messo qualcun altro, e lo riconosce da un fatto misurato: la
 * funzione in cima NON nomina `window._juceMode`. Lo shim JUCE apre proprio con
 * `if (window._juceMode)` (`juce-audio.js:999`) e quel nome compare 17 volte in
 * quel file; in tutto il plugin `stems` compare ZERO volte — apre invece con
 * `if (S.sloppakActive)` (`stems/src/transport.js:416`). Se in cima c'e' ancora
 * lo shim dell'app non tocchiamo niente, e fuori da JUCE deleghiamo sempre:
 * li' stems E' il trasporto legittimo.
 *
 * IL PREZZO, detto per intero. Lo shim di stems si installa una volta sola e
 * resta in cima anche per i brani che non prende in carico, dove delegherebbe
 * correttamente. Non possiamo distinguere i due casi al momento della chiamata —
 * quando il drill parte tutto e' in pausa, e i due stati concordano — quindi
 * quando stems e' caricato la porta prende in mano ogni avvio. Cosi' si perde la
 * fusione "pausa + seek nello stesso tick" dello shim JUCE: una sequenza come
 * quella di Section Map diventa ferma-cerca-riparti invece di una sola cerca.
 * Un movimento in piu' del trasporto in cambio di una voce in meno: lo scambio
 * regge, ma va saputo.
 *
 * E SI RIMETTE IN CIMA. `stems` installa i suoi shim una volta sola, alla
 * valutazione del plugin; se quel momento arriva dopo il nostro, ci copre. Per
 * questo la porta si ricontrolla a ogni brano — se non e' piu' lei in cima, si
 * riavvolge sopra quello che ha trovato.
 */

import { appSaysPaused, audioEl, foreignSound } from './transport-truth.js';
import { stampAround } from './silence.js';

const MARK = '__rrAudioDoor';

let door = null;

/**
 * Lo shim JUCE consulta `window._juceMode` a ogni chiamata; stems non lo
 * nomina mai. Se la funzione in cima non lo nomina, non e' quella dell'app.
 *
 * Il verso del test e' scelto apposta: se un giorno il codice fosse
 * irriconoscibile, `foreign` risulta falso e la porta si fa da parte — cioe' si
 * torna a com'e' oggi senza di noi, che e' il fallimento giusto per una toppa.
 */
function foreignShim(fn) {
    if (typeof fn !== 'function') return false;
    try { return !/_juceMode/.test(fn.toString()); } catch (_) { return false; }
}

export function installAudioDoor(opts = {}) {
    const prev = door || window[MARK];
    if (prev) { prev.reassert(); return { installed: true, already: true, foreign: prev.foreign() }; }

    const on = typeof opts.on === 'function' ? opts.on : null;
    const el = audioEl();
    if (!el || typeof el.play !== 'function') return { installed: false, reason: 'niente elemento' };

    // Quello che sta in cima adesso: puo' essere lo shim JUCE, o stems sopra di
    // lui. Non lo sostituiamo — ci passiamo attraverso quando tocca a lui.
    let under = { play: el.play, pause: el.pause };

    const takeOver = () => !!window._juceMode && foreignShim(under.play);

    function toggle() {
        if (typeof window.togglePlay !== 'function') return null;
        try { return window.togglePlay(); } catch (_) { return null; }
    }

    /** Zittisci la copia estranea, se e' rimasta accesa. */
    function hush() {
        if (!window._juceMode || !foreignShim(under.pause)) return false;
        if (!foreignSound()) return false;
        try { under.pause.call(audioEl()); } catch (_) { return false; }
        door.hushed++;
        console.warn('[riffrepeater] una seconda copia del brano stava suonando fuori dal trasporto: fermata');
        return true;
    }

    const ourPlay = function () {
        // Delegare allo shim dell'app e' un avvio ANNUNCIATO: il timbro lo dice
        // al veto, che altrimenti potrebbe scambiarlo per il riavvio del
        // conteggio e negarlo.
        if (!takeOver()) return stampAround(() => under.play.call(el));
        // Se l'app si dichiara gia' in riproduzione, avviare vorrebbe dire
        // aggiungere una voce: e' esattamente il difetto. Chi chiede di suonare
        // qualcosa che sta gia' suonando ha gia' quello che voleva.
        if (!appSaysPaused()) return Promise.resolve();
        const out = toggle();
        if (out === null) return under.play.call(this);
        return Promise.resolve(out).then(() => undefined);
    };

    const ourPause = function () {
        if (!takeOver()) return under.pause.call(this);
        hush();
        if (!appSaysPaused()) toggle();
        return undefined;
    };

    function place() {
        const live = audioEl();
        if (!live) return false;
        if (live.play === ourPlay && live.pause === ourPause) return true;
        under = { play: live.play, pause: live.pause };
        try { live.play = ourPlay; live.pause = ourPause; } catch (_) { return false; }
        return live.play === ourPlay;
    }

    if (!place()) return { installed: false, reason: 'elemento non scrivibile' };

    const unsubs = [];
    if (on) {
        // Una pausa che ferma solo il motore lascerebbe suonare la copia: e'
        // il caso della barra spaziatrice, che non passa da nessuna porta
        // nostra. Qui invece l'evento arriva comunque.
        unsubs.push(on('song:pause', () => hush()));
        // Un brano nuovo puo' portare shim nuovi sopra il nostro.
        unsubs.push(on('song:loaded', () => { place(); }));
        unsubs.push(on('song:ready', () => { place(); }));
    }

    door = {
        hushed: 0,
        foreign: () => foreignShim(under.play),
        reassert: place,
        hush,
        stats: () => ({ hushed: door.hushed }),
        stop() {
            for (const u of unsubs) { try { u(); } catch (_) { /* va via comunque */ } }
            const live = audioEl();
            if (live && live.play === ourPlay) { live.play = under.play; live.pause = under.pause; }
            door = null;
            try { delete window[MARK]; } catch (_) { /* niente */ }
        },
    };
    window[MARK] = door;
    // Se la copia stava gia' suonando quando siamo arrivati, questo e' il
    // momento buono per accorgersene.
    hush();
    return { installed: true, foreign: door.foreign() };
}

/** Quante volte ha zittito una copia fuori dal trasporto. */
export function audioDoorStats() {
    return door ? door.stats() : null;
}

/** Solo per le prove. */
export function _resetAudioDoor() {
    if (door) door.stop();
    door = null;
    try { delete window[MARK]; } catch (_) { /* niente */ }
}
