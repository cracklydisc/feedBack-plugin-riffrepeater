/*
 * What Riff Repeater remembers, and where.
 *
 * localStorage, not the server. Two reasons: the host has no per-song plugin
 * store to write into, and everything here is a practice preference rather
 * than a score — losing it costs a re-tick, not a record.
 *
 * The shape is versioned under one key so a future migration is a single
 * read-transform-write rather than a scan of loose keys:
 *
 *   {
 *     v: 1,
 *     settings: { ladder, goalPct, widen, rememberSpeed, rememberDifficulty, barCount },
 *     songs: {
 *       "<filename>::<arrangement>": {
 *         speedPct, difficultyPct,
 *         ranges: { "<rangeKey>": { label, plays, best, drillBest, graduated, ts } }
 *       }
 *     }
 *   }
 *
 * `best` is normal-play accuracy; `drillBest` is what the conductor reported
 * when a drill on that passage ended. They are kept apart on purpose — see
 * stats.js for why summing them would lie.
 */

export const KEY = 'riffrepeater.v1';
const DISABLED_KEY = 'riffrepeater.disabled';
/*
 * 2 as of 0.13.0, when the ladder stopped being a ticked set.
 *
 * Bumped rather than left alone because the shape of `settings` changed, and
 * `read()` migrates instead of discarding — the settings are six numbers, the
 * songs are every passage you have ever practised, and only one of those is
 * cheap to lose.
 */
const VERSION = 2;

/** Cap the per-song range table so a long session can't grow storage without bound. */
const MAX_RANGES_PER_SONG = 400;
/** Cap the number of songs kept. Oldest-touched go first. */
const MAX_SONGS = 200;

import {
    DEFAULT_GOAL_PCT, DEFAULT_START_PCT, DEFAULT_STEP_PCT,
    clampGoalPct, clampStartPct, clampStepPct,
} from './ladder.js';

export function defaults() {
    return {
        /*
         * The ladder is three numbers now, not a set of ticked rungs.
         * `startPct` + `stepPct` -> `goalPct` generates them; see
         * `buildLadder`. A stored `ladder` array from before 0.13.0 is
         * migrated in `read()`.
         */
        /*
         * WITHDRAWN: `unit`.
         *
         * A `BARS | TIME` switch chose how far the edge steppers move. It went
         * in 0.21.0 because the unit is a fact about the chart rather than a
         * choice — `nudgeByBar` had always fallen back to seconds on a chart
         * with no bar lines, so the switch's one real job was already
         * automatic, and its label lied in exactly that case.
         *
         * A stored `unit` from before is simply ignored; nothing reads it, and
         * migrating a preference that no longer has a meaning would be
         * inventing one.
         */
        startPct: DEFAULT_START_PCT,
        stepPct: DEFAULT_STEP_PCT,
        goalPct: DEFAULT_GOAL_PCT,
        widen: true,            // the conductor's expandContext — widen once nailed
        rememberSpeed: true,    // the host resets speed to 100% every song; we don't
        rememberDifficulty: false,  // OFF: the host stores difficulty GLOBALLY (see below)
        barCount: 4,            // default size of a "bars" range
    };
}

function blank() {
    return { v: VERSION, settings: defaults(), songs: {} };
}

function read() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (_) { return blank(); }
    if (!raw) return blank();
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (_) { return blank(); }
    if (!parsed || typeof parsed !== 'object') return blank();
    /*
     * An unknown FUTURE version is treated as absent rather than half-read, so
     * a downgrade cannot corrupt an upgrade's data.
     */
    if (parsed.v > VERSION) return blank();

    const settings = { ...defaults(), ...(parsed.settings || {}) };
    return {
        v: VERSION,
        settings: migrateSettings(settings),
        songs: (parsed.songs && typeof parsed.songs === 'object') ? parsed.songs : {},
    };
}

/**
 * Carry an old settings blob forward.
 *
 * The alternative was the version gate above discarding everything, which is
 * cheap to write and expensive to be on the receiving end of: the settings are
 * six numbers, and the songs are every passage you have ever practised. A
 * migration that only has to handle the settings can therefore keep the part
 * that matters.
 *
 * 0.13.0: `ladder` was an array of ticked rungs; it is now generated from
 * `startPct` + `stepPct` -> `goalPct`. A stored `[80, 90, 100]` becomes
 * start 80, step 10, goal 100 — the same ladder. An unevenly spaced set like
 * `[50, 65, 80, 90, 100]` cannot be expressed exactly, so it takes its
 * smallest gap: the result is a ladder with MORE rungs than you had, which is
 * the safe direction to be wrong in. A ladder that skips a rung you were
 * relying on is a drill that suddenly asks for a speed you cannot play.
 */
function migrateSettings(settings) {
    const out = { ...settings };
    const old = settings.ladder;
    if (!Array.isArray(old) || !old.length) {
        delete out.ladder;
        return out;
    }

    const rungs = old
        .map(Number)
        .filter((n) => Number.isFinite(n) && n > 0)
        .sort((a, b) => a - b);
    delete out.ladder;
    if (!rungs.length) return out;

    /*
     * `goalPct` is NOT touched. The old `ladder` array was speeds and always
     * ended at 100 (its own normaliser forced full tempo); `goalPct` was, and
     * remains, the accuracy a pass has to clear. Reading the ladder's top rung
     * as the goal silently overwrote a stored 85% accuracy with 100 — caught
     * by the migration test, which is the only place the two could be seen
     * side by side.
     */
    out.startPct = rungs[0];
    let gap = Infinity;
    for (let i = 1; i < rungs.length; i += 1) gap = Math.min(gap, rungs[i] - rungs[i - 1]);
    if (Number.isFinite(gap) && gap > 0) out.stepPct = gap;
    return out;
}

function write(state) {
    try {
        localStorage.setItem(KEY, JSON.stringify(state));
        return true;
    } catch (_) {
        return false;   // private mode, or quota. Nothing here is worth throwing over.
    }
}

/**
 * The identity of what is loaded.
 *
 * filename + arrangement, because that is the pair that decides which notes
 * are on the highway. The filename carries the pack's content hash
 * ("Metallica - Blackened [d26d2b08].feedpak"), so a re-converted chart gets
 * its own history instead of inheriting numbers earned against different
 * notes — which is the honest behaviour even though it loses the old ones.
 */
export function songKey(song) {
    if (!song) return null;
    const file = String(song.filename || song.title || '').trim();
    if (!file) return null;
    const arr = String(song.arrangement || song.arrangementSmartName || '').trim();
    return arr ? `${file}::${arr}` : file;
}

// ── Settings ─────────────────────────────────────────────────────────────

export function getSettings() {
    return read().settings;
}

/**
 * The one place a setting is written, and therefore the one place it is
 * clamped.
 *
 * `goalPct` had three different floors depending on which widget you used
 * (DESIGN.md §15's corollary). Clamping here rather than in each control means
 * a widget cannot be the reason a stored value is out of range — including the
 * settings page, which cannot import this module and so cannot be trusted to
 * agree with it.
 */
export function setSettings(patch) {
    const state = read();
    const next = { ...state.settings, ...(patch || {}) };
    if (patch && 'goalPct' in patch) next.goalPct = clampGoalPct(next.goalPct);
    if (patch && 'stepPct' in patch) next.stepPct = clampStepPct(next.stepPct);
    /*
     * The start is clamped on its own, against full tempo. It is deliberately
     * NOT clamped against `goalPct`: one is a speed and the other an accuracy,
     * and treating the goal as the ladder's ceiling is the mistake this
     * migration was written twice because of.
     */
    if (patch && 'startPct' in patch) next.startPct = clampStartPct(next.startPct);
    state.settings = next;
    write(state);
    return state.settings;
}

export function resetSettings() {
    const state = read();
    state.settings = defaults();
    write(state);
    return state.settings;
}

// ── Per-song ─────────────────────────────────────────────────────────────

export function getSong(key) {
    if (!key) return null;
    const song = read().songs[key];
    if (!song) return null;
    return {
        speedPct: Number.isFinite(Number(song.speedPct)) ? Number(song.speedPct) : null,
        difficultyPct: Number.isFinite(Number(song.difficultyPct)) ? Number(song.difficultyPct) : null,
        ranges: (song.ranges && typeof song.ranges === 'object') ? song.ranges : {},
        ts: Number(song.ts) || 0,
    };
}

export function patchSong(key, patch) {
    if (!key) return null;
    const state = read();
    const prev = state.songs[key] || { ranges: {} };
    const next = { ...prev, ...(patch || {}), ts: Date.now() };
    if (!next.ranges || typeof next.ranges !== 'object') next.ranges = {};
    state.songs[key] = next;
    evict(state);
    write(state);
    return next;
}

/**
 * Fold one measured result into a passage's history.
 *
 * `best` only ever climbs — the number on a chip answers "how well have you
 * ever played this", and a bad run after a good one is not new information
 * about your ceiling. `plays` counts every attempt, which is what makes a
 * chip you have hammered fifteen times distinguishable from one you nailed
 * first try at the same accuracy.
 */
export function recordRange(key, rangeKey, result) {
    if (!key || !rangeKey || !result) return null;
    const state = read();
    const song = state.songs[key] || { ranges: {} };
    if (!song.ranges || typeof song.ranges !== 'object') song.ranges = {};
    const prev = song.ranges[rangeKey] || { plays: 0, best: null, drillBest: null, graduated: false };

    const next = {
        label: result.label || prev.label || '',
        plays: (Number(prev.plays) || 0) + (result.countsAsPlay === false ? 0 : 1),
        best: maxOrNull(prev.best, result.best),
        drillBest: maxOrNull(prev.drillBest, result.drillBest),
        graduated: !!prev.graduated || !!result.graduated,
        ts: Date.now(),
    };
    song.ranges[rangeKey] = next;
    song.ts = Date.now();
    state.songs[key] = song;
    trimRanges(song);
    evict(state);
    write(state);
    return next;
}

export function forgetSong(key) {
    if (!key) return false;
    const state = read();
    if (!state.songs[key]) return false;
    delete state.songs[key];
    return write(state);
}

export function forgetEverything() {
    const state = blank();
    // Keep the settings — "forget my scores" is not "reset my preferences".
    state.settings = read().settings;
    return write(state);
}

/** Rough size of the store, for the settings panel to be honest about. */
export function usage() {
    const state = read();
    const songs = Object.keys(state.songs).length;
    let ranges = 0;
    for (const k of Object.keys(state.songs)) {
        ranges += Object.keys(state.songs[k].ranges || {}).length;
    }
    let bytes = 0;
    try { bytes = (localStorage.getItem(KEY) || '').length; } catch (_) { /* ignore */ }
    return { songs, ranges, bytes };
}

// ── The escape hatch ─────────────────────────────────────────────────────

/**
 * Read from its own key, not from the settings object.
 *
 * A plugin that puts a control in the player needs a way out that does not
 * depend on the plugin working — the same reasoning as Tidy's.
 */
export function isDisabled() {
    try { return localStorage.getItem(DISABLED_KEY) === '1'; } catch (_) { return false; }
}

export function setDisabled(off) {
    try {
        if (off) localStorage.setItem(DISABLED_KEY, '1');
        else localStorage.removeItem(DISABLED_KEY);
        return true;
    } catch (_) { return false; }
}

// ── internals ────────────────────────────────────────────────────────────

/**
 * The higher of two measurements, or null when neither exists.
 *
 * `Number(null)` is 0 and 0 passes `Number.isFinite`, so treating absence as a
 * number here would write `best: 0` onto a passage that only ever got a drill
 * result — a zero that reads as "you missed everything" rather than "not
 * measured this way yet".
 */
function maxOrNull(a, b) {
    const x = measured(a);
    const y = measured(b);
    if (x !== null && y !== null) return Math.max(x, y);
    return x !== null ? x : y;
}

function measured(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function trimRanges(song) {
    const keys = Object.keys(song.ranges);
    if (keys.length <= MAX_RANGES_PER_SONG) return;
    keys.sort((a, b) => (Number(song.ranges[a].ts) || 0) - (Number(song.ranges[b].ts) || 0));
    for (const k of keys.slice(0, keys.length - MAX_RANGES_PER_SONG)) delete song.ranges[k];
}

function evict(state) {
    const keys = Object.keys(state.songs);
    if (keys.length <= MAX_SONGS) return;
    keys.sort((a, b) => (Number(state.songs[a].ts) || 0) - (Number(state.songs[b].ts) || 0));
    for (const k of keys.slice(0, keys.length - MAX_SONGS)) delete state.songs[k];
}
