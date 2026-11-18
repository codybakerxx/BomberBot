/**
 * The building blocks every menu is made of, so that every setting works the same way on a phone, with a
 * mouse and with a keyboard.
 *
 * - `choice`: a row with ‹ value ›. Tap the arrows, or focus it and press ← or →.
 * - `slider`: a row with a name and its value, then − [slider] + under it. Drag, tap − or +, or use the keys.
 * - `toggle`: a row with a switch. Settings that only matter when it is on (a slider, usually) sit under it
 *   and appear when it is switched on. The row itself can be tapped anywhere, not only on the switch.
 * - `action`: a plain button row.
 *
 * Each returns an `Opt`: its element, and `refresh()`, which redraws it from the value it controls. A page
 * keeps its Opts and refreshes them all after any change, so everything on screen always agrees.
 * The values live elsewhere (setup.ts); these only read them with `get` and change them with `set`.
 */

export interface Opt {
  el: HTMLElement;
  refresh(): void;
}

let uid = 0;
const nextId = (p: string): string => `${p}${++uid}`;

const CHEVRON_L = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
const CHEVRON_R = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';
const MINUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"/></svg>';
const PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12M12 6v12"/></svg>';
export const ICONS = { left: CHEVRON_L, right: CHEVRON_R };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function iconButton(svg: string, label: string, cls = 'step'): HTMLButtonElement {
  const b = el('button', cls);
  b.type = 'button';
  b.innerHTML = svg;
  b.setAttribute('aria-label', label);
  return b;
}

/** The name of a setting, with an optional line under it saying what it does. */
function nameBlock(label: string, hint?: string | (() => string)): { box: HTMLElement; hintEl: HTMLElement | null } {
  const box = el('div', 'opt-name');
  box.append(el('span', 'opt-label', label));
  let hintEl: HTMLElement | null = null;
  if (hint) {
    hintEl = el('span', 'opt-hint');
    box.append(hintEl);
  }
  return { box, hintEl };
}
const hintText = (h: string | (() => string) | undefined): string => (typeof h === 'function' ? h() : (h ?? ''));

/**
 * ‹ value ›: one of a list. Wraps round at the ends, unless `wrap` is false, when the arrow at an end is
 * switched off.
 */
export function choice(o: {
  label: string;
  hint?: string | (() => string);
  values: () => string[];
  get: () => number;
  set: (i: number) => void;
  wrap?: boolean;
  disabled?: () => boolean;
}): Opt {
  const row = el('div', 'opt opt-choice');
  const { box, hintEl } = nameBlock(o.label, o.hint);
  const prev = iconButton(CHEVRON_L, `Previous ${o.label.toLowerCase()}`);
  const next = iconButton(CHEVRON_R, `Next ${o.label.toLowerCase()}`);
  const val = el('output', 'opt-value');
  val.tabIndex = 0;
  val.setAttribute('role', 'spinbutton');
  val.setAttribute('aria-label', o.label);
  const ctl = el('div', 'opt-ctl');
  ctl.append(prev, val, next);
  row.append(box, ctl);
  const move = (d: number): void => {
    if (o.disabled?.()) return;
    const n = o.values().length;
    let i = o.get() + d;
    if (o.wrap === false) {
      if (i < 0 || i >= n) return;
    } else i = (i + n) % n;
    o.set(i);
  };
  prev.addEventListener('click', () => move(-1));
  next.addEventListener('click', () => move(1));
  val.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') move(-1);
    else if (e.key === 'ArrowRight') move(1);
    else return;
    e.preventDefault();
  });
  return {
    el: row,
    refresh(): void {
      const vs = o.values();
      const i = o.get();
      val.textContent = vs[i] ?? '';
      val.setAttribute('aria-valuetext', vs[i] ?? '');
      const off = !!o.disabled?.();
      row.classList.toggle('off', off);
      prev.disabled = off || (o.wrap === false && i <= 0);
      next.disabled = off || (o.wrap === false && i >= vs.length - 1);
      if (hintEl) hintEl.textContent = hintText(o.hint);
    },
  };
}

/** A number on a slider, with − and + either side and its value written out. */
export function slider(o: {
  label: string;
  hint?: string | (() => string);
  min: number;
  max: number;
  step?: number;
  get: () => number;
  set: (v: number) => void;
  text: (v: number) => string;
  /** the value in small type over the slider's circle, following it, in place of beside the name (the owner's ask for Settings › Controls) */
  onThumb?: boolean;
}): Opt {
  const row = el('div', 'opt opt-slider');
  if (o.onThumb) row.classList.add('on-thumb');
  const head = el('div', 'opt-head');
  const { box, hintEl } = nameBlock(o.label, o.hint);
  const val = el('span', 'opt-value');
  head.append(box, val);
  const step = o.step ?? 1;
  const range = el('input');
  range.type = 'range';
  range.min = String(o.min);
  range.max = String(o.max);
  range.step = String(step);
  range.id = nextId('range');
  range.setAttribute('aria-label', o.label);
  const minus = iconButton(MINUS, `Less ${o.label.toLowerCase()}`, 'step small');
  const plus = iconButton(PLUS, `More ${o.label.toLowerCase()}`, 'step small');
  const line = el('div', 'opt-range');
  const track = el('div', 'range-wrap');
  const tip = el('span', 'thumb-value');
  tip.setAttribute('aria-hidden', 'true');
  track.append(range);
  if (o.onThumb) track.append(tip);
  line.append(minus, track, plus);
  row.append(head, line);
  const put = (v: number): void => {
    const c = Math.max(o.min, Math.min(o.max, Math.round(v / step) * step));
    if (c !== o.get()) o.set(c);
  };
  range.addEventListener('input', () => put(Number(range.value)));
  minus.addEventListener('click', () => put(o.get() - step));
  plus.addEventListener('click', () => put(o.get() + step));
  return {
    el: row,
    refresh(): void {
      const v = o.get();
      range.value = String(v);
      range.setAttribute('aria-valuetext', o.text(v));
      range.style.setProperty('--fill', `${((v - o.min) / (o.max - o.min || 1)) * 100}%`);
      val.textContent = o.text(v);
      tip.textContent = o.text(v);
      track.style.setProperty('--at', String((v - o.min) / (o.max - o.min || 1)));
      minus.disabled = v <= o.min;
      plus.disabled = v >= o.max;
      if (hintEl) hintEl.textContent = hintText(o.hint);
    },
  };
}

/** A switch. The settings in `under` only show while it is on. */
export function toggle(o: {
  label: string;
  hint?: string | (() => string);
  get: () => boolean;
  set: (on: boolean) => void;
  under?: Opt[];
  /** what the row says when it is off, in place of the settings under it (optional) */
  offText?: string | (() => string);
  /** greyed out and cannot be switched while this says so (it depends on another switch) */
  locked?: () => boolean;
}): Opt {
  const wrap = el('div', 'opt-group');
  const row = el('div', 'opt opt-toggle');
  const { box, hintEl } = nameBlock(o.label, o.hint);
  const sw = el('button', 'switch-btn');
  sw.type = 'button';
  sw.setAttribute('role', 'switch');
  sw.setAttribute('aria-label', o.label);
  sw.append(el('span', 'knob'));
  row.append(box, sw);
  const under = el('div', 'opt-under');
  for (const u of o.under ?? []) under.append(u.el);
  const offLine = el('p', 'opt-off');
  wrap.append(row, under, offLine);
  const flip = (): void => {
    if (!o.locked?.()) o.set(!o.get());
  };
  sw.addEventListener('click', (e) => {
    e.stopPropagation();
    flip();
  });
  // the whole row is a target, not only the small switch
  box.addEventListener('click', flip);
  return {
    el: wrap,
    refresh(): void {
      const on = o.get();
      const locked = !!o.locked?.();
      sw.setAttribute('aria-checked', String(on));
      sw.disabled = locked;
      row.classList.toggle('on', on);
      row.classList.toggle('locked', locked);
      under.hidden = !on || !(o.under ?? []).length;
      for (const u of o.under ?? []) u.refresh();
      const off = hintText(o.offText);
      offLine.textContent = off;
      offLine.hidden = on || !off;
      if (hintEl) hintEl.textContent = hintText(o.hint);
    },
  };
}

/** A small heading inside a page. */
export function heading(text: string, end = ''): Opt {
  const h = el('div', 'sec-head');
  h.append(el('span', '', text));
  if (end) h.append(el('span', '', end));
  return { el: h, refresh() {} };
}

/** A bomb with a lit fuse, for group labels (`group`). */
export const BOMB_ICON = '<circle cx="10" cy="14.5" r="6.5"/><path d="M7 13.2a3.2 3.2 0 0 1 2.4-2.3M14.6 9.9l1.9-1.9M16.5 8c.4-1.6 1.6-2.4 3-2"/><path d="M21 2.8v1.4M22.6 5.3h-1.4M19.6 3.9l.8.8"/>';

/**
 * Options that belong together, under a small label of their own with an icon (the owner's ask, 18 November
 * 2026: the Match page's rules spaced out into groups, each with a label for its kind of setting).
 * `icon` is the inside of a 24 by 24 SVG, drawn with lines like the other icons.
 */
export function group(label: string, icon: string, opts: Opt[], reset?: GroupReset): Opt {
  const box = el('section', 'set-group');
  const head = el('div', 'group-head');
  const id = nextId('grp');
  head.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>`;
  const name = el('span', '', label);
  name.id = id;
  head.append(name);
  box.setAttribute('aria-labelledby', id);
  // a group's own reset (the owner's design, 18 November 2026): a slim "↺ Reset" chip at the end of its
  // label's line, shown only while something in the group differs from its defaults; pressed, the group's
  // cards glow once so it is clear what went back
  let btn: HTMLButtonElement | null = null;
  if (reset) {
    btn = el('button', 'group-reset');
    btn.type = 'button';
    btn.setAttribute('aria-label', `Reset ${label} to default`);
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4 3.5v4.2h4.2"/></svg><span>Reset</span>';
    btn.addEventListener('click', () => {
      reset.reset();
      box.classList.remove('was-reset');
      void box.offsetWidth; // (so the glow starts again on another reset)
      box.classList.add('was-reset');
    });
    box.addEventListener('animationend', (e) => {
      if ((e as AnimationEvent).animationName === 'reset-glow') box.classList.remove('was-reset');
    });
    head.append(btn);
  }
  const list = el('div', 'opts');
  for (const o of opts) list.append(o.el);
  box.append(head, list);
  return {
    el: box,
    refresh(): void {
      for (const o of opts) o.refresh();
      if (btn && reset) btn.hidden = reset.isDefault();
    },
  };
}

/** A group's own reset (`group`): what it does, and whether there is anything to reset. */
export interface GroupReset {
  reset(): void;
  isDefault(): boolean;
}

/** A line of explanation. */
export function note(text: string | (() => string)): Opt {
  const p = el('p', 'hint');
  return {
    el: p,
    refresh(): void {
      p.textContent = hintText(text);
    },
  };
}

/** Put a list of Opts on a page and give back a function that refreshes them all. */
export function mount(parent: HTMLElement, opts: Opt[]): () => void {
  parent.textContent = '';
  for (const o of opts) parent.append(o.el);
  const all = (): void => {
    for (const o of opts) o.refresh();
  };
  all();
  return all;
}

/** How far a finger must go sideways to count as a swipe. */
const SWIPE_PX = 28;

/**
 * Swipes across an area: a sideways drag of at least SWIPE_PX calls `go(1)` (finger moving left, so the
 * next one) or `go(-1)`. Used on the whole robot panel and the whole arena panel, as a third way to change
 * them besides the arrows and the dots (the owner asked for a bigger area that catches swipes every time).
 *
 * It counts as soon as the finger has gone far enough, not when it lifts, and it keeps following the finger
 * after it leaves the area. A swipe that starts on a button inside (a dot, Ready, Start) does not also press
 * it. Up and down are left to the page, so it still scrolls.
 */
export function swipeable(area: HTMLElement, go: (d: number) => void): void {
  let x0 = 0;
  let y0 = 0;
  let id = -1;
  let fired = false;
  let quietUntil = 0;
  area.style.touchAction = 'pan-y';
  area.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e.target as HTMLElement).closest('input, textarea')) return; // typing a name: not a swipe
    id = e.pointerId;
    x0 = e.clientX;
    y0 = e.clientY;
    fired = false;
  });
  const follow = (e: PointerEvent): void => {
    if (e.pointerId !== id || fired) return;
    const dx = e.clientX - x0;
    const dy = e.clientY - y0;
    if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.2) {
      fired = true;
      quietUntil = performance.now() + 600;
      go(dx < 0 ? 1 : -1);
    }
  };
  window.addEventListener('pointermove', follow);
  window.addEventListener('pointerup', (e) => {
    follow(e);
    if (e.pointerId === id) id = -1;
  });
  window.addEventListener('pointercancel', (e) => {
    if (e.pointerId === id) id = -1; // the page took it over, to scroll
  });
  // the click a swipe can leave behind on a button inside is not a press
  area.addEventListener(
    'click',
    (e) => {
      if (performance.now() < quietUntil) {
        e.preventDefault();
        e.stopPropagation();
        quietUntil = 0;
      }
    },
    true,
  );
}

// ---------------------------------------------------------------- asking first

let confirmDone: ((yes: boolean) => void) | null = null;
let confirmFrom: HTMLElement | null = null;

/**
 * Ask before something that cannot be undone (leaving a match, restarting a round, removing a player).
 * Shows the #confirm panel; `then(true)` if the player says yes. Escape, Cancel or a tap outside the panel
 * all mean no. With `over`, the panel sits where that element is (centred on it, as wide as it, kept on the
 * screen): the owner's ask, so asking from the result panel does not jump to the middle of the arena.
 */
export function confirmFirst(title: string, text: string, yes: string, then: (yes: boolean) => void, over?: HTMLElement): void {
  const box = document.getElementById('confirm')!;
  document.getElementById('confirmTitle')!.textContent = title;
  document.getElementById('confirmText')!.textContent = text;
  document.getElementById('confirmYes')!.textContent = yes;
  confirmFrom = document.activeElement as HTMLElement | null;
  confirmDone = then;
  box.hidden = false;
  const sheet = box.querySelector<HTMLElement>('.sheet')!;
  sheet.style.cssText = '';
  box.classList.toggle('over', !!over);
  if (over) {
    const r = over.getBoundingClientRect();
    sheet.style.width = `${Math.round(r.width)}px`;
    sheet.style.left = `${Math.round(r.left)}px`;
    const h = sheet.offsetHeight;
    const top = Math.min(Math.max(8, r.top + r.height / 2 - h / 2), window.innerHeight - h - 8);
    sheet.style.top = `${Math.round(Math.max(8, top))}px`;
  }
  (document.getElementById('confirmNo') as HTMLButtonElement).focus();
}
export function confirmOpen(): boolean {
  return !document.getElementById('confirm')!.hidden;
}
export function answerConfirm(yes: boolean): void {
  const box = document.getElementById('confirm')!;
  if (box.hidden) return;
  box.hidden = true;
  const done = confirmDone;
  confirmDone = null;
  confirmFrom?.focus?.({ preventScroll: true });
  done?.(yes);
}
export function wireConfirm(): void {
  const box = document.getElementById('confirm')!;
  document.getElementById('confirmYes')!.addEventListener('click', () => answerConfirm(true));
  document.getElementById('confirmNo')!.addEventListener('click', () => answerConfirm(false));
  box.addEventListener('click', (e) => {
    if (e.target === box) answerConfirm(false);
  });
}

// ---------------------------------------------------------------- a flash on every press

/** How long a pressed button stays lit, in thousandths of a second. */
const FLASH_MS = 220;
/** The menus' buttons that light up when pressed (the round's own A and B, `.tbtn`, are left alone). */
const FLASHABLE = 'button:not(.tbtn), [role="spinbutton"]';

/**
 * Every menu button lights up for a moment when it is pressed (the owner's ask: so the player can see the tap
 * was taken): a soft glow in the accent colour and a slight press in (`.flash` in page.html). Wired once, on
 * the whole page. It follows the finger or mouse going down, and a press made with Enter, Space or a
 * controller's A (which reach the button as a click with no finger) lights it up too.
 */
export function wireFlash(): void {
  const flash = (el: Element | null): void => {
    const b = el?.closest<HTMLElement>(FLASHABLE);
    if (!b || (b as HTMLButtonElement).disabled) return;
    b.classList.remove('flash');
    void b.offsetWidth; // start the glow again if it is pressed twice quickly
    b.classList.add('flash');
    window.setTimeout(() => b.classList.remove('flash'), FLASH_MS);
  };
  document.addEventListener(
    'pointerdown',
    (e) => flash(e.target as Element),
    true,
  );
  document.addEventListener(
    'click',
    (e) => {
      if (e.detail === 0) flash(e.target as Element); // no finger or mouse: Enter, Space or a controller
    },
    true,
  );
}
