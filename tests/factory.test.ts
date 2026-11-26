/**
 * The Factory's conveyor belts (the owner's design, 26 November 2026): two along rows and two down columns,
 * crossing; they carry robots and bombs (not power-ups) along at BELT_SPEED, and now and then, after an alarm,
 * stop and run the other way. Off the Factory none of it happens.
 */
import assert from 'node:assert';
import {
  createWorld,
  step,
  cloneWorld,
  spawnPoints,
  beltLines,
  beltsAt,
  PlayerInput,
  World,
  Dir,
  BASE_SPEED,
  BELT_SPEED,
  BELT_FIRST,
  BELT_GAP,
  BELT_WARN_TICKS,
  BELT_STOP_TICKS,
  BELT_ALARM_TICKS,
  FLOOR,
  SOFT,
  HARD,
  MAX_PLAYERS,
} from '../src/sim';
import { dangerMap, hasDanger, createBot, botInput, BOT_LEVELS } from '../src/bot';
import { ARENAS, MAPS, defaultSetup, worldConfig, mapOf } from '../src/setup';
import { PROTOCOL, decodeWorld, encodeWorld, worldHash } from '../src/net';

/** An empty Factory (no boxes, no timer), 13 by 11 inside its wall: belts along rows 3 and 9, down columns 3 and 11. */
const arena = (players = 1): World =>
  createWorld({ seed: 3, players: Array.from({ length: players }, (_, i) => ({ colorId: String(i) })), softDensity: 0, roundTicks: 0, belts: true });
const press = (w: World, inp: Partial<PlayerInput>, n = 1): void => {
  for (let i = 0; i < n; i++) step(w, [{ dir: 0, a: false, b: false, ...inp }]);
};
const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;

// ---------------------------------------------------------------- the map

assert.ok(MAPS.some((m) => m.id === 'factory' && m.name === 'Factory'), 'a Factory map');
{
  const s = defaultSetup('gold');
  assert.ok(!worldConfig(s, 'gold', 1).belts, 'Midnight has no belts');
  for (const m of ['western', 'ice'] as const) {
    s.map = m;
    assert.ok(!worldConfig(s, 'gold', 1).belts, `nor has ${m}`);
  }
  s.map = 'factory';
  assert.equal(mapOf(s).name, 'Factory');
  const cfg = worldConfig(s, 'gold', 1);
  assert.equal(cfg.belts, true, 'the Factory has belts');
  assert.ok(!cfg.rails && !cfg.tnt && !cfg.ice, 'and no railway, TNT or ice');
  assert.equal(createWorld(cfg).belts.length, 4);
}
assert.equal(createWorld({ seed: 1, players: [{ colorId: 'a' }, { colorId: 'b' }] }).belts.length, 0, 'no belts unless asked for');
assert.ok(PROTOCOL >= 16, 'online pages from before the Factory cannot join a room with it');

// four belts on every size, crossing at four points, and no robot starts on one
for (const a of ARENAS) {
  for (const grow of [0, 2]) {
    for (let n = 2; n <= MAX_PLAYERS; n++) {
      const w = createWorld({ seed: 1, cols: a.cols + grow, rows: a.rows + grow, players: Array.from({ length: n }, (_, i) => ({ colorId: String(i) })), belts: true });
      assert.equal(w.belts.length, 4);
      let crossings = 0;
      for (let y = 1; y < w.h - 1; y++) {
        for (let x = 1; x < w.w - 1; x++) {
          const [h, v] = beltsAt(w, x, y);
          if (h || v) assert.notEqual(w.tiles[y * w.w + x], HARD, 'a belt runs on open floor (no pillars on its line)');
          if (h && v) crossings++;
        }
      }
      assert.equal(crossings, 4, 'they cross at four points');
      for (const s of spawnPoints(w.w, w.h, n)) {
        const [h, v] = beltsAt(w, s.x, s.y);
        assert.ok(!h && !v, `no robot starts on a belt (${a.id}${grow ? ', grown' : ''}, ${n} players)`);
      }
    }
  }
}
{
  // they start running round the arena like a clock's hands: right along the top, down the right, left along
  // the bottom, up the left
  const [top, bottom, left, right] = beltLines(15, 13);
  assert.deepEqual([top.dir, top.at, top.way], ['h', 3, 1]);
  assert.deepEqual([bottom.dir, bottom.at, bottom.way], ['h', 9, -1]);
  assert.deepEqual([left.dir, left.at, left.way], ['v', 3, -1]);
  assert.deepEqual([right.dir, right.at, right.way], ['v', 11, 1]);
}

// ---------------------------------------------------------------- robots

{
  // standing on a belt, a robot is carried along it
  const w = arena();
  const p = w.players[0];
  p.x = 5;
  p.y = 3;
  press(w, {}, 60);
  assert.ok(near(p.x, 5 + 60 * BELT_SPEED, 1e-6) && p.y === 3, `carried a second's worth (${p.x})`);
  assert.ok(!p.moving, 'standing, not walking');
}
{
  // walking with it is faster, against it slower; across it, it does not drag you sideways
  const go = (dir: Dir): World => {
    const w = arena();
    w.players[0].x = 5;
    w.players[0].y = 3;
    press(w, { dir }, 30);
    return w;
  };
  assert.ok(near(go(4).players[0].x, 5 + 30 * (BASE_SPEED + BELT_SPEED), 1e-6), 'with the belt: walking speed and the belt’s');
  assert.ok(near(go(3).players[0].x, 5 - 30 * (BASE_SPEED - BELT_SPEED), 1e-6), 'against it: walking speed less the belt’s');
  const w = arena();
  const p = w.players[0];
  p.x = 5;
  p.y = 1;
  press(w, { dir: 2 }, 100);
  assert.equal(p.x, 5, 'walking across a belt, not dragged sideways');
  assert.ok(near(p.y, 1 + 100 * BASE_SPEED, 1e-6));
}
{
  // carried along, it can still step off to the side where there is an opening (it used to line up with it
  // every tick and be carried off it again)
  const w = arena();
  const p = w.players[0];
  p.x = 5;
  p.y = 3;
  press(w, {}, 10);
  assert.ok(p.x > 5.2);
  press(w, { dir: 2 }, 40);
  assert.equal(p.x, 5, 'back to the opening');
  assert.ok(p.y > 4, `and off the belt (${p.y})`);
  // walking along a belt, it turns off it at the opening it asks for, with the belt or against it
  // (at column 5, which has no belt of its own)
  for (const [from, dir] of [
    [4.2, 4],
    [5.8, 3],
  ] as const) {
    const o = arena();
    o.players[0].x = from;
    o.players[0].y = 3;
    press(o, { dir }, 2);
    press(o, { dir: 2 }, 100);
    assert.ok(o.players[0].y > 4.5, `turned off it walking ${dir === 4 ? 'with' : 'against'} it`);
  }
}
{
  // carried to the end, it stops in the middle of the last tile, against the wall; a box on the belt stops it too
  const w = arena();
  const p = w.players[0];
  p.x = 10;
  p.y = 3;
  press(w, {}, 300);
  assert.equal(p.x, 13, 'stopped at the wall');
  const o = arena();
  o.tiles[3 * o.w + 8] = SOFT;
  o.players[0].x = 5;
  o.players[0].y = 3;
  press(o, {}, 300);
  assert.equal(o.players[0].x, 7, 'stopped behind the box');
}
{
  // through a crossing it rides on the same way, and down the column's belt after turning onto it
  const w = arena();
  const p = w.players[0];
  p.x = 1.5;
  p.y = 3;
  press(w, {}, 200);
  assert.ok(p.x > 5 && p.y === 3, 'along the row through the crossing at (3, 3)');
  const o = arena();
  o.players[0].x = 11;
  o.players[0].y = 5;
  press(o, {}, 60);
  assert.ok(near(o.players[0].y, 5 + 60 * BELT_SPEED, 1e-6) && o.players[0].x === 11, 'down the right-hand column');
}

// ---------------------------------------------------------------- bombs and power-ups

{
  // a bomb dropped on a belt rides it; one carried into something waits in the middle of the tile before it
  const w = arena();
  const p = w.players[0];
  p.x = 5;
  p.y = 3;
  press(w, { a: true });
  press(w, { dir: 2 }, 40); // (walk off down column 5)
  const b = w.bombs[0];
  assert.ok(b.x > 5.8 && b.y === 3, `the bomb rides on (${b.x})`);
  const o = arena(2);
  o.players[1].x = 8;
  o.players[1].y = 1;
  o.tiles[3 * o.w + 8] = FLOOR;
  o.players[0].x = 5;
  o.players[0].y = 3;
  step(o, [{ dir: 0, a: true, b: false }, undefined]);
  step(o, [{ dir: 2, a: false, b: false }, undefined]);
  o.players[1].x = 8; // a robot standing on the belt ahead of it
  o.players[1].y = 3;
  for (let t = 0; t < 100; t++) {
    o.players[1].x = 8;
    step(o, [{ dir: 2, a: false, b: false }, undefined]);
  }
  assert.equal(o.bombs[0].x, 7, 'it waits behind the robot in its way');
}
{
  // power-ups do not ride
  const w = arena();
  w.items.push({ cx: 6, cy: 3, kind: 'bomb', age: 0 });
  w.players[0].x = 1;
  w.players[0].y = 1;
  press(w, {}, 120);
  assert.deepEqual([w.items[0].cx, w.items[0].cy], [6, 3], 'a power-up stays where it is');
}
{
  // a bomb resting on a column's belt rides it too
  const w = arena();
  const p = w.players[0];
  p.x = 1;
  p.y = 5;
  w.bombs.push({ id: 90, owner: 0, x: 3, y: 5, cx: 3, cy: 5, fuse: 999, range: 1, age: 0, state: 'ground', slide: 0, speed: 0, heldBy: -1, lifted: false, fromX: 0, fromY: 0, flyDir: 0, flyDist: 0, flyT: 0 });
  // (column 3's belt runs up at the start: a bomb resting on it rides up)
  press(w, {}, 30);
  assert.ok(near(w.bombs[0].y, 5 - 30 * BELT_SPEED, 1e-6) && w.bombs[0].x === 3, 'resting on the column belt, it rides up');
}

// ---------------------------------------------------------------- turning round

{
  const w = arena();
  assert.ok(w.beltFlip >= BELT_FIRST[0] && w.beltFlip <= BELT_FIRST[1], 'the first turn comes 15 to 20 s in');
  const first = w.beltFlip;
  const p = w.players[0];
  p.x = 7;
  p.y = 3;
  const alarms: number[] = [];
  let reversed = -1;
  let stillFrom = -1;
  let atTurn = 0;
  for (let t = 0; t < first + 10; t++) {
    const x = p.x;
    press(w, {});
    for (const e of w.events) {
      if (e.type === 'alarm') alarms.push(w.tick);
      if (e.type === 'reverse') {
        reversed = w.tick;
        atTurn = p.x;
      }
    }
    if (stillFrom < 0 && w.tick > 30 && p.x === x && p.x < 13) stillFrom = w.tick;
    if (w.tick === first - BELT_WARN_TICKS - 1) {
      // (put it back in the middle of the belt for the turn)
      p.x = 7;
    }
  }
  assert.deepEqual(alarms, [0, 1, 2, 3].map((k) => first - BELT_WARN_TICKS + k * BELT_ALARM_TICKS), 'the alarm sounds twice a second for the 2 s before');
  assert.equal(stillFrom, first - BELT_STOP_TICKS, 'the belts stand still for the last half second');
  assert.equal(reversed, first, 'then turn round');
  assert.equal(w.beltWay, -1);
  assert.ok(near(p.x, atTurn - 10 * BELT_SPEED, 1e-6), `and carry it back (${p.x})`);
  assert.ok(w.beltFlip - first >= BELT_GAP[0] && w.beltFlip - first <= BELT_GAP[1], 'the next turn 15 to 20 s on');
}
{
  // once the round is decided the belts stop
  const w = arena(2);
  w.players[0].x = 5;
  w.players[0].y = 3;
  w.over = { winner: 0 };
  step(w, [undefined, undefined]);
  assert.equal(w.players[0].x, 5, 'nothing is carried once the round is decided');
  assert.equal(w.beltFlip, 0, 'and they turn no more');
}

// ---------------------------------------------------------------- CPU players

{
  // a CPU player sees where a bomb on a belt will be when it goes off, not where it is now
  const w = arena(2);
  w.players[1].x = 1;
  w.players[1].y = 11;
  w.bombs.push({ id: 91, owner: 1, x: 5, y: 3, cx: 5, cy: 3, fuse: 92, range: 1, age: 999, state: 'ground', slide: 0, speed: 0, heldBy: -1, lifted: false, fromX: 0, fromY: 0, flyDir: 0, flyDist: 0, flyT: 0 });
  const D = dangerMap(w, w.players[0], 0);
  // 92 ticks at 0.021875 a tick: 2 tiles on, to (7, 3)
  assert.ok(hasDanger(D, 3 * w.w + 7) && hasDanger(D, 3 * w.w + 8), 'its blast where it will have ridden to');
  assert.ok(!hasDanger(D, 3 * w.w + 4), 'not where it is now, behind it');
}
// every level, alone in a full Factory for two minutes, never blasts itself; with a player who stands still in an
// open one, it gets them
for (const level of BOT_LEVELS) {
  for (let seed = 1; seed <= 3; seed++) {
    const w = createWorld({ roundTicks: 0, seed, players: [{ colorId: 'gold' }, { colorId: 'blue' }], belts: true });
    const bot = createBot(0, level, seed * 31 + 7);
    for (let t = 0; t < 120 * 60 && !w.over; t++) step(w, [botInput(w, bot)]);
    assert.ok(w.players[0].alive, `${level} in the Factory, arena ${seed}: still in`);
    const o = createWorld({ roundTicks: 0, seed, players: [{ colorId: 'gold' }, { colorId: 'blue' }], softDensity: 0, belts: true });
    const hunter = createBot(0, level, seed * 31 + 7);
    for (let t = 0; t < 120 * 60 && !o.over; t++) step(o, [botInput(o, hunter)]);
    assert.deepEqual(o.over, { winner: 0 }, `${level} in the Factory, open arena ${seed}: got the other player`);
  }
}

// ---------------------------------------------------------------- online

{
  // the same inputs give the same match, and a world sent whole carries its belts
  const s = defaultSetup('gold');
  s.map = 'factory';
  const cfg = worldConfig(s, 'gold', 7);
  const a = createWorld(cfg);
  const b = createWorld(cfg);
  const dirs: Dir[] = [4, 4, 4, 0, 0, 3, 3, 2, 2, 0, 4, 1];
  for (let t = 0; t < 1500; t++) {
    const inp: PlayerInput = { dir: dirs[Math.floor(t / 20) % dirs.length], a: t % 50 === 0, b: false };
    step(a, [inp]);
    step(b, [inp]);
  }
  assert.equal(worldHash(a), worldHash(b), 'the same match on every page');
  const back = decodeWorld(JSON.parse(JSON.stringify(encodeWorld(a))));
  assert.equal(back.belts.length, 4);
  assert.equal(worldHash(back), worldHash(a), 'a world sent whole is the same world');
  const c = cloneWorld(a);
  c.beltWay = c.beltWay > 0 ? -1 : 1;
  assert.notEqual(worldHash(c), worldHash(a), 'which way the belts run counts in the checksum');
}

console.log('factory checks passed');
