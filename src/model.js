/*
 * The model: what is selected, what is remembered, what the engine is doing.
 * No DOM, no event wiring — main.js feeds it and ui/ renders it.
 *
 * Everything the panel draws comes out of one `snapshot()`. That is a
 * deliberate constraint rather than a style: it means the panel cannot hold
 * state of its own, so re-rendering it from scratch is always correct, and the
 * merge into core can replace the whole of ui/ without touching a line of
 * logic.
 *
 * The one thing this file is careful about is COST. `snapshot()` runs twice a
 * second while the panel is open, and two of the things it reports are
 * expensive: the per-range event counts (a pass over every note and chord) and
 * the per-range tally (a pass over every verdict, per range). Both are cached
 * on every input that can change them — the difficulty filter and the bar
 * range for the counts, the verdict count and the range set for the tally —
 * so an idle tick costs a few reads. Under-keying either one is a real bug and
 * a quiet one: the panel just goes on showing a stale number.
 */

import { host } from './host.js';
import * as ranges from './ranges.js';
import * as store from './store.js';
import * as stats from './stats.js';
import * as drill from './drill.js';

const listeners = new Set();

const state = {
    songKey: null,
    songTitle: '',
    sections: [],
    parts: [],
    settings: store.getSettings(),

    mode: 'section',        // 'section' | 'part' | 'bars'
    sectionKey: null,
    partIndex: 0,
    barsRange: null,

    log: stats.makeLog(),
    /** Verdicts scored while a drill runs are the conductor's business, not the map's. */
    paused: false,

    // caches
    _events: null,          // Map<rangeKey, count>
    _eventsAt: null,        // the difficulty the counts were taken at
    _eventsBars: null,      // the bar range they included
    _tally: null,           // Map<rangeKey, cell>
    _tallyAt: -1,           // log size the tally was taken at
    _tallyShape: '',        // the range set it covered
};

// ── notification ─────────────────────────────────────────────────────────

export function subscribe(fn) {
    if (typeof fn === 'function') listeners.add(fn);
    return () => listeners.delete(fn);
}

export function announce() {
    for (const fn of Array.from(listeners)) {
        try { fn(); } catch (err) { console.warn('[riffrepeater] a listener threw:', err); }
    }
}

// ── song lifecycle ───────────────────────────────────────────────────────

/**
 * Rebuild everything for whatever is loaded now.
 *
 * Called on song:ready, which the host also fires on arrangement switches and
 * on some seeks. The song identity is what decides whether this is a NEW song
 * — reacting to the event itself would reset the run's verdict log every time
 * the user dragged the playhead.
 */
export function refreshSong() {
    const song = host.currentSong();
    const key = store.songKey(song);
    const changed = key !== state.songKey;

    state.songKey = key;
    state.songTitle = song ? [song.artist, song.title].filter(Boolean).join(' — ') : '';

    const duration = host.duration();
    const notes = host.notes();
    const firstNoteTime = notes.length ? Number(notes[0]?.time) : NaN;
    const hasNotesBefore = (t) => Number.isFinite(firstNoteTime) && firstNoteTime < t;

    state.sections = ranges.buildSections(host.sections(), duration, hasNotesBefore);
    invalidateEvents();

    if (changed) {
        state.log.reset();
        state._tally = null;
        state._tallyAt = -1;
        // Keep the mode (a habit worth preserving) but drop the selection: a
        // section key from the previous song points at nothing here.
        state.sectionKey = null;
        state.partIndex = 0;
        state.barsRange = null;
    }

    // Seed or re-seed the selection whenever it is missing or stale.
    //
    // This is not the same as "on a new song", and the difference is a real
    // bug: `song:loaded` carries the song and fires BEFORE the section table
    // has arrived, so the first pass through here sets the identity with
    // sections still empty. `song:ready` then brings the sections but is no
    // longer a change of song — so a condition that only ran on `changed`
    // left the panel with 21 chips and nothing selected.
    if (!state.sectionKey || !state.sections.some((s) => s.key === state.sectionKey)) {
        state.sectionKey = state.sections.length ? state.sections[0].key : null;
        state.partIndex = 0;
    }

    rebuildParts();
    announce();
    return changed;
}

/** True when there is something to loop. */
export function ready() {
    return !!(state.songKey && (state.sections.length || ranges.barLines(host.beats()).length));
}

// ── selection ────────────────────────────────────────────────────────────

export function setMode(mode) {
    if (!['section', 'part', 'bars'].includes(mode)) return;
    state.mode = mode;
    if (mode === 'bars' && !state.barsRange) selectBarsAtPlayhead();
    if (mode === 'part') rebuildParts();
    announce();
}

export function selectSection(key) {
    const found = state.sections.find((s) => s.key === key);
    if (!found) return;
    state.sectionKey = key;
    state.partIndex = 0;
    rebuildParts();
    announce();
}

export function stepPart(delta) {
    if (!state.parts.length) return;
    const next = state.partIndex + (Number(delta) || 0);
    state.partIndex = Math.max(0, Math.min(state.parts.length - 1, next));
    announce();
}

/**
 * Take a bar range starting at the playhead.
 *
 * The natural gesture is "drill from here", and "here" is where the playhead
 * is — not where a chip is. This is the grain the host's Section Practice does
 * not offer at all.
 */
export function selectBarsAtPlayhead() {
    const bars = ranges.barLines(host.beats());
    const r = ranges.barsFrom(bars, host.time(), state.settings.barCount, host.duration());
    if (r) {
        state.barsRange = r;
        state.mode = 'bars';
    }
    announce();
    return r;
}

export function setBarCount(n) {
    const count = Math.max(1, Math.min(64, Math.round(Number(n) || 1)));
    state.settings = store.setSettings({ barCount: count });
    if (state.mode === 'bars' && state.barsRange) {
        const bars = ranges.barLines(host.beats());
        const from = ranges.barsFrom(bars, state.barsRange.start, count, host.duration());
        if (from) state.barsRange = from;
    }
    announce();
}

/** Move one edge of the current range by a bar. Snaps onto the bar grid. */
export function nudge(edge, direction) {
    const cur = selection();
    if (!cur) return;
    const bars = ranges.barLines(host.beats());
    const moved = ranges.nudgeByBar(cur, bars, edge, direction, host.duration());
    if (!moved || moved === cur) return;
    // A nudged section stops being that section — it becomes a bar range, and
    // saying so is more honest than showing "Verse 1" for a passage that is
    // now a bar longer than Verse 1.
    state.barsRange = { ...moved, kind: 'bars' };
    state.barsRange.key = ranges.rangeKey('bars', moved.start, moved.end);
    if (!state.barsRange.label || moved.kind !== 'bars') {
        const si = ranges.barIndexAt(bars, moved.start);
        const ei = ranges.barIndexAt(bars, Math.max(moved.start, moved.end - 0.001));
        const a = bars[si]?.measure;
        const b = bars[ei]?.measure;
        state.barsRange.label = (Number.isFinite(a) && Number.isFinite(b))
            ? (a === b ? `Bar ${a}` : `Bars ${a}–${b}`)
            : 'Custom range';
    }
    state.mode = 'bars';
    announce();
}

/** The range that a drill or a loop would use right now. */
export function selection() {
    if (state.mode === 'bars') return state.barsRange;
    if (state.mode === 'part') return state.parts[state.partIndex] || null;
    return state.sections.find((s) => s.key === state.sectionKey) || null;
}

function rebuildParts() {
    const section = state.sections.find((s) => s.key === state.sectionKey) || null;
    state.parts = section ? ranges.buildParts(section, host.phrases(), host.duration()) : [];
    if (state.partIndex >= state.parts.length) state.partIndex = Math.max(0, state.parts.length - 1);
}

// ── settings passthrough ─────────────────────────────────────────────────

export function getSettings() {
    return { ...state.settings };
}

export function setSettings(patch) {
    state.settings = store.setSettings(patch);
    announce();
    return { ...state.settings };
}

export function resetSettings() {
    state.settings = store.resetSettings();
    announce();
    return { ...state.settings };
}

// ── verdict log ──────────────────────────────────────────────────────────

/** One judged note. `paused` is set while a drill owns the measurement. */
export function addVerdict(noteTime, hit) {
    if (state.paused) return;
    state.log.add(noteTime, hit);
}

export function setPaused(paused) {
    state.paused = !!paused;
}

export function resetRun() {
    state.log.reset();
    state._tally = null;
    state._tallyAt = -1;
    announce();
}

/**
 * Fold this run's per-passage accuracy into the store.
 *
 * Called on song end and on player exit. Only ranges that were actually
 * played get written: a section you skipped past has no verdicts, and
 * recording "0 of 0" as a result would put a chip you never attempted at the
 * top of the weak list.
 */
export function commitRun() {
    if (!state.songKey) return 0;
    const tally = tallyNow();
    let written = 0;
    for (const [key, cell] of tally) {
        if (!Number.isFinite(cell.accuracy)) continue;
        if (cell.hits + cell.misses < 4) continue;   // a handful of notes is noise
        store.recordRange(state.songKey, key, { label: cell.label, best: cell.accuracy });
        written++;
    }
    return written;
}

/** Record what the conductor reported when a drill ended. */
export function commitDrill(result, rangeKey, label) {
    if (!state.songKey || !rangeKey) return null;
    return store.recordRange(state.songKey, rangeKey, {
        label,
        drillBest: Number.isFinite(result?.best) ? result.best : null,
        graduated: !!result?.graduated,
    });
}

// ── remembered speed / difficulty ────────────────────────────────────────

/**
 * Put back the practice speed this song was left at.
 *
 * The host resets the rate to 100% on every song load
 * (`_resetPlaybackSpeedForNewSong`), which is right as a default and wrong for
 * a song you are three sessions into learning at 80%.
 */
export function restoreSpeed() {
    if (!state.settings.rememberSpeed || !state.songKey) return null;
    const saved = store.getSong(state.songKey);
    const pct = saved && saved.speedPct;
    if (!Number.isFinite(pct) || pct === 100) return null;
    return host.setSpeedPct(pct) ? pct : null;
}

export function rememberSpeed() {
    if (!state.settings.rememberSpeed || !state.songKey) return;
    // The CHOSEN speed, not the playing one: a drill's current rung is not a
    // preference to restore next session.
    store.patchSong(state.songKey, { speedPct: host.chosenSpeedPct() });
}

/**
 * Put back the difficulty this song was left at.
 *
 * OFF by default, and it has to be, because the host's master difficulty is a
 * GLOBAL setting: applying a per-song value writes it for every song. The
 * settings panel says so. Kept as an option because for somebody working
 * through one hard chart it is exactly what they want.
 */
export function restoreDifficulty() {
    if (!state.settings.rememberDifficulty || !state.songKey) return null;
    if (!host.hasPhraseData()) return null;   // single-tier chart: the slider is inert
    const saved = store.getSong(state.songKey);
    const pct = saved && saved.difficultyPct;
    if (!Number.isFinite(pct)) return null;
    return host.setDifficultyPct(pct) ? pct : null;
}

export function rememberDifficulty() {
    if (!state.songKey) return;
    store.patchSong(state.songKey, { difficultyPct: host.difficultyPct() });
}

// ── the snapshot the UI renders ──────────────────────────────────────────

export function snapshot() {
    const duration = host.duration();
    const events = eventsNow();
    const tally = tallyNow();
    const saved = state.songKey ? store.getSong(state.songKey) : null;
    const records = (saved && saved.ranges) || {};

    const decorate = (r) => {
        const rec = records[r.key];
        const live = tally.get(r.key);
        return {
            ...r,
            events: events.get(r.key) ?? null,
            best: stats.displayAccuracy(rec),
            plays: Number(rec?.plays) || 0,
            graduated: !!rec?.graduated,
            runAccuracy: live && Number.isFinite(live.accuracy) ? live.accuracy : null,
            runEvents: live ? live.hits + live.misses : 0,
        };
    };

    const sections = state.sections.map(decorate);
    const parts = state.parts.map(decorate);
    const sel = selection();
    const drillState = drill.state();

    return {
        ready: ready(),
        songKey: state.songKey,
        songTitle: state.songTitle,
        duration,

        engine: {
            available: drill.available(),
            detecting: drill.detecting(),
            blocked: drill.blockedReason(),
        },

        mode: state.mode,
        sections,
        /** Which chip is lit. Explicit, so the panel never has to infer it. */
        sectionKey: state.sectionKey,
        parts,
        partIndex: state.partIndex,
        partCount: state.parts.length,
        bars: {
            range: state.barsRange ? decorate(state.barsRange) : null,
            count: state.settings.barCount,
            available: ranges.barLines(host.beats()).length > 0,
        },
        selection: sel ? decorate(sel) : null,
        selectionUsable: ranges.isUsable(sel, duration),

        settings: { ...state.settings },
        speedPct: host.speedPct(),
        difficultyPct: host.difficultyPct(),
        hasPhraseData: host.hasPhraseData(),

        drill: drillState,
        iterations: drillState.active ? drill.iterations() : [],
        current: drillState.active ? drill.currentIteration() : null,

        run: stats.overall(state.log.get()),
        paused: state.paused,

        weakest: stats.weakest(sections, records, { limit: 5, minEvents: 8, kinds: ['section'] }),
    };
}

// ── caches ───────────────────────────────────────────────────────────────

function invalidateEvents() {
    state._events = null;
    state._eventsAt = null;
    state._eventsBars = null;
}

/**
 * Per-range playable-event counts.
 *
 * Keyed on TWO things. The difficulty, because the counts come from the
 * FILTERED note and chord arrays — at 40% mastery a passage genuinely has
 * fewer notes in it, and a count taken at 100% would misreport what the
 * player is about to face. And the bar range's identity, because that one is
 * built on demand: keying on difficulty alone left a freshly picked bar range
 * reporting `null` notes for as long as the difficulty stayed put.
 */
function eventsNow() {
    const at = host.difficultyPct();
    const barsKey = state.barsRange ? state.barsRange.key : null;
    if (state._events && state._eventsAt === at && state._eventsBars === barsKey) return state._events;
    const notes = host.notes();
    const chords = host.chords();
    const map = new Map();
    const all = [...state.sections, ...state.parts];
    if (state.barsRange) all.push(state.barsRange);
    for (const r of all) {
        map.set(r.key, ranges.countEvents(notes, chords, r.start, r.end));
    }
    state._events = map;
    state._eventsAt = at;
    state._eventsBars = barsKey;
    return map;
}

/**
 * This run's per-range tally.
 *
 * Recomputed when a verdict has landed OR when the set of ranges has moved —
 * a new bar range or a different section's parts have to be bucketed even
 * though no new note was judged.
 */
function tallyNow() {
    const size = state.log.size();
    const shape = `${state.barsRange ? state.barsRange.key : ''}|${state.sectionKey || ''}|${state.sections.length}`;
    if (state._tally && state._tallyAt === size && state._tallyShape === shape) return state._tally;
    const all = [...state.sections, ...state.parts];
    if (state.barsRange) all.push(state.barsRange);
    state._tally = stats.tallyByRange(all, state.log.get());
    state._tallyAt = size;
    state._tallyShape = shape;
    return state._tally;
}

/** Difficulty moved: the event counts are stale. */
export function onDifficultyChanged() {
    invalidateEvents();
    announce();
}

/** Chart content changed under us (arrangement switch, transform). */
export function onChartChanged() {
    invalidateEvents();
    rebuildParts();
    announce();
}
