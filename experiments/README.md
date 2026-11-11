# Experiments

Simulations used to work out how the controls should behave, and one script that plays the CPU players against each other. They are **not part of the game**: nothing in `src/` uses them, and deleting this folder would change nothing a player sees.

They exist because the feel of touch controls cannot be checked from a desk. Each script replays made-up thumb movements through the real game code and counts what happens, so two versions of the controls can be compared on the same input.

**The control experiments are models, not measurements.** The "thumb" is invented: its strokes lean, scatter and bounce back by amounts chosen to be plausible. The results show which design is better and roughly by how much. They do not say what any real player will experience. Play-testing on a phone has the final word.

## Running them

```sh
npx tsx experiments/corridor-turns.ts
npx tsx experiments/stroke-reading.ts
npx tsx experiments/model-player.ts
npx tsx experiments/match-v2.ts
npx tsx experiments/cpu-matches.ts          # about six minutes
npx tsx experiments/cpu-matches.ts solo
npx tsx experiments/cpu-matches.ts versus
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

## `cpu-matches.ts`: do the CPU players blast themselves, and are the levels in order?

Unlike the scripts above this is a measurement, not a model: it plays whole matches with the real CPU players (`src/bot.ts`) under the real rules, with no screen, and counts how each one went out. Recorded on 10 November 2026, with a blast lasting 0.45 seconds and each speed power-up adding 0.45 tiles a second.

| Run | What it plays |
|---|---|
| no argument | Four of the same level, 60 matches; then one of each level, 240 matches. Up to 3 minutes each. |
| `solo` | Each level alone with a player who stands still, 40 arenas |
| `versus` | Three of one level against one Beginner CPU player standing in for a slow, careless person, 80 matches |

Four of the same level:

| Level | Blasted itself | Shut in by a rival | Caught in a rival's blast | Still in at the end |
|---|---|---|---|---|
| Beginner | 0.0% | 1.3% | 19.6% | 79.2% |
| Normal | 0.0% | 4.6% | 10.4% | 85.0% |
| Hard | 0.0% | 7.9% | 9.2% | 82.9% |
| Extreme | 0.0% | 9.2% | 12.1% | 78.8% |

The other tables are in [docs/CPU-PLAYERS.md](../docs/CPU-PLAYERS.md).

**What it showed.**

- The first version checked only that a bomb left a way out. Alone, no bot ever blasted itself. Four together, about one in five went out to its own bomb (Normal 23%, Hard 20%, Extreme 25%). Replaying those matches showed every one of them standing trapped after another player's bomb had cut the route it planned. Checking, before pressing A, that no nearby player could shut the route brought "blasted itself" to zero.
- The same replays found two plain bugs: Beginner never moved at all (its pause before setting off cancelled its own plan), and a bot could park on a spot too far away to attack from and stay there. Both showed up as numbers that looked too good: a Beginner that never blasted itself because it never dropped a bomb.
- The levels come out in order for staying in the match. Hard and Extreme knock out about the same number of rivals.
- "Shut in by a rival" and "blasted itself" are both a bot caught by its own blast. What separates them is in `shutIn` in the script, and it was drawn up from replays: a first, narrower test left four cases under "blasted itself", and each turned out to be a rival's later bomb cutting the way out or driving the bot back across its own bomb's lane. Replay any case that lands in "blasted itself" before believing either column.
- CPU players seldom finish each other off inside 3 minutes. They dodge well. The shrinking arena planned for step 3 is what should end matches.

What it cannot show is how they feel to play against. That needs a phone.

## `previous-build.ts`

A frozen copy of the swipe pad and the turning rule as they were before the rework of 9 November 2026, kept only so these comparisons can be rerun. Its header lists how it differs from the current code.
