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

    const audio = {
        async startBacking() { log.hard++; advancing = true; return true; },
        async stopBacking() { log.stops++; advancing = false; },
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

    globalThis.window = {};
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
    globalThis.document = {
        getElementById: (id) => (id === 'audio' ? { paused: !playing } : null),
    };
    // Il motore che si ferma da solo senza passare dall'arresto: e' il caso in
    // cui la guardia si sbaglia, e deve accorgersene.
    globalThis.stallEngine = () => { advancing = false; };
    return { log, audio, jucePlayer };
}

function install() {
    mod._resetBackingGuard();
    return mod.installBackingGuard();
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
