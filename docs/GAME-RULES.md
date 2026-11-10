# Game rules

Every rule of play as the game works today, with the numbers. The rules live in one file, [`src/sim.ts`](../src/sim.ts), and each section here names the part of that file it describes.

The game runs at a fixed 60 ticks a second. Times below are given in seconds with the tick count in brackets.

## The arena

*`createWorld` in sim.ts*

- The arena is 15 tiles wide and 13 tall. The outer ring is wall, leaving 13 by 11 to play in.
- **Solid blocks** never break. They are the outer wall plus a pillar on every second tile in both directions. The pillars turn the arena into a grid of lanes.
- **Bricks** can be blasted away. At the start each open tile has a 78% chance of holding a brick.
- Each player's starting tile and the tiles next to it are always left clear, so nobody starts boxed in.
- Up to four players start in the corners, in this order: top-left, bottom-right, top-right, bottom-left. You are always top-left.
- The layout comes from a seed number. The same seed always builds the same arena. The game picks a new random seed for every round.

## Moving

*`movePlayer` in sim.ts. The touch and keyboard side is in [CONTROLS.md](CONTROLS.md).*

- A robot moves up, down, left or right, one direction at a time, and stops the moment no direction is held. It does not finish the step.
- Robots start at 2.55 tiles a second. Each speed power-up adds 0.37 tiles a second, and up to six of them count, which brings a robot to 4.8 tiles a second, 1.88 times its starting speed.
- At the starting speed, the quickest way clear of your own first bomb from a corner (two tiles along, one round the corner) takes 1.23 seconds of the bomb's 2.5.
- The tile a robot **counts as standing on** is the one whose middle it is nearest to. The game draws a ring on yours. That tile decides where your bomb is dropped, whether a blast catches you and which power-up you pick up.
- A robot fills its lane, so it can only go sideways where there is an opening beside it. Bricks and solid blocks block it. So does a bomb, with one exception: a bomb on the tile the robot counts as standing on (the one it just dropped, or one thrown onto it) does not hold it in. It can move about on that tile and walk off. The moment it counts as standing on the next tile, that bomb is solid to it like any other, so there is no walking back through.

### Turning

A turn is often asked for between two openings. What happens then:

1. **Lined up with an opening:** the robot turns straight away.
2. **Running along a lane, and the tile it is standing on has the opening:** it lines up with that opening and turns. If it has already gone past the middle of the tile, this is a small step back of at most half a tile.
3. **Running along a lane, otherwise:** it keeps running the same way and takes the next opening ahead. It never turns round to reach an opening behind it.
4. **Running along a lane with nothing to turn into ahead:** it goes back to the opening just behind it if there is one. If there is none either way, it stops on the next tile.
5. **Standing still between two openings:** it steps to the nearer one that is open, then turns.
6. **Reversing** is always immediate.

Rule 3 is the important one for swipe controls: swiping early for the next turning never sends the robot backwards.

## Bombs

*`placeBomb` and `step` in sim.ts*

- **A** drops a bomb on the tile you are standing on. You start able to have one bomb out at a time.
- A bomb goes off 2.5 seconds (150 ticks) after it is dropped.
- Its blast length is fixed when it is dropped. Picking up a flame afterwards does not lengthen bombs already out.
- You cannot drop a bomb on a tile that already has one, or while you are carrying one.

## Blasts

*`explode` in sim.ts*

- A blast covers the bomb's own tile and runs out in four straight lines. It starts 2 tiles long.
- A **solid block** stops it.
- The **first brick** it meets stops it too. That brick burns for half a second (30 ticks), then turns to floor and shows its power-up if it was hiding one.
- A **power-up lying in the open** is destroyed, and the blast carries on past it.
- **Another bomb** in its path goes off 5 ticks later (a twelfth of a second), which is how chain reactions happen. The same goes for a bomb that slides or lands into a blast that is still burning.
- A blast stays for half a second (30 ticks). It is drawn in the colour of the bot that dropped the bomb.
- A robot is **knocked out** if the tile it is standing on is in a blast. That includes your own.

## Power-ups

*`createWorld` and `applyItem` in sim.ts*

Each brick hides at most one power-up. You pick one up by standing on its tile.

| Power-up | Effect | Chance under each brick | Limit |
|---|---|---|---|
| Bomb | One more bomb out at a time | 11% | 8 bombs |
| Flame | Blast one tile longer | 11% | 8 tiles |
| Speed (») | Walk faster | 8% | 6 pick-ups |
| Boot | Lets you kick bombs | 5% | |
| Glove | Lets you lift and throw bombs | 5% | |
| Nothing | | 60% | |

Every arena has at least one boot and one glove. If the dice give none, one is placed under a brick that would otherwise be empty.

## Kicking

*`movePlayer` and `moveBombs` in sim.ts*

- You need the **boot**. Without it a bomb in your way just blocks you.
- Walk into a bomb from the tile next to it and it slides away in that direction at 8.4 tiles a second. That includes pushing back into a bomb you have only just stepped off.
- It keeps sliding until the next tile is not free, then stops in the middle of the last free tile. A solid block, a brick, another bomb or a robot stops it.
- A bomb with something directly behind it cannot be kicked.
- Its fuse keeps running while it slides.

## Lifting and throwing

*`useAction` and `moveBombs` in sim.ts*

- You need the **glove** to lift.
- **B** lifts a bomb from the tile you are standing on. If there is none there, it takes one from the tile you are facing, and failing that from any tile next to you.
- The first time a bomb is lifted its fuse is set to **3 seconds** (180 ticks), and it keeps counting down in your hands. Lifting the same bomb again later does not reset it.
- While carrying you cannot drop another bomb.
- **B** again throws it the way you are facing. It lands 3 tiles away.
- If the landing tile is a block, a brick or another bomb, it bounces on one tile at a time until it finds free floor. A robot does not stop it landing.
- Thrown off the edge of the arena, it comes back in on the opposite side.
- If the 3 seconds run out **in your hands**, it goes off on your tile and knocks you out. If they run out **in the air**, it goes off the moment it lands.
- If the bot carrying a bomb is knocked out, the bomb drops where it stood.

## Winning

*the end of `step` in sim.ts*

- The round is decided when only one robot is left, or none.
- The result is declared three quarters of a second later (45 ticks). That pause lets a blast that catches the last two together count as a **draw**.
- In today's test arena the three other bots stand still. Knock out all three and the round is won.

## The numbers

All of these are named constants near the top of `src/sim.ts`. Changing one changes the game; the tests in `tests/rules.test.ts` will say if a change breaks a rule.

| Constant | Value | Meaning |
|---|---|---|
| `TICK_HZ` | 60 | Rule steps per second |
| `BASE_SPEED` | 0.04250390625 | Starting walking speed in tiles per tick (2.55 a second) |
| `SPEED_STEP` | 0.0062 | Extra speed per speed power-up (0.37 a second) |
| `MAX_SPEED_ITEMS` | 6 | Most speed power-ups that count |
| `MAX_BOMBS` | 8 | Most bombs out at once |
| `MAX_FIRE` | 8 | Longest blast, in tiles |
| `FUSE_TICKS` | 150 | Fuse of a dropped bomb (2.5 s) |
| `FLAME_TICKS` | 30 | How long a blast and a burning brick last (0.5 s) |
| `CHAIN_TICKS` | 5 | Delay before a bomb caught in a blast goes off |
| `CARRY_FUSE_TICKS` | 180 | Fuse set by the first lift (3 s) |
| `KICK_SPEED` | 0.14 | Sliding speed of a kicked bomb in tiles per tick (8.4 a second) |
| `THROW_TILES` | 3 | How far a throw goes |
| `FLY_TICKS_PER_TILE` | 7 | Time a thrown bomb takes over each tile |
| `BACK_TOLERANCE` | 0.5 | How far past an opening a turn will still step back to it, in tiles |
| `DEATH_TICKS` | 50 | Length of the knocked-out fade |

Starting values for every player are set in `createWorld`: 1 bomb, a blast 2 tiles long, no speed power-ups, no boot, no glove. The arena size (13 by 11) and the brick chance (78%) are defaults there too.

## Not in the game yet

Computer-controlled players, the shrinking arena, teams, playing online, more arenas, and setting bombs off by remote. See [ROADMAP.md](ROADMAP.md).
