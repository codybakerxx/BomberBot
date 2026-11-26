/**
 * Online play: what the game page and the server say to each other, and the small pieces both sides need.
 * Pure, like sim.ts: no DOM, no clocks, no Math.random. Imported by the game page (online.ts) and by the
 * server (room.ts, worker.ts). docs/ONLINE.md explains the whole design.
 *
 * How a round is kept the same on every screen: the server runs the round (sim.ts, and bot.ts for the CPU
 * players) and sends everyone, tick by tick, what every player asked for on that tick. Each page steps its own
 * copy of the world with exactly those inputs, so every copy stays the same as the server's (the rules give
 * the same match for the same seed and inputs). Every CHECK_EVERY ticks the server adds a checksum of its
 * world; a page whose copy differs asks for the whole world (`snap`) and carries on from it.
 *
 * How your own robot moves at once: the page does not wait for the server. It runs a little ahead of it
 * (predict.ts), and says of each press which tick it is for (`k`). The server keeps the press until that tick
 * (`InputQueue`, the same few lines on both sides), so the tick comes out as the page already drew it.
 */
import { AIM_STEPS, createWorld, type Dir, type ItemKind, type PlayerInput, type World, type WorldConfig } from './sim';
import type { MatchSetup } from './setup';
import type { DanceId } from './dances';
import type { BotLevel } from './bot';

/**
 * The version of these messages. A page says it in `hello`; the server turns away a page with another (one
 * left open from before an update), telling it to reload. Raise it whenever a message changes its meaning.
 */
export const PROTOCOL = 13; // 3: the laptop's plane (steering in the inputs, planes and falling bombs in the world); 4: the plane slower, turning less, flying longer; 5: Power-ups (itemShare in the setup), and a custom mix is only which kinds; 6: Brick density (brickShare) and a switch for each kind (itemOn); 7: the area the falling blocks leave is a clean rectangle on every size (9 by 7 on Standard); 8: the plane with one bomb, 6 s, off towards the middle, turning tighter, and the blocks falling faster; 9: the input mask keeps the plane's steering (it was wiped), and the Mode bubbles (randomRules, rolledKey in the setup); 10: the kinds every arena is sure to have (`sure` in the round's config: not one set to Rare or Very rare); 11: Item drop (itemDrop in the setup and the round's config), quick chat (`chat`), the plane faster and turning tighter; 12: the Wild West's railway and TNT (`rails`, `tnt` in the round's config; the train and lit TNT in the world); 13: bricks on the railway (a train smashes them), trains every 8 to 12 s

/** Room codes: four letters, without the ones easily mixed up (I, O) or that spell words easily (vowels). */
export const CODE_LETTERS = 'BCDFGHJKLMNPQRSTVWXZ';
export const CODE_LENGTH = 4;
/** A room code as typed: upper case, letters only, or '' if it cannot be one. */
export function readCode(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const code = raw.toUpperCase().replace(/[^A-Z]/g, '');
  return code.length === CODE_LENGTH && [...code].every((c) => CODE_LETTERS.includes(c)) ? code : '';
}
/** A new room code from random numbers in [0, 1) (the server's own). */
export function makeCode(random: () => number): string {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_LETTERS[Math.floor(random() * CODE_LETTERS.length)];
  return s;
}

/** Players' typed names: up to 12 characters, single spaces, no control characters. */
export function readName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 12);
}

// ---------------------------------------------------------------- inputs

/**
 * A player's input on one tick: the direction (0 to 4), then A (8) and B (16), in five bits; and only while
 * flying a plane (the laptop), which way to steer it in the bits above (IN_AIM: the aim, 0 to 63, plus one;
 * nothing there means no steering).
 */
export const IN_A = 8;
export const IN_B = 16;
export const IN_AIM = 32;
/**
 * Every bit an input can have: the five low bits and the seven above them for the aim (plus one: 1 to 64). A
 * mask, so all of its bits must be set: it was 31 + IN_AIM * AIM_STEPS (2079), which is not one, and the
 * server's `& IN_ALL` wiped every aim but one; the plane could not be steered online (the owner, 23 November 2026).
 */
export const IN_ALL = IN_AIM * 128 - 1;
export function packInput(p: PlayerInput | undefined): number {
  if (!p) return 0;
  const aim = p.aim !== undefined && Number.isInteger(p.aim) && p.aim >= 0 && p.aim < AIM_STEPS ? (p.aim + 1) * IN_AIM : 0;
  return (p.dir & 7) | (p.a ? IN_A : 0) | (p.b ? IN_B : 0) | aim;
}
export function unpackInput(v: number): PlayerInput {
  const dir = v & 7;
  const out: PlayerInput = { dir: (dir <= 4 ? dir : 0) as Dir, a: (v & IN_A) !== 0, b: (v & IN_B) !== 0 };
  const aim = Math.floor(v / IN_AIM) % 128;
  if (aim >= 1 && aim <= AIM_STEPS) out.aim = aim - 1;
  return out;
}
/**
 * One tick's inputs for every player: one character each (0-9, a-v), "0a00" for four players; an input that
 * steers a plane is two, a character for its five bits from another set (STEER) and one for its aim (AIMS).
 */
const DIGITS = '0123456789abcdefghijklmnopqrstuv';
const STEER = 'wxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_';
const AIMS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export function tickText(codes: number[]): string {
  return codes
    .map((c) => {
      const aim = Math.floor(c / IN_AIM) % 128;
      return aim >= 1 && aim <= AIM_STEPS ? STEER[c & 31] + AIMS[aim - 1] : DIGITS[c & 31];
    })
    .join('');
}
export function tickCodes(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const d = DIGITS.indexOf(text[i]);
    if (d >= 0) {
      out.push(d);
      continue;
    }
    const s = STEER.indexOf(text[i]);
    const a = AIMS.indexOf(text[i + 1] ?? '');
    out.push(s < 0 ? 0 : s | (a < 0 ? 0 : (a + 1) * IN_AIM));
    i++;
  }
  return out;
}

/** What a player pressed, and the tick it is for. `n` counts a page's presses in a round, so the server can say how far it has got. */
export interface StampedInput {
  /** the tick this takes effect on; if that tick has gone by when it arrives, the next one */
  k: number;
  /** packInput */
  v: number;
  n: number;
}
/**
 * One player's presses on their way into the round: what is held now, a press of A or B not yet given to a
 * tick (so a quick tap, let go before the next tick, still counts), and the presses waiting for their tick.
 * The server keeps one for each person; the page keeps a copy of its own to work out what the server will do.
 */
export interface InputQueue {
  held: number;
  pressA: boolean;
  pressB: boolean;
  pending: StampedInput[];
  /** `n` of the last press taken in */
  acked: number;
}
export function newQueue(held = 0, pending: StampedInput[] = []): InputQueue {
  return { held, pressA: false, pressB: false, pending, acked: 0 };
}
/** What this player asks for on tick `tick` (packInput): every press due by then is taken in, in order. */
export function takeInput(q: InputQueue, tick: number): number {
  while (q.pending.length && q.pending[0].k <= tick) {
    const m = q.pending.shift()!;
    const v = m.v & IN_ALL;
    if (v & IN_A && !(q.held & IN_A)) q.pressA = true;
    if (v & IN_B && !(q.held & IN_B)) q.pressB = true;
    q.held = v;
    q.acked = m.n;
  }
  const code = q.held | (q.pressA ? IN_A : 0) | (q.pressB ? IN_B : 0);
  q.pressA = q.pressB = false;
  return code;
}

// ---------------------------------------------------------------- keeping copies the same

/** The server adds a checksum of its world every this many ticks (half a second). */
export const CHECK_EVERY = 30;

/**
 * A checksum of everything in a world that matters to how the round goes on: the tiles, every robot (and its
 * plane), bomb, bomb falling from a plane, blast, power-up and falling block. Two worlds with the same checksum are, for practical purposes, the same.
 * Numbers are hashed by their exact bits, so the smallest drift shows.
 */
export function worldHash(w: World): number {
  let h = 0x811c9dc5;
  const buf = new DataView(new ArrayBuffer(8));
  const byte = (b: number): void => {
    h ^= b & 255;
    h = Math.imul(h, 0x01000193);
  };
  const num = (v: number): void => {
    buf.setFloat64(0, v);
    for (let i = 0; i < 8; i++) byte(buf.getUint8(i));
  };
  num(w.tick);
  for (let i = 0; i < w.tiles.length; i++) byte(w.tiles[i]);
  for (const p of w.players) {
    num(p.x);
    num(p.y);
    num(p.facing);
    num(p.alive ? 1 : 0);
    num(p.lives);
    num(p.bombsMax * 64 + p.fire * 8 + p.speed);
    num(p.activeBombs);
    num(p.carrying);
    num(p.respawnAt);
    num(p.angel ? p.angelS : -1);
    num(p.zombie ? (p.zombieDown ? 2 : 1) : 0);
    num(p.shieldTicks + p.curseTicks * 4096);
    num(p.laptop ? 1 : 0);
    num(p.flying);
    if (p.flying) {
      num(p.planeX);
      num(p.planeY);
      num(p.planeDir * 8 + p.planeBombs);
    }
  }
  num(w.drops.length);
  for (const d of w.drops) {
    num(d.x);
    num(d.y);
    num(d.t);
  }
  num(w.bombs.length);
  for (const b of w.bombs) {
    num(b.x);
    num(b.y);
    num(b.fuse);
    num(b.owner);
  }
  num(w.flames.length);
  num(w.items.length);
  for (const it of w.items) num(it.cy * w.w + it.cx);
  num(w.falling.length);
  num(w.shrinkNext);
  num(w.tntLit.length);
  num(w.train ? w.train.warnAt * 8 + w.train.line * 2 + (w.train.dir > 0 ? 1 : 0) : -1);
  num(w.over ? w.over.winner : -2);
  return h >>> 0;
}

/** A world as plain data, to send whole (a page that has fallen out of step, or come back mid-round). */
export interface WorldData extends Omit<World, 'tiles' | 'hidden' | 'events'> {
  tiles: number[];
  hidden: [number, ItemKind][];
}
export function encodeWorld(w: World): WorldData {
  const { tiles, hidden, events: _events, ...rest } = w;
  return JSON.parse(JSON.stringify({ ...rest, tiles: Array.from(tiles), hidden: [...hidden.entries()] }));
}
export function decodeWorld(d: WorldData): World {
  return { ...d, tiles: Uint8Array.from(d.tiles), hidden: new Map(d.hidden), events: [] } as World;
}
/** The world a round starts from: built from its config, the same on every page and on the server. */
export function roundWorld(cfg: WorldConfig): World {
  return createWorld(cfg);
}

// ---------------------------------------------------------------- the room

/** A person in a room, as everyone sees them. */
export interface MemberInfo {
  /** the server's number for them (not their place in a round) */
  id: number;
  name: string;
  colorId: string;
  ready: boolean;
  dance: DanceId;
  /** connected just now (a dropped connection keeps its place for a while) */
  on: boolean;
  /** in the match being played (someone who joined during a match waits for the next) */
  playing: boolean;
}

/** One place in a round: a person (by member id) or a CPU player, with the name and dance it shows. */
export interface Seat {
  member: number | null;
  /** a person's typed name ('' for none, and for a CPU player: the page shows the robot's name) */
  name: string;
  colorId: string;
  dance: DanceId;
  /** a CPU player's level in this match (it may have been picked at random: Randomize CPUs) */
  level?: BotLevel;
}

/** The score of the match so far, by place in the round. */
export interface Score {
  wins: number[];
  /** the place in the lead (wears the crown), -1 before the first win */
  leader: number;
  /** the place that has won the match, -1 until then */
  matchWinner: number;
  /** rounds started in this match */
  roundNo: number;
}

/** What the page sends. */
export type ClientMsg =
  /** the first message: who this is (an id kept by the page, so a dropped connection comes back as the same person) */
  | { t: 'hello'; id: string; name: string; colorId: string; dance: DanceId; create: boolean; pv?: number }
  /** their robot, Ready, dance and name in the lobby */
  | { t: 'me'; colorId: string; ready: boolean; dance: DanceId; name: string }
  /** the host's match setup (the CPU players and the rules) */
  | { t: 'setup'; setup: MatchSetup }
  /** the host: start the match */
  | { t: 'start' }
  /** what this player is pressing (StampedInput), in the round with this number (`e`: the `ep` the page was last given) */
  | { t: 'in'; v: number; k: number; n: number; e: number }
  /** the host: the next round, or a rematch once the match is won */
  | { t: 'next' }
  /** the host: the whole match again from 0 */
  | { t: 'restart' }
  /** the host: everyone back to the lobby */
  | { t: 'lobby' }
  /** this page's world is out of step: send it the whole world */
  | { t: 'sync' }
  | { t: 'ping'; c: number }
  /** leaving the room for good */
  | { t: 'bye' }
  /** the host: send a notification to everyone who turned them on (Settings › App) that this room is open. `me`: this phone's own sign-up, left out. */
  | { t: 'invite'; me?: string }
  /** a quick-chat line (picked or typed in the menu's chat), said over their robot to everyone in the room */
  | { t: 'chat'; text: string };

/** What the server sends. */
export type ServerMsg =
  /** the room: who is in it, who hosts, the setup, and whether a match is on. Sent whenever any of it changes. */
  | { t: 'room'; code: string; you: number; host: number; members: MemberInfo[]; setup: MatchSetup; playing: boolean }
  /** a round starts: build its world from `cfg`. `seats` says who is in each place. `ep`: to send back with every press. */
  | { t: 'round'; cfg: WorldConfig; seats: Seat[]; score: Score; ep: number }
  /**
   * inputs for ticks `from`, `from + 1`... (tickText each); `sum`: the checksum after tick sum[0]; `a`: for each
   * place, the `n` of the last press taken in (sent when it has changed)
   */
  | { t: 'ticks'; from: number; i: string[]; sum?: [number, number]; a?: number[] }
  /** the whole world (after `world.tick`), to carry on from */
  | { t: 'snap'; world: WorldData; seats: Seat[]; score: Score; ep: number }
  /** `d`, in a round: where the round's clock stood when the ping arrived, in ticks (tick T is stepped when it reaches T) */
  | { t: 'pong'; c: number; d?: number }
  /** something went wrong; `why` is said to the player. `fatal`: the connection is closing. */
  | { t: 'error'; why: string; fatal?: boolean }
  /**
   * a short line for the top of the screen. The answer to the host's bell (Tell friends) also says how it went
   * (`bell`) and how many friends were rung (`n`), so the page can say it under the bell in its own words.
   */
  | { t: 'note'; why: string; bell?: BellAnswer; n?: number }
  /** someone in the room said this (quick chat): `id` is the member's number, as in `MemberInfo` */
  | { t: 'chat'; id: number; text: string };

/** The longest quick-chat line, in characters. */
export const CHAT_MAX = 40;
/** Tidy a chat line: one line, no control characters, at most CHAT_MAX characters ('' if nothing is left). */
export function cleanChat(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return [...raw.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, CHAT_MAX).join('').trim();
}

/** How a ring of the host's bell (Tell friends) went: friends rung, nobody to ring, too soon, too many this hour, or it failed. */
export type BellAnswer = 'sent' | 'none' | 'wait' | 'busy' | 'fail';

/** Read a message, or null if it is not one. */
export function parseMsg<T extends { t: string }>(raw: unknown): T | null {
  if (typeof raw !== 'string' || raw.length > 64_000) return null;
  try {
    const m = JSON.parse(raw);
    return m && typeof m === 'object' && typeof m.t === 'string' ? (m as T) : null;
  } catch {
    return null;
  }
}
