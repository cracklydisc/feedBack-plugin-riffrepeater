/*
 * La guardia sull'avvio del motore nativo.
 *
 * Ogni prova qui e' scritta per FALLIRE se la guardia viene tolta: la prima
 * conta le IPC vere, e senza guardia ne conta due. E' il modo in cui questa
 * correzione e' stata verificata a mano sull'app — due `startBacking()` senza
 * un `stopBacking()` in mezzo — trasferito in un posto che non dipende dal
 * fatto che io mi ricordi di rifarlo.
 *
 * Il finto ospite imita l'unica cosa che conta di quello vero: `transport.js`
 * risolve `window.feedBackDesktop.audio.startBacking` A OGNI CHIAMATA. Se lo
 * catturasse all'avvio, le modalita' di ripiego 2 e 3 non coprirebbero niente,
 * quindi il finto ospite chiama sempre passando dal globale.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

let seq = 0;

/**
 * Un motore finto. `hard` conta le chiamate arrivate DAVVERO al motore, che e'
 * il numero che decide se si sente una voce o due.
 */
function makeHost({ freeze = false, playing = false, juce = true } = {}) {
    const log = { hard: 0, stops: 0 };
    let pos = 0;
    let running = playing;
    let advancing = playing;

    const audio = {
        async startBacking() { log.hard++; running = true; advancing = true; return true; },
        async stopBacking() { log.stops++; running = false; advancing = false; },
        async seekBacking(s) { pos = s; },
        async getBackingPosition() { if (advancing) pos += 0.05; return pos; },
        async loadBackingTrack() { return true; },
    };
    if (freeze) Object.freeze(audio);

    globalThis.window = {
        _juceMode: juce,
        feedBackDesktop: { audio },
        // Il motore che si ferma da solo senza passare da stopBacking: e' il
        // caso in cui la guardia si sbaglia, e deve accorgersene.
        _stallEngine() { advancing = false; running = false; },
        _engineRunning: () => running,
    };
    globalThis.document = {
        getElementById: (id) => (id === 'audio' ? { paused: !playing } : null),
    };
    return { log, audio };
}

/** Un'istanza nuova del modulo: tiene stato in chiusura e su `window`. */
function freshModule() {
    return import('../src/backing-guard.js?n=' + (++seq));
}

/** Come la chiama l'app: dal globale, ogni volta. */
function callStart() {
    return window.feedBackDesktop.audio.startBacking();
}
function callStop() {
    return window.feedBackDesktop.audio.stopBacking();
}

// ── il difetto ───────────────────────────────────────────────────────────

test('due avvii senza un arresto in mezzo arrivano al motore una volta sola', async () => {
    const { log } = makeHost();
    const mod = await freshModule();
    assert.equal(mod.installBackingGuard().installed, true);

    await callStart();          // il drill, o il tasto play
    await callStart();          // il conteggio del loop che atterra sopra

    assert.equal(log.hard, 1, 'il motore deve essere stato avviato una volta sola');
    assert.deepEqual(mod.backingGuardStats(), { dropped: 1, rescued: 0 });
});

test('senza la guardia lo stesso ospite ne fa due (la prova vale qualcosa)', async () => {
    const { log } = makeHost();
    await callStart();
    await callStart();
    assert.equal(log.hard, 2);
});

test('due avvii nella stessa raffica, senza attendere, restano uno', async () => {
    const { log } = makeHost();
    const mod = await freshModule();
    mod.installBackingGuard();

    await Promise.all([callStart(), callStart(), callStart()]);

    assert.equal(log.hard, 1);
});

// ── quello che NON deve fare ─────────────────────────────────────────────

test('dopo un arresto un avvio passa: non si sopprime mai una ripresa', async () => {
    const { log } = makeHost();
    const mod = await freshModule();
    mod.installBackingGuard();

    await callStart();
    await callStop();
    await callStart();

    assert.equal(log.hard, 2);
    assert.equal(mod.backingIsRunning(), true);
});

test('caricare unaltra traccia azzera quello che la guardia crede di sapere', async () => {
    const { log } = makeHost();
    const mod = await freshModule();
    mod.installBackingGuard();

    await callStart();
    await window.feedBackDesktop.audio.loadBackingTrack('altra.ogg');
    await callStart();

    assert.equal(log.hard, 2);
});

// ── la rete di sicurezza ─────────────────────────────────────────────────

test('se sopprime a torto se ne accorge e avvia lei', async () => {
    const { log } = makeHost();
    const mod = await freshModule();
    mod.installBackingGuard();

    await callStart();
    assert.equal(log.hard, 1);

    // Il motore si spegne senza passare da stopBacking: la guardia continua a
    // crederlo in moto, ed e' esattamente il caso che lascerebbe muta la
    // canzone se la verifica non esistesse.
    window._stallEngine();
    await callStart();
    assert.equal(log.hard, 1, 'sul momento sopprime, perche' + "' crede di saperlo in moto");

    await new Promise((r) => setTimeout(r, 400));

    assert.equal(log.hard, 2, 'ma entro pochi decimi rimedia da sola');
    assert.equal(window._engineRunning(), true);
    assert.equal(mod.backingGuardStats().rescued, 1);
});

// ── dove riesce a mettersi ───────────────────────────────────────────────

test('in posto quando loggetto e scrivibile', async () => {
    makeHost();
    const mod = await freshModule();
    assert.equal(mod.installBackingGuard().mode, 'in-posto');
});

test('su un oggetto congelato ripiega, e protegge lo stesso', async () => {
    const { log } = makeHost({ freeze: true });
    const mod = await freshModule();

    const report = mod.installBackingGuard();
    assert.equal(report.installed, true);
    assert.notEqual(report.mode, 'in-posto');

    await callStart();
    await callStart();
    assert.equal(log.hard, 1);
});

test('sul congelato la copia porta con se il resto delle IPC', async () => {
    makeHost({ freeze: true });
    const mod = await freshModule();
    mod.installBackingGuard();

    await window.feedBackDesktop.audio.seekBacking(12);
    assert.equal(await window.feedBackDesktop.audio.getBackingPosition(), 12);
});

// ── quando non serve ─────────────────────────────────────────────────────

test('senza il ponte desktop non si installa', async () => {
    makeHost();
    delete window.feedBackDesktop;
    const mod = await freshModule();
    const report = mod.installBackingGuard();
    assert.equal(report.installed, false);
    assert.equal(report.mode, 'niente-ponte');
    assert.equal(mod.backingIsRunning(), null);
});

/*
 * La versione precedente si installava solo con `window._juceMode` acceso, e
 * sarebbe stato un buco silenzioso: quel flag si accende al caricamento della
 * canzone, dopo l'avvio dei plugin. Questa prova tiene ferma la condizione
 * giusta — c'e' il ponte, si installa; il resto lo decide chi chiama le IPC.
 */
test('col ponte desktop si installa anche prima che JUCE si accenda', async () => {
    const { log } = makeHost({ juce: false });
    const mod = await freshModule();
    assert.equal(mod.installBackingGuard().installed, true);

    window._juceMode = true;    // la canzone arriva adesso
    await callStart();
    await callStart();
    assert.equal(log.hard, 1);
});

test('installarla due volte non la impila', async () => {
    const { log } = makeHost();
    const mod = await freshModule();
    mod.installBackingGuard();
    const second = mod.installBackingGuard();
    assert.equal(second.already, true);

    await callStart();
    await callStart();
    assert.equal(log.hard, 1);
});

test('parte sapendo che sta suonando, se sta suonando', async () => {
    const { log } = makeHost({ playing: true });
    const mod = await freshModule();
    mod.installBackingGuard();

    assert.equal(mod.backingIsRunning(), true);
    await callStart();
    assert.equal(log.hard, 0, 'un avvio su un motore gia in moto non arriva al motore');
});
