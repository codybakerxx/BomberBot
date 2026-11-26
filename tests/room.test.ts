/**
 * Checks of online rooms (src/room.ts, src/net.ts), with made-up connections and a made-up clock: making and
 * joining a room by code, robots staying different, only the host setting up and starting, a whole match played
 * through with every page's own copy of the world staying the same as the server's, only the host moving on
 * and restarting, and a dropped page coming back in the middle of a round.
 * Run with: npm test
 */
import assert from 'node:assert';
import { COLORS } from '../src/render';
import { createWorld, ITEM_CHANCE, SOFT, step, AIM_STEPS, MAX_BOMBS, MAX_FIRE, MAX_SPEED_ITEMS } from '../src/sim';
import { Room, COLOR_IDS, LEAD_MS, TICK_MS, AWAY_MS, HOST_AWAY_MS, CHAT_GAP_MS, type Conn, type Member } from '../src/room';
import {
  decodeWorld,
  packInput,
  IN_ALL,
  newQueue,
  takeInput,
  tickText,
  readCode,
  roundWorld,
  tickCodes,
  unpackInput,
  worldHash,
  makeCode,
  PROTOCOL,
  CHAT_MAX,
  type ClientMsg,
  type ServerMsg,
} from '../src/net';
import { makeRng } from '../src/sim';
import { ARENAS, MAPS, ITEM_SHARE_STEP, type MatchSetup, defaultRules, itemChances, defaultSetup, dropOnto, fixedSize, lineUp, pickTeam, readSetup, recolour, rollCpus, seatLast, seating, setTeamSize, settleTeams, evenTeams, startTeams, summary, swapTeams, canEven, RULE_GROUPS, resetGroup, groupIsDefault, groupValues, ITEM_NORMAL, ITEM_RARE, ITEM_VERY_RARE, modeOf, hardcoreRules, rollRules, rulesKey, settleMode, ROUND_STEP, SOUND_GROUPS, SOUND_NAMES, teamChoices, teamSizes, teamsFor, wearsCrown, wholeTile, worldConfig } from '../src/setup';
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

// Power-ups (the owner's ask, 19 November 2026) says how many bricks hide a power-up; the mix, usual or
// custom, only says which: Lots of everything is the usual mix, and the total is still Power-ups
{
  const sum = (c: [string, number][]): number => c.reduce((n, [, x]) => n + x, 0);
  assert.equal(defaultSetup('gold').itemShare, 60, '60% by default');
  assert.deepStrictEqual(itemChances(defaultSetup('gold')), ITEM_CHANCE, 'the default setup gives the usual chances');
  const lots = { ...defaultSetup('gold'), itemsOn: true, items: { bomb: 4, fire: 4, speed: 4, kick: 4, grab: 4, shield: 4, curse: 4, laptop: 4, decoy: 4, wire: 4 } };
  const c = itemChances(lots);
  assert.ok(Math.abs(sum(c) - 0.6) < 1e-12, `still 60% of the bricks (${sum(c)})`);
  assert.ok(Math.abs(c[0][1] / c[2][1] - 60 / 44) < 1e-9, 'in the usual proportions');
  for (let p = 0; p <= 100; p += ITEM_SHARE_STEP) {
    for (const itemsOn of [false, true]) {
      const t = sum(itemChances({ ...lots, itemsOn, itemShare: p }));
      assert.ok(Math.abs(t - p / 100) < 1e-12, `${p}%${itemsOn ? ', a custom mix' : ''}: ${t}`);
    }
  }
  // one kind on its own takes all of it; every kind off, or None, hides nothing
  const bombs = itemChances({ ...lots, itemShare: 40, items: { ...lots.items, fire: 0, speed: 0, kick: 0, grab: 0, shield: 0, curse: 0, laptop: 0, decoy: 0, wire: 0 } });
  assert.deepStrictEqual(bombs.filter(([, x]) => x > 0), [['bomb', 0.4]]);
  const off = { ...lots, items: { bomb: 0, fire: 0, speed: 0, kick: 0, grab: 0, shield: 0, curse: 0, laptop: 0, decoy: 0, wire: 0 } };
  assert.equal(sum(itemChances(off)), 0, 'every kind off: none');
  for (const s of [{ ...defaultSetup('gold'), itemShare: 0 }, off]) {
    const w = createWorld(worldConfig(s, 'gold', 7));
    assert.equal(w.hidden.size, 0, 'no power-ups, not even a boot, a glove or a laptop made sure of');
  }
  // more bricks hide one with more of it, in the same arena (the lobby's line under it counts them)
  let last = -1;
  for (let p = 0; p <= 100; p += 20) {
    const n = createWorld(worldConfig({ ...defaultSetup('gold'), itemShare: p }, 'gold', 7)).hidden.size;
    assert.ok(n > last, `${p}%: ${n} power-ups`);
    last = n;
  }
  const all = createWorld(worldConfig({ ...defaultSetup('gold'), itemShare: 100 }, 'gold', 7));
  assert.equal(all.hidden.size, all.tiles.filter((t) => t === SOFT).length, '100%: every brick hides one');
  // read back: a saved share is kept to its steps; one saved before the setting is the usual
  const colorIds = COLORS.map((c) => c.id);
  assert.equal(readSetup({ ...defaultSetup('gold'), itemShare: 37 }, 'gold', colorIds).itemShare, 35);
  assert.equal(readSetup({ ...defaultSetup('gold'), itemShare: 400 }, 'gold', colorIds).itemShare, 100);
  const old = { ...defaultSetup('gold') } as Partial<MatchSetup>;
  delete old.itemShare;
  assert.equal(readSetup(old, 'gold', colorIds).itemShare, 60);
  assert.ok(summary({ ...defaultSetup('gold'), itemShare: 30 }).includes('Power-up density 30%'));
  assert.ok(summary({ ...defaultSetup('gold'), itemShare: 0 }).includes('No power-ups'));
  assert.ok(!summary(defaultSetup('gold')).includes('Power-up'), 'the usual is not mentioned');
  // a kind switched off never turns up, whatever its amount; the others share its bricks
  const noShields = { ...defaultSetup('gold'), itemsOn: true, itemOn: { ...defaultSetup('gold').itemOn, shield: false } };
  const ns = itemChances(noShields);
  assert.equal(ns.find(([k]) => k === 'shield')![1], 0);
  assert.ok(Math.abs(sum(ns) - 0.6) < 1e-12);
  // the extra bomb and the flame have no switch (the owner's ask, 19 November 2026): always on
  const offAnyway = { ...defaultSetup('gold'), itemsOn: true, itemOn: { ...defaultSetup('gold').itemOn, bomb: false, fire: false } };
  assert.deepEqual(itemChances(offAnyway), itemChances(defaultSetup('gold')));
  const read = readSetup(offAnyway, 'gold', colorIds);
  assert.equal(read.itemOn.bomb, true);
  assert.equal(read.itemOn.fire, true);
  // a kind saved at Off, before the switches, comes back switched off at Normal
  const was = readSetup({ ...defaultSetup('gold'), itemOn: undefined, items: { ...defaultSetup('gold').items, curse: 0 } }, 'gold', colorIds);
  assert.equal(was.itemOn.curse, false);
  assert.equal(was.items.curse, ITEM_NORMAL);
  // saved before Very rare (version 7): Rare, Normal and Lots keep their meaning, a step up
  const seven = readSetup({ ...defaultSetup('gold'), v: 7, itemsOn: true, items: { bomb: 1, fire: 2, speed: 3, kick: 2, grab: 2, shield: 2, curse: 2, laptop: 2 } }, 'gold', colorIds);
  assert.deepStrictEqual([seven.items.bomb, seven.items.fire, seven.items.speed], [ITEM_RARE, ITEM_NORMAL, 4], 'Rare, Normal, Lots read as before');
  assert.equal(readSetup(JSON.parse(JSON.stringify(seven)), 'gold', colorIds).items.bomb, ITEM_RARE, 'and saved again, read the same');
  assert.equal(was.itemOn.bomb, true);
}

// Brick density (the owner's ask, 19 November 2026): a percentage of the open floor in steps of 5%, 80% by default
{
  const colorIds = COLORS.map((c) => c.id);
  assert.equal(defaultSetup('gold').brickShare, 80);
  assert.equal(worldConfig(defaultSetup('gold'), 'gold', 1).softDensity, 0.8);
  // saved between steps (78%, the old usual): the nearest step
  assert.equal(readSetup({ ...defaultSetup('gold'), brickShare: 78 }, 'gold', colorIds).brickShare, 80);
  assert.equal(readSetup({ ...defaultSetup('gold'), brickShare: 37 }, 'gold', colorIds).brickShare, 35);
  const none = createWorld(worldConfig({ ...defaultSetup('gold'), brickShare: 0 }, 'gold', 3));
  assert.equal(none.tiles.filter((t) => t === SOFT).length, 0, 'None: no bricks');
  const full = createWorld(worldConfig({ ...defaultSetup('gold'), brickShare: 100 }, 'gold', 3));
  const some = createWorld(worldConfig({ ...defaultSetup('gold'), brickShare: 50 }, 'gold', 3));
  assert.ok(full.tiles.filter((t) => t === SOFT).length > some.tiles.filter((t) => t === SOFT).length);
  // saved as one of the old five steps: its percentage
  const old = { ...defaultSetup('gold'), bricks: 0 } as Partial<MatchSetup> & { bricks: number };
  delete old.brickShare;
  assert.equal(readSetup(old, 'gold', colorIds).brickShare, 50);
  assert.equal(readSetup({ ...defaultSetup('gold'), brickShare: 140 }, 'gold', colorIds).brickShare, 100);
  assert.ok(summary({ ...defaultSetup('gold'), brickShare: 40 }).includes('Brick density 40%'));
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
// a plane's steering gets through every step to the server's world: packed, masked, queued, taken, sent on
// as a tick's text (the mask once wiped every aim but one: the plane could not be steered online)
for (let aim = 0; aim < AIM_STEPS; aim++) {
  const v = packInput({ dir: 4, a: false, b: true, aim });
  assert.strictEqual(v & IN_ALL, v, `aim ${aim} survives the mask`);
  const q = newQueue();
  q.pending.push({ k: 5, v: v & IN_ALL, n: 1 });
  const taken = takeInput(q, 5);
  assert.strictEqual(unpackInput(tickCodes(tickText([0, taken]))[1]).aim, aim, `aim ${aim} reaches the world`);
}

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
// (the robot they got was a CPU player's: it moved to a colour nobody had. Never two of one robot)
const worn = [...info.members.map((m) => m.colorId), ...info.setup.cpus.map((c) => c.colorId)];
assert.strictEqual(new Set(worn).size, worn.length, `every robot in the room differs: ${worn.join(' ')}`);

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
assert.notStrictEqual(back.last('room')!.host, back.last('room')!.you, 'a host away for a short while (another app) is still the host');
assert.ok(back.last('room')!.members.some((m) => !m.on), 'and is shown as away');
room.housekeep(now + HOST_AWAY_MS + 1000);
assert.strictEqual(back.last('room')!.host, back.last('room')!.you, 'the friend hosts now');
assert.strictEqual(back.last('room')!.members[0].id, back.last('room')!.you, 'and is P1: the host is always P1 (the owner, 25 November 2026)');
assert.strictEqual(back.last('room')!.members[1].id, host.member!.id, 'the old host is next in line, P2');
assert.strictEqual(back.last('room')!.members.length, 2, 'the old host keeps their place for a good while yet');
room.housekeep(now + AWAY_MS + 1000);
assert.strictEqual(back.last('room')!.members.length, 1, 'and is let go in the end');

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
  room3.message(h.member!, { t: 'setup', setup: { ...first, teamsOn: true, friendlyFire: false, seats: ['gold', ...cpus], teams: { gold: 0, [cpus[0]]: 0, [cpus[1]]: 1, [cpus[2]]: 1 }, firstTo: 2, timerOn: false } }, now);
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

// teams, Custom (the default): everyone on a team of their own until a colour is picked to match another's
{
  const s = defaultSetup('gold');
  const four = ['gold', 'black', 'pink', 'blue'];
  assert.equal(s.teamsOn, false, 'teams are off to start with');
  assert.equal(s.friendlyFire, false, 'and friendly fire is off');
  assert.equal(s.teamSize, 0, 'Custom to start with');
  assert.equal(worldConfig(s, 'gold', 1).teams, undefined, 'off: every robot for itself');
  s.teamsOn = true;
  startTeams(s, four);
  assert.deepStrictEqual(teamsFor(s, four), [0, 1, 2, 3], 'each on a team of their own, in a colour of their own');
  assert.equal(lineUp(s, four), '1 v 1 v 1 v 1');
  // picking a colour another robot has: one team, and it moves to sit beside them
  assert.deepStrictEqual(teamChoices(s, four, 'blue'), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.ok(pickTeam(s, four, 'blue', 0));
  assert.deepStrictEqual(teamsFor(s, four), [0, 1, 2, 0], 'blue joins your (red) team');
  assert.deepStrictEqual(seating(s, four), four, 'and stays where it sits: only a drag moves a card');
  // a colour nobody has: a team of its own again
  assert.ok(pickTeam(s, four, 'blue', 5));
  assert.deepStrictEqual(teamsFor(s, four), [0, 1, 2, 5]);
  // dragged onto a card: it sits beside that robot and joins its team
  dropOnto(s, four, 'pink', 'gold', true);
  assert.deepStrictEqual(seating(s, four), ['gold', 'pink', 'black', 'blue']);
  assert.deepStrictEqual(teamsFor(s, four), [0, 1, 0, 5], 'pink is on your team now');
  // a tap where a name is: its whole team takes the next colour nobody has
  assert.equal(recolour(s, four, 'pink'), 2);
  assert.deepStrictEqual(teamsFor(s, four), [2, 1, 2, 5], 'you and pink both');
  // changing one robot's colour never changes anyone else's
  s.teams = { gold: 0, black: 0, pink: 0, blue: 1 };
  s.seats = [...four];
  assert.ok(pickTeam(s, four, 'pink', 4));
  assert.deepStrictEqual(teamsFor(s, four), [0, 0, 4, 1], 'only pink changed');
  dropOnto(s, four, 'black', 'blue', true);
  assert.deepStrictEqual(teamsFor(s, four), [0, 1, 4, 1], 'dragged: only black changed');
  // everyone can be one team (the round is then played together)
  s.teams = { gold: 0, black: 0, pink: 0, blue: 1 };
  assert.ok(teamChoices(s, four, 'blue').includes(0));
  assert.ok(pickTeam(s, four, 'blue', 0));
  assert.deepStrictEqual(teamsFor(s, four), [0, 0, 0, 0]);
  assert.equal(lineUp(s, four), 'All one team');
  // a team size that stops fitting (a player more) turns into Custom for good, nobody's team changing
  const five = [...four, 'red'];
  s.teamSize = 2;
  s.seats = [...four];
  settleTeams(s, four);
  const before = teamsFor(s, four);
  settleTeams(s, five);
  assert.equal(s.teamSize, 0);
  assert.deepStrictEqual(teamsFor(s, five).slice(0, 4), before, 'the four keep their teams');
  assert.ok(!before.includes(teamsFor(s, five)[4]), 'and the newcomer is on a team of its own');
  // any mix in Custom: 3 v 2 v 1 v 1 v 1 with eight robots
  const eight = ['gold', 'black', 'pink', 'blue', 'red', 'orange', 'white', 'green'];
  startTeams(s, eight);
  assert.equal(lineUp(s, eight), '1v1v1v1v1v1v1v1', 'everyone on their own; more than four teams written closer');
  const tGold = teamsFor(s, eight)[0];
  const tBlue = teamsFor(s, eight)[3];
  assert.ok(pickTeam(s, eight, 'black', tGold) && pickTeam(s, eight, 'pink', tGold) && pickTeam(s, eight, 'red', tBlue));
  assert.equal(lineUp(s, eight), '3v2v1v1v1');
  // Even out: equal teams; 8 do not divide into 5 teams, so the smallest give way to make 4 of 2;
  // the colours are ones already there; teammates sit together
  const teamsBefore = new Set(teamsFor(s, eight));
  assert.ok(canEven(s, eight));
  evenTeams(s, eight);
  assert.equal(lineUp(s, eight), '2 v 2 v 2 v 2');
  assert.ok(teamsFor(s, eight).every((t) => teamsBefore.has(t)), 'colours already there');
  assert.ok(!canEven(s, eight), 'nothing more to even out');
  const seated = seating(s, eight).map((c) => teamsFor(s, eight)[eight.indexOf(c)]);
  assert.ok(seated.every((t, k) => k === 0 || t === seated[k - 1] || !seated.slice(0, k).includes(t)), 'each team sits together');
  s.teams = { gold: 0, black: 0, pink: 0, blue: 1 };
  s.seats = [...four];
  evenTeams(s, four);
  assert.equal(lineUp(s, four), '2 v 2');
  assert.equal(teamsFor(s, four)[0], 0, 'you stay on your team');
  // 2 v 1 v 1 used to stay as it was (the owner's report): it becomes 2 v 2
  s.teams = { gold: 0, black: 0, pink: 1, blue: 2 };
  s.seats = [...four];
  evenTeams(s, four);
  assert.equal(lineUp(s, four), '2 v 2');
  assert.equal(teamsFor(s, four)[0], 0, 'the biggest team stays');
  // Reset (the owner's ask, 21 November 2026): teams put together by hand, then everyone back on their own,
  // each in a colour of its own; the cards stay where they are
  s.teams = { gold: 0, black: 0, pink: 0, blue: 1 };
  s.seats = ['blue', 'gold', 'pink', 'black'];
  startTeams(s, four);
  assert.equal(lineUp(s, four), '1 v 1 v 1 v 1');
  assert.equal(new Set(teamsFor(s, four)).size, 4, 'four different colours');
  assert.deepEqual(s.seats, ['blue', 'gold', 'pink', 'black'], 'nobody moved');
  // everyone on their own is even already
  startTeams(s, four);
  assert.ok(!canEven(s, four));
  // five robots divide no other way: 3 v 1 v 1 becomes 2 v 2 v 1
  startTeams(s, five);
  const [t5] = teamsFor(s, five);
  pickTeam(s, five, 'black', t5); pickTeam(s, five, 'pink', t5);
  evenTeams(s, five);
  assert.equal(lineUp(s, five), '2 v 2 v 1');
  assert.deepStrictEqual(teamsFor(defaultSetup('gold'), ['gold', 'black']), [0, 1], 'two robots: one each');
  // a CPU player gives its colour up to you: each keeps its seat and team
  s.seats = [...four];
  s.teams = { gold: 0, black: 1, pink: 2, blue: 2 };
  swapTeams(s, 'gold', 'pink');
  assert.deepStrictEqual(s.seats, ['pink', 'black', 'gold', 'blue']);
  assert.deepStrictEqual(s.teams, { black: 1, gold: 2, pink: 0, blue: 2 });
  // into the world, and read back as saved
  s.friendlyFire = true;
  s.cpus = [{ colorId: 'black', level: 'normal' }, { colorId: 'gold', level: 'normal' }, { colorId: 'blue', level: 'normal' }];
  const cfg = worldConfig(s, 'pink', 1);
  assert.deepStrictEqual(cfg.teams, [0, 1, 2, 2]);
  assert.equal(cfg.friendlyFire, true);
  const back = readSetup(JSON.parse(JSON.stringify(s)), 'pink', COLOR_IDS);
  assert.equal(back.teamsOn, true);
  assert.deepStrictEqual(back.seats, s.seats);
  assert.deepStrictEqual(back.teams, s.teams);
  assert.deepStrictEqual(readSetup({ ...s, seats: ['gold', 'nope', 'gold', 'blue'] }, 'pink', COLOR_IDS).seats, ['gold', 'blue'], 'only real colours, each once');
  assert.deepStrictEqual(readSetup({ ...s, teams: { gold: 9, nope: 1, blue: 1 } }, 'pink', COLOR_IDS).teams, { blue: 1 });
  assert.equal(defaultRules(s, 'pink').teamsOn, true, 'Reset to Default on the Match page leaves the teams alone');
  assert.ok(summary(s).includes('Teams, friendly fire'));
}

// teams of 2 or 4: the row a robot sits in on the Players page is its team (two to a row)
{
  const s = defaultSetup('gold');
  s.teamsOn = true;
  const eight = ['gold', 'black', 'pink', 'blue', 'red', 'orange', 'white', 'green'];
  assert.deepStrictEqual([3, 4, 5, 6, 7, 8].map((n) => teamSizes(n)), [[], [2], [], [2], [], [2, 4]], 'whole rows only');
  // from Custom: each row takes the team of whoever sits first in it
  s.seats = [...eight];
  s.teams = { gold: 3, black: 3, pink: 3, blue: 3, red: 6, orange: 6, white: 6, green: 6 };
  setTeamSize(s, eight, 4);
  assert.deepStrictEqual(s.rowTeams, [3, 3, 6, 6]);
  assert.equal(lineUp(s, eight), '4 v 4');
  setTeamSize(s, eight, 2);
  assert.deepStrictEqual(s.rowTeams, [3, 0, 6, 1], 'teams of two: every row its own colour, none shared');
  assert.equal(lineUp(s, eight), '2 v 2 v 2 v 2');
  // dragging a card onto another swaps their seats: each plays for the other's row
  dropOnto(s, eight, 'green', 'black', true);
  assert.deepStrictEqual(seating(s, eight).slice(0, 2), ['gold', 'green']);
  assert.deepStrictEqual(teamsFor(s, eight).slice(0, 2), [3, 1], 'gold stays yellow; black takes green’s seat in the last row');
  assert.equal(teamsFor(s, eight)[eight.indexOf('green')], 3, 'green now sits beside you, on your team');
  // a row's colour: any colour (another team's makes the two one team: see below); a tap changes its whole
  // row (Teams of 4: both rows)
  assert.deepStrictEqual(teamChoices(s, eight, 'gold'), [0, 1, 2, 3, 4, 5, 6, 7]);
  setTeamSize(s, eight, 4);
  assert.equal(recolour(s, eight, 'pink'), 4, 'pink sits in the second row, with you: yellow becomes purple');
  assert.deepStrictEqual(s.rowTeams, [4, 4, 6, 6], 'both rows of that team');
  // dropped on the empty place at the end: the last seat
  seatLast(s, eight, 'gold');
  assert.equal(seating(s, eight)[7], 'gold');
  // back to Custom: everyone on a team of their own again, each a colour of their own
  setTeamSize(s, eight, 0);
  assert.equal(new Set(teamsFor(s, eight)).size, 8);
  assert.equal(lineUp(s, eight), '1v1v1v1v1v1v1v1');
  assert.equal(fixedSize({ ...s, teamSize: 2 }, 9), 0, 'a player more: Custom');
  assert.equal(readSetup({ ...s, teamSize: 3 }, 'pink', COLOR_IDS).teamSize, 0, 'whole rows only: Teams of 2 or 4');
}

// teams of 2 or 4, overridden by hand (the owner's asks, 18 November 2026): any team can be given any colour,
// another team's too, which makes the two one team; a tap where a name is does it for the whole row, and the
// Team ‹ › on a card for that one player only, its row partner staying where it is
{
  const s = defaultSetup('gold');
  s.teamsOn = true;
  const eight = ['gold', 'black', 'pink', 'blue', 'red', 'orange', 'white', 'green'];
  const cpus = eight.slice(1).map((colorId) => ({ colorId, level: 'normal' as const }));
  const team = (c: string): number => teamsFor(s, eight)[eight.indexOf(c)];
  startTeams(s, eight);
  setTeamSize(s, eight, 2);
  assert.deepStrictEqual(s.rowTeams, [0, 2, 4, 6], 'picked: each row the team of whoever sits first in it');
  assert.equal(lineUp(s, eight), '2 v 2 v 2 v 2');
  // a tap: the row takes the next colour, whoever has it; the next tap moves only that row on
  s.rowTeams = [0, 1, 2, 3];
  assert.equal(recolour(s, eight, 'gold'), 1);
  assert.deepStrictEqual(s.rowTeams, [1, 1, 2, 3], 'red became blue, the second row’s colour: one team');
  assert.equal(lineUp(s, eight), '4 v 2 v 2');
  settleTeams(s, eight);
  assert.equal(lineUp(s, eight), '4 v 2 v 2', 'and stays so: the lobby settles the teams on every change');
  assert.equal(fixedSize(s, eight.length), 2, 'still Teams of 2');
  assert.deepStrictEqual(worldConfig({ ...s, cpus }, 'gold', 1).teams, [1, 1, 1, 1, 2, 2, 3, 3], 'into the round as picked');
  assert.equal(recolour(s, eight, 'black'), 2);
  assert.deepStrictEqual(s.rowTeams, [2, 1, 2, 3], 'only the tapped row moved on (it joins green), blue as it was');
  // the ‹ › on a card: that one player only
  s.rowTeams = [0, 1, 2, 3];
  assert.deepStrictEqual(teamChoices(s, eight, 'pink'), [0, 1, 2, 3, 4, 5, 6, 7], 'every colour, the other teams’ too');
  assert.ok(pickTeam(s, eight, 'pink', 5));
  assert.deepStrictEqual(s.rowTeams, [0, 1, 2, 3], 'the rows as they were');
  assert.equal(team('pink'), 5, 'pink on a team of its own (orange)');
  assert.equal(team('blue'), 1, 'its row partner where it was');
  assert.equal(lineUp(s, eight), '2 v 2 v 2 v 1 v 1'.replace(/ v /g, 'v'));
  assert.ok(pickTeam(s, eight, 'pink', 0), 'onto the first row’s team');
  assert.equal(lineUp(s, eight), '3 v 2 v 2 v 1');
  settleTeams(s, eight);
  assert.equal(team('pink'), 0, 'kept on every change');
  assert.deepStrictEqual(worldConfig({ ...s, cpus }, 'gold', 1).teams, [0, 0, 0, 1, 2, 2, 3, 3], 'and into the round');
  assert.ok(pickTeam(s, eight, 'pink', 1), 'its row’s colour again: back with its row');
  assert.deepStrictEqual(s.ownTeams, {});
  assert.equal(lineUp(s, eight), '2 v 2 v 2 v 2');
  // a tap where pink's name is takes its whole row on from pink's own colour, pink back in the row
  pickTeam(s, eight, 'pink', 6);
  assert.equal(recolour(s, eight, 'pink'), 7);
  assert.deepStrictEqual([team('pink'), team('blue')], [7, 7]);
  assert.deepStrictEqual(s.ownTeams, {});
  // a drag swaps seats, and each then plays for its new row
  s.rowTeams = [0, 1, 2, 3];
  pickTeam(s, eight, 'red', 0);
  dropOnto(s, eight, 'red', 'green', true);
  assert.deepStrictEqual([team('red'), team('green')], [3, 2], 'red in the fourth row, green in the third');
  // all one team, by hand
  for (const c of eight) pickTeam(s, eight, c, 4);
  assert.equal(lineUp(s, eight), 'All one team');
  // picking the size again starts even, every team a colour of its own, nobody on their own
  setTeamSize(s, eight, 2);
  assert.equal(new Set(s.rowTeams).size, 4);
  assert.deepStrictEqual(s.ownTeams, {});
  assert.equal(lineUp(s, eight), '2 v 2 v 2 v 2');
  // a row more (six robots to eight) starts a team in a colour nobody has; a merge and a player's own stay
  const six = eight.slice(0, 6);
  setTeamSize(s, six, 2);
  recolour(s, six, 'gold');
  while (s.rowTeams[0] !== s.rowTeams[1]) recolour(s, six, 'gold');
  assert.equal(lineUp(s, six), '4 v 2');
  pickTeam(s, six, 'red', 7);
  settleTeams(s, eight);
  assert.ok(!s.rowTeams.slice(0, 3).includes(s.rowTeams[3]) && s.rowTeams[3] !== 7, 'the new row is a team of its own');
  assert.equal(team('red'), 7, 'red kept its own');
  // Teams of 4: a tap moves both rows of a team together, and the two teams can be made one; the ‹ › one player
  setTeamSize(s, eight, 4);
  assert.equal(lineUp(s, eight), '4 v 4');
  while (s.rowTeams[2] !== s.rowTeams[0]) recolour(s, eight, 'white');
  assert.equal(lineUp(s, eight), 'All one team');
  const was = s.rowTeams[0];
  recolour(s, eight, 'white');
  assert.deepStrictEqual(s.rowTeams, [was, was, (was + 1) % 8, (was + 1) % 8], 'a tap: the tapped team’s two rows move on together');
  assert.ok(pickTeam(s, eight, 'green', was));
  assert.equal(lineUp(s, eight), '5 v 3');
  // in Custom the ‹ › were one player's already, and a size no longer fitting keeps everyone's team
  assert.ok(pickTeam(s, eight, 'orange', 3));
  settleTeams(s, eight.slice(0, 7));
  assert.equal(s.teamSize, 0, 'seven players: Custom');
  assert.deepStrictEqual(s.ownTeams, {});
  assert.equal(teamsFor(s, eight.slice(0, 7))[eight.indexOf('orange')], 3, 'orange kept its own team');
}

console.log('room checks passed');

// Settings › Sound: every sound switch is in exactly one group (the owner's ask: sounds in groups)
{
  const grouped = SOUND_GROUPS.flatMap(([, ids]) => ids);
  assert.deepStrictEqual([...grouped].sort(), SOUND_NAMES.map(([id]) => id).sort(), 'every sound in one group, once');
}

// The Match page's groups of rules: each group's reset puts back its own rules and nothing else, and the
// five together put back everything Reset all settings does (the owner's design, 18 November 2026)
{
  const me = COLORS[0].id;
  const d = defaultSetup(me);
  const s = defaultSetup(me);
  s.arena = 'compact';
  Object.assign(s, { timerOn: false, roundSecs: 200, closeIn: 4, firstTo: 3, lives: 4, postMortem: true, afterlife: 'zombie', angelsBack: true, brickShare: 40, itemShare: 25, itemsOn: true, startOn: true, startBombs: 3, startFire: 4, startSpeed: 2 });
  s.items = { ...s.items, bomb: 0 };
  const all = defaultRules(s, me);
  const groups = Object.keys(RULE_GROUPS) as (keyof typeof RULE_GROUPS)[];
  // every rule Reset all puts back is in a group
  const grouped = new Set<string>(groups.flatMap((g) => [...RULE_GROUPS[g]]));
  for (const k of Object.keys(all) as (keyof typeof all)[]) {
    if (JSON.stringify(all[k]) !== JSON.stringify(s[k])) assert.ok(grouped.has(k), `${k} is reset by Reset all but is in no group`);
  }
  assert.ok(!groupIsDefault(s, 'lives', me));
  const before = groupValues(s, 'time');
  resetGroup(s, 'lives', me);
  assert.ok(groupIsDefault(s, 'lives', me));
  assert.equal(s.lives, d.lives);
  assert.equal(s.afterlife, d.afterlife);
  assert.deepStrictEqual(groupValues(s, 'time'), before, 'the other groups are left alone');
  assert.equal(s.firstTo, 3);
  // the arena's own round length comes back with Round time (Mini: 1:00)
  resetGroup(s, 'time', me);
  assert.equal(s.timerOn, true);
  assert.equal(s.roundSecs, ARENAS.find((a) => a.id === 'compact')!.roundSecs);
  for (const g of groups) resetGroup(s, g, me);
  assert.deepStrictEqual(s, all, 'all five resets together are Reset all');
}

// The Match page's modes (the owner's ask, 23 November 2026): Classic, Hardcore and Random; a rule changed by
// hand makes it Custom; Random's rules are picked again for every new match, on this screen and online
{
  const me = COLORS[0].id;
  const s = defaultSetup(me);
  assert.equal(modeOf(s, me), 'classic', 'a new setup is Classic');
  s.firstTo = 3;
  assert.equal(modeOf(s, me), 'classic', 'Rounds to win is not part of a mode');
  const hard = hardcoreRules(s, me);
  assert.equal(modeOf(hard, me), 'hardcore');
  assert.ok(hard.startOn && hard.startBombs === MAX_BOMBS && hard.startFire === MAX_FIRE && hard.startSpeed === MAX_SPEED_ITEMS, 'Hardcore: bombs, blast and speed maxed from the start');
  const classic = defaultRules(s, me);
  for (const k of ['brickShare', 'itemShare', 'itemOn', 'closeIn', 'roundSecs', 'lives'] as const)
    assert.deepStrictEqual(hard[k], classic[k], `Hardcore: ${k} as in Classic (the owner: the rest normal, power-up density included)`);
  // the glove very rare (the owner's ask): Rare, and no arena sure to have one; the rest of the mix as usual
  assert.ok(hard.itemsOn && hard.items.grab === ITEM_RARE, 'Hardcore: the glove at Rare, half as common');
  for (const k of ['bomb', 'fire', 'speed', 'kick', 'shield', 'curse', 'laptop', 'decoy', 'wire'] as const) assert.strictEqual(hard.items[k], classic.items[k], `Hardcore: ${k} as usual`);
  {
    const cfg = worldConfig(hard, me, 1);
    assert.deepStrictEqual(cfg.sure, ['kick', 'laptop', 'decoy', 'wire'], 'the glove is not made sure of');
    assert.deepStrictEqual(worldConfig(classic, me, 1).sure, ['kick', 'grab', 'laptop', 'decoy', 'wire'], 'in Classic it is');
    let gloves = 0;
    let none = 0;
    let all = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const w = createWorld({ ...worldConfig(hard, me, seed) });
      const kinds = [...w.hidden.values()];
      const n = kinds.filter((k) => k === 'grab').length;
      gloves += n;
      all += kinds.length;
      if (!n) none++;
    }
    assert.ok(gloves / all > 0.022 && gloves / all < 0.031, `gloves are about half their usual 5.1% of power-ups in Hardcore (${((100 * gloves) / all).toFixed(1)}%)`);
    assert.ok(none > 30, `some Hardcore arenas have no glove at all (${none} of 200)`);
  }
  assert.equal(hard.firstTo, 3, 'and Rounds to win kept');
  hard.lives = 2;
  assert.equal(modeOf(hard, me), 'custom', 'a rule changed by hand: Custom');
  // Random: picked, shown (the rules themselves, not a word), and different each time
  const rng = makeRng(11);
  const keys = new Set<string>();
  for (let i = 0; i < 30; i++) {
    const r = rollRules(s, rng);
    assert.equal(modeOf(r, me), 'random');
    assert.equal(r.firstTo, 3, 'Random keeps Rounds to win');
    assert.ok(r.roundSecs >= 45 && r.roundSecs <= 180 && r.roundSecs % ROUND_STEP === 0, `round length ${r.roundSecs}`);
    assert.ok(r.brickShare % 5 === 0 && r.itemShare % 5 === 0 && r.lives >= 1 && r.lives <= 3);
    // it reads back the same, as a saved setup or one sent to the server would be
    const back = readSetup(JSON.parse(JSON.stringify(r)), me, COLORS.map((c) => c.id));
    assert.equal(modeOf(back, me), 'random', 'Random survives being saved and sent');
    assert.equal(rulesKey(back), rulesKey(r));
    keys.add(rulesKey(r));
  }
  assert.ok(keys.size > 25, 'different rules each time');
  const r = rollRules(s, rng);
  r.brickShare = r.brickShare === 100 ? 95 : r.brickShare + 5;
  settleMode(r);
  assert.ok(!r.randomRules && modeOf(r, me) === 'custom', 'a rule changed by hand after a roll: Custom, and no more rolling');
  // online: a rematch and going back to the lobby pick new rules; the host's Start plays the ones shown
  const room3 = new Room('KLMN', makeRng(5));
  const h = new Page('h3');
  h.member = room3.hello(h.conn, { t: 'hello', id: 'h3', name: 'Cody', colorId: 'gold', dance: 'party', create: true, pv: PROTOCOL }, now);
  const shown = rollRules(h.last('room')!.setup, makeRng(9));
  room3.message(h.member!, { t: 'setup', setup: shown }, now);
  assert.equal(rulesKey(h.last('room')!.setup), rulesKey(shown), 'the room keeps the rules picked');
  room3.message(h.member!, { t: 'start' }, now);
  assert.equal(rulesKey(h.last('room')!.setup), rulesKey(shown), 'Start plays the rules shown');
  room3.message(h.member!, { t: 'restart' }, now);
  const second = h.last('room')!.setup;
  assert.ok(second.randomRules && rulesKey(second) !== rulesKey(shown), 'Restart: new rules, shown to everyone');
  room3.message(h.member!, { t: 'lobby' }, now);
  const third = h.last('room')!.setup;
  assert.ok(third.randomRules && rulesKey(third) !== rulesKey(second), 'back in the lobby: new rules for the next match');
}

// quick chat (24 November 2026): a line goes to everyone in the room with who said it, tidied, and not too often
{
  const room4 = new Room('CHAT', makeRng(4));
  const a = new Page('ca');
  const b = new Page('cb');
  a.member = room4.hello(a.conn, { t: 'hello', id: 'ca', name: 'Cody', colorId: 'gold', dance: 'party', create: true, pv: PROTOCOL }, now);
  b.member = room4.hello(b.conn, { t: 'hello', id: 'cb', name: 'Zed', colorId: 'blue', dance: 'party', create: false, pv: PROTOCOL }, now);
  room4.message(a.member!, { t: 'chat', text: '  Too   slow!  ' }, now);
  for (const p of [a, b]) assert.deepStrictEqual(p.last('chat'), { t: 'chat', id: a.member!.id, text: 'Too slow!' }, `${p.key} hears it`);
  room4.message(a.member!, { t: 'chat', text: 'again' }, now + 200);
  assert.equal(b.last('chat')!.text, 'Too slow!', 'a second line straight after is dropped');
  room4.message(a.member!, { t: 'chat', text: 'again' }, now + CHAT_GAP_MS);
  assert.equal(b.last('chat')!.text, 'again', 'after the gap it goes');
  room4.message(b.member!, { t: 'chat', text: '\n\t' }, now);
  assert.equal(a.last('chat')!.text, 'again', 'an empty line is not sent');
  room4.message(b.member!, { t: 'chat', text: 'y'.repeat(300) }, now);
  assert.equal(a.last('chat')!.text.length, CHAT_MAX, 'cut short');
}

console.log('room chat checks passed');

// The host is always P1; when the host leaves, the next in line (P2) takes over and becomes P1, the rest moving up
// one; someone away is passed over for the next one here, who still becomes P1 (the owner, 25 November 2026)
{
  const r = new Room('PONE', makeRng(5));
  const ps = ['a', 'b', 'c', 'd'].map((k) => new Page(k));
  ps.forEach((p, k) => (p.member = r.hello(p.conn, { t: 'hello', id: p.key, name: p.key.toUpperCase(), colorId: COLOR_IDS[k], dance: 'party', create: k === 0, pv: PROTOCOL }, now)));
  const order = () => ps[3].last('room')!.members.map((m) => m.name).join('');
  const hostName = () => { const i = ps[3].last('room')!; return i.members.find((m) => m.id === i.host)!.name; };
  assert.strictEqual(order(), 'ABCD', 'P1 to P4 in the order they came, the maker first');
  assert.strictEqual(hostName(), 'A', 'the maker hosts, as P1');
  r.message(ps[0].member!, { t: 'bye' }, now);
  assert.strictEqual(order(), 'BCD', 'the host left: the rest move up one');
  assert.strictEqual(hostName(), 'B', 'P2 took over, and is P1 now');
  // the next in line is away when the host leaves: the one after hosts, as P1, and the one away is P2
  r.disconnect(ps[2].member!, ps[2].conn, now);
  r.message(ps[1].member!, { t: 'bye' }, now);
  assert.strictEqual(hostName(), 'D', 'C is away, so D hosts');
  assert.strictEqual(order(), 'DC', 'and D is P1, C P2');
}

console.log('host is P1 checks passed');

// The crown: the leader wears it and, in a teams match, everyone on its side, a team of any size (the owner's
// ask, 25 November 2026: on a team of two only one wore it)
{
  const solo = [{ team: -1 }, { team: -1 }, { team: -1 }];
  assert.deepStrictEqual(solo.map((_, i) => wearsCrown(solo, 1, i)), [false, true, false], 'no teams: the leader alone');
  assert.ok(!solo.some((_, i) => wearsCrown(solo, -1, i)), 'nobody before the first win');
  const pairs = [{ team: 0 }, { team: 0 }, { team: 3 }, { team: 3 }];
  assert.deepStrictEqual(pairs.map((_, i) => wearsCrown(pairs, 2, i)), [false, false, true, true], 'a team of two: both');
  const four = [{ team: 1 }, { team: 5 }, { team: 1 }, { team: 1 }, { team: 5 }, { team: 1 }, { team: 5 }, { team: 5 }];
  assert.deepStrictEqual(four.map((_, i) => wearsCrown(four, 3, i)), [true, false, true, true, false, true, false, false], 'a team of four: all four');
  const odd = [{ team: 2 }, { team: 2 }, { team: 2 }, { team: 6 }, { team: 4 }];
  assert.deepStrictEqual(odd.map((_, i) => wearsCrown(odd, 0, i)), [true, true, true, false, false], '3 v 1 v 1: the three');
}

console.log('crown checks passed');
