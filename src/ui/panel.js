/*
 * The panel.
 *
 * THIS FILE IS THE THROWAWAY HALF. In core these controls belong in a third
 * row of the Section Practice popover, next to the chips the user already
 * clicks — not in a panel parked in a corner. The panel exists because the
 * popover has no sanctioned extension point for a plugin (core's
 * docs/plugin-v3-ui.md documents exactly one: playerControlSlot), and
 * injecting into it would mean fighting specificity and re-injecting after
 * every re-render.
 *
 * Two rules keep it replaceable:
 *   - it reads ONLY model.snapshot(), never the host or the detector
 *   - it writes ONLY through the actions passed in, never to the model directly
 *
 * Rendering is patch-in-place rather than innerHTML-per-tick, because this
 * re-renders twice a second while a drill runs and a rebuilt block is a block
 * that cannot be clicked.
 *
 * ── ON THE CONTROLS ─────────────────────────────────────────────────────
 *
 * This is a heads-up display for something you do with a guitar in your
 * hands, not a preferences sheet. The rules, from the design language the
 * Virtuoso plugin already writes down for this app, plus what a review of the
 * first version taught:
 *
 *  1. ONE CONTROL FAMILY PER MEANING, and the families must not collide. A
 *     segmented control is "pick one of a small fixed set". A chip group is
 *     "pick a subset". A toggle pill is a boolean. Version 0.2 drew the drill
 *     ladder (a subset) and the playback speed (one of a set) as the same
 *     rail of pills with the same five numbers — two different things wearing
 *     one costume, which is the single most confusing thing a panel can do.
 *     They are different families now, and their labels say which is which.
 *  2. ONE lit primary, on its own line, so nothing competes with it.
 *  3. A DATA signal must never look like a SELECTION signal. The section
 *     chips carried an accuracy underline in green/amber/red while selection
 *     was an accent border — and a reviewer read the amber underline as a
 *     second kind of "selected". The accuracy colour now lives on the
 *     timeline and in the weak list, where colour means one thing.
 *  4. No paragraph of explanation, and no box drawn to hold one. A warning is
 *     a badge with the sentence in its tooltip; a blocked action explains
 *     itself on the button that is blocked.
 *
 * And the ladder still does double duty: idle it is the setting, running it IS
 * the progress display. Turning a setting into a status readout is most of
 * what separates a HUD from a form.
 */

import { PRESETS, STRETCH_WARN_PCT, statusLine, nextStepLine, band } from '../ladder.js';
import { clock } from '../ranges.js';

const MODES = [
    { id: 'section', label: 'Section', hint: 'A logical part of the song — the same passages the Practice popover lists. Click a block on the timeline, or drag across it for a custom range.' },
    { id: 'part', label: 'Phrase', hint: 'The phrases inside that section — the host\'s "Part n of m".' },
    { id: 'bars', label: 'Bars', hint: 'A run of measures taken from the bar under the playhead — for when you fluff something while playing and want the bars you are in.' },
];

/** The panel steps the goal in 5s and stops at 50; the settings page has the rest. */
const GOAL_STEP = 5;
const GOAL_MIN = 50;
const GOAL_MAX = 100;

/** A drag has to travel this far before it stops being a click. */
const DRAG_SLOP_PX = 4;

function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
}

function button(cls, text, title, onClick) {
    const b = el('button', cls, text);
    b.type = 'button';
    if (title) b.title = title;
    if (onClick) b.addEventListener('click', onClick);
    return b;
}

/** A key cap, so a shortcut is discoverable without opening the help panel. */
function kbd(keys) {
    const n = el('span', 'rr-kbd', keys);
    n.setAttribute('aria-hidden', 'true');
    return n;
}

/** A boolean, drawn the way the app draws one. */
function toggle(label, title, onChange) {
    const wrap = el('label', 'rr-toggle');
    if (title) wrap.title = title;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.addEventListener('change', () => onChange(input.checked));
    wrap.appendChild(input);
    wrap.appendChild(el('span', 'rr-toggle-track'));
    wrap.appendChild(el('span', 'rr-toggle-text', label));
    return { wrap, input };
}

function pct(v) {
    return Number.isFinite(v) ? Math.round(v * 100) + '%' : '–';
}

/**
 * Build the panel once and return a `render(snapshot)`.
 *
 * `actions` is the whole write surface: every control below calls into it and
 * nothing else. That is what lets the same panel be driven by a test harness,
 * and what makes the eventual core version a matter of re-wiring one object.
 */
export function createPanel(actions) {
    const root = el('div', 'rr-panel');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Riff Repeater');
    root.hidden = true;

    // ── header ───────────────────────────────────────────────────────────
    const head = el('div', 'rr-head');
    head.appendChild(el('span', 'rr-title', 'Riff Repeater'));
    const songLabel = el('span', 'rr-song');
    head.appendChild(songLabel);
    head.appendChild(button('rr-x', '✕', 'Close (Esc)', () => actions.close()));
    root.appendChild(head);

    const body = el('div', 'rr-body');
    root.appendChild(body);

    const empty = el('p', 'rr-empty');
    body.appendChild(empty);

    const main = el('div', 'rr-main');
    body.appendChild(main);

    // ── what to loop ─────────────────────────────────────────────────────
    main.appendChild(el('h4', 'rr-legend', 'What to loop'));

    const modeRow = el('div', 'rr-modes', null);
    modeRow.setAttribute('role', 'tablist');
    const modeButtons = new Map();
    for (const m of MODES) {
        const b = button('rr-mode', m.label, m.hint, () => actions.setMode(m.id));
        b.setAttribute('role', 'tab');
        modeButtons.set(m.id, b);
        modeRow.appendChild(b);
    }
    main.appendChild(modeRow);

    /*
     * The timeline.
     *
     * This replaces a grid of 21+ chips, which was half the panel's height and
     * needed a careful visual scan to find "Solo 1". A strip proportional to
     * the song reads at a glance — you know roughly where the solo is in a
     * song even if you cannot name the section — and it gives drag-to-select
     * for free, which no arrangement of chips can.
     *
     * It draws no waveform. A waveform would mean fetching and decoding the
     * stem, which is expensive, duplicates work the player already did, and
     * adds nothing: the useful signal here is not amplitude, it is where the
     * sections are and how well you play them.
     */
    const timeline = el('div', 'rr-timeline');
    timeline.setAttribute('role', 'group');
    timeline.setAttribute('aria-label', 'Song timeline — click a section, or drag for a custom range');
    timeline.title = 'Click a section. Drag across for a custom range, snapped to bar lines.';
    const tlBlocks = el('div', 'rr-tl-blocks');
    const tlSel = el('div', 'rr-tl-sel');
    const tlHead = el('div', 'rr-tl-head');
    timeline.appendChild(tlBlocks);
    timeline.appendChild(tlSel);
    timeline.appendChild(tlHead);
    main.appendChild(timeline);
    let blockSignature = '';
    const blockNodes = new Map();

    // The same navigation without a mouse, and the selection's name.
    const navRow = el('div', 'rr-row rr-nav');
    const navPrev = button('rr-step', '◀', 'Previous section', () => actions.stepSection(-1));
    const navName = el('span', 'rr-nav-name');
    const navNext = button('rr-step', '▶', 'Next section', () => actions.stepSection(1));
    navRow.appendChild(navPrev);
    navRow.appendChild(navName);
    navRow.appendChild(navNext);
    navRow.appendChild(kbd(', .'));
    main.appendChild(navRow);

    // phrase stepper
    const partRow = el('div', 'rr-row rr-parts');
    const partPrev = button('rr-step', '◀', 'Previous phrase', () => actions.stepPart(-1));
    const partLabel = el('span', 'rr-part-label');
    const partNext = button('rr-step', '▶', 'Next phrase', () => actions.stepPart(1));
    partRow.appendChild(partPrev);
    partRow.appendChild(partLabel);
    partRow.appendChild(partNext);
    main.appendChild(partRow);

    // bar picker
    const barsRow = el('div', 'rr-row rr-bars');
    barsRow.appendChild(el('span', 'rr-mini', 'Bars'));
    const barMinus = button('rr-step', '−', 'One bar fewer', () => actions.setBarCount(actions.barCount() - 1));
    const barCount = el('span', 'rr-count');
    const barPlus = button('rr-step', '+', 'One bar more', () => actions.setBarCount(actions.barCount() + 1));
    barsRow.appendChild(barMinus);
    barsRow.appendChild(barCount);
    barsRow.appendChild(barPlus);
    barsRow.appendChild(button('rr-btn rr-btn-quiet', 'From playhead',
        'Take that many bars starting at the bar under the playhead',
        () => actions.barsAtPlayhead()));
    main.appendChild(barsRow);

    // the chosen range, and its edges
    const readout = el('div', 'rr-readout');
    const readoutLabel = el('span', 'rr-readout-label');
    const readoutMeta = el('span', 'rr-readout-meta');
    readout.appendChild(readoutLabel);
    readout.appendChild(readoutMeta);
    main.appendChild(readout);

    const trim = el('div', 'rr-row rr-trim');
    trim.title = 'Move a loop edge by one whole bar. Bars, not seconds: a boundary '
        + 'off the grid turns the count-in into a guess.';
    trim.appendChild(el('span', 'rr-mini', 'Trim'));
    trim.appendChild(button('rr-step', '−', 'Start one bar earlier', () => actions.nudge('start', -1)));
    const trimStart = el('span', 'rr-time');
    trim.appendChild(trimStart);
    trim.appendChild(button('rr-step', '+', 'Start one bar later', () => actions.nudge('start', 1)));
    trim.appendChild(el('span', 'rr-arrow', '→'));
    trim.appendChild(button('rr-step', '−', 'End one bar earlier', () => actions.nudge('end', -1)));
    const trimEnd = el('span', 'rr-time');
    trim.appendChild(trimEnd);
    trim.appendChild(button('rr-step', '+', 'End one bar later', () => actions.nudge('end', 1)));
    main.appendChild(trim);

    // ── how to drill ─────────────────────────────────────────────────────
    main.appendChild(el('h4', 'rr-legend', 'How to drill'));

    /*
     * "Climb", not "Ladder" — and a chip group, not a rail of pills.
     *
     * The label is the fix for the review's sharpest point: this row and the
     * playback-speed row carried the same five numbers with no way to tell
     * which was which. This one is the set of speeds a drill CLIMBS; the other
     * is the speed the song plays at NOW. Different words, different control
     * family, and a badge that explains the slow end.
     */
    const ladderRow = el('div', 'rr-row rr-ladder');
    ladderRow.appendChild(el('span', 'rr-mini', 'Climb'));
    const ladderTrack = el('div', 'rr-track');
    const ladderButtons = new Map();
    for (const p of PRESETS) {
        const b = button('rr-rung', String(p), null, () => actions.toggleRung(p));
        ladderButtons.set(p, b);
        ladderTrack.appendChild(b);
    }
    ladderRow.appendChild(ladderTrack);
    const stretchBadge = el('span', 'rr-badge rr-badge-warn', '⚠');
    stretchBadge.title = `Below ${STRETCH_WARN_PCT}% the backing track is audibly `
        + 'time-stretched. Worth it for a passage you cannot play yet; not worth leaving on.';
    ladderRow.appendChild(stretchBadge);
    main.appendChild(ladderRow);

    // Goal and the widen switch share a row: two settings, no prose, one line.
    const goalRow = el('div', 'rr-row rr-goal');
    goalRow.appendChild(el('span', 'rr-mini', 'Goal'));
    const goalDown = button('rr-step', '−', 'Lower the goal by 5%', () => actions.nudgeGoal(-GOAL_STEP));
    const goalValue = el('span', 'rr-value');
    const goalUp = button('rr-step', '+', 'Raise the goal by 5%', () => actions.nudgeGoal(GOAL_STEP));
    goalRow.appendChild(goalDown);
    goalRow.appendChild(goalValue);
    goalRow.appendChild(goalUp);

    const widen = toggle('Widen',
        'Once the passage is clean, grow the loop by a bar each side (up to two) '
        + 'so it goes back into its surroundings before you leave it.',
        (on) => actions.setWiden(on));
    widen.wrap.classList.add('rr-push');
    goalRow.appendChild(widen.wrap);
    main.appendChild(goalRow);

    // ── actions ──────────────────────────────────────────────────────────
    /*
     * The primary gets its own line. In 0.2 it shared a row with two other
     * buttons and a reviewer reported it as reading weaker than the mode tabs
     * above it — which it did, at a third of the width with two siblings.
     */
    const primaryRow = el('div', 'rr-row rr-acts-primary');
    const startBtn = button('rr-btn rr-btn-primary', null, null, () => actions.startDrill());
    const startDot = el('span', 'rr-dot');
    startBtn.appendChild(startDot);
    startBtn.appendChild(el('span', null, '⏱ Start drill'));
    startBtn.appendChild(kbd('D'));
    const endBtn = button('rr-btn rr-btn-danger', null, 'Stop the drill and restore your speed',
        () => actions.endDrill());
    endBtn.appendChild(el('span', null, '✕ End drill'));
    endBtn.appendChild(kbd('D'));
    primaryRow.appendChild(startBtn);
    primaryRow.appendChild(endBtn);
    main.appendChild(primaryRow);

    const acts = el('div', 'rr-row rr-acts');
    const loopBtn = button('rr-btn rr-btn-small', 'Loop only',
        'Loop the passage with no goal and no ramp', () => actions.loopOnly());
    const clearBtn = button('rr-btn rr-btn-small rr-btn-quiet', 'Clear',
        'Drop the loop and play on', () => actions.clearLoop());
    acts.appendChild(loopBtn);
    acts.appendChild(clearBtn);
    main.appendChild(acts);

    /*
     * The one imperative surface in the panel, and the one exception to
     * "reads only the snapshot".
     *
     * It carries the reason an action just FAILED — a range the engine
     * refused, a throw — which is an event, not a state, and therefore not
     * something a snapshot can hold. Reasons an action is *blocked* are not
     * here: those live on the disabled control's own tooltip.
     */
    const flash = el('p', 'rr-flash');
    flash.hidden = true;
    main.appendChild(flash);
    let flashTimer = null;

    // ── live drill ───────────────────────────────────────────────────────
    const live = el('div', 'rr-live');
    const liveStatus = el('div', 'rr-live-status');
    const liveNext = el('div', 'rr-live-next');
    const liveFocus = el('div', 'rr-live-focus');
    const liveIters = el('div', 'rr-iters');
    live.appendChild(liveStatus);
    live.appendChild(liveNext);
    live.appendChild(liveFocus);
    live.appendChild(liveIters);
    main.appendChild(live);

    // ── play at ──────────────────────────────────────────────────────────
    main.appendChild(el('h4', 'rr-legend', 'Play at'));

    /*
     * A segmented control, because this is "pick one" — the speed the song is
     * playing at right now. The drill's ladder above is "pick a subset". Same
     * numbers, different question, and now different shapes.
     */
    const speedRow = el('div', 'rr-row rr-speed');
    const speedSeg = el('div', 'rr-seg');
    speedSeg.setAttribute('role', 'group');
    speedSeg.setAttribute('aria-label', 'Playback speed');
    const speedButtons = new Map();
    for (const p of PRESETS) {
        const b = button('rr-seg-btn', String(p), `Play at ${p}% of tempo`, () => actions.setSpeed(p));
        speedButtons.set(p, b);
        speedSeg.appendChild(b);
    }
    speedRow.appendChild(speedSeg);
    speedRow.appendChild(kbd('↑ ↓'));
    main.appendChild(speedRow);

    const diffRow = el('div', 'rr-row rr-diff');
    diffRow.title = 'Master difficulty. Lower thins the chart to the easier tiers the '
        + 'pack was authored with; 100% is the full arrangement.';
    diffRow.appendChild(el('span', 'rr-mini', 'Difficulty'));
    const diffInput = document.createElement('input');
    diffInput.type = 'range';
    diffInput.min = '0';
    diffInput.max = '100';
    diffInput.step = '5';
    diffInput.className = 'rr-range';
    diffInput.setAttribute('aria-label', 'Master difficulty');
    diffInput.addEventListener('input', () => {
        diffValue.textContent = diffInput.value + '%';
        actions.setDifficulty(Number(diffInput.value));
    });
    const diffValue = el('span', 'rr-count');
    diffRow.appendChild(diffInput);
    diffRow.appendChild(diffValue);
    main.appendChild(diffRow);

    // Only ever drawn when it explains a control that is not working.
    const diffNote = el('p', 'rr-note');
    main.appendChild(diffNote);

    // ── the map ──────────────────────────────────────────────────────────
    const mapHead = el('div', 'rr-legend-row');
    mapHead.appendChild(el('h4', 'rr-legend', 'Where you struggle'));
    const weakestBtn = button('rr-btn rr-btn-small rr-push', 'Practice weakest',
        'Select the passage you play worst and arm a drill on it',
        () => actions.practiceWeakest());
    mapHead.appendChild(weakestBtn);
    main.appendChild(mapHead);
    const runLine = el('p', 'rr-note');
    main.appendChild(runLine);
    const weak = el('div', 'rr-weak');
    main.appendChild(weak);

    // ── the timeline's pointer handling ──────────────────────────────────

    let dragFrom = null;      // { x, t } where the pointer went down
    let dragging = false;
    let lastSnap = null;      // the model's duration, cached for x -> time

    function timeAtX(clientX) {
        const r = timeline.getBoundingClientRect();
        if (!r.width || !Number.isFinite(lastSnap) || lastSnap <= 0) return NaN;
        const frac = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
        return frac * lastSnap;
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
        // Resolved from the TIME, not from the clicked element. Reading
        // `e.target.closest('.rr-tl-block')` needed the pointer to land on a
        // block, so a click on the hairline between two of them fell through
        // to a one-bar range instead of the section — and the same happened
        // for any click that did not originate on a block.
        if (Number.isFinite(from.t)) actions.selectAtTime(from.t);
    }

    timeline.addEventListener('pointerup', endDrag);
    timeline.addEventListener('pointercancel', endDrag);

    // ── render ───────────────────────────────────────────────────────────

    function renderTimeline(snap) {
        lastSnap = snap.duration;
        const dur = snap.duration;
        if (!Number.isFinite(dur) || dur <= 0) {
            timeline.hidden = true;
            return;
        }
        timeline.hidden = snap.mode === 'bars' ? false : false;

        const signature = snap.sections.map((s) => s.key).join('|');
        if (signature !== blockSignature) {
            blockSignature = signature;
            tlBlocks.textContent = '';
            blockNodes.clear();
            for (const s of snap.sections) {
                const b = el('div', 'rr-tl-block');
                b.dataset.key = s.key;
                b.style.left = ((s.start / dur) * 100) + '%';
                b.style.width = (((s.end - s.start) / dur) * 100) + '%';
                blockNodes.set(s.key, b);
                tlBlocks.appendChild(b);
            }
        }

        for (const s of snap.sections) {
            const node = blockNodes.get(s.key);
            if (!node) continue;
            const acc = Number.isFinite(s.runAccuracy) ? s.runAccuracy : s.best;
            node.dataset.band = Number.isFinite(acc) ? band(acc) : 'none';
            node.classList.toggle('rr-tl-block-on', snap.mode !== 'bars' && s.key === snap.sectionKey);
            node.classList.toggle('rr-tl-block-done', !!s.graduated);
            const bits = [s.label, `${clock(s.start)} → ${clock(s.end)}`];
            if (Number.isFinite(acc)) bits.push(`best ${pct(acc)}`);
            if (Number.isFinite(s.events)) bits.push(`${s.events} notes`);
            node.title = bits.join(' · ');
        }

        const sel = snap.selection;
        if (sel) {
            tlSel.hidden = false;
            tlSel.style.left = ((sel.start / dur) * 100) + '%';
            tlSel.style.width = (Math.max(0.4, ((sel.end - sel.start) / dur) * 100)) + '%';
        } else {
            tlSel.hidden = true;
        }

        const t = snap.playhead;
        if (Number.isFinite(t) && t >= 0) {
            tlHead.hidden = false;
            tlHead.style.left = (Math.min(100, (t / dur) * 100)) + '%';
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
    function renderLadder(snap) {
        const running = snap.drill.active;
        const chosen = snap.settings.ladder || [];
        const engine = running ? (snap.drill.ladderPct || []) : [];
        const nowPct = running ? engine[snap.drill.rung] : null;

        for (const [p, b] of ladderButtons) {
            const inLadder = running ? engine.includes(p) : (p === 100 || chosen.includes(p));
            const isNow = running && p === nowPct;
            const cleared = running && inLadder && Number.isFinite(nowPct) && p < nowPct;

            b.classList.toggle('rr-rung-on', inLadder && !isNow && !cleared);
            b.classList.toggle('rr-rung-now', !!isNow);
            b.classList.toggle('rr-rung-done', !!cleared);
            b.disabled = running || p === 100;
            b.title = running
                ? (isNow ? `Playing at ${p}% — clear the goal to move up`
                    : (cleared ? `Cleared at ${p}%` : (inLadder ? `Still to come: ${p}%` : 'Not in this drill')))
                : (p === 100
                    ? 'A drill always finishes at full tempo'
                    : `${p}% of tempo — click to ${inLadder ? 'drop' : 'add'} this rung`);
        }
        ladderTrack.title = running
            ? 'The ladder this drill is climbing.'
            : `The speeds a drill climbs. A cleared goal steps up one; ${snap.drill.reps || 3} clean passes at full tempo finish it.`;
    }

    function renderIterations(snap) {
        liveIters.textContent = '';
        if (!snap.drill.active) return;
        const list = snap.iterations.slice(-8);
        if (!list.length && !snap.current) {
            liveIters.appendChild(el('span', 'rr-note', 'Play the loop — the first pass has not been scored yet.'));
            return;
        }
        for (const it of list) {
            const cell = el('span', 'rr-iter');
            const acc = Number.isFinite(it.accuracyPct) ? it.accuracyPct / 100 : null;
            cell.dataset.band = Number.isFinite(acc) ? band(acc) : 'none';
            cell.textContent = Number.isFinite(it.accuracyPct) ? it.accuracyPct + '%' : '–';
            cell.title = `Pass ${it.idx + 1}: ${it.hits} hit, ${it.misses} missed`;
            liveIters.appendChild(cell);
        }
        if (snap.current && (snap.current.hits + snap.current.misses) > 0) {
            const cell = el('span', 'rr-iter rr-iter-now');
            cell.textContent = Number.isFinite(snap.current.accuracyPct) ? snap.current.accuracyPct + '%' : '–';
            cell.title = `This pass so far: ${snap.current.hits} hit, ${snap.current.misses} missed`;
            liveIters.appendChild(cell);
        }
    }

    function renderWeak(snap) {
        weak.textContent = '';
        if (!snap.weakest.length) {
            weak.appendChild(el('p', 'rr-note',
                'Nothing measured yet. Play with note detection on and the sections you '
                + 'struggle with will collect a number here.'));
            return;
        }
        for (const row of snap.weakest) {
            const line = el('button', 'rr-weak-row');
            line.type = 'button';
            line.addEventListener('click', () => actions.selectSection(row.key));
            const bar = el('span', 'rr-weak-bar');
            bar.dataset.band = band(row.accuracy);
            bar.style.setProperty('--rr-fill', Math.round(row.accuracy * 100) + '%');
            line.appendChild(el('span', 'rr-weak-name', row.label));
            line.appendChild(bar);
            line.appendChild(el('span', 'rr-weak-pct', pct(row.accuracy)));
            line.title = row.live
                ? `${row.label} — ${pct(row.accuracy)} on this run. Click to select it.`
                : (row.graduated
                    ? `${row.label} — graduated a drill at ${pct(row.accuracy)}. Click to select it.`
                    : `${row.label} — ${pct(row.accuracy)} over ${row.plays} attempt${row.plays === 1 ? '' : 's'}. Click to select it.`);
            if (row.live) line.appendChild(el('span', 'rr-live-dot', '•'));
            weak.appendChild(line);
        }
    }

    function render(snap) {
        songLabel.textContent = snap.songTitle || '';

        if (!snap.ready) {
            empty.hidden = false;
            main.hidden = true;
            empty.textContent = 'Open a song to pick a passage. The chart has to be loaded before there is anything to loop.';
            return;
        }
        empty.hidden = true;
        main.hidden = false;

        // mode
        for (const [id, b] of modeButtons) {
            b.classList.toggle('rr-mode-on', snap.mode === id);
            b.setAttribute('aria-selected', snap.mode === id ? 'true' : 'false');
        }
        partRow.hidden = snap.mode !== 'part';
        barsRow.hidden = snap.mode !== 'bars';

        renderTimeline(snap);

        // the section stepper doubles as the selection's name
        const current = snap.sections.find((s) => s.key === snap.sectionKey);
        const at = snap.sections.indexOf(current);
        navName.textContent = current ? current.label : '—';
        navPrev.disabled = at <= 0;
        navNext.disabled = at < 0 || at >= snap.sections.length - 1;

        // phrases
        if (snap.mode === 'part') {
            partLabel.textContent = snap.partCount
                ? `Part ${snap.partIndex + 1} of ${snap.partCount}`
                : 'No phrase data';
            partPrev.disabled = snap.partIndex <= 0;
            partNext.disabled = snap.partIndex >= snap.partCount - 1;
        }

        // bars
        if (snap.mode === 'bars') {
            barCount.textContent = String(snap.bars.count);
            const noBars = !snap.bars.available;
            barMinus.disabled = noBars || snap.bars.count <= 1;
            barPlus.disabled = noBars;
            barsRow.title = noBars
                ? 'This chart carries no bar lines, so bar ranges are unavailable.'
                : 'How many bars to take, starting at the bar under the playhead.';
        }

        // the chosen range
        const sel = snap.selection;
        readoutLabel.textContent = sel ? sel.label : 'Nothing selected';
        if (sel) {
            const len = Math.max(0, sel.end - sel.start);
            const bits = [`${clock(sel.start)} → ${clock(sel.end)}`, `${len.toFixed(1)}s`];
            if (Number.isFinite(sel.events)) bits.push(`${sel.events} notes`);
            if (Number.isFinite(sel.best)) bits.push(`best ${pct(sel.best)}`);
            readoutMeta.textContent = bits.join(' · ');
            trimStart.textContent = clock(sel.start);
            trimEnd.textContent = clock(sel.end);
        } else {
            readoutMeta.textContent = '';
            trimStart.textContent = '–';
            trimEnd.textContent = '–';
        }
        for (const b of trim.querySelectorAll('button')) b.disabled = !sel || snap.drill.active;

        // the ladder and the goal
        renderLadder(snap);
        const goal = snap.drill.active && Number.isFinite(snap.drill.goalPct)
            ? snap.drill.goalPct
            : snap.settings.goalPct;
        goalValue.textContent = goal + '%';
        goalDown.disabled = snap.drill.active || goal <= GOAL_MIN;
        goalUp.disabled = snap.drill.active || goal >= GOAL_MAX;
        widen.input.checked = !!snap.settings.widen;
        widen.input.disabled = snap.drill.active;
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
        for (const [p, b] of speedButtons) {
            b.classList.toggle('rr-seg-btn-on', Math.abs(snap.speedPct - p) < 3);
            b.disabled = snap.drill.active;
        }
        speedSeg.title = snap.drill.active
            ? 'The drill owns the speed while it runs.'
            : 'The speed the song is playing at now.';
        if (document.activeElement !== diffInput) diffInput.value = String(snap.difficultyPct);
        diffValue.textContent = snap.difficultyPct + '%';
        diffInput.disabled = !snap.hasPhraseData || snap.drill.active;

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
        runLine.textContent = Number.isFinite(run.accuracy)
            ? `This run: ${pct(run.accuracy)} over ${run.hits + run.misses} judged notes.${snap.paused ? ' Paused — the drill is measuring instead.' : ''}`
            : 'This run: nothing judged yet.';
        renderWeak(snap);
    }

    /** Show why something just failed. Clears itself; render() never touches it. */
    function say(text) {
        if (!text) return;
        flash.textContent = text;
        flash.hidden = false;
        if (flashTimer) clearTimeout(flashTimer);
        flashTimer = setTimeout(() => {
            flash.hidden = true;
            flash.textContent = '';
            flashTimer = null;
        }, 6000);
    }

    return { root, render, say };
}
