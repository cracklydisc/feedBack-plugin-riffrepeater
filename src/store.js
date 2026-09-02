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
const VERSION = 1;

/** Cap the per-song range table so a long session can't grow storage without bound. */
const MAX_RANGES_PER_SONG = 400;
/** Cap the number of songs kept. Oldest-touched go first. */
const MAX_SONGS = 200;

import { DEFAULT_LADDER, DEFAULT_GOAL_PCT } from './ladder.js';

export function defaults() {
    return {
        ladder: DEFAULT_LADDER.slice(),
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
    // No migration to do yet; an unknown future version is treated as absent
    // rather than half-read, so a downgrade cannot corrupt an upgrade's data.
    if (parsed.v !== VERSION) return blank();
    return {
        v: VERSION,
        settings: { ...defaults(), ...(parsed.settings || {}) },
        songs: (parsed.songs && typeof parsed.songs === 'object') ? parsed.songs : {},
    };
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

export function setSettings(patch) {
    const state = read();
    state.settings = { ...state.settings, ...(patch || {}) };
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
