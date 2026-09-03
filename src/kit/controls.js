/*
 * kit 0.15.0 — the four control families, as builders.
 *
 * Each returns `{ el, ... }` where `el` is the node to append and the rest is
 * the handle you drive it with. Nothing here holds application state: a
 * builder gives you a node plus a `set()` that takes the truth from wherever
 * your model keeps it. That is what lets a panel re-render from scratch on a
 * timer and still be correct.
 *
 * There are four families and no others, because the one thing a panel must
 * never do is use two shapes for the same kind of question — or one shape for
 * two. See DESIGN.md §1 for the version of that mistake that shipped.
 */

/**
 * A number, or null when there isn't one.
 *
 * `Number(null)` is 0 and 0 passes `Number.isFinite`, so a bare finite check
 * turns "absent" into "zero" — which has now cost four bugs across two
 * repositories: a stored best of 0% on a never-measured passage, a drill
 * result preferred over a real one, an accuracy band colouring red for
 * "never played", and a stepper that jumped to its minimum when handed null.
 * Every number entering the kit goes through here.
 */
export function num(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

export function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
}

export function button(cls, text, title, onClick) {
    const b = el('button', cls, text);
    b.type = 'button';
    if (title) b.title = title;
    if (onClick) b.addEventListener('click', onClick);
    return b;
}

/** A key cap. Pair it with a real `window.registerShortcut` registration. */
export function kbd(keys) {
    const n = el('span', 'fbk-kbd', keys);
    n.setAttribute('aria-hidden', 'true');   // the shortcut is announced by the host's help panel
    return n;
}

/** A caveat. The sentence goes in the tooltip, never on the panel. */
export function badge(glyph, title) {
    const n = el('span', 'fbk-badge', glyph || '⚠');
    if (title) n.title = title;
    return n;
}

/** The state of an input, to sit inside the control that needs it. */
export function dot(state, title) {
    const n = el('span', 'fbk-dot');
    n.dataset.state = state || 'off';
    if (title) n.title = title;
    return n;
}

/** A section heading with the hairline that makes it read as a divider. */
export function section(title) {
    const wrap = el('div', 'fbk-section');
    wrap.appendChild(el('h4', 'fbk-section-title', title));
    wrap.appendChild(el('span', 'fbk-section-rule'));
    return wrap;
}

/**
 * A section heading that folds what is under it, and reads its own state.
 *
 *     HOW YOU DRILL   80 → 90 → 100 · 85%              ›
 *
 * This exists for exactly one thing: a block of POLICY inside a panel whose
 * job is something else. Policy is what you set once and then live with — how
 * aggressive the ladder is, what counts as clean — and it does not belong in
 * the default view of a panel you opened to do a task. But it must not move to
 * another screen either, because then changing it costs a context switch.
 *
 * A fold is the only honest answer to that: the summary keeps the value
 * visible, so nothing is hidden, and the controls are one click away.
 *
 * DO NOT use it for the thing the panel is FOR. A fold over the primary
 * workflow is a second click charged for the reason the user opened the panel,
 * and the summary then competes with the controls it replaced instead of
 * standing in for them. If the value changes every time you use the panel, it
 * is not policy — leave it open.
 *
 * The head is a real `<button>` with `aria-expanded`, so the whole heading row
 * is the hit target rather than a chevron somebody has to aim at.
 */
export function fold(opts = {}) {
    const { title = '', summary = '', open = false, ariaLabel = null } = opts;

    const wrap = el('section', 'fbk-fold');
    const head = el('button', 'fbk-fold-head');
    head.type = 'button';
    if (ariaLabel) head.setAttribute('aria-label', ariaLabel);

    const heading = el('span', 'fbk-fold-title', title);
    const sum = el('span', 'fbk-fold-summary', summary);
    /*
     * A chevron, not a triangle or a plus. It rotates, so the same glyph says
     * both states and there is nothing to keep in sync — and rotation is the
     * one transform the "Still" recipe can neutralise without the control
     * becoming ambiguous, because the open state also shows its body.
     */
    const chev = el('span', 'fbk-fold-chev', '›');

    /*
     * CHEVRON FIRST. It was trailing, 200px from the title, and it was also
     * the quietest thing in its own row — so the only signal that the row did
     * anything sat where nobody was looking, at the lowest contrast in the
     * group. Reported as "it isn't clear that the section expands", which was
     * the row telling the truth about itself.
     *
     * Leading fixes three things at once. The affordance is where the eye
     * enters the row. It is next to the text it belongs to rather than
     * flushed to an edge it has no relationship with. And the summary can
     * then right-align against the panel's other values — the Chart field's
     * readout lands on the same pixel, which is one shared alignment instead
     * of a third ragged one (Refactoring UI: use fewer alignments).
     */
    head.appendChild(chev);
    head.appendChild(heading);
    head.appendChild(sum);

    const body = el('div', 'fbk-fold-body');

    wrap.appendChild(head);
    wrap.appendChild(body);

    let isOpen = false;

    function setOpen(on) {
        isOpen = !!on;
        head.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        /*
         * `hidden` rather than a class, so the fourth law holds: a consumer
         * that styles `.fbk-fold-body` with a `display` cannot leave a closed
         * body on screen (kit.css scopes the `!important` that guarantees it).
         */
        body.hidden = !isOpen;
        wrap.dataset.open = isOpen ? 'true' : 'false';
    }

    head.addEventListener('click', () => setOpen(!isOpen));
    setOpen(open);

    return {
        el: wrap,
        /** Append the folded controls here. */
        body,
        head,
        /** The three head cells, in DOM order: chevron, title, summary. */
        parts: { chev, title: heading, summary: sum },
        /**
         * The VALUE, kept visible while the body is shut.
         *
         * Whatever the controls inside say, said in one line. A fold whose
         * summary does not answer the question the controls answer is a fold
         * that hides rather than folds.
         *
         * A value, and not a sentence: this slot is the flexible cell of a
         * three-cell row, so on a 336px panel it is about 165px and anything
         * longer ellipsizes. Riff Repeater put "applies to every passage,
         * every song" here when open and it arrived as "applies to every
         * passage, every …", which is a summary that has stopped summarising.
         * Prose belongs in a `.fbk-hint` at the top of `body`, where it has
         * the full width and is next to the controls it describes.
         */
        setSummary(text) { sum.textContent = text === null || text === undefined ? '' : String(text); },
        setOpen,
        toggle() { setOpen(!isOpen); },
        isOpen() { return isOpen; },
    };
}

/**
 * A RACK — one block of the unit.
 *
 *     ● LOOP   INTRO 1 · BEST 58%              [ TIME | BARS ]
 *     ────────────────────────────────────────────────────────
 *     …controls…
 *
 * The panel is a chassis and this is a module bolted into it: a label, an
 * optional read-only aside, an optional header control, and a body. Racks are
 * FLAT and separated by a 1px stroke rather than by margin — which is why the
 * space scale got denser when this arrived. Air between groups was doing a
 * line's job.
 *
 * `setAside` is for a VALUE, never a control: it sits in the label's row at
 * the mono readout step, and the point of the slot is that you can read the
 * rack's state without opening anything. A control goes in `header`, which is
 * right-aligned after it and sized for something set once (`h-sm`).
 */
export function rack(opts = {}) {
    const { label = '', tone = null } = opts;
    const wrap = el('section', 'fbk-rack');
    if (tone) wrap.dataset.tone = tone;

    const head = el('div', 'fbk-rack-head');
    head.appendChild(el('span', 'fbk-rack-dot'));
    const name = el('h4', 'fbk-rack-label', label);
    const aside = el('span', 'fbk-rack-aside');
    const header = el('div', 'fbk-rack-header');
    head.appendChild(name);
    head.appendChild(aside);
    head.appendChild(header);

    const body = el('div', 'fbk-rack-body');
    wrap.appendChild(head);
    wrap.appendChild(body);

    return {
        el: wrap,
        /** Append the rack's controls here. */
        body,
        /** Right-aligned slot for ONE control that is set once. */
        header,
        head,
        /** The read-only state, in the label's row. Nullish clears it. */
        setAside(text) { aside.textContent = (text === null || text === undefined) ? '' : String(text); },
        setLabel(text) { name.textContent = text === null || text === undefined ? '' : String(text); },
    };
}

/**
 * A WELL — a slot cut into the chassis.
 *
 * Darker than what surrounds it, rounder than the chassis (a routed slot has a
 * tool radius), and it means one thing: *this is a readout, not a control*.
 * The climb rail lives in one; so does a blocked status line, which is the
 * same idea turned to urgency — a message that has to stop you gets cut into
 * the panel instead of printed on it.
 *
 * `tone` paints the stroke: `warn` for the amber one.
 */
export function well(tone = null) {
    const n = el('div', 'fbk-well');
    if (tone) n.dataset.tone = tone;
    return n;
}

/**
 * A FIELD — a labelled well with controls in it.
 *
 *     ┌──────────────────────────────────────────┐
 *     │  STEP        +2  │ +5 │  +10             │
 *     └──────────────────────────────────────────┘
 *
 * This is the unit the rack is actually built from, and getting it wrong is
 * what made a first attempt at this design look nothing like it. The rows had
 * the right controls in the right order and sat on FLAT ground: label outside
 * on the left, control to its right, no boundary anywhere. What the design
 * does instead is put **every control group in a well with its own label
 * inside it** — so a rack reads as four objects bolted to a chassis rather
 * than as four lines of a form.
 *
 * The label goes inside for a reason beyond looks: a label in an external
 * column has to share a fixed width with every other label in the panel, so
 * `DIFFICULTY` forces `STEP` to start 40px further right than it needs to.
 * Inside its own well each label takes the room it needs and the wells still
 * line up, because the WELLS are what is aligned.
 */
export function field(opts = {}) {
    const { label = '', tone = null, tight = false } = opts;
    const wrap = el('div', tight ? 'fbk-field fbk-field-tight' : 'fbk-field');
    if (tone) wrap.dataset.tone = tone;
    const legend = label ? el('span', 'fbk-field-label', label) : null;
    if (legend) wrap.appendChild(legend);
    const body = el('div', 'fbk-field-body');
    wrap.appendChild(body);
    return {
        el: wrap,
        /** Append the controls here. */
        body,
        label: legend,
        setLabel(text) { if (legend) legend.textContent = text === null || text === undefined ? '' : String(text); },
    };
}

/**
 * A RAIL — a ladder, as a readout.
 *
 *     CLIMB · ON RUNG              3 clean runs to goal
 *     ●───────◉───────○───────○───────○
 *     80      85      90      95     100
 *
 * NOT PRESSABLE, and that is the design rather than a limitation. The rungs
 * DERIVE from start, step and goal — three steppers own those — so a rail you
 * could click would be a fourth writer of a value three controls already
 * write, which is §15's defect exactly. It shows three states: cleared,
 * current, ahead.
 *
 * And there is deliberately no caption warning about time-stretch on the slow
 * rungs. The rack is called SPEED, its audience already reaches for a practice
 * tool, and a permanent warning about a choice somebody made on purpose is
 * what §4 exists to prevent.
 */
export function rail(opts = {}) {
    const { ariaLabel = null } = opts;
    const wrap = el('div', 'fbk-rail');
    wrap.setAttribute('role', 'img');
    if (ariaLabel) wrap.setAttribute('aria-label', ariaLabel);
    const line = el('div', 'fbk-rail-line');
    const dots = el('div', 'fbk-rail-dots');
    const marks = el('div', 'fbk-rail-marks');
    wrap.appendChild(line);
    wrap.appendChild(dots);
    wrap.appendChild(marks);

    let signature = '';

    return {
        el: wrap,
        /**
         * `rungs` is `[{ value, label, state }]`, state `done | on | next`.
         * Rebuilt only when the shape changes, so an idle tick is a class swap.
         */
        set(rungs) {
            const list = Array.isArray(rungs) ? rungs : [];
            /* A 21-rung ladder's dots would overlap at 12px. */
            wrap.dataset.dense = list.length > 8 ? 'true' : 'false';
            /*
             * How many equal cells the two rows are divided into, so the line
             * can start and end at the OUTER DOTS' centres rather than at the
             * rail's edges. CSS cannot count children, and this is cheaper
             * than a resize observer.
             */
            wrap.style.setProperty('--fbk-cells', String(Math.max(1, list.length)));
            const sig = list.map((r) => r.value + ':' + (r.label === undefined ? '' : r.label)).join(',');
            if (sig !== signature) {
                signature = sig;
                dots.textContent = '';
                marks.textContent = '';
                /*
                 * EVERY DOT, BUT NOT EVERY LABEL.
                 *
                 * A step of +2 from 60 is 21 rungs, and 21 numbers in 330px is
                 * a smear. The dots are the ladder and they all belong — the
                 * shape of the climb is the information — while the labels are
                 * a convenience, so above a handful only the ends and every
                 * nth survive. The current rung is labelled by `set()` below
                 * whatever this leaves, because that one is never optional.
                 */
                const every = list.length <= 6 ? 1 : Math.ceil(list.length / 5);
                for (let i = 0; i < list.length; i += 1) {
                    const r = list[i];
                    /*
                     * A dot inside a CELL, not as the cell.
                     *
                     * The cells are what divide the rail into equal shares so
                     * a number lands under its dot; a dot itself is a fixed
                     * 12px circle. Making the dot the cell made it stretch to
                     * fill its share — one wide blue pill where a round dot
                     * belonged, which is what shipped for one version.
                     */
                    const cell = el('span', 'fbk-rail-cell');
                    cell.appendChild(el('span', 'fbk-rail-dot'));
                    dots.appendChild(cell);
                    const keep = i === 0 || i === list.length - 1 || i % every === 0;
                    marks.appendChild(el('span', 'fbk-rail-mark',
                        keep ? String(r.label === undefined ? r.value : r.label) : ''));
                }
            }
            const dn = dots.children;
            const mn = marks.children;
            for (let i = 0; i < list.length; i += 1) {
                /* `dn[i]` is the cell; the dot is its only child. */
                const dot = dn[i] && dn[i].children[0];
                if (dot) dot.dataset.state = list[i].state || 'next';
                if (!mn[i]) continue;
                mn[i].dataset.state = list[i].state || 'next';
                /*
                 * The rung you are ON always carries its number, even on a
                 * ladder too dense to label. "Which speed am I playing at" is
                 * the one question the rail exists to answer.
                 */
                if (list[i].state === 'on' && !mn[i].textContent) {
                    mn[i].textContent = String(list[i].label === undefined ? list[i].value : list[i].label);
                }
            }
            /*
             * The line fills to the current rung, so progress is a LENGTH.
             * Without it the only cue is how many dots are green, which is a
             * number you have to count — and counting is the thing a HUD is
             * supposed to save you.
             */
            /*
             * The fill is a fraction of the line, and the line now spans the
             * outer dots' centres — so the current rung's index over the gaps
             * between them is exactly right, with no edge correction.
             */
            const onAt = list.findIndex((r) => r.state === 'on');
            const pct = list.length > 1 && onAt >= 0 ? (onAt / (list.length - 1)) * 100 : 0;
            line.style.setProperty('--fbk-fill', pct + '%');
        },
    };
}

/**
 * An LED METER — a discrete grade bar.
 *
 * Segments rather than a smooth fill, because what it reports IS discrete: a
 * count of judged notes, of attempts, of cleared runs. A continuous bar
 * promises a precision the number behind it does not have — and at 8% a smooth
 * meter is a sliver you cannot see, while ten cells with one lit is
 * unambiguous.
 *
 * Grade colours only, and never on anything pressable (§3).
 */
export function ledMeter(opts = {}) {
    const { segments = 10 } = opts;
    const wrap = el('span', 'fbk-led');
    const cells = [];
    for (let i = 0; i < segments; i += 1) {
        const c = el('span', 'fbk-led-cell');
        cells.push(c);
        wrap.appendChild(c);
    }
    return {
        el: wrap,
        /** `value` 0..100 and a band name. A nullish value lights nothing. */
        set(value, bandName) {
            const v = num(value);
            const lit = v === null ? 0 : Math.round((Math.max(0, Math.min(100, v)) / 100) * segments);
            for (let i = 0; i < cells.length; i += 1) {
                if (i < lit && bandName) cells[i].dataset.band = bandName;
                else delete cells[i].dataset.band;
            }
        },
    };
}

/**
 * A STATUS LINE whose chrome scales with urgency.
 *
 *     ● ok — a plain line, no well
 *     ┌────────────────────────────────────────────────┐
 *     │ ● blocked — a well, an amber stroke    Fix ›   │
 *     └────────────────────────────────────────────────┘
 *
 * Three states, three amounts of furniture, and that is the part worth
 * copying: a message that is merely true gets a line; a message that stops you
 * gets cut into the chassis and outlined.
 *
 * `ok` is SILENT unless a caller insists. "Everything is normal" is a signal
 * that carries nothing (§16) — the green dot on a primary, again — so nothing
 * is drawn until there is something to say.
 *
 * `act` adds the trailing link, because a blocked state you cannot act on is a
 * dead end. If there is a fix, it belongs within reach of the sentence.
 */
export function statusLine() {
    const wrap = el('div', 'fbk-status');
    wrap.hidden = true;
    wrap.appendChild(el('span', 'fbk-status-dot'));
    const text = el('span', 'fbk-status-text');
    const action = el('button', 'fbk-status-action');
    action.type = 'button';
    action.hidden = true;
    wrap.appendChild(text);
    wrap.appendChild(action);

    let handler = null;
    action.addEventListener('click', () => { if (handler) handler(); });

    return {
        el: wrap,
        /** `state` is `ok | warn | blocked`, or nullish to say nothing. */
        set(state, message, act = null) {
            const quiet = !state || !message;
            wrap.hidden = quiet;
            if (quiet) { handler = null; action.hidden = true; return; }
            wrap.dataset.state = state;
            text.textContent = String(message);
            handler = act && typeof act.onClick === 'function' ? act.onClick : null;
            action.hidden = !handler;
            action.textContent = handler ? String(act.label) + ' ›' : '';
        },
    };
}

/**
 * A LIST ROW — a name, a grade, a value, and a way in.
 *
 * `h-md`, because it is pressed while the song is running.
 */
export function listRow(opts = {}) {
    const {
        label = '', value = null, band: bandName = null,
        title = '', onClick = null, segments = 12,
    } = opts;
    const row = el(onClick ? 'button' : 'div', 'fbk-list-row');
    if (onClick) {
        row.type = 'button';
        row.addEventListener('click', onClick);
    }
    if (title) row.title = title;
    row.appendChild(el('span', 'fbk-list-name', label));
    const meter = ledMeter({ segments });
    meter.set(value, bandName);
    row.appendChild(meter.el);
    row.appendChild(el('span', 'fbk-list-value', num(value) === null ? '–' : Math.round(num(value)) + '%'));
    if (onClick) row.appendChild(el('span', 'fbk-list-chev', '›'));
    return row;
}

/**
 * A RANGE STRIP — the phrase timeline, and the only loop selector there is.
 *
 *     ┌──┬────────────┬──┐
 *     │A │            │B │   ▮▮▯▮▮▯▯▮▮▯
 *     └──┴────────────┴──┘
 *
 * One control replaced four: mode tabs, section chevrons, a phrase stepper and
 * two rows of edge steppers. The argument is direct manipulation — the thing
 * you want to say is "loop from here to here", and every one of those controls
 * was a way of spelling that out in numbers instead of pointing at it.
 *
 * Three gestures, and they do not overlap:
 *   - **tap a block** loops that block
 *   - **drag a handle** moves that edge, snapping to block edges
 *   - **drag across the blocks** takes a fresh range
 *
 * The blocks stay PROPORTIONAL to the song, because the strip is a map and a
 * map whose widths lie is not one. Which makes some blocks too thin to hit, so
 * the geometry and the hit test are separate: every block gets a target at
 * least `minHit` wide grown about its own centre, and a tap picks the target
 * whose centre is nearest. Nothing moves on screen. (§12.)
 *
 * A block with nothing in it is drawn and NOT in the hit table — the strip
 * stays truthful about the song's shape while refusing to let you land
 * somewhere nothing can happen.
 *
 * `onPick(key)`, `onEdge(which, seconds)` and `onDrag(a, b)` are the whole
 * write surface; the strip holds no state and is redrawn from `set()`.
 */
export function rangeStrip(opts = {}) {
    const {
        minHit = 40, ariaLabel = null,
        onPick = null, onEdge = null, onDrag = null,
        slop = 4,
    } = opts;

    const wrap = el('div', 'fbk-strip');
    wrap.setAttribute('role', 'group');
    if (ariaLabel) wrap.setAttribute('aria-label', ariaLabel);
    const blocks = el('div', 'fbk-strip-blocks');
    const sel = el('div', 'fbk-strip-sel');
    const handleA = el('button', 'fbk-strip-handle', 'A');
    const handleB = el('button', 'fbk-strip-handle', 'B');
    handleA.type = 'button';
    handleB.type = 'button';
    handleA.dataset.edge = 'start';
    handleB.dataset.edge = 'end';
    handleA.title = 'Drag to move the loop start — snaps to a phrase edge';
    handleB.title = 'Drag to move the loop end — snaps to a phrase edge';
    sel.appendChild(handleA);
    sel.appendChild(handleB);
    wrap.appendChild(blocks);
    wrap.appendChild(sel);

    let items = [];          // [{key, start, end, events, band, graduated}]
    let duration = 0;
    let hits = [];           // [{key, centre, from, to}] in px
    let signature = '';
    const nodes = new Map();

    const rect = () => wrap.getBoundingClientRect();
    const timeAt = (clientX) => {
        const r = rect();
        if (!r.width || !duration) return 0;
        const x = Math.max(0, Math.min(r.width, clientX - r.left));
        return (x / r.width) * duration;
    };

    /**
     * The block boundary nearest a time — what a handle snaps to.
     *
     * ZERO AND THE DURATION COUNT AS BOUNDARIES. Without them, dragging A to
     * the very start snapped to the first block's start instead, which on a
     * chart whose first phrase begins at 0:03 meant the loop could not be
     * moved before 0:03 however far you dragged — reported exactly that way.
     * The song's own ends are edges; leaving them out made the strip narrower
     * than the song it draws.
     */
    function snap(seconds) {
        let best = seconds;
        let dist = Infinity;
        const edges = [0, duration];
        for (const it of items) edges.push(it.start, it.end);
        for (const edge of edges) {
            if (!Number.isFinite(edge)) continue;
            const d = Math.abs(edge - seconds);
            if (d < dist) { dist = d; best = edge; }
        }
        return best;
    }

    function hitAt(clientX) {
        if (!hits.length) return null;
        const x = clientX - rect().left;
        let best = null;
        let bestDist = Infinity;
        for (const h of hits) {
            if (x < h.from || x > h.to) continue;
            const d = Math.abs(x - h.centre);
            if (d < bestDist) { bestDist = d; best = h.key; }
        }
        return best;
    }

    /*
     * A drag on a HANDLE and a drag on the STRIP are different gestures, and
     * the handle has to win — it sits on top of the blocks, so without the
     * `dragging` guard a grab of the handle would also start a fresh range
     * underneath it.
     */
    let dragging = null;     // 'start' | 'end'
    let sweepFrom = null;    // {x, t}

    for (const h of [handleA, handleB]) {
        h.addEventListener('pointerdown', (e) => {
            dragging = h.dataset.edge;
            h.setPointerCapture?.(e.pointerId);
            e.stopPropagation();
        });
        h.addEventListener('pointermove', (e) => {
            if (dragging !== h.dataset.edge || !onEdge) return;
            onEdge(dragging, snap(timeAt(e.clientX)));
        });
        h.addEventListener('pointerup', () => { dragging = null; });
        h.addEventListener('pointercancel', () => { dragging = null; });
    }

    wrap.addEventListener('pointerdown', (e) => {
        if (dragging) return;
        sweepFrom = { x: e.clientX, t: timeAt(e.clientX) };
    });
    wrap.addEventListener('pointermove', (e) => {
        if (dragging || !sweepFrom || !onDrag) return;
        if (Math.abs(e.clientX - sweepFrom.x) < slop) return;
        const t = timeAt(e.clientX);
        onDrag(Math.min(sweepFrom.t, t), Math.max(sweepFrom.t, t));
    });
    wrap.addEventListener('pointerup', (e) => {
        if (dragging) { dragging = null; sweepFrom = null; return; }
        if (!sweepFrom) return;
        // Under the slop it was a tap, which loops the block it landed on.
        if (Math.abs(e.clientX - sweepFrom.x) < slop && onPick) {
            const key = hitAt(e.clientX);
            if (key) onPick(key);
        }
        sweepFrom = null;
    });

    return {
        el: wrap,
        handles: { start: handleA, end: handleB },
        /**
         * `list` is the blocks, `range` is `{start, end}` or null.
         *
         * `band` paints the grade; `events === 0` marks a block as empty and
         * takes it out of the hit table. `null` events means NOT COUNTED YET
         * and is left alone — `Number(null)` is 0, and reading absent as empty
         * is how a whole strip once went inert between a song loading and its
         * chart arriving.
         */
        set(list, songSeconds, range) {
            items = Array.isArray(list) ? list : [];
            duration = Number(songSeconds) > 0 ? Number(songSeconds) : 0;

            const sig = items.map((i) => i.key).join('|') + '@' + duration;
            if (sig !== signature) {
                signature = sig;
                blocks.textContent = '';
                nodes.clear();
                for (const it of items) {
                    const b = el('div', 'fbk-strip-block');
                    b.dataset.key = it.key;
                    b.style.left = ((it.start / duration) * 100) + '%';
                    b.style.width = (((it.end - it.start) / duration) * 100) + '%';
                    nodes.set(it.key, b);
                    blocks.appendChild(b);
                }
            }

            for (const it of items) {
                const node = nodes.get(it.key);
                if (!node) continue;
                node.dataset.band = it.band || 'none';
                node.dataset.empty = num(it.events) === 0 ? 'true' : 'false';
                node.classList.toggle('fbk-strip-block-done', !!it.graduated);
                if (it.title) node.title = it.title;
            }

            /*
             * The hit table: each selectable block's own extent, PADDED by
             * half a hit target on each side, resolved by nearest centre.
             *
             * The padding is what makes a thin block reachable, and it is
             * also what makes the two empty-block behaviours fall out of one
             * rule. Growing symmetrically about the CENTRE instead — which is
             * what this did first — left a dead band wherever an empty block
             * sat between two blocks already wider than `minHit`: neither
             * neighbour grew, so a 3px gap swallowed taps and gave no reason.
             * Padding the edges tiles a small gap and still leaves a wide one
             * dead, which is the right pair: a tap that silently jumps an inch
             * away is worse than a tap that plainly does nothing.
             */
            const w = rect().width || 0;
            const pad = minHit / 2;
            hits = items
                .filter((it) => num(it.events) !== 0)
                .map((it) => {
                    const l = (it.start / duration) * w;
                    const r = (it.end / duration) * w;
                    return { key: it.key, centre: (l + r) / 2, from: l - pad, to: r + pad };
                });

            const has = range && duration > 0
                && Number.isFinite(Number(range.start)) && Number.isFinite(Number(range.end));
            sel.hidden = !has;
            if (has) {
                sel.style.left = ((range.start / duration) * 100) + '%';
                sel.style.width = (((range.end - range.start) / duration) * 100) + '%';
            }
        },
        /** Light the block under the playhead's key, or nothing. */
        mark(key) {
            for (const [k, node] of nodes) node.classList.toggle('fbk-strip-block-at', k === key);
        },
        disable(off) {
            handleA.disabled = !!off;
            handleB.disabled = !!off;
        },
    };
}

/**
 * A FOLDED STRIP — the panel, shrunk to what you can read while playing.
 *
 *     ┌──────────────────────────────────────────────┐
 *     │  LIVE  SPEED                3 runs to goal   │
 *     │  91%   ●───◉───○───○───○                     │
 *     │  ● Intro 1  ▮▮▮▯▯▯   4/7 · 0:41.2            │
 *     └──────────────────────────────────────────────┘
 *
 * No buttons in it. The WHOLE BLOCK is the target, because the one thing you
 * might want mid-song is "give me the rest of it" and aiming at a chevron with
 * a guitar in your hands is not a gesture. Hover and focus turn the stroke and
 * the grip blue and reveal the key hint in the corner — the affordance appears
 * when you go looking for it and stays out of the way when you do not.
 *
 * It is a STATE of the panel, not a second widget: same layer, same open and
 * close, same shortcut registry. Two objects would be two z-indexes, two
 * lifecycles, and two places for a bug about which one is showing.
 */
export function foldedStrip(opts = {}) {
    const { label = 'OPEN', hint = null, onOpen = null } = opts;
    const wrap = el('button', 'fbk-folded');
    wrap.type = 'button';
    wrap.setAttribute('aria-expanded', 'false');
    if (onOpen) wrap.addEventListener('click', onOpen);

    wrap.appendChild(el('span', 'fbk-folded-grip'));
    const body = el('span', 'fbk-folded-body');
    const cue = el('span', 'fbk-folded-cue', hint ? `${label} · ${hint}` : label);
    wrap.appendChild(body);
    wrap.appendChild(cue);

    return {
        el: wrap,
        /** Append the readouts here. Nothing pressable — the block is the button. */
        body,
        setCue(text) { cue.textContent = text === null || text === undefined ? '' : String(text); },
    };
}

/** A big tabular number with a small unit — DESIGN.md §7. */
export function readout(unit) {
    const wrap = el('span', 'fbk-readout');
    const value = el('span', 'fbk-readout-value', '–');
    wrap.appendChild(value);
    if (unit) wrap.appendChild(el('span', 'fbk-readout-unit', unit));
    return {
        el: wrap,
        set(v) { value.textContent = (v === null || v === undefined) ? '–' : String(v); },
    };
}

/** The slab of facts about whatever is selected. */
export function plate() {
    const wrap = el('div', 'fbk-plate');
    const title = el('span', 'fbk-plate-title');
    const meta = el('span', 'fbk-plate-meta');
    wrap.appendChild(title);
    wrap.appendChild(meta);
    return {
        el: wrap,
        set(t, m) {
            title.textContent = t || '';
            meta.textContent = m || '';
        },
    };
}

/**
 * FAMILY 1 — segmented. Pick one of a small fixed set.
 *
 * `items` is `[{ value, label, title }]`. `onPick` gets the value.
 */
export function segmented(items, onPick, ariaLabel, opts = {}) {
    /*
     * TWO SIZES, and the rule is when you touch it, not what it holds.
     *
     *   row     `h-md` — values you change while setting up a passage
     *   header  `h-sm` — a unit or a mode set once, in a rack's header slot
     *
     * A `TIME | BARS` switch and a `+2 | +5 | +10` step are the same widget
     * and want different sizes, because one of them you set on the first day
     * and the other you reach for every passage.
     */
    const wrap = el('div', opts.size === 'header' ? 'fbk-seg fbk-seg-header' : 'fbk-seg');
    wrap.setAttribute('role', 'group');
    if (ariaLabel) wrap.setAttribute('aria-label', ariaLabel);
    const nodes = new Map();
    for (const it of (items || [])) {
        const b = button('fbk-seg-btn', it.label, it.title || null, () => onPick(it.value));
        b.setAttribute('aria-pressed', 'false');
        nodes.set(it.value, b);
        wrap.appendChild(b);
    }
    return {
        el: wrap,
        /** Light exactly one. */
        set(value) {
            for (const [v, b] of nodes) {
                const on = v === value;
                b.classList.toggle('fbk-on', on);
                b.setAttribute('aria-pressed', on ? 'true' : 'false');
            }
        },
        disable(off) { for (const [, b] of nodes) b.disabled = !!off; },
        node(value) { return nodes.get(value) || null; },
        values() { return [...nodes.keys()]; },
    };
}

/**
 * FAMILY 2 — chips. Pick a subset, and optionally show progress through it.
 *
 * `rail: true` puts them on a track, which is what lets the same widget be a
 * setting when idle and a progress display when something is running —
 * DESIGN.md §5, and the best control the kit has.
 *
 * State per chip is one of: `null` (not in the set), `'on'` (in it), `'now'`
 * (where we are), `'done'` (cleared).
 */
export function chips(items, onToggle, opts = {}) {
    const wrap = el('div', opts.rail ? 'fbk-chips fbk-chips-rail' : 'fbk-chips');
    wrap.setAttribute('role', 'group');
    if (opts.ariaLabel) wrap.setAttribute('aria-label', opts.ariaLabel);
    const nodes = new Map();

    function add(it) {
        const b = button('fbk-chip', it.label, it.title || null, () => onToggle(it.value));
        nodes.set(it.value, b);
        wrap.appendChild(b);
        return b;
    }
    for (const it of (items || [])) add(it);

    return {
        el: wrap,
        /**
         * Rebuild only when the SET changed.
         *
         * A rebuilt chip is a chip that cannot be clicked, and a panel that
         * re-renders twice a second would rebuild them mid-click. `signature`
         * is whatever string identifies the current set.
         */
        rebuild(signature, items2) {
            if (wrap.dataset.sig === signature) return false;
            wrap.dataset.sig = signature;
            wrap.textContent = '';
            nodes.clear();
            for (const it of (items2 || [])) add(it);
            return true;
        },
        set(states) {
            for (const [v, b] of nodes) {
                const s = states ? states[v] : null;
                b.classList.toggle('fbk-on', s === 'on');
                b.classList.toggle('fbk-now', s === 'now');
                b.classList.toggle('fbk-done', s === 'done');
            }
        },
        title(value, text) {
            const b = nodes.get(value);
            if (b) b.title = text || '';
        },
        disable(off, only) {
            for (const [v, b] of nodes) {
                b.disabled = !!off && (!only || only.includes(v));
            }
        },
        node(value) { return nodes.get(value) || null; },
    };
}

/** FAMILY 3 — a boolean. */
export function toggle(label, title, onChange) {
    const wrap = el('label', 'fbk-toggle');
    if (title) wrap.title = title;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.addEventListener('change', () => onChange(input.checked));
    wrap.appendChild(input);
    /*
     * TEXT FIRST, then the switch.
     *
     * It read switch-then-text, which is the form convention and the wrong one
     * here: these live in a rack's header, right-aligned against the panel's
     * edge, so the switch has to be the thing nearest that edge or the row
     * ends in a word and the control floats in the middle of it.
     */
    wrap.appendChild(el('span', 'fbk-toggle-text', label));
    wrap.appendChild(el('span', 'fbk-toggle-track'));
    return {
        el: wrap,
        input,
        set(on) { input.checked = !!on; },
        disable(off) { input.disabled = !!off; },
    };
}

/**
 * FAMILY 4 — a number you nudge.
 *
 * No text input, deliberately: a number you type reads as a form. Values the
 * steps cannot reach belong on the settings page (DESIGN.md §1).
 */
export function stepper(opts = {}) {
    const {
        unit = '',
        step = 1,
        min = -Infinity,
        max = Infinity,
        onChange = () => {},
        downTitle = 'Less',
        upTitle = 'More',
        /**
         * How the value is printed, when it is not just a number.
         *
         * A clock, a bar number, a ratio. Without it a stepper can only hold
         * an integer with a unit, which covers most of them and not the ones
         * that matter most — a loop edge reads `0:03.0`, and formatting that
         * in the caller would mean the caller also owning the readout.
         */
        format = null,
    } = opts;

    const wrap = el('div', opts.wide ? 'fbk-stepper fbk-stepper-wide' : 'fbk-stepper');
    let value = num(opts.value) ?? 0;

    const down = button('fbk-step', '−', downTitle, () => bump(-step));

    /*
     * THE LABEL NAMES THE UNIT, and it goes INSIDE the stepper.
     *
     *     ┌───┬──────────┬───┐
     *     │ − │  START   │ + │
     *     │   │   80%    │   │
     *     └───┴──────────┴───┘
     *
     * Two steppers side by side with their legends in a separate label column
     * is two rows and a guess about which legend belongs to which; stacked
     * over the value it names, a stepper is one object you can read on its
     * own. It is also what lets `A · ±1 bar` exist at all — the label carries
     * both what the control is and what one press does, which no external
     * legend has room for.
     *
     * The `emph` flag paints the value blue: on a rack of steppers, one of
     * them is the number that drives the drill and the rest are policy.
     */
    const stack = el('div', 'fbk-stepper-stack');
    const legend = opts.label ? el('span', 'fbk-stepper-label', opts.label) : null;
    if (legend) stack.appendChild(legend);
    const out = readout(unit);
    if (opts.emph) out.el.dataset.emph = '1';
    stack.appendChild(out.el);

    const up = button('fbk-step', '+', upTitle, () => bump(step));
    wrap.appendChild(down);
    wrap.appendChild(stack);
    wrap.appendChild(up);

    function bump(by) {
        const next = Math.max(min, Math.min(max, value + by));
        if (next === value) return;
        value = next;
        out.set(format ? format(value) : value);
        sync();
        onChange(value);
    }

    function sync() {
        down.disabled = wrap.dataset.off === '1' || value <= min;
        up.disabled = wrap.dataset.off === '1' || value >= max;
    }

    out.set(format ? format(value) : value);
    sync();

    return {
        el: wrap,
        /** The legend above the value, for a caller that renames the unit. */
        label: legend,
        /**
         * The two buttons, so a caller can rewire them.
         *
         * A stepper usually owns its number: press, clamp, report. Some do
         * not — a loop edge is a TIME the model owns, and the buttons ask it
         * to move rather than changing anything here. Exposing them beats a
         * second half-stepper component whose only difference is who holds
         * the value.
         */
        down,
        up,
        get() { return value; },
        set(v) {
            const n = num(v);
            if (n === null) return;
            value = Math.max(min, Math.min(max, n));
            out.set(format ? format(value) : value);
            sync();
        },
        disable(off) {
            wrap.dataset.off = off ? '1' : '0';
            sync();
        },
    };
}

/** A HUD gauge that is still an `<input type="range">`, for the keyboard. */
/**
 * A gauge you drag: label, value, track — in that order, on one row.
 *
 *     CHART  100 %   ●━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * The order is the point. Version 0.4 put the value AFTER the track, which
 * spends the row on three separated things and leaves the track 129px of a
 * 306px body — 42% of the width for the only part you touch. 0.5 fixed the
 * width by stacking a label line above a full-width track, and that cost a
 * row and left the label and its value at opposite ends of it.
 *
 * Putting the value next to its label fixes both: they read as one thing
 * (Refactoring UI's "combine labels and values"), and the track gets
 * everything left over — 216px here — on one row.
 */
export function slider(opts = {}) {
    const {
        min = 0, max = 100, step = 1, unit = '%',
        ariaLabel, onInput = () => {},
        label = '',
    } = opts;

    const wrap = el('div', 'fbk-row fbk-slider-row');

    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'fbk-slider';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    if (ariaLabel) input.setAttribute('aria-label', ariaLabel);

    const out = readout(unit);
    input.addEventListener('input', () => {
        out.set(input.value);
        onInput(Number(input.value));
    });

    const heading = label ? el('span', 'fbk-label fbk-label-inline fbk-slider-label', label) : null;
    /*
     * WITH a label: label, value, track — the value beside the word that names
     * it, so they read as one unit and the track takes the rest.
     *
     * WITHOUT one: track, then value. A label-less slider is inside a `field`
     * whose legend already names it, so there is nothing for the value to pair
     * with on the left — and putting it there instead left the track ending
     * 62px short of the field's edge, which is the "the difficulty bar does
     * not go all the way" report.
     */
    if (heading) {
        wrap.appendChild(heading);
        wrap.appendChild(out.el);
        wrap.appendChild(input);
    } else {
        wrap.appendChild(input);
        wrap.appendChild(out.el);
    }

    return {
        el: wrap,
        input,
        /** The label node, for a caller that wants to retitle it. */
        label: heading,
        /** Skipped while focused, so it cannot fight the user's drag. */
        set(v) {
            const n = num(v);
            if (n !== null && document.activeElement !== input) input.value = String(n);
            out.set(input.value);
        },
        disable(off) { input.disabled = !!off; },
    };
}

export function meterRow(opts = {}) {
    const { label = '', value = 0, band = null, title = '', onClick = null, suffix = null } = opts;
    const row = el(onClick ? 'button' : 'div', 'fbk-meter-row');
    if (onClick) {
        row.type = 'button';
        row.addEventListener('click', onClick);
    }
    if (title) row.title = title;
    row.appendChild(el('span', 'fbk-meter-name', label));
    const bar = el('span', 'fbk-meter');
    if (band) bar.dataset.band = band;
    const v = num(value) ?? 0;
    bar.style.setProperty('--fbk-fill', Math.max(0, Math.min(100, Math.round(v))) + '%');
    row.appendChild(bar);
    row.appendChild(el('span', 'fbk-meter-value', Math.round(v) + '%'));
    if (suffix) row.appendChild(suffix);
    return row;
}

/**
 * The band for an accuracy, using the app's own splits.
 *
 * The null check is separate from the finite check on purpose: `Number(null)`
 * is 0, so a never-measured value would otherwise colour exactly like one you
 * missed every note of.
 */
export function band(accuracy) {
    const a = num(accuracy);
    if (a === null) return null;
    if (a >= 0.9) return 'good';
    if (a >= 0.5) return 'mid';
    return 'bad';
}
