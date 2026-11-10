/**
 * Keyboard and on-screen touch controls, merged into one input state.
 *
 * The game asks for state() once per tick and gets { dir, a, b }. Directions
 * come from the swipe pad (swipe.ts) or the keyboard; A and B from the two
 * on-screen buttons or the keyboard.
 */
import type { Dir, PlayerInput } from './sim';
import { SwipePad } from './swipe';

const KEY_DIR: Record<string, Dir> = {
  ArrowUp: 1, KeyW: 1,
  ArrowDown: 2, KeyS: 2,
  ArrowLeft: 3, KeyA: 3,
  ArrowRight: 4, KeyD: 4,
};
const KEY_A = new Set(['Space', 'KeyX', 'KeyJ', 'Enter']);
const KEY_B = new Set(['ShiftLeft', 'ShiftRight', 'KeyZ', 'KeyK']);

export class Input {
  private keyDirs: Dir[] = []; // most recent last
  private keyA = false;
  private keyB = false;
  readonly pad = new SwipePad();
  private touchA = false;
  private touchB = false;
  // A flick or tap can begin and end between two game ticks. These remember it
  // until the game has read it once, so no press is ever lost.
  private latchDir: Dir = 0;
  private latchA = false;
  private latchB = false;
  /** Called on every touch or key press; main.ts uses it to switch sound on (browsers need a gesture first). */
  onFirstGesture: (() => void) | null = null;

  /** Read once per game tick. */
  state(): PlayerInput {
    this.pad.poll(performance.now());
    const held = this.pad.dir || this.keyDirs[this.keyDirs.length - 1] || 0;
    const out: PlayerInput = {
      dir: (held || this.latchDir) as Dir,
      a: this.keyA || this.touchA || this.latchA,
      b: this.keyB || this.touchB || this.latchB,
    };
    this.latchDir = 0;
    this.latchA = this.latchB = false;
    return out;
  }

  /** Forget anything pressed before the round started. */
  reset(): void {
    this.latchDir = 0;
    this.latchA = this.latchB = false;
  }

  /** Arrow keys or WASD to move; Space, X, J or Enter for A; Shift, Z or K for B. */
  attachKeyboard(win: Window): void {
    win.addEventListener('keydown', (e) => {
      const d = KEY_DIR[e.code];
      if (d) {
        if (!this.keyDirs.includes(d)) {
          this.keyDirs.push(d);
          this.latchDir = d;
        }
        e.preventDefault();
      } else if (KEY_A.has(e.code)) {
        if (!e.repeat) this.latchA = true;
        this.keyA = true;
        if (e.code === 'Space') e.preventDefault();
      } else if (KEY_B.has(e.code)) {
        if (!e.repeat) this.latchB = true;
        this.keyB = true;
      }
      this.onFirstGesture?.();
    });
    win.addEventListener('keyup', (e) => {
      const d = KEY_DIR[e.code];
      if (d) this.keyDirs = this.keyDirs.filter((k) => k !== d);
      else if (KEY_A.has(e.code)) this.keyA = false;
      else if (KEY_B.has(e.code)) this.keyB = false;
    });
    win.addEventListener('blur', () => {
      this.keyDirs = [];
      this.keyA = this.keyB = false;
      this.pad.release();
      this.touchA = this.touchB = false;
      this.reset();
    });
  }

  /** Wire the on-screen swipe pad. The recogniser itself lives in swipe.ts. */
  attachDpad(zone: HTMLElement, glyph: HTMLElement): void {
    const pad = this.pad;
    let pointer = -1;
    const sync = (before: Dir): void => {
      if (pad.dir && pad.dir !== before) this.latchDir = pad.dir;
      glyph.dataset.dir = String(pad.dir);
    };
    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (pointer !== -1) return;
      pointer = e.pointerId;
      pad.press(e.clientX, e.clientY, performance.now());
      sync(0);
      zone.classList.add('on');
      try {
        zone.setPointerCapture(e.pointerId);
      } catch {
        /* capture is a nicety */
      }
      this.onFirstGesture?.();
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pointer) return;
      const before = pad.dir;
      const now = performance.now();
      // the browser may bundle several thumb positions into one event: use them all
      const parts = e.getCoalescedEvents?.() ?? [];
      if (parts.length > 1) for (const part of parts) pad.move(part.clientX, part.clientY, now);
      else pad.move(e.clientX, e.clientY, now);
      sync(before);
    });
    const end = (e: PointerEvent): void => {
      if (e.pointerId !== pointer) return;
      pointer = -1;
      pad.release();
      sync(0);
      zone.classList.remove('on');
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  /** Wire one of the two on-screen buttons. It counts as held while any finger is on it. */
  attachButton(el: HTMLElement, which: 'a' | 'b'): void {
    const pointers = new Set<number>();
    const sync = (): void => {
      const on = pointers.size > 0;
      if (which === 'a') this.touchA = on;
      else this.touchB = on;
      el.classList.toggle('on', on);
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pointers.add(e.pointerId);
      if (which === 'a') this.latchA = true;
      else this.latchB = true;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* capture is a nicety */
      }
      sync();
      this.onFirstGesture?.();
    });
    const up = (e: PointerEvent): void => {
      pointers.delete(e.pointerId);
      sync();
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }
}
