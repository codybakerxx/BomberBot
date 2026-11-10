/**
 * Checks of the swipe pad (src/swipe.ts), using made-up thumb paths.
 *
 * A path is a list of positions and times, exactly what the pad gets from a
 * real touch. Distances are in px (about 5.5 px per mm on a phone); angles are
 * on screen, anticlockwise from "right": 0 = right, 90 = up, 180 = left, 270 = down.
 * Run with: npm test
 */
import assert from 'node:assert';
import type { Dir } from '../src/sim';
import { SwipePad, DEFAULT_TILT } from '../src/swipe';

{
  // moves the thumb in a straight line in 8 ms steps and returns every direction seen
  let t = 0;
  let x = 0;
  let y = 0;
  let pad = new SwipePad();
  const fresh = (tilt = 0): void => {
    pad = new SwipePad();
    pad.tilt = tilt; // 0 = judge by the screen's own up/down/left/right
    t = 0;
    x = 200;
    y = 300;
    pad.press(x, y, t);
  };
  const glide = (dx: number, dy: number, ms: number): Dir[] => {
    const n = Math.max(1, Math.round(ms / 8));
    const seen: Dir[] = [];
    const x0 = x;
    const y0 = y;
    for (let i = 1; i <= n; i++) {
      t += ms / n;
      x = x0 + (dx * i) / n;
      y = y0 + (dy * i) / n;
      pad.move(x, y, t);
      seen.push(pad.dir);
    }
    return seen;
  };
  const rest = (ms: number): void => {
    for (let i = 0; i < ms / 16; i++) {
      t += 16;
      pad.poll(t);
    }
  };
  /** thumb travel at the moment the direction first became `want` */
  const travelWhen = (seen: Dir[], want: Dir, total: number): number => ((seen.indexOf(want) + 1) / seen.length) * total;

  // touching down and swiping starts you moving after about 14 px
  fresh();
  let seen = glide(60, 0, 100);
  assert.ok(seen.includes(4));
  const startAt = travelWhen(seen, 4, 60);
  assert.ok(startAt >= 14 && startAt <= 20, `started at ${startAt}`);
  rest(300);
  assert.equal(pad.dir, 4, 'holding still keeps you going');

  // a quick 22 px wiggle from a resting thumb, in every direction, is ignored
  for (const [dx, dy] of [[0, 22], [0, -22], [-22, 0], [22, 0], [16, 16], [-16, 16]]) {
    assert.ok(glide(dx, dy, 40).every((d) => d === 4));
    assert.ok(glide(-dx, -dy, 40).every((d) => d === 4));
    rest(200);
  }
  // slow drift is ignored however far it creeps
  assert.ok(glide(0, 70, 3500).every((d) => d === 4), 'slow drift down');
  assert.ok(glide(-70, 0, 3500).every((d) => d === 4), 'slow drift back');
  rest(200);
  // a real swipe down turns you once the thumb has left the quiet zone (30 px)
  seen = glide(0, 60, 100);
  const turnAt = travelWhen(seen, 2, 60);
  assert.ok(turnAt >= 30 && turnAt <= 36, `turned at ${turnAt}`);

  // the bounce-back after a flick does not reverse or turn you
  fresh();
  rest(200);
  glide(-40, 0, 50);
  assert.equal(pad.dir, 3);
  assert.ok(glide(24, 0, 40).every((d) => d === 3), 'straight bounce-back');
  rest(200);
  fresh();
  glide(40, 0, 50);
  assert.ok(glide(-14, 10, 40).every((d) => d === 4), 'bounce-back with a sideways wobble');
  assert.ok(glide(0, 9, 30).every((d) => d === 4));
  rest(200);
  assert.equal(pad.dir, 4);

  // regular swiping: right then down in one motion turns after a clear sideways move
  fresh();
  glide(60, 0, 80);
  seen = glide(0, 50, 60);
  const cornerAt = travelWhen(seen, 2, 50);
  assert.ok(cornerAt >= 24 && cornerAt <= 30, `corner at ${cornerAt}`);
  // right then straight back left reverses once you have come back a zone's width
  fresh();
  glide(60, 0, 80);
  seen = glide(-60, 0, 80);
  const backAt = travelWhen(seen, 3, 60);
  assert.ok(backAt >= 30 && backAt <= 36, `reversed at ${backAt}`);
  // a slanted or curved swipe keeps its direction
  fresh();
  assert.ok(glide(90, 60, 150).filter((d) => d !== 0).every((d) => d === 4), 'a 34 degree slant stays right');
  // circling the thumb clockwise goes down, left, up, right in order
  fresh();
  glide(40, 0, 60);
  const circle: Dir[] = [pad.dir];
  for (let i = 1; i <= 60; i++) {
    const ang = (i / 60) * Math.PI * 2;
    t += 12;
    pad.move(190 + 50 * Math.cos(ang), 300 + 50 * Math.sin(ang), t);
    if (circle[circle.length - 1] !== pad.dir) circle.push(pad.dir);
  }
  assert.deepEqual(circle.slice(0, 5), [4, 2, 3, 1, 4]);

  // --- direction decoding with the standard lean for a left thumb ---
  // A stroke is given as an angle on screen: 0 = right, 90 = up, 180 = left, 270 = down.
  const stroke = (deg: number, len = 60, ms = 90): Dir[] =>
    glide(len * Math.cos((deg * Math.PI) / 180), -len * Math.sin((deg * Math.PI) / 180), ms);
  const ANG: Record<number, number> = { 1: 90, 2: 270, 3: 180, 4: 0 };
  // start the robot going each way in turn, let the thumb rest, then make the stroke
  const decode = (going: Dir, deg: number, tilt?: number): Dir => {
    fresh(tilt ?? DEFAULT_TILT);
    stroke(ANG[going]);
    assert.equal(pad.dir, going);
    rest(200);
    stroke(deg);
    return pad.dir;
  };
  for (const going of [1, 2, 3, 4] as Dir[]) {
    // straight swipes read as themselves
    for (const want of [1, 2, 3, 4] as Dir[]) assert.equal(decode(going, ANG[want]), want, `straight ${want} while going ${going}`);
    // the natural arc of a left thumb: left drifts up, right drifts down, up drifts right, down drifts left
    for (const lean of [20, 35, 50]) {
      for (const want of [1, 2, 3, 4] as Dir[]) {
        assert.equal(decode(going, ANG[want] - lean), want, `${want} leaning ${lean} while going ${going}`);
      }
    }
    // and a little the other way is still fine
    for (const want of [1, 2, 3, 4] as Dir[]) assert.equal(decode(going, ANG[want] + 20), want);
  }
  // the same swipe gives the same answer whichever way the robot is going
  for (let deg = 0; deg < 360; deg += 7) {
    const answers = new Set(([1, 2, 3, 4] as Dir[]).filter((g) => Math.abs(((ANG[g] - deg + 540) % 360) - 180) > 60).map((g) => decode(g, deg)));
    assert.equal(answers.size, 1, `stroke at ${deg} degrees read differently depending on the robot's direction`);
  }
  // the pad reports each stroke's real movement once, read over a decent length (used by Match my thumb)
  fresh(DEFAULT_TILT);
  let got: number[][] = [];
  pad.onStroke = (vx, vy) => got.push([vx, vy]);
  const angleOf = (v: number[]): number => ((Math.atan2(-v[1], v[0]) * 57.2958 + 360) % 360);
  stroke(140, 50); // from a fresh touch
  rest(200);
  stroke(300, 50); // from a resting thumb
  rest(200);
  assert.equal(got.length, 2);
  assert.ok(Math.abs(angleOf(got[0]) - 140) < 1 && Math.hypot(got[0][0], got[0][1]) >= 36);
  assert.ok(Math.abs(angleOf(got[1]) - 300) < 1);
  // a landing wobble at the start of a touch does not spoil the reading
  fresh(DEFAULT_TILT);
  got = [];
  pad.onStroke = (vx, vy) => got.push([vx, vy]);
  glide(-4, 5, 24);
  stroke(150, 50);
  rest(200);
  assert.equal(got.length, 1);
  assert.ok(Math.abs(angleOf(got[0]) - 150) < 12, `read ${angleOf(got[0])}`);
  // a short stroke is reported when it ends, as far as it got
  fresh(DEFAULT_TILT);
  got = [];
  pad.onStroke = (vx, vy) => got.push([vx, vy]);
  stroke(180, 24);
  assert.equal(got.length, 0);
  rest(200);
  assert.equal(got.length, 1);
  assert.ok(Math.abs(angleOf(got[0]) - 180) < 2 && Math.abs(Math.hypot(got[0][0], got[0][1]) - 24) < 2);
  // one continuous swipe with a turn in it is one stroke, not two
  fresh(DEFAULT_TILT);
  got = [];
  pad.onStroke = (vx, vy) => got.push([vx, vy]);
  stroke(0, 60);
  stroke(270, 60);
  rest(200);
  assert.equal(got.length, 1);

  // the pad reads each direction around its own aim when given one per direction
  fresh(0);
  stroke(120); // between left (180) and up (90), nearer up
  assert.equal(pad.dir, 1);
  fresh(0);
  pad.aims = [0, 90, 270, 140, 0]; // left aimed 40 degrees clockwise, the others straight
  stroke(120); // now nearer left's aim than up's (the border sits at 115)
  assert.equal(pad.dir, 3);
  stroke(270);
  assert.equal(pad.dir, 2, 'and the other directions still read as before');

  // the menu setting scales the quiet zone
  fresh();
  pad.scale = 0.6;
  glide(60, 0, 100);
  rest(200);
  const small = travelWhen(glide(0, 60, 100), 2, 60);
  assert.ok(small >= 18 && small <= 23, `small zone turned at ${small}`);
  pad.release();
  assert.equal(pad.dir, 0);
}
