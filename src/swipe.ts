/**
 * Swipe-pad recogniser. Pure logic, no browser APIs, so it can be tested with
 * recorded thumb paths.
 *
 * Put a thumb down anywhere and move it the way you want to go. Keep it down to
 * keep going. Two separate questions are answered here.
 *
 * 1. WHEN did the thumb start a new stroke?
 *    - A thumb that has come to rest has a quiet zone around it. Movements that
 *      stay inside the zone are ignored, and so is slow drift: the zone simply
 *      follows the thumb. A stroke starts when the thumb leaves the zone.
 *    - While a swipe is in progress, the stroke is followed as a straight leg in
 *      whatever direction the thumb is really moving. A new leg starts when the
 *      thumb breaks away sideways from that leg ("left, then down" in one
 *      motion), or comes back along it by a full zone's width. The small
 *      bounce-back at the end of a flick does neither.
 *
 * 2. WHICH of the four directions is that stroke?
 *    - Judged from the whole leg (never from a few pixels of it), by whichever
 *      of up, down, left and right it is nearest to. The robot's current
 *      direction plays no part, so the same swipe always gives the same answer.
 *    - Each direction has an AIM: the screen angle its swipes are expected to
 *      point at. A stroke counts as the direction whose aim it is nearest to,
 *      so the border between two directions sits half way between their aims.
 *      A thumb pivots at its base, so a quick sideways flick of the left thumb
 *      is an arc: left drifts up, right drifts down, up drifts right, down
 *      drifts left. Aiming each direction where the thumb really swipes puts
 *      those flicks in the middle of their quarter instead of on a border.
 *      By default all four aims lean the same 15 degrees (clockwise for a left
 *      thumb, anticlockwise for a right thumb); Match my thumb can
 *      set one lean for all four, or a lean for each. The aims change only
 *      which direction a stroke counts as, never how far the thumb travels.
 *
 * All distances are CSS pixels; on a phone 5 to 6 px is about a millimetre.
 */
import type { Dir } from './sim';

const START = 14; // first direction after touching down
const QUIET = 30; // radius of the quiet zone round a resting thumb
const TURN = 0.8; // sideways break needed to turn mid-swipe, as a share of QUIET
const REVISE_UNTIL = 36; // a stroke shorter than this is still being read
const REVISE_MARGIN = 0.2; // how clearly a longer look must disagree before it overrules the first read
const SETTLE_PX = 6; // a thumb that stays within this ...
const SETTLE_MS = 120; // ... for this long has come to rest

/** Standard clockwise lean, in degrees, for a left thumb. A right thumb leans the same amount the other way. */
export const DEFAULT_TILT = 15;

/** Which thumb steers: the pad sits on that side of the screen. */
export type Hand = 'left' | 'right';

/** Screen angle of each direction, in degrees anticlockwise from "right" (index 1 up, 2 down, 3 left, 4 right). */
export const STRAIGHT = [0, 90, 270, 180, 0];

/** Aims for all four directions leaning the same `tilt` degrees clockwise. */
export function uniformAims(tilt: number): number[] {
  return STRAIGHT.map((a, d) => (d === 0 ? 0 : a - tilt));
}

/**
 * The standard aims for a thumb that has not been matched. A thumb pivots at
 * its own bottom corner of the screen, so the two are mirror images: a left
 * thumb's quick swipes lean clockwise, a right thumb's anticlockwise.
 */
export function standardAims(hand: Hand): number[] {
  return uniformAims(hand === 'right' ? -DEFAULT_TILT : DEFAULT_TILT);
}

/**
 * How strongly a movement (vx right, vy down, in screen pixels) points along
 * the aim of direction `d`: its length times the cosine of the angle between
 * them. The direction with the highest score is the one it is nearest to.
 */
export function aimScore(aims: number[], d: Dir, vx: number, vy: number): number {
  const a = (aims[d] * Math.PI) / 180;
  return vx * Math.cos(a) - vy * Math.sin(a);
}

/** Which of the four directions a movement is nearest to, given each direction's aim. */
export function nearestDir(aims: number[], vx: number, vy: number): Dir {
  let best: Dir = 4;
  for (const d of [3, 2, 1] as Dir[]) if (aimScore(aims, d, vx, vy) > aimScore(aims, best, vx, vy)) best = d;
  return best;
}

export class SwipePad {
  /** current direction: 0 none, 1 up, 2 down, 3 left, 4 right */
  dir: Dir = 0;
  /** 1 = normal. Larger makes the quiet zone bigger (less sensitive). */
  scale = 1;
  /** The screen angle each direction is read around (index 1 to 4). See `nearestDir`. */
  aims: number[] = uniformAims(DEFAULT_TILT);

  /** Shortcut: lean all four aims the same number of degrees clockwise. */
  set tilt(t: number) {
    this.aims = uniformAims(t);
  }
  /** The lean of the "right" aim; equal to the lean of all four when they lean the same. */
  get tilt(): number {
    return -this.aims[4];
  }
  /**
   * Called once for each stroke that starts from a resting thumb or a fresh
   * touch, with the thumb's movement in screen pixels: as soon as the stroke is
   * long enough to read properly, or when it ends if it never gets that long.
   * Used by Match my thumb to measure how a player swipes.
   */
  onStroke: ((vx: number, vy: number) => void) | null = null;

  private down = false;
  private resting = true;
  private x = 0; // thumb
  private y = 0;
  private cx = 0; // centre of the quiet zone
  private cy = 0;
  private sx = 0; // where and when the thumb last moved appreciably
  private sy = 0;
  private st = 0;
  private settled = true;
  // the leg of the swipe being followed
  private ox = 0; // where it began
  private oy = 0;
  private ux = 1; // its direction
  private uy = 0;
  private ext = 0; // furthest distance reached along it
  private pref = 0; // sideways position of the line being followed
  private young = false;
  private unread = false; // this stroke has not been reported to onStroke yet

  press(x: number, y: number, t: number): void {
    this.down = true;
    this.dir = 0;
    this.resting = true;
    this.settled = true;
    this.x = this.cx = this.sx = x;
    this.y = this.cy = this.sy = y;
    this.st = t;
  }

  release(): void {
    this.reportEnd();
    this.down = false;
    this.dir = 0;
  }

  /** A stroke that ended before it was long enough: report it as far as it got. */
  private reportEnd(): void {
    if (!this.unread) return;
    this.unread = false;
    this.onStroke?.(this.ux * this.ext - this.uy * this.pref, this.uy * this.ext + this.ux * this.pref);
  }

  /** Call regularly (every game tick) so a thumb that has stopped is noticed. */
  poll(t: number): void {
    if (this.down) this.settle(t);
  }

  move(x: number, y: number, t: number): void {
    if (!this.down) return;
    this.x = x;
    this.y = y;
    this.settle(t);
    const quiet = QUIET * this.scale;
    const turn = quiet * TURN;

    if (this.resting) {
      const vx = x - this.cx;
      const vy = y - this.cy;
      const len = Math.hypot(vx, vy);
      if (len < (this.dir === 0 ? START : quiet)) return;
      // a deliberate stroke out of the quiet zone
      this.resting = false;
      this.dir = this.nearest(vx, vy);
      this.aim(this.cx, this.cy, vx, vy, len);
      this.young = len < REVISE_UNTIL;
      this.unread = this.young;
      if (!this.young) this.onStroke?.(vx, vy);
      return;
    }

    // a swipe is in progress: where is the thumb relative to the leg being followed?
    const wx = x - this.ox;
    const wy = y - this.oy;
    const a = wx * this.ux + wy * this.uy; // along it
    const q = -wx * this.uy + wy * this.ux; // sideways from it

    if (this.young) {
      // The first read of a stroke is made on very little movement. Until the
      // stroke is long enough to be sure, a clearly different reading of the
      // whole stroke so far overrules it.
      const len = Math.hypot(wx, wy);
      if (len >= REVISE_UNTIL) {
        this.young = false;
        if (this.unread) {
          this.unread = false;
          this.onStroke?.(wx, wy);
        }
      }
      const better = this.nearest(wx, wy);
      if (better !== this.dir && this.score(better, wx, wy) - this.score(this.dir, wx, wy) >= REVISE_MARGIN * len) {
        this.dir = better;
        this.aim(this.ox, this.oy, wx, wy, len);
        return;
      }
    }

    if (a > this.ext) {
      // moving forward: let the line follow a gently curving stroke
      const adv = a - this.ext;
      this.ext = a;
      this.pref += (q - this.pref) * Math.min(1, adv / turn);
    }
    if (Math.abs(q - this.pref) >= turn || this.ext - a >= quiet) {
      // The thumb has broken away from the leg, sideways or backwards. A new leg
      // starts at the far end of the old one and is read on its own.
      this.reportEnd();
      const kx = this.ox + this.ux * this.ext - this.uy * this.pref;
      const ky = this.oy + this.uy * this.ext + this.ux * this.pref;
      const vx = x - kx;
      const vy = y - ky;
      this.dir = this.nearest(vx, vy);
      this.aim(kx, ky, vx, vy, Math.hypot(vx, vy));
      this.young = false;
    }
  }

  private settle(t: number): void {
    if (Math.hypot(this.x - this.sx, this.y - this.sy) > SETTLE_PX) {
      this.sx = this.x;
      this.sy = this.y;
      this.st = t;
      this.settled = false;
    } else if (!this.settled && t - this.st >= SETTLE_MS) {
      // the thumb has stopped: the quiet zone re-centres on it
      if (!this.resting) this.reportEnd();
      this.settled = true;
      this.resting = true;
      this.cx = this.x;
      this.cy = this.y;
    }
  }

  /** Start following a leg from (ox, oy) in the direction of (vx, vy). */
  private aim(ox: number, oy: number, vx: number, vy: number, len: number): void {
    this.ox = ox;
    this.oy = oy;
    if (len > 1e-6) {
      this.ux = vx / len;
      this.uy = vy / len;
    }
    this.ext = len;
    this.pref = 0;
  }

  /** How strongly a movement points in direction `d`, given the current aims. */
  private score(d: Dir, vx: number, vy: number): number {
    return aimScore(this.aims, d, vx, vy);
  }

  /** Which of the four directions a movement is nearest to. */
  private nearest(vx: number, vy: number): Dir {
    return nearestDir(this.aims, vx, vy);
  }
}
