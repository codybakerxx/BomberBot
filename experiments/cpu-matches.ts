/**
 * Experiment: how do the CPU players do against each other, and do they ever
 * blast themselves?
 *
 * Plays whole matches with no human and no screen, and counts for each bot how
 * it went out: by its own bomb, by another player's, or not at all.
 *
 *   npx tsx experiments/cpu-matches.ts            every level against itself, then mixed
 *   npx tsx experiments/cpu-matches.ts solo       each level alone with a target that stands still
 *   npx tsx experiments/cpu-matches.ts versus     three of each level against one slow, careless player
 *   npx tsx experiments/cpu-matches.ts alone      each level alone for a whole round: does it reach the square the blocks leave open
 *   npx tsx experiments/cpu-matches.ts duel [N]   one against one (Hard against each level, Normal against Beginner): who wins, how soon, and what it used
 *
 * With WEST=1 in front, every arena is the Wild West's, with its railway and TNT: robots the train hits are
 * counted apart ('train'), and a barrel's blast counts as the blast of whoever set it off (so one a robot set
 * off itself is under "blasted itself").
 *
 * With ICE=1 in front, every arena is Frozen Lake's ice: robots slide when they let go or turn back,
 * and bombs slide on after a throw, slow down, and bounce back off what stops them when they hit it fast.
 *
 * With BELTS=1 in front, every arena is the Factory's: four conveyor belts carry robots and bombs, and turn
 * round now and then after an alarm.
 *
 * These are the real CPU players and the real rules, so unlike the thumb
 * experiments this is a measurement, not a model. What it cannot tell you is
 * how they feel to play against.
 */
import { createWorld, step, World, PlayerInput, TICK_HZ, FLOOR, SOFT, ROUND_TICKS, SHRINK_TICKS, DROP_TICKS, DROP_FIRE, FLAME_TICKS, SHIELD_GRACE_TICKS, dropLanding, tileAt, DX, DY } from '../src/sim';
import { createBot, botInput, Bot, BotLevel, BOT_LEVELS, LEVELS } from '../src/bot';
const wrap = (v: number, n: number): number => ((v % n) + n) % n;
/** WEST=1: the Wild West's railway and TNT in every arena */
const WEST = process.env.WEST === '1';
/** ICE=1: Frozen Lake's ice in every arena */
const ICE = process.env.ICE === '1';
/** BELTS=1: the Factory's conveyor belts in every arena */
const BELTS = process.env.BELTS === '1';
/** robots a train hit, over the whole run */
let ranOver = 0;
/** over the whole run: trip wires strung, robots that walked into one (anyone's), decoys made */
let wiresStrung = 0;
let walkedIntoWire = 0;
let decoysMade = 0;

export interface Outcome {
  /**
   * for each player: 'alive'; 'other' (caught by another player's blast);
   * 'boxed' (caught by its own blast after a rival shut it in: see `shutIn`
   * below; or after its own bomb had been moved; or after a rival's bomb set
   * its own off early: see `cause` in `playMatch`); or 'self' (caught by its
   * own blast with none of that going on); or 'crushed' (a falling block
   * landed on it); or 'train' (the Wild West's train hit it)
   */
  fate: ('alive' | 'self' | 'boxed' | 'other' | 'crushed' | 'train')[];
  /** when each went out, in ticks, or -1 */
  when: number[];
  winner: number;
  ticks: number;
  /** who put each player out, or -1 */
  by: number[];
  /** what each player did with its kit: bombs dropped, most out at once, kicks, throws, flights, bombs from a plane */
  use: Use[];
}

export interface Use {
  placed: number;
  most: number;
  kicks: number;
  throws: number;
  flights: number;
  drops: number;
}

/**
 * Play one match. `levels[i]` is the level of player i, or null for a player
 * who stands still. With `timer` false the round has no time limit and no
 * blocks fall.
 */
export function playMatch(seed: number, levels: (BotLevel | null)[], maxTicks: number, stopWhenDecided = true, timer = true): Outcome {
  const world: World = createWorld({ seed, players: levels.map((_, i) => ({ colorId: String(i) })), roundTicks: timer ? undefined : 0, rails: WEST, tnt: WEST, ice: ICE, belts: BELTS });
  const bots: (Bot | null)[] = levels.map((lv, i) => (lv ? createBot(i, lv, seed * 31 + 7) : null));
  const fate: Outcome['fate'] = levels.map(() => 'alive');
  const when = levels.map(() => -1);
  const by = levels.map(() => -1);
  const inputs: (PlayerInput | undefined)[] = [];
  const droppedAt = new Map<number, number>(); // bomb id -> the tile it was dropped on
  const droppedOn = new Map<number, number>(); // bomb id -> the tick it was dropped on
  const landedOn = new Map<number, number>(); // tile -> the tick a falling block landed on it
  const restingAt = new Map<number, { tile: number; since: number }>(); // bomb id -> where it lies, and since which tick
  // bomb id -> the last thing that decided when and where it would go off, and whose bomb did it: its own
  // drop, its last move (a kick or a throw), or, if another bomb's blast set it off early, whatever decided that one
  const cause = new Map<number, { tick: number; owner: number }>();
  const rushed = new Set<number>(); // bombs set off before their own fuse ran out, by a bomb that went off
  // rivals' blasts that are not bombs lying in the arena, for `shutIn`: bombs falling from planes (from the
  // tick they were let go until their blast has died down), and bombs a falling block took away before they
  // went off (they shut the way out while they lay there). `since`: when they were let go, or came to lie there
  const threats: Threat[] = [];
  // a player's own bombs that a rival's bomb set off early (see `early` below), kept while their blast burns,
  // so a robot whose shield took the first blast and that is caught in this one half a second later still counts
  const setOff: { owner: number; cx: number; cy: number; range: number; tick: number }[] = [];
  // a player's shield taken by a blast a rival had a hand in (a rival's bomb, or its own bomb a rival had kicked
  // or thrown): the tick, so its own blast catching it as the shield's half second runs out counts as the rival's doing
  const shieldTaken = new Map<number, number>();
  const thrownOn = new Map<number, number>(); // bomb id -> the tick it was thrown, while it is in the air
  const use: Use[] = levels.map(() => ({ placed: 0, most: 0, kicks: 0, throws: 0, flights: 0, drops: 0 }));
  // bombs a rival has kicked or thrown at some time since they were dropped (one kicked away and back again
  // ends on the tile it was dropped on, so where it lies does not tell)
  const rivalMoved = new Set<number>();
  // each player's bomb that went off last: on the Wild West, the one that set off a barrel of TNT whose blast caught it
  const lastOff = new Map<number, number>();
  const burning: (Seen & { tick: number })[] = []; // bombs gone off whose flames still burn, oldest first
  let t = 0;
  for (; t < maxTicks; t++) {
    for (let i = 0; i < bots.length; i++) inputs[i] = bots[i] ? botInput(world, bots[i]!) : undefined;
    const before = world.bombs.map((b) => ({ id: b.id, owner: b.owner, cx: b.cx, cy: b.cy, range: b.range, ground: b.state === 'ground', fuse: b.fuse }));
    // bombs in the air after a throw, and where they are coming down (a bounce carries one on a tile later)
    // (where it comes down: its distance, or bouncing on a tile at a time while that tile is a block or has a bomb,
    // as moveBombs does; it was taken at its distance alone, so one bouncing on over bricks was looked for short)
    const downAt = (b: (typeof world.bombs)[number]): { cx: number; cy: number } => {
      for (let dist = b.flyDist; ; dist++) {
        const cx = wrap(b.fromX + DX[b.flyDir] * dist, world.w);
        const cy = wrap(b.fromY + DY[b.flyDir] * dist, world.h);
        if (dist > b.flyDist + world.w + world.h || (tileAt(world, cx, cy) === FLOOR && !world.bombs.some((o) => o.state === 'ground' && o.cx === cx && o.cy === cy))) return { cx, cy };
      }
    };
    const flying = world.bombs
      .filter((b) => b.state === 'air')
      .map((b) => ({ id: b.id, owner: b.owner, range: b.range, ...downAt(b) }));
    // bombs falling from planes that land on this tick blast like a bomb going off (not on a brick: it only
    // burns), decided by whoever let them go, on the tick they did (ids below 0: they are not in world.bombs)
    const landing = world.drops
      .filter((d) => d.t === 1)
      .map((d, i) => ({ id: -1 - i, owner: d.owner, range: DROP_FIRE, let: t - DROP_TICKS + 1, ...dropLanding(world, d.x, d.y, d.vx, d.vy, 1) }))
      .filter((d) => tileAt(world, d.cx, d.cy) !== SOFT);
    const was = new Map(world.bombs.map((b) => [b.id, { slide: b.slide, state: b.state, heldBy: b.heldBy }]));
    step(world, inputs);
    for (const d of landing) cause.set(d.id, { tick: d.let, owner: d.owner });
    for (const b of world.bombs) {
      const o = was.get(b.id);
      if (!o) {
        if (b.state === 'ground' && use[b.owner]) use[b.owner].placed++;
        continue;
      }
      if (o.state === 'held' && b.state === 'air' && use[o.heldBy]) use[o.heldBy].throws++;
      if (o.state === 'held' && b.state === 'air' && o.heldBy !== b.owner) rivalMoved.add(b.id);
      if (!o.slide && b.slide && o.state === 'ground') {
        // (the kicker: the robot right behind it, the way it is sliding)
        let near = -1;
        let nd = Infinity;
        for (const p of world.players) {
          const d = Math.abs(p.x - (b.x - DX[b.slide])) + Math.abs(p.y - (b.y - DY[b.slide]));
          if (p.alive && d < nd) { nd = d; near = p.id; }
        }
        if (near >= 0 && use[near]) use[near].kicks++;
        if (near >= 0 && near !== b.owner) rivalMoved.add(b.id);
      }
    }
    for (const e of world.events) {
      if (e.type === 'launch' && use[e.player]) use[e.player].flights++;
      if (e.type === 'drop' && use[e.player]) use[e.player].drops++;
      if (e.type === 'wire') wiresStrung++;
      if (e.type === 'trip') walkedIntoWire++;
      if (e.type === 'decoy') decoysMade++;
    }
    for (const p of world.players) if (use[p.id]) use[p.id].most = Math.max(use[p.id].most, p.activeBombs);
    const gone = before.filter((b) => !world.bombs.some((x) => x.id === b.id));
    // (a bomb under a block that has just landed did not go off: the block took it)
    const crushedBombs = gone.filter((b) => world.events.some((e) => e.type === 'block' && e.cx === b.cx && e.cy === b.cy));
    for (const b of crushedBombs) threats.push({ owner: b.owner, cx: b.cx, cy: b.cy, range: b.range, since: restingAt.get(b.id)?.since ?? 0 });
    // (where each went off: a bomb that slid on to the next tile during this tick went off there, as its blast says)
    const booms = world.events.filter((e) => e.type === 'explode') as { cx: number; cy: number }[];
    const where = <B extends { cx: number; cy: number }>(b: B): B => {
      if (booms.some((e) => e.cx === b.cx && e.cy === b.cy)) return b;
      const e = booms.find((e) => Math.abs(e.cx - b.cx) + Math.abs(e.cy - b.cy) === 1);
      return e ? { ...b, cx: e.cx, cy: e.cy } : b;
    };
    const wentOff = [...gone.filter((b) => !crushedBombs.includes(b)).map(where), ...landing];
    for (const d of world.drops) {
      if (d.t !== DROP_TICKS - 1) continue; // (let go on this tick)
      const at = dropLanding(world, d.x, d.y, d.vx, d.vy, d.t);
      if (tileAt(world, at.cx, at.cy) !== SOFT) threats.push({ owner: d.owner, cx: at.cx, cy: at.cy, range: DROP_FIRE, since: t });
    }
    for (const g of wentOff) if (g.id >= 0) lastOff.set(g.owner, g.id);
    // bombs that have gone off and whose flames still burn: a robot can still be caught by them (its shield's
    // half second of safety running out in the middle of them), and needs them to tell whether it was shut in
    for (const g of wentOff) if (g.id >= 0 && 'ground' in g) burning.push({ ...g, tick: t });
    while (burning.length && t - burning[0].tick > FLAME_TICKS) burning.shift();
    for (const g of wentOff) {
      const c = cause.get(g.id);
      if (g.id >= 0 && rushed.has(g.id) && c && c.owner !== g.owner && c.tick >= (droppedOn.get(g.id) ?? 0)) setOff.push({ owner: g.owner, cx: g.cx, cy: g.cy, range: g.range, tick: t });
    }
    for (const b of world.bombs) if (b.state === 'air' && !thrownOn.has(b.id)) thrownOn.set(b.id, t);
    for (const b of world.bombs) if (b.state !== 'air') thrownOn.delete(b.id);
    for (const b of world.bombs) {
      const tile = b.cy * world.w + b.cx;
      if (!droppedAt.has(b.id)) {
        droppedAt.set(b.id, tile);
        droppedOn.set(b.id, t);
        cause.set(b.id, { tick: t, owner: b.owner });
      }
      // when it came to lie where it is now: when dropped, or when it last slid, was carried or landed
      const was = restingAt.get(b.id);
      if (b.state !== 'ground' || b.slide) {
        restingAt.set(b.id, { tile: -1, since: t });
        cause.set(b.id, { tick: t, owner: b.owner });
      } else if (!was || was.tile !== tile) restingAt.set(b.id, { tile, since: t });
      // its fuse has jumped down: a blast has reached it. If that blast is from a bomb that went off on this
      // tick, whatever decided that bomb's moment now decides this one's too (if it is the later of the two)
      const old = before.find((x) => x.id === b.id);
      if (old && old.ground && b.state === 'ground' && old.fuse - b.fuse > 1) {
        for (const g of wentOff) {
          const c = cause.get(g.id);
          if (!c || !inBlast(world, g, b.cx, b.cy)) continue;
          rushed.add(b.id);
          if (c.tick >= (cause.get(b.id)?.tick ?? -1)) cause.set(b.id, c);
        }
      }
    }
    for (const e of world.events) if (e.type === 'block') landedOn.set(e.cy * world.w + e.cx, t);
    for (const e of world.events) {
      if (e.type !== 'shield') continue;
      const p = world.players[e.player];
      const [sx, sy] = [Math.round(p.x), Math.round(p.y)];
      if (wentOff.some((g) => inBlast(world, g, sx, sy) && (g.owner !== e.player || rivalMoved.has(g.id)))) shieldTaken.set(e.player, t);
    }
    for (const e of world.events) {
      if (e.type !== 'death') continue;
      const p = world.players[e.player];
      const px = Math.round(p.x);
      const py = Math.round(p.y);
      by[e.player] = e.by;
      when[e.player] = t;
      if (e.cause === 'block') {
        fate[e.player] = 'crushed';
        continue;
      }
      if (e.cause === 'train') {
        fate[e.player] = 'train';
        ranOver++;
        continue;
      }
      if (e.by !== e.player) {
        fate[e.player] = 'other';
        continue;
      }
      // its own trip wire: caught in its lane when a rival walked into it ('other'); walked into it itself, as
      // with its own bomb: 'self', unless a rival had shut it in (a rival's bomb on its way out: below)
      if (e.cause === 'wire') {
        const trip = world.events.find((x) => x.type === 'trip' && x.owner === e.player);
        if (trip && trip.type === 'trip' && trip.player !== e.player) {
          fate[e.player] = 'other';
          continue;
        }
      }
      // its own blast. Did a rival shut it in, or had its own bomb been moved, or set off early by a rival's?
      // (a rival's bomb in the air, thrown since, comes down where it is going: it blocks that tile and will blast)
      const landing = flying.map((b) => ({ owner: b.owner, cx: b.cx, cy: b.cy, range: b.range, since: thrownOn.get(b.id) ?? t, lands: true }));
      // (caught by a barrel of TNT its own bomb set off: its own blast reaches as far as that barrel's fire does)
      const tnt =
        e.cause === 'tnt' && lastOff.has(e.player)
          ? { tiles: new Set(world.flames.filter((f) => f.tnt && f.owner === e.player).map((f) => f.cy * world.w + f.cx)), since: lastOff.get(e.player)! }
          : undefined;
      // (on the Wild West, a train on its way: its line is shut to it from when the warning started)
      const tr = world.train && world.tick >= world.train.warnAt && world.tick <= world.train.exitAt ? world.train : null;
      const line = tr ? world.rails[tr.line] : null;
      const train =
        tr && line
          ? { since: tr.warnAt, tiles: new Set(Array.from({ length: (line.dir === 'h' ? world.w : world.h) - 2 }, (_, k) => (line.dir === 'h' ? line.at * world.w + k + 1 : (k + 1) * world.w + line.at))) }
          : undefined;
      // (bombs gone off a moment ago still burn: its own, which can still catch it, and rivals', which can still shut it in)
      const still = burning.filter((b) => b.tick < t && !before.some((o) => o.id === b.id));
      const boxed = shutIn(world, [...before, ...still], e.player, px, py, (id) => droppedOn.get(id) ?? 0, (id) => restingAt.get(id)?.since ?? 0, (i) => landedOn.get(i) ?? -1, [...threats, ...landing], tnt, train);
      const moved = before.some((b) => b.owner === e.player && droppedAt.has(b.id) && (droppedAt.get(b.id) !== b.cy * world.w + b.cx || (rivalMoved.has(b.id) && inBlast(world, b, px, py))));
      // Set off early: the bomb that caught it went off before its fuse ran out, because a rival's bomb reached
      // it, and that rival's bomb was dropped, kicked or thrown after this one was dropped. (A rival's bomb that
      // was lying there already, and went off when its own fuse said, it should have allowed for.)
      const early =
        before.some((b) => {
          const c = cause.get(b.id);
          return b.owner === e.player && b.ground && rushed.has(b.id) && inBlast(world, b, px, py) && !!c && c.owner !== e.player && c.tick >= (droppedOn.get(b.id) ?? 0);
        }) ||
        // (or it went off a moment ago, and the robot's shield took a blast and kept it safe for half a second)
        setOff.some((b) => b.owner === e.player && t - b.tick <= FLAME_TICKS && inBlast(world, b, px, py));
      // (or a rival's doing took its shield, and its own blast caught it as the shield's half second ran out)
      const shielded = t - (shieldTaken.get(e.player) ?? -1e9) <= FLAME_TICKS + SHIELD_GRACE_TICKS;
      fate[e.player] = boxed || moved || early || shielded ? 'boxed' : 'self';
    }
    if (stopWhenDecided && world.over) break;
  }
  return { fate, when, winner: world.over ? world.over.winner : -2, ticks: t, by, use };
}

/** Would a bomb at (b.cx, b.cy) reach tile (x, y)? Blocks and bricks stop a blast. */
function inBlast(world: World, b: { cx: number; cy: number; range: number }, x: number, y: number): boolean {
  if (b.cx !== x && b.cy !== y) return false;
  const dist = Math.abs(b.cx - x) + Math.abs(b.cy - y);
  if (dist > b.range) return false;
  const sx = Math.sign(x - b.cx);
  const sy = Math.sign(y - b.cy);
  for (let i = 1; i < dist; i++) if (world.tiles[(b.cy + sy * i) * world.w + b.cx + sx * i] !== FLOOR) return false;
  return true;
}

type Seen = { id: number; owner: number; cx: number; cy: number; range: number; ground: boolean; fuse: number };
/** a rival's blast to come (or burning) that is not a bomb lying in the arena: see `threats` in `playMatch` */
type Threat = { owner: number; cx: number; cy: number; range: number; since: number; lands?: boolean };

/**
 * A player has just been caught by its own blast at (px, py). Did a rival shut
 * it in? Yes if, within six steps of where it stood, there was a tile its own
 * bombs would not have reached that was about to be blasted by, or was blocked
 * by, a rival's bomb that came to lie there no earlier than the bomb that
 * caught it was dropped: dropped on the same tick or later, or kicked or
 * thrown there since. A rival's bomb that was already lying there when it
 * dropped its own does not count: it should have known about that one. The search is over the arena as it was when the bomb
 * was dropped: a tile a block has landed on since still counts as a way it
 * had. A rival's bomb falling from a plane counts like a bomb dropped when it
 * was let go, and so does one a falling block took away after the bot dropped
 * its own (`threats`). On the Wild West, caught by a barrel of TNT its own bomb
 * set off (`tnt`), its own blast reaches as far as that barrel's fire, and the
 * bomb that caught it is the one of its own that went off last; and a train
 * whose warning started after that bomb was dropped (`train`) shuts its line
 * as a rival's blast would. The search starts both where it was caught and
 * where it dropped that bomb (on ice it may have slid on since).
 */
function shutIn(world: World, bombs: Seen[], who: number, px: number, py: number, droppedOn: (id: number) => number, restingSince: (id: number) => number, landedOn: (tile: number) => number, threats: Threat[] = [], tnt?: { tiles: Set<number>; since: number }, train?: { tiles: Set<number>; since: number }): boolean {
  const mine = bombs.filter((b) => b.owner === who && b.ground);
  const caughtBy = mine.filter((b) => inBlast(world, b, px, py)).map((b) => b.id);
  if (!caughtBy.length && !tnt) return false;
  const since = tnt ? tnt.since : Math.min(...caughtBy);
  // where its own blasts reach (with a barrel of TNT it set off, as far as that fire)
  const reaches = (x: number, y: number): boolean => mine.some((b) => inBlast(world, b, x, y)) || !!tnt?.tiles.has(y * world.w + x);
  // a tile counts as open if it is floor, or was floor when that bomb was dropped (a block has landed on it since)
  const open = (i: number): boolean => world.tiles[i] === FLOOR || landedOn(i) > droppedOn(since);
  // a rival's bomb counts if it came to lie where it is on the same tick as that bomb was dropped, or later:
  // dropped then (the two could not have known of each other), or kicked or thrown there since
  const after = (b: Seen): boolean => restingSince(b.id) >= droppedOn(since);
  const rivals: { cx: number; cy: number; range: number }[] = bombs.filter((b) => b.owner !== who && b.ground && after(b));
  const theirs = threats.filter((r) => r.owner !== who && r.since >= droppedOn(since));
  for (const r of theirs) rivals.push(r);
  const coming = (x: number, y: number): boolean => theirs.some((r) => r.lands && r.cx === x && r.cy === y);
  if (coming(px, py)) return true; // (one coming down on the tile it is crossing: its way out is shut too)
  // a train whose warning started after that bomb was dropped: its line shuts the way out as a rival's blast does
  const trainLine = train && train.since >= droppedOn(since) ? train.tiles : null;
  if (!rivals.length && !trainLine) return false;
  const bombAt = (x: number, y: number): Seen | undefined => bombs.find((b) => b.ground && b.cx === x && b.cy === y);
  // from where it was caught, and from where it stood when it dropped that bomb: on ice a robot that finds
  // its way shut slides on, and may come to rest in a dead end behind its own bomb
  let edge: [number, number][] = [[px, py], ...mine.filter((b) => caughtBy.includes(b.id)).map((b): [number, number] => [b.cx, b.cy])];
  const seen = new Set<number>(edge.map(([x, y]) => y * world.w + x));
  for (let depth = 0; depth <= 6 && edge.length; depth++) {
    const next: [number, number][] = [];
    for (const [x, y] of edge) {
      if (!reaches(x, y) && (rivals.some((b) => inBlast(world, b, x, y)) || !!trainLine?.has(y * world.w + x))) return true;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        const i = ny * world.w + nx;
        if (!open(i) || seen.has(i)) continue;
        if (coming(nx, ny)) return true; // a rival's bomb thrown since is coming down in the way
        const b = bombAt(nx, ny);
        if (b) {
          if (b.owner !== who && after(b)) return true; // a rival's bomb that arrived since is in the way
          continue;
        }
        seen.add(i);
        next.push([nx, ny]);
      }
    }
    edge = next;
  }
  return false;
}

const pct = (n: number, d: number): string => (d ? `${((100 * n) / d).toFixed(1)}%` : '-');

if (process.argv[1] && process.argv[1].endsWith('cpu-matches.ts')) {
  // A round has no end of its own. The timer runs 1 minute 30, then the blocks take 50 seconds to fall, then
  // it goes on in the square they leave open until someone wins. These runs give up 2 minutes after the
  // blocks stop (4 minutes 20 in) and count the round as not decided.
  const STOP = ROUND_TICKS + SHRINK_TICKS; // when the last block lands
  const MAX = STOP + 2 * 60 * TICK_HZ;
  /** a block landed on it more than this long before the blocks stopped: it was caught out, not simply squeezed at the end */
  const EARLY = 15 * TICK_HZ;
  const early = (o: Outcome, i: number): boolean => o.fate[i] === 'crushed' && STOP - o.when[i] > EARLY;
  const secs = (ticks: number): string => `${(ticks / TICK_HZ).toFixed(0)} s`;
  if (process.argv[2] === 'duel') {
    // One against one, each pairing of a level against one below or level with it, the two taking each corner
    // in turn: how often does the better one knock the other out, and how, and what does it use to do it?
    const N = Number(process.argv[3] ?? 60);
    const pairs: [BotLevel, BotLevel][] = [['hard', 'beginner'], ['hard', 'normal'], ['hard', 'hard'], ['normal', 'beginner']];
    console.log(`One against one, ${N} rounds each, a whole round with the timer and the falling blocks:\n`);
    console.log('pairing'.padEnd(20) + 'won'.padStart(10) + 'lost'.padStart(10) + 'by a blast'.padStart(12) + 'before 0:00'.padStart(13) + 'time to win'.padStart(13) + 'draw'.padStart(6) + 'open'.padStart(6) + 'blasted itself'.padStart(16) + '  first player: bombs, most out, kicks, throws, flights, drops (per round)');
    for (const [a, b] of pairs) {
      let won = 0, lost = 0, blast = 0, early0 = 0, time = 0, draw = 0, open = 0, self = 0;
      const u: Use = { placed: 0, most: 0, kicks: 0, throws: 0, flights: 0, drops: 0 };
      for (let s = 1; s <= N; s++) {
        const me = s % 2;
        const o = playMatch(s, me === 0 ? [a, b] : [b, a], MAX);
        const them = 1 - me;
        if (o.winner === me) {
          won++;
          time += o.ticks;
          if (o.fate[them] === 'other') blast++;
          if (o.fate[them] === 'other' && o.when[them] < ROUND_TICKS) early0++;
        } else if (o.winner === them) lost++;
        else if (o.winner === -1) draw++;
        else open++;
        if (o.fate[me] === 'self') self++;
        u.placed += o.use[me].placed;
        u.most += o.use[me].most;
        u.kicks += o.use[me].kicks;
        u.throws += o.use[me].throws;
        u.flights += o.use[me].flights;
        u.drops += o.use[me].drops;
      }
      const per = (n: number): string => (n / N).toFixed(1);
      console.log(`${LEVELS[a].label} v ${LEVELS[b].label}`.padEnd(20) + `${won}`.padStart(10) + `${lost}`.padStart(10) + `${blast}`.padStart(12) + `${early0}`.padStart(13) + (won ? secs(time / won) : '-').padStart(13) + `${draw}`.padStart(6) + `${open}`.padStart(6) + `${self}`.padStart(16) + `  ${per(u.placed)}, ${per(u.most)}, ${per(u.kicks)}, ${per(u.throws)}, ${per(u.flights)}, ${per(u.drops)}`);
    }
  } else if (process.argv[2] === 'versus') {
    // The stand-in for a casual human is the Beginner CPU player: slow to notice bombs and slow to act.
    const N = 80;
    console.log(`Three CPU players of one level against one slow, careless player (a Beginner CPU player), ${N} rounds:\n`);
    console.log('three of'.padEnd(10) + 'blasted the player'.padStart(20) + 'average time'.padStart(14) + 'a block got the player'.padStart(24) + 'the player won'.padStart(16) + 'not decided'.padStart(13) + 'CPU players blasted themselves'.padStart(32));
    for (const lv of BOT_LEVELS) {
      let out = 0, time = 0, crushed = 0, won = 0, open = 0, self = 0;
      for (let s = 1; s <= N; s++) {
        const seat = s % 4;
        const o = playMatch(s, [0, 1, 2, 3].map((i) => (i === seat ? 'beginner' : lv)), MAX);
        if (o.fate[seat] === 'crushed') crushed++;
        else if (o.fate[seat] !== 'alive') {
          out++;
          time += o.when[seat];
        }
        if (o.winner === seat) won++;
        if (o.winner === -2) open++;
        o.fate.forEach((f, i) => {
          if (i !== seat && f === 'self') self++;
        });
      }
      console.log(LEVELS[lv].label.padEnd(10) + `${out} of ${N}`.padStart(20) + (out ? secs(time / out) : '-').padStart(14) + `${crushed} of ${N}`.padStart(24) + `${won} of ${N}`.padStart(16) + `${open} of ${N}`.padStart(13) + String(self).padStart(32));
    }
  } else if (process.argv[2] === 'solo') {
    const SEEDS = 40;
    console.log(`Each level alone in the arena with one target that stands still, ${SEEDS} arenas, 3 minutes each, no round timer:\n`);
    console.log('level'.padEnd(10) + 'blasted itself'.padStart(16) + 'got the target'.padStart(16) + 'average time to get it'.padStart(26));
    for (const lv of BOT_LEVELS) {
      let self = 0, got = 0, sum = 0;
      for (let s = 1; s <= SEEDS; s++) {
        const o = playMatch(s, [lv, null], 3 * 60 * TICK_HZ, false, false);
        if (o.fate[0] !== 'alive' && o.fate[0] !== 'train') self++; // (a train is counted at the end)
        if (o.fate[1] !== 'alive') { got++; sum += o.when[1]; }
      }
      console.log(LEVELS[lv].label.padEnd(10) + `${self} of ${SEEDS}`.padStart(16) + `${got} of ${SEEDS}`.padStart(16) + (got ? secs(sum / got) : '-').padStart(26));
    }
  } else if (process.argv[2] === 'alone') {
    // With nobody else about, does each level get into the square before the blocks stop?
    const SEEDS = 40;
    console.log(`Each level alone in an arena of bricks until 10 seconds after the blocks stop, ${SEEDS} arenas:\n`);
    console.log('level'.padEnd(10) + 'blasted itself'.padStart(16) + 'caught by a block'.padStart(19) + 'in the square at the end'.padStart(26));
    for (const lv of BOT_LEVELS) {
      let self = 0, crushed = 0, safe = 0;
      for (let s = 1; s <= SEEDS; s++) {
        const o = playMatch(s, [lv], STOP + 10 * TICK_HZ, false);
        o.fate[0] === 'alive' ? safe++ : o.fate[0] === 'crushed' ? crushed++ : o.fate[0] === 'train' ? 0 : self++;
      }
      console.log(LEVELS[lv].label.padEnd(10) + `${self} of ${SEEDS}`.padStart(16) + `${crushed} of ${SEEDS}`.padStart(19) + `${safe} of ${SEEDS}`.padStart(26));
    }
  } else {
    const SEEDS = 60;
    console.log(`Four of the same level, ${SEEDS} rounds:\n`);
    console.log('level'.padEnd(10) + 'blasted itself'.padStart(16) + 'shut in by a rival'.padStart(20) + "caught in a rival's blast".padStart(27) + 'block, early'.padStart(14) + 'block, late'.padStart(13) + 'won'.padStart(8) + 'draws'.padStart(10) + 'not decided'.padStart(13) + 'decided by'.padStart(12));
    for (const lv of BOT_LEVELS) {
      let self = 0, boxed = 0, other = 0, soon = 0, late = 0, won = 0, draws = 0, open = 0, length = 0, decided = 0;
      for (let s = 1; s <= SEEDS; s++) {
        const o = playMatch(s, [lv, lv, lv, lv], MAX);
        o.fate.forEach((f, i) => {
          if (i === o.winner) won++; // even if a block got it a moment after it won
          else if (f === 'self') self++;
          else if (f === 'boxed') boxed++;
          else if (f === 'other') other++;
          else if (f === 'crushed') early(o, i) ? soon++ : late++;
        });
        if (o.winner === -1) draws++;
        if (o.winner === -2) open++;
        else {
          decided++;
          length += o.ticks;
        }
      }
      const n = SEEDS * 4;
      console.log(LEVELS[lv].label.padEnd(10) + pct(self, n).padStart(16) + pct(boxed, n).padStart(20) + pct(other, n).padStart(27) + pct(soon, n).padStart(14) + pct(late, n).padStart(13) + pct(won, n).padStart(8) + `${draws} of ${SEEDS}`.padStart(10) + `${open} of ${SEEDS}`.padStart(13) + (decided ? secs(length / decided) : '-').padStart(12));
    }
    const perms = [[0, 1, 2], [1, 2, 0], [2, 0, 1]];
    const total = SEEDS * perms.length;
    console.log(`\nOne of each level in the same round, three players, ${total} rounds (each level takes each of the three corners equally often):\n`);
    const zero = (): Record<string, number> => Object.fromEntries(BOT_LEVELS.map((lv) => [lv, 0]));
    const wins = zero(), selfs = zero(), blasted = zero(), soon = zero(), kills = zero();
    let draws = 0, open = 0;
    for (let s = 1; s <= SEEDS; s++) {
      for (let rot = 0; rot < perms.length; rot++) {
        const order = perms[rot].map((k) => BOT_LEVELS[k]);
        const o = playMatch(s * 13 + rot, order, MAX);
        if (o.winner >= 0) wins[order[o.winner]]++;
        else if (o.winner === -1) draws++;
        else open++;
        order.forEach((lv, i) => {
          if (o.fate[i] === 'self') selfs[lv]++;
          if (o.fate[i] === 'other' || o.fate[i] === 'boxed' || o.fate[i] === 'self') blasted[lv]++;
          if (early(o, i) && i !== o.winner) soon[lv]++;
          if (o.fate[i] === 'other' && o.by[i] >= 0) kills[order[o.by[i]]]++;
        });
      }
    }
    console.log('level'.padEnd(10) + 'won'.padStart(8) + 'blasted'.padStart(10) + 'block, early'.padStart(14) + 'blasted itself'.padStart(16) + 'rivals it blasted'.padStart(19));
    for (const lv of BOT_LEVELS) console.log(LEVELS[lv].label.padEnd(10) + pct(wins[lv], total).padStart(8) + pct(blasted[lv], total).padStart(10) + pct(soon[lv], total).padStart(14) + pct(selfs[lv], total).padStart(16) + String(kills[lv]).padStart(19));
    console.log(`\ndraws ${draws} of ${total}, not decided ${open} of ${total}`);
  }
  if (WEST) console.log(`\nWild West: robots hit by a train in the whole run: ${ranOver}`);
  console.log(`\nTrip wires strung in the whole run: ${wiresStrung}; robots that walked into one: ${walkedIntoWire}; decoys picked up: ${decoysMade}`);
}
