/**
 * Keyboard, game controller and on-screen touch controls, merged into one input state.
 *
 * The game asks for state() once per tick and gets { dir, a, b }. Directions come from the swipe pad
 * (swipe.ts), the keyboard, or a controller's left stick and D-pad; A and B from the two on-screen buttons,
 * the keys or the controller's buttons given to Drop bomb and Lift and throw (bindings.ts, changed in
 * Settings › Controls).
 *
 * A controller is read once a frame (`pollGamepad`, from main.ts). The menus read its presses from here too
 * (`padPressed`, `padDir`; menu moves are in padnav.ts). While Settings is waiting for a new key or button
 * (`capture`), presses go there and nowhere else.
 */
import type { Dir, PlayerInput } from './sim';
import { SwipePad } from './swipe';
import { KeyMap, PadMap, PAD, defaultKeys, defaultPad, keyAction, normKey } from './bindings';

/** How far the left stick must lean to count, and how far the way it is already going may fall before it lets go. */
const STICK_ON = 0.42;
const STICK_HOLD = 0.3;
/** How much stronger the other direction must be to take over from the one held (so a diagonal does not flicker). */
const STICK_SWITCH = 1.25;

/** A key or button pressed while Settings waits for one. */
export type Caught = { kind: 'key'; code: string } | { kind: 'pad'; button: number };
/** Which kind of control was used last: for the hints on the menus' buttons. */
export type Device = 'touch' | 'keys' | 'pad';

const ACTION_DIR: Record<string, Dir> = { up: 1, down: 2, left: 3, right: 4 };

/** True when a key press is going into a text box (the lobby's name field), so the game leaves it alone. */
export function typing(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'text' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

export class Input {
  private keys: KeyMap = defaultKeys();
  private padKeys: PadMap = defaultPad();
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
  /** Called when a key or button given to Pause is pressed (main.ts opens or closes the menu). */
  onPause: (() => void) | null = null;
  /** Called when the kind of control in use changes. */
  onDevice: ((d: Device) => void) | null = null;
  /** While set, the next key or controller button goes here, and nowhere else (Settings › Controls). */
  capture: ((c: Caught) => void) | null = null;
  // the controller
  private padOn: boolean[] = [];
  private padWas: boolean[] = [];
  /** buttons held when a round started, not counted until let go (the A that pressed Start is not a bomb) */
  private padIgnore = new Set<number>();
  private stickDir: Dir = 0;
  private padHeldDir: Dir = 0;
  private padA = false;
  private padB = false;
  private padIndex = -1;
  /** the name of the controller in use, or '' */
  padId = '';
  private device: Device = 'touch';

  /** Use these keys and controller buttons (Settings › Controls). */
  setBindings(keys: KeyMap, pad: PadMap): void {
    this.keys = keys;
    this.padKeys = pad;
    this.keyDirs = [];
    this.keyA = this.keyB = false;
  }

  private used(d: Device): void {
    if (d === this.device) return;
    this.device = d;
    this.onDevice?.(d);
  }
  /** The touch screen was used (main.ts reports taps anywhere). */
  touched(): void {
    this.used('touch');
  }

  /**
   * Read the controller: once a frame. Its left stick or D-pad gives a direction, the buttons given to
   * Drop bomb and Lift and throw give A and B, and a press of one given to Pause calls onPause.
   */
  pollGamepad(): void {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    let gp: Gamepad | null = null;
    for (const p of pads) if (p && p.connected) {
      gp = p;
      break;
    }
    this.padWas = this.padOn;
    if (!gp) {
      this.padOn = [];
      this.padId = '';
      this.padIndex = -1;
      this.padHeldDir = 0;
      this.padA = this.padB = false;
      return;
    }
    this.padIndex = gp.index;
    this.padId = gp.id;
    this.padOn = gp.buttons.map((b) => b.pressed || b.value > 0.5);
    for (const b of [...this.padIgnore]) if (!this.padOn[b]) this.padIgnore.delete(b);
    // the stick: the stronger way wins, and the way already held keeps going until it is clearly let go or overtaken
    const x = gp.axes[0] ?? 0;
    const y = gp.axes[1] ?? 0;
    const along = (d: Dir): number => (d === 1 ? -y : d === 2 ? y : d === 3 ? -x : d === 4 ? x : 0);
    const strongest: Dir = Math.abs(x) > Math.abs(y) ? (x < 0 ? 3 : 4) : y < 0 ? 1 : 2;
    if (this.stickDir && along(this.stickDir) > STICK_HOLD && along(strongest) < along(this.stickDir) * STICK_SWITCH) {
      /* keep it */
    } else this.stickDir = along(strongest) > STICK_ON ? strongest : 0;
    const on = (b: number): boolean => !!this.padOn[b];
    const dpad: Dir = on(PAD.UP) ? 1 : on(PAD.DOWN) ? 2 : on(PAD.LEFT) ? 3 : on(PAD.RIGHT) ? 4 : 0;
    const dir = dpad || this.stickDir;
    if (dir && dir !== this.padHeldDir) this.latchDir = dir;
    this.padHeldDir = dir;
    const anyNew = this.padOn.some((v, i) => v && !this.padWas[i]);
    if (anyNew || dir) this.used('pad');
    // a new press while Settings waits for a button goes there only
    if (this.capture) {
      for (let b = 0; b < this.padOn.length; b++) if (this.padOn[b] && !this.padWas[b]) {
        // the menus must not see it too (B would close the "swap them?" box it opens)
        this.padIgnore.add(b);
        this.capture({ kind: 'pad', button: b });
        break;
      }
      this.padA = this.padB = false;
      return;
    }
    const live = (b: number): boolean => on(b) && !this.padIgnore.has(b);
    const fresh = (b: number): boolean => live(b) && !this.padWas[b];
    this.padA = this.padKeys.bomb.some(live);
    this.padB = this.padKeys.lift.some(live);
    if (this.padKeys.bomb.some(fresh)) this.latchA = true;
    if (this.padKeys.lift.some(fresh)) this.latchB = true;
    if (anyNew) this.onFirstGesture?.();
  }
  /** Was this controller button pressed since the last frame? (For the menus.) */
  padPressed(b: number): boolean {
    return !!this.padOn[b] && !this.padWas[b] && !this.capture && !this.padIgnore.has(b);
  }
  /** Is a button given to Pause newly pressed? */
  padPause(): boolean {
    return this.padKeys.pause.some((b) => this.padPressed(b));
  }
  /** The way the controller's stick or D-pad points now. */
  padDir(): Dir {
    return this.capture ? 0 : this.padHeldDir;
  }
  /** A controller is connected. */
  padConnected(): boolean {
    return this.padIndex >= 0;
  }
  /** Shake the controller, if it can (a knockout, a blast close by). Strengths 0 to 1. */
  rumble(strong: number, weak: number, ms: number): void {
    if (this.padIndex < 0) return;
    const gp = navigator.getGamepads?.()[this.padIndex];
    const act = (gp as unknown as { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } } | null)?.vibrationActuator;
    act?.playEffect?.('dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: strong, weakMagnitude: weak })?.catch?.(() => undefined);
  }

  /** Read once per game tick. */
  state(): PlayerInput {
    this.pad.poll(performance.now());
    const held = this.pad.dir || this.keyDirs[this.keyDirs.length - 1] || this.padHeldDir || 0;
    const out: PlayerInput = {
      dir: (held || this.latchDir) as Dir,
      a: this.keyA || this.touchA || this.padA || this.latchA,
      b: this.keyB || this.touchB || this.padB || this.latchB,
    };
    this.latchDir = 0;
    this.latchA = this.latchB = false;
    return out;
  }

  /** Forget anything pressed before the round started. */
  reset(): void {
    this.latchDir = 0;
    this.latchA = this.latchB = false;
    // controller buttons held now (the A that pressed Start) count only once they have been let go
    this.padIgnore = new Set(this.padOn.flatMap((v, i) => (v ? [i] : [])));
    this.padA = this.padB = false;
  }

  /**
   * The keyboard, with the keys from Settings › Controls (by default WASD or the arrows to move; Space, J or
   * X for A; Shift, K or Z for B; P to pause). Not while typing in a text box, and not while Settings waits
   * for a new key (`capture`), which gets the key instead.
   */
  attachKeyboard(win: Window): void {
    win.addEventListener(
      'keydown',
      (e) => {
        if (typing(e)) return; // typing a name: the keys are letters, not moves
        if (this.capture) {
          if (e.repeat) return;
          e.preventDefault();
          e.stopImmediatePropagation(); // nothing else hears it, not even Escape's "go back"
          this.capture({ kind: 'key', code: normKey(e.code) });
          return;
        }
        this.used('keys');
        const act = keyAction(this.keys, e.code);
        const d = act ? ACTION_DIR[act] : 0;
        if (d) {
          if (!this.keyDirs.includes(d)) {
            this.keyDirs.push(d);
            this.latchDir = d;
          }
          e.preventDefault();
        } else if (act === 'bomb') {
          if (!e.repeat) this.latchA = true;
          this.keyA = true;
          if (e.code === 'Space') e.preventDefault();
        } else if (act === 'lift') {
          if (!e.repeat) this.latchB = true;
          this.keyB = true;
        } else if (act === 'pause' && !e.repeat) this.onPause?.();
        this.onFirstGesture?.();
      },
      true,
    );
    win.addEventListener('keyup', (e) => {
      const act = keyAction(this.keys, e.code);
      const d = act ? ACTION_DIR[act] : 0;
      if (d) this.keyDirs = this.keyDirs.filter((k) => k !== d);
      else if (act === 'bomb') this.keyA = false;
      else if (act === 'lift') this.keyB = false;
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
