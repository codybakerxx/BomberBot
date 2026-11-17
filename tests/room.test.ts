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
import { ARENAS, MAPS, defaultRules, itemChances, defaultSetup, fixedSize, joinTeam, lineUp, readSetup, recolourTeam, rollCpus, splitTeams, summary, swapTeams, teamChoices, teamSizes, teamsFor, wholeTile, worldConfig } from '../src/setup';
import { BOT_LEVELS } from '../src/bot';
import { DANCE_IDS } from '../src/dances';
import type { World } from '../src/sim';

assert.deepStrictEqual(COLOR_IDS, COLORS.map((c) => c.id), 'the server knows the same robots as the page');

// Reset to Default keeps the arena picked and puts in that arena's own round length and closing-in speed
for (const a of ARENAS) {
  const messy = { ...defaultSetup('gold'), arena: a.id, roundSecs: 250, closeIn: 0, firstTo: 4, lives: 3 };
  const r = defaultRules(messy, 'gold');
  assert.strictEqual(r.arena, a.id, `Reset to Default stays on ${a.name}`);
  assert.ok(r.roundSecs === a.roundSecs && r.closeIn === a.closeIn, `and uses ${a.name}'s timer and closing in`);
  assert.ok(r.firstTo === 1 && r.lives === 1, 'the other rules go back to their defaults');
}

// the map (how the arena looks) and Randomize CPUs are part of the setup: read back, kept by Reset to Default
{
  const d = defaultSetup('gold');
  assert.ok(d.map === 'midnight' && !d.randEmotes && !d.randLevels, 'a new setup: the first map, nothing random');
  const saved = readSetup({ ...d, map: 'western', randEmotes: true, randLevels: true }, 'gold', COLOR_IDS);
  assert.ok(saved.map === 'western' && saved.randEmotes && saved.randLevels, 'they are read back');
  assert.strictEqual(readSetup({ ...d, map: 'moon' }, 'gold', COLOR_IDS).map, 'midnight', 'a map that does not exist is the first map');
  const r = defaultRules({ ...saved, lives: 4 }, 'gold');
  assert.ok(r.map === 'western' && r.randEmotes && r.randLevels && r.lives === 1, 'Reset to Default keeps the map and Randomize CPUs');
  assert.ok(summary(saved).includes('Wild West') && !summary(d).includes(MAPS[0].name), 'the summary names a map other than the first');
  // every size on every map: the map changes nothing the rules see
  for (const a of ARENAS) assert.deepStrictEqual({ ...defaultRules({ ...saved, arena: a.id }, 'gold'), map: 'midnight' }, { ...defaultRules({ ...saved, arena: a.id, map: 'midnight' }, 'gold') });

  // Randomize CPUs: a new list each time, the cards' own left alone, and only what is switched on changes
  const rng = makeRng(5);
  const cards = JSON.stringify(saved.cpus);
  const levels = new Set<string>();
  const dances = new Set<string>();
  for (let i = 0; i < 60; i++) {
    for (const c of rollCpus(saved, rng)) {
      assert.ok(BOT_LEVELS.includes(c.level) && DANCE_IDS.includes(c.dance!));
      levels.add(c.level);
      dances.add(c.dance!);
    }
  }
  assert.strictEqual(JSON.stringify(saved.cpus), cards, 'the lobby keeps the levels and emotes on the cards');
  assert.ok(levels.size === BOT_LEVELS.length && dances.size === DANCE_IDS.length, 'every level and every emote turns up');
  assert.deepStrictEqual(rollCpus({ ...saved, randEmotes: false, randLevels: false }, rng), saved.cpus, 'off: as on the cards');
  assert.ok(rollCpus({ ...saved, randLevels: false }, rng).every((c, i) => c.level === saved.cpus[i].level), 'emotes only: levels as on the cards');
  assert.deepStrictEqual(rollCpus(saved, () => 0.999999).map((c) => c.level), saved.cpus.map(() => BOT_LEVELS[BOT_LEVELS.length - 1]), 'the top of the range is the last level');
}

// a custom power-up mix with Lots of everything asks for more than every brick: scaled down to fit
{
  const lots = { ...defaultSetup('gold'), itemsOn: true, items: { bomb: 3, fire: 3, speed: 3, kick: 3, grab: 3, shield: 3, curse: 3 } };
  const c = itemChances(lots);
  const sum = c.reduce((n, [, x]) => n + x, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `at most every brick (${sum})`);
  assert.ok(Math.abs(c[0][1] / c[2][1] - 0.1875 / 0.1375) < 1e-9, 'in the same proportions');
}

// the arena is a whole number of page pixels on a screen of density 3 (an iPhone), so it is never stretched
for (const [cols, rows] of [[11, 9], [13, 11], [15, 13], [17, 15]]) {
  for (let T = 30; T <= 120; T++) {
    const t = wholeTile(T, cols, rows, 3);
    assert.ok(t <= T && T - t <= 2, `a tile gives up at most 2 screen pixels (${T} → ${t})`);
    assert.ok(Number.isInteger((t * cols) / 3) && Number.isInteger((t * rows) / 3), `${cols}×${rows} at ${t}: whole page pixels`);
  }
}
assert.strictEqual(wholeTile(80, 13, 11, 2), 80, 'at density 2 any even tile already fits');

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

// Randomize CPUs online, on the Wild West map: the server picks, the seats tell every page, the lobby's cards stay
{
  const room2 = new Room('GHJK', makeRng(3));
  const h = new Page('h2');
  h.member = room2.hello(h.conn, { t: 'hello', id: 'h2', name: 'Cody', colorId: 'gold', dance: 'spin', create: true, pv: PROTOCOL }, now);
  const first = h.last('room')!.setup;
  room2.message(h.member!, { t: 'setup', setup: { ...first, map: 'western', randEmotes: true, randLevels: true, timerOn: false } }, now);
  const lobby = h.last('room')!.setup;
  assert.ok(lobby.map === 'western' && lobby.randEmotes && lobby.randLevels, 'the room keeps the map and Randomize CPUs');
  const seen = new Set<string>();
  room2.message(h.member!, { t: 'start' }, now);
  for (let i = 0; i < 12; i++) {
    const seats = h.last('round')!.seats;
    const cpus = seats.filter((s) => s.member === null);
    assert.strictEqual(cpus.length, lobby.cpus.length);
    for (const c of cpus) {
      assert.ok(c.level && BOT_LEVELS.includes(c.level) && DANCE_IDS.includes(c.dance), 'each CPU seat says its level and emote');
      seen.add(`${c.level}/${c.dance}`);
    }
    assert.strictEqual(seats[0].level, undefined, 'a person has no level');
    assert.strictEqual(seats[0].dance, 'spin', 'and keeps their own emote');
    room2.message(h.member!, { t: 'restart' }, now); // a new match: picked afresh
  }
  assert.ok(seen.size > 4, `the picks change from match to match (${seen.size} different)`);
  assert.deepStrictEqual(h.last('room')!.setup.cpus, lobby.cpus, 'the cards in the lobby are as the host left them');
}

// teams online: the server's round has the sides, and every robot on the winning side gets the point
{
  const room3 = new Room('TEAM', makeRng(5));
  const h = new Page('h3');
  h.member = room3.hello(h.conn, { t: 'hello', id: 'h3', name: 'Cody', colorId: 'gold', dance: 'spin', create: true, pv: PROTOCOL }, now);
  const first = h.last('room')!.setup;
  const cpus = first.cpus.map((c) => c.colorId);
  const teams = Object.fromEntries(['gold', ...cpus].map((c, i) => [c, i < 2 ? 0 : 1]));
  room3.message(h.member!, { t: 'setup', setup: { ...first, teamsOn: true, friendlyFire: false, teams, firstTo: 2, timerOn: false } }, now);
  room3.message(h.member!, { t: 'start' }, now);
  const cfg = h.last('round')!.cfg;
  assert.deepStrictEqual(cfg.teams, [0, 0, 1, 1], 'the round the server sends has the sides');
  assert.strictEqual(cfg.friendlyFire, false);
  const w = room3.world!;
  for (const x of [w, h.world!]) for (const p of x.players) if (p.team === 1) Object.assign(p, { alive: false, lives: 0, respawnAt: -1 });
  let t = now + 3000;
  for (let i = 0; i < 40 && !w.over; i++) room3.advance((t += 100));
  assert.strictEqual(w.over?.team, 0, 'the red side wins');
  assert.deepStrictEqual(room3.score.wins, [1, 1, 0, 0], 'a point each for both robots on it');
}

// teams: split half and half, balanced as players come and go, kept through colour swaps and saving
{
  const s = defaultSetup('gold');
  const four = ['gold', 'black', 'pink', 'blue'];
  assert.equal(s.teamsOn, false, 'teams are off to start with');
  assert.equal(s.friendlyFire, false, 'and friendly fire is off');
  assert.equal(worldConfig(s, 'gold', 1).teams, undefined, 'off: every robot for itself');
  splitTeams(s, four);
  assert.deepStrictEqual(teamsFor(s, four), [0, 0, 1, 1], 'half and half, in player order');
  splitTeams(s, ['gold', 'black', 'pink']);
  assert.deepStrictEqual(teamsFor(s, ['gold', 'black', 'pink']), [0, 0, 1], 'an odd number: red has one more');
  // someone new goes on the smaller side
  splitTeams(s, four);
  assert.deepStrictEqual(teamsFor(s, [...four, 'red']), [0, 0, 1, 1, 0]);
  s.teams.black = 1;
  assert.deepStrictEqual(teamsFor(s, [...four, 'red']), [0, 1, 1, 1, 0]);
  // never only one side
  s.teams = { gold: 0, black: 0, pink: 0, blue: 0 };
  assert.deepStrictEqual(teamsFor(s, four), [0, 0, 0, 1]);
  // a CPU player gives its colour up to you: you each keep your side
  s.teams = { gold: 0, black: 0, pink: 1, blue: 1 };
  swapTeams(s, 'gold', 'pink');
  assert.deepStrictEqual(s.teams, { gold: 1, black: 0, pink: 0, blue: 1 });
  // into the world, and read back as saved
  s.teamsOn = true;
  s.friendlyFire = true;
  s.cpus = [{ colorId: 'black', level: 'normal' }, { colorId: 'gold', level: 'normal' }, { colorId: 'blue', level: 'normal' }];
  const cfg = worldConfig(s, 'pink', 1);
  assert.deepStrictEqual(cfg.teams, [0, 0, 1, 1]);
  assert.equal(cfg.friendlyFire, true);
  const back = readSetup(JSON.parse(JSON.stringify(s)), 'pink', COLOR_IDS);
  assert.equal(back.teamsOn, true);
  assert.equal(back.friendlyFire, true);
  assert.deepStrictEqual(back.teams, s.teams);
  assert.deepStrictEqual(readSetup({ ...s, teams: { gold: 9, nope: 1, blue: 1 } }, 'pink', COLOR_IDS).teams, { blue: 1 }, 'only real colours and teams are kept');
  assert.equal(defaultRules(s, 'pink').teamsOn, true, 'Reset to Default on the Match page leaves the teams alone');
  assert.ok(summary(s).includes('Teams, friendly fire'));

  // team size: Custom (the default) or teams all one size, as the players divide into them
  const eight = ['gold', 'black', 'pink', 'blue', 'red', 'orange', 'white', 'green'];
  assert.deepStrictEqual([2, 3, 4, 5, 6, 7, 8].map((n) => teamSizes(n)), [[], [], [2], [], [2, 3], [], [2, 4]], 'only sizes the players divide into');
  const t = defaultSetup('gold');
  assert.equal(t.teamSize, 0, 'Custom to start with');
  t.teamsOn = true;
  assert.deepStrictEqual(teamsFor(t, eight), [0, 0, 0, 0, 1, 1, 1, 1], 'two teams to start with');
  t.teamSize = 2;
  splitTeams(t, eight);
  assert.deepStrictEqual(teamsFor(t, eight), [0, 0, 1, 1, 2, 2, 3, 3], 'teams of two');
  assert.equal(lineUp(t, eight), '2 v 2 v 2 v 2');
  // a tap where a name is: the whole team takes the next colour no other team has
  assert.equal(recolourTeam(t, eight, 0), 4, 'red becomes purple (blue, green and yellow are taken)');
  assert.deepStrictEqual(teamsFor(t, eight), [4, 4, 1, 1, 2, 2, 3, 3], 'and everyone on it changes with it');
  // teams of two: the ‹ › goes through the teams there are, and a full team swaps a robot over
  assert.deepStrictEqual(teamChoices(t, eight, 'gold'), [1, 2, 3, 4]);
  assert.ok(joinTeam(t, eight, 'gold', 2));
  assert.deepStrictEqual(teamsFor(t, eight), [2, 4, 1, 1, 2, 4, 3, 3], 'gold joins green; green’s last robot takes its place');
  assert.equal(lineUp(t, eight), '2 v 2 v 2 v 2', 'every team still two');
  // dropped on a robot: that one stays, the other one swaps over
  assert.ok(joinTeam(t, eight, 'white', 1, 'pink'));
  assert.deepStrictEqual(teamsFor(t, eight), [2, 4, 1, 3, 2, 4, 1, 3]);
  // split again: the teams keep their colours
  t.teamSize = 4;
  splitTeams(t, eight);
  assert.deepStrictEqual(teamsFor(t, eight), [2, 2, 2, 2, 4, 4, 4, 4], 'teams of four, keeping the first two colours');
  // a player more: the size no longer fits, so it is Custom, and the new robot joins the smallest team
  assert.equal(fixedSize(t, 9), 0);
  // Custom: every colour can be picked; a colour nobody has starts a team; never down to one team
  t.teamSize = 0;
  assert.deepStrictEqual(teamChoices(t, eight, 'gold'), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.ok(joinTeam(t, eight, 'gold', 6));
  assert.equal(lineUp(t, eight), '4 v 3 v 1');
  const two = ['gold', 'black'];
  const u = defaultSetup('gold');
  u.teamsOn = true;
  splitTeams(u, two);
  assert.ok(!joinTeam(u, two, 'black', 0), 'one against one: neither can join the other');
  assert.ok(!teamChoices(u, two, 'black').includes(0));
  // a size that was in force, upset by a player coming: split again so every team is that size
  const v = defaultSetup('gold');
  v.teamsOn = true;
  v.teamSize = 2;
  const quad = ['gold', 'black', 'pink', 'blue'];
  splitTeams(v, quad);
  v.teams = { gold: 0, black: 0, pink: 0, blue: 1 };
  assert.deepStrictEqual(teamsFor(v, quad), [0, 0, 1, 1]);
  assert.equal(readSetup({ ...v, teamSize: 3 }, 'gold', COLOR_IDS).teamSize, 3);
  assert.equal(readSetup({ ...v, teamSize: 9 }, 'gold', COLOR_IDS).teamSize, 4);
}

console.log('room checks passed');
