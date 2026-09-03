/*
 * Riff Repeater's runtime: wire the host's events to the model, the model to
 * the panel, and put both down again cleanly.
 *
 * The host re-evaluates a plugin's script on update, rollback and reinstall.
 * Each run takes the previous one down first — a live interval and a second
 * copy of the API on window are exactly what plugin-runtime-idempotent.v1 is
 * about.
 */

import { host } from './host.js';
import * as model from './model.js';
import * as drill from './drill.js';
import * as store from './store.js';
import * as ranges from './ranges.js';
import * as kit from './kit/index.js';
import { normalizeLadder } from './ladder.js';
import { createContent } from './ui/panel.js';

const ID = 'riffrepeater';
/** Kept in step with plugin.json — it cache-busts both stylesheets. */
const VERSION = '0.9.0';
const HOOKS_KEY = '__feedBackRiffRepeaterHooks';

/** Panel open: fast enough that a loop wrap shows up as it happens. */
const TICK_OPEN_MS = 400;
/** Panel closed: slow enough to be free, quick enough to notice an auto-drill. */
const TICK_IDLE_MS = 1500;

try {
    const prev = window[HOOKS_KEY];
    if (prev && typeof prev.teardown === 'function') prev.teardown();
} catch (err) {
    console.warn('[' + ID + '] previous instance did not come down cleanly:', err);
}

const unsubs = [];
const apiListeners = new Set();
let open = false;
let tickTimer = null;
let tickRate = 0;
let panel = null;      // the kit's shell
let content = null;    // this plugin's controls inside it

/**
 * What the running drill is working on.
 *
 * Captured on every tick while a drill is active, because the conductor drops
 * its range on the way out and `notedetect:drill-ended` does not carry it —
 * so without this, a result could not be attributed to a passage. Covers
 * auto-drills too, which is the point: a drill the detector started on a run
 * the player fluffed is exactly the passage the map should learn about.
 */
let activeDrill = null;   // { key, label, start, end, mine, scored }

// ─────────────────────────────────────────────────────────────────────────
// actions — the panel's entire write surface
// ─────────────────────────────────────────────────────────────────────────

const actions = {
    close() { setOpen(false); },

    selectSection(key) {
        model.selectSection(key);
        if (model.snapshot().mode === 'bars') model.setMode('section');
    },
    stepPart(d) { model.stepPart(d); },
    stepSection(d) { model.stepSection(d); },
    selectDrag(a, b) { model.selectDrag(a, b); },
    selectAtTime(t) { model.selectAtTime(t); },
    nudge(edge, dir) { model.nudge(edge, dir); },

    /** Mark the loop's A or B at the playhead. */
    markEdge(edge) {
        const res = model.markEdge(edge);
        if (!res.ok) note(explainMark(res.reason));
    },

    /**
     * One press for "work on the thing I am worst at".
     *
     * Selects the weakest passage AND arms the drill, because reading the list
     * and then finding the button is two steps for a decision the list has
     * already made. Falls back to selecting it when a drill cannot start —
     * the reason is on the Start button.
     */
    async practiceWeakest() {
        const range = model.selectWeakest();
        if (!range) return;
        if (drill.blockedReason()) { model.announce(); return; }
        await actions.startDrill();
    },

    toggleRung(pct) {
        const cur = model.getSettings().ladder || [];
        const next = cur.includes(pct) ? cur.filter((p) => p !== pct) : [...cur, pct];
        model.setSettings({ ladder: normalizeLadder(next, host.speedBounds()) });
    },
    setGoal(pct) {
        const n = Math.max(10, Math.min(100, Math.round(Number(pct) || 0)));
        model.setSettings({ goalPct: n });
    },

    /**
     * Step the goal, which is how the panel sets it.
     *
     * The panel's floor is 50 rather than the store's 10: a drill whose goal is
     * "land one note in ten" is not a drill, and a stepper that walks down to
     * it is a stepper you have to walk back up. The full 10–100 range stays
     * reachable from the settings page, where a number field belongs.
     */
    nudgeGoal(delta) {
        const cur = Number(model.getSettings().goalPct) || 85;
        const step = Number(delta) || 0;
        const next = Math.max(50, Math.min(100, Math.round((cur + step) / 5) * 5));
        if (next !== cur) model.setSettings({ goalPct: next });
    },
    setWiden(on) { model.setSettings({ widen: !!on }); },

    async startDrill() {
        const snap = model.snapshot();
        const range = snap.selection;
        if (!range) return;
        const s = snap.settings;
        const res = await drill.start(range, {
            goalPct: s.goalPct,
            ladder: s.ladder,
            widen: s.widen,
        });
        if (res.ok) {
            activeDrill = { key: range.key, label: range.label, start: range.start, end: range.end, mine: true, scored: 0 };
            model.setPaused(true);
            retick();
        } else {
            note(explain(res.reason));
        }
        model.announce();
    },

    endDrill() {
        drill.end();
        model.announce();
    },

    async loopOnly() {
        const range = model.snapshot().selection;
        if (!range) return;
        const res = await drill.loopOnly(range);
        if (!res.ok) note(explain(res.reason));
        model.announce();
    },

    clearLoop() {
        host.clearLoop();
        model.announce();
    },

    setSpeed(pct) {
        if (host.setSpeedPct(pct)) model.rememberSpeed();
        model.announce();
    },

    setDifficulty(pct) {
        if (host.setDifficultyPct(pct)) {
            model.rememberDifficulty();
            model.onDifficultyChanged();
        }
    },
};

function explainMark(reason) {
    switch (reason) {
        case 'b-before-a': return 'B has to come after A — set A first, then let the song run.';
        case 'no-playhead': return 'No playhead yet. Start the song, then mark a point.';
        case 'no-room': return 'No room for a loop there.';
        case 'too-short': return 'A and B landed on the same bar — let it run a little further.';
        default: return 'That did not work.';
    }
}

function explain(reason) {
    switch (reason) {
        case 'no-engine': return 'The Note Detection plugin is not loaded — it owns the drill engine.';
        case 'detection-off': return 'Turn on note detection first: a drill is graded from what you play.';
        case 'too-short': return 'That passage is too short to drill. Widen it by a bar.';
        case 'no-range': return 'Pick a passage first.';
        case 'refused': return 'The drill engine refused that range — see the console for its reason.';
        case 'threw': return 'The drill engine errored. See the console.';
        default: return 'That did not work.';
    }
}

/**
 * Why something just failed.
 *
 * Goes to the panel's flash line when it is open, and to the console when it
 * is not — a drill refused by a keyboard shortcut with the panel closed would
 * otherwise fail silently.
 */
function note(text) {
    if (panel) panel.say(text);
    if (!open) console.warn(`[${ID}] ${text}`);
}

// ─────────────────────────────────────────────────────────────────────────
// render loop
// ─────────────────────────────────────────────────────────────────────────

function render() {
    if (!content) return;
    const snap = model.snapshot();
    content.render(snap);
    panel.setSubtitle(snap.songTitle);
}

function tick() {
    // Keep the drill's target under observation while it runs — this is the
    // only place the conductor's range is readable before it is discarded.
    const st = drill.state();
    if (st.active) {
        if (st.range && Number.isFinite(st.range.judgeStart)) {
            const start = st.range.judgeStart;
            const end = st.range.judgeEnd;
            if (!activeDrill || activeDrill.start !== start || activeDrill.end !== end) {
                const scored = activeDrill ? activeDrill.scored : 0;
                activeDrill = attribute(start, end, st.label, activeDrill && activeDrill.mine);
                activeDrill.scored = scored;
            }
        }
        // How many iterations the conductor has actually GRADED. Tracked here
        // because it decides whether the result is worth storing at all: a
        // drill armed and abandoned before a single pass reports best = 0, and
        // writing that would stamp 0% onto a passage nobody played.
        if (activeDrill) activeDrill.scored = drill.iterations().length;
        model.setPaused(true);
    } else if (model.snapshot().paused) {
        model.setPaused(false);
    }
    if (open) render();
    retick();
}

/**
 * Which stored passage a drilled range belongs to.
 *
 * A drill's loop is not the passage: the conductor pulls the start back by a
 * five-second lead-in and may have widened both ends. So the range is
 * attributed by its MIDPOINT — the section that contains the middle of what
 * was drilled is the section the result is about.
 */
function attribute(start, end, label, mine) {
    const mid = (Number(start) + Number(end)) / 2;
    const snap = model.snapshot();
    const own = snap.sections.find((s) => mid >= s.start && mid < s.end);
    return {
        key: own ? own.key : ranges.rangeKey('bars', start, end),
        label: label || (own ? own.label : 'Passage'),
        start: Number(start),
        end: Number(end),
        mine: !!mine,
    };
}

function retick() {
    const want = open ? TICK_OPEN_MS : TICK_IDLE_MS;
    if (tickTimer && tickRate === want) return;
    if (tickTimer) clearInterval(tickTimer);
    tickRate = want;
    tickTimer = setInterval(tick, want);
}

/*
 * Opening and closing is the kit panel's job now, including the in-player
 * guard (a programmatic open used to succeed over the song library, because
 * the highway keeps the last song's sections after you navigate away). This
 * only reacts to it: render before it appears, and re-pace the tick.
 */
function onPanelToggle(isOpen) {
    open = !!isOpen;
    if (open) render();
    retick();
    announceApi();
}

function setOpen(next) {
    if (!panel) return;
    if (next) { render(); panel.open(); } else { panel.close(); }
}

function announceApi() {
    for (const fn of Array.from(apiListeners)) {
        try { fn(publicState()); } catch (_) { /* a panel that threw is not our problem */ }
    }
}

// ─────────────────────────────────────────────────────────────────────────
// host wiring
// ─────────────────────────────────────────────────────────────────────────

function wire() {
    unsubs.push(model.subscribe(() => { if (open) render(); }));

    // A song arriving, or an arrangement switch. `song:ready` also fires on
    // seeks, which is why refreshSong() decides for itself whether anything
    // actually changed.
    const onSong = () => {
        const changed = model.refreshSong();
        if (!changed) return;
        // The host resets the rate to 100% during the load, so restoring has
        // to happen after it — a microtask is not enough, and a frame is not
        // reliable either. One short timeout, once per song.
        setTimeout(() => {
            model.restoreSpeed();
            model.restoreDifficulty();
            model.announce();
        }, 400);
    };
    unsubs.push(host.on('song:ready', onSong));
    unsubs.push(host.on('song:loaded', onSong));
    unsubs.push(host.on('arrangement:changed', () => { model.refreshSong(); }));
    unsubs.push(host.on('song:arrangement-changed', () => { model.refreshSong(); }));
    unsubs.push(host.on('transform-changed', () => model.onChartChanged()));

    // Leaving the song, or the screen, is when a run's numbers are worth
    // keeping. Both paths, because a user can exit either way.
    unsubs.push(host.on('song:ended', () => { model.commitRun(); model.rememberSpeed(); }));
    unsubs.push(host.on('screen:changed', (e) => {
        const from = e && e.detail ? e.detail.from : null;
        if (from === 'player') { model.commitRun(); model.rememberSpeed(); }
        if (panel) panel.syncVisibility();
    }));

    // A wrap means the conductor has just scored an iteration.
    unsubs.push(host.on('loop:restart', () => { if (open) render(); }));

    // Per-note verdicts. Checked against the live drill state rather than a
    // polled flag: a drill can start between two notes, and a second's worth
    // of drill verdicts in the map is a second's worth of wrong numbers.
    const verdict = (e) => {
        const d = (e && e.detail) || {};
        const t = Number(d.noteTime);
        if (!Number.isFinite(t)) return;
        if (drill.isDrilling()) { model.setPaused(true); return; }
        model.addVerdict(t, !!d.hit);
    };
    unsubs.push(host.onWindow('notedetect:hit', verdict));
    unsubs.push(host.onWindow('notedetect:miss', verdict));

    // A drill finished — however it finished. `best` is the conductor's own
    // measurement, which is better evidence than anything we could compute.
    unsubs.push(drill.onEnded((result) => {
        const target = activeDrill;
        activeDrill = null;
        model.setPaused(false);
        // Only a drill that graded at least one pass has told us anything. An
        // abandoned drill reports best = 0, and storing that would put a
        // passage nobody played at the top of the weak list.
        const scored = target && Number(target.scored) > 0;
        if (target && target.key && scored) {
            model.commitDrill(result, target.key, target.label || result.label);
        }
        model.announce();
        if (open) render();
    }));
}

// ─────────────────────────────────────────────────────────────────────────
// keyboard
// ─────────────────────────────────────────────────────────────────────────

/*
 * Shortcuts, through the host's own registry.
 *
 * `window.registerShortcut` is documented as a plugin-facing API and it earns
 * its keep twice over: the app's `?` panel and its Settings → Keybinds tab
 * list what we add, and it warns on the console when a key is already taken
 * instead of two handlers quietly both firing.
 *
 * WHAT IS NOT BOUND, and why. Asking the registry (`getAllShortcuts()`) rather
 * than guessing: in the `player` scope the app already owns Space (play/pause),
 * ← / → (seek ±5s), Escape (back), [ and ] (A/V offset) and + / − (volume).
 * The obvious guitarist bindings — Space to start, [ and ] to move the loop —
 * are therefore all taken, and rebinding them would break the transport to
 * add a convenience. So: D for the drill, ↑/↓ for speed (free in this scope),
 * and , / . for the sections.
 */
const SHORTCUT_SCOPE = 'player';

const SHORTCUTS = [
    {
        key: 'd',
        description: 'start or end a drill on the selected passage',
        handler: () => {
            if (drill.isDrilling()) actions.endDrill();
            else actions.startDrill();
        },
    },
    {
        key: 'ArrowUp',
        description: 'playback speed +5%',
        handler: () => actions.setSpeed(Math.min(100, host.speedPct() + 5)),
    },
    {
        key: 'ArrowDown',
        description: 'playback speed −5%',
        handler: () => actions.setSpeed(Math.max(15, host.speedPct() - 5)),
    },
    {
        // I and O, the way a video editor marks in and out. A and B would read
        // better on the buttons — and they are what the buttons say — but the
        // 3D Highway registers 'A' in this scope for its framing tuner, and a
        // shortcut that fights another plugin for a key is worse than one that
        // needs a tooltip.
        key: 'i',
        description: 'set the loop start (A) at the playhead',
        handler: () => actions.markEdge('start'),
    },
    {
        key: 'o',
        description: 'set the loop end (B) at the playhead',
        handler: () => actions.markEdge('end'),
    },
    {
        // Panel-open only: moving a selection you cannot see is not a feature.
        key: ',',
        description: 'previous section (panel open)',
        handler: () => { if (open) actions.stepSection(-1); },
    },
    {
        key: '.',
        description: 'next section (panel open)',
        handler: () => { if (open) actions.stepSection(1); },
    },
];

let unwireShortcuts = () => {};

function wireShortcuts() {
    unwireShortcuts = kit.shortcuts.register(SHORTCUTS, {
        scope: SHORTCUT_SCOPE,
        name: 'Riff Repeater',
    });
}

// ─────────────────────────────────────────────────────────────────────────
// public API
// ─────────────────────────────────────────────────────────────────────────

function publicState() {
    const snap = model.snapshot();
    return {
        open,
        ready: snap.ready,
        songKey: snap.songKey,
        mode: snap.mode,
        selection: snap.selection ? { ...snap.selection } : null,
        engine: { ...snap.engine },
        drill: { ...snap.drill },
        settings: { ...snap.settings },
    };
}

const api = {
    version: 1,

    open() { setOpen(true); },
    close() { setOpen(false); },
    toggle() { setOpen(!open); },
    isOpen() { return open; },

    /** Everything loopable in the current song, decorated with what we know. */
    ranges() {
        const snap = model.snapshot();
        return { sections: snap.sections, parts: snap.parts, bars: snap.bars };
    },

    select(key) { actions.selectSection(key); },
    selection() { return model.snapshot().selection; },
    barsAtPlayhead() { return model.selectBarsAtPlayhead(); },

    /** Arm a drill on the selection, or on an explicit `{ start, end, label }`. */
    async startDrill(range) {
        if (range && Number.isFinite(Number(range.start))) {
            const s = model.getSettings();
            const r = {
                start: Number(range.start),
                end: Number(range.end),
                label: range.label || 'Passage',
                key: ranges.rangeKey('bars', range.start, range.end),
            };
            const res = await drill.start(r, { goalPct: s.goalPct, ladder: s.ladder, widen: s.widen });
            if (res.ok) activeDrill = { ...r, mine: true, scored: 0 };
            return res;
        }
        await actions.startDrill();
        return { ok: drill.isDrilling(), reason: null };
    },
    endDrill() { return drill.end(); },
    drillState() { return drill.state(); },

    /** What has been measured for this song, per passage. */
    map() {
        const snap = model.snapshot();
        const saved = snap.songKey ? store.getSong(snap.songKey) : null;
        return {
            songKey: snap.songKey,
            ranges: (saved && saved.ranges) || {},
            weakest: snap.weakest,
            run: snap.run,
        };
    },

    settings: {
        get() { return model.getSettings(); },
        set(patch) { return model.setSettings(patch); },
        reset() { return model.resetSettings(); },
    },

    forgetSong() {
        const key = model.snapshot().songKey;
        const done = store.forgetSong(key);
        model.resetRun();
        return done;
    },
    forgetEverything() {
        const done = store.forgetEverything();
        model.resetRun();
        return done;
    },
    usage() { return store.usage(); },

    isDisabled: store.isDisabled,
    disable() { store.setDisabled(true); teardown(); announceApi(); },
    enable() { store.setDisabled(false); boot(); announceApi(); },

    state: publicState,
    onChange(fn) {
        if (typeof fn === 'function') apiListeners.add(fn);
        return () => apiListeners.delete(fn);
    },
};

// ─────────────────────────────────────────────────────────────────────────
// boot / teardown
// ─────────────────────────────────────────────────────────────────────────

let booted = false;

function boot() {
    if (booted || store.isDisabled()) return;
    booted = true;
    kit.install({ id: ID, version: VERSION });
    panel = kit.createPanel({
        id: ID,
        label: '⏱ Riff Repeater',
        title: 'Riff Repeater — drill a passage',
    });
    content = createContent(panel.body, actions);
    panel.onToggle(onPanelToggle);
    panel.attach();
    wire();
    wireShortcuts();
    model.refreshSong();
    retick();
}

function teardown() {
    booted = false;
    open = false;
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    tickRate = 0;
    while (unsubs.length) {
        const off = unsubs.pop();
        try { off(); } catch (_) { /* going away anyway */ }
    }
    unwireShortcuts();
    unwireShortcuts = () => {};
    if (panel) { try { panel.detach(); } catch (_) { /* ignore */ } panel = null; }
    content = null;
    kit.uninstall(ID);
    activeDrill = null;
}

boot();

window.riffRepeater = api;

window[HOOKS_KEY] = {
    teardown() {
        teardown();
        apiListeners.clear();
        if (window.riffRepeater === api) delete window.riffRepeater;
    },
};

console.log('[' + ID + '] loaded'
    + (store.isDisabled() ? ' (switched off — window.riffRepeater.enable() to turn it back on)' : '')
    + (drill.available() ? '' : ' — note detection not present, drills unavailable'));
