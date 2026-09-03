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
import * as ladder from './ladder.js';
import * as drill from './drill.js';

/**
 * A real number, where null is not one.
 *
 * `Number(null) === 0` and 0 passes `Number.isFinite`, which has now cost this
 * plugin five bugs. Anything entering a boolean about "is there a value" goes
 * through here.
 */
function finite(v) {
    if (v === null || v === undefined || v === '') return false;
    return Number.isFinite(Number(v));
}

const listeners = new Set();

const state = {
    songKey: null,
    songTitle: '',
    sections: [],
    phrases: [],
    parts: [],
    settings: store.getSettings(),

    mode: 'section',        // 'section' | 'part' | 'bars'
    sectionKey: null,
    partIndex: 0,
    barsRange: null,

    log: stats.makeLog(),
    /** Verdicts scored while a drill runs are the conductor's business, not the map's. */
    paused: false,

    /*
     * THE LIVE GAUGE, counted per pass and separately from the log.
     *
     * The log is the MAP — what you have ever played, and a drill's verdicts
     * belong to the conductor, so `paused` drops them. That was right for the
     * map and left the panel with nothing to show while you were playing: the
     * percentage appeared only when the pass ended, which is the one moment it
     * is no longer useful.
     *
     * And it counted UP from zero — hits over judged — so a passage read 0%
     * until the first note landed and stayed meaningless until most of them
     * had. Down from a hundred is the number you can act on: you know the
     * passage's note count, every miss costs a known slice, and the reading is
     * true from the first bar.
     *
     * `from`/`to` bound what counts, which is what keeps a run-up out of the
     * score.
     */
    pass: { misses: 0, from: null, to: null },

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
    /*
     * EVERY phrase in the song, not just the selected section's.
     *
     * `rebuildParts` builds the parts of one section, which is what the old
     * phrase stepper walked. The strip is the only loop selector now and it
     * draws the whole song, so it needs the lot — built by the same tested
     * builder, once per section, concatenated.
     */
    state.phrases = state.sections.flatMap(
        (sec) => ranges.buildParts(sec, host.phrases(), duration),
    );
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
    landOnWhole();
    rebuildParts();
    announce();
}

/**
 * Put the selection on `block`, which may be a section or one of its phrases.
 *
 * THE STRIP DRAWS PHRASES AND THE PICK HANDLER ONLY KNEW SECTIONS.
 *
 * `onPick` handed `selectSection` a `part:` key; that searches `state.sections`
 * and returns silently when it finds nothing — so on any chart WITH phrases,
 * which is most of them, tapping the strip did nothing at all. Reported as
 * "clicking a section on the chart does not select it for the loop", and it was
 * every tap, not some.
 *
 * The walking gesture had it right the whole time: `,` and `.` resolved a
 * phrase to its parent section and its index. Two gestures that mean the same
 * thing were reading the same block list in two different ways, which is the
 * shape of the bug rather than a detail of it — so there is one landing now,
 * and both call it.
 */
function landOnBlock(block) {
    if (!block) return;
    state.barsRange = null;
    if (block.kind === 'part') {
        const parent = state.sections.find((sc) => sc.key === block.parent);
        if (parent) state.sectionKey = parent.key;
        state.mode = 'part';
        rebuildParts();
        const i = state.parts.findIndex((pp) => pp.key === block.key);
        state.partIndex = i < 0 ? 0 : i;
        return;
    }
    state.sectionKey = block.key;
    landOnWhole();
    rebuildParts();
}

/**
 * Select whatever block the strip was tapped on — a section or a phrase.
 *
 * The strip's blocks are the song's phrases when it has any and its sections
 * when it does not, so the handler behind it has to take either.
 */
export function selectBlock(key) {
    const k = String(key === null || key === undefined ? '' : key);
    const block = (state.phrases.length ? state.phrases : state.sections)
        .find((b) => b.key === k)
        || state.sections.find((b) => b.key === k);
    if (!block) return;
    landOnBlock(block);
    announce();
}

/**
 * Put the selection on the WHOLE of whatever section was just chosen.
 *
 * Every gesture that picks a new section goes through here, and it has to,
 * because since 0.6.0 the grain is a POSITION in a walk rather than a mode the
 * user set once: "part 2 of 2" is where you got to inside the last section,
 * not a preference to carry into the next one. Choosing Chorus 2 while on the
 * second half of Verse 1 used to land you on the first half of Chorus 2 — a
 * loop nobody asked for, and invisible unless you read the stepper's label.
 *
 * Before the mode tabs went, keeping the mode was the right call: it was an
 * explicit choice with its own control, so honouring it across sections was
 * respecting the user. Removing the control changed what the field MEANS, and
 * this is the part of that change that the panel could not show.
 */
function landOnWhole() {
    state.mode = 'section';
    state.partIndex = 0;
}

/**
 * Walk the section and its phrases as one list.
 *
 *     whole section  ->  part 1  ->  part 2  ->  …
 *
 * Position zero is the WHOLE section, which is what lets the mode tabs go: a
 * step left from part 1 gives the section back, so there is no need for a
 * control that says "actually, all of it". It is also the app's own model —
 * its Section Practice has a "Full section" checkbox alongside the parts.
 */
export function stepPart(delta) {
    const d = Number(delta) || 0;
    if (!d) return;

    /*
     * THE WAY OUT OF A CUSTOM RANGE.
     *
     * A drag on the timeline puts the selection in `bars` mode, and until now
     * the only way back was the section chevrons — which the panel disabled
     * nothing about, but nobody looks there for it, and a reader is entitled
     * to expect the control that *shows* the grain to be the one that changes
     * it. Reported as "with a custom range you can't go back", and it was a
     * fair reading of a dead-ended walk: 0.6.0 removed the mode tabs on the
     * argument that position zero of this stepper is the whole section, and
     * that argument only holds if every state can reach position zero.
     *
     * So a step back from a custom range lands on the whole of the section
     * the range STARTS in — not the previously selected one, which could be
     * anywhere and would read as the panel losing your place.
     */
    if (state.mode === 'bars') {
        if (d > 0) return;
        const at = state.barsRange ? state.barsRange.start : host.time();
        const home = state.sections.find((sc) => at >= sc.start && at < sc.end)
            || state.sections[0];
        state.barsRange = null;
        if (home) state.sectionKey = home.key;
        landOnWhole();
        rebuildParts();
        announce();
        return;
    }

    if (!state.parts.length) return;

    if (state.mode !== 'part') {
        // On the whole section: forward enters the phrases, back does nothing.
        if (d < 0) return;
        state.mode = 'part';
        state.partIndex = 0;
        announce();
        return;
    }

    const next = state.partIndex + d;
    if (next < 0) {
        // Back out of the phrases and onto the section itself.
        state.mode = 'section';
        state.partIndex = 0;
        announce();
        return;
    }
    state.partIndex = Math.min(state.parts.length - 1, next);
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

/**
 * Take the range a drag on the timeline describes.
 *
 * Both ends snap to bar lines, which is the whole reason a drag is usable at
 * all: a gesture across a 300px strip representing six minutes lands within a
 * second or two of where you meant, and a loop boundary that is not on a bar
 * line turns the count-in into a guess.
 */
export function selectDrag(startSec, endSec) {
    const bars = ranges.barLines(host.beats());
    const r = ranges.rangeFromDrag(bars, startSec, endSec, host.duration());
    if (!r) return null;
    state.barsRange = r;
    state.mode = 'bars';
    announce();
    return r;
}

/**
 * Set one end of the loop at the playhead — the app's A and B.
 *
 * This is how a guitarist actually marks a passage: press A, let the song run
 * to the end of the phrase, press B. Reading a clock and stepping a number to
 * match it is the same job done backwards, and it is the job the panel was
 * making you do.
 *
 * Both marks snap to the bar grid, like everything else here. Pressing A with
 * nothing selected gives you a loop of the default bar count immediately, so
 * there is always something armable between the two presses rather than a
 * half-defined range; pressing B before A is refused rather than guessed at.
 */
export function markEdge(edge) {
    return setEdge(edge, host.time());
}

/**
 * Set one end of the loop at a given TIME.
 *
 * The same job from the pointer: what the strip's A/B handles call while being
 * dragged. Factored out of `markEdge` rather than duplicated, because the
 * hard parts — snapping, the missing-other-edge case, refusing B behind A —
 * are the same whether the time came from the playhead or from a drag, and two
 * copies of that is two places for the refusals to diverge.
 */
export function setEdge(edge, seconds) {
    const bars = ranges.barLines(host.beats());
    const dur = host.duration();
    const t = ranges.snapToBar(bars, seconds);
    if (!Number.isFinite(t)) return { ok: false, reason: 'no-playhead' };

    const cur = selection();
    let start;
    let end;

    if (edge === 'start') {
        start = t;
        end = (cur && Number.isFinite(cur.end) && cur.end > t) ? cur.end : null;
        if (end === null) {
            const one = ranges.barsFrom(bars, t, state.settings.barCount, dur);
            end = one ? one.end : null;
        }
        if (end === null) return { ok: false, reason: 'no-room' };
    } else {
        end = t;
        start = (cur && Number.isFinite(cur.start) && cur.start < t) ? cur.start : null;
        // B behind A is not a range. Refusing says so; swapping them silently
        // would arm a passage the two presses did not describe.
        if (start === null) return { ok: false, reason: 'b-before-a' };
    }

    const r = ranges.rangeFromDrag(bars, start, end, dur);
    if (!r) return { ok: false, reason: 'too-short' };
    state.barsRange = r;
    state.mode = 'bars';
    announce();
    return { ok: true, range: r };
}

/**
 * Select whatever the section table says is at this time.
 *
 * What a click on the timeline resolves to. Deliberately derived from the time
 * rather than read off the clicked element: the DOM route needed the pointer
 * to land on a block, so a click on the hairline between two of them — or any
 * synthetic click, which is how this was noticed — fell through to a bar
 * range instead of a section.
 *
 * Falls back to a bar range when the time is outside every section, which is
 * the honest answer for a chart whose markers do not cover it.
 */
export function selectAtTime(t) {
    const time = Number(t);
    if (!Number.isFinite(time)) return null;
    const hit = state.sections.find((s) => time >= s.start && time < s.end);
    if (!hit) return selectDrag(time, time);
    state.sectionKey = hit.key;
    landOnWhole();
    rebuildParts();
    announce();
    return hit;
}

/**
 * Step to the next or previous section.
 *
 * The timeline is a mouse gesture; this is the same navigation for a keyboard
 * or a controller, which is the only way to move through 21 sections without
 * aiming at a 14-pixel block.
 */
export function stepSection(delta) {
    if (!state.sections.length) return;
    const at = state.sections.findIndex((s) => s.key === state.sectionKey);
    const next = Math.max(0, Math.min(state.sections.length - 1, (at < 0 ? 0 : at) + (Number(delta) || 0)));
    state.sectionKey = state.sections[next].key;
    landOnWhole();
    rebuildParts();
    announce();
}

/**
 * Move to the next or previous block on the strip.
 *
 * The blocks are phrases when the chart has them and sections when it does
 * not, so this walks whatever the strip is actually showing — a keyboard that
 * stepped sections while the strip drew phrases would be two ideas of "next"
 * in one panel.
 */
export function stepBlock(delta) {
    const d = Number(delta) || 0;
    if (!d) return;
    const list = state.phrases.length ? state.phrases : state.sections;
    if (!list.length) return;

    const cur = selection();
    let at = cur ? list.findIndex((b) => b.key === cur.key) : -1;
    if (at < 0) {
        /*
         * Nothing on the strip is selected — a custom range, or a fresh song.
         * Start from the block the playhead is inside, so the first press
         * moves from where you ARE rather than from the top of the song.
         */
        const t = host.time();
        at = list.findIndex((b) => t >= b.start && t < b.end);
        if (at < 0) at = d > 0 ? -1 : 0;
    }
    const block = list[Math.max(0, Math.min(list.length - 1, at + d))];
    if (!block) return;

    landOnBlock(block);
    announce();
}

/**
 * Select the passage you play worst, and say which it was.
 *
 * The weak list already knows; this is the one-press version of reading it and
 * clicking a row. Returns the range so the caller can arm a drill on it in the
 * same gesture.
 */
export function selectWeakest() {
    const rows = snapshot().weakest;
    if (!rows.length) return null;
    const target = rows[0];
    selectSection(target.key);
    setMode('section');
    return selection();
}

/**
 * Take `count` bars starting where the selection already starts.
 *
 * WHY: "I want to drill bar 41" had no gesture. The strip's zones are phrases,
 * several bars each, and the edge steppers move A and B a bar at a time — so
 * getting to one bar meant walking B down to A by hand, once per bar. Reported
 * as not being able to test a single bar at all, which was fair.
 *
 * Anchored on the selection's own start rather than the playhead, so the
 * sequence is: tap the strip near the passage, press 1, then walk A with its
 * stepper until the readout says the bar you want. Every step of that shows
 * you a bar number.
 */
/**
 * The time of the bar `delta` bars along from the one containing `t`.
 *
 * Clamped to the ends of the chart rather than wrapping or refusing: at bar one
 * a step back should leave you at bar one, not somewhere else and not with a
 * button that quietly did nothing.
 */
function shiftBars(bars, t, delta) {
    const i = ranges.barIndexAt(bars, t);
    if (i < 0) return t;
    const j = Math.max(0, Math.min(bars.length - 1, i + delta));
    return bars[j].time;
}

export function selectBars(count) {
    const bars = ranges.barLines(host.beats());
    if (!bars.length) return null;
    const n = Math.max(1, Math.min(64, Math.round(Number(count) || 1)));
    const sel = selection();
    const from = sel ? sel.start : host.time();
    const r = ranges.barsFrom(bars, from, n, host.duration());
    if (!r) return null;
    state.settings = store.setSettings({ barCount: n });
    state.barsRange = r;
    state.mode = 'bars';
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
/**
 * Move a loop edge by one bar — or by two seconds where the chart has no bar
 * lines, which `nudgeByBar` decides for itself.
 *
 * Bars, because a boundary off the grid turns the drill's count-in into a
 * guess. Sub-bar placement is the A/B handle's job: it snaps only when it is
 * near an edge, so a deliberate drag puts one wherever you like.
 */
export function nudge(edge, direction) {
    const cur = selection();
    if (!cur) return;
    const bars = ranges.barLines(host.beats());

    /*
     * ON A BAR WINDOW, A SLIDES THE WHOLE THING.
     *
     * A one-bar loop is a dead end for an edge nudge: A cannot advance without
     * passing B, so `nudgeByBar` correctly refuses and the button does nothing
     * — six presses, no movement, which is how "I cannot say I want to test
     * bar 41" actually felt.
     *
     * With a grain already chosen, moving the START of the window means moving
     * the window: the size was the decision, and the thing you are changing now
     * is which bar. B still resizes, because widening a chosen window is a
     * different intent and still wants its own control.
     */
    if (cur.kind === 'bars' && edge === 'start' && Number.isFinite(Number(cur.barCount))) {
        const slid = ranges.barsFrom(
            bars,
            shiftBars(bars, cur.start, Number(direction) >= 0 ? 1 : -1),
            cur.barCount,
            host.duration(),
        );
        if (slid) {
            state.barsRange = slid;
            state.mode = 'bars';
            announce();
        }
        return;
    }
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

/*
 * WITHDRAWN with the `BARS | TIME` switch: `nudgeBySeconds`.
 *
 * It moved an edge by a tenth of a second, which was never the right tool for
 * sub-bar placement — ten presses per second — and it had no caller left once
 * the switch went. `nudgeByBar` already falls back to seconds on a chart with
 * no bar lines, which is the case the tenths were standing in for; fine
 * placement is the handle's job now, and the handle snaps only when near an
 * edge so a deliberate drag places freely.
 *
 * Deleted rather than kept in case: §19, and a function with no consumer is a
 * function nobody has tested.
 */

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
    /*
     * The live gauge counts whoever owns the measurement, because it is a
     * GAUGE and not the map: `paused` exists to keep a drill's verdicts out of
     * the per-passage record, not to stop the player seeing how the pass is
     * going.
     */
    countPass(noteTime, hit);
    if (state.paused) return;
    state.log.add(noteTime, hit);
}

/** A miss inside the judged window costs a slice of the gauge. */
function countPass(noteTime, hit) {
    const t = Number(noteTime);
    if (!Number.isFinite(t)) return;
    const p = state.pass;
    /* Outside the judged window — a run-up, or a note after B — costs nothing. */
    if (p.from !== null && t < p.from - 1e-6) return;
    if (p.to !== null && t > p.to + 1e-6) return;
    if (!hit) p.misses += 1;
}

/**
 * A new pass over the same passage: the gauge goes back to a hundred.
 *
 * Called on every loop wrap and whenever the passage changes. The window is
 * explicit rather than read from the selection here, because during a drill
 * the conductor is judging its own window and that is the one the number has
 * to agree with.
 */
export function resetPass(from, to) {
    state.pass = {
        misses: 0,
        from: finite(from) ? Number(from) : null,
        to: finite(to) ? Number(to) : null,
    };
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
    /*
     * Read ONCE, and used twice.
     *
     * `barsAvailable` was calling this every tick already, and the edge bar
     * numbers need the same list — filtering, mapping and sorting every beat
     * in the song twice a second, twice, for one boolean and two integers.
     */
    const bars = ranges.barLines(host.beats());
    const events = eventsNow();
    const tally = tallyNow();
    const saved = state.songKey ? store.getSong(state.songKey) : null;
    const records = (saved && saved.ranges) || {};

    const decorate = (r) => {
        const rec = records[r.key];
        const live = tally.get(r.key);
        return {
            ...r,
            /*
             * A gap knows it is empty; nothing counted it and nothing should.
             * `?? null` would report "not counted yet" and make it clickable.
             */
            events: r.kind === 'gap' ? 0 : (events.get(r.key) ?? null),
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
        /** Where the playhead is, for the timeline's marker. */
        playhead: host.time(),

        engine: {
            available: drill.available(),
            detecting: drill.detecting(),
            blocked: drill.blockedReason(),
        },

        /*
         * Whether the host actually has a loop armed right now.
         *
         * Read from the host rather than tracked, because the host's own A/B
         * controls and the drill both set and drop it — a second copy here is
         * how a HUD ends up offering to clear a loop that is not there. Which
         * is what `Clear` did: it was disabled only during a drill, so outside
         * one it was a live button whose click did nothing visible.
         */
        /**
         * Whether this chart has bar lines at all.
         *
         * The edge steppers move by a bar when it does and by seconds when it
         * does not — `nudgeByBar` has always fallen back on its own — and this
         * is what lets their LABEL say which, instead of claiming "±1 bar" on
         * a chart with no bars. It replaced a `BARS | TIME` switch: the unit is
         * a fact about the chart, not a choice worth a control.
         */
        barsAvailable: bars.length > 0,

        /*
         * WHICH BAR each edge is on, or null on a chart with no bar lines.
         *
         * The steppers move by a bar and say so, and printing `0:01` under a
         * label reading `±1 bar` makes the reader do the conversion the panel
         * already knows how to do: a bar number is what you count while you
         * play, and it is the number you would say out loud to describe where
         * the loop starts. The clock stays as the fallback, because on a chart
         * without bar lines a bar number would be a fiction.
         */
        edgeBars: (() => {
            if (!bars.length) return null;
            const sel = selection();
            if (!sel) return null;
            const at = (t) => {
                const i = ranges.barIndexAt(bars, t);
                return i < 0 ? null : bars[i].measure;
            };
            return { start: at(sel.start), end: at(sel.end) };
        })(),

        loopArmed: (() => {
            const l = host.loop();
            // `Number(null)` is 0 and 0 passes `Number.isFinite`, so the
            // obvious version of this line reported a loop armed at 0→0 on
            // every song with no loop — which is the whole reason `Clear` was
            // being fixed. Written once more, caught by measuring the thing
            // rather than by reading it.
            return finite(l.loopA) && finite(l.loopB);
        })(),

        mode: state.mode,
        sections,
        /** Which chip is lit. Explicit, so the panel never has to infer it. */
        sectionKey: state.sectionKey,
        parts,
        partIndex: state.partIndex,
        /** True while a phrase is selected rather than the whole section. */
        onPart: state.mode === 'part',
        partCount: state.parts.length,
        bars: {
            range: state.barsRange ? decorate(state.barsRange) : null,
            count: state.settings.barCount,
            available: ranges.barLines(host.beats()).length > 0,
        },
        selection: sel ? decorate(sel) : null,

        /*
         * THE LIVE GAUGE: a hundred minus what the misses have cost.
         *
         * Derived here rather than in the panel so the number and the passage
         * it is a percentage OF cannot drift apart. `null` when the note count
         * is unknown — a passage nobody has counted yet has no denominator,
         * and inventing one would be a number that reads as measured.
         */
        live: (() => {
            const total = sel ? (events.get(sel.key) ?? null) : null;
            const misses = state.pass.misses;
            if (!Number.isFinite(total) || total <= 0) return { pct: null, misses, total: null };
            return { pct: Math.max(0, 1 - misses / total) * 100, misses, total };
        })(),
        /*
         * The DECORATED selection, so `isUsable` can see the note count.
         *
         * The undecorated range has no `events` field, and the whole point is
         * that a passage with nothing in it is not drillable — the panel was
         * printing "this passage has no notes in it, so there is nothing to
         * drill" directly above a live `Start drill`.
         */
        selectionUsable: ranges.isUsable(sel ? decorate(sel) : null, duration),

        settings: { ...state.settings },

        /*
         * THE BLOCKS THE STRIP DRAWS.
         *
         * Phrases when the chart has them, sections when it does not. The
         * strip is the only loop selector now, so what it draws decides what
         * grain you can pick at all — and a chart with no phrase table would
         * otherwise leave it empty and the panel unusable.
         */
        /*
         * TILED, so the strip has something to draw everywhere.
         *
         * A count-in belongs to no phrase and no section, so the first stretch
         * of a real chart was a hole in the map. `tile` fills those with
         * `events: 0` zones that everything already refuses.
         */
        blocks: ranges.tile(
            state.phrases.length ? state.phrases : state.sections,
            duration,
        ).map(decorate),

        /*
         * The rungs a drill WOULD climb, from the stored start and step.
         *
         * Derived here rather than in the panel, so the rail and the engine
         * cannot disagree about which speeds exist — the panel reads the
         * engine's ladder while a drill runs and this one otherwise, and a
         * mismatch would show as the wrong dot lit.
         */
        ladder: ladder.buildLadder(state.settings.startPct, state.settings.stepPct, host.speedBounds()),
        /** The speed the song is PLAYING at — the audio element's rate. */
        speedPct: host.speedPct(),
        /**
         * The speed the USER picked — the host's own slider.
         *
         * Both, because they disagree while a drill runs: `window.setSpeed`
         * moves the rate and the label but never writes the slider. The panel
         * lights the playing one and compares the chosen one against the
         * ladder's first rung, which is the only way to answer "which speed
         * wins when I press start" without lying in one state or the other.
         */
        chosenSpeedPct: host.chosenSpeedPct(),
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

    /*
     * ZERO OUT OF ZERO IS NOT EMPTY, IT IS UNKNOWN.
     *
     * `countEvents` cannot tell the difference between "this passage has no
     * notes in it" and "the host is reporting no notes at all" — it returns 0
     * either way. And the host reports nothing in more states than you would
     * expect: between `song:loaded` and the chart arriving, after a song is
     * closed while the panel still holds the last section table, and on an
     * arrangement it has no note array for.
     *
     * 0.8.0 started *acting* on a count of 0 — hatching the block, dropping
     * it from the hit table, refusing to drill it — so in any of those states
     * the whole strip went hatched and nothing on it could be clicked. The
     * panel had turned a missing input into twenty-one confident assertions.
     *
     * So the question is asked once, of the CHART: if it carries no events at
     * all, every count stays `null` and null means unknown everywhere
     * downstream. A passage is empty only when the chart has notes somewhere
     * and none of them are here.
     */
    if (!notes.length && !chords.length) {
        state._events = map;               // empty map -> every lookup is null
        state._eventsAt = at;
        state._eventsBars = barsKey;
        return map;
    }

    const all = [...state.sections, ...state.phrases, ...state.parts];
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
    const shape = `${state.barsRange ? state.barsRange.key : ''}|${state.sectionKey || ''}|${state.sections.length}|${state.phrases.length}`;
    if (state._tally && state._tallyAt === size && state._tallyShape === shape) return state._tally;
    const all = [...state.sections, ...state.phrases, ...state.parts];
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
