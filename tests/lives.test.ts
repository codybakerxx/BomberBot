/**
 * Checks of lives and angels (src/sim.ts): a robot with a life left comes back at its starting place with
 * what it started with and a moment of safety; one out of lives with angels on haunts the outer wall and
 * throws bombs in, further the longer A is held; with Angels come back, an angel whose bomb knocks a robot out
 * takes its place; and the round is won by the last robot still in, counting those waiting to come back.
 * Run with: npm test
 */
import assert from 'node:assert';
import {
  createWorld,
  step,
  World,
  PlayerInput,
  FLOOR,
  FUSE_TICKS,
  FLAME_TICKS,
  RESPAWN_TICKS,
  SAFE_TICKS,
  ANGEL_DELAY,
  ANGEL_MIN_TILES,
  ANGEL_CHARGE_TICKS,
  ANGEL_FIRE,
  FLY_TICKS_PER_TILE,
  START_FIRE,
  perimeterAt,
  wallLength,
  angelAim,
  type AngelRule,
} from '../src/sim';
import { createBot, botInput } from '../src/bot';

const none: PlayerInput = { dir: 0, a: false, b: false };
const press: PlayerInput = { dir: 0, a: true, b: false };

/** An open arena (no bricks), no timer: two players, top-left and bottom-right. */
function open(lives = 1, angels: AngelRule = 'off', n = 2): World {
  return createWorld({ seed: 7, softDensity: 0, roundTicks: 0, players: Array.from({ length: n }, (_, i) => ({ colorId: `c${i}` })), lives, angels });
}
/** Knock player `id` out with a blast on its tile, owned by `by`. */
function blast(w: World, id: number, by: number): void {
  const p = w.players[id];
  w.flames.push({ cx: Math.round(p.x), cy: Math.round(p.y), ttl: FLAME_TICKS, owner: by, kind: 'c', tip: 0 });
}
const run = (w: World, n: number, inputs: (PlayerInput | undefined)[] = []): void => {
  for (let i = 0; i < n; i++) step(w, inputs);
};

{
  // lives: one lost, the robot comes back at its corner with what it started with, safe for a moment
  const w = open(3);
  const p = w.players[0];
  assert.strictEqual(p.lives as number, 3, 'starts with the lobby\'s lives');
  p.bombsMax = 4;
  p.fire = 5;
  p.canKick = true;
  p.x = 3;
  blast(w, 0, 1);
  run(w, 1);
  assert.ok(!p.alive && (p.lives as number) === 2 && p.respawnAt > 0, 'knocked out, a life lost, coming back');
  const death = w.events.find((e) => e.type === 'death');
  assert.ok(death && death.type === 'death' && !death.out, 'the knockout says it is not out');
  run(w, RESPAWN_TICKS);
  assert.ok(p.alive, 'back after RESPAWN_TICKS');
  assert.deepStrictEqual([p.x, p.y], [w.spawns[0].x, w.spawns[0].y], 'at its starting place');
  assert.deepStrictEqual([p.bombsMax, p.fire, p.canKick], [1, START_FIRE, false], 'with only what it started with');
  assert.ok(p.safeTicks > SAFE_TICKS - 5, 'safe for a moment');
  blast(w, 0, 1);
  run(w, 2);
  assert.ok(p.alive && (p.lives as number) === 2, 'a blast while safe does no harm');
  run(w, SAFE_TICKS);
  blast(w, 0, 1);
  run(w, 1);
  assert.ok(!p.alive && (p.lives as number) === 1, 'after that it does');
  assert.ok(!w.over, 'the round is not over while a life is left');
  run(w, RESPAWN_TICKS + 1);
  run(w, SAFE_TICKS);
  blast(w, 0, 1);
  run(w, 1);
  assert.ok(!p.alive && (p.lives as number) === 0 && p.respawnAt < 0, 'the last life: out');
  run(w, 50);
  assert.deepStrictEqual(w.over, { winner: 1 }, 'and the other robot wins');
  assert.ok(!p.angel, 'angels off: no angel');
}

{
  // a robot coming back to a corner taken by a bomb comes back next to it
  const w = open(2);
  const s = w.spawns[0];
  blast(w, 0, 1);
  run(w, FLAME_TICKS + 1); // (the blast gone, or it would set the bomb off)
  w.bombs.push({ id: 99, owner: 1, x: s.x, y: s.y, cx: s.x, cy: s.y, fuse: 9999, range: 1, age: 0, state: 'ground', slide: 0, heldBy: -1, lifted: false, fromX: 0, fromY: 0, flyDir: 0, flyDist: 0, flyT: 0 });
  run(w, RESPAWN_TICKS - FLAME_TICKS);
  const p = w.players[0];
  assert.ok(p.alive && Math.abs(p.x - s.x) + Math.abs(p.y - s.y) === 1, 'on a free tile beside its corner');
}

{
  // both knocked out at once, one with a life left: that one wins once it is back
  const w = open(1);
  w.players[0].lives = 2;
  blast(w, 0, 1);
  blast(w, 1, 0);
  run(w, 60);
  assert.strictEqual(w.over, null, 'not decided while it is on its way back');
  run(w, RESPAWN_TICKS + 50);
  assert.deepStrictEqual(w.over, { winner: 0 }, 'decided once it is standing');
}

{
  // angels: out of lives, on the wall; glide round it; hold A to throw further
  const w = open(1, 'on', 3);
  const a = w.players[0];
  blast(w, 0, 1);
  run(w, 1);
  assert.ok(a.angel && !a.alive, 'an angel');
  const start = a.angelS;
  run(w, ANGEL_DELAY - 2, [{ dir: 4, a: false, b: false }]);
  assert.strictEqual(a.angelS, start, 'it waits for the knocked-out animation');
  run(w, 3);
  // put it over the middle of the top wall, over column 5
  a.angelS = 5;
  const at = perimeterAt(w, a.angelS);
  assert.deepStrictEqual(at, { x: 5, y: 0 }, 'top wall, column 5');
  assert.strictEqual(angelAim(w, a).dir, 2, 'aims down from the top');
  run(w, 10, [{ dir: 4, a: false, b: false }]);
  assert.ok(a.angelS > 5.5, 'right on the top wall glides it along');
  run(w, 30);
  assert.ok(Number.isInteger(a.angelS), 'let go, it settles on a tile');
  a.angelS = 5;
  // hold A for two tiles' worth past the shortest throw, then let go
  run(w, ANGEL_CHARGE_TICKS * 2 + 1, [press]);
  assert.strictEqual(w.bombs.length, 0, 'nothing thrown while A is held');
  run(w, 1, [none]);
  const b = w.bombs.find((o) => o.owner === 0)!;
  assert.ok(b && b.state === 'air' && b.flyDir === 2, 'let go: a bomb flies in');
  assert.strictEqual(b.flyDist, ANGEL_MIN_TILES + 2, 'as far as A was held');
  assert.strictEqual(b.range, ANGEL_FIRE, 'an angel\'s bomb has its own blast');
  run(w, 2, [press]);
  run(w, 1, [none]);
  assert.strictEqual(w.bombs.filter((o) => o.owner === 0).length, 1, 'one bomb out at a time');
  run(w, (ANGEL_MIN_TILES + 2) * FLY_TICKS_PER_TILE + 2);
  assert.ok((b.state as string) === 'ground' && b.cx === 5 && b.cy === ANGEL_MIN_TILES + 2, 'it lands that many tiles in');
  // round the corner: down the right side
  a.angelS = w.w - 1;
  run(w, 10, [{ dir: 2, a: false, b: false }]);
  const r = perimeterAt(w, a.angelS);
  assert.ok(r.x === w.w - 1 && r.y > 0.5, 'down goes down the right side');
  assert.ok(wallLength(w) === 2 * (w.w - 1) + 2 * (w.h - 1), 'the wall\'s length');
}

{
  // Angels come back: an angel's bomb knocks a robot out, and the angel takes its place
  const w = open(1, 'revive', 3);
  const a = w.players[0];
  blast(w, 0, 1);
  run(w, ANGEL_DELAY + 2);
  const v = w.players[2];
  v.x = 5;
  v.y = 3;
  w.flames.push({ cx: 5, cy: 3, ttl: FLAME_TICKS, owner: 0, kind: 'c', tip: 0 });
  run(w, 1);
  assert.ok(!v.alive, 'the robot is out');
  assert.ok(a.alive && !a.angel && a.x === 5 && a.y === 3, 'the angel is back, where it was');
  assert.ok(w.events.some((e) => e.type === 'revive' && e.player === 0 && e.victim === 2), 'and says so');
  assert.ok(a.safeTicks > 0 && a.lives === 1, 'safe for a moment, one life');

  // with plain angels, it stays an angel
  const w2 = open(1, 'on', 3);
  blast(w2, 0, 1);
  run(w2, ANGEL_DELAY + 2);
  const v2 = w2.players[2];
  w2.flames.push({ cx: Math.round(v2.x), cy: Math.round(v2.y), ttl: FLAME_TICKS, owner: 0, kind: 'c', tip: 0 });
  run(w2, 1);
  assert.ok(!v2.alive && w2.players[0].angel, 'Angels on: it stays an angel');
}

{
  // a CPU-free check that an angel's bomb is a real bomb: it goes off where it lands
  const w = open(1, 'on', 3);
  const a = w.players[0];
  blast(w, 0, 1);
  run(w, ANGEL_DELAY + 2);
  a.angelS = 7; // top wall, column 7
  run(w, 1, [press]);
  run(w, 1, [none]);
  run(w, FUSE_TICKS + 5);
  assert.ok(w.tiles[ANGEL_MIN_TILES * w.w + 7] === FLOOR && w.events !== null, 'it lands and goes off (no error)');
  assert.strictEqual(a.activeBombs, 0, 'and the angel can throw again');
}

{
  // a CPU player as an angel goes along the wall to line up with a robot standing still, and gets it
  const w = open(1, 'on', 3);
  const bot = createBot(0, 'normal', 3);
  blast(w, 0, 1);
  const t = w.players[2];
  t.x = 5;
  t.y = 5;
  let threw = false;
  for (let i = 0; i < 60 * 20 && t.alive; i++) {
    step(w, [botInput(w, bot)]);
    if (w.events.some((e) => e.type === 'throw')) threw = true;
  }
  assert.ok(threw && !t.alive, 'a CPU angel throws, and hits a robot that stands still');
}
