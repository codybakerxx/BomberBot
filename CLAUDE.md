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

- `src/sim.ts`: all game rules. `src/swipe.ts`: the swipe pad. `src/teach.ts`: Match my thumb maths. `src/bot.ts`: the CPU players.
- `src/input.ts`, `src/render.ts`, `src/audio.ts`: input wiring, drawing, sound.
- `src/main.ts`: loop, menu, layout, settings. `src/page.html`: markup and styles.
- `tests/`: checks for the four pure modules. `experiments/`: control-tuning simulations and CPU player matches, not part of the game.
- `docs/`: read `docs/CODE-GUIDE.md` first. `docs/ROADMAP.md` has the plan and every decision so far.

## Rules that must hold

1. `sim.ts`, `swipe.ts`, `teach.ts` and `bot.ts` stay pure: no DOM, no `Math.random`, no clocks. The same seed and inputs must always give the same match, CPU players included (tests check it). Online play will run `sim.ts` and `bot.ts` on a server.
2. Rendering only reads the world. The rules never draw or play sound; they report events.
3. Game numbers are named constants at the top of `sim.ts`; pad numbers at the top of `swipe.ts`; CPU level settings in the `LEVELS` table at the top of `bot.ts`.
4. No image or sound files, and no new runtime dependencies. The build stays one self-contained HTML file.
5. Every screen works on an upright phone about 390 px wide, and sideways.
6. All art, code and sound are original. Do not copy from Bomberman or from `TommyBez/bomberman` (the project that inspired this one has no licence; it was used for ideas only).

## Decisions already made

Do not undo these unless asked. The reasons are in `docs/ROADMAP.md` and `docs/CONTROLS.md`.

- Battle royale only. No story mode.
- Controls: see-through swipe pad on the left, B above A on the right. Swipe from wherever the thumb is; keep it down to keep moving; lift to stop.
- The robot stops where you let go. Whole-tile stepping was tried and rejected (`stepAssist` exists in `sim.ts` but stays off, with no menu setting).
- A resting thumb has a quiet zone; small movements, slow drift and bounce-back are ignored. Its size is fixed (`QUIET` 30 px). A menu choice of swipe length was tried and removed: do not bring it back unless asked.
- The menu pauses the round (it never ends it) and closes with ✕ or Escape. It has two tabs: Main menu (bot picker, Play or Resume, New round) and Controls.
- Controls tab: Steering thumb (left by default; right mirrors the layout and the standard lean, and each thumb keeps its own match) and Swipe direction, a Standard / My thumb switch. The side in use is tagged On, and the pad's corner caption shows it during play. Switching to Standard keeps the saved match.
- A turn takes the next opening ahead. The robot never doubles back to one it has passed, beyond half a tile.
- The robot looks the way it was last asked to go (`p.facing = dir` in `movePlayer`), at once: at a block, and while still walking to an opening. A throw goes the way it looks. `heading` is the way it is really moving. Standing still on a tile where the way asked for is a block, it only turns; it sets off for the next tile's opening once the direction has been held for `LOOK_TICKS` (9 ticks, 0.15 s). No pause while running or when its own tile has the opening.
- Swipe directions are read around a leaning aim per direction: 15° for all four by default. Match my thumb learns from 12 swipes, tests on 8 more, and keeps the best of the setting before, one lean, or a lean per direction.
- Match my thumb version 1 is kept on purpose: `docs/MATCH-MY-THUMB-V1.md` and the branches `match-my-thumb-v1` and `match-my-thumb-v2`. Never delete them. (Tags cannot be pushed from Claude's sessions, which is why these are branches.)
- Robots start at 2.55 tiles a second (`BASE_SPEED` 0.04250390625: the original speed halved, then tuned +25%, +12.5%, −2.5%). Each speed power-up adds 0.5 tiles a second (`SPEED_STEP`, 0.5 / 60 a tick; it was 0.37, then 0.45), up to six, which is 5.55 tiles a second. Collecting a speed power-up is the only thing that changes a robot's speed. Kicked bombs slide at 0.14 tiles a tick, 30% slower than the original 0.2.
- A blast, and a burning brick, lasts 0.45 seconds (`FLAME_TICKS` 27: shortened a little from 30).
- A bomb is passable only while the robot still counts as standing on its tile (`blocked` in `sim.ts`). Once on the next tile it is solid; with the boot, pushing back into it kicks it.
- Kicking needs the boot. Lifting needs the glove. A lifted bomb has 3 seconds, keeps ticking, and the timer is set at the first lift only.
- Robots are about one tile in size. Bricks and solid blocks fill their tile. Power-ups are a full tile of pulsing colour.
- The three other bots are CPU players (`src/bot.ts`, explained in `docs/CPU-PLAYERS.md`). Four levels: Beginner, Normal (default), Hard, Extreme, chosen under CPU players on the Main menu tab and saved as `cpuLevel`. A change applies at once, to a paused round too.
- CPU players get a `PlayerInput` like a person and nothing more: no extra speed, no seeing under bricks.
- No level is careless with its own bombs. Before pressing A every level needs a way out, no watched player able to shut it (`guard`), and the move played forward on a copy of the world (`placeBomb`). Easy levels are easy by being slow and unambitious.

## Working on controls and feel

You cannot feel touch controls. Say so, and do not claim a feel problem is fixed until it has been played on a phone.

- Find a concrete cause before changing numbers. Reproduce it in a test or an experiment script (`experiments/` shows how: replay a made-up thumb path through the real code and count what happens).
- Change one thing at a time and say what should feel different.
- When a report is "it goes the wrong way", check both halves: how the pad read the swipe (`swipe.ts`) and what the robot did with that direction (`movePlayer` in `sim.ts`).

## Before finishing

- `npm run check` passes.
- A rule or number changed: add or update a check in `tests/`, and update the tables in `docs/GAME-RULES.md`, `docs/CONTROLS.md`, `docs/MATCH-MY-THUMB.md` or `docs/CPU-PLAYERS.md`.
- The screen changed: retake screenshots with `tools/screenshots.py` if Python and Chrome are available.
- A decision was made: add it to `docs/ROADMAP.md` and to the list above.

## Working on CPU players

- A feel report ("too easy", "it never comes for me") is a change to one level's line in `LEVELS`. Change one setting at a time and say what should be different.
- After any change to `bot.ts`: `npm test`, then `npx tsx experiments/cpu-matches.ts` (about six minutes) and `npx tsx experiments/cpu-matches.ts solo`. "Blasted itself" must stay at zero. Update the tables in `docs/CPU-PLAYERS.md` and `experiments/README.md`.
- Known gap: a CPU player with no safe route left stands still (`doing = 'trapped'` in `flee`). A last-ditch run is not built; a negative margin in `explore` is not the fix on its own, because it would also run them into flames they could have waited out.
- "Blasted itself" and "shut in by a rival" are told apart by `shutIn` in `experiments/cpu-matches.ts`. If a run shows anything under "blasted itself", replay it (seed and corner order are in the script) before changing the bot or the test.
- Be suspicious of numbers that look too good. A level that never blasts itself may be a level that never drops a bomb: check it also gets the still target in the `solo` run.
- You cannot tell how hard a level is for a person. Say so; it has to be played.

## Next

Step 3 of the roadmap: round flow. A time limit after which blocks fall to shrink the arena, so rounds end (CPU players dodge well and seldom finish each other off), and a results screen. New state in `World` and a new stage in `step`; the CPU players' danger map will need to know about falling blocks.
