/*
 * The adapter over the detector's drill conductor.
 *
 * THE ENGINE ALREADY EXISTS. `note_detect` ships a complete riff repeater:
 * a five-second audible lead-in with a beat-locked click, a per-iteration
 * accuracy goal, a speed ladder, hold / advance / consolidate / graduate, an
 * auto-slowdown after three sub-goal passes, loop widening once nailed, and a
 * coaching line. It is covered by its own tests (drill_mode, drill_ramp,
 * drill_pass_score, autodrill).
 *
 * What it does not have is a way in. Its source says so explicitly:
 *
 *     // NOTE: no standalone "Drill here" button here on purpose. The drill
 *     // conductor is a headless engine driven through feedBack's existing UI
 *     // (the coaching plugin's post-play "Drill this run" / "Practice this"
 *     // buttons call window.noteDetect.startDrill).
 *
 * That coaching plugin was never written, so the only thing that ever starts a
 * drill is the auto-drill trigger — a setting that defaults to 0 (off) and
 * lives on the Note Detection settings page. This file is the missing caller.
 *
 * So: no state machine here, no second ladder, no parallel notion of "which
 * rung are we on". Everything is read back from `getConductorState()`. Two
 * copies of that state is how a HUD ends up disagreeing with the engine it
 * describes.
 */

import { host } from './host.js';

/**
 * How much audible run-up a free loop gets before its A point.
 *
 * `note_detect`'s drill uses five, plus a runway to the first note. A free loop
 * is the tighter, more repetitive tool, so it gets the two seconds that were
 * asked for: enough to arrive in time, not enough to be most of the loop.
 */
export const PREROLL_SEC = 2;
import { toRates, normalizeGoal, FULLSPEED_REPS } from './ladder.js';

function nd() {
    const api = window.noteDetect;
    return (api && typeof api.startDrill === 'function') ? api : null;
}

/** Is the engine present at all? (`note_detect` installed and loaded.) */
export function available() {
    return !!nd();
}

/**
 * Is detection actually running?
 *
 * The conductor grades an iteration from judgments, and judgments only exist
 * while the detector is listening. Without it a drill would loop forever at
 * the slowest rung with nothing to clear — so this gates the button, and the
 * panel says which of the two is missing rather than just greying out.
 */
export function detecting() {
    const api = nd();
    if (!api || typeof api.isEnabled !== 'function') return false;
    try { return !!api.isEnabled(); } catch (_) { return false; }
}

export function isDrilling() {
    const api = nd();
    if (!api) return false;
    if (typeof api.isDrilling === 'function') {
        try { return !!api.isDrilling(); } catch (_) { /* fall through */ }
    }
    return !!state().active;
}

/**
 * The conductor's state, in percentages.
 *
 * Its own units are 0..1 rates and 0..1 accuracies; everything this plugin
 * shows is a percent. Converting once, here, is what keeps the rest of the
 * code from sprinkling `* 100` around and rounding differently in each place.
 */
export function state() {
    const api = nd();
    if (!api || typeof api.getConductorState !== 'function') {
        return { active: false, available: !!api };
    }
    let raw = null;
    try { raw = api.getConductorState(); } catch (_) { raw = null; }
    if (!raw) return { active: false, available: true };

    const ladder = Array.isArray(raw.ladder) ? raw.ladder : [];
    const pct = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) : NaN);

    return {
        available: true,
        active: !!raw.active,
        label: raw.label || '',
        focus: raw.focus || '',
        goalPct: pct(raw.goal),
        bestPct: pct(raw.best),
        speedPct: pct(raw.speed),
        rung: Number.isFinite(Number(raw.rung)) ? Number(raw.rung) : NaN,
        rungs: ladder.length,
        ladderPct: ladder.map((r) => pct(r)),
        range: raw.range ? { ...raw.range } : null,
        reps: FULLSPEED_REPS,
    };
}

/**
 * Per-iteration history for the live panel.
 *
 * The conductor snapshots an iteration on every `loop:restart`; iterations
 * with no judgments are dropped by it, so an idle wrap does not pollute the
 * row. Newest last, which is the reading direction of the sparkline.
 */
export function iterations() {
    const api = nd();
    if (!api || typeof api.getDrillStats !== 'function') return [];
    let stats = null;
    try { stats = api.getDrillStats(); } catch (_) { return []; }
    const list = Array.isArray(stats?.iterations) ? stats.iterations : [];
    return list.map((it) => ({
        idx: Number(it.idx),
        hits: Number(it.hits) || 0,
        misses: Number(it.misses) || 0,
        // getDrillStats() reports accuracy as a PERCENT (0..100), unlike
        // getConductorState() which reports 0..1. Normalize to a percent here
        // so callers never have to know which one they are holding.
        accuracyPct: Number.isFinite(Number(it.accuracy)) ? Math.round(Number(it.accuracy)) : null,
        durationSec: Number(it.durationSec) || 0,
    }));
}

/** The current, unfinished iteration — what you are playing right now. */
export function currentIteration() {
    const api = nd();
    if (!api || typeof api.getDrillStats !== 'function') return null;
    let stats = null;
    try { stats = api.getDrillStats(); } catch (_) { return null; }
    const cur = stats && stats.current;
    if (!cur) return null;
    const hits = Number(cur.hits) || 0;
    const misses = Number(cur.misses) || 0;
    const total = hits + misses;
    return {
        hits,
        misses,
        streak: Number(cur.streak) || 0,
        bestStreak: Number(cur.bestStreak) || 0,
        accuracyPct: total > 0 ? Math.round((hits / total) * 100) : null,
    };
}

/**
 * Arm a drill on a range.
 *
 * `expandContext` is passed through as the user's "widen when nailed": the
 * conductor grows the loop by a bar each side, up to `maxExpansions`, once
 * the passage is clean — which is how a lick you have isolated gets put back
 * into its surroundings before you leave it.
 *
 * Returns { ok, reason } rather than a bare boolean, because every failure
 * here has a sentence the panel should show: no engine, no detection, a range
 * the conductor refused as too short, a song with no duration yet.
 */
export async function start(range, opts = {}) {
    const api = nd();
    if (!api) return { ok: false, reason: 'no-engine' };
    if (!range || !Number.isFinite(Number(range.start)) || !Number.isFinite(Number(range.end))) {
        return { ok: false, reason: 'no-range' };
    }
    if (Number(range.end) - Number(range.start) < 0.5) {
        return { ok: false, reason: 'too-short' };
    }
    if (!detecting()) return { ok: false, reason: 'detection-off' };

    const payload = {
        label: range.label || 'Passage',
        focus: opts.focus || null,
        goal: normalizeGoal(opts.goalPct),
        speedLadder: toRates(opts.ladder),
        expandContext: !!opts.widen,
        maxExpansions: Number.isFinite(Number(opts.maxExpansions)) ? Number(opts.maxExpansions) : 2,
    };

    let ok = false;
    try {
        ok = (await api.startDrill(Number(range.start), Number(range.end), payload)) !== false;
    } catch (err) {
        console.warn('[riffrepeater] startDrill threw:', err);
        return { ok: false, reason: 'threw' };
    }
    // startDrill logs its own reason to the console and returns false when it
    // refuses (no duration, range too short after clamping, setLoop failed).
    return ok ? { ok: true, reason: null } : { ok: false, reason: 'refused' };
}

/** End a drill early. The conductor restores the speed it saved on the way in. */
export function end() {
    const api = nd();
    if (!api || typeof api.endDrill !== 'function') return false;
    try { api.endDrill(); return true; } catch (_) { return false; }
}

/**
 * Loop the range without arming a drill.
 *
 * Worth having as its own action: sometimes you want the passage on repeat at
 * a speed you chose, with no goal and no ramp — and the detector still tracks
 * per-iteration accuracy for any armed loop, so the numbers keep coming.
 */
export async function loopOnly(range) {
    if (!range) return { ok: false, reason: 'no-range' };
    /*
     * A RUN-UP, and the loop is the only place to put it.
     *
     * Landing on the first note of the passage the instant the audio starts
     * means playing it cold every single pass — worse when the phrase begins
     * on an upbeat, because there is nothing to feel the beat against.
     * `note_detect`'s drill has had five seconds of this since it was written;
     * a free loop had none, so the two felt like different tools.
     *
     * Two seconds, because a free loop is the tight repetitive one — long
     * enough to arrive in time, short enough not to be most of the loop.
     * Nothing played in it counts: the gauge's window still starts at A.
     */
    const start = Number(range.start);
    const from = Math.max(0, start - PREROLL_SEC);
    const ok = await host.setLoop(from, Number(range.end));
    return ok ? { ok: true, reason: null } : { ok: false, reason: 'refused' };
}

/**
 * Fires when a drill finishes, however it finished:
 * `{ reason, graduated, label, best }` — `best` is 0..1.
 */
export function onEnded(fn) {
    if (typeof fn !== 'function') return () => {};
    const handler = (e) => {
        const d = (e && e.detail) || {};
        fn({
            reason: d.reason || 'unknown',
            graduated: !!d.graduated,
            label: d.label || '',
            best: Number.isFinite(Number(d.best)) ? Number(d.best) : null,
        });
    };
    return host.onWindow('notedetect:drill-ended', handler);
}

/** Why a drill cannot start right now, as something a person can act on. */
export function blockedReason() {
    if (!available()) {
        return 'The Note Detection plugin provides the drill engine. Install or enable it to drill a passage.';
    }
    if (!detecting()) {
        return 'Turn on note detection in the player — a drill is graded from what you play.';
    }
    return null;
}
