/**
 * Checks of the Match my thumb maths (src/teach.ts): measuring how far a swipe
 * leans, averaging a dozen of them, and choosing the lean the pad should use.
 * Run with: npm test
 */
import assert from 'node:assert';
import { Dir, makeRng } from '../src/sim';
import {
  TEACH_ORDER,
  TEST_ORDER,
  ThumbSummary,
  TestSwipe,
  judge,
  leanOf,
  marginOf,
  perDirectionAims,
  pickBest,
  singleAims,
  summarise,
  tiltFor,
} from '../src/teach';
import { STRAIGHT, uniformAims, nearestDir } from '../src/swipe';

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

// version 2: candidate settings, the test round and choosing between them
{
  const wrap = (a: number): number => ((((a + 180) % 360) + 360) % 360) - 180;
  /** a summary as summarise would give it, for chosen leans */
  const summary = (lean: number, by: number[]): ThumbSummary => ({ lean, by, spread: 5, ok: true });
  /** a swipe meant as `want` that leans `lean` degrees clockwise */
  const swipe = (want: Dir, lean: number): TestSwipe => {
    const a = ((STRAIGHT[want] - lean) * Math.PI) / 180;
    return { want, vx: 40 * Math.cos(a), vy: -40 * Math.sin(a) };
  };

  // the test asks for each direction twice
  assert.equal(TEST_ORDER.length, 8);
  for (const d of [1, 2, 3, 4]) assert.equal(TEST_ORDER.filter((w) => w === d).length, 2);

  // one lean is version 1's setting
  assert.deepEqual(singleAims(summary(20, [0, 20, 20, 20, 20])), uniformAims(15));

  // a lean per direction: the same as one lean when every direction leans alike
  assert.deepEqual(perDirectionAims(summary(20, [0, 20, 20, 20, 20])), uniformAims(15));
  // otherwise each direction's own lean, pulled half way toward the average
  const per = perDirectionAims(summary(20, [0, 0, 0, 40, 40]));
  assert.deepEqual(per.slice(1).map((a, i) => Math.round(wrap(STRAIGHT[i + 1] - a))), [8, 8, 23, 23]);

  // whatever the leans, a perfectly straight swipe stays at least 20 degrees inside its own quarter
  const r = makeRng(11);
  for (let i = 0; i < 2000; i++) {
    const by = [0, 1, 2, 3, 4].map(() => (r() - 0.5) * 140);
    const aims = perDirectionAims(summary(Math.round((r() - 0.5) * 140), by));
    for (const d of [1, 2, 3, 4] as Dir[]) {
      const s = swipe(d, 0);
      assert.equal(nearestDir(aims, s.vx, s.vy), d);
      assert.ok(marginOf(aims, d, s.vx, s.vy) >= 20 - 1e-9, `straight ${d} has room`);
    }
  }

  // margins: a straight swipe right with the standard 15 degree lean is 30 degrees from the border with up
  assert.ok(Math.abs(marginOf(uniformAims(15), 4, 1, 0) - 30) < 1e-9);
  // and a misread swipe has a negative margin
  const up = swipe(1, 0);
  assert.ok(marginOf(uniformAims(0), 3, up.vx, up.vy) < 0);

  // judging: every swipe read right, and the closest call
  const tests = TEST_ORDER.map((w) => swipe(w, w >= 3 ? 40 : 0)); // left and right lean 40, up and down straight
  const single = judge(singleAims(summary(20, [0, 0, 0, 40, 40])), tests);
  const perV = judge(perDirectionAims(summary(20, [0, 0, 0, 40, 40])), tests);
  assert.equal(single.right, 8);
  assert.equal(perV.right, 8);
  assert.ok(Math.abs(single.closest - 20) < 1e-9);
  assert.ok(perV.closest > single.closest, 'for a thumb like this a lean per direction leaves more room');
  // with no lean allowed for, a left swipe leaning 40 is only 5 degrees from the border with up
  assert.ok(Math.abs(judge(uniformAims(0), tests).closest - 5) < 1e-9);

  // choosing: more read right wins; then the larger closest call; an exact tie keeps the earlier one
  assert.equal(pickBest([{ right: 7, total: 8, closest: 30 }, { right: 8, total: 8, closest: 2 }]), 1);
  assert.equal(pickBest([{ right: 8, total: 8, closest: 12 }, { right: 8, total: 8, closest: 19 }]), 1);
  assert.equal(pickBest([{ right: 8, total: 8, closest: 19 }, { right: 8, total: 8, closest: 19 }]), 0);
  // closest calls are compared as the whole degrees shown on screen: 20.6 and 21.4 both show 21, a tie
  assert.equal(pickBest([{ right: 8, total: 8, closest: 20.6 }, { right: 8, total: 8, closest: 21.4 }]), 0);
}

