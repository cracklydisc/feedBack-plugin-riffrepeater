/*
 * These tests exist to pin one judgement call: overlapping ranges, and what
 * "best" means.
 *
 * A section and its phrase parts describe the same seconds, so a verdict has
 * to land in BOTH — otherwise colouring the section chips and the part
 * stepper would need two passes over the same data and could disagree.
 *
 * And a drill result outranks a normal-play result even when it is LOWER,
 * which looks wrong until you say why: the conductor measured that passage
 * repeatedly against a goal, and one pass through it mid-song did not.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    tallyByRange,
    displayAccuracy,
    weakest,
    makeLog,
    overall,
} from '../src/stats.js';

const RANGES = [
    { key: 'sec:a', kind: 'section', label: 'Verse 1', start: 0, end: 10, events: 20 },
    { key: 'sec:b', kind: 'section', label: 'Chorus 1', start: 10, end: 20, events: 20 },
    { key: 'part:a1', kind: 'part', label: 'Verse 1 · part 1/2', start: 0, end: 5, events: 10 },
];

test('a verdict lands in every range that contains it', () => {
    const tally = tallyByRange(RANGES, [{ t: 2, hit: true }]);
    assert.equal(tally.get('sec:a').hits, 1);
    assert.equal(tally.get('part:a1').hits, 1);
    assert.equal(tally.get('sec:b').hits, 0);
});

test('a range boundary is inclusive at the start and exclusive at the end', () => {
    // Otherwise the note on a section's downbeat is counted twice — once for
    // the section that just ended and once for the one starting.
    const tally = tallyByRange(RANGES, [{ t: 10, hit: false }]);
    assert.equal(tally.get('sec:a').misses, 0);
    assert.equal(tally.get('sec:b').misses, 1);
});

test('accuracy is null for a range nothing was played in', () => {
    // Not zero: "you have not attempted this" and "you missed everything"
    // must not colour the same.
    const tally = tallyByRange(RANGES, [{ t: 12, hit: true }]);
    assert.equal(tally.get('sec:a').accuracy, null);
    assert.equal(tally.get('sec:b').accuracy, 1);
});

test('verdicts with no usable time are ignored', () => {
    const tally = tallyByRange(RANGES, [{ t: NaN, hit: true }, { hit: true }, null]);
    assert.equal(tally.get('sec:a').hits, 0);
});

test('an empty range list gives an empty tally rather than throwing', () => {
    assert.equal(tallyByRange([], [{ t: 1, hit: true }]).size, 0);
    assert.equal(tallyByRange(null, null).size, 0);
});

// ── which number to show ─────────────────────────────────────────────────

test('a drill result outranks a normal-play result, even when lower', () => {
    assert.equal(displayAccuracy({ best: 0.95, drillBest: 0.72 }), 0.72);
});

test('with no drill result, the normal-play best is shown', () => {
    assert.equal(displayAccuracy({ best: 0.61, drillBest: null }), 0.61);
});

test('nothing measured shows nothing', () => {
    assert.equal(displayAccuracy({}), null);
    assert.equal(displayAccuracy(null), null);
});

// ── the weak list ────────────────────────────────────────────────────────

const RECORDS = {
    'sec:a': { best: 0.42, plays: 3 },
    'sec:b': { best: 0.88, plays: 1 },
    'part:a1': { best: 0.1, plays: 9 },
};

test('the weak list is worst first', () => {
    const rows = weakest(RANGES, RECORDS, { kinds: ['section'] });
    assert.deepEqual(rows.map((r) => r.label), ['Verse 1', 'Chorus 1']);
});

test('the weak list keeps to the grain it was asked for', () => {
    // A section and its parts in one list would show the same weakness three
    // times and bury everything else.
    const rows = weakest(RANGES, RECORDS, { kinds: ['section'] });
    assert.ok(!rows.some((r) => r.kind === 'part'));
});

test('a passage never played is not a weakness', () => {
    const rows = weakest(RANGES, { 'sec:a': { best: 0.42, plays: 1 } }, { kinds: ['section'] });
    assert.deepEqual(rows.map((r) => r.label), ['Verse 1']);
});

test('a passage too small to judge is excluded', () => {
    const tiny = [{ key: 'x', kind: 'section', label: 'Fill', start: 0, end: 1, events: 2 }];
    assert.equal(weakest(tiny, { x: { best: 0 } }, { minEvents: 8 }).length, 0);
});

test('a range with no event count is not excluded by the event floor', () => {
    // The count is unavailable before the chart has been scanned; treating
    // "unknown" as "too small" would empty the list on the first render.
    const unknown = [{ key: 'x', kind: 'section', label: 'Verse 1', start: 0, end: 10 }];
    assert.equal(weakest(unknown, { x: { best: 0.3 } }, { minEvents: 8 }).length, 1);
});

test('the weak list honours its limit', () => {
    const many = [];
    const recs = {};
    for (let i = 0; i < 12; i++) {
        many.push({ key: 'k' + i, kind: 'section', label: 'S' + i, start: i, end: i + 1, events: 20 });
        recs['k' + i] = { best: i / 100, plays: 1 };
    }
    assert.equal(weakest(many, recs, { limit: 5 }).length, 5);
});

test('this run outranks the stored best, once there is enough of it', () => {
    // The list has to be useful WHILE you play, not only after the song ends.
    const live = [{ ...RANGES[0], runAccuracy: 0.2, runEvents: 20 }];
    const rows = weakest(live, { 'sec:a': { best: 0.9, plays: 5 } }, { kinds: ['section'] });
    assert.equal(rows[0].accuracy, 0.2);
    assert.equal(rows[0].live, true);
});

test('a handful of live notes does not outrank a stored best', () => {
    const live = [{ ...RANGES[0], runAccuracy: 0, runEvents: 3 }];
    const rows = weakest(live, { 'sec:a': { best: 0.9, plays: 5 } }, { kinds: ['section'], minEvents: 8 });
    assert.equal(rows[0].accuracy, 0.9);
    assert.equal(rows[0].live, false);
});

test('a Map of records works as well as an object', () => {
    const map = new Map([['sec:a', { best: 0.3, plays: 2 }]]);
    const rows = weakest(RANGES, map, { kinds: ['section'] });
    assert.deepEqual(rows.map((r) => r.label), ['Verse 1']);
});

// ── the log ──────────────────────────────────────────────────────────────

test('the log drops the OLDEST verdicts when it fills', () => {
    // The run in progress is what the panel is describing, so the old end is
    // the right end to lose.
    const log = makeLog(100);
    for (let i = 0; i < 250; i++) log.add(i, true);
    assert.equal(log.size(), 100);
    assert.equal(log.get()[0].t, 150);
});

test('the log refuses a verdict with no time', () => {
    const log = makeLog();
    log.add(NaN, true);
    log.add(undefined, false);
    assert.equal(log.size(), 0);
});

test('overall accuracy matches the app own hits/(hits+misses)', () => {
    assert.deepEqual(overall([{ hit: true }, { hit: true }, { hit: false }]),
        { hits: 2, misses: 1, accuracy: 2 / 3 });
    assert.deepEqual(overall([]), { hits: 0, misses: 0, accuracy: null });
});
