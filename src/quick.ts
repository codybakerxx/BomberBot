/**
 * Two small things over the round, neither of which pauses it (the owner's asks, 24 November 2026):
 *
 * - Quick chat: the speech-bubble button in the top bar opens a panel of five groups of lines, four ready-made
 *   ones each and a Custom one to type in. A line picked shows in a bubble over the robot that said it, for
 *   everyone in the room (online the server passes it on: `chat` in net.ts).
 * - The quick menu: holding the menu button down opens a small panel of a few settings (sound on or off, the
 *   volume, movement sensitivity) without stopping the round. A tap opens the full menu as before.
 *
 * Both close on a tap anywhere outside them (the tap still counts: a thumb going back to the pad moves the
 * robot), on Escape, and when the round's screen is left.
 */
import { CHAT_MAX, cleanChat } from './net';
import { mount, type Opt } from './ui';
import type { World } from './sim';

/** A group of ready-made lines in the quick chat. The last group, Custom, has a box to type in instead. */
export interface ChatGroup {
  id: string;
  name: string;
  icon: string;
  lines: string[];
}
/** The quick chat's groups and lines (Claude's words; the owner asked for greetings, insults, apologies, motivation and a custom one). */
export const CHAT_GROUPS: ChatGroup[] = [
  { id: 'hi', name: 'Hello', icon: '👋', lines: ['Hey everyone!', 'Good luck, have fun!', 'Ready to rumble?', 'GG, well played!'] },
  { id: 'trash', name: 'Taunts', icon: '😈', lines: ['Is that all you got?', 'Too slow!', 'Nice try, rookie.', 'You call that a bomb?'] },
  { id: 'sorry', name: 'Sorry', icon: '🙏', lines: ['Sorry!', 'My bad!', 'Oops, wrong way!', 'That one was an accident!'] },
  { id: 'hype', name: 'Hype', icon: '🔥', lines: ["Let's go!", 'Nice one!', "We've got this!", 'So close!'] },
  { id: 'custom', name: 'Custom', icon: '✏️', lines: [] },
];
/** How long a bubble stays over a robot, in ms (its last part fading). */
export const BUBBLE_MS = 3600;
/** One line this often from this page (the server keeps the same gap, CHAT_GAP_MS). */
const SEND_GAP_MS = 1500;

/** Close a panel on a press outside it (and outside the button that opens it), letting the press go on. */
function outside(panel: HTMLElement, btn: HTMLElement, close: () => void): void {
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (panel.hidden) return;
      const t = e.target as Node;
      if (!panel.contains(t) && !btn.contains(t)) close();
    },
    true,
  );
}

export interface Chat {
  open(): void;
  close(): void;
  isOpen(): boolean;
}

/**
 * The quick chat panel. `say` sends a line (on this screen it is shown at once; online it comes back from the
 * server like everyone else's).
 */
export function createChat(btn: HTMLElement, panel: HTMLElement, say: (text: string) => void): Chat {
  const tabs = panel.querySelector<HTMLElement>('.chat-tabs')!;
  const list = panel.querySelector<HTMLElement>('.chat-lines')!;
  const own = panel.querySelector<HTMLFormElement>('.chat-own')!;
  const box = own.querySelector<HTMLInputElement>('input')!;
  box.maxLength = CHAT_MAX;
  let group = 0;
  let lastAt = -1e9;
  const send = (raw: string): void => {
    const text = cleanChat(raw);
    if (!text) return;
    const now = performance.now();
    if (now - lastAt < SEND_GAP_MS) return;
    lastAt = now;
    say(text);
    close();
  };
  const tabButtons = CHAT_GROUPS.map((g, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chat-tab';
    const icon = document.createElement('span');
    icon.className = 'chat-icon';
    icon.textContent = g.icon;
    icon.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.textContent = g.name;
    b.append(icon, name);
    b.addEventListener('click', () => pick(i));
    return b;
  });
  tabs.replaceChildren(...tabButtons);
  function pick(i: number): void {
    group = i;
    tabButtons.forEach((b, k) => b.setAttribute('aria-pressed', String(k === i)));
    const g = CHAT_GROUPS[i];
    own.hidden = g.lines.length > 0;
    list.hidden = g.lines.length === 0;
    list.replaceChildren(
      ...g.lines.map((line) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chat-line';
        b.textContent = line;
        b.addEventListener('click', () => send(line));
        return b;
      }),
    );
    if (!own.hidden) box.focus({ preventScroll: true });
  }
  own.addEventListener('submit', (e) => {
    e.preventDefault();
    send(box.value);
    if (panel.hidden) box.value = '';
  });
  function open(): void {
    panel.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    pick(group);
  }
  function close(): void {
    if (panel.hidden) return;
    panel.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    box.blur();
  }
  btn.addEventListener('click', () => (panel.hidden ? open() : close()));
  outside(panel, btn, close);
  return { open, close, isOpen: () => !panel.hidden };
}

/**
 * The bubbles over the robots. `say` puts one over a player (replacing what it last said); `place` keeps them
 * over their robots, called every frame the arena is drawn, with where the arena is on the page.
 */
export function createBubbles(layer: HTMLElement, colourOf: (player: number) => string) {
  const shown = new Map<number, { el: HTMLElement; until: number }>();
  return {
    say(player: number, text: string): void {
      shown.get(player)?.el.remove();
      const el = document.createElement('div');
      el.className = 'bubble';
      el.textContent = text; // (typed by a person: always text, never markup)
      el.style.setProperty('--who', colourOf(player));
      layer.append(el);
      shown.set(player, { el, until: performance.now() + BUBBLE_MS });
    },
    place(w: World, left: number, top: number, tile: number, width: number): void {
      if (!shown.size) return;
      const now = performance.now();
      for (const [i, b] of shown) {
        const p = w.players[i];
        if (!p || now > b.until) {
          b.el.remove();
          shown.delete(i);
          continue;
        }
        // over the helmet, kept on the screen
        const bw = b.el.offsetWidth;
        const at = left + (p.x + 0.5) * tile;
        const x = Math.max(4, Math.min(width - 4 - bw, at - bw / 2));
        const y = Math.max(b.el.offsetHeight + 4, top + (p.y - 0.62) * tile);
        b.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y - b.el.offsetHeight)}px)`;
        // the tail points at the robot even when the bubble is pushed in from the edge
        b.el.style.setProperty('--tail', `${Math.round(Math.max(14, Math.min(bw - 14, at - x)))}px`);
        b.el.classList.toggle('going', b.until - now < 500);
      }
    },
    clear(): void {
      for (const b of shown.values()) b.el.remove();
      shown.clear();
    },
  };
}
export type Bubbles = ReturnType<typeof createBubbles>;

/** How long the menu button must be held for the quick menu, in ms. */
export const HOLD_MS = 420;

/**
 * The quick menu: held, the menu button opens `panel` with `opts` in it; a plain tap still does `tap` (the full
 * menu). `ok()` says whether the round's screen is showing.
 */
export function createQuickMenu(btn: HTMLElement, panel: HTMLElement, opts: Opt[], tap: () => void, ok: () => boolean) {
  const refresh = mount(panel.querySelector<HTMLElement>('.opts')!, opts);
  let timer = 0;
  let held = false;
  const close = (): void => {
    panel.hidden = true;
  };
  const open = (): void => {
    refresh();
    panel.hidden = false;
    navigator.vibrate?.(12);
  };
  btn.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || !ok()) return;
    held = false;
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      held = true;
      open();
    }, HOLD_MS);
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) btn.addEventListener(ev, () => clearTimeout(timer));
  // a long press would otherwise bring up the phone's own menu or select the button
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  btn.addEventListener('click', () => {
    if (held) {
      held = false; // the end of the hold, not a tap
      return;
    }
    if (!panel.hidden) close();
    tap();
  });
  outside(panel, btn, close);
  return { open, close, refresh, isOpen: () => !panel.hidden };
}
