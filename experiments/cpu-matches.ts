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
 *
 * These are the real CPU players and the real rules, so unlike the thumb
 * experiments this is a measurement, not a model. What it cannot tell you is
 * how they feel to play against.
 */
import { createWorld, step, World, PlayerInput, TICK_HZ, FLOOR } from '../src/sim';
import { createBot, botInput, Bot, BotLevel, BOT_LEVELS, LEVELS } from '../src/bot';

export interface Outcome {
  /**
   * for each player: 'alive'; 'other' (caught by another player's blast);
   * 'boxed' (caught by its own blast after a rival shut it in: see `shutIn`
   * below; or after its own bomb had been moved); or 'self' (caught by its
   * own blast with none of that going on)
   */
  fate: ('alive' | 'self' | 'boxed' | 'other')[];
  /** when each went out, in ticks, or -1 */
  when: number[];
  winner: number;
  ticks: number;
  /** who put each player out, or -1 */
  by: number[];
}

/** Play one match. `levels[i]` is the level of player i, or null for a player who stands still. */
export function playMatch(seed: number, levels: (BotLevel | null)[], maxTicks: number, stopWhenDecided = true): Outcome {
  const world: World = createWorld({ seed, players: levels.map((_, i) => ({ colorId: String(i) })) });
  const bots: (Bot | null)[] = levels.map((lv, i) => (lv ? createBot(i, lv, seed * 31 + 7) : null));
  const fate: Outcome['fate'] = levels.map(() => 'alive');
  const when = levels.map(() => -1);
  const by = levels.map(() => -1);
  const inputs: (PlayerInput | undefined)[] = [];
  const droppedAt = new Map<number, number>(); // bomb id -> the tile it was dropped on
  let t = 0;
  for (; t < maxTicks; t++) {
    for (let i = 0; i < bots.length; i++) inputs[i] = bots[i] ? botInput(world, bots[i]!) : undefined;
    const before = world.bombs.map((b) => ({ id: b.id, owner: b.owner, cx: b.cx, cy: b.cy, range: b.range, ground: b.state === 'ground' }));
    step(world, inputs);
    for (const b of world.bombs) if (!droppedAt.has(b.id)) droppedAt.set(b.id, b.cy * world.w + b.cx);
    for (const e of world.events) {
      if (e.type !== 'death') continue;
      const p = world.players[e.player];
      const px = Math.round(p.x);
      const py = Math.round(p.y);
      const f = world.flames.find((fl) => fl.cx === px && fl.cy === py);
      by[e.player] = f ? f.owner : -1;
      when[e.player] = t;
      if (!f || f.owner !== e.player) {
        fate[e.player] = 'other';
        continue;
      }
      // its own blast. Did a rival shut it in, or had its own bomb been moved?
      const boxed = shutIn(world, before, e.player, px, py);
      const moved = before.some((b) => b.owner === e.player && droppedAt.has(b.id) && droppedAt.get(b.id) !== b.cy * world.w + b.cx);
      fate[e.player] = boxed || moved ? 'boxed' : 'self';
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

type Seen = { id: number; owner: number; cx: number; cy: number; range: number; ground: boolean };

/**
 * A player has just been caught by its own blast at (px, py). Did a rival shut
 * it in? Yes if, within six steps of where it stood, there was a tile its own
 * bombs would not have reached that was about to be blasted by, or was blocked
 * by, a bomb a rival dropped AFTER the bomb that caught it. A rival's bomb that
 * was already down when it dropped its own does not count: it should have
 * known about that one.
 */
function shutIn(world: World, bombs: Seen[], who: number, px: number, py: number): boolean {
  const mine = bombs.filter((b) => b.owner === who && b.ground);
  const caughtBy = mine.filter((b) => inBlast(world, b, px, py)).map((b) => b.id);
  if (!caughtBy.length) return false;
  const since = Math.min(...caughtBy);
  const rivals = bombs.filter((b) => b.owner !== who && b.ground && b.id > since);
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
        if (world.tiles[i] !== FLOOR || seen.has(i)) continue;
        const b = bombAt(nx, ny);
        if (b) {
          if (b.owner !== who && b.id > since) return true; // a rival's newer bomb is in the way
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
  const MINUTES = 3;
  const MAX = MINUTES * 60 * TICK_HZ;
  if (process.argv[2] === 'versus') {
    // The stand-in for a casual human is the Beginner CPU player: slow to notice bombs and slow to act.
    const N = 80;
    console.log(`Three CPU players of one level against one slow, careless player (a Beginner CPU player), ${N} matches of up to 3 minutes:\n`);
    console.log('three of'.padEnd(10) + 'knocked the player out'.padStart(24) + 'average time'.padStart(14) + 'CPU players lost'.padStart(18) + 'of those, blasted itself'.padStart(26));
    for (const lv of BOT_LEVELS) {
      let out = 0, time = 0, lost = 0, self = 0;
      for (let s = 1; s <= N; s++) {
        const seat = s % 4;
        const o = playMatch(s, [0, 1, 2, 3].map((i) => (i === seat ? 'beginner' : lv)), MAX, false);
        if (o.fate[seat] !== 'alive') {
          out++;
          time += o.when[seat];
        }
        o.fate.forEach((f, i) => {
          if (i === seat || f === 'alive') return;
          lost++;
          if (f === 'self') self++;
        });
      }
      console.log(LEVELS[lv].label.padEnd(10) + `${out} of ${N}`.padStart(24) + (out ? `${(time / out / TICK_HZ).toFixed(0)} s` : '-').padStart(14) + `${lost} of ${N * 3}`.padStart(18) + String(self).padStart(26));
    }
  } else if (process.argv[2] === 'solo') {
    const SEEDS = 40;
    console.log(`Each level alone in the arena with one target that stands still, ${SEEDS} arenas, ${MINUTES} minutes each:\n`);
    console.log('level'.padEnd(10) + 'blasted itself'.padStart(16) + 'got the target'.padStart(16) + 'average time to get it'.padStart(26));
    for (const lv of BOT_LEVELS) {
      let self = 0, got = 0, sum = 0;
      for (let s = 1; s <= SEEDS; s++) {
        const o = playMatch(s, [lv, null], MAX, false);
        if (o.fate[0] !== 'alive') self++;
        if (o.fate[1] !== 'alive') { got++; sum += o.when[1]; }
      }
      console.log(LEVELS[lv].label.padEnd(10) + `${self} of ${SEEDS}`.padStart(16) + `${got} of ${SEEDS}`.padStart(16) + (got ? `${(sum / got / TICK_HZ).toFixed(0)} s` : '-').padStart(26));
    }
  } else {
    const SEEDS = 60;
    console.log(`Four of the same level, ${SEEDS} matches of up to ${MINUTES} minutes:\n`);
    console.log('level'.padEnd(10) + 'blasted itself'.padStart(16) + 'shut in by a rival'.padStart(20) + "caught in a rival's blast".padStart(27) + 'still in at the end'.padStart(21) + 'matches decided'.padStart(17));
    for (const lv of BOT_LEVELS) {
      let self = 0, boxed = 0, other = 0, alive = 0, decided = 0;
      for (let s = 1; s <= SEEDS; s++) {
        const o = playMatch(s, [lv, lv, lv, lv], MAX);
        for (const f of o.fate) f === 'self' ? self++ : f === 'boxed' ? boxed++ : f === 'other' ? other++ : alive++;
        if (o.winner !== -2) decided++;
      }
      const n = SEEDS * 4;
      console.log(LEVELS[lv].label.padEnd(10) + pct(self, n).padStart(16) + pct(boxed, n).padStart(20) + pct(other, n).padStart(27) + pct(alive, n).padStart(21) + `${decided} of ${SEEDS}`.padStart(17));
    }
    console.log(`\nOne of each level in the same match, ${SEEDS * 4} matches (each level takes each corner equally often):\n`);
    const wins: Record<string, number> = {}, selfs: Record<string, number> = {}, outs: Record<string, number> = {}, kills: Record<string, number> = {}, lasted: Record<string, number> = {};
    for (const lv of BOT_LEVELS) wins[lv] = selfs[lv] = outs[lv] = kills[lv] = lasted[lv] = 0;
    let draws = 0, undecided = 0;
    const total = SEEDS * 4;
    for (let s = 1; s <= SEEDS; s++) {
      for (let rot = 0; rot < 4; rot++) {
        const order = BOT_LEVELS.map((_, i) => BOT_LEVELS[(i + rot) % 4]);
        const o = playMatch(s * 13 + rot, order, MAX);
        if (o.winner >= 0) wins[order[o.winner]]++;
        else if (o.winner === -1) draws++;
        else undecided++;
        order.forEach((lv, i) => {
          if (o.fate[i] === 'self') selfs[lv]++;
          if (o.fate[i] !== 'alive') outs[lv]++;
          if (o.fate[i] === 'other' && o.by[i] >= 0) kills[order[o.by[i]]]++;
          lasted[lv] += o.when[i] < 0 ? o.ticks : o.when[i];
        });
      }
    }
    console.log('level'.padEnd(10) + 'won'.padStart(8) + 'knocked out'.padStart(13) + 'blasted itself'.padStart(16) + 'rivals it blasted'.padStart(19));
    for (const lv of BOT_LEVELS) console.log(LEVELS[lv].label.padEnd(10) + pct(wins[lv], total).padStart(8) + pct(outs[lv], total).padStart(13) + pct(selfs[lv], total).padStart(16) + String(kills[lv]).padStart(19));
    console.log(`\ndraws ${draws}, not decided in time ${undecided}`);
  }
}
