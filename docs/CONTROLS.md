# Controls

How the game is controlled, how the swipe pad turns a moving thumb into a direction, and how to tune it.

- The swipe pad's logic is in [`src/swipe.ts`](../src/swipe.ts).
- The wiring to touches and keys is in [`src/input.ts`](../src/input.ts).
- What the robot does with a direction is in `movePlayer` in [`src/sim.ts`](../src/sim.ts), described under "Turning" in [GAME-RULES.md](GAME-RULES.md).

## The layout

<p align="center">
  <img src="screenshots/play.png" alt="Upright phone, left thumb steering: arena on top, swipe pad bottom left, B over A bottom right" width="220">
  <img src="screenshots/right-thumb.png" alt="Upright phone, right thumb steering: swipe pad bottom right, B over A bottom left" width="220">
</p>
<p align="center">
  <img src="screenshots/sideways.png" alt="Phone held sideways: swipe pad down the left edge, B over A down the right edge" width="430">
</p>

On a phone held upright the arena sits at the top and the controls fill everything below it:

- **Swipe pad:** two thirds of the width. The cross in the middle only shows which direction is being read. It is not a button and you do not need to touch it.
- **B:** on the other side, at the top. Lifts a bomb, then throws it (needs the glove).
- **A:** below B, the larger of the two. Drops a bomb.

Which side the pad is on is a setting, **Steering thumb**. With *Left thumb* (the default) the pad is on the left and B and A on the right. With *Right thumb* the same layout is mirrored.

Held sideways, the pad runs down one edge and B and A down the other, either side of the arena. The panels are see-through.

The strip at the top left shows how many bombs you can have out, your blast length, your speed, and whether you hold the boot and the glove. **Menu** is at the top right.

## The menu

<p align="center">
  <img src="screenshots/menu.png" alt="The menu's Main menu tab: the bot picker, the CPU level and Play" width="220">
  <img src="screenshots/menu-controls.png" alt="The menu's Controls tab: Steering thumb and Swipe direction" width="220">
  <img src="screenshots/menu-paused.png" alt="The menu opened in the middle of a round: Resume and New round" width="220">
</p>

The menu has two tabs along the top and a close button (✕) beside them.

| Tab | What is on it |
|---|---|
| **Main menu** | The bot picker, **CPU players** (Beginner, Normal, Hard or Extreme), and **Play**. If a round is in progress: **Resume** and **New round**. |
| **Controls** | On a touch screen: **Steering thumb** and **Swipe direction** (both described below). On a computer: the keyboard keys. |

Opening the menu during a round pauses it. Nothing is lost: the round waits behind the menu.

- **✕** closes the menu and goes to the game: back into the paused round if there is one, otherwise a new round starts.
- **Resume** does the same as ✕ when a round is paused. **New round** abandons it and starts afresh.
- Picking a different bot colour while paused recolours your bot in the same round. If another bot was wearing that colour, it takes your old one.
- On a computer, **Escape** opens and closes the menu.

On a computer the touch controls are hidden and the keyboard is used:

| Action | Keys |
|---|---|
| Move | Arrow keys, or W A S D |
| A (drop a bomb) | Space, X, J or Enter |
| B (lift and throw) | Shift, Z or K |
| Open or close the menu | Escape |

## Using the swipe pad

1. Put your thumb down anywhere on the pad.
2. Swipe the way you want to go. The robot starts moving.
3. Keep your thumb down to keep going. You do not have to keep swiping.
4. To turn, swipe another way from wherever your thumb is now.
5. Lift your thumb to stop.

"Left, then down" in one continuous movement works: the robot turns when your thumb does.

Things the pad deliberately ignores while your thumb is resting on it:

- **Small movements.** Wiggles and little flicks that stay inside a small zone round your resting thumb do nothing.
- **Slow drift.** If your thumb creeps across the pad, the zone creeps with it.
- **Bounce-back.** The small rebound at the end of a quick swipe does not turn you round.

## How the pad reads a thumb

The pad answers two separate questions.

### 1. When has the thumb started a new stroke?

**From a resting thumb.** A thumb that stays within 6 px for 120 ms counts as resting. A resting thumb has a **quiet zone** round it, 30 px in radius at the Normal setting, which is about 5 mm on a phone. Nothing inside the zone counts. A stroke starts when the thumb leaves the zone. Every time the thumb comes to rest, the zone re-centres on it, which is why slow drift never adds up to a stroke.

**From a fresh touch.** Before the robot has been given any direction, the first stroke registers after 14 px, so starting off feels quick.

**In the middle of a swipe.** Once a stroke has started, the pad follows it as a straight **leg** in whatever direction the thumb is really travelling. A new leg starts when the thumb either:

- breaks away **sideways** from the leg by 24 px (this is the "left, then down" turn), or
- comes **back** along the leg by 30 px (a deliberate reverse).

Both distances are measured against the stroke's own line, not the screen's, so a turn needs the same thumb travel whichever way the stroke was leaning. A gently curving stroke does not count as breaking away: the line follows it.

### 2. Which of the four directions is that stroke?

Whichever of up, down, left and right the leg points nearest to. Three details matter:

- **The whole leg is judged**, not a few pixels of it. A first stroke that registered at 14 px is still being read until it is 36 px long. If the longer look clearly disagrees with the first read, the direction is corrected.
- **The robot's current direction plays no part.** The same swipe always gives the same answer. (An earlier version favoured the axis the robot was already moving along, which made sideways swipes read as up or down.)
- **"Nearest" is measured against aims that lean.** A thumb pivots at its base, so quick swipes lean: with a left thumb, left drifts up and right drifts down. Each direction has an *aim*, the screen angle its swipes are expected to point at, and a stroke counts as the direction it is aimed nearest to. By default all four aims lean 15°: clockwise when the left thumb steers, anticlockwise when the right thumb does. [Match my thumb](MATCH-MY-THUMB.md) can replace that with one lean measured for the player, or a lean for each direction. The aims change only which direction a stroke counts as. They never change how far the thumb has to travel.

### Nothing is lost between frames

The game reads the controls 60 times a second. A quick flick or a tap on A or B can begin and end between two of those readings. `src/input.ts` remembers any new direction or button press until the game has read it once, so even the shortest tap counts.

## The settings on the Controls tab

<p align="center">
  <img src="screenshots/menu-settings.png" alt="The Controls tab with Left thumb and Standard switched on" width="300">
  <img src="screenshots/menu-settings-matched.png" alt="The Controls tab with My thumb switched on, and a Match again button" width="300">
</p>

Both settings are two-sided switches. The side in use is filled in and tagged **On**.

### Steering thumb

Which thumb you steer with. The swipe pad goes on that side of the screen and A and B on the other.

| Side | Layout | Standard swipe direction |
|---|---|---|
| **Left thumb** (default) | Pad on the left, B over A on the right | Leans 15° clockwise |
| **Right thumb** | Pad on the right, B over A on the left | Leans 15° anticlockwise |

The two thumbs are mirror images. Each pivots at its own bottom corner of the phone, so a left thumb's quick swipes lean clockwise and a right thumb's lean anticlockwise. Switching thumbs therefore switches the standard lean too, and **each thumb keeps its own Match my thumb result**. Switching back and forth loses nothing.

### Swipe direction

Which of up, down, left and right each swipe counts as, for the thumb selected above.

| Side | What it is | Tapping it |
|---|---|---|
| **Standard** | The built-in setting: all four directions lean 15° the way a typical thumb on that side does. | Switches to Standard. A saved match is kept, just switched off. |
| **My thumb** | The setting measured from your own swipes by [Match my thumb](MATCH-MY-THUMB.md). Its small print says *tap to set up*, *matched to you* or *matched, switched off*. | With no match saved yet for this thumb, starts Match my thumb. Otherwise switches your match back on. |

The line underneath says in words which is on. **Match again** appears once a match is saved, to redo it.

While you play, a small caption in the bottom corner of the swipe pad shows which side is on: **Standard swipes**, or **✓ My thumb swipes** in gold.

The settings are saved in the browser on that device and load by themselves next time. They do not travel with the game to another phone. If a browser refuses to save anything, the tab says so.

### Swipe length is not a setting

How far you have to swipe to turn is fixed: the quiet zone is 30 px, a sideways turn mid-swipe takes 24 px and a reverse 30 px. On a phone, 5 to 6 px is about one millimetre. The first swipe after touching down needs only 14 px, so starting off stays quick.

The menu used to offer a choice here, first five levels and then three (Short, Medium, Long). Medium felt right in play-testing, so the choice was removed and Medium became the only size. A swipe length saved by an older version is ignored. The pad's code can still scale its distances (`scale` on `SwipePad`); nothing in the game changes it.

## Turning in the maze

A direction from the pad is only half of a turn. The robot can only go sideways where there is an opening, so the rules decide where the turn happens:

- If the tile the robot is standing on has the opening, it turns there.
- Otherwise it keeps running and takes the **next opening ahead**. It never doubles back to one it has passed.

So you can swipe early for a turning that is coming up. The full list is under "Turning" in [GAME-RULES.md](GAME-RULES.md).

One thing looks odd until you know why: if the robot is **standing still** between two openings and you swipe sideways, it first steps up or down to the nearest opening. It has to, because that is the only place it can go sideways from.

The robot **looks** the way you swiped straight away, even at a block and even while it is still on its way to the opening.

Between two blocks there is one more rule. A **quick swipe** at a block turns the robot to look at it and does not move it, which is how you aim a throw over a block. A swipe **held** for longer than 0.15 seconds sends it to the opening on the next tile and round the block, as before. The pause is `LOOK_TICKS` in `sim.ts`. It only applies when the robot is standing still and would have to leave its tile; a running robot, or one with an opening on its own tile, turns without any pause.

## Tuning it in the code

Every distance is a named constant at the top of `src/swipe.ts`.

| Constant | Value | What it controls | Symptom it fixes |
|---|---|---|---|
| `START` | 14 px | Thumb travel before the first direction after touching down | Lower: starting feels sluggish. Higher: the robot sets off when you only rested your thumb. |
| `QUIET` | 30 px | Radius of the quiet zone | Lower: turns need too much travel. Higher: small movements turn the robot. |
| `TURN` | 0.8 | Sideways break needed mid-swipe, as a share of `QUIET` | Lower: "left, then down" in one motion is slow to turn. Higher: sloppy strokes cause turns. |
| `REVISE_UNTIL` | 36 px | How long a stroke is still being read | Higher: more early mistakes get corrected, but corrections come later. |
| `REVISE_MARGIN` | 0.2 | How clearly the longer look must disagree to overrule the first read | Lower: more corrections. Higher: fewer. |
| `SETTLE_PX`, `SETTLE_MS` | 6 px, 120 ms | When a thumb counts as resting | Together they set the slowest movement that still counts as a stroke: about 50 px a second. |
| `DEFAULT_TILT` | 15° | Lean of all four aims until Match my thumb has been run | See [MATCH-MY-THUMB.md](MATCH-MY-THUMB.md). |

There is no menu setting for these distances any more. To change them for everyone, edit the constants above.

After changing anything here, run `npm test`. `tests/swipe.test.ts` replays made-up thumb paths through the pad and checks the results: wiggles ignored, drift ignored, bounce-back ignored, real swipes read, leaning swipes read correctly from every starting direction, and a separate aim per direction honoured.

## How it got this way

The controls went through several rounds of play-testing on a phone. Each round fixed something real, and the reasons are worth keeping:

1. **Drag anywhere.** The first pad read direction from where the thumb was relative to the pad's centre. It was replaced by swiping from wherever the thumb is, in the layout of a hand-drawn wireframe: big pad on the left, B over A on the right.
2. **Small movements were too sensitive.** Direction was judged from the last 14 px of movement, so a wiggle could flip it, and the rebound after a flick could reverse it. The quiet zone, the resting rule and the bounce-back rule came from this.
3. **Whole-tile stepping was tried and removed.** Making every swipe finish on the middle of a tile was rejected in play-testing: a small movement should not move a whole block. The code for it is still in `sim.ts` (`stepAssist`) but it is switched off and has no setting.
4. **"I go up instead of left."** Two causes were found. The robot doubled back to the nearest opening when a turn was swiped early, which the next-opening-ahead rule fixed. And sideways swipes were misread while the robot was moving up or down, which the unbiased, leaning read fixed. Match my thumb was added in the same round.
5. **Swipe length settled.** A menu choice of quiet-zone size went from five levels to three, then was removed once Medium proved right in play-testing.
6. **A menu that can be closed, in two tabs.** Opening the menu used to end the round. It now pauses it, with a close button to go back, and the control settings moved to their own tab.
7. **Right thumb steering.** The layout can be mirrored, with the standard lean mirrored too and a separate match kept for each thumb.
8. **No walking back through a bomb.** A bomb used to stay passable for as long as the robot overlapped it at all. It now turns solid the moment the robot counts as standing on the next tile.
9. **Match my thumb version 2.** A lean per direction and a test round were added. Simulation showed a lean per direction alone is roughly a wash, so the test round decides, on each player's own swipes, whether it is used.
10. **Looking where you swipe.** The robot used to look the way it was walking. Between two blocks, a swipe at a block made it walk toward the nearest opening and look that way instead, so it could not be turned to face the block. It now looks the way it was asked to go, at once, and between two blocks a quick swipe only turns it: it sets off for the opening if the swipe is held for 0.15 seconds.

The simulations used to compare the old and new behaviour are in [`experiments/`](../experiments/README.md).
