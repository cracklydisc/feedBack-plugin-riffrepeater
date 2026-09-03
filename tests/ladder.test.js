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
    STEPS,
    DEFAULT_GOAL_PCT,
    DEFAULT_START_PCT,
    DEFAULT_STEP_PCT,
    GOAL_MIN_PCT,
    START_MIN_PCT,
    FULLSPEED_REPS,
    buildLadder,
    clampGoalPct,
    clampStartPct,
    clampStepPct,
    toRates,
    normalizeGoal,
    statusLine,
    nextStepLine,
    band,
} from '../src/ladder.js';

import * as mod from '../src/ladder.js';

const BOUNDS = { min: 15, max: 150, step: 5 };

test('the steps are all on the host slider grid', () => {
    for (const st of STEPS) assert.equal(st % 1, 0, `${st} is not whole`);
    assert.deepEqual(STEPS, [2, 5, 10]);
});

test('a ladder is generated from start, step and goal', () => {
    /*
     * The whole point of the change: five fixed chips could not express 85 or
     * 95 at all, and three steppers express every ladder there is.
     */
    assert.deepEqual(buildLadder(80, 5, BOUNDS), [80, 85, 90, 95, 100]);
    assert.deepEqual(buildLadder(80, 10, BOUNDS), [80, 90, 100]);
    assert.deepEqual(buildLadder(50, 10, BOUNDS), [50, 60, 70, 80, 90, 100]);
});

test('a ladder always ends at FULL TEMPO, however the step falls', () => {
    /*
     * There is no control for the top and there must not be: a drill that
     * never asks for the real tempo has not taught the passage. The last gap
     * may be short — 80 stepping by 30 gives 80 then 100 — and that is
     * correct: full tempo is not negotiable, the spacing is.
     */
    assert.deepEqual(buildLadder(80, 30, BOUNDS), [80, 100]);
    assert.deepEqual(buildLadder(95, 10, BOUNDS), [95, 100]);
});

test('start at full tempo is a one-rung ladder, not an empty one', () => {
    assert.deepEqual(buildLadder(100, 5, BOUNDS), [100]);
});

test('a nullish or junk ladder still builds something playable', () => {
    // `Number(null) === 0`, and a start of 0 would hand the conductor a rate
    // of 0 — silence that never advances.
    assert.deepEqual(buildLadder(null, null, BOUNDS), [80, 85, 90, 95, 100]);
    assert.deepEqual(buildLadder('x', 'y', BOUNDS), [80, 85, 90, 95, 100]);
    for (const r of buildLadder(0, 0, BOUNDS)) assert.ok(r >= START_MIN_PCT, `rung ${r}`);
});

test('rungs are snapped to the slider step, so every one is playable', () => {
    assert.deepEqual(buildLadder(82, 5, BOUNDS), [80, 85, 90, 95, 100]);
});

test('the start floor is 50, not the host bound of 15', () => {
    /*
     * 15% is a legal playback rate and an illegal practice speed: at 15% a
     * passage is not slow, it is a different piece of music, and the timings
     * stop resembling what you are learning. 50 is the floor the fixed chips
     * had and it was right.
     */
    assert.equal(START_MIN_PCT, 50);
    assert.equal(clampStartPct(20, 100), 50);
    assert.ok(buildLadder(15, 5, BOUNDS)[0] >= 50);
});

test('a start is clamped against full tempo, NOT against the goal', () => {
    /*
     * `goalPct` is an ACCURACY and the start is a SPEED. Clamping one by the
     * other read the rail's top rung as the goal and silently overwrote a
     * stored 85% accuracy with 100 — which the store's migration test caught,
     * because it is the only place the two numbers sit side by side.
     */
    assert.equal(clampStartPct(120), 100);
    assert.equal(clampStartPct(95), 95);
    // A goal of 60% accuracy does not cap a start of 95% speed.
    assert.equal(clampStartPct(95, 60), 95);
});

test('a step snaps to one of the three offered', () => {
    assert.equal(clampStepPct(7), 5);
    assert.equal(clampStepPct(1), 2);
    assert.equal(clampStepPct(100), 10);
    assert.equal(clampStepPct(null), DEFAULT_STEP_PCT);
});

test('toRates hands the engine multipliers, not percentages', () => {
    assert.deepEqual(toRates([50, 80, 100]), [0.5, 0.8, 1]);
    assert.deepEqual(toRates(null), []);
});

test('the goal becomes the 0..1 the conductor compares against', () => {
    assert.equal(normalizeGoal(85), 0.85);
    assert.equal(normalizeGoal(100), 1);
    assert.equal(normalizeGoal(1000), 1);
    assert.equal(normalizeGoal('x'), DEFAULT_GOAL_PCT / 100);
});

test('the goal has ONE legal range, whichever control wrote it', () => {
    // It used to have three: 5% here, 10% in the settings page's field, 50% in
    // the panel's stepper. Same number, three domains, decided by which widget
    // you touched — so a stored 10% was a value the panel could neither reach
    // nor honestly display.
    assert.equal(GOAL_MIN_PCT, 50);
    assert.equal(clampGoalPct(0), 50);
    assert.equal(clampGoalPct(10), 50);            // the settings page's old floor
    assert.equal(clampGoalPct(49), 50);
    assert.equal(clampGoalPct(85), 85);
    assert.equal(clampGoalPct(1000), 100);
    assert.equal(normalizeGoal(0), 0.5);           // a goal of nothing is not a goal
    assert.equal(normalizeGoal(10), 0.5);
});

test('an absent goal is the default, not zero', () => {
    // `Number(null) === 0` and 0 clamps to the FLOOR, which would silently
    // hand every drill a 50% goal the moment a settings read came back empty.
    for (const v of [null, undefined, '', NaN, 'x']) {
        assert.equal(clampGoalPct(v), DEFAULT_GOAL_PCT, `for ${String(v)}`);
    }
});

test('there is no time-stretch warning any more, and that is deliberate', () => {
    /*
     * A caveat badge used to explain that a rung below 80% stretches the
     * backing track audibly. It was right about the sound and it went with the
     * fixed chips that made it necessary: when 50 and 65 were always on screen
     * the panel had to say why you might not want them. A start you SET does
     * not need explaining, and the rack is called SPEED.
     */
    assert.equal(typeof mod.warnsAboutStretch, 'undefined');
    assert.equal(typeof mod.STRETCH_WARN_PCT, 'undefined');
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
