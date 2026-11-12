/**
 * BomberBot game rules.
 *
 * Pure logic: no drawing, no sound, no browser APIs, no Math.random. Give it a
 * world and the players' inputs and it advances the world by one tick. Because
 * of that it can be tested without a browser, replayed exactly from a seed, and
 * run unchanged on a server when online play is added.
 *
 * Coordinates: tile centres are whole numbers, so a player at x = 3 stands
 * exactly in the middle of column 3, and Math.round(x) is the tile they count
 * as standing on. Column 0 and row 0 are the outer wall.
 *
 * In this file, top to bottom:
 *   types and constants, world creation, player movement, bombs (placing,
 *   kicking, lifting, throwing), blasts, and step(), which runs one tick.
 *
 * docs/GAME-RULES.md describes the same rules in plain words.
 */

// ---------------------------------------------------------------- types

/** The rules run at a fixed 60 ticks a second, whatever the screen's frame rate. */
export const TICK_HZ = 60;

/** 0 none, 1 up, 2 down, 3 left, 4 right */
export type Dir = 0 | 1 | 2 | 3 | 4;
/** One tile's step in x and y for each direction, indexed by Dir. */
export const DX = [0, 0, 0, -1, 1];
export const DY = [0, -1, 1, 0, 0];

/** What a tile can be: open floor, a solid block (never breaks), or a brick (a blast breaks it). */
export const FLOOR = 0;
export const HARD = 1;
export const SOFT = 2;

/**
 * Power-ups: one more bomb at a time, a longer blast, faster walking,
 * the boot (kick bombs) and the glove (lift and throw bombs).
 */
export type ItemKind = 'bomb' | 'fire' | 'speed' | 'kick' | 'grab' | 'shield' | 'curse';

/**
 * What one player is asking for on one tick. Buttons are sent as "held or
 * not"; the rules notice the moment a button goes down.
 */
export interface PlayerInput {
  dir: Dir;
  /** A button: drop a bomb */
  a: boolean;
  /** B button: lift a bomb, or throw the one being carried (needs the glove) */
  b: boolean;
}

export interface Player {
  /** index into world.players; also used as the owner of bombs and blasts */
  id: number;
  /** which of the bot colours in render.ts this player wears */
  colorId: string;
  /** position in tiles; always exactly on a tile centre in at least one of the two */
  x: number;
  y: number;
  /** the way the robot looks: the direction last asked for. It is drawn facing this way, and a thrown bomb goes this way. */
  facing: Dir;
  /** true if the robot really moved on the last tick */
  moving: boolean;
  /** walk animation phase, advanced as the robot moves */
  walk: number;
  /** which way the last real movement went on each axis (-1, 0, 1) */
  mvx: number;
  mvy: number;
  /** direction of the last real movement (differs from `facing` when blocked, or while lining up for a turn) */
  heading: Dir;
  /** the direction being asked for, and for how many ticks in a row (0 on the first) */
  askDir: Dir;
  askTicks: number;
  alive: boolean;
  /** ticks since being knocked out, for the knocked-out animation (stops at DEATH_TICKS) */
  deadTicks: number;
  /** how many bombs this player may have out at once */
  bombsMax: number;
  /** blast length, in tiles, of the bombs this player drops */
  fire: number;
  /** speed power-ups collected (0 at the start) */
  speed: number;
  /** bombs of this player's that have not gone off yet */
  activeBombs: number;
  /** power-ups: kick bombs by running into them, lift and throw with B */
  canKick: boolean;
  canGrab: boolean;
  /** ticks of shield left: while above 0 the next blast is survived (and uses the shield up) */
  shieldTicks: number;
  /** ticks left in which blasts do no harm, just after a shield has been used up */
  graceTicks: number;
  /** ticks of curse left: while above 0 the robot walks at CURSE_SPEED times the starting speed */
  curseTicks: number;
  /** button states on the previous tick, to notice a fresh press */
  prevA: boolean;
  prevB: boolean;
  /** id of the bomb being carried, or 0 */
  carrying: number;
}

export interface Bomb {
  id: number;
  /** id of the player who dropped it; the blast is drawn in their colour */
  owner: number;
  /** exact position; cx, cy is the tile it counts as being on */
  x: number;
  y: number;
  cx: number;
  cy: number;
  /** ticks until it goes off */
  fuse: number;
  /** blast length in tiles, fixed when the bomb was dropped */
  range: number;
  /** ticks since it was dropped, for the pulsing animation */
  age: number;
  /** on the floor, carried over someone's head, or flying after a throw */
  state: 'ground' | 'held' | 'air';
  /** direction it is sliding after a kick, 0 if still */
  slide: Dir;
  /** id of the player carrying it, or -1 */
  heldBy: number;
  /** true once it has been picked up, so the carry timer is only set once */
  lifted: boolean;
  /** a throw: the tile it left from, its direction, how many tiles it will travel, ticks in the air */
  fromX: number;
  fromY: number;
  flyDir: Dir;
  flyDist: number;
  flyT: number;
}

/** One tile of a blast. */
export interface Flame {
  cx: number;
  cy: number;
  /** ticks left before it fades */
  ttl: number;
  owner: number;
  /** 'c' centre, 'h' horizontal arm, 'v' vertical arm */
  kind: 'c' | 'h' | 'v';
  /** direction of the arm's tip if this is the last tile, else 0 */
  tip: Dir;
}

/** A brick that a blast has reached. It turns to floor when ttl runs out. */
export interface Burning {
  cx: number;
  cy: number;
  ttl: number;
}

/** A power-up lying on the floor. */
export interface Item {
  cx: number;
  cy: number;
  kind: ItemKind;
  /** ticks since it appeared, for the pop-in animation */
  age: number;
}

/**
 * Things that happened during one tick. The rules never play sound or draw:
 * they list events here and main.ts turns them into sound effects.
 */
export type GameEvent =
  | { type: 'place' }
  | { type: 'kick' }
  | { type: 'lift' }
  | { type: 'throw' }
  | { type: 'land' }
  | { type: 'explode' }
  | { type: 'pickup'; player: number; kind: ItemKind }
  /** a shield took a blast for this player and is used up */
  | { type: 'shield'; player: number }
  /** a falling block has landed on this tile, which is now a solid block */
  | { type: 'block'; cx: number; cy: number }
  /**
   * `cause` says what knocked the player out: a blast, or a falling block.
   * `by` is the player whose bomb made the blast, or -1 for a block.
   */
  | { type: 'death'; player: number; cause: 'blast' | 'block'; by: number };

/** A block on its way down. It lands, and turns its tile solid, when `world.tick` reaches `landAt`. */
export interface FallingBlock {
  cx: number;
  cy: number;
  landAt: number;
}

/** The whole state of a match. Everything the rules know is in here. */
export interface World {
  /** size in tiles, including the outer wall */
  w: number;
  h: number;
  /** FLOOR, HARD or SOFT for each tile, row by row (index = y * w + x) */
  tiles: Uint8Array;
  /** power-ups still hidden under bricks, by tile index */
  hidden: Map<number, ItemKind>;
  players: Player[];
  bombs: Bomb[];
  flames: Flame[];
  burning: Burning[];
  items: Item[];
  /** ticks played so far */
  tick: number;
  /** what the timer counts down from, in ticks. Blocks start to fall when it reaches 0. 0 = no timer and no falling blocks. */
  roundTicks: number;
  /** the blocks take this many ticks to fall, starting when the timer reaches 0 */
  shrinkTicks: number;
  /** the tiles blocks will fall on, in order: round the edge and inward, stopping short of the square kept open in the middle. Fixed for the whole round. */
  shrinkOrder: number[];
  /** how many of those have started falling */
  shrinkNext: number;
  /** blocks in the air right now */
  falling: FallingBlock[];
  nextBombId: number;
  /** what happened on the latest tick (cleared at the start of each one) */
  events: GameEvent[];
  /** set once the round is decided; winner is a player id, or -1 for a draw */
  over: { winner: number } | null;
  /** ticks left before the result is declared once one player or none is left; -1 until then */
  overCountdown: number;
  /** optional and off by default: letting go finishes the step so players stop in the middle of a tile */
  stepAssist: boolean;
}

export interface WorldConfig {
  /** the same seed always builds the same arena */
  seed: number;
  /** playable columns and rows, not counting the outer wall (odd numbers). Default 13 by 11. */
  cols?: number;
  rows?: number;
  /** one entry per player, up to four for now; they start in the corners */
  players: { colorId: string }[];
  /** share of open tiles that start as bricks, 0 to 1. Default 0.78. */
  softDensity?: number;
  /** what the timer counts down from, in ticks. Default ROUND_TICKS (1 minute 30). 0 = no timer and no falling blocks. */
  roundTicks?: number;
  /** see World.stepAssist. Default false. */
  stepAssist?: boolean;
}

// ---------------------------------------------------------------- constants
// Times are in ticks (60 a second), distances in tiles.

export const FUSE_TICKS = 150; // a dropped bomb goes off after 2.5 s
export const FLAME_TICKS = 27; // a blast stays for 0.45 s (was 30: shortened a little in play-testing)
export const CHAIN_TICKS = 5; // a bomb caught in a blast goes off this soon after
export const BASE_SPEED = 0.04250390625; // starting walking speed, tiles per tick (2.55 tiles a second)
export const SPEED_STEP = 0.5 / TICK_HZ; // added by each speed power-up: 0.5 tiles a second (0.008333 a tick). Nothing else changes a robot's speed.
export const MAX_SPEED_ITEMS = 6; // so six of them bring it to 0.0925 tiles a tick (5.55 tiles a second)
export const MAX_BOMBS = 8;

/**
 * The chance that a brick hides each power-up. A brick hides at most one, so
 * these add up to the share of bricks that hide anything (48%). The order
 * matters only for which random numbers give which power-up; keep new ones at
 * the end so arenas made from old seeds keep their first five kinds in place.
 * What these chances come to per arena is measured in docs/GAME-RULES.md.
 */
export const ITEM_CHANCE: [ItemKind, number][] = [
  ['bomb', 0.15],
  ['fire', 0.15],
  ['speed', 0.11],
  ['kick', 0.025], // rare. Every arena still gets at least one: see createWorld
  ['grab', 0.025], // likewise
  ['shield', 0.01], // very rare: in about half of arenas
  ['curse', 0.01], // very rare: in about half of arenas
];
export const SHIELD_TICKS = 30 * TICK_HZ; // a shield that is not used wears off after 30 s
export const SHIELD_GRACE_TICKS = 30; // after a shield takes a blast, blasts do no harm for 0.5 s: long enough for that blast to clear
export const CURSE_TICKS = 8 * TICK_HZ; // a curse lasts 8 s
export const CURSE_SPEED = 0.85; // while cursed a robot walks at 85% of the starting speed, whatever speed power-ups it has
export const ROUND_TICKS = 90 * TICK_HZ; // the timer counts down 1 minute 30 unless told otherwise; then the blocks start to fall (it was 2 minutes)
export const SHRINK_TICKS = 50 * TICK_HZ; // once the timer reaches 0 the blocks take 50 seconds to fall (a minute at first; made 20% faster)
export const FALL_TICKS = 38; // a falling block is in the air, over its shadow, for 0.63 s before it lands (0.75 s at first; made 20% faster)
export const START_FIRE = 1; // a blast reaches one tile each way until a flame power-up is picked up (it was 2)
export const MAX_FIRE = 8;
/**
 * The falling blocks leave a square this many tiles across open in the middle
 * of the arena, for whoever is left to fight it out in.
 */
export const KEEP_OPEN = 5;
export const DEATH_TICKS = 90; // length of the knocked-out animation (1.5 s)
export const GHOST_TICKS = 300; // `deadTicks` goes on counting this far (5 s), so the ghost can be drawn floating all the way off the top of the screen
export const CARRY_FUSE_TICKS = 180; // 3 s from the first pick-up, and it keeps ticking
export const KICK_SPEED = 0.14; // a kicked bomb slides at 8.4 tiles a second
export const THROW_TILES = 3; // a thrown bomb lands this many tiles away
export const FLY_TICKS_PER_TILE = 7; // how long a thrown bomb takes over each tile

// ---------------------------------------------------------------- world creation

/** Small seeded random generator so a match can be replayed exactly. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Start tiles for up to four players: the four corners. */
export function spawnPoints(w: number, h: number): { x: number; y: number }[] {
  return [
    { x: 1, y: 1 },
    { x: w - 2, y: h - 2 },
    { x: w - 2, y: 1 },
    { x: 1, y: h - 2 },
  ];
}

/**
 * Build a fresh arena: outer wall, a pillar on every second tile, bricks on
 * most of the rest with power-ups hidden under some, and each player's corner
 * left clear so nobody starts boxed in.
 */
export function createWorld(cfg: WorldConfig): World {
  const w = (cfg.cols ?? 13) + 2;
  const h = (cfg.rows ?? 11) + 2;
  const rng = makeRng(cfg.seed);
  const tiles = new Uint8Array(w * h);
  const spawns = spawnPoints(w, h).slice(0, cfg.players.length);

  const safe = new Set<number>();
  for (const s of spawns) {
    safe.add(s.y * w + s.x);
    for (let d = 1; d <= 4; d++) safe.add((s.y + DY[d]) * w + (s.x + DX[d]));
  }

  const hidden = new Map<number, ItemKind>();
  const density = cfg.softDensity ?? 0.78;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const border = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      const pillar = x % 2 === 0 && y % 2 === 0;
      if (border || pillar) tiles[i] = HARD;
      else if (!safe.has(i) && rng() < density) {
        tiles[i] = SOFT;
        // one random number per brick decides what, if anything, it hides (ITEM_CHANCE)
        let r = rng();
        for (const [kind, chance] of ITEM_CHANCE) {
          if (r < chance) {
            hidden.set(i, kind);
            break;
          }
          r -= chance;
        }
      }
    }
  }
  // every arena has at least one kick and one grab power-up somewhere
  for (const kind of ['kick', 'grab'] as const) {
    if ([...hidden.values()].includes(kind)) continue;
    const empty: number[] = [];
    for (let i = 0; i < tiles.length; i++) if (tiles[i] === SOFT && !hidden.has(i)) empty.push(i);
    if (empty.length) hidden.set(empty[Math.floor(rng() * empty.length)], kind);
  }

  const roundTicks = Math.max(0, Math.floor(cfg.roundTicks ?? ROUND_TICKS));
  const players: Player[] = cfg.players.map((p, id) => ({
    id,
    colorId: p.colorId,
    x: spawns[id].x,
    y: spawns[id].y,
    facing: 2,
    moving: false,
    walk: 0,
    mvx: 0,
    mvy: 0,
    heading: 2,
    askDir: 0,
    askTicks: 0,
    alive: true,
    deadTicks: 0,
    bombsMax: 1,
    fire: START_FIRE,
    speed: 0,
    activeBombs: 0,
    canKick: false,
    canGrab: false,
    shieldTicks: 0,
    graceTicks: 0,
    curseTicks: 0,
    prevA: false,
    prevB: false,
    carrying: 0,
  }));

  return {
    w,
    h,
    tiles,
    hidden,
    players,
    bombs: [],
    flames: [],
    burning: [],
    items: [],
    tick: 0,
    roundTicks,
    shrinkTicks: SHRINK_TICKS,
    shrinkOrder: roundTicks > 0 ? spiral(w, h).filter((i) => tiles[i] !== HARD && !keptOpen(w, h, i)) : [],
    shrinkNext: 0,
    falling: [],
    nextBombId: 1,
    events: [],
    over: null,
    overCountdown: -1,
    stepAssist: cfg.stepAssist ?? false,
  };
}

/**
 * Every tile inside the outer wall, in the order blocks fall on them: along
 * the top row from the top-left corner, down the right side, back along the
 * bottom, up the left side, then the same one ring further in, and so on to
 * the middle. (createWorld then leaves out the pillars and the square that
 * is kept open.)
 */
function spiral(w: number, h: number): number[] {
  const out: number[] = [];
  for (let r = 1; ; r++) {
    const x0 = r;
    const y0 = r;
    const x1 = w - 1 - r;
    const y1 = h - 1 - r;
    if (x0 > x1 || y0 > y1) break;
    for (let x = x0; x <= x1; x++) out.push(y0 * w + x);
    for (let y = y0 + 1; y <= y1; y++) out.push(y * w + x1);
    if (y1 > y0) for (let x = x1 - 1; x >= x0; x--) out.push(y1 * w + x);
    if (x1 > x0) for (let y = y1 - 1; y > y0; y--) out.push(y * w + x0);
  }
  return out;
}

/** Is this tile in the square in the middle of the arena that the falling blocks leave open? */
export function keptOpen(w: number, h: number, i: number): boolean {
  const half = (KEEP_OPEN - 1) / 2;
  const x = i % w;
  const y = Math.floor(i / w);
  return Math.abs(x - (w - 1) / 2) <= half && Math.abs(y - (h - 1) / 2) <= half;
}

/**
 * The tick on which block number `k` of `world.shrinkOrder` lands. They land
 * The first starts to fall the moment the timer reaches 0, so it lands
 * FALL_TICKS later. The rest follow at an even pace, the last one landing
 * `shrinkTicks` after the timer reached 0.
 */
export function blockLandTick(world: World, k: number): number {
  const n = world.shrinkOrder.length;
  const pace = n > 1 ? (world.shrinkTicks - FALL_TICKS) / (n - 1) : 0;
  return world.roundTicks + FALL_TICKS + Math.round(k * pace);
}

/** Ticks left on the round timer (never below 0). Infinity if the round has no time limit. */
export function ticksLeft(world: World): number {
  return world.roundTicks > 0 ? Math.max(0, world.roundTicks - world.tick) : Infinity;
}

/**
 * Start blocks falling when their time comes, and land the ones that are due.
 * A landing block turns its tile into a solid block for good. Whatever was on
 * the tile is gone: a brick and anything under it, a power-up, a bomb (it does
 * not go off), a blast. A robot standing on the tile is knocked out, shield or
 * no shield. A robot or bomb on the next tile that was leaning over this one is
 * pushed back onto the middle of its own tile.
 */
function fallBlocks(world: World): void {
  const n = world.shrinkOrder.length;
  // (once the round is decided no more blocks start to fall; the ones in the air still land)
  while (!world.over && world.shrinkNext < n && world.tick >= blockLandTick(world, world.shrinkNext) - FALL_TICKS) {
    const i = world.shrinkOrder[world.shrinkNext];
    world.falling.push({ cx: i % world.w, cy: Math.floor(i / world.w), landAt: blockLandTick(world, world.shrinkNext) });
    world.shrinkNext++;
  }
  if (!world.falling.length || world.falling[0].landAt > world.tick) return;
  for (const f of world.falling) {
    if (f.landAt > world.tick) continue;
    const { cx, cy } = f;
    const i = cy * world.w + cx;
    world.tiles[i] = HARD;
    world.hidden.delete(i);
    world.items = world.items.filter((it) => it.cx !== cx || it.cy !== cy);
    world.flames = world.flames.filter((fl) => fl.cx !== cx || fl.cy !== cy);
    world.burning = world.burning.filter((b) => b.cx !== cx || b.cy !== cy);
    for (const b of [...world.bombs]) {
      if (b.state !== 'ground') continue;
      if (b.cx === cx && b.cy === cy) {
        world.bombs.splice(world.bombs.indexOf(b), 1);
        const o = world.players[b.owner];
        if (o) o.activeBombs = Math.max(0, o.activeBombs - 1);
      } else if (Math.abs(b.x - cx) < 1 && Math.abs(b.y - cy) < 1) {
        b.x = b.cx;
        b.y = b.cy;
        b.slide = 0;
      }
    }
    const under: Player[] = [];
    for (const p of world.players) {
      if (!p.alive) continue;
      const px = Math.round(p.x);
      const py = Math.round(p.y);
      if (px === cx && py === cy && world.over && world.over.winner === p.id) {
        // the round is decided and this is the winner: the block leaves it be
      } else if (px === cx && py === cy) {
        p.alive = false;
        p.moving = false;
        under.push(p);
        world.events.push({ type: 'death', player: p.id, cause: 'block', by: -1 });
      } else if (Math.abs(p.x - cx) < 1 && Math.abs(p.y - cy) < 1) {
        if (px !== cx) p.x = px;
        if (py !== cy) p.y = py;
      }
    }
    world.events.push({ type: 'block', cx, cy });
    // The last robot standing wins even if a block gets it a moment after the others went.
    // (Several under the same block went together: that is left to end as a draw.)
    if (!world.over && under.length === 1 && world.players.length > 1 && !world.players.some((p) => p.alive)) {
      world.over = { winner: under[0].id };
    }
  }
  world.falling = world.falling.filter((f) => f.landAt > world.tick);
}

/**
 * An independent copy of a world. Stepping the copy leaves the original
 * untouched, which lets a CPU player try a move out before making it.
 */
export function cloneWorld(w: World): World {
  return {
    ...w,
    tiles: w.tiles.slice(),
    hidden: new Map(w.hidden),
    players: w.players.map((p) => ({ ...p })),
    bombs: w.bombs.map((b) => ({ ...b })),
    flames: w.flames.map((f) => ({ ...f })),
    burning: w.burning.map((b) => ({ ...b })),
    items: w.items.map((i) => ({ ...i })),
    falling: w.falling.map((f) => ({ ...f })),
    events: [],
    over: w.over ? { ...w.over } : null,
  };
}

/** The tile at (cx, cy). Anything off the map counts as a solid block. */
export function tileAt(world: World, cx: number, cy: number): number {
  if (cx < 0 || cy < 0 || cx >= world.w || cy >= world.h) return HARD;
  return world.tiles[cy * world.w + cx];
}

/** A bomb sitting (or sliding) on this tile. Carried and flying bombs don't count. */
function bombAt(world: World, cx: number, cy: number): Bomb | undefined {
  for (const b of world.bombs) if (b.state === 'ground' && b.cx === cx && b.cy === cy) return b;
  return undefined;
}

/** Can a bomb rest on or slide into this tile? */
function freeForBomb(world: World, cx: number, cy: number, players = true): boolean {
  if (tileAt(world, cx, cy) !== FLOOR) return false;
  if (bombAt(world, cx, cy)) return false;
  if (players) {
    for (const p of world.players) {
      if (p.alive && Math.round(p.x) === cx && Math.round(p.y) === cy) return false;
    }
  }
  return true;
}

/**
 * Can this player not enter the tile? Blocks and bricks stop them, and so does
 * a bomb, with one exception: a bomb on the tile the player counts as standing
 * on (the one they just dropped, or one thrown onto them) does not hold them
 * in. They can move about on that tile and walk off it. The moment they count
 * as standing on the next tile, that bomb is solid to them like any other, so
 * there is no walking back through it.
 */
function blocked(world: World, p: Player, cx: number, cy: number): boolean {
  if (tileAt(world, cx, cy) !== FLOOR) return true;
  const b = bombAt(world, cx, cy);
  if (b && !(Math.round(p.x) === b.cx && Math.round(p.y) === b.cy)) return true;
  return false;
}

/** Move `v` toward `target` by at most `step`, landing exactly on it. */
function approach(v: number, target: number, step: number): number {
  if (v < target) return Math.min(target, v + step);
  return Math.max(target, v - step);
}

/** This player's walking speed in tiles per tick. */
export function playerSpeed(p: Player): number {
  if (p.curseTicks > 0) return BASE_SPEED * CURSE_SPEED;
  return BASE_SPEED + SPEED_STEP * p.speed;
}

// ---------------------------------------------------------------- player movement

/**
 * Having passed a side opening by no more than this, a turn still takes it with
 * a small step back. Half a tile: exactly while the player still counts as
 * standing on the opening's tile (where the ring is drawn).
 */
export const BACK_TOLERANCE = 0.5;

/**
 * Standing still on a tile where the way asked for is a block, the robot turns
 * to look first. Only if the direction is still being asked for after this many
 * ticks (0.15 s) does it set off for the opening on the next tile. So a quick
 * swipe at a block turns the robot on the spot, and a held one still takes it
 * round the block.
 */
export const LOOK_TICKS = 9;

/**
 * Grid movement. Players travel along lanes: you can only go sideways where
 * there is an opening, so a turn asked for between openings has to be lined up.
 *
 * - Already lined up and the way is free: go.
 * - Running along a lane and asked to turn (say going down, asked to go left):
 *   if the tile it is standing on has the opening, turn there. Otherwise keep
 *   running the same way and take the next opening ahead. The robot never turns
 *   round to reach an opening behind it unless there is nothing ahead at all.
 * - Standing still between two lanes: step to the nearest one that is open. If
 *   that means leaving the tile it is standing on, it turns to look first and
 *   only sets off once the direction has been held for LOOK_TICKS.
 *
 * Whatever it does, it looks the way it was asked to go.
 */
function movePlayer(world: World, p: Player, dir: Dir): void {
  const sp = playerSpeed(p);
  const dx = DX[dir];
  const dy = DY[dir];
  const tx = Math.round(p.x);
  const ty = Math.round(p.y);
  const horizontal = dx !== 0;

  // position along the requested direction's axis and across it
  const along = horizontal ? p.x : p.y;
  const across = horizontal ? p.y : p.x;
  const tAlong = horizontal ? tx : ty;
  const tAcross = horizontal ? ty : tx;
  const step = horizontal ? dx : dy;
  const isBlocked = (a: number, c: number): boolean =>
    horizontal ? blocked(world, p, a, c) : blocked(world, p, c, a);

  // +1 / -1 if the player was, a moment ago, travelling across the requested direction
  const heading = p.moving ? p.heading : 0;
  const run = heading && heading >= 3 !== horizontal ? (horizontal ? DY[heading] : DX[heading]) : 0;
  /** lane `c` is clear and the requested direction is open from it */
  const canTurnAt = (c: number): boolean => !isBlocked(tAlong, c) && !isBlocked(tAlong + step, c);
  /** carrying on along the lane from `from`, is there an opening before the lane is blocked? */
  const openingAhead = (from: number): boolean => {
    for (let c = from, n = 0; n < 32; c += run, n++) {
      if (isBlocked(tAlong, c)) return false;
      if (!isBlocked(tAlong + step, c)) return true;
    }
    return false;
  };

  const off = across - tAcross;
  let newAlong = along;
  let newAcross = across;

  if (Math.abs(off) > 1e-6) {
    // between two lanes: choose which one to line up with
    let target: number | null = null;
    if (run) {
      const lo = Math.floor(across);
      const ahead = run > 0 ? lo + 1 : lo;
      const behind = run > 0 ? lo : lo + 1;
      if (Math.abs(across - behind) <= BACK_TOLERANCE && canTurnAt(behind)) target = behind;
      else if (openingAhead(ahead)) target = ahead;
      else if (canTurnAt(behind)) target = behind;
      else if (!isBlocked(tAlong, ahead)) target = ahead; // nowhere to turn: stop on the next tile
    } else {
      // Standing still. Its own tile's lane first; the opening on the next tile only once
      // the swipe has been held long enough to mean "go there" rather than "look there".
      const other = tAcross + Math.sign(off);
      if (canTurnAt(tAcross)) target = tAcross;
      else if (canTurnAt(other) && p.askTicks >= LOOK_TICKS) target = other;
    }
    if (target !== null) newAcross = approach(across, target, sp);
  } else {
    newAcross = tAcross;
    newAlong = along + step * sp;
    if (isBlocked(tAlong + step, tAcross)) {
      // may walk up to the centre of the current tile, no further
      if (step > 0) newAlong = along > tAlong ? along : Math.min(newAlong, tAlong);
      else newAlong = along < tAlong ? along : Math.max(newAlong, tAlong);
      let kicked = false;
      // Walking into a bomb kicks it away in that direction. "Into" means up against it:
      // at the middle of this tile, or already leaning over toward the bomb's tile
      // (which happens when the player has only just stepped off it).
      if ((newAlong - tAlong) * step >= 0) {
        const bx = tx + dx;
        const by = ty + dy;
        const b = bombAt(world, bx, by);
        if (p.canKick && b && b.slide === 0 && freeForBomb(world, bx + dx, by + dy)) {
          b.slide = dir;
          kicked = true;
          world.events.push({ type: 'kick' });
        }
      }
      // cannot turn here yet: keep running until the next opening
      if (newAlong === along && run && !kicked && openingAhead(tAcross + run)) {
        newAcross = across + run * sp;
      }
    }
  }

  const ox = p.x;
  const oy = p.y;
  if (horizontal) {
    p.x = newAlong;
    p.y = newAcross;
  } else {
    p.y = newAlong;
    p.x = newAcross;
  }
  // Real movement only: tidying a position that is a hair off a tile centre does not count.
  const mx = p.x - ox;
  const my = p.y - oy;
  const moved = Math.abs(mx) > 1e-9 || Math.abs(my) > 1e-9;
  if (moved) {
    if (Math.abs(mx) >= Math.abs(my)) {
      p.mvx = Math.sign(mx);
      p.heading = mx > 0 ? 4 : 3;
    } else {
      p.mvy = Math.sign(my);
      p.heading = my > 0 ? 2 : 1;
    }
  }
  // Look the way it was asked to go, even while it is still walking along a lane to reach the
  // opening, or shuffling sideways to line up with one, or stopped by a block. (It used to look
  // the way it was walking, so between two blocks it could not be turned to look at either.)
  p.facing = dir;
  p.moving = moved;
  if (moved) p.walk += sp * 5.2;
}

function flameAt(world: World, cx: number, cy: number): boolean {
  return world.flames.some((f) => f.cx === cx && f.cy === cy);
}

/**
 * Step assist (switched off: World.stepAssist is false unless a match asks for
 * it, and the game's menu has no setting for it). With no direction held, a
 * player who is between two tiles keeps walking to the middle of the tile they
 * were heading for, so the shortest flick is exactly one tile. It will not
 * finish a step into a live blast if stepping back is safe.
 */
function coast(world: World, p: Player): void {
  const rx = Math.round(p.x);
  const ry = Math.round(p.y);
  const offX = p.x - rx;
  const offY = p.y - ry;
  const horizontal = Math.abs(offX) > 1e-6;
  if (!horizontal && Math.abs(offY) <= 1e-6) {
    p.x = rx;
    p.y = ry;
    p.moving = false;
    return;
  }
  const pos = horizontal ? p.x : p.y;
  let sign = horizontal ? p.mvx : p.mvy;
  if (!sign) sign = (horizontal ? offX : offY) > 0 ? -1 : 1;
  const ahead = sign > 0 ? Math.ceil(pos) : Math.floor(pos);
  const behind = ahead - sign;
  const wall = (t: number): boolean => (horizontal ? blocked(world, p, t, ry) : blocked(world, p, rx, t));
  const hot = (t: number): boolean => (horizontal ? flameAt(world, t, ry) : flameAt(world, rx, t));
  let target = ahead;
  if (wall(ahead) || (hot(ahead) && !hot(behind) && !wall(behind))) target = behind;
  if (wall(target)) {
    p.moving = false;
    return;
  }
  const sp = playerSpeed(p);
  const next = approach(pos, target, sp);
  if (horizontal) {
    p.mvx = Math.sign(next - p.x) || p.mvx;
    p.heading = p.mvx > 0 ? 4 : 3;
    p.x = next;
    p.y = ry;
  } else {
    p.mvy = Math.sign(next - p.y) || p.mvy;
    p.heading = p.mvy > 0 ? 2 : 1;
    p.y = next;
    p.x = rx;
  }
  p.moving = true;
  p.walk += sp * 5.2;
}

// ---------------------------------------------------------------- bombs

/** A button: drop a bomb on the tile the player is standing on, if they have one to spare. */
function placeBomb(world: World, p: Player): void {
  const cx = Math.round(p.x);
  const cy = Math.round(p.y);
  if (p.carrying || p.activeBombs >= p.bombsMax) return;
  if (tileAt(world, cx, cy) !== FLOOR || bombAt(world, cx, cy)) return;
  world.bombs.push({
    id: world.nextBombId++,
    owner: p.id,
    x: cx,
    y: cy,
    cx,
    cy,
    fuse: FUSE_TICKS,
    range: p.fire,
    age: 0,
    state: 'ground',
    slide: 0,
    heldBy: -1,
    lifted: false,
    fromX: 0,
    fromY: 0,
    flyDir: 0,
    flyDist: 0,
    flyT: 0,
  });
  p.activeBombs++;
  world.events.push({ type: 'place' });
}

/**
 * B button. Carrying a bomb: throw it the way you are facing. Otherwise, with
 * the glove: lift a bomb from your own tile, else the tile you face, else any
 * tile next to you. The first lift of a bomb sets its fuse to 3 seconds.
 */
function useAction(world: World, p: Player): void {
  const cx = Math.round(p.x);
  const cy = Math.round(p.y);
  if (p.carrying) {
    const b = world.bombs.find((o) => o.id === p.carrying);
    p.carrying = 0;
    if (!b) return;
    b.state = 'air';
    b.heldBy = -1;
    b.fromX = cx;
    b.fromY = cy;
    b.flyDir = p.facing || 2;
    b.flyDist = THROW_TILES;
    b.flyT = 0;
    world.events.push({ type: 'throw' });
    return;
  }
  if (!p.canGrab) return;
  // own tile first, then the tile you face, then the other neighbours
  const spots: [number, number][] = [[cx, cy], [cx + DX[p.facing], cy + DY[p.facing]]];
  for (let d = 1; d <= 4; d++) spots.push([cx + DX[d], cy + DY[d]]);
  for (const [bx, by] of spots) {
    const b = bombAt(world, bx, by);
    if (!b) continue;
    b.state = 'held';
    b.heldBy = p.id;
    b.slide = 0;
    if (!b.lifted) {
      b.lifted = true;
      b.fuse = CARRY_FUSE_TICKS;
    }
    p.carrying = b.id;
    world.events.push({ type: 'lift' });
    return;
  }
}

/** Wrap a coordinate round the edge of the map (a thrown bomb re-enters on the far side). */
const wrap = (v: number, n: number): number => ((v % n) + n) % n;

/**
 * Carried bombs follow their carrier, thrown bombs fly, kicked bombs slide.
 * A thrown bomb that would land on a block or another bomb bounces on, one
 * tile at a time, until it finds free floor.
 */
function moveBombs(world: World): void {
  for (const b of [...world.bombs]) {
    b.age++;
    if (b.state === 'held') {
      const p = world.players[b.heldBy];
      if (p && p.alive) {
        b.x = p.x;
        b.y = p.y;
        b.cx = Math.round(p.x);
        b.cy = Math.round(p.y);
      } else {
        // carrier was knocked out: the bomb drops where they stood
        b.state = 'ground';
        b.heldBy = -1;
        b.x = b.cx;
        b.y = b.cy;
        if (p) p.carrying = 0;
      }
    } else if (b.state === 'air') {
      b.flyT++;
      const travelled = b.flyT / FLY_TICKS_PER_TILE;
      b.x = wrap(b.fromX + DX[b.flyDir] * travelled + 0.5, world.w) - 0.5;
      b.y = wrap(b.fromY + DY[b.flyDir] * travelled + 0.5, world.h) - 0.5;
      if (travelled >= b.flyDist) {
        const lx = wrap(b.fromX + DX[b.flyDir] * b.flyDist, world.w);
        const ly = wrap(b.fromY + DY[b.flyDir] * b.flyDist, world.h);
        if (freeForBomb(world, lx, ly, false)) {
          b.state = 'ground';
          b.x = b.cx = lx;
          b.y = b.cy = ly;
          world.events.push({ type: 'land' });
        } else if (b.flyDist > THROW_TILES + world.w + world.h) {
          // nowhere to land at all: fizzle out
          world.bombs.splice(world.bombs.indexOf(b), 1);
          const o = world.players[b.owner];
          if (o) o.activeBombs = Math.max(0, o.activeBombs - 1);
        } else b.flyDist++; // bounce on to the next tile
      }
    } else if (b.slide) {
      const dx = DX[b.slide];
      const dy = DY[b.slide];
      const horizontal = dx !== 0;
      const stepDir = horizontal ? dx : dy;
      const pos = horizontal ? b.x : b.y;
      const centre = Math.round(pos);
      let next = pos + stepDir * KICK_SPEED;
      // at each tile centre, look at the tile ahead before carrying on
      if ((pos - centre) * stepDir <= 0 && (next - centre) * stepDir >= 0) {
        if (!freeForBomb(world, b.cx + dx, b.cy + dy)) {
          next = centre;
          b.slide = 0;
        }
      }
      if (horizontal) b.x = next;
      else b.y = next;
      b.cx = Math.round(b.x);
      b.cy = Math.round(b.y);
    }
  }
}

// ---------------------------------------------------------------- blasts

function addFlame(world: World, f: Flame): void {
  // a newer blast replaces an older flame on the same tile
  const i = world.flames.findIndex((o) => o.cx === f.cx && o.cy === f.cy);
  if (i >= 0) {
    const old = world.flames[i];
    if (old.kind !== f.kind) f.kind = 'c';
    world.flames[i] = f;
  } else world.flames.push(f);
}

/**
 * Set a bomb off. The blast runs out in four directions for `range` tiles. A
 * solid block stops it; the first brick it meets burns and stops it; power-ups
 * lying in the open are destroyed; other bombs it touches go off moments later.
 */
function explode(world: World, bomb: Bomb): void {
  world.bombs.splice(world.bombs.indexOf(bomb), 1);
  const owner = world.players[bomb.owner];
  if (owner) owner.activeBombs = Math.max(0, owner.activeBombs - 1);
  world.events.push({ type: 'explode' });

  bomb.slide = 0;
  const carrier = world.players[bomb.heldBy];
  if (carrier) carrier.carrying = 0;
  addFlame(world, { cx: bomb.cx, cy: bomb.cy, ttl: FLAME_TICKS, owner: bomb.owner, kind: 'c', tip: 0 });
  for (let d = 1 as Dir; d <= 4; d++) {
    for (let i = 1; i <= bomb.range; i++) {
      const cx = bomb.cx + DX[d] * i;
      const cy = bomb.cy + DY[d] * i;
      const t = tileAt(world, cx, cy);
      if (t === HARD) break;
      if (t === SOFT) {
        if (!world.burning.some((b) => b.cx === cx && b.cy === cy)) {
          world.burning.push({ cx, cy, ttl: FLAME_TICKS });
        }
        break;
      }
      const item = world.items.findIndex((it) => it.cx === cx && it.cy === cy);
      if (item >= 0) world.items.splice(item, 1);
      const other = bombAt(world, cx, cy);
      if (other) other.fuse = Math.min(other.fuse, CHAIN_TICKS);
      addFlame(world, {
        cx,
        cy,
        ttl: FLAME_TICKS,
        owner: bomb.owner,
        kind: d <= 2 ? 'v' : 'h',
        tip: i === bomb.range ? (d as Dir) : 0,
      });
    }
  }
}

function applyItem(p: Player, kind: ItemKind): void {
  if (kind === 'bomb') p.bombsMax = Math.min(MAX_BOMBS, p.bombsMax + 1);
  else if (kind === 'fire') p.fire = Math.min(MAX_FIRE, p.fire + 1);
  else if (kind === 'kick') p.canKick = true;
  else if (kind === 'grab') p.canGrab = true;
  else if (kind === 'shield') p.shieldTicks = SHIELD_TICKS; // a second one only starts the 30 s again
  else if (kind === 'curse') p.curseTicks = CURSE_TICKS; // likewise
  else p.speed = Math.min(MAX_SPEED_ITEMS, p.speed + 1);
}

// ---------------------------------------------------------------- one tick

/**
 * Advance the world by one tick. `inputs[id]` may be missing: that player
 * stands still. Order within a tick: players move and press buttons, bombs
 * move and count down, due bombs go off, blasts and burning bricks fade,
 * falling blocks land, players are checked against blasts and power-ups,
 * then the match result.
 */
export function step(world: World, inputs: (PlayerInput | undefined)[]): void {
  world.events.length = 0;
  world.tick++;

  for (const p of world.players) {
    if (!p.alive) {
      if (p.deadTicks < GHOST_TICKS) p.deadTicks++;
      continue;
    }
    if (p.shieldTicks > 0) p.shieldTicks--;
    if (p.graceTicks > 0) p.graceTicks--;
    if (p.curseTicks > 0) p.curseTicks--;
    const inp = inputs[p.id];
    const asked: Dir = inp ? inp.dir : 0;
    if (asked !== p.askDir) {
      p.askDir = asked;
      p.askTicks = 0;
    } else if (asked) p.askTicks++;
    if (inp && inp.dir) movePlayer(world, p, inp.dir);
    else if (world.stepAssist) coast(world, p);
    else p.moving = false;
    const a = !!inp?.a;
    if (a && !p.prevA) placeBomb(world, p);
    p.prevA = a;
    const bBtn = !!inp?.b;
    if (bBtn && !p.prevB) useAction(world, p);
    p.prevB = bBtn;
  }

  // bombs: the fuse keeps burning while carried or thrown
  moveBombs(world);
  for (const b of world.bombs) {
    b.fuse--;
    if (b.state === 'ground' && world.flames.some((f) => f.cx === b.cx && f.cy === b.cy)) {
      b.fuse = Math.min(b.fuse, CHAIN_TICKS);
    }
  }
  for (let guard = 0; guard < 200; guard++) {
    const due = world.bombs.find((b) => b.state !== 'air' && b.fuse <= 0);
    if (!due) break;
    explode(world, due);
  }

  // flames and burning blocks
  for (const f of world.flames) f.ttl--;
  world.flames = world.flames.filter((f) => f.ttl > 0);
  for (const b of world.burning) b.ttl--;
  for (const b of world.burning) {
    if (b.ttl <= 0) {
      const i = b.cy * world.w + b.cx;
      world.tiles[i] = FLOOR;
      const kind = world.hidden.get(i);
      if (kind) {
        world.hidden.delete(i);
        world.items.push({ cx: b.cx, cy: b.cy, kind, age: 0 });
      }
    }
  }
  world.burning = world.burning.filter((b) => b.ttl > 0);
  for (const it of world.items) it.age++;

  // the round timer: blocks start to fall, and land
  if (world.roundTicks > 0) fallBlocks(world);

  // players against flames and items
  for (const p of world.players) {
    if (!p.alive) continue;
    const cx = Math.round(p.x);
    const cy = Math.round(p.y);
    const flame = world.flames.find((f) => f.cx === cx && f.cy === cy);
    // (once the round is decided, nothing more can happen to the winner)
    if (flame && !(world.over && world.over.winner === p.id)) {
      if (p.graceTicks > 0) {
        // its shield has just taken this blast
      } else if (p.shieldTicks > 0) {
        p.shieldTicks = 0;
        p.graceTicks = SHIELD_GRACE_TICKS;
        world.events.push({ type: 'shield', player: p.id });
      } else {
        p.alive = false;
        p.moving = false;
        world.events.push({ type: 'death', player: p.id, cause: 'blast', by: flame.owner });
        continue;
      }
    }
    const i = world.items.findIndex((it) => it.cx === cx && it.cy === cy);
    if (i >= 0) {
      const kind = world.items[i].kind;
      world.items.splice(i, 1);
      applyItem(p, kind);
      world.events.push({ type: 'pickup', player: p.id, kind });
    }
  }

  // last one standing wins; a short wait lets a double knockout count as a draw
  if (!world.over) {
    const alive = world.players.filter((p) => p.alive);
    if (alive.length <= 1 && world.players.length > 1) {
      if (world.overCountdown < 0) world.overCountdown = 45;
      else if (--world.overCountdown === 0) {
        world.over = { winner: alive.length === 1 ? alive[0].id : -1 };
      }
    }
  }
}
