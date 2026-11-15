/**
 * Getting round the menus with a controller.
 *
 * The D-pad or left stick moves the highlight to the nearest button in that direction, within whatever is
 * on top (an "are you sure?" box, a CPU player's panel, Settings, the lobby, the menu, the result panel or
 * the title). Held, it repeats. On a slider or a ‹ value › setting, left and right change the value instead.
 * A presses the highlighted button. The rest is handed to main.ts (`PadNavHost`): B goes back, LB and RB
 * turn pages, Y is Ready, ≡ (Menu) starts the match from the lobby or opens and closes the menu in a round.
 * These menu buttons are fixed: remapping (bindings.ts) changes only what they do in a round.
 */
import type { Dir } from './sim';
import type { Input } from './input';
import { PAD } from './bindings';

export interface PadNavHost {
  /** the part of the page on top, whose buttons the highlight moves between, or null when none is */
  top(): HTMLElement | null;
  back(): void;
  turn(d: number): void;
  ready(): void;
  menu(): void;
}

/** Hold a direction this long before it repeats, then repeat this often (milliseconds). */
const REPEAT_AFTER = 380;
const REPEAT_EVERY = 120;

const FOCUSABLE = 'button, input, output[tabindex], a[href], [tabindex="0"]';

/** Can this element be highlighted? Drawn on the page, not switched off. */
function usable(el: HTMLElement): boolean {
  if ((el as HTMLButtonElement).disabled) return false;
  // (not `[hidden]`: on a wide screen the lobby shows both its pages, the hidden one too)
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none';
}

/** The nearest usable element from `from` in direction `d` within `root`: straight ahead counts most. */
function nearest(root: HTMLElement, from: HTMLElement | null, d: Dir): HTMLElement | null {
  const all = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(usable);
  if (!from || !root.contains(from) || !usable(from)) return all[0] ?? null;
  const a = from.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of all) {
    if (el === from) continue;
    const b = el.getBoundingClientRect();
    const bx = b.left + b.width / 2;
    const by = b.top + b.height / 2;
    const dx = bx - ax;
    const dy = by - ay;
    // how far ahead, and how far off to the side
    const ahead = d === 1 ? -dy : d === 2 ? dy : d === 3 ? -dx : dx;
    const side = d === 1 || d === 2 ? Math.abs(dx) : Math.abs(dy);
    // overlapping rows or columns count as straight ahead
    const lined = d === 1 || d === 2 ? b.right > a.left && b.left < a.right : b.bottom > a.top && b.top < a.bottom;
    if (ahead <= 4) continue;
    const score = ahead + (lined ? 0 : side * 2.2);
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

/** Left and right on a slider or a ‹ value ›: change the value. Returns true if it did. */
function nudge(el: HTMLElement, d: Dir): boolean {
  if (d !== 3 && d !== 4) return false;
  if (el instanceof HTMLInputElement && el.type === 'range') {
    if (d === 3) el.stepDown();
    else el.stepUp();
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  if (el.getAttribute('role') === 'spinbutton') {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: d === 3 ? 'ArrowLeft' : 'ArrowRight', bubbles: true }));
    return true;
  }
  return false;
}

export function createPadNav(input: Input, host: PadNavHost): { step(now: number, inMenus: boolean): void } {
  let heldDir: Dir = 0;
  let nextAt = 0;
  return {
    /** Once a frame, after the controller has been read. `inMenus`: a menu or screen is up (not a round in play). */
    step(now: number, inMenus: boolean): void {
      if (input.padPause() || input.padPressed(PAD.MENU)) {
        host.menu();
        return;
      }
      if (!inMenus) {
        heldDir = 0;
        return;
      }
      const top = host.top();
      if (!top) return;
      const d = input.padDir();
      if (d !== heldDir) {
        heldDir = d;
        nextAt = now + REPEAT_AFTER;
        if (d) move(top, d);
      } else if (d && now >= nextAt) {
        nextAt = now + REPEAT_EVERY;
        move(top, d);
      }
      if (input.padPressed(PAD.A)) {
        const el = document.activeElement as HTMLElement | null;
        if (el && top.contains(el) && usable(el)) {
          if (el instanceof HTMLInputElement && el.type === 'text') el.focus();
          else el.click();
        } else nearest(top, null, 2)?.focus({ preventScroll: true });
      }
      if (input.padPressed(PAD.B)) host.back();
      if (input.padPressed(PAD.LB)) host.turn(-1);
      if (input.padPressed(PAD.RB)) host.turn(1);
      if (input.padPressed(PAD.Y)) host.ready();
    },
  };

  function move(top: HTMLElement, d: Dir): void {
    const cur = document.activeElement as HTMLElement | null;
    if (cur && top.contains(cur) && usable(cur) && nudge(cur, d)) return;
    const next = nearest(top, cur, d);
    if (next) {
      next.focus({ preventScroll: true });
      next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }
}
