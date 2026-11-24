/**
 * Two small things over the round, neither of which pauses it (the owner's asks, 24 November 2026):
 *
 * - Quick chat: the speech-bubble button in the top bar, left of the menu button, opens a panel of five groups
 *   of lines, four ready-made ones each and a Custom one to type in. A line picked shows in a bubble under the
 *   head of the player who said it on the scoreboard, for everyone in the room (online the server passes it
 *   on: `chat` in net.ts).
 * - The quick menu: holding the menu button down opens a small panel of a few settings (sound on or off, the
 *   volume, movement sensitivity) without stopping the round. A tap opens the full menu as before; while the
 *   panel is open, a tap on the button closes it instead.
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

/** How far a bubble's tail reaches up from its body, in page pixels. */
export const BUBBLE_TAIL = 6;

/**
 * What each player said, in a bubble under their head on the scoreboard at the top of the screen, so it never
 * covers the arena (the owner's asks, 24 November 2026: over the robot it was in the way; then the name over
 * the head and the chat under it, never down onto the arena or its walls). `say` puts one under a player's
 * head (replacing what it last said); `place` keeps them there, called every frame, with where each head's foot
 * is on the page (`at`, null for a player with no place on the scoreboard) and the room they may use.
 */
export function createBubbles(layer: HTMLElement, colourOf: (player: number) => string) {
  const shown = new Map<number, { el: HTMLElement; until: number; font: number }>();
  return {
    say(player: number, text: string): void {
      shown.get(player)?.el.remove();
      const el = document.createElement('div');
      el.className = 'bubble';
      const words = document.createElement('span');
      words.textContent = text; // (typed by a person: always text, never markup)
      el.append(words);
      el.style.setProperty('--who', colourOf(player));
      layer.append(el);
      shown.set(player, { el, until: performance.now() + BUBBLE_MS, font: 0 });
    },
    place(at: (player: number) => { x: number; y: number } | null, room: { left: number; right: number; bottom: number }): void {
      if (!shown.size) return;
      const now = performance.now();
      for (const [i, b] of shown) {
        const a = at(i);
        if (!a || now > b.until) {
          b.el.remove();
          shown.delete(i);
          continue;
        }
        // under the head, its tail pointing up at it, kept inside its room
        const y = a.y + 1 + BUBBLE_TAIL;
        // never past the bottom of its room (upright: the arena's top wall): smaller type until it fits
        if (y + b.el.offsetHeight > room.bottom && b.font !== 6) {
          b.font = Math.max(6, (b.font || parseFloat(getComputedStyle(b.el).fontSize)) - 1);
          b.el.style.fontSize = `${b.font}px`;
        }
        const bw = b.el.offsetWidth;
        const x = Math.max(room.left, Math.min(room.right - bw, a.x - bw / 2));
        b.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
        b.el.style.setProperty('--tail', `${Math.round(Math.max(10, Math.min(bw - 10, a.x - x)))}px`);
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
    panel.hidden = false;
    refresh();
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
    // open, a tap on the button closes it rather than opening the full menu (the owner's ask, 24 November 2026)
    if (!panel.hidden) {
      close();
      return;
    }
    tap();
  });
  outside(panel, btn, close);
  return { open, close, refresh, isOpen: () => !panel.hidden };
}
