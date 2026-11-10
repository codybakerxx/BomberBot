# Roadmap

Where BomberBot is going, what has been decided, and what is still open.

## The plan in seven steps

Each step is played on a phone before the next one starts.

| Step | What | Status |
|---|---|---|
| 1 | **One level.** The arena, movement, bombs, blasts, bricks, power-ups and the touch controls. | Done, and it grew: kicking, lifting and throwing, and Match my thumb (now version 2) were added along the way. |
| 2 | **Computer players.** The other bots move, avoid blasts and fight back, so the game can be played alone. | Next |
| 3 | **Round flow.** Last one standing wins, blocks fall to shrink the arena as time runs out, and a results screen. | Planned |
| 4 | **Menus.** A proper character select, a colour picker, level select, and choosing which power-ups are in a custom game. | Planned |
| 5 | **Teams.** Team battles by colour. | Planned |
| 6 | **Online.** Rooms for up to nine players. | Planned |
| 7 | **Polish.** Final look, colours and sound, then putting it online for friends. | Planned |

## What the finished game should have

This is the brief the project started from.

**Battle royale only.** No story mode.

**Computer players** to play against alone.

**Online play for up to nine players**, with starting places spread evenly:

- 4 players: near the four corners
- 5 players: the same, plus one in the middle
- 6 players: the same, with two in the middle, spaced apart
- 7 to 9 players: the arena gets bigger, and only gets smaller again as the falling blocks close it in

**Team battles by colour.** The top of the screen shows which team is which. Uneven teams are allowed, and computer players can be added to even them out.

**Changeable bot colours.** No two players in the same match can have the same colour.

**Better menus** for choosing a character and a level.

**Custom games** where you choose which power-ups are in play.

## Decisions made so far

| Decision | Why |
|---|---|
| The game is called **BomberBot** | Chosen on 9 November 2026. |
| Original name, characters and art | It is inspired by Bomberman but is its own game. Nothing from Bomberman or from the reference project is copied. |
| TypeScript and canvas, with no game engine | A 2D grid game does not need one, and the result is one small file. |
| The rules are kept apart from drawing and input | So they can be tested without a browser and run on a server for online play. |
| See-through swipe pad on the left, B above A on the right | From a hand-drawn wireframe. Swipe from wherever the thumb is, keep it down to keep moving. |
| The robot stops where you let go | Finishing every step on the middle of a tile was tried and rejected: a small thumb movement should not move a whole block. |
| A turn takes the next opening ahead | Turning to the nearest opening sometimes sent the robot back the way it came. |
| The pad can be matched to a player's thumb | Quick swipes lean, by an amount that differs from person to person. |
| Match my thumb version 1 is kept, not deleted | Its document is `docs/MATCH-MY-THUMB-V1.md` and its code is on the branch `match-my-thumb-v1`. Do not delete that branch. |
| Match my thumb tests its result and keeps the best of: the setting before, one lean, a lean per direction | Simulation showed a lean per direction alone is not a clear improvement, so each player's own test swipes decide. A change has to beat the setting already in use. |
| Robots start at 2.55 tiles a second, about 69% of the original speed; each speed power-up adds 0.37 tiles a second, up to six | The game started too fast, so the speed was halved, then tuned in play-testing (+25%, +12.5%, −2.5%). Speed is something you earn by collecting power-ups. |
| Swipe length is fixed at Medium, with no menu setting | A choice of five levels, then three, was offered. Medium felt right in play-testing, so the choice was removed. |
| The menu has a Standard / My thumb switch, with the side in use tagged On, and the swipe pad shows which is on during play | It was not obvious whether Match my thumb was active. Switching to Standard keeps the match so it can be switched back on. |
| A kicked bomb slides 30% slower than at first (8.4 tiles a second instead of 12) | Asked for together with the slower walking. |
| The menu pauses the round and can be closed with ✕; it has two tabs, Main menu and Controls | Opening the menu used to end the round. Control settings were crowding the main menu. |
| Steering thumb: left (default) or right. The right-thumb layout is mirrored, its standard lean is 15° anticlockwise, and each thumb keeps its own match | So players can steer with whichever thumb they prefer. The two thumbs lean opposite ways, so they cannot share a setting. |
| A bomb is passable only while the robot still counts as standing on its tile | Walking back and forth through a bomb after stepping off it felt wrong. Once on the next tile, it is solid. |
| Kicking needs the boot, lifting needs the glove | They are power-ups to find, not abilities everyone starts with. |
| A lifted bomb has 3 seconds and keeps ticking | The fuse does not pause in your hands. The 3 seconds start at the first lift only, so a bomb cannot be kept alive by lifting it again. |
| Robots are about one tile in size, with a ring on the tile they stand on | So it is clear where the robot is relative to the blocks when hiding from a blast. |
| Bricks and solid blocks fill their whole tile | The classic look, drawn fresh. |
| Power-ups are a full tile of pulsing colour with a dark icon | Easy to see at phone size. |

## Still open

- **Match my thumb: separate settings for upright and sideways.** The thumb sweeps a different arc in each grip. Liked, not built yet.
- **Setting bombs off by remote.** B was also meant to detonate. How that should work has not been decided.
- **The final colours.** The arena is in blues for now. The look is to be revisited.
- **More arenas.** Only the one layout style exists.
- **Where to host online play.** It needs a small server as well as the page.
- **A licence** for this repository, if it is ever to be shared more widely.

## How online play is expected to work

Nothing is built yet. The intended shape:

- A small Node.js server keeps one copy of each match and runs the same rules file the game already uses (`src/sim.ts`).
- Friends join a room with a short code.
- Each phone sends only its player's inputs and draws the world the server sends back, which keeps everyone in step.

The rules were written with this in mind from the start: they use no browser features and no randomness of their own, and the same seed with the same inputs always gives the same match.
