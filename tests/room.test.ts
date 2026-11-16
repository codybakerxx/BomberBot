/**
 * Checks of online rooms (src/room.ts, src/net.ts), with made-up connections and a made-up clock: making and
 * joining a room by code, robots staying different, only the host setting up and starting, a whole match played
 * through with every page's own copy of the world staying the same as the server's, only the host moving on
 * and restarting, and a dropped page coming back in the middle of a round.
 * Run with: npm test
 */
import assert from 'node:assert';
import { COLORS } from '../src/render';
import { step } from '../src/sim';
import { Room, COLOR_IDS, LEAD_MS, TICK_MS, type Conn, type Member } from '../src/room';
import {
  decodeWorld,
  packInput,
  readCode,
  roundWorld,
  tickCodes,
  unpackInput,
  worldHash,
  makeCode,
  PROTOCOL,
  type ClientMsg,
  type ServerMsg,
} from '../src/net';
import { makeRng } from '../src/sim';
import type { World } from '../src/sim';

assert.deepStrictEqual(COLOR_IDS, COLORS.map((c) => c.id), 'the server knows the same robots as the page');

// room codes
const rng = makeRng(7);
for (let i = 0; i < 50; i++) {
  const code = makeCode(rng);
  assert.strictEqual(readCode(code.toLowerCase()), code, 'a code reads back, typed in either case');
}
assert.strictEqual(readCode('bc-df'), 'BCDF');
assert.strictEqual(readCode('ABCD'), '', 'vowels are never in a code');
for (let i = 0; i < 4; i++) assert.ok(readCode(makeCode(rng)), 'a made code is a code');

// inputs
for (let v = 0; v < 32; v++) if ((v & 7) <= 4) assert.strictEqual(packInput(unpackInput(v)), v);

/** A page: its connection, what it was sent, and its own copy of the round. */
class Page {
  sent: ServerMsg[] = [];
  closed = false;
  world: World | null = null;
  checked = 0;
  member: Member | null = null;
  /** the number the server gave for this round's presses, how many have been sent, and the server's acks */
  ep = 0;
  n = 0;
  acks: number[] = [];
  conn: Conn = {
    send: (t) => {
      const m = JSON.parse(t) as ServerMsg;
      this.sent.push(m);
      this.take(m);
    },
    close: () => {
      this.closed = true;
    },
  };
  constructor(public key: string) {}
  last<T extends ServerMsg['t']>(t: T): Extract<ServerMsg, { t: T }> | undefined {
    for (let i = this.sent.length - 1; i >= 0; i--) if (this.sent[i].t === t) return this.sent[i] as Extract<ServerMsg, { t: T }>;
    return undefined;
  }
  /** what a page does with a round, its ticks and a whole world (online.ts does the same) */
  take(m: ServerMsg): void {
    if (m.t === 'round' || m.t === 'snap') {
      this.world = m.t === 'round' ? roundWorld(m.cfg) : decodeWorld(m.world);
      this.ep = m.ep;
      this.n = 0;
    } else if (m.t === 'ticks' && this.world) {
      if (m.a) this.acks = m.a;
      assert.strictEqual(m.from, this.world.tick + 1, `${this.key}: ticks arrive in order`);
      for (const t of m.i) {
        step(this.world, tickCodes(t).map(unpackInput));
        if (m.sum && m.sum[0] === this.world.tick) {
          assert.strictEqual(worldHash(this.world), m.sum[1], `${this.key}: same world as the server at tick ${this.world.tick}`);
          this.checked++;
        }
      }
    }
  }
}

let now = 1000;
const room = new Room('BCDF', makeRng(99));
const hello = (p: Page, create: boolean, colorId = 'gold', name = ''): Member | null =>
  (p.member = room.hello(p.conn, { t: 'hello', id: p.key, name, colorId, dance: 'spin', create, pv: PROTOCOL }, now));
const say = (p: Page, msg: ClientMsg): void => room.message(p.member!, msg, now);
/** What a page presses, for the tick `ahead` after the server's next (0: as soon as it can be). */
const press = (p: Page, v: number, ahead = 0): void => say(p, { t: 'in', v, k: (room.world?.tick ?? 0) + 1 + ahead, n: ++p.n, e: p.ep });

// a page left open from before an update is told to reload
{
  const old = new Page('old');
  assert.strictEqual(room.hello(old.conn, { t: 'hello', id: 'old', name: '', colorId: 'gold', dance: 'party', create: true }, now), null);
  assert.ok(old.closed && /reload/i.test(old.last('error')!.why), 'an out-of-date page is turned away, and told to reload');
  assert.ok(room.empty(), 'and makes no room');
}

// nobody can join a room that does not exist
const lost = new Page('lost');
assert.strictEqual(hello(lost, false), null);
assert.ok(lost.closed && lost.last('error'));

const host = new Page('host');
assert.ok(hello(host, true, 'blue', 'Cody'));
let info = host.last('room')!;
assert.strictEqual(info.host, info.you, 'the one who makes the room hosts it');
assert.strictEqual(info.members[0].colorId, 'blue');
assert.strictEqual(info.members[0].name, 'Cody');
assert.strictEqual(info.setup.cpus.length, 3, 'a new room starts with three CPU players');
assert.ok(!info.setup.cpus.some((c) => c.colorId === 'blue'));

// the code is taken now
const twin = new Page('twin');
assert.strictEqual(hello(twin, true), null, 'a code in use cannot be made again');

// a friend joins asking for the host's robot: they get another
const friend = new Page('friend');
assert.ok(hello(friend, false, 'blue', '<b>Sam</b>'));
info = friend.last('room')!;
const me = info.members.find((m) => m.id === info.you)!;
assert.notStrictEqual(me.colorId, 'blue', 'two people never wear the same robot');
assert.strictEqual(me.name, 'bSam/b', 'names lose anything that could be markup');
assert.notStrictEqual(info.host, info.you);

// the friend takes a CPU player's robot: the CPU player gets the friend's
const cpuColour = info.setup.cpus[0].colorId;
const old = me.colorId;
say(friend, { t: 'me', colorId: cpuColour, ready: true, dance: 'wave', name: 'Sam' });
info = host.last('room')!;
assert.strictEqual(info.members[1].colorId, cpuColour);
assert.ok(info.members[1].ready);
assert.strictEqual(info.setup.cpus[0].colorId, old, 'the CPU player took the robot the friend had');
// and cannot take the host's
say(friend, { t: 'me', colorId: 'blue', ready: true, dance: 'wave', name: 'Sam' });
assert.strictEqual(host.last('room')!.members[1].colorId, cpuColour);

// only the host sets up and starts
const before = JSON.stringify(host.last('room')!.setup);
say(friend, { t: 'setup', setup: { ...info.setup, firstTo: 9 } });
say(friend, { t: 'start' });
assert.strictEqual(JSON.stringify(host.last('room')!.setup), before, 'a guest cannot change the setup');
assert.ok(!host.last('room')!.playing, 'a guest cannot start');
say(host, { t: 'setup', setup: { ...info.setup, firstTo: 2, cpus: [{ colorId: 'blue', level: 'hard' }], arena: 'compact', timerOn: false } });
info = host.last('room')!;
assert.strictEqual(info.setup.firstTo, 2);
assert.strictEqual(info.setup.cpus.length, 1);
assert.notStrictEqual(info.setup.cpus[0].colorId, 'blue', 'a CPU player cannot wear a person’s robot');

say(host, { t: 'start' });
assert.ok(host.last('room')!.playing);
const round = friend.last('round')!;
assert.strictEqual(round.seats.length, 3);
assert.deepStrictEqual(
  round.seats.map((s) => s.member === null),
  [false, false, true],
  'people first, then the CPU players',
);

/** Run the clock on, a tick at a time, with each person's inputs from `drive`. */
function run(ms: number, drive?: (tick: number) => void): void {
  const end = now + ms;
  while (now < end) {
    now += TICK_MS;
    drive?.(room.world?.tick ?? 0);
    room.advance(now);
    if (room.world?.bombs.some((b) => b.owner === 1)) friendBombed = true;
  }
}
let friendBombed = false;
run(LEAD_MS + 2000, (t) => {
  // the host walks and drops a bomb; the friend taps B very quickly (pressed and let go between ticks)
  press(host, packInput({ dir: t % 120 < 60 ? 4 : 3, a: t % 50 === 0, b: false })); // right, then left
  if (t % 37 === 0) {
    press(friend, packInput({ dir: 0, a: true, b: false }));
    press(friend, 0);
  }
});
assert.ok(room.world!.tick > 100, 'the round is being stepped');
assert.ok(host.checked > 2 && friend.checked > 2, 'checksums were compared');
assert.ok(friendBombed, 'a quick tap of A, let go before the next tick, still drops a bomb');
assert.ok(host.acks[0] > 50 && host.acks[1] > 2 && host.acks[2] === 0, 'the server says how far it has taken in each person’s presses');

// a press says which tick it is for, and the server keeps it until then
{
  const at = room.world!.tick;
  const x = room.world!.players[0].x;
  press(host, 0);
  run(5 * TICK_MS);
  const still = room.world!.players[0].x;
  press(host, packInput({ dir: 4, a: false, b: false }), 6); // right, for seven ticks from now
  const sent = room.world!.tick;
  run(5 * TICK_MS);
  assert.strictEqual(room.world!.players[0].x, still, 'a press for a later tick waits for it');
  run(20 * TICK_MS);
  const codes = host.sent.filter((m): m is Extract<ServerMsg, { t: 'ticks' }> => m.t === 'ticks' && m.from > at).flatMap((m) => m.i.map((t, k) => [m.from + k, tickCodes(t)[0]] as const));
  const first = codes.find(([, c]) => (c & 7) === 4)!;
  assert.strictEqual(first[0], sent + 7, 'and is taken in on exactly that tick');
  void x;
  // presses from before the world was sent again (another round, a reconnect) are dropped
  say(host, { t: 'in', v: packInput({ dir: 3, a: false, b: false }), k: room.world!.tick + 1, n: ++host.n, e: host.ep - 1 });
  run(3 * TICK_MS);
  assert.notStrictEqual(room.world!.players[0].facing, 3, 'a press for an earlier round is ignored');
  // a ping is answered with where the round's clock stands
  host.sent.length = 0;
  say(host, { t: 'ping', c: 7 });
  const pong = host.last('pong')!;
  assert.ok(pong.c === 7 && typeof pong.d === 'number' && Math.abs(pong.d - (room.world!.tick + 1)) < 1.01, 'a pong says where the round’s clock stands');
}

// a dropped page comes back in the middle of the round and carries on in step
room.disconnect(friend.member!, friend.conn, now);
run(500);
const back = new Page('friend');
hello(back, false);
assert.ok(back.last('snap'), 'a page that comes back is sent the round as it is');
assert.strictEqual(back.world!.tick, room.world!.tick);
run(2000);
assert.ok(back.checked > 0, 'and stays in step after');

// play the rest of the round: everyone stands still, the CPU player hunts
press(host, 0);
run(10 * 60 * 1000);
assert.ok(room.world!.over, 'the round ends');
assert.ok(!room.busy() || room.world!.tick > 0);
// only the host moves on
const n = room.score.roundNo;
say(back, { t: 'next' });
assert.strictEqual(room.score.roundNo, n, 'a guest cannot start the next round');
say(back, { t: 'restart' });
assert.strictEqual(room.score.roundNo, n, 'a guest cannot restart');
say(host, { t: 'next' });
assert.strictEqual(room.score.roundNo, n + 1, 'the host starts the next round');
say(host, { t: 'restart' });
assert.strictEqual(room.score.roundNo, 1, 'the host restarts the match from round 1');
assert.ok(room.score.wins.every((w) => w === 0));

// the host takes everyone back to the lobby; Ready has to be pressed again
say(host, { t: 'lobby' });
info = back.last('room')!;
assert.ok(!info.playing && info.members.every((m) => !m.ready));

// a host gone for a while hands the room on
room.disconnect(host.member!, host.conn, now);
room.housekeep(now + 20_000);
assert.strictEqual(back.last('room')!.host, back.last('room')!.you, 'the friend hosts now');

console.log('room checks passed');
