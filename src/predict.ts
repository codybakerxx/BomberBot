/**
 * Online: this page's side of a round, and what makes it feel as quick as playing on this screen
 * (docs/ONLINE.md). Pure: no DOM and no clock of its own (the time is handed in), so tests run it against a
 * room over a made-up slow, uneven connection (tests/predict.test.ts).
 *
 * The page keeps two worlds.
 *
 * - **The server's** (`hooks.world()`): stepped only with the inputs the server sends, tick by tick, the
 *   moment they arrive. It is always right, and a little in the past. Scores, results and checksums use it.
 * - **The picture** (`view()`): that world copied and played on to the tick it is now, with what you have
 *   pressed since. Your own robot moves in it at once, and bombs, blasts and falling blocks are on time for
 *   it. It is thrown away and worked out again every time the server says more, so it cannot drift.
 *
 * **Your presses.** Each press says which tick it is for (the picture's next one), and the server keeps it
 * until then (`InputQueue` in net.ts, the same lines on both sides). So when the tick comes back from the
 * server it is the tick the picture already showed, and nothing moves. A press that arrives after its tick is
 * taken in on the next: the server's acks say how far it has got, the picture is worked out again from that,
 * and your robot shifts by a tick's walk, about a pixel.
 *
 * **The clock.** The picture runs ahead of the server's ticks by the trip there and back, so that presses
 * arrive just before their tick. Pings measure it: each pong says where the round's clock stood when the ping
 * arrived, which gives how far ahead this page must run for a press sent then to be `MARGIN` ticks early. The
 * page runs at the slowest of the last few (one freak ping aside), and moves there gently: a little faster or
 * slower for a moment, never a jump back.
 *
 * **The other robots** are not guessed at. In the picture they are drawn where the server said they were a
 * few ticks ago, read from a short history, so they walk evenly however unevenly the ticks arrive. How far
 * back follows the connection: as far as the ticks have lately been late, easing forward again.
 */
import { TICK_HZ, cloneWorld, step, type GameEvent, type Player, type PlayerInput, type World } from './sim';
import { IN_A, IN_ALL, IN_B, newQueue, takeInput, tickCodes, unpackInput, worldHash, type ClientMsg, type InputQueue, type ServerMsg, type StampedInput } from './net';

export const TICK_MS = 1000 / TICK_HZ;
/** A press should reach the server this many ticks before its tick, by the slowest recent ping. */
export const MARGIN = 2;
/** The picture never runs further than this past the server's last tick (when the connection stalls, it waits). */
export const MAX_AHEAD = 40;
/** Pongs remembered for the clock (they come twice a second in a round). */
const PONGS = 10;
/** The clock moves to where it should be at most this fast: a quarter faster, a twentieth slower. */
const SPEED_UP = 0.25;
const SLOW_DOWN = 0.05;
/** Further behind than this (half a second), it jumps ahead instead. */
const SNAP = 30;
/** How far back the other robots are drawn eases forward this many ticks a second once the connection settles. */
const DELAY_EASE = 1;
/**
 * A frame's reading of the clock is kept this far (in ticks) from the moment one tick turns into the next
 * (`lean`, in `frame`): read right on that edge, a frame a hair early shows the same tick as the last one
 * and the next shows two, and everything that moves judders.
 */
const EDGE = 0.15;
/** Ticks of history kept (other robots, early sounds, what was guessed). */
const RING = 128;

export interface PredictHooks {
  /** the world as the server has it (stepped only by `step`) */
  world(): World;
  /** step that world one tick with the server's inputs (main.ts: its sounds, the score, the result) */
  step(codes: number[]): void;
  /** a press, to the server */
  send(msg: ClientMsg): void;
  /** something happened in the picture ahead of the server's word on it: play its sound now */
  early(e: GameEvent): void;
}

export class Predictor {
  /** your place in the round */
  readonly me: number;
  private hooks: PredictHooks;
  private epoch: number;

  // the clock: the picture's tick is now / TICK_MS + off
  private needs: number[] = [];
  private off = NaN;
  private slewAt = 0;
  /** the clock is read this much ahead (under a tick), so frames fall in the middle of a tick: see EDGE */
  private lean = 0;

  // your presses: those sent and not yet taken in by the server, and what the server holds for you
  private n = 0;
  private lastV = 0;
  private sent: StampedInput[] = [];
  private ackedV = 0;

  // the picture
  /** the tick the picture is at */
  head: number;
  private pred: World | null = null;
  private q: InputQueue = newQueue();
  private dirty = true;
  private shown: World | null = null;
  /** what everyone was last pressing, by the server (the others keep their buttons as they were in the picture) */
  private lastCodes: number[] = [];

  // the other robots: where the server said they were, tick by tick, and how far back they are drawn
  private hist: ({ tick: number; players: Player[] } | undefined)[] = new Array(RING);
  private delay = 0;
  private delayAt = 0;
  private remoteTick = 0;

  // sounds made ahead of the server, by tick
  private early: ({ tick: number; types: string[] } | undefined)[] = new Array(RING);
  private sounded: number;
  /** what the picture took you to be pressing on each tick, to count the times it was wrong */
  private guess = new Int16Array(RING).fill(-1);
  private guessTick = new Int32Array(RING).fill(-1);

  /** checksums compared with the server's, and how many differed */
  checks = 0;
  misses = 0;
  /** ticks on which the server had you pressing something other than the picture showed (a press arrived late) */
  corrections = 0;

  constructor(hooks: PredictHooks, me: number, epoch: number) {
    this.hooks = hooks;
    this.me = me;
    this.epoch = epoch;
    const w = hooks.world();
    this.head = w.tick;
    this.sounded = w.tick;
    this.remoteTick = w.tick;
    this.record(w);
  }

  // ---------------------------------------------------------------- from the server

  /**
   * The server's inputs for the next ticks: its world is stepped with them at once. False if they do not
   * follow on, or this page's world turns out not to be the server's: the whole world is needed.
   */
  ticks(m: Extract<ServerMsg, { t: 'ticks' }>): boolean {
    if (m.from !== this.hooks.world().tick + 1) return false;
    for (const text of m.i) {
      const codes = tickCodes(text);
      this.hooks.step(codes);
      const w = this.hooks.world();
      this.lastCodes = codes;
      this.record(w);
      const g = w.tick % RING;
      if (this.guessTick[g] === w.tick && this.guess[g] !== (codes[this.me] ?? 0)) this.corrections++;
      if (m.sum && m.sum[0] === w.tick) {
        this.checks++;
        if (worldHash(w) !== m.sum[1]) {
          this.misses++;
          return false;
        }
      }
    }
    if (m.a) this.ack(m.a[this.me] ?? 0);
    this.dirty = true;
    return true;
  }

  /** The server has taken in your presses up to number `n`. */
  private ack(n: number): void {
    while (this.sent.length && this.sent[0].n <= n) this.ackedV = this.sent.shift()!.v & IN_ALL;
  }

  /** Keep where everyone is after this tick, for drawing the others a few ticks back. */
  private record(w: World): void {
    this.hist[w.tick % RING] = { tick: w.tick, players: w.players.map((p) => ({ ...p })) };
  }

  /**
   * A pong: the ping sent at `sentAt` (the time `frame` is given, in milliseconds) reached the server when the
   * round's clock stood at `due` ticks.
   */
  pong(sentAt: number, due: number): void {
    // the offset that would have had a press sent then arrive MARGIN ticks ahead of its tick
    this.needs.push(due + MARGIN - sentAt / TICK_MS);
    if (this.needs.length > PONGS) this.needs.shift();
  }

  // ---------------------------------------------------------------- every frame

  /**
   * Once a frame: `now` in milliseconds, `v` what you are pressing (packInput). Sends a press when it changes,
   * moves the picture on to the tick it is now, and makes the world to draw (`view`).
   */
  frame(now: number, v: number): void {
    const base = this.hooks.world();
    if (v !== this.lastV) {
      // for the picture's next tick: this frame's, when a new tick has come round
      this.lastV = v;
      const m: StampedInput = { k: this.head + 1, v, n: ++this.n };
      this.sent.push(m);
      if (!this.dirty) this.q.pending.push(m);
      this.hooks.send({ t: 'in', v, k: m.k, n: m.n, e: this.epoch });
    }
    this.slew(now);
    let want = base.tick;
    if (!Number.isNaN(this.off)) {
      // Which tick is it now? Frames come a tick apart (on most screens), each at the same point in its tick.
      // If that point is right where one tick turns into the next, the smallest wobble in a frame's time (a
      // phone gives them in whole milliseconds) shows one tick twice and then skips one. So when a frame
      // falls near that edge the reading is leaned, once, to put frames in the middle of a tick: always
      // forwards, by under a tick (16 ms), so a press is never stamped for an earlier tick than it would
      // have been and reaches the server no later for its tick.
      const exact = now / TICK_MS + this.off;
      const at = exact + this.lean - Math.floor(exact + this.lean); // 0 to 1: where in its tick this frame falls
      if (at < EDGE || at > 1 - EDGE) {
        this.lean += 0.5 - at;
        this.lean -= Math.floor(this.lean);
      }
      want = Math.floor(exact + this.lean);
    }
    this.head = Math.max(this.head, base.tick, Math.min(want, base.tick + MAX_AHEAD));

    let w = this.pred;
    if (!w || this.dirty || w.tick < base.tick || w.tick > this.head) w = this.rebuild(base);
    while (w.tick < this.head) this.stepOn(w);

    // the other robots: as far back as the ticks have lately been late, and never backwards
    const gap = this.head - base.tick;
    this.delay = Math.max(gap, this.delay - (Math.max(0, now - this.delayAt) / 1000) * DELAY_EASE);
    this.delayAt = now;
    this.remoteTick = Math.max(this.remoteTick, Math.min(base.tick, this.head - Math.ceil(this.delay)));
    const h = this.hist[this.remoteTick % RING];
    const there = h && h.tick === this.remoteTick ? h.players : base.players;
    // (the moments they are waiting for, coming back or appearing as an angel, are told in ticks: moved on to
    // the picture's tick, which is ahead of theirs, so those are drawn at their own pace too)
    const shift = w.tick - this.remoteTick;
    const players = w.players.map((p, i) => {
      if (i === this.me) return p;
      const r = there[i] ?? p;
      return shift && (r.respawnAt >= 0 || r.angel) ? { ...r, respawnAt: r.respawnAt >= 0 ? r.respawnAt + shift : r.respawnAt, angelFrom: r.angelFrom + shift } : r;
    });
    // (a bomb one of them carries sits on that robot's head)
    const bombs = w.bombs.some((b) => b.state === 'held' && b.heldBy !== this.me)
      ? w.bombs.map((b) => (b.state === 'held' && b.heldBy !== this.me && players[b.heldBy] ? { ...b, x: players[b.heldBy].x, y: players[b.heldBy].y } : b))
      : w.bombs;
    this.shown = { ...w, players, bombs };
  }

  /** Move the clock towards where the pongs say it should be. */
  private slew(now: number): void {
    if (!this.needs.length) return;
    // the slowest recent ping; with enough of them, one freak is left out
    const sorted = [...this.needs].sort((a, b) => b - a);
    const target = sorted.length >= 5 ? sorted[1] : sorted[0];
    const dt = Math.max(0, now - this.slewAt) / TICK_MS;
    this.slewAt = now;
    const d = target - this.off;
    if (Number.isNaN(this.off) || d > SNAP) this.off = target;
    else this.off += Math.max(-SLOW_DOWN * dt, Math.min(SPEED_UP * dt, d));
  }

  /** The picture afresh: the server's world, to be played on with the presses it has not taken in yet. */
  private rebuild(base: World): World {
    const w = cloneWorld(base);
    // the others stand where they are and nothing is decided for them: what happens to them is the server's to say
    for (const p of w.players) if (p.id !== this.me) p.safeTicks = Math.max(p.safeTicks, MAX_AHEAD + 2);
    this.q = newQueue(this.ackedV, this.sent.slice());
    this.pred = w;
    this.dirty = false;
    return w;
  }

  /** The picture one tick on: your presses as the server will take them in, the others keeping still. */
  private stepOn(w: World): void {
    const t = w.tick + 1;
    const code = takeInput(this.q, t);
    const mine = w.over ? 0 : code; // (once the round is decided nobody is asked for anything)
    // (another player flying a plane presses nothing in the picture: its bombs come when the server says so, as
    // its plane is drawn where the server last had it)
    const inputs: PlayerInput[] = w.players.map((p, i) =>
      i === this.me ? unpackInput(mine) : p.flying ? unpackInput(0) : unpackInput((this.lastCodes[i] ?? 0) & (IN_A | IN_B)),
    );
    step(w, inputs);
    const g = t % RING;
    this.guess[g] = mine;
    this.guessTick[g] = t;
    // sounds: made now, the first time the picture reaches this tick; the server's word on the tick then
    // finds them made already (heard)
    const types: string[] = [];
    for (const e of w.events) if (this.foreseen(e)) types.push(e.type);
    this.early[g] = { tick: t, types };
    if (t > this.sounded) {
      this.sounded = t;
      for (const e of w.events) if (this.foreseen(e)) this.hooks.early(e);
    }
  }

  /** Things the picture can know ahead of the server: what you do, and what follows from bombs already down. */
  private foreseen(e: GameEvent): boolean {
    switch (e.type) {
      case 'place':
      case 'explode':
      case 'kick':
      case 'lift':
      case 'throw':
      case 'land':
      case 'block':
      case 'tnt':
      case 'bell':
      case 'train':
        return true;
      case 'pickup':
        return e.player === this.me;
      default:
        return false;
    }
  }

  /** Was this event of the server's tick `tick` already sounded in the picture? (Each early sound answers once.) */
  heard(tick: number, e: GameEvent): boolean {
    if (!this.foreseen(e)) return false;
    const h = this.early[tick % RING];
    if (!h || h.tick !== tick) return false;
    const i = h.types.indexOf(e.type);
    if (i < 0) return false;
    h.types.splice(i, 1);
    return true;
  }

  /** The world to draw: the picture, with the other robots where the server last said. */
  view(): World {
    return this.shown ?? this.hooks.world();
  }

  /** How it is going, for the menu and for tests. */
  stats(): { ahead: number; behind: number; synced: boolean; corrections: number; checks: number; misses: number } {
    return {
      /** ticks the picture is ahead of the server's last */
      ahead: this.head - this.hooks.world().tick,
      /** ticks back the other robots are drawn */
      behind: this.head - this.remoteTick,
      synced: !Number.isNaN(this.off),
      corrections: this.corrections,
      checks: this.checks,
      misses: this.misses,
    };
  }
}
