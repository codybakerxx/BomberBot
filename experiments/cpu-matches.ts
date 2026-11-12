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
 *
 * These are the real CPU players and the real rules, so unlike the thumb
 * experiments this is a measurement, not a model. What it cannot tell you is
 * how they feel to play against.
 */
import { createWorld, step, World, PlayerInput, TICK_HZ, FLOOR, ROUND_TICKS, SHRINK_TICKS } from '../src/sim';
import { createBot, botInput, Bot, BotLevel, BOT_LEVELS, LEVELS } from '../src/bot';

export interface Outcome {
  /**
   * for each player: 'alive'; 'other' (caught by another player's blast);
   * 'boxed' (caught by its own blast after a rival shut it in: see `shutIn`
   * below; or after its own bomb had been moved; or after a rival's bomb set
   * its own off early: see `cause` in `playMatch`); or 'self' (caught by its
   * own blast with none of that going on); or 'crushed' (a falling block
   * landed on it)
   */
  fate: ('alive' | 'self' | 'boxed' | 'other' | 'crushed')[];
  /** when each went out, in ticks, or -1 */
  when: number[];
  winner: number;
  ticks: number;
  /** who put each player out, or -1 */
  by: number[];
}

/**
 * Play one match. `levels[i]` is the level of player i, or null for a player
 * who stands still. With `timer` false the round has no time limit and no
 * blocks fall.
 */
export function playMatch(seed: number, levels: (BotLevel | null)[], maxTicks: number, stopWhenDecided = true, timer = true): Outcome {
  const world: World = createWorld({ seed, players: levels.map((_, i) => ({ colorId: String(i) })), roundTicks: timer ? undefined : 0 });
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
  let t = 0;
  for (; t < maxTicks; t++) {
    for (let i = 0; i < bots.length; i++) inputs[i] = bots[i] ? botInput(world, bots[i]!) : undefined;
    const before = world.bombs.map((b) => ({ id: b.id, owner: b.owner, cx: b.cx, cy: b.cy, range: b.range, ground: b.state === 'ground', fuse: b.fuse }));
    step(world, inputs);
    const wentOff = before.filter((b) => !world.bombs.some((x) => x.id === b.id));
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
      if (e.by !== e.player) {
        fate[e.player] = 'other';
        continue;
      }
      // its own blast. Did a rival shut it in, or had its own bomb been moved, or set off early by a rival's?
      const boxed = shutIn(world, before, e.player, px, py, (id) => droppedOn.get(id) ?? 0, (id) => restingAt.get(id)?.since ?? 0, (i) => landedOn.get(i) ?? -1);
      const moved = before.some((b) => b.owner === e.player && droppedAt.has(b.id) && droppedAt.get(b.id) !== b.cy * world.w + b.cx);
      // Set off early: the bomb that caught it went off before its fuse ran out, because a rival's bomb reached
      // it, and that rival's bomb was dropped, kicked or thrown after this one was dropped. (A rival's bomb that
      // was lying there already, and went off when its own fuse said, it should have allowed for.)
      const early = before.some((b) => {
        const c = cause.get(b.id);
        return b.owner === e.player && b.ground && rushed.has(b.id) && inBlast(world, b, px, py) && !!c && c.owner !== e.player && c.tick >= (droppedOn.get(b.id) ?? 0);
      });
      fate[e.player] = boxed || moved || early ? 'boxed' : 'self';
    }
    if (stopWhenDecided && world.over) break;
  }
  return { fate, when, winner: world.over ? world.over.winner : -2, ticks: t, by };
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

/**
 * A player has just been caught by its own blast at (px, py). Did a rival shut
 * it in? Yes if, within six steps of where it stood, there was a tile its own
 * bombs would not have reached that was about to be blasted by, or was blocked
 * by, a rival's bomb that came to lie there no earlier than the bomb that
 * caught it was dropped: dropped on the same tick or later, or kicked or
 * thrown there since. A rival's bomb that was already lying there when it
 * dropped its own does not count: it should have known about that one. The search is over the arena as it was when the bomb
 * was dropped: a tile a block has landed on since still counts as a way it
 * had.
 */
function shutIn(world: World, bombs: Seen[], who: number, px: number, py: number, droppedOn: (id: number) => number, restingSince: (id: number) => number, landedOn: (tile: number) => number): boolean {
  const mine = bombs.filter((b) => b.owner === who && b.ground);
  const caughtBy = mine.filter((b) => inBlast(world, b, px, py)).map((b) => b.id);
  if (!caughtBy.length) return false;
  const since = Math.min(...caughtBy);
  // a tile counts as open if it is floor, or was floor when that bomb was dropped (a block has landed on it since)
  const open = (i: number): boolean => world.tiles[i] === FLOOR || landedOn(i) > droppedOn(since);
  // a rival's bomb counts if it came to lie where it is on the same tick as that bomb was dropped, or later:
  // dropped then (the two could not have known of each other), or kicked or thrown there since
  const after = (b: Seen): boolean => restingSince(b.id) >= droppedOn(since);
  const rivals = bombs.filter((b) => b.owner !== who && b.ground && after(b));
  if (!rivals.length) return false;
  const bombAt = (x: number, y: number): Seen | undefined => bombs.find((b) => b.ground && b.cx === x && b.cy === y);
  const seen = new Set<number>([py * world.w + px]);
  let edge: [number, number][] = [[px, py]];
  for (let depth = 0; depth <= 6 && edge.length; depth++) {
    const next: [number, number][] = [];
    for (const [x, y] of edge) {
      if (!mine.some((b) => inBlast(world, b, x, y)) && rivals.some((b) => inBlast(world, b, x, y))) return true;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        const i = ny * world.w + nx;
        if (!open(i) || seen.has(i)) continue;
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
  if (process.argv[2] === 'versus') {
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
        if (o.fate[0] !== 'alive') self++;
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
        o.fate[0] === 'alive' ? safe++ : o.fate[0] === 'crushed' ? crushed++ : self++;
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
}
