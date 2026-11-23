/**
 * One online room: the people in it, the host's match setup, and the match itself, run here on the server.
 * The Cloudflare side (worker.ts) owns the connections and the clock and hands them in; this file only
 * decides. Nothing here touches the network or a clock of its own, so tests can play a whole room through
 * with made-up connections and a made-up time (tests/room.test.ts).
 *
 * - Lobby: people join by code. The first is the host. Each picks a robot and presses Ready, as on a phone
 *   (a CPU player wearing the robot someone takes gets the one they had). The host sets the match: the CPU
 *   players and the rules. Only the host starts.
 * - Match: the server steps the round 60 times a second, asks the CPU players for their moves, and sends every
 *   page what every player pressed on each tick (net.ts). It counts the wins. Only the host moves on (Next
 *   round, Rematch), restarts the match, or takes everyone back to the lobby. Nobody can pause it.
 * - A dropped connection keeps its place (its robot stands still meanwhile) and comes back where it was. A host
 *   who drops for a while hands the room on.
 */
import { MAX_PLAYERS, TICK_HZ, step, winnersOf, type World, type WorldConfig } from './sim';
import { BOT_LEVELS, botInput, createBot, type Bot, type BotLevel } from './bot';
import { MAX_CPUS, copyRules, problem, readSetup, rollCpus, rollRules, swapTeams, worldConfig, type CpuSlot, type MatchSetup } from './setup';
import { readDance, type DanceId } from './dances';
import {
  CHECK_EVERY,
  PROTOCOL,
  encodeWorld,
  newQueue,
  packInput,
  IN_ALL,
  readName,
  roundWorld,
  takeInput,
  tickText,
  unpackInput,
  worldHash,
  type ClientMsg,
  type InputQueue,
  type MemberInfo,
  type Score,
  type Seat,
  type ServerMsg,
} from './net';

/** The robots, in the order of COLORS in render.ts (tests/room.test.ts checks they agree). */
export const COLOR_IDS = ['gold', 'black', 'pink', 'blue', 'red', 'orange', 'white', 'green', 'purple'];

/** The first tick of a round comes this long after the round is announced, so every page is ready for it. */
export const LEAD_MS = 900;
export const TICK_MS = 1000 / TICK_HZ;
/** Once a round is decided, it goes on being stepped this long (the ghosts float away), then waits. */
export const AFTER_TICKS = 10 * TICK_HZ;
/** A page that falls this far behind (a slow server moment) catches up at most this many ticks at once. */
export const CATCH_UP = 30;
/**
 * Someone whose connection dropped keeps their place this long in the lobby, and across the end of a match.
 * In a match, until it ends. (A phone drops its connection as soon as the app is left for another; the owner
 * asked that leaving the app for a while not lose your place, 23 November 2026: it was 45 s, and anyone away
 * when a match ended was let go at once.)
 */
export const AWAY_MS = 10 * 60_000;
/** A host who has been gone this long hands the room to the next person still here (it was 12 s). */
export const HOST_AWAY_MS = 2 * 60_000;

/** A connection to one page. */
export interface Conn {
  send(text: string): void;
  close(code?: number, reason?: string): void;
}

export interface Member {
  id: number;
  /** the page's own id for itself, kept while the page is open, so a dropped connection comes back as the same person */
  key: string;
  name: string;
  colorId: string;
  ready: boolean;
  dance: DanceId;
  conn: Conn | null;
  /** when the connection dropped, or -1 */
  awaySince: number;
  /** in the match being played */
  playing: boolean;
  /** what they are pressing, and the presses waiting for their tick (net.ts) */
  q: InputQueue;
  /** goes up each time `q` starts afresh (a new round, or the whole world sent again); presses say which they are for */
  epoch: number;
}

/** A press can be for a tick at most this far ahead (two seconds), and this many can wait. */
const MAX_STAMP_AHEAD = 2 * TICK_HZ;
const MAX_WAITING = 120;

export class Room {
  readonly code: string;
  private random: () => number;
  members: Member[] = [];
  hostId = -1;
  private nextId = 1;
  setup: MatchSetup;
  playing = false;
  // the match
  seats: Seat[] = [];
  /** the setup the match is played with, fixed when it starts (players and rules change only between matches) */
  private match: MatchSetup | null = null;
  score: Score = { wins: [], leader: -1, matchWinner: -1, roundNo: 0 };
  world: World | null = null;
  cfg: WorldConfig | null = null;
  private bots: Bot[] = [];
  /** the time tick 1 is due */
  private startAt = 0;
  /** the tick the round was decided on, or -1 */
  private overTick = -1;
  private counted = false;
  /** the acks last sent with the ticks, as text (they are sent again only when they change) */
  private lastAcks = '';

  constructor(code: string, random: () => number) {
    this.code = code;
    this.random = random;
    this.setup = readSetup({ cpus: [] }, 'gold', COLOR_IDS);
    this.setup.cpus = [];
  }

  // ------------------------------------------------------------ who is here

  private host(): Member | undefined {
    return this.members.find((m) => m.id === this.hostId);
  }
  /** Is anyone still connected? */
  anyoneHere(): boolean {
    return this.members.some((m) => m.conn);
  }
  /** Nothing left in the room: it can be forgotten. */
  empty(): boolean {
    return this.members.length === 0;
  }
  /** Is anyone connected just now? (Everyone may be away for a while, each keeping their place.) */
  anyoneOn(): boolean {
    return this.members.some((m) => m.conn);
  }
  /** Does the round need stepping (the fast clock)? */
  busy(): boolean {
    return this.playing && !!this.world && (this.overTick < 0 || this.world.tick < this.overTick + AFTER_TICKS);
  }

  /** A robot nobody else in the room wears: a person, or a CPU player (unless `cpusToo` is false). */
  private freeColour(prefer: string, except: Member | null, cpusToo = true): string {
    const people = new Set(this.members.filter((m) => m !== except).map((m) => m.colorId));
    const cpus = new Set(cpusToo ? this.setup.cpus.map((c) => c.colorId) : []);
    if (COLOR_IDS.includes(prefer) && !people.has(prefer) && !cpus.has(prefer)) return prefer;
    return COLOR_IDS.find((c) => !people.has(c) && !cpus.has(c)) ?? COLOR_IDS.find((c) => !people.has(c)) ?? COLOR_IDS[0];
  }
  /** `m` takes robot `colorId`: a CPU player wearing it takes the one `m` had (the lobby's rule). */
  private takeColour(m: Member, colorId: string): void {
    for (const c of this.setup.cpus) if (c.colorId === colorId) c.colorId = m.colorId;
    if (colorId !== m.colorId) swapTeams(this.setup, colorId, m.colorId); // (each keeps its side in a teams match)
    m.colorId = colorId;
  }
  /** Eight players at most: a CPU player makes room for a person. */
  private makeRoom(): void {
    while (this.setup.cpus.length && this.members.length + this.setup.cpus.length > MAX_PLAYERS) this.setup.cpus.pop();
  }

  // ------------------------------------------------------------ connections

  /**
   * A page says hello. `create`: it is making this room, which must not be in use. Otherwise it is joining
   * one that must be. Returns the member it now is, or null (and the connection is told why and closed).
   */
  hello(conn: Conn, msg: Extract<ClientMsg, { t: 'hello' }>, now: number): Member | null {
    const refuse = (why: string): null => {
      send(conn, { t: 'error', why, fatal: true });
      conn.close(4000, why);
      return null;
    };
    // a page from before the last update speaks an older version of the messages: it needs the new page
    if (msg.pv !== PROTOCOL) return refuse('This game has been updated. Reload the page to get the new version, then join again.');
    const key = typeof msg.id === 'string' ? msg.id.slice(0, 40) : '';
    if (!key) return refuse('Something went wrong. Try again.');
    let m = this.members.find((x) => x.key === key);
    if (m) {
      // the same page again: its connection had dropped, or it opened a second one
      if (m.conn && m.conn !== conn) m.conn.close(4001, 'Connected again');
      m.conn = conn;
      m.awaySince = -1;
      this.welcome(m);
      this.sendRoom();
      return m;
    }
    if (msg.create && this.members.length) return refuse('That room code is taken.');
    if (!msg.create && !this.members.length) return refuse('There is no room with that code. Check it and try again.');
    if (this.members.length >= MAX_PLAYERS) return refuse('That room is full: eight players already.');
    m = {
      id: this.nextId++,
      key,
      name: readName(msg.name),
      colorId: 'gold',
      ready: false,
      dance: readDance(msg.dance) ?? 'party',
      conn,
      awaySince: -1,
      playing: false,
      q: newQueue(),
      epoch: 0,
    };
    if (msg.create) {
      // a new room: three Normal CPU players to start with, as in a new local lobby; the host can change them
      this.setup = readSetup({}, 'gold', COLOR_IDS);
      this.setup.cpus = [];
      this.hostId = m.id;
    }
    this.members.push(m);
    // the robot they asked for, or the first nobody else here has; a CPU player wearing it moves to a colour
    // nobody has (it used to keep it, so a friend joining could play the same robot as a CPU player)
    const want = this.freeColour(typeof msg.colorId === 'string' ? msg.colorId : 'gold', m, false);
    const cpu = this.setup.cpus.find((c) => c.colorId === want);
    if (cpu) {
      const spare = COLOR_IDS.find((id) => id !== want && !this.members.some((x) => x !== m && x.colorId === id) && !this.setup.cpus.some((c) => c.colorId === id));
      if (spare) {
        swapTeams(this.setup, want, spare); // (it keeps its side in a teams match)
        cpu.colorId = spare;
      } else this.setup.cpus = this.setup.cpus.filter((c) => c !== cpu); // (no colour left: it makes room)
    }
    m.colorId = want;
    if (msg.create) {
      for (const colorId of ['black', 'pink', 'blue', 'red', 'orange', 'white', 'green', 'purple', 'gold'].filter((c) => c !== m!.colorId).slice(0, 3))
        this.setup.cpus.push({ colorId, level: 'normal' });
    }
    this.makeRoom();
    this.welcome(m);
    this.sendRoom();
    void now;
    return m;
  }

  /** Bring a page up to date: the room, and the round in progress if it is in it. */
  private welcome(m: Member): void {
    this.sendRoomTo(m);
    if (this.playing && m.playing && this.world) this.sendSnap(m);
  }

  /** A connection closed. The person keeps their place for a while (AWAY_MS), or until the match ends. */
  disconnect(m: Member, conn: Conn, now: number): void {
    if (m.conn !== conn) return; // an old connection of someone already back
    m.conn = null;
    m.awaySince = now;
    this.freshInput(m); // their robot stands still meanwhile
    this.sendRoom();
  }

  /** Someone leaves for good. */
  private remove(m: Member): void {
    this.members = this.members.filter((x) => x !== m);
    m.conn?.close(1000, 'Left the room');
    m.conn = null;
    if (this.hostId === m.id) this.hostId = (this.members.find((x) => x.conn) ?? this.members[0])?.id ?? -1;
    if (!this.members.length) this.reset();
    else this.sendRoom();
  }
  private reset(): void {
    this.playing = false;
    this.world = null;
    this.hostId = -1;
  }

  /** Every few seconds: drop those gone too long, and hand the room on if its host is gone. */
  housekeep(now: number): void {
    let changed = false;
    for (const m of [...this.members]) {
      if (m.conn || m.awaySince < 0) continue;
      const inMatch = this.playing && m.playing;
      if (!inMatch && now - m.awaySince > AWAY_MS) {
        this.members = this.members.filter((x) => x !== m);
        changed = true;
      }
    }
    if (!this.members.some((m) => m.conn) && this.members.length && this.members.every((m) => now - m.awaySince > AWAY_MS)) {
      // everyone has been gone a long while, a match or not: the room closes
      this.members = [];
    }
    if (!this.members.length) {
      if (this.hostId >= 0) this.reset();
      return;
    }
    const host = this.host();
    if (!host || (!host.conn && now - host.awaySince > HOST_AWAY_MS)) {
      const next = this.members.find((m) => m.conn);
      if (next && next.id !== this.hostId) {
        this.hostId = next.id;
        changed = true;
      }
    }
    if (changed) this.sendRoom();
  }

  // ------------------------------------------------------------ messages

  message(m: Member, msg: ClientMsg, now: number): void {
    const isHost = m.id === this.hostId;
    switch (msg.t) {
      case 'in': {
        const w = this.world;
        if (!m.playing || !w || msg.e !== m.epoch) return; // (a press sent before this round, or before the world was sent again)
        if (typeof msg.v !== 'number' || !Number.isFinite(msg.k) || !Number.isFinite(msg.n)) return;
        const q = m.q;
        const last = q.pending[q.pending.length - 1];
        if (msg.n <= (last ? last.n : q.acked) || q.pending.length >= MAX_WAITING) return;
        // for the tick it names: not before the press ahead of it, and not far in the future. One for a tick
        // that has gone by is taken in on the next (takeInput).
        const k = Math.max(last ? last.k : 0, Math.min(Math.floor(msg.k), w.tick + MAX_STAMP_AHEAD));
        q.pending.push({ k, v: msg.v & IN_ALL, n: Math.floor(msg.n) });
        return;
      }
      case 'me': {
        if (this.playing && m.playing) return; // robots are fixed for the match
        const want = typeof msg.colorId === 'string' && COLOR_IDS.includes(msg.colorId) ? msg.colorId : m.colorId;
        if (this.members.some((x) => x !== m && x.colorId === want)) {
          // someone else took it first: this page is told how things are
          m.ready = false;
          this.sendRoom();
          return;
        }
        if (want !== m.colorId) this.takeColour(m, want);
        m.ready = !!msg.ready;
        m.dance = readDance(msg.dance) ?? m.dance;
        m.name = readName(msg.name);
        this.sendRoom();
        return;
      }
      case 'setup': {
        if (!isHost || this.playing) return;
        const s = readSetup(msg.setup, m.colorId, COLOR_IDS);
        // the CPU players read again here: readSetup knows only one person's robot, and puts in three CPU
        // players when there are none, which online (people to play against) is allowed
        const raw = (msg.setup as unknown as { cpus?: unknown })?.cpus;
        const people = new Set(this.members.map((x) => x.colorId));
        s.cpus = [];
        for (const c of Array.isArray(raw) ? (raw as Partial<CpuSlot>[]).slice(0, MAX_CPUS) : []) {
          if (!c || typeof c !== 'object') continue;
          const taken = (id: string): boolean => people.has(id) || s.cpus.some((o) => o.colorId === id);
          const colorId = typeof c.colorId === 'string' && COLOR_IDS.includes(c.colorId) && !taken(c.colorId) ? c.colorId : COLOR_IDS.find((id) => !taken(id));
          if (!colorId) break;
          const dance = readDance(c.dance);
          s.cpus.push({ colorId, level: BOT_LEVELS.includes(c.level as BotLevel) ? (c.level as BotLevel) : 'normal', ...(dance ? { dance } : {}) });
        }
        s.cpus = s.cpus.slice(0, Math.min(MAX_CPUS, MAX_PLAYERS - this.members.length));
        this.setup = s;
        this.sendRoom();
        return;
      }
      case 'start': {
        if (!isHost || this.playing) return;
        const here = this.members.filter((x) => x.conn);
        const why = problem(this.setup, here.length - 1);
        if (why) {
          send(m.conn, { t: 'error', why: 'Add a CPU player, or wait for a friend to join, to have someone to play against.' });
          return;
        }
        for (const x of this.members) x.playing = !!x.conn;
        this.playing = true;
        this.match = JSON.parse(JSON.stringify(this.setup)) as MatchSetup;
        this.seats = [
          ...this.members.filter((x) => x.playing).map((x) => ({ member: x.id, name: x.name, colorId: x.colorId, dance: x.dance })),
          ...this.match.cpus.map((c) => ({ member: null, name: '', colorId: c.colorId, dance: c.dance ?? 'party', level: c.level })),
        ];
        this.newScore(false);
        this.sendRoom();
        this.startRound(now);
        return;
      }
      case 'next': {
        if (!isHost || !this.playing || !this.world?.over) return;
        if (this.score.matchWinner >= 0) this.newScore(true);
        this.startRound(now);
        return;
      }
      case 'restart': {
        if (!isHost || !this.playing) return;
        this.newScore(true);
        this.startRound(now);
        return;
      }
      case 'lobby': {
        if (!isHost || !this.playing) return;
        this.toLobby();
        return;
      }
      case 'sync': {
        if (this.playing && m.playing && this.world) this.sendSnap(m);
        return;
      }
      case 'ping': {
        // in a round: where its clock stands now, so the page can time its presses to arrive just ahead of their tick
        const d = this.playing && this.world ? (now - this.startAt) / TICK_MS + 1 : undefined;
        send(m.conn, { t: 'pong', c: typeof msg.c === 'number' ? msg.c : 0, ...(d === undefined ? {} : { d }) });
        return;
      }
      case 'bye': {
        this.remove(m);
        return;
      }
    }
  }

  /**
   * Back to the lobby: the match ends, and everyone presses Ready again. Those away keep their place in the
   * lobby as usual (housekeep lets them go after AWAY_MS); those who left are already gone.
   */
  private toLobby(): void {
    this.playing = false;
    this.world = null;
    this.match = null;
    // Random mode: new rules for the next match, shown in the lobby before it starts
    if (this.setup.randomRules) copyRules(rollRules(this.setup, this.random), this.setup);
    for (const m of this.members) {
      m.playing = false;
      m.ready = false;
      this.freshInput(m);
    }
    if (!this.host()) this.hostId = this.members[0]?.id ?? -1;
    this.makeRoom();
    this.sendRoom();
  }

  // ------------------------------------------------------------ rounds

  /**
   * A match starts (or starts again: Rematch, Restart): the score back to 0, and, with Randomize CPUs on,
   * each CPU player's emote and level picked afresh. The seats say what each got, so every page knows.
   */
  private newScore(again: boolean): void {
    this.score = { wins: this.seats.map(() => 0), leader: -1, matchWinner: -1, roundNo: 0 };
    const match = this.match;
    if (!match) return;
    // Random mode: a new match from the round (Rematch, Restart) gets new rules, the room's setup too, so the
    // lobby shows them; from the lobby, the ones shown there
    if (again && match.randomRules) {
      const r = rollRules(match, this.random);
      copyRules(r, match);
      copyRules(r, this.setup);
      this.sendRoom();
    }
    match.cpus = rollCpus(match, this.random);
    const people = this.seats.length - match.cpus.length;
    match.cpus.forEach((c, i) => {
      const seat = this.seats[people + i];
      if (!seat) return;
      seat.dance = c.dance ?? 'party';
      seat.level = c.level;
    });
  }

  private startRound(now: number): void {
    const setup = this.match!;
    const people = this.seats.filter((s) => s.member !== null).map((s) => s.colorId);
    const seed = Math.floor(this.random() * 2 ** 31);
    // people first, in the order they joined, then the CPU players: the same order as the seats
    const cfg = worldConfig(setup, people[0], seed, people.slice(1));
    this.cfg = cfg;
    this.world = roundWorld(cfg);
    this.bots = setup.cpus.map((c, i) => createBot(people.length + i, c.level, seed));
    this.startAt = now + LEAD_MS;
    this.overTick = -1;
    this.counted = false;
    this.score.roundNo++;
    this.lastAcks = '';
    for (const m of this.members) {
      this.freshInput(m);
      if (m.playing) send(m.conn, { t: 'round', cfg, seats: this.seats, score: this.score, ep: m.epoch });
    }
  }

  /** Start a person's presses afresh: nothing held, nothing waiting, and a new number for the presses to come. */
  private freshInput(m: Member): void {
    m.q = newQueue();
    m.epoch++;
  }

  /**
   * Step the round up to the time `now`, and send everyone the inputs of each tick stepped. Called often
   * (about 60 times a second) while `busy()`.
   */
  advance(now: number): void {
    const w = this.world;
    if (!this.playing || !w || !this.busy()) return;
    const due = Math.floor((now - this.startAt) / TICK_MS) + 1;
    if (due <= w.tick) return;
    const from = w.tick + 1;
    const ticks: string[] = [];
    let sum: [number, number] | undefined;
    let n = 0;
    while (w.tick < due && n < CATCH_UP && this.busy()) {
      const codes = this.seats.map((s, i) => {
        if (s.member === null) return w.over ? 0 : packInput(botInput(w, this.bots[i - (this.seats.length - this.bots.length)]));
        const m = this.members.find((x) => x.id === s.member);
        if (!m || !m.conn) return 0;
        const v = takeInput(m.q, w.tick + 1);
        return w.over ? 0 : v; // once the round is decided nobody is asked for anything
      });
      step(w, codes.map(unpackInput));
      ticks.push(tickText(codes));
      if (w.tick % CHECK_EVERY === 0) sum = [w.tick, worldHash(w)];
      n++;
      if (w.over && !this.counted) {
        this.counted = true;
        this.overTick = w.tick;
        const winner = w.over.winner;
        if (winner >= 0) {
          const s = this.score;
          // a point for the winner or, in a teams match, for every robot on its side
          for (const id of winnersOf(w)) s.wins[id]++;
          if (s.leader < 0 || s.wins[winner] > s.wins[s.leader]) s.leader = winner;
          if (s.wins[winner] >= (this.match?.firstTo ?? 1)) s.matchWinner = winner;
        }
      }
    }
    if (n === CATCH_UP && w.tick < due) this.startAt = now - (w.tick - 1) * TICK_MS; // too far behind: carry on from here
    // how far each person's presses have been taken in, when that has changed
    const acks = this.seats.map((s) => (s.member === null ? 0 : (this.members.find((x) => x.id === s.member)?.q.acked ?? 0)));
    const said = acks.join(',');
    const a = said !== this.lastAcks ? { a: acks } : {};
    this.lastAcks = said;
    this.broadcast({ t: 'ticks', from, i: ticks, ...(sum ? { sum } : {}), ...a });
  }

  // ------------------------------------------------------------ sending

  private info(m: Member): MemberInfo {
    return { id: m.id, name: m.name, colorId: m.colorId, ready: m.ready, dance: m.dance, on: !!m.conn, playing: m.playing };
  }
  private sendRoomTo(m: Member): void {
    send(m.conn, { t: 'room', code: this.code, you: m.id, host: this.hostId, members: this.members.map((x) => this.info(x)), setup: this.setup, playing: this.playing });
  }
  private sendRoom(): void {
    for (const m of this.members) this.sendRoomTo(m);
  }
  private sendSnap(m: Member): void {
    if (!this.world) return;
    this.freshInput(m);
    this.lastAcks = '';
    send(m.conn, { t: 'snap', world: encodeWorld(this.world), seats: this.seats, score: this.score, ep: m.epoch });
  }
  private broadcast(msg: ServerMsg): void {
    const text = JSON.stringify(msg);
    // a round's ticks go to those playing in it; someone waiting for the next match does not need them
    for (const m of this.members) if (m.conn && (m.playing || msg.t !== 'ticks')) m.conn.send(text);
  }
}

function send(conn: Conn | null, msg: ServerMsg): void {
  if (conn) conn.send(JSON.stringify(msg));
}
