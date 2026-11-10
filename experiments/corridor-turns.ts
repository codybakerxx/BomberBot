/**
 * Experiment: where does the robot turn?
 *
 * The robot runs down column 3 from row 1. Somewhere on the way "left" is
 * swiped and held. Openings to the left are at rows 1 and 3; row 2 has a
 * pillar beside it. For each point where the swipe could happen, this prints
 * what the robot does first and which row it ends up going left along, under
 * the previous turning rule and the current one.
 *
 * Run with: npx tsx experiments/corridor-turns.ts
 */
import { createWorld, step, PlayerInput, Dir, World, Player } from '../src/sim';
import { previousMove } from './previous-build';

const hold = (dir: Dir): PlayerInput => ({ dir, a: false, b: false });

function trial(trigger: number, current: boolean): { y0: number; what: string; row: number } {
  const w: World = createWorld({ seed: 7, players: [{ colorId: 'a' }, { colorId: 'b' }], softDensity: 0 });
  const p: Player = w.players[0];
  p.x = 3;
  p.y = 1;
  const move = (dir: Dir): void => (current ? step(w, [hold(dir)]) : previousMove(w, p, dir));
  while (p.y < trigger - 1e-9) move(2);
  const y0 = p.y;
  let highest = y0;
  let lowest = y0;
  for (let i = 0; i < 90 && p.x > 2.5; i++) {
    move(3);
    highest = Math.min(highest, p.y);
    lowest = Math.max(lowest, p.y);
  }
  const what = highest < y0 - 1e-9 ? `BACK UP ${(y0 - highest).toFixed(2)}` : lowest > y0 + 1e-9 ? `on down ${(lowest - y0).toFixed(2)}` : 'straight left';
  return { y0, what, row: Math.round(p.y) };
}

console.log('swipe left at   previous rule               current rule');
for (let trigger = 1.1; trigger <= 3.05; trigger += 0.1) {
  const before = trial(trigger, false);
  const now = trial(trigger, true);
  console.log(
    `y = ${now.y0.toFixed(2)}`.padEnd(16) +
      `${before.what}, row ${before.row}`.padEnd(28) +
      `${now.what}, row ${now.row}`,
  );
}
