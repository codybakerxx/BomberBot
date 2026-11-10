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
import { DEFAULT_TILT, STRAIGHT, uniformAims } from './swipe';
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
// `zone` is the size of the quiet zone as a percentage: the three Swipe length buttons, Short, Medium and Long.
const ZONE_LEVELS = [70, 100, 140];
/** What each Swipe length choice means, shown under the buttons. */
const ZONE_WORDS: Record<number, string> = {
  70: 'Turns with a small swipe. Quickest to react, but a wobble of your thumb can turn you.',
  100: 'Recommended. Turns with a medium swipe and ignores small wobbles.',
  140: 'Turns only with a longer swipe. Best if the robot turns when you did not mean it to.',
};

/** The result of Match my thumb that is in use. */
interface ThumbMatch {
  /** one lean for all four directions, or a lean for each */
  kind: 'single' | 'per';
  /** the measured average lean, and per direction (index 1 to 4), for display */
  lean: number;
  by: number[];
  /** what the pad uses: the screen angle each direction is read around (index 1 to 4) */
  aims: number[];
}
/** `match` is null until Match my thumb has been run and kept: the pad then uses the standard lean. */
const settings: { zone: number; match: ThumbMatch | null } = { zone: 100, match: null };

/** Aims that are safe to use: each within the limits tiltFor allows of its straight direction. */
function validAims(a: unknown): a is number[] {
  if (!Array.isArray(a) || a.length !== 5) return false;
  for (let d = 1; d <= 4; d++) {
    const lean = (((STRAIGHT[d] - a[d] + 180) % 360) + 360) % 360 - 180;
    if (typeof a[d] !== 'number' || !Number.isFinite(a[d]) || lean < -20.5 || lean > 25.5) return false;
  }
  return true;
}

try {
  const saved = JSON.parse(localStorage.getItem('controls2') ?? 'null');
  if (saved && typeof saved.zone === 'number') {
    // earlier versions had five levels (60, 80, 100, 125, 150): use the nearest of the three
    settings.zone = ZONE_LEVELS.reduce((a, b) => (Math.abs(b - saved.zone) < Math.abs(a - saved.zone) ? b : a));
  }
  const sm = saved?.match;
  if (sm && (sm.kind === 'single' || sm.kind === 'per') && validAims(sm.aims) && typeof sm.lean === 'number' && Array.isArray(sm.by)) {
    settings.match = { kind: sm.kind, lean: sm.lean, by: sm.by, aims: sm.aims };
  } else if (saved && typeof saved.lean === 'number' && Math.abs(saved.lean) <= 60) {
    // saved by version 1 of Match my thumb: one measured lean
    settings.match = { kind: 'single', lean: saved.lean, by: [0, saved.lean, saved.lean, saved.lean, saved.lean], aims: uniformAims(tiltFor(saved.lean)) };
  }
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
  input.pad.aims = settings.match ? [...settings.match.aims] : uniformAims(DEFAULT_TILT);
  $('matchState').textContent = !settings.match
    ? 'Standard, set for a typical left thumb. Match my thumb measures yours in about 40 seconds.'
    : settings.match.kind === 'per'
      ? 'Matched to your thumb, with a lean for each direction.'
      : 'Matched to your thumb, with one lean for all four directions.';
  $('matchReset').hidden = !settings.match;
  $('optZoneDesc').textContent = ZONE_WORDS[settings.zone] ?? '';
  for (const b of document.querySelectorAll<HTMLElement>('#optZone button')) {
    b.setAttribute('aria-pressed', String(Number(b.dataset.v) === settings.zone));
  }
  if (!save) return;
  try {
    // `lean` is kept alongside for version 1 of the game, which reads only that
    localStorage.setItem('controls2', JSON.stringify({ ...settings, lean: settings.match?.lean ?? null }));
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
  menu.hidden = true;
  result.hidden = true;
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
  const before = settings.match;
  candidates = [
    {
      label: before ? 'Before (last match)' : 'Before (standard)',
      match: before,
      aims: before ? [...before.aims] : uniformAims(DEFAULT_TILT),
    },
    { label: 'One lean', match: { kind: 'single', lean: sum.lean, by: sum.by, aims: singleAims(sum) }, aims: singleAims(sum) },
    {
      label: 'A lean per direction',
      match: { kind: 'per', lean: sum.lean, by: sum.by, aims: perDirectionAims(sum) },
      aims: perDirectionAims(sum),
    },
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
    chosen === 0
      ? `${leanWords} The setting you already had read your test swipes best, so it stays unless you pick another.`
      : `${leanWords} The best result is selected. Tap another to use it instead.`,
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

/** Done or Cancel: keep the chosen setting if a test has just finished, then back to the menu. */
function closeTeach(): void {
  if (teachPhase === 'done' && teachSum?.ok && candidates.length) {
    const pick = candidates[chosen];
    if (chosen !== 0) {
      settings.match = pick.match;
      applySettings(true);
    }
  }
  toMenu();
}

input.pad.onStroke = teachStroke;
$('matchStart').addEventListener('click', startTeach);
$('teachAgain').addEventListener('click', startTeach);
$('teachClose').addEventListener('click', closeTeach);
$('matchReset').addEventListener('click', () => {
  settings.match = null;
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
