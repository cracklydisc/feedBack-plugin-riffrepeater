/*
 * The range table is the one part of this plugin that has to AGREE with
 * something else: the host's own Section Practice builds its chips from the
 * same section markers, and if the two disagree by half a bar then the loop a
 * user arms here is not the passage the chip over there highlights.
 *
 * So these tests are written against the host's observable behaviour rather
 * than against this implementation — consecutive same-name markers collapse,
 * repeats get counted, a section ends where the next begins, the first phrase
 * part snaps back to the section start. When this code is deleted in favour of
 * core's own helpers, these tests are what proves the deletion changed nothing.
 *
 * Fixture note: the section/phrase/beat shapes below are the real ones, read
 * off a live host — sections are `{ name, time }` with no end, phrases are
 * `{ index, start_time, end_time, max_difficulty }`, and beats are
 * `{ measure, time }` where only a downbeat carries its bar number and every
 * other beat carries -1.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    baseName,
    buildSections,
    buildParts,
    barLines,
    barIndexAt,
    barsFrom,
    nudgeByBar,
    countEvents,
    rangeKey,
    isUsable,
    clock,
    snapToBar,
    rangeFromDrag,
    MIN_RANGE_SEC,
} from '../src/ranges.js';

// ── names ────────────────────────────────────────────────────────────────

test('baseName canonicalises the names charts actually use', () => {
    assert.equal(baseName('intro', 0), 'Intro');
    assert.equal(baseName('VERSE', 0), 'Verse');
    assert.equal(baseName('chorus', 0), 'Chorus');
    assert.equal(baseName('noguitar', 0), 'Noguitar');
});

test('baseName strips a trailing number so the counter is ours', () => {
    // A chart that numbers its own markers must not produce "Chorus 2 1".
    assert.equal(baseName('Chorus 2', 0), 'Chorus');
    assert.equal(baseName('verse_3', 0), 'Verse');
});

test('an empty marker becomes the bare word, and the counter numbers it', () => {
    // The host's own helper builds "Section 5" and then strips the trailing
    // digits along with a chart's own numbering, so an unnamed marker comes
    // out as "Section" — and buildSections turns that into "Section 1",
    // "Section 2" via its counter. Reproduced rather than "fixed": these
    // labels have to match the chips in the host's Practice popover, and the
    // visible result is correct anyway.
    assert.equal(baseName('', 4), 'Section');
    assert.equal(baseName(null, 0), 'Section');

    const out = buildSections([{ name: '', time: 1 }, { name: 'verse', time: 5 }, { name: '', time: 9 }], 20);
    assert.deepEqual(out.map((r) => r.label), ['Section 1', 'Verse 1', 'Section 2']);
});

// ── sections ─────────────────────────────────────────────────────────────

const SECTIONS = [
    { name: 'intro', time: 3 },
    { name: 'intro', time: 26.55 },      // consecutive same name -> one group
    { name: 'verse', time: 50 },
    { name: 'verse', time: 60 },
    { name: 'chorus', time: 70 },
    { name: 'verse', time: 90 },         // a later run of the same name -> Verse 2
];

test('consecutive same-name markers collapse into one range', () => {
    const out = buildSections(SECTIONS, 120);
    assert.deepEqual(out.map((r) => r.label), ['Intro 1', 'Verse 1', 'Chorus 1', 'Verse 2']);
});

test('a section ends where the next one begins, and the last at the duration', () => {
    const out = buildSections(SECTIONS, 120);
    assert.equal(out[0].start, 3);
    assert.equal(out[0].end, 50);        // both intro markers, closed by verse
    assert.equal(out[3].start, 90);
    assert.equal(out[3].end, 120);
});

test('markers arriving out of order are sorted before grouping', () => {
    const shuffled = [SECTIONS[2], SECTIONS[0], SECTIONS[4], SECTIONS[1], SECTIONS[3], SECTIONS[5]];
    const out = buildSections(shuffled, 120);
    assert.deepEqual(out.map((r) => r.label), ['Intro 1', 'Verse 1', 'Chorus 1', 'Verse 2']);
});

test('a late first marker with notes before it earns a Start range', () => {
    const out = buildSections([{ name: 'verse', time: 30 }], 120, (t) => t > 0);
    assert.equal(out[0].label, 'Start');
    assert.equal(out[0].start, 0);
    assert.equal(out[0].end, 30);
});

test('a late first marker with NOTHING before it does not', () => {
    const out = buildSections([{ name: 'verse', time: 30 }], 120, () => false);
    assert.equal(out.length, 1);
    assert.equal(out[0].label, 'Verse 1');
});

test('an empty or unusable section table yields nothing rather than throwing', () => {
    assert.deepEqual(buildSections([], 120), []);
    assert.deepEqual(buildSections(null, 120), []);
    assert.deepEqual(buildSections([{ name: 'x', time: 'nope' }], 120), []);
});

test('a last section with no duration to close it still gets a usable end', () => {
    const out = buildSections([{ name: 'outro', time: 10 }], NaN);
    assert.equal(out.length, 1);
    assert.ok(out[0].end > out[0].start);
});

// ── phrase parts ─────────────────────────────────────────────────────────

const PHRASES = [
    { index: 0, start_time: 0, end_time: 3, max_difficulty: 0 },
    { index: 1, start_time: 52, end_time: 56, max_difficulty: 7 },
    { index: 2, start_time: 56, end_time: 64, max_difficulty: 9 },
    { index: 3, start_time: 70, end_time: 80, max_difficulty: 9 },
];

test('parts are the phrases that START inside the section', () => {
    const section = { kind: 'section', label: 'Verse 1', start: 50, end: 70, key: 's' };
    const parts = buildParts(section, PHRASES, 120);
    assert.equal(parts.length, 2);
    assert.deepEqual(parts.map((p) => p.label), ['Verse 1 · part 1/2', 'Verse 1 · part 2/2']);
});

test('the first part snaps back to the section start', () => {
    // The first in-window phrase begins at 52 but the marker is at 50: an
    // unsnapped loop would start two seconds inside the passage the chip
    // promised.
    const section = { kind: 'section', label: 'Verse 1', start: 50, end: 70, key: 's' };
    const parts = buildParts(section, PHRASES, 120);
    assert.equal(parts[0].start, 50);
});

test('a part is clamped to the section end and to the duration', () => {
    const section = { kind: 'section', label: 'Chorus 1', start: 70, end: 75, key: 's' };
    const parts = buildParts(section, PHRASES, 120);
    assert.equal(parts[0].end, 75);

    const short = buildParts({ kind: 'section', label: 'X', start: 70, end: 90, key: 's' }, PHRASES, 72);
    assert.equal(short[0].end, 72);
});

test('no phrase table means the section is its own single part', () => {
    // Returning [] here would leave Prev/Next dead on a GP import rather than
    // trivially satisfied.
    const section = { kind: 'section', label: 'Verse 1', start: 50, end: 70, key: 's' };
    const parts = buildParts(section, [], 120);
    assert.equal(parts.length, 1);
    assert.equal(parts[0].label, 'Verse 1 · part 1/1');
    assert.equal(parts[0].start, 50);
    assert.equal(parts[0].end, 70);
});

// ── bars ─────────────────────────────────────────────────────────────────

/** Four bars of four beats at 1s per beat, starting at t=0. */
const BEATS = (() => {
    const out = [];
    for (let bar = 1; bar <= 8; bar++) {
        for (let beat = 0; beat < 4; beat++) {
            out.push({ measure: beat === 0 ? bar : -1, time: (bar - 1) * 4 + beat });
        }
    }
    return out;
})();

test('bar lines are the beats that carry a measure number', () => {
    const bars = barLines(BEATS);
    assert.equal(bars.length, 8);
    assert.deepEqual(bars.slice(0, 3), [
        { measure: 1, time: 0 },
        { measure: 2, time: 4 },
        { measure: 3, time: 8 },
    ]);
});

test('barIndexAt finds the bar a time sits in, inclusive of its downbeat', () => {
    const bars = barLines(BEATS);
    assert.equal(barIndexAt(bars, 0), 0);
    assert.equal(barIndexAt(bars, 3.9), 0);
    assert.equal(barIndexAt(bars, 4), 1);
    assert.equal(barIndexAt(bars, 30), 7);
    assert.equal(barIndexAt(bars, -5), 0);   // before the first line: bar 1
});

test('barsFrom starts AT the bar under the playhead, not centred on it', () => {
    // A centred window starts mid-phrase about half the time, and a drill that
    // begins mid-phrase teaches the wrong entry.
    const bars = barLines(BEATS);
    const r = barsFrom(bars, 9.5, 4, 32);
    assert.equal(r.start, 8);            // bar 3's downbeat, not 9.5
    assert.equal(r.end, 24);             // bar 7's downbeat
    assert.equal(r.label, 'Bars 3–6');
});

test('barsFrom names a single bar in the singular', () => {
    const r = barsFrom(barLines(BEATS), 5, 1, 32);
    assert.equal(r.label, 'Bar 2');
});

test('barsFrom runs off the end of the chart into the duration', () => {
    const r = barsFrom(barLines(BEATS), 29, 4, 32);
    assert.equal(r.start, 28);
    assert.equal(r.end, 32);
});

test('barsFrom on a chart with no bar lines returns null', () => {
    assert.equal(barsFrom([], 10, 4, 32), null);
});

// ── trimming ─────────────────────────────────────────────────────────────

test('nudge moves an edge onto the next bar line', () => {
    const bars = barLines(BEATS);
    const r = barsFrom(bars, 8, 2, 32);      // bars 3–4: 8 -> 16
    const later = nudgeByBar(r, bars, 'start', 1, 32);
    assert.equal(later.start, 12);
    const earlier = nudgeByBar(r, bars, 'end', -1, 32);
    assert.equal(earlier.end, 12);
});

test('nudge snaps an off-grid edge onto the grid on the first press', () => {
    const bars = barLines(BEATS);
    const off = { kind: 'bars', label: 'x', start: 9.5, end: 17.5, key: 'x' };
    // Moving the start LATER from 9.5 lands on bar 3's successor, not 11.5.
    assert.equal(nudgeByBar(off, bars, 'start', 1, 32).start, 12);
    // Moving it EARLIER lands on the line it is sitting after.
    assert.equal(nudgeByBar(off, bars, 'start', -1, 32).start, 8);
});

test('nudge refuses to collapse a range below the engine minimum', () => {
    const bars = barLines(BEATS);
    const tiny = { kind: 'bars', label: 'x', start: 8, end: 8 + MIN_RANGE_SEC, key: 'x' };
    const same = nudgeByBar(tiny, bars, 'end', -1, 32);
    assert.equal(same, tiny);
});

test('nudge relabels a bar range from its new measures', () => {
    const bars = barLines(BEATS);
    const r = barsFrom(bars, 8, 2, 32);
    assert.equal(nudgeByBar(r, bars, 'end', 1, 32).label, 'Bars 3–5');
});

test('nudge falls back to seconds when the chart has no bar lines', () => {
    const r = { kind: 'bars', label: 'x', start: 10, end: 20, key: 'x' };
    assert.equal(nudgeByBar(r, [], 'end', 1, 60).end, 22);
});

// ── counting and keys ────────────────────────────────────────────────────

test('countEvents counts notes and chords, each as one event', () => {
    const notes = [{ time: 1 }, { time: 5 }, { time: 9 }];
    const chords = [{ time: 6 }];
    assert.equal(countEvents(notes, chords, 0, 10), 4);
    assert.equal(countEvents(notes, chords, 5, 9), 2);   // 5 and 6; 9 is the open end
    assert.equal(countEvents(notes, chords, 0, 0), 0);
});

test('rangeKey is stable against float noise but not across passages', () => {
    assert.equal(rangeKey('section', 84.410001, 99.666), rangeKey('section', 84.41, 99.666));
    assert.notEqual(rangeKey('section', 84.41, 99.666), rangeKey('section', 84.41, 99.7));
    assert.notEqual(rangeKey('section', 84.41, 99.666), rangeKey('bars', 84.41, 99.666));
});

test('isUsable rejects what the drill engine would refuse', () => {
    assert.equal(isUsable({ start: 0, end: 10 }, 60), true);
    assert.equal(isUsable({ start: 0, end: 0.2 }, 60), false);
    assert.equal(isUsable({ start: 70, end: 80 }, 60), false);   // past the end
    assert.equal(isUsable(null, 60), false);
});

test('clock formats seconds the way the player does', () => {
    assert.equal(clock(0), '0:00');
    assert.equal(clock(84.41), '1:24');
    assert.equal(clock(-1), '–');
    assert.equal(clock(NaN), '–');
});

// ── the timeline's drag ──────────────────────────────────────────────────
//
// A drag across a 320px strip representing six minutes lands within a second
// or two of where you meant, so both ends snap to bar lines. These pin the
// three things a raw drag gets wrong: a backwards drag, a drag too short to
// span two lines, and the naming of the result.

test('snapToBar takes the NEAREST line, not the previous one', () => {
    const bars = barLines(BEATS);        // lines every 4s
    assert.equal(snapToBar(bars, 4.4), 4);
    assert.equal(snapToBar(bars, 7.6), 8);
    assert.equal(snapToBar(bars, 6), 4);   // a tie goes to the earlier line
});

test('snapToBar past the last line returns the last line', () => {
    const bars = barLines(BEATS);
    assert.equal(snapToBar(bars, 999), bars[bars.length - 1].time);
});

test('snapToBar with no bar lines returns the time unchanged', () => {
    assert.equal(snapToBar([], 12.34), 12.34);
});

test('a drag snaps both ends to bars and names the measures', () => {
    const bars = barLines(BEATS);
    const r = rangeFromDrag(bars, 9.2, 21.4, 32);
    assert.equal(r.start, 8);
    assert.equal(r.end, 20);
    assert.equal(r.label, 'Bars 3–5');
});

test('a backwards drag is the same range as a forwards one', () => {
    const bars = barLines(BEATS);
    const fwd = rangeFromDrag(bars, 9.2, 21.4, 32);
    const back = rangeFromDrag(bars, 21.4, 9.2, 32);
    assert.equal(back.start, fwd.start);
    assert.equal(back.end, fwd.end);
});

test('a tap gives you the bar you tapped, not nothing', () => {
    // Both ends snap to the same line; growing by a bar is friendlier than
    // refusing, and it matches what the gesture looked like.
    const bars = barLines(BEATS);
    const r = rangeFromDrag(bars, 9, 9.1, 32);
    assert.equal(r.start, 8);
    assert.equal(r.end, 12);
    assert.equal(r.label, 'Bar 3');
});

test('a drag past the end snaps to the last bar line, not to the duration', () => {
    // Snapping is the point: a loop that ends between bar lines cannot take a
    // count-in. The last line wins even when there is song left after it.
    const bars = barLines(BEATS);          // lines at 0,4,…,28; song is 32s
    const r = rangeFromDrag(bars, 26, 999, 32);
    assert.equal(r.end, 28);
});

test('the duration still clamps a range that would run past it', () => {
    const bars = barLines(BEATS);
    const r = rangeFromDrag(bars, 22, 999, 26);
    assert.equal(r.end, 26);
});

test('a drag that cannot make a usable range returns null', () => {
    // No bar lines to snap to and no room to grow: better to refuse than to
    // arm something the gesture did not describe.
    assert.equal(rangeFromDrag([], 10, 10.1, 60), null);
    assert.equal(rangeFromDrag([], NaN, 5, 60), null);
});
