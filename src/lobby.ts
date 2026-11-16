/**
 * The lobby: where a match is set up before it starts. Two pages, with Start always in the middle of the
 * bottom bar and the other page's name beside it:
 *
 * - Players: your robot (‹ › arrows, a dot for each colour, or a swipe across it) and Ready, then a card
 *   for each player with a check mark once that player is ready (CPU players always are). Browsing shows a
 *   colour on your robot; Ready makes it yours and pops up a P1 tag under its dot (P2 to P9 sit under the
 *   CPU players' colours). Picking another colour takes Ready away until it is pressed again. If a CPU
 *   player wears the colour you take, it takes the one you had. This page has no Start: its main button
 *   goes on to the Match page. Online, every player will pick and press Ready the same way. Tap a CPU player's card for its panel: its colour, its level, and Remove. An empty card adds a
 *   CPU player. "All CPUs" sets every CPU player's level at once.
 * - Match: the arena (‹ ›, dots or a swipe; the picture is the real arena, drawn with the bricks the rules
 *   ask for), then the rules, which the host sets: the round timer and how fast the blocks close in, rounds
 *   to win, bricks, a custom start, and a custom power-up mix.
 *
 * Couch play: another controller joins by pressing A in the lobby, and gets a card of its own (P2, P3...,
 * before the CPU players). On it, left and right pick a robot, A or Y is Ready, and B takes Ready away or,
 * when not ready, leaves. Those players are not saved; they join again next time.
 *
 * Everything else is saved on this device as it changes (setup.ts), so the lobby opens the way it was left.
 * main.ts owns the match itself; it hands this file a `LobbyHost` to read and change what it needs.
 */
import { BOT_LEVELS, LEVELS } from './bot';
import { COLORS, botName, colorById, drawRobot, drawStatic, drawDynamic, ROBOT } from './render';
import { createWorld, MAX_BOMBS, MAX_FIRE, MAX_LIVES, MAX_SPEED_ITEMS, START_FIRE } from './sim';
import {
  CpuSlot,
  Guest,
  AFTERLIVES,
  type Afterlife,
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
  pickArena,
  arenaSize,
  GROW_AFTER,
  clockText,
  defaultRules,
  problem,
  summary,
  worldConfig,
} from './setup';
import { DANCES, danceFrame, danceOf, stepDance, type DanceId } from './dances';
import { Opt, choice, confirmFirst, heading, mount, note, slider, swipeable, toggle } from './ui';

/** What the lobby needs to know in an online room (main.ts keeps the connection, online.ts). */
export interface OnlineView {
  code: string;
  /** you host the room: you set the match and start it */
  host: boolean;
  /** the host's name, as shown */
  hostName: string;
  /** your P-number in the room (people in the order they joined, then the CPU players) */
  myP: number;
  /** a match is on that you are not in (you joined during it): you play in the next one */
  waiting: boolean;
}

export interface LobbyHost {
  setup: MatchSetup;
  /** in an online room, what the lobby needs to know about it; null when playing on this screen */
  online(): OnlineView | null;
  /** the other players on this screen, each with a controller (couch play); kept by main.ts, not saved */
  guests: Guest[];
  /** how many controllers are connected (the "join" card shows only when there is one) */
  controllers(): number;
  myColor: string;
  /** your victory dance (dances.ts); saved by save() */
  myDance: DanceId;
  /** the name you typed, or '' (shown on your card in place of "You"); saved when set */
  myName: string;
  /** save the setup and your colour */
  save(): void;
  /** the screen's pixel density, as every canvas is drawn at */
  density(): number;
  start(): void;
  back(): void;
  /** open Settings, on one of its pages, or on the one last seen */
  settings(tab?: 'sound' | 'controls' | 'gamepad' | 'graphics'): void;
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/** The order a new CPU player's colour is picked in: bright colours first, black and white last. */
const CPU_COLOURS = ['pink', 'blue', 'red', 'green', 'orange', 'purple', 'gold', 'white', 'black'];
/** The bin on a card. */
const BIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/></svg>';
/** The arena picture is always drawn from the same arena, so it changes only when a setting does. */
const PREVIEW_SEED = 20261114;

export type LobbyPage = 'players' | 'match';

export function createLobby(host: LobbyHost): {
  /** `fresh`: arriving from the title or from a match, when everyone is not ready yet; not when coming back from Settings */
  show(page?: LobbyPage, fresh?: boolean): void;
  hide(): void;
  page(): LobbyPage;
  turn(d: number): void;
  sheetOpen(): boolean;
  closeSheet(): void;
  redraw(): void;
  /** have you pressed Ready (on the robot you are showing)? */
  isReady(): boolean;
  /** online: the server says whether you are ready, and `moved` if it changed your robot */
  setReady(ready: boolean, moved: boolean): void;
  /** A controller nobody has yet pressed A: a new player joins. False if there is no room. */
  join(pad: number): boolean;
  /** That player's left or right: the next robot. */
  guestStep(pad: number, d: number): void;
  /** That player's up or down: the next victory dance. */
  guestDance(pad: number, d: number): void;
  /** That player's A or Y: Ready. */
  guestReady(pad: number): void;
  /** That player's B: not ready any more or, if not ready, leave. */
  guestBack(pad: number): void;
  /** That player's controller has gone: they leave. */
  dropGuest(pad: number): void;
} {
  let page: LobbyPage = 'players';
  /**
   * The colour shown on your robot while browsing. It is only yours (`host.myColor`) once OK is pressed.
   * Online, every player will pick and OK their own the same way, and can pick and OK again until the start.
   */
  let pick = host.myColor;
  /** set by Ready, so the next redraw makes the P1 tag pop up */
  let popMine = false;
  /** whether you have pressed Ready (with the colour you are showing). Lost when another colour is picked. */
  let ready = false;
  const wide = (): boolean => window.matchMedia('(min-width: 820px) and (min-height: 480px)').matches;
  /** the CPU player whose panel is open, or -1 */
  let editing = -1;
  const s = (): MatchSetup => host.setup;
  const guests = (): Guest[] => host.guests;
  /** everyone in the match: you, the other players here, the CPU players */
  const total = (): number => 1 + guests().length + s().cpus.length;
  /** P-number of a CPU player (its place in s().cpus) */
  const cpuP = (i: number): number => i + 2 + guests().length;
  /** the colours other people on this screen wear (not `pad`'s own), which nobody else can take */
  const humanColours = (pad = -2): Set<string> =>
    new Set([...(pad === -1 ? [] : [host.myColor]), ...guests().filter((g) => g.pad !== pad).map((g) => g.colorId)]);
  /** online, the room as main.ts sees it; null on this screen */
  const net = (): OnlineView | null => host.online();
  /** can you change the CPU players and the rules? Yes on this screen; online, only the host */
  const canEdit = (): boolean => !net() || net()!.host;
  /** another player's P-number: P2, P3... here; online, their place in the room */
  const guestP = (g: Guest): number => g.remote?.p ?? guests().indexOf(g) + 2;
  /** your own P-number */
  const myP = (): number => net()?.myP ?? 1;
  /** Most CPU players there is room for: eight players in all. */
  const maxCpus = (): number => Math.min(MAX_CPUS, MAX_CPUS - guests().length);

  // ------------------------------------------------------------ changes
  /** After any change: save, and redraw everything that shows it. */
  function changed(): void {
    host.save();
    refresh();
  }
  /** Colours nobody else in the match wears (you, and the CPU players except `except`). */
  function freeFor(except: number): string[] {
    const used = new Set([...humanColours(), ...s().cpus.filter((_, i) => i !== except).map((c) => c.colorId)]);
    return COLORS.map((c) => c.id).filter((id) => !used.has(id));
  }
  /** Show a colour on your robot (not yours until Ready). Any colour, a CPU player's included. */
  function setPick(id: string): void {
    pick = id;
    if (id !== host.myColor) ready = false;
    refresh();
  }
  /** The next colour that way, past `skip` (other players' own). */
  function nextColour(from: string, d: number, skip: Set<string>): string {
    const ids = COLORS.map((c) => c.id);
    let i = ids.indexOf(from);
    for (let n = 0; n < ids.length; n++) {
      i = (i + d + ids.length) % ids.length;
      if (!skip.has(ids[i])) return ids[i];
    }
    return from;
  }
  function stepMine(d: number): void {
    setPick(nextColour(pick, d, humanColours(-1)));
  }
  /** Ready: the colour on your robot becomes yours, and you are ready. A CPU player wearing it takes the colour you had. */
  function readyUp(): void {
    if (ready && pick === host.myColor) return;
    // another player here took that robot meanwhile: the next one free instead
    if (humanColours(-1).has(pick)) pick = nextColour(pick, 1, humanColours(-1));
    const old = host.myColor;
    if (pick !== old) for (const c of s().cpus) if (c.colorId === pick) c.colorId = old;
    host.myColor = pick;
    ready = true;
    popMine = true;
    changed();
  }
  function addCpu(): void {
    if (s().cpus.length >= maxCpus() || !canEdit()) return;
    const free = freeFor(-1);
    const colorId = CPU_COLOURS.find((c) => free.includes(c)) ?? free[0];
    const level = s().cpus[s().cpus.length - 1]?.level ?? 'normal';
    s().cpus.push({ colorId, level });
    changed();
  }
  function stepArena(d: number): void {
    if (!canEdit()) return;
    const i = ARENAS.findIndex((a) => a.id === s().arena);
    pickArena(s(), ARENAS[(i + d + ARENAS.length) % ARENAS.length].id);
    changed();
  }

  // ------------------------------------------------------------ the Players page
  $('colPrev').addEventListener('click', () => stepMine(-1));
  $('colNext').addEventListener('click', () => stepMine(1));
  swipeable($('youBot').closest<HTMLElement>('.panel')!, stepMine); // the whole robot panel

  // ------------------------------------------------------------ victory dances (the owner's design)
  // Each card has a small ‹ dance › along its foot; arrows, a tap on the name, or a swipe across the card
  // pick it, and the card's robot then does it once through. Another player here also uses up and down on
  // their controller. A CPU player's dance is on its panel too, where its robot dances while it is open.
  /** the cards doing their dance just now, by who (`me`, `g<pad>`, `c<i>`), and since when */
  const previews = new Map<string, number>();
  function preview(who: string): void {
    previews.set(who, performance.now());
    startDancing();
  }
  let danceFrom = performance.now();
  let looping = false;
  function danceLoop(now: number): void {
    if ($('lobby').hidden) {
      looping = false;
      return;
    }
    for (const [who, from] of previews) {
      const cv = document.querySelector<HTMLCanvasElement>(`canvas[data-who="${who}"]`);
      const colour = cardColour(who);
      if (!cv || !colour) {
        previews.delete(who);
        continue;
      }
      const t = (now - from) / 1000;
      const d = cardDance(who);
      if (t >= PREVIEW[d]) {
        previews.delete(who);
        drawBotOn(cv, colour); // done: standing again
      } else drawDancer(cv, colour, d, t, 0.8);
    }
    const c = s().cpus[editing];
    if (!sheet.hidden && c) drawDancer($<HTMLCanvasElement>('cpuBot'), c.colorId, c.dance ?? 'party', (now - danceFrom) / 1000, 0.78);
    if (previews.size || !sheet.hidden) requestAnimationFrame(danceLoop);
    else looping = false;
  }
  /** whose card: its robot's colour now, and its dance */
  function cardColour(who: string): string | null {
    if (who === 'me') return host.myColor;
    if (who[0] === 'g') return guestOf(Number(who.slice(1)))?.pick ?? null;
    return s().cpus[Number(who.slice(1))]?.colorId ?? null;
  }
  function cardDance(who: string): DanceId {
    if (who === 'me') return host.myDance;
    if (who[0] === 'g') return guestOf(Number(who.slice(1)))?.dance ?? 'party';
    return s().cpus[Number(who.slice(1))]?.dance ?? 'party';
  }
  function setCardDance(who: string, id: DanceId): void {
    if (who === 'me') {
      host.myDance = id;
      host.save();
    } else if (who[0] === 'g') {
      const g = guestOf(Number(who.slice(1)));
      if (g) g.dance = id;
    } else {
      const c = s().cpus[Number(who.slice(1))];
      if (!c) return;
      c.dance = id;
      host.save();
      refreshCpu();
    }
    const name = document.getElementById(`dp-name-${who}`);
    if (name) {
      name.querySelector('.dp-text')!.textContent = danceOf(id).name;
      name.setAttribute('aria-label', `Victory dance: ${danceOf(id).name}. Tap to see it.`);
    }
    preview(who);
  }
  /** The small ‹ dance › along the foot of a card, and a swipe across the whole card. */
  function dancePick(wrap: HTMLElement, who: string, readOnly = false): void {
    const row = document.createElement('div');
    row.className = 'dance-pick';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'Victory dance');
    const mk = (id: string, html: string, label: string, act: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.id = id;
      b.innerHTML = html;
      b.setAttribute('aria-label', label);
      b.addEventListener('click', act);
      return b;
    };
    const step = (d: number): void => setCardDance(who, stepDance(cardDance(who), d));
    const name = mk(`dp-name-${who}`, '', `Victory dance: ${danceOf(cardDance(who)).name}. Tap to see it.`, () => preview(who));
    name.className = 'dp-name';
    // a small "Emote" over the dance's name, so it is clear what it is (the owner's ask)
    name.innerHTML = '<span class="dp-label">Emote</span><span class="dp-text"></span>';
    name.querySelector('.dp-text')!.textContent = danceOf(cardDance(who)).name;
    if (readOnly) {
      // someone else's to pick (another person online, or a CPU player when you are not the host): shown, and
      // a tap on it plays it, but it cannot be changed from here
      row.classList.add('ro');
      row.append(name);
      wrap.append(row);
      return;
    }
    row.append(
      mk(`dp-prev-${who}`, '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>', 'Previous dance', () => step(-1)),
      name,
      mk(`dp-next-${who}`, '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>', 'Next dance', () => step(1)),
    );
    wrap.append(row);
    swipeable(wrap, step);
  }
  function startDancing(): void {
    if (looping) return;
    looping = true;
    requestAnimationFrame(danceLoop);
  }
  /** How long each dance plays before it starts again, in the lobby: a whole go, start included. */
  const PREVIEW: Record<DanceId, number> = { party: 3.4, spin: 4.2, wave: 2.85 };
  /**
   * A robot doing a dance on a card's canvas: a little smaller than it stands there, and with its jumps
   * halved, so the jumps and slides stay inside the card.
   */
  function drawDancer(cv: HTMLCanvasElement, colorId: string, dance: DanceId, t: number, _fill = 0): void {
    const r = cv.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const dpr = host.density();
    const w = Math.round(r.width * dpr);
    const h = Math.round(r.height * dpr);
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    const g = cv.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    const size = 0.8 * Math.min((h * 0.92) / -ROBOT.top, (w * 0.95) / 0.78); // drawBotOn's size, 80%
    const f = danceFrame(dance, t % PREVIEW[dance]);
    const pose = { ...f.pose, jump: (f.pose.jump ?? 0) * 0.5, fine: false };
    drawRobot(g, w / 2 + f.dx * size, h * 0.96, size, colorById(colorId), f.facing, f.walk, f.moving, pose);
  }
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
    b.addEventListener('click', () => {
      if (!humanColours(-1).has(c.id)) setPick(c.id);
    });
    b.addEventListener('dblclick', () => readyUp()); // a double tap is a quick Ready
    const tag = document.createElement('span');
    tag.className = 'ptag';
    tag.id = `ptag-${c.id}`;
    cell.append(b, tag);
    dots.append(cell);
  }
  // Ready, and once ready, Next: on to the Match page (the owner's ask)
  $('colOk').addEventListener('click', () => {
    if (ready && pick === host.myColor && !wide()) setPage('match');
    else readyUp();
  });
  // Your own name: the pencil beside the name over the colours swaps it for a box to type in (the owner's
  // design). Your name then shows there and on your card in place of the robot's. Emptied, it goes back to
  // the robot's name. Online, every real player will type theirs the same way.
  const nameBox = $<HTMLInputElement>('myName');
  function editName(on: boolean): void {
    if (on) {
      nameBox.value = host.myName;
      nameBox.hidden = false;
      $('youName').hidden = true;
      nameBox.focus();
      nameBox.select();
    } else if (!nameBox.hidden) {
      host.myName = nameBox.value.replace(/\s+/g, ' ').trim().slice(0, 12);
      nameBox.hidden = true;
      $('youName').hidden = false;
      changed();
    }
  }
  $('editName').addEventListener('pointerdown', (e) => e.preventDefault()); // keep the box's focus: the pencil then finishes the edit
  $('editName').addEventListener('click', () => editName(nameBox.hidden === true));
  nameBox.addEventListener('input', () => {
    host.myName = nameBox.value.replace(/\s+/g, ' ').trimStart().slice(0, 12);
    buildSlots();
  });
  nameBox.addEventListener('blur', () => editName(false));
  nameBox.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.stopPropagation();
      editName(false);
    }
  });

  const allCpus: Opt[] = [
    choice({
      label: 'All CPUs',
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
    me.setAttribute('aria-label', `${host.myName || 'You'}, P${myP()}, playing as ${botName(colorById(host.myColor))}, ${ready ? 'ready' : 'not ready'}`);
    const mc = document.createElement('canvas');
    const mt = document.createElement('div');
    mt.innerHTML = `<b></b><small>P${myP()} · you${net()?.host ? ' · host' : ''}</small><span class="rdy${ready ? ' on' : ''}">${ready ? '✓ Ready' : 'Not ready'}</span>`;
    mt.querySelector('b')!.textContent = host.myName || 'You'; // typed by the player: set as text, never as markup
    me.append(mc, mt);
    mc.dataset.who = 'me';
    const meWrap = document.createElement('div');
    meWrap.className = 'slot-wrap';
    meWrap.append(me);
    dancePick(meWrap, 'me');
    box.append(meWrap);
    const cvs: [HTMLCanvasElement, string][] = [[mc, host.myColor]];
    const lastOne = s().cpus.length + guests().length <= 1;
    guests().forEach((g) => {
      const n = guestP(g);
      const card = document.createElement('div');
      card.className = 'slot guest';
      card.id = `guest-${g.pad}`;
      card.setAttribute('role', 'group');
      const looking = botName(colorById(g.pick));
      card.setAttribute('aria-label', `${looking}, P${n}, on controller ${g.pad + 1}, ${g.ready && g.pick === g.colorId ? 'ready' : 'not ready'}`);
      const cv = document.createElement('canvas');
      const t = document.createElement('div');
      const on = g.ready && g.pick === g.colorId;
      t.innerHTML = `<b></b><small></small><span class="rdy${on ? ' on' : ''}">${on ? '✓ Ready' : g.remote ? 'Not ready' : 'Not ready: A'}</span>`;
      // (a name typed by another person: set as text, never as markup)
      t.querySelector('b')!.textContent = g.remote ? g.remote.name || looking : looking;
      t.querySelector('small')!.textContent = g.remote
        ? `P${n} · ${g.remote.host ? 'host' : 'online'}${g.remote.on ? '' : ' · away'}`
        : `P${n} · controller ${g.pad + 1}`;
      if (g.remote) card.setAttribute('aria-label', `${g.remote.name || looking}, P${n}, online, ${on ? 'ready' : 'not ready'}`);
      card.append(cv, t);
      cv.dataset.who = `g${g.pad}`;
      const bin = document.createElement('button');
      bin.type = 'button';
      bin.className = 'bin';
      bin.id = `gbin-${g.pad}`;
      bin.innerHTML = BIN;
      bin.disabled = lastOne;
      bin.setAttribute('aria-label', lastOne ? 'A match needs someone to play against' : `Remove P${n}`);
      bin.addEventListener('click', () => leave(g.pad));
      const wrap = document.createElement('div');
      wrap.className = 'slot-wrap';
      wrap.append(card);
      if (!g.remote) wrap.append(bin); // nobody removes another person from an online room
      dancePick(wrap, `g${g.pad}`, !!g.remote);
      box.append(wrap);
      cvs.push([cv, g.pick]);
    });
    s().cpus.forEach((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'slot';
      b.id = `slot-${i + 1}`;
      b.setAttribute('aria-label', `${botName(colorById(c.colorId))}, CPU player, P${cpuP(i)}, ${LEVELS[c.level].label}, ready. Tap to change.`);
      const cv = document.createElement('canvas');
      const t = document.createElement('div');
      t.innerHTML = `<b>${botName(colorById(c.colorId))}</b><small>P${cpuP(i)} · ${LEVELS[c.level].label}</small><span class="rdy on">✓ Ready</span>`;
      b.append(cv, t);
      cv.dataset.who = `c${i}`;
      b.addEventListener('click', () => openSheet(i));
      if (!canEdit()) b.classList.add('ro'); // the host's to change
      // the bin: removes this CPU player at once (Undo brings it back)
      const bin = document.createElement('button');
      bin.type = 'button';
      bin.className = 'bin';
      bin.id = `bin-${i + 1}`;
      bin.innerHTML = BIN;
      bin.disabled = lastOne;
      bin.setAttribute('aria-label', lastOne ? 'A match needs someone to play against' : `Remove ${botName(colorById(c.colorId))}`);
      bin.addEventListener('click', () => removeCpu(i));
      const wrap = document.createElement('div');
      wrap.className = 'slot-wrap';
      wrap.append(b);
      if (canEdit()) wrap.append(bin);
      dancePick(wrap, `c${i}`, !canEdit());
      box.append(wrap);
      cvs.push([cv, c.colorId]);
    });
    if (s().cpus.length < maxCpus() && canEdit()) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'slot add';
      add.id = 'slotAdd';
      add.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><b>Add CPU player</b>';
      add.addEventListener('click', addCpu);
      box.append(add);
    }
    // with a controller connected and room for one more: how another player joins
    if (total() < MAX_CPUS + 1 && host.controllers() > 0 && !net()) {
      const j = document.createElement('div');
      j.className = 'slot join';
      j.id = 'slotJoin';
      j.innerHTML = '<span class="pada">A</span><b>Another controller? Press A on it to join</b>';
      box.append(j);
    }
    // the canvases have their size only once they are on the page
    for (const [cv, id] of cvs) drawBotOn(cv, id);
    $('playerCount').textContent = `${total()} of ${MAX_CPUS + 1}`;
  }

  // ------------------------------------------------------------ a CPU player's panel
  const sheet = $('cpuSheet');
  const cpuOpts: Opt[] = [
    choice({
      label: 'Robot',
      hint: () => (s().cpus[editing] ? `${colorById(s().cpus[editing].colorId).name}. Each colour is a robot of its own.` : ''),
      values: () => freeFor(editing).map((id) => botName(colorById(id))),
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
    choice({
      label: 'Victory dance',
      hint: () => (s().cpus[editing] ? danceOf(s().cpus[editing].dance ?? 'party').blurb : ''),
      values: () => DANCES.map((d) => d.name),
      get: () => DANCES.findIndex((d) => d.id === (s().cpus[editing]?.dance ?? 'party')),
      set: (i) => {
        s().cpus[editing].dance = DANCES[i].id;
        danceFrom = performance.now();
        changed();
        startDancing();
      },
    }),
  ];
  const refreshCpu = mount($('cpuRows'), cpuOpts);
  function openSheet(i: number): void {
    if (!canEdit()) return;
    danceFrom = performance.now(); // its robot dances its dance while the panel is open
    queueMicrotask(startDancing);
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
    const i = editing;
    sheet.hidden = true;
    editing = -1;
    removeCpu(i);
  });

  // ------------------------------------------------------------ removing, and Undo
  /** The CPU player removed last, and where it was, until Undo is pressed or the bar goes away. */
  let removed: { cpu: CpuSlot; at: number } | null = null;
  let undoTimer = 0;
  /**
   * Remove a CPU player at once (the bin on its card, or Remove on its panel): the owner asked for a quick
   * way. A bar with Undo shows for a few seconds instead of asking first. The last CPU player stays.
   */
  function removeCpu(i: number): void {
    if (s().cpus.length + guests().length <= 1 || !s().cpus[i]) return;
    const [cpu] = s().cpus.splice(i, 1);
    removed = { cpu, at: i };
    $('undoText').textContent = `${botName(colorById(cpu.colorId))} removed.`;
    $('undoBtn').hidden = false;
    $('undoBar').hidden = false;
    clearTimeout(undoTimer);
    undoTimer = window.setTimeout(hideUndo, 6000);
    changed();
    ($(`bin-${Math.min(i + 1, s().cpus.length)}`) ?? $('slotAdd'))?.focus({ preventScroll: true });
  }
  function hideUndo(): void {
    removed = null;
    $('undoBar').hidden = true;
  }
  $('undoBtn').addEventListener('click', () => {
    if (!removed || s().cpus.length >= maxCpus()) return hideUndo();
    const { cpu, at } = removed;
    // its colour back if nobody has taken it meanwhile, else a free one
    const free = freeFor(-1);
    s().cpus.splice(Math.min(at, s().cpus.length), 0, { ...cpu, colorId: free.includes(cpu.colorId) ? cpu.colorId : free[0] });
    hideUndo();
    changed();
  });
  function refreshSheet(): void {
    if (editing < 0 || !s().cpus[editing]) return;
    const c = s().cpus[editing];
    $('cpuTitle').textContent = botName(colorById(c.colorId));
    $('cpuDesc').textContent = `CPU player · P${cpuP(editing)} · ${LEVELS[c.level].label}. Changes are saved as you make them.`;
    drawBotOn($<HTMLCanvasElement>('cpuBot'), c.colorId);
    const only = s().cpus.length + guests().length <= 1;
    ($('cpuRemove') as HTMLButtonElement).disabled = only;
    $('cpuRemove').title = only ? 'A match needs someone to play against' : '';
    refreshCpu();
  }

  // ------------------------------------------------------------ the Match page
  $('arenaPrev').addEventListener('click', () => stepArena(-1));
  $('arenaNext').addEventListener('click', () => stepArena(1));
  swipeable($('arenaPic').closest<HTMLElement>('.panel')!, stepArena); // the whole arena panel
  for (const a of ARENAS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dot';
    b.setAttribute('aria-label', `${a.name} arena`);
    b.addEventListener('click', () => {
      pickArena(s(), a.id);
      changed();
    });
    b.dataset.arena = a.id;
    $('arenaDots').append(b);
  }
  /** The arena picture: a real arena built with the setup's size and bricks, with everyone in their corners. */
  // the arena picture is drawn again whenever the room for it changes: shown, turned sideways, resized
  let arenaRoom = 0;
  new ResizeObserver(() => {
    const room = $('arenaPic').parentElement!.getBoundingClientRect().width;
    if (room > 0 && room !== arenaRoom) {
      arenaRoom = room;
      drawArena();
    }
  }).observe($('arenaPic').parentElement!);
  function drawArena(): void {
    const cv = $<HTMLCanvasElement>('arenaPic');
    // everyone where they will start: online, in the room's order (P1 first), which is the round's
    const people = [{ p: myP(), c: host.myColor }, ...guests().map((g) => ({ p: guestP(g), c: g.colorId }))].sort((x, y) => x.p - y.p).map((x) => x.c);
    const w = createWorld({ ...worldConfig(s(), people[0], PREVIEW_SEED, people.slice(1)), roundTicks: 0 });
    cv.style.aspectRatio = `${w.w} / ${w.h}`;
    const dpr = host.density();
    // measured at the size the row gives it, then set to exactly the size of what is drawn, so that each of
    // its pixels is one of the screen's (stretched even a little, it is soft). Not on screen (the Match page
    // hidden), it is drawn once it is: see the watch on its row below.
    cv.style.width = '';
    cv.style.height = '';
    cv.style.flex = '';
    const box = cv.getBoundingClientRect();
    if (box.width < 2) return;
    const T = Math.max(4, Math.floor((box.width * dpr) / w.w));
    cv.width = T * w.w;
    cv.height = T * w.h;
    cv.style.width = `${cv.width / dpr}px`;
    cv.style.height = `${cv.height / dpr}px`;
    cv.style.flex = '0 0 auto'; // (no longer stretched to fill the row)
    const g = cv.getContext('2d')!;
    drawStatic(g, w, T);
    drawDynamic(g, w, T, 0, 0);
  }

  // Post-Mortem Behavior (the owner's design): a switch, off by default (everyone out of lives watches, the
  // standard); on, a switch each for Angel and Zombie, at most one of them on (neither: still watching), and
  // Angels come back under Angel, which can only be switched while Angel is on
  const lifeAfter = (id: Afterlife) =>
    toggle({
      label: AFTERLIVES.find((x) => x.id === id)!.name,
      hint: AFTERLIVES.find((x) => x.id === id)!.blurb,
      get: () => s().afterlife === id,
      set: (on) => {
        s().afterlife = on ? id : 'watch';
        changed();
      },
    });
  const angelsBack = toggle({
    label: 'Angels come back',
    hint: () => (s().afterlife === 'angel' ? 'An angel whose bomb knocks a robot out takes its place' : 'Turn Angel on first'),
    get: () => s().afterlife === 'angel' && s().angelsBack,
    set: (v) => {
      s().angelsBack = v;
      changed();
    },
    locked: () => s().afterlife !== 'angel',
  });
  angelsBack.el.classList.add('sub-of'); // set in under Angel, which it belongs to
  const postMortem = toggle({
    label: 'Post-Mortem Behavior',
    hint: 'What a robot out of lives does for the rest of the round',
    get: () => s().postMortem,
    set: (v) => {
      s().postMortem = v;
      changed();
    },
    offText: 'Out of lives, you watch the rest of the round.',
    under: [lifeAfter('angel'), angelsBack, lifeAfter('zombie')],
  });
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
      label: 'Lives',
      hint: 'Each round. Lose one and you are back in your corner, starting from scratch',
      min: 1,
      max: MAX_LIVES,
      get: () => s().lives,
      set: (v) => {
        s().lives = v;
        changed();
      },
      text: (v) => (v === 1 ? 'One life' : `${v} lives`),
    }),
    postMortem,
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
    confirmFirst('Reset to default?', `The timer, rounds, lives, post-mortem behavior, bricks, start and power-ups go back to the defaults for the ${arenaOf(s()).name} arena. The arena and your players stay as they are.`, 'Reset to Default', (yes) => {
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
    // ‹ back to Players, at the top left beside the page names (the owner's ask); none on the Players page
    $('lobbyPrev').hidden = p === 'players';
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
  $('lobbyBack').addEventListener('click', () => host.back());
  $('lobbySound').addEventListener('click', () => host.settings('sound'));
  $('lobbySettings').addEventListener('click', () => host.settings());
  // No bottom bar (the owner's ask): Start is at the end of the Match page (and under the arena), and Next › at
  // the end of the Players page, lit once you are ready. Other ways on: Ready's own Next ›, the page name, RB or E.
  $('lobbyStart').addEventListener('click', tryStart);
  $('playersNext').addEventListener('click', () => setPage('match'));
  // a second Start right under the arena picture, close to hand (the owner's ask); the same as the one in the bar
  $('arenaStart').addEventListener('click', tryStart);
  /** The other players here who have not pressed Ready (with the robot they are showing). */
  const waiting = (): Guest[] => guests().filter((g) => !(g.ready && g.pick === g.colorId));
  /** Start the match, asking first if anyone has not pressed Ready. */
  function tryStart(): void {
    if (problem(s(), guests().length) || !canEdit() || net()?.waiting) return;
    const others = waiting();
    if (ready && !others.length) {
      host.start();
      return;
    }
    // not everyone is ready: ask rather than guess
    const go = (yes: boolean): void => {
      if (!yes) return;
      if (!ready) readyUp();
      for (const g of waiting()) guestReady(g.pad);
      host.start();
    };
    if (!others.length) {
      confirmFirst('Are you ready?', `You have not pressed Ready on the Players page. Everyone must be ready to start.`, 'Ready & Start', go); // the owner's wording: short, with no robot names
      return;
    }
    const names = [...(ready ? [] : ['You']), ...others.map((g) => `P${guestP(g)}`)];
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    confirmFirst(
      'Are you ready?',
      `${list} ${names.length === 1 && names[0] !== 'You' ? 'has' : 'have'} not pressed Ready. They play as the robots showing now.`,
      'Ready & Start',
      go,
    );
  }

  // ------------------------------------------------------------ the other players here (couch play)
  const guestOf = (pad: number): Guest | undefined => guests().find((g) => g.pad === pad);
  function join(pad: number): boolean {
    if (net()) return false; // online, everyone plays on their own screen
    if (guestOf(pad)) return true;
    if (1 + guests().length >= MAX_CPUS + 1) return false;
    // a full match: the last CPU player makes room
    let made = '';
    if (total() >= MAX_CPUS + 1) {
      const cpu = s().cpus.pop()!;
      made = botName(colorById(cpu.colorId));
    }
    const free = freeFor(-1);
    const colorId = CPU_COLOURS.find((c) => free.includes(c)) ?? free[0];
    // each new player starts on a different dance from the one before, so a couch match is not all the same
    guests().push({ pad, colorId, pick: colorId, ready: false, dance: DANCES[(guests().length + 1) % DANCES.length].id });
    if (made) {
      removed = null;
      $('undoText').textContent = `${made} made room for P${guests().length + 1}.`;
      $('undoBtn').hidden = true;
      $('undoBar').hidden = false;
      clearTimeout(undoTimer);
      undoTimer = window.setTimeout(hideUndo, 4000);
    }
    if (!wide() && page !== 'players') setPage('players');
    changed();
    $(`guest-${pad}`)?.scrollIntoView({ block: 'nearest' });
    return true;
  }
  function guestStep(pad: number, d: number): void {
    const g = guestOf(pad);
    if (!g) return;
    g.pick = nextColour(g.pick, d, humanColours(pad));
    if (g.pick !== g.colorId) g.ready = false;
    refresh();
  }
  /** That player's up or down: the next dance, played on their card from its start. */
  function guestDance(pad: number, d: number): void {
    const g = guestOf(pad);
    if (g) setCardDance(`g${pad}`, stepDance(g.dance, d));
  }
  /** Ready: the robot that player is showing becomes theirs. A CPU player wearing it takes the one they had. */
  function guestReady(pad: number): void {
    const g = guestOf(pad);
    if (!g || humanColours(pad).has(g.pick)) return;
    if (g.pick !== g.colorId) for (const c of s().cpus) if (c.colorId === g.pick) c.colorId = g.colorId;
    g.colorId = g.pick;
    g.ready = true;
    changed();
  }
  function guestBack(pad: number): void {
    const g = guestOf(pad);
    if (!g) return;
    if (g.ready) {
      g.ready = false;
      refresh();
    } else leave(pad);
  }
  /** A player here leaves. Nobody left to play against: a CPU player comes back. */
  function leave(pad: number): void {
    const i = guests().findIndex((g) => g.pad === pad);
    if (i < 0) return;
    guests().splice(i, 1);
    if (s().cpus.length === 0) addCpu();
    changed();
  }

  function refresh(): void {
    const shown = colorById(pick);
    const mine = pick === host.myColor;
    const wearer = s().cpus.findIndex((x) => x.colorId === pick);
    const G = guests().length;
    // your robot, in the colour being looked at, and the dots with who wears each colour under them
    drawBotOn($<HTMLCanvasElement>('youBot'), pick, 0.95);
    $('youBot').setAttribute('aria-label', `Your robot, in ${shown.name}${mine ? '' : ' (not yours until you press OK)'}`);
    $('youName').textContent = host.myName || botName(shown);
    // no explanations on this page (the owner's call): only a short note when Ready would swap with a CPU player
    $('youState').textContent = !mine && wearer >= 0 ? `Swaps with P${cpuP(wearer)}` : '';
    const ok = $<HTMLButtonElement>('colOk');
    // just Ready (the owner's wording): the robot's name is right above it. Once ready it becomes Next, on to
    // the Match page; a wide screen already shows that page, so there it just says it is done.
    const next = mine && ready && !wide();
    ok.disabled = mine && ready && !next;
    ok.textContent = next ? 'Next ›' : mine && ready ? '✓ Ready' : 'Ready';
    ok.setAttribute('aria-label', next ? 'Ready. Next: the Match page' : ok.textContent);
    for (const c of COLORS) {
      const b = $<HTMLButtonElement>(`dot-${c.id}`);
      const cpu = s().cpus.findIndex((x) => x.colorId === c.id);
      const guest = guests().findIndex((g) => g.colorId === c.id);
      const tag = $(`ptag-${c.id}`);
      const isMe = c.id === host.myColor;
      tag.textContent = isMe ? `P${myP()}` : guest >= 0 ? `P${guestP(guests()[guest])}` : cpu >= 0 ? `P${cpuP(cpu)}` : '';
      tag.classList.toggle('me', isMe);
      tag.classList.toggle('guest', guest >= 0);
      b.disabled = guest >= 0;
      b.classList.toggle('taken', guest >= 0);
      b.setAttribute('aria-pressed', String(c.id === pick));
      b.setAttribute(
        'aria-label',
        `${botName(c)}, ${c.name}${isMe ? `, yours (P${myP()})` : guest >= 0 ? `, P${guestP(guests()[guest])}'s` : cpu >= 0 ? `, worn by CPU ${cpu + 1} (P${cpuP(cpu)})` : ''}`,
      );
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
    const size = arenaSize(s(), G);
    $('arenaName').textContent = a.name;
    // just the size in tiles, no other words (the owner's ask); a grown arena shows its grown size
    $('arenaBlurb').textContent = `${size.cols} × ${size.rows}`;
    $('arenaBlurb').setAttribute(
      'aria-label',
      size.grown ? `${size.cols} by ${size.rows} tiles, grown for more than ${GROW_AFTER} players` : `${size.cols} by ${size.rows} tiles`,
    );
    $('arenaCount').textContent = `${ARENAS.indexOf(a) + 1} of ${ARENAS.length}`;
    for (const b of $('arenaDots').querySelectorAll<HTMLButtonElement>('.dot')) b.setAttribute('aria-pressed', String(b.dataset.arena === a.id));
    if (!$('lobbyMatch').hidden || window.matchMedia('(min-width: 820px) and (min-height: 480px)').matches) drawArena();
    refreshRules();
    // the summary at the top, and whether Start can be pressed
    $('lobbySummary').textContent = summary(s(), G);
    // Start at the end of the Match page, Next › at the end of the Players page (lit once you are ready;
    // not needed on a wide screen, which shows both pages)
    const go = $<HTMLButtonElement>('lobbyStart');
    const toMatch = page === 'players' && !wide();
    const nx = $<HTMLButtonElement>('playersNext');
    nx.hidden = wide();
    nx.disabled = !(ready && pick === host.myColor);
    nx.setAttribute('aria-label', nx.disabled ? 'Next: press Ready first' : 'Next: the Match page');
    const why = problem(s(), G);
    go.disabled = !!why;
    ($('arenaStart') as HTMLButtonElement).disabled = !!why;
    const note = $('startNote');
    const late = waiting().map((g) => `P${guestP(g)}`);
    const room = net();
    note.textContent = room?.waiting
      ? 'A match is on. You play in the next one, once the host is back in the lobby.'
      : room && !room.host
        ? `${!ready ? 'Press Ready on the Players page. ' : ''}${room.hostName} sets the match and starts it.`
        : why ||
          (toMatch
            ? ''
            : !ready
              ? 'You are not ready yet: press Ready on the Players page.'
              : late.length
                ? `Waiting for ${late.join(', ')} to press Ready${room ? '' : ' (A)'}.`
                : '');
    note.classList.toggle('info', !why || !!room);
    // online, the match is the host's: shown to everyone, changed and started only by the host
    const ro = !canEdit() || !!room?.waiting;
    document.querySelector<HTMLElement>('#lobbyMatch .panel.arena')!.inert = !canEdit();
    $('rules').inert = !canEdit();
    $('allCpus').inert = !canEdit();
    $('lobbyMatch').classList.toggle('readonly', !canEdit());
    $('rulesReset').hidden = !canEdit();
    go.hidden = ro;
    ($('arenaStart') as HTMLButtonElement).hidden = ro;
    refreshSheet();
  }

  return {
    show(p?: LobbyPage, fresh = false): void {
      if (fresh) {
        // a new visit: Ready again for every match, as every player will be online
        pick = host.myColor;
        ready = false;
        for (const g of guests()) {
          g.pick = g.colorId;
          g.ready = false;
        }
        p = p ?? 'players';
      }
      $('lobby').hidden = false;
      nameBox.hidden = true;
      previews.clear();
      $('youName').hidden = false;
      setPage(p ?? page);
      $(page === 'players' && !wide() ? 'colOk' : 'arenaStart').focus({ preventScroll: true });
    },
    hide(): void {
      hideUndo();
      $('lobby').hidden = true;
      sheet.hidden = true;
      editing = -1;
    },
    page: () => page,
    turn,
    sheetOpen: () => !sheet.hidden,
    closeSheet,
    redraw: refresh,
    isReady: () => ready && pick === host.myColor,
    setReady(r: boolean, moved: boolean): void {
      // the server's word on it (online): Ready is as it says, and your robot is the one it says if you are
      // ready or it gave you another (a colour you were only looking at is left showing)
      if (r || moved) pick = host.myColor;
      ready = r;
      refresh();
    },
    join,
    guestStep,
    guestDance,
    guestReady,
    guestBack,
    dropGuest: leave,
  };
}
