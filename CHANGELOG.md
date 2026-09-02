# Changelog

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
