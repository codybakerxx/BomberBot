// How often two CPU players in the square settle it within 90 s, over many arenas (the fuse check).
import { createWorld, step, World, HARD, TICK_HZ, ROUND_TICKS, SHRINK_TICKS, FUSE_TICKS } from '../src/sim';
import { createBot, botInput, BotLevel } from '../src/bot';
const N = Number(process.env.N ?? 80);
const square = (seed: number): World => {
  const w = createWorld({ seed, players: [{ colorId: 'gold' }, { colorId: 'blue' }], softDensity: 0 });
  for (const i of w.shrinkOrder) w.tiles[i] = HARD;
  w.shrinkNext = w.shrinkOrder.length;
  w.tick = ROUND_TICKS + SHRINK_TICKS + 1;
  const [a, b] = w.players; a.x = 5; a.y = 5; b.x = 9; b.y = 7;
  return w;
};
for (const level of ['normal', 'hard'] as BotLevel[]) {
  let d24 = 0, d = 0;
  for (let seed = 1; seed <= N; seed++) {
    const w = square(seed);
    const bots = [0, 1].map((i) => createBot(i, level, 21 + seed));
    for (let t = 0; t < 90 * TICK_HZ && !w.over; t++) step(w, bots.map((bot) => botInput(w, bot)));
    if (w.over) { d++; if (seed <= 24) d24++; }
  }
  console.log(`fuse ${FUSE_TICKS} ${level}: ${d24} of 24, ${d} of ${N}`);
}
