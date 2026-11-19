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
 * the boot (kick bombs), the glove (lift and throw bombs), the shield, the
 * curse, and the laptop (B flies a plane that drops bombs: see `launch`).
 */
export type ItemKind = 'bomb' | 'fire' | 'speed' | 'kick' | 'grab' | 'shield' | 'curse' | 'laptop';

/**
 * What one player is asking for on one tick. Buttons are sent as "held or
 * not"; the rules notice the moment a button goes down.
 */
export interface PlayerInput {
  dir: Dir;
  /** A button: drop a bomb (flying a plane: drop one of its bombs) */
  a: boolean;
  /** B button: lift a bomb, or throw the one being carried (needs the glove); holding a laptop, fly the plane; flying, bring it home */
  b: boolean;
  /**
   * Only while flying a plane: the way to steer it, in AIM_STEPS steps of a turn clockwise from right (screen
   * down is a quarter turn), from the swipe pad, keys or stick at any angle. Left out, the plane flies on as it is.
   */
  aim?: number;
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
  /** lives left this round, the one in use included (WorldConfig.lives). 0 once out of the round. */
  lives: number;
  /** a life was lost and another is left: the tick it comes back on, at its starting place; -1 otherwise */
  respawnAt: number;
  /** ticks left in which blasts do no harm, just after coming back (it is drawn blinking) */
  safeTicks: number;
  /**
   * Out of lives, with angels on (WorldConfig.angels): an angel on the arena's outer wall, gliding round it and
   * throwing bombs in (`angelStep`). It starts acting at `angelFrom`.
   */
  angel: boolean;
  angelFrom: number;
  /** where the angel is on the wall: tiles round it clockwise from the top-left corner (see `perimeterAt`) */
  angelS: number;
  /** how many ticks A has been held for the throw being wound up; 0 when not */
  angelHeld: number;
  /**
   * Out of lives, with zombies on (WorldConfig.zombies): a zombie, back on its feet in the arena where it fell,
   * slow, with one small bomb at a time and no power-ups. A blast or a block knocks it down (`zombieDown`) and
   * it gets up again (`respawnAt`). It is never in the round: it cannot win, and does not keep the round going.
   */
  zombie: boolean;
  zombieDown: boolean;
  /** the side it plays on in a teams match (WorldConfig.teams): 0, 1... ; -1 when every robot plays for itself */
  team: number;
  /**
   * The laptop power-up: holding one. B then flies a plane in place of lifting a bomb (the owner's design,
   * 18 November 2026), once: the laptop is used up when the plane comes home.
   */
  laptop: boolean;
  /**
   * Ticks of the plane's flight left; 0 when not flying. While flying the robot stands still at its laptop
   * (and can be knocked out): the direction steers the plane, A drops its bombs, B brings it home.
   */
  flying: number;
  /** where the plane is, in tiles like a robot (any point: it wraps round the edges of the map) */
  planeX: number;
  planeY: number;
  /** which way it flies, in TURN_STEPS steps of a turn clockwise from right */
  planeDir: number;
  /** bombs it still has to drop, and ticks before the next one can go */
  planeBombs: number;
  planeCool: number;
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

/**
 * A bomb dropped from a plane, falling. It keeps the plane's speed as it falls, losing a little each tick
 * (DROP_DRAG), so it lands some way on from where it was let go, and goes off the moment it lands.
 */
export interface Drop {
  /** where it is over the floor, in tiles (wrapping round the map's edges like the plane) */
  x: number;
  y: number;
  /** its speed over the floor, tiles a tick */
  vx: number;
  vy: number;
  /** ticks until it lands */
  t: number;
  /** the player whose plane dropped it: the blast is theirs */
  owner: number;
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
  /** a bomb went off on this tile */
  | { type: 'explode'; cx: number; cy: number }
  | { type: 'pickup'; player: number; kind: ItemKind }
  /** a shield took a blast for this player and is used up */
  | { type: 'shield'; player: number }
  /** a falling block has landed on this tile, which is now a solid block */
  | { type: 'block'; cx: number; cy: number }
  /**
   * `cause` says what knocked the player out: a blast, or a falling block.
   * `by` is the player whose bomb made the blast, or -1 for a block.
   */
  | { type: 'death'; player: number; cause: 'blast' | 'block'; by: number; out: boolean }
  /** a player who lost a life is back, at their starting place (or the nearest free tile to it) */
  | { type: 'respawn'; player: number }
  /** an angel's bomb knocked a robot out and, with Angels come back on, the angel took its place */
  | { type: 'revive'; player: number; victim: number }
  /** a zombie is on its feet: just risen from a knockout, or back up after being knocked down */
  | { type: 'rise'; player: number }
  /** a player opened the laptop: their plane is up */
  | { type: 'launch'; player: number }
  /** a plane let one of its bombs go */
  | { type: 'drop'; player: number }
  /** a plane's flight is over (it came home, or its pilot was knocked out) */
  | { type: 'home'; player: number };

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
  /** bombs falling from planes */
  drops: Drop[];
  nextBombId: number;
  /** what happened on the latest tick (cleared at the start of each one) */
  events: GameEvent[];
  /**
   * set once the round is decided; winner is a player id, or -1 for a draw. In a teams match `team` is the
   * side that won and `winner` one of its robots (one still standing if any is): every robot on that side
   * wins the round, those knocked out included (`winnersOf`).
   */
  over: { winner: number; team?: number } | null;
  /** ticks left before the result is declared once one player or none is left; -1 until then */
  overCountdown: number;
  /** optional and off by default: letting go finishes the step so players stop in the middle of a tile */
  stepAssist: boolean;
  /** knocked-out players out of lives become angels on the wall: 'off', 'on', or 'revive' (an angel whose bomb knocks a robot out takes its place) */
  angels: AngelRule;
  /** knocked-out players out of lives get up again as zombies (in place of angels) */
  zombies: boolean;
  /** where each player started the round, by id: where a lost life comes back */
  spawns: { x: number; y: number }[];
  /** what a robot starts with, and comes back with after losing a life */
  start: { bombs: number; fire: number; speed: number };
  /** a teams match: the round is won by the last side standing (Player.team) */
  teams: boolean;
  /**
   * Every robot on one team (the owner's ask: allowed in the lobby's Custom teams). Nobody goes after anyone
   * (the CPU players only break blocks), and the round is played together: the team wins it if someone is
   * still standing when the last falling block has landed; everyone out is a draw.
   */
  coop: boolean;
  /** in a teams match, whether a teammate's blast can knock you out (your own always can) */
  friendlyFire: boolean;
}

/** Knocked-out players as angels: off, on (they throw bombs in), or on and able to come back (`revive`). */
export type AngelRule = 'off' | 'on' | 'revive';

export interface WorldConfig {
  /** the same seed always builds the same arena */
  seed: number;
  /** playable columns and rows, not counting the outer wall (odd numbers). Default 13 by 11. */
  cols?: number;
  rows?: number;
  /** one entry per player, up to eight (MAX_PLAYERS); where each starts is `spawnPoints` */
  players: { colorId: string }[];
  /** share of open tiles that start as bricks, 0 to 1. Default 0.78. */
  softDensity?: number;
  /** what the timer counts down from, in ticks. Default ROUND_TICKS (1 minute 30). 0 = no timer and no falling blocks. */
  roundTicks?: number;
  /** see World.stepAssist. Default false. */
  stepAssist?: boolean;
  /**
   * How long the falling blocks take to close in once the timer reaches 0, in ticks. Default SHRINK_TICKS
   * (50 seconds). The lobby's "Closing in" setting.
   */
  shrinkTicks?: number;
  /**
   * The chance that a brick hides each kind of power-up, in place of ITEM_CHANCE (same kinds; a kind left
   * out never appears). The lobby's power-up settings. A kind set to 0 never appears, and the kick and
   * grab power-ups are only made sure of when their chance is above 0. The chances must add up to 1 or less.
   */
  itemChance?: [ItemKind, number][];
  /** What every player starts the round with: bombs (1 to MAX_BOMBS, default 1), blast length (START_FIRE to MAX_FIRE), speed power-ups (0 to MAX_SPEED_ITEMS). */
  startBombs?: number;
  startFire?: number;
  startSpeed?: number;
  /** Lives each robot has in the round, 1 (the default) to MAX_LIVES. */
  lives?: number;
  /** Knocked-out players as angels (World.angels). Default 'off'. */
  angels?: AngelRule;
  /** Knocked-out players as zombies (World.zombies), in place of angels. Default false. */
  zombies?: boolean;
  /**
   * A teams match: the side of each player, in the order of `players` (0, 1...). The last side with a robot in
   * the round wins it. Everyone on one side: they play together (World.coop). Left out, every robot plays for
   * itself.
   */
  teams?: number[];
  /** In a teams match, can a teammate's blast knock you out? Default true. Your own blast always can. */
  friendlyFire?: boolean;
}

// ---------------------------------------------------------------- constants
// Times are in ticks (60 a second), distances in tiles.

export const FUSE_TICKS = 153; // a dropped bomb goes off after 2.55 s (the owner's ask, 18 November 2026; it was 150, 2.5 s)
export const FLAME_TICKS = 27; // a blast stays for 0.45 s (was 30: shortened a little in play-testing)
export const CHAIN_TICKS = 5; // a bomb caught in a blast goes off this soon after
export const BASE_SPEED = 0.04250390625; // starting walking speed, tiles per tick (2.55 tiles a second)
export const SPEED_STEP = 0.5 / TICK_HZ; // added by each speed power-up: 0.5 tiles a second (0.008333 a tick). Nothing else changes a robot's speed.
export const MAX_SPEED_ITEMS = 6; // so six of them bring it to 0.0925 tiles a tick (5.55 tiles a second)
export const MAX_BOMBS = 8;

/**
 * The chance that a brick hides each power-up. A brick hides at most one, so
 * these add up to the share of bricks that hide anything (61.25%). The order
 * matters only for which random numbers give which power-up; keep new ones at
 * the end so arenas made from old seeds keep their first five kinds in place.
 * What these chances come to per arena is measured in docs/GAME-RULES.md.
 */
// (all a quarter up in November 2026, the owner's ask, on every map: 60% of bricks hide something, it was 48%)
export const ITEM_CHANCE: [ItemKind, number][] = [
  ['bomb', 0.1875],
  ['fire', 0.1875],
  ['speed', 0.1375],
  ['kick', 0.03125], // rare. Every arena still gets at least one: see createWorld
  ['grab', 0.03125], // likewise
  ['shield', 0.0125], // very rare: in about six arenas in ten
  ['curse', 0.0125], // very rare: in about six arenas in ten
  ['laptop', 0.0125], // very rare, but every arena gets at least one (the owner's ask, 18 November 2026): see createWorld
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
 * The falling blocks leave an area this many tiles across and this many down open in the middle of the arena,
 * for whoever is left to fight it out in: 7 by 5 (the owner's ask, 18 November 2026; it was a 5 by 5 square,
 * which the last four blocks used to make out of the 7 by 5 that the rings leave on the Standard arena).
 */
export const KEEP_OPEN_W = 7;
export const KEEP_OPEN_H = 5;
export const DEATH_TICKS = 90; // length of the knocked-out animation (1.5 s)
export const GHOST_TICKS = 300; // `deadTicks` goes on counting this far (5 s), so the ghost can be drawn floating all the way off the top of the screen
export const CARRY_FUSE_TICKS = 180; // 3 s from the first pick-up, and it keeps ticking
export const KICK_SPEED = 0.14; // a kicked bomb slides at 8.4 tiles a second
export const THROW_TILES = 3; // a thrown bomb lands this many tiles away
export const FLY_TICKS_PER_TILE = 7; // how long a thrown bomb takes over each tile

// lives
export const MAX_LIVES = 5;
export const RESPAWN_TICKS = 120; // a lost life comes back 2 s after the knockout, at the robot's starting place
export const SAFE_TICKS = 120; // and blasts do it no harm for 2 s after that (it blinks)

// angels: out of lives, a robot haunts the outer wall and throws bombs in
export const ANGEL_DELAY = DEATH_TICKS; // it takes to the wall once the knocked-out animation has played
export const ANGEL_SPEED = 0.075; // gliding round the wall, tiles a tick (4.5 tiles a second)
export const ANGEL_MIN_TILES = 2; // a tap of A throws the bomb this many tiles in from the wall
export const ANGEL_MAX_TILES = 6; // holding A throws it further, up to this
export const ANGEL_CHARGE_TICKS = 14; // each tile further takes this long held (about a quarter of a second)
export const ANGEL_FIRE = 2; // an angel's bomb reaches two tiles each way
export const ANGEL_BOMBS = 1; // one of its bombs out at a time

// zombies: out of lives, a robot gets up again where it fell, to get in the others' way
export const ZOMBIE_RISE_TICKS = DEATH_TICKS + 30; // it rises 2 s after the knockout (once the knocked-out animation has played)
export const ZOMBIE_DOWN_TICKS = 240; // a blast or a block knocks a zombie down for 4 s; then it gets up where it fell
export const ZOMBIE_SPEED = 0.5; // it walks at half the starting speed, whatever it had collected (the owner's ask; it was 75%)
export const ZOMBIE_FIRE = 1; // its bombs reach one tile each way
export const ZOMBIE_BOMBS = 1; // one at a time
export const ZOMBIE_SAFE_TICKS = 60; // blasts leave it be for 1 s after it gets up

// the laptop: B flies a plane over the arena that drops bombs (the owner's design, 18 November 2026). The robot
// stands at its laptop while the plane is up. The plane is steered smoothly at any angle; its bombs fall, keep
// some of its speed as they go, and go off where they land, with nothing on screen saying where that will be.
export const PLANE_TICKS = 8 * TICK_HZ; // a flight lasts up to 8 s
export const PLANE_SPEED = 0.08; // tiles a tick (4.8 tiles a second: quicker than a robot with every speed power-up)
export const TURN_STEPS = 256; // the plane's heading is kept in 256ths of a turn ...
export const PLANE_TURN = 2; // ... and turns at most this many a tick (169° a second): it sweeps round, never on the spot
export const AIM_STEPS = 64; // the way it is steered (PlayerInput.aim) comes in 64ths of a turn
export const PLANE_BOMBS = 3; // bombs a plane can drop
export const PLANE_FIRST_GAP = 30; // none in its first half second, so the first cannot land on the robot it took off from
export const PLANE_DROP_GAP = 20; // and at least a third of a second between two
export const PLANE_AFTER = 30; // once its last bomb is away it flies on half a second, then home
export const DROP_TICKS = 48; // a dropped bomb falls for 0.8 s: long enough to see it coming and get out of the way
export const DROP_DRAG = 0.95; // keeping 95% of its speed each tick: it lands about 1.5 tiles on from where it was let go
export const DROP_FIRE = 1; // its blast reaches one tile each way

/**
 * The way a plane flies for each of its TURN_STEPS headings: [x, y] per tick of PLANE_SPEED, clockwise from
 * right (y is down). Worked out with + - * / only, from the series for sine and cosine, never Math.sin or
 * Math.cos: engines may round those differently, and every copy of a round (the server's, each page's) must
 * move its planes exactly alike. Basic arithmetic is rounded the same everywhere.
 */
export const PLANE_STEP: [number, number][] = (() => {
  const PI = 3.141592653589793;
  // for 0 to an eighth of a turn, where 14 terms of each series are far more than enough
  const sinS = (a: number): number => {
    let term = a;
    let sum = a;
    for (let n = 1; n < 14; n++) {
      term *= -(a * a) / (2 * n * (2 * n + 1));
      sum += term;
    }
    return sum;
  };
  const cosS = (a: number): number => {
    let term = 1;
    let sum = 1;
    for (let n = 1; n < 14; n++) {
      term *= -(a * a) / ((2 * n - 1) * (2 * n));
      sum += term;
    }
    return sum;
  };
  const q = TURN_STEPS / 4;
  const out: [number, number][] = [];
  for (let h = 0; h < TURN_STEPS; h++) {
    const k = h % q; // the angle into its quarter turn, in steps
    // within a quarter: up to an eighth by the series, past it by the series for what is left of the quarter
    const c = k <= q / 2 ? cosS((k * 2 * PI) / TURN_STEPS) : sinS(((q - k) * 2 * PI) / TURN_STEPS);
    const s = k <= q / 2 ? sinS((k * 2 * PI) / TURN_STEPS) : cosS(((q - k) * 2 * PI) / TURN_STEPS);
    // then a whole number of quarter turns, clockwise: (x, y) -> (-y, x)
    const turns = Math.floor(h / q);
    const v: [number, number] = turns === 0 ? [c, s] : turns === 1 ? [-s, c] : turns === 2 ? [-c, -s] : [s, -c];
    out.push([v[0] * PLANE_SPEED, v[1] * PLANE_SPEED]);
  }
  return out;
})();

/** The heading (TURN_STEPS) a robot facing `d` launches its plane in. */
export const FACING_HEADING = [0, (TURN_STEPS * 3) / 4, TURN_STEPS / 4, TURN_STEPS / 2, 0];

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

/** The most players a round can have (the owner's limit: eight in all). */
export const MAX_PLAYERS = 8;

/**
 * Start tiles for `n` players (1 to MAX_PLAYERS), spread out as the owner asked: four players start in
 * the corners; a fifth in the middle; six put two in the middle row instead, a third of the way in from
 * each side; seven add the middle of the top and bottom edges to five; eight use the corners and the middle
 * of all four edges. In player order: you (top-left), bottom-right, top-right,
 * bottom-left, then the rest. A tile on a pillar is moved one to the right.
 */
export function spawnPoints(w: number, h: number, n = 4): { x: number; y: number }[] {
  const at = (x: number, y: number): { x: number; y: number } => (x % 2 === 0 && y % 2 === 0 ? { x: x + 1, y } : { x, y });
  const cx = Math.floor((w - 1) / 2);
  const cy = Math.floor((h - 1) / 2);
  const corners = [at(1, 1), at(w - 2, h - 2), at(w - 2, 1), at(1, h - 2)];
  const middle = at(cx, cy);
  const top = at(cx, 1);
  const bottom = at(cx, h - 2);
  const left = at(1, cy);
  const right = at(w - 2, cy);
  const third = Math.round((w - 1) / 3);
  if (n <= 4) return corners.slice(0, Math.max(0, n));
  if (n === 5) return [...corners, middle];
  if (n === 6) return [...corners, at(third, cy), at(w - 1 - third, cy)];
  if (n === 7) return [...corners, middle, top, bottom];
  return [...corners, top, bottom, left, right];
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
  const spawns = spawnPoints(w, h, cfg.players.length);

  const safe = new Set<number>();
  for (const s of spawns) {
    safe.add(s.y * w + s.x);
    for (let d = 1; d <= 4; d++) safe.add((s.y + DY[d]) * w + (s.x + DX[d]));
  }

  const hidden = new Map<number, ItemKind>();
  const chances = cfg.itemChance ?? ITEM_CHANCE;
  const density = cfg.softDensity ?? 0.78;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const border = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      const pillar = x % 2 === 0 && y % 2 === 0;
      if (border || pillar) tiles[i] = HARD;
      else if (!safe.has(i) && rng() < density) {
        tiles[i] = SOFT;
        // one random number per brick decides what, if anything, it hides (ITEM_CHANCE, or the lobby's mix)
        let r = rng();
        for (const [kind, chance] of chances) {
          if (r < chance) {
            hidden.set(i, kind);
            break;
          }
          r -= chance;
        }
      }
    }
  }
  // every arena has at least one kick, one grab and one laptop power-up somewhere (unless the lobby has switched
  // them off; the laptop since 18 November 2026, the owner's ask)
  for (const kind of ['kick', 'grab', 'laptop'] as const) {
    if (!chances.some(([k, c]) => k === kind && c > 0)) continue;
    if ([...hidden.values()].includes(kind)) continue;
    const empty: number[] = [];
    for (let i = 0; i < tiles.length; i++) if (tiles[i] === SOFT && !hidden.has(i)) empty.push(i);
    if (empty.length) hidden.set(empty[Math.floor(rng() * empty.length)], kind);
  }

  const roundTicks = Math.max(0, Math.floor(cfg.roundTicks ?? ROUND_TICKS));
  const within = (v: number | undefined, lo: number, hi: number, dflt: number): number =>
    v === undefined || !Number.isFinite(v) ? dflt : Math.max(lo, Math.min(hi, Math.round(v)));
  const startBombs = within(cfg.startBombs, 1, MAX_BOMBS, 1);
  const startFire = within(cfg.startFire, START_FIRE, MAX_FIRE, START_FIRE);
  const startSpeed = within(cfg.startSpeed, 0, MAX_SPEED_ITEMS, 0);
  const lives = within(cfg.lives, 1, MAX_LIVES, 1);
  const teamsOn = !!cfg.teams && cfg.teams.length === cfg.players.length && cfg.players.length > 0 && cfg.teams.every((t) => Number.isInteger(t) && t >= 0);
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
    bombsMax: startBombs,
    fire: startFire,
    speed: startSpeed,
    activeBombs: 0,
    canKick: false,
    canGrab: false,
    shieldTicks: 0,
    graceTicks: 0,
    curseTicks: 0,
    prevA: false,
    prevB: false,
    carrying: 0,
    lives,
    respawnAt: -1,
    safeTicks: 0,
    angel: false,
    angelFrom: -1,
    angelS: 0,
    angelHeld: 0,
    zombie: false,
    zombieDown: false,
    team: teamsOn ? cfg.teams![id] : -1,
    laptop: false,
    flying: 0,
    planeX: 0,
    planeY: 0,
    planeDir: 0,
    planeBombs: 0,
    planeCool: 0,
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
    shrinkTicks: Math.max(FALL_TICKS * 2, Math.floor(cfg.shrinkTicks ?? SHRINK_TICKS)),
    shrinkOrder: roundTicks > 0 ? spiral(w, h).filter((i) => tiles[i] !== HARD && !keptOpen(w, h, i)) : [],
    shrinkNext: 0,
    falling: [],
    drops: [],
    nextBombId: 1,
    events: [],
    over: null,
    overCountdown: -1,
    stepAssist: cfg.stepAssist ?? false,
    angels: !cfg.zombies && (cfg.angels === 'on' || cfg.angels === 'revive') ? cfg.angels : 'off',
    zombies: !!cfg.zombies,
    spawns: spawns.map((p) => ({ ...p })),
    start: { bombs: startBombs, fire: startFire, speed: startSpeed },
    teams: teamsOn,
    coop: teamsOn && cfg.players.length > 1 && new Set(cfg.teams).size === 1,
    friendlyFire: cfg.friendlyFire ?? true,
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

/** Is this tile in the area in the middle of the arena that the falling blocks leave open (7 by 5)? */
export function keptOpen(w: number, h: number, i: number): boolean {
  const x = i % w;
  const y = Math.floor(i / w);
  return Math.abs(x - (w - 1) / 2) <= (KEEP_OPEN_W - 1) / 2 && Math.abs(y - (h - 1) / 2) <= (KEEP_OPEN_H - 1) / 2;
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
      if (px === cx && py === cy && wonRound(world, p)) {
        // the round is decided and this is the winner: the block leaves it be
      } else if (px === cx && py === cy) {
        knockOut(world, p, 'block', -1);
        under.push(p);
      } else if (Math.abs(p.x - cx) < 1 && Math.abs(p.y - cy) < 1) {
        if (px !== cx) p.x = px;
        if (py !== cy) p.y = py;
      }
    }
    world.events.push({ type: 'block', cx, cy });
    // The last robot standing wins even if a block gets it a moment after the others went.
    // (Several under the same block went together: that is left to end as a draw, unless they are teammates.)
    // (everyone on one team: being crushed last is no win)
    if (!world.over && !world.coop && under.length >= 1 && oneSide(under) && world.players.length > 1 && !world.players.some(inRound) && under.every((u) => u.lives === 0 && !u.zombie)) {
      world.over = decided(world, under);
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
    drops: w.drops.map((d) => ({ ...d })),
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
  if (p.zombie) return BASE_SPEED * ZOMBIE_SPEED;
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
 * B button. Carrying a bomb: throw it the way you are facing. Holding a laptop:
 * fly its plane (`launch`). Otherwise, with the glove: lift a bomb from your
 * own tile, else the tile you face, else any tile next to you. The first lift
 * of a bomb sets its fuse to 3 seconds.
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
  // holding a laptop, B flies the plane: the glove waits until the laptop is used (the owner's design)
  if (p.laptop) {
    launch(world, p);
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
  world.events.push({ type: 'explode', cx: bomb.cx, cy: bomb.cy });

  bomb.slide = 0;
  const carrier = world.players[bomb.heldBy];
  if (carrier) carrier.carrying = 0;
  blast(world, bomb.cx, bomb.cy, bomb.range, bomb.owner);
}

/** The blast itself, from (cx, cy), `range` tiles each way, in `owner`'s name (a bomb's, or a plane's: moveDrops). */
function blast(world: World, x0: number, y0: number, range: number, owner: number): void {
  addFlame(world, { cx: x0, cy: y0, ttl: FLAME_TICKS, owner, kind: 'c', tip: 0 });
  for (let d = 1 as Dir; d <= 4; d++) {
    for (let i = 1; i <= range; i++) {
      const cx = x0 + DX[d] * i;
      const cy = y0 + DY[d] * i;
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
        owner,
        kind: d <= 2 ? 'v' : 'h',
        tip: i === range ? (d as Dir) : 0,
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
  else if (kind === 'laptop') p.laptop = true; // (one at a time: a second one is just picked up)
  else p.speed = Math.min(MAX_SPEED_ITEMS, p.speed + 1);
}

// ---------------------------------------------------------------- the laptop's plane

/** B with a laptop: the plane takes off from the robot, the way it faces, with PLANE_BOMBS bombs. */
function launch(world: World, p: Player): void {
  p.flying = PLANE_TICKS;
  p.planeX = p.x;
  p.planeY = p.y;
  p.planeDir = FACING_HEADING[p.facing];
  p.planeBombs = PLANE_BOMBS;
  p.planeCool = PLANE_FIRST_GAP;
  p.moving = false;
  p.askDir = 0;
  p.askTicks = 0;
  world.events.push({ type: 'launch', player: p.id });
}

/** The flight is over: the plane is gone, and the laptop is used up (B lifts bombs again, with the glove). */
function endFlight(world: World, p: Player): void {
  p.flying = 0;
  p.laptop = false;
  p.planeBombs = 0;
  p.planeCool = 0;
  world.events.push({ type: 'home', player: p.id });
}

/**
 * A robot flying its plane, for one tick. The robot stands still at its laptop. The plane turns towards
 * `aim` by at most PLANE_TURN (so it sweeps round in a curve), flies on PLANE_SPEED, and wraps round the
 * edges of the map as a thrown bomb does. A drops one of its bombs, B brings it home; it comes home by
 * itself when its time is up, half a second after its last bomb, or once the round is decided.
 */
function flyPlane(world: World, p: Player, inp: PlayerInput | undefined): void {
  p.moving = false;
  const a = !!inp?.a;
  const b = !!inp?.b;
  const freshA = a && !p.prevA;
  const home = world.over !== null || (b && !p.prevB);
  p.prevA = a;
  p.prevB = b;
  if (home) {
    endFlight(world, p);
    return;
  }
  p.planeDir = planeTurn(p.planeDir, inp?.aim);
  const [vx, vy] = PLANE_STEP[p.planeDir];
  p.planeX = wrap(p.planeX + vx + 0.5, world.w) - 0.5;
  p.planeY = wrap(p.planeY + vy + 0.5, world.h) - 0.5;
  if (p.planeCool > 0) p.planeCool--;
  if (freshA && p.planeBombs > 0 && p.planeCool === 0) {
    world.drops.push({ x: p.planeX, y: p.planeY, vx, vy, t: DROP_TICKS, owner: p.id });
    p.planeBombs--;
    p.planeCool = PLANE_DROP_GAP;
    if (!p.planeBombs) p.flying = Math.min(p.flying, PLANE_AFTER);
    world.events.push({ type: 'drop', player: p.id });
  }
  if (--p.flying <= 0) endFlight(world, p);
}

/** A plane's heading (TURN_STEPS) after one tick of steering towards `aim` (AIM_STEPS): PLANE_TURN at most, the short way round. */
export function planeTurn(dir: number, aim: number | undefined): number {
  if (aim === undefined || !Number.isInteger(aim) || aim < 0 || aim >= AIM_STEPS) return dir;
  const target = aim * (TURN_STEPS / AIM_STEPS);
  const diff = ((target - dir + TURN_STEPS * 1.5) % TURN_STEPS) - TURN_STEPS / 2;
  return Math.abs(diff) <= PLANE_TURN ? target : (dir + Math.sign(diff) * PLANE_TURN + TURN_STEPS) % TURN_STEPS;
}

/**
 * The tile a bomb falling from a plane lands on, `t` ticks of falling from now: moved exactly as moveDrops
 * moves it, the same sums in the same order, so a CPU player's sums agree with the rules to the last bit.
 */
export function dropLanding(world: World, x: number, y: number, vx: number, vy: number, t: number): { cx: number; cy: number; x: number; y: number } {
  for (let k = 0; k < t; k++) {
    x = wrap(x + vx + 0.5, world.w) - 0.5;
    y = wrap(y + vy + 0.5, world.h) - 0.5;
    vx *= DROP_DRAG;
    vy *= DROP_DRAG;
  }
  return { cx: Math.min(world.w - 1, Math.max(0, Math.round(x))), cy: Math.min(world.h - 1, Math.max(0, Math.round(y))), x, y };
}

/**
 * Bombs falling from planes, for one tick: each drifts on the way its plane flew, slowing, and goes off where
 * it lands. Onto a brick it is the brick that takes the blast (it burns); anywhere else, the floor or the top
 * of a solid block, it blasts DROP_FIRE tiles each way, and a power-up or bomb right where it lands is hit too.
 */
function moveDrops(world: World): void {
  if (!world.drops.length) return;
  const landed: Drop[] = [];
  for (const d of world.drops) {
    d.x = wrap(d.x + d.vx + 0.5, world.w) - 0.5;
    d.y = wrap(d.y + d.vy + 0.5, world.h) - 0.5;
    d.vx *= DROP_DRAG;
    d.vy *= DROP_DRAG;
    if (--d.t <= 0) landed.push(d);
  }
  if (!landed.length) return;
  world.drops = world.drops.filter((d) => d.t > 0);
  for (const d of landed) {
    const cx = Math.min(world.w - 1, Math.max(0, Math.round(d.x)));
    const cy = Math.min(world.h - 1, Math.max(0, Math.round(d.y)));
    world.events.push({ type: 'explode', cx, cy });
    if (tileAt(world, cx, cy) === SOFT) {
      if (!world.burning.some((b) => b.cx === cx && b.cy === cy)) world.burning.push({ cx, cy, ttl: FLAME_TICKS });
      continue;
    }
    const item = world.items.findIndex((it) => it.cx === cx && it.cy === cy);
    if (item >= 0) world.items.splice(item, 1);
    const under = bombAt(world, cx, cy);
    if (under) under.fuse = Math.min(under.fuse, CHAIN_TICKS);
    blast(world, cx, cy, DROP_FIRE, d.owner);
  }
}


// ---------------------------------------------------------------- lives and angels

/**
 * A robot is knocked out (by a blast or a falling block). With a life left it comes back at its starting
 * place in RESPAWN_TICKS; with none it is out of the round, and with angels on it becomes an angel on the
 * wall once its knocked-out animation has played, at the point of the wall nearest where it fell.
 */
function knockOut(world: World, p: Player, cause: 'blast' | 'block', by: number): void {
  if (p.flying) endFlight(world, p); // (its plane goes too; bombs already falling still land)
  p.laptop = false;
  p.alive = false;
  p.moving = false;
  p.deadTicks = 0;
  p.safeTicks = 0;
  if (p.zombie) {
    // a zombie is only knocked down: it gets up again where it fell
    p.zombieDown = true;
    p.respawnAt = world.tick + ZOMBIE_DOWN_TICKS;
    world.events.push({ type: 'death', player: p.id, cause, by, out: false });
    return;
  }
  p.lives = Math.max(0, p.lives - 1);
  if (p.lives > 0) p.respawnAt = world.tick + RESPAWN_TICKS;
  else if (world.zombies) {
    // out of lives: it will rise as a zombie where it fell
    p.zombie = true;
    p.zombieDown = false;
    p.respawnAt = world.tick + ZOMBIE_RISE_TICKS;
  } else if (world.angels !== 'off') {
    p.angel = true;
    p.angelFrom = world.tick + ANGEL_DELAY;
    p.angelS = nearestOnWall(world, p.x, p.y);
    p.angelHeld = 0;
  }
  world.events.push({ type: 'death', player: p.id, cause, by, out: p.lives === 0 });
}

/**
 * Put a robot back in the round at (x, y), as at the start of a round: starting bombs, blast and speed, no
 * kick, glove, shield, curse or laptop; blasts cannot hurt it for SAFE_TICKS. Buttons held now count once let go.
 */
function bringBack(world: World, p: Player, x: number, y: number): void {
  Object.assign(p, {
    alive: true,
    x,
    y,
    facing: 2,
    moving: false,
    walk: 0,
    mvx: 0,
    mvy: 0,
    heading: 2,
    askDir: 0,
    askTicks: 0,
    deadTicks: 0,
    bombsMax: world.start.bombs,
    fire: world.start.fire,
    speed: world.start.speed,
    canKick: false,
    canGrab: false,
    shieldTicks: 0,
    graceTicks: 0,
    curseTicks: 0,
    prevA: true,
    prevB: true,
    carrying: 0,
    respawnAt: -1,
    safeTicks: SAFE_TICKS,
    angel: false,
    angelFrom: -1,
    angelHeld: 0,
    laptop: false,
    flying: 0,
    planeBombs: 0,
    planeCool: 0,
  } satisfies Partial<Player>);
}

/**
 * Where a robot coming back appears: its starting tile, or if that is now a block, a bomb, a blast or under a
 * falling block, the nearest tile that is none of those (counted in steps across open floor and bricks alike,
 * so it is never far). The square kept open in the middle always has room.
 */
function comeBackTile(world: World, from: { x: number; y: number }): { x: number; y: number } {
  const ok = (cx: number, cy: number): boolean =>
    tileAt(world, cx, cy) === FLOOR &&
    !bombAt(world, cx, cy) &&
    !world.flames.some((f) => f.cx === cx && f.cy === cy) &&
    !world.falling.some((f) => f.cx === cx && f.cy === cy);
  const seen = new Set<number>([from.y * world.w + from.x]);
  let ring = [from];
  while (ring.length) {
    for (const t of ring) if (ok(t.x, t.y)) return t;
    const next: { x: number; y: number }[] = [];
    for (const t of ring) {
      for (let d = 1; d <= 4; d++) {
        const nx = t.x + DX[d];
        const ny = t.y + DY[d];
        if (nx < 1 || ny < 1 || nx > world.w - 2 || ny > world.h - 2) continue;
        const k = ny * world.w + nx;
        if (seen.has(k)) continue;
        seen.add(k);
        next.push({ x: nx, y: ny });
      }
    }
    ring = next;
  }
  return from;
}

/**
 * Still in the round: standing, or waiting to come back with a life left. Not an angel, and not a zombie:
 * they cannot win the round and do not keep it going.
 */
export function inRound(p: Player): boolean {
  return !p.zombie && (p.alive || p.respawnAt >= 0);
}

/** Two different robots on the same side in a teams match. */
export function allies(a: Player, b: Player): boolean {
  return a.team >= 0 && a.team === b.team && a.id !== b.id;
}

/** Can a blast of `owner`'s knock `p` out? Always, unless they are teammates and friendly fire is off. */
export function blastHurts(world: World, owner: number, p: Player): boolean {
  const by = world.players[owner];
  return world.friendlyFire || !by || !allies(by, p);
}

/** Every robot that won the round just decided: the winner, or its whole side in a teams match. None for a draw. */
export function winnersOf(world: World): number[] {
  const o = world.over;
  if (!o || o.winner < 0) return [];
  if (o.team === undefined) return [o.winner];
  return world.players.filter((p) => p.team === o.team).map((p) => p.id);
}

/** Has `p` won the round (on its own, or with its side)? Once the round is decided nothing more can happen to it. */
export function wonRound(world: World, p: Player): boolean {
  const o = world.over;
  return !!o && o.winner >= 0 && (o.winner === p.id || (o.team !== undefined && p.team === o.team));
}

/** The round's result, given the robots left in it (and one to name the winner by if they are all one side). */
function decided(world: World, left: Player[]): { winner: number; team?: number } {
  if (!left.length) return { winner: -1 };
  const w = left.find((p) => p.alive) ?? left[0];
  return world.teams ? { winner: w.id, team: w.team } : { winner: w.id };
}

/** Are these robots all one side: one robot, or teammates? */
function oneSide(list: Player[]): boolean {
  return list.every((p) => p.id === list[0].id || allies(p, list[0]));
}

/** How far it is round the outer wall, in tiles: along the top, down the right, back along the bottom, up the left. */
export function wallLength(world: World): number {
  return 2 * (world.w - 1) + 2 * (world.h - 1);
}

/** The point on the outer wall `s` tiles round it clockwise from the top-left corner (wrapping). */
export function perimeterAt(world: World, s: number): { x: number; y: number } {
  const W = world.w - 1;
  const H = world.h - 1;
  const L = 2 * W + 2 * H;
  const t = ((s % L) + L) % L;
  if (t < W) return { x: t, y: 0 };
  if (t < W + H) return { x: W, y: t - W };
  if (t < 2 * W + H) return { x: W - (t - W - H), y: H };
  return { x: 0, y: H - (t - 2 * W - H) };
}

/** The place on the wall nearest to (x, y), as a distance round it (see perimeterAt). */
function nearestOnWall(world: World, x: number, y: number): number {
  const W = world.w - 1;
  const H = world.h - 1;
  const options: [number, number][] = [
    [y, Math.max(0, Math.min(W, x))], // top: distance, then where along it
    [W - x, W + Math.max(0, Math.min(H, y))], // right
    [H - y, W + H + (W - Math.max(0, Math.min(W, x)))], // bottom
    [x, 2 * W + H + (H - Math.max(0, Math.min(H, y)))], // left
  ];
  let best = options[0];
  for (const o of options) if (o[0] < best[0]) best = o;
  return best[1];
}

/**
 * The way into the arena from the wall tile an angel is over, or 0 at a corner (nothing to throw across).
 * Also the tile, rounded.
 */
export function angelAim(world: World, p: Player): { cx: number; cy: number; dir: Dir } {
  const at = perimeterAt(world, Math.round(p.angelS));
  const W = world.w - 1;
  const H = world.h - 1;
  const corner = (at.x === 0 || at.x === W) && (at.y === 0 || at.y === H);
  const dir: Dir = corner ? 0 : at.y === 0 ? 2 : at.x === W ? 3 : at.y === H ? 1 : 4;
  return { cx: at.x, cy: at.y, dir };
}

/** How far in a throw wound up for `held` ticks goes: a tap ANGEL_MIN_TILES, then a tile more every ANGEL_CHARGE_TICKS. */
export function angelReach(world: World, dir: Dir, held: number): number {
  const across = dir === 1 || dir === 2 ? world.h - 2 : world.w - 2;
  return Math.min(ANGEL_MAX_TILES, across, ANGEL_MIN_TILES + Math.floor(held / ANGEL_CHARGE_TICKS));
}

/**
 * An angel's tick. The direction glides it round the wall: along the top, right and left go each way; down
 * the sides, up and down; at a corner either works. Holding A winds up a throw (further the longer it is
 * held), and letting go throws a bomb over the wall onto the floor that many tiles in. One bomb out at a time;
 * not from a corner. Nothing an angel does happens once the round is decided.
 */
function angelStep(world: World, p: Player, inp: PlayerInput | undefined): void {
  const a = !!inp?.a;
  if (world.over || world.tick < p.angelFrom) {
    p.prevA = a;
    return;
  }
  const L = wallLength(world);
  const at = perimeterAt(world, p.angelS);
  const W = world.w - 1;
  const H = world.h - 1;
  const d = inp?.dir ?? 0;
  let move = 0;
  if (d) {
    // which way round the wall each direction goes, on each side (both apply near a corner)
    if (at.y < 0.5 && (d === 4 || d === 3)) move = d === 4 ? 1 : -1;
    else if (at.x > W - 0.5 && (d === 2 || d === 1)) move = d === 2 ? 1 : -1;
    else if (at.y > H - 0.5 && (d === 3 || d === 4)) move = d === 3 ? 1 : -1;
    else if (at.x < 0.5 && (d === 1 || d === 2)) move = d === 1 ? 1 : -1;
  }
  if (move) {
    p.angelS = (((p.angelS + move * ANGEL_SPEED) % L) + L) % L;
    p.moving = true;
    p.walk += 0.25;
  } else {
    // at rest it settles on the middle of a wall tile, so the throw lines up with a row or column
    const target = Math.round(p.angelS);
    const gap = target - p.angelS;
    p.angelS = Math.abs(gap) <= ANGEL_SPEED ? target % L : p.angelS + Math.sign(gap) * ANGEL_SPEED;
    p.moving = false;
  }
  if (a && p.activeBombs < ANGEL_BOMBS) p.angelHeld++;
  if (!a && p.prevA && p.angelHeld > 0) {
    const aim = angelAim(world, p);
    if (aim.dir) {
      world.bombs.push({
        id: world.nextBombId++,
        owner: p.id,
        x: aim.cx,
        y: aim.cy,
        cx: aim.cx,
        cy: aim.cy,
        fuse: FUSE_TICKS,
        range: ANGEL_FIRE,
        age: 0,
        state: 'air',
        slide: 0,
        heldBy: -1,
        lifted: false,
        fromX: aim.cx,
        fromY: aim.cy,
        flyDir: aim.dir,
        flyDist: angelReach(world, aim.dir, p.angelHeld),
        flyT: 0,
      });
      p.activeBombs++;
      world.events.push({ type: 'throw' });
    }
    p.angelHeld = 0;
  }
  if (!a) p.angelHeld = 0;
  p.prevA = a;
}

// ---------------------------------------------------------------- one tick

/**
 * Advance the world by one tick. `inputs[id]` may be missing: that player
 * stands still. Order within a tick: players move and press buttons (or fly
 * their planes), bombs move and count down, due bombs go off, bombs falling
 * from planes land and go off, blasts and burning bricks fade, falling blocks
 * land, players are checked against blasts and power-ups, then the match
 * result.
 */
export function step(world: World, inputs: (PlayerInput | undefined)[]): void {
  world.events.length = 0;
  world.tick++;

  for (const p of world.players) {
    if (!p.alive) {
      if (p.deadTicks < GHOST_TICKS) p.deadTicks++;
      if (p.respawnAt >= 0 && world.tick >= p.respawnAt && !world.over && p.zombie) {
        // a zombie gets up where it fell (or beside it, if that tile is taken now)
        const at = comeBackTile(world, { x: Math.round(p.x), y: Math.round(p.y) });
        bringBack(world, p, at.x, at.y);
        Object.assign(p, { zombie: true, zombieDown: false, bombsMax: ZOMBIE_BOMBS, fire: ZOMBIE_FIRE, speed: 0, safeTicks: ZOMBIE_SAFE_TICKS });
        world.events.push({ type: 'rise', player: p.id });
      } else if (p.respawnAt >= 0 && world.tick >= p.respawnAt && !world.over) {
        // a lost life comes back
        const at = comeBackTile(world, world.spawns[p.id]);
        bringBack(world, p, at.x, at.y);
        world.events.push({ type: 'respawn', player: p.id });
      } else {
        if (p.angel) angelStep(world, p, inputs[p.id]);
        continue;
      }
    }
    if (p.safeTicks > 0) p.safeTicks--;
    if (p.shieldTicks > 0) p.shieldTicks--;
    if (p.graceTicks > 0) p.graceTicks--;
    if (p.curseTicks > 0) p.curseTicks--;
    const inp = inputs[p.id];
    if (p.flying > 0) {
      // at its laptop: the direction and buttons fly the plane, and the robot stays where it is
      flyPlane(world, p, inp);
      continue;
    }
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
  // bombs falling from planes: those that land now go off (a bomb they reach goes off moments later)
  moveDrops(world);

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
  const comebacks: [Player, number, number, number][] = []; // angels coming back: the angel, where, and whose place
  for (const p of world.players) {
    if (!p.alive) continue;
    const cx = Math.round(p.x);
    const cy = Math.round(p.y);
    // (a teammate's blast does no harm with friendly fire off)
    const flame = world.flames.find((f) => f.cx === cx && f.cy === cy && blastHurts(world, f.owner, p));
    // (once the round is decided, nothing more can happen to the winner, or to its side)
    if (flame && !wonRound(world, p)) {
      if (p.graceTicks > 0 || p.safeTicks > 0) {
        // its shield has just taken this blast, or it has only just come back
        // its shield has just taken this blast
      } else if (p.shieldTicks > 0) {
        p.shieldTicks = 0;
        p.graceTicks = SHIELD_GRACE_TICKS;
        world.events.push({ type: 'shield', player: p.id });
      } else {
        knockOut(world, p, 'blast', flame.owner);
        // an angel's bomb, with Angels come back on: the angel takes this robot's place
        const by = world.players[flame.owner];
        if (world.angels === 'revive' && by && by.angel && by.id !== p.id && !allies(by, p) && !comebacks.some((c) => c[0] === by)) comebacks.push([by, cx, cy, p.id]);
        continue;
      }
    }
    const i = p.zombie ? -1 : world.items.findIndex((it) => it.cx === cx && it.cy === cy); // (a zombie walks over power-ups)
    if (i >= 0) {
      const kind = world.items[i].kind;
      world.items.splice(i, 1);
      applyItem(p, kind);
      world.events.push({ type: 'pickup', player: p.id, kind });
    }
  }

  for (const [angel, cx, cy, victim] of comebacks) {
    if (world.over) break;
    bringBack(world, angel, cx, cy);
    angel.lives = 1;
    world.events.push({ type: 'revive', player: angel.id, victim });
  }

  // last one standing wins (in a teams match, the last side); a short wait lets a double knockout count as a
  // draw. A robot waiting to come back with a life left is still in; an angel is not (unless it comes back,
  // which calls the wait off).
  if (!world.over) {
    const still = world.players.filter(inRound);
    // (the ones left are all waiting to come back: let one come back first, so the winner is standing)
    const waitFor = still.length > 0 && !still.some((p) => p.alive);
    // everyone on one team: the round is over when nobody is left, or once the last falling block has landed
    const ended = world.coop
      ? !still.length || (world.roundTicks > 0 && world.shrinkNext >= world.shrinkOrder.length && !world.falling.length && !waitFor)
      : oneSide(still) && world.players.length > 1 && !waitFor;
    if (ended) {
      if (world.overCountdown < 0) world.overCountdown = 45;
      else if (--world.overCountdown === 0) {
        world.over = decided(world, still);
      }
    } else world.overCountdown = -1;
  }
}
