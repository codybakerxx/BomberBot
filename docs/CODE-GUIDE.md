# Code guide

How the code is organised, what each file is for, and the rules to keep to when changing it. The files themselves carry comments on every part; this is the map.

## The big picture

The game is split into layers that only talk to each other in one direction.

```mermaid
flowchart LR
  T([thumb or keys]) --> I["input.ts + swipe.ts<br>what is the player asking for?"]
  I -- "direction, A, B<br>60 times a second" --> S["sim.ts<br>the rules"]
  S -- "the world" --> R["render.ts<br>draw it"]
  S -- "events" --> A["audio.ts<br>play sounds"]
  S -- "the world" --> B["bot.ts<br>CPU players"]
  B -- "direction, A, B" --> S
  M["main.ts<br>runs the loop, the menu and the screen layout"] -.-> I
  M -.-> S
  M -.-> R
  M -.-> A
```

- **Input** turns touches and key presses into three things: a direction, whether A is held, whether B is held.
- **The rules** take the current world and everyone's input and work out the world one tick later. They know nothing about screens, sound or browsers.
- **CPU players** look at the world and return the same three things a person's controls do. They never change the world either.
- **Rendering** draws the world. It never changes it.
- **Audio** plays a sound for each thing the rules report happened.
- **main.ts** owns the loop that drives all of this, plus everything about the page.

Keeping the rules apart is the most important decision in the project. It is why the rules can be tested without a browser, and it is what will let the same file run on a server for online play.

## One frame, step by step

1. The browser calls `frame()` in `main.ts` before each screen refresh.
2. `frame()` works out how much time has passed and runs `tick()` once for every sixtieth of a second owed. Screens that refresh at 90 or 120 times a second still get exactly 60 ticks a second.
3. `tick()` asks `input.state()` for the player's direction and buttons, and `botInput(world, bot)` for each CPU player's.
4. `tick()` calls `step(world, inputs)` in `sim.ts`, which moves everything forward one tick and fills `world.events`.
5. `tick()` plays a sound for each event and checks whether the round has ended.
6. `frame()` calls `render()`, which draws the cached floor layer and then everything that moves.

## File by file

### `src/sim.ts`: the rules

The whole game as pure logic. No drawing, no sound, no browser calls, no `Math.random`.

| Part | What it is |
|---|---|
| `World` | The complete state of a match: the tiles, the players, bombs, blasts, burning bricks, power-ups, and the result |
| `createWorld(config)` | Builds a fresh arena from a seed |
| `cloneWorld(world)` | A separate copy of a world, which CPU players use to try a move before making it |
| `step(world, inputs)` | Advances the world one tick. The only function the rest of the game calls during play. |
| `ticksLeft(world)`, `blockLandTick(world, k)` | What the timer shows, and when each falling block lands |
| `movePlayer` | Walking, lining up with openings, turning, kicking |
| `placeBomb`, `useAction` | The A and B buttons |
| `moveBombs` | Carried bombs follow, thrown bombs fly, kicked bombs slide |
| `explode` | A blast: reach, what stops it, chain reactions |
| Constants | Every number of the game, named, near the top of the file |

Positions are in tiles, and tile centres are whole numbers. A robot at `x = 3` is exactly in the middle of column 3, and `Math.round(x)` is the tile it counts as standing on.

Plain-words version: [GAME-RULES.md](GAME-RULES.md).

### `src/swipe.ts`: the swipe pad

`SwipePad` turns a stream of thumb positions into a direction. Also pure logic, so it is tested with made-up thumb paths.

| Member | Use |
|---|---|
| `press(x, y, t)`, `move(x, y, t)`, `release()` | Feed it the touch |
| `poll(t)` | Call regularly so it notices a thumb that has stopped moving |
| `dir` | The direction it currently reads: 0 none, 1 up, 2 down, 3 left, 4 right |
| `scale` | Scales the quiet zone and turn distances. Always 1 in the game: there is no menu setting for it. |
| `aims` | The screen angle each direction is read around (index 1 to 4). Setting `tilt` instead leans all four the same number of degrees clockwise. |
| `onStroke` | Callback used by Match my thumb to measure swipes |

Plain-words version: [CONTROLS.md](CONTROLS.md).

### `src/teach.ts`: Match my thumb maths

Small pure functions in three groups. Measuring: `leanOf` (how far one swipe leans) and `summarise` (average a dozen, overall and per direction). Building settings: `tiltFor` (the lean the pad should use), `singleAims` and `perDirectionAims`. Testing: `marginOf` (how far inside its quarter a swipe sits), `judge` (read the test swipes with a setting) and `pickBest`. Plus the two lists of directions asked for, `TEACH_ORDER` and `TEST_ORDER`. The shared aim maths (`STRAIGHT`, `uniformAims`, `aimScore`, `nearestDir`) lives in `swipe.ts`. Explained in [MATCH-MY-THUMB.md](MATCH-MY-THUMB.md).

### `src/bot.ts`: the CPU players

Pure logic like the rules. Given the world, `botInput(world, bot)` returns one `PlayerInput`. A `Bot` holds that player's memory: its level, its plan, and its own seeded random generator.

| Part | What it is |
|---|---|
| `LEVELS` | The settings of the three levels, one line each |
| `createBot(id, level, seed)` | Makes the memory for one CPU player |
| `botInput(world, bot)` | What it presses this tick. Calls `flee` if its tile is going to be blasted, otherwise `calm`. |
| `dangerMap` | For every tile, when a blast will be on it: chain reactions, bricks that will be gone, sliding and thrown bombs |
| `explore`, `pathTo`, `escapeTargets` | Where it can walk and how soon, never on a tile while it burns |
| `decide`, `chooseGoal` | Bomb a player, or pick a power-up, bricks or a player to walk to |
| `placeBomb` | The three checks before pressing A: a way out, nobody able to shut it, and the move played forward on a copy |
| `tryOut`, `wayOut` | Kicks and throws, each tried on a copy of the world first |

It uses `cloneWorld` and `step` from `sim.ts` to play moves forward. Plain-words version: [CPU-PLAYERS.md](CPU-PLAYERS.md).

### `src/input.ts`: keyboard and touch wiring

The `Input` class listens to the keyboard, the swipe pad area and the two buttons, and merges them. `state()` returns `{ dir, a, b }` once per tick.

It also **latches**: a tap or flick that begins and ends between two ticks is remembered until the game has read it once, so nothing is missed.

### `src/robot.ts`: the robot

How one robot is drawn: from the front, the back and each side, standing, walking, with an arm raised, knocked out or as a ghost. The design was settled by the owner on a large front view; the back and side views were worked out from it. Read the note at the top of the file before changing a shape.

| Name | What it is |
|---|---|
| `drawRobot` | Draws one robot, in any colour, facing any of four ways, mid-stride or still. The menu uses it too. |
| `drawHead` | A robot's helmet on its own, for the scoreboard, with the crown if asked |
| `Pose` | Ways to draw a robot other than standing or walking: jumping, arms up, leaning, crosses for eyes, a ghost, a crown, shrinking |
| `ROBOT` | Where the robot's head, top and shoulders are, in tiles, and how big it is next to the size its wings and halo were first drawn for (`scale`): for whatever is drawn round one (crown, halo, wings, shield ring, a carried bomb) |
| `warmRobots` | Makes robots' pictures ahead of the moment they are needed, a few each frame |

**Sprites.** Drawing one robot takes a few hundred canvas calls, which is too many to make for four robots sixty times a second on a phone. So each robot is drawn once into a small picture of its own (a sprite) for each way it can look: colour, direction, one of 8 steps of the walk, how far each arm is raised. After that, drawing it is a single `drawImage`. Making a sprite takes a few thousandths of a second, so `warmSprites` in `render.ts` (called once a frame from `main.ts`) makes the ones a round will need a few at a time, before they are needed. A change of screen size makes new ones; when there are more than 700 they are all thrown away and made again as wanted.

**Two levels of finish.** Every piece is lit, shaded, given a reflection and a highlight, and throws a shadow on the piece below. On a drawing with a robot over 500 pixels tall (artwork from `tools/portraits.py`) each piece is also rounded by soft shadow and light inside its edges. At playing size that would be less than a pixel, so it is left out. The soft version uses a canvas shadow to blur (`softly`), because the canvas blur filter is missing on iPhones; it has only been tried in Chrome.

### `src/render.ts`: drawing

Everything on the canvas is drawn with shapes in code. There are no image files. The robots are drawn by `robot.ts`; `render.ts` hands `drawRobot`, `drawHead` and `ROBOT` on, so the rest of the game finds all the drawing in one place.

| Function | Draws |
|---|---|
| `drawStatic` | Floor and solid blocks. Drawn once onto a hidden canvas and reused every frame. |
| `drawDynamic` | Everything else, every frame: shadows, power-ups, bricks, the ring under your robot, bombs, blasts, robots, carried and flying bombs |
| `drawItemIcon` | The seven power-up icons |
| `winPose` | The winner's jump and dance, as a `Pose` |
| `warmSprites` | Gets the robots' pictures ready ahead of need: everyone's walk, the burnt robot, the ghosts, the winner's dance |
| `drawGhosts` | The ghosts of knocked-out robots, with wings and a halo, floating up to the top of the screen. Drawn on a layer of its own, because they leave the arena |
| `drawStatus` | What is drawn over a robot: the shield ring, the ring flying off when a shield is used up, the skull over a cursed robot |
| `COLORS` | The nine bot colours. Only the coloured parts change (the armour, the helmet's rim and chin piece, the lit soles); the black parts are shared. |

### `src/audio.ts`: sound

Each effect is a short synthesised tone or burst of noise. `sfx.place()`, `sfx.explode()` and so on. Sound only starts after the first tap or key press, because browsers require that.

### `src/main.ts`: the app shell

Everything that ties the game to the page:

- the fixed-rate loop (`frame`, `tick`)
- sizing the arena and controls to the screen (`layout`)
- the round timer at the top (`drawTimer`)
- the menu: its two tabs, opening and closing it, and pausing the round behind it (`showMenu`, `showTab`, `closeMenu`, `play`, `resume`, `watch`, `start`, and the flags `roundLive` and `overShown`)
- the bot picker (`buildPicker`; `lockPicker` switches it off during a round; a round's colours are set in `newWorld` and nowhere else), the CPU level buttons (`buildLevels`) and the result panel (`finish`)
- the layer the ghosts float up on (`ghosts`, placed by `layout`, drawn in `render`)
- the scoreboard (`drawScore`; `layout` works out where its four places go), the count of rounds won (`wins`) and who wears the crown (`leader`), which last until the game is closed
- the three CPU players of the round (`bots`, made in `newWorld`, asked for their input in `tick`)
- the control settings: steering thumb and swipe direction (`settings`, `thumb`, `applySettings`)
- the Match my thumb screen (`startTeach`, `teachStroke`, `finishLearning`, `finishTesting`, `closeTeach`)

It holds no game rules.

### `src/page.html`: the page

The markup and all the styles. A comment at the top lists every element by id. `build.mjs` pastes the compiled code in at the `/*__BUNDLE__*/` marker.

Classes on `<body>` drive the layout: `touch` (show the on-screen controls) and `portrait` (phone held upright), both set by `layout()` in `main.ts`; `righty` (the right thumb steers, so the controls are mirrored), set by `applySettings()`; and `menu-open` (hide the Menu button and top strip), set by `showMenu()`.

Every canvas is made for the screen's size and pixel density at the moment `layout()` runs. A phone can change its pixel density without a resize event (the Claude app can open the page at density 1 and correct it a moment later), which left the whole game blurry until the next resize. So `keepSharp()` checks size and density every frame and lays the page out again when either has changed; `drawPicker()` redraws the menu's robots when the density changes.

### `build.mjs`: the build

Bundles `src/main.ts` with esbuild, pastes it into `src/page.html`, and writes `dist/index.html`. That single file is the whole game.

## The world, briefly

| In `World` | Holds |
|---|---|
| `tiles` | One number per tile: 0 floor, 1 solid block, 2 brick |
| `hidden` | Power-ups still under bricks |
| `players` | Position, facing, what they can do, whether they are still in |
| `bombs` | Position, owner, fuse, blast length, and whether on the floor, carried or flying |
| `flames` | The tiles of blasts still burning |
| `burning` | Bricks a blast has reached, about to become floor |
| `items` | Power-ups lying in the open |
| `events` | What happened this tick: place, kick, lift, throw, land, explode, pickup, shield, block (one landed), death (with what caused it and whose bomb) |
| `roundTicks`, `shrinkTicks` | The length of the round and of the part of it in which blocks fall |
| `shrinkOrder`, `shrinkNext`, `falling` | The tiles blocks will fall on, in order; how many have started; and the ones in the air now |
| `over` | Null until the round is decided, then the winner or a draw |

## Rules to keep to

1. **`sim.ts` stays pure.** No DOM, no `Math.random`, no clocks. Randomness comes from the seeded generator `makeRng`. The same seed with the same inputs must give exactly the same result every time; a test checks this. Online play will depend on it.
2. **Rendering never changes the world.** It only reads it.
3. **The rules never draw or play sound.** They report events; `main.ts` acts on them.
4. **`swipe.ts`, `teach.ts` and `bot.ts` stay pure too**, so they can be tested without a browser, and so a server can run CPU players.
5. **Numbers get names.** Game numbers are constants at the top of `sim.ts`, pad numbers at the top of `swipe.ts`.
6. **No image or sound files.** Everything is drawn and synthesised in code, which keeps the game one small file.
7. **Phones first.** Every screen has to work on an upright phone about 390 px wide, and sideways.
8. **Run `npm run check` before calling anything done.**

## Tests

`npm test` runs four files through `tests/index.ts`. Each is a plain script: it builds a situation, runs it, and asserts what must be true. The first failure stops with an error; reaching "all checks passed" means everything held.

| File | Covers |
|---|---|
| `tests/rules.test.ts` | The arena, walking and stopping, which way the robot looks, bombs and blasts, power-ups, chain reactions, kicking, lifting and throwing, winning, turning at openings, repeatability from a seed, and 45,000 ticks of random play that must never leave a robot inside a block or jittering |
| `tests/swipe.test.ts` | The pad: when a stroke starts, wiggles, drift and bounce-back ignored, turns and reverses mid-swipe, leaning swipes read correctly from every starting direction, the stroke reports Match my thumb relies on, a separate aim per direction |
| `tests/teach.test.ts` | Measuring a lean, averaging, rejecting scattered swipes, the three-quarters rule and its limits, the two candidate settings, that a straight swipe always keeps 20° of room, judging test swipes, and choosing the winner |
| `tests/bot.test.ts` | The CPU players: the danger map and chain reactions, slow levels noticing bombs late, that thinking never changes the world, no bomb without a way out, every level surviving two minutes in a full arena, every level finding and beating a player who stands still, and repeatability |

To add a check, copy a block in the nearest file and change what it sets up and what it asserts.

There are no automatic browser tests. The game has been checked in a phone-sized browser window by hand and with the script in `tools/`, and play-tested on a real phone.

## Experiments and tools

- [`experiments/`](../experiments/README.md) holds simulations used to decide how the controls should work, and the script that plays CPU players against each other. They are not part of the game and nothing depends on them.
- `tools/screenshots.py` retakes the pictures in `docs/screenshots/`. It needs Python and a Chrome browser, and is optional.
- `tools/portraits.py` saves large pictures of the robots as PNG files with transparent backgrounds, for title screens and other artwork: the robot exactly as the game draws it (`tools/portrait.ts` calls `drawRobot`), at a size where the soft finish shows, from the front or with `--view back`, `right` or `left`. Not part of the game.

## Where new features will go

| Planned | Where it fits |
|---|---|
| More than four players, bigger arenas | `spawnPoints` and `createWorld` in `sim.ts`. The arena size is already a setting (`cols`, `rows`). |
| Teams | A team field on `Player`, and the win check at the end of `step`. |
| Online play | A small server runs `sim.ts` and is the authority. Each phone sends its `PlayerInput` and draws the world it is sent. The purity rules above are what make this possible. |
| Menus for characters, levels and custom items | `page.html` and `main.ts`. |
