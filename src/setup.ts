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
  const out = { ...defaultSetup(myColor), cpus: s.cpus, map: s.map, randEmotes: s.randEmotes, randLevels: s.randLevels };
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
  return { soundOn: true, volume: 80, muted: [], sharpness: DEFAULT_SHARPNESS, ghosts: true, calm: false, padShow: 100, keys: defaultKeys(), padKeys: defaultPad(), rumble: true };
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
