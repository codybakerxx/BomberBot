/**
 * "Match my thumb": works out how a player's swipes lean, from a dozen
 * prompted swipes. Pure maths, no browser APIs.
 */
import type { Dir } from './sim';

/** Screen angle of each direction, in degrees anticlockwise from "right". */
const ANGLE = [0, 90, 270, 180, 0];

/** The order the directions are asked for: each one three times. */
export const TEACH_ORDER: Dir[] = [3, 1, 4, 2, 4, 3, 2, 1, 3, 2, 1, 4];

/** How far a swipe leans clockwise from the direction that was asked for, in degrees (-180 to 180). */
export function leanOf(want: Dir, vx: number, vy: number): number {
  const ang = (Math.atan2(-vy, vx) * 180) / Math.PI;
  return ((ANGLE[want] - ang + 540) % 360) - 180;
}

function circularMean(degrees: number[]): { mean: number; r: number } {
  let s = 0;
  let c = 0;
  for (const d of degrees) {
    s += Math.sin((d * Math.PI) / 180);
    c += Math.cos((d * Math.PI) / 180);
  }
  const n = Math.max(1, degrees.length);
  return { mean: (Math.atan2(s, c) * 180) / Math.PI, r: Math.hypot(s, c) / n };
}

export interface ThumbSummary {
  /** average clockwise lean of all the swipes */
  lean: number;
  /** average lean of the up, down, left and right swipes (index 1 to 4) */
  by: number[];
  /** how much individual swipes varied round the average, in degrees */
  spread: number;
  /** false if the swipes were too scattered to learn from */
  ok: boolean;
}

export function summarise(samples: { want: Dir; lean: number }[]): ThumbSummary {
  const all = circularMean(samples.map((s) => s.lean));
  const by = [0, 1, 2, 3, 4].map((d) => Math.round(circularMean(samples.filter((s) => s.want === d).map((s) => s.lean)).mean));
  const spread = all.r > 0 ? (Math.sqrt(-2 * Math.log(Math.min(1, all.r))) * 180) / Math.PI : 180;
  return { lean: Math.round(all.mean), by, spread: Math.round(spread), ok: spread <= 30 };
}

/**
 * The lean the pad should use for a player whose quick swipes lean this much.
 * Not the whole of it: slower, deliberate swipes are straighter than quick
 * ones, and both have to land comfortably inside the right quarter.
 */
export function tiltFor(lean: number): number {
  return Math.max(-20, Math.min(25, Math.round(lean * 0.75)));
}
