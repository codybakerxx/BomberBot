/**
 * The app shell: everything that ties the game to the page.
 *
 * - keeps the current match (a World from sim.ts) and steps it 60 times a second
 * - reads the player's input (input.ts) and plays sounds for what happened (audio.ts)
 * - sizes and places the arena, the touch controls and the panels for the screen
 * - runs the title screen, the menu, the result panel, the D-pad settings and the Match my thumb screen
 * - remembers the chosen bot and the D-pad settings on this device (localStorage)
 *
 * It holds no game rules. Those are all in sim.ts.
 */
import { createWorld, step, ticksLeft, World, PlayerInput, Dir, TICK_HZ, DEATH_TICKS } from './sim';
import { Bot, BotLevel, BOT_LEVELS, LEVELS, createBot, botInput } from './bot';
import { COLORS, NOBODY, ROBOT, colorById, drawRobot, drawHead, drawStatic, drawDynamic, drawGhosts, warmSprites } from './render';
import { Input } from './input';
import { drawTitle, closeTitle } from './title';
import { initAudio, sfx } from './audio';
import { Hand, STRAIGHT, standardAims, uniformAims } from './swipe';
import {
  TEACH_ORDER,
  TEST_ORDER,
  TestSwipe,
  ThumbSummary,
  judge,
  leanOf,
  perDirectionAims,
  pickBest,
  singleAims,
  summarise,
  tiltFor,
} from './teach';

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
const menu = $('menu');
const result = $('result');
const touch = $('touch');
const teach = $('teach');
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

// How good the CPU players are, remembered on this device under the key "cpuLevel".
let cpuLevel: BotLevel = 'normal';
try {
  // there used to be a fourth level, Extreme. Hard is now what Extreme was, so a saved Extreme becomes Hard.
  const stored = localStorage.getItem('cpuLevel');
  const saved = (stored === 'extreme' ? 'hard' : stored) as BotLevel | null;
  if (saved && BOT_LEVELS.includes(saved)) cpuLevel = saved;
} catch {
  /* storage is optional */
}
/** The three CPU players of the current arena (players 1 to 3). */
let bots: Bot[] = [];
/** Whose blast caught you this round: a player id, CRUSHED for a falling block, or -1 if you are still in. */
let blastedBy = -1;
const CRUSHED = -2;
/** true once this round's "blocks are falling" warning has sounded */
let hurried = false;
/** Rounds won by each of the four places on the scoreboard since the game was opened. Place 0 is you. */
const wins = [0, 0, 0, 0];
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

// Control settings, remembered on this device under the key "controls3".
// (Swipe length is not a setting: the quiet zone is always the standard size, `QUIET` in swipe.ts.)

/** A result of Match my thumb. */
interface ThumbMatch {
  /** one lean for all four directions, or a lean for each */
  kind: 'single' | 'per';
  /** the measured average lean, and per direction (index 1 to 4), for display */
  lean: number;
  by: number[];
  /** what the pad uses: the screen angle each direction is read around (index 1 to 4) */
  aims: number[];
}

/**
 * The swipe direction setting for one thumb.
 * `match` is the saved result of Match my thumb, or null if it has never been kept.
 * `useMatch` says whether the pad uses it ("My thumb") or the standard lean ("Standard").
 * Switching to Standard keeps the match, so it can be switched back on without redoing it.
 */
interface ThumbSetting {
  match: ThumbMatch | null;
  useMatch: boolean;
}

/**
 * `hand` is the thumb that steers: the swipe pad sits on that side, A and B on the other.
 * Each thumb has its own swipe direction setting, because the two lean opposite ways.
 */
const settings: { hand: Hand; left: ThumbSetting; right: ThumbSetting } = {
  hand: 'left',
  left: { match: null, useMatch: false },
  right: { match: null, useMatch: false },
};

/** The swipe direction setting of the thumb in use. */
function thumb(): ThumbSetting {
  return settings[settings.hand];
}

/** The match the pad is using right now, or null when it is on the standard lean. */
function activeMatch(): ThumbMatch | null {
  const t = thumb();
  return t.useMatch ? t.match : null;
}

/** False if this browser refuses to store anything, in which case settings last only until the game is closed. */
let canSave = true;
try {
  localStorage.setItem('bb-probe', '1');
  localStorage.removeItem('bb-probe');
} catch {
  canSave = false;
}

/** Aims that are safe to use: each within the limits tiltFor allows, for that thumb, of its straight direction. */
function validAims(a: unknown, hand: Hand): a is number[] {
  if (!Array.isArray(a) || a.length !== 5) return false;
  const [lo, hi] = hand === 'right' ? [-25.5, 20.5] : [-20.5, 25.5];
  for (let d = 1; d <= 4; d++) {
    const lean = (((STRAIGHT[d] - a[d] + 180) % 360) + 360) % 360 - 180;
    if (typeof a[d] !== 'number' || !Number.isFinite(a[d]) || lean < lo || lean > hi) return false;
  }
  return true;
}

/** Read one thumb's saved setting, ignoring anything that does not look right. */
function readThumb(saved: { match?: Partial<ThumbMatch> | null; use?: boolean } | null | undefined, hand: Hand): ThumbSetting {
  const sm = saved?.match;
  if (sm && (sm.kind === 'single' || sm.kind === 'per') && validAims(sm.aims, hand) && typeof sm.lean === 'number' && Array.isArray(sm.by)) {
    return { match: { kind: sm.kind, lean: sm.lean, by: sm.by, aims: sm.aims }, useMatch: saved?.use !== false };
  }
  return { match: null, useMatch: false };
}

try {
  const saved = JSON.parse(localStorage.getItem('controls3') ?? 'null');
  if (saved) {
    settings.hand = saved.hand === 'right' ? 'right' : 'left';
    settings.left = readThumb(saved.left, 'left');
    settings.right = readThumb(saved.right, 'right');
  } else {
    // Older versions kept one setting, for the left thumb, under "controls2".
    // (A `zone` in it, from when swipe length was a choice, is ignored.)
    const old = JSON.parse(localStorage.getItem('controls2') ?? 'null');
    settings.left = readThumb(old, 'left');
    if (!settings.left.match && old && typeof old.lean === 'number' && Math.abs(old.lean) <= 60) {
      // saved by version 1 of Match my thumb: one measured lean
      settings.left = {
        match: { kind: 'single', lean: old.lean, by: [0, old.lean, old.lean, old.lean, old.lean], aims: uniformAims(tiltFor(old.lean)) },
        useMatch: true,
      };
    }
  }
} catch {
  /* storage is optional */
}

let world: World;
let T = 32; // tile size in canvas pixels
/**
 * title: the title screen, shown when the game opens. menu: the menu is open (a round may be paused behind
 * it). playing: a round. over: result panel showing. teach: Match my thumb.
 */
let mode: 'title' | 'menu' | 'playing' | 'over' | 'teach' = 'title';
let overShown = false;
/** True from the start of a round until its result: the round the menu pauses and can go back to. */
let roundLive = false;

const input = new Input();
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

/** Start a fresh arena with a random seed. */
function newWorld(): void {
  // You, plus three CPU players in the other corners, all in different colours. This is the one place a
  // round's colours are set: yours is the colour chosen at this moment (`myColor`), and it stays yours until
  // the next round is made. The CPU players keep the colours they had; if you have chosen one of theirs
  // since, that one takes the colour you had.
  const had: string[] | null = world ? world.players.map((p) => p.colorId) : null;
  const others = had ? had.slice(1).map((id) => (id === myColor ? had[0] : id)) : COLORS.filter((c) => c.id !== myColor).slice(0, 3).map((c) => c.id);
  const seed = (Math.random() * 2 ** 31) | 0;
  world = createWorld({
    seed,
    players: [{ colorId: myColor }, ...others.map((id) => ({ colorId: id }))],
  });
  bots = others.map((_, i) => createBot(i + 1, cpuLevel, seed));
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
/** Where each of the four places on the scoreboard goes: the left edge and width of its cell, in screen pixels from the scoreboard's own left edge. */
let scoreCells: { x: number; w: number }[] = [];
/** How far down the scoreboard the middle of the heads is, in screen pixels. */
let scoreMid = 0;

/**
 * How many of the screen's pixels make one of the page's: what every canvas is drawn at. A phone at 3 can
 * report more when its page is zoomed (an app's text-size setting can do that), and the canvases must
 * follow it or they are stretched and blurry while the page's text stays sharp. It was capped at 3, which
 * did exactly that. The cap of 4 is only there to keep the sprites' memory in bounds.
 */
const MAX_DENSITY = 4;
function density(): number {
  return Math.min(window.devicePixelRatio || 1, MAX_DENSITY);
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
  if (sharper) drawPicker();
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
  T = Math.max(8, Math.floor(Math.min((W * dpr) / world.w, (availH * dpr) / (world.h + (stacked ? INFO_ROWS : 0)))));
  canvas.width = T * world.w;
  canvas.height = T * world.h;
  const cw = canvas.width / dpr;
  const ch = canvas.height / dpr;
  canvas.style.width = `${cw}px`;
  canvas.style.height = `${ch}px`;
  canvas.style.left = `${Math.round((W - cw) / 2)}px`;
  const infoRow = stacked ? Math.round((T / dpr) * INFO_ROWS) : 0;
  canvas.style.top = stacked ? `${topBar + infoRow}px` : `${Math.round((H - ch) / 2)}px`;
  // the ghost layer: over the arena and everything above it, on the same pixels as the arena
  ghostTop = Math.round((stacked ? topBar + infoRow : Math.round((H - ch) / 2)) * dpr);
  ghosts.width = canvas.width;
  ghosts.height = canvas.height + ghostTop;
  ghosts.style.left = canvas.style.left;
  ghosts.style.width = canvas.style.width;
  ghosts.style.height = `${ghosts.height / dpr}px`;
  ghostsShown = false;
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
  const box = stacked ? { left: 0, top: 0, width: W, height: topBar } : { left: 6, top: 40, width: Math.min(side - 12, 260), height: 44 };
  if (stacked) {
    const half = (timer.offsetWidth || 80) / 2 + 5;
    const btn = $('menuBtn').getBoundingClientRect();
    const edge = (btn.width ? Math.min(W - btn.left, 60) : 48) + 4;
    const cell = Math.max(24, (W / 2 - half - edge) / 2);
    scoreCells = [edge, edge + cell, W / 2 + half, W / 2 + half + cell].map((x) => ({ x, w: cell }));
    scoreMid = topBar / 2 + 3;
  } else {
    box.left = Math.round((side - box.width) / 2);
    const cell = box.width / 4;
    scoreCells = [0, 1, 2, 3].map((i) => ({ x: i * cell, w: cell }));
    scoreMid = box.height / 2 + 4;
  }
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
  resultCard.style.top = `${stacked ? Math.round(topBar + infoRow + ch + 14) : 92}px`;
  teach.style.left = canvas.style.left;
  teach.style.top = canvas.style.top;
  teach.style.width = canvas.style.width;
  teach.style.height = canvas.style.height;
  redrawStatic();
}

/** The floor and solid blocks never change during a match, so they are drawn once and reused. */
function redrawStatic(): void {
  if (!world) return;
  staticLayer.width = canvas.width;
  staticLayer.height = canvas.height;
  drawStatic(staticLayer.getContext('2d')!, world, T);
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
function drawScore(): void {
  const places = [0, 1, 2, 3].map((i) => world.players[i]);
  const winner = world.over ? world.over.winner : -1;
  const key = places.map((p, i) => (p ? `${p.colorId}${p.alive ? '' : 'x'}${wins[i]}` : '-')).join('|') + `|${winner}|${leader}|${score.width}x${score.height}`;
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
    let size = Math.round(HEAD_R * 1.35);
    sctx.font = `700 ${size}px "Chakra Petch", system-ui, sans-serif`;
    let numW = sctx.measureText(label || '0').width;
    const r = Math.max(6, Math.min(HEAD_R, (cell.w - gap - numW - 8) / 2)); // 8: breathing room between one place and the next
    if (r < HEAD_R) {
      size = Math.max(10, Math.round(r * 1.35));
      sctx.font = `700 ${size}px "Chakra Petch", system-ui, sans-serif`;
      numW = sctx.measureText(label || '0').width;
    }
    const cx = cell.x + (cell.w - (2 * r + gap + numW)) / 2 + r;
    const cy = scoreMid;
    const dim = !p ? 0.45 : p.alive ? 1 : 0.45;
    // the helmet has a rim in the player's colour, which is what shows it against the dark screen
    // (the first robot's helmet was all black, and needed a disc behind it and a ring round it here)
    sctx.globalAlpha = dim;
    drawHead(sctx, cx, cy, r, col, { xEyes: !!p && !p.alive });
    sctx.globalAlpha = 1;
    if (!p) return;
    // the crown goes on last, and is not dimmed
    if (i === leader) drawHead(sctx, cx, cy, r, col, { crownOnly: true });
    sctx.fillStyle = i === winner ? col.glow : p.alive ? '#eef1fb' : '#8a90a3';
    sctx.fillText(label, cx + r + gap, cy + 1);
    said.push(`${i === 0 ? 'You' : col.name} ${wins[i]}${i === leader ? ' (in the lead)' : ''}`);
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
  const left = ticksLeft(world);
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

/** Draw one frame. */
function render(time: number): void {
  ctx.drawImage(staticLayer, 0, 0);
  clock = time;
  const winner = world.over ? world.over.winner : -1;
  drawDynamic(ctx, world, T, time, 0, winner >= 0 && decidedAt >= 0 ? { player: winner, t: time - decidedAt } : undefined, leader);
  warmSprites(ctx, world, T); // a few of the robots' pictures made ahead of need, so play does not stutter
  // the ghosts, on their own layer, which is only cleared when it has something on it
  gctx.setTransform(1, 0, 0, 1, 0, 0);
  if (ghostsShown) gctx.clearRect(0, 0, ghosts.width, ghosts.height);
  gctx.setTransform(1, 0, 0, 1, 0, ghostTop);
  ghostsShown = drawGhosts(gctx, world, T, -ghostTop);
  drawTimer();
  drawScore();
}

/** Show the result panel. */
function finish(title: string, text: string): void {
  mode = 'over';
  overShown = true;
  roundLive = false;
  $('resultTitle').textContent = title;
  $('resultText').textContent = text;
  $('resultText').hidden = !text;
  if (result.hidden) {
    result.hidden = false;
    $('again').focus();
  }
}

/** One step of the game rules: read the input, advance the world, play its sounds, check for the end. */
function tick(): void {
  // player 0 is you; players 1 to 3 are CPU players, which are asked for the same thing your controls give.
  // Once the round is decided nobody is asked for anything: the winner celebrates and the rest is over.
  const inputs: (PlayerInput | undefined)[] = [];
  if (!world.over) {
    inputs[0] = input.state();
    for (const b of bots) inputs[b.id] = botInput(world, b);
  }
  step(world, inputs);
  const me = world.players[0];
  for (const e of world.events) {
    if (e.type === 'place') sfx.place();
    else if (e.type === 'explode') sfx.explode();
    else if (e.type === 'pickup') e.kind === 'curse' ? sfx.curse() : sfx.pickup();
    else if (e.type === 'shield') sfx.shield();
    else if (e.type === 'kick' || e.type === 'throw') sfx.kick();
    else if (e.type === 'lift' || e.type === 'land') sfx.lift();
    else if (e.type === 'block') {
      // the arena has one more solid block: the picture of the floor and blocks needs redrawing
      sfx.block();
      redrawStatic();
    } else if (e.type === 'death') {
      sfx.death();
      if (e.player === 0) blastedBy = e.cause === 'block' ? CRUSHED : e.by;
    }
  }
  // the moment the first block starts to fall
  if (world.shrinkNext === 1 && world.falling.length === 1 && !hurried) {
    hurried = true;
    sfx.hurry();
  }

  const who = world.players[blastedBy];
  const crushed = blastedBy === CRUSHED;
  const how = crushed ? 'A falling block landed on you.' : !who || who === me ? 'Caught in your own blast.' : `Caught in ${colorById(who.colorId).name}'s blast.`;
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
    }
    if (winner === 0) finish('You win', 'Last bot standing.');
    else if (winner > 0) finish(`${colorById(world.players[winner].colorId).name} wins`, me.alive ? '' : how);
    else finish('Draw', me.alive ? 'Nobody was left standing.' : `${how} Nobody was left standing.`);
  } else if (!world.over && !overShown && !me.alive && me.deadTicks >= DEATH_TICKS) {
    // You are out and the others are still at it. The round carries on behind this panel, and its
    // winner still gets the win; Next round does not wait for it.
    finish(crushed ? 'You got crushed' : 'You got blasted', `${how} The others are still fighting.`);
  }
}

let last = performance.now();
let acc = 0;
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  keepSharp();
  input.pad.poll(now); // notice a thumb that has stopped, in every mode
  if (mode === 'playing' || mode === 'over') {
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
  // the title screen covers everything, so the arena behind it is not drawn
  if (mode === 'title') renderTitle(now / 1000);
  else render(now / 1000);
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
  drawTitle(tctx, { x: r.left * dpr, y: r.top * dpr, w: r.width * dpr, h: r.height * dpr }, colorById(myColor), time - titleFrom);
}
/** Open the title screen. It is where the game starts, and where the menu's ✕ goes back to before any round has been played. */
function showTitle(): void {
  mode = 'title';
  titleFrom = -1;
  menu.hidden = true;
  result.hidden = true;
  teach.hidden = true;
  document.body.classList.remove('menu-open');
  document.body.classList.add('title-open');
  title.hidden = false;
  $('titleLocal').focus({ preventScroll: true });
}
/**
 * Leave the title screen for the menu, on one of its tabs. The title's large pictures are let go.
 * The title offers the two modes: Local, which leads here (the menu stands in for the lobby to come), and
 * Online, which is switched off until online play is built (step 2 of the plan in docs/ROADMAP.md).
 */
function leaveTitle(tab: Tab): void {
  initAudio(); // a tap: the moment the browser allows sound to start
  title.hidden = true;
  document.body.classList.remove('title-open');
  closeTitle();
  showMenu(tab);
}
$('titleLocal').addEventListener('click', () => leaveTitle('main'));

// ---------------------------------------------------------------- menu

/**
 * The nine bot buttons in the menu, each drawn with the same code that draws the robots in play.
 *
 * Picking one chooses your colour for the next round (`myColor`, which is also saved). It never changes
 * a round that has started: a round's colours are fixed when it is made, in newWorld(). While a round
 * is in play the buttons cannot be pressed at all (lockPicker). Other menus that let a player choose a
 * colour should do the same two things: set `myColor`, and leave the world alone once a round has begun.
 */
function buildPicker(): void {
  const grid = $('picker');
  grid.textContent = '';
  for (const c of COLORS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'bot';
    b.id = `bot-${c.id}`;
    b.style.setProperty('--glow', c.glow);
    b.setAttribute('aria-pressed', String(c.id === myColor));
    const cv = document.createElement('canvas');
    cv.dataset.color = c.id;
    const label = document.createElement('span');
    label.textContent = c.name;
    b.append(cv, label);
    b.addEventListener('click', () => {
      if (roundLive) return; // your colour is yours for the whole round
      myColor = c.id;
      try {
        localStorage.setItem('botColor', c.id);
      } catch {
        /* storage is optional */
      }
      for (const el of grid.querySelectorAll('.bot')) {
        el.setAttribute('aria-pressed', String(el === b));
      }
      // Before the first round the arena waiting behind the menu has not been played on, so it is recoloured
      // to show the choice. (If another bot wears the colour picked, it takes your old one: no two bots ever
      // match.) A round that has ended for you is left as it was; the choice is for the next one.
      if (overShown) return;
      const me = world.players[0];
      for (const p of world.players) if (p !== me && p.colorId === c.id) p.colorId = me.colorId;
      me.colorId = c.id;
    });
    grid.append(b);
  }
  drawPicker();
}

/** Draw the robots on the bot buttons, sharp at the screen's present pixel density. */
function drawPicker(): void {
  const dpr = density();
  for (const cv of $('picker').querySelectorAll('canvas')) {
    cv.width = 96 * dpr;
    cv.height = 108 * dpr;
    const g = cv.getContext('2d')!;
    drawRobot(g, cv.width / 2, cv.height * 0.95, (cv.height * 0.9) / -ROBOT.top, colorById(cv.dataset.color ?? ''), 2, 0, false); // nine tenths of the button's height
  }
}

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

/** While a round is in play your colour cannot be changed: the bot buttons are switched off and a line says why. */
function lockPicker(locked: boolean): void {
  for (const el of $('picker').querySelectorAll<HTMLButtonElement>('.bot')) el.disabled = locked;
  $('pickerNote').hidden = !locked;
}

/** The three CPU level buttons in the menu. A change applies at once, to a paused round too. */
function buildLevels(): void {
  const row = $('cpuLevels');
  for (const lv of BOT_LEVELS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.id = `cpu-${lv}`;
    const name = document.createElement('b');
    name.textContent = LEVELS[lv].label;
    b.append(name);
    b.addEventListener('click', () => {
      cpuLevel = lv;
      for (const bot of bots) bot.level = lv;
      try {
        localStorage.setItem('cpuLevel', lv);
      } catch {
        /* storage is optional */
      }
      showLevel();
    });
    row.append(b);
  }
  showLevel();
}

function showLevel(): void {
  for (const lv of BOT_LEVELS) $(`cpu-${lv}`).setAttribute('aria-pressed', String(lv === cpuLevel));
  $('cpuBlurb').textContent = LEVELS[cpuLevel].blurb;
}

/** Push the control settings into the swipe pad, the screen layout, the menu and the pad's caption, and optionally save them. */
function applySettings(save: boolean): void {
  const right = settings.hand === 'right';
  const t = thumb();
  const on = activeMatch();
  input.pad.aims = on ? [...on.aims] : standardAims(settings.hand);

  // which side the pad is on (page.html lays the controls out mirrored under body.righty)
  document.body.classList.toggle('righty', right);
  $('handLeft').setAttribute('aria-pressed', String(!right));
  $('handRight').setAttribute('aria-pressed', String(right));

  // the Standard / My thumb switch: the setting in use is highlighted and tagged ON
  const which = right ? 'right' : 'left';
  $('dirStandard').setAttribute('aria-pressed', String(!on));
  $('dirMine').setAttribute('aria-pressed', String(!!on));
  $('dirStandardSub').textContent = `typical ${which} thumb`;
  $('dirMineSub').textContent = !t.match ? 'tap to set up' : on ? 'matched to you' : 'matched, switched off';
  $('matchState').textContent = on
    ? `On now: My thumb. The pad reads your ${which} thumb's swipes the way you make them, with ${on.kind === 'per' ? 'a lean for each direction' : 'one lean for all four directions'}.`
    : t.match
      ? `On now: Standard, made for a typical ${which} thumb. Your match is saved: tap My thumb to switch it back on.`
      : `On now: Standard, made for a typical ${which} thumb. Tap My thumb to measure yours in about 40 seconds.`;
  $('matchStart').hidden = !t.match;
  $('saveNote').hidden = canSave;

  // the caption on the swipe pad itself, visible while playing
  const tag = $('padTag');
  tag.textContent = on ? 'My thumb swipes' : 'Standard swipes';
  tag.classList.toggle('mine', !!on);

  if (!save) return;
  try {
    const out = (s: ThumbSetting): object => ({ match: s.match, use: s.useMatch });
    localStorage.setItem('controls3', JSON.stringify({ hand: settings.hand, left: out(settings.left), right: out(settings.right) }));
  } catch {
    /* storage is optional */
  }
}

// ---------------------------------------------------------------- Match my thumb
// Twelve prompted swipes measure how this player's swipes lean; eight more test
// the result. teach.ts does the maths. The panel covers only the arena so the
// swipe pad stays usable under it. docs/MATCH-MY-THUMB.md explains the feature.

const DIR_WORD = ['', 'Up', 'Down', 'Left', 'Right'];
const ARROW_TURN = [0, -90, 90, 180, 0];

/** learn: the twelve swipes. test: the eight. done: the result is showing. */
let teachPhase: 'learn' | 'test' | 'done' = 'learn';
let teachAt = 0;
let learnSamples: { want: Dir; lean: number }[] = [];
let testSwipes: TestSwipe[] = [];
let teachSum: ThumbSummary | null = null;
/** the three settings the test compares: the one in use before, one lean, a lean per direction */
let candidates: { label: string; match: ThumbMatch | null; aims: number[] }[] = [];
let chosen = 0;

function teachOrder(): Dir[] {
  return teachPhase === 'test' ? TEST_ORDER : TEACH_ORDER;
}

/** Show the next direction to swipe, with an optional note about the last attempt. */
function teachPrompt(note = ''): void {
  const order = teachOrder();
  const want = order[teachAt];
  $('teachStep').textContent =
    teachPhase === 'test' ? `Test swipe ${teachAt + 1} of ${order.length}` : `Swipe ${teachAt + 1} of ${order.length}`;
  $('teachWord').textContent = DIR_WORD[want];
  $('teachArrow').style.transform = `rotate(${ARROW_TURN[want]}deg)`;
  $('teachArrow').style.display = ''; // an svg has no `hidden` property, so use display
  $('teachHint').textContent =
    note ||
    (teachPhase === 'test'
      ? 'Now a few more to test the result. Swipe the same quick way.'
      : 'Keep your thumb on the pad and swipe the way you do when playing. If the arrow does not change, swipe a little further.');
  $('teachChoices').hidden = true;
  $('teachNums').hidden = true;
  $('teachAgain').hidden = true;
  $('teachClose').textContent = 'Cancel';
}

function startTeach(): void {
  mode = 'teach';
  teachPhase = 'learn';
  teachAt = 0;
  learnSamples = [];
  testSwipes = [];
  teachSum = null;
  hideMenu();
  teach.hidden = false;
  teachPrompt();
}

/** A swipe registered on the pad while matching. */
function teachStroke(vx: number, vy: number): void {
  if (mode !== 'teach' || teachPhase === 'done') return;
  const order = teachOrder();
  const want = order[teachAt];
  if (Math.hypot(vx, vy) < 20) {
    teachPrompt(`That one was very short. Swipe ${DIR_WORD[want].toLowerCase()} a little further.`);
    return;
  }
  const lean = leanOf(want, vx, vy);
  if (Math.abs(lean) > 80) {
    teachPrompt(`That read as a different direction. Swipe ${DIR_WORD[want].toLowerCase()} again.`);
    return;
  }
  if (teachPhase === 'learn') learnSamples.push({ want, lean });
  else testSwipes.push({ want, vx, vy });
  teachAt++;
  if (teachAt < order.length) {
    teachPrompt();
    return;
  }
  if (teachPhase === 'learn') finishLearning();
  else finishTesting();
}

/** The twelve learning swipes are in: work out the two candidate settings, then start the test. */
function finishLearning(): void {
  const sum = summarise(learnSamples);
  teachSum = sum;
  if (!sum.ok) {
    teachPhase = 'done';
    showTeachEnd('No match', 'Those swipes pointed too many different ways to learn from, so nothing was changed.');
    $('teachNums').textContent = `Spread ${sum.spread}°. Up to 30° can be used.`;
    $('teachNums').hidden = false;
    return;
  }
  const before = activeMatch();
  const one = singleAims(sum, settings.hand);
  const each = perDirectionAims(sum, settings.hand);
  candidates = [
    {
      label: before ? 'Before (your match)' : 'Before (Standard)',
      match: before,
      aims: before ? [...before.aims] : standardAims(settings.hand),
    },
    { label: 'One lean', match: { kind: 'single', lean: sum.lean, by: sum.by, aims: one }, aims: one },
    { label: 'A lean per direction', match: { kind: 'per', lean: sum.lean, by: sum.by, aims: each }, aims: each },
  ];
  teachPhase = 'test';
  teachAt = 0;
  testSwipes = [];
  teachPrompt();
}

/** The eight test swipes are in: read them with each candidate and offer the best. */
function finishTesting(): void {
  teachPhase = 'done';
  const verdicts = candidates.map((c) => judge(c.aims, testSwipes));
  chosen = pickBest(verdicts);
  const sum = teachSum!;
  const leanWords =
    Math.abs(sum.lean) < 4
      ? 'Your swipes are close to straight.'
      : `Your swipes lean about ${Math.abs(sum.lean)}° ${sum.lean > 0 ? 'clockwise' : 'anticlockwise'}.`;
  showTeachEnd(
    'Tested',
    chosen !== 0
      ? `${leanWords} The best result is selected and will be switched on. Tap another to use it instead.`
      : candidates[0].match
        ? `${leanWords} Your current match read your test swipes best, so it stays on unless you pick another.`
        : `${leanWords} Standard read your test swipes best, so Standard stays on unless you pick another.`,
  );
  const list = $('teachChoices');
  list.textContent = '';
  candidates.forEach((c, i) => {
    const v = verdicts[i];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'choice';
    b.setAttribute('aria-pressed', String(i === chosen));
    const name = document.createElement('span');
    name.textContent = c.label;
    const score = document.createElement('span');
    score.className = 'score';
    score.textContent = v.right === v.total ? `${v.right} of ${v.total} · closest ${Math.round(v.closest)}°` : `${v.right} of ${v.total}`;
    b.append(name, score);
    b.addEventListener('click', () => {
      chosen = i;
      for (const el of list.querySelectorAll('.choice')) el.setAttribute('aria-pressed', String(el === b));
    });
    list.append(b);
  });
  list.hidden = false;
  $('teachNums').textContent = `Lean: left ${sum.by[3]}°, right ${sum.by[4]}°, up ${sum.by[1]}°, down ${sum.by[2]}°. Spread ${sum.spread}°.`;
  $('teachNums').hidden = false;
}

/** The final panel: a title and a message, the arrow hidden, Try again and Done. */
function showTeachEnd(title: string, text: string): void {
  $('teachStep').textContent = '';
  $('teachArrow').style.display = 'none';
  $('teachWord').textContent = title;
  $('teachHint').textContent = text;
  $('teachChoices').hidden = true;
  $('teachAgain').hidden = false;
  $('teachClose').textContent = 'Done';
}

/** Done or Cancel: keep the chosen setting if a test has just finished, then back to the Controls tab. */
function closeTeach(): void {
  if (teachPhase === 'done' && teachSum?.ok && candidates.length) {
    const pick = candidates[chosen];
    if (chosen !== 0) {
      const t = thumb();
      t.match = pick.match;
      t.useMatch = true;
      applySettings(true);
    }
  }
  showMenu('controls');
}

input.pad.onStroke = teachStroke;
$('matchStart').addEventListener('click', startTeach);
$('teachAgain').addEventListener('click', startTeach);
$('teachClose').addEventListener('click', closeTeach);
// The Standard / My thumb switch. My thumb with no match saved yet starts the matching.
$('dirStandard').addEventListener('click', () => {
  thumb().useMatch = false;
  applySettings(true);
});
$('dirMine').addEventListener('click', () => {
  if (!thumb().match) {
    startTeach();
    return;
  }
  thumb().useMatch = true;
  applySettings(true);
});
// Which thumb steers. Each thumb keeps its own swipe direction setting.
$('handLeft').addEventListener('click', () => {
  settings.hand = 'left';
  applySettings(true);
});
$('handRight').addEventListener('click', () => {
  settings.hand = 'right';
  applySettings(true);
});

// ---------------------------------------------------------------- menu, rounds

type Tab = 'main' | 'controls';

/** Show one of the menu's two tabs. */
function showTab(tab: Tab): void {
  for (const [name, tabId, paneId] of [['main', 'tabMain', 'paneMain'], ['controls', 'tabControls', 'paneControls']] as const) {
    $(tabId).setAttribute('aria-selected', String(name === tab));
    $(paneId).hidden = name !== tab;
  }
}

/**
 * Open the menu. The game stops while it is open. If a round is in progress
 * it waits behind the menu, untouched, and the menu offers Resume. If the
 * round has ended for you (you are out, or it is decided) it waits too: the
 * menu offers New round, and closing the menu goes back to watching it.
 */
function showMenu(tab: Tab = 'main'): void {
  mode = 'menu';
  result.hidden = true;
  teach.hidden = true;
  menu.hidden = false;
  document.body.classList.add('menu-open');
  $('play').textContent = roundLive ? 'Resume' : overShown ? 'New round' : 'Play';
  $('newRound').hidden = !roundLive;
  lockPicker(roundLive);
  showTab(tab);
}

function hideMenu(): void {
  menu.hidden = true;
  result.hidden = true;
  teach.hidden = true;
  document.body.classList.remove('menu-open');
}

/** Start a new round in a fresh arena. */
function start(): void {
  initAudio();
  newWorld();
  input.reset();
  acc = 0;
  roundLive = true;
  mode = 'playing';
  hideMenu();
}

/** Carry on with the round that was waiting behind the menu. */
function resume(): void {
  initAudio();
  input.reset();
  acc = 0;
  mode = 'playing';
  hideMenu();
}

/** Back to a round that has ended for you: the result panel again, and the rest of the round (or the winner's dance) behind it. */
function watch(): void {
  initAudio();
  input.reset();
  acc = 0;
  mode = 'over';
  hideMenu();
  result.hidden = false;
}

/**
 * The X: close the menu and go back to where the player came from. Into the paused round if there is one;
 * back to watching a round that has ended for you (it never starts a new one: that is what New round is
 * for); and when no round has been played yet, back to the title screen.
 */
function closeMenu(): void {
  if (roundLive) resume();
  else if (overShown) watch();
  else showTitle();
}

/** The menu's main button: Resume a paused round, otherwise a new round. */
function play(): void {
  if (roundLive) resume();
  else start();
}

$('play').addEventListener('click', play);
$('newRound').addEventListener('click', start);
$('menuClose').addEventListener('click', closeMenu);
$('tabMain').addEventListener('click', () => showTab('main'));
$('tabControls').addEventListener('click', () => showTab('controls'));
$('again').addEventListener('click', start);
$('change').addEventListener('click', () => showMenu('main'));
$('menuBtn').addEventListener('click', () => showMenu('main'));
// Escape opens the menu during a round and closes it again
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape') return;
  if (mode === 'playing' || mode === 'over') showMenu('main');
  else if (mode === 'menu') closeMenu();
});
input.onFirstGesture = initAudio;

document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());
window.addEventListener('resize', layout);
window.addEventListener('orientationchange', () => setTimeout(layout, 200));

newWorld();
layout();
buildPicker();
buildLevels();
applySettings(false);
showTitle();
requestAnimationFrame(frame);

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
  get cpuLevel() {
    return cpuLevel;
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
};
