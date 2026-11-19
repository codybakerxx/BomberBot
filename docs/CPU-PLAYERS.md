# CPU players

The three other bots in a round are played by the computer. This explains how they think, how the three levels differ, and what has been measured about them. The code is `src/bot.ts`.

- [What they are](#what-they-are)
- [How one thinks](#how-one-thinks)
- [How they avoid their own bombs](#how-they-avoid-their-own-bombs)
- [How they go after players](#how-they-go-after-players)
- [The shield and the curse](#the-shield-and-the-curse)
- [The falling blocks](#the-falling-blocks)
- [The three levels](#the-three-levels)
- [What has been measured](#what-has-been-measured)
- [What is not known yet](#what-is-not-known-yet)
- [Changing them](#changing-them)

## What they are

A CPU player is handed the world and gives back exactly what your controls give: a direction, and whether A and B are pressed, sixty times a second. It moves by the same rules as you, at the same speed, with the same bombs. It cannot see under bricks and has no powers a player lacks.

You choose the level in the menu, under **CPU players**: Beginner, Normal or Hard. Normal is the default. The choice is remembered on the device, and changing it in the middle of a paused round takes effect at once.

## How one thinks

```mermaid
flowchart TD
  A["Work out the danger map:<br>when will each tile be blasted?"] --> B{"Is my own tile<br>going to be blasted?"}
  B -- yes --> C["Flee: take the quickest route to a tile<br>that will not be, timed to miss every blast"]
  B -- no --> D{"A player in my blast line,<br>or one I could trap?"}
  D -- yes --> E["Check the bomb is safe for me"]
  D -- no --> F["Pick a goal and walk there:<br>a power-up, bricks to blast, or a player"]
  F --> G{"Arrived at bricks?"}
  G -- yes --> E
  E -- safe --> H["Press A and leave by the route just checked"]
  E -- not safe --> F
```

**The danger map** is the heart of it. For every tile it holds when a blast will be there and for how long. It is built from every bomb on the floor, and it follows the rules exactly: bricks stop a blast unless an earlier blast will have burnt them away, a bomb caught in a blast goes off early and sets off the next, a kicked bomb is followed to where it will stop, a thrown bomb to where it will land, and a bomb falling from a plane to where it will land (with the same sums as the rules: `dropLanding`).

**Walking** uses that map with timing. A route is only taken if every tile on it is clear while the bot is on it, with a little time to spare. That lets a bot run through a lane that will be blasted later, or wait out a blast and cross after it.

## How they avoid their own bombs

Before any level presses A, three things must all be true. If one fails, it does not drop the bomb.

1. **There is a way out.** With the new bomb added to the danger map, there must be a tile it can reach in time that will not be blasted.
2. **Nobody can shut that way out.** It looks at each player close by who has a bomb to drop. If that player could get onto the escape route before it does, or could cut the route by dropping a bomb where they stand, the route does not count and it tries another. Lower levels only watch players near them; Hard watches everyone.
3. **The move works when played forward.** It copies the whole world, presses A in the copy, walks the escape route with the real rules, and checks it is still alive when the bomb has gone off.

The first version only did steps 1 and 3. Alone, that was enough: no bot ever blasted itself. With four bots in the arena, about one in five went out to its own bomb. Replaying those matches showed the same thing every time: the escape route was fine when the bomb was dropped, and then another player dropped a bomb on it. Step 2 was added for that.

A bot can still be caught by its own bomb when another player traps it after the bomb is down. That is the other player's doing, and it is a tactic Hard uses on purpose.

When a bot is boxed in with no route out, Normal and Hard will kick a bomb out of the way if they have the boot, and Hard will lift one and throw it clear if it has the glove. Each of these is also played forward on a copy first.

## How they go after players

- **Bombing a player in line.** If a player is in its blast line and close enough, it drops a bomb (after the safety checks). How close, and how often it takes the chance, depends on the level.
- **Hunting.** Spots it could bomb a player from are goals, alongside power-ups and bricks. Higher levels weigh them more, so they come looking for you sooner.
- **Traps (Hard).** It works out whether one bomb would leave a player no way out at all, always takes that shot, and looks for nearby spots where it would be true.
- **Kicking bombs at players (Hard).** With the boot, a bomb lying next to it with a player further down the lane gets kicked at them.
- **Not being trapped (Hard).** If a nearby player could box it in with one bomb, it moves somewhere that is not true before doing anything else.

## The shield and the curse

- **Every level wants a shield** and will walk to one, about as keenly as to any other power-up.
- **Holding a shield changes nothing about how careful they are.** They dodge blasts and check their bombs exactly as before. The shield is there for the blast they did not see coming.
- **Once a shield has taken a blast**, they know blasts do no harm for the next half second and use it to walk out through the flames. Before that was added, a bot stood still in a chain reaction and was caught by the second bomb.
- **No level goes looking for a curse.** Normal and Hard also treat one lying on the floor as something to walk round, when there is another way. If the only way to anything worth doing is through it, or the only way out of a blast, they go through. Beginner does not look.
- Hard does not count a curse as a power-up worth sparing when it blasts bricks.

## The falling blocks

When the timer reaches 0:00 blocks fall round the edge and inward for 50 seconds (see [GAME-RULES.md](GAME-RULES.md)). The order is fixed and the same every round, so a person can learn it, and the CPU players know it.

- **A tile a block will land on is treated like a blast that never ends.** It goes into the danger map from just before the block lands. Each level looks a different distance ahead (`blockSight`): Beginner only as far as the blocks it can see falling, Hard eight seconds.
- **A block about to land sends it running**, as a blast does (within about a second and a half).
- **A block further off is a reason to move on, not to run.** It heads for the nearest tile that will last longer, but it can still stop to bomb a player on the way. That keeps them fighting while the arena closes.
- **A blast comes before a block.** Getting clear of a bomb, a tile only has to outlast the blast, even if a block is due on it a few seconds later.
- **The 7 by 5 in the middle is never covered** (it was a 5 by 5 square until 18 November 2026; "the square" below means this area), so there is always somewhere that counts as safe, and they end up in it.
- Hard will step out to bomb a spot that shuts other players into a dead end of the closing arena, if it can still get clear itself.

Beginner has one weakness left in on purpose. Because it only steps aside from the block that is falling, it can back itself into a corner that the ring then closes.

## Pressing in the square

Careful players in the open area (a 5 by 5 square when this was written, 7 by 5 since) can circle each other for minutes. So once the timer has run out and a Normal or Hard CPU player is standing in the square, it presses (`squareBold` in `LEVELS`, `emboldened` and `inSquare` in `src/bot.ts`). While it is there:

- it bombs any player in line, every chance it gets, from any distance;
- it uses every bomb it holds;
- it is pulled toward players much harder, and does not pause before setting off;
- it drops bombs beside players as well as in line with them, to take away the room they have to stand in (within `SQUEEZE_REACH`, 4 steps);
- it stops holding back in case a rival shuts its way out (`guard` is switched off).

What does not change: it still needs a way out before it presses A, and it still plays the move forward on a copy of the world first. So it does not walk into its own blast, but it can now be shut in by a rival's bomb, which is the risk that ends rounds.

It applies only while the bot itself is inside the square after 0:00. A bot still on its way in plays as it did. Beginner never presses.

## As zombies

Out of lives with Zombie picked, a CPU player is a zombie in the arena, with one 1-tile bomb and half the starting speed. It plays as usual with that (the same safety rules for its bombs), goes after the robots still in the round and not other zombies, and leaves power-ups alone (`itemWorth` is 0). In 15 rounds of four Normal CPU players, the zombies dropped 75 bombs between them; they rarely catch anyone, which is what a 1-tile blast at that speed gives.

## With a laptop

The laptop (see [GAME-RULES.md](GAME-RULES.md), Laptop) is worth about as much to them as a boot or a glove they have not got, so they go for one (`itemWorth`).

**Taking off.** Holding a laptop, not carrying a bomb, with nothing heading for its tile and no rival within 3 tiles (one who could walk up while its robot stands still), a CPU player flies, each time it thinks, at its level's chance (`fly`: Beginner 15%, Normal 45%, Hard 90%).

**Flying** (`pilot`). It goes for the rival nearest the plane and steers straight for where it reckons that rival will be when a bomb lands: as far ahead as the rival will have walked by then, times its level's `lead` (Beginner aims where the rival is), give or take `slop` tiles each way. It lets a bomb go when it judges, by eye, that the bomb would land right there, its feel for how far a falling bomb carries on off by up to `carry` of the real distance either way. Both errors are picked once a flight (and again if it changes target), as a person misjudging would be: a flight that misjudges keeps missing. It never lets a bomb go that the rules' own sums say would reach its own robot or a teammate, or set off something that would (the danger map with the bomb added must be no worse on its own tile). If a blast heads for its robot it lands the plane at once and runs.

**Seeing other players' falling bombs.** Another player's falling bomb is noticed as soon, for the 0.8 s it falls, as a bomb on the floor is for its 2.55 s fuse (`notice`): Beginner after 22 ticks of the 48, Normal after 7, Hard at once. So a Beginner sees one coming only late, and a Hard one in time to step aside.

**How often a flight gets someone** (`experiments/pilot.ts`, 60 arenas each, 18 November 2026; the share of flights that knocked the target out):

| Pilot | A robot that never looks up and walks to the next wall (no bricks) | One that also turns at random every half second (no bricks) | A Normal CPU player, which dodges what it notices (some bricks) |
|---|---|---|---|
| Beginner | 46% | 30% | 16% |
| Normal | 62% | 50% | 22% |
| Hard | 83% | 58% | 24% |

Against someone who keeps an eye on the sky, a flight mostly misses; against someone who never looks up, a Hard pilot mostly does not. Three bombs with a blast of a tile each way give luck a fair share, so even Beginner's wild aim gets a careless player about half the time. How it feels to be bombed by one, and whether Hard is too good at it, has to be played: the four numbers in each level's line are the ones to turn.

## As angels

Out of lives with Angels on, a CPU player is an angel on the wall (`angelInput` in bot.ts). It picks the robot nearest to it, goes round the wall to the closest place in line with that robot that a throw can reach (2 to 6 tiles in: over its column from the top or bottom, or by its row from a side), holds A for exactly that distance and lets go. It aims where the robot is, not where it is going. Between throws it rests, by level (`ANGEL_REST`): Beginner 150 ticks, Normal 70, Hard 25. Its own robot's knockout makes it forget its plan, so a robot coming back after a lost life starts thinking afresh.

## The three levels

All of these are in the `LEVELS` table at the top of `src/bot.ts`. Times are in ticks: 60 ticks are one second.

| | Beginner | Normal | Hard |
|---|---|---|---|
| Thinks every (`think`) | 30 ticks | 16 | 4 |
| Pause before setting off (`hesitate`) | 40 to 110 ticks | 6 to 26 | none |
| Notices another player's bomb after (`notice`) | 70 ticks | 22 | at once |
| Time kept spare when dodging (`margin`) | 14 ticks | 9 | 4 |
| Bombs out at once (`maxBombs`) | 1 | 2 | all it has |
| Pull toward players (`hunt`) | 0.12 | 0.55 | 1.6 |
| Bombs a player in line (`attack`) | 20% of chances | 50% | always |
| From how far (`attackReach`) | 2 tiles | 4 | 8 |
| Sets traps (`killShot`) | no | no | yes |
| Watches for players who could shut it in (`guard`) | within 3 tiles | 5 | whole arena |
| Kicks a bomb to escape (`kickEscape`) | no | yes | yes |
| Kicks bombs at players (`kickAttack`) | no | no | yes |
| Throws a bomb to escape (`throwEscape`) | no | no | yes |
| Moves out of spots it could be trapped in (`evade`) | no | no | yes |
| Leaves power-ups unburnt (`spareItems`) | no | no | yes |
| Walks round a curse (`dodgeCurse`) | no | yes | yes |
| Knows where blocks will fall (`blockSight`) | 0.9 s ahead | 2.5 s | 8 s |
| Presses in the square after 0:00 (`squareBold`) | no | yes | yes |
| Randomness in choosing goals (`wobble`) | 0.6 | 0.3 | 0.05 |
| Flies a laptop's plane when it can (`fly`) | 15% of chances | 45% | 90% |
| Aims ahead of a moving rival (`lead`) | not at all | 40% of the way | all the way |
| Aim off by up to (`slop`), once a flight | 3 tiles each way | 2 | 0.8 |
| Misjudges how far a falling bomb carries (`carry`), once a flight | by up to 90% | 85% | 60% |

In short:

- **Beginner** is slow to react, carries one bomb, and mostly digs for power-ups. It will sometimes bomb you if you stand next to it, and it will blunder over a curse lying in its way.
- **Normal** collects power-ups and comes after you once it can reach you.
- **Hard** reacts at once, hunts you, sets traps, uses the boot and the glove, and will not let itself be cornered.

There were four levels at first. On 11 November 2026 they were cut to three after play-testing: what was called Extreme is now Hard, the old Hard (which sat between the two) was dropped, and Normal was eased a little (it thinks every 16 ticks instead of 14, pauses 6 to 26 ticks before setting off instead of 0 to 14, notices bombs after 22 ticks instead of 16, `hunt` 0.55 from 0.7, `attack` 50% from 60%). Beginner was not changed. A phone that had Extreme saved now gets Hard.

No level cheats, and no level is made easier by being careless with its own bombs. The easy levels are easy because they are slow and unambitious.

## What has been measured

`experiments/cpu-matches.ts` plays whole rounds with no screen and counts how each bot went out. These are the real CPU players under the real rules: three levels, a blast that starts one tile long, the timer, the falling blocks that start when it reaches 0:00, the square they leave open, and Normal and Hard pressing once they are in it. Recorded again on 18 November 2026, after the area the blocks leave open was made 7 by 5 (it was a 5 by 5 square) and the fuse made 2.55 s (it was 2.5); the first recording was on 11 November 2026, after the timer was shortened to 1 minute 30 and the blocks made 20% faster. Where the 18 November figures differ much from the 11 November ones, the notes say so.

A round has no end of its own: the timer runs 1 minute 30, the blocks take 50 seconds to fall, and then it goes on in the square until someone wins. These runs give up 2 minutes after the blocks stop (4 minutes 20 in) and count the round as **not decided**.

**Four of the same level** (60 rounds, so 240 bots per level):

| Level | Blasted itself | Shut in by a rival | Caught in a rival's blast | Under a block, early | Under a block, in the last 15 s of them | Won | Rounds drawn | Not decided | Decided after |
|---|---|---|---|---|---|---|---|---|---|
| Beginner | 0.0% | 0.8% | 60.4% | 1.3% | 6.3% | 19.2% | 0 of 60 | 14 of 60 | 180 s |
| Normal | 0.0% | 23.3% | 39.6% | 0.8% | 11.7% | 24.6% | 1 of 60 | 0 of 60 | 146 s |
| Hard | 0.0% | 29.2% | 43.3% | 0.4% | 2.1% | 21.7% | 4 of 60 | 4 of 60 | 161 s |

- "Shut in by a rival" and "blasted itself" are both a bot caught by its own blast. The script calls it "shut in by a rival" when, within six steps of where the bot stood, there was a tile its own bombs would not have reached that was blocked or about to be blasted by a bomb a rival dropped *after* the bomb that caught it. It looks at the arena as it was when that bomb was dropped, so a tile a block has landed on since still counts as a way out it had. A rival's bomb dropped on the very same tick counts too, and so does one a rival threw or kicked that came to rest on the way out afterwards, a rival's bomb let go from a plane (from the moment it was let go), and a rival's bomb a falling block took away after the bot dropped its own. It is also "shut in by a rival" when the bot's own bomb went off early because a rival's bomb (one from a plane too) set it off, and that rival's bomb was dropped, kicked, thrown or let go after the bot dropped its own, including when the bot's shield took a first blast and its own bomb's blast caught it half a second later. Anything else is "blasted itself".
- With the laptop in every arena (18 November 2026) the columns moved little: the CPU players fly it now and then, and a plane's bombs add to what catches them.
- Before Normal and Hard pressed in the square, Normal left 32 of 60 rounds not decided and Hard 9. Now it is none and 2. The price shows in "shut in by a rival": Normal went from 3.8% to about 20%, Hard from 27.5% to about 34%. That is the risk they now take on purpose. Beginner does not press, and its 20 of 60 is the old figure give or take (it was 15).
- "Decided after" is the average length of the rounds that were decided. The blocks stop at 140 s, so most are settled in the square.
- With the shorter timer and faster blocks, rounds are settled about 35 seconds sooner than before, and the other columns moved little. One thing did move: four Hards drew 9 rounds of 60 (it was 2). Why was not looked into; with the 7 by 5 it is back to 2.
- With the 7 by 5 and the 2.55 s fuse (18 November 2026): about where it was. Four Beginners left 12 of 60 not decided with the 7 by 5 alone and 17 with the longer fuse too (20 before either): noise, mostly. Four Hards draw 2 of 60 again.

**One of each level in the same round** (three players, 180 rounds, each level in each of three corners equally often):

| Level | Won | Blasted | Under a block, early | Blasted itself | Rivals it blasted |
|---|---|---|---|---|---|
| Beginner | 1.1% | 80.0% | 6.7% | 0.0% | 3 |
| Normal | 33.3% | 55.6% | 0.6% | 0.0% | 76 |
| Hard | 60.0% | 36.1% | 0.0% | 0.0% | 164 |

7 of 180 drawn, 3 left undecided (before the laptop: 4 and 5; with the 5 by 5 and the 2.5 s fuse: 5 drawn, 2 undecided) (it was 27 before they pressed in the square). The levels are well apart: each wins far more and blasts far more rivals than the one below.

**Three of one level against a slow, careless player** (a Beginner CPU player standing in for a person, 80 rounds):

| Three of | Blasted the player | Average time | A block got the player | The player won | Not decided | CPU players that blasted themselves |
|---|---|---|---|---|---|---|
| Beginner | 55 of 80 | 116 s | 3 of 80 | 16 of 80 | 18 of 80 | 0 |
| Normal | 58 of 80 | 113 s | 19 of 80 | 1 of 80 | 2 of 80 | 0 |
| Hard | 67 of 80 | 78 s | 11 of 80 | 1 of 80 | 5 of 80 | 0 (1 with the 7 by 5 and the 2.5 s fuse, replayed: a rival's doing, see below) |

This table is noisy, and the stand-in is not a person. Read it loosely.

**Alone until 10 seconds after the blocks stop, in an arena of bricks** (40 arenas). Does it get into the square before the blocks stop?

| Level | Blasted itself | Caught by a block | In the square at the end |
|---|---|---|---|
| Beginner | 0 of 40 | 1 of 40 | 39 of 40 |
| Normal | 0 of 40 | 0 of 40 | 40 of 40 |
| Hard | 0 of 40 | 0 of 40 | 40 of 40 |

(With the laptop, 18 November 2026; the arenas differ, as every arena now hides a laptop. Before it: Beginner 4, Normal 1, Hard 1 caught.) The Normal and Hard caught in the run before the laptop (with the 2.55 s fuse; 0 of 40 just before it) were replayed: each was standing still on a tile of the edge rings, shut in a pocket of bricks with no safe way to bomb out (the known gap, below), when a block landed on it. Over 120 arenas the old and new fuse give the same: Normal and Hard 1 of 120 each, Beginner 5 and 7 of 120. The 40 arenas here simply took in those cases this time.

**Alone with a player who stands still, no timer** (40 arenas, 3 minutes each). This one is run without the timer, because otherwise the blocks would get the still player and it would look like a win:

| Level | Blasted itself | Got the other player | Average time |
|---|---|---|---|
| Beginner | 0 of 40 | 21 of 40 | 132 s |
| Normal | 0 of 40 | 40 of 40 | 99 s |
| Hard | 0 of 40 | 40 of 40 | 73 s |

Most of that time is spent digging through bricks from one corner to the other. With the laptop (18 November 2026; before it: 12 of 40 in 156 s, 133 s, 113 s) it is quicker: a CPU player that finds the laptop can fly over the bricks to a player who stands still. It takes longer than it did, because a blast now starts one tile long. Beginner's figures moved since the last run (11 of 40, then 17) although Beginner was not changed: the arenas are different, because the power-up chances have changed (this run has no timer, so the 7 by 5 plays no part in it).

### What the replays have caught

The "blasted itself" column is only worth anything because every case that lands in it is replayed. So far:

- **The first version** checked only that a bomb left a way out. With four bots in the arena about one in five went out to its own bomb, each time because a rival then bombed the way out. That is what `guard` was added for.
- **The narrow test.** The first test for "shut in by a rival" (a rival's bomb on or next to the bot's tile) left four cases under "blasted itself". All four were a rival's later bomb, further off. The test was widened.
- **The shield.** One Hard bot stood still in a chain reaction after its shield took the first blast, and the second bomb's blast outlasted the half second of safety. They now walk out.
- **The falling blocks.** One bot of the top level dropped a bomb with a way out, then refused to use it: a block was due on the safe tile five seconds later, and it counted that as no better than the blast. It stood in its own blast. A blast now comes first. One Hard bot in the last seven seconds was caught between its own bomb, a rival's bombs and a block that had just landed on its way out; the test now sees the arena as it was when the bomb was dropped.
- **Pressing in the square.** The first run with it put three bots under "blasted itself". Replayed, all three were a rival's doing: a rival dropped a bomb on the way out on the same tick the bot dropped its own, or threw one that landed on the way out afterwards. The test only counted bombs dropped later, on the tile they were dropped on. It now counts those cases too.
- **Set off early.** The first run with the shorter timer put two Normal bots under "blasted itself" in the run against the stand-in. Replayed, both were the same thing: the bot dropped a bomb with a way out and was walking it; a rival then kicked a bomb of its own into a blast that was still burning, which set that bomb off two seconds early; its blast reached the bot's bomb and set that off too, with the bot still in line. Nothing on the board when it pressed A said that would happen. The test now counts a bot's bomb set off early by a rival's bomb that was dropped, kicked or thrown afterwards.
- **Beginner was made easier on 10 November 2026** after play-testing found it still hard: it pauses longer before setting off (40 to 110 ticks, was 20 to 60), notices other players' bombs later (70 ticks, was 45), is drawn to players less (`hunt` 0.12, was 0.3) and bombs a player beside it less often (20% of chances, was 40%).

- **The 7 by 5 (18 November 2026).** The run against the stand-in put one Hard bot under "blasted itself" (seed 21, the stand-in in seat 1, player 3, 140 s in, as the blocks stopped). Replayed, it was a rival's doing that the script cannot see: a rival Hard with the glove lifted two of its bombs, one after the other, and threw them; they were still in the air when it dropped its next bomb, and they came down either side of it in the 7 by 5. When its last bomb went off, their flames were still burning across both of its ways out. The script misses it because the bombs that shut it in were its own (only thrown by the rival) and had already gone off, leaving flames, when it went out. Not a fault of the bot's own: left as it is, with this note.
- **Beginner alone among bricks (tests/bot.test.ts, 18 November 2026).** With the 7 by 5, the alone test's Beginner in the brick arena ran from its own bomb onto the third ring as it closed and a block landed on it. That is its short sight for blocks (under a second) by design; the test now allows a block, never its own blast, for Beginner only. The `alone` run's figures are unchanged (1 of 40 caught by a block).

- **The square fight test (tests/bot.test.ts, 18 November 2026).** With the 2.55 s fuse, the one arena where two Normals had to settle the fight in the square within 90 s stalled instead (it took 27 s with the 2.5 s fuse). Over 40 arenas the share settled within 90 s was the same with either fuse (22 and 21 of 40; 22 with the old 5 by 5 too): two Normals in the open area settle about half their fights within 90 s, and a few never. The test now plays 24 arenas and asks for at least 8 (Normal) and 18 (Hard) of them.

- **The laptop (18 November 2026).** The first run with it put three bots under "blasted itself" (four Normals, seed 4, player 1; one of each level, seed 54, the Hard in seat 0, and seed 197, the Normal in seat 2). Replayed, all three were a rival's doing that the script could not see. Seed 54: a rival's bomb let go from a plane, after the Hard had dropped its own, was coming down on its way out; it stood still, shut in, and its own blast caught it a moment before the plane's bomb landed. Seed 197: a rival's plane bomb landed right on the Normal's own bomb with the Normal standing on it; its shield took that blast, and its own bomb, set off by the plane's, burned on past the half second of safety. Seed 4 (late in the falling blocks): a rival dropped a bomb whose blast covered both its ways out, then a falling block took that bomb away; by then the blocks were coming up the same column. The script now counts a rival's bomb from a plane like one dropped when it was let go, a rival's bomb a block took away like one still there, and its own bomb set off early by a rival even when the bot's shield made it go out a moment later. All three now read "shut in by a rival", and the column is back at zero.

One weakness the replays showed and that is still there: a CPU player with no safe route left stands still. Trying anyway would sometimes save it, and that is not built.

## What is not known yet

- **How they feel to play against.** The numbers say they are safe and that the levels are in order. Whether Beginner is easy enough, or Hard too mean, for a person on a phone has to be found by playing.
- **Whether the square now feels like a fight.** Between Normal or Hard CPU players the stall is gone in these runs. Against a person it has not been played: pressing may feel fair, or it may feel like being rushed the moment the timer runs out. `emboldened` in `src/bot.ts` holds the numbers to turn down if so.
- **Beginner still stalls.** About a third of rounds between four Beginners, and between three Beginners and the stand-in, were still going 2 minutes after the blocks stopped. That was asked for (Beginner does not press), and against a person it is the person who has to finish it.
- **The stand-in player is not a person.** A Beginner CPU player never walks into a blast it has noticed. People do.

## Changing them

- To make a level harder or easier, change its line in `LEVELS`. `hunt`, `attack` and `attackReach` are the ones that change how often it comes for you; `think` and `notice` change how sharp it is. For the laptop's plane: `fly` (how often it takes off), `lead`, `slop` and `carry` (how well it aims); run `npx tsx experiments/pilot.ts` after changing them.
- After any change run `npm test`, then `npx tsx experiments/cpu-matches.ts` (about fifteen minutes), and the same with `solo`, `versus` and `alone`. The "blasted itself" columns should stay at zero, and anything that lands in them should be replayed before it is believed.
- `src/bot.ts` follows the same rules as `src/sim.ts`: no browser features, no `Math.random`, no clocks. Its randomness comes from a seeded generator kept in each bot, so the same seed gives the same match, and a server will be able to run CPU players for online games.
- The checks are in `tests/bot.test.ts`.
