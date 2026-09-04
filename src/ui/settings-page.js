/*
 * ── THE SETTINGS PAGE, IN THE KIT ────────────────────────────────────────
 *
 * This was the last surface of either plugin still written in the host's
 * utility classes: `bg-fb-cardMuted`, `text-fb-textDim`, a stack of
 * hand-built rows in `settings.html`. Live Tab's page moved to the kit and
 * this one did not, so two plugins whose panels are the same object had
 * settings screens that looked unrelated — and a settings screen is where a
 * reader spends the most unhurried time with an identity.
 *
 * The kit's own note on this (`settings-mount.js`) records the position it
 * used to hold and why it was wrong: a settings page IS a different genre
 * from a HUD, but the difference is size and pace, not language. Wider wells,
 * more prose per control, a select where a panel wants a stepper. Same parts,
 * more room.
 *
 * WHICH CONTROL EACH VALUE GETS is not chosen by hand here either — kit
 * DESIGN.md §24 has the table, and the shape of the value decides:
 *
 *   startPct   five speeds        > 4 options  -> select
 *   stepPct    three increments   <= 4         -> segmented
 *   goalPct    50..100 by 5       11 steps     -> slider
 *   barCount   1..64 by 1         64 steps     -> slider
 *   the three switches            bool         -> toggle
 *
 * `settings.html` keeps only the loader, so this file is the one place the
 * page exists and it cannot fall out of step with the store's defaults.
 */

import * as c from '../kit/controls.js';
import {
    STEPS, START_MIN_PCT, GOAL_MIN_PCT, GOAL_MAX_PCT, buildLadder,
} from '../ladder.js';

/*
 * The five starting speeds.
 *
 * Not a range: below 50 the app's own time-stretch is the thing you hear
 * rather than the part, and the rungs in between are the ones a player
 * actually asks for. `START_MIN_PCT` is the store's floor and the first
 * option matches it, so the page cannot offer what the store would clamp.
 */
const STARTS = [50, 60, 70, 80, 90];

/** The most bars "From playhead" will take. Past this it is not a passage. */
const BARS_MAX = 64;

export function buildSettingsPage(api, root) {
    root.textContent = '';
    root.className = 'fbk-sheet';

    /*
     * No header. The page is already titled Settings and lists the plugins by
     * name, so a second title tells the reader they have entered somewhere new
     * when they have not — the same call as Live Tab's page. The paragraph
     * below says what this is, which is the part that carries information.
     */
    root.appendChild(c.el('p', 'fbk-note',
        'The drill engine itself lives in the Note Detection plugin — this '
        + 'plugin gives it a way in, a passage to work on, and a memory. These '
        + 'are the defaults a drill starts from; everything about a specific '
        + 'passage belongs in the panel, next to the passage.'));

    // ── THE LADDER ───────────────────────────────────────────────────────
    const ladderRack = c.rack({ label: 'The ladder' });
    root.appendChild(ladderRack.el);

    const startField = c.field({ label: 'Start at' });
    const startSel = c.select(
        STARTS.map((v) => ({ value: String(v), label: v + '% of tempo' })),
        (v) => set({ startPct: Number(v) }),
        { ariaLabel: 'Starting speed' },
    );
    startField.body.appendChild(startSel.el);
    ladderRack.body.appendChild(startField.el);

    const stepField = c.field({ label: 'Step' });
    const stepSeg = c.segmented(
        STEPS.map((v) => ({ value: String(v), label: '+' + v })),
        (v) => set({ stepPct: Number(v) }),
        'Speed increment',
    );
    stepField.body.appendChild(stepSeg.el);
    ladderRack.body.appendChild(stepField.el);

    /*
     * The rungs, spelled out, because this page has the room the panel does
     * not: the panel shows the same ladder as a rail, which is denser and
     * cannot afford the arithmetic. Reading `80 · 85 · 90 · 95 · 100%` is how
     * you find out that a step of 2 makes eleven passes.
     */
    const rungs = c.el('p', 'fbk-note');
    ladderRack.body.appendChild(rungs);

    const goalField = c.field({ label: 'Goal' });
    const goalSlider = c.slider({
        min: GOAL_MIN_PCT, max: GOAL_MAX_PCT, step: 5, unit: '%',
        ariaLabel: 'Accuracy that clears a rung',
        onInput: (v) => set({ goalPct: Number(v) }),
    });
    goalField.body.appendChild(goalSlider.el);
    ladderRack.body.appendChild(goalField.el);
    ladderRack.body.appendChild(c.el('p', 'fbk-note',
        'Accuracy on one pass that counts as clearing a rung. The engine’s '
        + 'own default is 85%: at 100% a single fluffed note sends you round '
        + 'again, which is right for a passage you are polishing and punishing '
        + 'on one you are learning.'));

    // ── THE PASSAGE ──────────────────────────────────────────────────────
    const passRack = c.rack({ label: 'The passage' });
    root.appendChild(passRack.el);

    const barsField = c.field({ label: 'Bars' });
    const barsSlider = c.slider({
        min: 1, max: BARS_MAX, step: 1, unit: 'bars',
        ariaLabel: 'Default bar range',
        onInput: (v) => set({ barCount: Number(v) }),
    });
    barsField.body.appendChild(barsSlider.el);
    passRack.body.appendChild(barsField.el);
    passRack.body.appendChild(c.el('p', 'fbk-note',
        'How many bars “From playhead” takes. Trimming in the panel '
        + 'moves whole bars, not seconds — a loop boundary off the grid '
        + 'turns a count-in into a guess.'));

    const widenField = c.field({});
    const widen = c.toggle('Widen the loop once a passage is nailed', null,
        (on) => set({ widen: on }));
    widenField.body.appendChild(widen.el);
    passRack.body.appendChild(widenField.el);
    passRack.body.appendChild(c.el('p', 'fbk-note',
        'The engine grows the loop by a bar each side, up to two, after you '
        + 'clear it — so an isolated lick goes back into its surroundings '
        + 'before you leave it.'));

    // ── MEMORY ───────────────────────────────────────────────────────────
    const memRack = c.rack({ label: 'Memory' });
    root.appendChild(memRack.el);

    const speedField = c.field({});
    const speedTog = c.toggle('Remember the practice speed per song', null,
        (on) => set({ rememberSpeed: on }));
    speedField.body.appendChild(speedTog.el);
    memRack.body.appendChild(speedField.el);
    memRack.body.appendChild(c.el('p', 'fbk-note',
        'The app resets playback to 100% every time a song loads. This puts '
        + 'back the speed you left this song at, which is what you want for a '
        + 'chart you are three sessions into at 80%.'));

    const diffField = c.field({});
    const diffTog = c.toggle('Remember the difficulty per song', null,
        (on) => set({ rememberDifficulty: on }));
    diffField.body.appendChild(diffTog.el);
    memRack.body.appendChild(diffField.el);
    memRack.body.appendChild(c.el('p', 'fbk-note',
        'Off by default, and worth understanding before turning on: the app '
        + 'stores master difficulty as ONE GLOBAL setting, not per song. So '
        + 'restoring a per-song value also changes the global one — the '
        + 'last song you opened decides what the next one starts at.'));

    // ── WHAT HAS BEEN MEASURED ───────────────────────────────────────────
    const storeRack = c.rack({ label: 'What has been measured' });
    root.appendChild(storeRack.el);
    const usage = c.el('p', 'fbk-note');
    storeRack.body.appendChild(usage);
    const storeRow = c.el('div', 'fbk-row');
    storeRow.appendChild(c.button('fbk-btn fbk-btn-small', 'Forget this song',
        'Clear this song’s passages and bests', () => { api.forgetSong(); sync(); }));
    storeRow.appendChild(c.button('fbk-btn fbk-btn-small', 'Forget everything',
        'Clear every song’s history', () => { api.forgetEverything(); sync(); }));
    storeRack.body.appendChild(storeRow);
    storeRack.body.appendChild(c.el('p', 'fbk-note',
        'Per-passage bests are kept in this browser only. A pack that gets '
        + 're-converted gets a fresh history, because its notes changed.'));

    // ── the foot: the escape hatch and the way back ──────────────────────
    const foot = c.el('div', 'fbk-sheet-foot');
    const status = c.statusLine();
    foot.appendChild(status.el);
    const offBtn = c.button('fbk-btn fbk-btn-small', 'Turn off', null, () => {
        if (api.isDisabled()) api.enable(); else api.disable();
        sync();
    });
    foot.appendChild(offBtn);
    foot.appendChild(c.button('fbk-btn fbk-btn-accent fbk-btn-small', 'Reset to defaults',
        'Put every value back to what the plugin ships with',
        () => { api.settings.reset(); sync(); }));
    root.appendChild(foot);

    function set(patch) {
        api.settings.set(patch);
        sync();
    }

    function sync() {
        const s = api.settings.get();
        const off = api.isDisabled();

        startSel.set(String(s.startPct));
        stepSeg.set(String(s.stepPct));
        goalSlider.set(s.goalPct);
        barsSlider.set(s.barCount);
        widen.set(!!s.widen);
        speedTog.set(!!s.rememberSpeed);
        diffTog.set(!!s.rememberDifficulty);

        /*
         * The rungs come from `buildLadder`, not from a loop written here: the
         * panel, the drill and this page have to agree on what the ladder IS,
         * and the settings page recomputing it by hand is how the three drift.
         * The old page did exactly that, with its own `for` loop.
         */
        const built = buildLadder(s.startPct, s.stepPct, null) || [];
        /* `buildLadder` restituisce PERCENTUALI (80, 85, 100), non frazioni:
           moltiplicarle per cento darebbe 8000%. */
        rungs.textContent = built.length
            ? '→ ' + built.join(' · ') + '%'
            : '';

        const u = api.usage();
        usage.textContent = `${u.songs} song${u.songs === 1 ? '' : 's'}, `
            + `${u.ranges} passage${u.ranges === 1 ? '' : 's'}, `
            + `${(u.bytes / 1024).toFixed(1)} kB.`;

        offBtn.textContent = off ? 'Turn Riff Repeater back on' : 'Turn Riff Repeater off';
        /*
         * Quiet unless it has news, like Live Tab's page: "changes are saved"
         * is how every settings page behaves and says nothing about this one.
         * Being switched off IS news — nothing else here explains why the
         * player has no button.
         */
        status.set(off ? 'warn' : null,
            off ? 'Off — no button in the player rail.' : null);

        startSel.disable(off);
        stepSeg.disable(off);
        goalSlider.disable(off);
        barsSlider.disable(off);
        widen.disable(off);
        speedTog.disable(off);
        diffTog.disable(off);
    }

    api.onChange(sync);
    sync();
    return { sync };
}
