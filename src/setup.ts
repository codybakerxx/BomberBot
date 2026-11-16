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
import { readDance, type DanceId } from './dances';
import { BotLevel, BOT_LEVELS } from './bot';
import { KeyMap, PadMap, defaultKeys, defaultPad, readKeys, readPad } from './bindings';
import { ItemKind, ITEM_CHANCE, MAX_BOMBS, MAX_FIRE, MAX_SPEED_ITEMS, START_FIRE, TICK_HZ, WorldConfig } from './sim';

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
}

/**
 * The arenas to choose from: the same build in three sizes. Classic is the one the game has always had.
 * Each brings its own round length and closing-in speed (an index into CLOSE_IN), put in whenever it is
 * picked in the lobby and changeable after: the owner's choices, scaled to the arena's size. Compact: 1:00
 * and Quick; Classic: 1:30 and Normal; Big: 2:00 and Normal. Bricks and power-ups are a share of the tiles,
 * so they already scale with the size and are left alone.
 */
export const ARENAS = [
  { id: 'compact', name: 'Compact', cols: 11, rows: 9, roundSecs: 60, closeIn: 3, blurb: 'Small and close: you meet the others fast.' },
  { id: 'classic', name: 'Classic', cols: 13, rows: 11, roundSecs: 90, closeIn: 2, blurb: 'The standard arena.' },
  { id: 'big', name: 'Big', cols: 15, rows: 13, roundSecs: 120, closeIn: 2, blurb: 'More room to run, more bricks to clear.' },
] as const;
export type ArenaId = (typeof ARENAS)[number]['id'];

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
export const SETUP_VERSION = 3;

export interface MatchSetup {
  /** SETUP_VERSION when it was saved */
  v: number;
  cpus: CpuSlot[];
  arena: ArenaId;
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
}

export function defaultSetup(myColor: string): MatchSetup {
  const others = ['black', 'pink', 'blue', 'red', 'orange', 'white', 'green', 'purple', 'gold'].filter((c) => c !== myColor);
  return {
    cpus: others.slice(0, 3).map((colorId) => ({ colorId, level: 'normal' as BotLevel })),
    arena: 'classic',
    timerOn: true,
    roundSecs: ARENAS[1].roundSecs,
    closeIn: ARENAS[1].closeIn,
    v: SETUP_VERSION,
    firstTo: 1,
    bricks: 2,
    startOn: false,
    startBombs: 1,
    startFire: START_FIRE,
    startSpeed: 0,
    itemsOn: false,
    items: { bomb: 2, fire: 2, speed: 2, kick: 2, grab: 2, shield: 2, curse: 2 },
  };
}

/** Pick an arena, and put in its round length and closing-in speed (they can be changed after). */
export function pickArena(s: MatchSetup, id: ArenaId): void {
  const a = ARENAS.find((x) => x.id === id) ?? ARENAS[1];
  s.arena = a.id;
  s.roundSecs = a.roundSecs;
  s.closeIn = a.closeIn;
}

/** The rules of a setup, put back to the usual ones. The players are left as they are. */
export function defaultRules(s: MatchSetup, myColor: string): MatchSetup {
  return { ...defaultSetup(myColor), cpus: s.cpus };
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
  return ITEM_CHANCE.map(([k, c]) => [k, c * ITEM_AMOUNTS[s.items[k]].times]);
}

/** The config sim.ts builds a round from: you first, then the other players on this screen, then the CPU players in their lobby order. */
export function worldConfig(s: MatchSetup, myColor: string, seed: number, guests: string[] = []): WorldConfig {
  const size = arenaSize(s, guests.length);
  return {
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
    `${arenaOf(s).name} arena`,
    s.timerOn ? `${clockText(s.roundSecs)} rounds` : 'No timer',
    `First to ${s.firstTo}`,
  ];
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

/** How sharp the game is drawn: the most of the screen's pixels it uses for each of the page's. */
export const SHARPNESS = [
  { name: 'Battery saver', cap: 1.5 },
  { name: 'Balanced', cap: 2 },
  { name: 'Sharpest', cap: 4 },
];

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
  return { soundOn: true, volume: 80, muted: [], sharpness: 2, ghosts: true, calm: false, padShow: 100, keys: defaultKeys(), padKeys: defaultPad(), rumble: true };
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
