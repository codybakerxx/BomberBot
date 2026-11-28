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
/** The way back, for each direction (none stays none). */
export const BACK: Dir[] = [0, 2, 1, 4, 3];

/**
 * What a tile can be: open floor, a solid block (never breaks), a brick (a blast breaks it), or a barrel of TNT
 * (Wild West: a blast that reaches it sets it off, `tntBlast`).
 */
export const FLOOR = 0;
export const HARD = 1;
export const SOFT = 2;
export const TNT = 3;

/**
 * Power-ups: one more bomb at a time, a longer blast, faster walking,
 * the boot (kick bombs), the glove (lift and throw bombs), the shield, the
 * curse, the laptop (B flies a plane that drops bombs: see `launch`), the decoy (two copies of the robot
 * that walk when it walks: `makeDecoys`) and the trip wire (B strings it across a gap between two solid blocks;
 * a robot walking into it sets off a blast the length of the lane: `tripWire`).
 */
export type ItemKind = 'bomb' | 'fire' | 'speed' | 'kick' | 'grab' | 'shield' | 'curse' | 'laptop' | 'decoy' | 'wire' | 'torch';

/**
 * What one player is asking for on one tick. Buttons are sent as "held or
 * not"; the rules notice the moment a button goes down.
 */
export interface PlayerInput {
  dir: Dir;
  /** A button: drop a bomb (flying a plane: drop one of its bombs) */
  a: boolean;
  /**
   * B button: lift a bomb, or throw the one being carried (needs the glove); holding a trip wire, between two solid
   * blocks, string it there; holding a laptop, fly the plane; flying, bring it home
   */
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
  /** ticks of flashlight left (Blackout): while above 0 it lights the arena round it, TORCH_REACH tiles */
  torchTicks: number;
  /** ticks left, after a throw, before the glove can lift or throw again (THROW_GAP_TICKS) */
  throwWait: number;
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
  /**
   * On ice (World.ice): the speed it is still sliding at, tiles a tick, along `slipDir`. While it walks this is
   * how far it went on the last tick; once it lets go, or turns back the way it came, it slides on at this speed,
   * losing ICE_GRIP of it each tick (`glide`). 0 when it has stopped, and always 0 off the ice.
   */
  slip: number;
  slipDir: Dir;
  /** it slid on the last tick (no feet moving: it is drawn standing, leaning, kicking up frost) */
  skid: boolean;
  /**
   * The Factory's belts (World.belts): which way the last belt to carry it ran, 1 along a row, 2 down a column,
   * 0 none yet. Standing still in the middle of a crossing, it rides on the same way (`beltDir`).
   */
  ride?: number;
  /** trip wires held (the trip wire power-up, up to MAX_WIRES): B strings one across a gap between two solid blocks (`wireSpot`) */
  wires: number;
}

/**
 * A decoy (the decoy power-up; the owner's design, 26 November 2026): a copy of a robot, drawn just like it, that
 * walks whenever it walks: one the way it is asked to go, the other (`mirror`) the opposite way. It is the
 * robot's own copy, so `id` is its owner's. It drops no bombs, picks nothing up and sets off no trip wire; any
 * blast, a falling block or the train pops it in a puff of smoke, and it vanishes by itself at `until`.
 */
export interface Decoy extends Player {
  mirror: boolean;
  /** the tick it appeared */
  born: number;
  /** the tick it vanishes, if nothing has popped it before */
  until: number;
  /** the tick it went up in a puff of smoke; -1 while it is up. It is drawn as the puff for POOF_TICKS, then gone */
  popped: number;
}

/**
 * A trip wire (the trip wire power-up; the owner's design, 26 November 2026), strung across tile (cx, cy) from one
 * solid block to the one opposite: `dir` 'h' from the block on its left to the one on its right (the way through,
 * its lane, runs up and down), 'v' from the block above to the one below (the lane runs across). Any robot
 * walking into it, the one who strung it too, sets it off (`tripWire`): a blast the whole length of its lane.
 */
export interface Wire {
  cx: number;
  cy: number;
  dir: 'h' | 'v';
  /** who strung it: the blast is theirs */
  owner: number;
  /** false until its tile is clear of robots (the one who strung it, standing on it, walks off first) */
  armed: boolean;
  /** the tick it was strung */
  at: number;
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
  /** direction it is sliding after a kick (or, on ice, after landing from a throw), 0 if still */
  slide: Dir;
  /** how fast it slides, tiles a tick: KICK_SPEED, except on ice, where it slows down (ICE_FRICTION) and bounces (`slideBomb`) */
  speed: number;
  /** id of the player carrying it, or -1 */
  heldBy: number;
  /** true once it has been picked up, so the carry timer is only set once */
  lifted: boolean;
  /** the Factory's belts: which way the last belt to carry it ran (as Player.ride) */
  ride?: number;
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
  /** part of a barrel of TNT's blast: it burns with plain orange fire, whoever set it off */
  tnt?: boolean;
  /** part of a trip wire's blast (`tripWire`) */
  wire?: boolean;
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
  /** on ice, a sliding bomb bounced back off what stopped it */
  | { type: 'bounce' }
  /** a bomb went off on this tile */
  | { type: 'explode'; cx: number; cy: number }
  | { type: 'pickup'; player: number; kind: ItemKind }
  /** a shield took a blast for this player and is used up */
  | { type: 'shield'; player: number }
  /** a falling block has landed on this tile, which is now a solid block */
  | { type: 'block'; cx: number; cy: number }
  /**
   * `cause` says what knocked the player out: a blast, a falling block, the train, or a barrel of TNT.
   * `by` is the player whose bomb made the blast (or set the TNT off), or -1 for a block or the train.
   */
  | { type: 'death'; player: number; cause: KnockCause; by: number; out: boolean }
  /** a barrel of TNT went off on this tile */
  | { type: 'tnt'; cx: number; cy: number }
  /** the crossing bell on this line rings (twice a second while its lights flash) */
  | { type: 'bell'; line: number }
  /** a train is about to come out of its tunnel on this line: its whistle */
  | { type: 'train'; line: number }
  /** the Factory's belts are about to turn round: the alarm (twice a second while the beacons flash) */
  | { type: 'alarm' }
  /** the Factory's belts have turned round */
  | { type: 'reverse' }
  /** Blackout: the flash of light (every FLASH_EVERY ticks) */
  | { type: 'flash' }
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
  | { type: 'home'; player: number }
  /** this player picked up a decoy: its two copies have appeared */
  | { type: 'decoy'; player: number }
  /** one of this player's decoys went up in a puff of smoke at (x, y) (a blast, a block or the train, or its time was up) */
  | { type: 'poof'; player: number; x: number; y: number }
  /** this player strung a trip wire on tile (cx, cy) */
  | { type: 'wire'; player: number; cx: number; cy: number }
  /** `player` walked into `owner`'s trip wire on tile (cx, cy): its blast runs the length of the lane */
  | { type: 'trip'; player: number; owner: number; cx: number; cy: number };

/** What can knock a robot out. */
export type KnockCause = 'blast' | 'block' | 'train' | 'tnt' | 'wire';

/** One line of the railway (Wild West): along row `at` ('h') or down column `at` ('v'), from tunnel to tunnel. */
export interface Rail {
  dir: 'h' | 'v';
  at: number;
}

/**
 * One conveyor belt (the Factory): along row `at` ('h') or down column `at` ('v'), from the outer wall to the
 * outer wall. `way` 1 carries towards higher x or y, -1 lower, at the start of the round (World.beltWay turns
 * them all round).
 */
export interface Belt {
  dir: 'h' | 'v';
  at: number;
  way: 1 | -1;
}

/**
 * A train (the owner's design, 25 November 2026): on line `line` of `world.rails`, going towards higher x or y
 * (`dir` 1) or lower (-1). From `warnAt` the crossing lights at both ends of the line flash, the bell rings and
 * the gates come down; at `enterAt` the engine comes out of its tunnel; at `exitAt` the last car has gone into
 * the far one, and GATE_TICKS later the gates are up again. Anything it touches on the way is knocked out.
 */
export interface Train {
  line: number;
  dir: 1 | -1;
  warnAt: number;
  enterAt: number;
  exitAt: number;
}

/** A barrel of TNT a blast has reached: it goes off when `t` runs out. Its blast is `owner`'s, who set it off. */
export interface LitTnt {
  cx: number;
  cy: number;
  t: number;
  owner: number;
}

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
  /** Item Drop: a robot knocked out drops the power-ups it collected round where it fell (`dropKit`) */
  itemDrop: boolean;
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
  /** the railway (Wild West: `railLines`); empty on other maps */
  rails: Rail[];
  /** the train coming or going, or the next one (it shows nothing until its `warnAt`); null when no more will come */
  train: Train | null;
  /** where the trains' own random numbers have got to (which line, which way, how long until the next) */
  trainSeed: number;
  /** barrels of TNT that a blast has reached, about to go off */
  tntLit: LitTnt[];
  /**
   * The floor is ice (the Frozen Lake map; the owner's design, 25 November 2026): robots slide when
   * they let go or turn back, further the faster they go (`glide`), and bombs slide on after landing from a throw, slow down, and bounce back
   * off what stops them if they hit it fast enough (`slideBomb`).
   */
  ice: boolean;
  /**
   * The Factory's conveyor belts (the owner's design, 26 November 2026; `beltLines`); empty on other maps. They
   * carry the robots and bombs on them along (`beltCarry`, `beltBomb`), and now and then turn round.
   */
  belts: Belt[];
  /** 1 while the belts run the way they started, -1 once turned round (and so on) */
  beltWay: 1 | -1;
  /** the tick they next turn round: the alarm starts BELT_WARN_TICKS before; 0 once they no longer will */
  beltFlip: number;
  /** where the belts' own random numbers have got to (how long until the next turn) */
  beltSeed: number;
  /** how far the belts have run since the round began, in tiles (the way they started counts up): for drawing them */
  beltRun: number;
  /** the decoys out (and those just popped, for their puff of smoke) */
  decoys: Decoy[];
  /** the trip wires strung */
  wires: Wire[];
  /**
   * Pitch black (the Blackout map; the owner's design, 27 November 2026): nothing is seen but what is lit, by the
   * flash that comes every FLASH_EVERY ticks (`flashLight`), a flashlight (`torchTicks`) and bombs and blasts
   * (`lights`). The rules play as anywhere else; what is lit decides what is drawn and what the CPU players see.
   */
  dark: boolean;
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
  /** share of open tiles that start as bricks, 0 to 1. Default SOFT_DENSITY. */
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
   * out never appears). The lobby's Power-ups and Custom power-ups (`itemMix`). A kind set to 0 never appears,
   * and the kick, grab and laptop power-ups are only made sure of when their chance is above 0. The chances
   * must add up to 1 or less.
   */
  itemChance?: [ItemKind, number][];
  /**
   * The kinds every arena gets at least one of, when their chance is above 0 (default SURE_KINDS: the boot, the
   * glove, the laptop, the decoy and the trip wire). The lobby leaves out one set to Rare in a custom mix, so Rare is rare (the owner's ask,
   * 23 November 2026: the glove very rare in Hardcore).
   */
  sure?: ItemKind[];
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
  /** Item Drop (World.itemDrop): a robot knocked out drops what it collected. Default false. */
  itemDrop?: boolean;
  /**
   * A teams match: the side of each player, in the order of `players` (0, 1...). The last side with a robot in
   * the round wins it. Everyone on one side: they play together (World.coop). Left out, every robot plays for
   * itself.
   */
  teams?: number[];
  /** In a teams match, can a teammate's blast knock you out? Default true. Your own blast always can. */
  friendlyFire?: boolean;
  /** The railway and its trains (the Wild West map: setup.ts sets it). Default false. */
  rails?: boolean;
  /** Barrels of TNT in place of some bricks (TNT_SHARE; the Wild West map). Default false. */
  tnt?: boolean;
  /** The floor is ice (World.ice; the Frozen Lake map). Default false. */
  ice?: boolean;
  /** Conveyor belts (World.belts; the Factory map). Default false. */
  belts?: boolean;
  /** Pitch black (World.dark; the Blackout map), with the flashlight power-up. Default false. */
  dark?: boolean;
}

// ---------------------------------------------------------------- constants
// Times are in ticks (60 a second), distances in tiles.

export const FUSE_TICKS = 155; // a dropped bomb goes off after 2.58 s (the owner's ask, 27 November 2026: 2.58 s, the nearest whole tick; it was 153, 2.55 s, and 150, 2.5 s, before that)
export const FLAME_TICKS = 27; // a blast stays for 0.45 s (was 30: shortened a little in play-testing)
export const CHAIN_TICKS = 5; // a bomb caught in a blast goes off this soon after
export const BASE_SPEED = 0.04250390625; // starting walking speed, tiles per tick (2.55 tiles a second)
export const SPEED_STEP = 0.5 / TICK_HZ; // added by each speed power-up: 0.5 tiles a second (0.008333 a tick). Nothing else changes a robot's speed.
export const MAX_SPEED_ITEMS = 6; // so six of them bring it to 0.0925 tiles a tick (5.55 tiles a second)
export const MAX_BOMBS = 8;

/**
 * What the bricks hide. `ITEM_SHARE` of them hide a power-up (a brick hides at most one): 60%, the lobby's
 * **Power-ups** setting (the owner's ask, 19 November 2026; every chance had been raised by a quarter to make
 * it 60% in November 2026, it was 48%, and the laptop added 1.25% on top until this setting came). Which one
 * is drawn by `ITEM_WEIGHT`, so each kind keeps its share of the power-ups however many there are. The order
 * matters only for which random numbers give which power-up; keep new ones at the end so arenas made from old
 * seeds keep their first kinds in place. What these come to per arena is measured in docs/GAME-RULES.md.
 */
export const ITEM_SHARE = 0.6;
/** share of the open floor that starts as bricks (the lobby's Brick density, in steps of 5%; it was 0.78 until 19 November 2026) */
export const SOFT_DENSITY = 0.8;
export const ITEM_WEIGHT: [ItemKind, number][] = [
  ['bomb', 60], // 30.6% of the power-ups
  ['fire', 60],
  ['speed', 44], // 22.4%
  ['kick', 10], // rare (5.1%). Every arena still gets at least one: see createWorld
  ['grab', 10], // likewise
  ['shield', 4], // very rare (2%): in about six arenas in ten
  ['curse', 4], // very rare: in about six arenas in ten
  ['laptop', 4], // very rare, but every arena gets at least one (the owner's ask, 18 November 2026): see createWorld
  ['decoy', 4], // very rare, but every arena gets at least one (added 26 November 2026, the owner's design)
  ['wire', 4], // likewise
];
/** The chance under each brick of each kind, for a mix of weights and the share of bricks that hide one. */
export function itemMix(weights: [ItemKind, number][], share: number): [ItemKind, number][] {
  const sum = weights.reduce((n, [, w]) => n + Math.max(0, w), 0);
  const of = Math.max(0, Math.min(1, share));
  return weights.map(([k, w]) => [k, sum > 0 ? (Math.max(0, w) / sum) * of : 0]);
}
/** The usual chance under each brick of each power-up (bomb and flame 17.6%, speed 12.9%, boot and glove 2.9%, shield, curse, laptop, decoy and trip wire 1.2%) */
export const ITEM_CHANCE: [ItemKind, number][] = itemMix(ITEM_WEIGHT, ITEM_SHARE);
export const SHIELD_TICKS = 30 * TICK_HZ; // a shield that is not used wears off after 30 s
export const SHIELD_GRACE_TICKS = 30; // after a shield takes a blast, blasts do no harm for 0.5 s: long enough for that blast to clear
export const CURSE_TICKS = 8 * TICK_HZ; // a curse lasts 8 s
export const CURSE_SPEED = 0.85; // while cursed a robot walks at 85% of the starting speed, whatever speed power-ups it has
export const ROUND_TICKS = 90 * TICK_HZ; // the timer counts down 1 minute 30 unless told otherwise; then the blocks start to fall (it was 2 minutes)
export const SHRINK_TICKS = 50 * TICK_HZ; // once the timer reaches 0 the blocks take 50 seconds to fall (a minute at first; made 20% faster)
export const FALL_TICKS = 32; // a falling block is in the air, over its shadow, for 0.53 s before it lands (0.75 s at first; made 20% faster to 0.63 s, then 20% faster again, 23 November 2026)
export const START_FIRE = 1; // a blast reaches one tile each way until a flame power-up is picked up (it was 2)

// ---- Blackout (the owner's design, 27 November 2026; his picks asked: 15 s and 3 tiles; the flash every 8 s for half a
// second at first, then every 5 s for 0.7 s, his ask the same afternoon, then every 3 s for 0.8 s, his ask, 28 November 2026)
/** the flash comes every 3 s... */
export const FLASH_EVERY = 3 * TICK_HZ;
/** ...and lights the whole arena for 0.8 s (rising in FLASH_RISE ticks, fading over FLASH_FADE at its end) */
export const FLASH_TICKS = 48;
export const FLASH_RISE = 3;
export const FLASH_FADE = 12;
/** at the start of a round the lights are on, and go out over the last LIGHTS_FADE of these ticks */
export const LIGHTS_OUT = 90;
export const LIGHTS_FADE = 45;
/** a flashlight lasts 15 s and lights 3 tiles round its robot */
export const TORCH_TICKS = 15 * TICK_HZ;
export const TORCH_REACH = 3;
/** the chance a brick hides a flashlight (Blackout only, on top of the usual mix), and how many every arena is sure of */
export const TORCH_CHANCE = 0.04;
export const TORCH_SURE = 2;
/** how far round them a bomb (its burning fuse) and a blast light the dark, in tiles */
export const BOMB_GLOW = 1.2;
export const FLAME_GLOW = 1.6;
/** a flashlight lying on the floor glows a little, so it can be found */
export const TORCH_ITEM_GLOW = 0.7;

/** The usual mix with flashlights added for Blackout: on top of the others, as far as there is room under 1. */
export function withTorches(chances: [ItemKind, number][]): [ItemKind, number][] {
  const total = chances.reduce((n, [, c]) => n + c, 0);
  if (total <= 0) return chances; // (Power-up density 0%: nothing at all)
  return [...chances.filter(([k]) => k !== 'torch'), ['torch', Math.max(0, Math.min(TORCH_CHANCE, 1 - total))]];
}

/**
 * How much of the whole arena the light shows on Blackout, 0 (pitch black) to 1: on at the start and going out,
 * the flash every FLASH_EVERY ticks, and on again once the round is decided. Sums only, from the tick, so
 * every copy of an online round and the CPU players agree. 1 on every other map.
 */
export function flashLight(world: World): number {
  if (!world.dark) return 1;
  if (world.over) return 1;
  const t = world.tick;
  if (t < LIGHTS_OUT) return t < LIGHTS_OUT - LIGHTS_FADE ? 1 : (LIGHTS_OUT - t) / LIGHTS_FADE;
  const k = t % FLASH_EVERY;
  if (k >= FLASH_TICKS || t < FLASH_EVERY) return 0;
  if (k < FLASH_RISE) return (k + 1) / FLASH_RISE;
  if (k >= FLASH_TICKS - FLASH_FADE) return (FLASH_TICKS - k) / FLASH_FADE;
  return 1;
}

/** One light in the dark: centred on (x, y) in tiles, lighting `r` tiles round it. */
export interface Light {
  x: number;
  y: number;
  r: number;
}
/** What lights the dark on Blackout besides the flash: flashlights, bombs and their fuses, blasts, and flashlights on the floor. */
export function lights(world: World): Light[] {
  const out: Light[] = [];
  for (const p of world.players) if (p.alive && p.torchTicks > 0) out.push({ x: p.x, y: p.y, r: TORCH_REACH });
  for (const b of world.bombs) out.push({ x: b.x, y: b.y, r: BOMB_GLOW });
  for (const f of world.flames) out.push({ x: f.cx, y: f.cy, r: FLAME_GLOW });
  for (const it of world.items) if (it.kind === 'torch') out.push({ x: it.cx, y: it.cy, r: TORCH_ITEM_GLOW });
  return out;
}
/** Is (x, y) lit on Blackout (always, elsewhere)? Within a light's reach, or in a flash. */
export function isLit(world: World, x: number, y: number, ls: Light[] = lights(world)): boolean {
  if (flashLight(world) > 0.5) return true;
  for (const l of ls) {
    const dx = x - l.x;
    const dy = y - l.y;
    if (dx * dx + dy * dy <= l.r * l.r) return true;
  }
  return false;
}
export const MAX_FIRE = 8;
/**
 * The falling blocks leave a rectangle open in the middle of the arena, for whoever is left to fight it out in:
 * at least this many tiles across and down (7 by 5: the owner's ask, 18 November 2026; it was a 5 by 5 square).
 * Its edges always run along an open row or column, never through the pillars, so what is left is a clean
 * rectangle with the pillars inside it (the owner's ask, 20 November 2026): 7 by 5 where that already holds
 * (Mini, Big), 9 by 7 where it does not (Standard, and Big grown for seven or eight players). See `keptSize`.
 */
export const KEEP_OPEN_W = 7;
export const KEEP_OPEN_H = 5;
export const DEATH_TICKS = 90; // length of the knocked-out animation (1.5 s)
export const GHOST_TICKS = 300; // `deadTicks` goes on counting this far (5 s), so the ghost can be drawn floating all the way off the top of the screen
export const CARRY_FUSE_TICKS = 180; // 3 s from the first pick-up, and it keeps ticking
export const KICK_SPEED = 0.14; // a kicked bomb slides at 8.4 tiles a second

// ice (the Frozen Lake map, World.ice; the owner's design, 25 November 2026: robots slide after they let go or
// turn back, further the faster they go; thrown bombs land and slide on; a sliding bomb that hits something fast
// bounces back). The numbers are Claude's, to be play-tested.
/**
 * A robot that lets go, or turns back the way it came, slides on, losing this much speed every tick (tiles a
 * tick, each tick) until it stops. Losing the same each tick, how far it slides grows with the square of its
 * speed, so every speed power-up makes it slide noticeably further: about a third of a tile at the starting
 * speed (0.3 s before it can walk back), and 1.7 tiles at top speed (0.65 s). (The owner's ask, 26 November
 * 2026: more slippery, and more so with every speed power-up. It kept 0.84 of its speed a tick at first, ICE_DRAG,
 * which was a fifth of a tile at the starting speed and under half a tile at top speed.)
 */
export const ICE_GRIP = 0.0024;
/** a thrown bomb lands on ice sliding at this speed, tiles a tick (half its speed in the air): about four tiles on (it was 0.065, two tiles) */
export const ICE_LAND_SPEED = 0.075;
/** a bomb sliding on ice loses this much speed every tick: a kick goes about thirteen tiles before it crawls (it was 0.001, nine tiles) */
export const ICE_FRICTION = 0.0007;
/** slowed to this, tiles a tick, a sliding bomb carries on to the middle of the next tile and stops there */
export const ICE_CRAWL = 0.025;
/** a bomb that bounces goes back at this share of the speed it hit at */
export const ICE_BOUNCE = 0.5;
/** it bounces only when it hits at this speed or faster: fast enough to go back at least a tile (ICE_CRAWL) */
export const ICE_BOUNCE_MIN = ICE_CRAWL / ICE_BOUNCE;
export const THROW_TILES = 3; // a thrown bomb lands this many tiles away
export const THROW_GAP_TICKS = 15; // after a throw, 0.25 s before the glove can lift or throw again (the owner's ask, 28 November 2026: a very slight pause between throws)
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
// (19 November 2026, the owner, to make it easier to control: slower, turning less, and twice as long a flight.
// It was 4.8 tiles a second, 169° a second and 8 s.) (23 November 2026, the owner: one bomb, 6 s, always taking
// off towards the middle, and turns 10% tighter: it was 3 bombs, 16 s, off the way the robot faced, 84° a second.)
// (24 November 2026, the owner: tighter again and slightly faster: it was 3 tiles a second and 93.75° a second.)
export const PLANE_TICKS = 6 * TICK_HZ; // a flight lasts up to 6 s
export const PLANE_SPEED = 0.055; // tiles a tick (3.3 tiles a second, 10% quicker than the 3 before)
export const TURN_STEPS = 9216; // the plane's heading is kept in 9216ths of a turn (1024 × 9, so a tenth tighter is a whole number) ...
export const PLANE_TURN = 52; // ... and turns at most this many a tick (121.9° a second, a full circle in about 3 s; its circle about 15% tighter than at 93.75° and 3 tiles a second, though faster): it sweeps round, never on the spot
export const AIM_STEPS = 64; // the way it is steered (PlayerInput.aim) comes in 64ths of a turn
export const PLANE_BOMBS = 1; // bombs a plane can drop (it was 3)
export const PLANE_FIRST_GAP = 30; // none in its first half second, so the first cannot land on the robot it took off from
export const PLANE_DROP_GAP = 20; // and at least a third of a second between two
export const PLANE_AFTER = 30; // once its last bomb is away it flies on half a second, then home
export const DROP_TICKS = 48; // a dropped bomb falls for 0.8 s: long enough to see it coming and get out of the way
export const DROP_DRAG = 0.95; // keeping 95% of its speed each tick: it lands about a tile (0.9) on from where it was let go
export const DROP_FIRE = 1; // its blast reaches one tile each way

// the railway (Wild West; the owner's design, 25 November 2026): four lines across the arena, two along rows and
// two down columns (`railLines`), each from a tunnel in the outer wall to one in the opposite wall. Now and then
// a train runs along one of them, picked at random, with a warning first: the crossing lights flash, a bell
// rings and the gates come down. It knocks out any robot it touches. None comes once the blocks start to fall.
export const TRAIN_SPEED = 0.15625; // tiles a tick: 9.4 tiles a second (a robot's fastest is 5.55)
export const TRAIN_CARS = [2, 1.0625, 1.625, 1.625]; // its cars' lengths in tiles, front first: the engine, its tender, two coaches
export const TRAIN_COUPLING = 0.125; // the gap between two cars
export const TRAIN_LENGTH = TRAIN_CARS.reduce((n, c) => n + c, 0) + TRAIN_COUPLING * (TRAIN_CARS.length - 1); // 6.69 tiles
export const TRAIN_WARN_TICKS = 150; // the lights, the bell and the gates start 2.5 s before the engine comes out of its tunnel
export const TRAIN_WHISTLE_TICKS = 45; // and it whistles 0.75 s before
export const TRAIN_FIRST = [6 * TICK_HZ, 10 * TICK_HZ]; // the first warning comes 6 to 10 s into the round
export const TRAIN_GAP = [8 * TICK_HZ, 12 * TICK_HZ]; // and the next 8 to 12 s after the one before (about every 10 s, the owner's ask of 25 November 2026 evening: it was 12 to 18, about every 15)
export const TRAIN_NOSE = 0.3; // a robot counting as on the line's tile is hit once the train is within this of it along the line
export const GATE_TICKS = 30; // the gates take half a second to come down, and go up again this long after the train has gone
export const BELL_TICKS = 30; // the bell rings twice a second while the lights flash

// TNT (Wild West; the owner's design, 25 November 2026): red barrels in place of some bricks. A blast that reaches
// one sets it off: its own blast runs every way until a wall, a block or a brick stops it (it does not break
// bricks), sets off the bombs and TNT it reaches, and burns with ordinary orange fire. It counts as the blast of
// whoever set it off.
export const TNT_SHARE = 0.1; // one brick in ten is a barrel of TNT (taken from bricks that hide no power-up where it can)
export const TNT_FUSE_TICKS = 8; // a barrel goes off this soon after a blast reaches it (0.13 s)

// the Factory's conveyor belts (the owner's design, 26 November 2026): two along rows and two down columns, on the
// same lines as the Wild West's railway (`beltLines`), crossing at four points. They carry robots and bombs (not
// power-ups) along; walking against one is slow, with it fast. Now and then, after an alarm, they all turn round.
export const BELT_SPEED = 0.021875; // tiles a tick: 1.31 tiles a second (a robot starts at 2.55), so against one at the start is about half speed
export const BELT_FIRST = [15 * TICK_HZ, 20 * TICK_HZ]; // they first turn round 15 to 20 s into the round
export const BELT_GAP = [15 * TICK_HZ, 20 * TICK_HZ]; // and again 15 to 20 s after that, and so on
export const BELT_WARN_TICKS = 120; // the beacons flash and the alarm sounds for 2 s before they turn
export const BELT_STOP_TICKS = 30; // in the last half second of it the belts stand still
export const BELT_ALARM_TICKS = 30; // the alarm buzzes twice a second

/**
 * The decoy (the owner's design, 26 November 2026): two copies of the robot that picks it up appear on the
 * nearest free tiles and walk whenever it does, one the same way, one the opposite way, until a blast, a falling
 * block or the train pops them, or their time is up. The trip wire: B strings it across a gap one tile wide
 * between two solid blocks; whoever walks into it, the one who strung it included, sets off a blast that runs
 * the length of the lane both ways, through bricks and all, to the walls. The numbers are Claude's.
 */
export const DECOY_TICKS = 15 * TICK_HZ; // the decoys vanish after 15 s (the owner's pick)
export const DECOY_COUNT = 2; // two of them (the owner's ask)
export const DECOY_REACH = 6; // they appear on the free tiles nearest the robot, at most this many steps away
export const POOF_TICKS = 24; // a decoy appearing or popped is a puff of smoke for 0.4 s
export const MAX_WIRES = 3; // trip wires a robot can hold at once (each power-up is one more)
export const WIRE_REACH = 0.3; // a robot on the wire's tile sets it off once it is this close to the string, which runs across the tile's middle

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
 * The railway's four lines in an arena `w` by `h` (outer wall included): along the third row from the top and
 * from the bottom, and down the third column from the left and from the right. They are open rows and columns
 * (no pillars on them), and no robot starts on one, on any size or number of players (tests/rail.test.ts).
 */
export function railLines(w: number, h: number): Rail[] {
  return [
    { dir: 'h', at: 3 },
    { dir: 'h', at: h - 4 },
    { dir: 'v', at: 3 },
    { dir: 'v', at: w - 4 },
  ];
}

/** Is (x, y) a tile of the railway, inside the outer wall? */
export function onRail(world: { w: number; h: number; rails: Rail[] }, x: number, y: number): boolean {
  if (x < 1 || y < 1 || x > world.w - 2 || y > world.h - 2) return false;
  for (const r of world.rails) if (r.dir === 'h' ? y === r.at : x === r.at) return true;
  return false;
}

/**
 * The Factory's four conveyor belts in an arena `w` by `h`: the railway's lines (`railLines`: the third row and
 * column from each edge, where no robot starts), running round the arena the way a clock's hands do at the start:
 * right along the top one, down the right one, left along the bottom one, up the left one. They cross at four
 * points.
 */
export function beltLines(w: number, h: number): Belt[] {
  return railLines(w, h).map((r, k): Belt => ({ dir: r.dir, at: r.at, way: k === 0 || k === 3 ? 1 : -1 }));
}

/**
 * Build a fresh arena: outer wall, a pillar on every second tile, bricks on
 * most of the rest with power-ups hidden under some, and each player's corner
 * left clear so nobody starts boxed in. On the Wild West map the railway is
 * left clear too, and some of the bricks are barrels of TNT.
 */
/** The kinds every arena gets at least one of, unless the round's config says otherwise (WorldConfig.sure). */
export const SURE_KINDS: readonly ItemKind[] = ['kick', 'grab', 'laptop', 'decoy', 'wire'];

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
  // the railway: bricks lie on it as anywhere else (the owner's ask, 25 November 2026: it was kept clear, and the
  // map had a third fewer bricks than Midnight); a train smashes those on its line (`runTrain`)
  const rails = cfg.rails ? railLines(w, h) : [];

  const hidden = new Map<number, ItemKind>();
  const chances = cfg.dark ? withTorches(cfg.itemChance ?? ITEM_CHANCE) : cfg.itemChance ?? ITEM_CHANCE;
  const density = cfg.softDensity ?? SOFT_DENSITY;
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
  // every arena has at least one kick, one grab, one laptop, one decoy and one trip wire power-up somewhere (unless
  // the lobby has switched them off; the laptop since 18 November 2026, the owner's ask; the decoy and the trip
  // wire since they came, 26 November 2026)
  // (on Blackout, at least TORCH_SURE flashlights: each 'torch' in the list is one more made sure of)
  const wanted = new Map<ItemKind, number>();
  for (const kind of cfg.dark ? [...(cfg.sure ?? SURE_KINDS), ...Array<ItemKind>(TORCH_SURE).fill('torch')] : cfg.sure ?? SURE_KINDS) {
    if (!chances.some(([k, c]) => k === kind && c > 0)) continue;
    const need = (wanted.get(kind) ?? 0) + 1;
    wanted.set(kind, need);
    if ([...hidden.values()].filter((k) => k === kind).length >= need) continue;
    const empty: number[] = [];
    for (let i = 0; i < tiles.length; i++) if (tiles[i] === SOFT && !hidden.has(i)) empty.push(i);
    if (empty.length) hidden.set(empty[Math.floor(rng() * empty.length)], kind);
  }
  // barrels of TNT in place of one brick in ten, picked at random from the bricks that hide nothing (and only
  // if there are not enough of those, from the others, whose power-up is then lost); never on the railway
  if (cfg.tnt) {
    const plain: number[] = [];
    const filled: number[] = [];
    let bricks = 0;
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i] !== SOFT) continue;
      bricks++;
      if (!onRail({ w, h, rails }, i % w, Math.floor(i / w))) (hidden.has(i) ? filled : plain).push(i);
    }
    const n = Math.min(plain.length + filled.length, Math.round(bricks * TNT_SHARE));
    for (let k = 0; k < n; k++) {
      const from = plain.length ? plain : filled;
      const i = from.splice(Math.floor(rng() * from.length), 1)[0];
      tiles[i] = TNT;
      hidden.delete(i);
    }
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
    torchTicks: 0,
    throwWait: 0,
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
    slip: 0,
    slipDir: 0,
    skid: false,
    wires: 0,
  }));

  const world: World = {
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
    itemDrop: !!cfg.itemDrop,
    spawns: spawns.map((p) => ({ ...p })),
    start: { bombs: startBombs, fire: startFire, speed: startSpeed },
    teams: teamsOn,
    coop: teamsOn && cfg.players.length > 1 && new Set(cfg.teams).size === 1,
    friendlyFire: cfg.friendlyFire ?? true,
    rails,
    train: null,
    trainSeed: (cfg.seed ^ 0x5bd1e995) >>> 0,
    tntLit: [],
    ice: !!cfg.ice,
    belts: cfg.belts ? beltLines(w, h) : [],
    beltWay: 1,
    beltFlip: 0,
    beltSeed: (cfg.seed ^ 0x27d4eb2f) >>> 0,
    beltRun: 0,
    decoys: [],
    wires: [],
    dark: !!cfg.dark,
  };
  if (world.belts.length) world.beltFlip = BELT_FIRST[0] + Math.floor(beltRand(world) * (BELT_FIRST[1] - BELT_FIRST[0] + 1));
  if (rails.length) world.train = trainFrom(world, TRAIN_FIRST[0] + Math.floor(trainRand(world) * (TRAIN_FIRST[1] - TRAIN_FIRST[0] + 1)));
  return world;
}

// ---------------------------------------------------------------- the Factory's conveyor belts

/** The belts' next random number, 0 to 1, from their own seed (world.beltSeed), so every copy of a round agrees. */
function beltRand(world: World): number {
  world.beltSeed = (world.beltSeed + 0x6d2b79f5) >>> 0;
  let t = world.beltSeed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Are the belts running on this tick? Not in the last half second before they turn round (BELT_STOP_TICKS), and
 * not once the round is decided.
 */
export function beltsRunning(world: World, t = world.tick): boolean {
  if (!world.belts.length || world.over) return false;
  return !(world.beltFlip > 0 && t >= world.beltFlip - BELT_STOP_TICKS && t < world.beltFlip);
}

/**
 * The way the belts under (cx, cy) run now, inside the outer wall: [along the row, down the column], each 1, -1,
 * or 0 where there is no belt that way. A crossing has both.
 */
export function beltsAt(world: World, cx: number, cy: number, way = world.beltWay): [number, number] {
  let h = 0;
  let v = 0;
  if (cx < 1 || cy < 1 || cx > world.w - 2 || cy > world.h - 2) return [0, 0];
  for (const b of world.belts) {
    if (b.dir === 'h' && b.at === cy) h = b.way * way;
    else if (b.dir === 'v' && b.at === cx) v = b.way * way;
  }
  return [h, v];
}

/**
 * Which way a belt carries something at (x, y) (a robot or a bomb), or 0 if none does. It is carried along the
 * lane it is in: between two tiles of a row, along the row's belt; between two of a column, down the column's.
 * In the middle of a tile with a belt each way (a crossing), along the one it is walking along (`heading`),
 * or, standing still, the one that last carried it (`ride`; along the row if none has). Walking across a belt,
 * it is not dragged sideways.
 */
export function beltDir(world: World, x: number, y: number, heading: Dir, ride: number, way = world.beltWay): Dir {
  const cx = Math.round(x);
  const cy = Math.round(y);
  if (tileAt(world, cx, cy) !== FLOOR) return 0;
  const [h, v] = beltsAt(world, cx, cy, way);
  if (!h && !v) return 0;
  let axis: number;
  if (Math.abs(y - cy) > 1e-6) axis = 2;
  else if (Math.abs(x - cx) > 1e-6) axis = 1;
  else if (h && v) axis = heading ? (DX[heading] ? 1 : 2) : ride === 2 ? 2 : 1;
  else axis = h ? 1 : 2;
  if (heading && (DX[heading] ? 1 : 2) !== axis) return 0;
  const runs = axis === 1 ? h : v;
  if (!runs) return 0;
  return axis === 1 ? (runs > 0 ? 4 : 3) : runs > 0 ? 2 : 1;
}

/**
 * The belts for one tick: the alarm while the beacons flash, then, on `beltFlip`, they all turn round and the next
 * turn is set 15 to 20 s on. `beltRun` counts how far they have run, for drawing them.
 */
function beltClock(world: World): void {
  if (!world.belts.length) return;
  if (world.over) {
    world.beltFlip = 0;
    return;
  }
  const t = world.tick;
  if (beltsRunning(world)) world.beltRun += BELT_SPEED * world.beltWay;
  if (!world.beltFlip) return;
  const warn = world.beltFlip - BELT_WARN_TICKS;
  if (t >= warn && t < world.beltFlip && (t - warn) % BELT_ALARM_TICKS === 0) world.events.push({ type: 'alarm' });
  if (t >= world.beltFlip) {
    world.beltWay = world.beltWay > 0 ? -1 : 1;
    world.events.push({ type: 'reverse' });
    world.beltFlip = t + BELT_GAP[0] + Math.floor(beltRand(world) * (BELT_GAP[1] - BELT_GAP[0] + 1));
  }
}

/**
 * A belt carries this robot along a tick's worth (BELT_SPEED), as its own walking would: a block, brick or bomb
 * ahead stops it in the middle of its tile. Walking with the belt it goes faster, against it slower; walking
 * across it, it is not dragged (`beltDir`), and lined up to step off it to the side, it is let go.
 */
function beltCarry(world: World, p: Player, still = false): void {
  if (!beltsRunning(world)) return;
  const d = beltDir(world, p.x, p.y, p.moving && !still ? p.heading : 0, p.ride ?? 0);
  if (!d) return;
  const horizontal = DX[d] !== 0;
  const s = horizontal ? DX[d] : DY[d];
  const pos = horizontal ? p.x : p.y;
  const t = Math.round(pos);
  // Stepping off the belt to the side: lined up with an opening it has asked to go through, it is not carried on
  // past it (else it could never leave: each tick it lines up with the opening, and the belt carries it off again)
  const ask = still ? 0 : p.askDir;
  if (ask && DX[ask] !== 0 !== horizontal && pos === t && !blocked(world, p, Math.round(p.x) + DX[ask], Math.round(p.y) + DY[ask])) return;
  let next = pos + s * BELT_SPEED;
  const ahead = horizontal ? blocked(world, p, t + s, Math.round(p.y)) : blocked(world, p, Math.round(p.x), t + s);
  if (ahead && (next - t) * s >= 0) next = (pos - t) * s >= 0 ? pos : t;
  if (horizontal) p.x = next;
  else p.y = next;
  p.ride = horizontal ? 1 : 2;
}

/**
 * A belt carries this bomb along a tick's worth (one on the floor, not sliding from a kick; the belts running:
 * `beltsRunning`). At the middle of each tile it looks at the tile ahead (`free`: no block, bomb or robot) and
 * waits there until it can go on. The CPU players' `foresee` follows it with this too (`way`: the way the belts
 * will run then).
 */
export function beltBomb(world: World, b: Bomb, free: (cx: number, cy: number) => boolean, way = world.beltWay): void {
  const d = beltDir(world, b.x, b.y, 0, b.ride ?? 0, way);
  if (!d) return;
  const dx = DX[d];
  const dy = DY[d];
  const horizontal = dx !== 0;
  const s = horizontal ? dx : dy;
  const pos = horizontal ? b.x : b.y;
  const centre = Math.round(pos);
  let next = pos + s * BELT_SPEED;
  if ((pos - centre) * s <= 0 && (next - centre) * s >= 0 && !free(b.cx + dx, b.cy + dy)) next = centre;
  if (horizontal) b.x = next;
  else b.y = next;
  b.cx = Math.round(b.x);
  b.cy = Math.round(b.y);
  b.ride = horizontal ? 1 : 2;
}

// ---------------------------------------------------------------- the railway

/** The trains' next random number, 0 to 1, from their own seed (world.trainSeed), so every copy of a round agrees. */
function trainRand(world: World): number {
  world.trainSeed = (world.trainSeed + 0x6d2b79f5) >>> 0;
  let t = world.trainSeed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** How long a line is from tunnel to tunnel, in tiles: the whole width or height inside the outer wall. */
export function railLength(world: World, line: number): number {
  return (world.rails[line].dir === 'h' ? world.w : world.h) - 2;
}

/**
 * A train whose warning starts at `warnAt`, on a line and going a way picked at random. None (null) if it would
 * not be gone, and its gates up, before the timer runs out: no train runs once the blocks start to fall.
 */
function trainFrom(world: World, warnAt: number): Train | null {
  const line = Math.floor(trainRand(world) * world.rails.length);
  const dir = trainRand(world) < 0.5 ? 1 : -1;
  const enterAt = warnAt + TRAIN_WARN_TICKS;
  const exitAt = enterAt + Math.ceil((railLength(world, line) + TRAIN_LENGTH) / TRAIN_SPEED);
  if (world.roundTicks > 0 && exitAt + GATE_TICKS >= world.roundTicks) return null;
  return { line, dir, warnAt, enterAt, exitAt };
}

/**
 * Where a train is along its line on tick `t`: [back, front] in tiles along the row or column (its back is
 * the lower number). Outside the arena (in a tunnel) before `enterAt` and after `exitAt`.
 */
export function trainSpan(world: World, tr: Train, t: number): [number, number] {
  const run = (t - tr.enterAt) * TRAIN_SPEED;
  if (tr.dir > 0) {
    const front = 0.5 + run; // (0.5: the edge of the outer wall, where the tunnel is)
    return [front - TRAIN_LENGTH, front];
  }
  const front = railLength(world, tr.line) + 0.5 - run;
  return [front, front + TRAIN_LENGTH];
}

/**
 * The railway for one tick: the bell while the lights flash, the whistle, and the train itself. It knocks out
 * every robot it touches: one that counts as standing on a tile of its line (the tile it is drawn ringed on, as
 * for a blast) once the train's front or back is within TRAIN_NOSE of it. Shield or not, like a falling block;
 * not the winner once the round is decided. It sets
 * off the bombs on the line as it reaches them and smashes the bricks on it. Once its gates are up the next
 * train is set, 8 to 12 s after this one's warning. Once the round is decided a train still in its tunnel
 * stays there, and none comes after it.
 */
function runTrain(world: World): void {
  const tr = world.train;
  if (!tr) return;
  const t = world.tick;
  if (world.over && t < tr.enterAt) {
    world.train = null;
    return;
  }
  if (t > tr.exitAt + GATE_TICKS) {
    const gap = TRAIN_GAP[0] + Math.floor(trainRand(world) * (TRAIN_GAP[1] - TRAIN_GAP[0] + 1));
    world.train = world.over ? null : trainFrom(world, Math.max(tr.warnAt + gap, t + 1));
    return;
  }
  if (t >= tr.warnAt && t <= tr.exitAt && (t - tr.warnAt) % BELL_TICKS === 0) world.events.push({ type: 'bell', line: tr.line });
  if (t === tr.enterAt - TRAIN_WHISTLE_TICKS) world.events.push({ type: 'train', line: tr.line });
  if (t < tr.enterAt || t > tr.exitAt) return;
  const r = world.rails[tr.line];
  const [back, front] = trainSpan(world, tr, t);
  for (const p of world.players) {
    if (!p.alive || wonRound(world, p)) continue;
    const along = r.dir === 'h' ? p.x : p.y;
    const on = Math.round(r.dir === 'h' ? p.y : p.x) === r.at;
    if (on && along > back - TRAIN_NOSE && along < front + TRAIN_NOSE) knockOut(world, p, 'train', -1);
  }
  for (const d of world.decoys) {
    if (d.popped >= 0) continue;
    const along = r.dir === 'h' ? d.x : d.y;
    if (Math.round(r.dir === 'h' ? d.y : d.x) === r.at && along > back - TRAIN_NOSE && along < front + TRAIN_NOSE) popDecoy(world, d);
  }
  const hit = (cx: number, cy: number): boolean => {
    const along = r.dir === 'h' ? cx : cy;
    return (r.dir === 'h' ? cy : cx) === r.at && along > back - 0.5 && along < front + 0.5;
  };
  for (const b of world.bombs) if (b.state === 'ground' && hit(b.cx, b.cy)) b.fuse = Math.min(b.fuse, 1);
  // a trip wire across its line is torn away (it does not go off: nobody walked into it)
  if (world.wires.length) world.wires = world.wires.filter((o) => !hit(o.cx, o.cy));
  // bricks on its line are smashed as it reaches them: they crumble as a burnt one does, and the power-up one
  // hid is left on the line (the train runs over power-ups and leaves them be)
  const len = railLength(world, tr.line);
  const from = Math.max(1, Math.ceil(back - 0.5));
  const to = Math.min(len, Math.floor(front + 0.5));
  for (let k = from; k <= to; k++) {
    const cx = r.dir === 'h' ? k : r.at;
    const cy = r.dir === 'h' ? r.at : k;
    if (tileAt(world, cx, cy) === SOFT && !world.burning.some((b) => b.cx === cx && b.cy === cy) && hit(cx, cy)) {
      world.burning.push({ cx, cy, ttl: FLAME_TICKS });
    }
  }
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

/**
 * How many tiles across and down the falling blocks leave open in the middle of an arena `w` by `h` (outer wall
 * included): the smallest at least KEEP_OPEN_W by KEEP_OPEN_H whose edges are open rows and columns (odd ones;
 * the pillars stand on even ones), so the end is always a clean rectangle. Arenas are always two wider than high,
 * so it is 7 by 5 or 9 by 7.
 */
export function keptSize(w: number, h: number): [number, number] {
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  return [cx % 2 === 0 ? KEEP_OPEN_W : KEEP_OPEN_W + 2, cy % 2 === 1 ? KEEP_OPEN_H : KEEP_OPEN_H + 2];
}

/** Is this tile in the rectangle in the middle of the arena that the falling blocks leave open (`keptSize`)? */
export function keptOpen(w: number, h: number, i: number): boolean {
  const x = i % w;
  const y = Math.floor(i / w);
  const [kw, kh] = keptSize(w, h);
  return Math.abs(x - (w - 1) / 2) <= (kw - 1) / 2 && Math.abs(y - (h - 1) / 2) <= (kh - 1) / 2;
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
    world.tntLit = world.tntLit.filter((b) => b.cx !== cx || b.cy !== cy); // (a barrel under it is crushed, and does not go off)
    world.wires = world.wires.filter((o) => o.cx !== cx || o.cy !== cy); // (and a trip wire, without going off)
    for (const d of world.decoys) {
      if (d.popped >= 0) continue;
      const dx = Math.round(d.x);
      const dy = Math.round(d.y);
      if (dx === cx && dy === cy) popDecoy(world, d);
      else if (Math.abs(d.x - cx) < 1 && Math.abs(d.y - cy) < 1) {
        if (dx !== cx) d.x = dx;
        if (dy !== cy) d.y = dy;
      }
    }
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
    train: w.train ? { ...w.train } : null,
    tntLit: w.tntLit.map((t) => ({ ...t })),
    decoys: w.decoys.map((d) => ({ ...d })),
    wires: w.wires.map((o) => ({ ...o })),
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
          b.speed = KICK_SPEED;
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

/**
 * On ice (World.ice): with no direction held, or the way back held, the robot slides on the way it was going,
 * losing ICE_GRIP of its speed each tick (`slip`), until it stops. A block, brick or bomb ahead stops it in the
 * middle of its tile, as walking would. It slides along the lane it is on, so it is always in line with its
 * tiles, from tile to tile if it is going fast enough. Returns whether it moved.
 */
function glide(world: World, p: Player): boolean {
  p.slip -= ICE_GRIP;
  if (p.slip <= 0) {
    p.slip = 0;
    p.moving = false;
    return false;
  }
  const d = p.slipDir;
  const horizontal = DX[d] !== 0;
  const s = horizontal ? DX[d] : DY[d];
  const pos = horizontal ? p.x : p.y;
  const t = Math.round(pos);
  let next = pos + s * p.slip;
  const ahead = horizontal ? blocked(world, p, t + s, Math.round(p.y)) : blocked(world, p, Math.round(p.x), t + s);
  if (ahead && (next - t) * s >= 0) {
    // no further than the middle of its own tile (and if it was past it already, it stays where it is)
    next = (pos - t) * s >= 0 ? pos : t;
    p.slip = 0;
  }
  const moved = next !== pos;
  if (horizontal) p.x = next;
  else p.y = next;
  if (moved) {
    p.heading = d;
    if (horizontal) p.mvx = s;
    else p.mvy = s;
  }
  p.moving = moved;
  p.skid = moved;
  return moved;
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
    speed: 0,
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
 * B button. Carrying a bomb: throw it the way you are facing. Holding a trip wire,
 * on a tile between two solid blocks: string it there (`wireSpot`). Holding a
 * laptop: fly its plane (`launch`). Otherwise, with the glove: lift a bomb from your
 * own tile, else the tile you face, else any tile next to you. The first lift
 * of a bomb sets its fuse to 3 seconds.
 */
function useAction(world: World, p: Player): void {
  const cx = Math.round(p.x);
  const cy = Math.round(p.y);
  if (p.carrying) {
    if (p.throwWait > 0) return; // (a bomb lifted in the pause after a throw waits for it to end)
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
    p.throwWait = THROW_GAP_TICKS;
    world.events.push({ type: 'throw' });
    return;
  }
  // holding a trip wire, between two solid blocks: string it across (anywhere else B does what it always does)
  if (p.wires > 0) {
    const dir = wireSpot(world, cx, cy);
    if (dir) {
      world.wires.push({ cx, cy, dir, owner: p.id, armed: false, at: world.tick });
      p.wires--;
      world.events.push({ type: 'wire', player: p.id, cx, cy });
      return;
    }
  }
  // holding a laptop, B flies the plane: the glove waits until the laptop is used (the owner's design)
  if (p.laptop) {
    launch(world, p);
    return;
  }
  if (!p.canGrab || p.throwWait > 0) return; // (no lifting in the pause after a throw)
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
          if (world.ice) {
            // on ice it lands sliding on the way it was thrown
            b.slide = b.flyDir;
            b.speed = ICE_LAND_SPEED;
          }
        } else if (b.flyDist > THROW_TILES + world.w + world.h) {
          // nowhere to land at all: fizzle out
          world.bombs.splice(world.bombs.indexOf(b), 1);
          const o = world.players[b.owner];
          if (o) o.activeBombs = Math.max(0, o.activeBombs - 1);
        } else b.flyDist++; // bounce on to the next tile
      }
    } else if (b.slide) {
      if (slideBomb(b, world.ice, (cx, cy) => freeForBomb(world, cx, cy))) world.events.push({ type: 'bounce' });
    } else if (world.belts.length && beltsRunning(world)) beltBomb(world, b, (cx, cy) => freeForBomb(world, cx, cy));
  }
}

/**
 * One tick of a sliding bomb (moveBombs; the CPU players' `foresee` follows a slide with it too). At the middle
 * of each tile it looks at the tile ahead (`free`: no block, bomb or robot there) and stops if it cannot go on.
 * Off the ice it slides at KICK_SPEED until something stops it. On ice it loses ICE_FRICTION of its speed a tick;
 * slowed to ICE_CRAWL it stops in the middle of the tile it reaches next; and stopped by something while going
 * at ICE_BOUNCE_MIN or faster, it bounces back the way it came at ICE_BOUNCE of its speed, if the tile behind it
 * is free. Returns true on a bounce.
 */
export function slideBomb(b: Bomb, ice: boolean, free: (cx: number, cy: number) => boolean): boolean {
  const dx = DX[b.slide];
  const dy = DY[b.slide];
  const horizontal = dx !== 0;
  const stepDir = horizontal ? dx : dy;
  const pos = horizontal ? b.x : b.y;
  const centre = Math.round(pos);
  const speed = ice ? b.speed : KICK_SPEED;
  let next = pos + stepDir * speed;
  let bounced = false;
  // at each tile centre, look at the tile ahead before carrying on
  if ((pos - centre) * stepDir <= 0 && (next - centre) * stepDir >= 0) {
    if (!free(b.cx + dx, b.cy + dy)) {
      next = centre;
      if (ice && speed >= ICE_BOUNCE_MIN && free(b.cx - dx, b.cy - dy)) {
        b.slide = BACK[b.slide];
        b.speed = speed * ICE_BOUNCE;
        bounced = true;
      } else b.slide = 0;
    } else if (ice && speed <= ICE_CRAWL) {
      next = centre; // (slowed right down: it stops here)
      b.slide = 0;
    }
  }
  if (ice && b.slide && !bounced) b.speed = Math.max(ICE_CRAWL, speed - ICE_FRICTION);
  if (horizontal) b.x = next;
  else b.y = next;
  b.cx = Math.round(b.x);
  b.cy = Math.round(b.y);
  return bounced;
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
 * solid block stops it; the first brick it meets burns and stops it; a barrel
 * of TNT stops it and goes off moments later; power-ups lying in the open are
 * destroyed; other bombs it touches go off moments later.
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
      if (t === TNT) {
        lightTnt(world, cx, cy, owner);
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

/** A blast of `owner`'s has reached a barrel of TNT: it goes off in TNT_FUSE_TICKS, in their name (the first blast to reach it). */
function lightTnt(world: World, cx: number, cy: number, owner: number): void {
  if (!world.tntLit.some((t) => t.cx === cx && t.cy === cy)) world.tntLit.push({ cx, cy, t: TNT_FUSE_TICKS, owner });
}

/**
 * A barrel of TNT goes off (the owner's design, 25 November 2026). Its tile is open floor from now on, and its
 * blast runs out every way as far as it can: until the outer wall, a solid block or a brick stops it (the brick
 * is not broken: it shelters what is behind it), or another barrel, which it sets off. Bombs it reaches go off
 * moments later and power-ups in the open are destroyed, as with any blast. It burns with ordinary orange
 * fire, but it is the blast of whoever set the barrel off (their bomb's blast reached it, or a barrel they set
 * off did): a robot it knocks out is theirs, and in a teams match it spares their teammates if friendly fire is off.
 */
function tntBlast(world: World, lit: LitTnt): void {
  world.tntLit.splice(world.tntLit.indexOf(lit), 1);
  const { cx: x0, cy: y0 } = lit;
  world.tiles[y0 * world.w + x0] = FLOOR;
  world.events.push({ type: 'tnt', cx: x0, cy: y0 });
  const owner = lit.owner;
  addFlame(world, { cx: x0, cy: y0, ttl: FLAME_TICKS, owner, kind: 'c', tip: 0, tnt: true });
  for (let d = 1 as Dir; d <= 4; d++) {
    for (let i = 1; ; i++) {
      const cx = x0 + DX[d] * i;
      const cy = y0 + DY[d] * i;
      const t = tileAt(world, cx, cy);
      if (t === HARD || t === SOFT) break;
      if (t === TNT) {
        lightTnt(world, cx, cy, owner);
        break;
      }
      const item = world.items.findIndex((it) => it.cx === cx && it.cy === cy);
      if (item >= 0) world.items.splice(item, 1);
      const other = bombAt(world, cx, cy);
      if (other) other.fuse = Math.min(other.fuse, CHAIN_TICKS);
      addFlame(world, { cx, cy, ttl: FLAME_TICKS, owner, kind: d <= 2 ? 'v' : 'h', tip: 0, tnt: true });
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
  else if (kind === 'wire') p.wires = Math.min(MAX_WIRES, p.wires + 1);
  else if (kind === 'decoy') return; // (makeDecoys, from step: it needs the world)
  else if (kind === 'torch') p.torchTicks = TORCH_TICKS; // a second one only starts the 15 s again
  else p.speed = Math.min(MAX_SPEED_ITEMS, p.speed + 1);
}

// ---------------------------------------------------------------- decoys and trip wires

/**
 * Can a trip wire be strung on tile (cx, cy), and which way? A tile of open floor (no bomb, no wire already) with
 * a solid block on each side, left and right ('h', strung across from one to the other; the way through runs up
 * and down) or above and below ('v'). In an arena's lanes that is every tile between two pillars.
 */
export function wireSpot(world: World, cx: number, cy: number): 'h' | 'v' | null {
  if (tileAt(world, cx, cy) !== FLOOR || bombAt(world, cx, cy) || world.wires.some((o) => o.cx === cx && o.cy === cy)) return null;
  if (tileAt(world, cx - 1, cy) === HARD && tileAt(world, cx + 1, cy) === HARD) return 'h';
  if (tileAt(world, cx, cy - 1) === HARD && tileAt(world, cx, cy + 1) === HARD) return 'v';
  return null;
}

/** The trip wire strung on this tile, if there is one. */
export function wireAt(world: World, cx: number, cy: number): Wire | undefined {
  for (const o of world.wires) if (o.cx === cx && o.cy === cy) return o;
  return undefined;
}

/**
 * The tiles a trip wire's blast covers: its own, then along its lane both ways, through bricks, barrels of TNT,
 * bombs and power-ups, until a solid block (the outer wall, or a block that has fallen) stops it.
 */
export function wireLane(world: World, o: Wire): [number, number][] {
  const out: [number, number][] = [[o.cx, o.cy]];
  for (const d of o.dir === 'h' ? [1, 2] : [3, 4]) {
    for (let i = 1; ; i++) {
      const cx = o.cx + DX[d] * i;
      const cy = o.cy + DY[d] * i;
      if (tileAt(world, cx, cy) === HARD) break;
      out.push([cx, cy]);
    }
  }
  return out;
}

/**
 * A robot has walked into a trip wire (the owner's design, 26 November 2026): it is gone, and its blast runs the
 * whole length of its lane, both ways, to the walls. Nothing but a solid block stops it: it burns every brick on
 * the way (and carries on), sets off barrels of TNT and bombs, and destroys power-ups lying there. It is the
 * blast of whoever strung the wire, in their colour.
 */
function tripWire(world: World, o: Wire, by: number): void {
  world.wires.splice(world.wires.indexOf(o), 1);
  world.events.push({ type: 'trip', player: by, owner: o.owner, cx: o.cx, cy: o.cy });
  const kind = o.dir === 'h' ? 'v' : 'h';
  const ends: Flame[] = [];
  const lane = wireLane(world, o);
  for (let k = 0; k < lane.length; k++) {
    const [cx, cy] = lane[k];
    const t = tileAt(world, cx, cy);
    if (t === SOFT && !world.burning.some((b) => b.cx === cx && b.cy === cy)) world.burning.push({ cx, cy, ttl: FLAME_TICKS });
    if (t === TNT) lightTnt(world, cx, cy, o.owner);
    const item = world.items.findIndex((it) => it.cx === cx && it.cy === cy);
    if (item >= 0) world.items.splice(item, 1);
    const other = bombAt(world, cx, cy);
    if (other) other.fuse = Math.min(other.fuse, CHAIN_TICKS);
    const f: Flame = { cx, cy, ttl: FLAME_TICKS, owner: o.owner, kind, tip: 0, wire: true };
    addFlame(world, f);
    // the last tile each way is the tip of the blast
    const next = lane[k + 1];
    if (k > 0 && (!next || Math.abs(next[0] - cx) + Math.abs(next[1] - cy) !== 1)) ends.push(f);
  }
  for (const f of ends) f.tip = (o.dir === 'h' ? (f.cy < o.cy ? 1 : 2) : f.cx < o.cx ? 3 : 4) as Dir;
}

/**
 * Trip wires after everyone has moved. A wire is armed once nobody stands on its tile; after that, any robot
 * (standing, or a zombie) that comes within WIRE_REACH of the string sets it off. Decoys do not. Once the round
 * is decided nothing sets one off.
 */
function checkWires(world: World): void {
  if (world.over) return;
  for (const o of [...world.wires]) {
    let on = false;
    let by = -1;
    for (const p of world.players) {
      if (!p.alive || Math.round(p.x) !== o.cx || Math.round(p.y) !== o.cy) continue;
      on = true;
      const off = o.dir === 'h' ? Math.abs(p.y - o.cy) : Math.abs(p.x - o.cx);
      if (by < 0 && off <= WIRE_REACH) by = p.id;
    }
    if (!o.armed) o.armed = !on;
    else if (by >= 0) tripWire(world, o, by);
  }
}

/**
 * The decoy power-up: two copies of `p` appear on the free tiles nearest it (open floor with no bomb, blast or
 * block about to land, found step by step across the floor), the nearer walking the way it walks, the other the
 * opposite way. Decoys it already had go first.
 */
function makeDecoys(world: World, p: Player): void {
  for (const d of world.decoys) if (d.id === p.id && d.popped < 0) popDecoy(world, d);
  const w = world.w;
  const start = Math.round(p.y) * w + Math.round(p.x);
  const free = (i: number): boolean => {
    const x = i % w;
    const y = (i - x) / w;
    return !bombAt(world, x, y) && !flameAt(world, x, y) && !world.falling.some((f) => f.cx === x && f.cy === y) && !world.decoys.some((d) => d.popped < 0 && Math.round(d.x) === x && Math.round(d.y) === y);
  };
  const spots: number[] = [];
  const seen = new Set([start]);
  let ring = [start];
  for (let n = 0; n < DECOY_REACH && spots.length < DECOY_COUNT && ring.length; n++) {
    const next: number[] = [];
    for (const i of ring) {
      for (let d = 1; d <= 4; d++) {
        const j = i + DX[d] + DY[d] * w;
        if (seen.has(j) || world.tiles[j] !== FLOOR) continue;
        seen.add(j);
        next.push(j);
        if (spots.length < DECOY_COUNT && free(j)) spots.push(j);
      }
    }
    ring = next;
  }
  spots.forEach((i, k) => {
    const x = i % w;
    world.decoys.push({
      ...p,
      x,
      y: (i - x) / w,
      moving: false,
      walk: 0,
      mvx: 0,
      mvy: 0,
      askDir: 0,
      askTicks: 0,
      carrying: 0,
      activeBombs: 0,
      canKick: false,
      canGrab: false,
      flying: 0,
      slip: 0,
      skid: false,
      wires: 0,
      prevA: true,
      prevB: true,
      mirror: k === 1,
      born: world.tick,
      until: world.tick + DECOY_TICKS,
      popped: -1,
    });
  });
  world.events.push({ type: 'decoy', player: p.id });
}

/** A decoy goes up in a puff of smoke. */
function popDecoy(world: World, d: Decoy): void {
  d.popped = world.tick;
  d.moving = false;
  d.skid = false;
  world.events.push({ type: 'poof', player: d.id, x: d.x, y: d.y });
}

/**
 * The decoys walk: each one is asked for the way its owner is asked to go this tick (the opposite way if it is
 * the mirror), and moves by the same rules as a robot, ice and belts included. It shows the same kit as its
 * owner (shield, curse, laptop) so nothing gives it away. Its owner out of the round, or its time up, it goes.
 */
function moveDecoys(world: World, inputs: (PlayerInput | undefined)[]): void {
  for (const d of world.decoys) {
    if (d.popped >= 0) continue;
    const o = world.players[d.id];
    if (!o || !o.alive || world.tick >= d.until) {
      popDecoy(world, d);
      continue;
    }
    d.speed = o.speed;
    d.curseTicks = o.curseTicks;
    d.shieldTicks = o.shieldTicks;
    d.graceTicks = o.graceTicks;
    d.safeTicks = o.safeTicks;
    d.laptop = o.laptop;
    const want: Dir = world.over || o.flying > 0 ? 0 : inputs[o.id]?.dir ?? 0;
    const asked: Dir = d.mirror ? BACK[want] : want;
    if (asked !== d.askDir) {
      d.askDir = asked;
      d.askTicks = 0;
    } else if (asked) d.askTicks++;
    d.skid = false;
    if (world.ice) iceMove(world, d, asked);
    else if (asked) movePlayer(world, d, asked);
    else d.moving = false;
    if (world.belts.length) beltCarry(world, d);
  }
}

// ---------------------------------------------------------------- the laptop's plane

/** B with a laptop: the plane takes off from the robot, towards the middle of the arena, with PLANE_BOMBS bombs. */
function launch(world: World, p: Player): void {
  p.flying = PLANE_TICKS;
  p.planeX = p.x;
  p.planeY = p.y;
  p.planeDir = headingTo(p.x, p.y, (world.w - 1) / 2, (world.h - 1) / 2, FACING_HEADING[p.facing]);
  p.planeBombs = PLANE_BOMBS;
  p.planeCool = PLANE_FIRST_GAP;
  p.moving = false;
  p.slip = 0; // (on ice: it stops to open the laptop)
  p.askDir = 0;
  p.askTicks = 0;
  world.events.push({ type: 'launch', player: p.id });
}

/**
 * The heading (TURN_STEPS) from (x, y) most nearly towards (tx, ty): the one of PLANE_STEP's that points
 * most along the way there (sums only, no Math.atan2; the first of equals wins, so every copy agrees).
 * `none` when already there.
 */
export function headingTo(x: number, y: number, tx: number, ty: number, none: number): number {
  const dx = tx - x;
  const dy = ty - y;
  if (dx === 0 && dy === 0) return none;
  let best = none;
  let most = -Infinity;
  for (let h = 0; h < TURN_STEPS; h++) {
    const along = PLANE_STEP[h][0] * dx + PLANE_STEP[h][1] * dy;
    if (along > most) {
      most = along;
      best = h;
    }
  }
  return best;
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
    if (tileAt(world, cx, cy) === TNT) {
      lightTnt(world, cx, cy, d.owner); // (onto a barrel of TNT: it goes off)
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
 * A robot is knocked out (by a blast, a falling block or the train). With a life left it comes back at its starting
 * place in RESPAWN_TICKS; with none it is out of the round, and with angels on it becomes an angel on the
 * wall once its knocked-out animation has played, at the point of the wall nearest where it fell.
 */
function knockOut(world: World, p: Player, cause: KnockCause, by: number): void {
  if (p.flying) endFlight(world, p); // (its plane goes too; bombs already falling still land)
  if (world.itemDrop && !p.zombie) dropKit(world, p);
  for (const d of world.decoys) if (d.id === p.id && d.popped < 0) popDecoy(world, d); // (its decoys go with it)
  p.laptop = false;
  p.wires = 0;
  p.alive = false;
  p.moving = false;
  p.slip = 0;
  p.skid = false;
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

/** How far from where it fell a knocked-out robot's power-ups can land, in steps across open floor. */
export const DROP_REACH = 4;

/**
 * Item Drop (the owner's ask, 24 November 2026): a robot knocked out leaves behind every power-up it collected
 * (bombs and blast over its start, speed power-ups, the boot, the glove, a laptop it has not flown, trip wires it has not strung), on the
 * open floor nearest where it fell, one to a tile, for anyone to pick up. Nearest first, in a fixed order, so
 * every copy of the world agrees; what finds no room within DROP_REACH steps is lost. Not the shield or curse.
 */
function dropKit(world: World, p: Player): void {
  const kit: ItemKind[] = [];
  for (let i = world.start.bombs; i < p.bombsMax; i++) kit.push('bomb');
  for (let i = world.start.fire; i < p.fire; i++) kit.push('fire');
  for (let i = world.start.speed; i < p.speed; i++) kit.push('speed');
  if (p.canKick) kit.push('kick');
  if (p.canGrab) kit.push('grab');
  if (p.laptop && !p.flying) kit.push('laptop');
  for (let i = 0; i < p.wires; i++) kit.push('wire');
  if (!kit.length) return;
  // the tools first, so they are the ones nearest where it fell
  kit.reverse();
  const w = world.w;
  const start = Math.round(p.y) * w + Math.round(p.x);
  const seen = new Set([start]);
  let ring = [start];
  for (let step = 0; step <= DROP_REACH && kit.length && ring.length; step++) {
    const next: number[] = [];
    for (const i of ring) {
      const x = i % w;
      const y = (i - x) / w;
      if (kit.length && world.tiles[i] === FLOOR && !bombAt(world, x, y) && !world.items.some((it) => it.cx === x && it.cy === y) && !world.falling.some((f) => f.cx === x && f.cy === y)) {
        world.items.push({ cx: x, cy: y, kind: kit.shift()!, age: 0 });
      }
      for (let d = 1; d <= 4; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        const j = ny * w + nx;
        if (nx < 0 || ny < 0 || nx >= w || ny >= world.h || seen.has(j) || world.tiles[j] !== FLOOR) continue;
        seen.add(j);
        next.push(j);
      }
    }
    ring = next;
  }
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
    torchTicks: 0,
    throwWait: 0,
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
    slip: 0,
    slipDir: 0,
    skid: false,
    wires: 0,
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
        speed: 0,
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

/**
 * Moving on ice. Asked the way back while still sliding, the robot slides on first (looking the new way), and
 * only walks back once it has stopped. Let go, it slides on. Asked any other way it walks as anywhere (a turn
 * still takes the next opening), and if that does not move it, it slides on. Whatever it walked this tick is
 * the speed it slides at once it lets go.
 */
function iceMove(world: World, p: Player, asked: Dir): void {
  if (!asked) {
    if (p.slip > 0) glide(world, p);
    else p.moving = false;
    return;
  }
  if (p.slip > 0 && asked === BACK[p.slipDir]) {
    glide(world, p);
    p.facing = asked;
    return;
  }
  const ox = p.x;
  const oy = p.y;
  movePlayer(world, p, asked);
  if (p.moving) {
    p.slipDir = p.heading;
    p.slip = Math.abs(p.x - ox) + Math.abs(p.y - oy);
  } else if (p.slip > 0) glide(world, p);
}

/**
 * One tick of a robot walking with `asked` held (0: nothing held), on ice and belts too, as `step` moves it. The CPU
 * players also play it on a copy of their robot (with `canKick` off, so the world is not touched) to see where a move
 * takes them.
 */
export function walkRobot(world: World, p: Player, asked: Dir): void {
  if (asked !== p.askDir) {
    p.askDir = asked;
    p.askTicks = 0;
  } else if (asked) p.askTicks++;
  p.skid = false;
  if (world.ice) iceMove(world, p, asked);
  else if (asked) movePlayer(world, p, asked);
  else if (world.stepAssist) coast(world, p);
  else p.moving = false;
  // a belt under it carries it along
  if (world.belts.length) beltCarry(world, p);
}

// ---------------------------------------------------------------- one tick

/**
 * Advance the world by one tick. `inputs[id]` may be missing: that player
 * stands still. Order within a tick: the belts' clock, players move (and are
 * carried by a belt) and press buttons (or fly their planes), bombs move, the train runs, bombs count down, due bombs and
 * barrels of TNT go off, bombs falling
 * from planes land and go off, blasts and burning bricks fade, falling blocks
 * land, players are checked against blasts and power-ups, then the match
 * result.
 */
export function step(world: World, inputs: (PlayerInput | undefined)[]): void {
  world.events.length = 0;
  world.tick++;
  // the Factory's belts: the alarm, and turning round
  beltClock(world);
  if (world.dark && !world.over && world.tick >= FLASH_EVERY && world.tick % FLASH_EVERY === 0) world.events.push({ type: 'flash' });

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
    if (p.torchTicks > 0) p.torchTicks--;
    if (p.throwWait > 0) p.throwWait--;
    const inp = inputs[p.id];
    if (p.flying > 0) {
      // at its laptop: the direction and buttons fly the plane, and the robot stays where it is (a belt under it
      // carries it along)
      flyPlane(world, p, inp);
      if (world.belts.length) beltCarry(world, p, true);
      continue;
    }
    walkRobot(world, p, inp ? inp.dir : 0);
    const a = !!inp?.a;
    if (a && !p.prevA) placeBomb(world, p);
    p.prevA = a;
    const bBtn = !!inp?.b;
    if (bBtn && !p.prevB) useAction(world, p);
    p.prevB = bBtn;
  }
  // decoys walk with their robots; a robot that has walked into a trip wire sets it off
  if (world.decoys.length) moveDecoys(world, inputs);
  if (world.wires.length) checkWires(world);

  // bombs: the fuse keeps burning while carried or thrown
  moveBombs(world);
  // the railway: the train runs over what is on its line (a bomb it reaches goes off now)
  runTrain(world);
  for (const b of world.bombs) {
    b.fuse--;
    if (b.state === 'ground' && world.flames.some((f) => f.cx === b.cx && f.cy === b.cy)) {
      b.fuse = Math.min(b.fuse, CHAIN_TICKS);
    }
  }
  for (const t of world.tntLit) t.t--;
  for (let guard = 0; guard < 400; guard++) {
    const due = world.bombs.find((b) => b.state !== 'air' && b.fuse <= 0);
    if (due) {
      explode(world, due);
      continue;
    }
    // barrels of TNT a blast reached
    const lit = world.tntLit.find((t) => t.t <= 0);
    if (!lit) break;
    tntBlast(world, lit);
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
        knockOut(world, p, flame.tnt ? 'tnt' : flame.wire ? 'wire' : 'blast', flame.owner);
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
      if (kind === 'decoy') makeDecoys(world, p);
    }
  }
  // any blast pops a decoy (whoever's it is), and so does a block that has landed on it
  if (world.decoys.length) {
    for (const d of world.decoys) {
      if (d.popped >= 0) continue;
      const cx = Math.round(d.x);
      const cy = Math.round(d.y);
      if (flameAt(world, cx, cy) || tileAt(world, cx, cy) === HARD) popDecoy(world, d);
    }
    world.decoys = world.decoys.filter((d) => d.popped < 0 || world.tick - d.popped < POOF_TICKS);
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
