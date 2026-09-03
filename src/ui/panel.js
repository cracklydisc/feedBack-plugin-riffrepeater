/*
 * The panel's contents — three racks and a footswitch.
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
 * Nearly everything: the chassis, the racks and wells, the range strip with
 * its A/B handles, the climb rail, the LED meters, the list rows, the status
 * line, the footswitch and the folded strip. The rules behind them are in the
 * kit's DESIGN.md, and every one of them has a Riff Repeater version number
 * attached to the bug that taught it.
 *
 * What is left here is the WIRING: which snapshot field feeds which control,
 * and which action each control calls. That is the file core would rewrite,
 * and it is now the only file core would rewrite.
 */

import * as c from '../kit/controls.js';
import { STEPS, START_MIN_PCT, GOAL_MIN_PCT, GOAL_MAX_PCT, statusLine, nextStepLine } from '../ladder.js';
import { clock } from '../ranges.js';

/** The smallest tap target a block gets, however thin it is drawn (kit §12). */
const MIN_HIT_PX = 40;

/**
 * A selection that exists but has nothing in it.
 *
 * Separate from `selectionUsable`, which is also false when nothing is
 * selected at all — the two need different sentences, and conflating them is
 * why a chosen passage was once reported as "pick a passage first".
 */
function emptySelection(snap) {
    return !!snap.selection && c.num(snap.selection.events) === 0;
}

function pct(v) {
    const n = c.num(v);
    return n === null ? '–' : Math.round(n * 100) + '%';
}

/**
 * Fill a panel body and its footer, and return the `render(snapshot)` that
 * keeps them true.
 *
 * `actions` is the whole write surface: every control below calls into it and
 * nothing else. That is what makes the eventual core version a matter of
 * re-wiring one object.
 */
export function createContent(outer, actions, foot) {
    /*
     * Two children: the message for when there is nothing to control, and
     * everything else. Toggling one container beats hiding three racks, and it
     * means `render` has exactly one early return.
     */
    const empty = c.el('p', 'fbk-note',
        'Open a song to pick a passage. The chart has to be loaded before there '
        + 'is anything to loop.');
    const body = c.el('div', 'rr-main');
    outer.appendChild(empty);
    outer.appendChild(body);

    /*
     * Whether the edge readouts print tenths, read by their formatter.
     *
     * Declared UP HERE and not beside `edgeStepper`, because `let` has a
     * temporal dead zone and the formatter runs during construction: a
     * declaration next to the function it serves sat after the call site, and
     * the whole plugin failed to load with "Cannot access 'tenths' before
     * initialization" — a module-level throw, so nothing mounted at all.
     */
    let tenths = false;

    // ── RACK 1: the loop ─────────────────────────────────────────────────
    const loopRack = c.rack({ label: 'Loop' });
    body.appendChild(loopRack.el);

    /*
     * The unit switch, in the rack's header because it is set once.
     *
     * BARS is the default and TIME is the escape hatch, not the other way
     * round: a boundary off the bar grid turns the drill's count-in into a
     * guess, so the unit that can produce one is the one you have to ask for.
     */
    const unit = c.segmented(
        [
            { value: 'bars', label: 'BARS', title: 'Move an edge by one whole bar — the safe default' },
            { value: 'time', label: 'TIME', title: 'Move an edge by a tenth of a second, for a pickup that starts mid-bar' },
        ],
        (v) => actions.setUnit(v),
        'Nudge unit',
        { size: 'header' },
    );
    loopRack.header.appendChild(unit.el);

    /*
     * The strip: the ONLY loop selector.
     *
     * It replaced three mode tabs, two section chevrons, a phrase stepper and
     * two rows of edge steppers — all of which were ways of spelling out in
     * numbers the thing you wanted to point at. Kit DESIGN.md §22.
     */
    const strip = c.rangeStrip({
        minHit: MIN_HIT_PX,
        ariaLabel: 'Phrase timeline — tap a block to loop it, drag a handle to move an edge',
        onPick: (key) => actions.selectSection(key),
        onEdge: (edge, seconds) => actions.markEdgeAt(edge, seconds),
        onDrag: (a, b) => actions.selectDrag(a, b),
    });
    strip.el.title = 'Tap a block to loop it. Drag A or B to move an edge, or drag across for a custom range.';
    loopRack.body.appendChild(strip.el);

    /*
     * The two edges, as steppers, in the unit the header switch names.
     *
     * The strip does the coarse work; these do the one thing a pointer is bad
     * at, which is moving an edge by exactly one unit. The label names the
     * unit rather than a separate legend saying so — `A · ±1 bar` is the whole
     * explanation.
     */
    const edges = c.el('div', 'fbk-row fbk-row-nowrap rr-edges');
    const edgeA = edgeStepper('A', 'start', 'I');
    const edgeB = edgeStepper('B', 'end', 'O');
    edges.appendChild(edgeA.el);
    edges.appendChild(edgeB.el);
    loopRack.body.appendChild(edges);


    /*
     * An edge, as a kit stepper.
     *
     * It used to be a hand-rolled `.rr-edge` — a flat row of two buttons and a
     * readout — which is exactly the mistake that made the whole panel look
     * unlike the design: the parts were right and the OBJECT was missing. A
     * kit stepper is itself a well, its label sits inside it over the value,
     * and `A · ±1 bar` says both what the control is and what one press does.
     */
    function edgeStepper(letter, edge, key) {
        const st = c.stepper({
            label: `${letter} · ±1 bar`,
            value: 0,
            step: 1,
            unit: '',
            /*
             * The value is a TIME, so the readout formats it — and the format
             * changes with the unit switch, hence the closure over `tenths`
             * rather than a constant. Without this the readout would print
             * `3` for three seconds.
             */
            format: (v) => (tenths ? clock(v, 1) : clock(v)),
            downTitle: 'One unit earlier',
            upTitle: 'One unit later',
        });
        /*
         * The stepper's own `bump` walks a number; these edges are times the
         * model owns, so the buttons are rewired to the action and the readout
         * is written from the snapshot. `onChange` above is deliberately inert.
         */
        st.down.onclick = () => actions.nudge(edge, -1);
        st.up.onclick = () => actions.nudge(edge, 1);
        st.el.classList.add('rr-edge');
        st.el.title = `Put ${letter} at the playhead — the ${key} key`;
        return st;
    }

    // ── RACK 2: the drill ────────────────────────────────────────────────
    const drillRack = c.rack({ label: 'Speed' });
    body.appendChild(drillRack.el);

    /*
     * `Widen when clean` in the header, because it is set once and never mid
     * passage: once you clear the goal at full tempo the loop grows a bar each
     * side so you play the phrase back into the music around it.
     */
    const widen = c.toggle('Widen when clean',
        'Once you clear the goal at full speed, the loop grows by one bar each '
        + 'side (up to two) so you play the passage back into the music around '
        + 'it before the drill lets go.',
        (on) => actions.setWiden(on));
    drillRack.header.appendChild(widen.el);

    /*
     * START and GOAL: a speed and an ACCURACY, and the two hundreds are not
     * the same hundred.
     *
     * `start` is where the ladder begins; the top is always full tempo and has
     * no control, because a drill that never asks for the real tempo has not
     * taught the passage. `goal` is the share of notes a pass has to land to
     * climb a rung. Conflating them cost a rewrite — see src/ladder.js.
     *
     * START also sets the LIVE playback speed while no drill is running, which
     * is what became of the old `PLAY AT` row: the speed you want to practise
     * at and the speed a ladder starts from are the same number, and having
     * them as two controls was the ambiguity ("which speed wins?") that got
     * reported.
     */
    const setRow = c.el('div', 'fbk-row fbk-row-nowrap rr-set');
    const start = c.stepper({
        label: 'START',
        value: 80,
        step: 5,
        min: START_MIN_PCT,
        max: 100,
        unit: '%',
        emph: true,
        downTitle: 'Start 5% slower — this also sets the speed the song plays at now',
        upTitle: 'Start 5% faster — this also sets the speed the song plays at now',
        onChange: (v) => actions.setStart(v),
    });
    const goal = c.stepper({
        label: 'GOAL',
        value: 100,
        step: 5,
        min: GOAL_MIN_PCT,
        max: GOAL_MAX_PCT,
        unit: '%',
        downTitle: 'Accept 5% fewer clean notes per pass',
        upTitle: 'Demand 5% more clean notes per pass',
        onChange: (v) => actions.setGoal(v),
    });
    setRow.appendChild(start.el);
    setRow.appendChild(goal.el);
    drillRack.body.appendChild(setRow);

    /* How big a jump each cleared rung buys. Three values, so a segmented. */
    const stepField = c.field({ label: 'Step', tight: true });
    const stepSeg = c.segmented(
        STEPS.map((v) => ({ value: v, label: '+' + v, title: `Each cleared rung moves up ${v}%` })),
        (v) => actions.setStep(v),
        'Ladder step',
    );
    stepField.body.appendChild(stepSeg.el);
    drillRack.body.appendChild(stepField.el);

    /*
     * The rail, in a well because it takes no input.
     *
     * Its rungs derive from start and step, so a rail you could click would be
     * a fourth writer of a value the steppers above already own — kit
     * DESIGN.md §21. Being unpressable is what lets it be dense: five rungs,
     * their labels, their states and a progress fill in one 40px row.
     */
    const climbWell = c.well();
    const climbHead = c.el('div', 'fbk-rack-head rr-climb-head');
    const climbLabel = c.el('h4', 'fbk-rack-label rr-climb-label', 'Climb');
    const climbNote = c.el('span', 'fbk-rack-aside rr-climb-note');
    climbHead.appendChild(climbLabel);
    climbHead.appendChild(climbNote);
    const climb = c.rail({ ariaLabel: 'The speeds this drill climbs' });
    climbWell.appendChild(climbHead);
    climbWell.appendChild(climb.el);
    drillRack.body.appendChild(climbWell);

    /* Master difficulty — the host's own slider is two clicks away behind a
       rail popover, which is what earns this duplicate its place. */
    /*
 * `Chart`, not `Difficulty`.
 *
 * It thins the chart to the easier tiers the pack was authored with, and
 * "difficulty" collides with the drill's own — the GOAL is a difficulty too.
 * One word, one meaning.
 */
    const diffField = c.field({ label: 'Chart' });
    const difficulty = c.slider({
        min: 0,
        max: 100,
        step: 5,
        unit: '%',
        ariaLabel: 'Master difficulty',
        onInput: (v) => actions.setDifficulty(v),
    });
    diffField.el.title = 'Master difficulty. Lower thins the chart to the easier tiers the '
        + 'pack was authored with; 100% is the full arrangement.';
    diffField.body.appendChild(difficulty.el);
    drillRack.body.appendChild(diffField.el);

    const diffNote = c.el('p', 'fbk-note');
    drillRack.body.appendChild(diffNote);

    // ── RACK 3: where you struggle ───────────────────────────────────────
    const weakRack = c.rack({ label: 'Weak spots' });
    body.appendChild(weakRack.el);
    const weak = c.el('div', 'rr-weak');
    weakRack.body.appendChild(weak);

    const weakActs = c.el('div', 'fbk-row fbk-row-tight fbk-row-nowrap rr-weakacts');
    const weakestBtn = c.button('fbk-btn fbk-btn-accent rr-weakest', 'Loop weakest ›',
        'Select the passage you play worst and arm a drill on it',
        () => actions.practiceWeakest());
    const moreBtn = c.button('fbk-btn fbk-btn-quiet rr-more', 'All 5 ⌄',
        'Show every passage with a number', () => { showAll = !showAll; if (lastSnap) renderWeak(lastSnap); });
    weakActs.appendChild(weakestBtn);
    weakActs.appendChild(moreBtn);
    weakRack.body.appendChild(weakActs);

    let showAll = false;

    // ── the footer: the status line, then the footswitch ─────────────────
    /*
     * The status line ABOVE the footswitch, because it explains it.
     *
     * It used to sit two rows lower, under an alternative action, and the
     * report was "start drill is disabled and I can't tell why" — with the
     * sentence already on screen. And it is silent when everything is fine:
     * "note detection on" is a signal that carries nothing (kit §16).
     */
    const status = c.statusLine();
    foot.appendChild(status.el);

    const actionRow = c.el('div', 'fbk-row fbk-row-tight fbk-row-nowrap rr-actions');
    const startBtn = c.button('fbk-btn fbk-btn-primary rr-primary', null, null,
        () => actions.startDrill());
    startBtn.appendChild(c.el('span', 'fbk-btn-label', 'Start drill'));
    startBtn.appendChild(c.kbd('D'));

    const endBtn = c.button('fbk-btn fbk-btn-stop rr-primary', null,
        'Stop the drill and restore your speed', () => actions.endDrill());
    endBtn.appendChild(c.el('span', 'fbk-btn-label', 'End drill'));
    endBtn.appendChild(c.kbd('D'));

    const loopBtn = c.button('fbk-btn rr-alt', 'Free loop',
        'Loop the passage and leave it alone — no goal, no ladder, no grading',
        () => actions.loopOnly());

    actionRow.appendChild(startBtn);
    actionRow.appendChild(endBtn);
    actionRow.appendChild(loopBtn);
    foot.appendChild(actionRow);

    /*
     * The last snapshot rendered.
     *
     * Only for handlers that repaint between ticks — never as state. The
     * panel's rule is that everything it draws comes out of one snapshot, and
     * this is that snapshot, not a copy of anything in it.
     */
    let lastSnap = null;

    // ── render ───────────────────────────────────────────────────────────

    function render(snap) {
        lastSnap = snap;
        empty.hidden = !!snap.ready;
        body.hidden = !snap.ready;
        foot.hidden = !snap.ready;
        if (!snap.ready) return;

        renderLoop(snap);
        renderDrillRack(snap);
        renderWeak(snap);
        renderFooter(snap);
    }

    function renderLoop(snap) {
        const sel = snap.selection;

        /*
         * The rack's legend carries the selection's identity, so the strip
         * does not need a label under it and the panel names the passage once.
         */
        const best = c.num(sel && sel.best);
        loopRack.setAside(sel
            ? (sel.label || '').toUpperCase() + (best === null ? '' : ' · BEST ' + pct(sel.best))
            : 'nothing selected');
        loopRack.el.querySelector('.fbk-rack-aside').dataset.tone = best === null ? '' : 'value';

        strip.set(snap.blocks, snap.duration, sel);
        strip.mark(blockAt(snap));
        strip.disable(snap.drill.active);

        unit.set(snap.settings.unit || 'bars');
        unit.disable(snap.drill.active);

        const bars = snap.settings.unit !== 'time';
        tenths = !bars;
        for (const [e, edge] of [['start', edgeA], ['end', edgeB]]) {
            const t = sel ? (e === 'start' ? sel.start : sel.end) : null;
            edge.label.textContent = (e === 'start' ? 'A' : 'B') + ' · ±1 ' + (bars ? 'bar' : 's');
            edge.set(t === null ? 0 : t);
            const dead = snap.drill.active || (!sel && e === 'end');
            edge.down.disabled = dead;
            edge.up.disabled = dead;
        }
    }

    /** Which block the playhead is inside, so the strip can mark it. */
    function blockAt(snap) {
        const t = c.num(snap.playhead);
        if (t === null) return null;
        for (const b of snap.blocks) if (t >= b.start && t < b.end) return b.key;
        return null;
    }

    function renderDrillRack(snap) {
        const running = snap.drill.active;
        const s = snap.settings;

        start.set(running && Number.isFinite(snap.drill.speedPct) ? snap.drill.speedPct : s.startPct);
        start.disable(running);
        goal.set(running && Number.isFinite(snap.drill.goalPct) ? snap.drill.goalPct : s.goalPct);
        goal.disable(running);
        stepSeg.set(s.stepPct);
        stepSeg.disable(running);
        widen.set(s.widen);
        widen.disable(running);

        /*
         * The rungs: the ENGINE's ladder while a drill runs, the stored one
         * otherwise. Two sources on purpose — the engine owns the ladder once
         * it starts, and showing the stored one would light the wrong dot the
         * moment the two disagreed.
         */
        const rungs = running ? (snap.drill.ladderPct || []) : (snap.ladder || []);
        const nowPct = running ? rungs[snap.drill.rung] : null;
        climb.set(rungs.map((v) => ({
            value: v,
            label: String(v),
            state: !running ? (v === s.startPct ? 'on' : 'next')
                : (v === nowPct ? 'on' : (v < nowPct ? 'done' : 'next')),
        })));

        climbLabel.textContent = running ? 'Climb · on rung' : 'Climb';
        climbNote.textContent = running
            ? (nextStepLine(snap.drill) || '')
            : (rungs.length > 1
                ? `${rungs.length - 1} clean run${rungs.length === 2 ? '' : 's'} to full tempo`
                : 'at full tempo');
        climbWell.title = running
            ? statusLine(snap.drill)
            : `A cleared pass at ${s.goalPct}% moves up one rung. The top is always full tempo.`;

        difficulty.set(snap.difficultyPct);
        difficulty.disable(!snap.hasPhraseData || running);
        if (running) {
            diffNote.hidden = false;
            diffNote.textContent = 'The drill owns the speed and the difficulty while it runs.';
        } else if (!snap.hasPhraseData) {
            diffNote.hidden = false;
            diffNote.textContent = 'This chart has a single difficulty tier, so the slider does nothing here.';
        } else {
            diffNote.hidden = true;
            diffNote.textContent = '';
        }
    }

    function renderWeak(snap) {
        const rows = showAll ? snap.weakest : snap.weakest.slice(0, 3);
        const judged = c.num(snap.run.accuracy) !== null;
        weakRack.setAside(judged
            ? `RUN ${pct(snap.run.accuracy)} · ${snap.run.hits + snap.run.misses} NOTES`
            : 'nothing judged yet');
        weakRack.el.querySelector('.fbk-rack-aside').dataset.tone = judged ? 'value' : '';

        weak.textContent = '';
        if (!snap.weakest.length) {
            weak.appendChild(c.el('p', 'fbk-empty',
                'Nothing measured yet. Play with note detection on and the passages you '
                + 'struggle with will collect a number here.'));
        } else {
            for (const row of rows) {
                weak.appendChild(c.listRow({
                    label: row.label,
                    value: row.accuracy * 100,
                    band: c.band(row.accuracy),
                    onClick: () => actions.selectSection(row.key),
                    title: row.live
                        ? `${row.label} — ${pct(row.accuracy)} on this run. Tap to loop it.`
                        : (row.graduated
                            ? `${row.label} — graduated a drill at ${pct(row.accuracy)}. Tap to loop it.`
                            : `${row.label} — ${pct(row.accuracy)} over ${row.plays} attempt${row.plays === 1 ? '' : 's'}. Tap to loop it.`),
                }));
            }
        }

        /*
         * NOTHING MEASURED YET: the message, and no buttons at all.
         *
         * A disabled `Loop weakest ›` under "nothing measured yet" is a
         * control that exists to say it cannot work — and the sentence above
         * it already said so, better. So the whole row goes until there is
         * something to loop, which also stops the empty state being taller
         * than the thing it is explaining.
         */
        const has = snap.weakest.length > 0;
        weakActs.hidden = !has;
        weakestBtn.disabled = snap.drill.active;
        moreBtn.hidden = snap.weakest.length <= 3;
        moreBtn.textContent = showAll ? 'Top 3 ⌃' : `All ${snap.weakest.length} ⌄`;
    }

    function renderFooter(snap) {
        const running = snap.drill.active;
        const canDrill = snap.selectionUsable && !snap.engine.blocked;

        startBtn.hidden = running;
        endBtn.hidden = !running;
        startBtn.disabled = !canDrill;
        loopBtn.disabled = !snap.selectionUsable || running;

        /*
         * Why the footswitch is dead, in words, right above it — and nothing
         * at all when it is alive.
         *
         * Two causes used to be reported two different wrong ways: a blocked
         * engine by an 8px hue on a saturated fill plus a tooltip, and an
         * empty passage by a tooltip reading "pick a passage first" about a
         * passage you had picked.
         */
        if (running || canDrill) {
            status.set(null, '');
        } else if (snap.engine.blocked) {
            status.set('blocked', snap.engine.blocked,
                snap.engine.available ? { label: 'Turn on', onClick: () => actions.enableDetection() } : null);
        } else if (emptySelection(snap)) {
            status.set('blocked', 'This passage has no notes — move A or B onto a phrase with notes.');
        } else {
            status.set('blocked', 'Tap a block on the timeline to pick a passage.');
        }

        startBtn.title = canDrill ? 'Arm the drill on the chosen passage' : '';
    }

    return { render };
}
