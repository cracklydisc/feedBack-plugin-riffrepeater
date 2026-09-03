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

test('tapping a PHRASE on the strip selects that phrase', () => {
    /*
     * THE STRIP'S ONE GESTURE, AND IT WAS DEAD.
     *
     * The strip draws the song's phrases when it has any, and its `onPick`
     * called `selectSection` — which searches the sections and returns
     * silently on a miss. So every tap on the strip did nothing, on every
     * chart with phrases, and nothing said so.
     *
     * Reported as "clicking a section on the chart does not select it for the
     * loop". What makes it worth a test rather than a fix is that the WALKING
     * gesture had always resolved a phrase correctly: two paths to the same
     * outcome, one of them wrong, and no assertion comparing them.
     */
    model.refreshSong();
    const blocks = model.snapshot().blocks;
    const phrase = blocks.find((b) => b.kind === 'part' && b.start >= 20);
    assert.ok(phrase, 'the fixture should produce a phrase at 20s');

    model.selectBlock(phrase.key);
    const sel = model.snapshot().selection;
    assert.equal(sel.key, phrase.key);
    assert.equal(sel.start, phrase.start);
    assert.equal(sel.end, phrase.end);
    assert.equal(model.snapshot().onPart, true, 'and the walk knows where it is');
});

test('tapping a SECTION on the strip still selects the whole section', () => {
    /* The other kind, because a chart without phrases puts sections there. */
    model.refreshSong();
    const outro = model.snapshot().sections.find((sc) => sc.label === 'Outro 1');
    model.selectBlock(outro.key);
    const snap = model.snapshot();
    assert.equal(snap.selection.key, outro.key);
    assert.equal(snap.onPart, false);
});

test('tapping a block that is not there changes nothing', () => {
    model.refreshSong();
    const before = JSON.stringify(model.snapshot().selection);
    model.selectBlock('part:999999:1000000');
    model.selectBlock(null);
    assert.equal(JSON.stringify(model.snapshot().selection), before);
});

/*
 * A passage with a KNOWN note count, because the gauge is a percentage of one.
 *
 * The shared fixture carries a single note, which is enough for the walk tests
 * and gives the gauge no usable denominator. This lends the host four notes
 * inside Verse 1 for the length of one test.
 */
function withNotes(times, fn) {
    const before = globalThis.window.highway.getNotes;
    globalThis.window.highway.getNotes = () => times.map((t) => ({ time: t }));
    try {
        model.refreshSong();
        return fn();
    } finally {
        globalThis.window.highway.getNotes = before;
        model.refreshSong();
    }
}

test('the live gauge counts DOWN from a hundred', () => {
    /*
     * Reported: the percentage only appeared when the pass ENDED, and it
     * counted UP from zero, so it meant nothing until most of the passage had
     * gone by — which is the opposite of a gauge you can act on.
     *
     * A hundred minus what the misses cost is true from the first bar, because
     * the denominator is the passage's own note count and that is known before
     * a note is played.
     */
    withNotes([11, 12, 13, 14], () => {
        const verse = model.snapshot().sections.find((x) => x.label === 'Verse 1');
        model.selectSection(verse.key);
        const sel = model.snapshot().selection;
        model.resetPass(sel.start, sel.end);

        const total = model.snapshot().live.total;
        assert.equal(total, 4, 'four notes in the passage');
        assert.equal(model.snapshot().live.pct, 100, 'a fresh pass reads a hundred');

        /* A hit costs nothing. */
        model.addVerdict(11, true);
        assert.equal(model.snapshot().live.pct, 100);

        /* A miss costs exactly one note's worth. */
        model.addVerdict(12, false);
        assert.equal(model.snapshot().live.pct, 75);
        assert.equal(model.snapshot().live.misses, 1);
    });
});

test('the gauge counts drill verdicts, which the map does not', () => {
    /*
     * The other half of this lived in main.js and was the actual bug: the
     * verdict handler RETURNED while a drill ran, so the model saw nothing
     * during the one activity the panel exists for. `paused` is the right
     * gate and it is inside `addVerdict`, one level down.
    /*
     * `paused` exists to keep a drill's verdicts out of the per-passage
     * record — the conductor owns that measurement. It was also stopping the
     * player from seeing the pass at all, which is a different thing.
     */
    model.refreshSong();
    /* The log outlives a `refreshSong` on the same song — this is about what
       THIS verdict does, so start from an empty one. */
    model.resetRun();
    const sel = model.snapshot().selection;
    model.resetPass(sel.start, sel.end);
    model.setPaused(true);
    model.addVerdict(sel.start + 0.2, false);

    assert.equal(model.snapshot().live.misses, 1, 'the gauge sees it');
    assert.equal(model.snapshot().run.misses, 0, 'the map does not');
    model.setPaused(false);
});

test('nothing played in the run-up counts against the pass', () => {
    /*
     * A free loop now starts a couple of seconds before A so you can arrive in
     * time. Those seconds are audible, not judged — otherwise every pass would
     * be scored on notes you were never asked to play.
     */
    withNotes([11, 12, 13, 14], () => {
        const verse = model.snapshot().sections.find((x) => x.label === 'Verse 1');
        model.selectSection(verse.key);
        const sel = model.snapshot().selection;
        model.resetPass(sel.start, sel.end);
        model.addVerdict(sel.start - 1.5, false);   // in the run-up
        model.addVerdict(sel.end + 1.5, false);     // past B
        assert.equal(model.snapshot().live.misses, 0);
        assert.equal(model.snapshot().live.pct, 100);
    });
});

test('one bar is selectable, and says which bar it is', () => {
    /*
     * Reported: "I cannot test a single bar — even with + and - I cannot say I
     * want bar 41." The strip's zones are phrases and the edge steppers move a
     * bar at a time, so a single bar meant walking B down to A by hand.
     */
    model.refreshSong();
    const sec = model.snapshot().sections.find((x) => x.label === 'Verse 1');
    model.selectSection(sec.key);

    const one = model.selectBars(1);
    assert.ok(one, 'a bar range came back');
    const snap = model.snapshot();
    assert.equal(snap.selection.kind, 'bars');
    assert.equal(snap.selection.barCount, 1);
    assert.match(snap.selection.label, /^Bar \d+$/, 'and it names the bar');

    /* It starts where the selection already started, not at the playhead. */
    assert.equal(snap.selection.start, sec.start);

    /* Two bars from the same place is the same first bar, a later last one. */
    const two = model.selectBars(2);
    assert.equal(two.start, one.start);
    assert.ok(two.end > one.end);
});

test('A slides a bar window instead of doing nothing', () => {
    /*
     * A one-bar loop is a dead end for an edge nudge — A cannot advance past B,
     * so the stepper correctly refused and the button did nothing. Six presses,
     * no movement, which is how "I cannot say I want to test bar 41" felt.
     *
     * With the grain already chosen, moving the start means moving the window.
     */
    model.refreshSong();
    const verse = model.snapshot().sections.find((x) => x.label === 'Verse 1');
    model.selectSection(verse.key);
    const one = model.selectBars(1);
    const startedAt = one.firstMeasure;

    model.nudge('start', 1);
    const next = model.snapshot().selection;
    assert.equal(next.barCount, 1, 'still one bar wide');
    assert.equal(next.firstMeasure, startedAt + 1, 'and one bar further on');
    assert.ok(next.start > one.start);

    model.nudge('start', -1);
    assert.equal(model.snapshot().selection.firstMeasure, startedAt, 'and back');
});

test('B still resizes a bar window', () => {
    /* Widening a chosen window is a different intent from moving it. */
    model.refreshSong();
    const verse = model.snapshot().sections.find((x) => x.label === 'Verse 1');
    model.selectSection(verse.key);
    const one = model.selectBars(1);
    model.nudge('end', 1);
    const wider = model.snapshot().selection;
    assert.equal(wider.start, one.start, 'A stayed put');
    assert.ok(wider.end > one.end, 'B moved out');
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
