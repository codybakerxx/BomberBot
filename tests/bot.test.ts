/**
 * Checks of the CPU players (src/bot.ts): what they know about blasts, that
 * they never drop a bomb they cannot get away from, that every level survives
 * and goes after other players, and that they are repeatable.
 *
 * No browser is involved. Run with: npm test
 */
import assert from 'node:assert';
import { createWorld, cloneWorld, step, World, PlayerInput, FLOOR, SOFT, HARD, FUSE_TICKS, FLAME_TICKS, CHAIN_TICKS, TICK_HZ } from '../src/sim';
import { BOT_LEVELS, LEVELS, BotLevel, createBot, botInput, dangerMap, hasDanger, previewBomb } from '../src/bot';

const none: PlayerInput = { dir: 0, a: false, b: false };
const pressA: PlayerInput = { dir: 0, a: true, b: false };
/** an arena with no bricks unless a density is given: player 0 top-left (1,1), player 1 bottom-right (13,11) */
const mk = (density = 0, seed = 7): World =>
  createWorld({ seed, players: [{ colorId: 'gold' }, { colorId: 'blue' }], softDensity: density });
const at = (w: World, x: number, y: number): number => y * w.w + x;
/** everything about a world that matters, as text, for comparing two worlds */
const snapshot = (w: World): string => JSON.stringify({ ...w, tiles: [...w.tiles], hidden: [...w.hidden], events: [] });

// 1. the danger map covers exactly what a bomb will blast, and when
{
  const w = mk();
  step(w, [pressA]);
  const D = dangerMap(w, null, 0);
  for (const [x, y] of [[1, 1], [2, 1], [3, 1], [1, 2], [1, 3]]) assert.ok(hasDanger(D, at(w, x, y)), `blast reaches ${x},${y}`);
  assert.ok(!hasDanger(D, at(w, 4, 1)), 'a starting bomb reaches two tiles, not three');
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
  w.bombs.push({ ...first, id: 99, x: 3, y: 1, cx: 3, cy: 1, fuse: FUSE_TICKS, age: 0 });
  const D = dangerMap(w, null, 0);
  // (5,1) is only in reach of the second bomb, which the first sets off
  assert.equal(D.iv[at(w, 5, 1)]![0], first.fuse + CHAIN_TICKS);
  // and that is what really happens
  const expected = first.fuse + CHAIN_TICKS;
  let seen = -1;
  for (let t = 1; t <= FUSE_TICKS && seen < 0; t++) {
    step(w, [none, none]);
    if (w.flames.some((f) => f.cx === 5 && f.cy === 1)) seen = t;
  }
  assert.ok(Math.abs(seen - expected) <= 1, `flames reached 5,1 at ${seen}, predicted ${expected}`);
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
  w.players[1].x = 3;
  w.players[1].y = 1;
  step(w, [none, pressA]);
  const me = w.players[0];
  assert.ok(!hasDanger(dangerMap(w, me, LEVELS.beginner.notice), at(w, 1, 1)), 'Beginner has not noticed yet');
  assert.ok(hasDanger(dangerMap(w, me, LEVELS.extreme.notice), at(w, 1, 1)), 'Extreme sees it at once');
  assert.ok(hasDanger(dangerMap(w, w.players[1], LEVELS.beginner.notice), at(w, 3, 1)), 'its own bomb is never a surprise');
  for (let i = 0; i < LEVELS.beginner.notice; i++) step(w, [none, none]);
  assert.ok(hasDanger(dangerMap(w, me, LEVELS.beginner.notice), at(w, 1, 1)), 'Beginner notices in the end');
}

// 5. asking a CPU player what it would do never changes the world
{
  const w = createWorld({ seed: 3, players: [0, 1, 2, 3].map((i) => ({ colorId: String(i) })) });
  const bots = [0, 1, 2, 3].map((i) => createBot(i, 'extreme', 5));
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
  const w = createWorld({ seed, players: [{ colorId: 'gold' }, { colorId: 'blue' }], softDensity: density });
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
    const w = createWorld({ seed: 9, players: [0, 1, 2, 3].map((i) => ({ colorId: String(i) })) });
    const bots = BOT_LEVELS.map((lv, i) => createBot(i, lv, 9));
    for (let t = 0; t < 40 * TICK_HZ; t++) step(w, bots.map((b) => botInput(w, b)));
    return snapshot(w);
  };
  assert.equal(play(), play());
}

// 11. four CPU players of each level together: any that goes out early is put out by someone else's bomb
// (the first 20 seconds, before paths cross, is when a careless bot would blast itself)
for (const level of BOT_LEVELS) {
  const w = createWorld({ seed: 4, players: [0, 1, 2, 3].map((i) => ({ colorId: String(i) })) });
  const bots = [0, 1, 2, 3].map((i) => createBot(i, level, 4));
  for (let t = 0; t < 20 * TICK_HZ; t++) step(w, bots.map((b) => botInput(w, b)));
  assert.ok(w.players.every((p) => p.alive), `${level}: all four still in after 20 seconds`);
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
