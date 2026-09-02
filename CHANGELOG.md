# Changelog

## 0.5.1 — kit 0.2.0: the foundations the panel was missing

The kit gained the three scales — five type steps, six space steps, three
control heights — and this panel is rebuilt on them. Nothing about what it does
changed; what changed is that its values are on a scale instead of picked per
row.

The one visible defect it fixes: **every inline label now starts its control at
the same x.** `Playhead`, `Trim`, `Climb`, `Goal` and `Chart` each ended
wherever their own text ended, so four rows began at four different positions —
measured after the change, all five start at exactly the same pixel. The
`Playhead` row is labelled **Mark** now, because the longer word did not fit
the shared column and shortening the word was the right fix rather than moving
the column for one row.

Three more, all found by looking at the kit's new gallery rather than reasoning
about the CSS:

- The **Climb** chips had grown to fill their row and covered the rail
  completely — a ladder that read as a row of touching pills. They sit at their
  natural width now, spread along a visible track.
- **Start drill** centred its status dot, its label and its `D` cap together in
  the middle of an empty 336px bar. Dot leading, label centred, cap trailing.
- `85 %` read as two things, because the unit had inherited the micro step's
  0.1em tracking and drifted away from its number.

And `assets/gallery.html` ships with the plugin, so it can be served straight
from the dev server: `/api/plugins/riffrepeater/assets/gallery.html`. It is the
kit's page, not this plugin's, but a static file needs a route and this plugin
has one.

## 0.5.0 — on the kit

Everything shared moved out. `src/kit/` and `assets/kit.css` are vendored from
[feedBack-plugin-kit](https://github.com/cracklydisc/feedBack-plugin-kit), and
this plugin is its first consumer.

| | before | after |
| --- | --- | --- |
| this plugin's stylesheet | 866 lines | **187** |
| the token bridge | `src/theme.js`, 65 lines | the kit's |
| the panel shell and the rail button | `src/ui/mount.js`, 155 lines | the kit's |
| the four control families | hand-rolled in CSS | `kit.controls.*` |
| shortcut registration and teardown | inline | `kit.shortcuts.register()` |

What is left in `src/ui/panel.js` is what is genuinely about drilling a
passage: the timeline, the ladder's double life as a progress display, the
per-iteration row, and the wiring. Everything else is a kit call.

**The look is a game HUD now, not a settings sheet.** The kit implements
**Layer 2 of the app's own proposed theme contract** — every device is a
`--fbk-*` slot with `none` legal — so the panel has real depth (a glow on the
primary, a top inner light line, lit cells instead of bordered boxes) while a
glow-less shop skin can still neutralise the glow and get a solid border
instead of a control that vanished. A test in the kit reads the source and
fails on any literal hex or gradient.

Concretely, in this panel: the primary is a 42px gradient slab with a glow and
a status dot; steppers are circles, matching the player's own rail of circular
icons; section headings carry a hairline divider; numbers are 20px tabular
readouts instead of 11px text; and the difficulty slider is a HUD gauge that
is still an `<input type="range">`, because that is the control a keyboard can
operate.

### Fixed

- **"Start drill" and "End drill" showed at the same time.** The kit's
  `.fbk-btn { display: inline-flex }` beat the browser's own
  `[hidden] { display: none }` — same specificity, and an author rule wins —
  so `el.hidden = true` had quietly become a no-op. Fixed in the kit with a
  scoped `[hidden] { display: none !important }`, which closes it for every
  future consumer.
- A fourth instance of the `Number(null) === 0` trap, in the kit's new stepper:
  `set(null)` walked it to its minimum. There is one `num()` in the kit now and
  every number goes through it.

### Not deduplicated, and why

`settings.html` keeps its own copy of the retry dance. The kit ships
`settings-mount.js` for it, but a settings panel runs as a **classic** inline
script whose relative imports resolve against the document root, not the
plugin's asset route — so it cannot `import` the kit without hard-coding an
absolute plugin path and breaking if the plugin is ever renamed. Twenty-five
duplicated lines is the cheaper risk.

## 0.4.0 — A and B, from the playhead

The panel could set a loop from a section, a phrase, a bar count or a drag, and
none of those is how a guitarist actually marks a passage: you press A, let the
song run to the end of the phrase, and press B. Reading a clock and stepping a
number until it matches is the same job done backwards.

**`Set A` / `Set B`** take the playhead, snapped to the bar grid like
everything else here. Pressing A with nothing selected gives a loop of the
default bar count straight away, so there is always something armable between
the two presses instead of a half-defined range. Pressing B behind A is
refused with a sentence rather than guessed at by swapping them — two presses
in that order describe something, and it is not a loop.

**`I` and `O`** do the same from the keyboard, so the whole gesture happens
without letting go of the guitar. Verified end to end: `I` at 44.9s snapped to
bar 17, the song ran 16 seconds, `O` at 60.9s closed it at bar 24 — one loop,
14 notes, no mouse.

The buttons say A and B because that is the app's own vocabulary for these two
points. The keys are I and O because the 3D Highway already registers `A` in
the player scope for its framing tuner, and a shortcut that fights another
plugin for a key is worse than one that needs a tooltip. I and O are what a
video editor uses for in and out, which is the same idea.

## 0.3.0 — a timeline instead of a chip grid

A UI review of 0.2 landed five criticisms. Four were right and are fixed here;
one was already done and one is answered rather than implemented.

**A timeline replaces the 21+ section chips.** They were half the panel's
height and needed a careful read to find "Solo 1". A strip proportional to the
song answers "where is the solo" by position, which is how you already think
about a song you are learning — and it takes a **drag**, snapped to bar lines,
which no arrangement of chips can. Click a block for its section; drag across
for a custom range. The panel is 666px tall now instead of 810.

No waveform, deliberately. Drawing one means fetching and decoding a stem —
expensive, duplicating work the player already did, and pointless: the useful
signal here is not amplitude, it is where the sections are and how well you
play them.

**"Ladder" and "Speed" no longer wear the same costume.** This was the
sharpest thing in the review and it was completely right: two rows, the same
five numbers, no way to tell which was which. They ask different questions —
one is the set of speeds a drill *climbs*, the other is the speed the song is
playing at *now* — so they are different control families and different words
now. **Climb** is a chip group (pick a subset) on its rail; **Play at** is a
segmented control (pick one). Not merged into an initial/target/step model,
though: the engine takes an explicit array and that re-parameterisation cannot
express `[50, 80, 100]`.

**Colour means one thing again.** The chips carried an accuracy underline in
green/amber/red while selection was an accent border, and the reviewer read the
amber underline as a second kind of "selected" — exactly the failure that
critique names. Accuracy is now the timeline block's fill and the weak list's
bar; selection is a white bracket. One signal per channel.

**The two text boxes are gone.** The time-stretch caveat is a `⚠` badge beside
the ladder with its sentence in the tooltip. The note-detection state is a
**status dot on the Start button** — green when the detector is listening,
amber when present but off — with the reason on the button that it disables.
A third box, for an action that just failed, is now a line that clears itself
after six seconds, because a failure is an event and not a state.

**The primary has its own line.** At a third of a row with two siblings it read
weaker than the mode tabs above it. Alone, full width of a 320px panel, it is
the only lit thing in the panel. `Loop only` and `Clear` are small and quiet
beneath it.

**"Practice weakest"** selects the passage you play worst *and* arms a drill on
it, in one press. The list already made the decision; making you read it and
then find the button was two steps for nothing. Verified: one click went from
nothing selected to a drill running on Solo 1 at 8%, at 65% speed.

**Keyboard.** Registered through the host's own `window.registerShortcut`, so
they show up in its `?` panel and its Settings → Keybinds tab, and it warns
about collisions instead of two handlers quietly both firing. Which keys was a
question for the registry rather than for taste: in the `player` scope the app
already owns **Space** (play/pause), **← →** (seek), **Escape**, **[ ]** (A/V
offset) and **+ −** (volume) — so the obvious guitarist bindings were all
taken. What was free: **D** start/end a drill, **↑ ↓** speed ±5%, **, .**
previous/next section. Shown as key caps on the controls they drive.

### Already done, before the review

Every row of "Where you struggle" has been clickable since 0.1.0 — it selects
that passage. `Practice weakest` is the shortcut for the top one.

### Not doing, and why

A **double-thumb range slider** for the trim. The timeline's drag is that, with
bar snapping, and a second range widget for the same job would be two ways to
set one thing.

### Fixed

- `api.open()` opened the panel outside the player. The highway keeps the last
  song's sections after you navigate away, so `ready` stayed true and the panel
  came up over the song library. The button was already hidden off the player;
  the programmatic path is guarded now too.
- A click on the timeline resolved the section from `e.target.closest(...)`,
  which needed the pointer to land on a block — so a click on the hairline
  between two of them fell through to a one-bar range. Resolved from the time
  instead.

## 0.2.0 — parked in the corner, and less of a form

**The panel no longer floats next to its button.** It is parked at top-right,
64px/12px, portalled to `<body>` — the same corner and the same idea as the 3D
Highway's settings pane and Live Tab's panel. Live Tab got there first and its
commit says why: a panel anchored to a pill inside the player's scrolling
`<main>` is clipped by that element rather than by the screen, and a panel
pinned by one edge can only grow from the other, so changing a control moves
the whole thing. Anchoring also put it over the notes, which is what prompted
this. All of the placement code is gone — no measuring the trigger, no flipping
sides, no re-anchoring on resize.

Finding the right layer took a measurement rather than a guess: core's
`style.css` gives `#player` `position: fixed; inset: 0; z-index: 100`, so it is
a full-screen layer and the first attempt at z-45 was positioned perfectly and
invisible behind it. 150 clears the player and stays under the guided-tour menu
(200/201) and the detector's drill HUD (210), which has to keep covering this.

**The controls stopped reading like a preferences sheet.** Four changes, each
one taken from the design language the Virtuoso plugin already writes down for
this app:

- **The ladder does double duty.** Idle it is still the setting — tick the
  rungs a drill should climb. Running, it *is* the progress display: the rung
  being played is filled, cleared rungs go green, the rest wait outlined, and
  they sit on a rail so it reads as a climb. Turning a setting into a status
  readout is most of what separates a HUD from a form, and here it cost one
  extra class rather than a second widget. The state comes from the engine's
  ladder, not from the setting — they can differ, because a drill keeps what it
  was armed with while you are free to re-tick for the next one.
- **The goal is a stepper, not a text field.** `− 85% +`, in 5s, 50–100. A
  number you type reads as a form; a number you set with ± reads as a game
  option. The full 10–100 range stays on the settings page, which is where a
  number field belongs.
- **"Widen when nailed" is a toggle pill**, the way the app draws a boolean,
  and it shares the goal's row — two settings, one line, no prose.
- **One lit primary.** `⏱ Start drill` is bigger and accent-filled; `Loop only`
  is a plain secondary and `Clear` is quiet. `✕ End drill` takes the primary's
  slot and size when a drill is running, so the thing you press to stop is
  exactly as findable as the thing you pressed to start.

**And four paragraphs of explanation left the panel.** They live in `title`
now. The only note still drawn is one that explains a control that is not
working — a single-tier chart's dead difficulty slider, or the drill owning the
speed — plus the time-stretch warning, which is a real warning and stays.

The section chip list lost its own scrollbar. Its `max-height` cut the last row
of chips in half, which read as a rendering fault rather than as "there is more
below", and it put a second scrollbar inside a panel that already had one.

### Fixed

- The panel failed to load at all for one run: rewriting `mount.js` restored an
  old import path (`../src/host.js` from inside `src/ui/`, which resolves to
  `src/src/host.js`) and the module graph 404'd.

## 0.1.0 — a way into the drill engine

The first version. It exists because the drill conductor in `note_detect` is a
finished, tested riff repeater that nothing calls: its own source says the
button was meant to live in a coaching plugin, and that plugin was never
written. The only thing that ever started a drill was an auto-trigger that
defaults to off.

**Picks the passage, at three grains.** Sections built exactly the way the app's
own Section Practice builds them, so a chip here means the same seconds as a
chip there. The phrases inside a section — the app's "Part *n* of *m*". And any
run of bars, taken from the bar under the playhead, which is the grain the app
has never offered. Trimming moves whole bars rather than the engine's two
seconds, because two seconds is a different amount of music in every song.

**Drives the drill.** A speed ladder chosen from 50 · 65 · 80 · 90 · 100 and a
goal, handed to the engine as its `speedLadder` and `goal`. The engine's own
floor is 80% — a reasonable judgement about time-stretch artefacts and an
unreasonable one for a passage you cannot play at 80% — so the slower rungs are
here with a note about what they cost. 100% is always the last rung.

**Reads the engine back rather than tracking it.** Rung, goal, best-so-far, the
coaching line and every graded pass come from `getConductorState()` and
`getDrillStats()`. Two copies of that state is how a HUD ends up disagreeing
with the thing it describes. The one sentence this plugin writes itself is
what has to happen next, because it changes at the top of the ladder: below it,
clear the goal to speed up; at it, clear it three times at tempo to finish.

**Remembers.** The practice speed per song, because the app resets playback to
100% on every load. The best per passage, as a coloured underline on the chips
and a *Where you struggle* list, worst first — live while you play, from the
store when you are not. The difficulty per song too, off by default, because the
app stores master difficulty globally and restoring a per-song value moves the
global one.

**Brings three controls together.** Loop, speed and difficulty are the three
knobs of one activity and live in three different places today: the Practice
rail pill, the *Advanced settings* popover, and the transport. The panel carries
all three next to the passage they apply to.

### Things it refuses to do

- No control over the full-speed repetition count: the engine fixes it at three
  and takes no option for it, and a control the engine ignores is worse than
  none.
- Verdicts scored while a drill runs stay out of the per-passage map. A drill
  plays the same fifteen seconds ten times, slowed; folding that in would make
  every drilled passage report whatever its last iterations looked like.
- A drill abandoned before a pass has been graded records nothing. The engine
  reports `best = 0` there, and storing it would stamp 0% onto a passage nobody
  played.

### Bugs fixed before the first release

Three of these were found by the tests as they were written, and all three were
the same mistake: `Number(null)` is `0`, and `0` passes `Number.isFinite`.

- A passage that had only ever been drilled was stored with `best: 0` — a
  never-measured value reading as "missed everything".
- `displayAccuracy` preferred an absent drill result over a real normal-play
  one, for the same reason.
- The accuracy band for a never-played passage came out `low` (red) instead of
  `none`.

And three found in the running app:

- The panel came up with 21 section chips and nothing selected. `song:loaded`
  carries the song identity a beat before `highway.getSections()` returns
  anything, so the first pass built the table empty; the selection is now
  re-seeded whenever it is missing, not only when the song changes.
- The panel's speed row highlighted 100% while a drill played at 80%. The
  engine changes speed through `window.setSpeed`, which moves the rate and the
  label but never writes the slider's value — so the slider is the user's
  choice and the audio element is the truth, and the two are now read
  separately.
- A freshly picked bar range reported `null` notes. The per-range event counts
  were cached on the difficulty alone, and a new bar range does not change the
  difficulty.

One thing removed rather than fixed: the panel's fade-in. In an embedded webview
the opacity transition did not always tick, leaving the panel frozen at 0.8
opacity with the highway showing through its text — indefinitely. A panel's
legibility must not depend on an animation completing.
