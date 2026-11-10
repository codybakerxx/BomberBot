# BomberBot: notes for Claude

BomberBot is a top-down bomber battle game for the browser, built for phones. The owner directs the project and play-tests every change on a phone. Claude writes the code. Explain what you did in plain words, and lead with what changed for the player.

## Commands

```sh
npm install        # once
npm run check      # type-check, tests, build: run this before calling anything done
npm test           # tests only
npm run build      # writes dist/index.html, the whole game in one file
```

## Where things are

- `src/sim.ts`: all game rules. `src/swipe.ts`: the swipe pad. `src/teach.ts`: Match my thumb maths.
- `src/input.ts`, `src/render.ts`, `src/audio.ts`: input wiring, drawing, sound.
- `src/main.ts`: loop, menu, layout, settings. `src/page.html`: markup and styles.
- `tests/`: checks for the three pure modules. `experiments/`: control-tuning simulations, not part of the game.
- `docs/`: read `docs/CODE-GUIDE.md` first. `docs/ROADMAP.md` has the plan and every decision so far.

## Rules that must hold

1. `sim.ts`, `swipe.ts` and `teach.ts` stay pure: no DOM, no `Math.random`, no clocks. The same seed and inputs must always give the same match (a test checks it). Online play will run `sim.ts` on a server.
2. Rendering only reads the world. The rules never draw or play sound; they report events.
3. Game numbers are named constants at the top of `sim.ts`; pad numbers at the top of `swipe.ts`.
4. No image or sound files, and no new runtime dependencies. The build stays one self-contained HTML file.
5. Every screen works on an upright phone about 390 px wide, and sideways.
6. All art, code and sound are original. Do not copy from Bomberman or from `TommyBez/bomberman` (the project that inspired this one has no licence; it was used for ideas only).

## Decisions already made

Do not undo these unless asked. The reasons are in `docs/ROADMAP.md` and `docs/CONTROLS.md`.

- Battle royale only. No story mode.
- Controls: see-through swipe pad on the left, B above A on the right. Swipe from wherever the thumb is; keep it down to keep moving; lift to stop.
- The robot stops where you let go. Whole-tile stepping was tried and rejected (`stepAssist` exists in `sim.ts` but stays off, with no menu setting).
- A resting thumb has a quiet zone; small movements, slow drift and bounce-back are ignored. Its size is the menu's Swipe length: Short, Medium (default) or Long. Swipe length and Match my thumb are independent settings, and the menu says so.
- A turn takes the next opening ahead. The robot never doubles back to one it has passed, beyond half a tile.
- Swipe directions are read around a leaning aim per direction: 15° for all four by default. Match my thumb learns from 12 swipes, tests on 8 more, and keeps the best of the setting before, one lean, or a lean per direction.
- Robots start at 2.55 tiles a second (`BASE_SPEED` 0.04250390625: the original speed halved, then tuned +25%, +12.5%, −2.5%). Each speed power-up adds 0.37 tiles a second (`SPEED_STEP` 0.0062), up to six. Kicked bombs slide at 0.14 tiles a tick, 30% slower than the original 0.2.
- Kicking needs the boot. Lifting needs the glove. A lifted bomb has 3 seconds, keeps ticking, and the timer is set at the first lift only.
- Robots are about one tile in size. Bricks and solid blocks fill their tile. Power-ups are a full tile of pulsing colour.

## Working on controls and feel

You cannot feel touch controls. Say so, and do not claim a feel problem is fixed until it has been played on a phone.

- Find a concrete cause before changing numbers. Reproduce it in a test or an experiment script (`experiments/` shows how: replay a made-up thumb path through the real code and count what happens).
- Change one thing at a time and say what should feel different.
- When a report is "it goes the wrong way", check both halves: how the pad read the swipe (`swipe.ts`) and what the robot did with that direction (`movePlayer` in `sim.ts`).

## Before finishing

- `npm run check` passes.
- A rule or number changed: add or update a check in `tests/`, and update the tables in `docs/GAME-RULES.md`, `docs/CONTROLS.md` or `docs/MATCH-MY-THUMB.md`.
- The screen changed: retake screenshots with `tools/screenshots.py` if Python and Chrome are available.
- A decision was made: add it to `docs/ROADMAP.md` and to the list above.

## Next

Step 2 of the roadmap: computer players. They should be a new module that reads the world and returns a `PlayerInput` per bot; `tick()` in `main.ts` already passes a list of inputs to `step`.
