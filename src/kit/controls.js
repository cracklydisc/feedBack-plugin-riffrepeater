/*
 * kit 0.4.0 — the four control families, as builders.
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

    head.appendChild(heading);
    head.appendChild(sum);
    head.appendChild(chev);

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
        /**
         * The value, kept visible while the body is shut.
         *
         * Whatever the controls inside say, said in one line. A fold whose
         * summary does not answer the question the controls answer is a fold
         * that hides rather than folds.
         */
        setSummary(text) { sum.textContent = text === null || text === undefined ? '' : String(text); },
        setOpen,
        toggle() { setOpen(!isOpen); },
        isOpen() { return isOpen; },
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
export function segmented(items, onPick, ariaLabel) {
    const wrap = el('div', 'fbk-seg');
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
    wrap.appendChild(el('span', 'fbk-toggle-track'));
    wrap.appendChild(el('span', 'fbk-toggle-text', label));
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
    } = opts;

    const wrap = el('div', opts.wide ? 'fbk-stepper fbk-stepper-wide' : 'fbk-stepper');
    let value = num(opts.value) ?? 0;

    const down = button('fbk-step', '−', downTitle, () => bump(-step));
    const out = readout(unit);
    const up = button('fbk-step', '+', upTitle, () => bump(step));
    wrap.appendChild(down);
    wrap.appendChild(out.el);
    wrap.appendChild(up);

    function bump(by) {
        const next = Math.max(min, Math.min(max, value + by));
        if (next === value) return;
        value = next;
        out.set(value);
        sync();
        onChange(value);
    }

    function sync() {
        down.disabled = wrap.dataset.off === '1' || value <= min;
        up.disabled = wrap.dataset.off === '1' || value >= max;
    }

    out.set(value);
    sync();

    return {
        el: wrap,
        get() { return value; },
        set(v) {
            const n = num(v);
            if (n === null) return;
            value = Math.max(min, Math.min(max, n));
            out.set(value);
            sync();
        },
        disable(off) {
            wrap.dataset.off = off ? '1' : '0';
            sync();
        },
    };
}

/** A HUD gauge that is still an `<input type="range">`, for the keyboard. */
export function slider(opts = {}) {
    const { min = 0, max = 100, step = 1, unit = '%', ariaLabel, onInput = () => {} } = opts;
    const wrap = el('div', 'fbk-row');
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
    wrap.appendChild(input);
    wrap.appendChild(out.el);
    return {
        el: wrap,
        input,
        /** Skipped while focused, so it cannot fight the user's drag. */
        set(v) {
            const n = num(v);
            if (n !== null && document.activeElement !== input) input.value = String(n);
            out.set(input.value);
        },
        disable(off) { input.disabled = !!off; },
    };
}

/**
 * A clickable meter row: name, bar, number.
 *
 * The one shape for measured data. `band` is 'good' | 'mid' | 'bad', matching
 * the host's own accuracy palette — do not invent thresholds.
 */
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
