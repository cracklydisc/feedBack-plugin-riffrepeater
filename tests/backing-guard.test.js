/*
 * La guardia sull'avvio del motore nativo.
 *
 * Il finto ospite imita i due fatti che decidono se questa correzione funziona
 * o no sull'app vera:
 *
 *   1. `window.jucePlayer` e' LO STESSO oggetto che i moduli importano, e tutti
 *      lo chiamano come `jucePlayer.play()` — cioe' risolvendo la proprieta' al
 *      momento della chiamata. Percio' qui i chiamanti passano sempre da
 *      `window.jucePlayer.play()`, mai da un riferimento catturato.
 *   2. l'oggetto del `contextBridge` puo' essere CONGELATO, ed e' il caso
 *      dell'app di oggi: `guardia doppio-avvio NO (oggetto-sigillato)`. La prova
 *      che conta e' quella che mette insieme le due cose — ponte sigillato e
 *      `jucePlayer` disponibile — perche' e' la macchina dell'utente.
 *
 * Ogni prova e' scritta per fallire se la guardia viene tolta: si contano gli
 * avvii arrivati DAVVERO al motore, che e' il numero che decide se si sente una
 * voce o due.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const mod = await import('../src/backing-guard.js');

/**
 * @param freeze  congela l'oggetto del ponte (il caso reale)
 * @param player  esponi `window.jucePlayer` (il caso reale)
 */
function makeHost({ freeze = false, playing = false, player = true } = {}) {
    const log = { hard: 0, stops: 0 };
    let pos = 0;
    let advancing = playing;

    const lento = { avvio: null, arresto: null };
    const audio = {
        async startBacking() {
            // Con `lento.rilascia` armato l'avvio resta appeso: serve a mettere
            // un arresto DENTRO un avvio ancora in volo.
            if (lento.avvio) await new Promise((r) => { lento.avvio = r; });
            log.hard++; advancing = true; return true;
        },
        async stopBacking() {
            if (lento.arresto) await new Promise((r) => { lento.arresto = r; });
            log.stops++; advancing = false;
        },
        async seekBacking(s) { pos = s; },
        async getBackingPosition() { if (advancing) pos += 0.05; return pos; },
        async loadBackingTrack() { return true; },
    };
    if (freeze) Object.freeze(audio);

    const jucePlayer = {
        _polling: playing,
        async play() {
            const ok = await window.feedBackDesktop.audio.startBacking();
            if (ok === false) return false;
            this._polling = true;
            return true;
        },
        async pause() {
            this._polling = false;
            await window.feedBackDesktop.audio.stopBacking();
        },
        _startPolling() { this._polling = true; },
    };

    // In JUCE, che e' l'unica modalita' in cui la guardia sa qualcosa: fuori
    // di li' nessuno chiama `jucePlayer.*` e quello che sapeva invecchia.
    globalThis.window = { _juceMode: true };
    if (freeze) {
        // Come `contextBridge.exposeInMainWorld`: l'oggetto e' congelato E la
        // proprieta' su `window` non e' ne' scrivibile ne' riconfigurabile.
        // Congelare solo l'oggetto interno lascerebbe passare la copia, e la
        // prova direbbe "protetto" dove l'app dice `oggetto-sigillato`.
        Object.defineProperty(window, 'feedBackDesktop', {
            value: Object.freeze({ audio }),
            writable: false,
            configurable: false,
            enumerable: true,
        });
    } else {
        window.feedBackDesktop = { audio };
    }
    if (player) window.jucePlayer = jucePlayer;
    /*
     * `#audio.paused` e' lo stato che l'APP dichiara, e non e' lo stato del
     * motore: i chiamanti lo scrivono dopo che `play()` e' tornato, e il
     * conteggio non lo scrive affatto. Qui e' mutabile apposta, perche' e' la
     * leva che separa "il motore e' fermo" da "l'utente vuole silenzio".
     */
    let appPlaying = playing;
    globalThis.setAppPlaying = (v) => { appPlaying = v; };
    globalThis.document = {
        getElementById: (id) => (id === 'audio' ? { get paused() { return !appPlaying; } } : null),
    };
    // Il motore che si ferma da solo senza passare dall'arresto: e' il caso in
    // cui la guardia si sbaglia, e deve accorgersene.
    globalThis.stallEngine = () => { advancing = false; };
    return { log, audio, jucePlayer, lento };
}

function install(opts) {
    mod._resetBackingGuard();
    return mod.installBackingGuard(opts);
}

/** Come lo chiamano togglePlay, lo shim e il conteggio: dal globale, ogni volta. */
const viaPlayer = () => window.jucePlayer.play();
const viaPlayerStop = () => window.jucePlayer.pause();
/** Come ci arriva `jucePlayer` stesso, quando la guardia sta sul ponte. */
const viaBridge = () => window.feedBackDesktop.audio.startBacking();
const viaBridgeStop = () => window.feedBackDesktop.audio.stopBacking();

// ── dove si monta ────────────────────────────────────────────────────────

test('si monta su jucePlayer, che e limbuto che il conteggio attraversa', () => {
    makeHost();
    assert.equal(install().mode, 'jucePlayer');
});

test('senza jucePlayer ripiega sul ponte', () => {
    makeHost({ player: false });
    assert.equal(install().mode, 'ponte');
});

test('ponte sigillato e nessun jucePlayer: non si installa, e lo dice', () => {
    makeHost({ freeze: true, player: false });
    const report = install();
    assert.equal(report.installed, false);
    assert.equal(report.mode, 'oggetto-sigillato');
    assert.equal(mod.backingIsRunning(), null);
});

// ── il difetto ───────────────────────────────────────────────────────────

test('due avvii senza un arresto in mezzo arrivano al motore una volta sola', async () => {
    const { log } = makeHost();
    install();

    await viaPlayer();          // il drill, o il tasto play
    await viaPlayer();          // il conteggio del loop che atterra sopra

    assert.equal(log.hard, 1, 'il motore deve essere stato avviato una volta sola');
    assert.deepEqual(mod.backingGuardStats(), { dropped: 1, rescued: 0 });
});

test('senza la guardia lo stesso ospite ne fa due (la prova vale qualcosa)', async () => {
    const { log } = makeHost();
    await viaPlayer();
    await viaPlayer();
    assert.equal(log.hard, 2);
});

/*
 * La macchina dell'utente: il ponte non si lascia toccare, e la protezione deve
 * arrivare comunque. E' la prova per cui la guardia e' stata riscritta.
 */
test('col ponte sigillato protegge lo stesso, da jucePlayer', async () => {
    const { log } = makeHost({ freeze: true });
    assert.equal(install().mode, 'jucePlayer');

    await viaPlayer();
    await viaPlayer();

    assert.equal(log.hard, 1);
});

test('sul ponte, quando ci si arriva, vale la stessa regola', async () => {
    const { log } = makeHost({ player: false });
    install();

    await viaBridge();
    await viaBridge();

    assert.equal(log.hard, 1);
});

test('due avvii nella stessa raffica, senza attendere, restano uno', async () => {
    const { log } = makeHost();
    install();

    await Promise.all([viaPlayer(), viaPlayer(), viaPlayer()]);

    assert.equal(log.hard, 1);
});

// ── quello che NON deve fare ─────────────────────────────────────────────

test('dopo un arresto un avvio passa: non si sopprime mai una ripresa', async () => {
    const { log } = makeHost();
    install();

    await viaPlayer();
    await viaPlayerStop();
    await viaPlayer();

    assert.equal(log.hard, 2);
    assert.equal(mod.backingIsRunning(), true);
});

test('caricare unaltra traccia azzera quello che la guardia crede di sapere', async () => {
    const { log } = makeHost({ player: false });
    install();

    await viaBridge();
    await window.feedBackDesktop.audio.loadBackingTrack('altra.ogg');
    await viaBridge();

    assert.equal(log.hard, 2);
});

test('sopprimere lavvio non spegne il campionamento della posizione', async () => {
    const { jucePlayer } = makeHost();
    install();

    await viaPlayer();
    jucePlayer._polling = false;    // come se il conteggio lo avesse fermato
    await viaPlayer();

    assert.equal(jucePlayer._polling, true, 'lautostrada non deve restare ferma');
});

test('sul ponte sigillato il resto delle IPC resta raggiungibile', async () => {
    makeHost({ freeze: true });
    install();

    await window.feedBackDesktop.audio.seekBacking(12);
    assert.equal(await window.feedBackDesktop.audio.getBackingPosition(), 12);
});

// ── la rete di sicurezza ─────────────────────────────────────────────────

test('se sopprime a torto se ne accorge e avvia lei', async () => {
    const { log } = makeHost();
    install();

    await viaPlayer();
    setAppPlaying(true);       // come fa chi ha chiesto l'avvio, appena torna
    assert.equal(log.hard, 1);

    // Il motore si spegne senza passare dall'arresto: la guardia continua a
    // crederlo in moto, ed e' esattamente il caso che lascerebbe muta la
    // canzone se la verifica non esistesse.
    stallEngine();
    await viaPlayer();
    assert.equal(log.hard, 1, 'sul momento sopprime, perche' + "' crede di saperlo in moto");

    await new Promise((r) => setTimeout(r, 400));

    assert.equal(log.hard, 2, 'ma entro pochi decimi rimedia da sola');
    assert.equal(mod.backingGuardStats().rescued, 1);
});

// ── contorno ─────────────────────────────────────────────────────────────

test('senza ponte e senza player non si installa', async () => {
    makeHost();
    delete window.feedBackDesktop;
    delete window.jucePlayer;
    const report = install();
    assert.equal(report.installed, false);
    assert.equal(report.mode, 'oggetto-sigillato');
});

test('installarla due volte non la impila', async () => {
    const { log } = makeHost();
    install();
    const second = mod.installBackingGuard();
    assert.equal(second.already, true);

    await viaPlayer();
    await viaPlayer();
    assert.equal(log.hard, 1);
});

test('parte sapendo che sta suonando, se sta suonando', async () => {
    const { log } = makeHost({ playing: true });
    install();

    assert.equal(mod.backingIsRunning(), true);
    await viaPlayer();
    assert.equal(log.hard, 0, 'un avvio su un motore gia in moto non arriva al motore');
});

// ── il veto ──────────────────────────────────────────────────────────────

/*
 * La guardia da sola sa solo deduplicare: distingue due avvii, non un avvio
 * voluto da uno che nessuno ha chiesto. Quella distinzione la porta `silence.js`,
 * e la guardia la consulta un istante prima di partire.
 */
test('col veto alzato lavvio non arriva al motore', async () => {
    const { log } = makeHost();
    install({ veto: () => true });

    const esito = await viaPlayer();

    assert.equal(log.hard, 0);
    assert.equal(esito, false, 'false e lesito che i chiamanti gia gestiscono');
    assert.equal(mod.backingIsRunning(), false);
});

test('col veto abbassato lavvio passa', async () => {
    const { log } = makeHost();
    install({ veto: () => false });

    await viaPlayer();

    assert.equal(log.hard, 1);
});

test('la rete di sicurezza non contraddice una pausa dichiarata', async () => {
    // Trasporto in pausa (`#audio.paused` true), guardia convinta che suoni:
    // la verifica troverebbe la posizione ferma, ma riavviare qui vorrebbe dire
    // suonare contro chi ha appena messo in pausa.
    const { log } = makeHost({ playing: false });
    install();

    await viaPlayer();
    assert.equal(log.hard, 1);
    stallEngine();
    await viaPlayer();
    await new Promise((r) => setTimeout(r, 400));

    assert.equal(log.hard, 1, 'niente rimedio contro la pausa');
    assert.equal(mod.backingGuardStats().rescued, 0);
});

// ── un avvio sorpassato da un arresto ────────────────────────────────────

test('se un arresto passa mentre lavvio e in volo, la guardia non resta convinta', async () => {
    const h = makeHost();
    install();

    h.lento.avvio = true;                 // il prossimo avvio resta appeso
    const inVolo = viaPlayer();
    await new Promise((r) => setTimeout(r, 0));
    await viaPlayerStop();                // arresto mentre l'avvio non e' tornato
    h.lento.avvio();                      // ora l'avvio si risolve
    await inVolo;

    assert.equal(mod.backingIsRunning(), false,
        'un avvio vecchio non deve dire "sta suonando" sopra un motore fermo');

    h.lento.avvio = null;
    await viaPlayer();
    assert.equal(h.log.hard, 2, 'e il prossimo avvio non viene soppresso a torto');
});

test('fuori da JUCE la guardia non risponde: quello che sapeva e vecchio', async () => {
    makeHost();
    install();
    await viaPlayer();
    assert.equal(mod.backingIsRunning(), true);

    // Il brano finisce sull'elemento HTML5: da qui in poi nessuno chiama piu'
    // `jucePlayer.*`, quindi `running` resta fermo all'ultimo valore noto. Una
    // risposta vecchia con la faccia di una misura e' peggio di nessuna
    // risposta: chi chiede deve poter ripiegare sul pulsante.
    window._juceMode = false;
    assert.equal(mod.backingIsRunning(), null);
});

test('un arresto in volo si puo attendere', async () => {
    const h = makeHost();
    install();
    await viaPlayer();

    h.lento.arresto = true;
    const inVolo = viaPlayerStop();
    await new Promise((r) => setTimeout(r, 0));

    const attesa = mod.backingSettling();
    assert.ok(attesa, 'finche non e atterrato, c e qualcosa da attendere');
    h.lento.arresto();
    await inVolo;
    await attesa;
    assert.equal(mod.backingSettling(), null, 'atterrato, non c e piu niente');
});
