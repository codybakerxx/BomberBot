/**
 * Settings › Controls (keys) and Settings › Gamepad (buttons): changing which keys and controller buttons do what (bindings.ts).
 *
 * Each action has a row of boxes, one per key or button it has (up to three keys, two buttons), and an
 * empty box to add one. Tap a box (or pick it with Enter or A) and it waits for the new key or button:
 * - the key or button pressed takes that box;
 * - if another action has it, the game asks whether to swap them;
 * - Backspace or Delete empties the box; Escape, or tapping the box again, leaves it as it was;
 * - after eight seconds it gives up and leaves it as it was.
 * Reset puts all the keys (or all the buttons) back as they were, and asks first.
 *
 * Escape and Tab are never given to an action, and the controller's D-pad always moves, so the menus can
 * always be reached. Everything is saved at once (main.ts's `onChange`).
 */
import type { Input, Caught } from './input';
import {
  ACTIONS,
  FIXED_KEYS,
  KEY_SLOTS,
  KeyMap,
  PAD_ACTIONS,
  PAD_BINDABLE,
  PAD_SLOTS,
  PadMap,
  defaultKeys,
  defaultPad,
  keyName,
  padName,
} from './bindings';
import { confirmFirst } from './ui';

export interface RemapHost {
  keys(): KeyMap;
  pad(): PadMap;
  setKeys(k: KeyMap): void;
  setPad(p: PadMap): void;
  rumble(): boolean;
  setRumble(on: boolean): void;
}

/** How long a box waits for a key or button, in milliseconds. */
const WAIT_MS = 8000;

const $ = (id: string): HTMLElement => document.getElementById(id)!;

export function createRemap(input: Input, host: RemapHost): { refresh(): void; cancel(): void; waiting(): boolean } {
  /** the box waiting for a key or button, if any */
  let waitingFor: { kind: 'key' | 'pad'; action: string; slot: number; el: HTMLButtonElement } | null = null;
  let timer = 0;

  /** which page's note to write in: the Keyboard rows are on Controls, the buttons on Gamepad */
  let noteFor: 'key' | 'pad' = 'key';
  function say(text: string): void {
    $(noteFor === 'key' ? 'keysNote' : 'remapNote').textContent = text;
    $(noteFor === 'key' ? 'remapNote' : 'keysNote').textContent = '';
  }

  function stop(note = ''): void {
    clearTimeout(timer);
    input.capture = null;
    waitingFor = null;
    say(note);
    draw();
  }

  function startWaiting(kind: 'key' | 'pad', action: string, slot: number, el: HTMLButtonElement): void {
    // tapped again (the box may have been drawn afresh meanwhile): leave it
    if (waitingFor && waitingFor.kind === kind && waitingFor.action === action && waitingFor.slot === slot) return stop();
    clearTimeout(timer);
    noteFor = kind;
    waitingFor = { kind, action, slot, el };
    draw();
    say(kind === 'key' ? 'Press a key. Backspace empties the box, Escape leaves it.' : 'Press a button on the controller.');
    timer = window.setTimeout(() => stop('Nothing pressed: left as it was.'), WAIT_MS);
    // (the press that picked this box, Enter or A, has already been read, so it is not taken as the new one)
    input.capture = caught;
  }

  function caught(c: Caught): void {
    const w = waitingFor;
    if (!w) return;
    if (w.kind === 'key') {
      if (c.kind !== 'key') return; // a controller button while waiting for a key: ignored
      if (c.code === 'Escape') return stop();
      if (c.code === 'Backspace' || c.code === 'Delete') {
        const k = clone(host.keys());
        k[w.action as keyof KeyMap].splice(w.slot, 1);
        host.setKeys(k);
        return stop('Emptied.');
      }
      if (FIXED_KEYS.has(c.code)) return say(`${keyName(c.code)} always does its own job. Press another key.`);
      putKey(w.action as keyof KeyMap, w.slot, c.code);
    } else {
      if (c.kind !== 'pad') {
        if (c.code === 'Escape') stop();
        return;
      }
      if (!PAD_BINDABLE.includes(c.button)) return say(`The ${padName(c.button)} always moves. Press another button.`);
      putPad(w.action as keyof PadMap, w.slot, c.button);
    }
  }

  function putKey(action: keyof KeyMap, slot: number, code: string): void {
    const keys = clone(host.keys());
    const mine = keys[action];
    if (mine.includes(code)) return stop(`${keyName(code)} is already there.`);
    const other = ACTIONS.find((a) => a.id !== action && keys[a.id].includes(code));
    const apply = (): void => {
      const old = mine[slot];
      if (other) {
        const list = keys[other.id];
        const at = list.indexOf(code);
        // swap: the other action gets this box's old key, or just loses the key if the box was empty
        if (old) list[at] = old;
        else list.splice(at, 1);
      }
      if (slot < mine.length) mine[slot] = code;
      else mine.push(code);
      host.setKeys(keys);
    };
    if (!other) {
      apply();
      return stop(`${keyName(code)}: ${nameOf(action)}.`);
    }
    // ask, rather than take a key away from another action without saying so
    clearTimeout(timer);
    input.capture = null;
    const old = mine[slot];
    confirmFirst(
      `${keyName(code)} is already ${nameOf(other.id)}`,
      old ? `Swap them? ${nameOf(other.id)} gets ${keyName(old)}.` : `Move it to ${nameOf(action)}?`,
      old ? 'Swap' : 'Move it',
      (yes) => {
        if (yes) apply();
        stop(yes ? `${keyName(code)}: ${nameOf(action)}.` : 'Left as it was.');
      },
    );
  }

  function putPad(action: keyof PadMap, slot: number, button: number): void {
    const pad = clone(host.pad());
    const mine = pad[action];
    if (mine.includes(button)) return stop(`${padName(button)} is already there.`);
    const other = PAD_ACTIONS.find((a) => a.id !== action && pad[a.id].includes(button));
    const apply = (): void => {
      const old = mine[slot];
      if (other) {
        const list = pad[other.id];
        const at = list.indexOf(button);
        if (old !== undefined) list[at] = old;
        else list.splice(at, 1);
      }
      if (slot < mine.length) mine[slot] = button;
      else mine.push(button);
      host.setPad(pad);
    };
    if (!other) {
      apply();
      return stop(`${padName(button)}: ${padActionName(action)}.`);
    }
    clearTimeout(timer);
    input.capture = null;
    const old = mine[slot];
    confirmFirst(
      `${padName(button)} is already ${padActionName(other.id)}`,
      old !== undefined ? `Swap them? ${padActionName(other.id)} gets ${padName(old)}.` : `Move it to ${padActionName(action)}?`,
      old !== undefined ? 'Swap' : 'Move it',
      (yes) => {
        if (yes) apply();
        stop(yes ? `${padName(button)}: ${padActionName(action)}.` : 'Left as it was.');
      },
    );
  }

  const nameOf = (a: string): string => ACTIONS.find((x) => x.id === a)?.name ?? a;
  const padActionName = (a: string): string => PAD_ACTIONS.find((x) => x.id === a)?.name ?? a;

  /** One action's row: its name, then a box per key or button and an empty box to add one. */
  function row(kind: 'key' | 'pad', action: string, name: string, have: string[], slots: number): HTMLElement {
    const r = document.createElement('div');
    r.className = 'opt bind-row';
    const label = document.createElement('span');
    label.className = 'opt-label';
    label.textContent = name;
    const boxes = document.createElement('div');
    boxes.className = 'bind-boxes';
    const count = Math.min(slots, have.length + 1);
    for (let i = 0; i < count; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'bind';
      b.id = `bind-${kind}-${action}-${i}`;
      const waiting = waitingFor && waitingFor.kind === kind && waitingFor.action === action && waitingFor.slot === i;
      b.classList.toggle('waiting', !!waiting);
      b.classList.toggle('empty', i >= have.length);
      b.textContent = waiting ? '…' : (have[i] ?? '+');
      b.setAttribute(
        'aria-label',
        waiting ? `${name}: waiting for a ${kind === 'key' ? 'key' : 'button'}` : i < have.length ? `${name}: ${have[i]}. Change it` : `${name}: add a ${kind === 'key' ? 'key' : 'button'}`,
      );
      b.addEventListener('click', () => startWaiting(kind, action, i, b));
      boxes.append(b);
    }
    r.append(label, boxes);
    return r;
  }

  function draw(): void {
    // the highlight stays on the same box when the rows are drawn afresh (or on the box before, if that one went)
    const had = document.activeElement?.id ?? '';
    const keys = host.keys();
    const kBox = $('remapKeys');
    kBox.textContent = '';
    for (const a of ACTIONS) kBox.append(row('key', a.id, a.name, keys[a.id].map(keyName), KEY_SLOTS));
    const pad = host.pad();
    const pBox = $('remapPad');
    pBox.textContent = '';
    for (const a of PAD_ACTIONS) pBox.append(row('pad', a.id, a.name, pad[a.id].map(padName), PAD_SLOTS));
    const n = input.padCount();
    $('padStatus').textContent = n
      ? `Connected: ${input.padId.replace(/\s*\(.*\)\s*$/, '') || 'a controller'}${n > 1 ? `, and ${n - 1} more` : ''}`
      : 'No controller found. Connect one, then press any button on it.';
    const rb = $('rumbleBtn');
    rb.setAttribute('aria-checked', String(host.rumble()));
    const m = /^bind-(key|pad)-(\w+)-(\d)$/.exec(had);
    if (m) {
      for (let i = Number(m[3]); i >= 0; i--) {
        const el = document.getElementById(`bind-${m[1]}-${m[2]}-${i}`);
        if (el) {
          el.focus({ preventScroll: true });
          break;
        }
      }
    }
  }

  $('rumbleBtn').addEventListener('click', () => {
    host.setRumble(!host.rumble());
    draw();
    if (host.rumble()) input.rumble(0.6, 0.6, 200);
  });
  $('resetKeys').addEventListener('click', () =>
    confirmFirst('Put the keys back?', 'Every key goes back to how it was at first: WASD or the arrows, Space, J or X, Shift, K or Z, and P.', 'Reset keys', (yes) => {
      if (yes) host.setKeys(defaultKeys());
      noteFor = 'key';
      stop(yes ? 'Keys put back.' : '');
    }),
  );
  $('resetPad').addEventListener('click', () =>
    confirmFirst('Put the buttons back?', 'A or RT drops a bomb, B or LT lifts and throws, ≡ pauses.', 'Reset buttons', (yes) => {
      if (yes) host.setPad(defaultPad());
      noteFor = 'pad';
      stop(yes ? 'Buttons put back.' : '');
    }),
  );
  // (a moment later: the controller is read on the next frame)
  window.addEventListener('gamepadconnected', () => setTimeout(draw, 100));
  window.addEventListener('gamepaddisconnected', () => setTimeout(draw, 100));

  return {
    refresh: draw,
    /** Leave any box that is waiting (Settings is closing). */
    cancel(): void {
      if (waitingFor) stop();
    },
    waiting: () => !!waitingFor,
  };
}

function clone<T>(m: T): T {
  return JSON.parse(JSON.stringify(m)) as T;
}
