/**
 * Checks of the victory dances (src/dances.ts): every moment is a stance a robot can be drawn in, the same
 * time always gives the same picture, and each dance needs only a handful of pictures (they are made once
 * and kept, so a dance with many would stutter the first time it plays).
 * Run with: npm test
 */
import assert from 'node:assert';
import { DANCES, DANCE_IDS, danceFrame, danceSamples, isDance, stepDance } from '../src/dances';

assert.deepStrictEqual(DANCE_IDS, ['party', 'spin', 'griddy'], 'three dances, Party first (the one before there was a choice)');
assert.ok(isDance('griddy') && !isDance('floss') && !isDance(3), 'isDance knows the dances and nothing else');
assert.strictEqual(stepDance('party', -1), 'griddy', '‹ from the first goes round to the last');
assert.strictEqual(stepDance('griddy', 1), 'party', '› from the last goes round to the first');

for (const d of DANCES) {
  const pictures = new Set<string>();
  for (const f of danceSamples(d.id)) {
    assert.ok([1, 2, 3, 4].includes(f.facing), `${d.name}: faces a real way`);
    const arms = f.pose.arms ?? [0, 0];
    for (const a of arms) assert.ok(a >= 0 && a <= 1, `${d.name}: arms between hanging and right up`);
    assert.ok((f.pose.jump ?? 0) >= 0 && (f.pose.jump ?? 0) <= 0.7, `${d.name}: jumps stay sensible`);
    assert.ok(Math.abs(f.dx) <= 0.25, `${d.name}: stays on its tile, near enough`);
    const front = f.facing === 2 || f.facing === 1;
    const step = f.moving ? Math.round((f.walk / (Math.PI * 2)) * 8) % 8 : -1;
    pictures.add(`${f.facing}|${step}|${front ? arms.map((a) => Math.round(a * 8)).join(',') : ''}`);
  }
  assert.ok(pictures.size <= 12, `${d.name}: ${pictures.size} pictures, few enough to make ahead of time`);
  for (const t of [0, 0.37, 1.5, 2.9]) assert.deepStrictEqual(danceFrame(d.id, t), danceFrame(d.id, t), `${d.name}: the same time, the same moment`);
}
assert.ok(danceSamples('spin').some((f) => f.facing === 1) && danceSamples('spin').some((f) => f.facing === 3), 'Spin turns all the way round');
assert.ok(danceSamples('griddy').every((f) => f.moving), 'the Griddy keeps stepping');
