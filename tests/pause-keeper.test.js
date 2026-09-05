/*
 * Il custode della pausa.
 *
 * La prova che conta e' la quarta: un drill parte con `#audio.play()` subito
 * dopo una pausa chiesta da noi, e se il custode la scambiasse per la ripresa
 * del conteggio spegnerebbe il drill appena avviato. E' il modo piu' facile di
 * scrivere questa correzione e sbagliarla, quindi sta scritto qui.
 *
 * Il tempo e' iniettato: un custode che si puo' provare solo aspettando sei
 * secondi e' un custode che nessuno riprovera'.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const mod = await import('../src/pause-keeper.js');

let clock = 0;
const now = () => clock;

/**
 * Un trasporto finto: `togglePlay` inverte lo stato ed emette, come fa
 * l'originale. `countInResume()` e' la ripresa del conteggio — parte per conto
 * suo, senza passare da nessuna porta.
 */
function makeHost({ playing = true } = {}) {
    const bus = new Map();
    const t = { playing, toggles: 0 };

    function emit(name) {
        for (const fn of bus.get(name) || []) fn();
    }

    globalThis.window = {
        async togglePlay() {
            t.toggles++;
            t.playing = !t.playing;
            emit(t.playing ? 'song:play' : 'song:pause');
        },
        feedBack: {
            playback: {
                async resume() { t.playing = true; emit('song:play'); },
            },
        },
    };
    const el = {
        async play() { t.playing = true; emit('song:play'); },
        get paused() { return !t.playing; },
    };
    globalThis.document = { getElementById: (id) => (id === 'audio' ? el : null) };

    return {
        t,
        el,
        on(name, fn) {
            if (!bus.has(name)) bus.set(name, []);
            bus.get(name).push(fn);
            return () => {};
        },
        // Il conteggio: nessun timbro, nessuna porta.
        countInResume() { t.playing = true; emit('song:play'); },
    };
}

function install(h, extra = {}) {
    mod._resetPauseKeeper();
    clock = 1000;
    return mod.installPauseKeeper({
        now,
        on: h.on,
        loopArmed: () => true,
        ...extra,
    });
}

/** Le porte timbrate sono asincrone: lascia sfilare le microtask. */
const settle = () => new Promise((r) => setTimeout(r, 0));

test('timbra le tre porte quando ci sono tutte', () => {
    const h = makeHost();
    const report = install(h);
    assert.equal(report.installed, true);
    assert.deepEqual(report.doors, ['togglePlay', 'audio.play', 'playback.resume']);
});

test('senza togglePlay non si arma, e lo dice', () => {
    const h = makeHost();
    delete window.togglePlay;
    mod._resetPauseKeeper();
    const report = mod.installPauseKeeper({ now, on: h.on });
    assert.equal(report.installed, false);
});

// ── il difetto ───────────────────────────────────────────────────────────

test('una ripresa non richiesta dopo la pausa viene rimessa in pausa', async () => {
    const h = makeHost({ playing: true });
    install(h);

    await window.togglePlay();          // l'utente mette in pausa
    await settle();
    assert.equal(h.t.playing, false);

    clock += 1500;                      // il conteggio arriva in fondo
    h.countInResume();
    await settle();

    assert.equal(h.t.playing, false, 'la pausa deve avere retto');
    assert.equal(mod.pauseKeeperStats().restored, 1);
});

// ── quello che NON deve fare ─────────────────────────────────────────────

test('un drill che parte subito dopo la nostra pausa non viene fermato', async () => {
    const h = makeHost({ playing: true });
    install(h);

    await window.togglePlay();          // `host.pause()` prima di armare il drill
    await settle();

    clock += 50;
    await document.getElementById('audio').play();   // il rilevatore avvia il drill
    await settle();

    assert.equal(h.t.playing, true, 'il drill deve restare in riproduzione');
    assert.equal(mod.pauseKeeperStats().restored, 0);
});

test('se e lutente a premere play, resta in riproduzione', async () => {
    const h = makeHost({ playing: true });
    install(h);

    await window.togglePlay();          // pausa
    await settle();
    clock += 2000;
    await window.togglePlay();          // e ci ripensa
    await settle();

    assert.equal(h.t.playing, true);
    assert.equal(mod.pauseKeeperStats().restored, 0);
});

test('anche lAPI pubblica di playback vale come richiesta', async () => {
    const h = makeHost({ playing: true });
    install(h);

    await window.togglePlay();
    await settle();
    clock += 800;
    await window.feedBack.playback.resume();
    await settle();

    assert.equal(h.t.playing, true);
    assert.equal(mod.pauseKeeperStats().restored, 0);
});

test('passata la finestra non e piu affare suo', async () => {
    const h = makeHost({ playing: true });
    install(h);

    await window.togglePlay();
    await settle();
    clock += 20000;                     // venti secondi dopo: non e' un conteggio
    h.countInResume();
    await settle();

    assert.equal(h.t.playing, true);
    assert.equal(mod.pauseKeeperStats().restored, 0);
});

test('senza una pausa prima non tocca niente', async () => {
    const h = makeHost({ playing: false });
    install(h);

    clock += 1000;
    h.countInResume();
    await settle();

    assert.equal(h.t.playing, true);
    assert.equal(mod.pauseKeeperStats().restored, 0);
});

test('senza un loop armato non c e conteggio, e non si intromette', async () => {
    const h = makeHost({ playing: true });
    install(h, { loopArmed: () => false });

    await window.togglePlay();
    await settle();
    clock += 1500;
    h.countInResume();
    await settle();

    assert.equal(h.t.playing, true);
    assert.equal(mod.pauseKeeperStats().restored, 0);
});
