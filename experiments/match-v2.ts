/**
 * Experiment: is a lean per direction better than one lean for all four?
 *
 * A MODEL of a thumb, not a real one. Each model thumb has its own true lean
 * for each direction (how far its quick swipes for up, down, left and right
 * turn clockwise). Its swipes scatter round that by `scatter` degrees. In play,
 * 70% of swipes are quick and lean fully; 30% are slow and lean only a third
 * as much.
 *
 * For each thumb, matching is simulated many times (the prompted swipes are
 * random draws, so the measured leans are noisy), and each resulting setting is
 * scored on fresh play swipes: what share are read as a different direction?
 *
 * Settings compared:
 *   standard        one 15 degree lean, no matching
 *   V1              one lean: 3/4 of the average of 12 swipes (today's Match my thumb)
 *   V2 n/dir, k     a lean per direction from n swipes each, pulled toward the
 *                   overall average by k imaginary swipes (k = 0: not at all)
 *
 * Run with: npx tsx experiments/match-v2.ts
 */
import { makeRng } from '../src/sim';

const STRAIGHT = [0, 90, 270, 180, 0]; // screen angle of up(1), down(2), left(3), right(4)
const rng = makeRng(77);
const gauss = (): number => {
  let s = 0;
  for (let i = 0; i < 6; i++) s += rng();
  return (s - 3) / Math.sqrt(0.5);
};
const wrap = (a: number): number => ((a % 360) + 540) % 360 - 180;
const clampLean = (l: number): number => Math.max(-20, Math.min(25, l * 0.75));

/** Which direction a swipe at screen angle `ang` is read as, given each direction's aim. */
function read(aims: number[], ang: number): number {
  let best = 1;
  for (let d = 2; d <= 4; d++) if (Math.abs(wrap(ang - aims[d])) < Math.abs(wrap(ang - aims[best]))) best = d;
  return best;
}

function circMean(xs: number[]): number {
  let s = 0;
  let c = 0;
  for (const x of xs) {
    s += Math.sin((x * Math.PI) / 180);
    c += Math.cos((x * Math.PI) / 180);
  }
  return (Math.atan2(s, c) * 180) / Math.PI;
}

interface Thumb {
  name: string;
  lean: number[]; // index 1..4
}
const THUMBS: Thumb[] = [
  { name: 'straight (0 all round)', lean: [0, 0, 0, 0, 0] },
  { name: 'even (30 all round)', lean: [0, 30, 30, 30, 30] },
  { name: 'sideways lean more (up/down 10, left/right 35)', lean: [0, 10, 10, 35, 35] },
  { name: 'uneven (up 30, down 10, left 40, right 20)', lean: [0, 30, 10, 40, 20] },
  { name: 'mixed (up -5, down 5, left 35, right 30)', lean: [0, -5, 5, 35, 30] },
];

/** A play swipe meant as direction d. */
function playSwipe(t: Thumb, d: number, scatter: number): number {
  const quick = rng() < 0.7;
  return STRAIGHT[d] - t.lean[d] * (quick ? 1 : 1 / 3) + gauss() * scatter;
}
/** A prompted swipe while matching: done the quick way, as the instructions ask. */
function matchSwipe(t: Thumb, d: number, scatter: number): number {
  return STRAIGHT[d] - t.lean[d] + gauss() * scatter;
}

type Method = { name: string; aims: (t: Thumb, scatter: number) => number[] };
const uniform = (tilt: number): number[] => [0, 90 - tilt, 270 - tilt, 180 - tilt, -tilt];
const methods: Method[] = [
  { name: 'standard', aims: () => uniform(15) },
  {
    name: 'V1 (12)',
    aims: (t, s) => {
      const leans: number[] = [];
      for (let d = 1; d <= 4; d++) for (let i = 0; i < 3; i++) leans.push(STRAIGHT[d] - matchSwipe(t, d, s));
      return uniform(clampLean(circMean(leans)));
    },
  },
];
for (const [n, k] of [[3, 0], [3, 3], [4, 0], [4, 2], [4, 4]]) {
  methods.push({
    name: `V2 ${n}/dir k${k}`,
    aims: (t, s) => {
      const by: number[][] = [[], [], [], [], []];
      for (let d = 1; d <= 4; d++) for (let i = 0; i < n; i++) by[d].push(wrap(STRAIGHT[d] - matchSwipe(t, d, s)));
      const all = circMean(by.flat());
      const aims = [0, 0, 0, 0, 0];
      for (let d = 1; d <= 4; d++) {
        const m = circMean(by[d]);
        const blended = (n * m + k * all) / (n + k);
        aims[d] = STRAIGHT[d] - clampLean(blended);
      }
      return aims;
    },
  });
}

const MATCHES = 300; // matching runs per thumb and method
const PLAYS = 200; // play swipes scored per matching run
for (const scatter of [10, 16]) {
  console.log(`\nSwipes scatter about ${scatter} degrees. Share of play swipes read as the wrong direction:\n`);
  console.log('thumb'.padEnd(50) + methods.map((m) => m.name.padStart(13)).join(''));
  const totals = methods.map(() => 0);
  for (const t of THUMBS) {
    let row = t.name.padEnd(50);
    methods.forEach((m, mi) => {
      let wrong = 0;
      for (let r = 0; r < MATCHES; r++) {
        const aims = m.aims(t, scatter);
        for (let i = 0; i < PLAYS; i++) {
          const d = 1 + Math.floor(rng() * 4);
          if (read(aims, playSwipe(t, d, scatter)) !== d) wrong++;
        }
      }
      const pct = (100 * wrong) / (MATCHES * PLAYS);
      totals[mi] += pct / THUMBS.length;
      row += `${pct.toFixed(2)}%`.padStart(13);
    });
    console.log(row);
  }
  console.log('average'.padEnd(50) + totals.map((v) => `${v.toFixed(2)}%`.padStart(13)).join(''));
}

// ---------------------------------------------------------------- choosing with a test round
// After matching, 8 more prompted swipes (2 per direction) are read by each
// candidate setting: the setting in use before (standard here), V1's single
// lean, and the per-direction leans. The candidate that reads most of them
// right wins. Ties are broken in one of three ways, compared below:
//   mean     the largest average distance inside the swipe's own quarter
//   worst    the largest distance for the closest call
//   risk     the fewest expected misreads if swipes scatter as much as the
//            learning swipes did: the sum over test swipes of the chance a
//            swipe that far inside would land past the border
// (Moving a border between two directions only shifts room from one side's
// swipes to the other's, so "mean" hardly changes; that is why it is tested.)

/** How far inside its own quarter a swipe sits: degrees to the nearest border, negative if misread. */
function margin(aims: number[], ang: number, d: number): number {
  let m = Infinity;
  for (let e = 1; e <= 4; e++) {
    if (e === d) continue;
    m = Math.min(m, (Math.abs(wrap(ang - aims[e])) - Math.abs(wrap(ang - aims[d]))) / 2);
  }
  return m;
}
/** chance a bell-shaped scatter of `sd` carries a swipe more than `m` degrees */
function tail(m: number, sd: number): number {
  const z = m / sd;
  // complementary error function approximation (Abramowitz and Stegun 7.1.26)
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erfc = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-x * x);
  const upper = erfc / 2;
  return z >= 0 ? upper : 1 - upper;
}

function learn(t: Thumb, s: number): { v1: number[]; v2: number[]; spread: number } {
  const by: number[][] = [[], [], [], [], []];
  for (let d = 1; d <= 4; d++) for (let i = 0; i < 3; i++) by[d].push(wrap(STRAIGHT[d] - matchSwipe(t, d, s)));
  const flat = by.flat();
  const all = circMean(flat);
  let sq = 0;
  for (const x of flat) sq += wrap(x - all) ** 2;
  const spread = Math.sqrt(sq / flat.length);
  const v2 = [0, 0, 0, 0, 0];
  for (let d = 1; d <= 4; d++) v2[d] = STRAIGHT[d] - clampLean((3 * circMean(by[d]) + 3 * all) / 6);
  return { v1: uniform(clampLean(all)), v2, spread };
}

const TESTS_PER_DIR = 2;
const strategies = ['standard', 'V1 always', 'V2 always', 'test: mean', 'test: worst', 'test: risk'];
for (const scatter of [10, 16]) {
  console.log(`\nWith a test round. Swipes scatter about ${scatter} degrees. Wrong reads in play:\n`);
  console.log('thumb'.padEnd(50) + strategies.map((m) => m.padStart(13)).join(''));
  const totals = strategies.map(() => 0);
  for (const t of THUMBS) {
    const wrong = strategies.map(() => 0);
    let n = 0;
    for (let r = 0; r < MATCHES; r++) {
      const before = uniform(15);
      const { v1, v2, spread } = learn(t, scatter);
      const sd = Math.max(6, spread);
      const tests: [number, number][] = [];
      for (let d = 1; d <= 4; d++) for (let i = 0; i < TESTS_PER_DIR; i++) tests.push([d, matchSwipe(t, d, scatter)]);
      const judge = (aims: number[]): { right: number; mean: number; worst: number; risk: number } => {
        let right = 0;
        let sum = 0;
        let worst = Infinity;
        let risk = 0;
        for (const [d, a] of tests) {
          if (read(aims, a) === d) right++;
          const m = margin(aims, a, d);
          sum += m;
          worst = Math.min(worst, m);
          risk += tail(m, sd);
        }
        return { right, mean: sum / tests.length, worst, risk };
      };
      const pick = (cands: number[][], key: 'mean' | 'worst' | 'risk'): number[] => {
        let best = cands[0];
        let bs = judge(best);
        for (const c of cands.slice(1)) {
          const s = judge(c);
          const better = key === 'risk' ? s.risk < bs.risk : s[key] > bs[key];
          if (s.right > bs.right || (s.right === bs.right && better)) {
            best = c;
            bs = s;
          }
        }
        return best;
      };
      const cands = [before, v1, v2];
      const chosen = [before, v1, v2, pick(cands, 'mean'), pick(cands, 'worst'), pick(cands, 'risk')];
      for (let i = 0; i < PLAYS; i++) {
        const d = 1 + Math.floor(rng() * 4);
        const a = playSwipe(t, d, scatter);
        chosen.forEach((aims, k) => {
          if (read(aims, a) !== d) wrong[k]++;
        });
        n++;
      }
    }
    let row = t.name.padEnd(50);
    wrong.forEach((w, k) => {
      const pct = (100 * w) / n;
      totals[k] += pct / THUMBS.length;
      row += `${pct.toFixed(2)}%`.padStart(13);
    });
    console.log(row);
  }
  console.log('average'.padEnd(50) + totals.map((v) => `${v.toFixed(2)}%`.padStart(13)).join(''));
}
