/*
 * The host seam — every read of somebody else's global happens here.
 *
 * Two reasons this file exists rather than `window.highway.getSections()`
 * scattered through eight modules.
 *
 * 1. FEATURE DETECTION IN ONE PLACE. A plugin runs against hosts older and
 *    newer than the one it was written on. Every accessor below returns a
 *    documented empty value (null, [], 0, false) when the host does not have
 *    the surface, so callers branch on data rather than on `typeof`.
 *
 * 2. IT IS THE MERGE BOUNDARY. When this moves into core, the bodies here
 *    collapse into direct imports — `sections()` becomes
 *    `highway.getSections()` from the module that owns the highway, `on()`
 *    becomes the internal bus. Every other file in src/ is untouched by that.
 *
 * Note the ONE asymmetry: reads are silent, writes are not. A read that finds
 * nothing is a normal state (no song loaded). A write that finds nothing means
 * a host API we depend on has moved, and swallowing that would leave the panel
 * showing controls that quietly do nothing — so writes return false and the
 * caller surfaces it.
 */

function bus() {
    const fb = window.feedBack;
    return (fb && typeof fb.on === 'function') ? fb : null;
}

function hw() {
    const h = window.highway;
    return (h && typeof h.getSongInfo === 'function') ? h : null;
}

function arr(v) {
    return Array.isArray(v) ? v : [];
}

function num(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

export const host = {

    // ── Identity / capability ────────────────────────────────────────────

    /** True on the v3 shell, which is the only shell that has a plugin slot. */
    isV3() {
        const fb = window.feedBack;
        return !!(fb && fb.uiVersion === 'v3');
    },

    /**
     * The sanctioned, always-reachable container for a plugin's player
     * control (the "Plugins" rail popover). This is the ONE documented
     * extension point in the v3 player — see docs/plugin-v3-ui.md. Returns
     * null in v2 or before the chrome has mounted.
     */
    controlSlot() {
        const fb = window.feedBack;
        const ui = fb && fb.ui;
        if (!ui || typeof ui.playerControlSlot !== 'function') return null;
        try { return ui.playerControlSlot() || null; } catch (_) { return null; }
    },

    // ── Event bus ────────────────────────────────────────────────────────

    /** Subscribe, and get the unsubscriber back. Never throws, never returns null. */
    on(name, fn) {
        const fb = bus();
        if (!fb || typeof fn !== 'function') return () => {};
        try {
            fb.on(name, fn);
        } catch (_) {
            return () => {};
        }
        return () => {
            try { if (typeof fb.off === 'function') fb.off(name, fn); } catch (_) { /* going away anyway */ }
        };
    },

    /** Same contract, for the window-scoped CustomEvents the detector emits. */
    onWindow(name, fn) {
        if (typeof fn !== 'function') return () => {};
        window.addEventListener(name, fn);
        return () => window.removeEventListener(name, fn);
    },

    // ── Chart reads ──────────────────────────────────────────────────────

    /** `[{ name, time }]` — section markers. A section's END is the next one's start. */
    sections() {
        const h = hw();
        if (!h || typeof h.getSections !== 'function') return [];
        try { return arr(h.getSections()); } catch (_) { return []; }
    },

    /**
     * `[{ index, start_time, end_time, max_difficulty }]` or [] — the phrase
     * table. `getPracticePhrases` is what the host's own Section Practice
     * reads, so this matches the "Part n of m" the user already sees;
     * `getPhrases` is the fallback for hosts that predate it.
     */
    phrases() {
        const h = hw();
        if (!h) return [];
        try {
            if (typeof h.getPracticePhrases === 'function') {
                const pp = arr(h.getPracticePhrases());
                if (pp.length) return pp;
            }
            if (typeof h.getPhrases === 'function') return arr(h.getPhrases());
        } catch (_) { /* fall through */ }
        return [];
    },

    /**
     * `[{ measure, time }]` — every beat. `measure` is the bar number on a
     * downbeat and -1 on the beats between, which is what lets us derive bar
     * lines without a second API.
     */
    beats() {
        const h = hw();
        if (!h || typeof h.getBeats !== 'function') return [];
        try { return arr(h.getBeats()); } catch (_) { return []; }
    },

    /** Notes and chords AFTER the difficulty filter — what the player will actually see. */
    notes() {
        const h = hw();
        if (!h) return [];
        try {
            if (typeof h.getFilteredNotes === 'function') {
                const f = h.getFilteredNotes();
                if (Array.isArray(f)) return f;   // null = "no filter active", fall through
            }
            if (typeof h.getNotes === 'function') return arr(h.getNotes());
        } catch (_) { /* fall through */ }
        return [];
    },

    chords() {
        const h = hw();
        if (!h) return [];
        try {
            if (typeof h.getFilteredChords === 'function') {
                const f = h.getFilteredChords();
                if (Array.isArray(f)) return f;
            }
            if (typeof h.getChords === 'function') return arr(h.getChords());
        } catch (_) { /* fall through */ }
        return [];
    },

    /** True when the chart carries per-phrase difficulty tiers (the slider is live). */
    hasPhraseData() {
        const h = hw();
        if (!h || typeof h.hasPhraseData !== 'function') return false;
        try { return !!h.hasPhraseData(); } catch (_) { return false; }
    },

    duration() {
        const h = hw();
        if (h && typeof h.getSongInfo === 'function') {
            try {
                const d = num(h.getSongInfo()?.duration, 0);
                if (d > 0) return d;
            } catch (_) { /* fall through */ }
        }
        const song = this.currentSong();
        if (song) {
            const d = num(song.duration, 0);
            if (d > 0) return d;
        }
        const el = document.getElementById('audio');
        return el ? num(el.duration, 0) : 0;
    },

    /** Playhead, in chart seconds. */
    time() {
        const h = hw();
        if (h && typeof h.getTime === 'function') {
            try { return num(h.getTime(), 0); } catch (_) { /* fall through */ }
        }
        const el = document.getElementById('audio');
        return el ? num(el.currentTime, 0) : 0;
    },

    currentSong() {
        const fb = window.feedBack;
        return (fb && fb.currentSong) || null;
    },

    isPlaying() {
        const fb = window.feedBack;
        return !!(fb && fb.isPlaying);
    },

    // ── Loop ─────────────────────────────────────────────────────────────

    /** `{ loopA, loopB }` with nulls when nothing is armed. */
    loop() {
        const fb = window.feedBack;
        if (!fb || typeof fb.getLoop !== 'function') return { loopA: null, loopB: null };
        try {
            const l = fb.getLoop() || {};
            return { loopA: l.loopA ?? null, loopB: l.loopB ?? null };
        } catch (_) { return { loopA: null, loopB: null }; }
    },

    /**
     * Porta la riproduzione a un istante del brano.
     *
     * Non mette in play e non mette in pausa: sposta soltanto la posizione,
     * quindi da fermo si sente dove si e' andati alla ripresa e in
     * riproduzione si sente subito. E' lo stesso imbuto che usa il player —
     * `window.feedBack.seek` emette `song:seek`, che gli altri plugin
     * ascoltano — percio' non va aggirato scrivendo su `audio.currentTime`.
     */
    /*
     * ── FERMARE E RIPRENDERE ─────────────────────────────────────────────
     *
     * `window.togglePlay` e' globale: l'app la mette su `window` in
     * `Object.assign(window, {...})` per i propri handler inline, ed e' la
     * funzione che chiama il tasto play. E' un TOGGLE, quindi va chiamata solo
     * quando lo stato e' quello che si vuole cambiare.
     *
     * E lo stato lo legge `#audio.paused`, non `feedBack.isPlaying`. Quel
     * flag MENTE: nel ramo HTML5 di `togglePlay` l'app scrive `S.isPlaying =
     * false` e non aggiorna `window.feedBack.isPlaying`, che resta `true`
     * dopo una pausa. Ci ho creduto per un giro e la ripresa non e' partita:
     * `resume()` vedeva "sta gia' suonando" e non faceva niente.
     *
     * `#audio.paused` invece e' vero in entrambe le modalita': fuori da JUCE
     * e' lo stato dell'elemento, e dentro JUCE e' uno shim il cui getter
     * restituisce `!S.isPlaying`, cioe' lo stato che il trasporto conosce.
     *
     * `await`, e non e' un dettaglio: nel ramo JUCE `togglePlay` attende
     * `stopBacking()`, quindi al ritorno il motore nativo e' fermo davvero.
     */
    _stopped() {
        const el = document.getElementById('audio');
        return !el || el.paused === true;
    },

    async _flip() {
        if (typeof window.togglePlay !== 'function') return false;
        try { await window.togglePlay(); return true; }
        catch (_) { return false; }
    },

    /** Ferma la riproduzione; dice se l'ha fermata davvero lei. */
    async pause() {
        if (this._stopped()) return false;
        return this._flip();
    },

    /** Riprendi; il gemello di `pause()`, e con la stessa verita' di stato. */
    async resume() {
        if (!this._stopped()) return false;
        return this._flip();
    },

    seek(seconds) {
        const fb = window.feedBack;
        const t = Number(seconds);
        if (!fb || typeof fb.seek !== 'function' || !isFinite(t)) return false;
        try { fb.seek(Math.max(0, t), 'riffrepeater-select'); return true; }
        catch (_) { return false; }
    },

    /** Arm the A-B loop. Async in the host (it is seek-gated), so await it. */
    async setLoop(a, b) {
        const fb = window.feedBack;
        if (!fb || typeof fb.setLoop !== 'function') return false;
        try { return (await fb.setLoop(a, b)) !== false; } catch (_) { return false; }
    },

    clearLoop() {
        const fb = window.feedBack;
        if (fb && typeof fb.clearLoop === 'function') {
            try { fb.clearLoop(); return true; } catch (_) { return false; }
        }
        if (typeof window.clearLoop === 'function') {
            try { window.clearLoop(); return true; } catch (_) { return false; }
        }
        return false;
    },

    // ── Speed ────────────────────────────────────────────────────────────

    /**
     * The speed actually PLAYING, as a percent (100 = as recorded).
     *
     * Read from the audio element, not the slider, and the difference is not
     * academic: `window.setSpeed` — which is what the drill conductor calls —
     * moves the rate and the label but never writes the slider's `value`. So
     * during a drill the slider still says 100 while the song plays at 0.8.
     * A panel that highlighted 100% there would disagree with the transport
     * two inches below it.
     */
    speedPct() {
        const el = document.getElementById('audio');
        if (el) {
            const rate = num(el.playbackRate, NaN);
            if (Number.isFinite(rate) && rate > 0) return Math.round(rate * 100);
        }
        const juce = window.jucePlayer;
        if (juce && Number.isFinite(num(juce._speed, NaN))) return Math.round(num(juce._speed) * 100);
        return this.chosenSpeedPct();
    },

    /**
     * The speed the USER picked, as a percent.
     *
     * The slider is the host's own record of that — `applySpeedPreset` writes
     * it, and the host restores from it — so this is the value worth
     * remembering per song. It deliberately ignores a rate the drill
     * conductor is driving: what we want back next session is the speed the
     * player chose, not the rung a drill happened to be on when they quit.
     */
    chosenSpeedPct() {
        const slider = document.getElementById('speed-slider');
        if (slider) {
            const v = num(slider.value, NaN);
            if (Number.isFinite(v) && v > 0) return v;
        }
        const el = document.getElementById('audio');
        const rate = el ? num(el.playbackRate, 1) : 1;
        return Math.round(rate * 100);
    },

    /**
     * Set the speed as a percent.
     *
     * `applySpeedPreset` is the right entry: it clamps to the slider's own
     * min/max, writes the slider, and dispatches the input event so the
     * label, the fill and the preset highlight all follow. `setSpeed` alone
     * moves the rate but leaves the slider showing the old number.
     */
    setSpeedPct(pct) {
        const n = Number(pct);
        if (!Number.isFinite(n) || n <= 0) return false;
        if (typeof window.applySpeedPreset === 'function') {
            try { window.applySpeedPreset(n); return true; } catch (_) { /* fall through */ }
        }
        if (typeof window.setSpeed === 'function') {
            try { window.setSpeed(n / 100); return true; } catch (_) { /* fall through */ }
        }
        const el = document.getElementById('audio');
        if (el) { el.playbackRate = n / 100; return true; }
        return false;
    },

    /** The slider's own bounds, so a ladder can be validated against them. */
    speedBounds() {
        const slider = document.getElementById('speed-slider');
        return {
            min: num(slider?.min, 15) || 15,
            max: num(slider?.max, 150) || 150,
            step: num(slider?.step, 5) || 5,
        };
    },

    // ── Difficulty (master difficulty / "mastery") ───────────────────────

    /** 0..100. The host stores it as 0..1 on the highway. */
    difficultyPct() {
        const h = hw();
        if (h && typeof h.getMastery === 'function') {
            try {
                const m = num(h.getMastery(), 1);
                return Math.round(Math.max(0, Math.min(1, m)) * 100);
            } catch (_) { /* fall through */ }
        }
        const slider = document.getElementById('mastery-slider');
        const v = Number(slider?.value);
        return Number.isFinite(v) ? v : 100;
    },

    /**
     * Set the difficulty, 0..100.
     *
     * `window.setMastery` is the shared applier: it moves BOTH sliders (the
     * player popover and the Gameplay tab), re-filters the highway, and
     * debounce-persists. Going straight to `highway.setMastery` would change
     * the chart while leaving both sliders lying about it.
     *
     * Be aware this is a GLOBAL host setting, not a per-song one — see
     * store.js and the settings panel's warning.
     */
    setDifficultyPct(pct) {
        const n = Math.round(Number(pct));
        if (!Number.isFinite(n)) return false;
        const clamped = Math.max(0, Math.min(100, n));
        if (typeof window.setMastery === 'function') {
            try { window.setMastery(clamped); return true; } catch (_) { /* fall through */ }
        }
        const h = hw();
        if (h && typeof h.setMastery === 'function') {
            try { h.setMastery(clamped / 100); return true; } catch (_) { return false; }
        }
        return false;
    },

    // ── Theme ────────────────────────────────────────────────────────────

    /** Resolved `--fb-*` role tokens as `"r g b"` triplets, or null on an old host. */
    themeTokens() {
        const fb = window.feedBack;
        const theme = fb && fb.theme;
        if (!theme || typeof theme.get !== 'function') return null;
        try { return theme.get()?.tokens || null; } catch (_) { return null; }
    },

    prefersReducedMotion() {
        const fb = window.feedBack;
        const theme = fb && fb.theme;
        if (theme && typeof theme.prefersReducedMotion === 'function') {
            try { return !!theme.prefersReducedMotion(); } catch (_) { /* fall through */ }
        }
        try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; }
    },

    // ── The screen we are on ─────────────────────────────────────────────

    activeScreenId() {
        const el = document.querySelector('.screen.active');
        return el ? el.id : null;
    },

    inPlayer() {
        return this.activeScreenId() === 'player';
    },
};
