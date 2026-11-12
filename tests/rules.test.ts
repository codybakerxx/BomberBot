/**
 * Checks of the game rules (src/sim.ts): the arena, movement and turning,
 * bombs, blasts, power-ups, kicking, lifting and throwing, and who wins.
 *
 * Each block builds a small world, feeds it inputs tick by tick and asserts
 * what must be true afterwards. No browser is involved.
 * Run with: npm test
 */
import assert from 'node:assert';
import {
  createWorld,
  step,
  World,
  PlayerInput,
  Dir,
  FLOOR,
  SOFT,
  HARD,
  FUSE_TICKS,
  FLAME_TICKS,
  BASE_SPEED,
  SPEED_STEP,
  MAX_SPEED_ITEMS,
  KICK_SPEED,
  LOOK_TICKS,
  START_FIRE,
  DEATH_TICKS,
  GHOST_TICKS,
  cloneWorld,
  KEEP_OPEN,
  keptOpen,
  TICK_HZ,
  ITEM_CHANCE,
  SHIELD_TICKS,
  SHIELD_GRACE_TICKS,
  CURSE_TICKS,
  CURSE_SPEED,
  ROUND_TICKS,
  SHRINK_TICKS,
  FALL_TICKS,
  blockLandTick,
  ticksLeft,
  playerSpeed,
  tileAt,
  makeRng,
} from '../src/sim';

/** no direction, no buttons */
const none: PlayerInput = { dir: 0, a: false, b: false };
/** advance the world `n` ticks with the same input for player 0 */
const run = (w: World, n: number, inp: PlayerInput = none): void => {
  for (let i = 0; i < n; i++) step(w, [inp]);
};
/**
 * Many checks below were written when robots walked at 0.062 tiles a tick.
 * ticks() scales a tick count from then to the current walking speed, so the
 * robot covers the same distance whatever BASE_SPEED is.
 */
const ticks = (n: number): number => Math.round((n * 0.062) / BASE_SPEED);

/** a two-player world with no bricks unless a density is given: player 0 top-left, player 1 bottom-right */
const mk = (density = 0): World =>
  createWorld({ roundTicks: 0, seed: 7, players: [{ colorId: 'gold' }, { colorId: 'blue' }], softDensity: density });

// 1. layout: border and pillars are hard, spawn corners are open
{
  const w = createWorld({ roundTicks: 0, seed: 1, players: [{ colorId: 'a' }, { colorId: 'b' }, { colorId: 'c' }, { colorId: 'd' }] });
  assert.equal(w.w, 15);
  assert.equal(w.h, 13);
  assert.equal(tileAt(w, 0, 5), HARD);
  assert.equal(tileAt(w, 2, 2), HARD);
  for (const p of w.players) {
    assert.equal(tileAt(w, p.x, p.y), FLOOR);
    const open = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => tileAt(w, p.x + dx, p.y + dy) === FLOOR);
    assert.equal(open.length, 2, 'each corner has two open neighbours');
  }
  assert.ok([...w.tiles].filter((t) => t === SOFT).length > 40);
  assert.ok(w.hidden.size > 5);
}

// 2. movement: walk right along the top row, stop at the wall, exactly centred
{
  const w = mk();
  run(w, ticks(600), { dir: 4, a: false, b: false });
  assert.equal(w.players[0].x, 13);
  assert.equal(w.players[0].y, 1);
  // pillars block: pressing down at column 2 slides to an open column instead of stopping
  const w2 = mk();
  run(w2, ticks(14), { dir: 4, a: false, b: false }); // x ≈ 1.87, in front of the pillar at (2,2)
  const x0 = w2.players[0].x;
  assert.ok(x0 > 1.5 && x0 < 2.4);
  run(w2, ticks(120), { dir: 2, a: false, b: false });
  assert.ok(Number.isInteger(w2.players[0].x) && w2.players[0].x % 2 === 1, 'slid into an open column');
  assert.ok(w2.players[0].y > 2, 'and carried on down');
}

// 3. bombs: one at a time, blocks you once you step off, explodes on time
{
  const w = mk();
  step(w, [{ dir: 0, a: true, b: false }]);
  assert.equal(w.bombs.length, 1);
  step(w, [{ dir: 0, a: false, b: false }]);
  step(w, [{ dir: 0, a: true, b: false }]);
  assert.equal(w.bombs.length, 1, 'only one bomb until an item is found');
  run(w, ticks(40), { dir: 4, a: false, b: false }); // walk off it
  assert.ok(w.players[0].x > 2);
  run(w, ticks(200), { dir: 3, a: false, b: false }); // try to walk back before/after blast
  // the starting blast reaches one tile along the top row, to x = 2, which is as far back as the bomb lets it walk
  assert.equal(w.players[0].alive, false, 'walking back into your own blast kills you');
}
// a starting blast reaches one tile each way; every flame power-up adds one more
{
  assert.equal(START_FIRE, 1);
  /** drop a bomb on (1,1) with `flames` flame power-ups picked up, stand `tiles` below it, and say whether the robot lives */
  const lives = (flames: number, tiles: number): boolean => {
    const w = mk();
    const p = w.players[0];
    assert.equal(p.fire, 1, 'a robot starts with a blast one tile long');
    for (let k = 0; k < flames; k++) {
      w.items.push({ cx: 1, cy: 1, kind: 'fire', age: 9 });
      step(w, [none]);
    }
    assert.equal(p.fire, 1 + flames, 'each flame power-up makes it one tile longer');
    step(w, [{ dir: 0, a: true, b: false }]);
    assert.equal(w.bombs[0].range, 1 + flames);
    p.y = 1 + tiles;
    run(w, FUSE_TICKS + FLAME_TICKS, none);
    assert.equal(w.bombs.length, 0);
    return p.alive;
  };
  assert.equal(lives(0, 1), false, 'the next tile is in a starting blast');
  assert.equal(lives(0, 2), true, 'two tiles away is clear of it');
  assert.equal(lives(1, 2), false, 'with one flame power-up two tiles away is in the blast');
  assert.equal(lives(1, 3), true, 'and three is clear');
  assert.equal(lives(2, 3), false, 'with two, three tiles away is in it');
  // exactly the four tiles next to the bomb, in the open
  const w = mk();
  const p = w.players[0];
  p.x = 3;
  p.y = 3;
  step(w, [{ dir: 0, a: true, b: false }]);
  p.x = 7;
  p.y = 7;
  run(w, FUSE_TICKS + 1, none);
  const lit = w.flames.map((f) => `${f.cx},${f.cy}`).sort();
  assert.deepEqual(lit, ['2,3', '3,2', '3,3', '3,4', '4,3'], 'a starting blast is a plus sign one tile each way');
}
{
  const w = mk();
  step(w, [{ dir: 0, a: true, b: false }]);
  run(w, ticks(70), { dir: 2, a: false, b: false }); // down to row 3+
  run(w, ticks(60), { dir: 4, a: false, b: false }); // then right along row 3 or 5
  run(w, FUSE_TICKS + FLAME_TICKS + 5, none);
  assert.equal(w.players[0].alive, true, 'hiding round a corner is safe');
  assert.equal(w.players[0].activeBombs, 0);
  assert.equal(w.flames.length, 0);
}

// 4. blasts break blocks, reveal items, items can be picked up, chains work
{
  const w = mk();
  const i = 1 * w.w + 3;
  w.tiles[i] = SOFT;
  w.hidden.set(i, 'fire');
  w.tiles[1 * w.w + 4] = SOFT; // behind the first block: must survive
  w.players[0].fire = 2; // as if one flame power-up had been picked up: the blast reaches the brick two tiles away
  step(w, [{ dir: 0, a: true, b: false }]);
  run(w, ticks(70), { dir: 2, a: false, b: false });
  run(w, ticks(60), { dir: 4, a: false, b: false });
  run(w, FUSE_TICKS + FLAME_TICKS + 5, none);
  assert.equal(w.tiles[i], FLOOR);
  assert.equal(w.tiles[1 * w.w + 4], SOFT, 'blast stops at the first block');
  assert.deepEqual(w.items.map((it) => it.kind), ['fire']);
  // go and fetch it
  const goto = (dir: Dir, n: number): void => run(w, ticks(n), { dir, a: false, b: false });
  goto(3, 80);
  goto(1, 80);
  goto(4, 60);
  assert.equal(w.players[0].fire, 3);
  assert.equal(w.items.length, 0);
}
{
  const w = mk();
  w.players[0].bombsMax = 2;
  step(w, [{ dir: 0, a: true, b: false }]);
  run(w, ticks(34), { dir: 4, a: false, b: false }); // to about x = 3
  step(w, [{ dir: 4, a: true, b: false }]);
  assert.equal(w.bombs.length, 2);
  run(w, ticks(200), { dir: 4, a: false, b: false });
  run(w, ticks(60), { dir: 2, a: false, b: false });
  // first bomb goes at 150; the second (placed 35 ticks later) must chain right after
  assert.equal(w.bombs.length, 0, 'second bomb chained early');
}

// 5. last one standing wins
{
  const w = mk();
  const target = w.players[1];
  w.players[0].x = target.x - 1;
  w.players[0].y = target.y;
  step(w, [{ dir: 0, a: true, b: false }]);
  run(w, ticks(60), { dir: 3, a: false, b: false });
  run(w, ticks(60), { dir: 1, a: false, b: false });
  run(w, FUSE_TICKS + 100, none);
  assert.equal(target.alive, false);
  assert.deepEqual(w.over, { winner: 0 });
}

// 6. same seed, same inputs, same result (needed for online play later)
{
  const play = (): string => {
    const w = createWorld({ roundTicks: 0, seed: 99, players: [{ colorId: 'a' }, { colorId: 'b' }] });
    for (let t = 0; t < 900; t++) {
      const dir = ((Math.floor(t / 37) * 7 + 3) % 5) as Dir;
      step(w, [{ dir, a: t % 211 === 5, b: false }]);
    }
    return JSON.stringify([w.players, [...w.tiles], w.items]);
  };
  assert.equal(play(), play());
}

// 7. kick: needs the power-up; then running into a bomb sends it sliding until something stops it
{
  for (const has of [false, true]) {
    const w = mk();
    const p = w.players[0];
    p.canKick = has;
    p.x = 5;
    step(w, [{ dir: 0, a: true, b: false }]);
    w.bombs[0].fuse = 10_000; // this check is about kicking, not the fuse: at walking speed the round trip outlasts it
    run(w, ticks(40), { dir: 4, a: false, b: false });
    run(w, ticks(40), { dir: 3, a: false, b: false });
    run(w, 40, none); // long enough for a slide of four tiles
    const b = w.bombs[0];
    if (has) {
      assert.equal(b.cx, 1, 'bomb slid left to the wall');
      assert.equal(b.slide, 0);
      assert.ok(p.x < 6 && p.x > 4);
    } else {
      assert.equal(b.cx, 5, 'no power-up, no kick');
      assert.equal(p.x, 6, 'the bomb blocks you instead');
    }
  }
}

// 8. grab and throw: needs the power-up; the fuse is set to 3 s on pick-up and keeps ticking
{
  const w0 = mk();
  step(w0, [{ dir: 0, a: true, b: false }]);
  step(w0, [{ dir: 0, a: false, b: true }]);
  assert.equal(w0.players[0].carrying, 0, 'no power-up, no lift');

  const w = mk();
  const p = w.players[0];
  p.canGrab = true;
  step(w, [{ dir: 0, a: true, b: false }]);
  step(w, [{ dir: 0, a: false, b: true }]);
  assert.ok(p.carrying, 'lifted the bomb under you');
  assert.equal(w.bombs[0].fuse, 179, 'three-second timer started');
  run(w, 5, { dir: 4, a: false, b: false }); // turn to face right (5 ticks, so the fuse drops by 5)
  assert.equal(w.bombs[0].fuse, 174, 'and it keeps ticking while carried');
  step(w, [{ dir: 0, a: false, b: true }]);
  assert.equal(p.carrying, 0);
  assert.equal(w.bombs[0].state, 'air');
  run(w, 30, none);
  assert.equal(w.bombs[0].state, 'ground');
  assert.deepEqual([w.bombs[0].cx, w.bombs[0].cy], [4, 1], 'landed three tiles ahead');
  // picking it up a second time does not restart the timer
  const before = w.bombs[0].fuse;
  p.x = 4;
  step(w, [none]);
  step(w, [{ dir: 0, a: false, b: true }]);
  assert.ok(p.carrying);
  assert.equal(w.bombs[0].fuse, before - 2);

  // hold on too long and it goes off in your hands
  const w4 = mk();
  w4.players[0].canGrab = true;
  step(w4, [{ dir: 0, a: true, b: false }]);
  step(w4, [{ dir: 0, a: false, b: true }]);
  run(w4, 170, none);
  assert.equal(w4.players[0].alive, true);
  run(w4, 15, none);
  assert.equal(w4.players[0].alive, false, 'exploded while carried');
  assert.equal(w4.bombs.length, 0);
  assert.equal(w4.players[0].activeBombs, 0);

  // thrown at the outer wall it comes back in on the far side
  const w2 = mk();
  const q = w2.players[0];
  q.canGrab = true;
  step(w2, [{ dir: 0, a: true, b: false }]);
  run(w2, ticks(17), { dir: 4, a: false, b: false });
  run(w2, ticks(3), { dir: 3, a: false, b: false });
  step(w2, [{ dir: 0, a: false, b: true }]);
  assert.ok(q.carrying, 'lifted a bomb from the tile next to you');
  step(w2, [none]);
  step(w2, [{ dir: 0, a: false, b: true }]);
  run(w2, 60, none);
  assert.equal(w2.bombs[0].state, 'ground');
  assert.deepEqual([w2.bombs[0].cx, w2.bombs[0].cy], [13, 1], 'wrapped round and skipped the wall');

  // carrier knocked out: bomb drops and chains
  const w3 = mk();
  w3.players[0].canGrab = true;
  step(w3, [{ dir: 0, a: true, b: false }]);
  step(w3, [{ dir: 0, a: false, b: true }]);
  w3.flames.push({ cx: 1, cy: 1, ttl: 5, owner: 1, kind: 'c', tip: 0 });
  run(w3, 40, none);
  assert.equal(w3.players[0].alive, false);
  assert.equal(w3.bombs.length, 0);
}

// 9. every arena hides at least one kick and one grab
for (let seed = 1; seed <= 40; seed++) {
  const w = createWorld({ roundTicks: 0, seed, players: [{ colorId: 'a' }, { colorId: 'b' }] });
  const kinds = [...w.hidden.values()];
  assert.ok(kinds.includes('kick') && kinds.includes('grab'));
}

// 10. by default you stop exactly where you let go; step assist is optional
{
  const right: PlayerInput = { dir: 4, a: false, b: false };
  const w0 = mk();
  step(w0, [right]);
  run(w0, 30, none);
  assert.ok(Math.abs(w0.players[0].x - (1 + BASE_SPEED)) < 1e-9, 'stops where you let go: one tick of walking');
  const on = (): World => createWorld({ roundTicks: 0, seed: 7, players: [{ colorId: 'a' }, { colorId: 'b' }], softDensity: 0, stepAssist: true });
  const w = on();
  step(w, [right]);
  run(w, ticks(30), none);
  assert.equal(w.players[0].x, 2);
  const w2 = on();
  run(w2, ticks(4), right);
  w2.flames.push({ cx: 2, cy: 1, ttl: 40, owner: 1, kind: 'c', tip: 0 });
  run(w2, ticks(12), none);
  assert.equal(w2.players[0].x, 1);
  assert.equal(w2.players[0].alive, true);
}

// 11. turning: running along a lane and asked to turn, the robot takes the next opening ahead
{
  const hold = (dir: Dir): PlayerInput => ({ dir, a: false, b: false });
  const lane = (): World => {
    const w = mk();
    w.players[0].x = 3;
    w.players[0].y = 1;
    return w;
  };
  // going down column 3, swipe left anywhere between the two openings (rows 1 and 3)
  for (let trigger = 1.05; trigger < 2.9; trigger += 0.05) {
    const w = lane();
    const p = w.players[0];
    while (p.y < trigger) step(w, [hold(2)]);
    const y0 = p.y;
    let wentUp = 0;
    for (let i = 0; i < 90 && p.x > 2.5; i++) {
      step(w, [hold(3)]);
      wentUp = Math.max(wentUp, y0 - p.y);
    }
    assert.ok(p.x <= 2.5, 'it does get to turn left');
    if (y0 - 1 > 0.5) {
      assert.equal(wentUp, 0, `never doubles back (swiped at y=${y0})`);
      assert.equal(p.y, 3, 'takes the opening ahead');
    } else {
      assert.ok(wentUp <= 0.5 + 1e-9, 'still on the tile with the opening: a small step back');
      assert.equal(p.y, 1);
    }
  }
  // zig-zag: going left along row 3, "down" swiped early waits for column 1 instead of turning back to column 3
  {
    const w = mk();
    const p = w.players[0];
    p.x = 3;
    p.y = 3;
    while (p.x > 2.45) step(w, [hold(3)]);
    let wentRight = 0;
    const x0 = p.x;
    for (let i = 0; i < 90 && p.y < 3.5; i++) {
      step(w, [hold(2)]);
      wentRight = Math.max(wentRight, p.x - x0);
    }
    assert.equal(wentRight, 0);
    assert.equal(p.x, 1);
    assert.ok(p.y >= 3.5);
  }
  // nothing to turn into ahead (bricks close the lane): go back to the opening that was passed
  {
    const w = lane();
    const p = w.players[0];
    w.tiles[3 * w.w + 3] = SOFT;
    while (p.y < 1.7) step(w, [hold(2)]);
    run(w, ticks(60), hold(3));
    assert.equal(p.y, 1);
    assert.ok(p.x < 3);
  }
  // nowhere to turn at all: stop on the next tile rather than half way
  {
    const w = mk();
    const p = w.players[0]; // column 1: the outer wall is on the left all the way down
    while (p.y < 1.3) step(w, [hold(2)]);
    run(w, ticks(60), hold(3));
    assert.equal(p.x, 1);
    assert.equal(p.y, 2);
    assert.equal(p.moving, false);
  }
  // standing still between two lanes: step to the nearest opening, as before
  {
    const w = lane();
    const p = w.players[0];
    while (p.y < 1.7) step(w, [hold(2)]);
    step(w, [none]);
    run(w, ticks(60), hold(3));
    assert.equal(p.y, 1);
    const w2 = lane();
    const q = w2.players[0];
    while (q.y < 2.3) step(w2, [hold(2)]);
    step(w2, [none]);
    run(w2, ticks(60), hold(3));
    assert.equal(q.y, 3);
  }
  // reversing is always immediate
  {
    const w = lane();
    const p = w.players[0];
    while (p.y < 1.7) step(w, [hold(2)]);
    const y0 = p.y;
    step(w, [hold(1)]);
    assert.ok(p.y < y0);
  }
}

// 12. random play never leaves the robot inside a wall, off the grid lines or jittering
{
  const rng = makeRng(2024);
  for (let game = 0; game < 30; game++) {
    const w = createWorld({ roundTicks: 0, seed: 100 + game, players: [{ colorId: 'a' }, { colorId: 'b' }], softDensity: game % 3 === 0 ? 0 : 0.5 });
    const p = w.players[0];
    let dir: Dir = 0;
    let holdFor = 0;
    let reversals = 0;
    let lastStep = [0, 0];
    for (let tick = 0; tick < 1500; tick++) {
      if (holdFor-- <= 0) {
        dir = Math.floor(rng() * 5) as Dir;
        holdFor = Math.floor(rng() * 40);
        reversals = 0;
        lastStep = [0, 0];
      }
      const ox = p.x;
      const oy = p.y;
      step(w, [{ dir, a: false, b: false }]);
      // (a position a hair off a tile centre may be tidied by less than a billionth of a tile)
      const sx = Math.abs(p.x - ox) < 1e-9 ? 0 : p.x - ox;
      const sy = Math.abs(p.y - oy) < 1e-9 ? 0 : p.y - oy;
      assert.ok(sx === 0 || sy === 0, 'one axis at a time');
      if (sx !== 0 || sy !== 0) assert.equal(p.heading, sx > 0 ? 4 : sx < 0 ? 3 : sy > 0 ? 2 : 1, 'heading matches the real movement');
      assert.ok(Math.abs(sx) + Math.abs(sy) <= 0.2);
      assert.ok(Math.abs(p.x - Math.round(p.x)) < 1e-9 || Math.abs(p.y - Math.round(p.y)) < 1e-9, 'always on a grid line');
      for (const cx of [Math.floor(p.x + 1e-9), Math.ceil(p.x - 1e-9)]) {
        for (const cy of [Math.floor(p.y + 1e-9), Math.ceil(p.y - 1e-9)]) assert.equal(tileAt(w, cx, cy), FLOOR, 'never inside a block');
      }
      if ((sx !== 0 || sy !== 0) && (Math.sign(sx) === -Math.sign(lastStep[0]) && sx !== 0 || Math.sign(sy) === -Math.sign(lastStep[1]) && sy !== 0)) reversals++;
      if (sx !== 0 || sy !== 0) lastStep = [sx, sy];
      assert.ok(reversals <= 1, 'holding one direction never makes the robot jitter back and forth');
    }
  }
}

// 13. speed: about 69% of the original walking speed to start (halved, then 25% faster, 12.5% faster and 2.5% slower), each speed power-up adds 0.0062, kicks slide at 8.4 tiles a second
{
  const right: PlayerInput = { dir: 4, a: false, b: false };
  assert.ok(Math.abs(BASE_SPEED - 0.031 * 1.25 * 1.125 * 0.975) < 1e-12, 'robots start at half the original 0.062 tiles a tick, plus 25%, plus 12.5%, less 2.5%');
  const w = mk();
  const p = w.players[0];
  run(w, 60, right);
  assert.ok(Math.abs(p.x - (1 + 60 * 0.04250390625)) < 1e-9, 'one second of walking covers about 2.55 tiles');

  // speed power-ups laid along the top row: each one picked up adds SPEED_STEP, up to MAX_SPEED_ITEMS
  const w2 = mk();
  const q = w2.players[0];
  for (let x = 2; x <= 9; x++) w2.items.push({ cx: x, cy: 1, kind: 'speed', age: 20 });
  const seen: number[] = [playerSpeed(q)];
  for (let i = 0; i < 2000 && q.x < 9; i++) {
    step(w2, [right]);
    if (playerSpeed(q) !== seen[seen.length - 1]) seen.push(playerSpeed(q));
  }
  assert.equal(q.speed, MAX_SPEED_ITEMS, 'eight picked up, six count');
  assert.equal(seen.length, MAX_SPEED_ITEMS + 1, 'speed went up once per power-up until the limit');
  for (let k = 0; k < seen.length; k++) assert.ok(Math.abs(seen[k] - (BASE_SPEED + k * SPEED_STEP)) < 1e-12, `step ${k}`);
  assert.ok(Math.abs(SPEED_STEP * TICK_HZ - 0.5) < 1e-12, 'each step adds 0.5 tiles a second');
  assert.equal(FLAME_TICKS, 27, 'a blast stays for 0.45 seconds');
  assert.ok(Math.abs(playerSpeed(q) - (0.04250390625 + 6 * 0.5 / 60)) < 1e-12, 'six take it to about 5.55 tiles a second');

  // a kicked bomb slides 0.14 tiles a tick: 30% slower than the original 0.2
  assert.ok(Math.abs(KICK_SPEED - 0.2 * 0.7) < 1e-12);
  const w3 = mk();
  const r3 = w3.players[0];
  r3.canKick = true;
  r3.x = 3;
  step(w3, [{ dir: 0, a: true, b: false }]);
  w3.bombs[0].fuse = 10_000;
  run(w3, ticks(40), { dir: 3, a: false, b: false }); // step off to the left, then come back and kick it right
  for (let i = 0; i < 400 && w3.bombs[0].slide === 0; i++) step(w3, [right]);
  const b = w3.bombs[0];
  assert.equal(b.slide, 4, 'kicked');
  const x0 = b.x;
  step(w3, [none]);
  assert.ok(Math.abs(b.x - x0 - KICK_SPEED) < 1e-9, 'slides 0.14 tiles in a tick');
  run(w3, 200, none);
  assert.equal(b.cx, 13, 'and still slides all the way to the wall');

  // at the starting speed you can still get clear of your first bomb: from the corner, two tiles right and one down
  const w4 = mk();
  const r4 = w4.players[0];
  step(w4, [{ dir: 0, a: true, b: false }]);
  let t = 1;
  while (r4.x < 3) {
    step(w4, [right]);
    t++;
  }
  while (r4.y < 2) {
    step(w4, [{ dir: 2, a: false, b: false }]);
    t++;
  }
  assert.ok(t < FUSE_TICKS - 40, `safe with ${FUSE_TICKS - t} ticks to spare`);
  run(w4, FUSE_TICKS + FLAME_TICKS, none);
  assert.equal(r4.alive, true);
}

// 14. no walking back through a bomb: it is passable only while you still count as standing on its tile
{
  const right: PlayerInput = { dir: 4, a: false, b: false };
  const left: PlayerInput = { dir: 3, a: false, b: false };
  const drop = (x: number): World => {
    const w = mk();
    w.players[0].x = x;
    step(w, [{ dir: 0, a: true, b: false }]);
    w.bombs[0].fuse = 10_000; // these checks are about walking, not the fuse
    return w;
  };

  // still on the bomb's tile: free to move about on it, in both directions
  {
    const w = drop(5);
    const p = w.players[0];
    while (p.x < 5.4) step(w, [right]);
    assert.equal(Math.round(p.x), 5);
    run(w, ticks(20), left);
    assert.ok(p.x < 4.9, 'walked back over the bomb and off the other side');
  }
  // stepped onto the next tile, even by a hair: the bomb is now solid
  {
    const w = drop(5);
    const p = w.players[0];
    while (p.x < 5.5) step(w, [right]);
    assert.equal(Math.round(p.x), 6, 'counts as standing on the next tile');
    const x0 = p.x;
    assert.ok(x0 < 5.6);
    run(w, ticks(30), left);
    assert.equal(p.x, x0, 'cannot move back toward the bomb at all');
    assert.equal(p.moving, false);
    assert.equal(w.bombs[0].cx, 5, 'and without the boot the bomb stays put');
    run(w, 10, right);
    assert.ok(p.x > x0, 'but can still walk away from it');
  }
  // the same up and down, and from the other side
  {
    const w = mk();
    const p = w.players[0];
    p.x = 1;
    p.y = 5;
    step(w, [{ dir: 0, a: true, b: false }]);
    w.bombs[0].fuse = 10_000;
    while (p.y > 4.5) step(w, [{ dir: 1, a: false, b: false }]);
    while (p.y > 4.45) step(w, [{ dir: 1, a: false, b: false }]);
    const y0 = p.y;
    run(w, ticks(30), { dir: 2, a: false, b: false });
    assert.equal(p.y, y0);
  }
  // nor can the bomb be got round by lining up with it from between two lanes
  {
    const w = drop(3);
    const p = w.players[0];
    while (p.x < 3.5) step(w, [right]); // on tile 4, leaning over tile 3; row 2 has a pillar under column 4
    const x0 = p.x;
    let furthestBack = x0;
    for (let i = 0; i < ticks(60); i++) {
      step(w, [{ dir: 2, a: false, b: false }]);
      furthestBack = Math.min(furthestBack, p.x);
    }
    assert.equal(furthestBack, x0, 'pressing down never slides back onto the bomb tile to use its opening');
    assert.equal(p.x, 5, 'it carries on to the next opening instead');
    assert.ok(p.y > 1);
    // and from a standstill, where the nearest opening would be the bomb's tile, it stays put
    const w2 = drop(3);
    const q = w2.players[0];
    while (q.x < 3.5) step(w2, [right]);
    step(w2, [none]);
    const qx = q.x;
    run(w2, ticks(30), { dir: 2, a: false, b: false });
    assert.equal(q.x, qx);
    assert.equal(q.y, 1);
  }
  // with the boot, pushing back into the bomb you have just stepped off kicks it away
  {
    const w = drop(5);
    const p = w.players[0];
    p.canKick = true;
    while (p.x < 5.5) step(w, [right]);
    step(w, [left]);
    assert.equal(w.bombs[0].slide, 3, 'kicked');
    run(w, 60, none);
    assert.equal(w.bombs[0].cx, 1, 'slid to the wall');
    run(w, ticks(40), left);
    assert.ok(p.x < 5, 'and the way back is clear once it has gone');
  }
  // a bomb thrown onto your tile does not trap you: you can walk off it
  {
    const w = mk();
    const p = w.players[0];
    p.x = 7;
    w.bombs.push({ id: 99, owner: 1, x: 7, y: 1, cx: 7, cy: 1, fuse: 10_000, range: 2, age: 0, state: 'ground', slide: 0, heldBy: -1, lifted: true, fromX: 0, fromY: 0, flyDir: 0, flyDist: 0, flyT: 0 });
    run(w, ticks(40), right);
    assert.ok(p.x > 8);
    run(w, ticks(60), left);
    assert.equal(p.x, 8, 'and then it blocks the way back');
  }
}


// 15. the robot looks the way it is asked to go, even when a block is in the way or it has to line up first
{
  const go = (dir: Dir): PlayerInput => ({ dir, a: false, b: false });
  /** a robot standing still at (x, y) in an empty arena */
  const at = (x: number, y: number): World => {
    const w = mk();
    w.players[0].x = x;
    w.players[0].y = y;
    return w;
  };

  // In a sideways corridor with a pillar above and below (column 2, row 3), a little off the middle
  // of the tile. Up and down are blocks. A quick swipe up or down turns the robot to look that way.
  for (const dir of [1, 2] as Dir[]) {
    const w = at(2.3, 3);
    const p = w.players[0];
    run(w, LOOK_TICKS, go(dir));
    assert.equal(p.facing, dir, `looks ${dir === 1 ? 'up' : 'down'} at the block`);
    assert.equal(p.x, 2.3, 'and a quick swipe does not move it at all');
    assert.equal(p.y, 3);
    assert.equal(p.moving, false);
  }
  // The same in an upright corridor with a pillar left and right (column 3, row 2).
  for (const dir of [3, 4] as Dir[]) {
    const w = at(3, 2.3);
    const p = w.players[0];
    run(w, LOOK_TICKS, go(dir));
    assert.equal(p.facing, dir, `looks ${dir === 3 ? 'left' : 'right'} at the block`);
    assert.equal(p.y, 2.3);
    assert.equal(p.x, 3);
  }
  // Looking one way and then the other, each a quick swipe: still on the spot.
  {
    const w = at(2.3, 3);
    const p = w.players[0];
    run(w, LOOK_TICKS, go(1));
    run(w, LOOK_TICKS, go(2));
    assert.equal(p.facing, 2);
    assert.equal(p.x, 2.3);
  }
  // The pause is only for leaving the tile. An opening on the tile it is standing on is taken at once.
  {
    const w = at(3, 2.8); // counts as standing on row 3, which is open to the left
    const p = w.players[0];
    step(w, [go(3)]);
    assert.ok(p.moving && p.y > 2.8, 'steps down to line up on the first tick');
  }
  // And none while running: the turn is lined up without a pause.
  {
    const w = at(1.5, 3);
    const p = w.players[0];
    while (p.x < 2.3) step(w, [go(4)]);
    const x0 = p.x;
    step(w, [go(1)]);
    assert.ok(p.x > x0, 'keeps running to the opening');
  }
  // Exactly on the middle of the tile it already did; it still does.
  {
    const w = at(2, 3);
    run(w, 3, go(1));
    assert.equal(w.players[0].facing, 1);
    assert.equal(w.players[0].moving, false);
  }
  // Holding the swipe still takes it round the block: after the pause it walks to the next opening and goes through.
  {
    const w = at(2.3, 3);
    const p = w.players[0];
    run(w, LOOK_TICKS + 1, go(1));
    assert.ok(p.moving && p.x > 2.3, 'sets off once the swipe has been held');
    run(w, ticks(40), go(1));
    assert.equal(p.x, 3, 'lined up with the opening at column 3');
    assert.ok(p.y < 2.5, 'and went up through it');
    assert.equal(p.facing, 1);
  }
  // Running down a lane and asked to turn before the opening: it looks the new way at once,
  // keeps running to the opening, and turns there.
  {
    const w = at(1, 1);
    const p = w.players[0];
    while (p.y < 1.7) step(w, [go(2)]);
    step(w, [go(4)]);
    assert.equal(p.facing, 4, 'looks right straight away');
    assert.ok(p.moving && p.heading === 2, 'while still running down');
    run(w, ticks(60), go(4));
    assert.equal(p.y, 3, 'took the opening at row 3');
    assert.ok(p.x > 1.5);
  }
  // So a bomb can be thrown over a block from between two of them.
  {
    const w = at(2.3, 3);
    const p = w.players[0];
    p.canGrab = true;
    step(w, [{ dir: 0, a: true, b: false }]);
    step(w, [none]);
    step(w, [{ dir: 0, a: false, b: true }]);
    assert.ok(p.carrying, 'lifted the bomb');
    step(w, [go(1)]);
    step(w, [none]);
    step(w, [{ dir: 0, a: false, b: true }]);
    const b = w.bombs[0];
    assert.equal(b.state, 'air');
    assert.equal(b.flyDir, 1, 'thrown up, over the pillar');
  }
}

// 16. the shield: survive one blast, or lose it after 30 seconds
{
  const pressA: PlayerInput = { dir: 0, a: true, b: false };
  /** a robot at (1,1) in an empty arena with a shield power-up lying on (2,1) */
  const withShield = (): World => {
    const w = mk();
    w.items.push({ cx: 2, cy: 1, kind: 'shield', age: 0 });
    while (w.players[0].x < 1.5) step(w, [{ dir: 4, a: false, b: false }]);
    return w;
  };
  /** drop a bomb, stand on it until it has gone off and its blast has cleared; say whether a shield took it */
  const standInBlast = (w: World): boolean => {
    let took = false;
    step(w, [pressA]);
    for (let i = 0; i < FUSE_TICKS + FLAME_TICKS + 2; i++) {
      step(w, [none]);
      if (w.events.some((e) => e.type === 'shield' && e.player === 0)) took = true;
    }
    return took;
  };

  // picking it up starts 30 seconds
  {
    const w = withShield();
    const p = w.players[0];
    assert.equal(w.items.length, 0, 'picked up');
    assert.equal(p.shieldTicks, SHIELD_TICKS);
    assert.equal(SHIELD_TICKS, 30 * TICK_HZ);
  }
  // it takes one blast: the robot stands in the whole of it and lives, and the shield is gone
  {
    const w = withShield();
    const p = w.players[0];
    assert.ok(standInBlast(w), 'the shield took the blast');
    assert.ok(p.alive, 'and the robot stood in all of it and lived');
    assert.equal(p.shieldTicks, 0, 'the shield is used up');
    assert.equal(w.flames.length, 0);
    // the next blast is not survived
    assert.ok(!standInBlast(w));
    assert.ok(!p.alive, 'a second blast knocks it out');
  }
  // the half second of safety after the shield goes is only that long
  {
    const w = withShield();
    const p = w.players[0];
    step(w, [pressA]);
    while (p.shieldTicks > 0 && p.alive) step(w, [none]);
    assert.ok(p.alive);
    assert.equal(p.graceTicks, SHIELD_GRACE_TICKS);
    assert.ok(SHIELD_GRACE_TICKS >= FLAME_TICKS, 'long enough for the blast that broke it to clear');
    assert.ok(SHIELD_GRACE_TICKS < TICK_HZ, 'and no longer than a second');
  }
  // not used: it wears off after 30 seconds, and then a blast knocks the robot out
  {
    const w = withShield();
    const p = w.players[0];
    run(w, SHIELD_TICKS - 1, none);
    assert.equal(p.shieldTicks, 1, 'still there just before 30 seconds');
    step(w, [none]);
    assert.equal(p.shieldTicks, 0, 'gone at 30 seconds');
    assert.ok(!standInBlast(w));
    assert.ok(!p.alive);
  }
  // a second shield does not stack: it only starts the 30 seconds again
  {
    const w = withShield();
    const p = w.players[0];
    run(w, 100, none);
    w.items.push({ cx: Math.round(p.x), cy: 1, kind: 'shield', age: 0 });
    step(w, [none]);
    assert.equal(p.shieldTicks, SHIELD_TICKS);
    assert.ok(standInBlast(w));
    assert.ok(!standInBlast(w), 'one blast, not two');
  }
}

// 17. the curse: 8 seconds at 85% of the starting speed, whatever speed power-ups the robot has
{
  const right: PlayerInput = { dir: 4, a: false, b: false };
  /** how far the robot moves in one tick, walking right along row 1 */
  const stride = (w: World): number => {
    const p = w.players[0];
    const x0 = p.x;
    step(w, [right]);
    return p.x - x0;
  };
  for (const boosts of [0, 3, 6]) {
    const w = mk();
    const p = w.players[0];
    p.speed = boosts;
    const usual = BASE_SPEED + boosts * SPEED_STEP;
    assert.ok(Math.abs(stride(w) - usual) < 1e-12);
    w.items.push({ cx: Math.round(p.x), cy: 1, kind: 'curse', age: 0 });
    step(w, [none]);
    assert.equal(p.curseTicks, CURSE_TICKS);
    assert.equal(CURSE_TICKS, 8 * TICK_HZ);
    assert.ok(Math.abs(stride(w) - BASE_SPEED * CURSE_SPEED) < 1e-12, `cursed with ${boosts} speed power-ups: slower than a robot with none`);
    assert.ok(BASE_SPEED * CURSE_SPEED < BASE_SPEED && CURSE_SPEED >= 0.8, 'slightly slower than the starting speed');
    run(w, CURSE_TICKS - 3, none);
    assert.ok(p.curseTicks > 0 && Math.abs(stride(w) - BASE_SPEED * CURSE_SPEED) < 1e-12, 'still slow just before 8 seconds');
    run(w, 2, none);
    assert.equal(p.curseTicks, 0);
    assert.ok(Math.abs(stride(w) - usual) < 1e-12, 'then back to its usual speed, power-ups and all');
    assert.equal(p.speed, boosts, 'the curse took no speed power-ups away');
  }
  // a second curse starts the 8 seconds again
  {
    const w = mk();
    const p = w.players[0];
    w.items.push({ cx: 1, cy: 1, kind: 'curse', age: 0 });
    run(w, 200, none);
    w.items.push({ cx: 1, cy: 1, kind: 'curse', age: 0 });
    step(w, [none]);
    assert.equal(p.curseTicks, CURSE_TICKS);
  }
}

// 18. how rare each power-up is
{
  const chance = Object.fromEntries(ITEM_CHANCE) as Record<string, number>;
  assert.deepEqual(ITEM_CHANCE.map(([k]) => k), ['bomb', 'fire', 'speed', 'kick', 'grab', 'shield', 'curse']);
  assert.ok(Math.abs(ITEM_CHANCE.reduce((s, [, c]) => s + c, 0) - 0.48) < 1e-12, '48% of bricks hide something');
  assert.equal(chance.shield, 0.01);
  assert.equal(chance.curse, 0.01);
  for (const k of ['bomb', 'fire', 'speed']) assert.ok(chance[k] >= 10 * chance.shield, `${k} is far commoner than a shield or a curse`);
  assert.equal(chance.kick, 0.025);
  assert.equal(chance.grab, 0.025);
  for (const k of ['kick', 'grab']) assert.ok(chance[k] > 2 * chance.shield, `${k} is rare, but not as rare as a shield or a curse`);
  for (const k of ['bomb', 'fire', 'speed']) assert.ok(chance[k] >= 4 * chance.kick, `${k} is at least four times as common as a boot or a glove`);

  // over many arenas: the counts match the chances, and shields and curses are missing from a good share of them
  const N = 3000;
  const total: Record<string, number> = {};
  const arenasWith: Record<string, number> = {};
  let bricks = 0;
  for (let seed = 1; seed <= N; seed++) {
    const w = createWorld({ roundTicks: 0, seed, players: [0, 1, 2, 3].map((i) => ({ colorId: String(i) })) });
    bricks += w.tiles.filter((t) => t === SOFT).length;
    const kinds = [...w.hidden.values()];
    for (const k of kinds) total[k] = (total[k] ?? 0) + 1;
    for (const k of new Set(kinds)) arenasWith[k] = (arenasWith[k] ?? 0) + 1;
  }
  for (const [k, c] of ITEM_CHANCE) {
    const share = total[k] / bricks;
    // boots and gloves run a touch over, because every arena is given one if the dice gave none
    assert.ok(Math.abs(share - c) < 0.004, `${k}: ${(share * 100).toFixed(2)}% of bricks, meant to be ${c * 100}%`);
  }
  assert.equal(arenasWith.kick, N, 'every arena has a boot');
  assert.equal(arenasWith.grab, N, 'every arena has a glove');
  for (const k of ['shield', 'curse']) {
    const share = arenasWith[k] / N;
    assert.ok(share > 0.45 && share < 0.65, `${k} turns up in about half of arenas (${(share * 100).toFixed(0)}%)`);
  }
}

// 19. the round timer and the falling blocks
{
  /** an arena with the timer on: 1 minute 30 unless told otherwise. Two players, no bricks unless a density is given. */
  const timed = (roundTicks?: number, density = 0, players = 2): World =>
    createWorld({ seed: 7, players: [...Array(players)].map((_, i) => ({ colorId: String(i) })), softDensity: density, roundTicks });
  const at = (w: World, x: number, y: number): number => y * w.w + x;
  const hard = (w: World): number => w.tiles.filter((t) => t === HARD).length;

  // the defaults: the timer counts down 1 minute 30, then the blocks take 50 seconds to fall, each 0.63 s in the air
  {
    const w = timed();
    assert.equal(ROUND_TICKS, 90 * TICK_HZ);
    assert.equal(SHRINK_TICKS, 50 * TICK_HZ);
    assert.equal(FALL_TICKS, 38);
    assert.equal(w.roundTicks, ROUND_TICKS);
    assert.equal(w.shrinkTicks, SHRINK_TICKS);
    assert.equal(ticksLeft(w), ROUND_TICKS);
    step(w, [none]);
    assert.equal(ticksLeft(w), ROUND_TICKS - 1, 'the timer counts down a tick at a time');
  }
  // a shorter timer changes when the blocks start, not how long they take; no timer means no blocks at all
  {
    const short = timed(60 * TICK_HZ);
    assert.equal(short.shrinkTicks, SHRINK_TICKS);
    assert.equal(blockLandTick(short, 0), 60 * TICK_HZ + FALL_TICKS);
    const w = timed(0);
    assert.equal(ticksLeft(w), Infinity);
    assert.equal(w.shrinkOrder.length, 0);
    run(w, 400, none);
    assert.equal(w.falling.length, 0);
  }
  // the order: round the edge from the top-left corner, clockwise, then one ring in; pillars are skipped, and a square in the middle is left alone
  {
    const w = timed();
    const xy = w.shrinkOrder.map((i) => [i % w.w, Math.floor(i / w.w)]);
    assert.deepEqual(xy.slice(0, 3), [[1, 1], [2, 1], [3, 1]], 'starts along the top row');
    assert.deepEqual(xy[12], [13, 1], 'reaches the top-right corner');
    assert.deepEqual(xy[13], [13, 2], 'turns down the right side');
    assert.deepEqual(xy[43], [1, 2], 'the first ring ends just under where it began');
    assert.deepEqual(xy[44], [3, 2], 'the second ring starts one in, past the pillar at 2,2');
    // three whole rings (44, 18 and 28 blocks), then only the two columns either side of the square that stays open
    assert.deepEqual(xy.slice(90), [[10, 5], [10, 7], [4, 7], [4, 5]], 'the last four close the sides of the 7 by 5 that three rings leave');
    assert.equal(xy.length, 94);
    assert.equal(new Set(w.shrinkOrder).size, w.shrinkOrder.length, 'each once');
    // the square left open: 5 by 5 in the middle, columns 5 to 9 and rows 4 to 8
    assert.equal(KEEP_OPEN, 5);
    for (let y = 1; y < w.h - 1; y++) {
      for (let x = 1; x < w.w - 1; x++) {
        const inside = x >= 5 && x <= 9 && y >= 4 && y <= 8;
        assert.equal(keptOpen(w.w, w.h, y * w.w + x), inside);
        if (inside) assert.ok(!w.shrinkOrder.includes(y * w.w + x), `no block ever falls on ${x},${y}`);
      }
    }
  }
  // timing: nothing until the timer reaches 0; that moment the first block starts to fall; then one at a
  // time at an even pace; the last lands 50 seconds after 0:00
  {
    const w = timed();
    const before = hard(w);
    const n = w.shrinkOrder.length;
    assert.equal(blockLandTick(w, 0), ROUND_TICKS + FALL_TICKS, 'the first block starts to fall at 0:00, so it lands a fall later');
    assert.equal(blockLandTick(w, n - 1), ROUND_TICKS + SHRINK_TICKS, 'the last block lands 50 seconds after 0:00');
    for (let k = 1; k < n; k++) {
      const gap = blockLandTick(w, k) - blockLandTick(w, k - 1);
      assert.ok(gap === 31 || gap === 32, `block ${k} lands about half a second after the one before`);
    }
    w.players.forEach((p) => { p.x = 7; p.y = 5; }); // out of the way for now
    run(w, ROUND_TICKS - 1, none);
    assert.equal(ticksLeft(w), 1);
    assert.equal(w.falling.length, 0, 'nothing in the air while the timer is running');
    assert.equal(hard(w), before, 'and not a block has fallen');
    step(w, [none]);
    assert.equal(ticksLeft(w), 0);
    assert.deepEqual(w.falling, [{ cx: 1, cy: 1, landAt: blockLandTick(w, 0) }], 'as the timer reaches 0 the first block is in the air over the top-left corner');
    assert.equal(w.tiles[at(w, 1, 1)], FLOOR, 'and has not landed yet');
    run(w, FALL_TICKS - 1, none);
    assert.equal(w.tiles[at(w, 1, 1)], FLOOR);
    step(w, [none]);
    assert.equal(w.tiles[at(w, 1, 1)], HARD, 'it lands and the tile is a solid block');
    assert.ok(w.events.some((e) => e.type === 'block' && e.cx === 1 && e.cy === 1), 'and says so');
    assert.equal(hard(w), before + 1, 'one at a time');
  }
  // 50 seconds after 0:00 everything is solid except the 5 by 5 in the middle, which is untouched; then the blocks stop
  {
    const w = timed(undefined, 0.78, 1);
    const p = w.players[0];
    p.x = 7;
    p.y = 5; // (7,5) is inside the square
    const before = [...w.tiles];
    const hiddenBefore = new Map(w.hidden);
    run(w, ROUND_TICKS + SHRINK_TICKS, none);
    for (let i = 0; i < w.tiles.length; i++) {
      if (keptOpen(w.w, w.h, i)) assert.equal(w.tiles[i], before[i], 'inside the square nothing has changed');
      else assert.equal(w.tiles[i], HARD, 'outside it everything is solid');
    }
    for (const [i, kind] of hiddenBefore) assert.equal(w.hidden.get(i), keptOpen(w.w, w.h, i) ? kind : undefined, 'power-ups under bricks in the square are still there');
    assert.equal(w.tiles.filter((t, i) => keptOpen(w.w, w.h, i) && t !== HARD).length, 19, '19 tiles to fight in: 25 less 6 pillars');
    assert.equal(w.falling.length, 0);
    assert.equal(ticksLeft(w), 0);
    assert.ok(p.alive, 'a robot in the square is still in');
    const solid = hard(w);
    run(w, 10 * TICK_HZ, none);
    assert.equal(ticksLeft(w), 0, 'the timer stays at 0');
    assert.equal(hard(w), solid, 'and no more blocks fall');
    assert.ok(p.alive && !w.over, 'the round goes on');
  }
  // what a landing block does to what is on its tile
  {
    const w = timed(undefined, 0, 3);
    const [a, b, c] = w.players;
    const land = blockLandTick(w, 2); // the third block, on (3,1)
    w.tick = land - 60;
    w.shrinkNext = 2; // the first two count as fallen already
    a.x = 3; a.y = 1; a.shieldTicks = 600; // standing on it, with a shield
    b.x = 3.6; b.y = 1; // counts as standing on the next tile (4,1), leaning over this one
    c.x = 7; c.y = 5;
    w.items.push({ cx: 3, cy: 1, kind: 'fire', age: 9 });
    w.tiles[at(w, 3, 1)] = FLOOR;
    step(w, [none, none, { dir: 0, a: true, b: false }]);
    const bomb = w.bombs[0];
    bomb.x = bomb.cx = 3; bomb.y = bomb.cy = 1; bomb.fuse = 10_000; // someone's bomb is lying on it too
    assert.equal(c.activeBombs, 1);
    while (w.tick < land) step(w, [none]);
    assert.equal(w.tiles[at(w, 3, 1)], HARD);
    assert.ok(!a.alive, 'a robot under the block is knocked out');
    assert.ok(w.events.some((e) => e.type === 'death' && e.player === 0 && e.cause === 'block' && e.by === -1));
    assert.equal(a.shieldTicks > 0, true, 'a shield does not stop a block: it was not even used');
    assert.ok(b.alive && b.x === 4 && b.y === 1, 'a robot leaning over from the next tile is pushed back onto its own');
    assert.equal(w.items.length, 0, 'a power-up on the tile is gone');
    assert.equal(w.bombs.length, 0, 'a bomb on the tile is gone, without going off');
    assert.equal(w.flames.length, 0);
    assert.equal(c.activeBombs, 0, 'and its owner has it back');
  }
  // a blast now says whose it was
  {
    const w = mk();
    step(w, [{ dir: 0, a: true, b: false }]);
    let seen = false;
    for (let i = 0; i < FUSE_TICKS + 2; i++) {
      step(w, [none]);
      if (w.events.some((e) => e.type === 'death' && e.player === 0 && e.cause === 'blast' && e.by === 0)) seen = true;
    }
    assert.ok(seen);
  }
  // who wins when blocks decide it
  {
    // one player further along the falling order than the other: it outlasts the other and wins,
    // even though a block gets it too before the result would have been declared
    const w = timed();
    const [a, b] = w.players;
    a.x = 1; a.y = 1; // first tile to go
    b.x = 2; b.y = 1; // second
    while (!w.over && w.tick < ROUND_TICKS + SHRINK_TICKS) step(w, [none, none]);
    assert.ok(!a.alive && !b.alive);
    assert.deepEqual(w.over, { winner: 1 }, 'the one who lasted longer wins');
    assert.equal(w.tick, blockLandTick(w, 1), 'decided the moment the second block landed');
  }
  {
    // both under the same block: a draw
    const w = timed();
    w.players.forEach((p) => { p.x = 13; p.y = 1; });
    while (!w.over && w.tick < ROUND_TICKS + SHRINK_TICKS) step(w, [none, none]);
    assert.deepEqual(w.over, { winner: -1 });
  }
  {
    // both in the square when the blocks stop: nobody has lost, so the round is not over. It ends when one of them goes.
    const w = timed();
    const [a, b] = w.players;
    a.x = 5; a.y = 5;
    b.x = 9; b.y = 7;
    run(w, ROUND_TICKS + SHRINK_TICKS + 5 * TICK_HZ, none);
    assert.equal(w.over, null, 'still going after the blocks have stopped');
    step(w, [{ dir: 0, a: true, b: false }, none]); // a drops a bomb and stands on it
    run(w, FUSE_TICKS + 60, none);
    assert.deepEqual(w.over, { winner: 1 }, 'the one left standing wins, however long it takes');
  }
  // the same seed still gives the same round, blocks and all
  {
    const play = (): string => {
      const w = createWorld({ seed: 5, players: [{ colorId: 'a' }, { colorId: 'b' }] });
      const rng = makeRng(99);
      for (let t = 0; t < ROUND_TICKS + 20 * TICK_HZ; t++) {
        step(w, [0, 1].map(() => ({ dir: Math.floor(rng() * 5) as Dir, a: rng() < 0.02, b: false })));
      }
      return JSON.stringify({ ...w, tiles: [...w.tiles], hidden: [...w.hidden] });
    };
    assert.equal(play(), play());
  }
}

// 20. once a round is decided, nothing more happens to the winner, and no more blocks start to fall
{
  const w = createWorld({ seed: 7, players: [{ colorId: 'a' }, { colorId: 'b' }], softDensity: 0, roundTicks: 10 * TICK_HZ });
  const [a, b] = w.players;
  a.x = 3; a.y = 3;
  b.x = 9; b.y = 9;
  step(w, [{ dir: 0, a: true, b: false }, none]); // a drops a bomb and stands on it
  run(w, FUSE_TICKS + 60, none);
  assert.deepEqual(w.over, { winner: 1 });
  assert.equal(DEATH_TICKS, 90, 'the knocked-out animation has a second and a half');
  assert.ok(a.deadTicks >= 55 && a.deadTicks <= 62, 'and counts up from the knock-out');
  {
    // it goes on counting past the animation, for the ghost, and stops at GHOST_TICKS
    const c = cloneWorld(w);
    run(c, GHOST_TICKS + 30, none);
    assert.equal(c.players[0].deadTicks, GHOST_TICKS, 'the count stops once the ghost has had time to float off the screen');
    assert.ok(GHOST_TICKS > DEATH_TICKS);
  }
  // a blast on the winner's tile
  w.flames.push({ cx: 9, cy: 9, ttl: 20, owner: 0, kind: 'c', tip: 0 });
  run(w, 5, none);
  assert.ok(b.alive, 'a blast after the round is decided does not touch the winner');
  // the timer runs out: no blocks
  const solid = w.tiles.filter((tile) => tile === HARD).length;
  run(w, 20 * TICK_HZ, none);
  assert.equal(w.falling.length, 0);
  assert.equal(w.tiles.filter((tile) => tile === HARD).length, solid, 'no blocks fall after the round is decided');
  assert.ok(b.alive);
  assert.deepEqual(w.over, { winner: 1 }, 'and the result stands');
}
