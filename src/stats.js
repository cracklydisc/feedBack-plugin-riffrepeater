/*
 * Turning per-note verdicts into "which passage do you actually struggle with".
 * Pure: verdicts in, per-range tallies out.
 *
 * The detector already emits everything needed — `notedetect:hit` and
 * `notedetect:miss` carry `noteTime` (the note's chart time) and `hit`. What
 * nobody does is bucket them by passage, which is the difference between
 * "83% on this song" and "83% on this song, and 41% of that is four bars
 * before the solo".
 *
 * ONE RULE MAKES THE NUMBERS HONEST: verdicts scored while a drill is running
 * are excluded. A drill plays the same fifteen seconds ten times, deliberately
 * slowed; folding those into a passage's accuracy would make every drilled
 * passage look like whatever the drill's last iterations looked like, and would
 * make the passages you never drilled look comparatively fine. The conductor
 * already measures drill iterations properly and reports a best when the drill
 * ends — that arrives separately, as `drillBest`.
 *
 * The caller decides what "while a drill is running" means; this module just
 * never sees those verdicts.
 */

/**
 * Bucket verdicts into ranges.
 *
 * Ranges may overlap (a section and its parts describe the same seconds), and
 * that is fine: a verdict lands in EVERY range that contains it. So a section
 * chip and its part chips can be coloured from one pass over the same run.
 */
export function tallyByRange(ranges, verdicts) {
    const out = new Map();
    const list = Array.isArray(ranges) ? ranges : [];
    if (!list.length) return out;

    for (const r of list) {
        out.set(r.key, { key: r.key, label: r.label, hits: 0, misses: 0, accuracy: null });
    }

    for (const v of (Array.isArray(verdicts) ? verdicts : [])) {
        const t = Number(v?.t);
        if (!Number.isFinite(t)) continue;
        for (const r of list) {
            if (t < r.start || t >= r.end) continue;
            const cell = out.get(r.key);
            if (!cell) continue;
            if (v.hit) cell.hits++; else cell.misses++;
        }
    }

    for (const cell of out.values()) {
        const total = cell.hits + cell.misses;
        cell.accuracy = total > 0 ? cell.hits / total : null;
    }
    return out;
}

/**
 * The accuracy to show on a chip.
 *
 * A drill result beats a normal-play result when both exist. That is not
 * "whichever is higher" — it is that the conductor's number was measured
 * against a goal, over repeated iterations of exactly that passage, which is
 * strictly better evidence than one pass through it mid-song.
 */
export function displayAccuracy(record) {
    if (!record) return null;
    const drill = measured(record.drillBest);
    if (drill !== null) return drill;
    return measured(record.best);
}

/**
 * A stored accuracy, or null when there isn't one.
 *
 * `Number(null)` is 0 and 0 is finite, so a bare `Number.isFinite` check turns
 * "never measured" into "missed everything" — which would put unplayed
 * passages at the top of the weak list and colour them red.
 */
function measured(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/**
 * The passages worth practising, worst first.
 *
 * Only ranges with a measured number are eligible: a passage you have never
 * played is not a weakness, it is unknown, and putting it at the top of a
 * "work on this" list would bury the real ones. `minEvents` keeps a two-note
 * fill from outranking a solo on one unlucky miss.
 */
export function weakest(ranges, records, opts = {}) {
    const minEvents = Number.isFinite(Number(opts.minEvents)) ? Number(opts.minEvents) : 8;
    const limit = Number.isFinite(Number(opts.limit)) ? Number(opts.limit) : 5;
    const kinds = opts.kinds || ['section'];

    const rows = [];
    for (const r of (Array.isArray(ranges) ? ranges : [])) {
        if (kinds.length && !kinds.includes(r.kind)) continue;
        if (Number.isFinite(Number(r.events)) && Number(r.events) < minEvents) continue;
        const rec = records && (records[r.key] || (records.get && records.get(r.key)));

        // THIS RUN wins over the stored best, when there is enough of it.
        //
        // The moment the list is most useful is while you are playing, and a
        // list that only woke up after the song ended would be showing you
        // last week. The event floor applies to the live sample too: four
        // notes into a section is not yet a verdict on it.
        const live = Number(r.runAccuracy);
        const enough = Number(r.runEvents) >= minEvents;
        const acc = (Number.isFinite(live) && enough) ? live : displayAccuracy(rec);
        if (!Number.isFinite(acc)) continue;

        rows.push({
            ...r,
            accuracy: acc,
            live: Number.isFinite(live) && enough,
            plays: Number(rec?.plays) || 0,
            graduated: !!rec?.graduated,
        });
    }
    rows.sort((a, b) => a.accuracy - b.accuracy || b.plays - a.plays);
    return rows.slice(0, limit);
}

/**
 * A bounded verdict log.
 *
 * A dense chart is a couple of thousand notes and a long session is several
 * passes, so this caps rather than grows. The cap drops the OLDEST verdicts,
 * which is the right end to lose: the run in progress is what the panel is
 * describing.
 */
export function makeLog(limit = 20000) {
    const cap = Math.max(100, Number(limit) || 20000);
    let items = [];
    return {
        add(t, hit) {
            const time = Number(t);
            if (!Number.isFinite(time)) return;
            items.push({ t: time, hit: !!hit });
            if (items.length > cap) items = items.slice(items.length - cap);
        },
        get() { return items; },
        size() { return items.length; },
        reset() { items = []; },
    };
}

/** Overall accuracy of a verdict log, for the panel's own header. */
export function overall(verdicts) {
    let hits = 0;
    let misses = 0;
    for (const v of (Array.isArray(verdicts) ? verdicts : [])) {
        if (v.hit) hits++; else misses++;
    }
    const total = hits + misses;
    return { hits, misses, accuracy: total > 0 ? hits / total : null };
}
