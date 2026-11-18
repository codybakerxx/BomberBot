/**
 * What the lobby and the settings choose, kept apart from the screens that show them.
 *
 * - `MatchSetup`: the match the host sets up in the lobby. The CPU players (each with its own colour and
 *   level), the arena, and the rules. `worldConfig` turns it into the config sim.ts builds a round from.
 * - `Prefs`: each player's own settings, which never change anyone else's game: sound, graphics and the see-through
 *   level of the touch controls. (The swipe pad's direction settings are older and stay in main.ts.)
 *
 * Both are saved on this device. Anything saved that does not look right is ignored and the default used.
 * Every option here is used by the game: nothing is shown in a menu that does not do something.
 */
import { DANCES, readDance, type DanceId } from './dances';
import { BotLevel, BOT_LEVELS } from './bot';
import { KeyMap, PadMap, defaultKeys, defaultPad, readKeys, readPad } from './bindings';
import { ItemKind, ITEM_CHANCE, MAX_BOMBS, MAX_FIRE, MAX_LIVES, MAX_SPEED_ITEMS, START_FIRE, TICK_HZ, WorldConfig } from './sim';

// ---------------------------------------------------------------- the match

/** A CPU player in the lobby. */
export interface CpuSlot {
  colorId: string;
  level: BotLevel;
  /** its victory dance (dances.ts); Party if it has not been given one */
  dance?: DanceId;
}

/**
 * Another player on this screen, with a controller of their own (couch play). They join in the lobby by
 * pressing A on it, and are not saved: they join again each time the game is opened.
 */
export interface Guest {
  /** the browser's number for their controller */
  pad: number;
  /** the robot they play as */
  colorId: string;
  /** the robot they are looking at in the lobby; theirs once they press Ready */
  pick: string;
  ready: boolean;
  /** their victory dance (dances.ts), changed with up and down on their controller */
  dance: DanceId;
  /**
   * Online, the other people in the room are shown as guests too, with this: their typed name ('' for the
   * robot's), their P-number, whether they are connected, and whether they host. They are changed only by the
   * server; `pad` is then a made-up negative number that no controller has.
   */
  remote?: { name: string; p: number; on: boolean; host: boolean };
}

/**
 * The arenas to choose from: the same build in three sizes. Standard is the one the game has always had.
 * (Shown as Mini, Standard and Big since November 2026, the owner's words; they were Compact, Classic and Big.
 * The ids, and so saved setups, are unchanged.)
 * Each brings its own round length and closing-in speed (an index into CLOSE_IN), put in whenever it is
 * picked in the lobby and changeable after: the owner's choices, scaled to the arena's size. Compact: 1:00
 * and Quick; Classic: 1:30 and Normal; Big: 2:00 and Normal. Bricks and power-ups are a share of the tiles,
 * so they already scale with the size and are left alone.
 */
export const ARENAS = [
  { id: 'compact', name: 'Mini', cols: 11, rows: 9, roundSecs: 60, closeIn: 3, blurb: 'Small and close: you meet the others fast.' },
  { id: 'classic', name: 'Standard', cols: 13, rows: 11, roundSecs: 90, closeIn: 2, blurb: 'The standard arena.' },
  { id: 'big', name: 'Big', cols: 15, rows: 13, roundSecs: 120, closeIn: 2, blurb: 'More room to run, more bricks to clear.' },
] as const;
export type ArenaId = (typeof ARENAS)[number]['id'];

/**
 * The maps: how the arena looks (render.ts draws each). A map is only a look: the floor, the solid blocks and
 * the breakable ones. The layout, the sizes above and the rules are the same on every map, so the rules
 * (sim.ts) know nothing of it. The first is the game's original look.
 */
export const MAPS = [
  { id: 'midnight', name: 'Midnight', solid: 'steel blocks', soft: 'bricks' },
  { id: 'western', name: 'Wild West', solid: 'red rock', soft: 'wooden crates' },
] as const;
export type MapId = (typeof MAPS)[number]['id'];
export function mapOf(s: MatchSetup): (typeof MAPS)[number] {
  return MAPS.find((m) => m.id === s.map) ?? MAPS[0];
}

/** How many bricks fill the arena: a share of the open tiles (0.78 is the game's usual). */
export const BRICKS = [
  { name: 'Few', density: 0.5 },
  { name: 'Some', density: 0.65 },
  { name: 'Normal', density: 0.78 },
  { name: 'Lots', density: 0.86 },
  { name: 'Packed', density: 0.93 },
];

/** How fast the blocks close in once the timer runs out: how long they take, in seconds (50 is the game's usual). */
export const CLOSE_IN = [
  { name: 'Very slow', secs: 75 },
  { name: 'Slow', secs: 60 },
  { name: 'Normal', secs: 50 },
  { name: 'Quick', secs: 42 },
  { name: 'Fast', secs: 32 },
];

/** How often each power-up turns up, as a share of its usual chance. */
export const ITEM_AMOUNTS = [
  { name: 'Off', times: 0 },
  { name: 'Rare', times: 0.5 },
  { name: 'Normal', times: 1 },
  { name: 'Lots', times: 2 },
];

/** The power-ups, in the order the lobby lists them, with the names it uses. */
export const ITEM_NAMES: [ItemKind, string, string][] = [
  ['bomb', 'Extra bomb', 'One more bomb down at a time'],
  ['fire', 'Flame', 'Blasts reach one tile further'],
  ['speed', 'Speed', 'Run faster'],
  ['kick', 'Boot', 'Kick bombs by running into them'],
  ['grab', 'Glove', 'Lift and throw bombs with B'],
  ['shield', 'Shield', 'Survive one blast'],
  ['curse', 'Curse', 'Slows you down for 8 seconds'],
];

/** Round lengths the timer can be set to: 30 seconds to 5 minutes, in steps of 15 seconds. */
export const ROUND_MIN = 30;
export const ROUND_MAX = 300;
export const ROUND_STEP = 15;
/** The most CPU players a local match can have: eight players in all (MAX_PLAYERS in sim.ts). */
export const MAX_CPUS = 7;
/** With more players than this, every arena is two tiles wider and taller (the owner's plan: past six, the map gets bigger). */
export const GROW_AFTER = 6;
/** Rounds to win a match: first to 1 to 9. */
export const MAX_FIRST_TO = 9;

/**
 * Which version of the defaults a saved setup was made with. 2: Rounds to win defaults to 1 (the owner's
 * call; it was 3), so a setup saved before then has its Rounds to win put back to 1. 3: Closing in has five
 * steps in place of three (Slow, Normal, Fast became Very slow, Normal, Fast).
 */
export const SETUP_VERSION = 7;

/** What a robot out of lives does, taking the Post-Mortem Behavior switch into account. */
export function afterlifeOf(s: MatchSetup): Afterlife {
  return s.postMortem ? s.afterlife : 'watch';
}

/** What a robot out of lives does for the rest of the round (MatchSetup.afterlife), in the lobby's order. */
export type Afterlife = 'watch' | 'angel' | 'zombie';
export const AFTERLIVES: { id: Afterlife; name: string; blurb: string }[] = [
  { id: 'watch', name: 'Watch', blurb: 'Watch the rest of the round' },
  { id: 'angel', name: 'Angel', blurb: 'Haunt the wall and throw bombs in: hold A to throw further' },
  { id: 'zombie', name: 'Zombie', blurb: 'Get up where you fell, slow, with one small bomb' },
];

export interface MatchSetup {
  /** SETUP_VERSION when it was saved */
  v: number;
  cpus: CpuSlot[];
  /**
   * Randomize CPUs (the Players page; the owner's ask): each CPU player gets an emote, a level, or both,
   * picked at random at the start of every match (`rollCpus`), in place of the ones on its card.
   */
  randEmotes: boolean;
  randLevels: boolean;
  arena: ArenaId;
  /** how the arena looks (MAPS) */
  map: MapId;
  /** the round timer: off means no timer and no falling blocks, so a round lasts until one bot is left */
  timerOn: boolean;
  roundSecs: number;
  /** index into CLOSE_IN */
  closeIn: number;
  /** rounds to win the match */
  firstTo: number;
  /** index into BRICKS */
  bricks: number;
  /** a custom start: when off, everyone starts with 1 bomb, a blast of 1 and no speed power-ups */
  startOn: boolean;
  startBombs: number;
  startFire: number;
  startSpeed: number;
  /** a custom power-up mix: when off, the usual chances (ITEM_CHANCE) */
  itemsOn: boolean;
  /** index into ITEM_AMOUNTS for each kind */
  items: Record<ItemKind, number>;
  /** lives each robot has in a round, 1 to MAX_LIVES (sim.ts) */
  lives: number;
  /**
   * What a robot out of lives does for the rest of the round: watch, haunt the wall as an angel throwing bombs
   * in, or get up again in the arena as a zombie with one small bomb (AFTERLIFE)
   */
  afterlife: Afterlife;
  /** the lobby's Post-Mortem Behavior switch: off, everyone out of lives watches, whatever `afterlife` says */
  postMortem: boolean;
  /** with angels: an angel whose bomb knocks a robot out comes back in its place */
  angelsBack: boolean;
  /**
   * Teams (the Players page; the owner's ask, November 2026): the robots play in teams, and the last team
   * standing wins the round. Every robot on it gets the point. A team is its colour (TEAMS): changing a
   * team's colour changes it for everyone on it.
   */
  teamsOn: boolean;
  /**
   * Where each robot sits on the Players page, by its colour (one colour is one robot in a match), in order:
   * two to a row. A robot not in it sits at the end (`seating`). Dragging a card onto another swaps their seats.
   */
  seats: string[];
  /**
   * With Teams of 2 or 4: the team of each row of the Players page (the owner's design, 17 November 2026: the
   * row a robot sits in is its team), an index into TEAMS. Each team is that many rows' worth (Teams of 4: two
   * rows), all one colour (`rowTeams`).
   */
  rowTeams: number[];
  /**
   * In Custom: each robot's team by its colour, an index into TEAMS. A robot not in it is on a team of its own,
   * in a colour nobody has (the owner's ask: everyone on their own until a colour is picked to match another).
   */
  teams: Record<string, number>;
  /**
   * With Teams of 2 or 4: a robot given a team of its own with the Team ‹ › on its card, by its colour, an index
   * into TEAMS (the owner's ask, 18 November 2026: one player's colour changed on its own, its row partner
   * staying where it is). It plays for that team, not its row's, until its row is tapped round (`recolour`),
   * its card is dragged (`dropOnto`), it is given its row's colour again, or a team size is picked.
   */
  ownTeams: Record<string, number>;
  /**
   * Team size (the lobby's Custom, Teams of 2, Teams of 4): 0 is Custom, the default, where every robot is on
   * a team of its own unless its colour is picked to match another's (`teams`). Otherwise every team is this
   * many robots, rows of two side by side (`rowTeams`): only offered when the players divide into such teams
   * (`teamSizes`), Custom while they do not.
   */
  teamSize: number;
  /** in a teams match, can a teammate's blast knock you out? */
  friendlyFire: boolean;
}

/** The colours a team can have. A team is known by its colour: the Red team, the Green team... */
export const TEAMS = [
  { name: 'Red team', short: 'Red', color: '#ff5a5f' },
  { name: 'Blue team', short: 'Blue', color: '#3fa7ff' },
  { name: 'Green team', short: 'Green', color: '#3ddc84' },
  { name: 'Yellow team', short: 'Yellow', color: '#ffd23f' },
  { name: 'Purple team', short: 'Purple', color: '#b07cff' },
  { name: 'Orange team', short: 'Orange', color: '#ff9440' },
  { name: 'Pink team', short: 'Pink', color: '#ff6ec7' },
  { name: 'Cyan team', short: 'Cyan', color: '#3ee6e0' },
];
const isTeam = (t: unknown): t is number => typeof t === 'number' && Number.isInteger(t) && t >= 0 && t < TEAMS.length;

/** The team sizes `n` robots can be split into exactly, in whole rows of two and at least two teams: 8 robots, [2, 4]; 6, [2]; 5, none. */
export function teamSizes(n: number): number[] {
  const out: number[] = [];
  for (let k = 2; k <= n / 2; k += 2) if (n % k === 0) out.push(k);
  return out;
}

/** The team size in force for `n` robots: the one picked if they divide into it, else 0 (Custom). */
export function fixedSize(s: MatchSetup, n: number): number {
  return teamSizes(n).includes(s.teamSize) ? s.teamSize : 0;
}

/** Where the robots sit, by colour: as `s.seats` has them, then anyone not in it in player order. */
export function seating(s: MatchSetup, colours: string[]): string[] {
  const out = s.seats.filter((c, i) => colours.includes(c) && s.seats.indexOf(c) === i);
  for (const c of colours) if (!out.includes(c)) out.push(c);
  return out;
}

/**
 * The team of each row, for `n` robots sitting two to a row: as picked, and kept to the rules. With a team
 * size, each team's rows are one colour (its first row's); with nothing picked yet each team has a colour of
 * its own, in TEAMS order, and a row new since (a robot more) starts a team in a colour no other row has.
 * Two teams can be given the same colour, by hand: they are then one team (the owner's ask, 18 November
 * 2026: 2 v 2 v 2 v 2 turned into 4 v 2 v 2, or all one team). In Custom (where this only remembers the
 * rows for a team size picked later): with nothing picked, the first half of the rows red and the rest blue,
 * a new row joining the team with the fewest robots, and never one team only (with two rows or more).
 */
export function rowTeams(s: MatchSetup, n: number): number[] {
  const rows = Math.ceil(n / 2);
  const per = (r: number): number => (r < rows - 1 || n % 2 === 0 ? 2 : 1); // robots in row r
  const size = fixedSize(s, n);
  const span = size / 2; // with a team size, rows to a team
  let out: number[];
  if (!s.rowTeams.some(isTeam)) {
    const red = Math.max(1, Math.floor(rows / 2));
    out = Array.from({ length: rows }, (_, r) => (size ? Math.floor(r / span) % TEAMS.length : r < red ? 0 : 1));
  } else {
    // (the colours picked for these rows, so a new row can start a team in one nobody has)
    const used = new Set([...s.rowTeams.slice(0, rows), ...(size ? Object.values(s.ownTeams) : [])].filter(isTeam));
    out = [];
    for (let r = 0; r < rows; r++) {
      if (isTeam(s.rowTeams[r])) out.push(s.rowTeams[r]);
      else if (size) {
        const t = TEAMS.findIndex((_, k) => !used.has(k));
        out.push(t < 0 ? 0 : t);
        used.add(t);
      } else {
        const count = new Map<number, number>();
        out.forEach((t, k) => count.set(t, (count.get(t) ?? 0) + per(k)));
        let best = out[0] ?? 0;
        for (const [t, k] of count) if (k < count.get(best)!) best = t;
        out.push(best);
      }
    }
  }
  if (size) {
    for (let r = 0; r < rows; r++) out[r] = out[r - (r % span)];
  } else if (rows > 1 && out.every((t) => t === out[0])) out[rows - 1] = out[0] === 0 ? 1 : 0;
  return out;
}

/**
 * In Custom, the team of each robot, given where they sit (`seats`): the one picked for it, or else a colour
 * nobody has (a team of its own), in the order they sit.
 */
function customTeams(s: MatchSetup, seats: string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of seats) if (isTeam(s.teams[c])) out.set(c, s.teams[c]);
  const used = new Set(out.values());
  for (const c of seats) {
    if (out.has(c)) continue;
    const t = TEAMS.findIndex((_, k) => !used.has(k));
    out.set(c, t < 0 ? 0 : t);
    used.add(t);
  }
  return out;
}

/**
 * The team of each robot in a match, given their colours in player order (you, the other players, the CPU
 * players). With Teams of 2 or 4, the team of the row it sits in (`seating`, `rowTeams`), or the one its own ‹ ›
 * gave it (`ownTeams`); in Custom, its own
 * (`teams`), and nothing else ever changes it: everyone can even be on one team (the owner's ask; the round
 * is then played together, sim.ts `coop`).
 */
export function teamsFor(s: MatchSetup, colours: string[]): number[] {
  const seats = seating(s, colours);
  let out: number[];
  if (fixedSize(s, colours.length)) {
    const rows = rowTeams(s, colours.length);
    out = colours.map((c) => (isTeam(s.ownTeams[c]) ? s.ownTeams[c] : rows[Math.floor(seats.indexOf(c) / 2)]));
  } else {
    const t = customTeams(s, seats);
    out = colours.map((c) => t.get(c)!);
  }
  return out;
}

/**
 * Write everyone's seat and team down as they are now, so they stay put as players come and go and every
 * page (and the server, online) works them out the same. Returns the rows' teams.
 */
export function settleTeams(s: MatchSetup, colours: string[]): number[] {
  // a team size the players no longer divide into is Custom from now on, everyone keeping their team (it
  // must not come back by itself, rearranging everyone, when a player comes or goes again)
  if (s.teamSize && !fixedSize(s, colours.length)) {
    // (each robot that was seated keeps the team of the row it sat in, or its own; a newcomer gets a team of its own)
    s.teams = {};
    s.seats.forEach((c, i) => {
      const t = isTeam(s.ownTeams[c]) ? s.ownTeams[c] : s.rowTeams[Math.floor(i / 2)];
      if (colours.includes(c) && isTeam(t)) s.teams[c] = t;
    });
    s.teamSize = 0;
  }
  for (const c of Object.keys(s.ownTeams)) if (!colours.includes(c) || !fixedSize(s, colours.length)) delete s.ownTeams[c];
  s.seats = seating(s, colours);
  s.rowTeams = rowTeams(s, colours.length);
  if (!fixedSize(s, colours.length)) {
    const now = teamsFor(s, colours);
    s.teams = Object.fromEntries(colours.map((c, i) => [c, now[i]]));
  }
  return s.rowTeams;
}
const settle = settleTeams;

/** The rows that are one team with row `row` for the colour changes: its team's rows with a team size, else just it. */
function rowsOf(s: MatchSetup, n: number, row: number): number[] {
  const size = fixedSize(s, n);
  if (!size) return [row];
  const span = size / 2;
  const b = Math.floor(row / span);
  return Array.from({ length: span }, (_, k) => b * span + k).filter((r) => r < Math.ceil(n / 2));
}

/**
 * The colours the Team ‹ › on a robot's card goes through, in TEAMS order: every one. In Custom, a colour
 * another robot has puts it on that robot's team; one nobody has, a team of its own (all of them one team,
 * too). With Teams of 2 or 4 the same: it changes that one robot's team, its row partner staying where it is
 * (the owner's ask, 18 November 2026; the whole row is the tap's, `recolour`).
 */
export function teamChoices(_s: MatchSetup, _colours: string[], _colour: string): number[] {
  return TEAMS.map((_, t) => t);
}

/**
 * Put a robot on team `team` with the Team ‹ › on its card. In Custom, it joins whoever has that colour and
 * stays where it sits (the owner's call: only dragging a card moves it). With Teams of 2 or 4 too, only this
 * robot changes (the owner's ask, 18 November 2026): its row's colour puts it back with its row, any other
 * gives it a team of its own or joins whoever has that colour (`ownTeams`). False if not allowed (see teamChoices).
 */
export function pickTeam(s: MatchSetup, colours: string[], colour: string, team: number): boolean {
  if (!teamChoices(s, colours, colour).includes(team)) return false;
  settle(s, colours);
  if (fixedSize(s, colours.length)) {
    if (s.rowTeams[Math.floor(s.seats.indexOf(colour) / 2)] === team) delete s.ownTeams[colour];
    else s.ownTeams[colour] = team;
    return true;
  }
  s.teams[colour] = team;
  return true;
}

/**
 * A tap where a robot's name is. In Custom its whole team (everyone with its colour) takes the next colour no
 * other team has. With Teams of 2 or 4 its row (its team's rows) takes the next colour after the tapped
 * robot's, whoever has it: one another team has makes the two one team, and the next tap moves this row on
 * again, leaving them as they were (the owner's ask, 18 November 2026: any team's colour can be overridden).
 * Everyone in the row goes with it, a robot given a team of its own (`ownTeams`) included. Returns the colour.
 */
export function recolour(s: MatchSetup, colours: string[], colour: string): number {
  settle(s, colours);
  const now = teamsFor(s, colours);
  const mine = now[colours.indexOf(colour)];
  if (fixedSize(s, colours.length)) {
    const t = (mine + 1) % TEAMS.length;
    for (const r of rowsOf(s, colours.length, Math.floor(s.seats.indexOf(colour) / 2))) {
      s.rowTeams[r] = t;
      for (const c of s.seats.slice(r * 2, r * 2 + 2)) delete s.ownTeams[c];
    }
    return t;
  }
  const others = new Set(now.filter((t) => t !== mine));
  for (let d = 1; d < TEAMS.length; d++) {
    const t = (mine + d) % TEAMS.length;
    if (others.has(t)) continue;
    for (const c of colours) if (s.teams[c] === mine) s.teams[c] = t;
    return t;
  }
  return mine;
}

/**
 * Card `a` dragged onto card `b`. With Teams of 2 or 4 they swap seats, so each plays for the other's row
 * (a team of its own given by its ‹ › is dropped).
 * In Custom (and with teams off) `a` moves to sit beside `b` and, in a teams match, joins its team (unless
 * that would leave only one team).
 */
export function dropOnto(s: MatchSetup, colours: string[], a: string, b: string, teamsOn: boolean): void {
  settle(s, colours);
  const i = s.seats.indexOf(a);
  const j = s.seats.indexOf(b);
  if (i < 0 || j < 0 || a === b) return;
  if (fixedSize(s, colours.length)) {
    [s.seats[i], s.seats[j]] = [b, a];
    delete s.ownTeams[a]; // (each now plays for the row it was put in)
    delete s.ownTeams[b];
    return;
  }
  if (teamsOn) s.teams[a] = s.teams[b]; // (only the one dragged changes team)
  const rest = s.seats.filter((c) => c !== a);
  const k = rest.indexOf(b);
  s.seats = [...rest.slice(0, k + 1), a, ...rest.slice(k + 1)];
}

/** A robot moves to the last seat (a card dragged onto the empty place at the end). */
export function seatLast(s: MatchSetup, colours: string[], a: string): void {
  settle(s, colours);
  s.seats = [...s.seats.filter((c) => c !== a), a];
}

/**
 * Picking a team size. Into Custom, everyone is on a team of their own again, each in a colour of their own
 * (the owner's ask: however the sizes were gone through); into Teams of 2 or 4, each team (its row, or two
 * rows) takes the team of whoever sits first in it, or a colour of its own if a team before it has that one:
 * a size picked always starts as even teams in colours of their own (2 v 2 v 2 v 2). A colour can be given
 * to two of them by hand afterwards (pickTeam, recolour).
 */
export function setTeamSize(s: MatchSetup, colours: string[], size: number): void {
  const before = teamsFor(s, colours);
  const seats = seating(s, colours);
  s.seats = seats;
  s.teamSize = size;
  s.ownTeams = {};
  if (fixedSize(s, colours.length)) {
    const span = size / 2;
    const used: number[] = [];
    s.rowTeams = Array.from({ length: Math.ceil(seats.length / 2) }, (_, r) => {
      if (r % span === 0) {
        let t = before[colours.indexOf(seats[r * 2])];
        if (used.includes(t)) t = TEAMS.findIndex((_, k) => !used.includes(k));
        used.push(t);
      }
      return used[used.length - 1];
    });
  } else s.teams = {};
  settle(s, colours);
}

/**
 * Even out, in Custom (the owner's ask): the teams made the same size. When the robots do not divide into
 * the teams there are, the fewest teams are given up until they do (4 robots in 2 v 1 v 1 become 2 v 2;
 * 6 in 2 v 2 v 1 v 1 become 2 v 2 v 2), the smallest teams going first; at first it only spread the robots
 * as evenly as the same number of teams allowed, which left 2 v 1 v 1 as it was, so the button seemed to do
 * nothing (the owner's report, 18 November 2026). When no smaller number of teams divides them (5 or 7
 * robots), the teams stay and differ by one at most (5 in 3 v 1 v 1 become 2 v 2 v 1). As many robots as can
 * stay on their own team do; the rest join the teams short of robots, and teammates then sit together.
 * (Teams of 2 or 4 are even already.)
 */
export function evenTeams(s: MatchSetup, colours: string[]): void {
  settle(s, colours);
  if (fixedSize(s, colours.length)) return;
  const seats = s.seats;
  const n = seats.length;
  const order: number[] = []; // the teams, in the order their first robot sits
  for (const c of seats) if (!order.includes(s.teams[c])) order.push(s.teams[c]);
  const size = (t: number): number => seats.filter((c) => s.teams[c] === t).length;
  // the biggest teams first: they are the ones kept, and keep the bigger shares
  const byBig = [...order].sort((a, b) => size(b) - size(a) || order.indexOf(a) - order.indexOf(b));
  let k = order.length;
  for (let d = k; d >= 2; d--) if (n % d === 0) { k = d; break; }
  const want = Array.from({ length: k }, (_, i) => Math.floor(n / k) + (i < n % k ? 1 : 0));
  const target = new Map(order.map((t) => [t, 0]));
  byBig.slice(0, k).forEach((t, i) => target.set(t, want[i]));
  const kept = new Map<number, number>();
  const spare: string[] = [];
  for (const c of seats) {
    const t = s.teams[c];
    if ((kept.get(t) ?? 0) < target.get(t)!) kept.set(t, (kept.get(t) ?? 0) + 1);
    else spare.push(c);
  }
  for (const c of spare) {
    const t = order.find((x) => (kept.get(x) ?? 0) < target.get(x)!)!;
    s.teams[c] = t;
    kept.set(t, (kept.get(t) ?? 0) + 1);
  }
  s.seats = order.flatMap((t) => seats.filter((c) => s.teams[c] === t));
}

/** Whether Even out would change anything (the button is dimmed when not, so a press never seems to do nothing). */
export function canEven(s: MatchSetup, colours: string[]): boolean {
  const copy: MatchSetup = JSON.parse(JSON.stringify(s));
  settle(copy, colours);
  const before = JSON.stringify(teamsFor(copy, colours));
  evenTeams(copy, colours);
  return JSON.stringify(teamsFor(copy, colours)) !== before;
}

/** Teams on: everyone on a team of their own in Custom (the owner's ask), or the rows as the team size makes them. */
export function startTeams(s: MatchSetup, colours: string[]): void {
  s.teams = {};
  s.rowTeams = [];
  s.ownTeams = {};
  settle(s, colours);
}

/** The teams in play and how many are on each, biggest first: "2 v 2 v 1"; with more than four teams, closer: "3v2v1v1v1". */
export function lineUp(s: MatchSetup, colours: string[]): string {
  const n = new Map<number, number>();
  for (const t of teamsFor(s, colours)) n.set(t, (n.get(t) ?? 0) + 1);
  if (n.size === 1 && colours.length > 1) return 'All one team';
  return [...n.values()].sort((a, b) => b - a).join(n.size > 4 ? 'v' : ' v ');
}

/**
 * Two robots swap colours (a CPU player gives its colour up to you), or one takes a colour nobody has: each
 * keeps its seat, so its team.
 */
export function swapTeams(s: MatchSetup, a: string, b: string): void {
  s.seats = s.seats.map((c) => (c === a ? b : c === b ? a : c));
  const ta = s.teams[a];
  const tb = s.teams[b];
  delete s.teams[a];
  delete s.teams[b];
  if (tb !== undefined) s.teams[a] = tb;
  if (ta !== undefined) s.teams[b] = ta;
  const oa = s.ownTeams[a];
  const ob = s.ownTeams[b];
  delete s.ownTeams[a];
  delete s.ownTeams[b];
  if (ob !== undefined) s.ownTeams[a] = ob;
  if (oa !== undefined) s.ownTeams[b] = oa;
}

export function defaultSetup(myColor: string): MatchSetup {
  const others = ['black', 'pink', 'blue', 'red', 'orange', 'white', 'green', 'purple', 'gold'].filter((c) => c !== myColor);
  return {
    cpus: others.slice(0, 3).map((colorId) => ({ colorId, level: 'normal' as BotLevel })),
    arena: 'classic',
    timerOn: true,
    roundSecs: ARENAS[1].roundSecs,
    closeIn: ARENAS[1].closeIn,
    map: 'midnight',
    randEmotes: false,
    randLevels: false,
    v: SETUP_VERSION,
    firstTo: 1,
    bricks: 2,
    startOn: false,
    startBombs: 1,
    startFire: START_FIRE,
    startSpeed: 0,
    itemsOn: false,
    items: { bomb: 2, fire: 2, speed: 2, kick: 2, grab: 2, shield: 2, curse: 2 },
    lives: 1,
    afterlife: 'watch', // watching is the standard: Post-Mortem Behavior off (the owner's call)
    postMortem: false,
    angelsBack: false,
    teamsOn: false,
    seats: [],
    rowTeams: [],
    teams: {},
    ownTeams: {},
    teamSize: 0, // Custom (the owner's call)
    friendlyFire: false, // teammates are safe from each other's blasts unless it is switched on
  };
}

/** Pick an arena, and put in its round length and closing-in speed (they can be changed after). */
export function pickArena(s: MatchSetup, id: ArenaId): void {
  const a = ARENAS.find((x) => x.id === id) ?? ARENAS[1];
  s.arena = a.id;
  s.roundSecs = a.roundSecs;
  s.closeIn = a.closeIn;
}

/**
 * The rules of a setup, put back to the usual ones for the arena it has picked (its own round length and
 * closing-in speed: the owner's call, so Reset to Default on Compact gives Compact's rules). The arena and
 * the players are left as they are.
 */
export function defaultRules(s: MatchSetup, myColor: string): MatchSetup {
  // (the Players page's settings stay: the players, Randomize CPUs and the teams)
  const out = { ...defaultSetup(myColor), cpus: s.cpus, map: s.map, randEmotes: s.randEmotes, randLevels: s.randLevels, teamsOn: s.teamsOn, seats: s.seats, rowTeams: s.rowTeams, teams: s.teams, ownTeams: s.ownTeams, teamSize: s.teamSize, friendlyFire: s.friendlyFire };
  pickArena(out, s.arena);
  return out;
}

/**
 * The CPU players as a match will have them: as on their cards, or, with Randomize CPUs on, each with an
 * emote or a level (or both) picked at random. `random` gives a number from 0 up to 1. A new list: the
 * setup's own CPU players are left as they are.
 */
export function rollCpus(s: MatchSetup, random: () => number): CpuSlot[] {
  const pick = <T>(list: readonly T[]): T => list[Math.min(list.length - 1, Math.floor(random() * list.length))];
  return s.cpus.map((c) => ({
    ...c,
    ...(s.randLevels ? { level: pick(BOT_LEVELS) } : {}),
    ...(s.randEmotes ? { dance: pick(DANCES).id } : {}),
  }));
}

export function arenaOf(s: MatchSetup): (typeof ARENAS)[number] {
  return ARENAS.find((a) => a.id === s.arena) ?? ARENAS[1];
}

/** The size the arena is played at: as chosen, or two tiles bigger each way with more than GROW_AFTER players. */
export function arenaSize(s: MatchSetup, guests = 0): { cols: number; rows: number; grown: boolean } {
  const a = arenaOf(s);
  const grown = s.cpus.length + 1 + guests > GROW_AFTER;
  return { cols: a.cols + (grown ? 2 : 0), rows: a.rows + (grown ? 2 : 0), grown };
}

/** The chance of each power-up for this setup (the usual ones unless the mix is custom). */
export function itemChances(s: MatchSetup): [ItemKind, number][] {
  if (!s.itemsOn) return ITEM_CHANCE;
  const out = ITEM_CHANCE.map(([k, c]): [ItemKind, number] => [k, c * ITEM_AMOUNTS[s.items[k]].times]);
  // (Lots of many kinds could ask for more than every brick: then each is scaled down to fit, in proportion)
  const sum = out.reduce((n, [, c]) => n + c, 0);
  return sum > 1 ? out.map(([k, c]) => [k, c / sum]) : out;
}

/** The config sim.ts builds a round from: you first, then the other players on this screen, then the CPU players in their lobby order. */
export function worldConfig(s: MatchSetup, myColor: string, seed: number, guests: string[] = []): WorldConfig {
  const size = arenaSize(s, guests.length);
  const colours = [myColor, ...guests, ...s.cpus.map((c) => c.colorId)];
  return {
    ...(s.teamsOn ? { teams: teamsFor(s, colours), friendlyFire: s.friendlyFire } : {}),
    seed,
    cols: size.cols,
    rows: size.rows,
    players: [{ colorId: myColor }, ...guests.map((colorId) => ({ colorId })), ...s.cpus.map((c) => ({ colorId: c.colorId }))],
    softDensity: BRICKS[s.bricks].density,
    roundTicks: s.timerOn ? s.roundSecs * TICK_HZ : 0,
    shrinkTicks: CLOSE_IN[s.closeIn].secs * TICK_HZ,
    itemChance: itemChances(s),
    startBombs: s.startOn ? s.startBombs : 1,
    startFire: s.startOn ? s.startFire : START_FIRE,
    startSpeed: s.startOn ? s.startSpeed : 0,
    lives: s.lives,
    angels: afterlifeOf(s) !== 'angel' ? 'off' : s.angelsBack ? 'revive' : 'on',
    zombies: afterlifeOf(s) === 'zombie',
  };
}

/** "1:30" */
export function clockText(secs: number): string {
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

/** One line saying what the match is: shown at the top of the lobby and in the in-match menu. */
export function summary(s: MatchSetup, guests = 0): string {
  const parts = [
    `${s.cpus.length + 1 + guests} players`,
    s.map === 'midnight' ? `${arenaOf(s).name} arena` : `${mapOf(s).name}, ${arenaOf(s).name}`,
    s.timerOn ? `${clockText(s.roundSecs)} rounds` : 'No timer',
    `First to ${s.firstTo}`,
  ];
  if (s.teamsOn) parts.push(s.friendlyFire ? 'Teams, friendly fire' : 'Teams');
  if (s.lives > 1) parts.push(`${s.lives} lives`);
  if (afterlifeOf(s) === 'angel') parts.push(s.angelsBack ? 'Angels come back' : 'Angels');
  if (afterlifeOf(s) === 'zombie') parts.push('Zombies');
  if (s.startOn) parts.push('Custom start');
  if (s.itemsOn) parts.push('Custom power-ups');
  return parts.join(' · ');
}

/** Can this setup be played? It needs someone to play against: a CPU player, or another player on this screen. */
export function problem(s: MatchSetup, guests = 0): string {
  if (s.cpus.length + guests === 0) return 'Add a CPU player, or press A on another controller, to have someone to play against.';
  return '';
}

const clampInt = (v: unknown, lo: number, hi: number, dflt: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : dflt;

/** Read a saved setup, keeping only what looks right. Colours must differ from yours and from each other. */
export function readSetup(raw: unknown, myColor: string, colorIds: string[]): MatchSetup {
  const d = defaultSetup(myColor);
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<MatchSetup>;
  const out: MatchSetup = { ...d, items: { ...d.items } };
  if (Array.isArray(r.cpus)) {
    const used = new Set([myColor]);
    out.cpus = [];
    for (const c of r.cpus.slice(0, MAX_CPUS)) {
      if (!c || !colorIds.includes(c.colorId) || used.has(c.colorId)) continue;
      used.add(c.colorId);
      out.cpus.push({ colorId: c.colorId, level: BOT_LEVELS.includes(c.level) ? c.level : 'normal', ...(readDance(c.dance) ? { dance: readDance(c.dance) } : {}) });
    }
    if (out.cpus.length === 0) out.cpus = d.cpus;
  }
  if (ARENAS.some((a) => a.id === r.arena)) out.arena = r.arena as ArenaId;
  if (MAPS.some((m) => m.id === r.map)) out.map = r.map as MapId;
  if (typeof r.randEmotes === 'boolean') out.randEmotes = r.randEmotes;
  if (typeof r.randLevels === 'boolean') out.randLevels = r.randLevels;
  if (typeof r.timerOn === 'boolean') out.timerOn = r.timerOn;
  out.roundSecs = clampInt(r.roundSecs, ROUND_MIN, ROUND_MAX, d.roundSecs);
  out.roundSecs -= out.roundSecs % ROUND_STEP;
  // before version 3 Closing in had three steps: Slow (75 s), Normal, Fast (32 s)
  const oldClose = typeof r.v !== 'number' || r.v < 3;
  out.closeIn = oldClose ? ([0, 2, 4][clampInt(r.closeIn, 0, 2, 1)] ?? d.closeIn) : clampInt(r.closeIn, 0, CLOSE_IN.length - 1, d.closeIn);
  // saved before Rounds to win defaulted to 1: it goes back to 1
  out.firstTo = typeof r.v === 'number' && r.v >= 2 ? clampInt(r.firstTo, 1, MAX_FIRST_TO, d.firstTo) : d.firstTo;
  out.bricks = clampInt(r.bricks, 0, BRICKS.length - 1, d.bricks);
  if (typeof r.startOn === 'boolean') out.startOn = r.startOn;
  out.startBombs = clampInt(r.startBombs, 1, MAX_BOMBS, 1);
  out.startFire = clampInt(r.startFire, START_FIRE, MAX_FIRE, START_FIRE);
  out.startSpeed = clampInt(r.startSpeed, 0, MAX_SPEED_ITEMS, 0);
  if (typeof r.itemsOn === 'boolean') out.itemsOn = r.itemsOn;
  if (r.items && typeof r.items === 'object') {
    for (const [k] of ITEM_CHANCE) out.items[k] = clampInt((r.items as Record<string, unknown>)[k], 0, ITEM_AMOUNTS.length - 1, 2);
  }
  out.lives = clampInt(r.lives, 1, MAX_LIVES, 1);
  // Angels were on by default in version 4, for one evening; the owner had them off by default, so a setup
  // saved then starts with them off again, like a new one
  const was = r as Partial<MatchSetup> & { angels?: unknown };
  if (AFTERLIVES.some((a) => a.id === was.afterlife)) out.afterlife = was.afterlife as Afterlife;
  else if (was.angels === true && typeof r.v === 'number' && r.v === 5) out.afterlife = 'angel'; // version 5 had an Angels switch
  // version 7 put the choice under a Post-Mortem Behavior switch: a choice made before it, it is on
  if (typeof was.postMortem === 'boolean') out.postMortem = was.postMortem;
  else out.postMortem = out.afterlife !== 'watch';
  if (typeof r.angelsBack === 'boolean') out.angelsBack = r.angelsBack;
  if (typeof r.teamsOn === 'boolean') out.teamsOn = r.teamsOn;
  if (typeof r.friendlyFire === 'boolean') out.friendlyFire = r.friendlyFire;
  if (Array.isArray(r.seats)) out.seats = r.seats.filter((c, i, all) => typeof c === 'string' && colorIds.includes(c) && all.indexOf(c) === i).slice(0, 9);
  if (Array.isArray(r.rowTeams)) out.rowTeams = r.rowTeams.slice(0, 5).map((t) => (isTeam(t) ? t : 0));
  if (r.teams && typeof r.teams === 'object') {
    for (const [c, t] of Object.entries(r.teams)) if (colorIds.includes(c) && isTeam(t)) out.teams[c] = t;
  }
  if (r.ownTeams && typeof r.ownTeams === 'object') {
    for (const [c, t] of Object.entries(r.ownTeams)) if (colorIds.includes(c) && isTeam(t)) out.ownTeams[c] = t;
  }
  out.teamSize = clampInt(r.teamSize, 0, 4, d.teamSize);
  if (out.teamSize % 2) out.teamSize = 0; // (whole rows of two: Teams of 2 or 4)
  return out;
}

// ---------------------------------------------------------------- your own settings

/** The sounds, with the names the Sound settings use. The ids are the names of the functions in audio.ts. */
export const SOUND_NAMES: [string, string][] = [
  ['place', 'Dropping a bomb'],
  ['explode', 'Blast'],
  ['pickup', 'Power-up'],
  ['curse', 'Curse'],
  ['shield', 'Shield saves you'],
  ['kick', 'Kick and throw'],
  ['lift', 'Lift and land'],
  ['hurry', 'Blocks about to fall'],
  ['block', 'Block landing'],
  ['death', 'Knocked out'],
  ['win', 'Round won'],
];

/**
 * The sound switches in Settings › Sound, in groups (the owner's ask, 18 November 2026: easier to look at).
 * Every id in SOUND_NAMES once (tests/room.test.ts checks).
 */
export const SOUND_GROUPS: [string, string[]][] = [
  ['Bombs', ['place', 'explode', 'kick', 'lift']],
  ['Power-ups', ['pickup', 'shield', 'curse']],
  ['Falling blocks', ['hurry', 'block']],
  ['Knockouts and wins', ['death', 'win']],
];

/**
 * How sharp the game is drawn: the most of the screen's pixels it uses for each of the page's (`cap`), and
 * `over`: drawn with that many times the screen's own pixels each way, and shrunk to fit by the browser.
 * Smoothest (November 2026) is the owner's report that the arena looked best on his iPhone with Safari's
 * Request Desktop Website, which shows a page shrunk from a bigger one: drawn with more pixels than the
 * screen has, edges and moving robots come out smoother. It draws four times the pixels, so it is offered,
 * not the default, until it has been tried on his phone (on a slow computer without a graphics chip it fell
 * from 60 frames a second to 20 in an eight-player round).
 */
export const SHARPNESS = [
  { name: 'Battery saver', cap: 1.5, over: 1 },
  { name: 'Balanced', cap: 2, over: 1 },
  { name: 'Sharpest', cap: 6, over: 1 },
  { name: 'Smoothest', cap: 6, over: 2 },
];
/** The Sharpness a player has unless they pick another. */
export const DEFAULT_SHARPNESS = 2;

export interface Prefs {
  soundOn: boolean;
  /** 0 to 100 */
  volume: number;
  /** sounds switched off, by id */
  muted: string[];
  /** index into SHARPNESS */
  sharpness: number;

  /** the ghosts of knocked-out robots floating up the screen */
  ghosts: boolean;
  /** every blast burns ordinary orange fire, in place of its robot's colour (Settings › Graphics) */
  orangeFire: boolean;
  /** less movement in the menus: no pulsing buttons, no waving robot on the title */
  calm: boolean;
  /** how strongly the touch controls show: 40 to 200 (per cent of the usual) */
  padShow: number;
  /** the keyboard's keys and the controller's buttons (bindings.ts; Settings › Controls) */
  keys: KeyMap;
  padKeys: PadMap;
  /** shake the controller on a knockout or a blast close by */
  rumble: boolean;
}

export function defaultPrefs(): Prefs {
  return { soundOn: true, volume: 80, muted: [], sharpness: DEFAULT_SHARPNESS, ghosts: true, orangeFire: false, calm: false, padShow: 100, keys: defaultKeys(), padKeys: defaultPad(), rumble: true };
}

export function readPrefs(raw: unknown): Prefs {
  const d = defaultPrefs();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<Prefs>;
  return {
    soundOn: typeof r.soundOn === 'boolean' ? r.soundOn : d.soundOn,
    volume: clampInt(r.volume, 0, 100, d.volume),
    muted: Array.isArray(r.muted) ? r.muted.filter((m) => SOUND_NAMES.some(([id]) => id === m)) : [],
    sharpness: clampInt(r.sharpness, 0, SHARPNESS.length - 1, d.sharpness),
    ghosts: typeof r.ghosts === 'boolean' ? r.ghosts : d.ghosts,
    orangeFire: typeof r.orangeFire === 'boolean' ? r.orangeFire : d.orangeFire,
    calm: typeof r.calm === 'boolean' ? r.calm : d.calm,
    padShow: clampInt(r.padShow, 40, 200, d.padShow),
    keys: readKeys(r.keys),
    padKeys: readPad(r.padKeys),
    rumble: typeof r.rumble === 'boolean' ? r.rumble : d.rumble,
  };
}

// ---------------------------------------------------------------- saving

export function load<T>(key: string, read: (raw: unknown) => T): T {
  try {
    return read(JSON.parse(localStorage.getItem(key) ?? 'null'));
  } catch {
    return read(null);
  }
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage is optional */
  }
}

/**
 * The tile size (in screen pixels) to draw the arena at: the biggest up to `T` that makes the arena a whole
 * number of page pixels wide and high. Browsers place and size things in fractions of a page pixel (Safari in
 * 64ths), and an arena 1172 screen pixels wide at density 3 is 390.67 page pixels, which Safari rounds to
 * 390.67 less a hair: the canvas is then stretched by that hair and every pixel of it is smoothed, the whole
 * arena soft while the text round it stays sharp. That was the blur that kept coming back on the owner's
 * iPhone and could not be seen on a computer, where the density is 2 and halves fit 64ths exactly. At most a
 * few screen pixels a tile are given up (a tile is about 80). On a fractional density (a zoomed page) a whole
 * page pixel is rarely a whole screen pixel, so the nearest it can find is taken, or `T` as it is.
 */
export function wholeTile(T: number, cols: number, rows: number, dpr: number): number {
  const whole = (n: number): boolean => Math.abs(n - Math.round(n)) < 1e-6;
  for (let t = T; t >= Math.max(8, T - 12); t--) if (whole((t * cols) / dpr) && whole((t * rows) / dpr)) return t;
  return T;
}
