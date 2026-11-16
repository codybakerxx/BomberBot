/**
 * The game page's side of online play: the connection to a room on the server, and the round's ticks as they
 * come in. main.ts owns the screens and the world; this file hands it what the server says, at the right pace.
 * docs/ONLINE.md explains the design, net.ts the messages.
 *
 * - Connecting: a room is made (`create`) or joined by its code. A page has an id of its own for the rest of
 *   the time it is open (sessionStorage), so a dropped connection comes back as the same person, in the same
 *   place, and is sent the round as it is.
 * - A round: the server sends what everyone pressed on each tick. `playout` steps the world with them at 60 a
 *   second, keeping a couple of ticks in hand so an uneven connection does not make the round stutter, and
 *   catching up gently if more arrive. Every half second the server's checksum is compared with this page's
 *   world; if they differ, the page asks for the whole world and carries on from it.
 * - What you press is sent whenever it changes (`sendInput`), and on to the server's next tick.
 */
import { makeCode, parseMsg, tickCodes, worldHash, type ClientMsg, type MemberInfo, type Score, type Seat, type ServerMsg, type WorldData } from './net';
import type { World, WorldConfig } from './sim';
import type { MatchSetup } from './setup';
import type { DanceId } from './dances';

export interface OnlineHooks {
  /** the room changed: who is in it, the host, the setup, whether a match is on */
  room(msg: Extract<ServerMsg, { t: 'room' }>): void;
  /** a round starts */
  round(cfg: WorldConfig, seats: Seat[], score: Score): void;
  /** the whole world, to carry on from (after a dropped connection, or out of step) */
  snap(world: WorldData, seats: Seat[], score: Score): void;
  /** the world this page is stepping (null between rounds) */
  world(): World | null;
  /** step the world once, with these inputs (packInput codes, one per player) */
  step(codes: number[]): void;
  /** connecting, connected, or the connection dropped and is being tried again */
  status(s: 'connecting' | 'open' | 'lost'): void;
  /** something went wrong. `fatal`: the room is gone for this page (no room with that code, full...). */
  error(why: string, fatal: boolean): void;
}

/** Ticks kept in hand before stepping, against an uneven connection. */
const KEEP = 2;
/** More than this many in hand: step one extra a frame to catch up. */
const BEHIND = 5;
/** Far behind (the page was in the background): jump to two ticks short of the latest. */
const JUMP = 40;
/** Give up trying to reconnect after this long. */
const RETRY_FOR_MS = 60_000;
/** A message every so often keeps the connection from being closed as idle, and measures the delay. */
const PING_MS = 15_000;

/** This page's id for itself, kept while it is open (a reload keeps it; a new tab gets its own). */
function pageKey(): string {
  try {
    let k = sessionStorage.getItem('onlineKey');
    if (!k) {
      k = makeCode(Math.random) + Math.random().toString(36).slice(2, 12);
      sessionStorage.setItem('onlineKey', k);
    }
    return k;
  } catch {
    return makeCode(Math.random) + Math.random().toString(36).slice(2, 12);
  }
}

export class Online {
  code = '';
  /** this page's member id in the room, the host's, everyone, and the host's setup */
  me = -1;
  host = -1;
  members: MemberInfo[] = [];
  setup: MatchSetup | null = null;
  playing = false;
  /** round trip to the server, in milliseconds (measured by the pings) */
  rtt = 0;
  private ws: WebSocket | null = null;
  private hooks: OnlineHooks;
  private key = pageKey();
  /** what hello says about you (kept up to date by `meChanged`) */
  private you = { name: '', colorId: 'gold', dance: 'party' as DanceId };
  private creating = false;
  private tries = 0;
  /** connected once: a drop after that is tried again */
  private joined = false;
  private leaving = false;
  private lostAt = 0;
  private retry = 0;
  private pinger = 0;
  /** ticks received and not yet stepped: their inputs, and the checksum after them if one came */
  private queue: { tick: number; codes: number[]; sum?: number }[] = [];
  private acc = 0;
  /** stepping has started with ticks in hand (false at the start, and after running dry) */
  private primed = false;
  private sentInput = -1;
  /** asked for the whole world and waiting for it */
  private syncing = false;
  /** checksums compared, and how many differed (for a check from the browser console) */
  checks = 0;
  misses = 0;

  /** the server's address (host and port) */
  private server: string;

  constructor(hooks: OnlineHooks, server: string) {
    this.hooks = hooks;
    this.server = server;
  }

  get isHost(): boolean {
    return this.me >= 0 && this.me === this.host;
  }
  get connected(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN && this.me >= 0;
  }

  /** Make a new room (a code of our own; another is tried if it is taken), or join one by its code. */
  start(code: string | null, you: { name: string; colorId: string; dance: DanceId }): void {
    this.you = { ...you };
    this.creating = code === null;
    this.tries = 0;
    this.code = code ?? makeCode(Math.random);
    this.open();
  }

  private url(): string {
    const proto = location.protocol === 'http:' ? 'ws:' : 'wss:';
    return `${proto}//${this.server}/api/room/${this.code}`;
  }

  private open(): void {
    this.hooks.status(this.joined ? 'lost' : 'connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url());
    } catch {
      this.dropped();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.send({ t: 'hello', id: this.key, ...this.you, create: this.creating && !this.joined });
    };
    ws.onmessage = (e) => {
      const m = parseMsg<ServerMsg>(e.data);
      if (m && this.ws === ws) this.take(m);
    };
    ws.onclose = () => {
      if (this.ws === ws) this.dropped();
    };
  }

  /** The connection closed without our asking: try again for a while. */
  private dropped(): void {
    this.ws = null;
    clearInterval(this.pinger);
    if (this.leaving) return;
    if (!this.joined) {
      this.hooks.error('Could not reach the server. Check your connection and try again.', true);
      return;
    }
    if (!this.lostAt) this.lostAt = Date.now();
    if (Date.now() - this.lostAt > RETRY_FOR_MS) {
      this.joined = false;
      this.hooks.error('The connection to the room was lost.', true);
      return;
    }
    this.hooks.status('lost');
    clearTimeout(this.retry);
    this.retry = window.setTimeout(() => this.open(), Math.min(4000, 500 + (Date.now() - this.lostAt) / 4));
  }

  private take(m: ServerMsg): void {
    switch (m.t) {
      case 'room': {
        const first = !this.joined;
        this.joined = true;
        this.lostAt = 0;
        this.code = m.code;
        this.me = m.you;
        this.host = m.host;
        this.members = m.members;
        this.setup = m.setup;
        this.playing = m.playing;
        if (first) {
          clearInterval(this.pinger);
          this.pinger = window.setInterval(() => this.send({ t: 'ping', c: performance.now() }), PING_MS);
          this.send({ t: 'ping', c: performance.now() });
        }
        this.hooks.status('open');
        this.hooks.room(m);
        return;
      }
      case 'round':
        this.queue = [];
        this.acc = 0;
        this.primed = false;
        this.syncing = false;
        this.sentInput = -1;
        this.hooks.round(m.cfg, m.seats, m.score);
        return;
      case 'snap':
        this.queue = [];
        this.acc = 0;
        this.primed = false;
        this.syncing = false;
        this.hooks.snap(m.world, m.seats, m.score);
        return;
      case 'ticks': {
        const last = this.queue.length ? this.queue[this.queue.length - 1].tick : (this.hooks.world()?.tick ?? 0);
        if (m.from !== last + 1) {
          // a gap: something was missed. The whole world puts it right.
          this.askSync();
          return;
        }
        m.i.forEach((t, k) => {
          const tick = m.from + k;
          this.queue.push({ tick, codes: tickCodes(t), ...(m.sum && m.sum[0] === tick ? { sum: m.sum[1] } : {}) });
        });
        return;
      }
      case 'pong':
        this.rtt = Math.round(performance.now() - m.c);
        return;
      case 'error': {
        if (m.fatal && this.creating && !this.joined && m.why.includes('taken') && this.tries++ < 6) {
          // that code was in use: another
          this.code = makeCode(Math.random);
          this.ws = null;
          this.open();
          return;
        }
        if (m.fatal) {
          this.leaving = true;
          this.ws = null;
          clearInterval(this.pinger);
        }
        this.hooks.error(m.why, !!m.fatal);
        return;
      }
    }
  }

  private askSync(): void {
    if (this.syncing) return;
    this.syncing = true;
    this.queue = [];
    this.send({ t: 'sync' });
  }

  send(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** What you are pressing now (packInput): sent when it changes. */
  sendInput(v: number): void {
    if (v === this.sentInput) return;
    this.sentInput = v;
    this.send({ t: 'in', v });
  }

  /** Your robot, Ready, dance and name in the lobby. Also what hello says next time. */
  meChanged(colorId: string, ready: boolean, dance: DanceId, name: string): void {
    this.you = { name, colorId, dance };
    this.send({ t: 'me', colorId, ready, dance, name });
  }

  /**
   * Step the round on by `dt` seconds' worth of ticks, as far as the ticks received allow. Returns how many
   * were stepped.
   */
  playout(dt: number): number {
    const w = this.hooks.world();
    if (!w || this.syncing) return 0;
    // ticks already behind the world (a snapshot came after them) are dropped
    while (this.queue.length && this.queue[0].tick <= w.tick) this.queue.shift();
    if (this.queue.length && this.queue[0].tick !== w.tick + 1) {
      this.askSync();
      return 0;
    }
    const len = 1 / 60;
    const have = this.queue.length;
    // start (and start again after running dry) only with a couple of ticks in hand
    if (!this.primed) {
      if (have <= KEEP) {
        this.acc = 0;
        return 0;
      }
      this.primed = true;
    }
    this.acc += dt;
    let n = Math.floor(this.acc / len);
    this.acc -= n * len;
    if (have > JUMP) n = have - KEEP;
    else if (have > BEHIND) n += 1;
    let stepped = 0;
    while (stepped < n) {
      if (!this.queue.length) {
        this.primed = false; // ran dry: wait for a couple in hand again
        this.acc = 0;
        break;
      }
      const t = this.queue.shift()!;
      this.hooks.step(t.codes);
      stepped++;
      if (t.sum !== undefined) {
        this.checks++;
        const world = this.hooks.world();
        if (world && worldHash(world) !== t.sum) {
          this.misses++;
          this.askSync();
          break;
        }
      }
    }
    return stepped;
  }

  /** Ticks received and waiting to be stepped. */
  get waiting(): number {
    return this.queue.length;
  }

  /** Leave the room for good. */
  leave(): void {
    this.leaving = true;
    clearInterval(this.pinger);
    clearTimeout(this.retry);
    this.send({ t: 'bye' });
    const ws = this.ws;
    this.ws = null;
    setTimeout(() => ws?.close(), 100);
  }
}
