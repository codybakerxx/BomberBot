/**
 * The app shell: everything that ties the game to the page.
 *
 * - keeps the current match (a World from sim.ts) and steps it 60 times a second
 * - reads the player's input (input.ts) and plays sounds for what happened (audio.ts)
 * - sizes and places the arena, the touch controls and the panels for the screen
 * - runs the title screen, the lobby (with lobby.ts), Settings, the menu during a match, the result panel and
 *   the Match my thumb screen, and keeps the score of a match
 * - remembers your colour, the lobby's setup, your settings and the D-pad settings on this device (localStorage)
 *
 * It holds no game rules. Those are all in sim.ts.
 */
import { createWorld, step, ticksLeft, World, PlayerInput, Dir, TICK_HZ, DEATH_TICKS, type GameEvent } from './sim';
import { Bot, BotLevel, BOT_LEVELS, LEVELS, createBot, botInput } from './bot';
import { COLORS, NOBODY, botName, colorById, drawAngels, drawHead, drawStatic, drawDynamic, drawGhosts, warmSprites } from './render';
import { Input, PadReader, typing } from './input';
import { drawTitle, closeTitle, drawIcon } from './title';
import { initAudio, preview, setSound, sfx } from './audio';
import { createLobby, LobbyHost } from './lobby';
import { readDance, type DanceId } from './dances';
import { createPadNav } from './padnav';
import { PAD } from './bindings';
import { createRemap } from './remap';
import { Guest, MatchSetup, Prefs, SHARPNESS, SOUND_NAMES, arenaOf, clockText, defaultSetup, load, readPrefs, readSetup, save, summary, wholeTile, worldConfig } from './setup';
import { Opt, answerConfirm, choice, confirmFirst, confirmOpen, heading, mount, note, slider, toggle, wireConfirm, wireFlash } from './ui';
import { Hand, SENSITIVITY, DEFAULT_SENS, STRAIGHT, standardAims } from './swipe';
import { Online } from './online';
import { canInstall, howToAdd, install, isApple, myEndpoint, onWebsite, pushOff, pushOn, pushState, type PushState } from './app';
import { decodeWorld, packInput, readCode, unpackInput, type Score, type Seat, type ServerMsg } from './net';
/** Look up an element of src/page.html by its id. */
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('cv');
const ctx = canvas.getContext('2d')!;
const staticLayer = document.createElement('canvas');
/** The layer the ghosts of knocked-out robots float up on. It lines up with the arena and reaches from its bottom edge to the top of the screen. */
const ghosts = $<HTMLCanvasElement>('ghosts');
const gctx = ghosts.getContext('2d')!;
/** How far down the ghost layer the arena starts, in canvas pixels. */
let ghostTop = 0;
/** true if the ghost layer has something drawn on it */
let ghostsShown = false;
const result = $('result');
const touch = $('touch');
const title = $('title');
const titleArt = $<HTMLCanvasElement>('titleArt');
const tctx = titleArt.getContext('2d')!;

// The chosen bot colour, remembered on this device under the key "botColor".
let myColor = 'gold';
try {
  const saved = localStorage.getItem('botColor');
  if (saved && COLORS.some((c) => c.id === saved)) myColor = saved;
} catch {
  /* storage is optional */
}

/**
 * The match set up in the lobby (setup.ts): the CPU players, each with its own colour and level, the arena
 * and the rules. Remembered on this device under the key "matchSetup". Before the lobby there was one level
 * for all CPU players, saved as "cpuLevel": a setup saved before then starts with that level for all three.
 */
let setup: MatchSetup = load('matchSetup', (raw) => readSetup(raw, myColor, COLORS.map((c) => c.id)));
try {
  const stored = localStorage.getItem('cpuLevel');
  // there used to be a fourth level, Extreme. Hard is now what Extreme was, so a saved Extreme becomes Hard.
  const old = (stored === 'extreme' ? 'hard' : stored) as BotLevel | null;
  if (old && BOT_LEVELS.includes(old) && !localStorage.getItem('matchSetup')) {
    setup = defaultSetup(myColor);
    for (const c of setup.cpus) c.level = old;
  }
} catch {
  /* storage is optional */
}
/** Your victory dance (dances.ts), picked on the lobby's Players page. Remembered on this device under the key "myDance". */
let myDance: DanceId = 'party';
try {
  const saved = localStorage.getItem('myDance');
  myDance = readDance(saved) ?? 'party';
} catch {
  /* storage is optional */
}
/** The name you have typed in the lobby, or '' for none. Remembered on this device under the key "playerName". */
let myName = '';
try {
  myName = (localStorage.getItem('playerName') ?? '').slice(0, 12);
} catch {
  /* storage is optional */
}
/** Your own settings (setup.ts): sound, sharpness, ghosts, less movement, how strongly the touch controls show. Key "prefs". */
const prefs: Prefs = load('prefs', readPrefs);
/** The CPU players of the current arena (players 1 and up). */
let bots: Bot[] = [];
/** Whose blast caught you this round: a player id, CRUSHED for a falling block, or -1 if you are still in. */
let blastedBy = -1;
const CRUSHED = -2;
/** true once this round's "blocks are falling" warning has sounded */
let hurried = false;
/** the angel tip has been shown this match (it says how angels play, the first time someone here is one) */
let angelTipShown = false;
const playTip = $('playTip');
let tipTimer = 0;
/** A short line over the top of the arena for a few seconds, during a round. */
function showTip(text: string): void {
  playTip.textContent = text;
  playTip.hidden = false;
  playTip.classList.remove('go');
  void playTip.offsetWidth;
  playTip.classList.add('go');
  clearTimeout(tipTimer);
  tipTimer = window.setTimeout(() => (playTip.hidden = true), 4500);
}
/** Rounds won in this match by each of the four places on the scoreboard. Place 0 is you. */
const wins = Array<number>(9).fill(0);
/** Which round of the match this is: 1 for the first. */
let roundNo = 0;
/** The player who has won the match (reached `setup.firstTo` wins), or -1 while it goes on. */
let matchWinner = -1;
/**
 * Who wears the crown: the place with the most rounds won, or -1 before anyone has won one.
 * It changes hands only when another player takes the lead; drawing level does not take it.
 */
let leader = -1;
/** true once this round's result has been added to the scoreboard */
let counted = false;
/** when this round was decided, on the frame clock in seconds; -1 until it is */
let decidedAt = -1;
/** the frame clock: seconds, as passed to render() */
let clock = 0;

// Control settings, remembered on this device under the key "controls4".
// (Swipe length is not a setting: the quiet zone is always the standard size, `QUIET` in swipe.ts.)

/**
 * `hand` is the thumb that steers: the swipe pad sits on that side, A and B on the other.
 * `sens` is Movement sensitivity, an index into SENSITIVITY in swipe.ts (Low, Medium, High: how far the pad
 * reads swipes as leaning, 2°, 5° or 8°). It replaced the Standard / My thumb switch and Match my thumb
 * (the owner's call, November 2026; docs/SWIPE-HISTORY.md).
 */
const settings: { hand: Hand; sens: number } = { hand: 'left', sens: DEFAULT_SENS };

/** False if this browser refuses to store anything, in which case settings last only until the game is closed. */
let canSave = true;
try {
  localStorage.setItem('bb-probe', '1');
  localStorage.removeItem('bb-probe');
} catch {
  canSave = false;
}

try {
  const saved = JSON.parse(localStorage.getItem('controls4') ?? 'null');
  if (saved) {
    settings.hand = saved.hand === 'right' ? 'right' : 'left';
    if (Number.isInteger(saved.sens) && saved.sens >= 0 && saved.sens < SENSITIVITY.length) settings.sens = saved.sens;
  } else {
    // From before (controls3): the steering thumb, and a Match my thumb result in use becomes the nearest
    // sensitivity (its average lean, which is how the owner's own 2° became Low)
    const old = JSON.parse(localStorage.getItem('controls3') ?? 'null');
    if (old) {
      settings.hand = old.hand === 'right' ? 'right' : 'left';
      const t = old[settings.hand];
      const aims = t?.use !== false ? t?.match?.aims : null;
      if (Array.isArray(aims) && aims.length === 5) {
        let sum = 0;
        for (let d = 1; d <= 4; d++) sum += ((((STRAIGHT[d] - aims[d] + 180) % 360) + 360) % 360) - 180;
        const lean = Math.abs(sum / 4);
        let best = DEFAULT_SENS;
        SENSITIVITY.forEach((x, i) => {
          if (Math.abs(x.tilt - lean) < Math.abs(SENSITIVITY[best].tilt - lean)) best = i;
        });
        settings.sens = best;
      }
    }
  }
} catch {
  /* storage is optional */
}

let world: World;
let T = 32; // tile size in canvas pixels
/**
 * title: the title screen, shown when the game opens. lobby: setting up a match. settings: Settings, opened
 * from the lobby or from the menu. pause: the menu during a match (the round waits behind it). playing: a
 * round. over: the result panel is showing.
 */
let mode: 'title' | 'lobby' | 'settings' | 'pause' | 'playing' | 'over' = 'title';
let overShown = false;
/** True from the start of a round until its result: the round the menu pauses and can go back to. */
let roundLive = false;

const input = new Input();
/**
 * The other players on this screen, each with a controller of their own (couch play): players 1, 2... in a
 * round, after you and before the CPU players. They join in the lobby (lobby.ts) and are not saved.
 */
const guests: Guest[] = [];
// ---------------------------------------------------------------- online (online.ts, docs/ONLINE.md)
/** The online room this page is in, or null when playing on this screen. */
let net: Online | null = null;
/** Online: who is in each place of the round (a person or a CPU player), from the server. */
let seats: Seat[] = [];
/** Online: your place in the round. On this screen you are always player 0. */
let meIdx = 0;
/** Online: a round is being played out from the server's ticks (from its start until back in the lobby). */
let netRound = false;
/** Your own setup and robot on this screen, kept aside while in an online room (the host's are used there). */
let stash: { setup: MatchSetup; color: string } | null = null;
/** Your place in the round: player 0 on this screen, wherever the server put you online. */
const myIdx = (): number => (net ? meIdx : 0);
/** Other players on this screen with controllers (couch play), not online. */
const couch = (): boolean => !net && guests.length > 0;
/** How many of the round's players are people (the CPU players come after them). */
const peopleCount = (): number => (net ? seats.filter((x) => x.member !== null).length : 1 + guests.length);

/** Is player i one of the people here (you or a guest), not a CPU player? Online: any person in the room. */
const human = (i: number): boolean => (net ? !!seats[i] && seats[i].member !== null : i <= guests.length);
/** The victory dance player i picked in the lobby: yours, a guest's, or a CPU player's (Party if none). */
function danceOf(i: number): DanceId {
  if (net) return seats[i]?.dance ?? 'party';
  if (i === 0) return myDance;
  if (i <= guests.length) return guests[i - 1].dance;
  return setup.cpus[i - 1 - guests.length]?.dance ?? 'party';
}
/** The controller playing player i (you or a guest), if there is one. */
const padOf = (i: number): PadReader | null => (net ? (i === meIdx ? input.mine() : null) : i === 0 ? input.mine() : guests[i - 1] ? input.reader(guests[i - 1].pad) : null);
input.attachKeyboard(window);
input.attachDpad($('dzone'), $('dpad'));
input.attachButton($('btnA'), 'a');
input.attachButton($('btnB'), 'b');

/** The on-screen controls appear on touch devices only (body gets the class "touch"). */
function showTouch(): void {
  document.body.classList.add('touch');
  layout();
}
if (window.matchMedia?.('(pointer: coarse)').matches) document.body.classList.add('touch');
window.addEventListener('touchstart', showTouch, { passive: true, once: true });

/**
 * Start a fresh arena with a random seed, set up as the lobby says: you, then the CPU players in their lobby
 * order, each in the colour and at the level the lobby gave it. This is the one place a round's colours are
 * set. The lobby keeps them all different, and can only be reached between matches.
 */
function newWorld(): void {
  const seed = (Math.random() * 2 ** 31) | 0;
  world = createWorld(worldConfig(setup, myColor, seed, guests.map((g) => g.colorId)));
  bots = setup.cpus.map((c, i) => createBot(i + 1 + guests.length, c.level, seed));
  blastedBy = -1;
  hurried = false;
  counted = false;
  decidedAt = -1;
  scoreKey = '';
  timerKey = '';
  overShown = false;
  redrawStatic();
}

/**
 * Fit everything to the screen. The arena is drawn at whole device pixels per
 * tile so it stays sharp. Upright phone: top bar, arena, then the controls fill
 * the rest. Sideways or desktop: arena centred, controls down the two sides.
 */
/** On an upright phone, how many blocks of free space are kept between the top bar and the arena. Left blank for information to come. */
const INFO_ROWS = 1;
/** The biggest a head on the scoreboard is drawn, centre to edge, in screen pixels. */
const HEAD_R = 13;
/**
 * Where each place on the scoreboard goes: the left edge and width of its cell, and how far down the middle
 * of its head is, in screen pixels from the scoreboard's own top left. Four places, or one per player when
 * more than four are playing.
 */
/** Where each place on the scoreboard goes: its cell, the middle of its head, and the middle of its name under it. */
let scoreCells: { x: number; w: number; y: number; ny: number }[] = [];
/** the size of the names under the heads, in page pixels */
let scoreNameSize = 10;
/** The most a head on the scoreboard may be, centre to edge, so it fits the height it has. */
let scoreHeadMax = 13;

/**
 * How many of the screen's pixels make one of the page's: what every canvas is drawn at. A phone at 3 can
 * report more when its page is zoomed (an app's text-size setting can do that), and the canvases must
 * follow it or they are stretched and blurry while the page's text stays sharp. It was capped at 3, which
 * did exactly that; then at 4, and the owner's phone went blurry again, so a zoomed page can report more.
 * The cap of 6 is only there to keep the sprites' memory in bounds. Settings › Graphics says what the
 * screen reports and what the game draws at.
 */
const MAX_DENSITY = 6;
function density(): number {
  // Settings › Graphics › Sharpness can ask for less, to save battery (Sharpest is the usual)
  return Math.min(window.devicePixelRatio || 1, MAX_DENSITY, SHARPNESS[prefs.sharpness].cap);
}

/**
 * The screen the last layout() was made for: its size, and how many of the device's pixels make one of the
 * page's. If any of them changes, the canvases have to be made again (see keepSharp).
 */
let laidOut = { w: 0, h: 0, dpr: 0 };
function layout(): void {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const dpr = density();
  const sharper = laidOut.dpr !== 0 && laidOut.dpr !== dpr;
  laidOut = { w: W, h: H, dpr };
  if (sharper && mode === 'lobby') lobby.redraw();
  const portrait = H > W * 1.05;
  const isTouch = document.body.classList.contains('touch');
  document.body.classList.toggle('portrait', portrait);
  // upright phone: menu bar, then a free line one block high (kept for information to come),
  // then the arena, then controls fill everything below
  const stacked = portrait && isTouch;
  const topBar = stacked ? 46 : 0;
  const minControls = stacked ? Math.min(230, H * 0.3) : 0;
  const availH = H - topBar - minControls;
  // the free line is as tall as one block, so the height has to hold one row more than the arena has
  T = wholeTile(Math.max(8, Math.floor(Math.min((W * dpr) / world.w, (availH * dpr) / (world.h + (stacked ? INFO_ROWS : 0))))), world.w, world.h, dpr);
  canvas.width = T * world.w;
  canvas.height = T * world.h;
  const cw = canvas.width / dpr;
  const ch = canvas.height / dpr;
  canvas.style.width = `${cw}px`;
  canvas.style.height = `${ch}px`;
  // The arena's corner goes on a whole screen pixel, not just a whole page pixel. When a screen has a
  // fractional density (a zoomed page: 3.5, 2.625...), a whole page pixel can fall between two screen
  // pixels, and then every pixel of the arena is shared out between two of the screen's: the whole map goes
  // soft. Which arenas hit this depended on their size, so it came and went.
  // On a screen of a whole density (an iPhone's 3) it goes on a whole page pixel too: Safari places things
  // in 64ths of a page pixel, and a third of one is not a 64th, so an arena a third of a pixel off was
  // smoothed over (the blur that came back in November 2026; see wholeTile).
  const onPixel = (v: number): number => (Number.isInteger(dpr) ? Math.round(v) : Math.round(v * dpr) / dpr);
  const left = onPixel((W - cw) / 2);
  canvas.style.left = `${left}px`;
  const infoRow = stacked ? Math.round((T / dpr) * INFO_ROWS) : 0;
  const top = onPixel(stacked ? topBar + infoRow : (H - ch) / 2);
  canvas.style.top = `${top}px`;
  // the ghost layer: over the arena and everything above it, on the same pixels as the arena
  ghostTop = Math.round(top * dpr);
  ghosts.width = canvas.width;
  ghosts.height = canvas.height + ghostTop;
  ghosts.style.left = canvas.style.left;
  ghosts.style.width = canvas.style.width;
  ghosts.style.height = `${ghosts.height / dpr}px`;
  ghostsShown = false;
  // the tip: upright, in the free line over the arena (one line); otherwise over the top of the arena
  playTip.style.top = stacked ? `${topBar + Math.max(0, Math.round((infoRow - 26) / 2))}px` : `${parseInt(canvas.style.top, 10) + 8}px`;
  playTip.style.left = `${Math.round(W / 2)}px`;
  touch.style.setProperty('--ctl-top', `${Math.round(topBar + infoRow + ch + 8)}px`);
  // the styles use this to keep B the size it was before the line was added (see page.html)
  touch.style.setProperty('--info-row', `${infoRow}px`);
  touch.style.setProperty('--side', `${Math.round(Math.max(150, (W - cw) / 2))}px`);
  // the Match my thumb panel sits exactly over the arena, leaving the pad free
  // the timer: centred across the top when upright; otherwise centred over the column beside the arena
  timer.style.left = portrait ? '50%' : `${Math.round(Math.max(150, (W - cw) / 2) / 2)}px`;
  // The scoreboard: four heads, each with its wins to its right. Upright it is in the top bar, two
  // places on each side of the timer; the same room is left clear at the far left as the menu button
  // takes at the far right, so the two pairs match. Otherwise it is a row under the timer, over the
  // column beside the arena.
  const side = Math.max(150, (W - cw) / 2);
  const places = Math.max(4, world.players.length);
  const perRow = 5; // sideways, with more than four players: rows of up to five
  const rows = places > 4 ? Math.ceil(places / perRow) : 1;
  // Each head has its player's name under it (the owner's ask). Upright with four, the names sit in the free
  // line under the top bar; upright with more, heads and names share that line; sideways each row is taller.
  const ROW = 58;
  const box =
    stacked && places > 4
      ? // more than four players, upright: the scoreboard takes the free line under the top bar, one place each across the screen
        { left: 0, top: topBar, width: W, height: Math.max(16, infoRow) }
      : stacked
        ? { left: 0, top: 0, width: W, height: topBar + infoRow }
        : { left: 6, top: 40, width: Math.min(side - 12, places > 4 ? 300 : 260), height: ROW * rows };
  scoreHeadMax = HEAD_R;
  scoreNameSize = 10;
  if (stacked && places > 4) {
    const cell = (W - 12) / places;
    const h = box.height;
    scoreNameSize = Math.max(8, Math.min(10, Math.round(h * 0.3)));
    scoreHeadMax = Math.max(5, Math.min(HEAD_R, (h - scoreNameSize - 4) / 2));
    scoreCells = Array.from({ length: places }, (_, i) => ({ x: 6 + i * cell, w: cell, y: 1 + scoreHeadMax, ny: h - scoreNameSize / 2 - 1 }));
  } else if (stacked) {
    const half = (timer.offsetWidth || 80) / 2 + 5;
    const btn = $('menuBtn').getBoundingClientRect();
    const edge = (btn.width ? Math.min(W - btn.left, 60) : 48) + 4;
    const cell = Math.max(24, (W / 2 - half - edge) / 2);
    scoreNameSize = 11;
    scoreCells = [edge, edge + cell, W / 2 + half, W / 2 + half + cell].map((x) => ({ x, w: cell, y: topBar / 2 + 3, ny: topBar + Math.min(9, infoRow / 2) }));
  } else {
    box.left = Math.round((side - box.width) / 2);
    const across = places > 4 ? perRow : 4;
    const cell = box.width / across;
    scoreCells = Array.from({ length: places }, (_, i) => ({ x: (i % across) * cell, w: cell, y: ROW * Math.floor(i / across) + 22, ny: ROW * Math.floor(i / across) + 22 + HEAD_R + 11 }));
  }
  // sideways with more than four players the scoreboard has two rows: the swipe pad starts under them
  touch.style.setProperty('--pad-top', `${stacked ? 88 : Math.max(88, box.top + box.height + 6)}px`);
  score.style.left = `${box.left}px`;
  score.style.top = `${box.top}px`;
  score.style.width = `${box.width}px`;
  score.style.height = `${box.height}px`;
  score.width = Math.round(box.width * dpr);
  score.height = Math.round(box.height * dpr);
  scoreKey = '';
  // The result panel never covers the arena, so the end of a round can be watched. Upright it lies over
  // the controls; otherwise it is in the same column as the scoreboard, under it.
  const cardWidth = stacked ? W - 16 : Math.min(side - 12, 320);
  resultCard.style.width = `${cardWidth}px`;
  resultCard.style.left = `${stacked ? 8 : Math.round((side - cardWidth) / 2)}px`;
  resultCard.style.top = `${stacked ? Math.round(topBar + infoRow + ch + 14) : box.top + box.height + 8}px`;
  redrawStatic();
}

/**
 * The world that is drawn. On this screen it is the world itself. Online it is the picture the page runs on
 * from the server's world to now (predict.ts): your robot where your presses have put it, the rest on time.
 */
function shownWorld(): World {
  return (net && netRound && net.view()) || world;
}
/** Blocks that have landed in a world: when the drawn world has another, the floor picture is redrawn. */
const landedIn = (w: World): number => w.shrinkNext - w.falling.length;
let staticLanded = -1;

/** The floor and solid blocks change only when a block lands, so they are drawn once and reused. */
function redrawStatic(): void {
  if (!world) return;
  const w = shownWorld();
  staticLanded = landedIn(w);
  staticLayer.width = canvas.width;
  staticLayer.height = canvas.height;
  drawStatic(staticLayer.getContext('2d')!, w, T);
}

const score = $<HTMLCanvasElement>('score');
const sctx = score.getContext('2d')!;
const resultCard = $('resultCard');
let scoreKey = '';
/**
 * The scoreboard: one place for each of four players, a head in the player's
 * colour with the rounds it has won to its right. The player in the lead wears
 * a crown. A player knocked out of this round is dimmed, with crosses for eyes.
 * A place with no player in it (fewer than four are playing) is a grey head
 * with no number. The winner of the round just decided has its number in its
 * own colour. Where the four places go is worked out in layout().
 * Only redrawn when something it shows has changed.
 */
/** The name under a head on the scoreboard: the one a person typed, or the robot's. */
function scoreName(i: number): string {
  const p = world.players[i];
  if (!p) return '';
  if (i === myIdx() && myName) return myName;
  if (net && human(i) && seats[i]?.name) return seats[i].name;
  return botName(colorById(p.colorId));
}
/** `text`, cut short with … if it is wider than `max` in the context's font. */
function fitText(c: CanvasRenderingContext2D, text: string, max: number): string {
  if (c.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && c.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

function drawScore(): void {
  const places = Array.from({ length: Math.max(4, world.players.length) }, (_, i) => world.players[i]);
  const winner = world.over ? world.over.winner : -1;
  const key = places.map((p, i) => (p ? `${p.colorId}${p.alive ? '' : 'x'}${p.zombie ? 'z' : ''}${wins[i]}l${p.lives}${scoreName(i)}` : '-')).join('|') + `|${winner}|${leader}|${score.width}x${score.height}`;
  if (key === scoreKey) return;
  scoreKey = key;
  const k = score.width / (parseFloat(score.style.width) || score.width); // screen pixels to canvas pixels
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.clearRect(0, 0, score.width, score.height);
  sctx.setTransform(k, 0, 0, k, 0, 0);
  sctx.textAlign = 'left';
  sctx.textBaseline = 'middle';
  const gap = 4;
  const said: string[] = [];
  places.forEach((p, i) => {
    const cell = scoreCells[i];
    if (!cell) return;
    const col = p ? colorById(p.colorId) : NOBODY;
    const label = p ? String(wins[i]) : '';
    // the head is as big as its cell allows once the number has its room (an empty place keeps room for one digit, so the heads line up)
    let size = Math.round(scoreHeadMax * 1.35);
    sctx.font = `700 ${size}px "Chakra Petch", system-ui, sans-serif`;
    let numW = sctx.measureText(label || '0').width;
    const r = Math.max(5, Math.min(scoreHeadMax, (cell.w - gap - numW - 8) / 2)); // 8: breathing room between one place and the next
    if (r < scoreHeadMax) {
      size = Math.max(10, Math.round(r * 1.35));
      sctx.font = `700 ${size}px "Chakra Petch", system-ui, sans-serif`;
      numW = sctx.measureText(label || '0').width;
    }
    const cx = cell.x + (cell.w - (2 * r + gap + numW)) / 2 + r;
    const cy = cell.y;
    const numX = cx + r + gap; // where the number of wins starts
    const dim = !p ? 0.45 : p.alive && !p.zombie ? 1 : 0.45; // (a zombie is out of the round)
    // the helmet has a rim in the player's colour, which is what shows it against the dark screen
    // (the first robot's helmet was all black, and needed a disc behind it and a ring round it here)
    sctx.globalAlpha = dim;
    drawHead(sctx, cx, cy, r, col, { xEyes: !!p && !p.alive });
    sctx.globalAlpha = 1;
    if (!p) return;
    // the crown goes on last, and is not dimmed
    if (i === leader) drawHead(sctx, cx, cy, r, col, { crownOnly: true });
    sctx.fillStyle = i === winner ? col.glow : p.alive ? '#eef1fb' : '#8a90a3';
    sctx.fillText(label, numX, cy + 1);
    // with more than one life a round, a little dot for each life left, under the number (the name is under the head)
    if (setup.lives > 1 && p.lives > 0) {
      const dr = Math.max(1.2, r * 0.12);
      const step = dr * 2.8;
      sctx.fillStyle = col.glow;
      for (let n = 0; n < p.lives; n++) {
        sctx.beginPath();
        sctx.arc(numX + dr + n * step, cy + size * 0.42 + dr + 1, dr, 0, Math.PI * 2); // (just under the number)
        sctx.fill();
      }
    }
    // the player's name under the head, as wide as the cell allows (a typed name is drawn as text, never markup);
    // yours in your colour
    const name = scoreName(i);
    sctx.font = `600 ${scoreNameSize}px "Chakra Petch", system-ui, sans-serif`;
    sctx.textAlign = 'center';
    sctx.fillStyle = i === myIdx() ? col.glow : p.alive && !p.zombie ? '#c9cfdf' : '#6f7588';
    const shown = fitText(sctx, name, cell.w - 4);
    const half = sctx.measureText(shown).width / 2;
    // centred under the head, kept inside its own place
    sctx.fillText(shown, Math.max(cell.x + 2 + half, Math.min(cx, cell.x + cell.w - 2 - half)), cell.ny);
    sctx.textAlign = 'left';
    said.push(`${nameOf(i)} ${wins[i]}${i === leader ? ' (in the lead)' : ''}`);
  });
  score.setAttribute('aria-label', `Rounds won: ${said.join(', ')}`);
}

const timer = $('timer');
/** the timer turns amber with this many seconds left, as a warning that the blocks are coming */
const TIMER_WARN = 30;
let timerKey = '';
/**
 * The countdown at the top. It turns amber for the last half minute, red and
 * blinking for the last ten seconds, and stays red at 0:00, when the blocks
 * start to fall. Only touched when what it shows changes.
 */
function drawTimer(): void {
  if (world.over && timerKey) return; // the round is decided: the timer stops where it was
  const left = ticksLeft(shownWorld());
  if (left === Infinity) {
    timer.hidden = true;
    return;
  }
  const secs = Math.ceil(left / TICK_HZ);
  // at 0:00 the blocks start to fall, and the round goes on until someone wins
  const state = left <= 0 ? 'done' : secs <= 10 ? 'last' : secs <= TIMER_WARN ? 'hurry' : '';
  const key = `${secs}/${state}`;
  if (key === timerKey) return;
  timerKey = key;
  timer.hidden = false;
  timer.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  timer.className = state;
}

/**
 * A small shake of the arena when a bomb goes off (the owner's ask): a few page pixels, dying away over a fifth
 * of a second. Whole pixels only, so the arena stays sharp. None with Settings › Graphics › Less movement.
 */
const SHAKE_PX = 3;
const SHAKE_S = 0.2;
let shakeAt = -1;
let shaken = false;
function shake(time: number): void {
  const t = time - shakeAt;
  const on = shakeAt >= 0 && t >= 0 && t < SHAKE_S && !prefs.calm && (mode === 'playing' || mode === 'over');
  if (!on) {
    if (shaken) canvas.style.transform = ghosts.style.transform = '';
    shaken = false;
    return;
  }
  const k = SHAKE_PX * (1 - t / SHAKE_S);
  const x = Math.round(Math.sin(t * 95) * k);
  const y = Math.round(Math.cos(t * 71) * k * 0.7);
  canvas.style.transform = ghosts.style.transform = x || y ? `translate(${x}px, ${y}px)` : '';
  shaken = true;
}

/** Draw one frame. */
function render(time: number): void {
  shake(time);
  // (online the drawn world runs a little ahead of the server's: a block that has landed in it is drawn in now)
  const w = shownWorld();
  if (landedIn(w) !== staticLanded) redrawStatic();
  ctx.drawImage(staticLayer, 0, 0);
  clock = time;
  const winner = world.over ? world.over.winner : -1;
  drawDynamic(ctx, w, T, time, myIdx(), winner >= 0 && decidedAt >= 0 ? { player: winner, t: time - decidedAt, dance: danceOf(winner) } : undefined, leader);
  // a few of the robots' pictures made ahead of need, so play does not stutter (the winner's dance included)
  warmSprites(ctx, w, T, 4, world.over && world.over.winner >= 0 ? danceOf(world.over.winner) : 'party');
  // the ghosts, on their own layer, which is only cleared when it has something on it
  gctx.setTransform(1, 0, 0, 1, 0, 0);
  if (ghostsShown) gctx.clearRect(0, 0, ghosts.width, ghosts.height);
  gctx.setTransform(1, 0, 0, 1, 0, ghostTop);
  ghostsShown = prefs.ghosts ? drawGhosts(gctx, w, T, -ghostTop) : false; // they can be switched off in Settings › Graphics
  // angels on the wall are part of the game, so they are drawn whatever that setting says
  if (drawAngels(gctx, w, T, time)) ghostsShown = true;
  drawTimer();
  drawScore();
}

/**
 * Show the result panel. Its buttons are Next round and Menu while the match goes on; once someone has won
 * the match, Rematch (the same setup, the score back to 0) and Lobby.
 */
function finish(title: string, text: string): void {
  // online the round goes on behind the menu and Settings: one open now stays open, and the panel is there
  // when it closes (closePause goes to `watch`)
  const menuUp = mode === 'pause' || mode === 'settings';
  if (!menuUp) mode = 'over';
  overShown = true;
  roundLive = false;
  $('resultTitle').textContent = title;
  $('resultText').textContent = text;
  $('resultText').hidden = !text;
  const done = matchWinner >= 0;
  $('again').textContent = done ? 'Rematch' : 'Next round';
  $('change').textContent = done ? 'Lobby' : 'Menu';
  $('again').hidden = false;
  if (net) {
    // online the round is played out, and only the host moves everyone on
    const decided = !!world.over;
    $('again').hidden = !net.isHost || !decided;
    $('change').textContent = done && net.isHost ? 'Lobby' : 'Menu';
    if (decided && !net.isHost) {
      $('resultText').textContent = `${text ? text + ' ' : ''}${hostName()} starts the ${done ? 'rematch' : 'next round'}.`;
      $('resultText').hidden = false;
    }
  }
  if (menuUp) {
    if (mode === 'pause') fillPause();
    return;
  }
  if (result.hidden) {
    result.hidden = false;
    ($('again').hidden ? $('change') : $('again')).focus({ preventScroll: true });
  }
}

/** "3–1–0" in scoreboard order, for the end of a match. */
function scoreLine(): string {
  return world.players.map((_, i) => wins[i]).join('–');
}
/**
 * A player's name as the results say it: You, or a CPU player's robot name (Volt, Fizz...). With other
 * players here, "You" would not say who, so the people here are named with their P-number: "Auric (P1)".
 */
function nameOf(i: number): string {
  if (net) {
    // online: you are You; the others by the name they typed, or their robot's
    if (i === meIdx) return 'You';
    return seats[i]?.name || botName(colorById(world.players[i].colorId));
  }
  if (i === 0 && !guests.length) return 'You';
  const name = i === 0 ? myName || botName(colorById(world.players[0].colorId)) : botName(colorById(world.players[i].colorId));
  return human(i) ? `${name} (P${i + 1})` : name;
}

/** The sound of something the rules report. */
function soundOf(e: GameEvent): void {
  if (e.type === 'place') sfx.place();
  else if (e.type === 'explode') {
    sfx.explode();
    shakeAt = clock; // the screen shakes a little (render)
  }
  else if (e.type === 'pickup') e.kind === 'curse' ? sfx.curse() : sfx.pickup();
  else if (e.type === 'shield') sfx.shield();
  else if (e.type === 'kick' || e.type === 'throw') sfx.kick();
  else if (e.type === 'lift' || e.type === 'land') sfx.lift();
  else if (e.type === 'block') sfx.block();
  else if (e.type === 'respawn' || e.type === 'revive') sfx.shield(); // back in the round
  else if (e.type === 'rise') sfx.curse(); // a zombie gets up
  else if (e.type === 'death') sfx.death();
}

/** One step of the game rules on this screen: read the input, then advance (below). */
function tick(): void {
  // player 0 is you; then the other players here; then the CPU players, which are asked for the same thing
  // your controls give. Once the round is decided nobody is asked for anything: the winner celebrates.
  const inputs: (PlayerInput | undefined)[] = [];
  if (!world.over) {
    inputs[0] = input.state();
    guests.forEach((g, i) => (inputs[i + 1] = input.reader(g.pad)?.state()));
    for (const b of bots) inputs[b.id] = botInput(world, b);
  }
  advance(inputs);
}

/**
 * Advance the world one tick with these inputs, play its sounds, and check for the end. On this screen the
 * inputs come from tick(); online, from the server (every player's, yours included: online.ts).
 */
function advance(inputs: (PlayerInput | undefined)[]): void {
  step(world, inputs);
  const mi = myIdx();
  const me = world.players[mi];
  for (const e of world.events) {
    // (online, a sound the picture already made ahead of the server is not made twice; nor are the sounds
    // of ticks caught up on while the page was out of sight)
    if (!(net && (net.heard(world.tick, e) || document.hidden))) soundOf(e);
    if (e.type === 'explode') {
      // a light shake for a blast within two tiles of a robot played on a controller
      if (prefs.rumble)
        for (let i = 0; i < world.players.length; i++) {
          const p = world.players[i];
          if (human(i) && p.alive && Math.abs(e.cx - Math.round(p.x)) + Math.abs(e.cy - Math.round(p.y)) <= 2) padOf(i)?.rumble(0.2, 0.5, 120);
        }
    } else if (e.type === 'block') {
      // the arena has one more solid block: the picture of the floor and blocks needs redrawing
      redrawStatic();
    } else if (e.type === 'death') {
      if (e.player === mi && e.out) blastedBy = e.cause === 'block' ? CRUSHED : e.by;
      if (prefs.rumble && human(e.player)) padOf(e.player)?.rumble(1, 0.7, 380); // a strong shake: you are out
    }
  }
  // out of lives and an angel now (or the first time someone here is): say how angels play, once a match
  // (online, only for your own robot)
  const firstZombie = world.players.findIndex((p, i) => (net ? i === mi : human(i)) && p.zombie && p.alive);
  if (firstZombie >= 0 && !angelTipShown) {
    angelTipShown = true;
    showTip(couch() ? `${nameOf(firstZombie)}: a zombie! Small bombs only` : 'You are a zombie! Drop small bombs in their way');
  }
  const firstAngel = world.players.findIndex((p, i) => (net ? i === mi : human(i)) && p.angel && world.tick >= p.angelFrom);
  if (firstAngel >= 0 && !angelTipShown) {
    angelTipShown = true;
    showTip(couch() ? `${nameOf(firstAngel)}: an angel! Slide the wall, hold A to throw` : 'You are an angel! Slide the wall, hold A to throw');
  }
  // the moment the first block starts to fall
  if (world.shrinkNext === 1 && world.falling.length === 1 && !hurried) {
    hurried = true;
    sfx.hurry();
  }

  if (world.over && !counted) {
    // The round is decided: one more win on the scoreboard (none for a draw), and the result.
    counted = true;
    decidedAt = clock;
    const winner = world.over.winner;
    if (winner >= 0) {
      wins[winner]++;
      // the crown goes to whoever is in front; a player who only draws level does not take it
      if (leader < 0 || wins[winner] > wins[leader]) leader = winner;
      sfx.win();
      if (wins[winner] >= setup.firstTo) matchWinner = winner;
    }
    announce();
  } else if (!world.over && !overShown && couch() && world.players.every((p, i) => !human(i) || (!p.alive && p.lives === 0 && !p.angel && !p.zombie && p.deadTicks >= DEATH_TICKS))) {
    // everyone here is out and CPU players are still at it, as below
    finish('Everyone here is out', 'The CPU players are still fighting. Next round gives this round to one of them at random.');
  } else if (!world.over && !overShown && !couch() && !me.alive && me.lives === 0 && !me.angel && !me.zombie && me.deadTicks >= DEATH_TICKS) {
    // You are out and the others are still at it. The round carries on behind this panel, and its
    // winner still gets the win. On this screen Next round does not wait for it; online it is played out.
    finish(
      blastedBy === CRUSHED ? 'You got crushed' : 'You got blasted',
      `${howOut()} The others are still fighting. ${net ? 'The last robot standing wins the round.' : 'Next round gives this round to one of them at random.'}`,
    );
  }
}

/** How you were knocked out, for the result panel. */
function howOut(): string {
  const me = world.players[myIdx()];
  const who = world.players[blastedBy];
  return blastedBy === CRUSHED ? 'A falling block landed on you.' : !who || who === me ? 'Caught in your own blast.' : `Caught in ${nameOf(blastedBy) === 'You' ? botName(colorById(who.colorId)) : nameOf(blastedBy)}'s blast.`;
}

/** The result panel for a decided round (the score already counted). */
function announce(): void {
  const mi = myIdx();
  const me = world.players[mi];
  const winner = world.over ? world.over.winner : -1;
  const how = howOut();
  if (couch()) {
    // several people here: say who, by name and P-number
    if (matchWinner >= 0) finish(`${nameOf(matchWinner)} wins the match`, `First to ${setup.firstTo}. Final score ${scoreLine()}.`);
    else if (winner >= 0) finish(`${nameOf(winner)} wins the round`, `${wins[winner]} of ${setup.firstTo} to win the match.`);
    else finish('Draw', 'Nobody was left standing.');
  } else if (matchWinner === mi) finish('You win the match', `First to ${setup.firstTo}. Final score ${scoreLine()}.`);
  else if (matchWinner >= 0) finish(`${nameOf(matchWinner)} wins the match`, `First to ${setup.firstTo}. Final score ${scoreLine()}.${me.alive ? '' : ' ' + how}`);
  else if (winner === mi) finish('You win the round', `Last bot standing. ${wins[mi]} of ${setup.firstTo} to win the match.`);
  else if (winner >= 0) finish(`${nameOf(winner)} wins the round`, me.alive ? '' : how);
  else finish('Draw', me.alive ? 'Nobody was left standing.' : `${how} Nobody was left standing.`);
}

let last = performance.now();
let acc = 0;
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  keepSharp();
  input.pad.poll(now); // notice a thumb that has stopped, in every mode
  input.others = new Set(guests.map((g) => g.pad));
  input.pollGamepad(); // the controllers: their sticks and buttons, for the round and the menus
  padNav.step(now, mode !== 'playing');
  guestPads();
  if (net && netRound) {
    // online: the server's world moves on as its ticks come in (onRound's hooks), whatever screen is showing:
    // nobody can pause it. Here, what you press goes to the server (nothing while a menu is open) and the
    // picture that is drawn moves on to now, your robot with it (predict.ts).
    net.frame(now, mode === 'playing' ? packInput(input.state()) : 0);
  } else if (mode === 'playing' || mode === 'over') {
    acc += dt;
    const stepLen = 1 / TICK_HZ;
    let n = 0;
    while (acc >= stepLen && n < 6) {
      tick();
      acc -= stepLen;
      n++;
    }
    if (n === 6) acc = 0;
  }
  // the title screen, the lobby and Settings cover everything, so the arena behind them is not drawn
  if (mode === 'title') renderTitle(now / 1000);
  else if (mode !== 'lobby' && mode !== 'settings') render(now / 1000);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- title screen

/** When the title screen was opened, on the frame clock in seconds; -1 until its first frame. */
let titleFrom = -1;
/**
 * Draw the title screen's picture (title.ts): your robot in your colour, waving now and then, with two
 * rivals and a lit bomb, standing in the space the page leaves between the name and the buttons. The canvas
 * is the size of the screen at its full pixel density; it is made again whenever that changes.
 */
function renderTitle(time: number): void {
  if (titleFrom < 0) titleFrom = time;
  const dpr = density();
  const w = Math.round(window.innerWidth * dpr);
  const h = Math.round(window.innerHeight * dpr);
  if (titleArt.width !== w || titleArt.height !== h) {
    titleArt.width = w;
    titleArt.height = h;
  }
  const r = $('titleStage').getBoundingClientRect();
  // with less movement asked for (Settings › Graphics), the picture holds still
  drawTitle(tctx, { x: r.left * dpr, y: r.top * dpr, w: r.width * dpr, h: r.height * dpr }, colorById(myColor), prefs.calm ? 0 : time - titleFrom);
}
/** Open the title screen. It is where the game starts, and where the lobby's back button goes. */
function showTitle(): void {
  hideScreens();
  mode = 'title';
  titleFrom = -1;
  document.body.classList.remove('menu-open');
  document.body.classList.add('title-open');
  title.hidden = false;
  $('titleLocal').focus({ preventScroll: true });
}
/**
 * Leave the title screen for the lobby. The title's large pictures are let go.
 * The title offers the two modes: Local, which leads here, and Online, which is switched off until online
 * play is built (step 2 of the plan in docs/ROADMAP.md).
 */
function leaveTitle(): void {
  initAudio(); // a tap: the moment the browser allows sound to start
  title.hidden = true;
  document.body.classList.remove('title-open');
  closeTitle();
  showLobby(true);
}
$('titleLocal').addEventListener('click', leaveTitle);

// ---------------------------------------------------------------- the screen's sharpness

/**
 * Keep the game sharp. Every canvas is made for the screen's size and pixel density when layout() runs. A
 * phone can change its pixel density without telling the page it was resized: the Claude app, for one, can
 * open a game page at the wrong density and correct it a moment later. A page laid out in that moment is
 * blurry until it is laid out again, which on a phone may be never. So every frame checks, and lays the
 * page out again if the screen is not the one it was made for. (Most of the time this is three comparisons.)
 */
function keepSharp(): void {
  const dpr = density();
  if (dpr !== laidOut.dpr || window.innerWidth !== laidOut.w || window.innerHeight !== laidOut.h) layout();
}

/** Push the control settings into the swipe pad, the screen layout, the menu and the pad's caption, and optionally save them. */
function applySettings(save: boolean): void {
  const right = settings.hand === 'right';
  input.pad.aims = standardAims(settings.hand, SENSITIVITY[settings.sens].tilt);

  // which side the pad is on (page.html lays the controls out mirrored under body.righty)
  document.body.classList.toggle('righty', right);
  $('handLeft').setAttribute('aria-pressed', String(!right));
  $('handRight').setAttribute('aria-pressed', String(right));
  $('saveNote').hidden = canSave;
  refreshSens();

  // the caption on the swipe pad itself, visible while playing
  $('padTag').textContent = `${SENSITIVITY[settings.sens].name} sensitivity`;

  if (!save) return;
  try {
    localStorage.setItem('controls4', JSON.stringify({ hand: settings.hand, sens: settings.sens }));
  } catch {
    /* storage is optional */
  }
}

/** Movement sensitivity: Low, Medium or High (SENSITIVITY in swipe.ts). */
const sensOpts: Opt[] = [
  slider({
    label: 'Movement sensitivity',
    hint: () =>
      `How far a swipe can curve and still go the way you meant. ${
        ['Low suits thumbs that swipe dead straight.', 'Medium suits most thumbs.', 'High suits thumbs whose quick swipes curve a lot.'][settings.sens]
      } (The swipes are read leaning ${SENSITIVITY[settings.sens].tilt}° ${settings.hand === 'right' ? 'anticlockwise' : 'clockwise'}.)`,
    min: 0,
    max: SENSITIVITY.length - 1,
    get: () => settings.sens,
    set: (v) => {
      settings.sens = v;
      applySettings(true);
    },
    text: (v) => SENSITIVITY[v].name,
    onThumb: true,
  }),
];
let refreshSens = (): void => {};

// Which thumb steers. The sensitivity leans the other way for a right thumb (mirrored).
$('handLeft').addEventListener('click', () => {
  settings.hand = 'left';
  applySettings(true);
});
$('handRight').addEventListener('click', () => {
  settings.hand = 'right';
  applySettings(true);
});

// ---------------------------------------------------------------- screens, rounds and the match

/** Hide every screen and panel over the game: the lobby, Settings, the menu, the result panel. */
function hideScreens(): void {
  lobby.hide();
  $('settings').hidden = true;
  $('pause').hidden = true;
  result.hidden = true;
  $('onlineSheet').hidden = true;
  document.body.classList.remove('menu-open');
}

// ------------------------------------------------ the lobby (lobby.ts)

const lobbyHost: LobbyHost = {
  online() {
    if (!net) return null;
    const mine = net.members.find((m) => m.id === net!.me);
    return {
      code: net.code,
      host: net.isHost,
      hostName: hostName(),
      myP: net.members.findIndex((m) => m.id === net!.me) + 1,
      waiting: net.playing && !mine?.playing,
    };
  },
  get setup() {
    return setup;
  },
  set setup(v: MatchSetup) {
    setup = v;
  },
  get myColor() {
    return myColor;
  },
  get myName() {
    return myName;
  },
  set myName(v: string) {
    myName = v;
    if (net) net.meChanged(myColor, lobby.isReady(), myDance, myName);
    try {
      localStorage.setItem('playerName', v);
    } catch {
      /* storage is optional */
    }
  },
  set myColor(v: string) {
    myColor = v;
  },
  get myDance() {
    return myDance;
  },
  set myDance(v: DanceId) {
    myDance = v;
  },
  save(): void {
    if (net) {
      // online: your robot, Ready and dance go to the room; the setup too if you host. Your own setup on
      // this screen is kept as it was.
      net.meChanged(myColor, lobby.isReady(), myDance, myName);
      if (net.isHost) net.send({ t: 'setup', setup });
      try {
        localStorage.setItem('myDance', myDance);
      } catch {
        /* storage is optional */
      }
      return;
    }
    save('matchSetup', setup);
    try {
      localStorage.setItem('botColor', myColor);
      localStorage.setItem('myDance', myDance);
    } catch {
      /* storage is optional */
    }
  },
  guests,
  controllers: () => (navigator.getGamepads?.() ?? []).filter((g) => g && g.connected).length,
  density,
  start: () => (net ? net.send({ t: 'start' }) : newMatch()),
  back: () => {
    if (!net) return showTitle();
    confirmFirst('Leave the room?', 'You leave this online room. To come back, join again with its code.', 'Leave', (yes) => {
      if (yes) leaveOnline();
    });
  },
  settings: (tab) => showSettings(tab, 'lobby'),
};
const lobby = createLobby(lobbyHost);

/**
 * Open the lobby. It is only reached between matches: leaving a match for it ends the match. `fresh` when
 * arriving from the title or a match (Ready has to be pressed again); not when coming back from Settings.
 */
function showLobby(fresh = false): void {
  hideScreens();
  mode = 'lobby';
  roundLive = false;
  document.body.classList.add('menu-open');
  lobby.show(undefined, fresh);
}

// ------------------------------------------------ rounds and the match

/** Start a match with the lobby's setup: everyone's score back to 0, then round 1. */
function newMatch(): void {
  wins.fill(0);
  leader = -1;
  roundNo = 0;
  matchWinner = -1;
  angelTipShown = false;
  start();
}
/** Start the next round of the match in a fresh arena. */
function start(): void {
  initAudio();
  newWorld();
  layout(); // the arena may be a different size from the last one
  input.reset();
  acc = 0;
  roundLive = true;
  roundNo++;
  mode = 'playing';
  hideScreens();
}
/** Carry on with the round that was waiting behind the menu. */
function resume(): void {
  initAudio();
  input.reset();
  acc = 0;
  mode = 'playing';
  hideScreens();
}
/** Back to a round that has ended for you: the result panel again, and the rest of the round (or the winner's dance) behind it. */
function watch(): void {
  initAudio();
  input.reset();
  acc = 0;
  hideScreens();
  mode = 'over';
  result.hidden = false;
}

// ------------------------------------------------ the menu during a match

/**
 * The menu during a match (the three bars at the top, or Escape). The round waits behind it. It says
 * what is going on: local or online, paused or over, which round, the rules, the time left, and every
 * player's state and score. Then Resume and Settings, and the host's choices: Restart (the whole match
 * again, from 0: the owner's call, in place of restarting only the round) or leave to the lobby. Both ask first.
 */
function openPause(): void {
  if (mode !== 'playing' && mode !== 'over') return;
  showPause();
}
function showPause(): void {
  hideScreens();
  mode = 'pause';
  document.body.classList.add('menu-open');
  fillPause();
  $('pause').hidden = false;
  $('pauseResume').focus({ preventScroll: true });
}
/** Resume: back into the round, or back to its result if it is over for you. */
function closePause(): void {
  if (roundLive) resume();
  else watch();
}
function fillPause(): void {
  const done = matchWinner >= 0;
  $('pauseState').textContent = roundLive ? (net ? 'Playing' : 'Paused') : done ? 'Match over' : world.over ? 'Round over' : 'You are out';
  // online: the room's code, the round goes on behind the menu, and only the host restarts or ends the match
  modeChip($('pauseMode'), net?.code ?? null);
  const hosting = !net || net.isHost;
  $('pauseHostLine').textContent = hosting ? 'Match · you are the host' : `Match · ${hostName()} is the host`;
  $('pauseRestart').hidden = !hosting;
  $('pauseLobby').hidden = !hosting;
  $('pauseLobby').textContent = net ? 'End match' : 'Leave to the lobby';
  $('pauseLeave').hidden = !net;
  $('pauseTitle').textContent = done ? `${nameOf(matchWinner)} won the match` : `Round ${roundNo}`;
  const left = ticksLeft(world);
  const time = world.over || left === Infinity ? '' : left > 0 ? ` · ${clockText(Math.ceil(left / TICK_HZ))} left` : ' · Blocks falling';
  // (online: the round trip to the server, so a slow connection can be told from a fault)
  $('pauseInfo').textContent = `${summary(setup, guests.length)}${time}${net && net.rtt ? ` · ping ${net.rtt} ms` : ''}`;
  $('pauseResume').textContent = roundLive && !net ? 'Resume' : 'Back to the round';
  const list = $('standings');
  list.textContent = '';
  const dpr = density();
  world.players.forEach((p, i) => {
    const li = document.createElement('li');
    const cv = document.createElement('canvas');
    cv.width = cv.height = Math.round(34 * dpr);
    const col = colorById(p.colorId);
    drawHead(cv.getContext('2d')!, cv.width / 2, cv.height / 2, cv.width * 0.42, col, { xEyes: !p.alive, crown: false });
    if (i === leader) drawHead(cv.getContext('2d')!, cv.width / 2, cv.height / 2, cv.width * 0.42, col, { crownOnly: true });
    const who = document.createElement('div');
    const name = document.createElement('b');
    // (names typed by people: set as text, never as markup)
    name.textContent = i === myIdx() ? myName || 'You' : net && human(i) ? seats[i]?.name || botName(col) : botName(col);
    const sub = document.createElement('small');
    const cpuLevel = (): string => `P${i + 1} · CPU · ${LEVELS[setup.cpus[i - peopleCount()]?.level ?? 'normal'].label}`;
    sub.textContent = net
      ? human(i)
        ? `P${i + 1}${i === meIdx ? ' · you' : ''}${seats[i]?.member === net.host ? ' · host' : ''}${net.members.find((m) => m.id === seats[i]?.member)?.on === false ? ' · away' : ''}`
        : cpuLevel()
      : i === 0
        ? `P1 · you`
        : human(i)
          ? `P${i + 1} · controller ${guests[i - 1].pad + 1}`
          : cpuLevel();
    who.append(name, sub);
    const st = document.createElement('span');
    const won = world.over && world.over.winner === i;
    st.className = `st${p.alive && !p.zombie ? ' in' : ''}`;
    // (with more than one life: how many are left; out of lives with angels on: an angel)
    st.textContent = won ? 'Won' : !p.zombie && (p.alive || p.respawnAt >= 0) ? (setup.lives > 1 ? `${p.lives} ${p.lives === 1 ? 'life' : 'lives'}` : 'In') : p.angel ? 'Angel' : p.zombie ? 'Zombie' : 'Out';
    const w = document.createElement('span');
    w.className = 'wins';
    w.textContent = String(wins[i]);
    w.setAttribute('aria-label', `${wins[i]} rounds won`);
    li.append(cv, who, st, w);
    list.append(li);
  });
}
$('menuBtn').addEventListener('click', openPause);
$('pauseResume').addEventListener('click', closePause);
$('pauseSettings').addEventListener('click', () => showSettings(undefined, 'pause'));
$('pauseRestart').addEventListener('click', () =>
  confirmFirst(
    'Restart the match?',
    `Everyone’s score goes back to 0 and round 1 starts in a new arena, with the same players and rules${net ? ', for everyone in the room' : ''}.`,
    'Restart',
    (yes) => {
      if (!yes) return;
      if (net) net.send({ t: 'restart' });
      else newMatch();
    },
  ),
);
$('pauseLobby').addEventListener('click', () =>
  net
    ? confirmFirst('Everyone back to the lobby?', 'This match ends for everyone in the room, and its score is not kept. In the lobby you can change the players and the rules.', 'End match', (yes) => {
        if (yes) net?.send({ t: 'lobby' });
      })
    : confirmFirst('Leave to the lobby?', 'This match ends and its score is not kept. In the lobby you can change the players and the rules.', 'Leave match', (yes) => {
        if (yes) showLobby(true);
      }),
);
$('pauseLeave').addEventListener('click', () =>
  confirmFirst('Leave the room?', 'You leave this online match. Your robot stands still until the round ends. To come back, join again with the code.', 'Leave', (yes) => {
    if (yes) leaveOnline();
  }),
);
/**
 * Next round while you are out and the CPU players are still fighting: the round is not left without a
 * winner. One of the CPU players still in gets it, at random, and a point on the scoreboard (the owner's
 * call: solo against CPU players only; online, the round will be played out). Returns false if that point
 * has won it the match, so the result of the match is shown instead of a new round.
 */
function settleUnfinished(): boolean {
  if (counted || world.over) return true;
  const still = world.players.filter((p) => p.id > 0 && p.alive && !p.zombie);
  if (!still.length) return true; // everyone is out: a draw, no point
  const w = still[Math.floor(Math.random() * still.length)].id;
  counted = true;
  wins[w]++;
  if (leader < 0 || wins[w] > wins[leader]) leader = w;
  if (wins[w] < setup.firstTo) return true;
  matchWinner = w;
  scoreKey = '';
  finish(
    `${nameOf(w)} wins the match`,
    `First to ${setup.firstTo}. Final score ${scoreLine()}. ${guests.length ? 'Everyone here was' : 'You were'} out, so the last round went to ${nameOf(w)}, picked at random from the CPU players still in.`,
  );
  return false;
}
// the result panel: Next round and Menu while the match goes on; Rematch and Lobby once it is won
$('again').addEventListener('click', () => {
  if (net) net.send({ t: 'next' }); // (the host's: the next round, or a rematch)
  else if (matchWinner >= 0) newMatch();
  else if (settleUnfinished()) start();
});
$('change').addEventListener('click', () => {
  if (net) {
    if (matchWinner >= 0 && net.isHost) net.send({ t: 'lobby' });
    else openPause();
  } else if (matchWinner >= 0) showLobby(true);
  else openPause();
});


// ------------------------------------------------ online play (online.ts, net.ts; docs/ONLINE.md)

/**
 * Where the online server is. The page normally comes from it (its web address); opened as a file, or from
 * a local test server without one, it uses the game's own address on Cloudflare.
 */
const SERVER = 'bomberbot.bomberbot.workers.dev';
const serverHost = (): string => (location.protocol === 'http:' || location.protocol === 'https:' ? location.host : SERVER);
/** The link that opens the game straight into a room. */
const roomLink = (code: string): string => `${location.protocol === 'http:' ? 'http:' : 'https:'}//${serverHost()}/?room=${code}`;

/** The host's name as shown: You, the name they typed, or their robot's. */
function hostName(): string {
  if (!net) return 'You';
  if (net.isHost) return 'You';
  const h = net.members.find((m) => m.id === net!.host);
  return h ? h.name || botName(colorById(h.colorId)) : 'The host';
}

const netNote = $('netNote');
let netNoteTimer = 0;
/** A line at the top about the connection: "Reconnecting…" until it is back, or a short note for a while. */
function sayNet(text: string, ms = 0): void {
  clearTimeout(netNoteTimer);
  netNote.textContent = text;
  netNote.hidden = !text;
  if (text && ms) netNoteTimer = window.setTimeout(() => (netNote.hidden = true), ms);
}

/** The panel over the title: make a room, or join one with a code. */
function openOnlineSheet(code = '', note = ''): void {
  $('onlineSheet').hidden = false;
  ($('onlineCode') as HTMLInputElement).value = code;
  $('onlineNote').textContent = note;
  setOnlineBusy(false);
  ($(code ? 'onlineJoin' : 'onlineMake') as HTMLButtonElement).focus({ preventScroll: true });
}
function closeOnlineSheet(): void {
  if (net) {
    net.leave();
    net = null;
  }
  $('onlineSheet').hidden = true;
  $('titleOnline').focus({ preventScroll: true });
}
function setOnlineBusy(busy: boolean): void {
  for (const id of ['onlineMake', 'onlineJoin', 'onlineCode']) ($(id) as HTMLButtonElement).disabled = busy;
}
$('titleOnline').addEventListener('click', () => {
  initAudio();
  openOnlineSheet();
});
$('onlineMake').addEventListener('click', () => joinOnline(null));
$('onlineJoin').addEventListener('click', () => {
  const code = readCode(($('onlineCode') as HTMLInputElement).value);
  if (!code) {
    $('onlineNote').textContent = 'A room code is four letters, like BKTW.';
    return;
  }
  joinOnline(code);
});
$('onlineCode').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('onlineJoin').click();
});
$('onlineCode').addEventListener('input', () => {
  const box = $('onlineCode') as HTMLInputElement;
  box.value = box.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
});
$('onlineCancel').addEventListener('click', closeOnlineSheet);

/** Make a room (code null) or join one: connect, and go to its lobby once the room answers. */
function joinOnline(code: string | null): void {
  if (net) net.leave();
  setOnlineBusy(true);
  $('onlineNote').textContent = code ? `Joining ${code}…` : 'Making a room…';
  net = new Online(
    {
      room: onRoom,
      round: (cfg, s, score) => onRound(createWorld(cfg), s, score, true),
      snap: (w, s, score) => onRound(decodeWorld(w), s, score, false),
      world: () => (netRound ? world : null),
      step: (codes) => advance(codes.map(unpackInput)),
      early: (e) => {
        if (!document.hidden) soundOf(e);
      },
      status: (st) => {
        if (st === 'lost') sayNet('Connection lost. Reconnecting…');
        else if (st === 'open') sayNet('');
      },
      error: (why, fatal) => {
        if (!fatal) {
          sayNet(why, 4000);
          return;
        }
        // the room is gone for this page: back to the title, saying why
        sayNet('');
        const wasIn = !!stash;
        leaveOnline(false);
        if (!wasIn || mode === 'title') openOnlineSheet(code ?? '', why);
        else sayNet(why, 6000);
      },
    },
    serverHost(),
  );
  net.start(code, { name: myName, colorId: myColor, dance: myDance });
}

/** Leave the online room (saying goodbye unless the server has already closed it), back to the title. */
function leaveOnline(bye = true): void {
  if (net && bye) net.leave();
  net = null;
  $('roomTell').hidden = $('roomShare').hidden = true;
  modeChip($('lobbyMode'), null);
  try {
    sessionStorage.removeItem('onlineRoom');
  } catch {
    /* optional */
  }
  netRound = false;
  seats = [];
  meIdx = 0;
  guests.length = 0;
  if (stash) {
    // your own setup and robot on this screen, as they were
    setup = stash.setup;
    myColor = stash.color;
    stash = null;
  }
  sayNet('');
  newWorld();
  showTitle();
}

/** The room changed (online.ts): who is in it, the host, the setup, and whether a match is on. */
function onRoom(m: Extract<ServerMsg, { t: 'room' }>): void {
  if (!net) return;
  const mine = m.members.find((x) => x.id === m.you);
  if (!mine) return;
  if (!stash) stash = { setup, color: myColor };
  const moved = mine.colorId !== myColor;
  setup = JSON.parse(JSON.stringify(m.setup));
  myColor = mine.colorId;
  // everyone else in the room shows in the lobby as another player (lobby.ts reads them as guests)
  guests.length = 0;
  m.members.forEach((x, k) => {
    if (x.id === m.you) return;
    guests.push({
      pad: -100 - x.id,
      colorId: x.colorId,
      pick: x.colorId,
      ready: x.ready,
      dance: x.dance,
      remote: { name: x.name, p: k + 1, on: x.on, host: x.id === m.host },
    });
  });
  modeChip($('lobbyMode'), m.code);
  $('lobbyHostNote').textContent = net.isHost ? 'You are the host' : `${hostName()} is the host`;
  $('roomShare').hidden = false;
  $('roomTell').hidden = !net.isHost || m.playing;
  const inMatch = m.playing && mine.playing;
  if (mode === 'title') {
    // just joined: on to the room's lobby. A reload of this page comes straight back here (sessionStorage).
    try {
      sessionStorage.setItem('onlineRoom', m.code);
    } catch {
      /* optional */
    }
    $('onlineSheet').hidden = true;
    title.hidden = true;
    document.body.classList.remove('title-open');
    closeTitle();
    if (!inMatch) {
      showLobby(true);
      lobby.setReady(mine.ready, true);
    }
    return;
  }
  if (netRound && !m.playing) {
    // the host ended the match: everyone back to the lobby, to press Ready again
    netRound = false;
    showLobby(true);
    lobby.setReady(mine.ready, true);
    return;
  }
  if (mode === 'lobby') lobby.setReady(mine.ready, moved);
  else if (mode === 'pause') fillPause();
}

/**
 * A round from the server: a new one (`fresh`, built from its config) or the world as it is now (after a
 * dropped connection, or when this page fell out of step). The score comes with it.
 */
function onRound(w: World, s: Seat[], score: Score, fresh: boolean): void {
  if (!net) return;
  const inRound = netRound && (mode === 'playing' || mode === 'over' || mode === 'pause' || (mode === 'settings' && setFrom === 'pause'));
  world = w;
  bots = [];
  seats = s;
  meIdx = Math.max(0, s.findIndex((x) => x.member === net!.me));
  wins.fill(0);
  score.wins.forEach((v, i) => (wins[i] = v));
  leader = score.leader;
  matchWinner = score.matchWinner;
  roundNo = score.roundNo;
  scoreKey = '';
  timerKey = '';
  netRound = true;
  if (!fresh && inRound) {
    // the same round, put right: carry on where it is
    counted = !!w.over;
    redrawStatic();
    return;
  }
  if (fresh && roundNo <= 1) angelTipShown = false; // a new match
  blastedBy = -1;
  hurried = false;
  overShown = false;
  counted = !!w.over;
  decidedAt = w.over ? clock : -1;
  redrawStatic();
  initAudio();
  layout();
  input.reset();
  roundLive = !w.over;
  mode = 'playing';
  hideScreens();
  if (w.over) announce();
}

const COPY_GLYPH =
  '<svg class="copy-glyph" viewBox="0 0 24 24" aria-hidden="true"><rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 5.5v-.5a2 2 0 0 0-2-2H6a2.5 2.5 0 0 0-2.5 2.5v7.5a2 2 0 0 0 2 2h.5"/></svg>' +
  '<svg class="done-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
/**
 * The chip at the top saying Local match, or Online with the room's code: a button that copies the code
 * (the owner's ask). A tap turns it green with a tick for a moment (if copying fails, a note shows the code).
 */
function modeChip(chip: HTMLElement, code: string | null): void {
  if (chip.dataset.code === (code ?? '')) return;
  chip.dataset.code = code ?? '';
  chip.classList.toggle('online', !!code);
  if (!code) {
    chip.textContent = 'Local match';
    return;
  }
  chip.textContent = 'Online';
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'code-copy';
  b.setAttribute('aria-label', `Room code ${code.split('').join(' ')}. Copy it`);
  const word = document.createElement('span');
  word.className = 'code-word';
  word.textContent = code;
  b.append(word);
  b.insertAdjacentHTML('beforeend', COPY_GLYPH);
  let timer = 0;
  b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const ok = await copyText(code);
    clearTimeout(timer);
    b.classList.toggle('copied', ok);
    // (the note would cover the chip, so only when it could not be copied)
    if (!ok) sayNet(`Room code: ${code}`, 4000);
    timer = window.setTimeout(() => b.classList.remove('copied'), 1600);
  });
  chip.append(b);
}
/** Put text on the clipboard: the modern way, or the old one for browsers without it. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const box = document.createElement('textarea');
    box.value = text;
    box.setAttribute('readonly', '');
    box.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.append(box);
    box.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    box.remove();
    return ok;
  }
}

// Tell friends: a notification to everyone who turned them on (Settings › App), that this room is open
$('roomTell').addEventListener('click', async () => {
  if (!net || !net.isHost) return;
  sayNet('Telling friends…', 4000);
  net.send({ t: 'invite', me: await myEndpoint() });
});

// share the room: the phone's share sheet, or the link copied
$('roomShare').addEventListener('click', async () => {
  if (!net) return;
  const url = roomLink(net.code);
  try {
    if (navigator.share) await navigator.share({ title: 'BomberBot', text: `Join my BomberBot room: ${net.code}`, url });
    else {
      await navigator.clipboard.writeText(url);
      sayNet('Link copied', 2500);
    }
  } catch {
    /* the share sheet was closed */
  }
});

// ------------------------------------------------ Settings

type SetTab = 'sound' | 'controls' | 'gamepad' | 'graphics' | 'app';
const SET_TABS: SetTab[] = ['controls', 'gamepad', 'sound', 'graphics', 'app']; // the owner's order (Gamepad its own page, after Controls); App last
const SET_NAMES: Record<SetTab, string> = { sound: 'Sound', controls: 'Controls', gamepad: 'Gamepad', graphics: 'Graphics', app: 'App' };
const SET_IDS: Record<SetTab, [string, string]> = {
  sound: ['pgSound', 'setSound'],
  controls: ['pgControls', 'setControls'],
  gamepad: ['pgGamepad', 'setGamepad'],
  graphics: ['pgGraphics', 'setGraphics'],
  app: ['pgApp', 'setApp'],
};
let setTab: SetTab = 'controls';
/** where Settings goes back to: the lobby, or the menu during a match */
let setFrom: 'lobby' | 'pause' = 'lobby';

/** Open Settings on one of its pages (or the last one seen). `from` is where Done and Back go. */
function showSettings(tab?: SetTab, from?: 'lobby' | 'pause'): void {
  if (from) setFrom = from;
  if (tab) setTab = tab;
  hideScreens();
  mode = 'settings';
  document.body.classList.add('menu-open');
  $('settings').hidden = false;
  showSetTab(setTab);
  $('setDone').focus({ preventScroll: true });
}
function showSetTab(t: SetTab): void {
  setTab = t;
  if (t !== 'controls' && t !== 'gamepad') remap?.cancel();
  if (t === 'gamepad') remap?.refresh(); // says which controllers are connected now
  if (t === 'app') showApp();
  const i = SET_TABS.indexOf(t);
  for (const k of SET_TABS) {
    $(SET_IDS[k][0]).setAttribute('aria-selected', String(k === t));
    $(SET_IDS[k][1]).hidden = k !== t;
  }
  const prev = SET_TABS[i - 1];
  const next = SET_TABS[i + 1];
  $('setPrev').hidden = !prev;
  $('setNext').hidden = !next;
  $('setPrev').querySelector('span')!.textContent = prev ? SET_NAMES[prev] : '';
  $('setNext').querySelector('span')!.textContent = next ? SET_NAMES[next] : '';
  $('setPrev').setAttribute('aria-label', prev ? `Previous page: ${SET_NAMES[prev]}` : '');
  $('setNext').setAttribute('aria-label', next ? `Next page: ${SET_NAMES[next]}` : '');
  const sc = document.querySelector('#settings .scroll');
  if (sc) sc.scrollTop = 0;
  refreshPrefs();
}
function stepSettings(d: number): void {
  const i = SET_TABS.indexOf(setTab) + d;
  if (i >= 0 && i < SET_TABS.length) showSetTab(SET_TABS[i]);
}
function closeSettings(): void {
  remap.cancel();
  if (setFrom === 'pause') showPause();
  else showLobby();
}
for (const t of SET_TABS) $(SET_IDS[t][0]).addEventListener('click', () => showSetTab(t));
$('setPrev').addEventListener('click', () => stepSettings(-1));
$('setNext').addEventListener('click', () => stepSettings(1));
$('setDone').addEventListener('click', closeSettings);
$('setBack').addEventListener('click', closeSettings);

/** Your settings changed: save them, put them into effect, and redraw the pages that show them. */
function prefsChanged(): void {
  save('prefs', prefs);
  applyPrefs();
  refreshPrefs();
}
/** Put your settings into effect. (Sharpness is picked up by keepSharp on the next frame.) */
function applyPrefs(): void {
  setSound(prefs.soundOn, prefs.volume, prefs.muted);
  input.setBindings(prefs.keys, prefs.padKeys);
  document.body.classList.toggle('calm', prefs.calm);
  document.documentElement.style.setProperty('--pad-show', String(prefs.padShow / 100));
}

/** A sound's row: a switch for whether it plays, and a button that plays it. */
function soundRow(id: string, name: string): Opt {
  const o = toggle({
    label: name,
    get: () => !prefs.muted.includes(id),
    set: (on) => {
      prefs.muted = on ? prefs.muted.filter((m) => m !== id) : [...prefs.muted, id];
      prefsChanged();
    },
  });
  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'step opt-play';
  play.setAttribute('aria-label', `Play the ${name.toLowerCase()} sound`);
  play.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5l11 6.5-11 6.5z"/></svg>';
  play.addEventListener('click', () => {
    initAudio();
    preview(id);
  });
  const row = o.el.querySelector('.opt-toggle')!;
  row.insertBefore(play, row.querySelector('.switch-btn'));
  return o;
}

const soundOpts: Opt[] = [
  toggle({
    label: 'Sound effects',
    hint: 'Every sound in the game',
    get: () => prefs.soundOn,
    set: (v) => {
      prefs.soundOn = v;
      prefsChanged();
    },
    offText: 'All sounds are off. Switch them on to set the volume.',
    under: [
      slider({
        label: 'Volume',
        min: 0,
        max: 100,
        step: 10,
        get: () => prefs.volume,
        set: (v) => {
          prefs.volume = v;
          prefsChanged();
          initAudio();
          preview('pickup'); // so the new volume can be heard
        },
        text: (v) => `${v}%`,
      }),
    ],
  }),
  heading('Which sounds play', 'Tap ▶ to hear one'),
  ...SOUND_NAMES.map(([id, name]) => soundRow(id, name)),
  note('There is no music yet. It will come with the new sound effects, with a switch of its own.'),
];
const padOpts: Opt[] = [
  slider({
    label: 'Touch controls',
    hint: 'How strongly the swipe pad and the A and B buttons show over the game',
    min: 40,
    max: 200,
    step: 20,
    get: () => prefs.padShow,
    set: (v) => {
      prefs.padShow = v;
      prefsChanged();
    },
    text: (v) => (v === 100 ? 'Usual' : v < 100 ? `Fainter (${v}%)` : `Stronger (${v}%)`),
    onThumb: true,
  }),
];
const gfxOpts: Opt[] = [
  slider({
    label: 'Sharpness',
    onThumb: true,
    hint: () => {
      // what the screen reports and what the game draws at, so a blurry screen can be told apart
      const screen = Math.round((window.devicePixelRatio || 1) * 100) / 100;
      const drawn = Math.round(density() * 100) / 100;
      const now = ` This screen: ${screen}×, drawn at ${drawn}×.`;
      return prefs.sharpness === SHARPNESS.length - 1
        ? `Uses every pixel of the screen. The usual setting.${now}`
        : `Draws the game with fewer pixels, which uses less battery on big, sharp screens. It looks a little softer.${now}`;
    },
    min: 0,
    max: SHARPNESS.length - 1,
    get: () => prefs.sharpness,
    set: (v) => {
      prefs.sharpness = v;
      prefsChanged();
    },
    text: (v) => SHARPNESS[v].name,
  }),
  toggle({
    label: 'Ghosts',
    hint: 'A knocked-out robot’s ghost floats up the screen',
    get: () => prefs.ghosts,
    set: (v) => {
      prefs.ghosts = v;
      prefsChanged();
    },
  }),
  toggle({
    label: 'Less movement',
    hint: 'Stops the waving on the title screen and the pulsing and sliding in the menus',
    get: () => prefs.calm,
    set: (v) => {
      prefs.calm = v;
      prefsChanged();
    },
  }),
  note('More graphic styles are planned.'),
];
const refreshSound = mount($('soundOpts'), soundOpts);
const refreshPad = mount($('padOpts'), padOpts);
refreshSens = mount($('sensOpts'), sensOpts);
const refreshGfx = mount($('gfxOpts'), gfxOpts);

// Settings › App: putting the game on the home screen, and notifications (app.ts)
const SHARE_GLYPH = '<svg class="glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M7.5 7.5 12 3l4.5 4.5M5 11v9h14v-9"/></svg>';
/** a step's picture, beside its words */
const ICO: Record<string, string> = {
  safari: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  share: '<path d="M12 15V3M7.5 7.5 12 3l4.5 4.5M5 11v9h14v-9"/>',
  add: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/>',
  toggle: '<rect x="3" y="7" width="18" height="10" rx="5"/><circle cx="16" cy="12" r="2.6"/>',
  play: '<path d="M8 5.5l11 6.5-11 6.5z"/>',
  menu: '<path d="M12 5h.01M12 12h.01M12 19h.01" stroke-width="3.2"/>',
  install: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
  screen: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
};
type Step = [keyof typeof ICO, string];
const APP_TITLE: Record<ReturnType<typeof howToAdd>, string> = {
  app: 'You’ve got the BomberBot app!',
  file: 'How to add the BomberBot app!',
  apple: 'How to add the BomberBot app!',
  android: 'How to add the BomberBot app!',
  computer: 'How to add the BomberBot app!',
};
const APP_LEAD: Record<ReturnType<typeof howToAdd>, string> = {
  app: 'It opens full screen from your home screen, and Local play works with no connection at all. Online needs one.',
  file: 'This copy was opened as a file. Open the game’s website first, then follow the steps there.',
  apple: 'Put it on your Home Screen in a few taps and it plays like a real app.',
  android: 'Put it on your home screen in a few taps and it plays like a real app.',
  computer: 'Install it on your computer and it gets a window of its own.',
};
const APP_STEPS: Record<ReturnType<typeof howToAdd>, Step[]> = {
  app: [],
  file: [['globe', 'Go to <b>bomberbot.bomberbot.workers.dev</b> in your browser.']],
  apple: [
    ['safari', 'Open this page in <b>Safari</b>.'],
    ['share', `Tap <b>Share</b> ${SHARE_GLYPH}. On newer iPhones, tap <b>⋯</b> at the bottom first.`],
    ['add', 'Scroll down and tap <b>Add to Home Screen</b>.'],
    ['toggle', 'If you see <b>Open as Web App</b>, leave it on. Then tap <b>Add</b>.'],
    ['play', 'Open <b>BomberBot</b> from your Home Screen and play!'],
  ],
  android: [
    ['menu', 'In Chrome, tap <b>⋮</b> at the top right.'],
    ['install', 'Tap <b>Install app</b> (or <b>Add to Home screen</b>).'],
    ['play', 'Open <b>BomberBot</b> from your home screen and play!'],
  ],
  computer: [
    ['install', 'In Chrome or Edge: the install button at the right of the address bar, or <b>⋮</b> › <b>Install</b>.'],
    ['screen', 'In Safari on a Mac: <b>File</b> › <b>Add to Dock</b>.'],
  ],
};
let pushNow: PushState = 'cannot';
let pushBusy = false;
const notifyOpts: Opt[] = [
  toggle({
    label: 'Get room invites',
    hint: () =>
      pushNow === 'cannot'
        ? isApple() && onWebsite()
          ? 'On iPhone, add the app first (the steps above), then open it from your Home Screen and switch this on. Needs iOS 16.4 or newer.'
          : 'This browser cannot show notifications.'
        : pushNow === 'blocked'
          ? 'Blocked for BomberBot: turn them on in the phone’s Settings › Notifications.'
          : pushNow === 'on'
            ? 'On: you will hear about friends’ rooms.'
            : 'Off: switch on to hear about friends’ rooms.',
    get: () => pushNow === 'on',
    locked: () => pushNow === 'cannot' || pushNow === 'blocked' || pushBusy,
    set: (on) => void setPush(on),
  }),
];
const refreshNotify = mount($('notifyOpts'), notifyOpts);
async function setPush(on: boolean): Promise<void> {
  pushBusy = true;
  pushNow = on ? 'on' : 'off'; // the switch moves at once
  refreshNotify();
  $('notifyNote').textContent = on ? 'Turning on…' : '';
  const why = on ? await pushOn() : (await pushOff(), '');
  pushBusy = false;
  pushNow = await pushState();
  $('notifyNote').textContent = why || (pushNow === 'on' ? 'All set! Next time a friend rings the bell, you will know.' : '');
  refreshNotify();
}
function showApp(): void {
  const where = howToAdd();
  $('appTitle').textContent = APP_TITLE[where];
  $('appLead').innerHTML = APP_LEAD[where];
  const icon = $('appIcon') as HTMLImageElement;
  if (!icon.src) icon.src = drawIcon(168).toDataURL('image/png');
  $('appSteps').innerHTML = APP_STEPS[where]
    .map(([ico, t]) => `<li><span class="step-ico"><svg viewBox="0 0 24 24" aria-hidden="true">${ICO[ico]}</svg></span><span>${t}</span></li>`)
    .join('');
  $('appSteps').hidden = !APP_STEPS[where].length;
  const offer = (): void => {
    $('appInstall').hidden = !canInstall() || where === 'app';
  };
  canInstall(offer);
  offer();
  void pushState().then((st) => {
    if (!pushBusy) pushNow = st;
    refreshNotify();
  });
}
$('appInstall').addEventListener('click', () => void install());

function refreshPrefs(): void {
  remap?.refresh();
  refreshSound();
  refreshPad();
  refreshGfx();
}

// ------------------------------------------------ keys

// Escape goes back one step: closes a question or a panel, leaves Settings, resumes from the menu, opens the
// menu during a round, and goes from the lobby back to the title. Q and E turn the pages of the lobby and Settings.
/** Back one step, the same from Escape or a controller's B: a question or a panel first, then the screen. */
function goBack(): void {
  if (confirmOpen()) answerConfirm(false);
  else if (mode === 'title' && !$('onlineSheet').hidden) closeOnlineSheet();
  else if (mode === 'lobby' && lobby.sheetOpen()) lobby.closeSheet();
  else if (mode === 'lobby') lobbyHost.back();
  else if (mode === 'settings') closeSettings();
  else if (mode === 'pause') closePause();
  else if (mode === 'playing' || mode === 'over') openPause();
}
/** The key or button given to Pause (P, or ≡ on a controller): opens the menu in a round, closes it again. */
function pauseKey(): void {
  if (confirmOpen()) return;
  if (mode === 'playing' || mode === 'over') openPause();
  else if (mode === 'pause') closePause();
}
input.onPause = pauseKey;

/**
 * A controller nobody has yet, on its first press (input.ts asks). In the lobby, A or ≡ on it joins as a new
 * player (couch play): the person on the keyboard or touch screen is P1, and a controller picked up next to
 * them is a friend's. Anything else makes it yours, if you have none yet.
 */
input.claim = (index, button) => {
  // (online everyone plays on their own screen: no joining with a second controller)
  if (mode === 'lobby' && !net && (button === PAD.A || button === PAD.MENU) && !confirmOpen() && !lobby.sheetOpen()) return lobby.join(index) ? 'join' : 'ignore';
  return input.mineIndex < 0 ? 'mine' : 'ignore';
};

/** Which way each guest's stick or D-pad pointed last frame, so a push picks one robot, not one a frame. */
const guestDir = new Map<number, Dir>();
/**
 * The other players' controllers, once a frame. In the lobby: left and right pick a robot, A or Y is Ready,
 * B takes Ready away or leaves; a controller unplugged there leaves too. In a round, their own robot reads
 * them (tick), and their Pause button opens and closes the menu like yours.
 */
function guestPads(): void {
  for (const g of [...guests]) {
    if (g.remote) continue; // someone online, on their own screen
    const r = input.reader(g.pad);
    if (!r) {
      if (mode === 'lobby') lobby.dropGuest(g.pad);
      continue;
    }
    const was = guestDir.get(g.pad) ?? 0;
    const d = r.heldDir;
    guestDir.set(g.pad, d);
    if (input.capture || confirmOpen()) continue;
    if (mode === 'lobby') {
      if (d !== was && (d === 3 || d === 4)) lobby.guestStep(g.pad, d === 3 ? -1 : 1);
      if (d !== was && (d === 1 || d === 2)) lobby.guestDance(g.pad, d === 1 ? -1 : 1); // up and down: the dance
      if (r.pressed(PAD.A) || r.pressed(PAD.Y)) lobby.guestReady(g.pad);
      if (r.pressed(PAD.B)) lobby.guestBack(g.pad);
    } else if ((mode === 'playing' || mode === 'over' || mode === 'pause') && input.pausePressed(r)) pauseKey();
  }
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    goBack();
    return;
  }
  if ((e.code === 'KeyQ' || e.code === 'KeyE') && !confirmOpen() && !e.repeat && !typing(e)) {
    const d = e.code === 'KeyQ' ? -1 : 1;
    if (mode === 'lobby' && !lobby.sheetOpen()) lobby.turn(d);
    else if (mode === 'settings') stepSettings(d);
  }
});
input.onFirstGesture = initAudio;

// ------------------------------------------------ a controller in the menus, and button hints

/** What the controller's highlight moves round: whatever is on top. */
function padTop(): HTMLElement | null {
  if (confirmOpen()) return $('confirm');
  if (mode === 'title' && !$('onlineSheet').hidden) return $('onlineSheet');
  if (mode === 'lobby' && lobby.sheetOpen()) return $('cpuSheet');
  const screens: Partial<Record<typeof mode, string>> = { title: 'title', lobby: 'lobby', settings: 'settings', pause: 'pause', over: 'result' };
  const id = screens[mode];
  return id ? $(id) : null;
}
const padNav = createPadNav(input, {
  top: padTop,
  back: goBack,
  turn: (d) => {
    if (confirmOpen()) return;
    if (mode === 'lobby' && !lobby.sheetOpen()) lobby.turn(d);
    else if (mode === 'settings') stepSettings(d);
  },
  ready: () => {
    if (mode === 'lobby' && !lobby.sheetOpen() && !confirmOpen()) $('colOk').click();
  },
  menu: () => {
    if (confirmOpen()) return;
    if (mode === 'title') leaveTitle();
    else if (mode === 'lobby' && !lobby.sheetOpen()) $('arenaStart').click();
    else if (mode === 'settings') closeSettings();
    else pauseKey();
  },
});
// The hints on the menus' buttons follow the kind of control used last: controller buttons, keys, or none for touch.
input.onDevice = (d) => {
  document.body.classList.toggle('via-pad', d === 'pad');
  document.body.classList.toggle('via-keys', d === 'keys');
  if (d === 'pad' && mode !== 'playing') {
    // give the highlight somewhere to start
    const top = padTop();
    if (top && !top.contains(document.activeElement)) top.querySelector<HTMLElement>('.go.big:not([disabled]), button:not([disabled])')?.focus({ preventScroll: true });
  }
};
window.addEventListener('pointerdown', () => input.touched(), true);

// ------------------------------------------------ Settings › Controls: keys and buttons (remap.ts)

const remap = createRemap(input, {
  keys: () => prefs.keys,
  pad: () => prefs.padKeys,
  setKeys: (k) => {
    prefs.keys = k;
    prefsChanged();
  },
  setPad: (p) => {
    prefs.padKeys = p;
    prefsChanged();
  },
  rumble: () => prefs.rumble,
  setRumble: (on) => {
    prefs.rumble = on;
    prefsChanged();
  },
});

document.addEventListener('contextmenu', (e) => e.preventDefault());
// (two thumbs on the screen at once can read as a pinch, and a quick double tap as a zoom: a zoomed page
// shows the arena's pixels stretched, so neither is allowed to zoom it)
for (const g of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(g, (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
window.addEventListener('resize', layout);
window.addEventListener('orientationchange', () => setTimeout(layout, 200));

newWorld();
layout();
wireConfirm();
wireFlash(); // every menu button lights up for a moment when pressed
applyPrefs();
applySettings(false);
// On the website: the home-screen icon and the app's description (files beside the page), and the service
// worker that keeps a copy of the game for playing with no connection, and shows notifications (src/sw.js)
if (onWebsite()) {
  for (const [rel, href] of [
    ['apple-touch-icon', '/icon-180.png'],
    ['manifest', '/manifest.webmanifest'],
  ])
    document.head.appendChild(Object.assign(document.createElement('link'), { rel, href }));
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}
// the browser tab's icon: drawn now, so the game opened as a file has it too (on the website the same picture
// is also served as a file, for the home screen: page.html)
try {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'icon' }));
  link.type = 'image/png';
  link.href = drawIcon(64).toDataURL('image/png');
} catch {
  /* the tab keeps the browser's own icon */
}
showTitle();
requestAnimationFrame(frame);
// a link to a room (?room=CODE): straight to joining it
// (and a reload while in a room goes straight back into it)
{
  const code = readCode(new URLSearchParams(location.search).get('room'));
  let again = '';
  try {
    again = readCode(sessionStorage.getItem('onlineRoom'));
  } catch {
    /* optional */
  }
  if (again) {
    openOnlineSheet(again);
    joinOnline(again);
  } else if (code) openOnlineSheet(code, `Join room ${code}?`);
}

// A handle for automated browser checks and for poking about in the browser console.
(window as unknown as { __game: unknown }).__game = {
  get world() {
    return world;
  },
  get mode() {
    return mode;
  },
  get bots() {
    return bots;
  },
  get setup() {
    return setup;
  },
  get prefs() {
    return prefs;
  },
  get wins() {
    return wins;
  },
  get matchWinner() {
    return matchWinner;
  },
  get pad() {
    return input.pad;
  },
  get settings() {
    return settings;
  },
  get roundLive() {
    return roundLive;
  },
  get guests() {
    return guests;
  },
  get input() {
    return input;
  },
  get net() {
    return net;
  },
  /** the icon at a size, as a PNG data URL (tools/icons.py saves them for the home screen) */
  icon(size: number): string {
    return drawIcon(size).toDataURL('image/png');
  },
  /** the world that is drawn (online: the picture ahead of the server's world) */
  get view() {
    return shownWorld();
  },
};
