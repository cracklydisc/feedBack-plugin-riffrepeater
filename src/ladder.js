/*
 * The speed ladder and the goal. Pure.
 *
 * The detector's conductor already owns the state machine — hold, advance,
 * consolidate, graduate. What it does NOT own is a ladder a user chose: its
 * default is [0.8, 0.9, 1.0], hard-coded, and its floor of 0.8 is a judgement
 * about time-stretch artefacts rather than about learning. Meanwhile the
 * host's own speed presets go down to 50%.
 *
 * So this module's whole job is to turn a ladder into something `startDrill`
 * will accept.
 *
 * ── THE LADDER IS GENERATED, NOT TICKED (0.13.0) ────────────────────────
 *
 * It used to be a set: five fixed chips, `[50, 65, 80, 90, 100]`, and you
 * ticked the ones you wanted. Now it is three numbers — **start, step,
 * goal** — and the rungs derive from them:
 *
 *     start 80 · step +5 · goal 100   ->   80 · 85 · 90 · 95 · 100
 *     start 50 · step +10 · goal 100  ->   50 · 60 · 70 · 80 · 90 · 100
 *
 * Three reasons it is better, and the third is the one that mattered:
 *
 * 1. It expresses ladders the chips could not. Five fixed values could not
 *    give you 85 or 95 at all.
 * 2. It is three controls instead of five, and they are steppers — a family
 *    that already means "a number you set".
 * 3. THE SLOW RUNGS COST NOTHING NOW. With chips, offering 50% meant a chip
 *    on screen forever plus a caveat badge explaining time-stretch. With a
 *    start you set, a rung below 80 exists only if you asked for one — so the
 *    warning went too, and the rack being called SPEED is enough.
 *
 * WHAT IS NOT HERE, on purpose: the number of full-speed repetitions before
 * graduation. The conductor fixes that at 3 and takes no option for it
 * (`startDrill` accepts label, focus, goal, speedLadder, expandContext,
 * maxExpansions — and nothing else). Offering a control that the engine
 * ignores would be worse than not offering one.
 */

/** The steps a ladder can climb by. Three, because a fourth is a slider. */
export const STEPS = [2, 5, 10];

export const DEFAULT_START_PCT = 80;
export const DEFAULT_STEP_PCT = 5;

/**
 * The slowest rung a start can reach, and the reason it is not the host's 15.
 *
 * `speedBounds().min` is 15%, which is a legal playback rate and an illegal
 * practice speed: at 15% a passage is not slow, it is a different piece of
 * music, and the note timings stop resembling what you are learning. 50 is the
 * floor the fixed chips had and it was the right one.
 */
export const START_MIN_PCT = 50;

/*
 * 100, not the engine's 85.
 *
 * A product decision, and worth naming the cost: at 100 a passage has to be
 * played with every judged note clean before the ladder steps up, so the
 * climb is slower and a rung can be repeated many times. The conductor's own
 * default is 0.85 for exactly that reason.
 *
 * The argument for 100 anyway is that "clean" is the standard this kind of
 * practice tool is measured against, and a goal that graduates you at 85%
 * teaches a passage you can nearly play. The stepper reaches down to 50 in
 * five-point steps for a passage where that is too much to ask.
 */
export const DEFAULT_GOAL_PCT = 100;

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

/*
 * WHAT USED TO BE HERE: `STRETCH_WARN_PCT` and `warnsAboutStretch`.
 *
 * A caveat badge warned that a rung below 80% time-stretches the backing
 * track audibly. It was right about the sound, and it went with the fixed
 * chips that made it necessary: when 50 and 65 were always on screen, the
 * panel had to explain why you might not want them. A start you set does not
 * need explaining — you asked for it — and the rack is called SPEED.
 */

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
/**
 * The rungs, from a start and a step. The top is always FULL TEMPO.
 *
 *     start 80 · step +5   ->   80 · 85 · 90 · 95 · 100
 *     start 50 · step +10  ->   50 · 60 · 70 · 80 · 90 · 100
 *
 * There is no control for the top and there must not be: a drill that never
 * asks for the real tempo has not taught the passage. A ladder topping out at
 * 90% would graduate you on a speed the song is never played at.
 *
 * THIS IS NOT `goalPct`, and conflating them cost a rewrite. `goalPct` is the
 * ACCURACY a pass has to clear to move up a rung — the conductor compares it
 * against what you played. The rail's top rung reading 100 and the goal
 * reading 100% is a coincidence of two different hundreds: one is a speed,
 * one is a percentage of notes.
 *
 * Everything is snapped to the host's slider step, so a rung is always a speed
 * the host can actually play.
 */
export function buildLadder(startPct, stepPct, bounds) {
    const b = bounds || {};
    const grid = Math.max(1, Number(b.step) || 5);
    const snap = (v) => Math.round(v / grid) * grid;

    const top = 100;
    const start = Math.max(START_MIN_PCT, Math.min(top, snap(num(startPct, DEFAULT_START_PCT))));
    /*
     * THE STEP IS NOT SNAPPED TO THE SPEED GRID.
     *
     * It used to be `Math.max(grid, snap(step))`, and with the host's 5% grid
     * that turned `+2` into `Math.max(5, round(2/5)*5)` = **5**. Picking +2
     * lit the +2 cell and built the +5 ladder, which is the report: "selecting
     * step 2 does not create the scale".
     *
     * The mistake is a category one. A RUNG is a speed and has to land on a
     * rate the host can play, so it is snapped. A STEP is a *difference*
     * between rungs, and nothing requires a difference to be a legal speed —
     * 60, 62, 64 are all on the grid even though 2 is not. The rungs
     * themselves are snapped below, which is where the constraint belongs.
     */
    const step = Math.max(1, Math.round(num(stepPct, DEFAULT_STEP_PCT)));

    /*
     * THE RUNGS ARE NOT SNAPPED EITHER, and only the START is.
     *
     * Snapping them made `+2` indistinguishable from `+5`: on a 5% grid,
     * 60/62/64/66 all round to 60/60/65/65 and dedupe back to the +5 ladder.
     * Two rounds of the same mistake, one level apart.
     *
     * The grid is the SLIDER's constraint, not the drill's. `applySpeedPreset`
     * wants a preset stop, but the conductor applies each rung with
     * `window.setSpeed(rate)`, which takes any rate at all — so 62% is a
     * perfectly playable rung and only the START has to land on a stop,
     * because the START is also what drives the live slider.
     */
    const rungs = [];
    for (let v = start; v < top; v += step) rungs.push(Math.round(v));
    rungs.push(top);
    return [...new Set(rungs)].filter((v) => v <= top).sort((a, b) => a - b);
}

/** A number, with a fallback that is used for nullish and for junk alike. */
function num(v, fallback) {
    if (v === null || v === undefined || v === '') return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

/**
 * Put a start percentage inside its one legal range: 50 to full tempo.
 *
 * Clamped against 100 and NOT against `goalPct` — they are a speed and an
 * accuracy, and clamping one by the other is the confusion this module now
 * has a paragraph about.
 */
export function clampStartPct(pct) {
    const n = num(pct, DEFAULT_START_PCT);
    return Math.max(START_MIN_PCT, Math.min(100, Math.round(n / 5) * 5));
}

/** Put a step inside the three the segmented control offers. */
export function clampStepPct(pct) {
    const n = num(pct, DEFAULT_STEP_PCT);
    let best = STEPS[0];
    for (const s of STEPS) if (Math.abs(s - n) < Math.abs(best - n)) best = s;
    return best;
}


/** Percentages -> the rate multipliers `startDrill` expects. */
export function toRates(pcts) {
    return (Array.isArray(pcts) ? pcts : []).map((p) => p / 100);
}

/** A goal percentage -> the 0..1 the conductor compares against. */
export function normalizeGoal(pct) {
    return clampGoalPct(pct) / 100;
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
