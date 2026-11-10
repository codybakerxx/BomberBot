# Experiments

Simulations used to work out how the controls should behave. They are **not part of the game**: nothing in `src/` uses them, and deleting this folder would change nothing a player sees.

They exist because the feel of touch controls cannot be checked from a desk. Each script replays made-up thumb movements through the real game code and counts what happens, so two versions of the controls can be compared on the same input.

**These are models, not measurements.** The "thumb" is invented: its strokes lean, scatter and bounce back by amounts chosen to be plausible. The results show which design is better and roughly by how much. They do not say what any real player will experience. Play-testing on a phone has the final word.

## Running them

```sh
npx tsx experiments/corridor-turns.ts
npx tsx experiments/stroke-reading.ts
npx tsx experiments/model-player.ts
npx tsx experiments/match-v2.ts
```

The "current" columns use the live code in `src/`, so they change whenever the controls change. The "previous" columns use a frozen copy of the older logic kept in `previous-build.ts`.

The results below were recorded on 9 November 2026.

The experiments above `match-v2.ts` were run before Match my thumb version 2. Version 2 changed only how a setting is chosen, not how a single lean reads swipes, and rerunning them gives the same numbers.

The walking speed was changed later the same day (halved, then tuned +25%, +12.5% and −2.5%). `previous-build.ts` keeps the old speed, but the current rules walk at the new one, so rerunning `corridor-turns.ts` and `model-player.ts` now gives slightly different numbers. The conclusions hold, and the current build does a little better: in `model-player.ts`, 0.7%, 0.0% and 1.8% of turns wrong at leans of 0°, 20° and 35°.

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

## `match-v2.ts`: a lean per direction, and letting a test choose

Five model thumbs, from perfectly straight to ones whose four directions lean very differently. For each, Match my thumb is simulated 300 times (the prompted swipes are random draws, so each match comes out a little different) and every resulting setting is scored on fresh play swipes. In play, 70% of swipes are quick and lean fully; 30% are slow and lean a third as much.

The first part compares a single lean (version 1) with a lean per direction built from 3 or 4 swipes each, pulled toward the overall lean by k imaginary swipes. With swipes scattering about 16°:

| Model thumb | Standard | One lean (12 swipes) | Per direction, 3 each | Per direction, 3 each, k3 | Per direction, 4 each, k2 |
|---|---|---|---|---|---|
| Straight | 3.04% | 0.41% | 0.51% | 0.40% | 0.42% |
| Even, 30° all round | 2.33% | 1.23% | 1.61% | 1.35% | 1.30% |
| Sideways lean more | 2.70% | 2.61% | 2.90% | 2.54% | 2.72% |
| Uneven (left 40°, down 10°) | 2.82% | 2.39% | 2.04% | 2.07% | 1.79% |
| Mixed (left 35°, up −5°) | 3.34% | 3.81% | 4.03% | 3.83% | 3.67% |
| **Average** | 2.85% | 2.09% | 2.22% | 2.04% | 1.98% |

The second part adds a test round of 8 swipes that chooses between the setting before, one lean, and a lean per direction (3 each, pulled half way, as built). Ties in how many test swipes are read right are broken three ways:

| Model thumb | One lean always | Per direction always | Test, tie by average room | Test, tie by closest call | Test, tie by expected misreads |
|---|---|---|---|---|---|
| Straight | 0.44% | 0.49% | 0.74% | 0.75% | 0.71% |
| Even, 30° all round | 1.35% | 1.39% | 1.40% | 1.39% | 1.38% |
| Sideways lean more | 2.56% | 2.65% | 2.45% | 2.48% | 2.43% |
| Uneven | 2.54% | 2.00% | 2.14% | 2.16% | 2.10% |
| Mixed | 3.86% | 3.95% | 3.56% | 3.54% | 3.56% |
| **Average** | 2.15% | 2.10% | 2.06% | 2.06% | 2.04% |

**What it showed.**

- A lean per direction on its own is roughly a wash. It helps thumbs whose directions really differ ("uneven") and hurts the others, because a few swipes per direction measure less precisely than twelve averaged. Pulling each direction half way toward the overall lean removes most of that harm.
- Letting a test choose gives the best average, by a small margin, and protects the thumbs any match would make worse ("mixed"). The cost is that it sometimes keeps the standard lean when a match was slightly better ("straight").
- The three tie-breakers are within noise of each other. The game uses the closest call because it is the easiest to show on screen. (The average room was rejected for a reason the simulation does not show: moving a border only shifts room between neighbouring directions, so the average hardly changes and real settings often tie on it.)
- With less scatter (about 10°) every setting reads 99.5% or more right and the same pattern holds; the full output is printed by the script.

## `previous-build.ts`

A frozen copy of the swipe pad and the turning rule as they were before the rework of 9 November 2026, kept only so these comparisons can be rerun. Its header lists how it differs from the current code.
