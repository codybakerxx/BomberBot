/**
 * CPU players.
 *
 * A CPU player is given the world and returns the same thing a human's
 * controls do: a direction and the A and B buttons, once per tick. It has no
 * powers a player lacks and moves by the same rules.
 *
 * Pure logic, like the rules: no browser APIs, no Math.random, no clocks. Any
 * randomness comes from a seeded generator kept in the bot, so the same seed
 * gives the same match, and a server can run CPU players for online games.
 *
 * How one thinks, in order:
 *   1. DANGER MAP. For every tile, when a blast will be on it. Built from the
 *      bombs it knows about, including chain reactions, bricks that will be
 *      gone by then, bombs sliding after a kick and bombs in the air.
 *   2. If its own tile is going to be blasted: FLEE along the quickest route
 *      to a tile that will not be, timed so it is never on a tile while that
 *      tile burns.
 *   3. Otherwise DECIDE: bomb a player who is in line, or pick a goal (a
 *      power-up, a spot to blast bricks from, a spot to attack a player from)
 *      and walk there.
 *   4. Before pressing A it always checks there is a way out of its own
 *      blast, then PLAYS THE MOVE FORWARD on a copy of the world with the real
 *      rules to confirm it survives. If either check fails it does not bomb.
 *
 * The four levels differ in how quickly they think, how soon they notice
 * other players' bombs, how hard they go after players and which tricks they
 * know. All four apply step 4 in full: no level bombs itself on purpose.
 *
 * docs/CPU-PLAYERS.md explains all of this in plain words.
 */
import {
  World,
  Player,
  Bomb,
  Dir,
  PlayerInput,
  ItemKind,
  DX,
  DY,
  FLOOR,
  HARD,
  SOFT,
  FUSE_TICKS,
  FLAME_TICKS,
  CHAIN_TICKS,
  KICK_SPEED,
  FLY_TICKS_PER_TILE,
  playerSpeed,
  makeRng,
  cloneWorld,
  step,
} from './sim';

// ---------------------------------------------------------------- levels

export type BotLevel = 'beginner' | 'normal' | 'hard' | 'extreme';

/** The order the levels are offered in, easiest first. */
export const BOT_LEVELS: BotLevel[] = ['beginner', 'normal', 'hard', 'extreme'];

export interface LevelSpec {
  /** name shown in the menu */
  label: string;
  /** one line for the menu */
  blurb: string;
  /** ticks between decisions (60 ticks = 1 second) */
  think: number;
  /** it pauses this many ticks, at random between the two, before setting off for a new goal */
  hesitate: [number, number];
  /** ticks before it notices a bomb another player has dropped */
  notice: number;
  /** spare ticks it keeps when timing a run past a blast */
  margin: number;
  /** most bombs it will have out at once, however many it has collected */
  maxBombs: number;
  /** how strongly it goes after players, against bricks and power-ups (near 0: only when nothing else is left) */
  hunt: number;
  /** chance, each time it thinks, of bombing a player who is in its blast line */
  attack: number;
  /** how far along its blast line, in tiles, a player must be for that */
  attackReach: number;
  /** works out when a bomb would leave a player no way out, always takes that shot, and looks for spots to take it from */
  killShot: boolean;
  /**
   * Before bombing it checks that no player within this many tiles could get
   * onto its way out ahead of it, or drop a bomb where they stand, and shut
   * it in. 0 = it does not look. Lower levels look less far, so a player
   * coming from further off can still box them in.
   */
  guard: number;
  /** when boxed in, kicks a bomb out of the way (needs the boot) */
  kickEscape: boolean;
  /** kicks a bomb along a lane at a player (needs the boot) */
  kickAttack: boolean;
  /** when boxed in, lifts a bomb and throws it clear (needs the glove) */
  throwEscape: boolean;
  /** moves out of spots where a nearby player could box it in with one bomb */
  evade: boolean;
  /** will not blast a power-up lying in the open just to break bricks */
  spareItems: boolean;
  /** randomness in its choice of goal, 0 to 1 */
  wobble: number;
}

export const LEVELS: Record<BotLevel, LevelSpec> = {
  beginner: {
    label: 'Beginner',
    blurb: 'Slow to react and mostly minds its own business.',
    think: 30,
    hesitate: [20, 60],
    notice: 45,
    margin: 14,
    maxBombs: 1,
    hunt: 0.3,
    attack: 0.4,
    attackReach: 2,
    killShot: false,
    guard: 3,
    kickEscape: false,
    kickAttack: false,
    throwEscape: false,
    evade: false,
    spareItems: false,
    wobble: 0.6,
  },
  normal: {
    label: 'Normal',
    blurb: 'Collects power-ups and comes after you once it can reach you.',
    think: 14,
    hesitate: [0, 14],
    notice: 16,
    margin: 9,
    maxBombs: 2,
    hunt: 0.7,
    attack: 0.6,
    attackReach: 4,
    killShot: false,
    guard: 5,
    kickEscape: true,
    kickAttack: false,
    throwEscape: false,
    evade: false,
    spareItems: false,
    wobble: 0.3,
  },
  hard: {
    label: 'Hard',
    blurb: 'Quick, hunts you, and spots when a bomb would leave you no way out.',
    think: 8,
    hesitate: [0, 0],
    notice: 6,
    margin: 6,
    maxBombs: 8,
    hunt: 1.2,
    attack: 0.8,
    attackReach: 8,
    killShot: true,
    guard: 7,
    kickEscape: true,
    kickAttack: true,
    throwEscape: true,
    evade: false,
    spareItems: true,
    wobble: 0.15,
  },
  extreme: {
    label: 'Extreme',
    blurb: 'Reacts at once, sets traps, and will not let itself be cornered.',
    think: 4,
    hesitate: [0, 0],
    notice: 0,
    margin: 4,
    maxBombs: 8,
    hunt: 1.6,
    attack: 1,
    attackReach: 8,
    killShot: true,
    guard: 99,
    kickEscape: true,
    kickAttack: true,
    throwEscape: true,
    evade: true,
    spareItems: true,
    wobble: 0.05,
  },
};

// ---------------------------------------------------------------- the bot's memory

export type GoalKind = 'none' | 'item' | 'brick' | 'hunt' | 'evade';

export interface Bot {
  /** which player it controls */
  id: number;
  level: BotLevel;
  rng: () => number;
  /** tiles still to walk through, nearest first (tile index = y * w + x) */
  path: number[];
  goal: GoalKind;
  goalTile: number;
  /** ticks until it next thinks */
  thinkIn: number;
  /** ticks left of a pause */
  wait: number;
  /** button presses already decided for the coming ticks (a kick or a throw takes several) */
  script: PlayerInput[];
  /** tiles it will not try to bomb from for now: tile -> world tick when it may try again */
  avoid: Map<number, number>;
  /** for noticing that it is pushing against something and not moving */
  lastX: number;
  lastY: number;
  stuck: number;
  /** what it was doing on its last tick, for tests and debugging */
  doing: 'idle' | 'flee' | 'travel' | 'bomb' | 'script' | 'trapped';
}

export function createBot(id: number, level: BotLevel, seed: number): Bot {
  return {
    id,
    level,
    rng: makeRng((seed ^ Math.imul(id + 1, 0x9e3779b1)) >>> 0),
    path: [],
    goal: 'none',
    goalTile: -1,
    thinkIn: 0,
    wait: 0,
    script: [],
    avoid: new Map(),
    lastX: -1,
    lastY: -1,
    stuck: 0,
    doing: 'idle',
  };
}

const NONE: PlayerInput = { dir: 0, a: false, b: false };
const go = (dir: Dir | -1): PlayerInput => ({ dir: dir === -1 ? 0 : dir, a: false, b: false });

// ---------------------------------------------------------------- the danger map

/**
 * When each tile will have a blast on it. Times are in ticks from now.
 * `iv[tile]` holds pairs: from, to, from, to... A blast is on the tile from
 * `from` up to but not including `to`.
 */
export interface Danger {
  w: number;
  iv: (number[] | undefined)[];
  /** bricks that are burning or will be hit: tile -> when it turns to floor */
  gone: Map<number, number>;
}

/** A bomb that does not exist yet, to ask "what if one were dropped here?" */
export interface ExtraBomb {
  cx: number;
  cy: number;
  range: number;
  fuse: number;
}

const wrap = (v: number, n: number): number => ((v % n) + n) % n;

function tileOf(world: World, p: { x: number; y: number }): number {
  return Math.round(p.y) * world.w + Math.round(p.x);
}

/** Is a bomb sitting on this tile? */
function groundBombAt(world: World, cx: number, cy: number): Bomb | undefined {
  for (const b of world.bombs) if (b.state === 'ground' && b.cx === cx && b.cy === cy) return b;
  return undefined;
}

function tile(world: World, cx: number, cy: number): number {
  if (cx < 0 || cy < 0 || cx >= world.w || cy >= world.h) return HARD;
  return world.tiles[cy * world.w + cx];
}

/** Where a bomb will be when it goes off, and when. `landT` is when it will be on the floor. */
function foresee(world: World, b: Bomb): { cx: number; cy: number; t: number; landT: number } {
  if (b.state === 'held') {
    const p = world.players[b.heldBy];
    return { cx: p ? Math.round(p.x) : b.cx, cy: p ? Math.round(p.y) : b.cy, t: Math.max(1, b.fuse), landT: 0 };
  }
  if (b.state === 'air') {
    // the same rule as moveBombs in sim.ts: land at flyDist, bouncing on while the tile is taken
    let dist = b.flyDist;
    let lx = 0;
    let ly = 0;
    for (let guard = 0; guard < world.w + world.h + 4; guard++, dist++) {
      lx = wrap(b.fromX + DX[b.flyDir] * dist, world.w);
      ly = wrap(b.fromY + DY[b.flyDir] * dist, world.h);
      if (tile(world, lx, ly) === FLOOR && !groundBombAt(world, lx, ly)) break;
    }
    const landT = Math.max(1, dist * FLY_TICKS_PER_TILE - b.flyT);
    return { cx: lx, cy: ly, t: Math.max(b.fuse, landT + 1), landT };
  }
  if (b.slide) {
    // a kicked bomb: follow its slide until it stops or its fuse runs out
    const dx = DX[b.slide];
    const dy = DY[b.slide];
    let pos = dx !== 0 ? b.x : b.y;
    let cx = b.cx;
    let cy = b.cy;
    const dir = dx !== 0 ? dx : dy;
    for (let k = 0; k < b.fuse; k++) {
      const centre = Math.round(pos);
      let next = pos + dir * KICK_SPEED;
      if ((pos - centre) * dir <= 0 && (next - centre) * dir >= 0) {
        if (tile(world, cx + dx, cy + dy) !== FLOOR || groundBombAt(world, cx + dx, cy + dy)) {
          next = centre;
          pos = next;
          break;
        }
      }
      pos = next;
      if (dx !== 0) cx = Math.round(pos);
      else cy = Math.round(pos);
    }
    return { cx, cy, t: Math.max(1, b.fuse), landT: 0 };
  }
  return { cx: b.cx, cy: b.cy, t: Math.max(1, b.fuse), landT: 0 };
}

/**
 * The tiles a blast from (cx, cy) covers at time `t`, by the same rules as
 * explode() in sim.ts. Bricks stop it unless they will be gone by then; a
 * brick it reaches is noted as gone once it has burnt.
 */
function blastTiles(world: World, gone: Map<number, number>, cx: number, cy: number, range: number, t: number, note: boolean): number[] {
  const out = [cy * world.w + cx];
  for (let d = 1; d <= 4; d++) {
    for (let i = 1; i <= range; i++) {
      const x = cx + DX[d] * i;
      const y = cy + DY[d] * i;
      const kind = tile(world, x, y);
      if (kind === HARD) break;
      const idx = y * world.w + x;
      if (kind === SOFT) {
        const g = gone.get(idx);
        if (g !== undefined && g <= t) {
          out.push(idx); // burnt away by an earlier blast
          continue;
        }
        if (note && g === undefined) gone.set(idx, t + FLAME_TICKS);
        break;
      }
      out.push(idx);
    }
  }
  return out;
}

/**
 * Build the danger map. `viewer` and `notice` model slow reactions: a bomb
 * dropped by someone else is left out until it has been down for `notice`
 * ticks. Pass `extra` to include bombs that have not been dropped yet.
 */
export function dangerMap(world: World, viewer: Player | null, notice: number, extra: ExtraBomb[] = []): Danger {
  const iv: (number[] | undefined)[] = new Array(world.w * world.h);
  const gone = new Map<number, number>();
  const add = (idx: number, from: number, to: number): void => {
    (iv[idx] ??= []).push(from, to);
  };
  for (const b of world.burning) gone.set(b.cy * world.w + b.cx, b.ttl);
  for (const f of world.flames) add(f.cy * world.w + f.cx, 0, f.ttl);

  const pending: { cx: number; cy: number; t: number; landT: number; range: number; done: boolean }[] = [];
  for (const b of world.bombs) {
    if (viewer && b.owner !== viewer.id && b.heldBy !== viewer.id && b.age < notice) continue;
    pending.push({ ...foresee(world, b), range: b.range, done: false });
  }
  for (const e of extra) pending.push({ cx: e.cx, cy: e.cy, t: e.fuse, landT: 0, range: e.range, done: false });

  // earliest first, so each blast can set off the bombs it reaches
  for (let n = 0; n < pending.length; n++) {
    let next = -1;
    for (let i = 0; i < pending.length; i++) {
      if (!pending[i].done && (next < 0 || pending[i].t < pending[next].t)) next = i;
    }
    const b = pending[next];
    b.done = true;
    const tiles = blastTiles(world, gone, b.cx, b.cy, b.range, b.t, true);
    for (const idx of tiles) add(idx, b.t, b.t + FLAME_TICKS);
    for (const o of pending) {
      if (o.done || o.landT > b.t + FLAME_TICKS) continue;
      if (tiles.includes(o.cy * world.w + o.cx)) o.t = Math.min(o.t, Math.max(b.t, o.landT) + CHAIN_TICKS);
    }
  }
  return { w: world.w, iv, gone };
}

/** Will this tile be blasted at all? */
export function hasDanger(D: Danger, idx: number): boolean {
  return D.iv[idx] !== undefined;
}

/** Is there a blast on this tile at any moment between `a` and `b`? */
function overlaps(D: Danger, idx: number, a: number, b: number): boolean {
  const v = D.iv[idx];
  if (!v) return false;
  for (let i = 0; i < v.length; i += 2) if (v[i] < b && v[i + 1] > a) return true;
  return false;
}

/** Is this tile free of blasts from time `a` onward? */
function safeAfter(D: Danger, idx: number, a: number): boolean {
  const v = D.iv[idx];
  if (!v) return true;
  for (let i = 0; i < v.length; i += 2) if (v[i + 1] > a) return false;
  return true;
}

// ---------------------------------------------------------------- finding a way

/** Tiles that cannot be walked onto: blocks, bricks and bombs on the floor. */
function wallsOf(world: World): Uint8Array {
  const out = new Uint8Array(world.w * world.h);
  for (let i = 0; i < out.length; i++) if (world.tiles[i] !== FLOOR) out[i] = 1;
  for (const b of world.bombs) if (b.state === 'ground') out[b.cy * world.w + b.cx] = 1;
  return out;
}

interface Reach {
  start: number;
  /** when the player would reach the middle of each tile (Infinity if it cannot) */
  time: Float64Array;
  /** when it would start to count as standing on each tile */
  enter: Float64Array;
  prev: Int16Array;
}

/**
 * Times for stepping from tile `from` to the next tile in direction `d`:
 * [when the player starts to count as standing on the new tile, when it
 * reaches the middle]. The first step is worked out from where the player
 * really is, which may be off the middle of its tile.
 */
function stepTimes(world: World, p: Player, sp: number, start: number, from: number, tFrom: number, d: number): [number, number] {
  if (from !== start) return [tFrom + 0.5 / sp, tFrom + 1 / sp];
  const sx = start % world.w;
  const sy = (start - sx) / world.w;
  const offX = p.x - sx;
  const offY = p.y - sy;
  const horizontal = d >= 3;
  const across = Math.abs(horizontal ? offY : offX);
  if (across > 1e-6) return [(across + 0.5) / sp, (across + 1) / sp]; // line up with the tile first
  const dist = Math.abs(horizontal ? sx + DX[d] - p.x : sy + DY[d] - p.y);
  return [Math.max(0, dist - 0.5) / sp, dist / sp];
}

/**
 * Everywhere player `p` can walk, and how soon, without ever being on a tile
 * while it burns. A step from A to B is allowed only if A is clear until the
 * player has left it and B is clear from when the player enters it until it
 * reaches the middle, each with `margin` ticks to spare.
 */
function explore(world: World, p: Player, D: Danger, margin: number, walls: Uint8Array): Reach {
  const n = world.w * world.h;
  const time = new Float64Array(n).fill(Infinity);
  const enter = new Float64Array(n).fill(Infinity);
  const prev = new Int16Array(n).fill(-1);
  const start = tileOf(world, p);
  const sp = playerSpeed(p);
  time[start] = 0;
  enter[start] = 0;
  const open = [start];
  const closed = new Uint8Array(n);
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (time[open[i]] < time[open[bi]]) bi = i;
    const cur = open[bi];
    open[bi] = open[open.length - 1];
    open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % world.w;
    const cy = (cur - cx) / world.w;
    for (let d = 1; d <= 4; d++) {
      const nx = cx + DX[d];
      const ny = cy + DY[d];
      if (nx < 0 || ny < 0 || nx >= world.w || ny >= world.h) continue;
      const nb = ny * world.w + nx;
      if (walls[nb] || closed[nb]) continue;
      const [mid, arr] = stepTimes(world, p, sp, start, cur, time[cur], d);
      if (arr >= time[nb]) continue;
      if (overlaps(D, cur, enter[cur] - margin, mid + margin)) continue;
      if (overlaps(D, nb, mid - margin, arr + margin)) continue;
      time[nb] = arr;
      enter[nb] = mid;
      prev[nb] = cur;
      open.push(nb);
    }
  }
  return { start, time, enter, prev };
}

/** The tiles to walk through to reach `target`, nearest first. */
function pathTo(reach: Reach, target: number): number[] {
  const out: number[] = [];
  for (let t = target; t !== reach.start && t >= 0; t = reach.prev[t]) out.push(t);
  return out.reverse();
}

/** Tiles the player can reach that will not be blasted once it is on them, quickest first. */
function escapeTargets(D: Danger, reach: Reach, margin: number, limit: number, rng?: () => number): number[] {
  const found: [number, number][] = [];
  for (let i = 0; i < reach.time.length; i++) {
    const t = reach.time[i];
    if (t === Infinity || i === reach.start) continue;
    if (!safeAfter(D, i, reach.enter[i] - margin)) continue;
    found.push([t + (rng ? rng() * 0.5 : 0), i]);
  }
  found.sort((a, b) => a[0] - b[0]);
  return found.slice(0, limit).map((f) => f[1]);
}

/** The quickest of those, or -1. */
function escapeTarget(D: Danger, reach: Reach, margin: number, rng?: () => number): number {
  const t = escapeTargets(D, reach, margin, 1, rng);
  return t.length ? t[0] : -1;
}

/** A rival has to be this many ticks later onto a tile of the way out before it stops counting as able to block it. */
const GUARD_SLACK = 6;

const NO_DANGER: Danger = { w: 0, iv: [], gone: new Map() };

/** Is a path still walkable and still timed safely? */
function pathOk(world: World, p: Player, D: Danger, path: number[], margin: number, walls: Uint8Array, safeEnd: boolean): boolean {
  const start = tileOf(world, p);
  const sp = playerSpeed(p);
  let cur = start;
  let t = 0;
  let entered = 0;
  for (const nb of path) {
    if (walls[nb]) return false;
    const dx = (nb % world.w) - (cur % world.w);
    const dy = Math.floor(nb / world.w) - Math.floor(cur / world.w);
    if (Math.abs(dx) + Math.abs(dy) !== 1) return false;
    const d = dx === 1 ? 4 : dx === -1 ? 3 : dy === 1 ? 2 : 1;
    const [mid, arr] = stepTimes(world, p, sp, start, cur, t, d);
    if (overlaps(D, cur, entered - margin, mid + margin)) return false;
    if (overlaps(D, nb, mid - margin, arr + margin)) return false;
    cur = nb;
    t = arr;
    entered = mid;
  }
  return !safeEnd || safeAfter(D, cur, entered - margin);
}

/** Drop the tiles already reached from the front of a path. Returns true if that emptied it. */
function advance(world: World, p: Player, path: number[]): boolean {
  if (!path.length) return false;
  const here = tileOf(world, p);
  while (path.length && path[0] === here) path.shift();
  return path.length === 0;
}

/**
 * The direction to press to follow a path. With no path left, it shuffles to
 * the middle of its tile. Returns -1 if the path does not start next to the
 * player, which means the path is no longer any use.
 */
function steer(world: World, p: Player, path: number[]): Dir | -1 {
  const sx = Math.round(p.x);
  const sy = Math.round(p.y);
  if (!path.length) {
    const sp = playerSpeed(p);
    if (p.x - sx > sp) return 3;
    if (sx - p.x > sp) return 4;
    if (p.y - sy > sp) return 1;
    if (sy - p.y > sp) return 2;
    return 0;
  }
  const nx = path[0] % world.w;
  const ny = (path[0] - nx) / world.w;
  if (nx === sx + 1 && ny === sy) return 4;
  if (nx === sx - 1 && ny === sy) return 3;
  if (ny === sy + 1 && nx === sx) return 2;
  if (ny === sy - 1 && nx === sx) return 1;
  return -1;
}

// ---------------------------------------------------------------- trying a move out

/**
 * Play forward on a copy of the world, with the real rules, and say whether
 * player `id` is still standing once every bomb has gone off. The player
 * first presses `prefix`, one entry per tick, then walks `path`. Everyone
 * else stands still.
 */
function survives(world: World, id: number, prefix: PlayerInput[], path: number[]): boolean {
  const w = cloneWorld(world);
  return playOut(w, id, prefix, path);
}

function playOut(w: World, id: number, prefix: PlayerInput[], path: number[]): boolean {
  const me = w.players[id];
  const route = [...path];
  const inputs: (PlayerInput | undefined)[] = [];
  for (let t = 0; t < 460; t++) {
    let inp: PlayerInput;
    if (t < prefix.length) inp = prefix[t];
    else {
      advance(w, me, route);
      const d = steer(w, me, route);
      inp = go(d);
    }
    inputs[id] = inp;
    step(w, inputs);
    if (!me.alive) return false;
    if (t >= prefix.length && !w.bombs.length && !w.flames.length) break;
  }
  return true;
}

// ---------------------------------------------------------------- what a bomb would do

interface Effect {
  /** tiles the blast would cover */
  tiles: number[];
  /** bricks it would break that nothing else is already going to break */
  bricks: number;
  /** power-ups lying in the open that it would destroy */
  items: number;
}

function bombEffect(world: World, D: Danger, cx: number, cy: number, range: number): Effect {
  const tiles = [cy * world.w + cx];
  let bricks = 0;
  for (let d = 1; d <= 4; d++) {
    for (let i = 1; i <= range; i++) {
      const x = cx + DX[d] * i;
      const y = cy + DY[d] * i;
      const kind = tile(world, x, y);
      if (kind === HARD) break;
      const idx = y * world.w + x;
      if (kind === SOFT) {
        if (!D.gone.has(idx)) bricks++;
        break;
      }
      tiles.push(idx);
    }
  }
  let items = 0;
  for (const it of world.items) if (tiles.includes(it.cy * world.w + it.cx)) items++;
  return { tiles, bricks, items };
}

/** How much each power-up is worth going out of the way for. */
function itemWorth(p: Player, kind: ItemKind): number {
  if (kind === 'kick') return p.canKick ? 0.2 : 2;
  if (kind === 'grab') return p.canGrab ? 0.2 : 1.6;
  if (kind === 'speed') return 2.6;
  return 3;
}

// ---------------------------------------------------------------- one tick

interface Ctx {
  world: World;
  me: Player;
  bot: Bot;
  spec: LevelSpec;
  D: Danger;
  walls: Uint8Array;
  S: number;
  /** filled in by trapTiles */
  traps?: number[];
}

/**
 * What the CPU player does this tick. Call once per tick, before step(),
 * and pass the result as that player's input.
 */
export function botInput(world: World, bot: Bot): PlayerInput {
  const me = world.players[bot.id];
  if (!me || !me.alive) return NONE;
  if (bot.script.length) {
    bot.doing = 'script';
    bot.path = [];
    return bot.script.shift()!;
  }
  const spec = LEVELS[bot.level];
  const c: Ctx = { world, me, bot, spec, D: dangerMap(world, me, spec.notice), walls: wallsOf(world), S: tileOf(world, me) };

  // pushing against something and getting nowhere: forget the plan
  if (bot.path.length && bot.wait <= 0 && me.x === bot.lastX && me.y === bot.lastY) {
    if (++bot.stuck > 3) {
      bot.path = [];
      bot.stuck = 0;
      bot.thinkIn = 0;
    }
  } else bot.stuck = 0;
  bot.lastX = me.x;
  bot.lastY = me.y;

  const out = me.carrying ? carrying(c) : hasDanger(c.D, c.S) ? flee(c) : calm(c);
  return out;
}

/** Its own tile is going to be blasted: get off it. */
function flee(c: Ctx): PlayerInput {
  const { world, me, bot, spec, D, walls } = c;
  advance(world, me, bot.path);
  if (!bot.path.length || bot.doing !== 'flee' || !pathOk(world, me, D, bot.path, Math.min(spec.margin, 2), walls, true)) {
    bot.path = [];
    for (const margin of [spec.margin, 1, 0]) {
      const reach = explore(world, me, D, margin, walls);
      const target = escapeTarget(D, reach, margin, bot.rng);
      if (target >= 0) {
        bot.path = pathTo(reach, target);
        break;
      }
    }
    if (!bot.path.length) {
      // boxed in: the levels that know how try to kick or throw their way out
      const trick = wayOut(c);
      if (trick) {
        bot.script = trick;
        bot.doing = 'script';
        return bot.script.shift()!;
      }
      bot.doing = 'trapped';
      return go(steer(world, me, []));
    }
  }
  bot.doing = 'flee';
  bot.goal = 'none';
  const d = steer(world, me, bot.path);
  if (d < 0) {
    bot.path = [];
    return NONE;
  }
  return go(d);
}

/** Nothing is about to hit its tile: follow the plan, or make one. */
function calm(c: Ctx): PlayerInput {
  const { world, me, bot, spec, D, walls } = c;
  if (bot.wait > 0) {
    // making up its mind: stand where it is (its tile is not in any blast, or it would be fleeing)
    bot.wait--;
    bot.doing = 'idle';
    return NONE;
  }
  const hadPath = bot.path.length > 0;
  const arrived = advance(world, me, bot.path) && hadPath;
  let think = --bot.thinkIn <= 0 || arrived || bot.doing === 'flee' || bot.doing === 'trapped';
  if (bot.path.length && !pathOk(world, me, D, bot.path, spec.margin, walls, false)) {
    bot.path = [];
    think = true;
  }
  if (think) {
    bot.thinkIn = spec.think + Math.floor(bot.rng() * 4);
    const act = decide(c);
    if (act) return act;
  }
  const d = steer(world, me, bot.path);
  if (d < 0) {
    bot.path = [];
    bot.thinkIn = 0;
    return NONE;
  }
  bot.doing = bot.path.length ? 'travel' : 'idle';
  return go(d);
}

/** Left holding a bomb with no plan: throw it where that is survivable. */
function carrying(c: Ctx): PlayerInput {
  const { bot } = c;
  for (const d of shuffled(bot.rng)) {
    const prefix = tryOut(c, (_w, _me, t) => (t === 0 ? go(d) : t === 1 ? { dir: 0, a: false, b: true } : 'done'));
    if (prefix) {
      bot.script = prefix;
      bot.doing = 'script';
      return bot.script.shift()!;
    }
  }
  return { dir: 0, a: false, b: true };
}

function shuffled(rng: () => number): Dir[] {
  const out: Dir[] = [1, 2, 3, 4];
  for (let i = 3; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---------------------------------------------------------------- deciding

function decide(c: Ctx): PlayerInput | null {
  const { world, me, bot, spec, D, walls, S } = c;
  const sx = S % world.w;
  const sy = (S - sx) / world.w;
  const enemies = world.players.filter((p) => p.alive && p.id !== me.id);
  const wasIdle = bot.path.length === 0;
  const canBomb =
    !me.carrying &&
    me.activeBombs < Math.min(me.bombsMax, spec.maxBombs) &&
    !groundBombAt(world, sx, sy) &&
    !((bot.avoid.get(S) ?? 0) > world.tick);

  // a bomb lying next to it with a player further along the lane: kick it at them
  if (spec.kickAttack && me.canKick) {
    for (const d of shuffled(bot.rng)) {
      if (!groundBombAt(world, sx + DX[d], sy + DY[d]) || !enemyAlong(c, enemies, sx + DX[d], sy + DY[d], d)) continue;
      const prefix = tryOut(c, kickDriver(c, d));
      if (prefix) {
        bot.script = prefix;
        bot.doing = 'script';
        return bot.script.shift()!;
      }
    }
  }

  if (canBomb) {
    const fx = bombEffect(world, D, sx, sy, me.fire);
    let want = false;
    if (spec.killShot) {
      for (const e of enemies) {
        if (Math.abs(Math.round(e.x) - sx) + Math.abs(Math.round(e.y) - sy) > me.fire + 3) continue;
        if (boxedIn(c, e, [{ cx: sx, cy: sy, range: me.fire, fuse: FUSE_TICKS }], S)) want = true;
      }
    }
    if (!want) {
      const inLine = enemies.some((e) => {
        const reach = Math.abs(Math.round(e.x) - sx) + Math.abs(Math.round(e.y) - sy);
        return reach <= spec.attackReach && fx.tiles.includes(tileOf(world, e));
      });
      if (inLine && bot.rng() < spec.attack) want = true;
    }
    if (want) {
      const act = placeBomb(c);
      if (act) return act;
    }
  }

  // a nearby player could box it in with one bomb: move somewhere that is not true
  const reach = explore(world, me, D, spec.margin, walls);
  if (spec.evade) {
    for (const e of enemies) {
      const ex = Math.round(e.x);
      const ey = Math.round(e.y);
      if (Math.abs(ex - sx) + Math.abs(ey - sy) > 5 || e.carrying || e.activeBombs >= e.bombsMax) continue;
      const what = [{ cx: ex, cy: ey, range: e.fire, fuse: FUSE_TICKS }];
      if (!boxedIn(c, me, what, ey * world.w + ex)) continue;
      const D3 = dangerMap(world, me, spec.notice, what);
      let best = -1;
      for (let i = 0; i < reach.time.length; i++) {
        if (reach.time[i] > 70 || i === S || hasDanger(D3, i) || hasDanger(D, i)) continue;
        if (best < 0 || reach.time[i] < reach.time[best]) best = i;
      }
      if (best >= 0) {
        bot.path = pathTo(reach, best);
        bot.goal = 'evade';
        bot.goalTile = best;
        return null;
      }
    }
  }

  // choose somewhere to go
  for (let attempt = 0; attempt < 3; attempt++) {
    const goal = chooseGoal(c, reach, enemies);
    if (!goal) {
      bot.path = [];
      bot.goal = 'none';
      bot.goalTile = -1;
      return null;
    }
    if (goal.tile === S) {
      bot.path = [];
      bot.goal = goal.kind;
      bot.goalTile = S;
      // already standing on a spot worth bombing from
      if (goal.kind === 'brick' && canBomb) {
        const act = placeBomb(c);
        if (act) return act;
        continue; // no safe way to do it from here: look elsewhere
      }
      return null;
    }
    bot.path = pathTo(reach, goal.tile);
    bot.goal = goal.kind;
    bot.goalTile = goal.tile;
    if (wasIdle && spec.hesitate[1] > 0) bot.wait = spec.hesitate[0] + Math.floor(bot.rng() * (spec.hesitate[1] - spec.hesitate[0] + 1));
    return null;
  }
  return null;
}

interface Goal {
  kind: GoalKind;
  tile: number;
  score: number;
}

/** Score everything worth walking to and take the best. Nearer is better. */
function chooseGoal(c: Ctx, reach: Reach, enemies: Player[]): Goal | null {
  const { world, me, bot, spec, D, S } = c;
  const SOON = 40; // ticks added to every journey, so near things do not swamp everything else
  let best: Goal | null = null;
  const offer = (kind: GoalKind, t: number, worth: number): void => {
    const time = reach.time[t];
    if (time === Infinity || hasDanger(D, t)) return;
    const score = (worth / (time + SOON)) * (1 + spec.wobble * (bot.rng() - 0.5));
    if (!best || score > best.score) best = { kind, tile: t, score };
  };

  for (const it of world.items) offer('item', it.cy * world.w + it.cx, itemWorth(me, it.kind) * 4);

  const mayBomb = !((bot.avoid.get(S) ?? 0) > world.tick);
  for (let t = 0; t < reach.time.length; t++) {
    if (reach.time[t] === Infinity) continue;
    if ((bot.avoid.get(t) ?? 0) > world.tick || (t === S && !mayBomb)) continue;
    const x = t % world.w;
    const fx = bombEffect(world, D, x, (t - x) / world.w, me.fire);
    if (!fx.bricks) continue;
    if (spec.spareItems && fx.items) continue;
    offer('brick', t, 0.8 + 0.4 * fx.bricks);
  }

  // spots from which a bomb would reach a player; far more if it would leave them no way out
  const hunt = Math.max(spec.hunt, 0.02);
  // (only spots close enough that it would actually press the button there, and not ones it has just ruled out)
  const ruledOut = (t: number): boolean => (bot.avoid.get(t) ?? 0) > world.tick;
  for (const e of enemies) {
    const ex = Math.round(e.x);
    const ey = Math.round(e.y);
    const fx = bombEffect(world, D, ex, ey, me.fire);
    for (const t of fx.tiles) {
      const x = t % world.w;
      if (Math.abs(x - ex) + Math.abs((t - x) / world.w - ey) > spec.attackReach || ruledOut(t)) continue;
      offer('hunt', t, hunt * 3);
    }
  }
  for (const t of trapTiles(c, reach, enemies)) if (!ruledOut(t)) offer('hunt', t, hunt * 14);
  return best;
}

/**
 * For the levels that set traps: nearby tiles where a bomb dropped right now
 * would leave some player no way out. Worked out once per decision.
 */
function trapTiles(c: Ctx, reach: Reach, enemies: Player[]): number[] {
  if (c.traps) return c.traps;
  const { world, me, spec, D, S } = c;
  const out: number[] = [];
  if (spec.killShot && !me.carrying && me.activeBombs < Math.min(me.bombsMax, spec.maxBombs)) {
    for (const e of enemies) {
      const fx = bombEffect(world, D, Math.round(e.x), Math.round(e.y), me.fire);
      const near = fx.tiles.filter((t) => t !== S && reach.time[t] < 80 && !c.walls[t]).sort((a, b) => reach.time[a] - reach.time[b]).slice(0, 5);
      for (const t of near) {
        const x = t % world.w;
        if (boxedIn(c, e, [{ cx: x, cy: (t - x) / world.w, range: me.fire, fuse: FUSE_TICKS }], t)) out.push(t);
      }
    }
  }
  c.traps = out;
  return out;
}

/** Is there a player in the lane beyond (cx, cy) in direction d, with nothing in between? */
function enemyAlong(c: Ctx, enemies: Player[], cx: number, cy: number, d: Dir): boolean {
  const { world } = c;
  for (let i = 1; i <= 9; i++) {
    const x = cx + DX[d] * i;
    const y = cy + DY[d] * i;
    if (tile(world, x, y) !== FLOOR || groundBombAt(world, x, y)) return false;
    if (enemies.some((e) => Math.round(e.x) === x && Math.round(e.y) === y)) return i >= 2;
  }
  return false;
}

/**
 * If these bombs were dropped now, would `victim` be caught with no way out?
 * `blockTile` is where the new bomb would sit, which the victim could not
 * walk through.
 */
function boxedIn(c: Ctx, victim: Player, what: ExtraBomb[], blockTile: number): boolean {
  const { world, walls } = c;
  const D2 = dangerMap(world, null, 0, what);
  const at = tileOf(world, victim);
  if (!hasDanger(D2, at)) return false;
  let w2 = walls;
  if (blockTile !== at && !walls[blockTile]) {
    w2 = walls.slice();
    w2[blockTile] = 1;
  }
  const reach = explore(world, victim, D2, 2, w2);
  return escapeTarget(D2, reach, 2) < 0;
}

/**
 * Drop a bomb, but only if there is a way out of its blast, no player it is
 * watching could shut that way out first, and playing the move forward
 * confirms it survives. Returns the button press, or null if it must not.
 */
function placeBomb(c: Ctx): PlayerInput | null {
  const { world, me, bot, spec, walls, S } = c;
  const sx = S % world.w;
  const sy = (S - sx) / world.w;
  const what = [{ cx: sx, cy: sy, range: me.fire, fuse: FUSE_TICKS }];
  const D2 = dangerMap(world, null, 0, what);
  const press: PlayerInput = { dir: 0, a: true, b: false };

  // The players it is watching. For each: how soon it could be standing on
  // each tile once the new bomb is in its way, and what the arena would look
  // like if it dropped a bomb of its own where it stands right now.
  const rivals: { reach: Reach; D: Danger; walls: Uint8Array }[] = [];
  if (spec.guard > 0) {
    const blocked = walls.slice();
    blocked[S] = 1;
    for (const e of world.players) {
      if (!e.alive || e.id === me.id || e.carrying || e.activeBombs >= e.bombsMax) continue;
      const ex = Math.round(e.x);
      const ey = Math.round(e.y);
      if (Math.abs(ex - sx) + Math.abs(ey - sy) > spec.guard) continue;
      const at = ey * world.w + ex;
      const w3 = walls.slice();
      if (at !== S) w3[at] = 1;
      rivals.push({
        reach: explore(world, e, NO_DANGER, 0, at === S ? walls : blocked),
        D: dangerMap(world, null, 0, [...what, { cx: ex, cy: ey, range: e.fire, fuse: FUSE_TICKS }]),
        walls: w3,
      });
    }
  }

  for (const margin of [spec.margin + 2, spec.margin]) {
    const reach = explore(world, me, D2, margin, walls);
    for (const target of escapeTargets(D2, reach, margin, 6, bot.rng)) {
      const path = pathTo(reach, target);
      // a rival who can be on the way out before it gets there could drop a bomb and shut it in
      if (rivals.some((r) => path.some((t) => r.reach.enter[t] <= reach.enter[t] + GUARD_SLACK))) continue;
      // and the way out must still work if a rival drops a bomb where it stands
      if (rivals.some((r) => !pathOk(world, me, r.D, path, 1, r.walls, true))) continue;
      if (!survives(world, bot.id, [press], path)) continue;
      bot.path = path;
      bot.goal = 'none';
      bot.goalTile = -1;
      bot.doing = 'flee';
      bot.wait = 0;
      return press;
    }
  }
  bot.avoid.set(S, world.tick + (rivals.length ? 20 : 90));
  return null;
}

// ---------------------------------------------------------------- kicks and throws

/** Gives the press for each tick of a move, 'done' when the move is complete, or 'fail' if it did not work. */
type Driver = (w: World, me: Player, t: number) => PlayerInput | 'done' | 'fail';

/**
 * Try a short series of button presses on a copy of the world. If the move
 * completes, the player can then walk to safety, and it survives doing so,
 * the presses are returned to be carried out for real. Otherwise null.
 */
function tryOut(c: Ctx, driver: Driver): PlayerInput[] | null {
  const { world, bot, spec } = c;
  const w = cloneWorld(world);
  const me = w.players[bot.id];
  const prefix: PlayerInput[] = [];
  const inputs: (PlayerInput | undefined)[] = [];
  for (let t = 0; ; t++) {
    const inp = driver(w, me, t);
    if (inp === 'fail' || t > 60) return null;
    if (inp === 'done') break;
    prefix.push(inp);
    inputs[bot.id] = inp;
    step(w, inputs);
    if (!me.alive) return null;
  }
  if (!prefix.length) return null;
  const D = dangerMap(w, null, 0);
  let path: number[] = [];
  if (hasDanger(D, tileOf(w, me))) {
    const walls = wallsOf(w);
    let target = -1;
    for (const margin of [spec.margin, 1]) {
      const reach = explore(w, me, D, margin, walls);
      target = escapeTarget(D, reach, margin);
      if (target >= 0) {
        path = pathTo(reach, target);
        break;
      }
    }
    if (target < 0) return null;
  }
  if (me.carrying) return null;
  return playOut(w, bot.id, [], path) ? prefix : null;
}

/** Walk into the bomb next door in direction d until it is kicked. */
function kickDriver(c: Ctx, d: Dir): Driver {
  const { world, S } = c;
  const sx = S % world.w;
  const target = groundBombAt(world, sx + DX[d], (S - sx) / world.w + DY[d]);
  const id = target ? target.id : -1;
  return (w, _me, t) => {
    const b = w.bombs.find((o) => o.id === id);
    if (!b || t > 40) return 'fail'; // it went off, or would not budge
    if (b.slide) return 'done';
    return go(d);
  };
}

/** Boxed in, with no way to walk out: kick a bomb aside or throw one clear, if the level knows how. */
function wayOut(c: Ctx): PlayerInput[] | null {
  const { world, me, bot, spec, S } = c;
  const sx = S % world.w;
  const sy = (S - sx) / world.w;
  if (spec.kickEscape && me.canKick) {
    for (const d of shuffled(bot.rng)) {
      const b = groundBombAt(world, sx + DX[d], sy + DY[d]);
      if (!b || b.slide) continue;
      const prefix = tryOut(c, kickDriver(c, d));
      if (prefix) return prefix;
    }
  }
  if (spec.throwEscape && me.canGrab) {
    const near = groundBombAt(world, sx, sy) || [1, 2, 3, 4].some((d) => groundBombAt(world, sx + DX[d], sy + DY[d]));
    if (near) {
      for (const d of shuffled(bot.rng)) {
        // lift, turn to face d, throw
        const prefix = tryOut(c, (_w, m, t) => {
          if (t === 0) return { dir: 0, a: false, b: true };
          if (t === 1) return m.carrying ? go(d) : 'fail';
          if (t === 2) return m.carrying ? { dir: 0, a: false, b: true } : 'fail';
          return 'done';
        });
        if (prefix) return prefix;
      }
    }
  }
  return null;
}

/** Exposed for tests: the tiles a bomb dropped at (cx, cy) would reach, and how many bricks it would break. */
export function previewBomb(world: World, cx: number, cy: number, range: number): { tiles: number[]; bricks: number } {
  const fx = bombEffect(world, dangerMap(world, null, 0), cx, cy, range);
  return { tiles: fx.tiles, bricks: fx.bricks };
}
