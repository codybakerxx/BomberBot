/**
 * Keyboard, game controller and on-screen touch controls, merged into one input state.
 *
 * The game asks for state() once per tick and gets { dir, a, b }. Directions come from the swipe pad
 * (swipe.ts), the keyboard, or a controller's left stick and D-pad; A and B from the two on-screen buttons,
 * the keys or the controller's buttons given to Drop bomb and Lift and throw (bindings.ts, changed in
 * Settings › Controls).
 *
 * Every controller is read once a frame (`pollGamepad`, from main.ts), each by its own `PadReader`. One of
 * them is yours (P1's, `mine`): it plays for you and works the menus (`padPressed`, `padDir`; menu moves are
 * in padnav.ts). The first press on a controller that is nobody's yet asks main.ts what it is (`claim`): yours,
 * or a new player joining in the lobby (couch play), whose robot then reads its own `PadReader`. While
 * Settings is waiting for a new key or button (`capture`), presses go there and nowhere else.
 */
import { AIM_STEPS, TURN_STEPS, type Dir, type PlayerInput } from './sim';
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

/**
 * Which way (vx right, vy down) points, as a PlayerInput aim: AIM_STEPS steps of a turn clockwise from right.
 * For steering the laptop's plane, at any angle. (Math.atan2 is fine here: the aim is worked out once, on the
 * player's own device, and sent as a whole number; the rules never use it.)
 */
export function aimOf(vx: number, vy: number): number | undefined {
  if (!vx && !vy) return undefined;
  const turns = Math.atan2(vy, vx) / (2 * Math.PI);
  return ((Math.round(turns * AIM_STEPS) % AIM_STEPS) + AIM_STEPS) % AIM_STEPS;
}
/**
 * Steering the laptop's plane like a pilot (Settings › Controls › Inverse plane controls, on by default: the
 * owner's ask, 19 November 2026): left and right turn the plane to its own left and right, whichever way it is
 * flying (flying down the screen, left turns it towards the screen's right); up, down or nothing flies it straight
 * on. Given as an aim a quarter turn to that side of where it is heading, so the rules turn it as fast as a plane
 * turns for as long as the direction is held. The rules and what is sent online are as before: only the aim
 * differs. `planeDir` is the plane's heading in TURN_STEPS.
 */
export function pilotAim(dir: Dir, planeDir: number): number | undefined {
  const turn = dir === 3 ? -1 : dir === 4 ? 1 : 0;
  if (!turn) return undefined;
  const at = Math.round((planeDir * AIM_STEPS) / TURN_STEPS) + (turn * AIM_STEPS) / 4;
  return ((at % AIM_STEPS) + AIM_STEPS) % AIM_STEPS;
}

/** The aim of the directions held together (keys, a controller's D-pad): eight ways. */
function aimOfDirs(held: (d: Dir) => boolean): number | undefined {
  return aimOf((held(4) ? 1 : 0) - (held(3) ? 1 : 0), (held(2) ? 1 : 0) - (held(1) ? 1 : 0));
}

/** True when a key press is going into a text box (the lobby's name field), so the game leaves it alone. */
export function typing(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'text' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

/**
 * One controller: its stick and D-pad as one direction, the buttons given to Drop bomb and Lift and throw as
 * A and B, and what was newly pressed this frame. A press between two game ticks is kept until it is read.
 */
export class PadReader {
  on: boolean[] = [];
  was: boolean[] = [];
  /** buttons not counted until let go (held when a round started, or taken by Settings or by joining) */
  ignore = new Set<number>();
  private stickDir: Dir = 0;
  heldDir: Dir = 0;
  private latchDir: Dir = 0;
  a = false;
  b = false;
  /** the stick or D-pad at any angle, for steering a plane (aimOf), or undefined */
  aim: number | undefined = undefined;
  private latchA = false;
  private latchB = false;
  /** the controller's name, as the browser gives it */
  id = '';
  constructor(readonly index: number) {}

  /** Read it: once a frame. Returns true if a button was newly pressed. */
  read(gp: Gamepad, keys: PadMap): boolean {
    this.id = gp.id;
    this.was = this.on;
    this.on = gp.buttons.map((b) => b.pressed || b.value > 0.5);
    for (const b of [...this.ignore]) if (!this.on[b]) this.ignore.delete(b);
    // the stick: the stronger way wins, and the way already held keeps going until it is clearly let go or overtaken
    const x = gp.axes[0] ?? 0;
    const y = gp.axes[1] ?? 0;
    const along = (d: Dir): number => (d === 1 ? -y : d === 2 ? y : d === 3 ? -x : d === 4 ? x : 0);
    const strongest: Dir = Math.abs(x) > Math.abs(y) ? (x < 0 ? 3 : 4) : y < 0 ? 1 : 2;
    if (this.stickDir && along(this.stickDir) > STICK_HOLD && along(strongest) < along(this.stickDir) * STICK_SWITCH) {
      /* keep it */
    } else this.stickDir = along(strongest) > STICK_ON ? strongest : 0;
    const on = (b: number): boolean => !!this.on[b];
    const dpad: Dir = on(PAD.UP) ? 1 : on(PAD.DOWN) ? 2 : on(PAD.LEFT) ? 3 : on(PAD.RIGHT) ? 4 : 0;
    const dir = dpad || this.stickDir;
    if (dir && dir !== this.heldDir) this.latchDir = dir;
    this.heldDir = dir;
    // for a plane: the D-pad's eight ways, or the stick at any angle once it leans far enough
    const pads: Record<number, number> = { 1: PAD.UP, 2: PAD.DOWN, 3: PAD.LEFT, 4: PAD.RIGHT };
    this.aim = dpad ? aimOfDirs((d) => on(pads[d])) : Math.hypot(x, y) > STICK_ON ? aimOf(x, y) : undefined;
    const live = (b: number): boolean => on(b) && !this.ignore.has(b);
    const fresh = (b: number): boolean => live(b) && !this.was[b];
    this.a = keys.bomb.some(live);
    this.b = keys.lift.some(live);
    if (keys.bomb.some(fresh)) this.latchA = true;
    if (keys.lift.some(fresh)) this.latchB = true;
    return this.on.some((v, i) => v && !this.was[i]);
  }
  /** Was this button pressed since the last frame (and not set aside)? */
  pressed(b: number): boolean {
    return !!this.on[b] && !this.was[b] && !this.ignore.has(b);
  }
  /** The first button newly pressed this frame, or -1. */
  firstNew(): number {
    return this.on.findIndex((v, i) => v && !this.was[i]);
  }
  /** Let go of everything, as if nothing were pressed (it was unplugged). */
  clear(): void {
    this.on = [];
    this.was = [];
    this.heldDir = this.stickDir = 0;
    this.a = this.b = false;
    this.aim = undefined;
  }
  /** For a robot this controller drives: once per tick. */
  state(): PlayerInput {
    const out: PlayerInput = { dir: (this.heldDir || this.latchDir) as Dir, a: this.a || this.latchA, b: this.b || this.latchB };
    if (this.aim !== undefined) out.aim = this.aim;
    this.latchDir = 0;
    this.latchA = this.latchB = false;
    return out;
  }
  /** Forget what was pressed before the round started; buttons held now count once let go (the A that pressed Start). */
  reset(): void {
    this.latchDir = 0;
    this.latchA = this.latchB = false;
    this.ignore = new Set(this.on.flatMap((v, i) => (v ? [i] : [])));
    this.a = this.b = false;
  }
  /** Shake it, if it can. Strengths 0 to 1. */
  rumble(strong: number, weak: number, ms: number): void {
    const gp = navigator.getGamepads?.()[this.index];
    const act = (gp as unknown as { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } } | null)?.vibrationActuator;
    act?.playEffect?.('dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: strong, weakMagnitude: weak })?.catch?.(() => undefined);
  }
}

/** What a controller that is nobody's yet becomes on its first press: yours, a new player's, or nothing (yet). */
export type Claim = 'mine' | 'join' | 'ignore';

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
  /**
   * The touch controls' own record of which fingers are down, cleared by `dropTouches`. A phone can lose a
   * finger's lift (the menu opening over the controls while a finger is on them, the app going to the
   * background, a system swipe): the pad then believed the old thumb was still down and ignored every new
   * touch, and A stayed held into the next round, where it read as a fresh press and dropped a bomb
   * (the owner's two reports, 27 November 2026).
   */
  private touchClears: ((keep: number) => void)[] = [];
  /** the finger that last came down on the touch controls (see `staleTouches`) */
  private lastDown = -1;
  /** Called on every touch or key press; main.ts uses it to switch sound on (browsers need a gesture first). */
  onFirstGesture: (() => void) | null = null;
  /** Called when a key or button given to Pause is pressed (main.ts opens or closes the menu). */
  onPause: (() => void) | null = null;
  /** Called when the kind of control in use changes. */
  onDevice: ((d: Device) => void) | null = null;
  /** While set, the next key or controller button goes here, and nowhere else (Settings › Controls). */
  capture: ((c: Caught) => void) | null = null;
  // the controllers, by the browser's number for each
  private readers = new Map<number, PadReader>();
  /** the browser's number for your controller, or -1 for none yet */
  mineIndex = -1;
  /** the numbers of controllers other players have joined with (couch play): not yours, and not asked about */
  others = new Set<number>();
  /** Asked on the first press of a controller that is nobody's yet: what is it? (main.ts decides.) */
  claim: ((index: number, button: number) => Claim) | null = null;
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
   * Read every controller: once a frame. Yours gives a direction and A and B; a press of a button given to
   * Pause on it calls onPause. The first press on one that is nobody's asks `claim` what it is.
   */
  pollGamepad(): void {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const seen = new Set<number>();
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      seen.add(gp.index);
      let r = this.readers.get(gp.index);
      if (!r) this.readers.set(gp.index, (r = new PadReader(gp.index)));
      const anyNew = r.read(gp, this.padKeys);
      if (anyNew || (r.heldDir && gp.index === this.mineIndex)) this.used('pad');
      if (anyNew) this.onFirstGesture?.();
      // a new press while Settings waits for a button goes there only (from any controller), and the menus
      // must not see it too (B would close the "swap them?" box it opens)
      if (this.capture && anyNew) {
        const b = r.firstNew();
        r.ignore.add(b);
        this.capture({ kind: 'pad', button: b });
        continue;
      }
      if (anyNew && gp.index !== this.mineIndex && !this.others.has(gp.index)) {
        const b = r.firstNew();
        const c = this.claim ? this.claim(gp.index, b) : this.mineIndex < 0 ? 'mine' : 'ignore';
        if (c === 'mine') this.mineIndex = gp.index;
        else if (c === 'join') r.ignore.add(b); // the press that joined is not also Ready
      }
    }
    for (const [i, r] of this.readers) if (!seen.has(i)) {
      r.clear();
      this.readers.delete(i);
      if (i === this.mineIndex) this.mineIndex = -1;
    }
  }
  /** Your controller's reader, if you have one. */
  mine(): PadReader | null {
    return this.readers.get(this.mineIndex) ?? null;
  }
  /** A controller's reader, by the browser's number for it. */
  reader(index: number): PadReader | null {
    return this.readers.get(index) ?? null;
  }
  /** Was this button newly pressed on your controller? (For the menus.) */
  padPressed(b: number): boolean {
    return !this.capture && !!this.mine()?.pressed(b);
  }
  /** Is a button given to Pause newly pressed on your controller? */
  padPause(): boolean {
    return this.padKeys.pause.some((b) => this.padPressed(b));
  }
  /** Was a button given to Pause newly pressed on this controller? */
  pausePressed(r: PadReader): boolean {
    return !this.capture && this.padKeys.pause.some((b) => r.pressed(b));
  }
  /** The way your controller's stick or D-pad points now. */
  padDir(): Dir {
    return this.capture ? 0 : (this.mine()?.heldDir ?? 0);
  }
  /** How many controllers are connected. */
  padCount(): number {
    return this.readers.size;
  }
  /** A controller is connected (any). */
  padConnected(): boolean {
    return this.readers.size > 0;
  }
  /** The name of your controller, or of the first one connected. */
  get padId(): string {
    return (this.mine() ?? [...this.readers.values()][0])?.id ?? '';
  }
  /** Shake your controller, if it can (a knockout, a blast close by). Strengths 0 to 1. */
  rumble(strong: number, weak: number, ms: number): void {
    this.mine()?.rumble(strong, weak, ms);
  }

  /**
   * Read once per game tick. The aim (for steering a plane: the laptop) is the swipe pad's at any angle while a
   * thumb is on it, else the keys held together (eight ways), else your controller's stick or D-pad.
   */
  state(): PlayerInput {
    this.pad.poll(performance.now());
    const p = this.mine()?.state() ?? { dir: 0 as Dir, a: false, b: false };
    const held = this.pad.dir || this.keyDirs[this.keyDirs.length - 1] || 0;
    const out: PlayerInput = {
      dir: (held || this.latchDir || p.dir) as Dir,
      a: this.keyA || this.touchA || this.latchA || p.a,
      b: this.keyB || this.touchB || this.latchB || p.b,
    };
    const thumb = this.pad.pointing();
    const aim = thumb ? aimOf(thumb[0], thumb[1]) : this.keyDirs.length ? aimOfDirs((d) => this.keyDirs.includes(d)) : p.aim;
    if (aim !== undefined) out.aim = aim;
    this.latchDir = 0;
    this.latchA = this.latchB = false;
    return out;
  }

  /**
   * Forget anything pressed before the round started (or before the menu closed). A and B count again only
   * once pressed afresh: a key held through it, or a finger the phone never said was lifted, would otherwise
   * read as a press on the round's first tick and drop a bomb.
   */
  reset(): void {
    this.latchDir = 0;
    this.latchA = this.latchB = false;
    this.keyA = this.keyB = false;
    this.dropTouches(-1);
    // controller buttons held now (the A that pressed Start) count only once they have been let go
    for (const r of this.readers.values()) r.reset();
  }

  /** Let go of every finger the touch controls think is down, but `keep`. */
  private dropTouches(keep: number): void {
    for (const clear of this.touchClears) clear(keep);
  }

  /**
   * A finger has come down and it is the only one on the screen (`e.touches`, the browser's own list): any
   * other finger the touch controls still think is down was lifted without their hearing of it. Let go of
   * those, so the new touch works at once. (Pointer events come before touch events, so the new finger's
   * pointerdown has been seen: `lastDown`.)
   */
  staleTouches(e: TouchEvent): void {
    if (e.touches.length === 1) this.dropTouches(this.lastDown);
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
          // (only a real press: a key held since before the round's reset, repeating, does not count)
          if (!e.repeat) this.latchA = this.keyA = true;
          if (e.code === 'Space') e.preventDefault();
        } else if (act === 'lift') {
          if (!e.repeat) this.latchB = this.keyB = true;
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
    // a second finger landing while the thumb is on the pad is ignored; kept here in case the thumb turns out
    // to have been lifted unheard (`staleTouches`), when this finger takes over at once
    let waiting: { id: number; x: number; y: number } | null = null;
    const startStroke = (id: number, x: number, y: number): void => {
      pointer = id;
      waiting = null;
      pad.press(x, y, performance.now());
      sync(0);
      zone.classList.add('on');
      try {
        zone.setPointerCapture(id);
      } catch {
        /* capture is a nicety */
      }
    };
    this.touchClears.push((keep) => {
      if (pointer !== -1 && pointer !== keep) {
        pointer = -1;
        pad.release();
        sync(0);
        zone.classList.remove('on');
        if (waiting && waiting.id === keep) startStroke(waiting.id, waiting.x, waiting.y);
      }
      if (keep === -1) waiting = null;
    });
    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.lastDown = e.pointerId;
      if (pointer !== -1) {
        waiting = { id: e.pointerId, x: e.clientX, y: e.clientY };
        return;
      }
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
      if (waiting && e.pointerId === waiting.id) waiting = null;
      if (e.pointerId !== pointer) return;
      pointer = -1;
      pad.release();
      sync(0);
      zone.classList.remove('on');
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    zone.addEventListener('lostpointercapture', end);
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
    this.touchClears.push((keep) => {
      for (const id of [...pointers]) if (id !== keep) pointers.delete(id);
      sync();
    });
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.lastDown = e.pointerId;
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
    el.addEventListener('lostpointercapture', up);
  }
}
