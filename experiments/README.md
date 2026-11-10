# Experiments

Simulations used to work out how the controls should behave. They are **not part of the game**: nothing in `src/` uses them, and deleting this folder would change nothing a player sees.

They exist because the feel of touch controls cannot be checked from a desk. Each script replays made-up thumb movements through the real game code and counts what happens, so two versions of the controls can be compared on the same input.

**These are models, not measurements.** The "thumb" is invented: its strokes lean, scatter and bounce back by amounts chosen to be plausible. The results show which design is better and roughly by how much. They do not say what any real player will experience. Play-testing on a phone has the final word.

## Running them

```sh
npx tsx experiments/corridor-turns.ts
npx tsx experiments/stroke-reading.ts
npx tsx experiments/model-player.ts
```

The "current" columns use the live code in `src/`, so they change whenever the controls change. The "previous" columns use a frozen copy of the older logic kept in `previous-build.ts`.

The results below were recorded on 9 November 2026.

## `corridor-turns.ts`: where does the robot turn?

The robot runs down a corridor from an opening at row 1 toward the next opening at row 3. Somewhere on the way, "left" is swiped and held.

| Swipe left at | Previous rule | Current rule |
|---|---|---|
| y = 1.12 to 1.43 | Back up to row 1 | Back up to row 1 |
| **y = 1.56 to 1.93** | **Back up as much as 0.93 of a tile to row 1** | On down to row 3 |
| y = 2.05 to 2.92 | On down to row 3 | On down to row 3 |

**What it showed.** The previous rule sent the robot to the *nearest* opening. For a stretch of every corridor that meant turning round and going back the way it came, which a player sees as "I swiped left and went up". The current rule only steps back while the robot is still standing on the opening's tile (within half a tile). Otherwise it carries on to the next opening.

## `stroke-reading.ts`: is one stroke read as the direction that was meant?

Thousands of single strokes, each aimed at one of the four directions and leaning clockwise by a set amount, with about 12° of random scatter and a bounce-back at the end.

Stroke from a resting thumb while the robot is already moving:

| The thumb leans | Previous pad | Current pad, no lean | Current pad, lean 15° |
|---|---|---|---|
| 0° | 0.1% wrong | 0.0% | 0.6% |
| 15° | 2.0% | 0.4% | 0.0% |
| 30° | 18.7% | 10.1% | 0.6% |
| 40° | 43.3% | 34.5% | 5.1% |

Stroke straight after touching down:

| The thumb leans | Previous pad | Current pad, no lean | Current pad, lean 15° |
|---|---|---|---|
| 0° | 0.8% wrong | 0.1% | 2.7% |
| 15° | 3.4% | 1.8% | 0.3% |
| 30° | 18.8% | 13.9% | 2.4% |
| 40° | 35.9% | 37.1% | 9.2% |

**What it showed.**

- If quick strokes lean, a pad that judges them against the screen's own axes misreads a lot of them. Leaning the pad fixes most of that.
- The standard 15° lean costs a little when the thumb does not lean at all (0.6% and 2.7% wrong instead of almost none) and gains a great deal when it does. That is why 15° is the default and why Match my thumb exists to replace the guess with a measurement.
- Judging strokes without a bias toward the robot's current direction helps at every lean (the "no lean" column against the "previous" one).

## `model-player.ts`: the whole chain

A model player steers through an empty arena with the thumb held down. Again and again it picks a side opening near ahead and swipes for it, anywhere from 1.4 tiles before the opening to 0.3 tiles after it. A turn counts as wrong if the robot does anything other than carry straight on and then turn the way that was meant, at the opening that was meant.

| The thumb leans | Previous build | New turning rule only | New pad only | Both (current) |
|---|---|---|---|---|
| 0° | 10.6% wrong | 0.9% | 12.0% | 1.8% |
| 20° | 19.4% | 12.4% | 11.0% | 1.7% |
| 35° | 55.2% | 47.1% | 14.5% | 4.4% |

What went wrong, at a lean of 0°:

| | Turns | Doubled back | Wrong opening | Never turned |
|---|---|---|---|---|
| Previous build | 1348 | 143 | 0 | 0 |
| Current | 1054 | 4 | 12 | 3 |

**What it showed.**

- Two separate faults produced the same complaint. With a thumb that does not lean, nearly every wrong turn in the previous build was the robot doubling back, and the new turning rule alone removes them. With a thumb that leans, most wrong turns were misread strokes, and the new pad removes those. Both changes were needed.
- At small leans, what is left in the current build is mostly "wrong opening": the swipe came more than half a tile after the opening, so the robot took the next one. That is the rule working as intended. At a lean of 35° some misread strokes remain, which is the case Match my thumb is for.

## `previous-build.ts`

A frozen copy of the swipe pad and the turning rule as they were before the rework of 9 November 2026, kept only so these comparisons can be rerun. Its header lists how it differs from the current code.
