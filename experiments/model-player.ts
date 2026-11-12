/**
 * Experiment: the whole chain, thumb -> swipe pad -> robot.
 *
 * A MODEL player, not a real one, steers through an empty arena with the thumb
 * held down, the way the game is played on a phone. Over and over it picks a
 * side opening near ahead and swipes toward it, anywhere from 1.4 tiles before
 * the opening to 0.3 tiles after it. Its strokes lean, scatter and bounce back
 * like the ones in stroke-reading.ts.
 *
 * A turn counts as WRONG if the robot does anything other than carry straight
 * on and then turn the way that was meant at the opening that was meant:
 *   doubled back     it turned round and went back the way it came
 *   wrong opening    it turned the right way, but at a different opening
 *   other direction  it went off some other way
 *   no turn          it never turned at all
 *
 * The table compares the previous swipe pad and turning rule with the current
 * ones, separately and together.
 *
 * Run with: npx tsx experiments/model-player.ts
 */
import { SwipePad } from '../src/swipe';
import { createWorld, step, tileAt, FLOOR, makeRng, DX, DY, Dir } from '../src/sim';
import { PreviousPad, previousMove } from './previous-build';

const ANGLE: Record<number, number> = { 1: 90, 2: 270, 3: 180, 4: 0 }; // on screen, anticlockwise from "right"
const OPPOSITE: Dir[] = [0, 2, 1, 4, 3];
const GAMES = 60;
const TICKS_PER_GAME = 60 * 40;

const rng = makeRng(4242);
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
type Kind = 'doubled back' | 'wrong opening' | 'other direction' | 'no turn';
interface Tally {
  turns: number;
  wrong: number;
  kinds: Record<Kind, number>;
}

function play(lean: number, currentPad: boolean, currentTurning: boolean): Tally {
  const tally: Tally = { turns: 0, wrong: 0, kinds: { 'doubled back': 0, 'wrong opening': 0, 'other direction': 0, 'no turn': 0 } };

  for (let game = 0; game < GAMES; game++) {
    const w = createWorld({ roundTicks: 0, seed: 7 + game, players: [{ colorId: 'a' }, { colorId: 'b' }], softDensity: 0 });
    const p = w.players[0];
    const pad: Pad = currentPad ? new SwipePad() : new PreviousPad();
    let t = 0;
    let thumbX = 200;
    let thumbY = 300;
    pad.press(thumbX, thumbY, t);

    // thumb movements still to be played out, one position per 8 ms
    const queue: [number, number][] = [];
    const swipe = (d: Dir): void => {
      const deg = ANGLE[d] - lean + gauss() * 12;
      const len = 34 + rng() * 36;
      const n = 8 + Math.floor(rng() * 6);
      let x = thumbX;
      let y = thumbY;
      for (let i = 1; i <= n; i++) {
        queue.push([x + (len * Math.cos((deg * Math.PI) / 180) * i) / n, y - (len * Math.sin((deg * Math.PI) / 180) * i) / n]);
      }
      x += len * Math.cos((deg * Math.PI) / 180);
      y -= len * Math.sin((deg * Math.PI) / 180);
      const back = len * (0.1 + rng() * 0.25);
      const backDeg = deg + 180 + gauss() * 20;
      for (let i = 1; i <= 5; i++) {
        queue.push([x + (back * Math.cos((backDeg * Math.PI) / 180) * i) / 5, y - (back * Math.sin((backDeg * Math.PI) / 180) * i) / 5]);
      }
    };

    let going: Dir = 4;
    swipe(4);
    /** the next turn: swipe when the robot passes `at`; it is meant to happen on row or column `lane` */
    let plan: { want: Dir; at: number; lane: number } | null = null;
    /** a turn that has been swiped and is being watched */
    let watch: { want: Dir; from: Dir; lane: number; deadline: number } | null = null;
    let pause = 0; // ticks to let things settle after a verdict

    for (let tick = 0; tick < TICKS_PER_GAME; tick++) {
      for (let k = 0; k < 2; k++) {
        // the thumb is sampled at 120 Hz, twice per game tick
        t += 8.33;
        const next = queue.shift();
        if (next) {
          thumbX = next[0];
          thumbY = next[1];
          pad.move(thumbX, thumbY, t);
        } else pad.poll(t);
      }

      const beforeX = p.x;
      const beforeY = p.y;
      if (currentTurning) step(w, [{ dir: pad.dir, a: false, b: false }]);
      else if (pad.dir) previousMove(w, p, pad.dir);
      const mx = p.x - beforeX;
      const my = p.y - beforeY;
      const moved: Dir = Math.abs(mx) > 1e-9 ? (mx > 0 ? 4 : 3) : Math.abs(my) > 1e-9 ? (my > 0 ? 2 : 1) : 0;

      if (watch) {
        // stepping back is fine when the opening that was meant is now just behind the robot
        const was = watch.from >= 3 ? beforeX : beforeY;
        const sign = DX[watch.from] + DY[watch.from];
        const passed = (was - watch.lane) * sign > 1e-9;
        const steppedBack = moved === OPPOSITE[watch.from];
        let kind: Kind | 'right' | null = null;
        if (moved === watch.want) {
          kind = Math.abs((watch.want >= 3 ? p.y : p.x) - watch.lane) < 1e-6 ? 'right' : 'wrong opening';
        } else if (moved && moved !== watch.from && !(steppedBack && passed)) {
          kind = steppedBack ? 'doubled back' : 'other direction';
        } else if (tick > watch.deadline) kind = 'no turn';
        if (kind) {
          if (kind !== 'right') {
            tally.wrong++;
            tally.kinds[kind]++;
          }
          watch = null;
          plan = null;
          pause = 30;
        }
      }
      if (pause > 0) {
        pause--;
        if (pause === 0) going = (moved || going) as Dir;
        continue;
      }

      if (!watch && !plan && queue.length === 0 && moved === going) {
        // choose the next turn: a side opening at the next junction ahead (or one only just passed)
        const horizontal: boolean = going >= 3;
        const pos: number = horizontal ? p.x : p.y;
        const sign: number = DX[going] + DY[going];
        const lead = -0.3 + rng() * 1.7; // tiles before the opening when the swipe is made (negative = just after it)
        let junction: number = sign > 0 ? Math.ceil(pos + 0.5) : Math.floor(pos - 0.5);
        if (junction % 2 === 0) junction += sign;
        const jx = horizontal ? junction : Math.round(p.x);
        const jy = horizontal ? Math.round(p.y) : junction;
        let clear = true;
        for (let c = Math.round(pos); c !== junction + sign; c += sign) {
          if (tileAt(w, horizontal ? c : jx, horizontal ? jy : c) !== FLOOR) clear = false;
        }
        if (clear) {
          const sides: Dir[] = ((horizontal ? [1, 2] : [3, 4]) as Dir[]).filter((d) => tileAt(w, jx + DX[d], jy + DY[d]) === FLOOR);
          if (sides.length) plan = { want: sides[Math.floor(rng() * sides.length)], at: junction - sign * lead, lane: junction };
        }
        if (!plan) {
          // nothing to turn into ahead: turn round at the wall
          const ahead = tileAt(w, Math.round(p.x) + DX[going], Math.round(p.y) + DY[going]);
          if (ahead !== FLOOR && Math.abs(pos - Math.round(pos)) < 1e-6) {
            swipe(OPPOSITE[going]);
            going = OPPOSITE[going];
            pause = 30;
          }
        }
      }

      if (plan && !watch) {
        const pos = going >= 3 ? p.x : p.y;
        const sign = DX[going] + DY[going];
        if ((pos - plan.at) * sign >= 0) {
          swipe(plan.want);
          tally.turns++;
          watch = { want: plan.want, from: going, lane: plan.lane, deadline: tick + 200 };
        }
      }
    }
  }
  return tally;
}

const percent = (r: Tally): string => `${((100 * r.wrong) / r.turns).toFixed(1)}%`;
const detail = (r: Tally): string =>
  `${r.turns} turns: ` + (Object.entries(r.kinds) as [Kind, number][]).map(([k, v]) => `${k} ${v}`).join(', ');

console.log('Share of turns where the robot went a way that was not meant (model player, thumb held down):\n');
console.log('thumb leans'.padEnd(13) + 'previous build'.padStart(16) + 'new turning only'.padStart(18) + 'new pad only'.padStart(15) + 'both (current)'.padStart(16));
for (const lean of [0, 20, 35]) {
  const previous = play(lean, false, false);
  const turningOnly = play(lean, false, true);
  const padOnly = play(lean, true, false);
  const both = play(lean, true, true);
  console.log(`${lean} deg`.padEnd(13) + percent(previous).padStart(16) + percent(turningOnly).padStart(18) + percent(padOnly).padStart(15) + percent(both).padStart(16));
  console.log(`     previous: ${detail(previous)}`);
  console.log(`     current:  ${detail(both)}\n`);
}
