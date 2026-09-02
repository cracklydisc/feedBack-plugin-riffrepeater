# Riff Repeater

A way into the drill engine fee[dB]ack already has, for
[fee[dB]ack](https://github.com/got-feedback).

The Note Detection plugin ships a complete riff repeater: a five-second audible
lead-in with a beat-locked click, an accuracy goal per pass of the loop, a
speed ladder it climbs as you clear it, an auto-slowdown after three sub-goal
passes, loop widening once the passage is clean, and a coaching line. It is
covered by its own tests. What it has never had is a way in — its source says
so:

> `// NOTE: no standalone "Drill here" button here on purpose. The drill`
> `// conductor is a headless engine driven through feedBack's existing UI`
> `// (the coaching plugin's post-play "Drill this run" / "Practice this"`
> `// buttons call window.noteDetect.startDrill).`

That coaching plugin was never written. Nothing in the ecosystem calls
`startDrill`, so the only thing that ever starts a drill is the auto-drill
trigger — a setting that defaults to `0` (off) and lives three screens away on
the Note Detection settings page. A complete, tested feature that a player has
no way to reach.

Riff Repeater is the missing caller. It adds no state machine of its own: it
picks the passage, hands the engine a ladder and a goal, reads the engine's
state back, and remembers what happened.

**Status: alpha.** Built and verified against a local library of about forty
converted charts.

---

## Install

Your fee[dB]ack plugins directory is:

| | |
|---|---|
| Windows | `…\Feedback\resources\slopsmith\plugins\` |
| Linux / macOS | the `resources/slopsmith/plugins/` folder inside your install |

### With git — recommended

```
cd …/plugins
git clone https://github.com/cracklydisc/feedBack-plugin-riffrepeater.git riffrepeater
```

Restart fee[dB]ack, open a song, and the player's **Plugins** rail button has a
**⏱ Riff Repeater** in it. The panel opens parked at the top-right corner — the
same place the 3D Highway keeps its settings pane and Live Tab its panel, so it
never sits over the notes and never moves when a control changes.

Installed this way the app can update it for you: **Plugins → Check for
Updates** finds new versions and installs them with one click.

### Without git

Green **Code** button → *Download ZIP*, unpack it, and rename the unpacked
folder to `riffrepeater` inside your plugins directory. You should end up with
`…/plugins/riffrepeater/plugin.json`. Restart fee[dB]ack.

### It needs Note Detection

The drill engine lives in the `note_detect` plugin, and a drill is graded from
what you actually play. Without it the panel still picks passages, loops them,
and remembers your speed — but the **Start drill** button stays disabled and
says why.

---

## What it does

### Picks the passage — at three grains

**Section** — the same passages the app's own Practice popover lists, built the
same way (consecutive same-name markers collapse, repeats get counted). A chip
here is the same seconds as a chip there; that agreement is checked by
[`tests/ranges.test.js`](tests/ranges.test.js).

**Phrase** — the phrases inside a section, the app's "Part *n* of *m*".

**Bars** — any run of measures, taken from the bar under the playhead. This is
the grain the app does not offer and the one a guitarist actually asks for.
The engine's own trim moves the loop edges by **two seconds**; two seconds is a
different amount of music in every song, so this trims by **whole bars**
instead. A loop boundary off the grid turns a count-in into a guess.

The readout tells you what you have picked and what it costs: `Verse 1 · 1:24 →
1:39 · 15.3s · 95 notes`. The note count comes from the *filtered* chart, so it
follows the difficulty slider — at 60% a passage genuinely has fewer notes in
it.

### Drives the drill

Pick the ladder as rungs — **50 · 65 · 80 · 90 · 100** — and a goal. The
engine's default ladder is `[80, 90, 100]` and its floor of 80% is a judgement
about time-stretch artefacts, which is reasonable about the sound and not
reasonable for somebody learning a passage they cannot play at 80%. So the
slower rungs exist and the panel says what they cost.

100% is always the last rung. A ladder that tops out at 90% never asks you to
perform the passage, which is the point of the exercise.

While a drill runs, the panel shows the engine's own numbers — rung, goal,
best-so-far, its coaching line — plus every graded pass as a row of
percentages, so you can see whether you are improving or just repeating. And it
says what has to happen next, which changes at the top of the ladder: below it,
*clear the goal to speed up*; at it, *clear it three times at full tempo to
finish*.

### Remembers

**Your practice speed, per song.** The app resets playback to 100% on every
song load, which is right as a default and wrong for a chart you are three
sessions into at 80%.

**Your best, per passage.** Section chips carry a coloured underline for how
well you have played them, and a **Where you struggle** list puts the worst
first — from this run while you are playing, from the store when you are not.
Click a row to select that passage.

**Optionally the difficulty, per song** — off by default, and worth
understanding before turning on: the app stores master difficulty as *one
global setting*, not per song, so restoring a per-song value also moves the
global one. The settings panel says so.

### Brings the controls together

Loop, speed and difficulty are three controls in three different places today —
the sections in the Practice rail pill, the loop and the difficulty in the
*Advanced settings* popover, the speed in the transport. They are the three
knobs of one activity, so the panel carries all three next to the passage they
apply to.

### Reads as a HUD, not a preferences sheet

The panel is something you look at with a guitar in your hands, so it follows
the control taxonomy the Virtuoso plugin already writes down for this app: two
families for "pick one of N" and no others (a segmented control for the mode
tabs, chip groups for the sections, the ladder and the speed presets), a toggle
pill for a boolean, one lit primary sized to its label, and no text inputs.

The clearest instance is the ladder, which does double duty: idle it is the
setting, and while a drill runs it *is* the progress display — the rung being
played is filled, cleared rungs go green, the rest wait. The prose that used to
sit under each control moved into `title`; the only note still drawn is one
that explains a control that is not working.

Values a stepper cannot reach live on the settings page. A form belongs there,
not in the player.

---

## What it deliberately does not do

- **No control over the number of full-speed repetitions.** The engine fixes it
  at three and takes no option for it: `startDrill` accepts `label`, `focus`,
  `goal`, `speedLadder`, `expandContext` and `maxExpansions`, and nothing else.
  A control the engine ignores is worse than no control.
- **No second scoring system.** Timing and pitch verdicts, the clean-hit
  windows, the miss diagnostics on the highway — all of that is Note
  Detection's, and this reads it rather than reimplementing it.
- **No verdicts counted twice.** Verdicts scored *while a drill runs* are left
  out of the per-passage map. A drill plays the same fifteen seconds ten times,
  slowed; folding that in would make every drilled passage report whatever its
  last iterations looked like. The engine measures drill iterations properly and
  reports a best when the drill ends — that arrives separately.
- **No drill result from a drill you abandoned.** Ending one before a single
  pass has been graded reports `best = 0`, and storing that would stamp 0% onto
  a passage nobody played.

---

## Settings

**Settings → Plugins → Riff Repeater** carries the defaults a drill starts
with, the two *remember this* switches, and the store. Everything about a
specific passage lives in the panel, next to the passage.

Per-passage bests are kept in this browser's `localStorage` only, keyed by the
pack's filename (which carries its content hash) plus the arrangement. A pack
that gets re-converted starts a fresh history — inheriting a best earned
against different notes would be the dishonest option even though it keeps
more.

---

## For other plugins

`window.riffRepeater` (feature-detect it):

```js
window.riffRepeater.open();                       // show the panel
window.riffRepeater.ranges();                     // { sections, parts, bars }
window.riffRepeater.select(key);                  // pick a passage
await window.riffRepeater.startDrill();           // drill the selection
await window.riffRepeater.startDrill({ start, end, label });   // …or any range
window.riffRepeater.endDrill();
window.riffRepeater.drillState();                 // the engine's state, in percentages
window.riffRepeater.map();                        // { ranges, weakest, run } for this song
window.riffRepeater.settings.get() / .set(patch);
window.riffRepeater.onChange(fn);                 // -> unsubscribe
```

`map().weakest` is the interesting one: the passages you play worst, worst
first, with a `live` flag saying whether the number is from this run or the
store. A practice-journal or a career plugin can build a session plan out of it
without touching a note event.

---

## Merging this into core

This repository is shaped for that, because a floating panel launched from the
plugins rail is not where these controls belong. In core they belong in a
**third row of the Section Practice popover**, next to the chips the user
already clicks. The reason they are not there now is that the popover has no
sanctioned extension point for a plugin — core's `docs/plugin-v3-ui.md`
documents exactly one, `feedBack.ui.playerControlSlot()` — and injecting would
mean winning on specificity and re-injecting after every re-render, the way
Tidy has to.

So the split is by directory:

| | |
|---|---|
| `src/*.js` | pure logic and one host seam. **Moves** to `static/js/`, unchanged. |
| `src/ui/*.js` | the button, the panel, the portal. **Thrown away.** |
| `assets/riffrepeater.css` | the panel's look. Mostly thrown away; the chip bands and the weak-list rows are worth keeping. |
| `tests/*.test.js` | move with `src/`. |

Nothing in `src/` outside `src/ui/` touches a DOM node of its own, and none of
those files import anything from `src/ui/`. The panel reads exactly one thing —
`model.snapshot()` — and writes through exactly one thing, the `actions` object
in `src/main.js`. Re-mounting it is a matter of building the same rows inside
`_sectionPracticeBarInnerHtml()` and pointing them at the same actions.

Two things learned from the DOM, in case that PR is written by somebody else:

- `#section-practice-bar` tolerates a third row. `renderSectionPracticeBar()`
  rewrites only `#section-practice-scroll`, and `_ensureSectionPracticeDom()`
  patches in place rather than rebuilding. The one hazard is
  `_migrateSectionPracticeDomLayout()`, which does `bar.replaceChildren(...)`
  and would drop an unknown child — but it is guarded by
  `if (bar.querySelector('.section-practice-controls-row')) return`, so on
  current markup it never runs.
- `src/ui/` lives under `src/` because `/api/plugins/<id>/src/<path>` and
  `/api/plugins/<id>/assets/<path>` are the only two file routes a plugin gets.
  A top-level `ui/` 404s.

### Three host quirks worth fixing upstream, found while building this

1. **`window.setSpeed` does not write the speed slider.** It moves the rate, the
   label and the preset highlight, but leaves `#speed-slider.value` at its old
   number — so while a drill runs the slider reads 100 and the song plays at
   0.8. `applySpeedPreset` does it correctly. `src/host.js` splits the two
   readings (`speedPct` = what is playing, `chosenSpeedPct` = what the user
   picked) rather than trusting either alone.
2. **`song:loaded` fires before the section table exists.** The song identity is
   available a beat before `highway.getSections()` returns anything, so any
   consumer that builds a table on `song:loaded` gets an empty one and has to
   rebuild on `song:ready`.
3. **An unnamed section marker becomes `Section`, not `Section 5`.** The host's
   `_sectionPracticeBaseName` builds the positional fallback and *then* strips
   trailing digits, taking its own number off. The visible label is fine because
   the counter re-adds one; it is only surprising if you rely on the helper
   directly. Reproduced here rather than fixed, so the labels keep matching.

---

## Development

```bash
node --test tests/*.test.js
```

88 tests, no dependencies, no build step. The four suites cover the pure
modules — the range table, the ladder, the per-passage statistics, and the
store. The host seam, the model's wiring and the panel are verified in the
running app instead; they are the parts that a unit test can only mock.

To develop against a checkout rather than an install, point the app at a
directory of symlinks:

```bash
FEEDBACK_PLUGINS_DIR=/path/to/dev-plugins
```

Bump `version` in `plugin.json` whenever `assets/riffrepeater.css` changes —
the stylesheet is cache-busted with `?v=<version>`.

---

## License

AGPL-3.0-or-later, matching fee[dB]ack. See [LICENSE](LICENSE).
