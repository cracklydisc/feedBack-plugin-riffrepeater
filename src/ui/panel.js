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
import { PRESETS, STRETCH_WARN_PCT, GOAL_MIN_PCT, GOAL_MAX_PCT, statusLine, nextStepLine } from '../ladder.js';
import { clock } from '../ranges.js';

/** A drag has to travel this far before it stops being a click. */
const DRAG_SLOP_PX = 4;

/**
 * The smallest click target a section gets, however thin its block is.
 *
 * 11px is a little under a fingertip and comfortably over a mouse's aim. Wider
 * would start stealing clicks from the big sections either side of a thin one.
 */
const MIN_HIT_PX = 11;

/**
 * A selection that exists but has nothing in it.
 *
 * Separate from `selectionUsable`, which is also false when nothing is
 * selected at all — the two states need different sentences, and conflating
 * them is why a chosen passage was reported as "pick a passage first".
 */
function emptySelection(snap) {
    return !!snap.selection && c.num(snap.selection.events) === 0;
}

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

    /*
     * Click targets, separate from the fill.
     *
     * THE FILL HAS TO STAY HONEST: the strip is a map, so a section's width is
     * its share of the song and nothing else. But on a real chart that makes
     * it unclickable — Blackened has 21 sections in 306px, and NINE of them
     * come out under 10px wide. The smallest, "Outro 1", is 1.9px and has 14
     * notes in it: a legitimate thing to drill that you cannot hit.
     *
     * So the geometry and the hit test are two different things. Every section
     * gets a target at least MIN_HIT_PX wide, grown symmetrically about its
     * own centre, and a click picks the target whose CENTRE is nearest. A big
     * section keeps everything except the few pixels closest to a tiny
     * neighbour's middle; the tiny one becomes reachable. Nothing moves on
     * screen.
     */
    let hits = [];      // [{ key, centre, from, to }] in px, left to right

    /*
     * How much of the section — the whole thing, or one phrase inside it.
     *
     * This replaced the three mode tabs, and the reason they could go is that
     * position zero here is the WHOLE section: a step left from part 1 hands
     * it back, so nothing needs a control saying "actually, all of it".
     *
     * The tabs were a switch whose `Section` side gated no controls at all,
     * whose `Bars` side gated a setting that lives on the settings page plus a
     * button that duplicated `A`, and which seven different gestures wrote to
     * anyway — so it mostly reported the last thing you did rather than
     * commanding anything.
     */
    const partRow = c.el('div', 'fbk-row rr-parts');
    const partPrev = c.button('fbk-step', '◀', 'The whole section', () => actions.stepPart(-1));
    const partLabel = c.el('span', 'rr-nav-name');
    const partNext = c.button('fbk-step', '▶', 'The next phrase inside it', () => actions.stepPart(1));
    partRow.appendChild(partPrev);
    partRow.appendChild(partLabel);
    partRow.appendChild(partNext);
    body.appendChild(partRow);

    /*
     * The plate, flanked by the section stepper.
     *
     * These were two rows: a stepper carrying the section's name, then a plate
     * whose title was the section's name. The name was printed twice, four
     * rows apart, and the second row existed to hold the duplicate. One row
     * now — the chevrons step, the plate says what you are on, and it is the
     * only place that says it.
     */
    const pick = c.el('div', 'fbk-row fbk-row-tight fbk-row-nowrap rr-pick');
    const navPrev = c.button('fbk-btn fbk-btn-quiet rr-chev', '‹',
        'Previous section — the , key', () => actions.stepSection(-1));
    const plate = c.plate();
    const navNext = c.button('fbk-btn fbk-btn-quiet rr-chev', '›',
        'Next section — the . key', () => actions.stepSection(1));
    pick.appendChild(navPrev);
    pick.appendChild(plate.el);
    pick.appendChild(navNext);
    body.appendChild(pick);

    /*
     * The loop's two edges, in one row and with no label.
     *
     * This was two rows and two labels — MARK, for putting an edge at the
     * playhead, and TRIM, for nudging one by a bar — which are the same job
     * from two directions. One row now: A and B set an edge from where the
     * song is, and the steppers either side of each time move it a bar.
     *
     * No label, because the plate directly above already reads "1:24 → 1:39",
     * and no arrow glyph between the halves for the same reason. A and B are
     * the app's own names for these two points, so the letters carry it.
     */
    const trim = c.el('div', 'fbk-row rr-trim');
    trim.title = 'A and B put an edge at the playhead; the steppers move one by a whole bar. '
        + 'Bars, not seconds: a boundary off the grid turns the count-in into a guess.';
    const markA = c.button('fbk-step rr-mark', 'A',
        'Set the loop start (A) at the playhead — the I key',
        () => actions.markEdge('start'));
    const trimStart = c.el('span', 'rr-time');
    const markB = c.button('fbk-step rr-mark', 'B',
        'Set the loop end (B) at the playhead — the O key',
        () => actions.markEdge('end'));
    const trimEnd = c.el('span', 'rr-time');
    trim.appendChild(markA);
    trim.appendChild(c.button('fbk-step', '−', 'Start one bar earlier', () => actions.nudge('start', -1)));
    trim.appendChild(trimStart);
    trim.appendChild(c.button('fbk-step', '+', 'Start one bar later', () => actions.nudge('start', 1)));
    trim.appendChild(c.el('span', 'fbk-push'));
    trim.appendChild(c.button('fbk-step', '−', 'End one bar earlier', () => actions.nudge('end', -1)));
    trim.appendChild(trimEnd);
    trim.appendChild(c.button('fbk-step', '+', 'End one bar later', () => actions.nudge('end', 1)));
    trim.appendChild(markB);
    body.appendChild(trim);

    /* ── how you drill ────────────────────────────────────────────────────
     *
     * A FOLD, not a section, and the tense of the heading changed with it:
     * "how TO drill" reads as an instruction for the passage you just picked,
     * "how YOU drill" as a preference. It is the second one, and that was a
     * real defect rather than a wording quibble — every control in here goes
     * `model.setSettings` → `store.setSettings` → localStorage, so lowering
     * the ladder for one solo lowered it for every passage of every song,
     * signalled by nothing but a chip that stayed lit. Kit DESIGN.md §15.
     *
     * Folded, because the panel exists to pick a passage and press start;
     * these are set once and lived with. The summary keeps the value on screen
     * so nothing is hidden — you can read the ladder without opening it — and
     * the scope note replaces the summary the moment you open it, which is the
     * only moment you need telling.
     */
    const how = c.fold({
        title: 'How you drill',
        ariaLabel: 'How you drill — settings for every passage',
    });
    how.head.title = 'The ladder and the goal. These are preferences: they apply to '
        + 'every passage of every song, not just the one selected.';
    /*
     * Repaint the head the instant it is toggled, rather than waiting for the
     * next tick — the summary and the scope note swap on open, and half a
     * second of the wrong one is half a second of the panel lying about what
     * you are looking at. This listener is added AFTER the kit's own, so
     * `isOpen()` already reports the new state by the time it runs.
     */
    how.head.addEventListener('click', () => {
        if (lastSnap) renderHow(lastSnap);
    });
    body.appendChild(how.el);

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
    how.body.appendChild(climbRow);

    /*
     * The goal, and — since 0.7.0 — the widen switch beside it again, but
     * inside the fold rather than in the panel's default view.
     *
     * `Widen` is the clearest case of the §15 defect: a boolean you set once
     * about how a drill finishes, which sat two rows under the passage you had
     * just picked and looked like part of it.
     */
    const goalRow = c.el('div', 'fbk-row rr-goal');
    goalRow.appendChild(c.el('span', 'fbk-label fbk-label-inline', 'Goal'));
    const goal = c.stepper({
        value: 85,
        step: 5,
        min: GOAL_MIN_PCT,
        max: GOAL_MAX_PCT,
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
    how.body.appendChild(goalRow);

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

    /*
     * Why the three controls above are dead, next to the controls above.
     *
     * A note under the difficulty slider four rows down would be a sentence
     * about the passage filed under the chart, and `diffNote` already had a
     * job. The rule is that a `.fbk-note` explains a control that is not
     * working (DESIGN.md, Structure) — so it goes where the control is.
     */
    const deadNote = c.el('p', 'fbk-note');
    body.appendChild(deadNote);

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
        PRESETS.map((p) => ({ value: p, label: String(p), title: `Play at ${p}% of tempo — the ↑ and ↓ keys step 5%` })),
        (p) => actions.setSpeed(p),
        'Playback speed',
    );
    speedRow.appendChild(speed.el);
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
        // A click, not a drag. Resolved through the hit table rather than by
        // the element under the pointer: `e.target.closest('.rr-tl-block')`
        // needed the pointer to land on a block, which for a 1.9px block is
        // not a thing a person can do.
        const key = hitAt(from.x);
        if (key) actions.selectSection(key);
        else if (Number.isFinite(from.t)) actions.selectAtTime(from.t);
    }

    timeline.addEventListener('pointerup', endDrag);
    timeline.addEventListener('pointercancel', endDrag);

    /**
     * Which section a click at this x belongs to.
     *
     * Among the targets containing x, the nearest centre wins — that is what
     * lets an expanded thin target sit inside a wide neighbour without
     * swallowing it. Falling back to the nearest centre overall keeps a click
     * in the strip's dead margins from doing nothing.
     */
    function hitAt(clientX) {
        if (!hits.length) return null;
        const x = clientX - timeline.getBoundingClientRect().left;
        let best = null;
        let bestDist = Infinity;
        for (const h of hits) {
            if (x < h.from || x > h.to) continue;
            const d = Math.abs(x - h.centre);
            if (d < bestDist) { bestDist = d; best = h; }
        }
        if (best) return best.key;
        for (const h of hits) {
            const d = Math.abs(x - h.centre);
            if (d < bestDist) { bestDist = d; best = h; }
        }
        return best ? best.key : null;
    }

    /*
     * Naming what is under the cursor.
     *
     * A 2px block is reachable now but still invisible, so there is no way to
     * know it is there. Sweeping the strip names whatever the hit test would
     * choose, in the plate, which turns the timeline into something you scrub
     * rather than something you have to aim at. The plate goes back to the
     * selection on the way out.
     */
    let hoverKey = null;
    let lastSnap = null;

    timeline.addEventListener('pointermove', (e) => {
        if (dragFrom) return;                  // a drag has its own feedback
        const key = hitAt(e.clientX);
        if (key === hoverKey) return;
        hoverKey = key;
        paintPlate();
    });

    timeline.addEventListener('pointerleave', () => {
        if (hoverKey === null) return;
        hoverKey = null;
        paintPlate();
    });

    /**
     * The plate shows the hovered section while the pointer is on the strip,
     * and the selection otherwise.
     *
     * The border goes quiet during a preview, so "this is what you would get"
     * never reads as "this is what you have".
     */
    function paintPlate() {
        const snap = lastSnap;
        if (!snap) return;
        const hovered = hoverKey && hoverKey !== snap.sectionKey
            ? snap.sections.find((sc) => sc.key === hoverKey)
            : null;
        const show = hovered || snap.selection;
        plate.el.classList.toggle('rr-plate-preview', !!hovered);
        if (!show) {
            plate.set('Nothing selected', '');
            return;
        }
        const len = Math.max(0, show.end - show.start);
        const bits = [`${clock(show.start)} → ${clock(show.end)}`, `${len.toFixed(1)}s`];
        if (c.num(show.events) !== null) bits.push(`${show.events} notes`);
        if (c.num(show.best) !== null) bits.push(`best ${pct(show.best)}`);
        plate.set(show.label, bits.join(' · '));
    }

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
            /*
             * A passage with no notes in it.
             *
             * `=== 0` and not a falsy check, because `s.events` is null until
             * the count has been taken — and `Number(null)` is 0, which is the
             * bug class this repository keeps meeting. Treating "not counted
             * yet" as "empty" would grey out the whole strip for one frame
             * after every arrangement change.
             */
            const empty = c.num(s.events) === 0;
            node.dataset.empty = empty ? 'true' : 'false';

            const bits = [s.label, `${clock(s.start)} → ${clock(s.end)}`];
            if (acc !== null) bits.push(`best ${pct(acc)}`);
            if (c.num(s.events) !== null) bits.push(`${s.events} notes`);
            if (empty) bits.push('nothing to drill here');
            node.title = bits.join(' · ');
        }

        /*
         * Rebuild the hit table on every render: the strip's width changes
         * with the window and the section set changes with the arrangement.
         *
         * A passage with NO NOTES is left out of it. It is still drawn — the
         * strip has to stay proportional to the song or it is not a map — but
         * it cannot be clicked, so its pixels fall to whichever real section
         * is nearest. Otherwise the strip's biggest affordance let you land on
         * a range where `Start drill`, `Loop only` and the trim are all dead
         * and the only explanation was the primary's tooltip saying you had
         * not picked a passage. A target that can only disappoint is worse
         * than no target: §12 says a thin section must be reachable, and this
         * is the other end of the same rule.
         */
        const stripW = timeline.getBoundingClientRect().width || 0;
        hits = snap.sections
            .filter((sc) => c.num(sc.events) !== 0)
            .map((sc) => {
                const l = (sc.start / duration) * stripW;
                const r = (sc.end / duration) * stripW;
                const centre = (l + r) / 2;
                const half = Math.max((r - l) / 2, MIN_HIT_PX / 2);
                return { key: sc.key, centre, from: centre - half, to: centre + half };
            });

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
    /*
     * The fold's head: the value while shut, the SCOPE while open.
     *
     * Shut, it has to answer exactly what the controls inside answer — a
     * summary that does not is a fold that hides rather than folds. So it
     * prints the ladder and the goal, and during a drill it prints the
     * engine's ladder instead of the stored one, because that is what is
     * actually happening.
     *
     * Open, it says who the settings belong to. That is the §15 defect stated
     * out loud, and this is the one moment it matters: you are about to change
     * something you will be living with on every passage of every song.
     */
    function renderHow(snap) {
        if (how.isOpen()) {
            how.setSummary(snap.drill.active
                ? 'the drill owns these while it runs'
                : 'applies to every passage, every song');
            return;
        }
        const running = snap.drill.active;
        const rungs = running
            ? (snap.drill.ladderPct || [])
            : (snap.settings.ladder || []);
        const goalPct = running && Number.isFinite(snap.drill.goalPct)
            ? snap.drill.goalPct
            : snap.settings.goalPct;
        /*
         * Tight, because it has to FIT.
         *
         * "65 → 80 → 90 → 100 · clean at 85%" is 33 characters and ellipsized
         * at 336px, and a summary that gets cut off is not a summary — it is
         * the worst of both worlds, since the value it exists to keep visible
         * is the half that disappears. No spaces around the arrows and "goal"
         * instead of "clean at" brings a five-rung ladder inside the width.
         */
        const ladderText = rungs.length ? rungs.join('→') : '100';
        how.setSummary(`${ladderText} · goal ${goalPct}%`);
    }

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
            /*
             * No `•` suffix any more.
             *
             * It marked "this number is from the current run, not storage" — a
             * 6px bullet on a row that already carries a name, a bar and a
             * percentage, and whose whole meaning lived in a per-row tooltip
             * that says it in words anyway ("on this run" against "over 2
             * attempts"). It was the `, .` key cap again: a glyph nobody can
             * decode, duplicating what is written next to it. And provenance
             * is not what this list is read for — you are here to find out
             * what to practise, and for that the number is the answer.
             */
            weak.appendChild(c.meterRow({
                label: row.label,
                value: row.accuracy * 100,
                band: c.band(row.accuracy),
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
        lastSnap = snap;
        empty.hidden = !!snap.ready;
        body.hidden = !snap.ready;
        if (!snap.ready) return;

        renderTimeline(snap);

        // the chevrons step through the sections; the plate says which one
        const current = snap.sections.find((s) => s.key === snap.sectionKey);
        const at = snap.sections.indexOf(current);
        navPrev.disabled = at <= 0;
        navNext.disabled = at < 0 || at >= snap.sections.length - 1;

        // whole section -> part 1 -> part 2 -> …, with zero being the whole
        const custom = snap.mode === 'bars';
        if (custom) {
            partLabel.textContent = 'Custom range';
        } else if (!snap.partCount) {
            partLabel.textContent = 'No phrase data';
        } else if (snap.onPart) {
            partLabel.textContent = `Part ${snap.partIndex + 1} of ${snap.partCount}`;
        } else {
            partLabel.textContent = snap.partCount > 1
                ? `Whole section · ${snap.partCount} phrases`
                : 'Whole section';
        }
        // Back is dead on the whole section; forward is dead on the last
        // phrase, and on a custom range neither applies until you pick a
        // section again.
        partPrev.disabled = custom || !snap.partCount || !snap.onPart;
        partNext.disabled = custom || !snap.partCount
            || (snap.onPart && snap.partIndex >= snap.partCount - 1);

        // the chosen range
        const sel = snap.selection;
        paintPlate();
        if (sel) {
            trimStart.textContent = clock(sel.start);
            trimEnd.textContent = clock(sel.end);
        } else {
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
        renderHow(snap);

        // actions
        const canDrill = snap.selectionUsable && !snap.engine.blocked;
        startBtn.hidden = snap.drill.active;
        endBtn.hidden = !snap.drill.active;
        startBtn.disabled = !canDrill;
        // The blocked reason lives ON the blocked control — no box for it.
        startBtn.title = snap.engine.blocked
            || (snap.selectionUsable
                ? 'Arm the drill on the chosen passage'
                : (emptySelection(snap)
                    ? 'This passage has no notes in it'
                    : 'Pick a passage first'));
        startDot.dataset.state = snap.engine.blocked ? (snap.engine.available ? 'warn' : 'off') : 'ready';
        // The one case where three controls go dead at once with nothing on
        // screen saying why — and the tooltip said "pick a passage first",
        // about a passage you had picked.
        const dead = emptySelection(snap);
        deadNote.hidden = !dead;
        deadNote.textContent = dead
            ? 'This passage has no notes in it, so there is nothing to drill.'
            : '';
        startDot.title = snap.engine.blocked || 'Note detection is live';
        loopBtn.disabled = !snap.selectionUsable || snap.drill.active;
        // Nothing to clear is not the same as nothing to do: a live button
        // whose click has no visible effect is the mode tabs' defect in
        // miniature (kit DESIGN.md §15).
        clearBtn.disabled = snap.drill.active || !snap.loopArmed;
        clearBtn.title = snap.loopArmed
            ? 'Drop the loop and play on'
            : 'No loop is armed';

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
