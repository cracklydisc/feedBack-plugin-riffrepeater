/*
 * The panel.
 *
 * THIS FILE IS THE THROWAWAY HALF. In core these controls belong in a third
 * row of the Section Practice popover, next to the chips the user already
 * clicks — not in a floating panel launched from the plugins rail. The panel
 * exists because the popover has no sanctioned extension point for a plugin
 * (docs/plugin-v3-ui.md documents exactly one: playerControlSlot), and
 * injecting into it would mean fighting specificity and re-injecting after
 * every re-render. So: the right mount, later; a stable mount, now.
 *
 * Two rules keep it replaceable:
 *   - it reads ONLY model.snapshot(), never the host or the detector
 *   - it writes ONLY through the actions passed in, never to the model directly
 *
 * Rendering is patch-in-place rather than innerHTML-per-tick, because this
 * re-renders twice a second while a drill runs and a rebuilt chip is a chip
 * that cannot be clicked.
 */

import { PRESETS, STRETCH_WARN_PCT, statusLine, nextStepLine, band } from '../ladder.js';
import { clock } from '../ranges.js';

const MODES = [
    { id: 'section', label: 'Section', hint: 'A logical part of the song — the same passages the Practice popover lists.' },
    { id: 'part', label: 'Phrase', hint: 'The phrases inside that section — the host\'s "Part n of m".' },
    { id: 'bars', label: 'Bars', hint: 'Any run of measures, taken from the playhead. Trim by whole bars.' },
];

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

    // ── a message instead of controls, when there is nothing to control ──
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

    // section chips — rebuilt only when the section set changes
    const chips = el('div', 'rr-chips');
    chips.setAttribute('role', 'toolbar');
    chips.setAttribute('aria-label', 'Sections');
    main.appendChild(chips);
    let chipSignature = '';
    const chipNodes = new Map();

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
    barsRow.appendChild(button('rr-btn rr-btn-quiet', 'From playhead', 'Take that many bars starting at the bar under the playhead', () => actions.barsAtPlayhead()));
    main.appendChild(barsRow);

    // the chosen range, and its edges
    const readout = el('div', 'rr-readout');
    const readoutLabel = el('span', 'rr-readout-label');
    const readoutMeta = el('span', 'rr-readout-meta');
    readout.appendChild(readoutLabel);
    readout.appendChild(readoutMeta);
    main.appendChild(readout);

    const trim = el('div', 'rr-row rr-trim');
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

    const ladderRow = el('div', 'rr-row rr-ladder');
    ladderRow.appendChild(el('span', 'rr-mini', 'Ladder'));
    const ladderButtons = new Map();
    for (const p of PRESETS) {
        const b = button('rr-rung', String(p), `${p}% of tempo`, () => actions.toggleRung(p));
        if (p === 100) {
            b.disabled = true;
            b.title = 'A drill always finishes at full tempo';
        }
        ladderButtons.set(p, b);
        ladderRow.appendChild(b);
    }
    main.appendChild(ladderRow);

    const goalRow = el('div', 'rr-row rr-goal');
    goalRow.appendChild(el('span', 'rr-mini', 'Goal'));
    const goalInput = document.createElement('input');
    goalInput.type = 'number';
    goalInput.min = '10';
    goalInput.max = '100';
    goalInput.step = '5';
    goalInput.className = 'rr-num';
    goalInput.title = 'Accuracy needed on one pass of the loop to move up a rung';
    goalInput.addEventListener('change', () => actions.setGoal(Number(goalInput.value)));
    goalRow.appendChild(goalInput);
    goalRow.appendChild(el('span', 'rr-mini', '%'));

    const widenWrap = el('label', 'rr-check');
    const widenBox = document.createElement('input');
    widenBox.type = 'checkbox';
    widenBox.addEventListener('change', () => actions.setWiden(widenBox.checked));
    widenWrap.appendChild(widenBox);
    widenWrap.appendChild(el('span', null, 'Widen when nailed'));
    widenWrap.title = 'Once the passage is clean, grow the loop by a bar each side (up to two) so it goes back into its surroundings before you leave it';
    goalRow.appendChild(widenWrap);
    main.appendChild(goalRow);

    const repsNote = el('p', 'rr-note');
    main.appendChild(repsNote);

    const warn = el('p', 'rr-warn');
    main.appendChild(warn);

    // ── actions ──────────────────────────────────────────────────────────
    const acts = el('div', 'rr-row rr-acts');
    const startBtn = button('rr-btn rr-btn-primary', '⏱ Start drill', 'Arm the drill on the chosen passage', () => actions.startDrill());
    const endBtn = button('rr-btn rr-btn-danger', '✕ End drill', 'Stop the drill and restore your speed', () => actions.endDrill());
    const loopBtn = button('rr-btn', 'Loop only', 'Loop the passage with no goal and no ramp', () => actions.loopOnly());
    const clearBtn = button('rr-btn rr-btn-quiet', 'Clear loop', 'Drop the loop and play on', () => actions.clearLoop());
    acts.appendChild(startBtn);
    acts.appendChild(endBtn);
    acts.appendChild(loopBtn);
    acts.appendChild(clearBtn);
    main.appendChild(acts);

    const blocked = el('p', 'rr-blocked');
    main.appendChild(blocked);

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

    // ── speed & difficulty ───────────────────────────────────────────────
    main.appendChild(el('h4', 'rr-legend', 'Speed & difficulty'));

    const speedRow = el('div', 'rr-row rr-speed');
    speedRow.appendChild(el('span', 'rr-mini', 'Speed'));
    const speedButtons = new Map();
    for (const p of [50, 65, 80, 90, 100]) {
        const b = button('rr-rung', String(p), `Play at ${p}% of tempo`, () => actions.setSpeed(p));
        speedButtons.set(p, b);
        speedRow.appendChild(b);
    }
    main.appendChild(speedRow);

    const diffRow = el('div', 'rr-row rr-diff');
    diffRow.appendChild(el('span', 'rr-mini', 'Difficulty'));
    const diffInput = document.createElement('input');
    diffInput.type = 'range';
    diffInput.min = '0';
    diffInput.max = '100';
    diffInput.step = '5';
    diffInput.className = 'rr-range';
    diffInput.addEventListener('input', () => {
        diffValue.textContent = diffInput.value + '%';
        actions.setDifficulty(Number(diffInput.value));
    });
    const diffValue = el('span', 'rr-count');
    diffRow.appendChild(diffInput);
    diffRow.appendChild(diffValue);
    main.appendChild(diffRow);

    const diffNote = el('p', 'rr-note');
    main.appendChild(diffNote);

    // ── the map ──────────────────────────────────────────────────────────
    const mapHead = el('h4', 'rr-legend', 'Where you struggle');
    main.appendChild(mapHead);
    const runLine = el('p', 'rr-note');
    main.appendChild(runLine);
    const weak = el('div', 'rr-weak');
    main.appendChild(weak);

    // ── render ───────────────────────────────────────────────────────────

    function renderChips(snap) {
        const signature = snap.sections.map((s) => s.key).join('|');
        if (signature !== chipSignature) {
            chipSignature = signature;
            chips.textContent = '';
            chipNodes.clear();
            for (const s of snap.sections) {
                const b = button('rr-chip', s.label, null, () => actions.selectSection(s.key));
                chipNodes.set(s.key, b);
                chips.appendChild(b);
            }
        }
        for (const s of snap.sections) {
            const node = chipNodes.get(s.key);
            if (!node) continue;
            // This run's number wins over the stored best: while you are
            // playing, the interesting question is how THIS pass is going.
            const acc = Number.isFinite(s.runAccuracy) ? s.runAccuracy : s.best;
            node.classList.toggle('rr-chip-on', snap.mode !== 'bars' && s.key === snap.sectionKey);
            node.dataset.band = Number.isFinite(acc) ? band(acc) : 'none';
            node.classList.toggle('rr-chip-done', !!s.graduated);
            const bits = [s.label];
            if (Number.isFinite(acc)) bits.push(`best ${pct(acc)}`);
            if (s.plays) bits.push(`${s.plays} attempt${s.plays === 1 ? '' : 's'}`);
            if (Number.isFinite(s.events)) bits.push(`${s.events} notes`);
            node.title = bits.join(' · ');
        }
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
            // `rr-note`, not `rr-mini`: mini is an uppercase, letter-spaced
            // field label, and a whole sentence in it is unreadable.
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
        chips.hidden = snap.mode === 'bars';
        partRow.hidden = snap.mode !== 'part';
        barsRow.hidden = snap.mode !== 'bars';

        renderChips(snap);

        // phrases
        if (snap.mode === 'part') {
            partLabel.textContent = snap.partCount
                ? `Part ${snap.partIndex + 1} of ${snap.partCount}`
                : 'This section has no phrase data';
            partPrev.disabled = snap.partIndex <= 0;
            partNext.disabled = snap.partIndex >= snap.partCount - 1;
        }

        // bars
        if (snap.mode === 'bars') {
            barCount.textContent = String(snap.bars.count);
            const noBars = !snap.bars.available;
            barMinus.disabled = noBars || snap.bars.count <= 1;
            barPlus.disabled = noBars;
            if (noBars) {
                barsRow.title = 'This chart carries no bar lines, so bar ranges are unavailable.';
            }
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

        // ladder
        const ladder = snap.settings.ladder || [];
        for (const [p, b] of ladderButtons) {
            b.classList.toggle('rr-rung-on', p === 100 || ladder.includes(p));
            b.disabled = p === 100 || snap.drill.active;
        }
        if (document.activeElement !== goalInput) goalInput.value = String(snap.settings.goalPct);
        goalInput.disabled = snap.drill.active;
        widenBox.checked = !!snap.settings.widen;
        widenBox.disabled = snap.drill.active;
        repsNote.textContent = `A cleared goal steps up a rung; ${snap.drill.reps || 3} clean passes at full tempo finish the drill.`;
        warn.hidden = !ladder.some((p) => p < STRETCH_WARN_PCT);
        warn.textContent = warn.hidden ? ''
            : `Below ${STRETCH_WARN_PCT}% the backing track is audibly time-stretched. Worth it for a passage you cannot play yet; not worth leaving on.`;

        // actions
        const canDrill = snap.selectionUsable && !snap.engine.blocked;
        startBtn.hidden = snap.drill.active;
        endBtn.hidden = !snap.drill.active;
        startBtn.disabled = !canDrill;
        loopBtn.disabled = !snap.selectionUsable || snap.drill.active;
        clearBtn.disabled = snap.drill.active;
        blocked.hidden = !snap.engine.blocked || snap.drill.active;
        blocked.textContent = snap.engine.blocked || '';

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

        // speed & difficulty
        for (const [p, b] of speedButtons) {
            b.classList.toggle('rr-rung-on', Math.abs(snap.speedPct - p) < 3);
            b.disabled = snap.drill.active;
        }
        if (document.activeElement !== diffInput) diffInput.value = String(snap.difficultyPct);
        diffValue.textContent = snap.difficultyPct + '%';
        diffInput.disabled = !snap.hasPhraseData || snap.drill.active;
        diffNote.textContent = snap.drill.active
            ? 'The drill owns the speed while it runs, and the difficulty with it.'
            : (snap.hasPhraseData
                ? 'Difficulty thins the chart to the easier tiers the pack was authored with.'
                : 'This chart has a single difficulty tier, so the slider does nothing here.');

        // the map
        const run = snap.run;
        runLine.textContent = Number.isFinite(run.accuracy)
            ? `This run: ${pct(run.accuracy)} over ${run.hits + run.misses} judged notes.${snap.paused ? ' Paused — the drill is measuring instead.' : ''}`
            : 'This run: nothing judged yet.';
        renderWeak(snap);
    }

    return { root, render };
}
