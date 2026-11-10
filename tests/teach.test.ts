/**
 * Checks of the Match my thumb maths (src/teach.ts): measuring how far a swipe
 * leans, averaging a dozen of them, and choosing the lean the pad should use.
 * Run with: npm test
 */
import assert from 'node:assert';
import { Dir, makeRng } from '../src/sim';
import { TEACH_ORDER, leanOf, summarise, tiltFor } from '../src/teach';

{
  // on screen, y grows downward: (-1, -0.7) is left and up
  assert.ok(Math.abs(leanOf(3, -1, 0)) < 1e-9, 'straight left');
  assert.ok(Math.abs(leanOf(3, -Math.cos(0.6), -Math.sin(0.6)) - 34.4) < 0.1, 'left drifting up leans clockwise');
  assert.ok(Math.abs(leanOf(4, Math.cos(0.6), Math.sin(0.6)) - 34.4) < 0.1, 'right drifting down leans clockwise');
  assert.ok(Math.abs(leanOf(1, Math.sin(0.6), -Math.cos(0.6)) - 34.4) < 0.1, 'up drifting right leans clockwise');
  assert.ok(Math.abs(leanOf(2, -Math.sin(0.6), Math.cos(0.6)) - 34.4) < 0.1, 'down drifting left leans clockwise');
  assert.ok(Math.abs(leanOf(3, -Math.cos(0.3), Math.sin(0.3)) + 17.2) < 0.1, 'left drifting down leans the other way');
  const rngT = makeRng(5);
  const make = (lean: number, sd: number): { want: Dir; lean: number }[] =>
    TEACH_ORDER.map((want) => ({ want, lean: lean + (rngT() + rngT() + rngT() - 1.5) * 2 * sd }));
  const s30 = summarise(make(30, 10));
  assert.ok(s30.ok && Math.abs(s30.lean - 30) <= 6, `measured ${s30.lean}`);
  const s0 = summarise(make(0, 10));
  assert.ok(s0.ok && Math.abs(s0.lean) <= 6);
  assert.equal(summarise(TEACH_ORDER.map((want, i) => ({ want, lean: i * 30 - 170 }))).ok, false, 'scattered swipes are not used');
  assert.equal(tiltFor(0), 0);
  assert.equal(tiltFor(20), 15);
  assert.equal(tiltFor(40), 25, 'never leans the pad more than 25 degrees');
  assert.equal(tiltFor(-40), -20);
  assert.equal(TEACH_ORDER.length, 12);
  for (const d of [1, 2, 3, 4]) assert.equal(TEACH_ORDER.filter((w) => w === d).length, 3);
}
