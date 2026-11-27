/**
 * ALL HAIL THE HUMAN (src/hail.ts): where the CPU players stand round your robot, and that the letters land
 * before the robots come in. The animation itself has to be seen on a phone.
 */
import assert from 'node:assert/strict';
import { ring, HAIL, HAIL_SECONDS, YOU_WON, lettersDone } from '../src/hail';
import { SOUND_GROUPS, SOUND_NAMES } from '../src/setup';

for (let n = 1; n <= 7; n++) {
  const r = ring(n);
  assert.equal(r.length, n, `${n} CPU players, ${n} places`);
  for (const s of r) {
    // nobody hides behind your robot, and everyone faces it
    assert.ok(Math.abs(s.x) > 0.9, `${n}: a place beside your robot, not behind it (${s.x.toFixed(2)})`);
    assert.equal(s.facing, s.x < 0 ? 4 : 3, `${n}: faces your robot`);
    assert.equal(s.from, s.x < 0 ? -1 : 1, `${n}: comes in from its own side`);
  }
  // no two in the same place
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) assert.ok(Math.hypot(r[i].x - r[j].x, r[i].y - r[j].y) > 0.25, `${n}: ${i} and ${j} apart`);
}
assert.ok(lettersDone(HAIL) < 1.6 && lettersDone(HAIL) < HAIL_SECONDS - 2, 'the letters are down well before the end');
assert.ok(lettersDone(YOU_WON) < 1 && YOU_WON.seconds < HAIL_SECONDS && !YOU_WON.stage, 'YOU WON! is quicker and plainer');
for (const id of ['slam', 'firework']) {
  assert.ok(SOUND_NAMES.some(([s]) => s === id), `a sound switch for ${id}`);
  assert.ok(SOUND_GROUPS.some(([, ids]) => ids.includes(id)), `${id} in a group`);
}
