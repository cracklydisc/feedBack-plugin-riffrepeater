# Changelog

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
