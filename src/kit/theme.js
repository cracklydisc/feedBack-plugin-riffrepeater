/*
 * kit 0.5.0 — the token bridge.
 *
 * Reads the host's palette and writes it back as `--fbk-*` custom properties
 * that a stylesheet can use, then follows `theme:changed`. This existed three
 * times across three plugins in three different shapes before it lived here:
 * `tidy/src/theme.js` (62 lines), `riffrepeater/src/theme.js` (65 lines), and
 * Live Tab's `ink()` / `inkOn()` helpers building inline style strings.
 *
 * TWO LAYERS, following the app's own proposal in docs/host-theme-contract.md.
 *
 * Layer 1 — ROLES. Colours, as the `"r g b"` triplets the host uses, consumed
 * as `rgb(var(--fbk-accent))` with optional alpha `rgb(var(--fbk-accent) / .4)`.
 * These come straight from `feedBack.theme.get().tokens`, so an equipped shop
 * theme moves every consumer at once.
 *
 * Layer 2 — RECIPES. Devices, as full CSS values: how *this* look makes a
 * primary special, how it lights an active cell, what a panel's elevation is.
 * The host does not ship these yet (the contract is a proposal and its
 * `theme-contract.css` does not exist), so the kit fills them — with the
 * app's default neon-ish sky-on-navy as the default recipe.
 *
 * The point of the split is the rule in DESIGN.md §6: a consumer references a
 * role or a slot and never writes a device. `none` is a legal value for every
 * slot except `--fbk-meter-fill`, so a glow-less skin can neutralise the glow
 * and get a solid border instead of a control that vanished.
 *
 * WHY THE HOST'S `--fbv-*` ARE NOT READ: they are documented as internal
 * plumbing. `feedBack.theme.get()` is the sanctioned surface, and it is
 * feature-detected here so an older host falls back to the defaults below —
 * which are the host's own palette, so the fallback looks like the app.
 */

/** role -> the default `"r g b"`, mirroring the host's own `fb` palette. */
const ROLES = {
    bg: '15 23 42',
    sidebar: '17 24 39',
    surface: '30 41 59',          // host `card`
    surface2: '11 18 32',         // host `cardMuted`
    border: '51 65 85',
    text: '248 250 252',
    dim: '148 163 184',           // host `textDim`
    accent: '14 165 233',         // host `primary` — the app's interactive blue
    accentHi: '56 189 248',       // host `primaryHi`
    alert: '239 68 68',           // host `accent` — destructive / support
    good: '34 197 94',
    mid: '234 179 8',
    bad: '239 68 68',
    gold: '232 192 64',
    onAccent: '248 250 252',
    focus: '56 189 248',
};

/** Which host token each role reads from. */
const FROM_HOST = {
    bg: 'bg',
    sidebar: 'sidebar',
    surface: 'card',
    surface2: 'cardMuted',
    border: 'border',
    text: 'text',
    dim: 'textDim',
    accent: 'primary',
    accentHi: 'primaryHi',
    alert: 'accent',
    good: 'good',
    mid: 'mid',
    bad: 'low',
    gold: 'gold',
    onAccent: 'on-accent',
    focus: 'focus-ring',
};

/**
 * Layer 2 defaults — the app's own look, as devices AND as measurements.
 *
 * Written in terms of the Layer 1 roles so an equipped theme recolours them
 * without touching this table. A skin that wants a different LANGUAGE (no
 * glow, a bevel, a texture, tighter type) overrides the slots rather than the
 * roles.
 *
 * ── THE THREE SCALES ────────────────────────────────────────────────────
 *
 * These are the part that was missing. Before them the CSS used 10, 11, 12, 13
 * and 20px type and 6, 7, 8, 9, 10, 11, 12 and 15px spacing, all picked per
 * rule — which is exactly what "approximate" looks like from a metre away.
 *
 * TYPE — five steps, and no element may invent a sixth. A `font` shorthand
 * cannot carry letter-spacing, so each step is a pair: `--fbk-t-X` for the
 * shorthand and `--fbk-t-X-track` for the tracking.
 *
 * SPACE — a 2px base, six steps. No margin, padding or gap in the kit is a
 * number; every one of them is `var(--fbk-s-N)`.
 *
 * HEIGHT — three heights, and every interactive control is exactly one of
 * them. That is what makes rows share a baseline instead of each row being as
 * tall as whatever it happens to contain.
 */
const RECIPES = {
    /* ── type ───────────────────────────────────────────────────────────
     *
     * The family is named rather than inherited, because a `font` shorthand
     * needs a real family — `font: 500 13px/1.45 inherit` is invalid and
     * silently drops the whole declaration. This is the app's own body stack
     * (`fontFamily.display` in its tailwind.config.js); v3's Rubik is a
     * display face for headings and not what a panel of controls wants.
     */
    font: '"Inter", system-ui, sans-serif',

    /* The one big number in a panel. */
    't-display': '800 22px/1.05 var(--fbk-font)',
    't-display-track': '-0.01em',
    /* An inline readout: a stepper's value, a meter's percentage. */
    't-value': '800 16px/1.1 var(--fbk-font)',
    't-value-track': '0',
    /* Prose, and the title of a plate. */
    't-body': '500 13px/1.45 var(--fbk-font)',
    't-body-track': '0',
    /* Control labels and button text. */
    't-label': '700 11px/1.25 var(--fbk-font)',
    't-label-track': '0.01em',
    /* Section headings and key caps. Uppercase is applied by the component. */
    't-micro': '800 10px/1.2 var(--fbk-font)',
    't-micro-track': '0.1em',

    /* ── space: a 2px base ────────────────────────────────────────────── */
    's-1': '2px',
    's-2': '4px',
    's-3': '6px',
    's-4': '10px',
    's-5': '14px',
    's-6': '20px',

    /* ── control heights: three, and no others ────────────────────────── */
    'h-sm': '26px',   /* chip, small button, icon button */
    'h-md': '32px',   /* segmented cell, stepper, standard button */
    'h-lg': '44px',   /* the one primary */

    /*
     * The width every inline label shares.
     *
     * Without it each row's control started at a different x, because the
     * labels are different lengths — visible and wrong in a 336px panel. A
     * label that does not fit becomes a block label instead of widening this.
     */
    'label-w': '62px',

    /* The thickness of a hairline, so a skin can make them heavier. */
    hairline: '1px',

    /* ── devices ──────────────────────────────────────────────────────
     * How a primary action is made special. At least one of fill/border/halo
     * must be non-none, or a primary would be visually flat. */
    'emph-fill': 'linear-gradient(180deg, rgb(var(--fbk-accent-hi)), rgb(var(--fbk-accent)))',
    'emph-border': '1px solid rgb(var(--fbk-accent-hi) / 0.7)',
    'emph-halo': '0 0 0 1px rgb(var(--fbk-accent) / 0.45), 0 8px 24px rgb(var(--fbk-accent) / 0.35)',
    'emph-on': 'rgb(var(--fbk-on-accent))',

    /* How a small control says "active / armed / current". */
    'lit-fill': 'rgb(var(--fbk-accent))',
    'lit-halo': '0 0 10px rgb(var(--fbk-accent) / 0.45)',
    'lit-on': 'rgb(var(--fbk-on-accent))',

    /* A panel is an object over a stage: a real shadow and a top light line.
       This is the cheapest cue that something is physical rather than drawn. */
    'panel-shadow': '0 24px 60px rgb(0 0 0 / 0.6)',
    'panel-inner': 'inset 0 1px 0 rgb(255 255 255 / 0.06)',

    /* Progress / cleared / target. The ONE paint for a filled meter, and the
       one slot where `none` is illegal — a meter with no paint is invisible. */
    'meter-fill': 'rgb(var(--fbk-good))',

    /* Shape. */
    radius: '12px',
    'radius-sm': '8px',
    'radius-pill': '999px',

    /*
     * Disabled, as one recipe.
     *
     * It was per-component before: `opacity: 0.4` here, `filter: saturate(0.4)`
     * there, and the primary ended up a muddy grey-blue that read as broken
     * rather than as unavailable. One opacity, one rule, and the halo goes.
     */
    'disabled-opacity': '0.38',

    /* Decorative timing. Gated below, so no consumer can forget. */
    motion: '140ms ease',
};

const PROP_PREFIX = '--fbk-';

/** camelCase role -> the custom property name. `accentHi` -> `--fbk-accent-hi`. */
function propFor(role) {
    return PROP_PREFIX + role.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
}

let unsubscribe = null;
let recipeOverride = null;

function hostTokens() {
    const fb = window.feedBack;
    const theme = fb && fb.theme;
    if (!theme || typeof theme.get !== 'function') return null;
    try { return theme.get()?.tokens || null; } catch (_) { return null; }
}

function reducedMotion() {
    const fb = window.feedBack;
    const theme = fb && fb.theme;
    if (theme && typeof theme.prefersReducedMotion === 'function') {
        try { return !!theme.prefersReducedMotion(); } catch (_) { /* fall through */ }
    }
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; }
}

function write() {
    const root = document.documentElement;
    const tokens = hostTokens();

    for (const role of Object.keys(ROLES)) {
        const hostKey = FROM_HOST[role];
        const value = (tokens && hostKey && tokens[hostKey]) || ROLES[role];
        root.style.setProperty(propFor(role), value);
    }

    const recipes = { ...RECIPES, ...(recipeOverride || {}) };
    for (const slot of Object.keys(recipes)) {
        root.style.setProperty(PROP_PREFIX + slot, recipes[slot]);
    }

    /*
     * The touch scale, after the recipes so it wins over them — and after any
     * consumer override too, deliberately: a plugin may redefine the look, it
     * may not decide that a finger is smaller than it is.
     */
    if (coarsePointer()) {
        for (const slot of Object.keys(TOUCH_HEIGHTS)) {
            root.style.setProperty(PROP_PREFIX + slot, TOUCH_HEIGHTS[slot]);
        }
    }

    // The single reduced-motion gate. `--fbk-motion` is the only place
    // decorative timing is named, so setting it to `none` here disables every
    // transition in the kit at once and a consumer cannot forget the gate.
    if (reducedMotion()) root.style.setProperty(PROP_PREFIX + 'motion', 'none');
}

/**
 * Start the bridge, and keep it in step with the equipped theme.
 *
 * `recipes` overrides Layer 2 for a plugin that wants its own design language
 * — the escape hatch a plugin skin needs without reinventing the roles. Most
 * consumers pass nothing.
 */
/**
 * The height scale again, for a finger.
 *
 * A mouse lands within a pixel or two of where it is aimed; a fingertip
 * contacts roughly 9mm of glass. So these are not the same control at two
 * sizes, they are two different physical problems — and the honest fix is to
 * change the SCALE rather than to grow individual controls, because growing
 * one is how a row ends up with a 44px stepper next to a 26px chip and no
 * shared rhythm left.
 *
 * 44px is the figure WCAG 2.5.5 (Target Size, AAA) asks for and the one both
 * platform guidelines settle on. `h-sm` goes to 32 rather than 44 because it
 * is the height of things that sit in groups — chips, small buttons — where
 * the row's own padding contributes and 44 would make a five-rung ladder
 * taller than the primary.
 *
 * This is applied by `write()` only when the pointer is actually coarse, and
 * it is re-applied if that changes: a convertible laptop switches while the
 * panel is open.
 */
const TOUCH_HEIGHTS = {
    'h-sm': '32px',
    'h-md': '44px',
    'h-lg': '52px',
};

/** True when the primary pointer is a finger rather than a mouse. */
function coarsePointer() {
    try { return window.matchMedia('(pointer: coarse)').matches; } catch (_) { return false; }
}

export function follow(recipes = null) {
    recipeOverride = recipes;
    write();
    if (unsubscribe) return;

    const stops = [];

    /*
     * A convertible laptop changes pointer while the panel is open — folding
     * the keyboard back is exactly the moment the controls need to grow — so
     * the touch scale is watched, not read once at install.
     */
    try {
        const mq = window.matchMedia('(pointer: coarse)');
        const onPointer = () => write();
        if (typeof mq.addEventListener === 'function') {
            mq.addEventListener('change', onPointer);
            stops.push(() => mq.removeEventListener('change', onPointer));
        }
    } catch (_) { /* no matchMedia: the scale is whatever write() decided */ }

    const fb = window.feedBack;
    if (fb && typeof fb.on === 'function') {
        const handler = () => write();
        fb.on('theme:changed', handler);
        stops.push(() => {
            try { if (typeof fb.off === 'function') fb.off('theme:changed', handler); } catch (_) { /* going away */ }
        });
    }

    if (!stops.length) return;
    unsubscribe = () => { for (const stop of stops) stop(); };
}

export function unfollow() {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    recipeOverride = null;
    const root = document.documentElement;
    for (const role of Object.keys(ROLES)) root.style.removeProperty(propFor(role));
    for (const slot of Object.keys(RECIPES)) root.style.removeProperty(PROP_PREFIX + slot);
    // The touch scale writes the same property names, but removing a property
    // twice is harmless and forgetting one would leave a 44px stepper behind
    // after uninstall.
    for (const slot of Object.keys(TOUCH_HEIGHTS)) root.style.removeProperty(PROP_PREFIX + slot);
}

/**
 * A resolved role, for a canvas or a WebGL renderer.
 *
 * The CSS path is the right one for anything in the DOM; this exists because
 * a canvas cannot read a custom property. Returns a real CSS colour string.
 */
export function ink(role, alpha) {
    const value = (hostTokens()?.[FROM_HOST[role]]) || ROLES[role] || ROLES.text;
    return alpha === undefined ? `rgb(${value})` : `rgb(${value} / ${alpha})`;
}

/**
 * What stays legible written on a fill.
 *
 * The host's palette pairs `on-accent` with its accent and says nothing about
 * the rest, so white-on-amber is one careless line away. This picks black or
 * white by luminance for any role — the same fix Live Tab wrote inline.
 */
export function inkOn(role) {
    const raw = (hostTokens()?.[FROM_HOST[role]]) || ROLES[role] || '';
    const [r, g, b] = String(raw).split(/\s+/).map(Number);
    if (![r, g, b].every(Number.isFinite)) return `rgb(${ROLES.text})`;
    // Rec. 601 luma is close enough for a two-way choice and needs no gamma.
    const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luma > 0.6 ? 'rgb(9 12 20)' : `rgb(${ROLES.text})`;
}

/** The role table, for a consumer that wants to enumerate them. */
export const roles = Object.freeze(Object.keys(ROLES));

/** The recipe slots, for the same reason. */
export const slots = Object.freeze(Object.keys(RECIPES));
