/**
 * The Wild West's railway and TNT (the owner's design, 25 November 2026): four lines with a train now and then,
 * a warning before it, nothing once the blocks fall; barrels of TNT whose blast runs until a wall or a brick.
 */
import assert from 'node:assert';
import {
  createWorld,
  step,
  spawnPoints,
  railLines,
  onRail,
  trainSpan,
  railLength,
  cloneWorld,
  FLOOR,
  HARD,
  SOFT,
  TNT,
  TNT_SHARE,
  TNT_FUSE_TICKS,
  FLAME_TICKS,
  FUSE_TICKS,
  GATE_TICKS,
  TRAIN_FIRST,
  TRAIN_GAP,
  TRAIN_WARN_TICKS,
  TRAIN_LENGTH,
  TRAIN_SPEED,
  TICK_HZ,
  MAX_PLAYERS,
  World,
  GameEvent,
} from '../src/sim';
import { dangerMap, hasDanger } from '../src/bot';
import { ARENAS, MAPS, defaultSetup, worldConfig } from '../src/setup';
import { PROTOCOL, decodeWorld, encodeWorld, worldHash } from '../src/net';

const players = (n: number): { colorId: string }[] => Array.from({ length: n }, (_, i) => ({ colorId: `c${i}` }));

// ---------------------------------------------------------------- the lines

// on every size, grown or not, with any number of players: four lines on open rows and columns, none through a
// start tile, with a tunnel (a wall tile) at each end; bricks on them as anywhere (no barrels of TNT, no blocks)
for (const a of ARENAS) {
  for (const grow of [0, 2]) {
    for (let n = 2; n <= MAX_PLAYERS; n++) {
      const cols = a.cols + grow;
      const rows = a.rows + grow;
      const w = createWorld({ seed: 11 + n, cols, rows, players: players(n), rails: true, tnt: true });
      assert.equal(w.rails.length, 4, 'four lines');
      assert.deepStrictEqual(w.rails.map((r) => r.dir), ['h', 'h', 'v', 'v'], 'two across, two down');
      for (const r of w.rails) {
        assert.equal(r.at % 2, 1, 'on an open row or column, never through the pillars');
        const len = r.dir === 'h' ? w.w : w.h;
        assert.equal(w.tiles[r.dir === 'h' ? r.at * w.w : r.at], HARD, 'its tunnel at one end is in the outer wall');
        assert.equal(w.tiles[r.dir === 'h' ? r.at * w.w + len - 1 : (len - 1) * w.w + r.at], HARD, 'and at the other');
      }
      for (const s of spawnPoints(w.w, w.h, n)) assert.ok(!onRail(w, s.x, s.y), `no robot starts on the railway (${a.id}, ${n} players)`);
      let onLine = 0;
      for (let y = 0; y < w.h; y++)
        for (let x = 0; x < w.w; x++)
          if (onRail(w, x, y)) {
            assert.ok(w.tiles[y * w.w + x] === FLOOR || w.tiles[y * w.w + x] === SOFT, 'floor or bricks on the line, never TNT or a block');
            if (w.tiles[y * w.w + x] === SOFT) onLine++;
          }
      assert.ok(onLine > 0, 'bricks on the railway too');
      // TNT: a tenth of the bricks, hiding nothing
      let bricks = 0;
      let tnt = 0;
      for (let i = 0; i < w.tiles.length; i++) {
        if (w.tiles[i] === SOFT) bricks++;
        if (w.tiles[i] === TNT) {
          tnt++;
          assert.ok(!w.hidden.has(i), 'a barrel hides no power-up');
        }
      }
      assert.equal(tnt, Math.round((bricks + tnt) * TNT_SHARE), 'one brick in ten is TNT');
      assert.ok(tnt > 0, 'every arena has some');
    }
  }
}
{
  // only on the Wild West: the setup asks for it there, and only there
  for (const m of MAPS) {
    const s = { ...defaultSetup('gold'), map: m.id };
    const cfg = worldConfig(s, 'gold', 5);
    assert.equal(!!cfg.rails, m.id === 'western', `railway on ${m.id}`);
    assert.equal(!!cfg.tnt, m.id === 'western', `TNT on ${m.id}`);
  }
  const plain = createWorld({ seed: 5, players: players(4) });
  assert.equal(plain.rails.length, 0, 'no railway by default');
  assert.equal(plain.train, null, 'and no train');
  assert.ok(!plain.tiles.includes(TNT), 'and no TNT');
  // the other maps' arenas are just as they were: the same seed builds the same bricks with or without the
  // TNT and railway code (it only comes into it when asked for)
  assert.deepStrictEqual(Array.from(createWorld({ seed: 5, players: players(4), rails: false }).tiles), Array.from(plain.tiles), 'unchanged');
  assert.ok(PROTOCOL >= 12, 'online rooms know the railway');
}

// ---------------------------------------------------------------- the trains

/** Every train of a round, as they come, with nobody moving. */
function timetable(w: World, ticks: number): { warnAt: number; enterAt: number; exitAt: number; line: number; dir: number }[] {
  const out: { warnAt: number; enterAt: number; exitAt: number; line: number; dir: number }[] = [];
  for (let t = 0; t < ticks; t++) {
    if (w.train && !out.some((o) => o.warnAt === w.train!.warnAt)) out.push({ ...w.train });
    step(w, []);
  }
  return out;
}
{
  const roundTicks = 90 * TICK_HZ;
  const w = createWorld({ seed: 21, players: players(4), rails: true, tnt: true, roundTicks, softDensity: 0 });
  // (out of the way: in the corners, which no line runs through)
  const trains = timetable(w, roundTicks);
  assert.ok(w.players.every((p) => p.alive), 'nobody in the way, nobody hurt');
  trains.push(...timetable(w, 60 * TICK_HZ).filter((t) => !trains.some((o) => o.warnAt === t.warnAt)));
  assert.ok(trains.length >= 7, `about one every 10 s (${trains.length} in a 1:30 round)`);
  assert.ok(trains[0].warnAt >= TRAIN_FIRST[0] && trains[0].warnAt <= TRAIN_FIRST[1], 'the first 6 to 10 s in');
  for (let i = 0; i < trains.length; i++) {
    const tr = trains[i];
    assert.equal(tr.enterAt - tr.warnAt, TRAIN_WARN_TICKS, 'a warning of 2.5 s before it comes out');
    assert.ok(tr.exitAt + GATE_TICKS < roundTicks, 'gone, gates up, before the blocks start to fall');
    if (i > 0) {
      const gap = tr.warnAt - trains[i - 1].warnAt;
      assert.ok(gap >= TRAIN_GAP[0] && gap <= TRAIN_GAP[1], `8 to 12 s after the one before (${gap / TICK_HZ} s)`);
    }
  }
  assert.ok(new Set(trains.map((t) => t.line)).size > 1, 'not always the same line');
  assert.equal(w.train, null, 'none once the timer has run out');

  // the same seed, the same trains (every copy of an online round agrees)
  const again = timetable(createWorld({ seed: 21, players: players(4), rails: true, tnt: true, roundTicks, softDensity: 0 }), roundTicks);
  assert.deepStrictEqual(again, trains, 'the same timetable from the same seed');
  // and a round with no timer has trains for as long as it lasts
  const endless = timetable(createWorld({ seed: 21, players: players(4), rails: true, roundTicks: 0, softDensity: 0 }), 300 * TICK_HZ);
  assert.ok(endless.length >= 15, 'no timer: they keep coming');
}

/** A world with a train due on line 0 (along row 3), going right, its warning starting `warnIn` ticks from now. */
function trainSoon(warnIn = 1): World {
  const w = createWorld({ seed: 4, players: players(3), rails: true, roundTicks: 0, softDensity: 0 });
  const warnAt = w.tick + warnIn;
  const enterAt = warnAt + TRAIN_WARN_TICKS;
  w.train = { line: 0, dir: 1, warnAt, enterAt, exitAt: enterAt + Math.ceil((railLength(w, 0) + TRAIN_LENGTH) / TRAIN_SPEED) };
  return w;
}
function runTo(w: World, tick: number, events: GameEvent[] = []): GameEvent[] {
  while (w.tick < tick) {
    step(w, []);
    events.push(...w.events);
  }
  return events;
}
{
  // a robot standing on the line is knocked out as the train goes by, shield or not; one a tile off it is not,
  // nor one most of the way off it (the tile it counts as on is the next one), but one half off is
  const w = trainSoon();
  const line = w.rails[0].at;
  w.players.push({ ...w.players[2], id: 3 });
  const [a, b, c, e] = w.players;
  a.x = 5;
  a.y = line;
  a.shieldTicks = 9999;
  b.x = 7;
  b.y = line - 1;
  c.x = 9;
  c.y = line + 0.45; // (nearly half way off it: still on it)
  e.x = 11;
  e.y = line - 0.55; // (just over half way off it)
  const tr = w.train!;
  const ev = runTo(w, tr.enterAt - 1);
  assert.ok(a.alive, 'not before it comes out of its tunnel');
  assert.ok(ev.some((e) => e.type === 'bell'), 'the bell rings during the warning');
  assert.equal(ev.filter((e) => e.type === 'train').length, 1, 'and it whistles once');
  runTo(w, tr.exitAt, ev);
  assert.ok(!a.alive, 'run over');
  const death = ev.find((e) => e.type === 'death' && e.player === a.id);
  assert.ok(death && death.type === 'death' && death.cause === 'train' && death.by === -1, "the train's doing, nobody's point");
  assert.ok(b.alive, 'a tile off the line is safe');
  assert.ok(!c.alive, 'still counting as on the line: hit');
  assert.ok(e.alive, 'counting as on the next tile: safe');
  // it reached each when its front came by: no earlier
  assert.equal(w.train, tr, 'still the same train until its gates are up');
  runTo(w, tr.exitAt + GATE_TICKS + 2);
  assert.ok(w.train === null || w.train.warnAt > tr.warnAt, 'then the next one is set');
}
{
  // it reaches a robot when its front does
  const w = trainSoon();
  const p = w.players[0];
  p.x = 8;
  p.y = w.rails[0].at;
  const tr = w.train!;
  let hitAt = -1;
  for (let t = 0; t < 600 && hitAt < 0; t++) {
    step(w, []);
    if (!p.alive) hitAt = w.tick;
  }
  const [, front] = trainSpan(w, tr, hitAt);
  const [, before] = trainSpan(w, tr, hitAt - 1);
  assert.ok(front > 8 - 0.3 && before <= 8 - 0.3, 'knocked out the tick the front reaches it');
}
{
  // a bomb on the line goes off as the train reaches it, a brick on it is smashed (its power-up left on the line),
  // a power-up lying on it is left be
  const w = trainSoon();
  const line = w.rails[0].at;
  w.tiles[line * w.w + 11] = SOFT;
  w.hidden.set(line * w.w + 11, 'speed');
  w.bombs.push({ id: 99, owner: 1, x: 6, y: line, cx: 6, cy: line, fuse: 9999, range: 1, age: 0, state: 'ground', slide: 0, speed: 0, heldBy: -1, lifted: false, fromX: 6, fromY: line, flyDir: 0, flyDist: 0, flyT: 0 });
  w.players[1].activeBombs = 1;
  w.items.push({ cx: 9, cy: line, kind: 'bomb', age: 0 });
  w.players[0].x = 1;
  w.players[0].y = 1;
  const tr = w.train!;
  // (the brick: not before the train's front gets to it)
  let smashedAt = -1;
  const ev: GameEvent[] = [];
  while (w.tick < tr.exitAt) {
    step(w, []);
    ev.push(...w.events);
    if (smashedAt < 0 && w.burning.some((b) => b.cx === 11 && b.cy === line)) smashedAt = w.tick;
  }
  assert.ok(ev.some((e) => e.type === 'explode' && e.cx === 6 && e.cy === line), 'the bomb goes off');
  assert.ok(smashedAt > 0, 'the brick is smashed');
  const [, front] = trainSpan(w, tr, smashedAt);
  assert.ok(front > 11 - 0.5 && front < 11, 'as the front gets to it');
  assert.equal(w.tiles[line * w.w + 11], FLOOR, 'gone');
  assert.ok(w.items.some((it) => it.cx === 11 && it.cy === line && it.kind === 'speed'), 'its power-up left on the line');
  assert.ok(w.items.some((it) => it.cx === 9 && it.cy === line), 'the power-up lying there is left be');
}
{
  // once the round is decided, a train still in its tunnel stays there, and none comes after it
  const w = trainSoon(30);
  w.over = { winner: 0 };
  runTo(w, w.tick + 5);
  assert.equal(w.train, null, 'no train after the round is decided');
  // and a train already out leaves the winner be
  const v = trainSoon();
  const p = v.players[0];
  p.x = 5;
  p.y = v.rails[0].at;
  runTo(v, v.train!.enterAt + 2);
  v.over = { winner: 0 };
  runTo(v, v.train!.exitAt);
  assert.ok(p.alive, 'the winner is not run over');
}
{
  // the CPU players see the train coming once its warning starts, and not before: its line is dangerous while
  // it passes, the tiles beside it are not
  const w = trainSoon(60);
  const line = w.rails[0].at;
  const idx = line * w.w + 5;
  assert.ok(!hasDanger(dangerMap(w, null, 0), idx), 'nothing known before the warning');
  runTo(w, w.train!.warnAt);
  const D = dangerMap(w, null, 0);
  assert.ok(hasDanger(D, idx), 'its line is dangerous once the warning starts');
  assert.ok(!hasDanger(D, (line - 1) * w.w + 5), 'not the row beside it');
  // a slow level notices it a moment late, but no later than TRAIN_NOTICE
  assert.ok(!hasDanger(dangerMap(w, w.players[1], 30), idx), 'a slow level, a moment late');
  runTo(w, w.tick + 40);
  assert.ok(hasDanger(dangerMap(w, w.players[1], 70), idx), 'but it sees it in time');
}

// ---------------------------------------------------------------- TNT

/** An open arena with no timer: a barrel of TNT at (5, 3), bricks and barrels put down by the test. */
function tntArena(): World {
  const w = createWorld({ seed: 2, players: players(2), softDensity: 0, roundTicks: 0 });
  // the robots out of the way, in two corners
  return w;
}
const put = (w: World, x: number, y: number, t: number): void => {
  w.tiles[y * w.w + x] = t;
};
function bomb(w: World, owner: number, x: number, y: number, fuse = 1, range = 1): void {
  w.bombs.push({ id: w.nextBombId++, owner, x, y, cx: x, cy: y, fuse, range, age: 0, state: 'ground', slide: 0, speed: 0, heldBy: -1, lifted: false, fromX: x, fromY: y, flyDir: 0, flyDist: 0, flyT: 0 });
  w.players[owner].activeBombs++;
}
{
  const w = tntArena();
  // row 5 (an open row): TNT at (5,5); a brick at (11,5); a bomb at (3,5) whose blast just reaches (4,5)... and (5,5)
  put(w, 5, 5, TNT);
  put(w, 11, 5, SOFT);
  bomb(w, 0, 4, 5, 1, 1);
  w.items.push({ cx: 8, cy: 5, kind: 'fire', age: 0 });
  const ev: GameEvent[] = [];
  runTo(w, w.tick + 1, ev);
  assert.equal(w.tiles[5 * w.w + 5], TNT, 'a blast reaches the barrel: it is lit, not gone yet');
  assert.ok(!w.flames.some((f) => f.cx === 5 && f.cy === 5), 'the bomb blast stops at the barrel');
  assert.equal(w.tntLit.length, 1, 'lit');
  runTo(w, w.tick + TNT_FUSE_TICKS, ev);
  assert.equal(w.tiles[5 * w.w + 5], FLOOR, 'gone off: open floor now');
  assert.ok(ev.some((e) => e.type === 'tnt' && e.cx === 5 && e.cy === 5), 'and said so');
  // its blast: along the row until the brick, which it does not break; down the column (odd, so open) to the walls
  for (let x = 6; x <= 10; x++) assert.ok(w.flames.some((f) => f.cx === x && f.cy === 5 && f.owner === 0 && f.tnt), `fire at ${x},5: TNT's, in the name of whoever set it off`);
  assert.ok(!w.flames.some((f) => f.cx === 11 && f.cy === 5), 'stops at the brick');
  assert.equal(w.tiles[5 * w.w + 11], SOFT, 'and leaves it standing');
  assert.ok(!w.burning.some((b) => b.cx === 11), 'not even burning');
  for (let y = 1; y <= w.h - 2; y++) assert.ok(w.flames.some((f) => f.cx === 5 && f.cy === y), `down the whole column to the wall (5,${y})`);
  assert.ok(!w.flames.some((f) => f.cx === 5 && f.cy === 0), 'not into the wall');
  assert.equal(w.items.length, 0, 'the power-up in its way is gone');
}
{
  // TNT sets off TNT, and bombs, along its line; a robot anywhere along it is knocked out
  const w = tntArena();
  put(w, 3, 5, TNT);
  put(w, 9, 5, TNT);
  bomb(w, 1, 2, 5, 1, 1);
  bomb(w, 1, 9, 7, 9999, 1); // (on the column of the second barrel)
  const p = w.players[0];
  p.x = 9;
  p.y = 1;
  const ev = runTo(w, w.tick + 1 + TNT_FUSE_TICKS * 2 + 6);
  assert.equal(ev.filter((e) => e.type === 'tnt').length, 2, 'the second barrel goes off too');
  assert.ok(ev.some((e) => e.type === 'explode' && e.cx === 9 && e.cy === 7), 'and the bomb in its way');
  assert.ok(!p.alive, 'the robot at the end of its line is caught');
  const d = ev.find((e) => e.type === 'death');
  assert.ok(d && d.type === 'death' && d.cause === 'tnt' && d.by === 1, 'a TNT blast, the knockout put down to whoever set it off');
}
{
  // in a teams match with friendly fire off, a barrel a teammate set off spares you, as their bomb would
  const w = createWorld({ seed: 2, players: players(2), softDensity: 0, roundTicks: 0, teams: [0, 0, 1].slice(0, 2), friendlyFire: false });
  put(w, 3, 5, TNT);
  bomb(w, 1, 2, 5, 1, 1);
  w.players[0].x = 9;
  w.players[0].y = 5;
  runTo(w, w.tick + 1 + TNT_FUSE_TICKS + 3);
  assert.ok(w.players[0].alive, "a teammate's TNT, friendly fire off: unhurt");
}
{
  // a block landing on a lit barrel crushes it: it never goes off; a falling block's tile is solid for good
  const w = createWorld({ seed: 2, players: players(2), softDensity: 0, roundTicks: 60, shrinkTicks: 200 });
  const first = w.shrinkOrder[0];
  w.tiles[first] = TNT;
  w.tntLit.push({ cx: first % w.w, cy: Math.floor(first / w.w), t: 9999, owner: 0 });
  runTo(w, 60 + 40);
  assert.equal(w.tiles[first], HARD, 'crushed under the block');
  assert.equal(w.tntLit.length, 0, 'and will not go off');
}
{
  // the CPU players know: a bomb that will reach a barrel puts the barrel's whole line in danger
  const w = tntArena();
  put(w, 5, 5, TNT);
  const D = dangerMap(w, null, 0, [{ cx: 4, cy: 5, range: 1, fuse: FUSE_TICKS }]);
  const v = D.iv[1 * w.w + 5];
  assert.ok(v && v[0] >= FUSE_TICKS + TNT_FUSE_TICKS - 1, 'the column above the barrel: dangerous once the barrel goes off');
  assert.ok(hasDanger(D, 5 * w.w + 12), 'and the far end of the row');
  // a lit barrel is a known danger too
  const u = tntArena();
  put(u, 7, 5, TNT);
  u.tntLit.push({ cx: 7, cy: 5, t: 4, owner: 1 });
  assert.ok(hasDanger(dangerMap(u, null, 0), 1 * u.w + 7), 'a lit barrel, at once');
  assert.ok(!hasDanger(dangerMap(u, null, 0), 1 * u.w + 6), 'and only its lines');
}
{
  // a world goes online and comes back the same: its train and lit barrels included
  const w = trainSoon(5);
  w.tntLit.push({ cx: 3, cy: 1, t: 3, owner: 0 });
  runTo(w, w.tick + 20);
  const back = decodeWorld(encodeWorld(w));
  assert.equal(worldHash(back), worldHash(w), 'same world after the trip');
  const a = cloneWorld(w);
  const b = decodeWorld(encodeWorld(w));
  runTo(a, a.tick + 400);
  runTo(b, b.tick + 400);
  assert.equal(worldHash(a), worldHash(b), 'and steps on alike');
  assert.notStrictEqual(a.train, w.train, 'a copy has its own train');
}
{
  // FLAME_TICKS is long enough for the barrel's blast to be seen: the fire lasts as a bomb's does
  assert.ok(FLAME_TICKS > TNT_FUSE_TICKS, 'a chain of barrels is seen going down the line');
}

console.log('railway and TNT checks passed');
