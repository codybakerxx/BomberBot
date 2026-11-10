/**
 * Experiment: how often is a single stroke read as the direction that was meant?
 *
 * A MODEL of a thumb, not a real one. Each stroke:
 * - aims at one of the four directions, leaning clockwise by a set amount,
 *   with random scatter of about 12 degrees either way;
 * - is 34 to 74 px long, takes 60 to 120 ms, and bounces back 10 to 40 percent;
 * - starts either from a thumb resting on the pad while the robot is already
 *   moving, or straight after touching down (where the contact point also
 *   shifts a few px as the thumb lands).
 *
 * It compares the previous swipe pad with the current one at no lean and at
 * the standard lean.
 *
 * Run with: npx tsx experiments/stroke-reading.ts
 */
import { SwipePad, DEFAULT_TILT } from '../src/swipe';
import { makeRng, Dir } from '../src/sim';
import { PreviousPad } from './previous-build';

const ANGLE: Record<number, number> = { 1: 90, 2: 270, 3: 180, 4: 0 }; // on screen, anticlockwise from "right"
const SCATTER = 12;
const TRIALS = 1500;

const rng = makeRng(99);
/** roughly bell-shaped random number, mean 0, spread 1 */
const gauss = (): number => {
  let s = 0;
  for (let i = 0; i < 6; i++) s += rng();
  return (s - 3) / Math.sqrt(0.5);
};

interface Pad {
  dir: Dir;
  press(x: number, y: number, t: number): void;
  move(x: number, y: number, t: number): void;
  poll(t: number): void;
}

function trial(make: () => Pad, going: Dir, want: Dir, lean: number, fresh: boolean): boolean {
  const pad = make();
  let t = 0;
  let x = 200;
  let y = 300;
  const glide = (deg: number, len: number, ms: number): void => {
    const n = Math.max(1, Math.round(ms / 8));
    const x0 = x;
    const y0 = y;
    for (let i = 1; i <= n; i++) {
      t += ms / n;
      x = x0 + (len * Math.cos((deg * Math.PI) / 180) * i) / n;
      y = y0 - (len * Math.sin((deg * Math.PI) / 180) * i) / n;
      pad.move(x, y, t);
    }
  };
  const rest = (ms: number): void => {
    for (let i = 0; i < ms / 16; i++) {
      t += 16;
      pad.poll(t);
    }
  };

  pad.press(x, y, t);
  if (fresh) {
    // touching down: the contact point shifts a few px toward the base of the thumb
    glide(225 + gauss() * 25, Math.abs(gauss()) * 4, 24);
  } else {
    glide(ANGLE[going], 60, 90);
    rest(250);
    if (pad.dir !== going) return true; // the set-up stroke is not what is being measured
  }
  const deg = ANGLE[want] - lean + gauss() * SCATTER;
  const len = 34 + rng() * 40;
  glide(deg, len, 60 + rng() * 60);
  glide(deg + 180 + gauss() * 20, len * (0.1 + rng() * 0.3), 40); // bounce-back
  rest(250);
  return pad.dir === want;
}

const newPad = (tilt: number) => (): Pad => {
  const p = new SwipePad();
  p.tilt = tilt;
  return p;
};
const columns: [string, () => Pad][] = [
  ['previous pad', () => new PreviousPad()],
  ['current, no lean', newPad(0)],
  [`current, lean ${DEFAULT_TILT}`, newPad(DEFAULT_TILT)],
];

for (const fresh of [false, true]) {
  console.log(fresh ? '\nStroke straight after touching down:' : 'Stroke from a resting thumb while the robot is already moving:');
  console.log('thumb leans'.padEnd(14) + columns.map((c) => c[0].padStart(18)).join(''));
  for (const lean of [0, 15, 30, 40]) {
    let row = `${lean} deg`.padEnd(14);
    for (const [, make] of columns) {
      let right = 0;
      for (let i = 0; i < TRIALS; i++) {
        const going = (1 + Math.floor(rng() * 4)) as Dir;
        let want = (1 + Math.floor(rng() * 4)) as Dir;
        if (!fresh && want === going) want = ((want % 4) + 1) as Dir;
        if (trial(make, going, want, lean, fresh)) right++;
      }
      row += `${(100 - (right / TRIALS) * 100).toFixed(1)}% wrong`.padStart(18);
    }
    console.log(row);
  }
}
