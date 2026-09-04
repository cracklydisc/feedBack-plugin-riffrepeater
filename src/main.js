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
import { buildLadder, clampStartPct, clampStepPct, STEPS } from './ladder.js';
import { createContent } from './ui/panel.js';
import { buildSettingsPage } from './ui/settings-page.js';

const ID = 'riffrepeater';
/** Kept in step with plugin.json — it cache-busts both stylesheets. */
const VERSION = '0.36.2';
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
/** The playhead's own frame loop — see `retick`. */
let headFrame = null;
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

/**
 * The rungs a drill would climb, from the stored start and step.
 *
 * One function, because two callers deriving the ladder separately is how the
 * panel and the engine end up disagreeing about which rung you are on — and
 * the panel's rail reads the engine's ladder while it runs, so a mismatch
 * would show as the wrong dot lit.
 */
function ladderNow(settings) {
    return buildLadder(settings.startPct, settings.stepPct, host.speedBounds());
}

/**
 * Porta la riproduzione all'inizio di quello che e' selezionato adesso.
 *
 * In un posto solo perche' i modi di cambiare selezione sono cinque — la
 * striscia, i pulsanti delle sezioni, le due frecce, il trascinamento — e
 * cinque copie della stessa regola sono cinque posti da cui puo' sparire.
 *
 * `selectAtTime` non la usa: quella nasce da un punto del brano che il
 * chiamante ha giа' in mano, quindi ci si e' giа'.
 */
function seekToSelection() {
    const t = model.seekTarget(drill.isDrilling(), model.snapshot().selection);
    if (t !== null) host.seek(t);
}

const actions = {
    close() { setOpen(false); },

    /*
     * SELEZIONARE PORTA LA CANZONE LI'.
     *
     * Il drill parte da quello che hai selezionato, e prima la selezione era
     * muta: sceglievi un blocco sulla striscia, premevi, e sentivi quale
     * pezzo avevi preso soltanto dal drill. Chiesto perche' cosi' diventa
     * tutto un tentativo — ed e' vero: la striscia dice dove sei nel brano,
     * non che cosa suona quel punto.
     *
     * Quindi la selezione sposta la posizione al suo inizio. Non fa partire
     * niente e non ferma niente: da fermo lo senti alla ripresa, in
     * riproduzione lo senti subito.
     *
     * MAI durante un drill: la' la posizione appartiene al loop del
     * rilevatore, e spostarla vorrebbe dire due padroni per lo stesso
     * cursore. Chi cambia sezione mentre un drill gira lo sta per rifare su
     * un altro pezzo, e il drill successivo ci arriva da se'.
     */
    selectSection(key) {
        model.selectSection(key);
        if (model.snapshot().mode === 'bars') model.setMode('section');
        seekToSelection();
    },

    /**
     * Select the block the strip was tapped on — a section OR a phrase.
     *
     * Separate from `selectSection` because the strip and the section buttons
     * are handing over different things: a button names a section, and a tap
     * on the strip names whichever block is under the finger.
     */
    selectBlock(key) { model.selectBlock(key); seekToSelection(); },
    stepPart(d) { model.stepPart(d); seekToSelection(); },
    stepSection(d) { model.stepSection(d); seekToSelection(); },
    selectDrag(a, b) { model.selectDrag(a, b); seekToSelection(); },
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

    /*
     * The ladder is three numbers now, so there is nothing to toggle: a start,
     * a step, and a top that is always full tempo. `buildLadder` derives the
     * rungs, and the rail that shows them takes no input at all — which is
     * kit DESIGN.md §21, and the reason the slow rungs no longer need a
     * caveat badge. A rung below 80% exists only if you asked for one.
     */
    setStart(pct) {
        model.setSettings({ startPct: clampStartPct(pct) });
    },

    nudgeStart(delta) {
        const cur = Number(model.getSettings().startPct) || 80;
        const step = Number(delta) || 0;
        model.setSettings({ startPct: clampStartPct(cur + step) });
    },

    setStep(pct) {
        model.setSettings({ stepPct: clampStepPct(pct) });
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

    /**
     * Walk the blocks the strip draws — the keyboard's version of tapping one.
     *
     * This is what the section chevrons became, and it went MISSING for a
     * version: the action was written next to `setUnit`, and removing that
     * switch took the neighbouring block with it. The `,` and `.` shortcuts
     * went on calling `actions.stepBlock`, which is a thrown TypeError on
     * every press — silent, because a shortcut handler's throw does not
     * surface anywhere a user would look.
     *
     * Caught only by grepping for the callers while wiring something else.
     * The lesson is about the DELETION, not the action: removing a block by
     * pattern is safe for the pattern and blind to what sits beside it.
     */
    stepBlock(delta) { model.stepBlock(delta); },

    /**
     * Show the full rack even though a drill or a loop is running.
     *
     * The panel folds itself while something runs — one number and a way back
     * is what you can read while playing — and this is the way back. An action
     * rather than a panel-internal toggle, because a shortcut has to be able
     * to do the same thing without reaching for a pointer.
     */
    unfold() { if (content) content.showRack(); model.announce(); },


    /**
     * Put an edge at a given TIME rather than at the playhead.
     *
     * What the strip's A/B handles call while being dragged. `markEdge` sets an
     * edge from where the song is, which is the keyboard gesture; this one
     * sets it from where the pointer is, and the strip has already snapped the
     * value to a block boundary before it arrives.
     */
    markEdgeAt(edge, seconds) { model.setEdge(edge, seconds); },

    /**
     * Turn the detector on, from the status line that says it is off.
     *
     * A blocked state you cannot act on is a dead end (kit DESIGN.md §18), and
     * the fix is one call away — so it belongs next to the sentence rather
     * than in a settings page the sentence does not mention.
     */
    enableDetection() {
        const nd = window.noteDetect;
        if (nd && typeof nd.enable === 'function') { try { nd.enable(); } catch (_) { /* it said no */ } }
        else if (nd && typeof nd.setEnabled === 'function') { try { nd.setEnabled(true); } catch (_) { /* it said no */ } }
        model.announce();
    },

    async startDrill() {
        const snap = model.snapshot();
        const range = snap.selection;
        if (!range) return;

        /*
         * IL DRILL PARTE DA FERMO, e questo evita il doppio audio.
         *
         * Sul desktop il brano lo suona JUCE, e `#audio` e' uno SHIM: il suo
         * `play()` inoltra a `jucePlayer.play()`, che chiama
         * `startBacking()` senza nessuna guardia sul fatto che stia gia'
         * suonando. Il rilevatore chiude `startDrill` proprio con
         * `audio.play()`, sempre — percio' avviare un drill mentre la canzone
         * suona chiede al motore nativo di avviare il brano una SECONDA
         * volta. Due voci: quella governata dal loop e quella che se ne va
         * fino alla fine del file, con la schermata di fine brano in premio.
         *
         * La correzione pulita sta nell'app (un `play()` idempotente) e nel
         * rilevatore, e non sono nostri da rilasciare. Ma il difetto compare
         * SOLO se il trasporto sta gia' suonando quando il drill parte,
         * quindi si evita da qui: si consegna al drill un trasporto fermo, e
         * il suo `audio.play()` diventa l'unico avvio.
         *
         * Non e' un ripiego contro il progetto del drill, e' il suo
         * progetto: arma il loop, poi avvia la riproduzione perche' la
         * rincorsa si senta. Si aspetta di essere lui a farla partire.
         *
         * Fuori da JUCE non cambia nulla — un elemento HTML5 messo in pausa e
         * riavviato da `audio.play()` e' dove era — quindi non c'e' un ramo
         * per modalita': una riga sola, che nel caso in cui il difetto non
         * esiste non costa niente.
         */
        const fermata = await host.pause();
        /* A fresh run reads a hundred, not whatever the last one ended on. */
        model.resetPass(range.start, range.end);
        const s = snap.settings;
        const res = await drill.start(range, {
            goalPct: s.goalPct,
            ladder: ladderNow(s),
            widen: s.widen,
        });
        if (res.ok) {
            activeDrill = { key: range.key, label: range.label, start: range.start, end: range.end, mine: true, scored: 0 };
            model.setPaused(true);
            retick();
        } else {
            /*
             * Se il drill non parte, la pausa va disfatta.
             *
             * Fermare il trasporto e poi rifiutare — detection spenta, range
             * troppo corto, `setLoop` fallito — lascerebbe la canzone muta
             * senza che sia successo niente: l'utente ha premuto una cosa e
             * gliene e' stata tolta un'altra. La pausa era un preparativo,
             * quindi se il seguito non c'e' si torna come si stava.
             */
            if (fermata) await host.resume();
            note(explain(res.reason));
        }
        model.announce();
    },

    endDrill() {
        drill.end();
        model.announce();
    },

    async loopOnly() {
        /* Same as a drill: the gauge starts this loop from a hundred. */
        (() => { const r = model.snapshot().selection; if (r) model.resetPass(r.start, r.end); })();
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

/**
 * Point the live gauge at whatever window is being judged right now.
 *
 * The drill's own range wins while one runs, because that is what the pass
 * score at the end will be measured over; otherwise it is the selection.
 */
function newPass() {
    const st = drill.state();
    if (st.active && st.range && Number.isFinite(st.range.judgeStart)) {
        model.resetPass(st.range.judgeStart, st.range.judgeEnd);
        return;
    }
    const sel = model.snapshot().selection;
    model.resetPass(sel ? sel.start : null, sel ? sel.end : null);
}

function retick() {
    const want = open ? TICK_OPEN_MS : TICK_IDLE_MS;
    if (tickTimer && tickRate === want) return;
    if (tickTimer) clearInterval(tickTimer);
    tickRate = want;
    tickTimer = setInterval(tick, want);
}

/*
 * ── THE PLAYHEAD'S OWN LOOP ──────────────────────────────────────────────
 *
 * The panel renders every 400ms, which is right for numbers and wrong for a
 * line that is supposed to slide: two and a half positions a second is a
 * visible step, however correct each one is. Reported as the playhead jumping.
 *
 * So the line gets a frame loop of its own, and it is the cheapest thing in
 * the plugin: read the clock, write one `left`. Nothing else in the panel is
 * touched, so this cannot become a second source of truth for anything.
 *
 * It runs only while the panel is open, and stops the moment it is not — a
 * frame loop nobody can see is a frame loop nobody should be paying for.
 */
function moveHead() {
    headFrame = null;
    if (!open || !content) return;
    if (content.movePlayhead) content.movePlayhead(host.time());
    headFrame = window.requestAnimationFrame(moveHead);
}

function reheadFrame() {
    if (open && headFrame === null) {
        headFrame = window.requestAnimationFrame(moveHead);
        return;
    }
    if (!open && headFrame !== null) {
        window.cancelAnimationFrame(headFrame);
        headFrame = null;
    }
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
    reheadFrame();
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
    unsubs.push(host.on('loop:restart', () => {
        /*
         * A wrap is a new pass, so the gauge goes back to a hundred.
         *
         * The window comes from the DRILL when one is running — the conductor
         * judges its own, widened by `expandContext` and pulled back by its
         * first-note runway — and from the selection otherwise. A gauge scoring
         * a different window from the one being judged is two numbers about the
         * same pass.
         */
        newPass();
        if (open) render();
    }));

    // Per-note verdicts. Checked against the live drill state rather than a
    // polled flag: a drill can start between two notes, and a second's worth
    // of drill verdicts in the map is a second's worth of wrong numbers.
    const verdict = (e) => {
        const d = (e && e.detail) || {};
        const t = Number(d.noteTime);
        if (!Number.isFinite(t)) return;
        /*
         * SAY who owns the measurement, then hand the verdict over anyway.
         *
         * This used to RETURN while a drill ran, so during the one activity the
         * panel exists for, the model saw nothing at all — which is why the
         * percentage only appeared when the pass ended. `paused` inside
         * `addVerdict` already keeps a drill's verdicts out of the per-passage
         * map; the live gauge is a different consumer and wants them.
         */
        model.setPaused(drill.isDrilling());
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
        /*
         * `y` opens the rack while something runs, which is what the folded
         * strip's own corner hint says. A key for it because the strip is
         * meant to be read with your hands on the instrument, and reaching for
         * a pointer is the thing folding exists to avoid.
         */
        key: 'y',
        description: 'show the full panel during a drill',
        handler: () => { if (open) actions.unfold(); },
    },
    {
        // Panel-open only: moving a selection you cannot see is not a feature.
        /*
         * `,` and `.` walk the blocks the strip draws — phrases when the chart
         * has them, sections when it does not. They are the keyboard's version
         * of tapping a block, and they are why removing the visible chevrons
         * cost nothing: the gesture stayed, and the host's help panel still
         * lists it.
         */
        key: ',',
        description: 'previous passage (panel open)',
        handler: () => { if (open) actions.stepBlock(-1); },
    },
    {
        key: '.',
        description: 'next passage (panel open)',
        handler: () => { if (open) actions.stepBlock(1); },
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

    select(key) { actions.selectBlock(key); },
    selection() { return model.snapshot().selection; },
    barsAtPlayhead() { return model.selectBarsAtPlayhead(); },

    /** Arm a drill on the selection, or on an explicit `{ start, end, label }`. */
    async startDrill(range) {
        if (range && Number.isFinite(Number(range.start))) {
            /* Anche da qui: la ragione sta in `actions.startDrill`, e questa
               e' la seconda porta per la stessa stanza. Due porte con una
               regola sola sono due porte che divergono al primo ritocco. */
            const fermata = await host.pause();
            const s = model.getSettings();
            const r = {
                start: Number(range.start),
                end: Number(range.end),
                label: range.label || 'Passage',
                key: ranges.rangeKey('bars', range.start, range.end),
            };
            const res = await drill.start(r, { goalPct: s.goalPct, ladder: ladderNow(s), widen: s.widen });
            if (res.ok) activeDrill = { ...r, mine: true, scored: 0 };
            else if (fermata) await host.resume();
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

    /**
     * Costruisci la pagina delle impostazioni dentro `root`.
     *
     * Sta qui e non in `settings.html` perche' quella pagina e' uno script
     * CLASSICO e non puo' importare niente: nessun kit, nessuna costante
     * della scala. Finche' la costruiva lei, era scritta nelle classi di
     * utilita' dell'app — l'ultima superficie dei due plugin rimasta fuori dal
     * kit — e ripeteva a mano l'aritmetica dei pioli. Ora `settings.html` e'
     * solo il caricatore e questo modulo e' il solo posto in cui la pagina
     * esiste.
     */
    mountSettings(root) {
        if (!root) return null;
        /*
         * Il foglio di stile va installato ANCHE qui.
         *
         * `boot()` lo installa quando il player monta, e torna subito se il
         * plugin e' spento — ma la schermata delle impostazioni puo' essere la
         * prima cosa che si apre, a freddo, senza avere mai aperto una
         * canzone, e nel caso "spento" e' proprio la pagina da cui lo riaccendi.
         * In tutti quei casi `boot()` non e' passato e la pagina sarebbe uscita
         * senza stile. `install` e' idempotente e indicizzato sull'id del
         * plugin, quindi chiamarlo due volte non aggiunge niente.
         */
        kit.install({ id: ID, version: VERSION });
        return buildSettingsPage(api, root);
    },

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
        /*
         * No glyph in the legend.
         *
         * The design system's own rule — "icons on buttons are shapes, never
         * text glyphs" — and the chassis has a real indicator light left of its
         * name now, which is the shape that emoji was standing in for.
         */
        label: 'Riff Repeater',
        title: 'Riff Repeater — drill a passage',
        /*
         * MENTRE UN DRILL GIRA IL PANNELLO NON SI CONGEDA.
         *
         * Non e' un popover in quel momento: e' il quadrante del drill, con la
         * percentuale che scende e il piolo corrente. Un clic andato per
         * sbaglio sullo sfondo lo faceva sparire, e per riaverlo davanti
         * bisognava riaprirlo dalla rastrelliera, fermare il drill e
         * ricominciare — cioe' un clic distratto costava la sessione.
         *
         * Il gate copre i soli gesti accidentali, il clic fuori e l'Escape.
         * Fermare con lo stop e uscire dalla canzone chiudono ancora, che sono
         * le due strade che l'utente ha chiesto di lasciare.
         */
        canDismiss: () => !drill.isDrilling(),
    });
    content = createContent(panel.body, actions, panel.foot, panel.folded, panel);
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
    /* The playhead's frame loop too — it re-arms itself, so it has to be
       cancelled here and not merely left to notice that `open` went false. */
    if (headFrame !== null) { window.cancelAnimationFrame(headFrame); headFrame = null; }
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
