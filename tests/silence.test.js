/*
 * "L'utente vuole silenzio adesso?"
 *
 * La prova che porta il peso e' la prima: nel giro di loop NORMALE il conteggio
 * ferma e riavvia il motore di continuo, e li' non si deve negare niente. Il
 * solo dato che separa quel caso da quello rotto e' che il conteggio non tocca
 * `S.isPlaying`, quindi durante un giro normale il trasporto dice ancora "sto
 * suonando" — e se questa prova cadesse, il rimedio spegnerebbe ogni loop del
 * gioco.
 *
 * Il tempo e' iniettato: una regola con dentro dodici secondi non si prova
 * aspettandoli.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const mod = await import('../src/silence.js');

let clock = 0;
const now = () => clock;

function makeHost({ playing = true } = {}) {
    const bus = new Map();
    const listeners = new Map();
    const t = { playing };

    const probe = { fn: null };
    const el = {
        // `probe` campiona DENTRO la chiamata, che e' dove la guardia consulta
        // il veto: `jucePlayer.play()` parte da qui, mentre il timbro e' alzato.
        async play() { if (probe.fn) probe.fn(); t.playing = true; emit('song:play'); },
        get paused() { return !t.playing; },
    };

    function emit(name) {
        for (const fn of bus.get(name) || []) fn();
    }

    const doc = {
        addEventListener(name, fn) {
            if (!listeners.has(name)) listeners.set(name, []);
            listeners.get(name).push(fn);
        },
        removeEventListener() {},
        getElementById: (id) => (id === 'audio' ? el : null),
    };

    globalThis.window = {
        async togglePlay() { t.playing = !t.playing; emit(t.playing ? 'song:play' : 'song:pause'); },
    };
    globalThis.document = doc;

    return {
        t,
        el,
        probe,
        on(name, fn) {
            if (!bus.has(name)) bus.set(name, []);
            bus.get(name).push(fn);
            return () => {};
        },
        emit,
        /** Un tasto o un clic, come li vede il listener in cattura. */
        gesture() { for (const fn of listeners.get('keydown') || []) fn(); },
        /** L'inizio del conteggio: la sua firma esclusiva. */
        countInStarts() { emit('loop:restart'); },
        /** Il conteggio ferma il motore SENZA dirlo a `S.isPlaying`. */
        countInPausesEngine() { /* nessun evento, nessun cambio di stato */ },
        /** La pausa dell'utente, da qualunque strada arrivi. */
        userPauses() { t.playing = false; emit('song:pause'); },
    };
}

function install(h) {
    mod._resetSilence();
    clock = 100000;
    return mod.installSilence({ now, on: h.on, doc: document });
}

// ── il caso da NON rompere ───────────────────────────────────────────────

test('nel giro di loop normale non si nega niente', () => {
    const h = makeHost({ playing: true });
    const s = install(h);

    h.countInStarts();
    h.countInPausesEngine();       // motore fermo, ma `S.isPlaying` resta true
    clock += 2400;                 // i quattro battiti

    assert.equal(s.wantsSilence(), false, 'il loop deve continuare a girare');
});

// ── il difetto ───────────────────────────────────────────────────────────

test('pausa durante il conteggio: il suo avvio va negato', () => {
    const h = makeHost({ playing: true });
    const s = install(h);

    h.countInStarts();
    clock += 800;
    h.userPauses();                // spazio o pulsante, per il caso non cambia
    clock += 1600;

    assert.equal(s.wantsSilence(), true);
    assert.deepEqual(mod.silenceStats(), { vetoed: 1 });
});

test('la barra spaziatrice vale quanto il pulsante', () => {
    const h = makeHost({ playing: true });
    const s = install(h);

    h.countInStarts();
    clock += 800;
    // Lo spazio non passa da `window.togglePlay` (app.js:1957 usa il binding
    // importato): arriva solo l'evento. E' esattamente il caso che il custode
    // precedente non vedeva.
    h.t.playing = false;
    h.emit('song:pause');
    clock += 1600;

    assert.equal(s.wantsSilence(), true);
});

test('un veto per conteggio, non uno per avvio', () => {
    const h = makeHost({ playing: true });
    const s = install(h);

    h.countInStarts();
    clock += 800;
    h.userPauses();
    clock += 1600;

    assert.equal(s.wantsSilence(), true);
    assert.equal(s.wantsSilence(), false, 'il secondo avvio non e piu suo');
});

test('la canzone in pausa che il tick riavvolge lo stesso', () => {
    // Nessuna pausa DOPO l'inizio del conteggio: la pausa c'era gia'. Il
    // rilevatore del wrap non guarda se il trasporto suona, quindi il conteggio
    // parte da fermo e riavvierebbe la canzone da solo.
    const h = makeHost({ playing: false });
    const s = install(h);

    clock += 5000;                 // nessun gesto: non l'ha chiesto nessuno
    h.countInStarts();
    clock += 2400;

    assert.equal(s.wantsSilence(), true);
});

// ── quello che NON deve negare ───────────────────────────────────────────

test('se lutente preme play, passa', () => {
    const h = makeHost({ playing: true });
    const s = install(h);

    h.countInStarts();
    clock += 800;
    h.userPauses();
    clock += 1600;
    h.gesture();                   // preme play mentre il conteggio finisce

    assert.equal(s.wantsSilence(), false);
});

test('un avvio annunciato dalla porta passa', () => {
    const h = makeHost({ playing: true });
    const s = install(h);

    h.countInStarts();
    clock += 800;
    h.userPauses();
    clock += 1600;

    /*
     * `stampAround` e' come la porta `#audio` annuncia una delega allo shim
     * dell'app: il rilevatore sta avviando un drill, e dentro quella chiamata il
     * veto deve tacere. Senza questo, il drill che parte subito dopo la nostra
     * pausa verrebbe zittito — il modo piu' facile di sbagliare tutto.
     */
    const dentro = mod.stampAround(() => s.wantsSilence());

    assert.equal(dentro, false, 'il drill non deve essere zittito');
    // E il timbro si abbassa: fuori dalla chiamata la regola torna a valere.
    clock += 500;
    assert.equal(s.wantsSilence(), true);
});

test('un conteggio chiesto a mano, da fermo, passa', () => {
    const h = makeHost({ playing: false });
    const s = install(h);

    h.gesture();                   // clic su Restart, o su una sezione
    clock += 300;
    h.countInStarts();
    clock += 2400;

    assert.equal(s.wantsSilence(), false);
});

test('passati dodici secondi non e piu un conteggio', () => {
    const h = makeHost({ playing: true });
    const s = install(h);

    h.countInStarts();
    h.userPauses();
    clock += 13000;

    assert.equal(s.wantsSilence(), false);
});

test('senza conteggio in volo non nega mai', () => {
    const h = makeHost({ playing: true });
    const s = install(h);

    h.userPauses();
    clock += 1000;

    assert.equal(s.wantsSilence(), false);
});

test('un song:play chiude il conteggio', () => {
    const h = makeHost({ playing: true });
    const s = install(h);

    h.countInStarts();
    h.userPauses();
    clock += 500;
    h.emit('song:play');           // e' ripartito per vie sue
    clock += 1000;

    assert.equal(s.wantsSilence(), false);
});

// ── contorno ─────────────────────────────────────────────────────────────

test('timbra le porte che trova', () => {
    const h = makeHost();
    const report = install(h);
    assert.deepEqual(report.doors, ['togglePlay']);
});

test('installarlo due volte non lo impila', () => {
    const h = makeHost();
    install(h);
    const second = mod.installSilence({ now, on: h.on, doc: document });
    assert.equal(second.already, true);
});
