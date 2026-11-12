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
- `src/input.ts`, `src/render.ts`, `src/audio.ts`: input wiring, drawing, sound. `src/robot.ts`: how the robot is drawn (handed on through `render.ts`).
- `src/main.ts`: loop, menu, layout, settings. `src/page.html`: markup and styles.
- `tests/`: checks for the four pure modules (most build their arenas with `roundTicks: 0`, so the timer does not get in the way of what they check). `experiments/`: control-tuning simulations and CPU player matches, not part of the game.
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
- The menu pauses the round (it never ends it) and closes with ✕ or Escape. It has two tabs: Main menu (bot picker, Play or Resume, New round) and Controls. ✕ never starts a new round once one has been played: after a round has ended for you it goes back to watching that round with the result panel up (`watch`, `closeMenu` in `main.ts`), and the menu's main button says New round.
- Your colour is yours for the whole round. A round's colours are set in `newWorld` in `main.ts` and nowhere else; the picker only sets `myColor` for the next round, and is switched off while a round is in play (`lockPicker`). Before the first round it also recolours the waiting arena. CPU players keep their colours between rounds; one whose colour you pick takes yours. Menus to come that choose a colour must follow the same rule.
- The menu button (`#menuBtn`) is three bars, not the word Menu, so the scoreboard fits beside the timer.
- The timer counts down 1 minute 30 (`ROUND_TICKS`; it was 2 minutes at first; `roundTicks` in `createWorld`, 0 = no timer, which is what most tests use). When it reaches 0:00 the blocks start to fall, and take 50 seconds (`SHRINK_TICKS`). They fall one at a time in `world.shrinkOrder`: round the edge clockwise from the top-left corner, then two more rings inward, then the two columns beside the middle. (At first they fell during the last minute of the timer; changed in play-testing.) Each is in the air 0.63 s (`FALL_TICKS` 38) over a marked tile (the blocks were made 20% faster in play-testing: a minute and 0.75 s at first; keep the two in step), then turns it solid for good, knocks out a robot under it (a shield does not help), and removes a bomb, power-up, brick or blast there (`fallBlocks` in `sim.ts`).
- A 5 by 5 square in the middle is never touched (`KEEP_OPEN`, `keptOpen`). When the blocks stop the round goes on there until someone wins; it has no time limit. The first version closed the whole arena and half the rounds were draws on the last tile: do not go back to that.
- The last robot standing wins even if a block gets it a moment later; robots under the same block draw.
- A blast starts 1 tile long each way (`START_FIRE`); each flame power-up adds a tile, up to 8. It started at 2.
- The timer is centred in the top bar (`#timer`, `drawTimer` in `main.ts`): white, amber for the last 30 seconds, red for the last ten and after. Sideways it sits over the side column. The strip of collected power-ups was removed: do not bring it back unless asked. The pad caption is centred.
- Upright phone, top to bottom: top bar (46 px) holding the scoreboard and the timer, a blank line one block high kept for information to come (`INFO_ROWS` in `layout()`, passed to the styles as `--info-row`), the arena, then the controls. The pad and A gave up that block of height; B keeps its size (`--b-height` in `page.html`). Sideways has no such line: the scoreboard is a row under the timer in the side column.
- The scoreboard (`#score`, `drawScore` in `main.ts`; `layout()` sets `scoreCells`): four heads in the top bar, two each side of the timer, each player's rounds won to the right of its head, yours first. The far left is left clear to match the menu button on the far right. A win adds one, a draw nothing. A player out of the current round is dimmed with crosses for eyes; a place with no player is a grey head with no number. `wins` lasts until the page is closed; a setting for how many rounds make a match is still to come. It was a row under the top bar with the numbers underneath: do not go back to that unless asked.
- The player in the lead wears a crooked crown (`leader` in `main.ts`, `drawCrown` and `Pose.crown` in `robot.ts`) on the scoreboard and on its robot. Nobody has it before the first win; it changes hands only when another player gets strictly ahead.
- The end of a round: when you are knocked out a panel says how, and the round carries on behind it so its winner still gets the win; when the round is decided the panel says who won. The panel (`#resultCard`) never covers the arena: over the controls when upright, in the side column otherwise. Once a round is decided nobody is given any input, nothing more can happen to the winner, and no more blocks start to fall.
- Knocked out (`drawPlayer` in `render.ts`, 1.5 s, `DEATH_TICKS` 90): burnt black with crosses for eyes, crumbling into ash that drifts up, while a pale ghost in a faint suit colour, with angel wings and a halo (`drawWings`, `drawHalo`), floats up out of the arena to the top of the screen and fades as it nears the top (`drawGhosts` in `render.ts`, on its own layer `#ghosts`; `GHOST_SPEED`, `GHOST_FADE`; `deadTicks` counts on to `GHOST_TICKS` 300 for it). It rose 1.5 tiles at first, then 3. Under a fallen block only the ghost. The winner jumps with one arm up, then dances (`winPose`).
- Controls tab: Steering thumb (left by default; right mirrors the layout and the standard lean, and each thumb keeps its own match) and Swipe direction, a Standard / My thumb switch. The side in use is tagged On, and the pad's corner caption shows it during play. Switching to Standard keeps the saved match.
- A turn takes the next opening ahead. The robot never doubles back to one it has passed, beyond half a tile.
- The robot looks the way it was last asked to go (`p.facing = dir` in `movePlayer`), at once: at a block, and while still walking to an opening. A throw goes the way it looks. `heading` is the way it is really moving. Standing still on a tile where the way asked for is a block, it only turns; it sets off for the next tile's opening once the direction has been held for `LOOK_TICKS` (9 ticks, 0.15 s). No pause while running or when its own tile has the opening.
- Swipe directions are read around a leaning aim per direction: 15° for all four by default. Match my thumb learns from 12 swipes, tests on 8 more, and keeps the best of the setting before, one lean, or a lean per direction.
- Match my thumb version 1 is kept on purpose: `docs/MATCH-MY-THUMB-V1.md` and the branches `match-my-thumb-v1` and `match-my-thumb-v2`. Never delete them. (Tags cannot be pushed from Claude's sessions, which is why these are branches.)
- Robots start at 2.55 tiles a second (`BASE_SPEED` 0.04250390625: the original speed halved, then tuned +25%, +12.5%, −2.5%). Each speed power-up adds 0.5 tiles a second (`SPEED_STEP`, 0.5 / 60 a tick; it was 0.37, then 0.45), up to six, which is 5.55 tiles a second. Collecting a speed power-up is the only thing that raises a robot's speed. Kicked bombs slide at 0.14 tiles a tick, 30% slower than the original 0.2.
- 48% of bricks hide a power-up (`ITEM_CHANCE` in `sim.ts`: bomb 15%, flame 15%, speed 11%, boot 2.5%, glove 2.5%, shield 1%, curse 1%). An arena averages 11.8 bombs, 11.8 flames, 8.7 speeds, 2.1 boots, 2.1 gloves, 0.8 shields, 0.8 curses; every arena has a boot and a glove; a shield or a curse is in 54% of arenas. After changing a chance, run `npx tsx experiments/item-rarity.ts` and update the rarity table in `docs/GAME-RULES.md`. Add new kinds at the end of the list.
- Shield (very rare): the next blast does not knock the robot out; 30 seconds (`SHIELD_TICKS`) then it wears off; half a second of safety after it is used (`SHIELD_GRACE_TICKS`), so it covers one bomb, not a chain. Does not stack.
- Curse (very rare): 8 seconds (`CURSE_TICKS`) at 85% of the starting speed (`CURSE_SPEED`), ignoring speed power-ups. It is the only thing besides a speed power-up that changes a robot's speed, and it gives the speed back.
- Shield and curse are drawn on the robot (`drawStatus` in `render.ts`), not in the top bar.
- A blast, and a burning brick, lasts 0.45 seconds (`FLAME_TICKS` 27: shortened a little from 30).
- A bomb is passable only while the robot still counts as standing on its tile (`blocked` in `sim.ts`). Once on the next tile it is solid; with the boot, pushing back into it kicks it.
- Kicking needs the boot. Lifting needs the glove. A lifted bomb has 3 seconds, keeps ticking, and the timer is set at the first lift only.
- A bomb is a black iron ball with a steel cap and a rope fuse (`drawBomb` in `render.ts`; the owner asked for a more realistic bomb with a fuse that visibly burns down). The fuse is a clock: the rope left is the share of the bomb's time left (`FUSE_TICKS`, or `CARRY_FUSE_TICKS` once it has been lifted, when the fuse grows back), and the spark reaches the cap as it goes off. It flashes red-hot for the last three quarters of a second. A band of light in its owner's colour sits low on the ball. The ball is 0.30 of a tile (`BOMB_R`), a little low on its tile (`BOMB_DROP`); a carried bomb rests on the helmet.
- The robot's design was settled by the owner on a large front view (`frontBack` in `src/robot.ts`): glossy armour in its colour, black joints, a black pelvis with three lines across it (down, flat, up), fists with no thumb, no round joints on the knees, shoulder pads that reach in over the chest, big black boots with a lit sole, a helmet with a rim and chin piece in its colour and a light bar where glass meets chin piece, with a thin black line tracing the bar's curve right under it (`LED`, `LED_LINE`, `beside` in `helmet`; the line was halved once, to 0.008), a smooth metal finish. Do not move those shapes unless asked. The back and side views (`sideView`) and the walk are Claude's and can be improved, except the light bar's path from the side, which the owner chose (`SIDE_TRIM`): back under the glass from the front and up behind the middle of the head in a soft round turn (settled half way between a flat bottom with a tight corner and one wide sweep, both of which were tried), then towards the back, then up again to the back of the helmet. The back of the head has no light bar and no black line (the owner's choice: one with them was tried and turned down): the helmet's own material simply ends at the black glass, in a round arch over the back of the helmet. The arch is worked out from the side view's path (`BACK_TRIM` from `SIDE_TRIM`), so the two always agree: change the side and the back follows. Earlier looks were turned down: added equipment (chest panel, pouches, vents), a thumb, a trapezoid plate on the pelvis, anything that makes the pelvis read as a nappy.
- The robot is 1.09 tiles tall and 0.71 wide (`K` 0.918 in `robot.ts`), standing on one tile with its helmet a little over the tile above. The owner set this size in two steps: first its head 10% smaller (`HEAD` 0.9: the whole helmet scaled together, still resting on the collar), then the whole robot 15% smaller (`K` was 1.08, when the robot was 1.35 tiles tall and then 1.28). Do not scale either back unless asked. (Before that, Claude had tried it at 1.17 tiles and found it hard to read from the side: if the owner reports that robots are hard to see, this is the number.) The scoreboard's heads and the picker's robots keep their size. Things drawn round it use `ROBOT` (head, top, shoulders, and `scale` for the size of the wings and halo), not numbers of their own; a carried bomb sits just over the helmet (`ROBOT.top`).
- Robots are drawn from sprites (`sprite`, `drawRobot`, `warmRobots` in `robot.ts`; `warmSprites` in `render.ts`, called every frame from `main.ts`). Never draw a robot piece by piece every frame. A new pose that changes the picture needs to be part of the sprite's key; one that only moves, turns or scales it (`jump`, `lean`, `shrink`, the crown) does not.
- The soft rounding inside each piece (`FINE`, `softly`) is only for artwork over 500 pixels tall. It blurs with a canvas shadow because iPhones lack the canvas blur filter, and has only been tried in Chrome: try it on an iPhone before using it on a screen of the game.
- Bricks and solid blocks fill their tile. Power-ups are a square of pulsing colour 83% of a tile across (`ITEM_SIZE` in `render.ts`; made 10% smaller than the first size), bobbing slowly over a shadow (`ITEM_BOB`, `ITEM_BOB_RATE`).
- The three other bots are CPU players (`src/bot.ts`, explained in `docs/CPU-PLAYERS.md`). Three levels: Beginner, Normal (default) and Hard, chosen under CPU players on the Main menu tab and saved as `cpuLevel`. A change applies at once, to a paused round too.
- CPU players get a `PlayerInput` like a person and nothing more: no extra speed, no seeing under bricks.
- CPU players want a shield, never go looking for a curse, and Normal and above walk round one when there is another way (`dodgeCurse`). They know where blocks will fall, each level looking a different distance ahead (`blockSight`), and move inward ahead of them; they keep fighting while they do. Once the timer has run out and they are standing in the square, Normal and Hard press (`squareBold`, `emboldened` in `bot.ts`): they bomb any player in line, use every bomb, drop bombs beside players to take their room away, and stop holding back in case a rival shuts their way out. Beginner does not. They do not take risks because they hold a shield. Once a shield has taken a blast they use the half second to walk out through it (`sparedFor`).
- No level is careless with its own bombs. Before pressing A every level needs a way out, no watched player able to shut it (`guard`), and the move played forward on a copy of the world (`placeBomb`). Easy levels are easy by being slow and unambitious. There were four levels at first; Extreme was renamed Hard, the old Hard was dropped, and Normal was eased a little (`think` 16, `hesitate` 6 to 26, `notice` 22, `hunt` 0.55, `attack` 0.5). A saved `cpuLevel` of `extreme` is read as `hard`. Beginner was eased once already after play-testing (`hesitate` 40 to 110, `notice` 70, `hunt` 0.12, `attack` 0.2); if it is still too hard, those four and `think` are the ones to turn further.

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
- After any change to `bot.ts`, or to a rule the CPU players depend on: `npm test`, then `npx tsx experiments/cpu-matches.ts` (about fifteen minutes) and the same with `solo`, `versus` and `alone`. "Blasted itself" must stay at zero. Update the tables in `docs/CPU-PLAYERS.md` and `experiments/README.md`.
- Known gap: a CPU player with no safe route left stands still (`doing = 'trapped'` in `flee`). A last-ditch run is not built; a negative margin in `explore` is not the fix on its own, because it would also run them into flames they could have waited out.
- "Blasted itself" and "shut in by a rival" are told apart by `shutIn` in `experiments/cpu-matches.ts` (and by `cause` in `playMatch`, for a bot's bomb set off early by a rival's bomb that was dropped, kicked or thrown afterwards). If a run shows anything under "blasted itself", replay it (seed and corner order are in the script) before changing the bot or the test.
- Be suspicious of numbers that look too good. A level that never blasts itself may be a level that never drops a bomb: check it also gets the still target in the `solo` run.
- You cannot tell how hard a level is for a person. Say so; it has to be played.

## Next

The owner's plan from here is in `docs/ROADMAP.md` ("The plan from here"): a backbone of match setup and screens, then online, then modes, with smaller things in between. Step 1 is next: a title screen, then a lobby that holds the settings (round length, which the rules already take; rounds per match; CPU level; your colour). Its warm-up, the bomb with a burning fuse, is done. Ask before starting step 1. Before that, anything play-testing turns up about the timer and the falling blocks: the pace, the warning, and whether rounds drag on in the square once the blocks stop.
