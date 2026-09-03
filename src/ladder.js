/*
 * The speed ladder and the goal. Pure.
 *
 * The detector's conductor already owns the state machine — hold, advance,
 * consolidate, graduate. What it does NOT own is a ladder a user chose: its
 * default is [0.8, 0.9, 1.0], hard-coded, and its floor of 0.8 is a judgement
 * about time-stretch artefacts rather than about learning. Meanwhile the
 * host's own speed presets go down to 50%.
 *
 * So this module's whole job is to turn a set of percentages the user ticked
 * into something `startDrill` will accept, and to be honest about the cost of
 * the slow end.
 *
 * WHAT IS NOT HERE, on purpose: the number of full-speed repetitions before
 * graduation. The conductor fixes that at 3 and takes no option for it
 * (`startDrill` accepts label, focus, goal, speedLadder, expandContext,
 * maxExpansions — and nothing else). Offering a control that the engine
 * ignores would be worse than not offering one.
 */

/** The rungs a user can tick. Multiples of 5 so they land on the host slider's step. */
export const PRESETS = [50, 65, 80, 90, 100];

/** The conductor's own default, as percentages. Ticking nothing gets you this. */
export const DEFAULT_LADDER = [80, 90, 100];

export const DEFAULT_GOAL_PCT = 85;

/**
 * The goal's ONE legal range.
 *
 * It used to have three, which is the corollary in the kit's DESIGN.md §15:
 * `normalizeGoal` clamped at 5%, the settings page's number field said
 * `min="10"`, and the panel's stepper refused to go below 50. Three legal
 * domains for one number, decided by which control you happened to touch it
 * with — so the same store could hold a value the panel could not reach and
 * would not display honestly.
 *
 * 50 is the floor because the panel's argument was the right one: a drill
 * whose goal is "land one note in two" is already generous, and one that
 * accepts one in ten is not a drill. `store.setSettings` clamps to this, so
 * every writer lands inside it whatever its own widget allows.
 */
export const GOAL_MIN_PCT = 50;
export const GOAL_MAX_PCT = 100;

/** Put a goal percentage inside the one legal range. Nullish gets the default. */
export function clampGoalPct(pct) {
    const n = Number(pct);
    if (pct === null || pct === undefined || pct === '' || !Number.isFinite(n)) return DEFAULT_GOAL_PCT;
    return Math.max(GOAL_MIN_PCT, Math.min(GOAL_MAX_PCT, Math.round(n)));
}

/**
 * Below this, a slowed backing track is audibly time-stretched.
 *
 * Not a limit — a warning. The detector's source calls 0.8 a floor because
 * "slower time-stretches sound distorted", and it is right about the sound;
 * it is wrong to make that decision for somebody learning a passage they
 * cannot play at 80%. So the rung exists and the panel says what it costs.
 */
export const STRETCH_WARN_PCT = 80;

/** The conductor graduates after this many consecutive clears at the top rung. */
export const FULLSPEED_REPS = 3;

function toPct(v) {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? n : NaN;
}

/**
 * Clean a ladder for `startDrill`.
 *
 * Rules, in order:
 *   - drop junk, clamp into the host slider's range, snap to its step
 *   - unique, ascending (the conductor indexes rung 0 as the slowest)
 *   - always end at 100: a ladder that tops out at 90% never asks the player
 *     to perform the passage, which is the point of the exercise
 *   - never empty
 */
export function normalizeLadder(pcts, bounds = {}) {
    const min = Number.isFinite(Number(bounds.min)) ? Number(bounds.min) : 15;
    const max = Number.isFinite(Number(bounds.max)) ? Number(bounds.max) : 150;
    const step = Number.isFinite(Number(bounds.step)) && Number(bounds.step) > 0 ? Number(bounds.step) : 5;

    const seen = new Set();
    const out = [];
    for (const raw of (Array.isArray(pcts) ? pcts : [])) {
        let p = toPct(raw);
        if (!Number.isFinite(p) || p <= 0) continue;
        p = Math.round(p / step) * step;
        p = Math.max(min, Math.min(max, p));
        if (p > 100) continue;            // a drill ramps UP TO tempo, never past it
        if (seen.has(p)) continue;
        seen.add(p);
        out.push(p);
    }
    if (!seen.has(100)) { out.push(100); seen.add(100); }
    out.sort((a, b) => a - b);
    return out.length ? out : DEFAULT_LADDER.slice();
}

/** Percentages -> the rate multipliers `startDrill` expects. */
export function toRates(pcts) {
    return normalizeLadder(pcts).map((p) => p / 100);
}

/** A goal percentage -> the 0..1 the conductor compares against. */
export function normalizeGoal(pct) {
    return clampGoalPct(pct) / 100;
}

/** Whether any rung is slow enough to be audibly stretched. */
export function warnsAboutStretch(pcts) {
    return normalizeLadder(pcts).some((p) => p < STRETCH_WARN_PCT);
}

/**
 * The one-line status for a live drill.
 *
 * `state` is the conductor's own `getConductorState()`, normalized by
 * drill.js. Everything shown is read from it rather than tracked here: two
 * copies of "which rung are we on" is how a HUD ends up disagreeing with the
 * thing it describes.
 */
export function statusLine(state) {
    if (!state || !state.active) return '';
    const bits = [];
    if (Number.isFinite(state.speedPct)) bits.push(`${state.speedPct}% speed`);
    if (Number.isFinite(state.goalPct)) bits.push(`goal ${state.goalPct}%`);
    if (Number.isFinite(state.bestPct)) bits.push(`best ${state.bestPct}%`);
    if (Number.isFinite(state.rung) && Number.isFinite(state.rungs)) {
        bits.push(`step ${state.rung + 1} of ${state.rungs}`);
    }
    return bits.join(' · ');
}

/**
 * What has to happen next, in words.
 *
 * The conductor's HUD says "hit 85% clean to speed up", which is right until
 * you are already at the top rung — where the truthful sentence is about
 * repetitions, not speed. Getting this wrong is the difference between a
 * player who knows why the loop is not ending and one who thinks it is stuck.
 */
export function nextStepLine(state) {
    if (!state || !state.active) return '';
    const goal = Number.isFinite(state.goalPct) ? state.goalPct : DEFAULT_GOAL_PCT;
    const atTop = Number.isFinite(state.rung) && Number.isFinite(state.rungs)
        && state.rung >= state.rungs - 1;
    if (!atTop) return `Clear ${goal}% to speed up.`;
    return `Clear ${goal}% ${FULLSPEED_REPS}× at full speed to finish.`;
}

/**
 * Accuracy 0..1 -> a coarse band, for colouring a cell without inventing
 * thresholds. The splits are the app's own (`good` >= 90%, `mid` >= 50%).
 *
 * The null check is separate from the finite check on purpose: `Number(null)`
 * is 0, so a passage that has never been measured would otherwise colour
 * exactly like one you missed every note of.
 */
export function band(accuracy) {
    if (accuracy === null || accuracy === undefined || accuracy === '') return 'none';
    const a = Number(accuracy);
    if (!Number.isFinite(a)) return 'none';
    if (a >= 0.9) return 'good';
    if (a >= 0.5) return 'mid';
    return 'low';
}
