/**
 * Checks of how an online round feels on a page (src/predict.ts), over made-up connections: a room on the
 * "server", two pages, and links between them that are slow and uneven. The rules cannot feel a touch screen,
 * but they can measure what a player would see:
 *
 * - your own robot starts to move on the frame you press, and walks at an even pace, whatever the connection;
 * - the other robot walks evenly too, however unevenly the server's ticks arrive;
 * - the page's copy of the server's world never differs from the server's;
 * - a press that reaches the server late is put right; sounds are made once, yours at once.
 * Run with: npm test
 */
import assert from 'node:assert';
import { BASE_SPEED, makeRng, step, type GameEvent, type World } from '../src/sim';
import { Room, TICK_MS, type Conn, type Member } from '../src/room';
import { PROTOCOL, decodeWorld, packInput, roundWorld, unpackInput, type ClientMsg, type ServerMsg } from '../src/net';
import { Predictor } from '../src/predict';

let now = 0;

/** One direction of a connection: each message takes `base` ms plus up to `jitter`, now and then 70 more, and they stay in order. */
class Link {
  private last = 0;
  private q: { at: number; text: string }[] = [];
  constructor(
    private rng: () => number,
    private base: number,
    private jitter: number,
    private spikes: number,
  ) {}
  send(text: string): void {
    this.last = Math.max(this.last, now + this.base + this.rng() * this.jitter + (this.rng() < this.spikes ? 70 : 0));
    this.q.push({ at: this.last, text });
  }
  due(): string[] {
    const out: string[] = [];
    while (this.q.length && this.q[0].at <= now) out.push(this.q.shift()!.text);
    return out;
  }
}

/** A page: its copy of the server's world, the round on it (predict.ts), and what online.ts does around them. */
class Page {
  world: World | null = null;
  pred: Predictor | null = null;
  member: Member | null = null;
  seat = 0;
  /** sounds made, by kind */
  sounds: Record<string, number> = {};
  private pingAt = 0;
  private quick = 5;
  up: Link;
  down: Link;
  conn: Conn = { send: (t) => this.down.send(t), close: () => {} };
  constructor(
    public key: string,
    public room: Room,
    rng: () => number,
    link: [number, number, number],
    public frameMs: number,
  ) {
    this.up = new Link(rng, ...link);
    this.down = new Link(rng, ...link);
  }
  say(msg: ClientMsg): void {
    this.up.send(JSON.stringify(msg));
  }
  private sound(e: GameEvent): void {
    this.sounds[e.type] = (this.sounds[e.type] ?? 0) + 1;
  }
  /** Messages that have arrived, each way. */
  pump(): void {
    for (const t of this.up.due()) this.room.message(this.member!, JSON.parse(t), now);
    for (const t of this.down.due()) {
      const m = JSON.parse(t) as ServerMsg;
      if (m.t === 'round' || m.t === 'snap') {
        this.world = m.t === 'round' ? roundWorld(m.cfg) : decodeWorld(m.world);
        this.seat = m.seats.findIndex((s) => s.member === this.member!.id);
        this.pred = new Predictor(
          {
            world: () => this.world!,
            step: (codes) => {
              step(this.world!, codes.map(unpackInput));
              for (const e of this.world!.events) if (!this.pred!.heard(this.world!.tick, e)) this.sound(e);
            },
            send: (msg) => this.say(msg),
            early: (e) => this.sound(e),
          },
          this.seat,
          m.ep,
        );
        this.quick = 5;
        this.pingAt = 0;
      } else if (m.t === 'ticks') assert.ok(this.pred!.ticks(m), `${this.key}: the page's world is the server's`);
      else if (m.t === 'pong' && m.d !== undefined) this.pred?.pong(m.c, m.d);
    }
  }
  frame(v: number): void {
    if (!this.pred) return;
    if (now >= this.pingAt) {
      this.pingAt = now + (this.quick-- > 0 ? 110 : 500);
      this.say({ t: 'ping', c: now });
    }
    this.pred.frame(now, v);
  }
}

interface Walk {
  /** the worst a robot was from an even walk, in ticks' worth of walking */
  worst: number;
  /** frames measured */
  frames: number;
}

/**
 * Two people play for `secs` over links of `link` (each way: ms, jitter ms, share of messages with a spike).
 * The host walks right and left along the top row and the friend down and up, as a person would with a
 * thumb: 330 ms each way with a rest between. Returns what the host saw of both robots.
 */
function play(seed: number, link: [number, number, number], hostFrameMs: number, secs: number) {
  now = 0;
  const rng = makeRng(seed);
  const room = new Room('BCDF', makeRng(seed + 1));
  const host = new Page('host', room, rng, link, hostFrameMs);
  const friend = new Page('friend', room, rng, link, 1000 / 60);
  host.member = room.hello(host.conn, { t: 'hello', id: 'host', name: '', colorId: 'gold', dance: 'party', create: true, pv: PROTOCOL }, now);
  friend.member = room.hello(friend.conn, { t: 'hello', id: 'friend', name: '', colorId: 'blue', dance: 'party', create: false, pv: PROTOCOL }, now);
  room.message(host.member!, { t: 'setup', setup: { ...room.setup, cpus: [], timerOn: false, lives: 5, arena: 'compact' } }, now);
  room.message(host.member!, { t: 'start' }, now);

  const RIGHT = packInput({ dir: 4, a: false, b: false });
  const LEFT = packInput({ dir: 3, a: false, b: false });
  const DOWN = packInput({ dir: 2, a: false, b: false });
  const UP = packInput({ dir: 1, a: false, b: false });
  /** what a thumb is pressing at time t (ms since the round's first tick was due): 330 ms one way, 140 ms rest, 330 ms back, rest */
  const thumb = (t: number, there: number, back: number): number => {
    if (t < 600) return 0; // a moment to look at the arena
    const p = (t - 600) % 940;
    return p < 330 ? there : p < 470 ? 0 : p < 800 ? back : 0;
  };

  const own: Walk = { worst: 0, frames: 0 };
  const other: Walk = { worst: 0, frames: 0 };
  let pressDelay = 0;
  let presses = 0;
  // the walk being measured: where and when it started
  let run: { x0: number; at: number; dir: number; seen: boolean } | null = null;
  let lastV = 0;
  // the friend's robot as the host sees it: (time, y) of each frame of the walk going on
  let seen: { t: number; y: number }[] = [];
  let lastY = NaN;
  let still = 0;
  const judge = (): void => {
    // an even walk is a straight line of time against place: how far was the worst frame from one?
    if (seen.length >= 8) {
      const speed = BASE_SPEED / TICK_MS; // tiles a millisecond
      const sign = Math.sign(seen[seen.length - 1].y - seen[0].y) || 1;
      const off = seen.map((s) => (s.y - seen[0].y) * sign - (s.t - seen[0].t) * speed);
      // (leave out the last frames: the walk ends at a wall or a let-go)
      const body = off.slice(0, -3);
      const mid = (Math.max(...body) + Math.min(...body)) / 2;
      other.worst = Math.max(other.worst, ...body.map((o) => Math.abs(o - mid) / BASE_SPEED));
      other.frames += body.length;
    }
    seen = [];
  };

  let hostFrame = 0;
  let friendFrame = 0;
  let serverAt = 0;
  const end = secs * 1000;
  for (; now < end; now += 0.5) {
    if (now >= serverAt) {
      serverAt += 8;
      room.advance(now);
    }
    host.pump();
    friend.pump();
    if (now >= friendFrame) {
      friendFrame += friend.frameMs;
      friend.frame(thumb(now - 900 - 250, UP, DOWN)); // (the friend starts in the bottom right corner)
    }
    if (now >= hostFrame) {
      hostFrame += host.frameMs;
      const v = thumb(now - 900, RIGHT, LEFT);
      const before = host.pred ? host.pred.view().players[0].x : 0;
      host.frame(v);
      if (!host.pred) continue;
      const me = host.pred.view().players[0];
      if (v !== lastV) {
        if (v) {
          run = { x0: before, at: now, dir: v === RIGHT ? 1 : -1, seen: false };
          presses++;
        } else run = null;
        lastV = v;
      }
      if (run) {
        // your own robot: on an even walk from the moment of the press
        const walked = (me.x - run.x0) * run.dir;
        if (!run.seen && walked > 1e-9) {
          run.seen = true;
          pressDelay = Math.max(pressDelay, now - run.at);
        }
        const ideal = ((now - run.at) / TICK_MS) * BASE_SPEED;
        // (until it reaches the end of its tile's room: the walls of the corner it starts in)
        if (me.x > 1.02 && me.x < 1.98) {
          own.worst = Math.max(own.worst, Math.abs(walked - ideal) / BASE_SPEED);
          own.frames++;
        }
      }
      // the friend's robot on the host's screen
      const y = host.pred.view().players[1].y;
      if (!Number.isNaN(lastY)) {
        if (y !== lastY) {
          still = 0;
          seen.push({ t: now, y });
        } else if (seen.length && ++still >= 4) judge();
      }
      lastY = y;
    }
  }
  judge();
  return { room, host, friend, own, other, pressDelay, presses };
}

// ---------------------------------------------------------------- a good connection, a poor one, a bad one

for (const [name, link, frameMs, limits] of [
  ['a wired connection', [4, 2, 0], 1000 / 60, { own: 1.6, other: 1.6, late: 0 }],
  ['a phone on a good connection, 120 frames a second', [22, 12, 0.01], 1000 / 120, { own: 1.6, other: 2.6, late: 3 }],
  ['a phone on a poor connection', [45, 35, 0.02], 1000 / 60, { own: 2.1, other: 4.1, late: 6 }],
  ['a bad connection', [90, 60, 0.03], 1000 / 60, { own: 2.6, other: 5.1, late: 10 }],
] as const) {
  const r = play(11, [...link] as [number, number, number], frameMs, 24);
  const st = r.host.pred!.stats();
  const say = `${name} (${link[0]}–${link[0] + link[1]} ms each way)`;
  assert.ok(r.presses >= 40, `${say}: ${r.presses} presses were made`);
  assert.ok(st.synced, `${say}: the clock was set`);
  // your own robot: moving within a frame of the press, and never more than a tick or two from an even walk
  assert.ok(r.pressDelay <= frameMs * 2 + 0.5, `${say}: your robot moves at once (worst ${r.pressDelay.toFixed(1)} ms after the press)`);
  assert.ok(r.own.frames > 300 && r.own.worst <= limits.own, `${say}: your robot walks evenly (worst ${r.own.worst.toFixed(2)} ticks off, limit ${limits.own})`);
  // the other robot: an even walk too
  assert.ok(r.other.frames > 300 && r.other.worst <= limits.other, `${say}: the other robot walks evenly (worst ${r.other.worst.toFixed(2)} ticks off, limit ${limits.other})`);
  // the server's world on each page is the server's
  for (const p of [r.host, r.friend]) {
    const s = p.pred!.stats();
    assert.ok(s.checks > 30 && s.misses === 0, `${say}: ${p.key}'s world is the server's (${s.checks} checksums)`);
    assert.ok(Math.abs(p.world!.tick - r.room.world!.tick) < 30, `${say}: ${p.key} keeps up`);
  }
  // presses reach the server in time for their tick (a few may not, on a spike; those are put right)
  assert.ok(st.corrections <= limits.late, `${say}: presses arrive in time (${st.corrections} ticks put right, limit ${limits.late})`);
  // the picture is ahead of the server by about the trip there and back, and no more
  const trip = (2 * link[0] + link[1]) / TICK_MS;
  assert.ok(st.ahead >= trip - 1 && st.ahead <= trip + 2 * (link[1] / TICK_MS) + 9, `${say}: the picture runs ${st.ahead} ticks ahead (the trip is ${trip.toFixed(1)})`);
  console.log(
    `  ${say}: own robot ${r.pressDelay.toFixed(0)} ms to move, ${r.own.worst.toFixed(2)} ticks off even; other robot ${r.other.worst.toFixed(2)} ticks off even; ${st.corrections} late; picture ${st.ahead} ticks ahead, others ${st.behind} back`,
  );
}

// ---------------------------------------------------------------- a press that arrives late is put right

{
  now = 0;
  const rng = makeRng(3);
  const room = new Room('BCDF', makeRng(4));
  const host = new Page('host', room, rng, [30, 0, 0], 1000 / 60);
  const friend = new Page('friend', room, rng, [30, 0, 0], 1000 / 60);
  host.member = room.hello(host.conn, { t: 'hello', id: 'host', name: '', colorId: 'gold', dance: 'party', create: true, pv: PROTOCOL }, now);
  friend.member = room.hello(friend.conn, { t: 'hello', id: 'friend', name: '', colorId: 'blue', dance: 'party', create: false, pv: PROTOCOL }, now);
  room.message(host.member!, { t: 'setup', setup: { ...room.setup, cpus: [], timerOn: false, lives: 5, arena: 'compact' } }, now);
  room.message(host.member!, { t: 'start' }, now);
  let v = 0;
  let frameAt = 0;
  let serverAt = 0;
  const until = (ms: number, each?: () => void): void => {
    for (const end = now + ms; now < end; now += 0.5) {
      if (now >= serverAt) {
        serverAt += 8;
        room.advance(now);
      }
      host.pump();
      friend.pump();
      if (now >= frameAt) {
        frameAt += 1000 / 60;
        host.frame(v);
        friend.frame(0);
        each?.();
      }
    }
  };
  until(3000);
  assert.strictEqual(host.pred!.stats().corrections, 0);
  // the next press is held up 120 ms on its way (the link jams), far longer than the clock allows for
  const jam = host.up;
  const send = jam.send.bind(jam);
  let held: string[] = [];
  jam.send = (t) => void held.push(t);
  v = packInput({ dir: 4, a: false, b: false });
  until(120);
  const ahead = host.pred!.view().players[0].x;
  assert.ok(ahead > 1.2, 'your robot walks in the picture meanwhile');
  assert.strictEqual(room.world!.players[0].x, 1, 'though the server has not heard yet');
  jam.send = send;
  for (const t of held) send(t);
  held = [];
  until(400);
  // the picture was put right: it shows where the server's robot will be, and they agree once you stop
  assert.ok(host.pred!.stats().corrections > 0, 'the late press was noticed');
  v = 0;
  until(500);
  assert.strictEqual(host.pred!.view().players[0].x, room.world!.players[0].x, 'the picture and the server agree once you stop');
  assert.strictEqual(host.pred!.stats().misses, 0);

  // sounds: your own bomb is heard the moment you press, and once; the blast once, on both pages
  const before = { ...host.sounds };
  const theirs = { ...friend.sounds };
  v = packInput({ dir: 0, a: true, b: false });
  let placedAt = -1;
  until(1000 / 60 + 1, () => {
    if (placedAt < 0 && (host.sounds.place ?? 0) > (before.place ?? 0)) placedAt = now;
  });
  assert.ok(placedAt >= 0, 'the bomb is heard on the frame of the press');
  assert.strictEqual(room.world!.bombs.length, 0, 'before the server has even heard of it');
  v = 0;
  until(4000);
  assert.strictEqual((host.sounds.place ?? 0) - (before.place ?? 0), 1, 'your bomb is heard once on your page');
  assert.strictEqual((friend.sounds.place ?? 0) - (theirs.place ?? 0), 1, 'and once on the other');
  assert.strictEqual((host.sounds.explode ?? 0) - (before.explode ?? 0), 1, 'the blast is heard once on your page');
  assert.strictEqual((friend.sounds.explode ?? 0) - (theirs.explode ?? 0), 1, 'and once on the other');
  assert.strictEqual((host.sounds.death ?? 0) - (before.death ?? 0), 1, 'a knock-out is heard once (on the server’s word)');

  // the whole world sent again (out of step, or back after a dropped connection): the round carries on
  host.say({ t: 'sync' });
  v = packInput({ dir: 4, a: false, b: false });
  until(3000);
  assert.ok(host.pred!.stats().synced && host.pred!.stats().misses === 0, 'the round carries on from the world sent again');
  assert.ok(room.world!.players[0].x > 1.5, 'and presses reach the server as before');
}

console.log('online feel checks passed');
