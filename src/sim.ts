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
export type ItemKind = 'bomb' | 'fire' | 'speed' | 'kick' | 'grab';

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
  /** the way the robot is drawn facing, and the way a thrown bomb goes */
  facing: Dir;
  /** true if the robot really moved on the last tick */
  moving: boolean;
  /** walk animation phase, advanced as the robot moves */
  walk: number;
  /** which way the last real movement went on each axis (-1, 0, 1) */
  mvx: number;
  mvy: number;
  /** direction of the last real movement (may differ from `facing` when blocked) */
  heading: Dir;
  alive: boolean;
  /** ticks since being knocked out, for the fade-out (stops at DEATH_TICKS) */
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
  | { type: 'death'; player: number };

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
  /** see World.stepAssist. Default false. */
  stepAssist?: boolean;
}

// ---------------------------------------------------------------- constants
// Times are in ticks (60 a second), distances in tiles.

export const FUSE_TICKS = 150; // a dropped bomb goes off after 2.5 s
export const FLAME_TICKS = 30; // a blast stays for 0.5 s
export const CHAIN_TICKS = 5; // a bomb caught in a blast goes off this soon after
export const BASE_SPEED = 0.062; // walking speed, tiles per tick (3.7 tiles a second)
export const SPEED_STEP = 0.008; // added by each speed power-up
export const MAX_SPEED_ITEMS = 6;
export const MAX_BOMBS = 8;
export const MAX_FIRE = 8;
export const DEATH_TICKS = 50; // length of the knocked-out fade
export const CARRY_FUSE_TICKS = 180; // 3 s from the first pick-up, and it keeps ticking
export const KICK_SPEED = 0.2; // a kicked bomb slides at 12 tiles a second
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
        const r = rng();
        if (r < 0.11) hidden.set(i, 'bomb');
        else if (r < 0.22) hidden.set(i, 'fire');
        else if (r < 0.3) hidden.set(i, 'speed');
        else if (r < 0.35) hidden.set(i, 'kick');
        else if (r < 0.4) hidden.set(i, 'grab');
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
    alive: true,
    deadTicks: 0,
    bombsMax: 1,
    fire: 2,
    speed: 0,
    activeBombs: 0,
    canKick: false,
    canGrab: false,
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
    nextBombId: 1,
    events: [],
    over: null,
    overCountdown: -1,
    stepAssist: cfg.stepAssist ?? false,
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

/** Can this player not enter the tile? A bomb you are still standing on lets you walk off it. */
function blocked(world: World, p: Player, cx: number, cy: number): boolean {
  if (tileAt(world, cx, cy) !== FLOOR) return true;
  const b = bombAt(world, cx, cy);
  if (b && !(Math.abs(p.x - b.x) < 0.999 && Math.abs(p.y - b.y) < 0.999)) return true;
  return false;
}

/** Move `v` toward `target` by at most `step`, landing exactly on it. */
function approach(v: number, target: number, step: number): number {
  if (v < target) return Math.min(target, v + step);
  return Math.max(target, v - step);
}

/** This player's walking speed in tiles per tick. */
export function playerSpeed(p: Player): number {
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
 * Grid movement. Players travel along lanes: you can only go sideways where
 * there is an opening, so a turn asked for between openings has to be lined up.
 *
 * - Already lined up and the way is free: go.
 * - Running along a lane and asked to turn (say going down, asked to go left):
 *   if the tile it is standing on has the opening, turn there. Otherwise keep
 *   running the same way and take the next opening ahead. The robot never turns
 *   round to reach an opening behind it unless there is nothing ahead at all.
 * - Standing still between two lanes: step to the nearest one that is open.
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
      const other = tAcross + Math.sign(off);
      if (canTurnAt(tAcross)) target = tAcross;
      else if (canTurnAt(other)) target = other;
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
      // walking into a bomb kicks it away in that direction
      if (newAlong === tAlong) {
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
  // face the way the robot is actually walking; when it cannot move, the way it was asked to go
  p.facing = moved ? p.heading : dir;
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
  else p.speed = Math.min(MAX_SPEED_ITEMS, p.speed + 1);
}

// ---------------------------------------------------------------- one tick

/**
 * Advance the world by one tick. `inputs[id]` may be missing: that player
 * stands still. Order within a tick: players move and press buttons, bombs
 * move and count down, due bombs go off, blasts and burning bricks fade,
 * players are checked against blasts and power-ups, then the match result.
 */
export function step(world: World, inputs: (PlayerInput | undefined)[]): void {
  world.events.length = 0;
  world.tick++;

  for (const p of world.players) {
    if (!p.alive) {
      if (p.deadTicks < DEATH_TICKS) p.deadTicks++;
      continue;
    }
    const inp = inputs[p.id];
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

  // players against flames and items
  for (const p of world.players) {
    if (!p.alive) continue;
    const cx = Math.round(p.x);
    const cy = Math.round(p.y);
    if (world.flames.some((f) => f.cx === cx && f.cy === cy)) {
      p.alive = false;
      p.moving = false;
      world.events.push({ type: 'death', player: p.id });
      continue;
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
