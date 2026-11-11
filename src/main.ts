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
import { Bot, BotLevel, BOT_LEVELS, LEVELS, createBot, botInput } from './bot';
import { COLORS, colorById, drawRobot, drawStatic, drawDynamic, drawItemIcon } from './render';
import { Input } from './input';
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

// How good the CPU players are, remembered on this device under the key "cpuLevel".
let cpuLevel: BotLevel = 'normal';
try {
  const saved = localStorage.getItem('cpuLevel') as BotLevel | null;
  if (saved && BOT_LEVELS.includes(saved)) cpuLevel = saved;
} catch {
  /* storage is optional */
}
/** The three CPU players of the current arena (players 1 to 3). */
let bots: Bot[] = [];
/** Whose blast caught you this round: a player id, or -1 if you are still in. */
let blastedBy = -1;

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
/** menu: the menu is open (a round may be paused behind it). playing: a round. over: result panel showing. teach: Match my thumb. */
let mode: 'menu' | 'playing' | 'over' | 'teach' = 'menu';
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
  // you, plus three CPU players in the other corners, all in different colours
  const others = COLORS.filter((c) => c.id !== myColor).slice(0, 3);
  const seed = (Math.random() * 2 ** 31) | 0;
  world = createWorld({
    seed,
    players: [{ colorId: myColor }, ...others.map((c) => ({ colorId: c.id }))],
  });
  bots = others.map((_, i) => createBot(i + 1, cpuLevel, seed));
  blastedBy = -1;
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
  roundLive = false;
  $('resultTitle').textContent = title;
  $('resultText').textContent = text;
  result.hidden = false;
  $('again').focus();
}

/** One step of the game rules: read the input, advance the world, play its sounds, check for the end. */
function tick(): void {
  // player 0 is you; players 1 to 3 are CPU players, which are asked for the same thing your controls give
  const inputs: (PlayerInput | undefined)[] = [input.state()];
  for (const b of bots) inputs[b.id] = botInput(world, b);
  step(world, inputs);
  const me = world.players[0];
  for (const e of world.events) {
    if (e.type === 'place') sfx.place();
    else if (e.type === 'explode') sfx.explode();
    else if (e.type === 'pickup') sfx.pickup();
    else if (e.type === 'kick' || e.type === 'throw') sfx.kick();
    else if (e.type === 'lift' || e.type === 'land') sfx.lift();
    else if (e.type === 'death') {
      sfx.death();
      if (e.player === 0) {
        // whose blast was it? the flame on your tile remembers who dropped the bomb
        const f = world.flames.find((fl) => fl.cx === Math.round(me.x) && fl.cy === Math.round(me.y));
        blastedBy = f ? f.owner : 0;
      }
    }
  }
  if (overShown) return;
  if (world.over && world.over.winner === 0) {
    finish('You win', 'Last bot standing. All three CPU players are out.');
  } else if (!me.alive && (world.over || me.deadTicks >= DEATH_TICKS)) {
    // out, whether or not the others went with you
    const who = world.players[blastedBy];
    const how = !who || who === me ? 'Caught in your own blast.' : `Caught in ${colorById(who.colorId).name}'s blast.`;
    if (world.over && world.over.winner < 0) finish('Draw', `${how} Nobody was left standing.`);
    else finish('You got blasted', how);
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
      // Recolour in place, so a paused round carries on. If another bot wears
      // the colour picked, it takes your old one: no two bots ever match.
      const me = world.players[0];
      for (const p of world.players) if (p !== me && p.colorId === c.id) p.colorId = me.colorId;
      me.colorId = c.id;
    });
    grid.append(b);
  }
}

/** The four CPU level buttons in the menu. A change applies at once, to a paused round too. */
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
 * it waits behind the menu, untouched, and the menu offers Resume.
 */
function showMenu(tab: Tab = 'main'): void {
  mode = 'menu';
  result.hidden = true;
  teach.hidden = true;
  menu.hidden = false;
  document.body.classList.add('menu-open');
  $('play').textContent = roundLive ? 'Resume' : 'Play';
  $('newRound').hidden = !roundLive;
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

/** The X: close the menu and go to the game. Back into the paused round if there is one, otherwise a new round. */
function closeMenu(): void {
  if (roundLive) resume();
  else start();
}

/** After a round has ended: a fresh arena behind the menu. */
function toMenu(): void {
  roundLive = false;
  newWorld();
  showMenu('main');
}

$('play').addEventListener('click', closeMenu);
$('newRound').addEventListener('click', start);
$('menuClose').addEventListener('click', closeMenu);
$('tabMain').addEventListener('click', () => showTab('main'));
$('tabControls').addEventListener('click', () => showTab('controls'));
$('again').addEventListener('click', start);
$('change').addEventListener('click', toMenu);
$('menuBtn').addEventListener('click', () => showMenu('main'));
// Escape opens the menu during a round and closes it again
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape') return;
  if (mode === 'playing') showMenu('main');
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
showMenu('main');
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
