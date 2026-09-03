/*
 * The selection walk.
 *
 * 0.6.0 removed the three mode tabs, and the only reason they could go is that
 * position zero of the phrase stepper is the WHOLE section — a step left from
 * part 1 hands the section back. That makes this walk the *only* way to get
 * from a phrase to the section it lives in, so a regression here would be
 * silent: the panel would go on looking right while one grain became
 * unreachable. Hence a test.
 *
 * The model is not DOM code but it does read the host's globals through
 * `host.js` and the store through `localStorage`, so both are stubbed before
 * the dynamic import — ESM hoists static imports above any setup.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const map = new Map();
globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => map.clear(),
};

/*
 * One song: an intro with no phrase breakdown and a verse split in two.
 *
 * The host reports phrases as absolute times over the whole song, not per
 * section, which is why the verse's two phrases are 10→20 and 20→30.
 */
const SONG = {
    sections: [
        { name: 'Intro 1', time: 0 },
        { name: 'Verse 1', time: 10 },
        { name: 'Outro 1', time: 30 },
    ],
    phrases: [
        { index: 0, start_time: 0, end_time: 10, max_difficulty: 1 },
        { index: 1, start_time: 10, end_time: 20, max_difficulty: 1 },
        { index: 2, start_time: 20, end_time: 30, max_difficulty: 1 },
        { index: 3, start_time: 30, end_time: 40, max_difficulty: 1 },
    ],
};

/*
 * `host.speedPct` reads the audio element directly — `document`, not
 * `window.document` — so the stub has to exist as its own global.
 */
globalThis.document = { getElementById: () => null, querySelector: () => null };

globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
    matchMedia: () => ({ matches: false }),
    highway: {
        getSongInfo: () => ({
            filename: 'ABBA - Waterloo [00000000].feedpak',
            arrangement: 'Bass',
            artist: 'ABBA',
            title: 'Waterloo',
            duration: 40,
        }),
        getSections: () => SONG.sections,
        getPhrases: () => SONG.phrases,
        getBeats: () => Array.from({ length: 21 }, (_, i) => ({ measure: i + 1, time: i * 2 })),
        getNotes: () => [{ time: 0.5 }],
        getChords: () => [],
        getTime: () => 0,
        getMastery: () => 1,
    },
};

const model = await import('../src/model.js');

function onVerse() {
    model.refreshSong();
    const verse = model.snapshot().sections.find((s) => s.label === 'Verse 1');
    assert.ok(verse, 'the fixture should produce a Verse 1');
    model.selectSection(verse.key);
    return model.snapshot();
}

// ── the walk ─────────────────────────────────────────────────────────────

test('a freshly picked section starts on the whole section', () => {
    const snap = onVerse();
    assert.equal(snap.onPart, false);
    assert.equal(snap.partCount, 2);
});

test('forward enters the phrases and stops at the last one', () => {
    onVerse();
    model.stepPart(1);
    assert.deepEqual(pos(), { onPart: true, index: 0 });
    model.stepPart(1);
    assert.deepEqual(pos(), { onPart: true, index: 1 });
    // Past the end is a no-op, not a wrap: wrapping would silently jump the
    // loop to the other end of the section mid-practice.
    model.stepPart(1);
    assert.deepEqual(pos(), { onPart: true, index: 1 });
});

test('back out of the first phrase gives the whole section', () => {
    onVerse();
    model.stepPart(1);
    model.stepPart(-1);
    assert.deepEqual(pos(), { onPart: false, index: 0 });
    // And there is nothing before the whole section.
    model.stepPart(-1);
    assert.deepEqual(pos(), { onPart: false, index: 0 });
});

test('the range the drill gets follows the walk', () => {
    // `selection` is the one thing the panel and the drill both read, so it
    // is what the walk has to move. The label goes with it, which is how the
    // stepper can be the only place the grain is written down.
    onVerse();
    assert.deepEqual(span(), [10, 30]);
    assert.equal(model.snapshot().selection.label, 'Verse 1');

    model.stepPart(1);
    assert.deepEqual(span(), [10, 20]);
    assert.equal(model.snapshot().selection.label, 'Verse 1 · part 1/2');

    model.stepPart(1);
    assert.deepEqual(span(), [20, 30]);
});

test('a section with one phrase has nowhere useful to step', () => {
    model.refreshSong();
    const intro = model.snapshot().sections.find((s) => s.label === 'Intro 1');
    model.selectSection(intro.key);
    assert.equal(model.snapshot().partCount, 1);
    assert.deepEqual(span(), [0, 10]);

    // One phrase IS the whole section, so stepping into it cannot move the
    // loop. The panel disables the arrow on `partCount < 2`; this asserts the
    // model agrees, so a panel that got it wrong would still be harmless.
    model.stepPart(1);
    assert.deepEqual(span(), [0, 10]);
});

test('picking a section drops you back on the whole of it', () => {
    onVerse();
    model.stepPart(1);
    model.stepPart(1);
    assert.equal(model.snapshot().onPart, true);

    const outro = model.snapshot().sections.find((s) => s.label === 'Outro 1');
    model.selectSection(outro.key);
    // Carrying "part 2 of 2" onto the next section would land the loop on a
    // phrase the user never chose — and `partIndex` alone does not catch it,
    // because index 0 of a section you are still "on a phrase of" is its
    // first half, not the whole thing. This is the assertion that found it.
    assert.deepEqual(pos(), { onPart: false, index: 0 });
});

test('stepping to the next section lands on the whole of it', () => {
    onVerse();
    model.stepPart(1);
    model.stepSection(1);
    assert.deepEqual(pos(), { onPart: false, index: 0 });
});

test('clicking the timeline lands on the whole of what was clicked', () => {
    onVerse();
    model.stepPart(1);
    model.selectAtTime(35);           // inside Outro 1
    const s = model.snapshot();
    assert.equal(s.sections.find((x) => x.key === s.sectionKey).label, 'Outro 1');
    assert.deepEqual(pos(), { onPart: false, index: 0 });
});

test('a zero step is a no-op', () => {
    // `Number(null) === 0` and `0` passes `Number.isFinite`, which is the bug
    // class this codebase keeps meeting — here it has to mean "do nothing",
    // not "walk to the minimum".
    onVerse();
    model.stepPart(1);
    model.stepPart(null);
    model.stepPart(undefined);
    model.stepPart(0);
    assert.deepEqual(pos(), { onPart: true, index: 0 });
});

// ── no dead ends ─────────────────────────────────────────────────────────

test('a step back from a custom range returns to whole sections', () => {
    // 0.6.0 removed the mode tabs on the argument that position zero of this
    // stepper is the whole section. That only holds if EVERY state can reach
    // position zero, and a custom range could not: both arrows were disabled
    // and the walk dead-ended. Reported as "with a custom range you can't go
    // back", which it was.
    onVerse();
    const r = model.selectBarsAtPlayhead();
    assert.ok(r, 'the fixture has bar lines, so a bar range should be takeable');
    assert.equal(model.snapshot().mode, 'bars');

    model.stepPart(-1);
    const snap = model.snapshot();
    assert.notEqual(snap.mode, 'bars');
    assert.equal(snap.onPart, false);
    assert.equal(snap.bars.range, null);
});

test('it lands on the section the range STARTS in, not the last one selected', () => {
    // Handing back a section from before the drag reads as the panel losing
    // your place.
    model.refreshSong();
    const outro = model.snapshot().sections.find((s) => s.label === 'Outro 1');
    model.selectSection(outro.key);
    model.selectAtTime(0);                 // a click inside Intro 1
    model.selectSection(outro.key);        // …and back to Outro 1

    // A custom range that starts inside Verse 1 (10 → 30).
    model.selectDrag(12, 18);
    assert.equal(model.snapshot().mode, 'bars');
    model.stepPart(-1);

    const snap = model.snapshot();
    const now = snap.sections.find((s) => s.key === snap.sectionKey);
    assert.equal(now.label, 'Verse 1');
});

test('forward from a custom range does nothing, rather than guessing', () => {
    onVerse();
    model.selectBarsAtPlayhead();
    model.stepPart(1);
    assert.equal(model.snapshot().mode, 'bars');
});

function span() {
    const sel = model.snapshot().selection;
    return [sel.start, sel.end];
}

function pos() {
    const s = model.snapshot();
    return { onPart: s.onPart, index: s.partIndex };
}
