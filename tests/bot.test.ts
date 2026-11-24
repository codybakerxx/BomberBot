/**
 * Checks of the CPU players (src/bot.ts): what they know about blasts, that
 * they never drop a bomb they cannot get away from, that every level survives
 * and goes after other players, and that they are repeatable.
 *
 * No browser is involved. Run with: npm test
 */
import assert from 'node:assert';
import { createWorld, cloneWorld, step, World, PlayerInput, FLOOR, SOFT, HARD, FUSE_TICKS, FLAME_TICKS, CHAIN_TICKS, TICK_HZ, ROUND_TICKS, SHRINK_TICKS, blockLandTick, keptOpen } from '../src/sim';
import { BOT_LEVELS, LEVELS, BotLevel, createBot, botInput, dangerMap, hasDanger, previewBomb, blockLandsIn } from '../src/bot';

const none: PlayerInput = { dir: 0, a: false, b: false };
const pressA: PlayerInput = { dir: 0, a: true, b: false };
/** an arena with no bricks unless a density is given: player 0 top-left (1,1), player 1 bottom-right (13,11) */
const mk = (density = 0, seed = 7): World =>
  createWorld({ roundTicks: 0, seed, players: [{ colorId: 'gold' }, { colorId: 'blue' }], softDensity: density });
const at = (w: World, x: number, y: number): number => y * w.w + x;
/** everything about a world that matters, as text, for comparing two worlds */
const snapshot = (w: World): string => JSON.stringify({ ...w, tiles: [...w.tiles], hidden: [...w.hidden], events: [] });

// 1. the danger map covers exactly what a bomb will blast, and when
{
  const w = mk();
  step(w, [pressA]);
  const D = dangerMap(w, null, 0);
  for (const [x, y] of [[1, 1], [2, 1], [1, 2]]) assert.ok(hasDanger(D, at(w, x, y)), `blast reaches ${x},${y}`);
  assert.ok(!hasDanger(D, at(w, 3, 1)) && !hasDanger(D, at(w, 1, 3)), 'a starting bomb reaches one tile, not two');
  assert.ok(!hasDanger(D, at(w, 3, 3)), 'not round corners');
  const [from, to] = D.iv[at(w, 2, 1)]!;
  assert.equal(from, w.bombs[0].fuse, 'the blast starts when the fuse runs out');
  assert.equal(to - from, FLAME_TICKS, 'and lasts as long as flames do');

  // what-if bombs are included without being dropped
  const D2 = dangerMap(mk(), null, 0, [{ cx: 5, cy: 5, range: 2, fuse: FUSE_TICKS }]);
  assert.ok(hasDanger(D2, at(w, 5, 7)) && hasDanger(D2, at(w, 7, 5)) && !hasDanger(D2, at(w, 5, 8)));
}

// 2. chain reactions: a bomb in another bomb's blast goes off early, and the map knows
{
  const w = mk();
  step(w, [pressA]);
  for (let i = 0; i < 40; i++) step(w, [none]);
  const first = w.bombs[0];
  w.bombs.push({ ...first, id: 99, x: 2, y: 1, cx: 2, cy: 1, fuse: FUSE_TICKS, age: 0 }); // next to the first, in its one-tile blast
  const D = dangerMap(w, null, 0);
  // (3,1) is only in reach of the second bomb, which the first sets off
  assert.equal(D.iv[at(w, 3, 1)]![0], first.fuse + CHAIN_TICKS);
  // and that is what really happens
  const expected = first.fuse + CHAIN_TICKS;
  let seen = -1;
  for (let t = 1; t <= FUSE_TICKS && seen < 0; t++) {
    step(w, [none, none]);
    if (w.flames.some((f) => f.cx === 3 && f.cy === 1)) seen = t;
  }
  assert.ok(Math.abs(seen - expected) <= 1, `flames reached 3,1 at ${seen}, predicted ${expected}`);
}

// 3. bricks stop a blast, and the preview counts the bricks a bomb would break
{
  const w = mk();
  w.tiles[at(w, 3, 1)] = SOFT;
  const pv = previewBomb(w, 1, 1, 4);
  assert.equal(pv.bricks, 1);
  assert.ok(pv.tiles.includes(at(w, 2, 1)) && !pv.tiles.includes(at(w, 4, 1)), 'the blast stops at the brick');
}

// 4. slow levels notice another player's bomb late; nobody is slow about their own
{
  const w = mk();
  w.players[1].x = 2; // next to player 0, whose tile its one-tile blast will reach
  w.players[1].y = 1;
  step(w, [none, pressA]);
  const me = w.players[0];
  assert.ok(!hasDanger(dangerMap(w, me, LEVELS.beginner.notice), at(w, 1, 1)), 'Beginner has not noticed yet');
  assert.ok(hasDanger(dangerMap(w, me, LEVELS.hard.notice), at(w, 1, 1)), 'Hard sees it at once');
  assert.ok(hasDanger(dangerMap(w, w.players[1], LEVELS.beginner.notice), at(w, 2, 1)), 'its own bomb is never a surprise');
  for (let i = 0; i < LEVELS.beginner.notice; i++) step(w, [none, none]);
  assert.ok(hasDanger(dangerMap(w, me, LEVELS.beginner.notice), at(w, 1, 1)), 'Beginner notices in the end');
}

// 5. asking a CPU player what it would do never changes the world
{
  const w = createWorld({ roundTicks: 0, seed: 3, players: [0, 1, 2, 3].map((i) => ({ colorId: String(i) })) });
  const bots = [0, 1, 2, 3].map((i) => createBot(i, 'hard', 5));
  for (let t = 0; t < 900; t++) {
    const before = snapshot(w);
    const inputs = bots.map((b) => botInput(w, b));
    assert.equal(snapshot(w), before, `tick ${t}: thinking left the world as it was`);
    step(w, inputs);
  }
}

// 6. no way out, no bomb: boxed into two tiles with a brick to tempt it, no level presses A
for (const level of BOT_LEVELS) {
  const w = mk();
  w.tiles[at(w, 1, 2)] = HARD;
  w.tiles[at(w, 3, 1)] = SOFT;
  const bot = createBot(0, level, 11);
  for (let t = 0; t < 10 * TICK_HZ; t++) {
    const inp = botInput(w, bot);
    assert.ok(!inp.a, `${level} must not bomb where it cannot get clear`);
    step(w, [inp]);
  }
  assert.ok(w.players[0].alive);
}

// 7. with a way out it does bomb the brick, gets clear and lives
for (const level of BOT_LEVELS) {
  const w = mk();
  w.tiles[at(w, 3, 1)] = SOFT;
  const bot = createBot(0, level, 11);
  for (let t = 0; t < 20 * TICK_HZ && w.tiles[at(w, 3, 1)] === SOFT; t++) step(w, [botInput(w, bot)]);
  assert.equal(w.tiles[at(w, 3, 1)], FLOOR, `${level} broke the brick`);
  for (let t = 0; t < 2 * TICK_HZ; t++) step(w, [botInput(w, bot)]);
  assert.ok(w.players[0].alive, `${level} got clear of its own bomb`);
}

/** Play player 0 at `level` against a player who stands still. Returns the world at the end. */
function solo(level: BotLevel, seed: number, density: number | undefined, seconds: number): World {
  const w = createWorld({ roundTicks: 0, seed, players: [{ colorId: 'gold' }, { colorId: 'blue' }], softDensity: density });
  const bot = createBot(0, level, seed * 31 + 7);
  for (let t = 0; t < seconds * TICK_HZ && !w.over; t++) step(w, [botInput(w, bot)]);
  return w;
}

// 8. every level, in a full arena of bricks for two minutes: it never blasts itself
for (const level of BOT_LEVELS) {
  for (let seed = 1; seed <= 4; seed++) {
    const w = solo(level, seed, undefined, 120);
    assert.ok(w.players[0].alive, `${level}, arena ${seed}: still in`);
  }
}

// 9. every level goes after other players: in an open arena it finds a player who stands still and wins
for (const level of BOT_LEVELS) {
  for (let seed = 1; seed <= 3; seed++) {
    const w = solo(level, seed, 0, 120);
    assert.deepEqual(w.over, { winner: 0 }, `${level}, open arena ${seed}: got the other player`);
  }
}

// 10. the same seed gives the same match, CPU players included
{
  const play = (): string => {
    const w = createWorld({ roundTicks: 0, seed: 9, players: [0, 1, 2, 3].map((i) => ({ colorId: String(i) })) });
    const bots = BOT_LEVELS.map((lv, i) => createBot(i, lv, 9));
    for (let t = 0; t < 40 * TICK_HZ; t++) step(w, bots.map((b) => botInput(w, b)));
    return snapshot(w);
  };
  assert.equal(play(), play());
}

// 11. four CPU players of each level together: any that goes out early is put out by someone else's bomb
// (the first 20 seconds, before paths cross, is when a careless bot would blast itself)
for (const level of BOT_LEVELS) {
  const w = createWorld({ roundTicks: 0, seed: 4, players: [0, 1, 2, 3].map((i) => ({ colorId: String(i) })) });
  const bots = [0, 1, 2, 3].map((i) => createBot(i, level, 4));
  for (let t = 0; t < 20 * TICK_HZ; t++) {
    step(w, bots.map((b) => botInput(w, b)));
    // (Hard comes for the others from the start since 23 November 2026, so one may well be out by now: by a rival)
    for (const e of w.events) if (e.type === 'death') assert.notEqual(e.by, e.player, `${level}: player ${e.player} blasted itself at ${(t / TICK_HZ).toFixed(1)} s`);
  }
  if (level !== 'hard') assert.ok(w.players.every((p) => p.alive), `${level}: all four still in after 20 seconds`);
}

// 12. a cloned world is a separate world
{
  const w = mk(0.5, 2);
  step(w, [pressA]);
  const c = cloneWorld(w);
  assert.equal(snapshot(c), snapshot(w));
  for (let i = 0; i < FUSE_TICKS + 5; i++) step(c, [none]);
  assert.equal(w.bombs.length, 1, 'stepping the copy leaves the original alone');
  assert.equal(c.bombs.length, 0);
}

// 13. the curse: no level goes looking for one, and Normal and above walk round it
{
  // a speed power-up along the top row with a curse lying between it and the bot; the long way round is open
  for (const level of ['normal', 'hard'] as BotLevel[]) {
    const w = mk();
    w.items.push({ cx: 3, cy: 1, kind: 'curse', age: 9 }, { cx: 5, cy: 1, kind: 'speed', age: 9 });
    const bot = createBot(0, level, 11);
    for (let t = 0; t < 12 * TICK_HZ && w.players[0].speed === 0; t++) step(w, [botInput(w, bot)]);
    assert.equal(w.players[0].speed, 1, `${level} fetched the speed power-up`);
    assert.equal(w.players[0].curseTicks, 0, `${level} went round the curse to get it`);
    assert.ok(w.items.some((it) => it.kind === 'curse'), 'and the curse is still lying there');
  }
  // shut into its corner by two curses with a player to go after: it goes through one rather than sit there for ever
  for (const level of ['normal', 'hard'] as BotLevel[]) {
    const w = mk();
    w.items.push({ cx: 2, cy: 1, kind: 'curse', age: 9 }, { cx: 1, cy: 2, kind: 'curse', age: 9 });
    const bot = createBot(0, level, 11);
    for (let t = 0; t < 120 * TICK_HZ && !w.over; t++) step(w, [botInput(w, bot)]);
    assert.deepEqual(w.over, { winner: 0 }, `${level} came out and got the other player`);
  }
  // nothing else to do, and a curse lying near: nobody walks over to it
  for (const level of BOT_LEVELS) {
    const w = createWorld({ roundTicks: 0, seed: 7, players: [{ colorId: 'gold' }], softDensity: 0 });
    w.items.push({ cx: 3, cy: 1, kind: 'curse', age: 9 });
    const bot = createBot(0, level, 11);
    for (let t = 0; t < 15 * TICK_HZ; t++) step(w, [botInput(w, bot)]);
    assert.equal(w.players[0].curseTicks, 0, `${level} left the curse alone`);
  }
}

// 14. the shield: every level wants one
for (const level of BOT_LEVELS) {
  const w = createWorld({ roundTicks: 0, seed: 7, players: [{ colorId: 'gold' }], softDensity: 0 });
  w.items.push({ cx: 3, cy: 1, kind: 'shield', age: 9 });
  const bot = createBot(0, level, 11);
  for (let t = 0; t < 10 * TICK_HZ && w.players[0].shieldTicks === 0; t++) step(w, [botInput(w, bot)]);
  assert.ok(w.players[0].shieldTicks > 0, `${level} picked up the shield`);
}

// 15. a shield has just taken a blast: the bot walks out through the flames instead of standing in them
// (two bombs in a chain, so the second blast outlasts the half second of safety)
for (const level of ['normal', 'hard'] as BotLevel[]) {
  const w = createWorld({ roundTicks: 0, seed: 7, players: [{ colorId: 'gold' }, { colorId: 'blue' }], softDensity: 0 });
  const me = w.players[0];
  me.x = 4;
  me.y = 3;
  me.shieldTicks = 600;
  me.speed = 4; // quick enough to leave the lane in the half second the shield buys
  // the other player's two bombs: one about to go off beside the bot, one on the bot's tile that it will set off
  const bomb = (id: number, cx: number, fuse: number) => ({ id, owner: 1, x: cx, y: 3, cx, cy: 3, fuse, range: 3, age: 100, state: 'ground' as const });
  step(w, [none, pressA]);
  const real = w.bombs[0];
  w.bombs = [{ ...real, ...bomb(90, 6, 2) }, { ...real, ...bomb(91, 4, 140) }];
  const bot = createBot(0, level, 11);
  let used = false;
  for (let t = 0; t < 3 * TICK_HZ; t++) {
    step(w, [botInput(w, bot)]);
    if (w.events.some((e) => e.type === 'shield')) used = true;
  }
  assert.ok(used, 'the shield took the first blast');
  assert.ok(me.alive, `${level} got out before the second blast caught it`);
}

// 16. falling blocks: the CPU players know where they will land
{
  const w = createWorld({ seed: 7, players: [{ colorId: 'gold' }, { colorId: 'blue' }], softDensity: 0 });
  const at = (x: number, y: number): number => y * w.w + x;
  assert.equal(blockLandsIn(w, at(1, 1)), blockLandTick(w, 0), 'the first block is due on the top-left corner');
  assert.equal(blockLandsIn(w, at(2, 3)), ROUND_TICKS + SHRINK_TICKS, 'the last just outside the 9 by 7 that stays open on Standard, 50 seconds after the timer reaches 0');
  assert.equal(blockLandsIn(w, at(7, 6)), Infinity, 'none in the 9 by 7');
  assert.equal(blockLandsIn(w, at(3, 3)), Infinity, 'its corners included (the third ring used to close it to a 7 by 5)');
  assert.equal(blockLandsIn(w, at(4, 5)), Infinity);
  assert.equal(blockLandsIn(w, at(5, 4)), Infinity);
  assert.equal(blockLandsIn(w, at(2, 2)), Infinity, 'none on a pillar');
  // at the start nothing is in sight; just before the timer reaches 0 the first tiles are, for a level that looks ahead
  assert.ok(!hasDanger(dangerMap(w, null, 0, [], LEVELS.hard.blockSight), at(1, 1)));
  w.tick = ROUND_TICKS - 60;
  assert.ok(hasDanger(dangerMap(w, null, 0, [], LEVELS.hard.blockSight), at(1, 1)), 'Hard sees it coming');
  assert.ok(!hasDanger(dangerMap(w, null, 0, [], LEVELS.beginner.blockSight), at(1, 1)), 'Beginner only once it is nearly falling');
  assert.ok(LEVELS.beginner.blockSight < LEVELS.normal.blockSight && LEVELS.normal.blockSight < LEVELS.hard.blockSight);
}

// 17. alone for a whole round, in an open arena and in one full of bricks: every level is in the square
// that stays open when the blocks stop, without having blasted itself on the way
for (const level of BOT_LEVELS) {
  for (const density of [0, undefined]) {
    const w = createWorld({ seed: 3, players: [{ colorId: 'gold' }], softDensity: density });
    const bot = createBot(0, level, 11);
    const p = w.players[0];
    const end = ROUND_TICKS + SHRINK_TICKS + 5 * TICK_HZ;
    let cause = '';
    for (let t = 0; t < end && p.alive; t++) {
      step(w, [botInput(w, bot)]);
      for (const e of w.events) if (e.type === 'death' && e.player === p.id) cause = e.cause;
    }
    const where = density === 0 ? 'open arena' : 'bricks';
    // (Beginner only steps aside from the block that is falling, and looks under a second ahead when it
    // picks where to stand clear of its own bomb, so it can back into a pocket the ring then closes: that is
    // part of being easy. With a 2-minute timer that happened in this open arena; with the 7 by 5 kept open
    // (18 November 2026) it happened among the bricks: it runs from its own bomb onto the third ring as it
    // closes. So Beginner may be caught by a block here, but never by its own blast. How often: the `alone`
    // run of experiments/cpu-matches.ts.)
    if (level === 'beginner' && !p.alive) {
      assert.equal(cause, 'block', `${level}, ${where}: if caught, by a block, not its own bomb`);
      continue;
    }
    assert.ok(p.alive, `${level}, ${where}: still in five seconds after the blocks stop (went at tick ${w.tick} of ${end})`);
    assert.ok(keptOpen(w.w, w.h, Math.round(p.y) * w.w + Math.round(p.x)), `${level}, ${where}: inside the square`);
  }
}

// 18. four CPU players of each level: whoever is still in when the blocks stop is inside the square. (A round
// won while blocks are still falling ends there, wherever the winner stands: it is not counted. Seed 4 alone
// stopped being enough when the laptop came, November 2026: the round played differently and was won early.
// Seeds 1 to 4 stopped being enough for Hard when the plane got faster, 24 November 2026: up to 8 are tried.)
for (const level of BOT_LEVELS) {
  let full = 0;
  for (let seed = 1; seed <= 8 && full < 2; seed++) {
    const w = createWorld({ seed, players: [0, 1, 2, 3].map((i) => ({ colorId: String(i) })) });
    const bots = [0, 1, 2, 3].map((i) => createBot(i, level, seed));
    for (let t = 0; t < ROUND_TICKS + SHRINK_TICKS && !w.over; t++) step(w, bots.map((b) => botInput(w, b)));
    if (w.over) continue;
    full++;
    for (const p of w.players) if (p.alive) assert.ok(keptOpen(w.w, w.h, Math.round(p.y) * w.w + Math.round(p.x)), `${level}, seed ${seed}: player ${p.id} is in the square`);
  }
  assert.ok(full >= 1, `${level}: a round lasted until the blocks stopped`);
}

// 19. a blast comes before a block that is still seconds away: just before the blocks start, a bot that
// looks far ahead and has dropped a bomb still runs to the one tile clear of the blast, though a block is due there
for (const level of ['hard'] as BotLevel[]) {
  const w = createWorld({ seed: 7, players: [{ colorId: 'gold' }, { colorId: 'blue' }], softDensity: 0 });
  const me = w.players[0];
  // shut into the top-left corner: (1,1), (2,1) and (1,2) are all it has, and blocks are due on all three within its sight
  w.tiles[2 * w.w + 2] = HARD;
  w.tiles[1 * w.w + 3] = HARD;
  w.tiles[3 * w.w + 1] = HARD;
  me.x = 1;
  me.y = 2;
  w.tick = blockLandTick(w, 0) - 300;
  step(w, [pressA]); // its own bomb on (1,2): the blast will cover (1,1) too, and only (2,1) is clear of it
  const bot = createBot(0, level, 11);
  for (let t = 0; t < FUSE_TICKS + FLAME_TICKS + 5; t++) step(w, [botInput(w, bot)]);
  assert.ok(me.alive, `${level} got clear of the blast`);
}

// 20. the fight in the square. Once the blocks have fallen, Normal and Hard press: two of them left in the
// square settle it. Beginner's settings are not touched.
{
  assert.equal(LEVELS.beginner.squareBold, false);
  assert.ok(LEVELS.normal.squareBold && LEVELS.hard.squareBold);
  /** two players in the square, bricks gone, every block fallen */
  const square = (seed = 6): World => {
    const w = createWorld({ seed, players: [{ colorId: 'gold' }, { colorId: 'blue' }], softDensity: 0 });
    for (const i of w.shrinkOrder) w.tiles[i] = HARD;
    w.shrinkNext = w.shrinkOrder.length;
    w.tick = ROUND_TICKS + SHRINK_TICKS + 1;
    const [a, b] = w.players;
    a.x = 5; a.y = 5;
    b.x = 9; b.y = 7;
    return w;
  };
  // Over 24 arenas, not one: a single arena passed or failed by luck (a fuse 3 ticks longer, 18 November 2026,
  // turned this arena's 27 s into a stall, while over 40 arenas the share settled within 90 s stayed the same,
  // 22 and 21 of 40). Measured then, with the 7 by 5 and the 2.55 s fuse: Hard settles 21 of 24 within 90 s,
  // Normal 11 (Normal presses, but carefully: two of them can circle a long time).
  for (const [level, least] of [['normal', 8], ['hard', 18]] as [BotLevel, number][]) {
    let decided = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const w = square(seed);
      const bots = [0, 1].map((i) => createBot(i, level, 21 + seed));
      // (being shut in by the rival's bombs and caught by its own is the risk pressing takes on purpose:
      // docs/CPU-PLAYERS.md, so it is not checked here; the cpu-matches runs tell it from blasting itself)
      for (let t = 0; t < 90 * TICK_HZ && !w.over; t++) step(w, bots.map((bot) => botInput(w, bot)));
      if (w.over) decided++;
    }
    assert.ok(decided >= least, `two ${level} players in the square: ${decided} of 24 decided within 90 seconds (at least ${least})`);
  }
  // the pressing is only for the square: the same two players a minute earlier, out in the open arena, are as careful as ever
  {
    const w = createWorld({ seed: 6, players: [{ colorId: 'gold' }, { colorId: 'blue' }], softDensity: 0 });
    const [a, b] = w.players;
    a.x = 5; a.y = 5;
    b.x = 9; b.y = 7;
    const bots = [0, 1].map((i) => createBot(i, 'normal', 21));
    for (let t = 0; t < 20 * TICK_HZ && !w.over; t++) {
      step(w, bots.map((bot) => botInput(w, bot)));
      for (const e of w.events) if (e.type === 'death') assert.notEqual(e.by, e.player, 'nobody is caught by its own bomb');
    }
  }
}

// 13. Hard uses its kit on a rival (23 November 2026). Each in an open arena, against a rival who stands still.
{
  /** player 0 (Hard) and player 1 put where wanted, with the kit given */
  const setUp = (me: [number, number], them: [number, number], kit: (w: World) => void): World => {
    const w = mk();
    const [a, b] = w.players;
    [a.x, a.y] = me;
    [b.x, b.y] = them;
    kit(w);
    return w;
  };
  const play = (w: World, seconds: number, seen: (w: World) => void): void => {
    const bot = createBot(0, 'hard', 5);
    for (let t = 0; t < seconds * TICK_HZ && !w.over; t++) {
      step(w, [botInput(w, bot)]);
      seen(w);
    }
  };

  // with the glove: a rival three tiles away, that a bomb dropped where it stands would not reach, gets one thrown onto them
  {
    const w = setUp([3, 3], [3, 6], (w) => (w.players[0].canGrab = true));
    let thrown = false;
    play(w, 6, (w) => {
      if (w.events.some((e) => e.type === 'throw')) thrown = true;
    });
    assert.ok(thrown, 'Hard throws a bomb at a rival it cannot bomb from where it stands');
    assert.ok(w.players[0].alive, 'and is still in afterwards');
    assert.ok(!w.players[1].alive, 'and it got them');
  }

  // with the boot: a rival far down an open lane gets a bomb dropped and kicked down the lane at them
  {
    const w = setUp([1, 1], [9, 1], (w) => (w.players[0].canKick = true));
    let kicked = false;
    play(w, 6, (w) => {
      if (w.events.some((e) => e.type === 'kick')) kicked = true;
    });
    assert.ok(kicked, 'Hard kicks a bomb down the lane at a rival beyond its blast');
    assert.ok(w.players[0].alive, 'and is still in afterwards');
    assert.ok(!w.players[1].alive, 'and it got them');
  }

  // knows what it has enough of: a blast power-up is worth walking to with a short blast, not with the longest
  for (const [fire, wanted] of [[1, true], [8, false]] as const) {
    const w = setUp([1, 1], [13, 11], (w) => {
      w.players[0].fire = fire;
      w.items.push({ cx: 3, cy: 1, kind: 'fire', age: 0 });
    });
    const bot = createBot(0, 'hard', 5);
    let went = false;
    for (let t = 0; t < 2 * TICK_HZ; t++) {
      step(w, [botInput(w, bot)]);
      if (bot.goal === 'item') went = true;
    }
    assert.equal(went, wanted, `blast ${fire}: ${wanted ? 'goes for' : 'leaves'} a blast power-up`);
  }
}
