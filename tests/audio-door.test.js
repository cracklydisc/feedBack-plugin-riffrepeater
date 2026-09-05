/*
 * La porta `#audio`.
 *
 * Il finto ospite riproduce la pila che c'e' davvero sull'elemento: sotto lo
 * shim JUCE (che consulta `window._juceMode` a ogni chiamata), sopra quello del
 * plugin `stems` (che non lo nomina mai e comanda un trasporto WebAudio suo).
 * Il riconoscimento della porta si basa su quella differenza, quindi i finti
 * shim qui hanno il `toString()` che conta: non sono segnaposto.
 *
 * Le due prove che portano il peso sono:
 *   · con stems in cima, `#audio.play()` NON deve avviare la copia di stems;
 *   · senza stems, la porta non deve toccare NIENTE — se prendesse in mano il
 *     trasporto quando lo shim dell'app basta, romperebbe la fusione
 *     "pausa + seek nello stesso tick" su cui contano altri plugin.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const mod = await import('../src/audio-door.js');

function makeHost({ juce = true, stems = false, playing = false } = {}) {
    const log = { juceStart: 0, juceStop: 0, stemsStart: 0, stemsStop: 0, toggles: 0 };
    const t = { appPlaying: playing, stemsPlaying: false };
    const bus = new Map();

    const el = {};
    // Lo shim dell'app: nomina `_juceMode`, che e' come la porta lo riconosce.
    const juceShim = {
        play() { if (window._juceMode) { log.juceStart++; t.appPlaying = true; } return Promise.resolve(); },
        pause() { if (window._juceMode) { log.juceStop++; t.appPlaying = false; } },
    };
    // Lo shim di stems: comanda il suo trasporto e non guarda la modalita'.
    const stemsShim = {
        play() { log.stemsStart++; t.stemsPlaying = true; return Promise.resolve(); },
        pause() { log.stemsStop++; t.stemsPlaying = false; },
    };

    el.play = juceShim.play;
    el.pause = juceShim.pause;
    if (stems) { el.play = stemsShim.play; el.pause = stemsShim.pause; }
    // `paused` e' quello che legge chi sta in cima: stems risponde per se',
    // lo shim JUCE risponde per il trasporto dell'app.
    Object.defineProperty(el, 'paused', {
        get() { return stems ? !t.stemsPlaying : !t.appPlaying; },
        configurable: true,
    });

    const btn = {
        attrs: { 'aria-pressed': playing ? 'true' : 'false' },
        hasAttribute(n) { return n in this.attrs; },
        getAttribute(n) { return this.attrs[n]; },
    };

    globalThis.window = {
        _juceMode: juce,
        async togglePlay() {
            log.toggles++;
            if (t.appPlaying) { t.appPlaying = false; btn.attrs['aria-pressed'] = 'false'; emit('song:pause'); }
            else { t.appPlaying = true; btn.attrs['aria-pressed'] = 'true'; emit('song:play'); }
        },
    };
    globalThis.document = {
        getElementById: (id) => (id === 'audio' ? el : (id === 'btn-play' ? btn : null)),
    };

    function emit(name) { for (const fn of bus.get(name) || []) fn(); }

    return {
        log, t, el, btn, emit,
        on(name, fn) {
            if (!bus.has(name)) bus.set(name, []);
            bus.get(name).push(fn);
            return () => {};
        },
        /** Il trasporto dell'app parte per una via che non passa dalla porta. */
        appStarts() { t.appPlaying = true; btn.attrs['aria-pressed'] = 'true'; },
        /** stems mette in cima i suoi shim dopo di noi (ordine di caricamento). */
        stemsCoversUs() { el.play = stemsShim.play; el.pause = stemsShim.pause; },
    };
}

function install(h) {
    mod._resetAudioDoor();
    return mod.installAudioDoor({ on: h.on });
}

// ── quando NON deve intervenire ──────────────────────────────────────────

test('senza nessuno sopra lo shim dellapp, la porta non tocca niente', async () => {
    const h = makeHost({ stems: false });
    const report = install(h);
    assert.equal(report.installed, true);
    assert.equal(report.foreign, false);

    await document.getElementById('audio').play();

    assert.equal(h.log.juceStart, 1, 'lavvio deve arrivare allo shim dellapp');
    assert.equal(h.log.toggles, 0, 'e non deve passare da togglePlay');
});

test('fuori da JUCE delega sempre: la stems e il trasporto legittimo', async () => {
    const h = makeHost({ juce: false, stems: true });
    install(h);

    await document.getElementById('audio').play();

    assert.equal(h.log.stemsStart, 1);
    assert.equal(h.log.toggles, 0);
});

// ── il difetto ───────────────────────────────────────────────────────────

test('con stems in cima, avviare NON avvia la copia di stems', async () => {
    const h = makeHost({ stems: true });
    const report = install(h);
    assert.equal(report.foreign, true, 'deve riconoscere di avere un estraneo sopra');

    // Come chiude `startDrill` il rilevatore.
    await document.getElementById('audio').play();

    assert.equal(h.log.stemsStart, 0, 'la seconda copia non deve partire');
    assert.equal(h.log.toggles, 1, 'lavvio passa dal trasporto canonico');
    assert.equal(h.t.appPlaying, true);
});

test('senza la porta lo stesso ospite avvia la copia (la prova vale qualcosa)', async () => {
    const h = makeHost({ stems: true });
    await document.getElementById('audio').play();
    assert.equal(h.log.stemsStart, 1);
    assert.equal(h.log.toggles, 0);
});

test('un avvio su un trasporto che gia suona non aggiunge una voce', async () => {
    const h = makeHost({ stems: true });
    install(h);
    h.appStarts();

    await document.getElementById('audio').play();

    assert.equal(h.log.toggles, 0, 'niente toggle: sarebbe una pausa');
    assert.equal(h.log.stemsStart, 0, 'e nessuna seconda copia');
});

test('mettere in pausa ferma la copia estranea e il trasporto', async () => {
    const h = makeHost({ stems: true });
    install(h);
    h.appStarts();
    h.t.stemsPlaying = true;      // la copia era rimasta accesa

    document.getElementById('audio').pause();

    assert.equal(h.log.stemsStop, 1);
    assert.equal(h.log.toggles, 1);
});

test('una pausa che ferma solo il motore zittisce comunque la copia', () => {
    const h = makeHost({ stems: true });
    install(h);
    // La barra spaziatrice: non passa da nessuna porta nostra, ma l'evento si'.
    h.t.stemsPlaying = true;
    h.emit('song:pause');

    assert.equal(h.log.stemsStop, 1);
    assert.deepEqual(mod.audioDoorStats(), { hushed: 1 });
});

test('non zittisce niente se la copia non sta suonando', () => {
    const h = makeHost({ stems: true });
    install(h);
    h.emit('song:pause');
    assert.equal(h.log.stemsStop, 0);
});

/*
 * Se il trasporto dell'app suona e l'elemento dice "suono", i due sono
 * d'accordo e non c'e' nessuna copia da fermare: con il solo shim JUCE questo e'
 * sempre il caso, e zittire li' vorrebbe dire spegnere la canzone.
 */
test('non zittisce il trasporto dellapp travestito da copia', () => {
    const h = makeHost({ stems: false });
    install(h);
    h.appStarts();
    h.emit('song:pause');
    assert.equal(h.log.juceStop, 0);
});

// ── e si rimette in cima ─────────────────────────────────────────────────

test('se stems ci copre dopo, un brano nuovo rimette la porta in cima', async () => {
    const h = makeHost({ stems: false });
    install(h);
    h.stemsCoversUs();            // il plugin si carica dopo di noi

    await document.getElementById('audio').play();
    assert.equal(h.log.stemsStart, 1, 'prima del brano nuovo siamo scavalcati');

    h.emit('song:loaded');
    h.t.stemsPlaying = false;
    await document.getElementById('audio').play();

    assert.equal(h.log.stemsStart, 1, 'dopo, la copia non parte piu');
    assert.equal(h.log.toggles, 1);
});

test('installarla due volte non la impila', async () => {
    const h = makeHost({ stems: true });
    install(h);
    const second = mod.installAudioDoor({ on: h.on });
    assert.equal(second.already, true);

    await document.getElementById('audio').play();
    assert.equal(h.log.stemsStart, 0);
    assert.equal(h.log.toggles, 1);
});
