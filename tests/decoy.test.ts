/**
 * The decoy and the trip wire (the owner's design, 26 November 2026).
 *
 * Decoy: two copies of the robot that picks it up appear beside it and walk whenever it walks, one the same way,
 * one the opposite way; a blast, a falling block or the train pops one in a puff of smoke, and after 15 s they
 * vanish by themselves.
 *
 * Trip wire: B strings it across a gap one tile wide between two solid blocks. Anyone who walks into it, the one
 * who strung it too, sets it off: a blast the whole length of its lane, both ways, to the walls, breaking every
 * brick on the way.
 */
import assert from 'node:assert';
import {
  createWorld,
  step,
  cloneWorld,
  wireSpot,
  wireLane,
  PlayerInput,
  World,
  ITEM_CHANCE,
  DECOY_TICKS,
  DECOY_COUNT,
  POOF_TICKS,
  MAX_WIRES,
  FLAME_TICKS,
  FUSE_TICKS,
  FLOOR,
  SOFT,
  HARD,
  TICK_HZ,
  SHIELD_TICKS,
  playerSpeed,
} from '../src/sim';
import { createBot, botInput, BOT_LEVELS } from '../src/bot';
import { ITEM_NAMES, SOUND_GROUPS, SOUND_NAMES, defaultSetup, worldConfig } from '../src/setup';
import { PROTOCOL, decodeWorld, encodeWorld, worldHash } from '../src/net';

/** An empty arena 13 by 11 inside its wall, no timer: pillars on even rows and columns. */
const arena = (players = 1): World =>
  createWorld({ seed: 5, players: Array.from({ length: players }, (_, i) => ({ colorId: ['gold', 'blue', 'red', 'pink'][i] })), softDensity: 0, roundTicks: 0 });
const none: PlayerInput = { dir: 0, a: false, b: false };
const go = (dir: 0 | 1 | 2 | 3 | 4, b = false): PlayerInput => ({ dir, a: false, b });
/** step with player 0 pressing this, the others standing still */
const run = (w: World, inp: PlayerInput, n = 1): void => {
  for (let i = 0; i < n; i++) step(w, [inp]);
};
/** walk player 0 to the middle of (x, y), across then down (the last bit of a step is snapped to the middle) */
const walkTo = (w: World, x: number, y: number): void => {
  const p = w.players[0];
  for (let i = 0; i < 400; i++) {
    const sp = playerSpeed(p);
    if (Math.abs(p.x - x) < sp) p.x = x;
    if (p.x === x && Math.abs(p.y - y) < sp) p.y = y;
    if (p.x === x && p.y === y) break;
    run(w, go(p.x < x ? 4 : p.x > x ? 3 : p.y < y ? 2 : 1));
  }
  assert.ok(p.x === x && p.y === y, `walked to ${x},${y} (at ${p.x},${p.y})`);
};
const flameOn = (w: World, x: number, y: number): boolean => w.flames.some((f) => f.cx === x && f.cy === y);

// ---------------------------------------------------------------- the two new kinds

assert.deepEqual(
  ITEM_CHANCE.slice(-2).map(([k]) => k),
  ['decoy', 'wire'],
  'added at the end of the list',
);
assert.ok(ITEM_NAMES.some(([k, n]) => k === 'decoy' && n === 'Decoy'));
assert.ok(ITEM_NAMES.some(([k, n]) => k === 'wire' && n === 'Trip wire'));
for (const id of ['decoy', 'poof', 'wire', 'trip']) {
  assert.ok(SOUND_NAMES.some(([s]) => s === id), `a sound switch for ${id}`);
  assert.ok(SOUND_GROUPS.some(([, ids]) => ids.includes(id)), `${id} in a group`);
}
assert.ok(PROTOCOL >= 17, 'online pages from before them cannot join a room with them');
{
  // every arena is sure to have one of each, unless Custom power-ups switches them off
  const s = defaultSetup('gold');
  for (let seed = 1; seed <= 20; seed++) {
    const kinds = [...createWorld(worldConfig(s, 'gold', seed)).hidden.values()];
    assert.ok(kinds.includes('decoy') && kinds.includes('wire'), `seed ${seed}: a decoy and a trip wire`);
  }
  s.itemsOn = true;
  s.itemOn.decoy = false;
  s.itemOn.wire = false;
  for (let seed = 1; seed <= 20; seed++) {
    const kinds = [...createWorld(worldConfig(s, 'gold', seed)).hidden.values()];
    assert.ok(!kinds.includes('decoy') && !kinds.includes('wire'), 'switched off: none');
  }
}

// ---------------------------------------------------------------- decoys

{
  // picking one up: two copies appear on the nearest free tiles
  const w = arena();
  const p = w.players[0];
  w.items.push({ cx: 2, cy: 1, kind: 'decoy', age: 0 });
  for (let i = 0; i < 60 && !w.decoys.length; i++) run(w, go(4));
  assert.ok(w.events.some((e) => e.type === 'decoy' && e.player === 0));
  assert.equal(w.decoys.length, DECOY_COUNT, 'two of them');
  assert.ok(w.decoys.every((d) => d.id === p.id && d.colorId === p.colorId && d.popped < 0), 'copies of the robot');
  assert.equal(w.decoys.filter((d) => d.mirror).length, 1, 'one of them mirrored');
  for (const d of w.decoys) {
    assert.equal(Math.abs(d.x - 2) + Math.abs(d.y - 1), 1, 'right beside it');
    assert.equal(w.tiles[d.y * w.w + d.x], FLOOR);
  }
  assert.ok(!w.items.length, 'the power-up is used');
  assert.equal(p.bombsMax, 1, 'it gives nothing else');
  walkTo(w, 2, 1);

  // they walk when it walks: one the same way, one the opposite way
  const same = w.decoys.find((d) => !d.mirror)!;
  const mirror = w.decoys.find((d) => d.mirror)!;
  const [sx, sy, mx, my] = [same.x, same.y, mirror.x, mirror.y];
  run(w, none, 10);
  assert.ok(same.x === sx && same.y === sy && mirror.x === mx && mirror.y === my, 'standing still with it');
  // (from 2,1 a step down is a pillar: it walks along row 1, right)
  walkTo(w, 3, 1);
  assert.ok(same.x > sx || same.y !== sy, 'the same way');
  assert.equal(same.facing, 4);
  assert.equal(mirror.facing, 3, 'the other looks the opposite way');

  // it vanishes after 15 s in a puff of smoke, and the puff goes too
  const until = same.until;
  assert.equal(until - same.born, DECOY_TICKS);
  run(w, none, until - w.tick - 1);
  assert.ok(w.decoys.every((d) => d.popped < 0), 'still there just before');
  run(w, none);
  assert.ok(w.decoys.every((d) => d.popped === w.tick), 'gone at 15 s');
  assert.equal(w.events.filter((e) => e.type === 'poof').length, 2, 'two puffs of smoke');
  run(w, none, POOF_TICKS);
  assert.equal(w.decoys.length, 0, 'the puffs clear');
}
{
  // a blast pops one, whoever's it is; it does not stop a bomb, pick anything up or block anyone
  const w = arena(2);
  w.items.push({ cx: 1, cy: 2, kind: 'decoy', age: 0 });
  walkTo(w, 1, 2);
  assert.equal(w.decoys.length, 2);
  const d = w.decoys[0];
  const [dx, dy] = [Math.round(d.x), Math.round(d.y)];
  w.items.push({ cx: dx, cy: dy, kind: 'bomb', age: 0 });
  run(w, none, 5);
  assert.equal(w.items.length, 1, 'a decoy picks nothing up');
  w.bombs.push({ id: 99, owner: 1, x: dx, y: dy, cx: dx, cy: dy, fuse: 1, range: 0, age: 0, state: 'ground', slide: 0, speed: 0, heldBy: -1, lifted: false, fromX: 0, fromY: 0, flyDir: 0, flyDist: 0, flyT: 0 });
  run(w, none);
  assert.ok(d.popped >= 0, 'a blast pops it');
  assert.ok(w.events.some((e) => e.type === 'poof' && e.player === 0));
  assert.ok(w.players[0].alive, 'its robot is fine');
}
{
  // its robot knocked out: its decoys go with it; a second decoy power-up replaces the first two
  const w = arena();
  const p = w.players[0];
  w.items.push({ cx: 2, cy: 1, kind: 'decoy', age: 0 });
  walkTo(w, 2, 1);
  w.items.push({ cx: 3, cy: 1, kind: 'decoy', age: 0 });
  walkTo(w, 3, 1);
  assert.equal(w.decoys.filter((d) => d.popped < 0).length, 2, 'two at a time');
  w.flames.push({ cx: 3, cy: 1, ttl: FLAME_TICKS, owner: 0, kind: 'c', tip: 0 });
  run(w, none);
  assert.ok(!p.alive);
  assert.ok(w.decoys.every((d) => d.popped >= 0), 'its decoys go when it is out');
}
{
  // the CPU players cannot tell a decoy from its robot: a Hard one bombs a decoy in its line
  const w = arena(2);
  w.players[0].x = 1;
  w.players[0].y = 1;
  w.players[1].x = 11;
  w.players[1].y = 9;
  const bombsBy = (o: World): number => o.bombs.filter((b) => b.owner === 0).length;
  const without = cloneWorld(w);
  const decoyed = cloneWorld(w);
  decoyed.decoys.push({ ...decoyed.players[1], x: 2, y: 1, mirror: false, born: 0, until: DECOY_TICKS, popped: -1 });
  for (const [o, want] of [
    [without, 0],
    [decoyed, 1],
  ] as const) {
    const bot = createBot(0, 'hard', 3);
    for (let t = 0; t < 8 && !bombsBy(o); t++) step(o, [botInput(o, bot)]);
    assert.equal(bombsBy(o), want, want ? 'bombs the decoy' : 'nothing in line without it');
  }
}

// ---------------------------------------------------------------- trip wires

{
  const w = arena();
  assert.equal(wireSpot(w, 1, 2), 'h', 'between the wall and a pillar, left and right');
  assert.equal(wireSpot(w, 2, 1), 'v', 'between the wall and a pillar, above and below');
  assert.equal(wireSpot(w, 3, 2), 'h', 'between two pillars');
  assert.equal(wireSpot(w, 1, 1), null, 'not at a crossing');
  assert.equal(wireSpot(w, 3, 3), null);
  assert.equal(wireSpot(w, 2, 2), null, 'not on a block');
}
{
  // holding one, B between two blocks strings it; anywhere else B does what it always does
  const w = arena();
  const p = w.players[0];
  w.items.push({ cx: 1, cy: 1, kind: 'wire', age: 0 });
  run(w, none);
  assert.equal(p.wires, 1);
  run(w, go(0, true));
  run(w, none);
  assert.equal(w.wires.length, 0, 'not at a crossing');
  assert.equal(p.wires, 1);
  walkTo(w, 1, 2);
  run(w, go(0, true));
  assert.deepEqual(w.wires.map((o) => [o.cx, o.cy, o.dir, o.owner, o.armed]), [[1, 2, 'h', 0, false]], 'strung, not yet armed');
  assert.ok(w.events.some((e) => e.type === 'wire' && e.player === 0));
  assert.equal(p.wires, 0);
  // armed once it has walked off; walking back into it sets it off, and catches it
  walkTo(w, 1, 1);
  assert.equal(w.wires[0].armed, true, 'armed once its tile is clear');
  let tripped = false;
  for (let i = 0; i < 30 && !tripped; i++) {
    run(w, go(2));
    tripped = w.events.some((e) => e.type === 'trip');
  }
  assert.ok(tripped, 'it walked into it');
  assert.equal(w.wires.length, 0, 'the wire is gone');
  assert.ok(!p.alive, 'the one who strung it is caught too');
  const death = w.events.find((e) => e.type === 'death');
  assert.ok(death && death.type === 'death' && death.cause === 'wire' && death.by === 0);
  // the blast: the whole column, wall to wall, and nothing beside it
  for (let y = 1; y <= w.h - 2; y++) assert.ok(flameOn(w, 1, y), `column 1, row ${y}`);
  assert.ok(!flameOn(w, 2, 1) && !flameOn(w, 3, 3), 'only its lane');
}
{
  // anyone trips it, and the blast is its owner's: it runs through bricks (burning them), sets off bombs and
  // barrels, and stops only at a solid block
  const w = arena(2);
  const p = w.players[0];
  const q = w.players[1];
  p.x = 1;
  p.y = 2;
  p.wires = 1;
  run(w, go(0, true));
  walkTo(w, 1, 1);
  walkTo(w, 3, 1);
  // bricks and a bomb further down the lane, a robot beyond them
  for (const y of [4, 6]) w.tiles[y * w.w + 1] = SOFT;
  w.bombs.push({ id: 50, owner: 0, x: 1, y: 8, cx: 1, cy: 8, fuse: FUSE_TICKS, range: 1, age: 0, state: 'ground', slide: 0, speed: 0, heldBy: -1, lifted: false, fromX: 0, fromY: 0, flyDir: 0, flyDist: 0, flyT: 0 });
  q.x = 1;
  q.y = 3;
  // q walks up into it
  let tripped = false;
  for (let i = 0; i < 40 && !tripped; i++) {
    step(w, [none, go(1)]);
    tripped = w.events.some((e) => e.type === 'trip');
  }
  assert.ok(tripped);
  const trip = w.events.find((e) => e.type === 'trip');
  assert.ok(trip && trip.type === 'trip' && trip.player === 1 && trip.owner === 0, 'tripped by one, owned by the other');
  const death = w.events.find((e) => e.type === 'death' && e.player === 1);
  assert.ok(death && death.type === 'death' && death.by === 0 && death.cause === 'wire', 'knocked out by the one who strung it');
  assert.ok(p.alive, 'off the lane, it is safe');
  assert.ok(w.burning.some((b) => b.cx === 1 && b.cy === 4) && w.burning.some((b) => b.cx === 1 && b.cy === 6), 'both bricks burn');
  assert.ok(flameOn(w, 1, 9), 'and on past them, to the wall');
  run(w, none, 6);
  assert.ok(!w.bombs.length, 'the bomb in the lane went off');
  assert.deepEqual(wireLane(w, { cx: 1, cy: 2, dir: 'h', owner: 0, armed: true, at: 0 }).length, w.h - 2, 'its lane: every tile of the column');
}
{
  // a bomb's blast does not set it off, a decoy does not trip it, and a falling block crushes it
  const w = createWorld({ seed: 5, players: [{ colorId: 'gold' }], softDensity: 0, roundTicks: 6000 });
  const p = w.players[0];
  p.x = 3;
  p.y = 2;
  p.wires = 1;
  run(w, go(0, true));
  walkTo(w, 3, 1);
  walkTo(w, 5, 1);
  w.flames.push({ cx: 3, cy: 2, ttl: FLAME_TICKS, owner: 0, kind: 'c', tip: 0 });
  run(w, none, FLAME_TICKS + 2);
  assert.equal(w.wires.length, 1, 'a blast leaves it be');
  w.decoys.push({ ...p, x: 3, y: 3, mirror: false, born: w.tick, until: w.tick + DECOY_TICKS, popped: -1, askDir: 0, askTicks: 0 });
  w.decoys[0].x = 3;
  w.decoys[0].y = 2.2;
  run(w, none, 2);
  assert.equal(w.wires.length, 1, 'nor does a decoy');
  w.decoys.length = 0;
  w.shrinkOrder = [2 * w.w + 3];
  w.shrinkNext = 0;
  w.roundTicks = w.tick + 1;
  for (let i = 0; i < 200 && w.tiles[2 * w.w + 3] !== HARD; i++) run(w, none);
  assert.equal(w.wires.length, 0, 'a block landing on it crushes it, and it does not go off');
}
{
  // with a laptop as well: between two blocks B strings the wire, anywhere else it flies the plane
  const w = arena();
  const p = w.players[0];
  p.laptop = true;
  p.wires = 1;
  p.x = 1;
  p.y = 2;
  run(w, go(0, true));
  assert.equal(w.wires.length, 1);
  assert.equal(p.flying, 0, 'the wire first');
  run(w, none);
  walkTo(w, 1, 1);
  run(w, go(0, true));
  assert.ok(p.flying > 0, 'then the plane');
}
{
  // Item Drop: trip wires not strung go down with the rest of the kit; coming back after a lost life, none
  const w = createWorld({ seed: 5, players: [{ colorId: 'gold' }, { colorId: 'blue' }], softDensity: 0, roundTicks: 0, itemDrop: true, lives: 2 });
  const p = w.players[0];
  p.wires = 2;
  w.flames.push({ cx: 1, cy: 1, ttl: FLAME_TICKS, owner: 1, kind: 'c', tip: 0 });
  run(w, none);
  assert.equal(w.items.filter((it) => it.kind === 'wire').length, 2, 'both dropped');
  assert.equal(p.wires, 0);
  w.items.length = 0;
  for (let i = 0; i < 3 * TICK_HZ && !p.alive; i++) run(w, none);
  assert.ok(p.alive && p.wires === 0, 'back with none');
}

// ---------------------------------------------------------------- CPU players

for (const level of BOT_LEVELS) {
  // a CPU player holding trip wires strings them now and then, and never walks into one, its own included
  for (let seed = 1; seed <= 3; seed++) {
    const w = createWorld({ roundTicks: 0, seed, players: [{ colorId: 'gold' }, { colorId: 'blue' }] });
    const bot = createBot(0, level, seed * 17 + 3);
    let strung = 0;
    for (let t = 0; t < 90 * TICK_HZ && !w.over; t++) {
      if (t % (20 * TICK_HZ) === 0) w.players[0].wires = MAX_WIRES;
      w.players[1].shieldTicks = SHIELD_TICKS; // (the other player cannot be knocked out: the round goes on)
      step(w, [botInput(w, bot)]);
      strung += w.events.filter((e) => e.type === 'wire').length;
    }
    assert.ok(w.players[0].alive, `${level}, arena ${seed}: still in`);
    assert.ok(strung > 0, `${level}, arena ${seed}: strung some (${strung})`);
  }
}

// ---------------------------------------------------------------- online

{
  const w = arena(2);
  const before = worldHash(w);
  const a = cloneWorld(w);
  a.players[0].x = 1;
  a.players[0].y = 2;
  a.players[0].wires = 1;
  step(a, [go(0, true)]);
  const b = cloneWorld(w);
  b.players[0].x = 1;
  b.players[0].y = 2;
  b.players[0].wires = 1;
  step(b, [none]);
  assert.notEqual(worldHash(a), worldHash(b), 'a wire is part of the checksum');
  const c = cloneWorld(w);
  c.items.push({ cx: 1, cy: 1, kind: 'decoy', age: 0 });
  step(c, [none]);
  assert.equal(c.decoys.length, 2);
  const back = decodeWorld(JSON.parse(JSON.stringify(encodeWorld(c))));
  assert.equal(worldHash(back), worldHash(c), 'decoys go whole over the wire');
  assert.notEqual(worldHash(c), before);
}

console.log('decoy and trip wire checks passed');
