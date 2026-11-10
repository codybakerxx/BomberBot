# Match my thumb

Match my thumb teaches the swipe pad how *your* swipes point. You make twelve swipes, it measures how far they lean away from straight, and from then on the pad reads your swipes with that lean allowed for.

<p align="center">
  <img src="screenshots/match-prompt.png" alt="Match my thumb asking for a swipe to the left" width="250">
  <img src="screenshots/match-result.png" alt="Match my thumb showing the measured lean" width="250">
</p>

## The problem it solves

The pad has to decide whether a swipe meant up, down, left or right. That is easy when swipes are straight. They are not.

A thumb is hinged at its base, down in the corner of the phone. When you flick it sideways, the tip travels round an arc, not along a level line. For a left thumb on the pad:

- a quick swipe **left** also drifts **up**
- a quick swipe **right** also drifts **down**
- a quick swipe **up** also drifts **right**
- a quick swipe **down** also drifts **left**

All four are turned the same way, clockwise. The amount they are turned is the **lean**.

<p align="center"><img src="images/lean.svg" alt="The screen's four directions, and the same four as a left thumb swipes them, turned clockwise" width="620"></p>

Slow, careful swipes are nearly straight. Quick ones lean more, and how much depends on the hand and the grip. Suppose a swipe meant as "left" leans 40°. It is then almost exactly half way between left and up. If the pad divides the world into four quarters square to the screen, that swipe lands on the border and gets read as up about as often as left.

<p align="center"><img src="images/quarters.svg" alt="A swipe leaning 40 degrees lands on the border between left and up when the quarters are square to the screen, and well inside left when the quarters lean 25 degrees" width="620"></p>

Leaning the pad's quarters the same way puts the swipe back in the middle of the quarter it was meant for.

How much a thumb leans depends on the hand, the size of the phone and the grip. So the game measures it.

## Using it

1. Hold the phone the way you hold it when you play.
2. Open the menu and tap **Match my thumb** in the D-pad box.
3. An arrow asks for a direction. Put your thumb on the pad and swipe that way, the same quick way you do in a game.
4. The arrow changes as soon as the swipe has been read. Keep going: twelve swipes, three in each direction.
5. The result appears. Tap **Done**.

Tips:

- Swipe naturally. If you draw careful straight lines here, the pad learns that your swipes are straight.
- You can keep your thumb on the pad throughout or lift it between swipes. Both work.
- If the arrow does not change, the swipe was too small to count. Swipe a little further. Swipes that small would not register in a game either; if that surprises you, lower the "Ignore small thumb movements" setting.
- If you swipe the wrong way by mistake, it says so and asks again. Nothing is recorded.
- The result is saved on that phone, in that browser. Each friend matches their own thumb on their own phone.
- Do it again if you change how you hold the phone, for example from upright to sideways.

**Reset**, next to the button, goes back to the standard lean.

## Reading the result

A result looks like this:

> **Matched.** Your swipes lean about 30° clockwise from straight. The pad now reads them that way.
> Left 32°, right 25°, up 31°, down 30°. Spread 5°. Pad lean 23°.

| Number | Meaning |
|---|---|
| **lean about 30° clockwise** | The average lean of all twelve swipes. Clockwise is what a left thumb gives. Anticlockwise is possible too, for example with a right thumb. |
| **Left, right, up, down** | The average lean of the three swipes in each direction. These are shown for interest and for troubleshooting. The pad uses the single overall figure. |
| **Spread** | How much individual swipes varied round the average. Under 10° is very consistent. Up to 30° is accepted. |
| **Pad lean** | The lean the pad is now using. It is deliberately less than the measured lean (see below). |

If the swipes pointed in too many different ways (a spread over 30°), the screen says **No match** and nothing is changed. Try again, a little more deliberately.

## How it works

### 1. Collecting twelve swipes

The directions are asked for in a fixed, mixed-up order: left, up, right, down, right, left, down, up, left, down, up, right. That is `TEACH_ORDER` in [`src/teach.ts`](../src/teach.ts).

Each swipe is read by the same swipe pad the game uses, so it is measured exactly as it would be in play. The pad reports one **stroke** for each swipe that starts from a resting thumb or a fresh touch (`onStroke` in [`src/swipe.ts`](../src/swipe.ts)):

- as soon as the stroke is 36 px long, or
- when it ends, if it never gets that long.

Reading over 36 px matters. The first few pixels after a thumb touches down are unreliable, because the contact point shifts as the thumb settles onto the glass.

Two kinds of swipe are turned away and asked for again (`teachStroke` in [`src/main.ts`](../src/main.ts)):

- shorter than 20 px: "That one was very short"
- more than 80° away from the direction asked for: "That read as a different direction"

### 2. Measuring one swipe

Angles are measured on the screen, anticlockwise from "right": right is 0°, up is 90°, left is 180°, down is 270°.

The lean of one swipe is the angle asked for minus the angle swiped, so that clockwise comes out positive (`leanOf` in `src/teach.ts`).

**Example.** The game asks for *left* (180°). The thumb moves 34 px left and 21 px up. That stroke points at 148°, so its lean is 180° − 148° = **32° clockwise**.

### 3. Averaging

The twelve leans are averaged with a *circular* mean, the correct way to average angles (`summarise` in `src/teach.ts`). Each lean is treated as a point on a circle, the points are averaged, and the angle of the average point is the answer:

```
mean lean = atan2( sum of sin(lean), sum of cos(lean) )
R         = length of the average point   (1 = all swipes identical, 0 = pointing everywhere)
spread    = sqrt( -2 × ln R )             (converted to degrees)
```

The result is used only if the spread is 30° or less.

### 4. Choosing the pad's lean

The pad does not lean by the full amount measured. It uses **three quarters of it, and never more than 25° clockwise or 20° anticlockwise** (`tiltFor` in `src/teach.ts`).

| Measured lean | Pad lean |
|---|---|
| 0° | 0° |
| 10° | 8° |
| 20° | 15° |
| 30° | 23° |
| 40° | 25° (the limit) |
| −40° | −20° (the limit) |

The reason: matching measures your *quick* swipes. Your slow, deliberate swipes are much straighter. Both kinds have to land comfortably inside the right quarter. Leaning the pad all the way to the quick swipes would push the straight ones toward the opposite border.

### 5. How the pad uses the lean

Every time the pad has to name a stroke's direction, it scores the stroke against each of the four directions and picks the highest (`score` and `nearest` in `src/swipe.ts`). For a stroke that moved `vx` px across and `vy` px down, with pad lean `a`:

```
fx =  vx × cos(a) + vy × sin(a)
fy = -vx × sin(a) + vy × cos(a)

right = fx     left = -fx     down = fy     up = -fy
```

In words: turn the stroke anticlockwise by the lean, then see which of the screen's own directions it is nearest to.

**Example.** A 40 px swipe meant as *left* that leans 40°: `vx = −30.6`, `vy = −25.7`.

| Pad lean | left | up | Verdict |
|---|---|---|---|
| 0° | 30.6 | 25.7 | Left, but only just. A little more wobble and it reads as up. |
| 25° | 38.6 | 10.4 | Left, clearly. |

The lean is used for every stroke the pad reads: the first one after touching down, a stroke from a resting thumb, and each new leg of a continuous swipe. It changes only which direction a stroke counts as. The distances a thumb must travel stay the same.

### 6. Where it is kept

The measured lean is saved in the browser's local storage under the key `controls2`, alongside the quiet-zone setting:

```json
{ "zone": 100, "lean": 30 }
```

`lean` is the measured figure, not the pad lean. The pad lean is worked out from it each time the game loads. **Reset** sets it back to "not measured".

Local storage belongs to one browser on one device. Clearing the browser's site data removes it, and it does not follow the game to another phone.

## The standard lean

Until someone runs Match my thumb, the pad leans **15° clockwise** (`DEFAULT_TILT` in `src/swipe.ts`).

That figure is a middle course for a left thumb on the pad. It costs almost nothing for a player whose swipes are straight, and it takes most of the errors away for one whose swipes lean. Matching then replaces it with a measured value, which can be anywhere from −20° to 25°, including 0°.

## What it cannot do

- It measures twelve calm swipes. Swipes made in a panic may lean a little differently.
- It applies one lean to all four directions. If your left and right swipes lean far more than your up and down ones, the single figure is a compromise between them. The per-direction numbers on the result screen show when that is happening.
- It assumes you keep holding the phone the same way.
- It corrects *which way* a swipe is read. It does not change how far you have to swipe; that is the other setting in the D-pad box.

## How well it works

It has been play-tested on a phone and works well there.

The simulations in [`experiments/`](../experiments/README.md) point the same way. They use a made-up thumb, so they are a guide and not a measurement of anyone's hand. For single strokes made by a thumb resting on the pad:

| The thumb leans | Read wrong with no lean | Read wrong with the standard 15° lean |
|---|---|---|
| 0° | 0.0% | 0.6% |
| 15° | 0.4% | 0.0% |
| 30° | 10.1% | 0.6% |
| 40° | 34.5% | 5.1% |

## For developers

| Part | Where |
|---|---|
| The maths: `leanOf`, `summarise`, `tiltFor`, `TEACH_ORDER` | [`src/teach.ts`](../src/teach.ts) |
| Reporting strokes (`onStroke`) and using the lean (`tilt`, `score`, `nearest`) | [`src/swipe.ts`](../src/swipe.ts) |
| The screen: `startTeach`, `teachPrompt`, `teachStroke`, `finishTeach`; saving and applying (`settings.lean`, `applySettings`) | [`src/main.ts`](../src/main.ts) |
| The panel's markup and styles (`#teach`, and the `.match` row in the menu) | [`src/page.html`](../src/page.html) |
| Checks of the maths | [`tests/teach.test.ts`](../tests/teach.test.ts) |
| Checks that leaning swipes are read correctly, from every starting direction | [`tests/swipe.test.ts`](../tests/swipe.test.ts) |

The panel is laid over the arena only, so the pad stays usable while matching. While the panel is open the game is paused (`mode` is `'teach'`), so swipes do not move the robot.

Things you might want to change:

| To change | Edit |
|---|---|
| How many swipes are asked for, or their order | `TEACH_ORDER` in `src/teach.ts` |
| The shortest swipe accepted (20 px) or the widest miss accepted (80°) | `teachStroke` in `src/main.ts` |
| How consistent the swipes must be (spread of 30°) | `summarise` in `src/teach.ts` |
| The three-quarters rule and the limits | `tiltFor` in `src/teach.ts` |
| The lean used before matching | `DEFAULT_TILT` in `src/swipe.ts` |
