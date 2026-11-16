/**
 * The game page's side of online play: the connection to a room on the server. main.ts owns the screens and
 * the server's world; predict.ts runs the round on this page. docs/ONLINE.md explains the design, net.ts the
 * messages.
 *
 * - Connecting: a room is made (`create`) or joined by its code. A page has an id of its own for the rest of
 *   the time it is open (sessionStorage), so a dropped connection comes back as the same person, in the same
 *   place, and is sent the round as it is.
 * - A round: the server sends what everyone pressed on each tick, and the server's world is stepped with them
 *   the moment they arrive (`Predictor.ticks`). What is drawn is a picture run on from it to now, with your
 *   own presses (`frame`, `view`), so your robot answers at once and moves evenly whatever the connection does.
 *   Every half second the server's checksum is compared with this page's world; if they differ, the page asks
 *   for the whole world and carries on from it.
 * - Pings: every 15 seconds to keep the connection open; in a round twice a second, to keep the picture's
 *   clock in step with the server's (predict.ts).
 */
import { PROTOCOL, makeCode, parseMsg, type ClientMsg, type MemberInfo, type Score, type Seat, type ServerMsg, type WorldData } from './net';
import { Predictor } from './predict';
import type { GameEvent, World, WorldConfig } from './sim';
import type { MatchSetup } from './setup';
import type { DanceId } from './dances';

export interface OnlineHooks {
  /** the room changed: who is in it, the host, the setup, whether a match is on */
  room(msg: Extract<ServerMsg, { t: 'room' }>): void;
  /** a round starts */
  round(cfg: WorldConfig, seats: Seat[], score: Score): void;
  /** the whole world, to carry on from (after a dropped connection, or out of step) */
  snap(world: WorldData, seats: Seat[], score: Score): void;
  /** the server's world, as this page has it (null between rounds) */
  world(): World | null;
  /** step that world once, with these inputs (packInput codes, one per player) */
  step(codes: number[]): void;
  /** something happened in the picture ahead of the server's word on it: play its sound now */
  early(e: GameEvent): void;
  /** connecting, connected, or the connection dropped and is being tried again */
  status(s: 'connecting' | 'open' | 'lost'): void;
  /** something went wrong. `fatal`: the room is gone for this page (no room with that code, full...). */
  error(why: string, fatal: boolean): void;
}

/** In a round: a ping twice a second for the picture's clock, and a quick few at the start of each round. */
const ROUND_PING_MS = 500;
const FIRST_PINGS = 5;
const FIRST_PING_MS = 110;
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
  /** the round on this page (predict.ts), while one is being played */
  private pred: Predictor | null = null;
  /** asked for the whole world and waiting for it */
  private syncing = false;
  /** the round's pings: when the next is due, and how many quick ones are left */
  private pingAt = 0;
  private quick = 0;
  /** the last few round trips, for `rtt` */
  private trips: number[] = [];
  /** checksums compared and how many differed, and presses that reached the server late, over this visit */
  checks = 0;
  misses = 0;
  corrections = 0;

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
      this.send({ t: 'hello', id: this.key, ...this.you, create: this.creating && !this.joined, pv: PROTOCOL });
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
        if (!m.playing) this.endRound();
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
        this.endRound();
        this.hooks.round(m.cfg, m.seats, m.score);
        this.beginRound(m.seats, m.ep);
        return;
      case 'snap':
        this.endRound();
        this.hooks.snap(m.world, m.seats, m.score);
        this.beginRound(m.seats, m.ep);
        return;
      case 'ticks':
        // (while the whole world is on its way, ticks that came before it are of no use)
        if (this.pred && !this.syncing && !this.pred.ticks(m)) this.askSync();
        return;
      case 'pong': {
        this.trips.push(performance.now() - m.c);
        if (this.trips.length > 7) this.trips.shift();
        this.rtt = Math.round([...this.trips].sort((a, b) => a - b)[this.trips.length >> 1]);
        if (m.d !== undefined) this.pred?.pong(m.c, m.d);
        return;
      }
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

  /** A round (or the whole world again) has come: run it on this page from here. */
  private beginRound(seats: Seat[], epoch: number): void {
    const world = this.hooks.world();
    if (!world) return;
    this.syncing = false;
    this.pred = new Predictor(
      {
        world: () => this.hooks.world() ?? world,
        step: (codes) => this.hooks.step(codes),
        send: (msg) => this.send(msg),
        early: (e) => this.hooks.early(e),
      },
      Math.max(0, seats.findIndex((s) => s.member === this.me)),
      epoch,
    );
    // a quick few pings, so the picture's clock is set before the round's first tick
    this.quick = FIRST_PINGS;
    this.pingAt = 0;
  }
  private endRound(): void {
    if (!this.pred) return;
    const st = this.pred.stats();
    this.checks += st.checks;
    this.misses += st.misses;
    this.corrections += st.corrections;
    this.pred = null;
  }

  private askSync(): void {
    if (this.syncing) return;
    this.syncing = true;
    this.send({ t: 'sync' });
  }

  send(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Your robot, Ready, dance and name in the lobby. Also what hello says next time. */
  meChanged(colorId: string, ready: boolean, dance: DanceId, name: string): void {
    this.you = { name, colorId, dance };
    this.send({ t: 'me', colorId, ready, dance, name });
  }

  /**
   * Once a frame in a round: `now` (performance.now()), and what you are pressing (packInput). Sends your
   * presses, keeps the clock's pings going, and moves the picture on to now.
   */
  frame(now: number, v: number): void {
    if (!this.pred || this.syncing) return;
    if (now >= this.pingAt) {
      this.pingAt = now + (this.quick-- > 0 ? FIRST_PING_MS : ROUND_PING_MS);
      this.send({ t: 'ping', c: now });
    }
    this.pred.frame(now, v);
  }

  /** The world to draw in a round: the picture, a little ahead of the server's world (null between rounds). */
  view(): World | null {
    return this.pred ? this.pred.view() : this.hooks.world();
  }

  /** Was this event of the server's tick `tick` already sounded ahead of time? */
  heard(tick: number, e: GameEvent): boolean {
    return !!this.pred && this.pred.heard(tick, e);
  }

  /** How the connection is doing, for the menu and for checking from the console. */
  stats(): { rtt: number; ahead: number; behind: number; synced: boolean; checks: number; misses: number; corrections: number } {
    const st = this.pred?.stats();
    return {
      rtt: this.rtt,
      ahead: st?.ahead ?? 0,
      behind: st?.behind ?? 0,
      synced: st?.synced ?? false,
      checks: this.checks + (st?.checks ?? 0),
      misses: this.misses + (st?.misses ?? 0),
      corrections: this.corrections + (st?.corrections ?? 0),
    };
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
