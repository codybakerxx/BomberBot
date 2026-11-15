/**
 * Which keys and controller buttons do what: the defaults, their names, and reading saved ones.
 *
 * The keyboard can change every action: the four moves, Drop bomb (the A button), Lift and throw (B) and
 * Pause, with up to three keys each. A controller can change Drop bomb, Lift and throw and Pause, with up
 * to two buttons each; it always moves with the left stick and the D-pad. Some keys and buttons are never
 * changed, so nobody can lock themselves out of the menus: Escape and Tab on the keyboard; in the menus,
 * the D-pad and stick move, A picks, B goes back, LB and RB turn pages, Y is Ready and ≡ (Menu) starts.
 *
 * Changed in Settings › Controls (remap.ts), saved with your settings (`Prefs.keys`, `Prefs.padKeys`).
 * Keys are KeyboardEvent.code values ("KeyW", "Space"); controller buttons are the standard gamepad layout's
 * numbers (0 is A on an Xbox controller).
 */

export type Action = 'up' | 'down' | 'left' | 'right' | 'bomb' | 'lift' | 'pause';
export type PadAction = 'bomb' | 'lift' | 'pause';

export const ACTIONS: { id: Action; name: string }[] = [
  { id: 'up', name: 'Up' },
  { id: 'down', name: 'Down' },
  { id: 'left', name: 'Left' },
  { id: 'right', name: 'Right' },
  { id: 'bomb', name: 'Drop bomb (A)' },
  { id: 'lift', name: 'Lift and throw (B)' },
  { id: 'pause', name: 'Pause' },
];
export const PAD_ACTIONS: { id: PadAction; name: string }[] = [
  { id: 'bomb', name: 'Drop bomb' },
  { id: 'lift', name: 'Lift and throw' },
  { id: 'pause', name: 'Pause' },
];

/** How many keys or buttons one action can have. */
export const KEY_SLOTS = 3;
export const PAD_SLOTS = 2;

export type KeyMap = Record<Action, string[]>;
export type PadMap = Record<PadAction, number[]>;

/** The keys before any change: what the game has always used, with P added for Pause. */
export function defaultKeys(): KeyMap {
  return {
    up: ['KeyW', 'ArrowUp'],
    down: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
    bomb: ['Space', 'KeyJ', 'KeyX'],
    lift: ['ShiftLeft', 'KeyK', 'KeyZ'],
    pause: ['KeyP'],
  };
}
/** The controller's buttons before any change: A or RT drops a bomb, B or LT lifts and throws, ≡ pauses. */
export function defaultPad(): PadMap {
  return { bomb: [0, 7], lift: [1, 6], pause: [9] };
}

/** Keys that are never given to an action: they always do their own job. */
export const FIXED_KEYS = new Set(['Escape', 'Tab']);

/** The standard gamepad layout's buttons, by number, as an Xbox controller labels them. */
export const PAD_BUTTONS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', '≡', 'Left stick', 'Right stick', 'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right', 'Xbox'];
/** Buttons that can be given to Drop bomb, Lift and throw or Pause (not the D-pad, which moves). */
export const PAD_BINDABLE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
export const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

/** The right-hand Shift, Ctrl and Alt count as the left-hand ones. */
export function normKey(code: string): string {
  return /^(Shift|Control|Alt|Meta)Right$/.test(code) ? code.replace(/Right$/, 'Left') : code;
}

/** A key as people say it: "W", "↑", "Space", "Shift". */
export function keyName(code: string): string {
  const arrows: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
  if (arrows[code]) return arrows[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return `Num ${code.slice(6)}`;
  const named: Record<string, string> = {
    ShiftLeft: 'Shift', ControlLeft: 'Ctrl', AltLeft: 'Alt', MetaLeft: 'Cmd', Space: 'Space', Enter: 'Enter', Backspace: 'Backspace',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`', CapsLock: 'Caps Lock',
  };
  return named[code] ?? code;
}
export function padName(button: number): string {
  return PAD_BUTTONS[button] ?? `Button ${button}`;
}

/** The action a key is given to, or null. */
export function keyAction(keys: KeyMap, code: string): Action | null {
  const c = normKey(code);
  for (const a of ACTIONS) if (keys[a.id].includes(c)) return a.id;
  return null;
}
export function padAction(pad: PadMap, button: number): PadAction | null {
  for (const a of PAD_ACTIONS) if (pad[a.id].includes(button)) return a.id;
  return null;
}

/** Read saved keys, keeping only what looks right: strings, no fixed keys, no key given twice. */
export function readKeys(raw: unknown): KeyMap {
  const d = defaultKeys();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const out = {} as KeyMap;
  const used = new Set<string>();
  for (const a of ACTIONS) {
    const list = Array.isArray(r[a.id]) ? (r[a.id] as unknown[]) : d[a.id];
    out[a.id] = [];
    for (const k of list) {
      if (typeof k !== 'string' || !k || FIXED_KEYS.has(k) || used.has(k) || out[a.id].length >= KEY_SLOTS) continue;
      used.add(k);
      out[a.id].push(k);
    }
  }
  return out;
}
export function readPad(raw: unknown): PadMap {
  const d = defaultPad();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const out = {} as PadMap;
  const used = new Set<number>();
  for (const a of PAD_ACTIONS) {
    const list = Array.isArray(r[a.id]) ? (r[a.id] as unknown[]) : d[a.id];
    out[a.id] = [];
    for (const b of list) {
      if (typeof b !== 'number' || !PAD_BINDABLE.includes(b) || used.has(b) || out[a.id].length >= PAD_SLOTS) continue;
      used.add(b);
      out[a.id].push(b);
    }
  }
  return out;
}
