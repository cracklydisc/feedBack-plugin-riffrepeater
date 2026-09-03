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
export function createContent(outer, actions, foot, foldedSlot, panelApi) {
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

    /*
     * The bar each edge is on, or null on a chart with no bar lines — read by
     * the edge formatters for the same reason `tenths` is, and declared beside
     * it for the same temporal-dead-zone reason.
     */
    let edgeBars = null;

    // ── RACK 1: the loop ─────────────────────────────────────────────────
    const loopRack = c.rack({ label: 'Loop' });
    body.appendChild(loopRack.el);

    /*
     * WHAT USED TO BE HERE: a `BARS | TIME` switch.
     *
     * Asked whether it made sense, and it did not — for a reason that only
     * showed up in the code. `nudgeByBar` has ALWAYS fallen back to seconds
     * when a chart carries no bar lines, so the switch's one genuine job was
     * already being done automatically; and on such a chart the label went on
     * saying "±1 bar" while the button moved two seconds, which is worse than
     * having no switch at all.
     *
     * The unit is a FACT ABOUT THE CHART, not a choice: bars where there are
     * bars, seconds where there are not. The label says which, so nothing is
     * hidden — and the rack's header is free.
     *
     * Sub-bar precision did not go with it. It moved to where it belongs: the
     * A/B handles snap only when they are NEAR an edge, so a deliberate drag
     * places freely. Ten presses of a ±0.1s stepper was never the tool for
     * that.
     */

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
        onPick: (key) => actions.selectBlock(key),
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
    /*
     * THE GRAIN, and it is the answer to "I want to drill bar 41".
     *
     * The strip's zones are phrases — several bars each — and the edge
     * steppers move a bar at a time, so a single bar meant walking B down to A
     * by hand once per bar. Reported as not being possible at all.
     *
     * One press collapses the loop to that many bars from where it already
     * starts; the A stepper then walks it with the bar number under your eye.
     * It is a grain, not a mode: nothing to switch back out of, because
     * tapping the strip picks a phrase again.
     */
    const grain = c.segmented(
        [
            { value: 1, label: '1', title: 'Loop one bar from A' },
            { value: 2, label: '2', title: 'Loop two bars from A' },
            { value: 4, label: '4', title: 'Loop four bars from A' },
            { value: 8, label: '8', title: 'Loop eight bars from A' },
        ],
        (n) => actions.selectBars(n),
        'How many bars to loop',
    );
    const grainRow = c.field({ label: 'Bars', tight: true });
    grainRow.body.appendChild(grain.el);
    loopRack.body.appendChild(grainRow.el);

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
            /*
             * A BAR NUMBER when the chart has bars, the clock when it does not.
             *
             * The label above says `±1 bar`; a readout saying `0:01` under it
             * asks the reader to convert between two units the panel is
             * already holding. `bar 12` is what you count while playing.
             */
            format: (v) => {
                const n = edgeBars ? edgeBars[edge] : null;
                if (Number.isFinite(n)) return 'bar ' + n;
                return tenths ? clock(v, 1) : clock(v);
            },
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
     * WHAT USED TO BE HERE: the `Widen when clean` toggle.
     *
     * It maps to the conductor's `expandContext`: once you graduate a passage
     * at full tempo the loop grows a bar each side (up to two) and you clear
     * the wider version too, so you finish playing the phrase JOINED to its
     * neighbours rather than in isolation. That is a real thing and it is not
     * what `Start drill` versus `Free loop` decides — those are "graded climb"
     * against "just loop it", and this is about how a successful drill ENDS.
     *
     * It went anyway, and the reason is the question that was asked about it:
     * "what is Widen for?" — twice, three versions apart. 0.10.0 answered with
     * a paragraph under the toggle; 0.11.0 deleted the paragraph as dead space
     * and kept the toggle. That left a control whose meaning needed thirty
     * words, with the thirty words removed, in the most prominent slot of the
     * SPEED rack.
     *
     * By §15 it was never a panel control: it is policy, it writes a global,
     * and its value does not change from passage to passage — you decide once
     * whether you want drills to widen. The settings page keeps it, where a
     * sentence of explanation is affordable and expected.
     */

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
        /* Both of these drive the drill, so both read in the accent — the
           design paints them that way and it is right: they are the two
           numbers a drill is built from. */
        emph: true,
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
    /*
     * No key cap on the footswitch.
     *
     * `D` is still registered and still listed in the host's own help panel
     * and keybinds tab, so nothing was lost by taking it off the button — and
     * a footswitch is the one control in the panel you hit without reading it.
     * A badge on it is a label competing with the only label that matters.
     */
    startBtn.appendChild(c.el('span', 'fbk-btn-label', 'Start drill'));

    const endBtn = c.button('fbk-btn fbk-btn-stop rr-primary', null,
        'Stop the drill and restore your speed', () => actions.endDrill());
    endBtn.appendChild(c.el('span', 'fbk-btn-label', 'End drill'));

    /*
     * One button, two jobs, decided by the state it is displaying — which is
     * the only honest way to label a toggle: the words say what pressing does
     * NEXT, so they cannot disagree with what it will do.
     */
    const loopBtn = c.button('fbk-btn rr-alt', 'Free loop', null, () => {
        if (lastSnap && lastSnap.loopArmed && !lastSnap.drill.active) actions.clearLoop();
        else actions.loopOnly();
    });

    actionRow.appendChild(startBtn);
    actionRow.appendChild(endBtn);
    actionRow.appendChild(loopBtn);
    foot.appendChild(actionRow);

    /* ── the folded state: what you read while playing ───────────────────
     *
     * Reported: during a loop the only thing on screen was the DETECTOR's own
     * HUD, not this panel. Which was true — the panel had one size, the full
     * rack, and a rack is not what you can take in with a guitar in your
     * hands.
     *
     * So it folds while something is running: one big live number, the climb
     * rail, and one row saying which passage and how far in. The whole block
     * is one target, because the only thing you might want mid-song is "give
     * me the rest of it", and aiming at a chevron is not a gesture you can
     * make while playing. Kit DESIGN.md §23.
     *
     * The one exception is the WAY OUT. The detector's own drill HUD used to
     * carry it and we now stand that HUD down while this strip shows, so the
     * strip owes the player a stop they can hit without opening anything: a
     * loop you cannot leave is a trap, and that was true of their HUD's End
     * button before it was true of ours.
     */
    const strip2 = c.foldedStrip({
        /*
         * JUST "OPEN", no key badge.
         *
         * `OPEN · Y` next to a STOP footswitch read as two competing controls
         * — reported that way — and the `Y` was the half carrying no weight:
         * it is in the host's own keybinds list, and nobody hunting for the
         * way back out of a folded panel is reading a two-character badge to
         * find it. One word on the handle, and the footswitch beside it is
         * unmistakably the other thing.
         */
        label: 'OPEN',
        onOpen: () => actions.unfold(),
        endLabel: 'End',
        onEnd: () => {
            /*
             * Which run is playing decides which verb. Asking the snapshot
             * rather than remembering: the drill can end itself by graduating
             * between two presses, and a remembered flag would then stop a
             * loop that is not there.
             */
            if (lastSnap && lastSnap.drill.active) actions.endDrill();
            else actions.clearLoop();
        },
    });

    const liveTop = c.el('div', 'rr-live-top');
    const liveBox = c.el('div', 'rr-live-box');
    liveBox.appendChild(c.el('span', 'fbk-rack-label rr-live-cap', 'Live'));
    const liveValue = c.el('span', 'fbk-live-value');
    const liveNum = c.el('span', null, '–');
    liveValue.appendChild(liveNum);
    liveValue.appendChild(c.el('span', 'fbk-live-unit', '%'));
    liveBox.appendChild(liveValue);

    const climbBox = c.el('div', 'rr-live-climb');
    const climbCap = c.el('div', 'rr-live-climbcap');
    climbCap.appendChild(c.el('span', 'fbk-rack-label rr-live-cap', 'Speed'));
    const climbGoal = c.el('span', 'rr-live-goal');
    climbCap.appendChild(climbGoal);
    climbBox.appendChild(climbCap);
    const climb2 = c.rail({ ariaLabel: 'The speeds this drill climbs' });
    climbBox.appendChild(climb2.el);

    liveTop.appendChild(liveBox);
    liveTop.appendChild(climbBox);

    const liveRow = c.el('div', 'rr-live-row');
    const liveWhere = c.el('span', 'fbk-list-name rr-live-where');
    const liveMeter = c.ledMeter({ segments: 8 });
    const liveCount = c.el('span', 'fbk-list-value rr-live-count');
    liveRow.appendChild(c.el('span', 'fbk-rack-dot'));
    liveRow.appendChild(liveWhere);
    liveRow.appendChild(liveMeter.el);
    liveRow.appendChild(liveCount);

    strip2.body.appendChild(liveTop);
    /*
     * The facts go in the strip's FULL-WIDTH slot, not under the live stack.
     *
     * The footswitch shares its line with the number and the rail; this row
     * runs the whole width beneath it, divider and all. As a child of `body`
     * it was boxed into the column left of a 56px pedal — reported as the stop
     * being in the wrong place, which it was, but the row was the half that
     * had to move.
     */
    strip2.foot.appendChild(liveRow);
    if (foldedSlot) foldedSlot.appendChild(strip2.el);

    function renderFolded(snap) {
        const d = snap.drill;
        const running = d.active;

        /*
         * The one number, and it counts DOWN from a hundred.
         *
         * It used to be the conductor's best-so-far while a drill ran and
         * hits-over-judged otherwise — a number that starts at zero, means
         * nothing until most of the passage has gone by, and during a drill
         * only appeared when the pass ENDED, which is the one moment it is no
         * longer useful. Reported exactly that way.
         *
         * A hundred minus what the misses cost is true from the first bar,
         * because the denominator is the passage's own note count and we know
         * it before a note is played.
         */
        const live = c.num(snap.live ? snap.live.pct : null);
        liveNum.textContent = live === null ? '–' : Math.round(live);
        liveValue.dataset.band = live === null ? 'none' : (c.band(live / 100) || 'none');

        const rungs = running ? (d.ladderPct || []) : (snap.ladder || []);
        const nowPct = running ? rungs[d.rung] : null;
        climb2.set(rungs.map((v) => ({
            value: v,
            label: String(v),
            state: !running ? 'next'
                : (v === nowPct ? 'on' : (v < nowPct ? 'done' : 'next')),
        })));
        climbGoal.textContent = running
            ? (nextStepLine(d) || '')
            : 'loop running';

        strip2.setEnd(running ? 'End' : 'Stop');

        const sel = snap.selection;
        liveWhere.textContent = sel ? sel.label : '—';
        liveMeter.set(live, live === null ? null : c.band(live / 100));
        /*
         * What the number is out of, and what it has cost so far — the two
         * things that make a percentage readable rather than a mood.
         */
        const total = snap.live ? snap.live.total : null;
        const missed = snap.live ? snap.live.misses : 0;
        const tally = total === null
            ? '– notes'
            : `${missed}/${total} missed`;
        liveCount.textContent = running && d.iteration
            ? `${d.iteration}/${d.reps || 3} · ${tally}`
            : tally;
    }

    /*
     * The last snapshot rendered.
     *
     * Only for handlers that repaint between ticks — never as state. The
     * panel's rule is that everything it draws comes out of one snapshot, and
     * this is that snapshot, not a copy of anything in it.
     */
    let lastSnap = null;

    /*
     * Whether the reader has asked for the full rack while something runs.
     *
     * Reset when the run ends, because the override is about THIS run: you
     * opened the rack to change a goal, and the next passage should start
     * folded again like the first.
     */
    let wantsRack = false;

    // ── render ───────────────────────────────────────────────────────────

    function render(snap) {
        lastSnap = snap;
        empty.hidden = !!snap.ready;
        body.hidden = !snap.ready;
        foot.hidden = !snap.ready;
        if (!snap.ready) return;

        /*
         * FOLD WHILE SOMETHING IS RUNNING, unless the reader asked to see the
         * rack. `wantsRack` is the user's own override — opening the rack
         * mid-drill is a thing you do to change the goal, and it must not
         * snap shut on the next tick.
         */
        if (panelApi) {
            const busy = snap.drill.active || snap.loopArmed;
            const small = busy && !wantsRack;
            if (small) renderFolded(snap);
            const folded = panelApi.fold(small);

            /*
             * STAND THE DETECTOR'S OWN DRILL HUD DOWN — but only while ours is
             * actually on screen.
             *
             * `note_detect` builds `#nd-drill-hud` on document.body whenever a
             * drill runs and offers no way to opt out, so two panels said the
             * same things in two visual languages and the default one was the
             * one on top. The flag goes on the root element and our stylesheet
             * keys off it, which means the HUD comes straight back the moment
             * our strip is not showing: the rack open, the panel closed, this
             * plugin disabled or broken. Hiding another plugin's only way out
             * and then failing would leave a drill with no exit at all.
             */
            document.documentElement.dataset.rrLive =
                (folded && panelApi.isOpen()) ? 'true' : 'false';

            if (small) return;
        }

        wantsRack = wantsRack && (snap.drill.active || snap.loopArmed);

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
        strip.playhead(snap.playhead);
        strip.disable(snap.drill.active);

        /*
         * Bars where the chart has bars, seconds where it does not — and the
         * label says which, which is the whole of what the old switch bought.
         */
        const bars = snap.barsAvailable;
        tenths = !bars;
        edgeBars = snap.edgeBars;

        /*
         * The grain shows a value only when the loop IS a bar range — after a
         * tap on the strip it is a phrase, and lighting a number would claim
         * the loop is something it is not.
         */
        grain.set(snap.selection && snap.selection.kind === 'bars'
            ? snap.selection.barCount
            : null);
        grain.disable(!bars || snap.drill.active);
        grainRow.el.hidden = !bars;
        for (const [e, edge] of [['start', edgeA], ['end', edgeB]]) {
            const t = sel ? (e === 'start' ? sel.start : sel.end) : null;
            edge.label.textContent = (e === 'start' ? 'A' : 'B')
                + (bars ? ' · ±1 bar' : ' · ±2 s');
            edge.set(t === null ? 0 : t);
            const dead = snap.drill.active || (!sel && e === 'end');
            edge.down.disabled = dead;
            edge.up.disabled = dead;
        }
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
        /*
         * NO NOTE WHILE A DRILL RUNS.
         *
         * It said "the drill owns the speed and the difficulty while it runs"
         * — and START, GOAL, STEP and CHART are all disabled at that moment,
         * which says the same thing without a sentence. Reported as useless
         * and, worse, as growing the panel the instant you press start: two
         * lines appearing under the controls you just committed to, pushing
         * everything below them down.
         *
         * It is the green dot and the "note detection on" line again — a
         * message that reports the expected state. `.fbk-note` is for a
         * control that is not working for a reason you cannot see, and a
         * greyed-out stepper is not that.
         */
        if (running) {
            diffNote.hidden = true;
            diffNote.textContent = '';
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

        /*
         * FREE LOOP IS A TOGGLE, and it has to look like one.
         *
         * Reported: starting a drill visibly changes the panel and starting a
         * free loop does not, so there was no way to tell the instrument was
         * looping. The button was a one-shot that armed a loop and then sat
         * there unchanged, which is a control lying about its own state — and
         * the state was already in the snapshot (`loopArmed`, read from the
         * host, added when `Clear` was fixed for exactly this class of
         * problem).
         *
         * So it says what it will do next, and lights while the loop runs. A
         * drill owns the loop while it climbs, hence the `!running` guard:
         * during a drill this is not the thing that would stop it.
         */
        const looping = snap.loopArmed && !running;
        loopBtn.textContent = looping ? 'Stop loop' : 'Free loop';
        loopBtn.classList.toggle('rr-alt-on', looping);
        loopBtn.title = looping
            ? 'Drop the loop and play on'
            : 'Loop the passage and leave it alone — no goal, no ladder, no grading';
        loopBtn.disabled = running || (!looping && !snap.selectionUsable);

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

    return {
        render,
        /**
         * Move the playhead alone, without re-rendering the panel.
         *
         * The strip's line is placed from a time, so at the panel's own
         * twice-a-second render it steps visibly however correct each position
         * is. `main.js` calls this from a frame loop; it writes one property
         * and reads nothing.
         */
        movePlayhead(seconds) { strip.playhead(seconds); },
        /** Called by the action: show the rack even though something runs. */
        showRack() { wantsRack = true; },
    };
}
