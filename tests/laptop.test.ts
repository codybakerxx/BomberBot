/**
 * Checks of the laptop power-up and its plane (src/sim.ts: `launch`, `flyPlane`, `moveDrops`): picking it up,
 * B flying the plane, the robot standing still, steering at any angle with smooth turns, three bombs that fall,
 * drift on and go off where they land, the laptop used up afterwards, and the plane's moves being worked out
 * with plain arithmetic so every copy of a round agrees.
 * Run with: npm test
 */
import assert from 'node:assert';
import {
  createWorld,
  step,
  World,
  PlayerInput,
  ITEM_CHANCE,
  SOFT,
  FLOOR,
  HARD,
  PLANE_TICKS,
  PLANE_SPEED,
  PLANE_TURN,
  PLANE_BOMBS,
  PLANE_FIRST_GAP,
  PLANE_DROP_GAP,
  PLANE_AFTER,
  PLANE_STEP,
  TURN_STEPS,
  AIM_STEPS,
  DROP_TICKS,
  DROP_DRAG,
  FLAME_TICKS,
  FUSE_TICKS,
  DROP_FIRE,
  cloneWorld,
  dropLanding,
  tileAt,
  ItemKind,
} from '../src/sim';
import { packInput, tickCodes, tickText, unpackInput, worldHash } from '../src/net';
import { botInput, createBot } from '../src/bot';

const none: PlayerInput = { dir: 0, a: false, b: false };
const press = (o: Partial<PlayerInput>): PlayerInput => ({ ...none, ...o });
/** two players, no bricks, no timer: player 0 at (1, 1), player 1 at the far corner */
const mk = (): World => createWorld({ roundTicks: 0, seed: 7, players: [{ colorId: 'gold' }, { colorId: 'blue' }], softDensity: 0 });
/** a world with player 0 holding a laptop, facing `facing` */
function holding(facing: 1 | 2 | 3 | 4 = 4): World {
  const w = mk();
  w.players[0].laptop = true;
  w.players[0].facing = facing;
  return w;
}
const run = (w: World, n: number, inp: PlayerInput = none): void => {
  for (let i = 0; i < n; i++) step(w, [inp]);
};
/** the tick B is pressed: the plane takes off */
function takeOff(w: World): void {
  step(w, [press({ b: true })]);
  step(w, [none]);
}

// the plane's moves: a table of headings made with + - * / only, matching cosine and sine to the last bit or two
{
  assert.equal(PLANE_STEP.length, TURN_STEPS);
  for (let h = 0; h < TURN_STEPS; h++) {
    const a = (h * 2 * Math.PI) / TURN_STEPS;
    assert.ok(Math.abs(PLANE_STEP[h][0] - Math.cos(a) * PLANE_SPEED) < 1e-15, `x at ${h}`);
    assert.ok(Math.abs(PLANE_STEP[h][1] - Math.sin(a) * PLANE_SPEED) < 1e-15, `y at ${h}`);
  }
  // right, down, left, up exactly
  assert.deepStrictEqual(PLANE_STEP[0].map(Math.abs), [PLANE_SPEED, 0]);
  assert.deepStrictEqual(PLANE_STEP[TURN_STEPS / 4].map(Math.abs), [0, PLANE_SPEED]);
}

// every arena has a laptop under some brick (unless the lobby has switched them off), and it is the last kind
{
  assert.equal(ITEM_CHANCE[ITEM_CHANCE.length - 1][0], 'laptop', 'new kinds go at the end');
  for (let seed = 1; seed <= 40; seed++) {
    const w = createWorld({ seed, players: [{ colorId: 'a' }, { colorId: 'b' }] });
    assert.ok([...w.hidden.values()].includes('laptop'), `seed ${seed} has a laptop`);
  }
  const off = ITEM_CHANCE.map(([k, c]): [ItemKind, number] => [k, k === 'laptop' ? 0 : c]);
  for (let seed = 1; seed <= 20; seed++) {
    const w = createWorld({ seed, players: [{ colorId: 'a' }, { colorId: 'b' }], itemChance: off });
    assert.ok(![...w.hidden.values()].includes('laptop'), 'switched off: none');
  }
}

// picking one up: the robot holds a laptop
{
  const w = mk();
  w.items.push({ cx: 2, cy: 1, kind: 'laptop', age: 0 });
  let picked = false;
  for (let i = 0; i < 60 && !picked; i++) {
    step(w, [press({ dir: 4 })]);
    picked = w.events.some((e) => e.type === 'pickup' && e.kind === 'laptop');
  }
  assert.ok(picked);
  assert.equal(w.players[0].laptop, true);
}

// B flies the plane: it takes off from the robot the way it faces; the robot stays put whatever is held
{
  const w = holding(4);
  step(w, [press({ b: true })]);
  const p = w.players[0];
  assert.ok(w.events.some((e) => e.type === 'launch' && e.player === 0));
  assert.equal(p.flying, PLANE_TICKS);
  assert.equal(p.planeBombs, PLANE_BOMBS);
  assert.ok(p.planeX === 1 && p.planeY === 1, 'from the robot');
  run(w, 30, press({ dir: 2 }));
  assert.equal(p.x, 1);
  assert.equal(p.y, 1, 'the robot does not walk while it flies');
  assert.equal(p.moving, false);
  assert.ok(Math.abs(p.planeX - (1 + 30 * PLANE_SPEED)) < 1e-9 && p.planeY === 1, 'no aim: it flies straight on, the way the robot faced');
  assert.equal(p.flying, PLANE_TICKS - 30);
}

// steering: it turns towards the aim a little each tick, the short way round, then flies that way
{
  const w = holding(4);
  takeOff(w);
  const p = w.players[0];
  const down = AIM_STEPS / 4;
  step(w, [press({ aim: down })]);
  assert.equal(p.planeDir, PLANE_TURN, 'one tick: a little way round, clockwise');
  run(w, TURN_STEPS / 4 / PLANE_TURN, press({ aim: down }));
  assert.equal(p.planeDir, TURN_STEPS / 4, 'then pointing down');
  const y = p.planeY;
  run(w, 5, press({ aim: down }));
  assert.ok(Math.abs(p.planeY - y - 5 * PLANE_SPEED) < 1e-9, 'and flying down');
  // from down, left is the short way round clockwise; from right, up is anticlockwise
  step(w, [press({ aim: AIM_STEPS / 2 })]);
  assert.equal(p.planeDir, TURN_STEPS / 4 + PLANE_TURN, 'down to left: clockwise');
  const w2 = holding(4);
  takeOff(w2);
  step(w2, [press({ aim: (AIM_STEPS * 3) / 4 })]);
  assert.equal(w2.players[0].planeDir, TURN_STEPS - PLANE_TURN, 'right to up: anticlockwise');
  // an aim that is not a whole number in range is ignored
  const before = w2.players[0].planeDir;
  step(w2, [press({ aim: 99 })]);
  step(w2, [press({ aim: 1.5 })]);
  assert.equal(w2.players[0].planeDir, before);
}

// it wraps round the edges of the map, as a thrown bomb does
{
  const w = holding(3);
  takeOff(w);
  run(w, 40);
  const p = w.players[0];
  assert.ok(p.planeX > w.w - 3, `came round from the left edge to the right (${p.planeX})`);
}

// bombs: not in the first half second, then one per press of A, a third of a second apart; three in all
{
  const w = holding(4);
  takeOff(w);
  const p = w.players[0];
  const tap = (): boolean => {
    step(w, [press({ a: true })]);
    const dropped = w.events.some((e) => e.type === 'drop');
    step(w, [none]);
    return dropped;
  };
  assert.equal(tap(), false, 'too soon after taking off');
  run(w, PLANE_FIRST_GAP);
  assert.equal(tap(), true);
  assert.equal(p.planeBombs, PLANE_BOMBS - 1);
  assert.equal(tap(), false, 'too soon after the last');
  run(w, PLANE_DROP_GAP);
  assert.equal(tap(), true);
  run(w, PLANE_DROP_GAP);
  assert.equal(tap(), true);
  assert.equal(p.planeBombs, 0);
  assert.ok(p.flying <= PLANE_AFTER, 'last bomb away: home soon');
  run(w, PLANE_AFTER);
  assert.equal(p.flying, 0);
  assert.equal(p.laptop, false, 'the laptop is used up');
}

// a dropped bomb falls DROP_TICKS, drifting on and slowing, and goes off where it lands
{
  const w = holding(4);
  takeOff(w);
  run(w, PLANE_FIRST_GAP);
  const p = w.players[0];
  step(w, [press({ a: true })]);
  assert.equal(w.drops.length, 1);
  const d0 = { ...w.drops[0] };
  // where it should land: the plane's speed, keeping DROP_DRAG of it each tick (its first move came on the same tick)
  let x = p.planeX;
  let v = PLANE_SPEED;
  for (let k = 0; k < DROP_TICKS; k++) {
    x += v;
    v *= DROP_DRAG;
  }
  const lx = Math.round(x);
  assert.ok(x - d0.x > 0.8 && x - d0.x < 1.0, `lands about 0.9 of a tile on (${(x - d0.x).toFixed(2)})`);
  // the other robot stands right there
  const q = w.players[1];
  q.x = lx;
  q.y = 1;
  let went = -1;
  for (let k = 0; k < DROP_TICKS && went < 0; k++) {
    step(w, [none]);
    if (w.events.some((e) => e.type === 'explode')) went = k;
  }
  assert.ok(went >= 0, 'it went off');
  assert.equal(w.drops.length, 0);
  assert.ok(w.flames.some((f) => f.cx === lx && f.cy === 1 && f.kind === 'c' && f.owner === 0), 'in the pilot\'s name');
  assert.ok(w.flames.some((f) => f.cx === lx + 1 && f.cy === 1), 'reaching a tile each way');
  assert.ok(!w.flames.some((f) => f.cx === lx + 2 && f.cy === 1), 'and no further');
  step(w, [none]);
  assert.equal(q.alive, false, 'and knocks the robot there out');
}

// onto a brick: the brick takes the blast and burns, nothing beside it is touched
{
  const w = holding(4);
  takeOff(w);
  run(w, PLANE_FIRST_GAP);
  step(w, [press({ a: true })]);
  // where it lands: found by playing a copy on
  const copy = cloneWorld(w);
  run(copy, DROP_TICKS);
  const at = copy.flames.find((f) => f.kind === 'c')!;
  w.tiles[at.cy * w.w + at.cx] = SOFT;
  run(w, DROP_TICKS);
  assert.ok(w.burning.some((b) => b.cx === at.cx && b.cy === at.cy), 'the brick burns');
  assert.equal(w.flames.length, 0, 'no fire anywhere else');
  run(w, FLAME_TICKS + 1);
  assert.equal(w.tiles[at.cy * w.w + at.cx], FLOOR);
}

// a bomb on the floor where one lands goes off moments later
{
  const w = holding(4);
  takeOff(w);
  run(w, PLANE_FIRST_GAP);
  step(w, [press({ a: true })]);
  const copy = cloneWorld(w);
  run(copy, DROP_TICKS);
  const at = copy.flames.find((f) => f.kind === 'c')!;
  w.bombs.push({ id: 99, owner: 1, x: at.cx, y: at.cy, cx: at.cx, cy: at.cy, fuse: FUSE_TICKS, range: 2, age: 0, state: 'ground', slide: 0, heldBy: -1, lifted: false, fromX: 0, fromY: 0, flyDir: 0, flyDist: 0, flyT: 0 });
  w.players[1].activeBombs = 1;
  run(w, DROP_TICKS + 10);
  assert.equal(w.bombs.length, 0, 'set off');
}

// B brings it home early; the laptop is used up, and B lifts bombs again (with the glove), never flies twice
{
  const w = holding(4);
  takeOff(w);
  run(w, 10);
  step(w, [press({ b: true })]);
  const p = w.players[0];
  assert.ok(w.events.some((e) => e.type === 'home'));
  assert.equal(p.flying, 0);
  assert.equal(p.laptop, false);
  step(w, [none]);
  step(w, [press({ b: true })]);
  assert.ok(!w.events.some((e) => e.type === 'launch'), 'no second flight');
}

// with the glove and a laptop, B flies the plane: the bomb beside the robot stays where it is
{
  const w = holding(4);
  const p = w.players[0];
  p.canGrab = true;
  step(w, [press({ a: true })]); // a bomb on its own tile
  step(w, [none]);
  step(w, [press({ b: true })]);
  assert.ok(w.events.some((e) => e.type === 'launch'));
  assert.equal(p.carrying, 0, 'not lifted');
}

// knocked out while flying: the plane is gone; with a life left the robot comes back with no laptop
{
  const w = createWorld({ roundTicks: 0, seed: 7, players: [{ colorId: 'gold' }, { colorId: 'blue' }], softDensity: 0, lives: 2 });
  const p = w.players[0];
  p.laptop = true;
  takeOff(w);
  step(w, [press({ a: true })]); // (too soon for a bomb: nothing happens)
  step(w, [none]);
  w.flames.push({ cx: 1, cy: 1, ttl: 5, owner: 1, kind: 'c', tip: 0 });
  step(w, [none]);
  assert.equal(p.alive, false);
  assert.equal(p.flying, 0);
  assert.equal(p.laptop, false);
  run(w, 200);
  assert.equal(p.alive, true, 'back');
  assert.equal(p.laptop, false);
}

// once the round is decided the plane comes home
{
  const w = holding(4);
  takeOff(w);
  w.players[1].alive = false;
  w.players[1].lives = 0;
  run(w, 60);
  assert.ok(w.over);
  assert.equal(w.players[0].flying, 0);
}

// the same presses give the same flight on every copy, and the steering gets through online
{
  const a = holding(4);
  const b = holding(4);
  const inputs: PlayerInput[] = [];
  for (let t = 0; t < 400; t++) {
    inputs.push(t === 1 ? press({ b: true }) : { ...none, aim: (t * 7) % AIM_STEPS, a: t % 50 === 40 });
  }
  for (const inp of inputs) {
    step(a, [inp]);
    // through the online encoding, as the server sends it
    const codes = tickCodes(tickText([packInput(inp), 0]));
    step(b, codes.map(unpackInput));
  }
  assert.equal(worldHash(a), worldHash(b));
  assert.ok(a.players[0].flying === 0 || a.players[0].planeBombs < PLANE_BOMBS, 'it flew and dropped');
  // the encoding: a steering press is two characters, anything else one, and they read back the same
  for (const inp of [none, press({ dir: 3, a: true }), press({ aim: 0 }), press({ aim: 63, b: true, dir: 2 }), press({ aim: 17, a: true })]) {
    const back = unpackInput(tickCodes(tickText([packInput(inp)]))[0]);
    assert.deepStrictEqual(back, { dir: inp.dir, a: inp.a, b: inp.b, ...(inp.aim !== undefined ? { aim: inp.aim } : {}) });
  }
  assert.equal(tickText([packInput(none), packInput(press({ aim: 5 })), packInput(none)]).length, 4);
}

// the world checksum notices the plane
{
  const a = holding(4);
  takeOff(a);
  const b = cloneWorld(a);
  b.players[0].planeX += 1e-9;
  assert.notEqual(worldHash(a), worldHash(b));
  const c = cloneWorld(a);
  c.drops.push({ x: 3, y: 3, vx: 0, vy: 0, t: 5, owner: 0 });
  assert.notEqual(worldHash(a), worldHash(c));
}

// ---------------------------------------------------------------- CPU players with a laptop

// a CPU player holding a laptop, with nothing coming for it and its rival far off, flies the plane; flying, it
// goes for the rival and gets it if the rival stands still in the open, and never bombs itself
for (const level of ['hard', 'normal', 'beginner'] as const) {
  let hits = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const w = mk();
    const me = w.players[0];
    me.laptop = true;
    const bot = createBot(0, level, seed);
    const rival = w.players[1];
    let flew = false;
    let selfHit = false;
    for (let t = 0; t < 30 * 60 && rival.alive && me.alive; t++) {
      step(w, [botInput(w, bot)]);
      if (me.flying) flew = true;
      for (const e of w.events) if (e.type === 'death' && e.player === 0) selfHit = true;
      if (!me.laptop && !me.flying && !rival.alive) break;
      if (!me.laptop && !me.flying) break; // its one flight is over
    }
    assert.ok(flew, `${level} ${seed}: it flew`);
    assert.ok(!selfHit, `${level} ${seed}: never itself`);
    if (!rival.alive) hits++;
  }
  // the rival stands in its corner all along: the better levels get it most times, Beginner now and then
  if (level === 'hard') assert.ok(hits >= 4, `hard got a still rival ${hits} times in 6`);
  if (level === 'normal') assert.ok(hits >= 2, `normal got a still rival ${hits} times in 6`);
}

// flying, it lands the plane and runs when a blast heads for its robot
{
  const w = mk();
  const me = w.players[0];
  me.laptop = true;
  me.facing = 4;
  const bot = createBot(0, 'hard', 3);
  step(w, [press({ b: true })]); // up it goes (pressed for it)
  step(w, [none]);
  assert.ok(me.flying > 0);
  // a bomb of the rival's right beside its robot
  w.bombs.push({ id: 77, owner: 1, x: 2, y: 1, cx: 2, cy: 1, fuse: 90, range: 2, age: 200, state: 'ground', slide: 0, heldBy: -1, lifted: false, fromX: 0, fromY: 0, flyDir: 0, flyDist: 0, flyT: 0 });
  w.players[1].activeBombs = 1;
  for (let t = 0; t < 200 && me.alive; t++) step(w, [botInput(w, bot)]);
  assert.equal(me.alive, true, 'it got away');
  assert.equal(me.flying, 0, 'having landed');
}

// with a rival close by it keeps the laptop for later (it would be a sitting target)
{
  const w = mk();
  const me = w.players[0];
  me.laptop = true;
  const rival = w.players[1];
  rival.x = 3;
  rival.y = 1;
  const bot = createBot(0, 'hard', 1);
  for (let t = 0; t < 30; t++) {
    const inp = botInput(w, bot);
    assert.ok(!(inp.b && me.laptop), 'no take-off with a rival two tiles away');
    step(w, [inp, none]);
  }
}

// CPU players all holding laptops, a few rounds: they fly, drop, and none is knocked out by its own bomb, unless
// a rival's falling bomb set that bomb off early (a Beginner never notices one in time, and cannot allow for it:
// experiments/cpu-matches.ts tells these apart the same way)
{
  let flights = 0;
  let drops = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const w = createWorld({ seed, players: [0, 1, 2, 3].map((i) => ({ colorId: String(i) })), softDensity: 0.5 });
    const bots = w.players.map((p, i) => createBot(i, (['hard', 'normal', 'beginner', 'hard'] as const)[i], seed * 10 + i));
    for (const p of w.players) p.laptop = true;
    const rushed = new Map<number, number>(); // player -> the last tick a rival's falling bomb set one of theirs off early
    for (let t = 0; t < 60 * 60 && !w.over; t++) {
      // the falling bombs landing on this tick, and where (on a brick: no blast)
      const landing = w.drops
        .filter((d) => d.t === 1)
        .map((d) => ({ owner: d.owner, ...dropLanding(w, d.x, d.y, d.vx, d.vy, 1) }))
        .filter((l) => tileAt(w, l.cx, l.cy) !== SOFT);
      const fuses = new Map(w.bombs.map((b) => [b.id, b.fuse]));
      step(w, bots.map((b) => botInput(w, b)));
      for (const b of w.bombs) {
        const was = fuses.get(b.id);
        if (was === undefined || was - b.fuse <= 1) continue;
        if (landing.some((l) => l.owner !== b.owner && Math.abs(l.cx - b.cx) + Math.abs(l.cy - b.cy) <= DROP_FIRE)) rushed.set(b.owner, w.tick);
      }
      for (const e of w.events) {
        if (e.type === 'launch') flights++;
        if (e.type === 'drop') drops++;
        if (e.type === 'death' && e.by === e.player) {
          assert.ok(w.tick - (rushed.get(e.player) ?? -999) <= 60, `seed ${seed}: robot ${e.player} blasted itself`);
        }
      }
    }
  }
  assert.ok(flights >= 8, `they flew (${flights})`);
  assert.ok(drops >= 4, `and dropped bombs (${drops})`);
}

void HARD;
console.log('laptop checks passed');
