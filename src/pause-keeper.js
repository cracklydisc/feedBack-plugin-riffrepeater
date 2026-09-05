/*
 * ─────────────────────────────────────────────────────────────────────────
 * LA PAUSA RESTA PAUSA.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un difetto diverso da quello della guardia, e la guardia non lo copre: qui
 * di voce ce n'e' una sola, ma suona quando l'hai messa in pausa.
 *
 * COME SUCCEDE. A ogni ritorno del loop l'app chiama `startCountIn()`: ferma
 * il motore, conta quattro battiti su un timer, poi riavvia. Se durante quei
 * ~2,4 secondi premi pausa, `togglePlay()` ferma quello che e' gia' fermo e
 * mette il pulsante su pausa — ma NON annulla il conteggio. `_cancelCountIn`
 * scatta solo allo smontaggio del player, non su una pausa, non alla fine di
 * un drill, non quando il loop cambia. Cosi' un battito dopo il conteggio
 * arriva in fondo e fa quello per cui era nato: riavvia. Musica che riparte
 * da sola dopo che hai premuto pausa.
 *
 * PERCHE' NON SI RISOLVE NELLA GUARDIA. La tentazione era sopprimere
 * quell'avvio li', a livello di IPC. Sarebbe stato sbagliato: il conteggio
 * scrive `S.isPlaying = true` DOPO l'avvio, quindi soffocare l'IPC lascerebbe
 * l'app convinta di suonare sopra un motore muto — cioe' esattamente la
 * malattia che stiamo curando, girata dall'altra parte. Meglio lasciarlo
 * partire e rimetterlo in pausa dalla porta normale, `togglePlay()`, che
 * tiene lo stato in ordine per costruzione.
 *
 * COME DISTINGUE UNA RIPRESA VOLUTA DA QUELLA DEL CONTEGGIO. Non guardando
 * chi chiama — guardando chi si e' annunciato. Le riprese legittime passano
 * per `window.togglePlay` (il pulsante, la barra spaziatrice, noi) o per
 * `#audio.play()` (la porta dei plugin, quella con cui il rilevatore fa
 * partire un drill). Le avvolgiamo e ci teniamo un timbro. Il conteggio non
 * passa da nessuna delle due: chiama `jucePlayer.play()` per conto suo. Una
 * ripresa senza timbro, entro pochi secondi da una pausa, e' lui.
 *
 * C'e' una terza porta che timbriamo se la troviamo, `feedBack.playback.resume`,
 * e sull'app di oggi NON c'e': quel `playback` e' un registro di adattatori di
 * trasporto, non un trasporto, e il `resume()` che ho letto vive dentro
 * l'adattatore che l'app registra — irraggiungibile da fuori. Il rapporto
 * elenca le porte che ha davvero timbrato, cosi' la console dice quante sono e
 * non quante speravo. Resta un bordo aperto: una ripresa chiesta da lassu',
 * entro pochi secondi da una pausa e con un loop armato, la rimetteremmo in
 * pausa. Nessuno nell'app e nei plugin la chiama, e il costo sarebbe un play in
 * piu' — quindi resta annotato, non risolto.
 *
 * QUANTO COSTA SBAGLIARE. Se rimettessimo in pausa una ripresa che l'utente
 * voleva, l'utente ripreme play. E' il tetto del danno, ed e' il motivo per
 * cui questa regola puo' esistere: non ha modo di far sparire l'audio, solo
 * di fermarlo una volta di troppo.
 *
 * DOVE NON ENTRA. Se non c'e' un loop armato non c'e' conteggio, e quindi non
 * c'e' niente da sorvegliare: fuori da quel caso non tocchiamo il trasporto di
 * nessuno.
 */

/** Oltre questo, dopo una pausa, una ripresa non e' piu' attribuibile al conteggio. */
const WINDOW_MS = 6000;

/** Quanto puo' distare un timbro dall'evento perche' valga come attribuzione. */
const NEAR_MS = 400;

/*
 * Il segno su `window`, e non solo la variabile di modulo: l'app RIVALUTA lo
 * script di un plugin a ogni aggiornamento, ripristino e reinstallazione, e
 * ogni rivalutazione e' un modulo nuovo con le sue variabili. Senza il segno,
 * il secondo giro avvolgerebbe `togglePlay` sopra l'avvolgimento del primo, e
 * il terzo sopra il secondo. Le porte si timbrano una volta per pagina.
 */
const MARK = '__rrPauseKeeper';

let keeper = null;

function stopped() {
    const el = document.getElementById('audio');
    return !el || el.paused === true;
}

/**
 * Avvolge `owner[name]` per lasciare un timbro attorno alla chiamata, e dice
 * se c'e' riuscita. Rilegge sempre: una proprieta' non scrivibile fallisce in
 * silenzio, e una porta che credi di sorvegliare senza sorvegliarla e' peggio
 * di una che sai di non sorvegliare.
 */
function stamp(owner, name, marks, after) {
    if (!owner || typeof owner[name] !== 'function') return false;
    const orig = owner[name];
    const wrapper = function (...args) {
        marks.depth++;
        const settle = () => { marks.close(); if (after) after(); };
        let out;
        try {
            out = orig.apply(this, args);
        } catch (err) {
            settle();
            throw err;
        }
        if (out && typeof out.then === 'function') out.then(settle, settle);
        else settle();
        return out;
    };
    try { owner[name] = wrapper; } catch (_) { return false; }
    return owner[name] === wrapper;
}

/**
 * Installa il custode. Idempotente; torna un rapporto invece di lanciare, e il
 * rapporto dice quali porte e' riuscita a timbrare — con meno di
 * `window.togglePlay` non si arma affatto, perche' senza quella non saprebbe
 * distinguere una ripresa voluta e finirebbe per contrastare l'utente.
 */
export function installPauseKeeper(opts = {}) {
    const now = opts.now || (() => Date.now());
    const windowMs = opts.windowMs || WINDOW_MS;
    const nearMs = opts.nearMs || NEAR_MS;
    const on = opts.on;               // host.on, iniettabile per le prove
    const loopArmed = opts.loopArmed; // () => bool

    const prev = keeper || window[MARK];
    if (prev) return { installed: true, already: true, doors: prev.doors };

    const marks = {
        depth: 0,
        lastEnd: 0,
        close() { marks.depth = Math.max(0, marks.depth - 1); marks.lastEnd = now(); },
    };
    const attributed = () => marks.depth > 0 || (now() - marks.lastEnd) < nearMs;

    const state = { pausedAt: 0, restored: 0, doors: [] };

    /*
     * Porta 1: il pulsante, la barra spaziatrice, e noi. Senza questa non si
     * arma, ed e' la sola indispensabile — perche' fa due lavori: attribuisce
     * una ripresa, e dice QUANDO e' stata chiesta una pausa. Quel secondo dato
     * si legge a chiamata conclusa, non prima: `togglePlay` e' un toggle, e
     * quale dei due versi abbia preso lo dice solo lo stato dopo.
     */
    const armed = stamp(window, 'togglePlay', marks, () => {
        state.pausedAt = stopped() ? now() : 0;
    });
    if (!armed) return { installed: false, reason: 'togglePlay non timbrabile' };
    state.doors.push('togglePlay');

    // Porta 2: la strada dei plugin. Il drill parte da qui, e parte spesso
    // subito dopo una pausa che abbiamo chiesto noi — senza questo timbro il
    // custode fermerebbe il drill appena avviato.
    const el = document.getElementById('audio');
    if (el && stamp(el, 'play', marks)) state.doors.push('audio.play');

    // Porta 3: l'API pubblica di playback, per i plugin che la usano.
    const pb = window.feedBack && window.feedBack.playback;
    if (pb && stamp(pb, 'resume', marks)) state.doors.push('playback.resume');

    const unsub = typeof on === 'function' ? on('song:play', onPlay) : () => {};

    function onPlay() {
        if (!state.pausedAt) return;
        if (now() - state.pausedAt > windowMs) { state.pausedAt = 0; return; }
        if (attributed()) { state.pausedAt = 0; return; }
        if (typeof loopArmed === 'function' && !loopArmed()) return;
        // Nessun timbro, subito dopo una pausa, con un loop armato: e' il
        // conteggio che si e' ripreso da solo.
        state.pausedAt = 0;
        state.restored++;
        console.warn('[riffrepeater] la riproduzione era ripartita da sola dopo la pausa: rimessa in pausa');
        try { window.togglePlay(); } catch (_) { /* niente da fare */ }
    }

    keeper = {
        doors: state.doors,
        stats: () => ({ restored: state.restored }),
        stop() { try { unsub(); } catch (_) {} keeper = null; },
    };
    window[MARK] = keeper;
    return { installed: true, doors: state.doors };
}

/** Quante riprese non richieste ha rimesso in pausa. */
export function pauseKeeperStats() {
    return keeper ? keeper.stats() : null;
}

/** Solo per le prove: smonta il custode. */
export function _resetPauseKeeper() {
    if (keeper) keeper.stop();
    keeper = null;
    try { delete window[MARK]; } catch (_) { /* niente */ }
}
