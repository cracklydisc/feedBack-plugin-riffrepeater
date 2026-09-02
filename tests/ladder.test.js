/*
 * The ladder is handed straight to somebody else's engine, so the rules it
 * has to satisfy are the engine's rules, not ours: rung 0 must be the slowest
 * (the conductor indexes into the array), the values must be rates it will
 * accept, and the top must be full tempo or the drill never asks the player
 * to perform the passage.
 *
 * The two "in words" helpers get tests because they are the only place this
 * plugin explains the engine's state machine to a human, and getting the
 * top-rung sentence wrong is the difference between a player who knows why
 * the loop has not ended and one who thinks it is stuck.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    PRESETS,
    DEFAULT_LADDER,
    DEFAULT_GOAL_PCT,
    STRETCH_WARN_PCT,
    FULLSPEED_REPS,
    normalizeLadder,
    toRates,
    normalizeGoal,
    warnsAboutStretch,
    statusLine,
    nextStepLine,
    band,
} from '../src/ladder.js';

const BOUNDS = { min: 15, max: 150, step: 5 };

test('the presets are all on the host slider step', () => {
    for (const p of PRESETS) assert.equal(p % BOUNDS.step, 0, `${p} is not a multiple of 5`);
});

test('the default ladder is the engine own default', () => {
    assert.deepEqual(DEFAULT_LADDER, [80, 90, 100]);
});

test('a ladder is sorted ascending — the engine treats rung 0 as slowest', () => {
    assert.deepEqual(normalizeLadder([100, 50, 80], BOUNDS), [50, 80, 100]);
});

test('a ladder always ends at full tempo', () => {
    assert.deepEqual(normalizeLadder([50, 65], BOUNDS), [50, 65, 100]);
    assert.deepEqual(normalizeLadder([], BOUNDS), [100]);
});

test('duplicates and junk are dropped', () => {
    assert.deepEqual(normalizeLadder([80, 80, 'x', null, NaN, -5, 0, 90], BOUNDS), [80, 90, 100]);
});

test('rungs above full tempo are dropped, not clamped', () => {
    // A drill ramps UP TO tempo. A 120% rung would make "graduate at full
    // speed" mean something the player never asked for.
    assert.deepEqual(normalizeLadder([80, 120, 150], BOUNDS), [80, 100]);
});

test('rungs are snapped to the slider step and clamped to its minimum', () => {
    assert.deepEqual(normalizeLadder([52, 63], BOUNDS), [50, 65, 100]);
    assert.deepEqual(normalizeLadder([2], BOUNDS), [15, 100]);
});

test('normalizeLadder never returns empty, whatever it is given', () => {
    assert.ok(normalizeLadder(null, BOUNDS).length > 0);
    assert.ok(normalizeLadder('nonsense', BOUNDS).length > 0);
});

test('toRates hands the engine multipliers, not percentages', () => {
    assert.deepEqual(toRates([50, 80, 100]), [0.5, 0.8, 1]);
});

test('the goal becomes the 0..1 the conductor compares against', () => {
    assert.equal(normalizeGoal(85), 0.85);
    assert.equal(normalizeGoal(100), 1);
    assert.equal(normalizeGoal(0), 0.05);          // a goal of nothing is not a goal
    assert.equal(normalizeGoal(1000), 1);
    assert.equal(normalizeGoal('x'), DEFAULT_GOAL_PCT / 100);
});

test('the time-stretch warning fires below the engine own floor', () => {
    assert.equal(warnsAboutStretch([80, 90, 100]), false);
    assert.equal(warnsAboutStretch([65, 80, 100]), true);
    assert.equal(STRETCH_WARN_PCT, 80);
});

// ── the two sentences ────────────────────────────────────────────────────

const MID = { active: true, goalPct: 85, bestPct: 62, speedPct: 80, rung: 0, rungs: 3 };
const TOP = { active: true, goalPct: 85, bestPct: 91, speedPct: 100, rung: 2, rungs: 3 };

test('the status line reports the engine numbers, in order', () => {
    assert.equal(statusLine(MID), '80% speed · goal 85% · best 62% · step 1 of 3');
});

test('an inactive drill has no status line', () => {
    assert.equal(statusLine({ active: false }), '');
    assert.equal(statusLine(null), '');
});

test('below the top rung, the next step is about speed', () => {
    assert.equal(nextStepLine(MID), 'Clear 85% to speed up.');
});

test('at the top rung, the next step is about repetitions', () => {
    // "hit 85% to speed up" is a lie once there is nowhere to speed up TO.
    assert.equal(nextStepLine(TOP), `Clear 85% ${FULLSPEED_REPS}× at full speed to finish.`);
});

test('a single-rung ladder is already at the top', () => {
    const one = { active: true, goalPct: 90, rung: 0, rungs: 1 };
    assert.match(nextStepLine(one), /at full speed to finish/);
});

test('bands split at the thresholds the app already uses for accuracy', () => {
    assert.equal(band(0.95), 'good');
    assert.equal(band(0.9), 'good');
    assert.equal(band(0.7), 'mid');
    assert.equal(band(0.5), 'mid');
    assert.equal(band(0.49), 'low');
    assert.equal(band(null), 'none');
});
