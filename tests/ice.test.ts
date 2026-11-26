/**
 * Frozen Lake's ice (the owner's design, 25 November 2026): robots slide a little when they let go or turn back
 * the way they came; thrown bombs land and slide on; a sliding bomb slows down, and bounces back off what stops
 * it if it hits it fast enough. Off the ice none of it happens.
 */
import assert from 'node:assert';
import {
  createWorld,
  step,
  cloneWorld,
  slideBomb,
  PlayerInput,
  World,
  Bomb,
  Dir,
  BASE_SPEED,
  SPEED_STEP,
  MAX_SPEED_ITEMS,
  KICK_SPEED,
  ICE_DRAG,
  ICE_LAND_SPEED,
  ICE_CRAWL,
  ICE_BOUNCE,
  ICE_BOUNCE_MIN,
  FLOOR,
  HARD,
} from '../src/sim';
import { dangerMap, hasDanger, createBot, botInput, BOT_LEVELS } from '../src/bot';
import { MAPS, defaultSetup, worldConfig, mapOf } from '../src/setup';
import { PROTOCOL, decodeWorld, encodeWorld, worldHash } from '../src/net';

/** An empty arena (no bricks, no timer), 13 by 11 inside its wall: row 1 is open from x 1 to 13. */
const arena = (ice: boolean): World => createWorld({ seed: 3, players: [{ colorId: 'gold' }, { colorId: 'red' }], softDensity: 0, roundTicks: 0, ice });
const press = (w: World, inp: Partial<PlayerInput>, n = 1): void => {
  for (let i = 0; i < n; i++) step(w, [{ dir: 0, a: false, b: false, ...inp }]);
};

// ---------------------------------------------------------------- the map

assert.ok(MAPS.some((m) => m.id === 'ice' && m.name === 'Frozen Lake'), 'a Frozen Lake map');
{
  const s = defaultSetup('gold');
  assert.ok(!worldConfig(s, 'gold', 1).ice, 'Midnight is not ice');
  s.map = 'western';
  assert.ok(!worldConfig(s, 'gold', 1).ice, 'nor is the Wild West');
  s.map = 'ice';
  assert.equal(mapOf(s).name, 'Frozen Lake');
  const cfg = worldConfig(s, 'gold', 1);
  assert.equal(cfg.ice, true, 'Frozen Lake is ice');
  assert.ok(!cfg.rails && !cfg.tnt, 'with no railway or TNT');
  assert.equal(createWorld(cfg).ice, true);
}
assert.ok(PROTOCOL >= 14, 'online pages from before the ice cannot join a room with it');

// ---------------------------------------------------------------- robots

/** Walk right for `n` ticks at `speed` power-ups, then let go: how far it slides, and in how many ticks. */
function letGo(ice: boolean, speed: number, n = 20): { slid: number; ticks: number; w: World } {
  const w = arena(ice);
  const p = w.players[0];
  p.speed = speed;
  press(w, { dir: 4 }, n);
  const at = p.x;
  let ticks = 0;
  for (; ticks < 100; ticks++) {
    const was = p.x;
    press(w, {});
    if (p.x === was) break;
    assert.equal(p.y, 1, 'it slides along its lane');
    assert.ok(p.skid && p.moving, 'sliding, not walking');
  }
  return { slid: p.x - at, ticks, w };
}

// off the ice it stops where it is let go, as always
assert.equal(letGo(false, 0).slid, 0, 'off the ice a robot stops where it is let go');
assert.equal(letGo(false, MAX_SPEED_ITEMS).slid, 0);
// on ice it slides a little: about a fifth of a tile at the starting speed, under half a tile at top speed
{
  const slow = letGo(true, 0);
  const fast = letGo(true, MAX_SPEED_ITEMS);
  const glide = (v: number): number => (v * ICE_DRAG) / (1 - ICE_DRAG);
  assert.ok(slow.slid > 0.15 && slow.slid <= glide(BASE_SPEED) + 1e-9, `slides a little at the starting speed (${slow.slid.toFixed(3)} tiles)`);
  assert.ok(fast.slid > slow.slid && fast.slid < 0.5, `further at top speed, but under half a tile (${fast.slid.toFixed(3)})`);
  assert.ok(glide(BASE_SPEED + SPEED_STEP * MAX_SPEED_ITEMS) < 0.5, 'so a robot let go in the middle of a tile never slides off it');
  assert.ok(slow.ticks > 6 && fast.ticks < 25, `and stops within a few tenths of a second (${slow.ticks}, ${fast.ticks} ticks)`);
  assert.ok(!slow.w.players[0].skid && slow.w.players[0].slip === 0, 'then it has stopped');
}

// turning back the way it came: it slides on first, looking the new way, then walks back
{
  const w = arena(true);
  const p = w.players[0];
  press(w, { dir: 4 }, 30);
  const at = p.x;
  press(w, { dir: 3 });
  assert.ok(p.x > at, 'it carries on the way it was going');
  assert.equal(p.facing, 3, 'looking the way it was asked to go');
  let ticks = 1;
  while (p.x >= at && ticks < 60) {
    press(w, { dir: 3 });
    ticks++;
  }
  assert.ok(ticks > 10 && ticks < 40, `then walks back, a moment later (${ticks} ticks)`);
  // off the ice it turns back at once
  const o = arena(false);
  press(o, { dir: 4 }, 30);
  const was = o.players[0].x;
  press(o, { dir: 3 });
  assert.ok(o.players[0].x < was, 'off the ice it turns back at once');
}

// a block ahead stops the slide in the middle of its tile
{
  const w = arena(true);
  const p = w.players[0];
  p.x = 12;
  p.speed = MAX_SPEED_ITEMS;
  press(w, { dir: 4 }, 30); // to x 13, the last tile before the wall
  press(w, {}, 30);
  assert.equal(p.x, 13, 'stopped by the wall in the middle of the last tile');
  assert.equal(w.tiles[w.w + 14], HARD);
}

// a turn into a side opening still takes it (no slide across)
{
  const w = arena(true);
  const p = w.players[0];
  press(w, { dir: 4 }, 24); // past x 2, running right
  press(w, { dir: 2 }, 40); // down at x 3, the next opening (x 2 is a pillar below row 1)
  assert.equal(p.x, 3, 'turned down at the next opening, on its lane');
  assert.ok(p.y > 1.5);
}

// opening a laptop stops the slide
{
  const w = arena(true);
  const p = w.players[0];
  press(w, { dir: 4 }, 20);
  p.laptop = true;
  press(w, { b: true });
  assert.equal(p.slip, 0, 'it stops to fly its plane');
}

// ---------------------------------------------------------------- bombs

/** Robot 0 at (x, 1) facing right with the glove: drop a bomb, lift it, throw it right. */
function throwFrom(w: World, x: number): Bomb {
  const p = w.players[0];
  p.x = x;
  p.y = 1;
  p.canGrab = true;
  press(w, { a: true });
  press(w, {});
  press(w, { b: true });
  press(w, {});
  p.facing = 4;
  press(w, { b: true });
  press(w, {});
  return w.bombs[0];
}

/** Follow a bomb until it lies still (or goes off): where it ended up, and its bounces. */
function follow(w: World, b: Bomb): { x: number; bounces: number; landed: number } {
  let bounces = 0;
  let landed = -1;
  for (let t = 0; t < 200 && w.bombs.includes(b); t++) {
    press(w, {});
    if (w.events.some((e) => e.type === 'land')) landed = b.x;
    if (w.events.some((e) => e.type === 'bounce')) bounces++;
    if (b.state === 'ground' && !b.slide) break;
  }
  return { x: b.x, bounces, landed };
}

// off the ice a thrown bomb lands three tiles on and lies there
{
  const w = arena(false);
  const r = follow(w, throwFrom(w, 1));
  assert.equal(r.landed, 4);
  assert.equal(r.x, 4, 'off the ice it lies where it lands');
}
// on ice it lands and slides on, about two tiles, and stops in the middle of a tile
{
  const w = arena(true);
  const b = throwFrom(w, 1);
  const r = follow(w, b);
  assert.equal(r.landed, 4, 'it lands where it would anywhere');
  assert.ok(r.x >= 5 && r.x <= 7, `then slides on (to ${r.x})`);
  assert.equal(r.x, Math.round(r.x), 'and stops in the middle of a tile');
  assert.equal(r.bounces, 0);
  assert.equal(b.slide, 0);
}
// landing right against the wall it is still fast: it bounces back
{
  const w = arena(true);
  const b = throwFrom(w, 10); // lands on x 13, the wall at 14
  const r = follow(w, b);
  assert.equal(r.bounces, 1, 'it bounces back off the wall');
  assert.ok(r.x < 13 && r.x === Math.round(r.x), `back to the middle of a tile (${r.x})`);
}

// kicked: off the ice it slides until something stops it; on ice it slows, and bounces back off the wall
function kick(ice: boolean, from: number): { b: Bomb; w: World } {
  const w = arena(ice);
  const p = w.players[0];
  p.canKick = true;
  w.bombs.push({ id: 50, owner: 1, x: from + 1, y: 1, cx: from + 1, cy: 1, fuse: 10_000, range: 1, age: 0, state: 'ground', slide: 0, speed: 0, heldBy: -1, lifted: false, fromX: 0, fromY: 0, flyDir: 0, flyDist: 0, flyT: 0 });
  p.x = from;
  p.y = 1;
  for (let i = 0; i < 20 && !w.bombs[0].slide; i++) press(w, { dir: 4 });
  assert.equal(w.bombs[0].slide, 4, 'kicked');
  assert.ok(Math.abs(w.bombs[0].speed - KICK_SPEED) < 0.002, 'at the speed of a kick');
  return { b: w.bombs[0], w };
}
{
  const { b, w } = kick(false, 3);
  const r = follow(w, b);
  assert.equal(r.x, 13, 'off the ice it slides to the wall');
  assert.equal(r.bounces, 0, 'and stops there');
}
{
  const { b, w } = kick(true, 9); // three tiles to the wall: still fast when it gets there
  const r = follow(w, b);
  assert.equal(r.bounces, 1, 'on ice it bounces back off the wall');
  assert.ok(r.x < 13 && r.x === Math.round(r.x), `and comes to rest a tile or more back (${r.x})`);
}
{
  // it bounces back off a robot in its way too, and never slides into one
  const { b, w } = kick(true, 3);
  const q = w.players[1];
  q.x = 9;
  q.y = 1;
  let into = false;
  let bounces = 0;
  for (let t = 0; t < 200 && !(b.state === 'ground' && !b.slide); t++) {
    press(w, {});
    if (w.events.some((e) => e.type === 'bounce')) bounces++;
    if (b.cx === 9 && b.cy === 1) into = true;
  }
  assert.ok(!into, 'it never slides onto a robot');
  assert.equal(bounces, 1, 'it bounces back off the robot');
}

// slideBomb by itself: the numbers
{
  const at = (speed: number): Bomb => ({ id: 1, owner: 0, x: 5, y: 1, cx: 5, cy: 1, fuse: 999, range: 1, age: 0, state: 'ground', slide: 4, speed, heldBy: -1, lifted: false, fromX: 0, fromY: 0, flyDir: 0, flyDist: 0, flyT: 0 });
  const wall = (x: number): boolean => x !== 6; // a block on x 6
  const fast = at(ICE_BOUNCE_MIN);
  assert.ok(slideBomb(fast, true, wall), 'hitting at ICE_BOUNCE_MIN it bounces');
  assert.equal(fast.slide, 3);
  assert.equal(fast.speed, ICE_BOUNCE_MIN * ICE_BOUNCE);
  assert.ok(ICE_BOUNCE_MIN * ICE_BOUNCE >= ICE_CRAWL, 'fast enough to go back a tile');
  const slow = at(ICE_BOUNCE_MIN - 0.001);
  assert.ok(!slideBomb(slow, true, wall), 'any slower and it just stops');
  assert.equal(slow.slide, 0);
  const off = at(0.2);
  assert.ok(!slideBomb(off, false, wall), 'off the ice it never bounces');
  assert.equal(off.slide, 0);
  // friction: on ice it slows, down to a crawl and no further; off the ice it keeps KICK_SPEED
  const glide = at(ICE_LAND_SPEED);
  const open = (): boolean => true;
  for (let i = 0; i < 400 && glide.slide; i++) slideBomb(glide, true, open);
  assert.equal(glide.slide, 0, 'on ice it comes to a stop by itself');
  assert.equal(glide.x, Math.round(glide.x), 'in the middle of a tile');
  const plain = at(KICK_SPEED);
  for (let i = 0; i < 400; i++) slideBomb(plain, false, open);
  assert.equal(plain.slide, 4, 'off the ice it slides on until something stops it');
}

// ---------------------------------------------------------------- the CPU players see where it will go off

{
  // a bomb thrown on ice: the danger map has it where it really comes to rest, not where it lands
  const w = arena(true);
  const b = throwFrom(w, 1);
  assert.equal(b.state, 'air');
  const D = dangerMap(w, null, 0);
  const copy = cloneWorld(w);
  const cb = copy.bombs[0];
  for (let t = 0; t < 400 && copy.bombs.length; t++) {
    step(copy, [undefined, undefined]);
    if (copy.bombs.includes(cb) && cb.state === 'ground' && !cb.slide) break;
  }
  assert.ok(cb.x > 4, 'it slid on from where it landed');
  assert.ok(hasDanger(D, cb.cy * w.w + cb.cx), 'the CPU players know it will go off where it slid to');
}
{
  // a kicked bomb that will bounce: the danger map has it where it comes back to
  const { b, w } = kick(true, 9);
  b.fuse = 150;
  const D = dangerMap(w, null, 0);
  const copy = cloneWorld(w);
  const cb = copy.bombs[0];
  while (cb.slide) step(copy, [undefined, undefined]);
  assert.ok(cb.x < 13);
  assert.ok(hasDanger(D, cb.cy * w.w + cb.cx), 'the CPU players know where it bounces back to');
}

// every level, alone on ice in a full arena of bricks for two minutes, never blasts itself; with a player who
// stands still in an open one, it gets them; and it comes to rest near the middle of its tile, rather than
// sliding past and back for ever
for (const level of BOT_LEVELS) {
  for (let seed = 1; seed <= 3; seed++) {
    const w = createWorld({ roundTicks: 0, seed, players: [{ colorId: 'gold' }, { colorId: 'blue' }], ice: true });
    const bot = createBot(0, level, seed * 31 + 7);
    for (let t = 0; t < 120 * 60 && !w.over; t++) step(w, [botInput(w, bot)]);
    assert.ok(w.players[0].alive, `${level} on ice, arena ${seed}: still in`);
    const o = createWorld({ roundTicks: 0, seed, players: [{ colorId: 'gold' }, { colorId: 'blue' }], softDensity: 0, ice: true });
    const hunter = createBot(0, level, seed * 31 + 7);
    for (let t = 0; t < 120 * 60 && !o.over; t++) step(o, [botInput(o, hunter)]);
    assert.deepEqual(o.over, { winner: 0 }, `${level} on ice, open arena ${seed}: got the other player`);
  }
}
{
  // a CPU player alone in an empty arena, with nothing to do, left sliding off the middle of its tile at top
  // speed: once it stops, it stays stopped
  const w = createWorld({ seed: 3, players: [{ colorId: 'gold' }], softDensity: 0, roundTicks: 0, ice: true });
  const bot = createBot(0, 'normal', 1);
  w.players[0].slip = 0.09;
  w.players[0].slipDir = 4;
  w.players[0].x = 5.4;
  w.players[0].speed = MAX_SPEED_ITEMS;
  let moves = 0;
  for (let t = 0; t < 200; t++) {
    const was = w.players[0].x;
    step(w, [botInput(w, bot)]);
    if (t > 120 && w.players[0].x !== was) moves++;
  }
  assert.equal(moves, 0, 'a CPU player on ice settles, and does not slide to and fro');
  assert.ok(Math.abs(w.players[0].x - Math.round(w.players[0].x)) < 0.5);
}

// ---------------------------------------------------------------- online

{
  // the same inputs give the same match, and a world sent whole carries its ice and its slides
  const s = defaultSetup('gold');
  s.map = 'ice';
  const cfg = worldConfig(s, 'gold', 7);
  const a = createWorld(cfg);
  const b = createWorld(cfg);
  const dirs: Dir[] = [4, 4, 4, 0, 0, 3, 3, 2, 2, 0, 4, 1];
  for (let t = 0; t < 240; t++) {
    const inp: PlayerInput = { dir: dirs[Math.floor(t / 20) % dirs.length], a: t % 50 === 0, b: false };
    step(a, [inp]);
    step(b, [inp]);
  }
  assert.equal(worldHash(a), worldHash(b), 'the same match on every page');
  const back = decodeWorld(JSON.parse(JSON.stringify(encodeWorld(a))));
  assert.equal(back.ice, true);
  assert.equal(worldHash(back), worldHash(a), 'a world sent whole is the same world');
  // the checksum notices a slide that has not shown in a position yet
  const c = cloneWorld(a);
  c.players[0].slip += 0.01;
  assert.notEqual(worldHash(c), worldHash(a), 'a slide counts in the checksum');
}
assert.equal(createWorld({ seed: 1, players: [{ colorId: 'a' }, { colorId: 'b' }] }).ice, false, 'no ice unless asked for');
assert.equal(arena(true).tiles[arena(true).w + 1], FLOOR);

console.log('ice checks passed');
