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
import { createWorld, step, ticksLeft, World, PlayerInput, type Player, Dir, TICK_HZ, DEATH_TICKS, type GameEvent, type ItemKind } from './sim';
import { Bot, BotLevel, BOT_LEVELS, LEVELS, createBot, botInput } from './bot';
import { COLORS, NOBODY, botName, colorById, drawAngels, drawBarrel, drawSignalIcon, drawGround, drawHead, drawItemTile, drawStatic, drawDynamic, drawGhosts, groundKey, setMap, setOrangeFire, warmSprites } from './render';
import { Input, PadReader, pilotAim, typing } from './input';
import { drawTitle, closeTitle, drawIcon } from './title';
import { initAudio, preview, setSound, sfx, wakeAudio } from './audio';
import { createLobby, LobbyHost, type LobbyPage } from './lobby';
import { readDance, type DanceId } from './dances';
import { createPadNav } from './padnav';
import { PAD } from './bindings';
import { createRemap } from './remap';
import { CpuSlot, Guest, ITEM_NAMES, MatchSetup, Prefs, SHARPNESS, SOUND_GROUPS, SOUND_NAMES, TEAMS, arenaOf, clockText, defaultPrefs, defaultSetup, load, readPrefs, readSetup, rollCpus, rollRules, save, wearsCrown, wholeTile, worldConfig } from './setup';
import { BOMB_ICON, Opt, answerConfirm, choice, confirmFirst, confirmOpen, group, heading, mount, note, slider, toggle, wireConfirm, wireFlash } from './ui';
import { Hand, DEFAULT_SENS, OLD_SENS, SENS_DEG, SENS_MAX, STRAIGHT, sensTilt, standardAims } from './swipe';
import { Online } from './online';
import { BUBBLE_TAIL, createBubbles, createChat, createQuickMenu } from './quick';
import { canInstall, howToAdd, install, isApple, myEndpoint, onWebsite, pushOff, pushOn, pushRefresh, pushState, pushTest, type PushState } from './app';
import { decodeWorld, packInput, readCode, unpackInput, type BellAnswer, type Score, type Seat, type ServerMsg } from './net';
/** Look up an element of src/page.html by its id. */
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('cv');
// (the arena is drawn over the whole of its canvas every frame, so the canvas need not be see-through: the
// browser can then put it on the screen without blending it with what is behind)
const ctx = canvas.getContext('2d', { alpha: false })!;
const staticLayer = document.createElement('canvas');
/**
 * The floor and solid blocks (staticLayer) with the blocks' shadows and the breakable blocks on them: the
 * whole arena as it stands, drawn once a frame as one picture and made again only when a block breaks or
 * lands (`ground`).
 */
const groundLayer = document.createElement('canvas');
const groundCtx = groundLayer.getContext('2d', { alpha: false })!;
let groundFor = '';
let staticStamp = 0;
function ground(w: World): HTMLCanvasElement {
  const key = `${groundKey(w)}|${staticStamp}`;
  if (key !== groundFor || groundLayer.width !== staticLayer.width || groundLayer.height !== staticLayer.height) {
    groundFor = key;
    if (groundLayer.width !== staticLayer.width) groundLayer.width = staticLayer.width;
    if (groundLayer.height !== staticLayer.height) groundLayer.height = staticLayer.height;
    groundCtx.drawImage(staticLayer, 0, 0);
    setMap(setup.map);
    drawGround(groundCtx, w, T);
  }
  return groundLayer;
}
/** The layer the ghosts of knocked-out robots float up on. It lines up with the arena and reaches from its bottom edge to the top of the screen. */
const ghosts = $<HTMLCanvasElement>('ghosts');
const gctx = ghosts.getContext('2d')!;
/** How far down the ghost layer the arena starts, in canvas pixels. */
let ghostTop = 0;
/** true if the ghost layer has something drawn on it */
let ghostsShown = false;
/** true while the ghost layer is on the screen (it is taken off while it is empty: see render) */
let ghostsOn = true;
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
/** Whose blast caught you this round: a player id, CRUSHED for a falling block, TRAIN, TNT_BLAST, or -1 if you are still in. */
let blastedBy = -1;
const CRUSHED = -2;
const TRAIN = -3;
const TNT_BLAST = -4;
/** With TNT_BLAST: who set the barrel off (-1 if nobody). */
let tntBy = -1;
/** true once this round's "blocks are falling" warning has sounded */
let hurried = false;
/** the angel tip has been shown this match (it says how angels play, the first time someone here is one) */
let angelTipShown = false;
/** the first laptop picked up here in a match gets a tip saying what it does */
let laptopTipShown = false;
/** the tip that a train is coming has been shown this match (the first time its bell rings) */
let trainTipShown = false;
const playTip = $('playTip');
/** The bubbles over the robots: what each said in the quick chat (quick.ts) */
const bubbles = createBubbles($('bubbles'), (i) => colorById(world.players[i]?.colorId ?? 'gold').glow);
/** The quick menu: the menu button held down (quick.ts) */
const quickMenu = $('quickMenu');
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

// Control settings, remembered on this device under the key "controls5".
// (Swipe length is not a setting: the quiet zone is always the standard size, `QUIET` in swipe.ts.)

/**
 * `hand` is the thumb that steers: the swipe pad sits on that side, A and B on the other.
 * `sens` is Movement sensitivity, 0 to SENS_MAX percent (swipe.ts: how far the pad reads swipes as leaning,
 * 0.45° for each 1%). It replaced the Standard / My thumb switch and Match my thumb (the owner's call,
 * November 2026; docs/SWIPE-HISTORY.md), and was three steps, Low, Medium and High, until 18 November 2026.
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
  const saved = JSON.parse(localStorage.getItem('controls5') ?? 'null');
  const four = saved ? null : JSON.parse(localStorage.getItem('controls4') ?? 'null');
  if (saved) {
    settings.hand = saved.hand === 'right' ? 'right' : 'left';
    if (Number.isInteger(saved.sens) && saved.sens >= 0 && saved.sens <= SENS_MAX) settings.sens = saved.sens;
  } else if (four) {
    // From before (controls4): Low, Medium or High become 4%, 11% or 18%, the same lean to within a fifth of a degree
    settings.hand = four.hand === 'right' ? 'right' : 'left';
    if (Number.isInteger(four.sens) && four.sens >= 0 && four.sens < OLD_SENS.length) settings.sens = OLD_SENS[four.sens];
  } else {
    // From before that (controls3): the steering thumb, and a Match my thumb result in use becomes the nearest
    // sensitivity (its average lean: the owner's own 2° reads as 4%)
    const old = JSON.parse(localStorage.getItem('controls3') ?? 'null');
    if (old) {
      settings.hand = old.hand === 'right' ? 'right' : 'left';
      const t = old[settings.hand];
      const aims = t?.use !== false ? t?.match?.aims : null;
      if (Array.isArray(aims) && aims.length === 5) {
        let sum = 0;
        for (let d = 1; d <= 4; d++) sum += ((((STRAIGHT[d] - aims[d] + 180) % 360) + 360) % 360) - 180;
        const lean = Math.abs(sum / 4);
        settings.sens = Math.max(0, Math.min(SENS_MAX, Math.round(lean / SENS_DEG)));
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
  return matchCpus()[i - 1 - guests.length]?.dance ?? 'party';
}
/**
 * The CPU players as this match has them (on this screen; online the seats say). With Randomize CPUs on,
 * `newMatch` picks each one's emote and level at random; the lobby's own are left as they were.
 */
let rolled: CpuSlot[] | null = null;
const matchCpus = (): CpuSlot[] => (rolled && rolled.length === setup.cpus.length ? rolled : setup.cpus);
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
  bubbles.clear();
  bots = matchCpus().map((c, i) => createBot(i + 1 + guests.length, c.level, seed));
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
 * Where each place on the scoreboard goes: the left edge and width of its cell, and `foot`, the line its head
 * sits on, in page pixels from the scoreboard's own top left. The name goes over the head and a quick chat
 * line hangs under it (the owner's ask, 24 November 2026). Four places, or one per player when more than four
 * are playing.
 */
let scoreCells: { x: number; w: number; foot: number }[] = [];
/**
 * Upright with more than four players the scoreboard is a band of its own under the top bar: names, heads,
 * and room under the heads for a chat line, so it never runs onto the arena. Page pixels.
 */
const SCORE_BAND = 58;
/** Upright, the room under the top bar is at least this tall, so a chat line under a head fits above the arena. */
const CHAT_ROOM = 24;
/** Where the quick chat's bubbles may go (the arena is never covered), and how big their type is: set by layout(). */
let bubbleRoom = { left: 0, right: 0, bottom: 0 };
/** the size of the names over the heads, in page pixels */
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
  // Settings › Graphics › Sharpness: fewer pixels to save battery, or (Smoothest) more than the
  // screen has, shrunk to fit
  const s = SHARPNESS[prefs.sharpness];
  return Math.min(screenDensity() * s.over, MAX_DENSITY, s.cap * s.over);
}
/**
 * How many of the screen's pixels really make one of the page's, as far as the page can tell: what the
 * browser reports, times how far the page itself is zoomed (`pageZoom`). A page can be shown zoomed without
 * its reported density changing: pinched, shrunk to fit something too wide, or zoomed by the app showing
 * it. Canvases drawn for the reported density alone are then stretched, and soft, while text stays sharp.
 */
function screenDensity(): number {
  // (it was times the page's zoom for a day, November 2026; the owner found the arena looked bad again, so
  // back to what the browser reports, as when it was fine: pageZoom is only shown in Settings now)
  return window.devicePixelRatio || 1;
}
/**
 * How far the page is zoomed on the screen (the browser's visualViewport.scale): 1 nearly always. A new
 * value is taken up once it has held still for a moment (`watchZoom`, every frame), so a pinch in progress
 * does not have every canvas and sprite made again on each frame of it.
 */
let pageZoom = 1;
let zoomSeen = 1;
let zoomSince = 0;
const ZOOM_SETTLE_MS = 250;
function watchZoom(now: number): void {
  const raw = window.visualViewport?.scale ?? 1;
  // (within half a per cent of 1 is 1: browsers report 0.9999... and the like)
  const z = Number.isFinite(raw) && raw > 0.05 && Math.abs(raw - 1) > 0.005 ? Math.round(raw * 1000) / 1000 : 1;
  if (z !== zoomSeen) {
    zoomSeen = z;
    zoomSince = now;
  } else if (z !== pageZoom && now - zoomSince >= ZOOM_SETTLE_MS) pageZoom = z;
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
  const places = Math.max(4, world.players.length);
  // upright with more than four players, the scoreboard is a band of its own under the top bar
  const band = stacked && places > 4;
  const availH = H - topBar - (band ? SCORE_BAND : 0) - minControls;
  // the free line is as tall as one block, so the height has to hold one row more than the arena has
  T = wholeTile(Math.max(8, Math.floor(Math.min((W * dpr) / world.w, (availH * dpr) / (world.h + (stacked && !band ? INFO_ROWS : 0))))), world.w, world.h, dpr);
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
  // (the free line is at least CHAT_ROOM tall, so a chat line under a head on the scoreboard fits over the arena;
  // with more than four players it is the scoreboard's own band)
  const infoRow = !stacked ? 0 : band ? SCORE_BAND : Math.max(CHAT_ROOM, Math.round((T / dpr) * INFO_ROWS));
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
  // The scoreboard: four heads, each with its wins to its right and its name over it. Upright it is in the top
  // bar, two places on each side of the timer, left of the chat and menu buttons. Otherwise it is a row under
  // the timer, over the column beside the arena.
  const side = Math.max(150, (W - cw) / 2);
  const perRow = 5; // sideways, with more than four players: rows of up to five
  const rows = places > 4 ? Math.ceil(places / perRow) : 1;
  // Each head has its player's name over it and room under it for a chat line (the owner's ask, 24 November
  // 2026: names over the heads, chat under them, never onto the arena or its walls). Upright with four the
  // heads sit on the foot of the top bar and the chat hangs into the free line; upright with more, the
  // scoreboard is a band of its own (SCORE_BAND); sideways each row is taller.
  const ROW = 58;
  const box =
    band
      ? // more than four players, upright: a band under the top bar, one place each across the screen
        { left: 0, top: topBar, width: W, height: SCORE_BAND }
      : stacked
        ? { left: 0, top: 0, width: W, height: topBar + infoRow }
        : { left: 6, top: 40, width: Math.min(side - 12, places > 4 ? 300 : 260), height: ROW * rows };
  scoreHeadMax = HEAD_R;
  scoreNameSize = 10;
  if (band) {
    const cell = (W - 12) / places;
    scoreNameSize = 9;
    scoreHeadMax = 9;
    // names, then heads; the rest of the band is the chat's
    scoreCells = Array.from({ length: places }, (_, i) => ({ x: 6 + i * cell, w: cell, foot: scoreNameSize + 3 + 2 * scoreHeadMax + 1 }));
  } else if (stacked) {
    // The quick chat button sits left of the menu button (the owner's ask, 24 November 2026), so the two take
    // the right of the top bar. The four places and the timer share the rest, two places each side of the
    // timer, which sits in the middle of that room (a little left of the screen's middle) so the places stay
    // as wide as they were. (Until then the far left was kept clear to match the menu button.)
    const half = (timer.offsetWidth || 80) / 2 + 5;
    const left = 6;
    const right = W - CHAT_RIGHT - CHAT_W - 4;
    const mid = Math.round((left + right) / 2);
    timerMid = mid;
    const cell = Math.max(24, (mid - half - left) / 2);
    scoreNameSize = 11;
    // the heads sit on the foot of the top bar, their names over them
    scoreCells = [left, left + cell, mid + half, mid + half + cell].map((x) => ({ x, w: cell, foot: topBar - 3 }));
  } else {
    box.left = Math.round((side - box.width) / 2);
    const across = places > 4 ? perRow : 4;
    const cell = box.width / across;
    scoreCells = Array.from({ length: places }, (_, i) => ({ x: (i % across) * cell, w: cell, foot: ROW * Math.floor(i / across) + 4 + scoreNameSize + 3 + 2 * HEAD_R }));
  }
  // Where a chat line may hang under a head: upright, down to just over the arena's top wall, on one line, its
  // type as big as that room allows; sideways, inside the column beside the arena, as many lines as it needs.
  const foot = box.top + (scoreCells[0]?.foot ?? 0);
  const layer = $('bubbles');
  if (stacked) {
    bubbleRoom = { left: 4, right: W - 4, bottom: top - 1 };
    const room = top - 1 - (foot + 1) - BUBBLE_TAIL - 4; // (4: the bubble's padding and border, top and bottom)
    layer.style.setProperty('--bubble-font', `${Math.max(7, Math.min(12, Math.floor(room / 1.2)))}px`);
    layer.style.setProperty('--bubble-max', `${W - 8}px`);
  } else {
    bubbleRoom = { left: box.left, right: Math.min(box.left + box.width, left - 3), bottom: H - 4 }; // (never over the arena beside it)
    layer.style.setProperty('--bubble-font', '12px');
    layer.style.setProperty('--bubble-max', `${Math.round(bubbleRoom.right - bubbleRoom.left)}px`);
  }
  layer.classList.toggle('wrap', !stacked);
  // the quick chat button, just left of the menu button (the owner's ask, 24 November 2026), and the two panels under them
  timer.style.left = stacked && places <= 4 ? `${timerMid}px` : timer.style.left;
  $('chatBtn').style.right = `${CHAT_RIGHT}px`;
  $('chatPanel').style.top = quickMenu.style.top = '46px';
  $('chatPanel').style.right = quickMenu.style.right = '8px';
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
  resultPlace = { top: stacked ? Math.round(topBar + infoRow + ch + 14) : box.top + box.height + 8, stacked };
  fitResult();
  redrawStatic();
}

/** The quick chat button: its distance from the right of the screen (just left of the menu button) and its width. */
const CHAT_RIGHT = 52;
const CHAT_W = 38;
/** Upright with four places or fewer: where the timer's middle is (layout). */
let timerMid = 0;
/** Where layout() put the result panel: its top, and whether it lies over the controls (upright). */
let resultPlace = { top: 0, stacked: true };
/**
 * Keep the whole result panel, its last button included, on the screen (its three buttons one above the other,
 * the owner's ask, 19 November 2026, made it taller). Where it does not fit it gets smaller type and slimmer
 * buttons (`tight`); sideways it may then rise over the scoreboard as far as it needs (never over the arena); and
 * if it still does not fit, upright on the smallest phones, it scrolls inside itself.
 */
function fitResult(): void {
  if (result.hidden) return;
  const H = window.innerHeight;
  const { top, stacked } = resultPlace;
  resultCard.classList.remove('tight');
  resultCard.style.maxHeight = '';
  resultCard.style.overflowY = '';
  resultCard.style.top = `${top}px`;
  const room = (): number => H - 8 - top;
  if (resultCard.offsetHeight <= room()) return;
  resultCard.classList.add('tight');
  const h = resultCard.offsetHeight;
  const at = stacked ? top : Math.max(8, Math.min(top, H - 8 - h));
  resultCard.style.top = `${at}px`;
  if (h > H - 8 - at) {
    resultCard.style.maxHeight = `${H - 8 - at}px`;
    resultCard.style.overflowY = 'auto';
  }
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
  setMap(setup.map);
  drawStatic(staticLayer.getContext('2d')!, w, T);
  staticStamp++; // (the picture with the breakable blocks on it is out of date too)
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

/** Where the foot of each player's head is on the page, as drawScore last drew it (the quick chat's bubbles hang under them). */
const headAt: ({ x: number; y: number } | undefined)[] = [];
function drawScore(): void {
  const places = Array.from({ length: Math.max(4, world.players.length) }, (_, i) => world.players[i]);
  const winner = world.over ? world.over.winner : -1;
  const key = places.map((p, i) => (p ? `${p.colorId}t${p.team}${p.alive ? '' : 'x'}${p.zombie ? 'z' : ''}${wins[i]}l${p.lives}${scoreName(i)}` : '-')).join('|') + `|${winner}|${leader}|${score.width}x${score.height}`;
  if (key === scoreKey) return;
  scoreKey = key;
  headAt.length = 0;
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
    const cy = cell.foot - r; // (the head sits on its cell's foot, its name over it)
    const numX = cx + r + gap; // where the number of wins starts
    const dim = !p ? 0.45 : p.alive && !p.zombie ? 1 : 0.45; // (a zombie is out of the round)
    // the helmet has a rim in the player's colour, which is what shows it against the dark screen
    // (the first robot's helmet was all black, and needed a disc behind it and a ring round it here)
    sctx.globalAlpha = dim;
    drawHead(sctx, cx, cy, r, col, { xEyes: !!p && !p.alive });
    sctx.globalAlpha = 1;
    if (!p) return;
    // the crown goes on last, and is not dimmed
    if (crowned(i)) drawHead(sctx, cx, cy, r, col, { crownOnly: true });
    sctx.fillStyle = winner >= 0 && onSide(i, winner) ? col.glow : p.alive ? '#eef1fb' : '#8a90a3';
    sctx.fillText(label, numX, cy + 1);
    // with more than one life a round, a little dot for each life left, under the number (the name is over the head)
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
    // the player's name over the head (the owner's ask, 24 November 2026: it was under it), as wide as the cell
    // allows (a typed name is drawn as text, never markup); yours in your colour
    const name = scoreName(i);
    sctx.font = `600 ${scoreNameSize}px "Chakra Petch", system-ui, sans-serif`;
    sctx.textAlign = 'center';
    // (a teams match: every name in its team's colour, faded once out of the round; the owner's ask)
    if (p.team >= 0) {
      sctx.fillStyle = TEAMS[p.team].color;
      if (!(p.alive && !p.zombie)) sctx.globalAlpha = 0.5;
    } else sctx.fillStyle = i === myIdx() ? col.glow : p.alive && !p.zombie ? '#c9cfdf' : '#6f7588';
    const shown = fitText(sctx, name, cell.w - 4);
    const half = sctx.measureText(shown).width / 2;
    // centred under the head, kept inside its own place
    const nameX = Math.max(cell.x + 2 + half, Math.min(cx, cell.x + cell.w - 2 - half));
    sctx.fillText(shown, nameX, Math.max(scoreNameSize / 2 + 1, cy - r - 2 - scoreNameSize / 2));
    // where the head is on the page: a quick chat line hangs under it (bubbles in quick.ts)
    headAt[i] = { x: (parseFloat(score.style.left) || 0) + cx, y: (parseFloat(score.style.top) || 0) + cy + r };
    sctx.globalAlpha = 1;
    sctx.textAlign = 'left';
    said.push(`${nameOf(i)}${p.team >= 0 ? `, ${TEAMS[p.team].name},` : ''} ${wins[i]}${crowned(i) ? ' (in the lead)' : ''}`);
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
 * A small shake of the arena when a bomb goes off (the owner's ask): a couple of page pixels, dying away over a
 * sixth of a second (it was 3 pixels over a fifth: the owner asked for it a little more subtle). Whole pixels
 * only, so the arena stays sharp. None with Settings › Graphics › Less movement.
 */
const SHAKE_PX = 2;
const SHAKE_S = 0.16;
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

/** Your input, its steering (`aim`) kept only while you are flying the laptop's plane, when it is all it is for. */
function flyingAim(inp: PlayerInput): PlayerInput {
  const me = shownWorld().players[myIdx()];
  if (inp.aim !== undefined && !(me && me.flying > 0)) delete inp.aim;
  return pilot(inp, me);
}

/**
 * With Inverse plane controls on (Settings › Controls; the default), a player here flying the laptop's plane
 * steers it like a pilot: left and right turn it to its own left and right (`pilotAim` in input.ts), worked out
 * from where its plane is heading on this screen. Off, the aim is the way the thumb, keys or stick point.
 */
function pilot<T extends PlayerInput | undefined>(inp: T, p: Player | undefined): T {
  if (!inp || !p || !(p.flying > 0) || !prefs.planeInverse) return inp;
  const aim = pilotAim(inp.dir, p.planeDir);
  if (aim === undefined) delete inp.aim;
  else inp.aim = aim;
  return inp;
}

/**
 * What the A and B buttons do, on them, when it is not the usual: holding a laptop, B flies the plane; flying
 * it, A drops a bomb (with how many are left) and B lands it. Only redrawn when that changes.
 */
let hintKey = '';
const LAPTOP_GLYPH =
  '<svg class="tb-ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="10" rx="1.5"/><path d="M2.5 18.5h19"/></svg>';
function touchHints(): void {
  const me = shownWorld().players[myIdx()];
  const key = !me || !me.alive ? '' : me.flying > 0 ? `fly${me.planeBombs}` : me.laptop ? 'laptop' : '';
  if (key === hintKey) return;
  hintKey = key;
  const a = $('btnA');
  const b = $('btnB');
  if (key.startsWith('fly')) {
    const n = me.planeBombs;
    a.innerHTML = `<span class="tb-key">A</span><small class="tb-sub">${n ? `drop · ${n} left` : 'all dropped'}</small>`;
    b.innerHTML = '<span class="tb-key">B</span><small class="tb-sub">land</small>';
    a.setAttribute('aria-label', `A button, drop a bomb from the plane, ${n} left`);
    b.setAttribute('aria-label', 'B button, land the plane');
  } else {
    a.textContent = 'A';
    a.setAttribute('aria-label', 'A button, drop bomb');
    if (key === 'laptop') {
      b.innerHTML = `<span class="tb-row"><span class="tb-key">B</span>${LAPTOP_GLYPH}</span><small class="tb-sub">fly plane</small>`;
      b.setAttribute('aria-label', 'B button, fly the plane');
    } else {
      b.textContent = 'B';
      b.setAttribute('aria-label', 'B button, lift or throw a bomb');
    }
  }
  b.classList.toggle('laptop', key === 'laptop');
}

/** Draw one frame. */
function render(time: number): void {
  padCaption();
  touchHints();
  shake(time);
  // (online the drawn world runs a little ahead of the server's: a block that has landed in it is drawn in now)
  const w = shownWorld();
  if (landedIn(w) !== staticLanded) redrawStatic();
  ctx.drawImage(ground(w), 0, 0);
  clock = time;
  const winner = world.over ? world.over.winner : -1;
  drawDynamic(ctx, w, T, time, myIdx(), winner >= 0 && decidedAt >= 0 ? { player: winner, t: time - decidedAt, dance: danceOf(winner) } : undefined, crowned, true);
  // a few of the robots' pictures made ahead of need, so play does not stutter (the winner's dance included)
  warmSprites(ctx, w, T, 4, world.over && world.over.winner >= 0 ? danceOf(world.over.winner) : 'party');
  // the ghosts, on their own layer, which is only cleared when it has something on it
  gctx.setTransform(1, 0, 0, 1, 0, 0);
  if (ghostsShown) gctx.clearRect(0, 0, ghosts.width, ghosts.height);
  gctx.setTransform(1, 0, 0, 1, 0, ghostTop);
  ghostsShown = prefs.ghosts ? drawGhosts(gctx, w, T, -ghostTop) : false; // they can be switched off in Settings › Graphics
  // angels on the wall are part of the game, so they are drawn whatever that setting says
  if (drawAngels(gctx, w, T, time)) ghostsShown = true;
  // with nothing on it the layer is taken off the screen, so the browser has one big see-through picture
  // fewer to lay over the arena every frame
  if (ghostsShown !== ghostsOn) {
    ghostsOn = ghostsShown;
    ghosts.style.display = ghostsOn ? '' : 'none';
  }
  drawTimer();
  drawScore();
  bubbles.place((i) => headAt[i] ?? null, bubbleRoom);
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
  $('change').textContent = 'Lobby'; // (on this screen: Next round and Lobby, the owner's words; it was Menu)
  $('again').hidden = false;
  $('toMatch').hidden = false;
  if (net) {
    // online the round is played out, and only the host moves everyone on
    const decided = !!world.over;
    $('again').hidden = !net.isHost || !decided;
    $('change').textContent = done && net.isHost ? 'Lobby' : 'Menu';
    $('toMatch').hidden = !(done && net.isHost); // (mid-match, the host has it in the menu)
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
  fitResult(); // (its text and buttons differ each time)
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
  } else if (e.type === 'tnt') {
    sfx.tnt();
    shakeAt = clock;
  } else if (e.type === 'bell') sfx.bell();
  else if (e.type === 'train') sfx.train();
  else if (e.type === 'pickup') e.kind === 'curse' ? sfx.curse() : sfx.pickup();
  else if (e.type === 'shield') sfx.shield();
  else if (e.type === 'kick' || e.type === 'throw') sfx.kick();
  else if (e.type === 'lift' || e.type === 'land') sfx.lift();
  else if (e.type === 'block') sfx.block();
  else if (e.type === 'respawn' || e.type === 'revive') sfx.shield(); // back in the round
  else if (e.type === 'rise') sfx.curse(); // a zombie gets up
  else if (e.type === 'death') sfx.death();
  else if (e.type === 'launch') sfx.lift(); // the laptop's plane goes up (Lift and land's sound)
  else if (e.type === 'drop') sfx.kick(); // and lets a bomb go: a whoosh (Kick and throw's)
}

/** One step of the game rules on this screen: read the input, then advance (below). */
function tick(): void {
  // player 0 is you; then the other players here; then the CPU players, which are asked for the same thing
  // your controls give. Once the round is decided nobody is asked for anything: the winner celebrates.
  const inputs: (PlayerInput | undefined)[] = [];
  if (!world.over) {
    inputs[0] = pilot(input.state(), world.players[0]);
    guests.forEach((g, i) => (inputs[i + 1] = pilot(input.reader(g.pad)?.state(), world.players[i + 1])));
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
    if (e.type === 'explode' || e.type === 'tnt') {
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
      if (e.player === mi && e.out) {
        blastedBy = e.cause === 'block' ? CRUSHED : e.cause === 'train' ? TRAIN : e.cause === 'tnt' ? TNT_BLAST : e.by;
        tntBy = e.by;
      }
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
  if (!trainTipShown && world.events.some((e) => e.type === 'bell')) {
    trainTipShown = true;
    showTip('Train coming! Get off the line with the flashing lights');
  }
  if (!laptopTipShown) {
    const got = world.events.find((e) => e.type === 'pickup' && e.kind === 'laptop' && (net ? e.player === mi : human(e.player)));
    if (got && got.type === 'pickup') {
      laptopTipShown = true;
      showTip(`${couch() ? `${nameOf(got.player)}: a` : 'A'} laptop! B flies a plane: steer it, A drops bombs`);
    }
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
      addPoint(winner);
      sfx.win();
    }
    announce();
  } else if (!world.over && !overShown && couch() && world.players.every((p, i) => !human(i) || (!p.alive && p.lives === 0 && !p.angel && !p.zombie && p.deadTicks >= DEATH_TICKS))) {
    // everyone here is out and CPU players are still at it, as below
    finish('Everyone here is out', 'The CPU players are still fighting. Next round gives this round to one of them at random.');
  } else if (!world.over && !overShown && !couch() && !me.alive && me.lives === 0 && !me.angel && !me.zombie && me.deadTicks >= DEATH_TICKS) {
    // You are out and the others are still at it. The round carries on behind this panel, and its
    // winner still gets the win. On this screen Next round does not wait for it; online it is played out.
    finish(
      blastedBy === CRUSHED ? 'You got crushed' : blastedBy === TRAIN ? 'You got run over' : 'You got blasted',
      `${howOut()} The others are still fighting. ${net ? 'The last robot standing wins the round.' : 'Next round gives this round to one of them at random.'}`,
    );
  }
}

/**
 * Who wears the crown: the player in the lead and, in a teams match, everyone on its side, so a winning team
 * of any size all wear it, on their robots and on the scoreboard (the owner's ask, 25 November 2026: only one
 * of the two did). Teammates always win together, so they always have the same wins.
 */
function crowned(i: number): boolean {
  return wearsCrown(world.players, leader, i);
}

/**
 * A round won by `w`: a point on the scoreboard for it or, in a teams match, for every robot on its side.
 * The crown goes to whoever is in front (a player who only draws level does not take it), and the match to
 * whoever reaches Rounds to win.
 */
function addPoint(w: number): void {
  const side = world.players[w].team;
  for (const p of world.players) if (p.id === w || (side >= 0 && p.team === side)) wins[p.id]++;
  if (leader < 0 || wins[w] > wins[leader]) leader = w;
  if (wins[w] >= setup.firstTo) matchWinner = w;
}

/** Who won, as the result panel says it: the robot's name or, in a teams match, its side. */
function sideName(i: number): string {
  const t = world.players[i]?.team ?? -1;
  return t >= 0 ? TEAMS[t].name : nameOf(i);
}

/** Did `i` win (on its own or with its side)? */
function onSide(i: number, of: number): boolean {
  const a = world.players[i];
  const b = world.players[of];
  return !!a && !!b && (i === of || (a.team >= 0 && a.team === b.team));
}

/** How you were knocked out, for the result panel. */
function howOut(): string {
  const me = world.players[myIdx()];
  const who = world.players[blastedBy];
  if (blastedBy === TRAIN) return 'The train hit you.';
  if (blastedBy === TNT_BLAST) {
    const lit = world.players[tntBy];
    if (!lit) return 'Caught in a TNT blast.';
    return lit === me ? 'Caught in a TNT blast you set off.' : `Caught in a TNT blast ${nameOf(tntBy) === 'You' ? botName(colorById(lit.colorId)) : nameOf(tntBy)} set off.`;
  }
  return blastedBy === CRUSHED ? 'A falling block landed on you.' : !who || who === me ? 'Caught in your own blast.' : `Caught in ${nameOf(blastedBy) === 'You' ? botName(colorById(who.colorId)) : nameOf(blastedBy)}'s blast.`;
}

/** The result panel for a decided round (the score already counted). */
function announce(): void {
  const mi = myIdx();
  const me = world.players[mi];
  const winner = world.over ? world.over.winner : -1;
  const how = howOut();
  const teams = world.teams;
  if (world.coop) {
    // everyone on one team (the lobby's Custom teams, all one colour): the round is played together
    if (matchWinner >= 0) finish('Your team wins the match', `Everyone on one team. First to ${setup.firstTo}. Final score ${scoreLine()}.`);
    else if (winner >= 0) finish('You survived!', `Everyone on one team, and someone lasted until the last block fell. ${wins[mi]} of ${setup.firstTo} to win the match.`);
    else finish('Nobody made it', 'Everyone on one team, and nobody lasted until the last block fell.');
    return;
  }
  if (couch()) {
    // several people here: say who, by name and P-number (or which side)
    if (matchWinner >= 0) finish(`${sideName(matchWinner)} wins the match`, `First to ${setup.firstTo}. Final score ${scoreLine()}.`);
    else if (winner >= 0) finish(`${sideName(winner)} wins the round`, `${wins[winner]} of ${setup.firstTo} to win the match.`);
    else finish('Draw', 'Nobody was left standing.');
  } else if (matchWinner >= 0 && onSide(mi, matchWinner)) finish(teams ? 'Your team wins the match' : 'You win the match', `${teams ? `${sideName(matchWinner)}. ` : ''}First to ${setup.firstTo}. Final score ${scoreLine()}.`);
  else if (matchWinner >= 0) finish(`${sideName(matchWinner)} wins the match`, `First to ${setup.firstTo}. Final score ${scoreLine()}.${me.alive ? '' : ' ' + how}`);
  else if (winner >= 0 && onSide(mi, winner)) finish(teams ? 'Your team wins the round' : 'You win the round', `${teams ? `${sideName(winner)}, last side standing.` : 'Last bot standing.'} ${wins[mi]} of ${setup.firstTo} to win the match.`);
  else if (winner >= 0) finish(`${sideName(winner)} wins the round`, me.alive ? '' : how);
  else finish('Draw', me.alive ? 'Nobody was left standing.' : `${how} Nobody was left standing.`);
}

let last = performance.now();
let acc = 0;
/** How early a tick may be taken, as a share of a tick (see frame). */
const STEP_SLACK = 0.25;
/** A screen whose frames are within this share of a sixtieth of a second apart has the round keep its time (see frame). */
const STEP_LOCK = 0.06;
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  keepSharp(now);
  input.pad.poll(now); // notice a thumb that has stopped, in every mode
  input.others = new Set(guests.map((g) => g.pad));
  input.pollGamepad(); // the controllers: their sticks and buttons, for the round and the menus
  padNav.step(now, mode !== 'playing');
  guestPads();
  if (net && netRound) {
    // online: the server's world moves on as its ticks come in (onRound's hooks), whatever screen is showing:
    // nobody can pause it. Here, what you press goes to the server (nothing while a menu is open) and the
    // picture that is drawn moves on to now, your robot with it (predict.ts).
    net.frame(now, mode === 'playing' ? packInput(flyingAim(input.state())) : 0);
  } else if (mode === 'playing' || mode === 'over') {
    // The round moves on in ticks of a sixtieth of a second, as many as the time that has passed holds. A
    // screen's frames are a sixtieth apart too, but never exactly (16.6 ms, then 16.8), and counted strictly
    // that made a frame with no tick now and then and the next with two: a small judder in everything that
    // moves. So a tick is taken once the time is within STEP_SLACK of due, and the debt carried over. And
    // on a screen that is close to sixty frames a second (within STEP_LOCK: 59.94, say), a frame that got its
    // one tick has that debt eased towards the middle of its range, so the two never drift to where a frame
    // would get none or two: the round then keeps the screen's own time, a hair off a true sixtieth. Any
    // other screen (50, 90, 120 frames a second) is left alone and the round runs at exactly its speed.
    acc += dt;
    const stepLen = 1 / TICK_HZ;
    let n = 0;
    while (acc >= stepLen * (1 - STEP_SLACK) && n < 6) {
      tick();
      acc -= stepLen;
      n++;
    }
    if (n === 6) acc = 0;
    else if (n === 1 && Math.abs(dt - stepLen) < stepLen * STEP_LOCK) acc += ((0.5 - STEP_SLACK) * stepLen - acc) * 0.1;
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
function keepSharp(now: number): void {
  watchZoom(now);
  const dpr = density();
  if (dpr !== laidOut.dpr || window.innerWidth !== laidOut.w || window.innerHeight !== laidOut.h) {
    sharpTries = 0; // a new screen: the check starts afresh
    layout();
  } else if (now - sharpAt >= SHARP_EVERY_MS) checkSharp(now);
}

/**
 * Twice a second, where the arena really is on the screen and how big, compared with the pixels it was drawn
 * with: shown in Settings › Graphics under Sharpness ("Arena: laid out pixel for pixel", or what is off), so a
 * blurry screen can be reported with its reason. If it is shown stretched it is laid out again (a few times
 * at most). It does not otherwise touch the arena: for a day in November 2026 it also showed it pixelated,
 * moved it onto the screen's grid and followed the page's zoom, and the owner found the arena looked worse.
 */
const SHARP_EVERY_MS = 500;
const SHARP_TRIES = 4;
/** After its first tries, a stretched arena is laid out again this often for as long as it stays stretched (it used to give up for good). */
const SHARP_RETRY_MS = 2000;
let sharpAt = 0;
let sharpTries = 0;
let sharpRetryAt = 0;
let sharp = { ok: true, text: 'not checked yet' };
/** The last time the arena was found soft, and why, with the numbers (Settings › Graphics shows it, for a screenshot). */
let softSeen: { at: number; text: string } | null = null;

/**
 * The page itself never scrolls: everything that scrolls does so inside its own box. But an iPhone can leave it
 * shifted: put back where it was scrolled when the page is reloaded (Safari and Chrome both do, by default),
 * or left a little way up after the keyboard has been open (the name, a room code). Shifted by a fraction of
 * a page pixel, the arena sits between the screen's pixels and the browser smooths all of it, while text is
 * drawn afresh and stays crisp: the arena soft "at random" on a refresh (the owner, November 2026). So the
 * page is never put back where it was, and is put straight back at the top whenever anything moves it.
 * Returns true if it had to.
 */
try {
  history.scrollRestoration = 'manual';
} catch {
  /* an old browser: the checks below still put it right */
}
function unshift(): boolean {
  // (not while typing: then the phone has moved the page on purpose, to keep the box above the keyboard)
  const typing = document.activeElement?.matches('input, textarea, select, [contenteditable="true"]');
  if (typing) return false;
  const se = document.scrollingElement ?? document.documentElement;
  const vv = window.visualViewport;
  const moved = window.scrollX || window.scrollY || se.scrollTop || se.scrollLeft || document.body.scrollTop || document.body.scrollLeft;
  const panned = vv && vv.scale > 0.999 && vv.scale < 1.001 && (Math.abs(vv.offsetTop) > 0.01 || Math.abs(vv.offsetLeft) > 0.01);
  if (!moved && !panned) return false;
  window.scrollTo(0, 0);
  se.scrollTop = se.scrollLeft = 0;
  document.body.scrollTop = document.body.scrollLeft = 0;
  return true;
}
/**
 * The page zoomed (not by the player: pinching is not allowed). The viewport tag allows exactly 1; writing it
 * again has the browser apply it again, which brings the page back to 1. At most once every few seconds.
 */
let unzoomAt = -1e9;
function unzoom(now: number): void {
  if (now - unzoomAt < 3000) return;
  unzoomAt = now;
  const m = document.querySelector('meta[name="viewport"]');
  const was = m?.getAttribute('content');
  if (!m || !was) return;
  m.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1');
  requestAnimationFrame(() => m.setAttribute('content', was));
}

function checkSharp(now: number): void {
  sharpAt = now;
  if (shaken) return; // (mid-shake it is a pixel or two off on purpose)
  if (unshift()) {
    softSeen = { at: Date.now(), text: 'the page had been shifted (put back)' };
    return; // (measured again on the next check, in its place)
  }
  // (behind the title, the lobby or Settings the arena is still laid out, so it is checked there too: by the
  // time it shows it has been put right, and Settings can say what was found)
  const r = canvas.getBoundingClientRect();
  if (r.width < 2 || !canvas.width) return;
  const vv = window.visualViewport;
  const real = (window.devicePixelRatio || 1) * (vv && vv.scale > 0.05 ? vv.scale : 1); // the screen's pixels to one of the page's, right now
  const want = density();
  const exact = want >= screenDensity() - 0.001;
  // (the arena is left as the layout put it: showing it pixelated and nudging it onto the grid were tried for a
  // day in November 2026 and the owner found it looked worse on his phone. This only looks, and says.)
  if (canvas.style.imageRendering) canvas.style.imageRendering = ghosts.style.imageRendering = '';
  const shownAt = canvas.width / r.width;
  const stretch = shownAt / want;
  const off = (v: number): number => {
    const d = v * real;
    return d - Math.round(d);
  };
  const dx = off(r.left - (vv?.offsetLeft ?? 0));
  const dy = off(r.top - (vv?.offsetTop ?? 0));
  const zoom = real / (window.devicePixelRatio || 1);
  const zoomed = Math.abs(zoom - 1) > 0.005;
  const stretched = Math.abs(stretch - 1) > 0.004;
  const offGrid = Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05; // (a hair, as a fractional density leaves, is not worth a word)
  const bits: string[] = [];
  if (!exact) bits.push('drawn softer on purpose (Sharpness is below Sharpest)');
  if (zoomed) bits.push(`the page is zoomed ×${Math.round(zoom * 100) / 100}`);
  if (stretched) bits.push(`shown ${Math.round(Math.abs(1 / stretch - 1) * 1000) / 10}% ${stretch < 1 ? 'bigger' : 'smaller'} than drawn`);
  if (offGrid) bits.push(`${Math.round(Math.max(Math.abs(dx), Math.abs(dy)) * 100) / 100} of a pixel off the grid`);
  const shrunk = want > screenDensity() + 0.001;
  // (this measures the page, not what the browser does with it: the blur of November 2026 was inside WebKit,
  // where this line said "pixel for pixel" throughout. See page.html, #cv)
  sharp = bits.length ? { ok: false, text: bits.join('; ') } : { ok: true, text: shrunk ? `drawn at ${Math.round((want / screenDensity()) * 100) / 100}× the screen and shrunk to fit` : 'laid out pixel for pixel' };
  if (bits.length && exact) {
    // the numbers, for a screenshot of Settings › Graphics: the screen's density, the page's zoom and shift, and
    // where the arena is and how big, against what it was drawn with
    const n = (v: number): number => Math.round(v * 1000) / 1000;
    softSeen = {
      at: Date.now(),
      text: `${sharp.text} [density ${n(window.devicePixelRatio || 1)}, zoom ${n(vv?.scale ?? 1)}, shift ${n(vv?.offsetLeft ?? 0)},${n(vv?.offsetTop ?? 0)}, arena ${n(r.left)},${n(r.top)} ${n(r.width)}×${n(r.height)} for ${canvas.width}×${canvas.height}]`,
    };
  }
  if (zoomed) unzoom(now);
  // stretched (the window changed under it without a resize): laid out again, a few times straight away, then
  // every couple of seconds for as long as it lasts (it used to stop trying after four, for good)
  if (stretched && (sharpTries < SHARP_TRIES || now >= sharpRetryAt)) {
    sharpTries++;
    sharpRetryAt = now + SHARP_RETRY_MS;
    layout();
  }
}

/**
 * The swipe pad's caption while playing: the Movement sensitivity, or while you fly a plane (the laptop
 * power-up), what the pad and buttons do then. Called every frame; it only touches the page when it changes.
 */
let padText = '';
function padCaption(): void {
  const me = world?.players[myIdx()];
  // (flying, the A and B buttons say the rest: touchHints)
  const text = me && me.alive && me.flying > 0 ? 'Steer the plane' : `${settings.sens}% sensitivity`;
  if (text === padText) return;
  padText = text;
  $('padTag').textContent = text;
}

/** Push the control settings into the swipe pad, the screen layout, the menu and the pad's caption, and optionally save them. */
function applySettings(save: boolean): void {
  const right = settings.hand === 'right';
  input.pad.aims = standardAims(settings.hand, sensTilt(settings.sens));

  // which side the pad is on (page.html lays the controls out mirrored under body.righty)
  document.body.classList.toggle('righty', right);
  $('handLeft').setAttribute('aria-pressed', String(!right));
  $('handRight').setAttribute('aria-pressed', String(right));
  $('saveNote').hidden = canSave;
  refreshSens();

  // the caption on the swipe pad itself, visible while playing (it says otherwise while flying a plane: padCaption)
  padCaption();

  if (!save) return;
  try {
    localStorage.setItem('controls5', JSON.stringify({ hand: settings.hand, sens: settings.sens }));
  } catch {
    /* storage is optional */
  }
}

/**
 * Movement sensitivity: 0% to 25% (swipe.ts), the percentage over the slider's circle (the owner's ask,
 * 18 November 2026: more steps than Low, Medium and High, as a percentage).
 */
const sensOpts: Opt[] = [
  slider({
    label: 'Movement sensitivity',
    hint: () =>
      `How far a swipe can curve and still go the way you meant. 0% reads swipes dead straight; ${DEFAULT_SENS}% is the default. (Swipes are read leaning ${
        +sensTilt(settings.sens).toFixed(1)
      }° ${settings.hand === 'right' ? 'anticlockwise' : 'clockwise'}.)`,
    min: 0,
    max: SENS_MAX,
    normal: DEFAULT_SENS,
    get: () => settings.sens,
    set: (v) => {
      settings.sens = v;
      applySettings(true);
    },
    text: (v) => `${v}%`,
    onThumb: true,
  }),
  // (the owner's ask, 19 November 2026: the plane's steering inverted, and a setting for it)
  toggle({
    label: 'Inverse plane controls',
    hint: () =>
      prefs.planeInverse
        ? 'Steer the laptop’s plane like a pilot: left and right turn it to its own left and right, whichever way it is flying'
        : 'The laptop’s plane flies the way you point',
    get: () => prefs.planeInverse,
    set: (v) => {
      prefs.planeInverse = v;
      prefsChanged();
    },
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
  hideBellTip();
  chat.close();
  quick.close();
  lobby.hide();
  $('settings').hidden = true;
  $('pause').hidden = true;
  result.hidden = true;
  $('onlineSheet').hidden = true;
  $('keySheet').hidden = true;
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
  start: () => (net ? net.send({ t: 'start' }) : newMatch(false)),
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
function showLobby(fresh = false, page?: LobbyPage): void {
  if (siteZoomed() && !zoomTold) {
    zoomTold = true; // (once a visit)
    setTimeout(() => sayNet(ZOOM_TIP, 9000), 400);
  }
  rolled = null; // (the match is over: the lobby's CPU players are the ones on their cards)
  // Random mode: new rules for the next match, shown on the Match page before it starts (online the server picks)
  if (fresh && !net && setup.randomRules) {
    setup = rollRules(setup, Math.random);
    save('matchSetup', setup);
  }
  hideScreens();
  mode = 'lobby';
  roundLive = false;
  document.body.classList.add('menu-open');
  lobby.show(page, fresh);
}
/**
 * Match settings (the result panel) and Leave to match settings (the menu): the match ends and the lobby opens
 * on its Match page, the map and the rules (the owner's ask, 19 November 2026). Online it is the host's, and the
 * room goes back to the lobby as with Leave to the lobby; the host's page then opens on Match (`toMatchPage`).
 */
let toMatchPage = false;
function leaveToMatch(): void {
  if (net) {
    toMatchPage = true;
    net.send({ t: 'lobby' });
  } else showLobby(true, 'match');
}

// ------------------------------------------------ rounds and the match

/**
 * Start a match with the lobby's setup: everyone's score back to 0, then round 1. `again` for a new match
 * started from the round (Rematch, Restart): in Random mode it gets new rules (from the lobby, the ones shown).
 */
function newMatch(again = true): void {
  if (again && setup.randomRules) {
    setup = rollRules(setup, Math.random);
    save('matchSetup', setup);
  }
  rolled = setup.randEmotes || setup.randLevels ? rollCpus(setup, Math.random) : null;
  wins.fill(0);
  leader = -1;
  roundNo = 0;
  matchWinner = -1;
  angelTipShown = false;
  laptopTipShown = false;
  trainTipShown = false;
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
  fitResult();
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
  keepHero(!!net); // (on this screen the round is paused: nothing changes while the menu is open)
  $('pause').hidden = false;
  $('pauseResume').focus({ preventScroll: true });
}
/** Resume: back into the round, or back to its result if it is over for you. */
function closePause(): void {
  closeKey();
  if (roundLive) resume();
  else watch();
}
function fillPause(): void {
  const done = matchWinner >= 0;
  const state = $('pauseState');
  // only while the round goes on: "Round over" and "Match over" are said by the top of the menu (fillHero), and
  // "You are out" by the standings beside your name (the owner's call)
  // (online the round never pauses, so there the ping takes this chip's place: fillHero)
  state.textContent = roundLive && !net ? 'Paused' : '';
  state.hidden = !state.textContent;
  // online: the room's code, the round goes on behind the menu, and only the host restarts or ends the match
  modeChip($('pauseMode'), net?.code ?? null);
  const hosting = !net || net.isHost;
  $('pauseHostLine').textContent = hosting ? 'Match · you are the host' : `Match · ${hostName()} is the host`;
  $('pauseRestart').hidden = !hosting;
  $('pauseLobby').hidden = !hosting;
  // (the same words online, where it ends the match for the whole room: the owner's ask, 19 November 2026; they
  // were End match and End match · match settings)
  $('pauseLobby').textContent = 'Leave to the lobby';
  $('pauseMatch').hidden = !hosting;
  $('pauseMatch').textContent = 'Leave to match settings';
  $('pauseLeave').hidden = !net;
  const title = $('pauseTitle');
  title.textContent = done ? `${sideName(matchWinner)} won the match` : world.over ? `Round ${roundNo} · over` : `Round ${roundNo}`;
  title.classList.toggle('won', done);
  fillHero();
  $('pauseResume').textContent = 'Resume'; // (the owner's word, whether the round is going on or over)
  const list = $('standings');
  list.classList.toggle('many', world.players.length > 4); // (two columns, so the menu still fits)
  list.textContent = '';
  const dpr = density();
  world.players.forEach((p, i) => {
    const li = document.createElement('li');
    const cv = document.createElement('canvas');
    cv.width = cv.height = Math.round(34 * dpr);
    const col = colorById(p.colorId);
    drawHead(cv.getContext('2d')!, cv.width / 2, cv.height / 2, cv.width * 0.42, col, { xEyes: !p.alive, crown: false });
    if (crowned(i)) drawHead(cv.getContext('2d')!, cv.width / 2, cv.height / 2, cv.width * 0.42, col, { crownOnly: true });
    if (p.team >= 0) {
      // a teams match: its side's colour along the edge of its line
      li.classList.add('team');
      li.style.setProperty('--team', TEAMS[p.team].color);
    }
    const who = document.createElement('div');
    const name = document.createElement('b');
    // (names typed by people: set as text, never as markup)
    name.textContent = i === myIdx() ? myName || 'You' : net && human(i) ? seats[i]?.name || botName(col) : botName(col);
    const sub = document.createElement('small');
    const cpuLevel = (): string => `P${i + 1} · CPU · ${LEVELS[(net ? seats[i]?.level : undefined) ?? matchCpus()[i - peopleCount()]?.level ?? 'normal'].label}`;
    sub.textContent = net
      ? human(i)
        ? `P${i + 1}${i === meIdx ? ' · you' : ''}${seats[i]?.member === net.host ? ' · host' : ''}${net.members.find((m) => m.id === seats[i]?.member)?.on === false ? ' · away' : ''}`
        : cpuLevel()
      : i === 0
        ? `P1 · you`
        : human(i)
          ? `P${i + 1} · controller ${guests[i - 1].pad + 1}`
          : cpuLevel();
    if (p.team >= 0) sub.textContent = `${TEAMS[p.team].short} · ${sub.textContent}`;
    who.append(name, sub);
    const st = document.createElement('span');
    const won = world.over && world.over.winner >= 0 && onSide(i, world.over.winner);
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
/** A span for the menu's top, its text set as text. */
function bit(text: string, cls = ''): HTMLSpanElement {
  return Object.assign(document.createElement('span'), { textContent: text, className: cls });
}
/**
 * The top of the menu during a match, under its chips: the round, small, and your own kit, each power-up drawn as
 * in the arena (the owner's design, 18 November 2026; a big round box with the rules under the name, a clock for
 * the falling blocks and a bar for the round were tried that day and turned down). Online: the ping, in its chip
 * beside the room's code (or at the end of the round's line on the narrowest phones). Online the round goes on
 * behind the menu, so this is filled again a few times a second (`keepHero`); the standings only when something
 * happens.
 */
function fillHero(): void {
  const done = matchWinner >= 0;
  // online: the round trip to the server, so a slow connection can be told from a fault: signal bars lit by how
  // good it is, and the milliseconds; until the first one, a dash. (On a narrow phone a copy at the end of the
  // round's line is shown in its place: page.html.)
  const slot = $('pauseGoal');
  slot.replaceChildren();
  const ping = $('pauseNet');
  ping.hidden = !net;
  if (net) {
    const rtt = net.rtt;
    ping.className = `ping-chip${rtt ? (rtt < 80 ? ' good' : rtt < 160 ? ' fair' : ' poor') : ''}`;
    $('pausePing').textContent = rtt ? `${rtt} ms` : '– ms';
    ping.setAttribute('aria-label', rtt ? `Ping ${rtt} milliseconds, ${rtt < 80 ? 'good' : rtt < 160 ? 'fair' : 'slow'}` : 'Ping not measured yet');
    const copy = ping.cloneNode(true) as HTMLElement;
    copy.removeAttribute('id');
    copy.removeAttribute('role');
    copy.querySelector('#pausePing')?.removeAttribute('id');
    copy.setAttribute('aria-hidden', 'true');
    slot.append(copy);
  }
  // your kit, while you are in the round (not out, an angel or a zombie)
  const kit = $('pauseKit');
  const me = world.players[myIdx()];
  const inIt = !!me && !done && !world.over && !me.angel && !me.zombie && (me.alive || me.respawnAt >= 0);
  kit.hidden = !inIt;
  if (!inIt) return;
  const dpr = density();
  const item = (kind: ItemKind, text: string, label: string, bad = false): HTMLElement => {
    const el = bit('', `item${bad ? ' bad' : ''}${text ? '' : ' only'}`);
    const cv = document.createElement('canvas');
    cv.width = cv.height = Math.round(18 * dpr); // (drawn at the size it shows, so it stays sharp)
    drawItemTile(cv.getContext('2d')!, kind, 0, 0, cv.width);
    el.append(cv, document.createTextNode(text));
    el.setAttribute('aria-label', label);
    el.title = label;
    return el;
  };
  const list: HTMLElement[] = [
    bit('Your kit', 'kit-label'),
    item('bomb', String(me.bombsMax), `${me.bombsMax} ${me.bombsMax === 1 ? 'bomb' : 'bombs'} at a time`),
    item('fire', String(me.fire), `Blasts ${me.fire} ${me.fire === 1 ? 'tile' : 'tiles'} long`),
    item('speed', me.speed ? `+${me.speed}` : '0', me.speed ? `${me.speed} speed ${me.speed === 1 ? 'power-up' : 'power-ups'}` : 'Starting speed'),
  ];
  if (me.canKick) list.push(item('kick', '', 'Boot: kick bombs'));
  if (me.canGrab) list.push(item('grab', '', 'Glove: lift and throw bombs'));
  if (me.laptop) {
    const left = me.planeBombs;
    list.push(me.flying ? item('laptop', String(left), `Flying the plane: ${left} ${left === 1 ? 'bomb' : 'bombs'} left`) : item('laptop', '', 'Laptop: B flies a plane'));
  }
  if (me.shieldTicks > 0) list.push(item('shield', `${Math.ceil(me.shieldTicks / TICK_HZ)}s`, 'Shield: seconds left'));
  if (me.curseTicks > 0) list.push(item('curse', `${Math.ceil(me.curseTicks / TICK_HZ)}s`, 'Cursed: seconds left', true));
  if (list.length > 6) list.shift(); // (a full kit: the label gives up its room, so the kit stays on one line)
  kit.replaceChildren(...list);
}
/** Online the round goes on behind the menu: its top is kept up to date while it is open. */
let heroTimer = 0;
function keepHero(on: boolean): void {
  clearInterval(heroTimer);
  if (on) heroTimer = window.setInterval(() => (mode === 'pause' ? fillHero() : keepHero(false)), 250);
}
/**
 * Quick chat (the owner's ask, 24 November 2026): a line picked or typed shows over your robot. Online it goes
 * to the server, which says it to everyone in the room, this page included (`heard`).
 */
const chat = createChat($('chatBtn'), $('chatPanel'), (text) => {
  if (net) net.send({ t: 'chat', text });
  else bubbles.say(myIdx(), text);
});
/**
 * The quick menu (the owner's ask, 24 November 2026): the menu button held down opens a few settings over the
 * round without stopping it: sound on or off, the volume, and movement sensitivity. A tap still opens the menu.
 */
const quick = createQuickMenu(
  $('menuBtn'),
  quickMenu,
  [
    toggle({
      label: 'Sound effects',
      get: () => prefs.soundOn,
      set: (v) => {
        prefs.soundOn = v;
        prefsChanged();
      },
      offText: 'All sounds are off.',
      under: [
        slider({
          label: 'Volume',
          min: 0,
          max: 100,
          step: 10,
          normal: defaultPrefs().volume,
          get: () => prefs.volume,
          set: (v) => {
            prefs.volume = v;
            prefsChanged();
            initAudio();
            preview('pickup');
          },
          text: (v) => `${v}%`,
        }),
      ],
    }),
    slider({
      label: 'Movement sensitivity',
      min: 0,
      max: SENS_MAX,
      normal: DEFAULT_SENS,
      get: () => settings.sens,
      set: (v) => {
        settings.sens = v;
        applySettings(true);
        refreshPrefs();
      },
      text: (v) => `${v}%`,
      onThumb: true,
    }),
  ],
  openPause,
  () => mode === 'playing' || mode === 'over',
);
// a tap in the blank space round the menu closes it, like Resume (the owner's ask, 18 November 2026)
$('pause').addEventListener('click', (e) => {
  if (e.target === e.currentTarget && mode === 'pause') closePause();
});
$('pauseResume').addEventListener('click', closePause);
$('pauseSettings').addEventListener('click', () => showSettings(undefined, 'pause'));

/**
 * The key (the owner's ask, November 2026): from the menu during a match, a list of every power-up as it
 * looks in the arena, with what it does, then the marks you see on the robots and the floor. Drawn with the
 * game's own drawing, so it always matches the arena.
 */
function showKey(): void {
  const list = $('keyList');
  list.textContent = '';
  const dpr = Math.min(density(), 4);
  const px = Math.round(32 * dpr);
  const row = (name: string, what: string, draw: (g: CanvasRenderingContext2D, s: number) => void): void => {
    const li = document.createElement('li');
    const cv = document.createElement('canvas');
    cv.width = cv.height = px;
    draw(cv.getContext('2d')!, px);
    const text = document.createElement('div');
    const b = document.createElement('b');
    b.textContent = name;
    const small = document.createElement('small');
    small.textContent = what;
    text.append(b, small);
    li.append(cv, text);
    list.append(li);
  };
  const head = (t: string): void => {
    const li = document.createElement('li');
    li.className = 'key-sec';
    li.textContent = t;
    list.append(li);
  };
  head('Power-ups');
  for (const [kind, name, what] of ITEM_NAMES) row(name, what, (g, s) => drawItemTile(g, kind, s * 0.08, s * 0.08, s * 0.84));
  head('In the arena');
  row('Falling block', 'After the timer: a block lands on the marked tile. Move off!', (g, s) => {
    g.fillStyle = '#0e1220';
    g.fillRect(0, 0, s, s);
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(s * 0.15, s * 0.15, s * 0.7, s * 0.7);
    g.strokeStyle = 'rgba(255,90,110,0.85)';
    g.lineWidth = Math.max(1, s * 0.06);
    g.strokeRect(s * 0.06, s * 0.06, s * 0.88, s * 0.88);
  });
  if (world.rails.length) {
    // the Wild West's railway and TNT
    row('Train coming', 'Red lights flash and a bell rings: a train is coming down that line. Get off it!', drawSignalIcon);
    row('TNT', 'A blast sets it off: its fire runs every way to the walls. Bricks stop it and are not broken.', (g, s) => {
      g.fillStyle = '#93714a';
      g.fillRect(0, 0, s, s);
      drawBarrel(g, 0, 0, s);
    });
  }
  row('Crown', 'The player in the lead', (g, s) => {
    const col = colorById(world.players[myIdx()]?.colorId ?? 'gold');
    drawHead(g, s / 2, s * 0.58, s * 0.36, col, { xEyes: false, crown: true });
  });
  $('keySheet').hidden = false;
  ($('keyDone') as HTMLButtonElement).focus({ preventScroll: true });
}
function closeKey(): void {
  $('keySheet').hidden = true;
}
$('pauseKey').addEventListener('click', showKey);
// mute, from the menu during a match: the same as Settings › Sound › Sound effects, in one tap
$('pauseMute').addEventListener('click', () => {
  prefs.soundOn = !prefs.soundOn;
  if (prefs.soundOn) initAudio();
  prefsChanged();
});
$('keyDone').addEventListener('click', closeKey);
$('keySheet').addEventListener('click', (e) => {
  if (e.target === $('keySheet')) closeKey(); // a tap outside the panel
});
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
    ? confirmFirst('Leave to the lobby?', 'This match ends for everyone in the room, and its score is not kept. Everyone goes back to the lobby, where you can change the players and the rules.', 'End match', (yes) => {
        if (yes) net?.send({ t: 'lobby' });
      })
    : confirmFirst('Leave to the lobby?', 'This match ends and its score is not kept. In the lobby you can change the players and the rules.', 'Leave match', (yes) => {
        if (yes) showLobby(true);
      }),
);
$('pauseMatch').addEventListener('click', () =>
  net
    ? confirmFirst('Leave to match settings?', 'This match ends for everyone in the room, and its score is not kept. You go to the Match page, to change the map and the rules; the others go back to the lobby.', 'End match', (yes) => {
        if (yes) leaveToMatch();
      })
    : confirmFirst('Leave to match settings?', 'This match ends and its score is not kept. On the Match page you can change the map and the rules.', 'Leave match', (yes) => {
        if (yes) leaveToMatch();
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
 * has won it the match: a new match has then been started (no panel for it: the owner's ask).
 */
function settleUnfinished(): boolean {
  if (counted || world.over) return true;
  const still = world.players.filter((p) => p.id > 0 && p.alive && !p.zombie);
  if (!still.length) return true; // everyone is out: a draw, no point
  const w = still[Math.floor(Math.random() * still.length)].id;
  counted = true;
  addPoint(w); // (in a teams match, its whole side)
  if (matchWinner < 0) return true;
  // That point won the match. No panel and no note (the owner's ask): a new match starts at once, as Rematch
  // would.
  newMatch();
  return false;
}
// the result panel: Next round, Match settings and Lobby while the match goes on (the last two ask first: the
// match would end); Rematch, Match settings and Lobby once it is won
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
  else
    confirmFirst('Leave to the lobby?', 'This match ends and its score is not kept. In the lobby you can change the players and the rules.', 'Leave match', (yes) => {
      if (yes) showLobby(true);
    }, $('resultCard')); // (where the result panel is: the owner's ask)
});
$('toMatch').addEventListener('click', () => {
  if (net || matchWinner >= 0) leaveToMatch(); // (online only the host has it, once the match is won)
  else
    confirmFirst('Leave to match settings?', 'This match ends and its score is not kept. On the Match page you can change the map and the rules.', 'Leave match', (yes) => {
      if (yes) leaveToMatch();
    }, $('resultCard'));
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
/**
 * Safari on an iPhone is zooming this website (its aA menu, set per website). An iPhone's screen is always a
 * whole 2× or 3×; zoomed, the page reports a fraction (3.45× at 115%), and no arena size then lands on whole
 * screen pixels: the browser stretches it by a hair and smooths it all, so it looks soft. The same game
 * opened elsewhere (the file in the Claude app, the home-screen app) is not zoomed and looks sharp: what the
 * owner saw in November 2026. Nothing the page does can undo a browser's zoom, so it says how to.
 */
function siteZoomed(): boolean {
  return isApple() && !Number.isInteger(window.devicePixelRatio || 1);
}
const ZOOM_TIP = 'Safari is zooming this site, which softens the arena: tap aA in the address bar and set it to 100%.';
let zoomTold = false;

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
      bell: bellAnswer,
      chat: heard,
    },
    serverHost(),
  );
  net.start(code, { name: myName, colorId: myColor, dance: myDance });
}

/** Leave the online room (saying goodbye unless the server has already closed it), back to the title. */
function leaveOnline(bye = true): void {
  if (net && bye) net.leave();
  net = null;
  hideBellTip();
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

/** The people in the room, as the server last said (quick chat lines from someone not in the round name them). */
let roomPeople: { id: number; name: string; colorId: string }[] = [];
/** Someone in the room said something (quick chat): over their robot in the round, otherwise a line at the top. */
function heard(id: number, text: string): void {
  const at = netRound ? seats.findIndex((x) => x.member === id) : -1;
  if (at >= 0 && world.players[at]) {
    bubbles.say(at, text);
    return;
  }
  const who = roomPeople.find((x) => x.id === id);
  if (who) sayNet(`${who.name || botName(colorById(who.colorId))}: ${text}`, 3500);
}

/** The room changed (online.ts): who is in it, the host, the setup, and whether a match is on. */
function onRoom(m: Extract<ServerMsg, { t: 'room' }>): void {
  if (!net) return;
  roomPeople = m.members.map((x) => ({ id: x.id, name: x.name, colorId: x.colorId }));
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
    // the host ended the match: everyone back to the lobby, to press Ready again (the host on the Match page if
    // it asked for match settings)
    netRound = false;
    showLobby(true, toMatchPage ? 'match' : undefined);
    toMatchPage = false;
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
  if (fresh) bubbles.clear();
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
  if (fresh && roundNo <= 1) angelTipShown = laptopTipShown = trainTipShown = false; // a new match
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
/** Online: a green globe, at the start of the room's pill (the owner's ask: a symbol, not the word). */
const ONLINE_GLYPH =
  '<span class="net-badge"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg></span>';
/**
 * The chip at the top saying Local match, or, online, the room's code in a gold pill that starts with a green
 * globe (the owner's design, 18 November 2026: it said Online in words, which did not fit beside the buttons).
 * The pill copies the code (the owner's ask): a tap turns it green with a tick for a moment (if copying fails, a
 * note shows the code). The lobby, Settings and the menu during a match each have one.
 */
function modeChip(chip: HTMLElement, code: string | null): void {
  if (chip.dataset.code === (code ?? '')) return;
  chip.dataset.code = code ?? '';
  chip.classList.toggle('online', !!code);
  if (!code) {
    chip.textContent = 'Local match';
    return;
  }
  chip.textContent = '';
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'code-copy';
  b.setAttribute('aria-label', `Online, room code ${code.split('').join(' ')}. Copy it`);
  b.insertAdjacentHTML('beforeend', ONLINE_GLYPH);
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

// Tell friends: a notification to everyone who turned them on (Settings › App), that this room is open. The bell
// swings when tapped, and says how it went in a bubble under it (the owner found it seemed to do nothing,
// 18 November 2026: its answer was a line at the very top of the screen, and with nobody else signed up for
// invites there is never anything to send; the bell does not ring the phone it is tapped on)
let bellTimer = 0;
let bellWait = 0;
/** Say something under the bell, for `ms` (0: until the next thing is said). A tap anywhere closes it. */
function bellSay(head: string, body = '', good = false, ms = 6000): void {
  const bell = $('roomTell');
  if (bell.hidden || mode !== 'lobby') {
    // (the lobby was left meanwhile: the line at the top instead)
    if (ms) sayNet(body ? `${head}. ${body}` : head, ms);
    return;
  }
  const tip = $('bellTip');
  $('bellTipHead').textContent = head;
  $('bellTipBody').textContent = body;
  tip.classList.toggle('good', good);
  tip.hidden = false;
  // under the bell, its right edge with the bell's, but never off either side of the screen (on a phone 390
  // wide the bell is near the middle, and a bubble ending at its edge ran off the left)
  const r = bell.getBoundingClientRect();
  const w = tip.offsetWidth;
  const right = Math.round(Math.min(Math.max(8, innerWidth - r.right), innerWidth - w - 8));
  tip.style.top = `${Math.round(r.bottom + 9)}px`;
  tip.style.right = `${right}px`;
  // the little point at its top, under the middle of the bell
  tip.style.setProperty('--arrow', `${Math.round(Math.min(Math.max(10, innerWidth - right - (r.left + r.width / 2) - 5), w - 22))}px`);
  clearTimeout(bellTimer);
  if (ms) bellTimer = window.setTimeout(hideBellTip, ms);
}
function hideBellTip(): void {
  clearTimeout(bellTimer);
  clearTimeout(bellWait);
  $('bellTip').hidden = true;
}
addEventListener(
  'pointerdown',
  (e) => {
    if (!$('bellTip').hidden && !$('roomTell').contains(e.target as Node)) hideBellTip();
  },
  true,
);
addEventListener('resize', hideBellTip);
/** The server's answer to the bell (worker.ts, `Friends`), in plain words under it. */
function bellAnswer(answer: BellAnswer, why: string, n: number): void {
  clearTimeout(bellWait);
  // (if some phones could not be reached, the server's line says why: shown in place of the usual one)
  if (answer === 'sent') bellSay(`Rang ${n} friend${n === 1 ? '' : 's'}!`, why.includes('(') ? why : `They’ve been told that room ${net?.code ?? ''} is open.`, true);
  else if (answer === 'none')
    bellSay('Nobody to ring yet', 'The bell rings friends who switched on Room invites in Settings › App. It never rings your own phone.', false, 9000);
  else if (answer === 'wait') bellSay('Friends were just rung', 'A room can ring once every 10 seconds.');
  else if (answer === 'busy') bellSay('Lots of rings this hour', 'Try again a little later.');
  else bellSay('Couldn’t ring anyone', why);
}
$('roomTell').addEventListener('click', async () => {
  if (!net || !net.isHost) return;
  const bell = $('roomTell');
  bell.classList.remove('ringing');
  void bell.offsetWidth; // (so the swing starts again on every tap)
  bell.classList.add('ringing');
  bellSay('Ringing friends…', '', false, 0);
  const me = await myEndpoint(); // (never waits more than a moment)
  if (!net) return; // (the room was left meanwhile)
  net.send({ t: 'invite', me });
  clearTimeout(bellWait);
  bellWait = window.setTimeout(() => bellSay('No answer from the server', 'Check your connection and try again.'), 8000);
});
$('roomTell').addEventListener('animationend', () => $('roomTell').classList.remove('ringing'));

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
const SET_TABS: SetTab[] = ['controls', 'sound', 'graphics', 'gamepad', 'app']; // the owner's order (Gamepad after Graphics, his ask of 18 November 2026); App last
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
  modeChip($('setMode'), net?.code ?? null); // (online it said Local match here until 18 November 2026)
  mode = 'settings';
  document.body.classList.add('menu-open');
  $('settings').hidden = false;
  showSetTab(setTab);
  $('setDone').focus({ preventScroll: true });
}
function showSetTab(t: SetTab): void {
  setTab = t;
  if (t !== 'gamepad') remap?.cancel(); // (keys and buttons are both changed on Gamepad)
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
$('setClose').addEventListener('click', closeSettings);

/** Your settings changed: save them, put them into effect, and redraw the pages that show them. */
function prefsChanged(): void {
  save('prefs', prefs);
  applyPrefs();
  refreshPrefs();
}
/** Put your settings into effect. (Sharpness is picked up by keepSharp on the next frame.) */
function applyPrefs(): void {
  setSound(prefs.soundOn, prefs.volume, prefs.muted);
  const mute = $('pauseMute');
  mute.setAttribute('aria-pressed', String(!prefs.soundOn));
  mute.setAttribute('aria-label', prefs.soundOn ? 'Mute all sound' : 'Sound is off: switch it back on');
  input.setBindings(prefs.keys, prefs.padKeys);
  document.body.classList.toggle('calm', prefs.calm);
  setOrangeFire(prefs.orangeFire);
  document.documentElement.style.setProperty('--pad-show', String(prefs.padShow / 100));
}

/** A sound's row: a switch for whether it plays, and a button that plays it. */
// icons for the Settings groups' labels
const SPEAKER_ICON = '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>';
const STEER_ICON = '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.5"/><path d="M12 3.5v6M12 14.5v6M3.5 12h6M14.5 12h6"/>';
const EYE_ICON = '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>';

/** The icon on each group of sound switches (SOUND_GROUPS in setup.ts). */
const SOUND_ICONS: Record<string, string> = {
  Bombs: BOMB_ICON,
  'Power-ups': '<path d="M12 3.2l2.5 5.4 5.9.6-4.4 4 1.3 5.8L12 16.1 6.7 19l1.3-5.8-4.4-4 5.9-.6z"/>',
  'Falling blocks': '<rect x="5.5" y="13" width="13" height="8" rx="1.5"/><path d="M12 2.5v7M8.8 6.5 12 9.7l3.2-3.2"/>',
  'Knockouts and wins': '<path d="M5.5 21V3.5M5.5 4.5h11l-2.2 4 2.2 4h-11"/>',
};

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
  group('Volume', SPEAKER_ICON, [
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
          normal: defaultPrefs().volume,
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
  ], {
    isDefault: () => prefs.soundOn === defaultPrefs().soundOn && prefs.volume === defaultPrefs().volume,
    reset: () => {
      prefs.soundOn = defaultPrefs().soundOn;
      prefs.volume = defaultPrefs().volume;
      prefsChanged();
    },
  }),
  heading('Which sounds play', 'Tap ▶ to hear one'),
  // in groups, each under a small label (the owner's ask, 18 November 2026: easier to look at)
  ...SOUND_GROUPS.map(([label, ids]) =>
    group(
      label,
      SOUND_ICONS[label],
      ids.map((id) => soundRow(id, SOUND_NAMES.find(([s]) => s === id)![1])),
      {
        // every sound in the group back on (the default)
        isDefault: () => !ids.some((id) => prefs.muted.includes(id)),
        reset: () => {
          prefs.muted = prefs.muted.filter((m) => !ids.includes(m));
          prefsChanged();
        },
      },
    ),
  ),
  note('There is no music yet. It will come with the new sound effects, with a switch of its own.'),
];
const padOpts: Opt[] = [
  slider({
    label: 'Touch controls',
    hint: 'How strongly the swipe pad and the A and B buttons show over the game',
    min: 40,
    max: 200,
    step: 20,
    normal: defaultPrefs().padShow,
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
      const screen = Math.round(screenDensity() * 100) / 100;
      const drawn = Math.round(density() * 100) / 100;
      // and the last time the arena was found soft, with why (for a screenshot, if it ever looks soft)
      const ago = softSeen ? Math.round((Date.now() - softSeen.at) / 1000) : 0;
      const last = softSeen ? ` Last soft: ${ago < 60 ? `${ago} s` : `${Math.round(ago / 60)} min`} ago, ${softSeen.text}.` : '';
      const now = ` This screen: ${screen}×, drawn at ${drawn}×. Arena: ${sharp.text}.${last}${siteZoomed() ? ` ${ZOOM_TIP}` : ''}`;
      const what = [
        'Draws the game with fewer pixels, which uses less battery on big, sharp screens. It looks a little softer.',
        'Draws the game with fewer pixels, which uses less battery on big, sharp screens. It looks a little softer.',
        'One pixel drawn for each of the screen’s: crisp edges. The usual setting.',
        'Drawn with twice the screen’s pixels each way and shrunk to fit, like a desktop site on a phone: smoother edges and movement, but more work for the phone.',
      ][prefs.sharpness];
      return `${what}${now}`;
    },
    min: 0,
    max: SHARPNESS.length - 1,
    normal: defaultPrefs().sharpness,
    get: () => prefs.sharpness,
    set: (v) => {
      prefs.sharpness = v;
      prefsChanged();
    },
    text: (v) => SHARPNESS[v].name,
  }),
  toggle({
    label: 'Orange fire',
    hint: 'Every blast burns ordinary orange fire, in place of the colour of the robot whose bomb it was',
    get: () => prefs.orangeFire,
    set: (v) => {
      prefs.orangeFire = v;
      prefsChanged();
    },
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
/**
 * Settings › Controls in groups, each with a Reset chip while it differs from its defaults (the owner's ask,
 * 18 November 2026, as on the Match page): Steering (the thumb and movement sensitivity) and Visibility (how
 * strongly the touch controls show). Keys and buttons are on Gamepad, with Resets of their own.
 */
const controlOpts: Opt[] = [
  group('Steering', STEER_ICON, [{ el: $('steerSet'), refresh() {} }, ...sensOpts], {
    isDefault: () => settings.hand === 'left' && settings.sens === DEFAULT_SENS && prefs.planeInverse === defaultPrefs().planeInverse,
    reset: () => {
      settings.hand = 'left';
      settings.sens = DEFAULT_SENS;
      applySettings(true);
      prefs.planeInverse = defaultPrefs().planeInverse;
      prefsChanged();
    },
  }),
  group('Visibility', EYE_ICON, padOpts, {
    isDefault: () => prefs.padShow === defaultPrefs().padShow,
    reset: () => {
      prefs.padShow = defaultPrefs().padShow;
      prefsChanged();
    },
  }),
];
const refreshPad = mount($('controlOpts'), controlOpts);
refreshSens = refreshPad;

// Reset all, at the foot of Controls and of Sound (the owner's ask, as on the Match page): asks first
$('controlsReset').addEventListener('click', () =>
  confirmFirst('Reset all control settings?', 'The steering thumb, movement sensitivity, plane controls and touch controls go back to their defaults. Keys and buttons are on Gamepad and stay as they are.', 'Reset all', (yes) => {
    if (!yes) return;
    settings.hand = 'left';
    settings.sens = DEFAULT_SENS;
    applySettings(true);
    prefs.planeInverse = defaultPrefs().planeInverse;
    prefs.padShow = defaultPrefs().padShow;
    prefsChanged();
  }),
);
$('soundReset').addEventListener('click', () =>
  confirmFirst('Reset all sound settings?', 'Sound effects go back on at the usual volume, and every sound is switched on again.', 'Reset all', (yes) => {
    if (!yes) return;
    const d = defaultPrefs();
    prefs.soundOn = d.soundOn;
    prefs.volume = d.volume;
    prefs.muted = [];
    prefsChanged();
  }),
);
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
const refreshOpts = mount($('notifyOpts'), notifyOpts);
function refreshNotify(): void {
  refreshOpts();
  $('notifyTest').hidden = pushNow !== 'on';
}
$('notifyTest').addEventListener('click', async () => {
  const b = $('notifyTest') as HTMLButtonElement;
  if (b.disabled) return;
  b.disabled = true;
  $('notifyNote').textContent = 'Sending…';
  const r = await pushTest();
  $('notifyNote').textContent = r.why;
  b.disabled = false;
});
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
    if (st === 'on') void pushRefresh(); // (on the server's list with this phone's current sign-up)
  });
}
$('appInstall').addEventListener('click', () => void install());

function refreshPrefs(): void {
  remap?.refresh();
  quick?.refresh(); // (the quick menu shows some of the same settings)
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
  else if (chat.isOpen()) chat.close();
  else if (quick.isOpen()) quick.close();
  else if (mode === 'title' && !$('onlineSheet').hidden) closeOnlineSheet();
  else if (!$('keySheet').hidden) closeKey();
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
  if (mode === 'lobby' && !net && (button === PAD.A || button === PAD.MENU) && !confirmOpen()) return lobby.join(index) ? 'join' : 'ignore';
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
    if (mode === 'lobby') lobby.turn(d);
    else if (mode === 'settings') stepSettings(d);
  }
});
input.onFirstGesture = initAudio;

// ------------------------------------------------ a controller in the menus, and button hints

/** What the controller's highlight moves round: whatever is on top. */
function padTop(): HTMLElement | null {
  if (confirmOpen()) return $('confirm');
  if (mode === 'title' && !$('onlineSheet').hidden) return $('onlineSheet');
  if (!$('keySheet').hidden) return $('keySheet');
  const screens: Partial<Record<typeof mode, string>> = { title: 'title', lobby: 'lobby', settings: 'settings', pause: 'pause', over: 'result' };
  const id = screens[mode];
  return id ? $(id) : null;
}
const padNav = createPadNav(input, {
  top: padTop,
  back: goBack,
  turn: (d) => {
    if (confirmOpen()) return;
    if (mode === 'lobby') lobby.turn(d);
    else if (mode === 'settings') stepSettings(d);
  },
  ready: () => {
    if (mode === 'lobby' && !confirmOpen()) $('colOk').click();
  },
  menu: () => {
    if (confirmOpen()) return;
    if (mode === 'title') leaveTitle();
    else if (mode === 'lobby') $('arenaStart').click();
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
// The game going out of view and coming back (another app, a call, the screen locking). A round on this
// screen stops while it is away, so it is left with the menu open: coming back, you choose when it goes on
// (it used to start again the instant the game was back in view). Online the round cannot wait. Coming back,
// sound is woken (a phone switches it off in the background), and the screen is looked at afresh.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (mode === 'playing' && !net) openPause();
  } else {
    wakeAudio();
    last = performance.now();
    sharpTries = 0;
    sharpAt = 0;
    net?.wake(); // online: make sure the room's connection is alive, or make it again at once
  }
});
for (const ev of ['pointerdown', 'touchend', 'keydown']) document.addEventListener(ev, wakeAudio, { capture: true, passive: true });
window.visualViewport?.addEventListener('resize', () => (sharpAt = 0)); // (a zoom or a keyboard: check the arena on the next frame)
window.visualViewport?.addEventListener('scroll', () => (sharpAt = 0)); // (the page shifted: put it back on the next frame)
window.addEventListener('pageshow', () => {
  unshift();
  sharpAt = 0;
  net?.wake();
});
// the keyboard closing (a name, a room code) can leave the page shifted up: put it back once it has gone
document.addEventListener('focusout', () => setTimeout(() => {
  unshift();
  sharpAt = 0;
}, 350));
// The font arriving changes the size of text round the arena (it is the website's, fetched as the page
// opens, and shown in a stand-in font until then): everything is laid out again once it is in, and checked.
document.fonts?.ready.then(() => {
  unshift();
  layout();
  sharpAt = 0;
});
window.addEventListener('orientationchange', () => setTimeout(layout, 200));

unshift();
newWorld();
layout();
// The canvases are sized for the screen now: they may be shown (page.html, html.booting). Shown before, at a
// canvas's default 300 x 150, an iPhone (WebKit) gives each one a layer a third as sharp and keeps it so.
document.documentElement.classList.remove('booting');
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
  // each time the game opens with invites on, this phone's current sign-up goes to the server again (pushRefresh)
  if ('Notification' in window && Notification.permission === 'granted') setTimeout(() => void pushRefresh(), 3000);
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
  /** fill the menu during a match again, after a test has changed the world under it */
  fillPause,
  get mode() {
    return mode;
  },
  /** what the sharpness check last found (checkSharp), for tests */
  get sharp() {
    return { ...sharp, tries: sharpTries, zoom: pageZoom, density: density() };
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
