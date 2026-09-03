/*
 * What you can loop, derived from the chart. Pure — arrays in, ranges out.
 *
 * Three grains, because a passage worth drilling is one of three things:
 *
 *   SECTION   "Verse 1" — a logical part of the song. Built by collapsing
 *             consecutive same-name markers, exactly the way the host's own
 *             Section Practice does it, so a chip here means the same passage
 *             as the chip there. That match is not cosmetic: if the two
 *             disagreed by half a bar, the loop the user armed in one place
 *             would not be the loop the other place highlights.
 *
 *   PART      the phrases inside a section — the host's "Part 1 of 2".
 *
 *   BARS      an arbitrary run of measures. This is the grain the host does
 *             NOT offer, and the one a guitarist actually asks for ("the four
 *             bars before the chorus"). Bar lines come out of getBeats(),
 *             where a downbeat carries its measure number and every other
 *             beat carries -1.
 *
 * The section/part logic is a deliberate port of static/js/section-practice.js
 * (`_buildSectionParents`, `_buildPhrasePartsForParent`, `_sectionPracticeBaseName`).
 * It is duplicated rather than reached for because those are module-private in
 * core — and when this moves into core, this file's copies are the ones that
 * get deleted in favour of the originals. The tests pin the behaviour so that
 * deletion is provably a no-op.
 */

/** A section marker later than this, with notes before it, earns a "Start" range. */
const START_GAP_SEC = 0.05;

/** Shortest range worth arming. The host's own startDrill refuses under 0.5s. */
export const MIN_RANGE_SEC = 0.5;

const CANONICAL = {
    intro: 'Intro',
    verse: 'Verse',
    chorus: 'Chorus',
    bridge: 'Bridge',
    solo: 'Solo',
    riff: 'Riff',
    outro: 'Outro',
};

function fin(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
}

function markerTime(s) {
    if (!s) return NaN;
    return fin(s.time ?? s.startTime ?? s.start_time ?? s.start);
}

/**
 * The display name a section marker contributes to a group.
 *
 * Strips a trailing number ("Chorus 2" -> "Chorus") because the counter is
 * re-derived from position: charts number their markers inconsistently, and a
 * label that came half from the chart and half from us reads as a bug.
 */
export function baseName(rawName, fallbackIndex) {
    let s = (typeof rawName === 'string' ? rawName : '').trim();
    if (!s) s = `Section ${fallbackIndex + 1}`;
    s = s.replace(/_/g, ' ').replace(/\s*\d+$/u, '');
    const lower = s.toLowerCase();
    if (CANONICAL[lower]) return CANONICAL[lower];
    const titled = lower.split(/\s+/).filter(Boolean)
        .map((w) => w[0].toUpperCase() + w.slice(1))
        .join(' ');
    return titled || `Section ${fallbackIndex + 1}`;
}

/**
 * Sections, as loopable ranges.
 *
 * `hasNotesBefore` is a predicate rather than the note array so this stays
 * cheap to test: the only question asked of the chart is "is there anything to
 * play before the first marker", and a caller that already knows says so.
 */
export function buildSections(sections, duration, hasNotesBefore = () => false) {
    const raw = Array.isArray(sections) ? sections : [];
    if (!raw.length) return [];
    const dur = fin(duration);

    const sorted = [...raw].sort((a, b) => markerTime(a) - markerTime(b));

    // Step 1 — collapse consecutive same-name markers into logical groups.
    const groups = [];
    for (let i = 0; i < sorted.length; i++) {
        const start = markerTime(sorted[i]);
        if (!Number.isFinite(start)) continue;
        const base = baseName(sorted[i].name, groups.length);
        const prev = groups[groups.length - 1];
        if (prev && prev.base === base) prev.lastIndex = i;
        else groups.push({ base, firstIndex: i, lastIndex: i });
    }
    if (!groups.length) return [];

    // Step 2 — number the repeats (Verse 1, Verse 2, …) and close each range
    // on the next group's start.
    const counters = Object.create(null);
    const out = [];
    for (let gi = 0; gi < groups.length; gi++) {
        const g = groups[gi];
        const count = (counters[g.base] || 0) + 1;
        counters[g.base] = count;
        const start = markerTime(sorted[g.firstIndex]);
        if (!Number.isFinite(start)) continue;
        let end = (gi + 1 < groups.length)
            ? markerTime(sorted[groups[gi + 1].firstIndex])
            : dur;
        if (!Number.isFinite(end) || end <= start) end = (dur > start) ? dur : start + 4;
        out.push({ kind: 'section', label: `${g.base} ${count}`, start, end });
    }

    // A chart whose first marker is late, with notes before it, has a passage
    // no chip can reach. Give it one.
    if (out.length) {
        const first = fin(out[0].start);
        if (Number.isFinite(first) && first > START_GAP_SEC && hasNotesBefore(first)) {
            out.unshift({ kind: 'section', label: 'Start', start: 0, end: first });
        }
    }
    return out.map(withKey);
}

/**
 * The phrase parts inside one section range.
 *
 * The first part is snapped back to the section's own start: when a section's
 * first phrase iteration begins slightly later (a repeated chorus, typically)
 * an unsnapped loop starts a beat inside the passage the chip promised.
 */
export function buildParts(section, phrases, duration) {
    if (!section) return [];
    const dur = fin(duration);
    const ws = fin(section.start);
    const we = fin(section.end);
    if (!Number.isFinite(ws) || !Number.isFinite(we)) return [];

    const table = Array.isArray(phrases) ? phrases : [];
    const inWindow = table.filter((ph) => {
        const s = fin(ph?.start_time);
        return Number.isFinite(s) && s >= ws - 0.001 && s < we - 0.001;
    });

    const parts = [];
    for (const ph of inWindow) {
        let start = fin(ph.start_time);
        let end = fin(ph.end_time);
        if (!Number.isFinite(end) || end > we) end = we;
        if (Number.isFinite(dur) && dur > 0 && end > dur) end = dur;
        if (!Number.isFinite(start) || end <= start) continue;
        parts.push({ kind: 'part', label: section.label, start, end });
    }

    if (parts.length) {
        if (parts[0].start > ws) parts[0].start = ws;
        return parts.map((p, i) => withKey({
            ...p,
            label: `${section.label} · part ${i + 1}/${parts.length}`,
            partIndex: i,
            partCount: parts.length,
            parent: section.key,
        }));
    }

    // No phrase table (a GP import, an old pack): the section is its own
    // single part. Returning [] here would make Prev/Next dead rather than
    // trivially satisfied.
    let end = we;
    if (Number.isFinite(dur) && dur > 0 && end > dur) end = dur;
    if (end <= ws) return [];
    return [withKey({
        kind: 'part',
        label: `${section.label} · part 1/1`,
        start: ws,
        end,
        partIndex: 0,
        partCount: 1,
        parent: section.key,
    })];
}

/**
 * Bar lines, in time order.
 *
 * getBeats() marks a downbeat with its measure number and every other beat
 * with -1, so the filter IS the derivation. Measure numbers are carried
 * through rather than recomputed: they are what the highway prints, and a
 * range labelled "bars 34–37" has to agree with what the user is reading.
 */
export function barLines(beats) {
    return (Array.isArray(beats) ? beats : [])
        .filter((b) => Number.isFinite(fin(b?.time)) && fin(b?.measure) >= 1)
        .map((b) => ({ measure: fin(b.measure), time: fin(b.time) }))
        .sort((a, b) => a.time - b.time);
}

/** Index of the bar containing `t`, or -1. */
export function barIndexAt(bars, t) {
    const time = fin(t);
    if (!bars.length || !Number.isFinite(time)) return -1;
    let lo = 0;
    let hi = bars.length - 1;
    if (time < bars[0].time) return 0;   // before the first bar line: treat as bar 1
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (bars[mid].time <= time) lo = mid; else hi = mid - 1;
    }
    return lo;
}

/**
 * `count` bars starting at the one under the playhead.
 *
 * Starting AT the bar rather than centring on it is the deliberate choice: a
 * centred window starts mid-phrase about half the time, and a drill that
 * begins mid-phrase teaches the wrong entry.
 */
export function barsFrom(bars, t, count, duration) {
    const list = Array.isArray(bars) ? bars : [];
    if (!list.length) return null;
    const n = Math.max(1, Math.round(Number(count) || 1));
    const i = barIndexAt(list, t);
    if (i < 0) return null;
    const start = list[i].time;
    const endIdx = i + n;
    const dur = fin(duration);
    let end = (endIdx < list.length) ? list[endIdx].time : (Number.isFinite(dur) ? dur : NaN);
    if (!Number.isFinite(end) || end <= start) return null;
    const lastMeasure = (endIdx - 1 < list.length) ? list[endIdx - 1].measure : list[list.length - 1].measure;
    return withKey({
        kind: 'bars',
        label: (list[i].measure === lastMeasure)
            ? `Bar ${list[i].measure}`
            : `Bars ${list[i].measure}–${lastMeasure}`,
        start,
        end,
        firstMeasure: list[i].measure,
        lastMeasure,
        barCount: n,
    });
}

/**
 * The nearest bar line to a time.
 *
 * What a drag on the timeline gets snapped to. Nearest rather than previous:
 * a drag is a rough gesture and the user means the bar they let go closest
 * to, not the one they happened to pass over.
 */
export function snapToBar(bars, t) {
    const list = Array.isArray(bars) ? bars : [];
    const time = fin(t);
    if (!Number.isFinite(time)) return NaN;
    if (!list.length) return time;

    /*
     * THE SONG'S START IS A BOUNDARY TOO.
     *
     * A chart's first bar line is wherever the first measure begins — 0:03 on
     * a song with a count-in — and this snapped to it unconditionally. So
     * dragging the A handle all the way to the left gave 0, and then the bar
     * snap moved it forward to 0:03, and the loop refused to start at the
     * beginning of the song however far you pushed. Reported exactly that way.
     *
     * Zero is as real an edge as any measure: it is where the audio starts.
     * Treated as an implicit line in front of the list, so a time before the
     * first bar picks whichever of the two is nearer.
     */
    if (time < list[0].time) {
        return (time - 0 <= list[0].time - time) ? 0 : list[0].time;
    }

    const i = barIndexAt(list, time);
    const here = list[i].time;
    const next = (i + 1 < list.length) ? list[i + 1].time : null;
    if (next === null) return here;
    return (Math.abs(time - here) <= Math.abs(next - time)) ? here : next;
}

/**
 * A dragged range, snapped to bars and named for what it covers.
 *
 * Handles the two things a drag gets wrong on its own: a backwards drag (let
 * go left of where you started) and a drag so short it snaps to one bar line
 * — which would give a zero-length loop. The second is why this can return
 * null: refusing is better than arming something silently different from the
 * gesture.
 */
export function rangeFromDrag(bars, a, b, duration) {
    const list = Array.isArray(bars) ? bars : [];
    let start = snapToBar(list, Math.min(Number(a), Number(b)));
    let end = snapToBar(list, Math.max(Number(a), Number(b)));
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;

    // Snapped to the same line: grow by one bar rather than refuse outright,
    // so a tap on the timeline still gives you the bar you tapped.
    if (end <= start) {
        const i = barIndexAt(list, start);
        const dur = fin(duration);
        end = (i + 1 < list.length) ? list[i + 1].time : (Number.isFinite(dur) ? dur : start + 2);
    }
    const dur = fin(duration);
    if (Number.isFinite(dur) && dur > 0) end = Math.min(end, dur);
    if (end - start < MIN_RANGE_SEC) return null;

    const si = barIndexAt(list, start);
    const ei = barIndexAt(list, Math.max(start, end - 0.001));
    const first = list[si]?.measure;
    const last = list[ei]?.measure;
    const label = (Number.isFinite(first) && Number.isFinite(last))
        ? (first === last ? `Bar ${first}` : `Bars ${first}–${last}`)
        : 'Custom range';
    return withKey({
        kind: 'bars',
        label,
        start,
        end,
        firstMeasure: first,
        lastMeasure: last,
        barCount: Math.max(1, ei - si + 1),
    });
}

/**
 * Move one edge of a range by one bar.
 *
 * This is what replaces the detector's own ±2 SECONDS trim. Two seconds is a
 * different amount of music in every song, and a loop boundary that is not on
 * a bar line turns a count-in into a guess.
 */
export function nudgeByBar(range, bars, edge, direction, duration) {
    if (!range) return range;
    const list = Array.isArray(bars) ? bars : [];
    const dir = Number(direction) >= 0 ? 1 : -1;
    const dur = fin(duration);
    const times = list.map((b) => b.time);

    function shift(value, d) {
        if (!times.length) return value + d * 2;   // no bar lines: fall back to seconds
        const i = barIndexAt(list, value);
        // Snap onto the grid first when the value sits between two lines, so
        // the first press lands on a bar rather than moving a stale offset.
        const onGrid = Math.abs(times[i] - value) < 0.001;
        let target = onGrid ? i + d : (d > 0 ? i + 1 : i);
        target = Math.max(0, Math.min(times.length - 1, target));
        return times[target];
    }

    let { start, end } = range;
    if (edge === 'start') start = shift(start, dir);
    else end = shift(end, dir);

    if (Number.isFinite(dur) && dur > 0) end = Math.min(end, dur);
    start = Math.max(0, start);
    if (end - start < MIN_RANGE_SEC) return range;   // refuse to collapse it

    const out = { ...range, start, end };
    if (list.length) {
        const si = barIndexAt(list, start);
        const ei = barIndexAt(list, Math.max(start, end - 0.001));
        out.firstMeasure = list[si]?.measure ?? out.firstMeasure;
        out.lastMeasure = list[ei]?.measure ?? out.lastMeasure;
        out.barCount = Math.max(1, ei - si + 1);
        if (out.kind === 'bars') {
            out.label = (out.firstMeasure === out.lastMeasure)
                ? `Bar ${out.firstMeasure}`
                : `Bars ${out.firstMeasure}–${out.lastMeasure}`;
        }
    }
    return withKey(out, true);
}

/**
 * How many playable events fall inside a range.
 *
 * Notes and chords are counted as one event each — a six-string chord is one
 * thing you either land or do not, which is also how the detector's chord
 * leniency scores it.
 */
export function countEvents(notes, chords, start, end) {
    const a = fin(start);
    const b = fin(end);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
    let n = 0;
    for (const list of [notes, chords]) {
        for (const ev of (Array.isArray(list) ? list : [])) {
            const t = fin(ev?.time ?? ev?.t ?? ev?.start_time);
            if (Number.isFinite(t) && t >= a && t < b) n++;
        }
    }
    return n;
}

/**
 * A stable identity for a range, so a result recorded today matches the same
 * passage tomorrow.
 *
 * Times are quantised to 10ms: the section table is regenerated on every
 * arrangement switch and float noise in the last decimal would otherwise make
 * yesterday's best unreachable. 10ms is far below the tightest clean-timing
 * window, so two ranges that quantise together are the same passage.
 */
export function rangeKey(kind, start, end) {
    const q = (v) => Math.round(fin(v) * 100);
    return `${kind}:${q(start)}:${q(end)}`;
}

function withKey(range, force = false) {
    if (!range) return range;
    if (range.key && !force) return range;
    return { ...range, key: rangeKey(range.kind, range.start, range.end) };
}

/** Whether a range is long enough, and inside the song. */
export function isUsable(range, duration) {
    if (!range) return false;
    const a = fin(range.start);
    const b = fin(range.end);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    if (b - a < MIN_RANGE_SEC) return false;
    const dur = fin(duration);
    if (Number.isFinite(dur) && dur > 0 && a >= dur) return false;
    /*
     * A passage with NO NOTES in it — a Noguitar marker, usually.
     *
     * `=== 0` and not a falsy test: `events` is null until the count has been
     * taken, and `Number(null)` is 0, so the obvious version of this line
     * would disable the primary for one frame after every arrangement change.
     * Absent is not empty.
     *
     * An undecorated range has no `events` at all and stays usable, which is
     * what the drag path wants: a custom range is judged on its geometry.
     */
    if (range.events === 0) return false;
    return true;
}

/** mm:ss for a panel label. */
export function clock(sec, decimals = 0) {
    const n = fin(sec);
    if (!Number.isFinite(n) || n < 0) return '–';
    const m = Math.floor(n / 60);
    const rest = n - m * 60;
    /*
     * `decimals` exists for the TIME nudge unit, which moves an edge by a
     * tenth: a stepper whose step is finer than its readout is a control you
     * can press twice with nothing happening on screen.
     */
    if (decimals > 0) {
        const s = rest.toFixed(decimals);
        return `${m}:${(Number(s) < 10 ? '0' : '') + s}`;
    }
    return `${m}:${String(Math.floor(rest)).padStart(2, '0')}`;
}

/**
 * Fill the time no zone covers, so the strip tiles the whole song.
 *
 * WHY THIS EXISTS: the first eight and a half percent of a real chart belonged
 * to no phrase and no section — a count-in — and the strip drew nothing there.
 * Reported as looking strange, and it did: a hole in a map reads as the map
 * being broken, not as the song having nothing in it yet.
 *
 * A gap is a first-class zone with `events: 0`, so everything downstream that
 * already refuses an empty range refuses these too: they fall out of the hit
 * table, they cannot be selected, and `isUsable` rejects them. Its `kind` says
 * what it is, because a gap and an EMPTY zone are two different nothings and
 * the strip draws them differently.
 *
 * `min` is how short a gap has to be before it is not worth saying — a few
 * milliseconds of rounding between two phrases is not a hole.
 */
export function tile(list, duration, min = 0.25) {
    const total = fin(duration);
    const items = (Array.isArray(list) ? list : [])
        .filter((r) => Number.isFinite(fin(r?.start)) && Number.isFinite(fin(r?.end)))
        .slice()
        .sort((a, b) => fin(a.start) - fin(b.start));
    if (!Number.isFinite(total) || total <= 0) return items;

    const gap = (start, end) => ({
        kind: 'gap',
        key: rangeKey('gap', start, end),
        label: 'No notes',
        start,
        end,
        events: 0,
    });

    const out = [];
    let cursor = 0;
    for (const it of items) {
        const start = fin(it.start);
        const end = fin(it.end);
        if (start - cursor >= min) out.push(gap(cursor, start));
        out.push(it);
        cursor = Math.max(cursor, end);
    }
    if (total - cursor >= min) out.push(gap(cursor, total));
    return out;
}
