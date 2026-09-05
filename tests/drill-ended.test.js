/*
 * La fine di un drill arriva su DUE bus, e per mesi ne abbiamo ascoltato uno solo.
 *
 * Il rilevatore manda `notedetect:hit` e `notedetect:miss` su `window`
 * (`dispatchInstanceEvent`), ma la fine del drill su `window.slopsmith.emit(...)`,
 * cioe' su un `EventTarget` a se' stante. Ascoltando solo `window` i verdetti
 * funzionavano e la memoria per passaggio non registrava niente — un difetto
 * che nessuna prova poteva vedere, perche' `drill.js` non ne aveva.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

function makeHost() {
    const bus = new EventTarget();
    const win = new EventTarget();
    globalThis.window = {
        feedBack: {
            on: (n, fn) => bus.addEventListener(n, fn),
            off: (n, fn) => bus.removeEventListener(n, fn),
            emit: (n, detail) => bus.dispatchEvent(new CustomEvent(n, { detail })),
        },
        addEventListener: (n, fn) => win.addEventListener(n, fn),
        removeEventListener: (n, fn) => win.removeEventListener(n, fn),
        dispatchEvent: (e) => win.dispatchEvent(e),
    };
    globalThis.document = { getElementById: () => null };
    return { bus, win };
}

const h = makeHost();
const drill = await import('../src/drill.js');

const fine = (detail) => new CustomEvent('notedetect:drill-ended', { detail });

test('la fine mandata sul bus dellospite arriva', () => {
    const visti = [];
    const off = drill.onEnded((r) => visti.push(r));
    window.feedBack.emit('notedetect:drill-ended', { reason: 'graduated', graduated: true, label: 'Chorus', best: 0.92 });
    off();

    assert.equal(visti.length, 1);
    assert.equal(visti[0].reason, 'graduated');
    assert.equal(visti[0].graduated, true);
    assert.equal(visti[0].best, 0.92);
});

test('e anche quella mandata su window', () => {
    const visti = [];
    const off = drill.onEnded((r) => visti.push(r));
    window.dispatchEvent(fine({ reason: 'user' }));
    off();

    assert.equal(visti.length, 1);
    assert.equal(visti[0].reason, 'user');
});

test('la stessa fine per due strade si conta una volta sola', () => {
    const visti = [];
    const off = drill.onEnded((r) => visti.push(r));
    window.feedBack.emit('notedetect:drill-ended', { reason: 'graduated' });
    window.dispatchEvent(fine({ reason: 'graduated' }));
    off();

    assert.equal(visti.length, 1, 'un drill finisce una volta');
});

test('due fini diverse restano due', () => {
    const visti = [];
    const off = drill.onEnded((r) => visti.push(r));
    window.feedBack.emit('notedetect:drill-ended', { reason: 'user' });
    window.feedBack.emit('notedetect:drill-ended', { reason: 'graduated' });
    off();

    assert.equal(visti.length, 2);
});

test('staccarsi stacca da tutti e due', () => {
    const visti = [];
    const off = drill.onEnded((r) => visti.push(r));
    off();
    window.feedBack.emit('notedetect:drill-ended', { reason: 'user' });
    window.dispatchEvent(fine({ reason: 'graduated' }));

    assert.equal(visti.length, 0);
});
