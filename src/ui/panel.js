/*
 * The panel's contents.
 *
 * THIS FILE IS THE THROWAWAY HALF. In core these controls belong in a third
 * row of the Section Practice popover, next to the chips the user already
 * clicks — not in a panel parked in a corner. The panel exists because the
 * popover has no sanctioned extension point for a plugin (core's
 * docs/plugin-v3-ui.md documents exactly one: playerControlSlot).
 *
 * Two rules keep it replaceable:
 *   - it reads ONLY model.snapshot(), never the host or the detector
 *   - it writes ONLY through the actions passed in, never to the model directly
 *
 * ── WHAT THE KIT NOW OWNS ───────────────────────────────────────────────
 *
 * The panel shell, the button in the player, the four control families, the
 * meters, the badges and the key caps all come from `src/kit/`. The rules
 * behind them are in the kit's DESIGN.md, and they are rules this plugin
 * learned the hard way — every one of them has a Riff Repeater version number
 * attached to the bug that taught it.
 *
 * What is left here is what is genuinely about drilling a passage: the
 * timeline, the ladder's double life as a progress display, the per-iteration
 * row, and the wiring between them.
 */

import * as c from '../kit/controls.js';
import { PRESETS, STRETCH_WARN_PCT, statusLine, nextStepLine } from '../ladder.js';
import { clock } from '../ranges.js';

const MODES = [
    { value: 'section', label: 'Section', title: 'A logical part of the song — the same passages the Practice popover lists. Click a block on the timeline, or drag across it for a custom range.' },
    { value: 'part', label: 'Phrase', title: 'The phrases inside that section — the host\'s "Part n of m".' },
    { value: 'bars', label: 'Bars', title: 'A run of measures taken from the bar under the playhead — for when you fluff something while playing and want the bars you are in.' },
];

/** The panel steps the goal in 5s and stops at 50; the settings page has the rest. */
const GOAL_MIN = 50;
const GOAL_MAX = 100;

/** A drag has to travel this far before it stops being a click. */
const DRAG_SLOP_PX = 4;

function pct(v) {
    const n = c.num(v);
    return n === null ? '–' : Math.round(n * 100) + '%';
}

/**
 * Fill a panel body, and return the `render(snapshot)` that keeps it true.
 *
 * `actions` is the whole write surface: every control below calls into it and
 * nothing else. That is what makes the eventual core version a matter of
 * re-wiring one object.
 */
export function createContent(outer, actions) {
    /*
     * Two children of the panel body: the message for when there is nothing
     * to control, and everything else. Toggling one container beats hiding
     * fifteen rows, and it means `render` has exactly one early return.
     */
    const empty = c.el('p', 'fbk-note',
        'Open a song to pick a passage. The chart has to be loaded before there '
        + 'is anything to loop.');
    const body = c.el('div', 'rr-main');
    outer.appendChild(empty);
    outer.appendChild(body);

    // ── what to loop ─────────────────────────────────────────────────────
    body.appendChild(c.section('What to loop'));

    const mode = c.segmented(MODES, (v) => actions.setMode(v), 'Loop grain');
    body.appendChild(mode.el);

    /*
     * The timeline.
     *
     * Plugin-specific, and staying that way: it is the one control here that
     * is about a SONG rather than about a setting. It replaced a grid of 21+
     * chips that was half the panel's height and needed a careful scan to find
     * "Solo 1" — a strip proportional to the song answers that by position,
     * and it takes a drag, which no arrangement of chips can.
     *
     * It draws no waveform. That would mean fetching and decoding a stem:
     * expensive, duplicating work the player already did, and pointless — the
     * useful signal is not amplitude, it is where the sections are and how
     * well you play them.
     */
    const timeline = c.el('div', 'rr-timeline');
    timeline.setAttribute('role', 'group');
    timeline.setAttribute('aria-label', 'Song timeline — click a section, or drag for a custom range');
    timeline.title = 'Click a section. Drag across for a custom range, snapped to bar lines.';
    const tlBlocks = c.el('div', 'rr-tl-blocks');
    const tlSel = c.el('div', 'rr-tl-sel');
    const tlHead = c.el('div', 'rr-tl-head');
    timeline.appendChild(tlBlocks);
    timeline.appendChild(tlSel);
    timeline.appendChild(tlHead);
    body.appendChild(timeline);
    let blockSignature = '';
    const blockNodes = new Map();

    // The same navigation without a mouse, and the selection's name.
    const navRow = c.el('div', 'fbk-row rr-nav');
    const navPrev = c.button('fbk-step', '◀', 'Previous section', () => actions.stepSection(-1));
    const navName = c.el('span', 'rr-nav-name');
    const navNext = c.button('fbk-step', '▶', 'Next section', () => actions.stepSection(1));
    navRow.appendChild(navPrev);
    navRow.appendChild(navName);
    navRow.appendChild(navNext);
    navRow.appendChild(c.kbd(', .'));
    body.appendChild(navRow);

    // phrase stepper
    const partRow = c.el('div', 'fbk-row rr-parts');
    const partPrev = c.button('fbk-step', '◀', 'Previous phrase', () => actions.stepPart(-1));
    const partLabel = c.el('span', 'rr-nav-name');
    const partNext = c.button('fbk-step', '▶', 'Next phrase', () => actions.stepPart(1));
    partRow.appendChild(partPrev);
    partRow.appendChild(partLabel);
    partRow.appendChild(partNext);
    body.appendChild(partRow);

    // bar count
    const barsRow = c.el('div', 'fbk-row rr-bars');
    const barCount = c.stepper({
        wide: true,          // "4 bars" needs more room than "85 %"
        value: 4,
        step: 1,
        min: 1,
        max: 64,
        unit: 'bars',
        downTitle: 'One bar fewer',
        upTitle: 'One bar more',
        onChange: (v) => actions.setBarCount(v),
    });
    barsRow.appendChild(barCount.el);
    barsRow.appendChild(c.button('fbk-btn fbk-btn-small fbk-btn-quiet', 'From playhead',
        'Take that many bars starting at the bar under the playhead',
        () => actions.barsAtPlayhead()));
    body.appendChild(barsRow);

    /*
     * A and B, from the playhead.
     *
     * The way a guitarist actually marks a passage: press A, let the song run
     * to the end of the phrase, press B. The trim row below is for adjusting
     * afterwards — reading a clock and stepping a number to match it is the
     * same job done backwards.
     */
    const abRow = c.el('div', 'fbk-row rr-ab');
    abRow.appendChild(c.el('span', 'fbk-label fbk-label-inline', 'Mark'));
    const markA = c.button('fbk-btn fbk-btn-small', null,
        'Set the loop start (A) at the playhead', () => actions.markEdge('start'));
    markA.appendChild(c.el('span', null, 'Set A'));
    markA.appendChild(c.kbd('I'));
    const markB = c.button('fbk-btn fbk-btn-small', null,
        'Set the loop end (B) at the playhead', () => actions.markEdge('end'));
    markB.appendChild(c.el('span', null, 'Set B'));
    markB.appendChild(c.kbd('O'));
    abRow.appendChild(markA);
    abRow.appendChild(markB);
    body.appendChild(abRow);

    const plate = c.plate();
    body.appendChild(plate.el);

    const trim = c.el('div', 'fbk-row rr-trim');
    trim.title = 'Move a loop edge by one whole bar. Bars, not seconds: a boundary '
        + 'off the grid turns the count-in into a guess.';
    trim.appendChild(c.el('span', 'fbk-label fbk-label-inline', 'Trim'));
    trim.appendChild(c.button('fbk-step', '−', 'Start one bar earlier', () => actions.nudge('start', -1)));
    const trimStart = c.el('span', 'rr-time');
    trim.appendChild(trimStart);
    trim.appendChild(c.button('fbk-step', '+', 'Start one bar later', () => actions.nudge('start', 1)));
    trim.appendChild(c.el('span', 'rr-arrow', '→'));
    trim.appendChild(c.button('fbk-step', '−', 'End one bar earlier', () => actions.nudge('end', -1)));
    const trimEnd = c.el('span', 'rr-time');
    trim.appendChild(trimEnd);
    trim.appendChild(c.button('fbk-step', '+', 'End one bar later', () => actions.nudge('end', 1)));
    body.appendChild(trim);

    // ── how to drill ─────────────────────────────────────────────────────
    body.appendChild(c.section('How to drill'));

    /*
     * "Climb" — a chip group on a rail, and the kit's best control.
     *
     * Idle it is the setting: tick the speeds a drill should climb. Running it
     * IS the progress display — the rung being played is filled, cleared rungs
     * go green, the rest wait. One widget, two jobs, and the panel stops being
     * a form the moment anything is happening.
     *
     * The word matters as much as the shape. This row and the "Play at" row
     * below carried the same five numbers in 0.2 with no way to tell which was
     * which; they are a chip group and a segmented control now, and they say
     * "the speeds a drill climbs" and "the speed it is playing at".
     */
    const climbRow = c.el('div', 'fbk-row rr-climb');
    climbRow.appendChild(c.el('span', 'fbk-label fbk-label-inline', 'Climb'));
    const climb = c.chips(
        PRESETS.map((p) => ({ value: p, label: String(p) })),
        (p) => actions.toggleRung(p),
        { rail: true, ariaLabel: 'Speeds a drill climbs' },
    );
    climbRow.appendChild(climb.el);
    const stretchBadge = c.badge('⚠',
        `Below ${STRETCH_WARN_PCT}% the backing track is audibly time-stretched. `
        + 'Worth it for a passage you cannot play yet; not worth leaving on.');
    climbRow.appendChild(stretchBadge);
    body.appendChild(climbRow);

    // Goal and the widen switch share a row: two settings, no prose, one line.
    const goalRow = c.el('div', 'fbk-row rr-goal');
    goalRow.appendChild(c.el('span', 'fbk-label fbk-label-inline', 'Goal'));
    const goal = c.stepper({
        value: 85,
        step: 5,
        min: GOAL_MIN,
        max: GOAL_MAX,
        unit: '%',
        downTitle: 'Lower the goal by 5%',
        upTitle: 'Raise the goal by 5%',
        onChange: (v) => actions.setGoal(v),
    });
    goalRow.appendChild(goal.el);
    const widen = c.toggle('Widen',
        'Once the passage is clean, grow the loop by a bar each side (up to two) '
        + 'so it goes back into its surroundings before you leave it.',
        (on) => actions.setWiden(on));
    widen.el.classList.add('fbk-push');
    goalRow.appendChild(widen.el);
    body.appendChild(goalRow);

    // ── the primary, alone on its line ───────────────────────────────────
    const startBtn = c.button('fbk-btn fbk-btn-primary', null, null, () => actions.startDrill());
    const startDot = c.dot('off');
    startBtn.appendChild(startDot);
    startBtn.appendChild(c.el('span', 'fbk-btn-label', '⏱ Start drill'));
    startBtn.appendChild(c.kbd('D'));
    body.appendChild(startBtn);

    const endBtn = c.button('fbk-btn fbk-btn-stop', null,
        'Stop the drill and restore your speed', () => actions.endDrill());
    endBtn.appendChild(c.el('span', 'fbk-btn-label', '✕ End drill'));
    endBtn.appendChild(c.kbd('D'));
    body.appendChild(endBtn);

    const acts = c.el('div', 'fbk-row fbk-row-tight rr-acts');
    const loopBtn = c.button('fbk-btn fbk-btn-small', 'Loop only',
        'Loop the passage with no goal and no ramp', () => actions.loopOnly());
    const clearBtn = c.button('fbk-btn fbk-btn-small fbk-btn-quiet', 'Clear',
        'Drop the loop and play on', () => actions.clearLoop());
    acts.appendChild(loopBtn);
    acts.appendChild(clearBtn);
    body.appendChild(acts);

    // ── live drill ───────────────────────────────────────────────────────
    const live = c.el('div', 'rr-live');
    const liveStatus = c.el('div', 'rr-live-status');
    const liveNext = c.el('div', 'rr-live-next');
    const liveFocus = c.el('div', 'rr-live-focus');
    const liveIters = c.el('div', 'rr-iters');
    live.appendChild(liveStatus);
    live.appendChild(liveNext);
    live.appendChild(liveFocus);
    live.appendChild(liveIters);
    body.appendChild(live);

    // ── play at ──────────────────────────────────────────────────────────
    body.appendChild(c.section('Play at'));

    const speedRow = c.el('div', 'fbk-row rr-speed');
    const speed = c.segmented(
        PRESETS.map((p) => ({ value: p, label: String(p), title: `Play at ${p}% of tempo` })),
        (p) => actions.setSpeed(p),
        'Playback speed',
    );
    speedRow.appendChild(speed.el);
    speedRow.appendChild(c.kbd('↑ ↓'));
    body.appendChild(speedRow);

    const diffRow = c.el('div', 'fbk-row rr-diff');
    diffRow.title = 'Master difficulty. Lower thins the chart to the easier tiers the '
        + 'pack was authored with; 100% is the full arrangement.';
    diffRow.appendChild(c.el('span', 'fbk-label fbk-label-inline', 'Chart'));
    const difficulty = c.slider({
        min: 0,
        max: 100,
        step: 5,
        unit: '%',
        ariaLabel: 'Master difficulty',
        onInput: (v) => actions.setDifficulty(v),
    });
    diffRow.appendChild(difficulty.el);
    body.appendChild(diffRow);

    // Only ever drawn when it explains a control that is not working.
    const diffNote = c.el('p', 'fbk-note');
    body.appendChild(diffNote);

    // ── the map ──────────────────────────────────────────────────────────
    const mapHead = c.section('Where you struggle');
    const weakestBtn = c.button('fbk-btn fbk-btn-small', 'Practice weakest',
        'Select the passage you play worst and arm a drill on it',
        () => actions.practiceWeakest());
    mapHead.appendChild(weakestBtn);
    body.appendChild(mapHead);
    const runLine = c.el('p', 'fbk-note');
    body.appendChild(runLine);
    const weak = c.el('div', 'rr-weak');
    body.appendChild(weak);

    // ── the timeline's pointer handling ──────────────────────────────────

    let dragFrom = null;
    let dragging = false;
    let duration = 0;

    function timeAtX(clientX) {
        const r = timeline.getBoundingClientRect();
        if (!r.width || !(duration > 0)) return NaN;
        const frac = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
        return frac * duration;
    }

    timeline.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        const t = timeAtX(e.clientX);
        if (!Number.isFinite(t)) return;
        dragFrom = { x: e.clientX, t };
        dragging = false;
        try { timeline.setPointerCapture(e.pointerId); } catch (_) { /* not fatal */ }
        e.preventDefault();
    });

    timeline.addEventListener('pointermove', (e) => {
        if (!dragFrom) return;
        if (!dragging && Math.abs(e.clientX - dragFrom.x) < DRAG_SLOP_PX) return;
        dragging = true;
        const t = timeAtX(e.clientX);
        if (Number.isFinite(t)) actions.selectDrag(dragFrom.t, t);
    });

    function endDrag(e) {
        if (!dragFrom) return;
        const from = dragFrom;
        const wasDragging = dragging;
        dragFrom = null;
        dragging = false;
        try { timeline.releasePointerCapture(e.pointerId); } catch (_) { /* already gone */ }
        if (wasDragging) return;
        // A click, not a drag: whatever section covers that time.
        //
        // Resolved from the TIME, not from the clicked element.
        // `e.target.closest('.rr-tl-block')` needed the pointer to land on a
        // block, so a click on the hairline between two of them fell through
        // to a one-bar range.
        if (Number.isFinite(from.t)) actions.selectAtTime(from.t);
    }

    timeline.addEventListener('pointerup', endDrag);
    timeline.addEventListener('pointercancel', endDrag);

    // ── render ───────────────────────────────────────────────────────────

    function renderTimeline(snap) {
        duration = c.num(snap.duration) ?? 0;
        if (!(duration > 0)) {
            timeline.hidden = true;
            return;
        }
        timeline.hidden = false;

        const signature = snap.sections.map((s) => s.key).join('|');
        if (signature !== blockSignature) {
            blockSignature = signature;
            tlBlocks.textContent = '';
            blockNodes.clear();
            for (const s of snap.sections) {
                const b = c.el('div', 'rr-tl-block');
                b.dataset.key = s.key;
                b.style.left = ((s.start / duration) * 100) + '%';
                b.style.width = (((s.end - s.start) / duration) * 100) + '%';
                blockNodes.set(s.key, b);
                tlBlocks.appendChild(b);
            }
        }

        for (const s of snap.sections) {
            const node = blockNodes.get(s.key);
            if (!node) continue;
            // This run's number wins over the stored best: while you are
            // playing, the interesting question is how THIS pass is going.
            const acc = c.num(s.runAccuracy) ?? c.num(s.best);
            const b = c.band(acc);
            node.dataset.band = b || 'none';
            node.classList.toggle('rr-tl-block-on', snap.mode !== 'bars' && s.key === snap.sectionKey);
            node.classList.toggle('rr-tl-block-done', !!s.graduated);
            const bits = [s.label, `${clock(s.start)} → ${clock(s.end)}`];
            if (acc !== null) bits.push(`best ${pct(acc)}`);
            if (c.num(s.events) !== null) bits.push(`${s.events} notes`);
            node.title = bits.join(' · ');
        }

        const sel = snap.selection;
        if (sel) {
            tlSel.hidden = false;
            tlSel.style.left = ((sel.start / duration) * 100) + '%';
            tlSel.style.width = (Math.max(0.4, ((sel.end - sel.start) / duration) * 100)) + '%';
        } else {
            tlSel.hidden = true;
        }

        const t = c.num(snap.playhead);
        if (t !== null && t >= 0) {
            tlHead.hidden = false;
            tlHead.style.left = (Math.min(100, (t / duration) * 100)) + '%';
        } else {
            tlHead.hidden = true;
        }
    }

    /**
     * The ladder, in whichever of its two jobs applies.
     *
     * Running, the state comes from the ENGINE's ladder and rung, not from the
     * setting — they can differ, because a drill keeps the ladder it was armed
     * with while the user is free to re-tick the setting for the next one.
     */
    function renderClimb(snap) {
        const running = snap.drill.active;
        const chosen = snap.settings.ladder || [];
        const engine = running ? (snap.drill.ladderPct || []) : [];
        const nowPct = running ? engine[snap.drill.rung] : null;

        const states = {};
        for (const p of PRESETS) {
            const inLadder = running ? engine.includes(p) : (p === 100 || chosen.includes(p));
            const isNow = running && p === nowPct;
            const cleared = running && inLadder && Number.isFinite(nowPct) && p < nowPct;
            states[p] = isNow ? 'now' : (cleared ? 'done' : (inLadder ? 'on' : null));

            climb.title(p, running
                ? (isNow ? `Playing at ${p}% — clear the goal to move up`
                    : (cleared ? `Cleared at ${p}%` : (inLadder ? `Still to come: ${p}%` : 'Not in this drill')))
                : (p === 100
                    ? 'A drill always finishes at full tempo'
                    : `${p}% of tempo — click to ${inLadder ? 'drop' : 'add'} this rung`));
        }
        climb.set(states);
        // 100 is never editable: a drill that never asks for the real tempo
        // has not taught the passage.
        for (const p of PRESETS) {
            const node = climb.node(p);
            if (node) node.disabled = running || p === 100;
        }
        climb.el.title = running
            ? 'The ladder this drill is climbing.'
            : `The speeds a drill climbs. A cleared goal steps up one; ${snap.drill.reps || 3} clean passes at full tempo finish it.`;
    }

    function renderIterations(snap) {
        liveIters.textContent = '';
        if (!snap.drill.active) return;
        const list = snap.iterations.slice(-8);
        if (!list.length && !snap.current) {
            liveIters.appendChild(c.el('span', 'fbk-note', 'Play the loop — the first pass has not been scored yet.'));
            return;
        }
        for (const it of list) {
            const cell = c.el('span', 'rr-iter');
            const acc = c.num(it.accuracyPct);
            cell.dataset.band = c.band(acc === null ? null : acc / 100) || 'none';
            cell.textContent = acc === null ? '–' : acc + '%';
            cell.title = `Pass ${it.idx + 1}: ${it.hits} hit, ${it.misses} missed`;
            liveIters.appendChild(cell);
        }
        if (snap.current && (snap.current.hits + snap.current.misses) > 0) {
            const cell = c.el('span', 'rr-iter rr-iter-now');
            const acc = c.num(snap.current.accuracyPct);
            cell.textContent = acc === null ? '–' : acc + '%';
            cell.title = `This pass so far: ${snap.current.hits} hit, ${snap.current.misses} missed`;
            liveIters.appendChild(cell);
        }
    }

    function renderWeak(snap) {
        weak.textContent = '';
        if (!snap.weakest.length) {
            weak.appendChild(c.el('p', 'fbk-note',
                'Nothing measured yet. Play with note detection on and the sections you '
                + 'struggle with will collect a number here.'));
            return;
        }
        for (const row of snap.weakest) {
            const live = row.live ? c.el('span', 'rr-live-dot', '•') : null;
            weak.appendChild(c.meterRow({
                label: row.label,
                value: row.accuracy * 100,
                band: c.band(row.accuracy),
                suffix: live,
                onClick: () => actions.selectSection(row.key),
                title: row.live
                    ? `${row.label} — ${pct(row.accuracy)} on this run. Click to select it.`
                    : (row.graduated
                        ? `${row.label} — graduated a drill at ${pct(row.accuracy)}. Click to select it.`
                        : `${row.label} — ${pct(row.accuracy)} over ${row.plays} attempt${row.plays === 1 ? '' : 's'}. Click to select it.`),
            }));
        }
    }

    function render(snap) {
        empty.hidden = !!snap.ready;
        body.hidden = !snap.ready;
        if (!snap.ready) return;

        mode.set(snap.mode);
        partRow.hidden = snap.mode !== 'part';
        barsRow.hidden = snap.mode !== 'bars';

        renderTimeline(snap);

        // the section stepper doubles as the selection's name
        const current = snap.sections.find((s) => s.key === snap.sectionKey);
        const at = snap.sections.indexOf(current);
        navName.textContent = current ? current.label : '—';
        navPrev.disabled = at <= 0;
        navNext.disabled = at < 0 || at >= snap.sections.length - 1;

        if (snap.mode === 'part') {
            partLabel.textContent = snap.partCount
                ? `Part ${snap.partIndex + 1} of ${snap.partCount}`
                : 'No phrase data';
            partPrev.disabled = snap.partIndex <= 0;
            partNext.disabled = snap.partIndex >= snap.partCount - 1;
        }

        if (snap.mode === 'bars') {
            barCount.set(snap.bars.count);
            barCount.disable(!snap.bars.available);
            barsRow.title = snap.bars.available
                ? 'How many bars to take, starting at the bar under the playhead.'
                : 'This chart carries no bar lines, so bar ranges are unavailable.';
        }

        // the chosen range
        const sel = snap.selection;
        if (sel) {
            const len = Math.max(0, sel.end - sel.start);
            const bits = [`${clock(sel.start)} → ${clock(sel.end)}`, `${len.toFixed(1)}s`];
            if (c.num(sel.events) !== null) bits.push(`${sel.events} notes`);
            if (c.num(sel.best) !== null) bits.push(`best ${pct(sel.best)}`);
            plate.set(sel.label, bits.join(' · '));
            trimStart.textContent = clock(sel.start);
            trimEnd.textContent = clock(sel.end);
        } else {
            plate.set('Nothing selected', '');
            trimStart.textContent = '–';
            trimEnd.textContent = '–';
        }
        for (const b of trim.querySelectorAll('button')) b.disabled = !sel || snap.drill.active;
        // A works with nothing selected — that is how you start a range. B
        // needs a start to close, and the drill owns the loop while it runs.
        markA.disabled = snap.drill.active;
        markB.disabled = snap.drill.active || !sel;

        // the ladder and the goal
        renderClimb(snap);
        const goalPct = snap.drill.active && Number.isFinite(snap.drill.goalPct)
            ? snap.drill.goalPct
            : snap.settings.goalPct;
        goal.set(goalPct);
        goal.disable(snap.drill.active);
        widen.set(snap.settings.widen);
        widen.disable(snap.drill.active);
        stretchBadge.hidden = snap.drill.active
            || !(snap.settings.ladder || []).some((p) => p < STRETCH_WARN_PCT);

        // actions
        const canDrill = snap.selectionUsable && !snap.engine.blocked;
        startBtn.hidden = snap.drill.active;
        endBtn.hidden = !snap.drill.active;
        startBtn.disabled = !canDrill;
        // The blocked reason lives ON the blocked control — no box for it.
        startBtn.title = snap.engine.blocked
            || (snap.selectionUsable ? 'Arm the drill on the chosen passage' : 'Pick a passage first');
        startDot.dataset.state = snap.engine.blocked ? (snap.engine.available ? 'warn' : 'off') : 'ready';
        startDot.title = snap.engine.blocked || 'Note detection is live';
        loopBtn.disabled = !snap.selectionUsable || snap.drill.active;
        clearBtn.disabled = snap.drill.active;

        // live
        live.hidden = !snap.drill.active;
        if (snap.drill.active) {
            liveStatus.textContent = snap.drill.label
                ? `${snap.drill.label} — ${statusLine(snap.drill)}`
                : statusLine(snap.drill);
            liveNext.textContent = nextStepLine(snap.drill);
            liveFocus.hidden = !snap.drill.focus;
            liveFocus.textContent = snap.drill.focus || '';
            renderIterations(snap);
        }

        // play at
        const lit = PRESETS.find((p) => Math.abs(snap.speedPct - p) < 3);
        speed.set(lit === undefined ? null : lit);
        speed.disable(snap.drill.active);
        speed.el.title = snap.drill.active
            ? 'The drill owns the speed while it runs.'
            : 'The speed the song is playing at now.';
        difficulty.set(snap.difficultyPct);
        difficulty.disable(!snap.hasPhraseData || snap.drill.active);

        if (snap.drill.active) {
            diffNote.hidden = false;
            diffNote.textContent = 'The drill owns the speed and the difficulty while it runs.';
        } else if (!snap.hasPhraseData) {
            diffNote.hidden = false;
            diffNote.textContent = 'This chart has a single difficulty tier, so the slider does nothing here.';
        } else {
            diffNote.hidden = true;
            diffNote.textContent = '';
        }

        // the map
        weakestBtn.disabled = !snap.weakest.length || snap.drill.active;
        const run = snap.run;
        runLine.textContent = (c.num(run.accuracy) !== null)
            ? `This run: ${pct(run.accuracy)} over ${run.hits + run.misses} judged notes.${snap.paused ? ' Paused — the drill is measuring instead.' : ''}`
            : 'This run: nothing judged yet.';
        renderWeak(snap);
    }

    return { render };
}
