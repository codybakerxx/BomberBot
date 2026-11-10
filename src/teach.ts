/**
 * "Match my thumb": works out how a player's swipes lean, then tests the
 * result. Pure maths, no browser APIs.
 *
 * 1. Learning: twelve prompted swipes (TEACH_ORDER). From them come two
 *    candidate settings: one lean for all four directions (singleAims) and a
 *    lean for each direction (perDirectionAims).
 * 2. Testing: eight more prompted swipes (TEST_ORDER). Each candidate, and the
 *    setting in use before, reads the same eight. The one that reads most of
 *    them right wins; a tie goes to the one whose closest call is furthest
 *    from a border (judge and pickBest).
 *
 * docs/MATCH-MY-THUMB.md explains it all in plain words.
 */
import type { Dir } from './sim';
import { STRAIGHT, nearestDir, uniformAims } from './swipe';

/** The learning swipes, in the order they are asked for: each direction three times. */
export const TEACH_ORDER: Dir[] = [3, 1, 4, 2, 4, 3, 2, 1, 3, 2, 1, 4];

/** The test swipes: each direction twice, in a different order. */
export const TEST_ORDER: Dir[] = [2, 4, 1, 3, 3, 1, 4, 2];

/** Wrap an angle into -180 to 180 degrees. */
const wrap = (a: number): number => ((((a + 180) % 360) + 360) % 360) - 180;

/** Screen angle of a movement (vx right, vy down), in degrees anticlockwise from "right". */
export function angleOf(vx: number, vy: number): number {
  return (Math.atan2(-vy, vx) * 180) / Math.PI;
}

/** How far a swipe leans clockwise from the direction that was asked for, in degrees (-180 to 180). */
export function leanOf(want: Dir, vx: number, vy: number): number {
  return wrap(STRAIGHT[want] - angleOf(vx, vy));
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
 * ones, and both have to land comfortably inside the right quarter. The limits
 * keep a perfectly straight swipe at least 20 degrees inside its own quarter.
 */
export function tiltFor(lean: number): number {
  return Math.max(-20, Math.min(25, Math.round(lean * 0.75)));
}

/** Candidate 1: one lean for all four directions (Match my thumb version 1). */
export function singleAims(sum: ThumbSummary): number[] {
  return uniformAims(tiltFor(sum.lean));
}

/**
 * Candidate 2: a lean for each direction. Three swipes per direction is a
 * small sample, so each direction's own average is pulled half way toward
 * the overall average before use. That keeps most of a real difference
 * between directions while damping one stray swipe.
 */
export function perDirectionAims(sum: ThumbSummary): number[] {
  return STRAIGHT.map((a, d) => (d === 0 ? 0 : a - tiltFor((sum.by[d] + sum.lean) / 2)));
}

/** How far inside its own quarter a swipe sits under these aims: degrees to the nearest border, negative if misread. */
export function marginOf(aims: number[], want: Dir, vx: number, vy: number): number {
  const ang = angleOf(vx, vy);
  const own = Math.abs(wrap(ang - aims[want]));
  let m = Infinity;
  for (let e = 1; e <= 4; e++) {
    if (e !== want) m = Math.min(m, (Math.abs(wrap(ang - aims[e])) - own) / 2);
  }
  return m;
}

export interface TestSwipe {
  want: Dir;
  vx: number;
  vy: number;
}

export interface Verdict {
  /** test swipes read as the direction that was asked for */
  right: number;
  total: number;
  /**
   * the closest call: the smallest distance, in degrees, between a test swipe
   * and the border of its own quarter (negative if a swipe was misread). The
   * average would not do: moving the border between two directions only
   * shifts room from one side's swipes to the other's, so the average hardly
   * changes. The closest call shows whether a border sits uncomfortably near.
   */
  closest: number;
}

/** Read every test swipe with these aims. */
export function judge(aims: number[], tests: TestSwipe[]): Verdict {
  let right = 0;
  let closest = Infinity;
  for (const t of tests) {
    if (nearestDir(aims, t.vx, t.vy) === t.want) right++;
    closest = Math.min(closest, marginOf(aims, t.want, t.vx, t.vy));
  }
  return { right, total: tests.length, closest: tests.length ? closest : 0 };
}

/**
 * The best of several verdicts: most swipes read right, then the closest call
 * furthest from a border, compared in whole degrees as the screen shows them.
 * On a tie the earlier one wins, so list the setting in use before first and
 * the simpler settings before the more complicated: a change has to earn its
 * place.
 */
export function pickBest(verdicts: Verdict[]): number {
  let best = 0;
  for (let i = 1; i < verdicts.length; i++) {
    const v = verdicts[i];
    const b = verdicts[best];
    if (v.right > b.right || (v.right === b.right && Math.round(v.closest) > Math.round(b.closest))) best = i;
  }
  return best;
}
