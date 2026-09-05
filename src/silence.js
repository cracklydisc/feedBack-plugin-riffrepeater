/*
 * ─────────────────────────────────────────────────────────────────────────
 * QUANDO L'UTENTE VUOLE SILENZIO.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Questo modulo non ferma niente: risponde a una domanda sola, `wantsSilence()`,
 * e chi la fa e' la guardia, un istante prima di avviare il motore. Se la
 * risposta e' si', l'avvio non parte — e non parte PRIMA di fare rumore, invece
 * di essere rincorso dopo.
 *
 * ── PERCHE' HA SOSTITUITO IL CUSTODE ────────────────────────────────────
 *
 * Il custode (`pause-keeper.js`, ritirato) aspettava la ripresa non richiesta e
 * la disfaceva con un `togglePlay()`. Due difetti fatali, tutti e due misurati
 * sul codice dell'app e non supposti:
 *
 * 1. ERA CIECO ALLA BARRA SPAZIATRICE. Timbrava `window.togglePlay`, ma
 *    `app.js:1957` registra la scorciatoia come `handler: () => togglePlay()`
 *    con il binding IMPORTATO da `transport.js`. Un binding importato non passa
 *    da una proprieta' su `window`: chi mette in pausa con lo spazio non veniva
 *    visto affatto. (Il pulsante si', perche' `index.html:1273` e' un
 *    `onclick="togglePlay()"` inline, che il nome lo risolve su `window`.)
 *
 * 2. ARRIVAVA DOPO. Anche quando vedeva la pausa, il suo `stopBacking()`
 *    partiva un paio di millisecondi dopo che `startBacking()` era gia' andato
 *    al motore nativo. Una corsa contro un motore che da JS non si legge, e
 *    quindi nemmeno si arbitra.
 *
 * E poggiava su una premessa SBAGLIATA, che avevo scritto io: "negare l'avvio
 * lascerebbe l'app convinta di suonare sopra un motore muto". Non e' vero, e si
 * legge nei chiamanti — `jucePlayer.play()` che torna `false` e' un esito di
 * contratto che tutti gestiscono senza toccare lo stato:
 *
 *     count-in.js:287    if (!started) return;
 *     transport.js:320   if (!started) return;
 *     juce-audio.js:1003 if (gen !== _juceShimGen || !started) return;
 *
 * Quindi il veto e' pulito: niente suono, niente stato incoerente, bottone gia'
 * su pausa, posizione gia' su A.
 *
 * ── LA REGOLA ───────────────────────────────────────────────────────────
 *
 * Si nega un avvio quando valgono tutte:
 *
 *   1. C'E' UN CONTEGGIO IN VOLO. `loop:restart` e' la sua firma esclusiva —
 *      lo emette solo `count-in.js` (righe 201 e 266) — ed esce di scena al
 *      primo `song:play`. Oltre i 12 secondi si considera finito comunque.
 *   2. IL TRASPORTO DICE PAUSA (`#audio.paused`, cioe' `!S.isPlaying`). E'
 *      QUESTO che distingue il caso buono dal cattivo: in un giro di loop
 *      normale il conteggio non tocca `S.isPlaying`, quindi qui si legge
 *      "sto suonando" e non si nega niente. Se invece si legge "in pausa",
 *      qualcuno l'ha dichiarata, e il conteggio non lo sa.
 *   3. NESSUNO L'HA CHIESTO ORA: niente timbro sulle porte dei plugin, e
 *      nessun tasto o clic negli ultimi 400 ms. Il gesto e' la rete che copre
 *      la barra spaziatrice: `togglePlay` chiama `jucePlayer.play()` nello
 *      stesso task dell'evento, quindi fra `keydown` e avvio non passa nulla.
 *   4. IL SILENZIO E' RECENTE O IL CONTEGGIO NON ERA VOLUTO: o e' arrivato un
 *      `song:pause` dopo l'inizio del conteggio, oppure il conteggio non
 *      nasceva da un gesto (un giro di loop automatico, non un Restart o una
 *      sezione scelta a mano).
 *
 * UN VETO SOLO PER CONTEGGIO. Il conteggio ha un `play()` da sparare: dopo
 * averlo negato ce lo dimentichiamo. Cosi' un avvio legittimo che capiti negli
 * stessi secondi — la ripresa automatica di un cambio di arrangiamento, per
 * dire — non trova piu' un veto acceso.
 *
 * COME SBAGLIA. Nel peggiore dei casi il brano resta fermo con il pulsante gia'
 * su pausa e l'utente ripreme play: un gesto, quindi passa. Non puo' creare due
 * voci, non puo' creare stati incoerenti, non puo' zittire piu' di un avvio per
 * conteggio.
 */

/** Oltre questo un `loop:restart` non e' piu' un conteggio in volo. */
const COUNTIN_MAX_MS = 12000;

/** Un avvio cosi' vicino a un tasto o a un clic e' dell'utente. */
const GESTURE_MS = 400;

/** Un conteggio cosi' vicino a un gesto e' un conteggio che e' stato chiesto. */
const ASKED_MS = 2000;

/**
 * Avvolge `owner[name]` per lasciare un timbro attorno alla chiamata, e dice se
 * c'e' riuscita. Rilegge sempre: una proprieta' non scrivibile fallisce in
 * silenzio, e una porta che credi di sorvegliare senza sorvegliarla e' peggio
 * di una che sai di non sorvegliare.
 */
function stamp(owner, name, marks) {
    if (!owner || typeof owner[name] !== 'function') return false;
    const orig = owner[name];
    const wrapper = function (...args) {
        marks.depth++;
        const close = () => { marks.depth = Math.max(0, marks.depth - 1); marks.end = marks.now(); };
        let out;
        try {
            out = orig.apply(this, args);
        } catch (err) {
            close();
            throw err;
        }
        if (out && typeof out.then === 'function') out.then(close, close);
        else close();
        return out;
    };
    try { owner[name] = wrapper; } catch (_) { return false; }
    return owner[name] === wrapper;
}

let oracle = null;

const MARK = '__rrSilence';

export function installSilence(opts = {}) {
    const prev = oracle || window[MARK];
    if (prev) return { installed: true, already: true, doors: prev.doors, wantsSilence: prev.wantsSilence };

    const now = opts.now || (() => Date.now());
    const on = opts.on;
    const doc = opts.doc || document;

    const marks = { depth: 0, end: -Infinity, now };
    const st = { gestureAt: -Infinity, countIn: null, vetoed: 0 };

    const gesture = () => { st.gestureAt = now(); };
    // In cattura, perche' deve precedere sia il dispatcher delle scorciatoie sia
    // l'`onclick` inline del pulsante — non sapere di un gesto e' l'unico modo
    // in cui questa regola puo' contrastare l'utente.
    doc.addEventListener('keydown', gesture, true);
    doc.addEventListener('pointerdown', gesture, true);

    const sub = typeof on === 'function' ? on : () => () => {};
    const unsubs = [
        sub('loop:restart', () => {
            st.countIn = {
                at: now(),
                asked: (now() - st.gestureAt) < ASKED_MS,
                pausedSince: false,
            };
        }),
        sub('song:pause', () => { if (st.countIn) st.countIn.pausedSince = true; }),
        sub('song:play', () => { st.countIn = null; }),
        sub('song:resume', () => { st.countIn = null; }),
    ];

    const doors = [];
    if (stamp(doc.getElementById('audio'), 'play', marks)) doors.push('audio.play');
    if (stamp(window, 'togglePlay', marks)) doors.push('togglePlay');

    const paused = () => {
        const el = doc.getElementById('audio');
        return !el || el.paused === true;
    };
    const stamped = () => marks.depth > 0 || (now() - marks.end) < GESTURE_MS;

    function wantsSilence() {
        const c = st.countIn;
        if (!c) return false;
        if (now() - c.at > COUNTIN_MAX_MS) { st.countIn = null; return false; }
        if (!paused()) return false;
        if (stamped() || (now() - st.gestureAt) < GESTURE_MS) return false;
        if (!(c.pausedSince || !c.asked)) return false;
        // Un veto solo per conteggio: quello che aveva da sparare l'ha sparato.
        st.countIn = null;
        st.vetoed++;
        return true;
    }

    oracle = {
        doors,
        wantsSilence,
        stats: () => ({ vetoed: st.vetoed }),
        stop() {
            for (const u of unsubs) { try { u(); } catch (_) { /* va via comunque */ } }
            doc.removeEventListener('keydown', gesture, true);
            doc.removeEventListener('pointerdown', gesture, true);
            oracle = null;
            try { delete window[MARK]; } catch (_) { /* niente */ }
        },
    };
    window[MARK] = oracle;
    return { installed: true, doors, wantsSilence };
}

/** Quanti avvii ha negato. */
export function silenceStats() {
    return oracle ? oracle.stats() : null;
}

/** Solo per le prove. */
export function _resetSilence() {
    if (oracle) oracle.stop();
    oracle = null;
    try { delete window[MARK]; } catch (_) { /* niente */ }
}
