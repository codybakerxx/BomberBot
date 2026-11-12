# Roadmap

Where BomberBot is going, what has been decided, and what is still open.

## The plan in seven steps

Each step is played on a phone before the next one starts.

| Step | What | Status |
|---|---|---|
| 1 | **One level.** The arena, movement, bombs, blasts, bricks, power-ups and the touch controls. | Done, and it grew: kicking, lifting and throwing, and Match my thumb (now version 2) were added along the way. |
| 2 | **Computer players.** The other bots move, avoid blasts and fight back, so the game can be played alone. | Built: three levels (Beginner, Normal, Hard). Being play-tested. |
| 3 | **Round flow.** Last one standing wins, blocks fall to shrink the arena as time runs out, and a results screen. | Built: a timer of 1 minute 30, then 50 seconds of falling blocks, then a fight in the square that is left; a scoreboard of rounds won, with a crown for the leader; knock-out and winning animations. Being play-tested. Choosing the round length is still to come. |
| 4 | **Menus.** A proper character select, a choice of round length, a colour picker, level select, and choosing which power-ups are in a custom game. | Planned |
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
| Robots start at 2.55 tiles a second, about 69% of the original speed; each speed power-up adds 0.5 tiles a second, up to six | The game started too fast, so the speed was halved, then tuned in play-testing (+25%, +12.5%, −2.5%). Speed is something you earn by collecting power-ups. The step per power-up began at 0.37, was raised 20% to 0.45, then set to a round 0.5 in play-testing. Nothing but a speed power-up raises a robot's speed; only a curse lowers it, for 8 seconds. |
| 48% of bricks hide a power-up | The first five began at 40% between them and were raised a little in play-testing to 46%, each in the same proportion (bomb and flame 12.5%, speed 9%, boot and glove 6%). The shield and the curse add 1% each. The boot and the glove were then cut from 6% to 4% each, and later to 2.5% each, and the difference given to the bomb, the flame and speed (now 15%, 15%, 11%). How many of each that makes per arena is in GAME-RULES.md. |
| The timer counts down 1 minute 30, in the middle of the top bar | It replaced the strip of collected power-ups, which was removed. Amber for the last 30 seconds, red for the last ten and after. It was 2 minutes at first; shortened in play-testing. |
| When the timer reaches 0:00 blocks start to fall, one at a time, round the edge and inward, for 50 seconds | To force the fight into a small space. At first they fell during the last minute of the timer and stopped at 0:00; that was changed in play-testing so the whole of the timer is played on the whole arena. A block turns its tile solid for good, knocks out a robot under it (a shield does not help) and destroys a bomb or power-up there. Each shows a shadow for 0.63 s first. They were made 20% faster in play-testing: they took a minute, 0.75 s each in the air. The time in the air and the gap between blocks were both shortened by that share. |
| The last robot standing wins even if a block gets it a moment later; robots under the same block draw | Without this, two robots a block apart counted as a draw. |
| The falling blocks leave a 5 by 5 square open in the middle, and the round goes on there until someone wins | The first version closed the whole arena. Everyone left was herded onto the same last tile and went under the same block, so about half of rounds between CPU players were draws. |
| A blast starts 1 tile long each way; each flame power-up adds a tile | It started at 2. Shortened in play-testing so the first flame power-up matters and early bombs are less dangerous. |
| The swipe pad's caption is centred | It was in a corner. |
| On an upright phone a line one block high sits between the top bar and the arena | Room for more information under the top bar. The arena and controls moved down one block: the pad and A lost a block of height, B kept its size. It held the scoreboard at first; that moved up beside the timer, and the line is blank again for information to come. |
| A scoreboard in the top bar: four heads, two each side of the timer, each with its rounds won to its right | The start of proper matches. A win adds one; a draw adds nothing; a place with no player is a grey head. The count lasts until the game is closed. How many rounds make a match will be a setting. It began as a row under the top bar with the numbers under the heads; moved in play-testing so the line below is free. |
| The menu button is three bars, not the word Menu | Chosen by Claude to make room: with the word, there was not space for two heads and their numbers between the timer and the button. |
| The player in the lead wears a crooked crown, on the scoreboard and in the arena | Asked for in play-testing. Nobody has it before the first win. It changes hands only when another player gets ahead; drawing level does not take it (Claude's choice, so there is never a tie to show). |
| After a round has ended for you, closing the menu with ✕ goes back to watching that round | It used to start a new round, so the end could not be watched after opening the menu. New round in the menu starts the next one. |
| A knocked-out robot's ghost floats all the way to the top of the screen and fades as it nears the top | It rose a tile and a half, then three tiles; raised twice in play-testing. It leaves the arena, so it is drawn on a layer of its own over the arena and the top bar. It rises at 4.5 tiles a second and fades over the last two and a half tiles (Claude's numbers). |
| The ghost has angel wings and a halo | Asked for in play-testing. White wings that flap slowly behind it, a gold ring over its helmet. |
| Your colour cannot be changed during a round | Asked for in play-testing. The picker is switched off while a round is in play; between rounds a pick applies from the next round. A round's colours are set in one place (`newWorld`), so the menus to come only have to set the choice. CPU players now keep their colours from round to round. |
| When you are knocked out the round carries on behind a panel that does not cover the arena | So the round always has a winner to give the win to, and so the end can be watched. Next round does not wait. |
| Once the blocks have started and a CPU player is in the square, Normal and Hard press | Between CPU players, a sixth to a half of rounds were still going 2 minutes after the blocks stopped. In the square they now bomb any player in line, use every bomb, drop bombs to take a player's room away, and stop holding back in case a rival shuts their way out. They still never drop a bomb they cannot get clear of. Beginner is unchanged. |
| Knocked out: burnt black with crosses for eyes, crumbling to ash, while a pale ghost rises. Winning: a jump with one arm up, then a dance | Asked for in play-testing. Under a fallen block only the ghost shows. |
| Once a round is decided nothing more happens to the winner, and no more blocks start to fall | So the winner can celebrate. |
| A power-up in the open is 83% of a tile across and bobs slowly over a shadow | They filled the tile and sat still. Made 10% smaller and given a slow hover in play-testing. |
| Two very rare power-ups: a shield and a curse, 1% of bricks each | Each is in about half of arenas (54%), usually alone. The shield takes one blast and wears off after 30 seconds unused. The curse is a penalty: 8 seconds at 85% of the starting speed, whatever speed power-ups the robot has. |
| A shield covers one bomb, not a chain | After it takes a blast there is half a second of safety, enough for that blast to clear. A second bomb set off in a chain outlasts it, so the robot must move. |
| Shield and curse are shown on the robot, not in the top bar | Everyone needs to see who is shielded and who is slowed, not only you. |
| A blast lasts 0.45 seconds | It began at half a second and was shortened a little in play-testing (30 ticks to 27). Burning bricks use the same time. |
| Swipe length is fixed at Medium, with no menu setting | A choice of five levels, then three, was offered. Medium felt right in play-testing, so the choice was removed. |
| The menu has a Standard / My thumb switch, with the side in use tagged On, and the swipe pad shows which is on during play | It was not obvious whether Match my thumb was active. Switching to Standard keeps the match so it can be switched back on. |
| A kicked bomb slides 30% slower than at first (8.4 tiles a second instead of 12) | Asked for together with the slower walking. |
| The menu pauses the round and can be closed with ✕; it has two tabs, Main menu and Controls | Opening the menu used to end the round. Control settings were crowding the main menu. |
| Steering thumb: left (default) or right. The right-thumb layout is mirrored, its standard lean is 15° anticlockwise, and each thumb keeps its own match | So players can steer with whichever thumb they prefer. The two thumbs lean opposite ways, so they cannot share a setting. |
| A bomb is passable only while the robot still counts as standing on its tile | Walking back and forth through a bomb after stepping off it felt wrong. Once on the next tile, it is solid. |
| The robot looks the way it was asked to go, at once, even at a block or while lining up for a turn | Between two blocks it could not be turned to face either, because it looked the way it was walking. A throw goes the way the robot looks, so this decides where a bomb can be thrown. |
| Standing between two blocks, a quick swipe at a block only turns the robot; held for 0.15 seconds it goes round | Without the pause, a quick swipe also walked the robot toward the next opening, often off the tile it was meant to turn on. |
| Kicking needs the boot, lifting needs the glove | They are power-ups to find, not abilities everyone starts with. |
| A lifted bomb has 3 seconds and keeps ticking | The fuse does not pause in your hands. The 3 seconds start at the first lift only, so a bomb cannot be kept alive by lifting it again. |
| CPU players come in three levels, Normal by default, chosen in the menu | There were four at first (Beginner, Normal, Hard, Extreme). Extreme was renamed Hard, the old Hard was dropped, and Normal was eased a little. The levels differ in speed of thought, how soon they notice bombs, how hard they hunt and which tricks they know. |
| No level is careless with its own bombs | Every level checks for a way out, checks that no nearby player can shut it, and plays the move forward on a copy of the world before pressing A. Easy levels are easy because they are slow, not because they blunder. |
| Beginner was eased after play-testing | It was still hard. It now pauses longer, notices bombs later, comes for players less and bombs a player beside it less often. The numbers are in CPU-PLAYERS.md. |
| CPU players get the same inputs as a person and nothing more | They return a direction and the two buttons each tick. That keeps them fair, and lets a server run them for online games. |
| Robots stand on one tile, with a ring on the tile they stand on | So it is clear where the robot is relative to the blocks when hiding from a blast. The first robot was about a tile in size; the present one is taller (below). |
| A new robot, designed by the owner: glossy armour in its colour, black joints and pelvis, fists, big black boots, a rim round the helmet | The owner made reference pictures of a glossy toy robot and settled the design on a large front view over many rounds: no round joints on the knees; three lines across the pelvis (down, flat, up); no thumbs; shoulder pads joined to the chest, a little smaller and lower; a smooth metal finish. Claude worked out the back and side views and the walk from it. |
| A black line under the helmet's light bar | Asked for by the owner: the lit edge between the glass and the chin piece is the helmet's LED light bar, and a black line tracing its curve right under it makes it stand out from the chin piece. In every view. The line was then made half as thick. |
| The light bar's path from the side | Asked for by the owner, from a reference picture of another robot (for the direction of the line only): seen from the side, the light bar and its black line run back under the glass from the front, turn up behind the middle of the head, turn towards the back, then turn up again to the back of the helmet, as if carrying on round it (`SIDE_TRIM` in `src/robot.ts`). At first it was one sweep from the back down to the chin. The first turn (under the glass, then up) was flat along the bottom with a tighter corner at first; the owner asked for it rounder, so it became one wide round sweep; that was a little too much, and it now sits half way between the two. Thickness, head and body are unchanged, and so is the front view. The back view still has its old low curve: the owner expects a rounded line there to match, but has not asked for it yet. |
| The robot is 1.09 tiles tall, so its helmet stands a little over the tile above | The owner's choice, in two steps (next two rows). Claude had first drawn it 1.35 tiles tall, because the new robot is slim and at one tile tall Claude found it hard to read, above all from the side. |
| The robot's head is 10% smaller | Asked for by the owner. The whole helmet is scaled to nine tenths (`HEAD` in `src/robot.ts`): glass, rim, light bar and its black line together, so the design is the same, only smaller. It still rests on the collar where it did, so the body has not moved and the robot is a little shorter. The crown, halo, shield ring and curse mark follow it through `ROBOT`. The heads on the scoreboard keep their size. |
| The whole robot is 15% smaller | Asked for by the owner, after the smaller head. One number (`K` in `src/robot.ts`, 1.08 to 0.918): the robot is 1.09 tiles tall and 0.71 wide, was 1.28 and 0.84. Its shadow, crown, the ghost's wings and halo, the shield ring, the curse mark and a carried bomb all follow it (`ROBOT`, with `ROBOT.scale` for the wings and halo). The robots in the menu's picker and the heads on the scoreboard keep their size. Whether robots this size are easy to pick out on a phone has to be judged by playing. |
| Each robot is drawn once into small pictures (sprites) and those are reused | The new robot takes hundreds of drawing steps, too many to repeat for four robots sixty times a second. The pictures are made a few at a time, ahead of need, so play does not stutter. |
| The soft rounding of each piece is for large artwork only | It would be less than a pixel at playing size. It also relies on a drawing trick that could not be tried on an iPhone from Claude's side, so nothing in the game depends on it. |
| Bricks and solid blocks fill their whole tile | The classic look, drawn fresh. |
| Power-ups are a square of pulsing colour with a dark icon | Easy to see at phone size. |

## Still open

- **CPU players: how they feel.** The levels are measured to be in order and safe with their own bombs. Whether each is the right difficulty for a person has to be play-tested.
- **Rounds that do not end.** Once the blocks stop, the round goes on in the 5 by 5 square until someone wins. Normal and Hard CPU players now press there and settle it. Beginners still may not, and two careful people could circle each other for a long time. If that turns out to matter, something has to force it (a second, slower shrink, say). Not built.
- **Round length as a choice.** The timer is fixed at 1 minute 30. `createWorld` already takes a length; the menu does not offer one yet.
- **How many rounds make a match.** The scoreboard counts wins without end. A setting for it comes with the menus.
- **Seeing what you hold.** The strip of collected power-ups was removed, so nothing shows your bombs, blast length, boot or glove.

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
