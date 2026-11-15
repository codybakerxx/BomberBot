/**
 * The lobby: where a match is set up before it starts. Two pages, with Start always in the middle of the
 * bottom bar and the other page's name beside it:
 *
 * - Players: your robot (‹ › arrows, a dot for each colour, or a swipe across it) and OK, then a card for
 *   each player. Browsing shows a colour on your robot; OK makes it yours, and a P1 tag pops up under its
 *   dot (P2 to P4 sit under the CPU players' colours). If a CPU player wears the colour you take, it takes
 *   the one you had. Start with a colour picked but not OK'd asks which you mean. Tap a CPU player's card for its panel: its colour, its level, and Remove. An empty card adds a
 *   CPU player. "All CPUs" sets every CPU player's level at once.
 * - Match: the arena (‹ ›, dots or a swipe; the picture is the real arena, drawn with the bricks the rules
 *   ask for), then the rules, which the host sets: the round timer and how fast the blocks close in, rounds
 *   to win, bricks, a custom start, and a custom power-up mix.
 *
 * Everything is saved on this device as it changes (setup.ts), so the lobby opens the way it was left.
 * main.ts owns the match itself; it hands this file a `LobbyHost` to read and change what it needs.
 */
import { BOT_LEVELS, LEVELS } from './bot';
import { COLORS, colorById, drawRobot, drawStatic, drawDynamic, ROBOT } from './render';
import { createWorld, MAX_BOMBS, MAX_FIRE, MAX_SPEED_ITEMS, START_FIRE } from './sim';
import {
  ARENAS,
  BRICKS,
  CLOSE_IN,
  ITEM_AMOUNTS,
  ITEM_NAMES,
  MatchSetup,
  MAX_CPUS,
  MAX_FIRST_TO,
  ROUND_MAX,
  ROUND_MIN,
  ROUND_STEP,
  arenaOf,
  clockText,
  defaultRules,
  problem,
  summary,
  worldConfig,
} from './setup';
import { Opt, choice, confirmFirst, heading, mount, note, slider, swipeable, toggle } from './ui';

export interface LobbyHost {
  setup: MatchSetup;
  myColor: string;
  /** save the setup and your colour */
  save(): void;
  /** the screen's pixel density, as every canvas is drawn at */
  density(): number;
  start(): void;
  back(): void;
  /** open Settings, on one of its pages, or on the one last seen */
  settings(tab?: 'sound' | 'controls' | 'graphics'): void;
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/** The order a new CPU player's colour is picked in: bright colours first, black and white last. */
const CPU_COLOURS = ['pink', 'blue', 'red', 'green', 'orange', 'purple', 'gold', 'white', 'black'];
/** The arena picture is always drawn from the same arena, so it changes only when a setting does. */
const PREVIEW_SEED = 20261114;

export type LobbyPage = 'players' | 'match';

export function createLobby(host: LobbyHost): {
  show(page?: LobbyPage): void;
  hide(): void;
  page(): LobbyPage;
  turn(d: number): void;
  sheetOpen(): boolean;
  closeSheet(): void;
  redraw(): void;
} {
  let page: LobbyPage = 'players';
  /**
   * The colour shown on your robot while browsing. It is only yours (`host.myColor`) once OK is pressed.
   * Online, every player will pick and OK their own the same way, and can pick and OK again until the start.
   */
  let pick = host.myColor;
  /** set by OK, so the next redraw makes the P1 tag pop up */
  let popMine = false;
  /** the CPU player whose panel is open, or -1 */
  let editing = -1;
  const s = (): MatchSetup => host.setup;

  // ------------------------------------------------------------ changes
  /** After any change: save, and redraw everything that shows it. */
  function changed(): void {
    host.save();
    refresh();
  }
  /** Colours nobody else in the match wears (you, and the CPU players except `except`). */
  function freeFor(except: number): string[] {
    const used = new Set([host.myColor, ...s().cpus.filter((_, i) => i !== except).map((c) => c.colorId)]);
    return COLORS.map((c) => c.id).filter((id) => !used.has(id));
  }
  /** Show a colour on your robot (not yours until OK). Any colour, a CPU player's included. */
  function setPick(id: string): void {
    pick = id;
    refresh();
  }
  function stepMine(d: number): void {
    const ids = COLORS.map((c) => c.id);
    setPick(ids[(ids.indexOf(pick) + d + ids.length) % ids.length]);
  }
  /** OK: the colour on your robot becomes yours. A CPU player wearing it takes the colour you had. */
  function confirmPick(): void {
    if (pick === host.myColor) return;
    const old = host.myColor;
    for (const c of s().cpus) if (c.colorId === pick) c.colorId = old;
    host.myColor = pick;
    popMine = true;
    changed();
  }
  function addCpu(): void {
    if (s().cpus.length >= MAX_CPUS) return;
    const free = freeFor(-1);
    const colorId = CPU_COLOURS.find((c) => free.includes(c)) ?? free[0];
    const level = s().cpus[s().cpus.length - 1]?.level ?? 'normal';
    s().cpus.push({ colorId, level });
    changed();
  }
  function stepArena(d: number): void {
    const i = ARENAS.findIndex((a) => a.id === s().arena);
    s().arena = ARENAS[(i + d + ARENAS.length) % ARENAS.length].id;
    changed();
  }

  // ------------------------------------------------------------ the Players page
  $('colPrev').addEventListener('click', () => stepMine(-1));
  $('colNext').addEventListener('click', () => stepMine(1));
  swipeable($('youBot'), stepMine);
  const dots = $('youDots');
  for (const c of COLORS) {
    // a dot, with a tag under it saying which player wears that colour (P1 is you)
    const cell = document.createElement('div');
    cell.className = 'dot-cell';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dot';
    b.id = `dot-${c.id}`;
    b.style.setProperty('--c', c.body);
    b.addEventListener('click', () => setPick(c.id));
    b.addEventListener('dblclick', () => confirmPick()); // a double tap is a quick OK
    const tag = document.createElement('span');
    tag.className = 'ptag';
    tag.id = `ptag-${c.id}`;
    cell.append(b, tag);
    dots.append(cell);
  }
  $('colOk').addEventListener('click', confirmPick);

  const allCpus: Opt[] = [
    choice({
      label: 'All CPUs',
      hint: () => {
        const lv = new Set(s().cpus.map((c) => c.level));
        return lv.size > 1 ? 'Mixed levels. Set them all at once here, or one at a time on their cards.' : 'Sets every CPU player at once. Each can also be set on its own card.';
      },
      values: () => BOT_LEVELS.map((l) => LEVELS[l].label),
      get: () => {
        const lv = new Set(s().cpus.map((c) => c.level));
        return lv.size === 1 ? BOT_LEVELS.indexOf([...lv][0]) : 1;
      },
      set: (i) => {
        for (const c of s().cpus) c.level = BOT_LEVELS[i];
        changed();
      },
      disabled: () => s().cpus.length === 0,
    }),
  ];
  const refreshAll = mount($('allCpus'), allCpus);

  function drawBotOn(cv: HTMLCanvasElement, colorId: string, fill = 0.92): void {
    const dpr = host.density();
    const r = cv.getBoundingClientRect();
    const w = Math.round((r.width || cv.clientWidth || 56) * dpr);
    const h = Math.round((r.height || cv.clientHeight || 72) * dpr);
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    const g = cv.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    // as big as fits: the robot is 1.09 tiles tall (ROBOT.top) and about 0.75 wide
    const size = Math.min((h * fill) / -ROBOT.top, (w * 0.95) / 0.78);
    drawRobot(g, w / 2, h * 0.96, size, colorById(colorId), 2, 0, false, { fine: false });
  }

  function buildSlots(): void {
    const box = $('slots');
    box.textContent = '';
    const me = document.createElement('div');
    me.className = 'slot me';
    me.setAttribute('role', 'group');
    me.setAttribute('aria-label', `You, ${colorById(host.myColor).name}`);
    const mc = document.createElement('canvas');
    const mt = document.createElement('div');
    mt.innerHTML = `<b>You · P1</b><small>${colorById(host.myColor).name}</small>`;
    me.append(mc, mt);
    box.append(me);
    const cvs: [HTMLCanvasElement, string][] = [[mc, host.myColor]];
    s().cpus.forEach((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'slot';
      b.id = `slot-${i + 1}`;
      b.setAttribute('aria-label', `CPU ${i + 1}, ${colorById(c.colorId).name}, ${LEVELS[c.level].label}. Tap to change.`);
      const cv = document.createElement('canvas');
      const t = document.createElement('div');
      t.innerHTML = `<b>CPU ${i + 1} · P${i + 2}</b><small>${LEVELS[c.level].label} · ${colorById(c.colorId).name}</small>`;
      const edit = document.createElement('span');
      edit.className = 'edit';
      edit.textContent = 'Edit';
      b.append(cv, t, edit);
      b.addEventListener('click', () => openSheet(i));
      box.append(b);
      cvs.push([cv, c.colorId]);
    });
    if (s().cpus.length < MAX_CPUS) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'slot add';
      add.id = 'slotAdd';
      add.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><b>Add CPU player</b>';
      add.addEventListener('click', addCpu);
      box.append(add);
    }
    // the canvases have their size only once they are on the page
    for (const [cv, id] of cvs) drawBotOn(cv, id);
    $('playerCount').textContent = `${s().cpus.length + 1} of ${MAX_CPUS + 1}`;
  }

  // ------------------------------------------------------------ a CPU player's panel
  const sheet = $('cpuSheet');
  const cpuOpts: Opt[] = [
    choice({
      label: 'Colour',
      values: () => freeFor(editing).map((id) => colorById(id).name),
      get: () => freeFor(editing).indexOf(s().cpus[editing]?.colorId ?? ''),
      set: (i) => {
        s().cpus[editing].colorId = freeFor(editing)[i];
        changed();
      },
    }),
    choice({
      label: 'Level',
      hint: () => (s().cpus[editing] ? LEVELS[s().cpus[editing].level].blurb : ''),
      values: () => BOT_LEVELS.map((l) => LEVELS[l].label),
      get: () => BOT_LEVELS.indexOf(s().cpus[editing]?.level ?? 'normal'),
      set: (i) => {
        s().cpus[editing].level = BOT_LEVELS[i];
        changed();
      },
      wrap: false,
    }),
  ];
  const refreshCpu = mount($('cpuRows'), cpuOpts);
  function openSheet(i: number): void {
    editing = i;
    sheet.hidden = false;
    refresh();
    ($('cpuDone') as HTMLButtonElement).focus({ preventScroll: true });
  }
  function closeSheet(): void {
    if (sheet.hidden) return;
    const was = editing;
    sheet.hidden = true;
    editing = -1;
    $(`slot-${was + 1}`)?.focus({ preventScroll: true });
  }
  $('cpuDone').addEventListener('click', closeSheet);
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) closeSheet();
  });
  $('cpuRemove').addEventListener('click', () => {
    if (s().cpus.length <= 1) return;
    const i = editing;
    confirmFirst(`Remove CPU ${i + 1}?`, `${colorById(s().cpus[i].colorId).name} leaves the match. You can add a CPU player again at any time.`, 'Remove', (yes) => {
      if (!yes) return;
      s().cpus.splice(i, 1);
      sheet.hidden = true;
      editing = -1;
      changed();
      $('slotAdd')?.focus({ preventScroll: true });
    });
  });
  function refreshSheet(): void {
    if (editing < 0 || !s().cpus[editing]) return;
    const c = s().cpus[editing];
    $('cpuTitle').textContent = `CPU ${editing + 1}`;
    $('cpuDesc').textContent = `${colorById(c.colorId).name} · ${LEVELS[c.level].label}. Changes are saved as you make them.`;
    drawBotOn($<HTMLCanvasElement>('cpuBot'), c.colorId);
    const only = s().cpus.length <= 1;
    ($('cpuRemove') as HTMLButtonElement).disabled = only;
    $('cpuRemove').title = only ? 'A match needs at least one CPU player' : '';
    refreshCpu();
  }

  // ------------------------------------------------------------ the Match page
  $('arenaPrev').addEventListener('click', () => stepArena(-1));
  $('arenaNext').addEventListener('click', () => stepArena(1));
  swipeable($('arenaPic'), stepArena);
  for (const a of ARENAS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dot';
    b.setAttribute('aria-label', `${a.name} arena`);
    b.addEventListener('click', () => {
      s().arena = a.id;
      changed();
    });
    b.dataset.arena = a.id;
    $('arenaDots').append(b);
  }
  /** The arena picture: a real arena built with the setup's size and bricks, with everyone in their corners. */
  function drawArena(): void {
    const cv = $<HTMLCanvasElement>('arenaPic');
    const w = createWorld({ ...worldConfig(s(), host.myColor, PREVIEW_SEED), roundTicks: 0 });
    cv.style.aspectRatio = `${w.w} / ${w.h}`;
    const dpr = host.density();
    const box = cv.getBoundingClientRect();
    const T = Math.max(4, Math.floor(((box.width || 230) * dpr) / w.w));
    cv.width = T * w.w;
    cv.height = T * w.h;
    const g = cv.getContext('2d')!;
    drawStatic(g, w, T);
    drawDynamic(g, w, T, 0, 0);
  }

  const rules: Opt[] = [
    toggle({
      label: 'Round timer',
      hint: 'When it runs out, blocks fall in from the edge',
      get: () => s().timerOn,
      set: (v) => {
        s().timerOn = v;
        changed();
      },
      offText: 'No timer: a round lasts until one robot is left, and no blocks fall.',
      under: [
        slider({
          label: 'Round length',
          min: ROUND_MIN,
          max: ROUND_MAX,
          step: ROUND_STEP,
          get: () => s().roundSecs,
          set: (v) => {
            s().roundSecs = v;
            changed();
          },
          text: clockText,
        }),
        slider({
          label: 'Closing in',
          hint: () => `The blocks take ${CLOSE_IN[s().closeIn].secs} seconds to fall. A 5 by 5 square in the middle stays open.`,
          min: 0,
          max: CLOSE_IN.length - 1,
          get: () => s().closeIn,
          set: (v) => {
            s().closeIn = v;
            changed();
          },
          text: (v) => CLOSE_IN[v].name,
        }),
      ],
    }),
    slider({
      label: 'Rounds to win',
      hint: 'The first to win this many rounds wins the match',
      min: 1,
      max: MAX_FIRST_TO,
      get: () => s().firstTo,
      set: (v) => {
        s().firstTo = v;
        changed();
      },
      text: (v) => (v === 1 ? 'One round' : `First to ${v}`),
    }),
    slider({
      label: 'Bricks',
      hint: 'How much of the arena starts filled. The picture above shows it.',
      min: 0,
      max: BRICKS.length - 1,
      get: () => s().bricks,
      set: (v) => {
        s().bricks = v;
        changed();
      },
      text: (v) => BRICKS[v].name,
    }),
    toggle({
      label: 'Custom start',
      hint: 'What everyone starts each round with',
      get: () => s().startOn,
      set: (v) => {
        s().startOn = v;
        changed();
      },
      offText: 'Everyone starts with 1 bomb, a 1-tile blast and normal speed.',
      under: [
        slider({ label: 'Bombs', min: 1, max: MAX_BOMBS, get: () => s().startBombs, set: (v) => ((s().startBombs = v), changed()), text: (v) => `${v} at a time` }),
        slider({ label: 'Blast', min: START_FIRE, max: MAX_FIRE, get: () => s().startFire, set: (v) => ((s().startFire = v), changed()), text: (v) => (v === 1 ? '1 tile' : `${v} tiles`) }),
        slider({ label: 'Speed', min: 0, max: MAX_SPEED_ITEMS, get: () => s().startSpeed, set: (v) => ((s().startSpeed = v), changed()), text: (v) => (v === 0 ? 'Normal' : `+${v}`) }),
      ],
    }),
    toggle({
      label: 'Custom power-ups',
      hint: 'How often each power-up turns up under the bricks',
      get: () => s().itemsOn,
      set: (v) => {
        s().itemsOn = v;
        changed();
      },
      offText: 'The usual mix: about half the bricks hide a power-up. Shields and curses are very rare.',
      under: ITEM_NAMES.map(([kind, name, what]) =>
        slider({
          label: name,
          hint: what,
          min: 0,
          max: ITEM_AMOUNTS.length - 1,
          get: () => s().items[kind],
          set: (v) => {
            s().items[kind] = v;
            changed();
          },
          text: (v) => ITEM_AMOUNTS[v].name,
        }),
      ),
    }),
  ];
  const refreshRules = mount($('rules'), rules);
  $('rulesReset').addEventListener('click', () =>
    confirmFirst('Put the rules back to normal?', 'The arena, timer, rounds, bricks, start and power-ups go back to the usual ones. Your players stay as they are.', 'Reset rules', (yes) => {
      if (!yes) return;
      host.setup = defaultRules(s(), host.myColor);
      changed();
    }),
  );

  // ------------------------------------------------------------ pages, Start, the bar
  function setPage(p: LobbyPage): void {
    page = p;
    $('pgPlayers').setAttribute('aria-selected', String(p === 'players'));
    $('pgMatch').setAttribute('aria-selected', String(p === 'match'));
    $('lobbyPlayers').hidden = p !== 'players';
    $('lobbyMatch').hidden = p !== 'match';
    $('lobbyPrev').hidden = p === 'players';
    $('lobbyNext').hidden = p === 'match';
    const sc = document.querySelector('#lobby .scroll');
    if (sc) sc.scrollTop = 0;
    refresh();
  }
  function turn(d: number): void {
    setPage(d < 0 ? 'players' : 'match');
  }
  $('pgPlayers').addEventListener('click', () => setPage('players'));
  $('pgMatch').addEventListener('click', () => setPage('match'));
  $('lobbyPrev').addEventListener('click', () => setPage('players'));
  $('lobbyNext').addEventListener('click', () => setPage('match'));
  $('lobbyBack').addEventListener('click', () => host.back());
  $('lobbySound').addEventListener('click', () => host.settings('sound'));
  $('lobbySettings').addEventListener('click', () => host.settings());
  $('lobbyStart').addEventListener('click', () => {
    if (problem(s())) return;
    if (pick === host.myColor) {
      host.start();
      return;
    }
    // a colour picked but not OK'd: ask which is meant rather than guess
    const want = colorById(pick).name;
    confirmFirst(`Play as ${want}?`, `${want} is on your robot, but you have not pressed OK, so you are still ${colorById(host.myColor).name}.`, `Play as ${want}`, (yes) => {
      if (!yes) return;
      confirmPick();
      host.start();
    });
  });

  function refresh(): void {
    const shown = colorById(pick);
    const mine = pick === host.myColor;
    const wearer = s().cpus.findIndex((x) => x.colorId === pick);
    // your robot, in the colour being looked at, and the dots with who wears each colour under them
    drawBotOn($<HTMLCanvasElement>('youBot'), pick, 0.95);
    $('youBot').setAttribute('aria-label', `Your robot, in ${shown.name}${mine ? '' : ' (not yours until you press OK)'}`);
    $('youName').textContent = shown.name;
    $('youState').textContent = mine
      ? 'P1 · your colour'
      : wearer >= 0
        ? `P${wearer + 2} wears it now. OK to take it: CPU ${wearer + 1} gets ${colorById(host.myColor).name}.`
        : `Not yours yet: press OK to take it.`;
    const ok = $<HTMLButtonElement>('colOk');
    ok.disabled = mine;
    ok.textContent = mine ? `✓ ${shown.name} is yours` : `OK: play as ${shown.name}`;
    for (const c of COLORS) {
      const b = $<HTMLButtonElement>(`dot-${c.id}`);
      const cpu = s().cpus.findIndex((x) => x.colorId === c.id);
      const tag = $(`ptag-${c.id}`);
      const isMe = c.id === host.myColor;
      tag.textContent = isMe ? 'P1' : cpu >= 0 ? `P${cpu + 2}` : '';
      tag.classList.toggle('me', isMe);
      b.setAttribute('aria-pressed', String(c.id === pick));
      b.setAttribute('aria-label', `${c.name}${isMe ? ', yours (P1)' : cpu >= 0 ? `, worn by CPU ${cpu + 1} (P${cpu + 2})` : ''}`);
    }
    if (popMine) {
      popMine = false;
      const tag = $(`ptag-${host.myColor}`);
      tag.classList.remove('pop');
      void tag.offsetWidth; // so the animation starts again
      tag.classList.add('pop');
    }
    buildSlots();
    refreshAll();
    // the arena
    const a = arenaOf(s());
    $('arenaName').textContent = a.name;
    $('arenaBlurb').textContent = `${a.cols} by ${a.rows} tiles. ${a.blurb}`;
    $('arenaCount').textContent = `${ARENAS.indexOf(a) + 1} of ${ARENAS.length}`;
    for (const b of $('arenaDots').querySelectorAll<HTMLButtonElement>('.dot')) b.setAttribute('aria-pressed', String(b.dataset.arena === a.id));
    if (!$('lobbyMatch').hidden || window.matchMedia('(min-width: 820px) and (min-height: 480px)').matches) drawArena();
    refreshRules();
    // the summary at the top, and whether Start can be pressed
    $('lobbySummary').textContent = summary(s());
    const why = problem(s());
    ($('lobbyStart') as HTMLButtonElement).disabled = !!why;
    $('startNote').textContent = why;
    refreshSheet();
  }

  return {
    show(p?: LobbyPage): void {
      pick = host.myColor;
      $('lobby').hidden = false;
      setPage(p ?? page);
      $('lobbyStart').focus({ preventScroll: true });
    },
    hide(): void {
      $('lobby').hidden = true;
      sheet.hidden = true;
      editing = -1;
    },
    page: () => page,
    turn,
    sheetOpen: () => !sheet.hidden,
    closeSheet,
    redraw: refresh,
  };
}
