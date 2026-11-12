/**
 * How rare is each power-up, per arena? Builds a lot of arenas with the real
 * createWorld and counts what is hidden under the bricks.
 *
 *   npx tsx experiments/item-rarity.ts
 *
 * The chances themselves are ITEM_CHANCE in src/sim.ts. This turns them into
 * what a player sees: how many of each to expect in a round, and how often a
 * round has none at all.
 */
import { createWorld, ITEM_CHANCE, SOFT } from '../src/sim';

const N = 20000;
const names: Record<string, string> = { bomb: 'Bomb', fire: 'Flame', speed: 'Speed', kick: 'Boot', grab: 'Glove', shield: 'Shield', curse: 'Curse' };
const total: Record<string, number> = {};
const withOne: Record<string, number> = {};
const withTwo: Record<string, number> = {};
let bricks = 0;
let hiding = 0;
for (let seed = 1; seed <= N; seed++) {
  const w = createWorld({ seed, players: [0, 1, 2, 3].map((i) => ({ colorId: String(i) })) });
  bricks += w.tiles.filter((t) => t === SOFT).length;
  hiding += w.hidden.size;
  const count: Record<string, number> = {};
  for (const k of w.hidden.values()) count[k] = (count[k] ?? 0) + 1;
  for (const [k, n] of Object.entries(count)) {
    total[k] = (total[k] ?? 0) + n;
    withOne[k] = (withOne[k] ?? 0) + 1;
    if (n >= 2) withTwo[k] = (withTwo[k] ?? 0) + 1;
  }
}
const pct = (x: number): string => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;
console.log(`${N} arenas with four players. Bricks per arena: ${(bricks / N).toFixed(1)}. Power-ups per arena: ${(hiding / N).toFixed(1)}.\n`);
console.log('power-up'.padEnd(10) + 'chance under a brick'.padStart(22) + 'average in an arena'.padStart(21) + 'arenas with at least one'.padStart(26) + 'with two or more'.padStart(18));
for (const [k, c] of ITEM_CHANCE) {
  console.log(names[k].padEnd(10) + `${(c * 100).toFixed(1)}%`.padStart(22) + (total[k] / N).toFixed(1).padStart(21) + pct((withOne[k] ?? 0) / N).padStart(26) + pct((withTwo[k] ?? 0) / N).padStart(18));
}
