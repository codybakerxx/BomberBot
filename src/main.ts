/**
 * The app shell: everything that ties the game to the page.
 *
 * - keeps the current match (a World from sim.ts) and steps it 60 times a second
 * - reads the player's input (input.ts) and plays sounds for what happened (audio.ts)
 * - sizes and places the arena, the touch controls and the panels for the screen
 * - runs the menu, the result panel, the D-pad settings and the Match my thumb screen
 * - remembers the chosen bot and the D-pad settings on this device (localStorage)
 *
 * It holds no game rules. Those are all in sim.ts.
 */
import { createWorld, step, World, PlayerInput, Dir, TICK_HZ, DEATH_TICKS } from './sim';
import { COLORS, colorById, drawRobot, drawStatic, drawDynamic, drawItemIcon } from './render';
import { Input } from './input';
import { initAudio, sfx } from './audio';
import { DEFAULT_TILT } from './swipe';
import { TEACH_ORDER, leanOf, summarise, tiltFor } from './teach';

/** Look up an element of src/page.html by its id. */
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('cv');
const ctx = canvas.getContext('2d')!;
const staticLayer = document.createElement('canvas');
const menu = $('menu');
const result = $('result');
const touch = $('touch');
const teach = $('teach');

// The chosen bot colour, remembered on this device under the key "botColor".
let myColor = 'gold';
try {
  const saved = localStorage.getItem('botColor');
  if (saved && COLORS.some((c) => c.id === saved)) myColor = saved;
} catch {
  /* storage is optional */
}

// D-pad feel, adjustable from the menu and remembered on this device under the key "controls2".
// `zone` is the size of the quiet zone as a percentage (the five menu buttons Least to Most).
const ZONE_LEVELS = [60, 80, 100, 125, 150];
/** `lean` is how far this player's swipes lean clockwise, measured by Match my thumb; null until then. */
const settings: { zone: number; lean: number | null } = { zone: 100, lean: null };
try {
  const saved = JSON.parse(localStorage.getItem('controls2') ?? 'null');
  if (saved && ZONE_LEVELS.includes(saved.zone)) settings.zone = saved.zone;
  if (saved && typeof saved.lean === 'number' && Math.abs(saved.lean) <= 60) settings.lean = saved.lean;
} catch {
  /* storage is optional */
}

let world: World;
let T = 32; // tile size in canvas pixels
/** menu: picking a bot. playing: a match. over: result panel showing. teach: Match my thumb. */
let mode: 'menu' | 'playing' | 'over' | 'teach' = 'menu';
let overShown = false;

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
  // you, plus three practice targets in the other corners, all in different colours
  const others = COLORS.filter((c) => c.id !== myColor).slice(0, 3);
  world = createWorld({
    seed: (Math.random() * 2 ** 31) | 0,
    players: [{ colorId: myColor }, ...others.map((c) => ({ colorId: c.id }))],
  });
  overShown = false;
  redrawStatic();
}

/**
 * Fit everything to the screen. The arena is drawn at whole device pixels per
 * tile so it stays sharp. Upright phone: top bar, arena, then the controls fill
 * the rest. Sideways or desktop: arena centred, controls down the two sides.
 */
function layout(): void {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const portrait = H > W * 1.05;
  const isTouch = document.body.classList.contains('touch');
  document.body.classList.toggle('portrait', portrait);
  // upright phone: menu bar, then the arena, then controls fill everything below
  const stacked = portrait && isTouch;
  const topBar = stacked ? 46 : 0;
  const minControls = stacked ? Math.min(230, H * 0.3) : 0;
  const availH = H - topBar - minControls;
  T = Math.max(8, Math.floor(Math.min((W * dpr) / world.w, (availH * dpr) / world.h)));
  canvas.width = T * world.w;
  canvas.height = T * world.h;
  const cw = canvas.width / dpr;
  const ch = canvas.height / dpr;
  canvas.style.width = `${cw}px`;
  canvas.style.height = `${ch}px`;
  canvas.style.left = `${Math.round((W - cw) / 2)}px`;
  canvas.style.top = stacked ? `${topBar}px` : `${Math.round((H - ch) / 2)}px`;
  touch.style.setProperty('--ctl-top', `${Math.round(topBar + ch + 8)}px`);
  touch.style.setProperty('--side', `${Math.round(Math.max(150, (W - cw) / 2))}px`);
  // the Match my thumb panel sits exactly over the arena, leaving the pad free
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

const hud = $<HTMLCanvasElement>('hud');
let hudKey = '';
/** Bombs, blast length and speed, shown outside the arena so nothing covers the top row. */
function drawHud(): void {
  const me = world.players[0];
  const key = `${me.bombsMax}/${me.fire}/${me.speed}/${me.canKick}/${me.canGrab}`;
  if (key === hudKey) return;
  hudKey = key;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  hud.width = 232 * dpr;
  hud.height = 32 * dpr;
  const g = hud.getContext('2d')!;
  g.scale(dpr, dpr);
  g.font = '700 18px "Chakra Petch", system-ui, sans-serif';
  g.textBaseline = 'middle';
  const stats: ['bomb' | 'fire' | 'speed', number][] = [
    ['bomb', me.bombsMax],
    ['fire', me.fire],
    ['speed', me.speed + 1],
  ];
  let x = 14;
  for (const [kind, n] of stats) {
    drawItemIcon(g, kind, x, 16, 9);
    g.fillStyle = '#e8ecff';
    g.fillText(String(n), x + 14, 17);
    x += 54;
  }
  // kick and grab light up once collected
  x += 2;
  for (const [kind, has] of [['kick', me.canKick], ['grab', me.canGrab]] as const) {
    drawItemIcon(g, kind, x, 16, 10, has ? undefined : 'rgba(255,255,255,0.14)');
    x += 30;
  }
}

/** Draw one frame. */
function render(time: number): void {
  ctx.drawImage(staticLayer, 0, 0);
  drawDynamic(ctx, world, T, time);
  drawHud();
}

/** Show the result panel. */
function finish(title: string, text: string): void {
  mode = 'over';
  overShown = true;
  $('resultTitle').textContent = title;
  $('resultText').textContent = text;
  result.hidden = false;
  $('again').focus();
}

/** One step of the game rules: read the input, advance the world, play its sounds, check for the end. */
function tick(): void {
  // player 0 is you; the other three have no input yet, so they stand still (CPU players come next)
  const inputs: (PlayerInput | undefined)[] = [input.state()];
  step(world, inputs);
  for (const e of world.events) {
    if (e.type === 'place') sfx.place();
    else if (e.type === 'explode') sfx.explode();
    else if (e.type === 'pickup') sfx.pickup();
    else if (e.type === 'kick' || e.type === 'throw') sfx.kick();
    else if (e.type === 'lift' || e.type === 'land') sfx.lift();
    else if (e.type === 'death') sfx.death();
  }
  if (overShown) return;
  const me = world.players[0];
  if (world.over) {
    if (world.over.winner === 0) finish('Arena cleared', 'All three targets are down.');
    else finish('Draw', 'Nobody was left standing.');
  } else if (!me.alive && me.deadTicks >= DEATH_TICKS) {
    finish('You got blasted', 'Stand clear of your own bombs. The blast reaches two tiles at the start.');
  }
}

// The screen may refresh at 60, 90 or 120 times a second. The rules always run at
// exactly TICK_HZ: real time is banked in `acc` and spent one fixed tick at a time.
let last = performance.now();
let acc = 0;
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
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
  render(now / 1000);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- menu

/** The nine bot buttons in the menu, each drawn with the same code that draws the robots in play. */
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
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    cv.width = 96 * dpr;
    cv.height = 108 * dpr;
    const g = cv.getContext('2d')!;
    drawRobot(g, cv.width / 2, cv.height * 0.95, cv.height * 0.86, c, 2, 0, false);
    const label = document.createElement('span');
    label.textContent = c.name;
    b.append(cv, label);
    b.addEventListener('click', () => {
      myColor = c.id;
      try {
        localStorage.setItem('botColor', c.id);
      } catch {
        /* storage is optional */
      }
      for (const el of grid.querySelectorAll('.bot')) {
        el.setAttribute('aria-pressed', String(el === b));
      }
      newWorld();
    });
    grid.append(b);
  }
}

/** Push the D-pad settings into the swipe pad and the menu, and optionally save them. */
function applySettings(save: boolean): void {
  input.pad.scale = settings.zone / 100;
  input.pad.tilt = settings.lean === null ? DEFAULT_TILT : tiltFor(settings.lean);
  $('matchState').textContent = settings.lean === null ? 'Swipe directions: standard' : 'Swipe directions: matched to your thumb';
  $('matchReset').hidden = settings.lean === null;
  for (const b of document.querySelectorAll<HTMLElement>('#optZone button')) {
    b.setAttribute('aria-pressed', String(Number(b.dataset.v) === settings.zone));
  }
  if (!save) return;
  try {
    localStorage.setItem('controls2', JSON.stringify(settings));
  } catch {
    /* storage is optional */
  }
}
for (const b of document.querySelectorAll<HTMLElement>('#optZone button')) {
  b.addEventListener('click', () => {
    settings.zone = Number(b.dataset.v);
    applySettings(true);
  });
}

// ---------------------------------------------------------------- Match my thumb
// Twelve prompted swipes measure how this player's swipes lean (teach.ts does the
// maths). The panel covers only the arena so the swipe pad stays usable under it.
// docs/MATCH-MY-THUMB.md explains the whole feature.

const DIR_WORD = ['', 'Up', 'Down', 'Left', 'Right'];
const ARROW_TURN = [0, -90, 90, 180, 0];
let teachAt = 0;
let teachSamples: { want: Dir; lean: number }[] = [];

/** Show the next direction to swipe, with an optional note about the last attempt. */
function teachPrompt(note = ''): void {
  const want = TEACH_ORDER[teachAt];
  $('teachStep').textContent = `Swipe ${teachAt + 1} of ${TEACH_ORDER.length}`;
  $('teachWord').textContent = DIR_WORD[want];
  $('teachArrow').style.transform = `rotate(${ARROW_TURN[want]}deg)`;
  $('teachArrow').style.visibility = 'visible';
  $('teachHint').textContent =
    note || 'Keep your thumb on the pad and swipe the way you do when playing. If the arrow does not change, swipe a little further.';
  $('teachNums').hidden = true;
  $('teachAgain').hidden = true;
  $('teachClose').textContent = 'Cancel';
}

function startTeach(): void {
  mode = 'teach';
  teachAt = 0;
  teachSamples = [];
  menu.hidden = true;
  result.hidden = true;
  teach.hidden = false;
  teachPrompt();
}

/** A swipe registered on the pad while matching. */
function teachStroke(vx: number, vy: number): void {
  if (mode !== 'teach' || teachAt >= TEACH_ORDER.length) return;
  const want = TEACH_ORDER[teachAt];
  if (Math.hypot(vx, vy) < 20) {
    teachPrompt(`That one was very short. Swipe ${DIR_WORD[want].toLowerCase()} a little further.`);
    return;
  }
  const lean = leanOf(want, vx, vy);
  if (Math.abs(lean) > 80) {
    teachPrompt(`That read as a different direction. Swipe ${DIR_WORD[want].toLowerCase()} again.`);
    return;
  }
  teachSamples.push({ want, lean });
  teachAt++;
  if (teachAt < TEACH_ORDER.length) teachPrompt();
  else finishTeach();
}

/** All twelve swipes are in: work out the lean, apply and save it if they were consistent, show the numbers. */
function finishTeach(): void {
  const sum = summarise(teachSamples);
  $('teachStep').textContent = '';
  $('teachArrow').style.visibility = 'hidden';
  if (sum.ok) {
    settings.lean = sum.lean;
    applySettings(true);
    $('teachWord').textContent = 'Matched';
    $('teachHint').textContent =
      Math.abs(sum.lean) < 4
        ? 'Your swipes are close to straight. The pad now reads them that way.'
        : `Your swipes lean about ${Math.abs(sum.lean)}° ${sum.lean > 0 ? 'clockwise' : 'anticlockwise'} from straight. The pad now reads them that way.`;
  } else {
    $('teachWord').textContent = 'No match';
    $('teachHint').textContent = 'Those swipes pointed too many different ways to learn from, so nothing was changed.';
  }
  const nums = $('teachNums');
  nums.textContent = `Left ${sum.by[3]}°, right ${sum.by[4]}°, up ${sum.by[1]}°, down ${sum.by[2]}°. Spread ${sum.spread}°. Pad lean ${input.pad.tilt}°.`;
  nums.hidden = false;
  $('teachAgain').hidden = false;
  $('teachClose').textContent = 'Done';
}

input.pad.onStroke = teachStroke;
$('matchStart').addEventListener('click', startTeach);
$('teachAgain').addEventListener('click', startTeach);
$('teachClose').addEventListener('click', () => toMenu());
$('matchReset').addEventListener('click', () => {
  settings.lean = null;
  applySettings(true);
});

function start(): void {
  initAudio();
  newWorld();
  input.reset();
  acc = 0;
  mode = 'playing';
  menu.hidden = true;
  result.hidden = true;
  teach.hidden = true;
}

function toMenu(): void {
  mode = 'menu';
  result.hidden = true;
  teach.hidden = true;
  menu.hidden = false;
  newWorld();
}

$('play').addEventListener('click', start);
$('again').addEventListener('click', start);
$('change').addEventListener('click', toMenu);
$('menuBtn').addEventListener('click', toMenu);
input.onFirstGesture = initAudio;

document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());
window.addEventListener('resize', layout);
window.addEventListener('orientationchange', () => setTimeout(layout, 200));

newWorld();
layout();
buildPicker();
applySettings(false);
requestAnimationFrame(frame);

// A handle for automated browser checks and for poking about in the browser console.
(window as unknown as { __game: unknown }).__game = {
  get world() {
    return world;
  },
  get mode() {
    return mode;
  },
  get pad() {
    return input.pad;
  },
  get settings() {
    return settings;
  },
};
