/**
 * The swipe pad and the turning rule as they were BEFORE the 9 November 2026
 * rework, kept only so the experiments can compare old against new.
 * Nothing in the game uses this file.
 */
import { World, Player, Dir, DX, DY, FLOOR, BASE_SPEED, tileAt } from '../src/sim';

const OPPOSITE: Dir[] = [0, 2, 1, 4, 3];

/**
 * The previous swipe pad. Differences from src/swipe.ts:
 * - the first direction registered after only 10 px;
 * - a stroke leaving the quiet zone was judged with a bias toward the axis the
 *   robot was already moving along (a sideways swipe had to be within about
 *   36 degrees of flat while the robot was going up or down);
 * - directions were judged against the screen's axes, with no lean;
 * - mid-swipe turns were measured against the screen's axes, not the stroke's own line.
 */
export class PreviousPad {
  dir: Dir = 0;
  private down = false;
  private resting = true;
  private px = 0;
  private py = 0;
  private cx = 0;
  private cy = 0;
  private sx = 0;
  private sy = 0;
  private st = 0;
  private settled = true;
  private ext = 0;
  private pref = 0;

  press(x: number, y: number, t: number): void {
    this.down = true;
    this.dir = 0;
    this.resting = true;
    this.settled = true;
    this.px = this.cx = this.sx = x;
    this.py = this.cy = this.sy = y;
    this.st = t;
  }

  poll(t: number): void {
    if (this.down) this.settle(t);
  }

  move(x: number, y: number, t: number): void {
    if (!this.down) return;
    this.px = x;
    this.py = y;
    this.settle(t);
    const quiet = 30;
    if (this.resting) {
      const dx = x - this.cx;
      const dy = y - this.cy;
      if (Math.hypot(dx, dy) < (this.dir === 0 ? 10 : quiet)) return;
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);
      const horizontal = this.dir === 0 ? adx > ady : this.dir >= 3 ? adx * 1.35 > ady : adx > ady * 1.35;
      this.go(horizontal ? (dx < 0 ? 3 : 4) : dy < 0 ? 1 : 2);
      return;
    }
    const turn = quiet * 0.8;
    const a = this.along(x, y);
    const q = this.perp(x, y);
    if (a > this.ext) {
      const adv = a - this.ext;
      this.ext = a;
      this.pref += (q - this.pref) * Math.min(1, adv / (turn / 1.35));
    }
    const off = q - this.pref;
    if (Math.abs(off) >= turn) {
      this.go(this.dir >= 3 ? (off < 0 ? 1 : 2) : off < 0 ? 3 : 4);
      return;
    }
    if (this.ext - a >= quiet) this.go(OPPOSITE[this.dir]);
  }

  private settle(t: number): void {
    if (Math.hypot(this.px - this.sx, this.py - this.sy) > 6) {
      this.sx = this.px;
      this.sy = this.py;
      this.st = t;
      this.settled = false;
    } else if (!this.settled && t - this.st >= 120) {
      this.settled = true;
      this.resting = true;
      this.cx = this.px;
      this.cy = this.py;
    }
  }

  private go(d: Dir): void {
    this.dir = d;
    this.resting = false;
    this.ext = this.along(this.px, this.py);
    this.pref = this.perp(this.px, this.py);
  }

  private along(x: number, y: number): number {
    return this.dir === 4 ? x : this.dir === 3 ? -x : this.dir === 2 ? y : -y;
  }

  private perp(x: number, y: number): number {
    return this.dir >= 3 ? y : x;
  }
}

/**
 * The previous turning rule: asked to turn between two openings, the robot
 * always went to the NEAREST one, even if that meant turning round and going
 * back. (No bombs are handled here; the experiments use empty arenas.)
 */
export function previousMove(w: World, p: Player, dir: Dir): void {
  const sp = BASE_SPEED;
  const dx = DX[dir];
  const dy = DY[dir];
  const tx = Math.round(p.x);
  const ty = Math.round(p.y);
  const horizontal = dx !== 0;
  const along = horizontal ? p.x : p.y;
  const across = horizontal ? p.y : p.x;
  const tAlong = horizontal ? tx : ty;
  const tAcross = horizontal ? ty : tx;
  const step = horizontal ? dx : dy;
  const blocked = (a: number, c: number): boolean => (horizontal ? tileAt(w, a, c) : tileAt(w, c, a)) !== FLOOR;
  const approach = (v: number, t: number): number => (v < t ? Math.min(t, v + sp) : Math.max(t, v - sp));

  const off = across - tAcross;
  let newAlong = along;
  let newAcross = across;
  if (Math.abs(off) > 1e-6) {
    if (!blocked(tAlong + step, tAcross)) newAcross = approach(across, tAcross);
    else {
      const other = tAcross + Math.sign(off);
      if (!blocked(tAlong, other) && !blocked(tAlong + step, other)) newAcross = approach(across, other);
    }
  } else {
    newAcross = tAcross;
    newAlong = along + step * sp;
    if (blocked(tAlong + step, tAcross)) {
      newAlong = step > 0 ? (along > tAlong ? along : Math.min(newAlong, tAlong)) : along < tAlong ? along : Math.max(newAlong, tAlong);
    }
  }
  if (horizontal) {
    p.x = newAlong;
    p.y = newAcross;
  } else {
    p.y = newAlong;
    p.x = newAcross;
  }
}
