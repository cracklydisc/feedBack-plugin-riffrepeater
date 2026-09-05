# Changelog

## 0.36.10 — first release

The first version anyone else can install. Everything below this line was
development in the open on an unreleased branch: the numbers between 0.1.0 and
0.36.9 were working markers between commits, not releases, and treating them as
such would imply thirty-five versions nobody could ever install.

### What it is

A way into the drill engine fee[dB]ack already has. Note Detection ships a
complete riff repeater — lead-in, per-pass accuracy goal, a speed ladder it
climbs as you clear it, auto-slowdown, loop widening, coaching — and no way to
start it. Its own source says the button was meant to live in a coaching plugin
that was never written. This is the missing caller: it picks the passage, hands
the engine a ladder and a goal, reads the engine's state back, and remembers
what happened.

### What it adds

- **A passage picker on the player's rail.** Sections, phrases ("part 3 of 6"),
  or a range you drag on a strip of the whole song. Two arrows walk part by
  part, two more section by section, and the edges nudge by a bar.
- **Selecting takes the song there.** The strip tells you where you are in the
  song, not what that point sounds like — so choosing a block moves the
  playhead to its start. It neither starts nor stops playback.
- **A ladder from three numbers.** A start, a step, and a top that is always
  full tempo: `80 · +5` becomes 80, 85, 90, 95, 100. The rungs below 80 exist
  only if you ask for them.
- **A per-passage memory.** What you have played, how well, and when — kept per
  song, so the panel can point at the passage you are worst at and drill it in
  one press.
- **A HUD while a drill runs.** The current rung, the goal, the pass you are
  on, and the score of the last one — read from the engine, not invented here.

### What it deliberately does not do

The engine's limits are the plugin's limits, and the panel does not pretend
otherwise: the three full-speed repetitions, the three-strike auto-slowdown and
its 15-point step are constants inside Note Detection that `startDrill` takes
no options for. A control the engine ignores is worse than no control. The
README lists what a change upstream would unlock.

### Built on the plugin kit

Every control comes from the [fee[dB]ack plugin
kit](https://github.com/cracklydisc/feedBack-plugin-kit), vendored rather than
imported so that no plugin can be turned off and take this one's panel with it.

### Known limits at release

- The desktop build plays songs through a native engine, and a single-stem pack
  can end up with two transports at once. The plugin puts the `#audio` door
  back on the app's transport when that happens; the underlying fix belongs in
  the app.
- Verdicts scored while a drill runs are left out of the per-passage map on
  purpose — a drill plays the same fifteen seconds ten times, and folding that
  in would make every drilled passage report its last iterations.

---

## 0.13.0 — the rack

The panel is a rack unit now: three racks, wells cut into them, and a
footswitch. It is your design, built, and the components are all in the kit —
which was the point, so Live Tab adopts a design system rather than a
stylesheet.

### The ladder is generated, not ticked

Three numbers instead of five chips:

```
START 80 · STEP +5   ->   80 · 85 · 90 · 95 · 100
START 50 · STEP +10  ->   50 · 60 · 70 · 80 · 90 · 100
```

Three reasons, and the third is the one that paid:

1. It expresses ladders the chips could not — five fixed values could not
   give you 85 or 95 at all.
2. Three controls instead of five, and they are steppers, a family that
   already means "a number you set".
3. **The slow rungs cost nothing now.** With chips, offering 50% meant a chip
   on screen forever *plus* a caveat badge explaining time-stretch. With a
   start you set, a rung below 80 exists only if you asked for one — so the
   warning went, exactly as you said it should.

**The top rung is always full tempo and has no control**, because a drill that
never asks for the real tempo has not taught the passage.

**And the two hundreds are not the same hundred.** `GOAL 100%` is the share of
notes a pass has to land; the rail's top rung reading 100 is a speed. I
conflated them, wrote a migration that read the ladder's top as the goal, and
it silently overwrote a stored 85% accuracy with 100 — caught by the store's
migration test, which is the only place the two numbers sit side by side.
`src/ladder.js` now has a paragraph about it.

**The store migrates rather than discarding.** The version gate used to blank
the whole blob on a shape change, which is cheap to write and expensive to
receive: the settings are six numbers, the songs are every passage you have
ever practised. `[80, 90, 100]` becomes start 80, step 10; an unevenly spaced
`[50, 65, 80, 90, 100]` takes its **smallest** gap, so you get more rungs than
you had — the safe direction, because a ladder that *skips* a rung you relied
on is a drill that suddenly asks for a speed you cannot play.

### The strip is the only loop selector

Four controls retired: three mode tabs, two section chevrons, a phrase
stepper, two rows of edge steppers. Every one of them was a way of spelling
out in numbers the thing you wanted to point at.

It draws **phrases** where the chart has them — 17 blocks on *Waterloo* rather
than 10 sections — and sections where it does not, because the strip being the
only selector means what it draws decides what grain you can pick at all.

The `±` steppers survive for the one job a pointer is bad at, moving an edge by
exactly one unit, and `BARS | TIME` in the rack's header says which. **BARS is
the default** and TIME is the escape hatch: a boundary off the bar grid turns
the count-in into a guess, so the unit that can produce one is the one you have
to ask for. Their label carries both — `A · ±1 bar` — which is why the label
had to move *inside* the stepper.

`,` and `.` still walk the blocks, so removing the chevrons cost nothing: the
gesture stayed and the host's help panel still lists it.

### `PLAY AT` came back as `START`

I flagged twice that dropping it lost a control justified by measurement — the
host's speed slider auto-hides at `opacity: 0`. The answer turned out to be
that there was never more than one number: **the speed you want to practise at
IS the speed a ladder starts from.** So `START` sets the live playback rate
while no drill is running, and the arrow keys move it. That also settles the
"which speed wins?" report from three versions back — nothing wins, because
there is only one.

### What the footer says

The status line sits above the footswitch and is **silent when everything is
fine**: "note detection on" is a signal that carries nothing. Blocked, it gets
a well and an amber stroke and carries its own way out —

> ● Turn on note detection in the player — a drill is graded from what you
> play.  **Turn on ›**

— because a blocked state you cannot act on is a dead end.

### Verified in the game

| | |
| --- | --- |
| racks | Loop · Speed · Weak spots |
| blocks on the strip | **17** (phrases) |
| rungs on the rail | 5, from start 80 step +5 |
| stepper labels | `START` `GOAL` `A · ±1 bar` `B · ±1 bar` |
| the live number | 1, and it is `START` |
| console errors | **0** |

120 tests here, 62 in the kit.

### Fixed on the way

`settings.html` kept a `for (const r of rungs)` from the chip era, iterating
what is now a readout span — and because that page mounts once at plugin load,
the error survived four reloads before I stopped assuming a cache and read the
stack.

## 0.11.0 — the review, point by point

Eight items. Seven are implemented as asked; one is implemented differently
and this says why.

### 1a. "Arrows on arrows"

Two stepper-shaped controls stacked: `◄ Whole section · 3 phrases ►` and
`‹ Chorus 1 ›`. The **chevrons** are the pair that had to go, because they are
the ones the timeline already does — a click on a block picks a section in one
gesture instead of counting presses. The phrase stepper cannot be replaced
that way, since the strip carries no phrase marks.

The `,` and `.` shortcuts stay registered, so section stepping is still there
for a keyboard or a controller and still listed in the host's help panel. What
went is the visible duplicate. **Rows of arrows: 4 → 3.**

### 1b. A and B looked like isolated keys

They were, and it was mine: 0.8.0 pushed each nudge cluster to the far right
on the reasoning that the gap says "setting an edge and nudging it are two
jobs". A 130px gap between a button and the value it writes says they are
**unrelated**, which is louder than any distinction it was drawing. A sits
against its own stepper now — `[A] [−] 0:32 [+]`, measured at x=0 and x=38.

### 2. The open accordion was dead space

Right, and §4 of the kit's DESIGN.md had said so before I wrote it: *no
paragraph of explanation, and no box drawn to hold one*. I added two anyway in
0.10.0, justified with "inside a shut fold verbosity costs nothing" — and the
fold made the prose **cheap**, which is not the same as making it **wanted**.

Both gone. The scope note is on the heading's tooltip; the `Widen when clean`
sentence is on a `?` badge, which is the device the kit already documents for
something you may want to read once. **Paragraphs in the fold: 2 → 0.**

The label keeps its object, though — `Widen when clean`, not `Widen`. That
half of 0.10.0 stands: a bare tooltip on a two-syllable verb is what made the
question necessary in the first place.

### 3. "Which speed wins?" — done, but not the way the review asked

The review asked for `PLAY AT` to grey out **when the accordion is open** or
when a drill starts. The second half already worked (`speed.disable` on
`drill.active`), and the first I did not do: opening a fold to *read* your
ladder should not disable a live playback control, because nothing has changed
except that you looked.

The real gap was that nothing answered the question **before** pressing, which
is when it is asked. So the heading answers it, in five words, and only when
the answer is not already obvious — when a drill would start at a speed other
than the one selected:

```
PLAY AT ──────────────── a drill starts at 80%
50   65   80   90  [100]
```

It disappears when they agree, and reads *the drill is driving this* while one
runs. Five words that appear on a genuine discrepancy are the opposite of a
paragraph.

### 4. `CHART` and `100 %` were detached

Third shape in three versions, and this one is right. As a one-row
`CHART` + track + `100 %` the track got **129px** of a 306px body. As a field
— label line above a full-width track — it got 296px but cost a row, and left
the label and its value at opposite ends of it. Value beside its label answers
both: they read as one unit and the track gets **194px**, on one row.

The kit's DESIGN.md §18 now records that this **overruled its own** "use fewer
alignments" advice from one version earlier. That rule was describing a
symptom of a layout with no system; "combine labels and values" is the more
specific one and wins.

### 5. The bottom bar

- **The `D` cap**: 20px of side padding is right for a full-width primary on
  its own line; beside an alternative the primary is ~204px and 20px reads as
  the cap jammed into the corner. Now 10px of padding and 11px on a 22px cap
  against a 14px label — **79%** of the label's size, which is a key rather
  than a scrap.
- **`Loop` → `Free loop`.** One word was too generic to contrast with
  anything. `Free` is the contrast that matters: the drill has a goal, a
  ladder and a grade; this has none of them.

### 6. The default goal is 100%

Worth naming the cost, since it is a real one: at 100 a passage has to be
played with **every judged note clean** before the ladder steps up, so the
climb is slower and a rung can repeat many times. The conductor's own default
is 0.85 for exactly that reason.

The argument for 100 anyway is that "clean" is the standard this kind of tool
is measured against, and a goal that graduates you at 85% teaches a passage
you can *nearly* play. The stepper still reaches 50 in five-point steps for a
passage where that is too much to ask.

114 tests.

## 0.10.0 — the verb moves to the bottom, and Widen explains itself

Four reports, and the fourth is the one that reorganised the panel.

### "Does it make sense to have the main action halfway down the panel?"

It did not. The primary sat where the controls happened to stop — after the
passage picker, before the speed row — which on a scrolling panel is
mid-scroll. You configured, then hunted. Worse, the three groups *below* it
(speed, chart difficulty, the weak list) read as though they came **after**
pressing, which is backwards.

It is in a **sticky footer** now — new in kit 0.7.0, and the same mechanism
the panel's head already used, mirrored. A short panel keeps it in the natural
flow; a long one always has the verb on screen. One layout, no media query.

### "That you can start with either Start drill or Loop only isn't clear"

Also right, and it was a placement problem rather than a wording one: a
quieter button **underneath** a primary does not read as a choice, it reads as
a caption. Beside it, at a lower tier, it reads as the alternative it is.

```
┌──────────────────────────────┬────────┐
│      ⏱ Start drill      D    │  Loop  │
└──────────────────────────────┴────────┘
```

The kit's DESIGN.md §2 said "one lit primary, **on its own line**", so this
amends that rule rather than quietly breaking it. The old wording was the
right fix for the version that put the primary in a row with two siblings of
similar weight — where it read weaker than the segmented control above it —
and the wrong rule to generalise from that bug. The rule now: the primary
shares its line with at most one thing, and only with an alternative to
itself. A glow beside a bordered secondary never raises "what do I press?";
it answers "is there another way?", which the caption could not.

### "Start drill is disabled and I can't tell why"

The sentence explaining it was already on screen — and two rows below, under
`Loop only`, separated from the button it was about by another control. It is
in the footer now, immediately above the primary. Verified for all three
states:

| | note | primary |
| --- | --- | --- |
| detection off | *Turn on note detection in the player — a drill is graded from what you play.* | dead |
| passage with no notes | *This passage has no notes in it, so there is nothing to drill.* | dead |
| ready | hidden | live |

### "The text on the right is truncated when the menu opens"

The fold's summary is the flexible cell of a three-cell row — about 165px on a
336px panel — so the scope note put there arrived as *"applies to every
passage, every …"*. A summary that has stopped summarising.

That slot is for a **value**. The prose is a `.fbk-hint` at the top of the
fold's body now, at full width, next to the controls it describes — which is
also the moment it is wanted, since you are reading it because you are about
to change one. Open, the head shows the title and nothing else.

### "What is the Widen button for?"

The answer is the report. It was a two-syllable verb with no object, wedged
onto the end of the goal row where there was no room for more, explained only
by a tooltip.

Restoring the object says most of it — **Widen when clean** — and it has its
own row and a sentence now:

> Once you clear the goal at full speed, the loop grows by one bar each side
> (up to two) so you play the passage back into the music around it before the
> drill lets go.

Room for that is exactly what the fold bought. This is policy, it is shut by
default, and inside a shut fold verbosity costs nothing — so the control that
needed thirty words to be usable can have them.

114 tests.

## 0.9.0 — a dead end, a stray pair, and Refactoring UI by measurement

Four reports. The first is a bug I shipped in 0.8.0; the rest are the panel
being honest about itself.

### The whole timeline went hatched, and there was no way back

**Zero out of zero is not empty, it is unknown.** 0.8.0 started *acting* on a
note count of 0 — hatching the block, dropping it from the hit table, refusing
to drill it — and `countEvents` cannot tell "this passage has no notes" from
"the host is reporting no notes at all". It reports nothing in more states than
you would expect: between `song:loaded` and the chart arriving, after a song is
closed while the panel still holds the last section table, on an arrangement it
has no note array for. In any of those the strip went uniformly hatched and
**nothing on it could be clicked** — the panel had turned one missing input
into twenty-one confident assertions.

The question is asked once now, of the chart: no events anywhere means every
count stays `null`, and null means unknown all the way down. A passage is empty
only when the chart has notes somewhere and none of them are here. Verified in
the app: 1 hatched block out of 10, which is the Noguitar marker.

**And a custom range had no exit.** Both phrase arrows were disabled in `bars`
mode, so the walk dead-ended. That matters more than it looks: 0.6.0 removed
the mode tabs on the argument that position zero of the phrase stepper *is* the
whole section — and that argument only holds if every state can reach position
zero. A step back now lands on the whole of the section the range **starts** in
(not the previously selected one, which could be anywhere and would read as the
panel losing your place), and the arrow's tooltip says so.

### `Loop only` and `Clear` looked placed at random

They were, in the sense that mattered: two buttons sharing a row while being
different kinds of thing, with nothing saying what either belonged to.
`Loop only` is an **alternative** to `Start drill`. `Clear` drops the loop that
**A and B define three rows above**.

So they were grouped by proximity instead. `Clear` moved onto the *What to
loop* heading — which is also the pattern the panel already used once, since
`Practice weakest` sits on its own heading the same way — and `Loop only`
stayed under the primary, alone, quiet and centred, where it reads as "or just
loop it".

### The fold did not look like it opened

Correct, and the row was telling the truth about itself: the chevron was
**trailing, 200px from the title, and the lowest-contrast thing in its own
row** — the only signal the row does anything, placed where nobody looks, at
the weight of an afterthought.

Chevron leads now, at the value's contrast rather than the label's, with a
hover surface covering the whole row (the row is the hit target — kit
DESIGN.md §12). And the summary right-aligns as a consequence, which was worth
having on its own:

| value | right edge, before | after |
| --- | --- | --- |
| Chart readout | −14px | −14px |
| fold summary | **−26px** | **−14px** |
| weak-list % | −20px | −20px |

### Refactoring UI, applied by measurement

The panel was counted rather than admired: **41 bordered elements** in 336px.
That sounds damning until you look at what they are — 10 steppers, 5 chips, 4
buttons, a toggle track, a segmented track, where the border **is** the
control; plus 10 hairlines between timeline blocks, which are the only thing
separating one block from the next. What was actually wrong was three
**containers** drawing a boundary twice, over a background that already
separated them: the plate, the timeline track and the live-drill box. Those
went. The other 38 stayed. The rule is not "fewer borders", it is *one signal
per boundary*.

The kit's DESIGN.md §18 records this, and also what this panel deliberately
does **not** take from the book — the section headings keep their hairlines
(replacing four with whitespace needs more vertical space than there is, and
they are the app's own device), and the uppercase micro headings stay labels,
because each names a *group* of controls rather than a single value.

### Two CSS facts, learned getting that −26 to −14

- **A `<button>` shrink-to-fits even with `display: flex`** — its `width:
  auto` is fit-content, not fill-available. Removing `width: 100%` collapsed a
  296px row to 264.
- **A fixed-width box with negative horizontal margins shifts rather than
  widens.** `width: 100%` plus `margin: 0 -6px` moved the head 6px left and
  left it 6px short on the right, so a hover surface meant to bleed past the
  padding bled out of one side only and the value stayed 12px inside the
  alignment it had just been moved to join. The bleed was the nicer detail; the
  alignment was the documented one, so the bleed went.

114 tests (+3 for the way out of a custom range).

## 0.8.0 — three details, three rules

Reported: the Chart slider should run to the end of the panel; the colours
inside `Start drill` can't be seen — the green disappears and the `D` is
unreadable; and the round buttons don't always convince, they should be
comfortable on a touch UI at the right size.

All three turned out to be kit rules rather than local tweaks, so they landed
in **kit 0.5.0** and this version consumes them.

### The slider could not reach the edge, structurally

| | before | after |
| --- | --- | --- |
| track width | **129px** | **296px** |
| share of the 306px body | 42% | 97% |

A one-row slider spends its row on three things — label column, track, value —
so the track gets whatever is left, and the only part of the control you
actually touch was the part being squeezed. It is a `.fbk-field` now: the
value sits at the end of the label's line, which is where the track's maximum
is anyway, and the track spans the panel.

```
CHART                                          100 %
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━●
```

### The key cap was washed, and the dot said nothing

The cap was `--fbk-bg / 0.35` under the button's own near-white ink — a
translucent dark plate *under* the ink means both halves move together, so the
contrast between them can never improve. Measured against the accent fill:

| | plate vs fill | ink vs plate |
| --- | --- | --- |
| before | **1.05 : 1** | — (`color: inherit`) |
| after | 2.65 : 1 + a hairline | **17.06 : 1** |

Inverted: near-white plate, panel-ground ink. It reads on any hue a button
might be filled with.

**The green dot got a different answer — it is gone, not recoloured.** Ask
what it said: on an *enabled* primary it was always `ready`, because a blocked
engine is exactly what disables the button. It was visible precisely when it
carried nothing, and when it carried something the button was dimmed and the
reason lived in a tooltip. So the reason moved into the `.fbk-note` below the
button, in words, next to the control it is about — and that note now handles
both causes of a dead primary with one sentence in one place.

### 26px circles are not a touch target

`h-sm` is under WCAG 2.5.8's 24×24 floor once the border counts, and nowhere
near 2.5.5's 44×44 — on the controls a player nudges *while playing*.

The fix is in the kit and it is a **scale swap**, not a control tweak: under
`(pointer: coarse)` the height scale becomes 32 · 44 · 52, so all four
families grow together. Verified in the running app at 375px:

| | mouse | finger |
| --- | --- | --- |
| stepper | 32 × 32 | **44 × 44** |
| primary | 44 | 52 |
| rows overflowing | none | **none** |

The shape changed with the size — a rounded rect, because a circle is a pill
that happens to be square and the stepper had been sharing `radius-pill` with
the chips: two of the four families in one geometry.

**And the trim row became two rows, one per loop edge.** It fitted before —
nine children came to 298px in a 306px body, 8px to spare — but at the touch
scale the same nine need 354px, so no amount of tightening saves it.

```
A                              −   0:08   +
B                              −   0:22   +
```

One row costs 18px on each of eight targets, which for a control you operate
with a guitar in your hands is not a close call. It also reads better than
what it replaced: the old row put A and B at the far ends with the clocks in
the middle, so which stepper moved which edge was something you worked out
from position. Now the edge's own letter starts its row.

### Fixed on the way

The first version of the edge row let the clock absorb the row's slack, which
put `−` and `+` **182px apart** — at which point they are not a stepper, they
are two unrelated buttons with a number between them. The nudges live in a
real `.fbk-stepper` now (whose gap is deliberately smaller than a row's, for
exactly this reason) and the slack goes *between the two jobs* instead: `A`
sets the edge, the cluster adjusts it, and the space between them is what says
they are different things. Both rows' clusters are the same width, so the `+`
lands at the same x in each — measured at 1209 in both — with no constant to
keep in sync.

## 0.7.0 — follow the write

Asked: are there other parts that can be improved with the same logic?

Yes, five — and the question that found all of them is not a visual one, so no
amount of looking at the panel would have turned them up. It is **follow the
write**: for each control, who else writes that field, and how far does the
write reach? The mode tabs that 0.6.0 removed failed the first half (seven
gestures wrote them, so they reported rather than commanded). These fail the
second.

### 1. "How to drill" was the settings page, drawn twice

`Climb`, `Goal` and `Widen` sat two rows under the passage you had just
picked, so they read as *for this passage*. Every one of them went
`model.setSettings` → `store.setSettings` → `localStorage`. Lowering the
ladder for one solo lowered it for **every passage of every song**, signalled
by nothing but a chip that stayed lit.

| key | in the panel | in `settings.html` | per-passage? |
| --- | --- | --- | --- |
| `ladder` | 10 refs | 12 refs | no |
| `goalPct` | 4 | 2 | no |
| `widen` | 6 | 1 | no |

They are now inside a **fold** — new in kit 0.4.0, and built for exactly this:
a heading whose body is shut and whose *value* stays in its head.

```
HOW YOU DRILL   80→90→100 · goal 85%                    ›
```

Nothing is hidden — you can read the ladder without opening it — and the
heading changed tense with the move: *how **you** drill*, not *how **to***. On
open, the summary is replaced by `applies to every passage, every song`, which
is the one moment you need telling.

**And the goal has one legal range now.** It had three: 5% in `normalizeGoal`,
`min="10"` on the settings page's field, 50% in the panel's stepper. One
number, three domains, decided by which widget you touched — so the store
could hold a value the panel could neither reach nor display honestly. The
clamp lives in `store.setSettings`, the one place every writer passes through.

### 2. The timeline was invisible where you had not played

Measured, not estimated — block against the strip's own track:

| | before | after |
| --- | --- | --- |
| never played | **1.33 : 1** | **3.02 : 1** |
| blocks in that state, on *Waterloo* | 7 of 10 | 7 of 10 |

The panel's primary picker rendered as two coloured smears with eight
invisible gaps between them: a map that only appears once you have already
practised everything, which is exactly backwards. The alpha was swept against
the measured track colour rather than picked — 0.55 of `--fbk-dim` reaches the
3:1 WCAG 1.4.11 asks of a UI component's boundary, and a block here is a click
target, not decoration. Accuracy is the block's **hue** now, not the reason it
exists.

### 3. A passage with no notes gave you three dead controls and a wrong tooltip

`Noguitar 1` has 0 notes and 16px of the strip. Clicking it armed a selection
where `Start drill`, `Loop only` and the trim were all dead, and the only
explanation was the primary's tooltip — reading **"Pick a passage first"**,
about a passage you had picked.

Three changes: the block is left out of the hit table, so its pixels fall to
the nearest real section (still drawn, because the strip has to stay
proportional or it is not a map — §12 says a thin section must be *reachable*,
and this is the other end of the same rule); `isUsable` rejects a range with
`events === 0`, so the primary is honestly dead rather than accidentally live;
and a `.fbk-note` says why, **beside the controls it is about** rather than
under the difficulty slider four rows down.

### 4. `Clear` was live with nothing to clear

Disabled only during a drill. Outside one — nearly always — it was a live
button whose click did nothing visible. It now reads the host's own loop
state.

### 5. The `•` in the weak list was the `, .` key cap again

A 6px bullet meaning "this number is from the current run, not storage", on a
row that already carries a name, a bar and a percentage, and whose whole
meaning lived in a tooltip that says it **in words** ("on this run" against
"over 2 attempts"). Gone. Provenance is not what the list is read for.

### Two that look like the same defect and are not

`Play at` and `Chart` both duplicate a host control. Both stay, and the reason
is measured in the DOM: `#speed-slider` lives in `#player-controls.v3-transport`
at `opacity: 0` — the transport auto-hides — and `#mastery-slider` lives in
`#v3-rail-pop-advanced.v3-rail-pop.hidden`, behind a rail popover. **A
duplicate of something you cannot reach is not a duplicate.**

### Fixed, and it was mine, and it was the same bug as ever

The first version of `loopArmed` read:

```js
return Number.isFinite(Number(l.loopA)) && Number.isFinite(Number(l.loopB));
```

`host.loop()` returns `{ loopA: null, loopB: null }` when nothing is armed,
`Number(null)` is `0`, and `0` passes `Number.isFinite` — so it reported a
loop armed at 0→0 on every song, which is precisely the state `Clear` was
being fixed for. **Written once more while fixing four other things, and
caught by measuring the panel rather than by reading the line.** Fifth
instance of this in two repositories; there is now a `finite()` in `model.js`
next to the `num()` in the kit.

111 tests (+2 for `isUsable`, +2 for the goal's single domain).

## 0.6.0 — the mode tabs are gone

Asked: does the "What to loop" section still make sense?

No, and the reason is worth writing down, because it is not a styling problem.
`Section / Phrase / Bars` looked like a mode switch, but:

- its `Section` side gated **no controls at all**;
- its `Bars` side gated a stepper that is a preference (and already has a
  control on the settings page) plus a `From playhead` button that made the
  *identical* `barsFrom(bars, t, barCount, dur)` call as **A**;
- and **seven other gestures wrote to it** — a timeline click, a drag, `A`,
  `B`, the chevrons, `Practice weakest`, a section change.

A control that seven other things overwrite is not commanding anything; it is
*reporting the last thing you did*, in the shape of a button. So it went, along
with the Bars row.

What replaced it is one line already on screen: **the phrase stepper, with the
whole section at position zero.**

```
   ◀   Whole section · 2 phrases   ▶
   ◀        Part 1 of 2           ▶
```

A step left from part 1 hands the section back, so nothing needs a control
saying "actually, all of it" — and this is the app's own model, since its
Section Practice pairs the parts with a "Full section" checkbox.

| | 0.5.5 | 0.6.0 |
| --- | --- | --- |
| rows in *What to loop* | 5 (one of them conditional) | **3** |
| ways to say "the whole section" | 2 (a tab and an implicit default) | **1** |
| buttons that call `barsFrom` from the playhead | 2 | **1** |
| segmented controls in the panel | 2 | **1** (*Play at*) |

### Fixed — and only the test found it

Removing the tabs changed what `state.mode` **means**, and that turned out to
be a bug the panel could not show.

While the tabs existed, `mode` was an explicit choice with its own control, so
carrying it across a section change was the right thing: you had asked for
phrases, you kept phrases. With the tabs gone, `mode` is a *position in a
walk* — "part 2 of 2" is where you got to inside the last section, not a
preference. But `selectSection` still only reset `partIndex`:

```js
state.sectionKey = key;
state.partIndex = 0;      // …and mode stayed 'part'
```

So picking Chorus 2 while on the second half of Verse 1 landed you on the
**first half of Chorus 2** — a loop nobody asked for, and readable only in the
stepper's label. All three gestures that choose a section now go through one
`landOnWhole()`.

Worth noting *how* it surfaced: the panel looked correct, and the first version
of the test asserting `partIndex === 0` **passed** — index 0 of a section you
are still "on a phrase of" is its first half. The assertion that caught it
compares the whole position, `{ onPart, index }`. New file, `tests/model.test.js`,
eight tests: 107 in total.

## 0.5.5 — less, not restyled

Reported: the panel reads better than it did but is still busy, and there is an
unidentifiable icon after the right arrow.

**The icon was a key cap reading `, .`** — a comma and a full stop at 10px with
0.1em tracking, which is two faint dots and no information. Mine, and gone.

Then measured, rather than argued about:

| | before | after |
| --- | --- | --- |
| interactive elements | 40 | 40 |
| visible rows | 9 | **8** |
| key caps on screen | **6** | **1** |
| times the section's name is printed | **2** | **1** |

So the answer was **removal, not restyling**:

- **The nav row is gone.** It carried the section's name next to two filled
  26px circles — and the plate four rows below carried the same name as its
  title. The row existed to hold a duplicate. The chevrons moved onto the
  plate's row, quiet and narrow, and the name is printed once.
- **MARK and TRIM merged.** Putting an edge at the playhead and nudging an
  edge by a bar are the same job from two directions; they were two rows with
  two uppercase labels. One row now, no label — the plate directly above
  already reads `1:24 → 1:39` — with **A** and **B** as circles in the same
  shape family as the steppers they sit between.
- **Five of six key caps went into tooltips.** The shortcuts are registered
  with the host's own registry, so they are already listed in its `?` panel
  and its Settings → Keybinds tab. Six small dark boxes scattered through a
  336px panel bought nothing that was not documented in two places. The one
  on the primary stays, because that is the shortcut worth learning.
- **Two fewer uppercase labels** in the left column, as a consequence: three
  where there were five.

### Fixed, and worth writing down

The one-row picker took three attempts, and each failure looked like the
previous one:

1. **A stale `?v=`.** The host reads `plugin.json` once at startup, so every
   version bump since the plugin was created had been invisible and the
   browser was being handed `riffrepeater.css?v=0.1.0`. A stylesheet change
   needs a version bump *and* a server restart; the `src/` tree live-edits
   fine because it is served no-cache with ETags.
2. **A cascade problem.** `.rr-pick { flex-wrap: nowrap }` here and
   `.fbk-row { flex-wrap: wrap }` in the kit are both single-class selectors,
   so source order decided — and the kit's sheet was injected last and won.
   Fixed in the kit: `install()` prepends its link, so the kit is a base layer
   that loses ties, and `.fbk-row-nowrap` lives there where it belongs.
3. **A wrong test.** Mine compared the `top` of each child to detect a wrap,
   which only works when they are all the same height — so a zero-height
   spacer and a two-line plate both reported as wraps. `align-items: center`
   puts every child of an unwrapped row on the same vertical *centre*;
   comparing those says all four rows are on one line and none overflows.

And the CSS lesson underneath all of it: **a wrapping flex container breaks
the line before it shrinks anything.** `flex-shrink: 1` and `min-width: 0`
were both already set on the plate and neither could do a thing while
`flex-wrap: wrap` was in force.

## 0.5.2 — the thin sections are clickable now

Reported: parts of the timeline are too small to click. Measured on Blackened —
21 sections in a 296px strip — and it is not a corner case:

| | |
| --- | --- |
| sections under 10px wide | **9 of 21** |
| under 5px | 3 |
| the thinnest, `Outro 1` | **1.9px**, and it has 14 notes in it |

The fill was right and the hit test *was* the fill. They are two different
things now: the block's width stays its share of the song, because the strip is
a map, and every section additionally gets a **click target at least 11px
wide**, grown symmetrically about its own centre. A click resolves to the
target whose centre is nearest, so a wide section keeps everything except the
few pixels closest to a thin neighbour's middle. Nothing moved on screen.

Verified by clicking the centre of the four thinnest sections — 1.9px, 2.3px,
3.2px, 5.2px — and getting each one, then clicking the 53.9px `Intro 1` to
prove the expanded targets had not swallowed it. Five for five.

**And sweeping the strip now names what is under the cursor**, because a target
you cannot see is still no use. The plate shows the section the hit test would
choose, with a dashed border so *would get* never reads as *have got*, and goes
back to the selection when the pointer leaves. Turns a strip you have to aim at
into one you scrub.

Not the fix, for the record: a minimum visual width on thin blocks. It solves
the clicking and breaks the map — the blocks stop summing to the whole and the
playhead drifts out of the block it is supposed to be inside.

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
