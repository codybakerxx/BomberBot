/**
 * The robot: how it is drawn, from the front, the back and each side.
 *
 * The design was settled by the owner on a large front view (see
 * docs/ROADMAP.md): a glossy toy robot with an armoured body in its own
 * colour, black joints, a black pelvis with three lines across it, fists with
 * no thumb, big black boots with a lit sole, and a domed black glass helmet
 * with a rim and chin piece in its colour. Do not move the shapes of the front
 * view unless asked; the back and side views were worked out from it.
 *
 * Drawing one robot takes a few hundred canvas calls, far too many to make for
 * four robots sixty times a second on a phone. So each robot is drawn once
 * into a small picture of its own (a sprite) for each way it can look: colour,
 * direction, step of the walk, how far each arm is raised. After that, drawing
 * it is one drawImage. See `sprite` and `drawRobot`.
 *
 * The finish is meant to read as smooth, glossy metal: every piece is lit from
 * the top left and shaded to the bottom right, carries a faint reflection of a
 * bright sky over a dark floor, has a soft-edged highlight, and throws a
 * shadow on the piece beneath it. On a large drawing (the menu, artwork) each
 * piece is also rounded by soft shadow and light inside its edges; at playing
 * size that would be less than a pixel, so it is left out.
 */
import type { BotColor } from './render';
import type { Dir } from './sim';

type Ctx = CanvasRenderingContext2D;
type Pt = [number, number];
type Box = [number, number, number, number];
type Shape = () => void;

/** Ways a robot can be drawn other than standing or walking. Everything is optional. */
export interface Pose {
  /** how far off the floor it is, in tiles (a jump). Its shadow stays on the floor and shrinks. */
  jump?: number;
  /** how far each arm is raised, 0 hanging to 1 right up: [the arm on the left of the picture, the one on the right]. Front and back views only. */
  arms?: [number, number];
  /** lean of the whole body, in radians, pivoting at the feet */
  lean?: number;
  /** two crosses on the visor where eyes would be: knocked out */
  xEyes?: boolean;
  /** no shadow on the floor (a ghost, or a head on its own) */
  noShadow?: boolean;
  /** a pale helmet instead of a black one (a ghost) */
  pale?: boolean;
  /** a king's crown, sitting crooked on the helmet: the player with the most rounds won */
  crown?: boolean;
  /** for drawHead only: draw just the crown, where it would sit on the head */
  crownOnly?: boolean;
  /** drawn at this share of its full size, about its feet (a burnt robot shrinking as it crumbles) */
  shrink?: number;
  /**
   * false: never give it the soft rounding inside each piece, however large it is drawn. For screens of the
   * game (the title screen), because that rounding has not been tried on an iPhone (see `softly`).
   * Left out, a robot drawn large enough gets it (artwork, tools/portraits.py).
   */
  fine?: boolean;
}

/**
 * The robot is drawn in units of its own, in which it stands 1.25 tall with
 * its feet at y = 0 (up is negative). One of those units is this much of a
 * tile, which makes a robot 1.09 tiles tall and 0.71 wide: its helmet stands
 * a little over the tile above, as characters do in games seen from above.
 *
 * How it got to this size: the first robot was 1.06 tiles tall and 0.9 wide.
 * This slimmer one was drawn taller, 1.35 tiles (1.08 of a tile to the unit),
 * because Claude found it hard to read at the first robot's height. The owner
 * then asked for a head 10% smaller (`HEAD`), and after that for the whole
 * robot 15% smaller, which is this number.
 */
const K = 0.918;
const FIRST_K = 1.08; // the size the things drawn round a robot (wings, halo) were first made for
const R0 = 0.33; // the helmet as it was designed, centre to its outer rim
const DOME0 = 0.31; // the black glass inside that rim
const HEAD = 0.9; // how much of that size the helmet is drawn at: the owner asked for a head 10% smaller
const R = R0 * HEAD; // helmet, centre to its outer rim
const HY = -0.59 - R; // helmet centre, above the feet: the helmet rests on the collar where it did at full size
const LINE = 0.005; // how thick an outline is
const COOL = '200,215,255'; // the light the black parts reflect
const LED = 0.028; // how thick the light bar on the helmet is
const LED_LINE = 0.008; // how thick the black line under it is (0.016 at first; halved)
// The light bar seen from the side: four curves end to end, from the back of the helmet to the front
// (x towards the face, y down, in the first robot's helmet units). From the front it runs back under the
// glass, turns up behind the middle of the head, turns towards the back, then turns up again as it reaches
// the back of the helmet, where it carries on round the far side. The owner's choice, from a reference
// picture. (At first it was one sweep from the back down to the chin.) The first turn, under the glass
// and up, was settled in three goes: flat along the bottom with a tight corner, then one wide round sweep
// (corner at [-0.14, 0.1105], [-0.036, 0.232], low point [0.12, 0.232]), then, as now, half way between.
const SIDE_TRIM: [number, number][][] = [
  [[-0.295, -0.25], [-0.283, -0.21], [-0.262, -0.158], [-0.228, -0.14]],
  [[-0.228, -0.14], [-0.19, -0.12], [-0.172, -0.1], [-0.162, -0.035]],
  [[-0.162, -0.035], [-0.14425, 0.08275], [-0.083, 0.2285], [0.06, 0.23]],
  [[0.06, 0.23], [0.165, 0.2311], [0.2675, 0.2198], [0.37, 0.19]],
];

/** A point on SIDE_TRIM: `i` is which of its curves, `v` how far along that one (0 to 1). */
function sideTrimAt(i: number, v: number): [number, number] {
  const p = SIDE_TRIM[i];
  const r = 1 - v;
  const w = [r * r * r, 3 * r * r * v, 3 * r * v * v, v * v * v];
  return [p[0][0] * w[0] + p[1][0] * w[1] + p[2][0] * w[2] + p[3][0] * w[3], p[0][1] * w[0] + p[1][1] * w[1] + p[2][1] * w[2] + p[3][1] * w[3]];
}

const GLASS = 0.34; // the glass dome's radius in those units

/**
 * Where the light bar would run seen from behind: a round arch over the back of the helmet (the owner asked
 * for it rounded). No bar is drawn there, by the owner's choice: this is only where the helmet's material
 * ends and the glass begins. It is worked out from SIDE_TRIM, so the two views show the same line on the
 * same ball: where the side view has the bar `x` towards the face and `y` down, the roundness of the helmet
 * says how far out to the side that point is, and that is where it is seen from behind.
 *
 * The top of the arch is where the side view's bar reaches the back of the helmet. From there to where the
 * bar starts down the side of the head (the end of SIDE_TRIM's second curve) it is one smooth quarter of an
 * oval through those two points: worked out exactly, the S-bend the bar makes from the side showed here as
 * a wobble. Below that it is exact: it comes down both sides close to the edge (those parts are seen almost
 * edge on) and runs into the edge where the bar goes round to the front.
 * Points from the left end to the right, x out to the right, y down, same units.
 */
const BACK_TRIM: [number, number][] = (() => {
  const n = SIDE_TRIM.length;
  const at = (t: number): [number, number] => {
    const i = Math.min(n - 1, Math.floor(t * n));
    return sideTrimAt(i, t * n - i);
  };
  const inside = (t: number): number => {
    const [x, y] = at(t);
    return GLASS * GLASS - x * x - y * y; // above 0 on the glass
  };
  const forward = (t: number): number => at(t)[0]; // above 0 in front of the middle of the head
  const seen = (t: number): [number, number] => [Math.sqrt(Math.max(0, inside(t))), at(t)[1]]; // that point, from behind
  // the first place after `from` where `f` goes from below 0 to above it
  const crossing = (f: (t: number) => number, from: number): number => {
    let a = from;
    while (a < 1 && f(a + 0.002) <= 0) a += 0.002;
    let b = Math.min(1, a + 0.002);
    for (let i = 0; i < 40; i++) {
      const m = (a + b) / 2;
      if (f(m) <= 0) a = m;
      else b = m;
    }
    return b;
  };
  const top = crossing(inside, 0); // the bar comes onto the glass at the back: the top of the arch
  const turn = 2 / n; // it starts down the side of the head
  const end = crossing(forward, turn); // it reaches the side of the helmet and goes round to the front
  const half: [number, number][] = []; // from the top of the arch down the right side
  // the top: a quarter of an oval from the top of the arch (level there) to the turn (heading the way the bar does there)
  const peak: [number, number] = [0, at(top)[1]];
  const corner = seen(turn);
  const after = seen(turn + 0.004);
  const drop = corner[1] - peak[1];
  const lean = (after[0] - corner[0]) / (after[1] - corner[1] || 1); // how far it leans out for each unit it drops
  const c1: [number, number] = [corner[0] * 0.5523, peak[1]];
  const c2: [number, number] = [corner[0] - lean * drop * 0.5523, corner[1] - drop * 0.5523];
  for (let j = 0; j < 60; j++) {
    const v = j / 60;
    const r = 1 - v;
    const w = [r * r * r, 3 * r * r * v, 3 * r * v * v, v * v * v];
    half.push([peak[0] * w[0] + c1[0] * w[1] + c2[0] * w[2] + corner[0] * w[3], peak[1] * w[0] + c1[1] * w[1] + c2[1] * w[2] + corner[1] * w[3]]);
  }
  // the sides: exactly where the side view puts them
  for (let j = 0; j <= 100; j++) half.push(seen(turn + (end - turn) * (j / 100)));
  // carry each end on a little past the edge of the glass, so the bar is cut off by the edge and not square
  const a = half[half.length - 5];
  const b = half[half.length - 1];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  half.push([b[0] + ((b[0] - a[0]) / len) * 0.06, b[1] + ((b[1] - a[1]) / len) * 0.06]);
  const left = half.slice(1).reverse().map(([x, y]): [number, number] => [-x, y]);
  return [...left, ...half];
})();
/** How far along a row of points each one is, measured from the first. */
function lengthsAlong(pts: [number, number][]): number[] {
  const out = pts.map(() => 0);
  for (let i = 1; i < pts.length; i++) out[i] = out[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return out;
}
/** How far along the arch each of its points is. */
const backAlong = lengthsAlong(BACK_TRIM);
const ARM_SWEEP = 2.6; // how far round an arm goes when it is raised right up, in radians
/**
 * A drawing with at least this many pixels to one of its units (a robot 500 pixels tall or more) gets the
 * soft rounding inside each piece's edges. Nothing in the game is drawn that large yet: it is for artwork
 * (tools/portraits.py). If a screen in the game ever is, try it on an iPhone first: see `softly`.
 */
const FINE_FROM = 400;

/** Where things are on a robot standing on (0, 0), in tiles: for whatever is drawn round one (crown, halo, wings, shield). */
export const ROBOT = {
  /** how big the robot is next to the size its wings and halo were first drawn for: multiply their sizes by this */
  scale: K / FIRST_K,
  /** the middle of the helmet, and how far it is from there to its rim */
  headY: HY * K,
  headR: R * K,
  /** the very top of the helmet */
  top: (HY - R) * K,
  /** the shoulders */
  shoulderX: 0.247 * K,
  shoulderY: -0.582 * K,
  /** half way up the whole robot */
  midY: ((HY - R) * K) / 2,
};

// ---------------------------------------------------------------- shapes

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number | number[]): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
/**
 * A rounded rectangle for a side view. `back` is its back edge and it runs `w`
 * toward the front; `d` is 1 for a robot facing right, -1 facing left. The
 * corner sizes are given back-top, front-top, front-bottom, back-bottom.
 */
function rrd(ctx: Ctx, back: number, y: number, w: number, h: number, r: [number, number, number, number], d: number): void {
  if (d > 0) rr(ctx, back, y, w, h, r);
  else rr(ctx, -back - w, y, w, h, [r[1], r[0], r[3], r[2]]);
}
function dot(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}
function oval(ctx: Ctx, x: number, y: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
}
/** A closed shape through `pts`, with its corners rounded to radius `r`. */
function poly(ctx: Ctx, pts: Pt[], r: number): void {
  const n = pts.length;
  const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const start = mid(pts[n - 1], pts[0]);
  ctx.beginPath();
  ctx.moveTo(start[0], start[1]);
  for (let i = 0; i < n; i++) {
    const m = mid(pts[i], pts[(i + 1) % n]);
    ctx.arcTo(pts[i][0], pts[i][1], m[0], m[1], r);
  }
  ctx.closePath();
}
/** A piece of a limb from `a` to `b`: half as wide as `wa` at one end and `wb` at the other. */
function limb(ctx: Ctx, a: Pt, b: Pt, wa: number, wb: number, r: number): void {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const nx = -(b[1] - a[1]) / len;
  const ny = (b[0] - a[0]) / len;
  poly(ctx, [[a[0] + nx * wa, a[1] + ny * wa], [b[0] + nx * wb, b[1] + ny * wb], [b[0] - nx * wb, b[1] - ny * wb], [a[0] - nx * wa, a[1] - ny * wa]], r);
}
const lerp = (a: Pt, b: Pt, k: number): Pt => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
const flip = (pts: Pt[], sg: number): Pt[] => pts.map(([px, py]) => [px * sg, py]);
function boxOf(...pts: Pt[]): Box {
  return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
}
/** The red, green and blue of a colour written #rrggbb or rgb(r,g,b). */
function rgbOf(col: string): [number, number, number] {
  if (col[0] === '#') return [parseInt(col.slice(1, 3), 16), parseInt(col.slice(3, 5), 16), parseInt(col.slice(5, 7), 16)];
  const m = col.match(/[\d.]+/g) ?? ['0', '0', '0'];
  return [Number(m[0]), Number(m[1]), Number(m[2])];
}
/** A colour part of the way from `a` to `b`, as "r,g,b". */
function mixRgb(a: string, b: string, k: number): string {
  const pa = rgbOf(a);
  const pb = rgbOf(b);
  return [0, 1, 2].map((i) => Math.round(pa[i] + (pb[i] - pa[i]) * k)).join(',');
}

// ---------------------------------------------------------------- the finish

/** true while a drawing is large enough for the soft rounding to show (see FINE_FROM) */
let FINE = false;
/**
 * What the suit's own shadows are made of, as "r,g,b": a deep tone of the suit's colour, not black, so that
 * gold stays gold and pink stays pink in the shade. (The black parts, which are lit with a tint, shade to black.)
 */
let SUIT_DIM = '0,0,10';

/**
 * Soft-edged drawing that works in every browser. The canvas blur filter is
 * missing on iPhones, so this uses a shadow instead: the shape is drawn far
 * off to one side, where the clip hides it, and its blurred shadow is thrown
 * back to where the shape should have been. `blur` is in the drawing's units.
 */
const FAR = 4;
function softly(ctx: Ctx, colour: string, blur: number, dx: number, dy: number, draw: () => void): void {
  const m = ctx.getTransform();
  ctx.save();
  ctx.shadowColor = colour;
  ctx.shadowBlur = blur * Math.hypot(m.a, m.b) * 2;
  ctx.shadowOffsetX = -m.a * FAR;
  ctx.shadowOffsetY = -m.b * FAR;
  ctx.translate(FAR + dx, dy);
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  draw();
  ctx.restore();
}

type Spot = [x: number, y: number, long: number, wide: number, turn: number, bright: number];
interface Gloss {
  /** how much light falls on the lit corner */
  light?: number;
  /** how dark the far side gets */
  shade?: number;
  /** how bright the thin lit rim is */
  rim?: number;
  /** the colour of the light, as "r,g,b". Leave it out for a piece of the suit */
  tint?: string;
  /** how deep the rounding at the edges goes (smaller for small pieces) */
  depth?: number;
  /** how strongly the piece reflects a bright sky over a dark floor: what makes it read as metal */
  sky?: number;
  /** highlights: where, how long and wide, which way it lies, how bright */
  spots?: Spot[];
}

function ink(ctx: Ctx, shape: Shape, colour: string): void {
  shape();
  ctx.strokeStyle = colour;
  ctx.lineWidth = LINE;
  ctx.stroke();
}

/**
 * One piece of smooth, shiny metal. `shape` makes its path. It is filled; lit
 * from the top-left corner of `box` and shaded toward the bottom-right; given
 * a faint reflection of sky above and floor below; on a large drawing, rounded
 * at its edges by soft shadow on the far side and soft light on the near side;
 * given its highlights (each a crisp core in a soft glow) and a thin lit rim;
 * and outlined.
 */
function glossy(ctx: Ctx, shape: Shape, fill: string | CanvasGradient, outline: string, box: Box, g: Gloss = {}): void {
  const tint = g.tint ?? '255,255,255';
  const shade = g.shade ?? 0.5;
  const light = g.light ?? 0.3;
  const rim = g.rim ?? 0.7;
  const depth = g.depth ?? 0.014;
  const sky = g.sky ?? 1;
  const dim = g.tint ? '0,0,10' : SUIT_DIM;
  const [x0, y0, x1, y1] = box;
  shape();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.save();
  shape();
  ctx.clip();
  const lg = ctx.createLinearGradient(x0, y0, x1, y1);
  lg.addColorStop(0, `rgba(${tint},${light})`);
  lg.addColorStop(0.4, `rgba(${tint},0)`);
  lg.addColorStop(0.55, `rgba(${dim},0)`);
  lg.addColorStop(1, `rgba(${dim},${shade * 0.8})`);
  ctx.fillStyle = lg;
  ctx.fillRect(-3, -3, 6, 6);
  if (sky > 0) {
    const eg = ctx.createLinearGradient(0, y0, 0, y1);
    eg.addColorStop(0, `rgba(${tint},${0.16 * sky})`);
    eg.addColorStop(0.36, `rgba(${tint},${0.03 * sky})`);
    eg.addColorStop(0.56, `rgba(${dim},${0.2 * sky})`);
    eg.addColorStop(0.8, `rgba(${dim},${0.06 * sky})`);
    eg.addColorStop(1, `rgba(${tint},${0.07 * sky})`);
    ctx.fillStyle = eg;
    ctx.fillRect(-3, -3, 6, 6);
  }
  if (FINE) {
    // rounded edges: shadow gathers inside the far edge, light inside the near one
    softly(ctx, `rgba(${dim},${Math.min(1, shade * 1.15)})`, depth * 0.9, -depth, -depth * 1.3, () => {
      shape();
      ctx.lineWidth = depth * 2.6;
      ctx.stroke();
    });
    softly(ctx, `rgba(${tint},${Math.min(1, light * 1.6)})`, depth * 0.6, depth * 0.8, depth, () => {
      shape();
      ctx.lineWidth = depth * 1.5;
      ctx.stroke();
    });
  }
  for (const [cx, cy, long, wide, turn, bright] of g.spots ?? []) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(turn);
    ctx.scale(1, wide / long);
    const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, long * 2);
    halo.addColorStop(0, `rgba(${tint},${bright * 0.4})`);
    halo.addColorStop(1, `rgba(${tint},0)`);
    ctx.fillStyle = halo;
    dot(ctx, 0, 0, long * 2);
    ctx.fill();
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, long);
    core.addColorStop(0, `rgba(${tint},${bright})`);
    core.addColorStop(0.5, `rgba(${tint},${bright * 0.8})`);
    core.addColorStop(1, `rgba(${tint},0)`);
    ctx.fillStyle = core;
    dot(ctx, 0, 0, long);
    ctx.fill();
    ctx.restore();
  }
  const rg = ctx.createLinearGradient(x0, y0, x1, y1);
  rg.addColorStop(0, `rgba(${tint},${rim})`);
  rg.addColorStop(0.4, `rgba(${tint},0)`);
  rg.addColorStop(0.8, `rgba(${tint},0)`);
  rg.addColorStop(1, `rgba(${tint},${rim * 0.35})`);
  shape();
  ctx.strokeStyle = rg;
  ctx.lineWidth = 0.014;
  ctx.stroke();
  ctx.restore();
  ink(ctx, shape, outline);
}

/**
 * The shadow that `caster` throws on `receiver`: the caster's shape, moved the
 * way shadows fall and kept inside the receiver. Soft-edged on a large drawing.
 */
function cast(ctx: Ctx, receiver: Shape, caster: Shape, dx: number, dy: number, blur: number, strength: number): void {
  ctx.save();
  receiver();
  ctx.clip();
  if (FINE) {
    softly(ctx, `rgba(0,0,10,${strength})`, blur, dx, dy, () => {
      caster();
      ctx.fill();
    });
  } else {
    ctx.translate(dx, dy);
    caster();
    ctx.fillStyle = `rgba(0,0,10,${strength * 0.75})`;
    ctx.fill();
  }
  ctx.restore();
}

/** A groove where two panels meet, inside `shape`, with light on its lower lip. */
function seam(ctx: Ctx, shape: Shape, pts: Pt[], light = '255,255,255'): void {
  ctx.save();
  shape();
  ctx.clip();
  const line = (dx: number, dy: number): void => {
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(px + dx, py + dy) : ctx.moveTo(px + dx, py + dy)));
    ctx.stroke();
  };
  ctx.strokeStyle = `rgba(${light},0.45)`;
  ctx.lineWidth = 0.004;
  line(0.0015, 0.005);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 0.005;
  line(0, 0);
  ctx.restore();
}

/** Darken a piece that is on the far side of the body, so it sits back. */
function farSide(ctx: Ctx, shape: Shape): void {
  ctx.save();
  shape();
  ctx.clip();
  ctx.fillStyle = 'rgba(0,0,10,0.3)';
  ctx.fillRect(-3, -3, 6, 6);
  ctx.restore();
}

// ---------------------------------------------------------------- the robot

/** What a drawing of one robot needs to hand: the canvas, the colours, and the two fills every piece is made of. */
interface Kit {
  ctx: Ctx;
  c: BotColor;
  suit: CanvasGradient;
  black: CanvasGradient;
  /** the colour of the suit's outlines */
  edge: string;
  pale: boolean;
  xEyes: boolean;
}
const DARK = '#000000'; // outlines of the black parts
const JOINT: Gloss = { tint: COOL, light: 0.22, shade: 0.4, rim: 0.5, depth: 0.01, sky: 0.8 };

/** Get ready to draw a robot in colour `c` on `ctx`, which must already be set to the robot's own units. */
function kitFor(ctx: Ctx, c: BotColor, pale: boolean, xEyes: boolean, fine = true): Kit {
  const m = ctx.getTransform();
  FINE = fine && Math.hypot(m.a, m.b) >= FINE_FROM;
  SUIT_DIM = mixRgb(c.dark, '#000000', 0.72);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const suit = ctx.createLinearGradient(-0.35, -0.65, 0.35, 0);
  suit.addColorStop(0, c.light);
  suit.addColorStop(0.5, c.body);
  suit.addColorStop(1, c.dark);
  const black = ctx.createLinearGradient(-0.3, -0.6, 0.3, 0);
  black.addColorStop(0, '#343745');
  black.addColorStop(0.5, '#111117');
  black.addColorStop(1, '#040405');
  return { ctx, c, suit, black, edge: `rgb(${mixRgb(c.dark, '#000000', 0.62)})`, pale, xEyes };
}

/** How the walk and the arms stand at one moment. */
interface Stance {
  /** the swing of the walk, -1 to 1: one leg forward, then the other. 0 standing still */
  sw: number;
  /** how far the body has dropped (negative: risen) with the step */
  bob: number;
  /** how far each arm is raised, 0 to 1: [left of the picture, right] */
  arms: [number, number];
}

/**
 * The helmet, centred on (hx, hy). `d` is 1 unless it is the side view of a robot facing left. The turned
 * view (artwork only) hands in the `path` its light bar takes, worked out for the way the robot is turned.
 */
function helmet(k: Kit, view: 'front' | 'back' | 'side' | 'turned', d: number, hx: number, hy: number, path: Pt[] = []): void {
  const { ctx, c, suit, edge } = k;
  // everything here is drawn at the size the helmet was designed at, brought down to its real size about its centre
  ctx.save();
  ctx.translate(hx, hy);
  ctx.scale(HEAD, HEAD);
  ctx.translate(-hx, -hy);
  const rimShape: Shape = () => dot(ctx, hx, hy, R0);
  const domeShape: Shape = () => dot(ctx, hx, hy, DOME0);
  // a rim in the suit's colour, turned like a metal ring, round a black glass dome
  glossy(ctx, rimShape, suit, edge, [hx - R0 * 0.75, hy - R0 * 0.75, hx + R0 * 0.75, hy + R0 * 0.75], { shade: 0.6, rim: 0.95, depth: 0.012, sky: 0 });
  const glass = ctx.createRadialGradient(hx - 0.11, hy - 0.15, 0.02, hx, hy, DOME0);
  glass.addColorStop(0, k.pale ? '#f2f5ff' : '#3d4152');
  glass.addColorStop(0.45, k.pale ? '#bcc5da' : '#12121a');
  glass.addColorStop(1, k.pale ? '#8d97b0' : '#010102');
  domeShape();
  ctx.fillStyle = glass;
  ctx.fill();

  const z = DOME0 / 0.34; // the helmet shapes of the first robot, at this dome's size
  // the views whose bar is a row of points and not a curve: the points, and how far along the row each one is
  const line = view === 'turned' ? path : BACK_TRIM;
  const lineAlong = view === 'turned' ? lengthsAlong(path) : backAlong;
  const lineLength = lineAlong[lineAlong.length - 1];
  // the top edge of the chin piece: the line where glass meets colour
  const trim = (): void => {
    if (view === 'side') {
      ctx.moveTo(hx + SIDE_TRIM[0][0][0] * z * d, hy + SIDE_TRIM[0][0][1] * z);
      for (const q of SIDE_TRIM) ctx.bezierCurveTo(hx + q[1][0] * z * d, hy + q[1][1] * z, hx + q[2][0] * z * d, hy + q[2][1] * z, hx + q[3][0] * z * d, hy + q[3][1] * z);
    } else if (view === 'back' || view === 'turned') {
      ctx.moveTo(hx + line[0][0] * z, hy + line[0][1] * z);
      for (const q of line) ctx.lineTo(hx + q[0] * z, hy + q[1] * z);
    } else {
      ctx.moveTo(hx - 0.37 * z, hy - 0.04 * z);
      ctx.quadraticCurveTo(hx, hy + 0.53 * z, hx + 0.37 * z, hy - 0.04 * z);
    }
  };
  // A line that runs alongside the trim, `off` away from it on the chin piece's side (a true parallel:
  // the same distance all the way along, where simply moving the curve down would pinch at the steep ends).
  const beside = (off: number): void => {
    const at = (t: number): Pt => {
      if (view === 'side') {
        const i = Math.min(SIDE_TRIM.length - 1, Math.floor(t * SIDE_TRIM.length));
        const q = sideTrimAt(i, t * SIDE_TRIM.length - i);
        return [hx + q[0] * z * d, hy + q[1] * z];
      }
      if (view === 'back' || view === 'turned') {
        // along the row of points, by distance: they are not evenly spaced
        const want = t * lineLength;
        let i = 1;
        while (i < line.length - 1 && lineAlong[i] < want) i++;
        const v = (want - lineAlong[i - 1]) / (lineAlong[i] - lineAlong[i - 1] || 1);
        const q = lerp(line[i - 1], line[i], v);
        return [hx + q[0] * z, hy + q[1] * z];
      }
      const u = 1 - t;
      return [hx + (-0.37 * u * u + 0.37 * t * t) * z, hy + (-0.04 * u * u + 0.53 * 2 * u * t - 0.04 * t * t) * z];
    };
    const normal = (t: number): Pt => {
      const a = at(Math.max(0, t - 0.01));
      const b = at(Math.min(1, t + 0.01));
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
    };
    // the chin piece is on the lower side of the trim (from the side, judged where the bar runs under the glass;
    // from behind, at the top of the arch; turned, at the bar's lowest point)
    let low = 0;
    if (view === 'turned') line.forEach((q, i) => (low = q[1] > line[low][1] ? i : low));
    const side = normal(view === 'side' ? 0.85 : view === 'turned' ? lineAlong[low] / lineLength : 0.5)[1] > 0 ? 1 : -1;
    const steps = view === 'front' ? 48 : 160;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const p = at(t);
      const n = normal(t);
      const x = p[0] + n[0] * off * side;
      const y = p[1] + n[1] * off * side;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
  };
  ctx.save();
  domeShape();
  ctx.clip();
  // in the glass: the suit's light coming up from below, a broad sheen from above
  const bounce = ctx.createRadialGradient(hx, hy + 0.27, 0.02, hx, hy + 0.27, 0.28);
  bounce.addColorStop(0, c.glow);
  bounce.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = bounce;
  ctx.fillRect(hx - 0.4, hy - 0.1, 0.8, 0.5);
  ctx.globalAlpha = 1;
  ctx.save();
  ctx.translate(hx - 0.11, hy - 0.15);
  ctx.rotate(-0.6);
  ctx.scale(1, 0.55);
  const sheen = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.2);
  sheen.addColorStop(0, `rgba(${COOL},0.26)`);
  sheen.addColorStop(1, `rgba(${COOL},0)`);
  ctx.fillStyle = sheen;
  dot(ctx, 0, 0, 0.2);
  ctx.fill();
  ctx.restore();
  // a faint light round the far side of the glass, from the room behind
  ctx.strokeStyle = `rgba(${COOL},0.16)`;
  ctx.lineWidth = 0.014;
  ctx.beginPath();
  ctx.arc(hx, hy, DOME0 - 0.03, -0.42, 0.3);
  ctx.stroke();

  // the chin piece: rounded like the helmet
  const chin = ctx.createLinearGradient(hx - 0.27, hy, hx + 0.27, hy + 0.36);
  chin.addColorStop(0, c.light);
  chin.addColorStop(0.5, c.body);
  chin.addColorStop(1, c.dark);
  const chinShape: Shape = () => {
    if (view === 'back') {
      // no light bar on the back of the head: the helmet's own material runs up to the glass, over where the bar would be
      beside(-LED / 2);
    } else {
      ctx.beginPath();
      trim();
    }
    if (view === 'side' || view === 'turned') {
      ctx.lineTo(hx + 0.5 * d, hy + 0.6);
      ctx.lineTo(hx - 0.6 * d, hy + 0.6);
      ctx.lineTo(hx - 0.6 * d, hy - 0.5);
    } else {
      ctx.lineTo(hx + 0.5, hy + 0.6);
      ctx.lineTo(hx - 0.5, hy + 0.6);
    }
    ctx.closePath();
  };
  chinShape();
  ctx.fillStyle = chin;
  ctx.fill();
  ctx.save();
  chinShape();
  ctx.clip();
  const round = ctx.createRadialGradient(hx - 0.07, hy - 0.05, DOME0 * 0.66, hx, hy, DOME0);
  round.addColorStop(0, `rgba(${SUIT_DIM},0)`);
  round.addColorStop(1, `rgba(${SUIT_DIM},0.58)`);
  ctx.fillStyle = round;
  ctx.fillRect(hx - 0.5, hy - 0.5, 1, 1);
  if (view === 'front') {
    // a soft light lying on its lit side
    ctx.save();
    ctx.translate(hx - 0.165, hy + 0.2);
    ctx.rotate(0.64);
    ctx.scale(1, 0.16);
    const lit = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.1);
    lit.addColorStop(0, 'rgba(255,255,255,0.8)');
    lit.addColorStop(0.5, 'rgba(255,255,255,0.5)');
    lit.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = lit;
    dot(ctx, 0, 0, 0.1);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
  if (view !== 'back') {
    // the light bar: the lit edge between glass and chin piece (not on the back of the head: the owner's choice)
    const m = ctx.getTransform();
    ctx.shadowColor = c.glow;
    ctx.shadowBlur = Math.hypot(m.a, m.b) * 0.09;
    ctx.strokeStyle = c.glow;
    ctx.lineWidth = LED;
    ctx.beginPath();
    trim();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'rgba(0,0,0,0)';
    // a black line tracing the light bar's curve, right under it, so that the bar stands out from the chin piece
    ctx.strokeStyle = '#050508';
    ctx.lineWidth = LED_LINE;
    beside(LED / 2 + LED_LINE / 2);
    ctx.stroke();
  }
  if (view !== 'back') {
    // the streaks on the glass (two from the front, the nearer one from the side)
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 0.044;
    ctx.beginPath();
    if (d > 0) ctx.arc(hx, hy, DOME0 - 0.082, -1.05, -0.3);
    else ctx.arc(hx, hy, DOME0 - 0.082, Math.PI + 0.3, Math.PI + 1.05);
    ctx.stroke();
    if (view === 'front' || view === 'turned') {
      ctx.strokeStyle = 'rgba(255,255,255,0.52)';
      ctx.lineWidth = 0.036;
      ctx.beginPath();
      ctx.arc(hx, hy, DOME0 - 0.082, -2.45, -2.15);
      ctx.stroke();
    }
    if (k.xEyes) {
      // two crosses on the visor (one and a half show from the side)
      ctx.strokeStyle = '#f4f6ff';
      ctx.lineWidth = 0.042 * z;
      const e = 0.052 * z;
      for (const ex of view === 'side' ? [hx + 0.03 * z * d, hx + 0.2 * z * d] : [hx - 0.12 * z, hx + 0.12 * z]) {
        const ey = hy - 0.05 * z;
        ctx.beginPath();
        ctx.moveTo(ex - e, ey - e);
        ctx.lineTo(ex + e, ey + e);
        ctx.moveTo(ex + e, ey - e);
        ctx.lineTo(ex - e, ey + e);
        ctx.stroke();
      }
    }
  }
  if (FINE) {
    // the rim stands proud of the glass: its shadow lies just inside it, heaviest on the lit side
    softly(ctx, 'rgba(0,0,10,0.85)', 0.008, 0.006, 0.01, () => {
      domeShape();
      ctx.lineWidth = 0.022;
      ctx.stroke();
    });
  }
  ctx.restore();
  ink(ctx, domeShape, DARK);
  ctx.restore();
}

/** A boot's lit sole and the black tread under it. `back` and `w` are as for rrd. */
function sole(k: Kit, back: number, w: number, d: number): void {
  const { ctx, c } = k;
  const m = ctx.getTransform();
  rrd(ctx, back - 0.007, -0.022, w + 0.014, 0.022, [0.009, 0.009, 0.009, 0.009], d);
  ctx.fillStyle = '#07070a';
  ctx.fill();
  ctx.save();
  ctx.shadowColor = c.glow;
  ctx.shadowBlur = Math.hypot(m.a, m.b) * 0.05;
  rrd(ctx, back - 0.005, -0.05, w + 0.01, 0.03, [0.013, 0.013, 0.013, 0.013], d);
  ctx.fillStyle = c.glow;
  ctx.fill();
  ctx.restore();
  rrd(ctx, back + 0.005, -0.047, w - 0.01, 0.007, [0.0035, 0.0035, 0.0035, 0.0035], d);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fill();
}

/** The three machined lines across the pelvis, each following its lower edge: down, flat across, up. */
function pelvisLines(ctx: Ctx, pelvisShape: Shape, left: Pt, crotchL: Pt, crotchR: Pt, right: Pt): void {
  for (const up of [0.024, 0.048, 0.072]) {
    seam(ctx, pelvisShape, [[left[0], left[1] - up], [crotchL[0], crotchL[1] - up], [crotchR[0], crotchR[1] - up], [right[0], right[1] - up]], COOL);
  }
}

/** The black panel set into the top of a shoulder pad centred on (cx, cy). */
function padPanel(ctx: Ctx, pad: Shape, cx: number, cy: number, ry: number, edge: string): void {
  ctx.save();
  pad();
  ctx.clip();
  oval(ctx, cx, cy - ry - 0.006, 0.05, 0.026);
  ctx.fillStyle = '#0c0c11';
  ctx.fill();
  ctx.strokeStyle = `rgba(${COOL},0.4)`;
  ctx.lineWidth = 0.004;
  ctx.beginPath();
  ctx.ellipse(cx, cy - ry - 0.006, 0.043, 0.019, 0, 0.5, Math.PI - 0.5);
  ctx.stroke();
  ctx.restore();
  ink(ctx, pad, edge);
}

/** The robot from the front, or from the back. */
function frontBack(k: Kit, back: boolean, a: Stance): void {
  const { ctx, suit, black, edge } = k;
  const PAD_X = 0.247;
  const PAD_Y = -0.582;
  const PAD_RX = 0.084;
  const PAD_RY = 0.057;

  // ---- the shapes of the body (the design: leave these alone)
  const waist: Pt[] = [[-0.132, -0.44], [0.132, -0.44], [0.146, -0.385], [-0.146, -0.385]];
  const waistShape: Shape = () => poly(ctx, waist, 0.012);
  const pelvis: Pt[] = [[-0.152, -0.4], [0.152, -0.4], [0.172, -0.362], [0.066, -0.298], [-0.066, -0.298], [-0.172, -0.362]];
  const pelvisShape: Shape = () => poly(ctx, pelvis, 0.016);
  const chest: Pt[] = [[-0.168, -0.602], [0.168, -0.602], [0.186, -0.53], [0.124, -0.424], [-0.124, -0.424], [-0.186, -0.53]];
  const chestShape: Shape = () => poly(ctx, chest, 0.02);
  const collarShape: Shape = () => rr(ctx, -0.095, -0.625, 0.19, 0.052, 0.014);
  const rimShape: Shape = () => dot(ctx, 0, HY, R);
  // each shoulder pad reaches in over the top corner of the chest, so the two are joined
  const padShape = (sg: number): Shape => () => oval(ctx, sg * PAD_X, PAD_Y, PAD_RX, PAD_RY);
  const socketShape = (sg: number): Shape => () => dot(ctx, sg * 0.196, -0.556, 0.04);

  // ---- legs. A leg that steps lifts its shin and boot; the thigh stays.
  for (const sg of [-1, 1]) {
    const lift = Math.max(0, sg * a.sw) * 0.05;
    const kneeBack = flip([[0.075, -0.285], [0.172, -0.285], [0.172, -0.225], [0.075, -0.225]], sg);
    glossy(ctx, () => poly(ctx, kneeBack, 0.012), black, DARK, boxOf(...kneeBack), JOINT);

    const thigh = flip([[0.045, -0.4], [0.168, -0.4], [0.181, -0.258], [0.07, -0.258]], sg);
    const tb = boxOf(...thigh);
    const thighShape: Shape = () => poly(ctx, thigh, 0.026);
    glossy(ctx, thighShape, suit, edge, [tb[0], -0.37, tb[2], tb[3]], { spots: [[tb[0] + 0.04, -0.31, 0.034, 0.008, Math.PI / 2 + sg * 0.1, 0.85]] });
    cast(ctx, thighShape, pelvisShape, 0.008, 0.026, 0.012, 0.6);
    ink(ctx, thighShape, edge);

    ctx.save();
    ctx.translate(0, -lift);
    // the shin: from the front it has a knee plate that comes to a point at the top
    const shin = flip(back ? [[0.06, -0.272], [0.176, -0.272], [0.186, -0.12], [0.06, -0.12]] : [[0.06, -0.268], [0.118, -0.292], [0.176, -0.268], [0.186, -0.12], [0.06, -0.12]], sg);
    const sb = boxOf(...shin);
    const shinShape: Shape = () => poly(ctx, shin, 0.02);
    glossy(ctx, shinShape, suit, edge, sb, { spots: [[sb[0] + 0.04, -0.19, 0.04, 0.008, Math.PI / 2, 0.85]] });
    if (!back) seam(ctx, shinShape, [[sb[0], -0.238], [sg * 0.118, -0.222], [sb[2], -0.238]]);

    // the boot: big and round, with a raised cap, a lit stripe round the sole and a black tread under it
    const bx = sg * 0.146;
    const bootShape: Shape = () => rr(ctx, bx - 0.125, -0.142, 0.25, 0.125, [0.095, 0.095, 0.03, 0.03]);
    glossy(ctx, bootShape, black, DARK, [bx - 0.125, -0.142, bx + 0.125, -0.02], {
      tint: COOL,
      light: 0.3,
      shade: 0.4,
      rim: 0.65,
      depth: 0.018,
      sky: 0.9,
      spots: [[bx - 0.045, -0.116, 0.05, 0.01, -0.16, 0.7]],
    });
    cast(ctx, bootShape, shinShape, 0.008, 0.03, 0.012, 0.7);
    if (!back) {
      ctx.save();
      bootShape();
      ctx.clip();
      ctx.strokeStyle = `rgba(${COOL},0.22)`;
      ctx.lineWidth = 0.006;
      ctx.beginPath();
      ctx.ellipse(bx, -0.05, 0.095, 0.05, 0, Math.PI * 1.08, Math.PI * 1.92);
      ctx.stroke();
      ctx.restore();
    }
    ink(ctx, bootShape, DARK);
    sole(k, bx - 0.125, 0.25, 1);
    ctx.restore();
  }

  // everything above the legs rises and falls a little with each step
  ctx.save();
  ctx.translate(0, a.bob);

  // ---- waist and pelvis
  glossy(ctx, waistShape, black, DARK, boxOf(...waist), { ...JOINT, spots: [[-0.06, -0.418, 0.05, 0.006, 0, 0.45]] });
  seam(ctx, waistShape, [[-0.15, -0.421], [0.15, -0.421]], COOL);
  seam(ctx, waistShape, [[-0.15, -0.404], [0.15, -0.404]], COOL);
  cast(ctx, waistShape, chestShape, 0.006, 0.02, 0.01, 0.7);
  ink(ctx, waistShape, DARK);
  glossy(ctx, pelvisShape, black, DARK, boxOf(...pelvis), { tint: COOL, light: 0.28, shade: 0.4, rim: 0.6, depth: 0.014, sky: 0.9, spots: [[-0.1, -0.384, 0.04, 0.005, 0.05, 0.55]] });
  pelvisLines(ctx, pelvisShape, [-0.225, -0.394], [-0.066, -0.298], [0.066, -0.298], [0.225, -0.394]);
  cast(ctx, pelvisShape, waistShape, 0.005, 0.016, 0.008, 0.6);
  ink(ctx, pelvisShape, DARK);

  // ---- arms. A raised arm turns about the shoulder; a hanging one swings a little with the walk.
  for (const sg of [-1, 1]) {
    const up = a.arms[sg < 0 ? 0 : 1];
    const pad = padShape(sg);
    ctx.save();
    if (up > 0) {
      ctx.translate(sg * 0.262, -0.57);
      ctx.rotate(-sg * up * ARM_SWEEP);
      ctx.translate(-sg * 0.262, 0.57);
    }
    // the ribbed joint under the shoulder
    const j0: Pt = [sg * 0.268, -0.56];
    const j1: Pt = [sg * 0.282, -0.495];
    const ribbed: Shape = () => limb(ctx, j0, j1, 0.044, 0.044, 0.012);
    glossy(ctx, ribbed, black, DARK, boxOf(j0, j1), JOINT);
    for (const t of [0.45, 0.7]) {
      const m = lerp(j0, j1, t);
      seam(ctx, ribbed, [[m[0] - 0.06, m[1] + sg * 0.013], [m[0] + 0.06, m[1] - sg * 0.013]], COOL);
    }
    if (up === 0) cast(ctx, ribbed, pad, 0.006, 0.02, 0.01, 0.75);
    ink(ctx, ribbed, DARK);
    if (up === 0) ctx.translate(0, -sg * a.sw * 0.022);
    // the wrist
    const W: Pt = [sg * 0.314, -0.402];
    const H: Pt = [sg * 0.32, -0.335];
    glossy(ctx, () => limb(ctx, lerp(W, H, -0.2), lerp(W, H, 0.4), 0.04, 0.04, 0.01), black, DARK, boxOf(W, H), JOINT);
    // the forearm
    const f0: Pt = [sg * 0.286, -0.512];
    const forearm: Shape = () => limb(ctx, f0, W, 0.056, 0.066, 0.022);
    glossy(ctx, forearm, suit, edge, [Math.min(f0[0], W[0]) - 0.062, f0[1], Math.max(f0[0], W[0]) + 0.062, W[1]], {
      spots: [[lerp(f0, W, 0.5)[0] - 0.026, lerp(f0, W, 0.5)[1], 0.034, 0.008, Math.atan2(W[1] - f0[1], W[0] - f0[0]), 0.85]],
    });
    const cuff = lerp(f0, W, 0.72);
    seam(ctx, forearm, [[cuff[0] - 0.08, cuff[1] + sg * 0.02], [cuff[0] + 0.08, cuff[1] - sg * 0.02]]);
    if (up === 0) cast(ctx, forearm, pad, 0.01, 0.05, 0.016, 0.45);
    ink(ctx, forearm, edge);

    // the fist: the back of the hand, and four fingers curled under. No thumb.
    const [hx, hy] = H;
    const fist: Shape = () => rr(ctx, hx - 0.068, hy - 0.056, 0.136, 0.124, [0.03, 0.03, 0.042, 0.042]);
    glossy(ctx, fist, suit, edge, [hx - 0.068, hy - 0.056, hx + 0.068, hy + 0.068], { depth: 0.012, spots: [[hx - 0.022, hy - 0.034, 0.028, 0.008, -0.12, 0.85]] });
    if (!back) {
      seam(ctx, fist, [[hx - 0.075, hy - 0.004], [hx, hy + 0.004], [hx + 0.075, hy - 0.004]]);
      ctx.save();
      fist();
      ctx.clip();
      ctx.strokeStyle = edge;
      ctx.lineWidth = 0.005;
      ctx.beginPath();
      for (const fx of [-0.034, 0, 0.034]) {
        ctx.moveTo(hx + fx, hy + 0.012);
        ctx.lineTo(hx + fx, hy + 0.08);
      }
      ctx.stroke();
      // the fingers curl under, away from the light
      const curl = ctx.createLinearGradient(0, hy + 0.01, 0, hy + 0.068);
      curl.addColorStop(0, `rgba(${SUIT_DIM},0)`);
      curl.addColorStop(1, `rgba(${SUIT_DIM},0.36)`);
      ctx.fillStyle = curl;
      ctx.fillRect(hx - 0.08, hy + 0.01, 0.16, 0.07);
      ctx.restore();
    }
    cast(ctx, fist, forearm, 0.004, 0.022, 0.01, 0.55);
    ink(ctx, fist, edge);
    ctx.restore();
  }

  // the shoulder sockets: a black joint each side, behind the chest and the pad, filling the space between them
  for (const sg of [-1, 1]) {
    const socket = socketShape(sg);
    glossy(ctx, socket, black, DARK, [sg * 0.196 - 0.04, -0.596, sg * 0.196 + 0.04, -0.516], JOINT);
    cast(ctx, socket, padShape(sg), 0.006, 0.02, 0.01, 0.75);
  }

  // ---- chest: a plate with a crease across its widest line; below the crease it turns away from the light
  const CREASE = -0.53;
  glossy(ctx, chestShape, suit, edge, boxOf(...chest), { shade: 0.34, depth: 0.016 });
  ctx.save();
  chestShape();
  ctx.clip();
  const facet = ctx.createLinearGradient(0, CREASE, 0, -0.424);
  facet.addColorStop(0, `rgba(${SUIT_DIM},0.14)`);
  facet.addColorStop(1, `rgba(${SUIT_DIM},0.46)`);
  ctx.fillStyle = facet;
  ctx.fillRect(-0.3, CREASE, 0.6, 0.12);
  const crease = ctx.createLinearGradient(-0.19, 0, 0.19, 0);
  crease.addColorStop(0, 'rgba(255,255,255,0.95)');
  crease.addColorStop(0.6, 'rgba(255,255,255,0.45)');
  crease.addColorStop(1, 'rgba(255,255,255,0.15)');
  ctx.strokeStyle = crease;
  ctx.lineWidth = 0.005;
  ctx.beginPath();
  ctx.moveTo(-0.19, CREASE);
  ctx.lineTo(0.19, CREASE);
  ctx.stroke();
  ctx.restore();
  // no line down the middle of the chest, front or back: the owner turned one down
  cast(ctx, chestShape, rimShape, 0.008, 0.045, 0.02, 0.6);
  for (const sg of [-1, 1]) cast(ctx, chestShape, padShape(sg), 0.01, 0.02, 0.012, 0.45);
  ink(ctx, chestShape, edge);

  // the collar, between chest and helmet
  glossy(ctx, collarShape, black, DARK, [-0.095, -0.625, 0.095, -0.573], JOINT);
  cast(ctx, collarShape, rimShape, 0, 0.02, 0.008, 0.7);

  // ---- shoulders: a rounded pad each side, with a black panel set into the top
  for (const sg of [-1, 1]) {
    const cx = sg * PAD_X;
    const pad = padShape(sg);
    glossy(ctx, pad, suit, edge, [cx - PAD_RX, PAD_Y - PAD_RY, cx + PAD_RX, PAD_Y + PAD_RY], { depth: 0.016, spots: [[cx - 0.02, PAD_Y - 0.011, 0.023, 0.0095, -0.5, 0.9]] });
    cast(ctx, pad, rimShape, 0.01, 0.04, 0.016, 0.5);
    padPanel(ctx, pad, cx + sg * 0.022, PAD_Y, PAD_RY, edge);
  }

  helmet(k, back ? 'back' : 'front', 1, 0, HY);
  ctx.restore();
}

/**
 * The robot from the side. `d` is 1 facing right, -1 facing left; every x in
 * here is written for facing right and turned over by `d`, so the light still
 * falls from the top left either way.
 */
function sideView(k: Kit, d: number, a: Stance): void {
  const { ctx, suit, black, edge } = k;
  const stride = a.sw * 0.085;
  const swing = a.sw * 0.5;
  const ARM_REST = -0.09; // radians: the near arm's hang at rest, a little forward
  const P = (x: number, y: number): Pt => [x * d, y];

  /** One leg. `x0` is where its knee and ankle are, ahead of the middle of the body. */
  const leg = (x0: number, lift: number, far: boolean): void => {
    const kneeBack = flip([[x0 - 0.045, -0.285], [x0 + 0.05, -0.285], [x0 + 0.05, -0.225], [x0 - 0.045, -0.225]], d);
    const kneeShape: Shape = () => poly(ctx, kneeBack, 0.012);
    glossy(ctx, kneeShape, black, DARK, boxOf(...kneeBack), JOINT);
    const hip = x0 * 0.3;
    const thigh = flip([[hip - 0.062, -0.4], [hip + 0.064, -0.4], [x0 + 0.06, -0.258], [x0 - 0.056, -0.258]], d);
    const tb = boxOf(...thigh);
    const thighShape: Shape = () => poly(ctx, thigh, 0.026);
    glossy(ctx, thighShape, suit, edge, [tb[0], -0.37, tb[2], tb[3]], { spots: [[tb[0] + 0.035, -0.31, 0.034, 0.008, Math.PI / 2, 0.85]] });
    if (far) farSide(ctx, thighShape);
    ink(ctx, thighShape, edge);
    ctx.save();
    ctx.translate(0, -lift);
    // the shin, with the knee plate standing out at the front
    const shin = flip([[x0 - 0.056, -0.268], [x0 + 0.04, -0.29], [x0 + 0.066, -0.262], [x0 + 0.062, -0.12], [x0 - 0.06, -0.12]], d);
    const sb = boxOf(...shin);
    const shinShape: Shape = () => poly(ctx, shin, 0.02);
    glossy(ctx, shinShape, suit, edge, sb, { spots: [[sb[0] + 0.035, -0.19, 0.04, 0.008, Math.PI / 2, 0.85]] });
    seam(ctx, shinShape, [P(x0 - 0.07, -0.226), P(x0 + 0.02, -0.232), P(x0 + 0.08, -0.246)]);
    if (far) farSide(ctx, shinShape);
    ink(ctx, shinShape, edge);
    // the boot: its toe is out in front
    const back = x0 - 0.1;
    const bootShape: Shape = () => rrd(ctx, back, -0.142, 0.255, 0.125, [0.06, 0.1, 0.03, 0.03], d);
    const bl = d > 0 ? back : -back - 0.255;
    glossy(ctx, bootShape, black, DARK, [bl, -0.142, bl + 0.255, -0.02], {
      tint: COOL,
      light: 0.3,
      shade: 0.4,
      rim: 0.65,
      depth: 0.018,
      sky: 0.9,
      spots: [[bl + 0.08, -0.116, 0.05, 0.01, -0.16, 0.7]],
    });
    cast(ctx, bootShape, shinShape, 0.008, 0.03, 0.012, 0.7);
    if (far) farSide(ctx, bootShape);
    ink(ctx, bootShape, DARK);
    sole(k, back, 0.255, d);
    ctx.restore();
  };

  /** One arm, hanging from the shoulder and swung `turn` radians back (forward if negative). */
  const arm = (turn: number, far: boolean): void => {
    ctx.save();
    ctx.translate(-0.005 * d, -0.57);
    ctx.rotate(d * turn);
    ctx.translate(0.005 * d, 0.57);
    const j0 = P(-0.004, -0.56);
    const j1 = P(-0.002, -0.495);
    const ribbed: Shape = () => limb(ctx, j0, j1, 0.04, 0.04, 0.012);
    glossy(ctx, ribbed, black, DARK, [j0[0] - 0.04, j0[1], j0[0] + 0.04, j1[1]], JOINT);
    for (const t of [0.45, 0.7]) {
      const y = j0[1] + (j1[1] - j0[1]) * t;
      seam(ctx, ribbed, [[j0[0] - 0.06, y], [j0[0] + 0.06, y]], COOL);
    }
    const W = P(0.002, -0.402);
    const H = P(0.006, -0.335);
    glossy(ctx, () => limb(ctx, lerp(W, H, -0.2), lerp(W, H, 0.4), 0.036, 0.036, 0.01), black, DARK, [W[0] - 0.036, W[1], W[0] + 0.036, H[1]], JOINT);
    const f0 = P(-0.003, -0.512);
    const forearm: Shape = () => limb(ctx, f0, W, 0.05, 0.058, 0.022);
    glossy(ctx, forearm, suit, edge, [f0[0] - 0.058, f0[1], f0[0] + 0.058, W[1]], { spots: [[f0[0] - 0.024, -0.457, 0.034, 0.008, Math.PI / 2, 0.85]] });
    seam(ctx, forearm, [[f0[0] - 0.08, -0.433], [f0[0] + 0.08, -0.433]]);
    if (far) farSide(ctx, forearm);
    ink(ctx, forearm, edge);
    const [hx, hy] = H;
    const fist: Shape = () => rr(ctx, hx - 0.056, hy - 0.056, 0.112, 0.124, [0.03, 0.03, 0.042, 0.042]);
    glossy(ctx, fist, suit, edge, [hx - 0.056, hy - 0.056, hx + 0.056, hy + 0.068], { depth: 0.012, spots: [[hx - 0.018, hy - 0.034, 0.024, 0.008, -0.12, 0.85]] });
    seam(ctx, fist, [[hx - 0.07, hy], [hx + 0.07, hy]]);
    cast(ctx, fist, forearm, 0.004, 0.022, 0.01, 0.55);
    if (far) farSide(ctx, fist);
    ink(ctx, fist, edge);
    ctx.restore();
  };

  // the far arm and the far leg, behind the body; then the near leg
  ctx.save();
  ctx.translate(0, a.bob);
  arm(-swing, true);
  ctx.restore();
  leg(-0.065 - stride, Math.max(0, -a.sw) * 0.045, true);
  leg(0.065 + stride, Math.max(0, a.sw) * 0.045, false);

  ctx.save();
  ctx.translate(0, a.bob);
  // ---- waist and pelvis, seen edge on
  const waist = flip([[-0.105, -0.44], [0.112, -0.44], [0.122, -0.385], [-0.114, -0.385]], d);
  const waistShape: Shape = () => poly(ctx, waist, 0.012);
  const pelvis = flip([[-0.125, -0.4], [0.13, -0.4], [0.144, -0.362], [0.085, -0.3], [-0.08, -0.3], [-0.138, -0.362]], d);
  const pelvisShape: Shape = () => poly(ctx, pelvis, 0.016);
  const chest = flip([[-0.118, -0.602], [0.13, -0.602], [0.155, -0.53], [0.112, -0.424], [-0.098, -0.424], [-0.138, -0.53]], d);
  const chestShape: Shape = () => poly(ctx, chest, 0.02);
  const hx = 0.015 * d;
  const rimShape: Shape = () => dot(ctx, hx, HY, R);
  glossy(ctx, waistShape, black, DARK, boxOf(...waist), JOINT);
  seam(ctx, waistShape, [[-0.15, -0.421], [0.15, -0.421]], COOL);
  seam(ctx, waistShape, [[-0.15, -0.404], [0.15, -0.404]], COOL);
  cast(ctx, waistShape, chestShape, 0.006, 0.02, 0.01, 0.7);
  ink(ctx, waistShape, DARK);
  glossy(ctx, pelvisShape, black, DARK, boxOf(...pelvis), { tint: COOL, light: 0.28, shade: 0.4, rim: 0.6, depth: 0.014, sky: 0.9 });
  pelvisLines(ctx, pelvisShape, P(-0.22, -0.385), P(-0.08, -0.298), P(0.085, -0.298), P(0.22, -0.39));
  cast(ctx, pelvisShape, waistShape, 0.005, 0.016, 0.008, 0.6);
  ink(ctx, pelvisShape, DARK);

  // ---- chest, with its crease
  const CREASE = -0.53;
  glossy(ctx, chestShape, suit, edge, boxOf(...chest), { shade: 0.34, depth: 0.016 });
  ctx.save();
  chestShape();
  ctx.clip();
  const facet = ctx.createLinearGradient(0, CREASE, 0, -0.424);
  facet.addColorStop(0, `rgba(${SUIT_DIM},0.14)`);
  facet.addColorStop(1, `rgba(${SUIT_DIM},0.46)`);
  ctx.fillStyle = facet;
  ctx.fillRect(-0.3, CREASE, 0.6, 0.12);
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 0.005;
  ctx.beginPath();
  ctx.moveTo(-0.19, CREASE);
  ctx.lineTo(0.19, CREASE);
  ctx.stroke();
  ctx.restore();
  cast(ctx, chestShape, rimShape, 0.008, 0.045, 0.02, 0.6);
  ink(ctx, chestShape, edge);
  const collarShape: Shape = () => rr(ctx, 0.008 * d - 0.068, -0.625, 0.136, 0.052, 0.014);
  glossy(ctx, collarShape, black, DARK, [0.008 * d - 0.068, -0.625, 0.008 * d + 0.068, -0.573], JOINT);

  helmet(k, 'side', d, hx, HY);

  // ---- the near arm and its shoulder pad, over the body. The shoulder is nearer the viewer than the
  // bottom of the helmet, so the pad sits in front of the helmet's lower edge. At rest the arm hangs a
  // little forward of straight down.
  arm(swing + ARM_REST, false);
  const px = -0.005 * d;
  const pad: Shape = () => oval(ctx, px, -0.582, 0.072, 0.057);
  glossy(ctx, pad, suit, edge, [px - 0.072, -0.639, px + 0.072, -0.525], { depth: 0.016, spots: [[px - 0.02, -0.593, 0.023, 0.0095, -0.5, 0.9]] });
  padPanel(ctx, pad, px, -0.582, 0.057, edge);
  ctx.restore();
}

// ---------------------------------------------------------------- the turned view (artwork only)
//
// The robot turned part of the way round and seen from a little above: what a character sheet calls a
// three-quarter or isometric view. The game never draws it (a robot there faces one of four ways); it is
// for artwork, through drawRobotTurned and tools/portraits.py, and is left out of the game's build.
//
// Every piece is the same piece as in the front and side views, given its real depth: the front view says
// how wide it is and the side view how deep, its outline is where those corners fall once the robot is
// turned, and it gets the same finish. The details that lie on a piece's front or side (seams, the lines
// across the pelvis, the lit soles) are the other views' own, laid on that face.

const TURN = 0.8; // how far it is turned from facing the viewer, in radians (46°: close to the usual isometric 45°): its face toward the picture's right
const TILT = 0.24; // how far above it the viewer is, in radians (14°)

/** A point in the round: x to the picture's right when the robot faces the viewer, y down from the feet, z forward. */
type Vec = [number, number, number];

/** The outline of a set of points: the smallest shape with no dents that holds them all, in order round its edge. */
function hullOf(pts: Pt[]): Pt[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const turn = (o: Pt, a: Pt, b: Pt): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: Pt[]): Pt[] => {
    const out: Pt[] = [];
    for (const q of list) {
      while (out.length >= 2 && turn(out[out.length - 2], out[out.length - 1], q) <= 0) out.pop();
      out.push(q);
    }
    out.pop();
    return out;
  };
  const all = half(p).concat(half([...p].reverse()));
  // corners that all but touch would make a kink where the outline is rounded
  return all.filter((q, i) => Math.hypot(q[0] - all[(i + 1) % all.length][0], q[1] - all[(i + 1) % all.length][1]) > 0.006);
}

/** A closed shape through `pts` with soft corners: each starts turning `r` before its point (less on a short edge). */
function softPoly(ctx: Ctx, pts: Pt[], r: number): void {
  const n = pts.length;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const a = pts[(i + n - 1) % n];
    const b = pts[(i + 1) % n];
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]) || 1;
    const lb = Math.hypot(b[0] - p[0], b[1] - p[1]) || 1;
    const t = Math.min(r, la * 0.5, lb * 0.5);
    const from: Pt = [p[0] + ((a[0] - p[0]) / la) * t, p[1] + ((a[1] - p[1]) / la) * t];
    const to: Pt = [p[0] + ((b[0] - p[0]) / lb) * t, p[1] + ((b[1] - p[1]) / lb) * t];
    if (i) ctx.lineTo(from[0], from[1]);
    else ctx.moveTo(from[0], from[1]);
    ctx.quadraticCurveTo(p[0], p[1], to[0], to[1]);
  }
  ctx.closePath();
}

/** The four corners of a piece of a limb from `a` to `b`: half as wide as `wa` at one end and `wb` at the other. */
function limbCorners(a: Pt, b: Pt, wa: number, wb: number): Pt[] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const nx = -(b[1] - a[1]) / len;
  const ny = (b[0] - a[0]) / len;
  return [[a[0] + nx * wa, a[1] + ny * wa], [b[0] + nx * wb, b[1] + ny * wb], [b[0] - nx * wb, b[1] - ny * wb], [a[0] - nx * wa, a[1] - ny * wa]];
}

/**
 * The light bar on a helmet turned by `yaw` and seen from `pitch` above, as a row of points from where it
 * comes into sight at the back to where it goes out of sight round the front, in the units of SIDE_TRIM.
 * SIDE_TRIM says where the bar is on one side of the ball; the other side is its mirror image, and the two
 * meet at the back and at the front, so together they make a ring round the helmet. This is the part of
 * that ring on the half of the ball facing the viewer.
 */
function turnedTrim(yaw: number, pitch: number): Pt[] {
  const n = SIDE_TRIM.length;
  const at = (t: number): [number, number] => {
    const i = Math.min(n - 1, Math.floor(t * n));
    return sideTrimAt(i, t * n - i);
  };
  const glass = (t: number): number => {
    const [x, y] = at(t);
    return GLASS * GLASS - x * x - y * y; // above 0 on the glass
  };
  // where the side view's bar comes onto the glass at the back, and where it leaves it at the front
  const edge = (a: number, b: number): number => {
    for (let i = 0; i < 40; i++) {
      const m = (a + b) / 2;
      if (glass(m) > 0 === glass(b) > 0) b = m;
      else a = m;
    }
    return (a + b) / 2;
  };
  let first = 0;
  while (first < 1 && glass(first) <= 0) first += 0.002;
  let last = 1;
  while (last > first && glass(last) <= 0) last -= 0.002;
  const back = edge(first - 0.002, first);
  const front = edge(last + 0.002, last);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const steps = 260;
  const ring: { p: Pt; near: boolean }[] = [];
  const add = (i: number, side: number): void => {
    const t = back + (front - back) * (0.5 - 0.5 * Math.cos((Math.PI * i) / steps)); // closer together at both ends, where the ring turns fastest as seen
    const [f, y] = at(t);
    const out = Math.sqrt(Math.max(0, glass(t))) * side;
    const toward = f * cy - out * sy;
    ring.push({ p: [out * cy + f * sy, y * cp + toward * sp], near: toward * cp - y * sp > 0 });
  };
  for (let i = 0; i <= steps; i++) add(i, -1); // the side turned toward the viewer, back to front
  for (let i = steps - 1; i >= 1; i--) add(i, 1); // the other side, front to back
  // the longest stretch of the ring that is in sight
  let best = 0;
  let bestLen = 0;
  for (let i = 0; i < ring.length; i++) {
    if (!ring[i].near || ring[(i + ring.length - 1) % ring.length].near) continue;
    let len = 0;
    while (len < ring.length && ring[(i + len) % ring.length].near) len++;
    if (len > bestLen) {
      best = i;
      bestLen = len;
    }
  }
  const line: Pt[] = [];
  for (let i = 0; i < bestLen; i++) line.push(ring[(best + i) % ring.length].p);
  // carry each end on a little past the edge of the glass, so the bar is cut off by the edge and not square
  const on = (a: Pt, b: Pt): Pt => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [b[0] + ((b[0] - a[0]) / len) * 0.07, b[1] + ((b[1] - a[1]) / len) * 0.07];
  };
  if (line.length > 6) {
    line.unshift(on(line[4], line[0]));
    line.push(on(line[line.length - 5], line[line.length - 1]));
  }
  return line;
}

/** The robot turned (see above), standing still with its arms at its sides. */
function turned(k: Kit): void {
  const { ctx, suit, black, edge } = k;
  const cy = Math.cos(TURN);
  const sy = Math.sin(TURN);
  const cp = Math.cos(TILT);
  const sp = Math.sin(TILT);
  /** Where a point in the round is seen. */
  const pr = (p: Vec): Pt => [p[0] * cy + p[2] * sy, p[1] * cp + (p[2] * cy - p[0] * sy) * sp];
  /** A solid piece with those corners: its outline as seen, its corners softened by `r`, and the box round it. */
  const solid = (corners: Vec[], r: number): { shape: Shape; box: Box } => {
    const h = hullOf(corners.map(pr));
    return { shape: () => softPoly(ctx, h, r), box: boxOf(...h) };
  };
  /** The corners of a piece whose front is `face`, running from `z0` at its back to `z1` at its front (plus `lean` at each height). */
  const slab = (face: Pt[], z0: number, z1: number, lean: (y: number) => number = () => 0): Vec[] => [
    ...face.map(([x, y]): Vec => [x, y, z0 + lean(y)]),
    ...face.map(([x, y]): Vec => [x, y, z1 + lean(y)]),
  ];
  /** Draw on the flat front of a piece, `z` forward: (x, y) there are the front view's own. */
  const onFront = (z: number, draw: () => void): void => {
    ctx.save();
    ctx.transform(cy, -sy * sp, 0, cp, z * sy, z * cy * sp);
    draw();
    ctx.restore();
  };
  /** Draw on the flat side of a piece that faces the viewer, at `x`: (x, y) there are the side view's own, facing right. */
  const onSide = (x: number, draw: () => void): void => {
    ctx.save();
    ctx.transform(sy, cy * sp, 0, cp, x * cy, -x * sy * sp);
    draw();
    ctx.restore();
  };
  const within = (shape: Shape, draw: () => void): void => {
    ctx.save();
    shape();
    ctx.clip();
    draw();
    ctx.restore();
  };
  /** A piece on the far side of the body sits back a little. */
  const sitBack = (shape: Shape): void =>
    within(shape, () => {
      ctx.fillStyle = 'rgba(0,0,10,0.2)';
      ctx.fillRect(-3, -3, 6, 6);
    });
  /**
   * The front of a boxy piece is turned away from the light, which falls from the left: a touch of shade over
   * it, and a thin line of light down the corner where it meets the side that faces the light.
   */
  const corner = (shape: Shape, face: Vec[], ridge: Vec[], suitPiece: boolean): void =>
    within(shape, () => {
      ctx.beginPath();
      face.map(pr).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = suitPiece ? `rgba(${SUIT_DIM},0.2)` : 'rgba(0,0,10,0.28)';
      ctx.fill();
      ctx.beginPath();
      ridge.map(pr).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.strokeStyle = suitPiece ? 'rgba(255,255,255,0.5)' : `rgba(${COOL},0.3)`;
      ctx.lineWidth = 0.006;
      ctx.stroke();
    });
  /** A groove that runs round a piece: across the side that faces the viewer, then across its front. */
  const band = (shape: Shape, xl: number, xr: number, y: number, z0: number, z1: number, light?: string): void =>
    seam(ctx, shape, [pr([xl, y, z0]), pr([xl, y, z1]), pr([xr, y, z1])], light);

  const head = pr([0, HY, 0.015]);
  const rimShape: Shape = () => dot(ctx, head[0], head[1], R);

  // ---- the body's pieces, made first: some throw shadows on pieces drawn before them
  const level = (y: number, half: number, zb: number, zf: number): Vec[] => [[-half, y, zb], [-half, y, zf], [half, y, zf], [half, y, zb]];
  const waist = solid([...level(-0.44, 0.132, -0.105, 0.112), ...level(-0.385, 0.146, -0.114, 0.122)], 0.012);
  const pelvis = solid([...level(-0.4, 0.152, -0.125, 0.13), ...level(-0.362, 0.172, -0.138, 0.144), ...level(-0.298, 0.066, -0.08, 0.085)], 0.016);
  const chest = solid([...level(-0.602, 0.168, -0.118, 0.13), ...level(-0.53, 0.186, -0.138, 0.155), ...level(-0.424, 0.124, -0.098, 0.112)], 0.022);
  const padAt = (sg: number): { shape: Shape; c: Pt; rx: number; ry: number } => {
    const c = pr([sg * 0.247, -0.582, -0.005]);
    const rx = Math.hypot(0.084 * cy, 0.072 * sy);
    const ry = Math.hypot(0.057 * cp, Math.hypot(0.072 * cy, 0.084 * sy) * sp);
    return { shape: () => oval(ctx, c[0], c[1], rx, ry), c, rx, ry };
  };

  /** One leg. `sg` is -1 for the one nearer the viewer, 1 for the other. */
  const leg = (sg: number): void => {
    const far = sg > 0;
    const knee = solid(slab(flip([[0.075, -0.285], [0.172, -0.285], [0.172, -0.225], [0.075, -0.225]], sg), -0.045, 0.05), 0.012);
    glossy(ctx, knee.shape, black, DARK, knee.box, JOINT);

    const thighFace = flip([[0.045, -0.4], [0.168, -0.4], [0.181, -0.258], [0.07, -0.258]], sg);
    const tx = Math.min(...thighFace.map((q) => q[0]));
    const thigh = solid(slab(thighFace, -0.06, 0.062), 0.03);
    glossy(ctx, thigh.shape, suit, edge, thigh.box, { spots: [[thigh.box[0] + 0.035, (thigh.box[1] + thigh.box[3]) / 2, 0.034, 0.008, Math.PI / 2, 0.85]] });
    corner(thigh.shape, thighFace.map(([x, y]): Vec => [x, y, 0.062]), [[sg < 0 ? -0.168 : 0.045, -0.4, 0.062], [sg < 0 ? -0.181 : 0.07, -0.258, 0.062]], true);
    cast(ctx, thigh.shape, pelvis.shape, 0.008, 0.026, 0.012, 0.6);
    if (far) sitBack(thigh.shape);
    ink(ctx, thigh.shape, edge);
    void tx;

    // the shin, with its knee plate coming to a point at the top
    const shinFace = flip([[0.06, -0.268], [0.118, -0.292], [0.176, -0.268], [0.186, -0.12], [0.06, -0.12]], sg);
    const sx0 = Math.min(...shinFace.map((q) => q[0]));
    const sx1 = Math.max(...shinFace.map((q) => q[0]));
    const shin = solid(slab(shinFace, -0.058, 0.064), 0.022);
    glossy(ctx, shin.shape, suit, edge, shin.box, { spots: [[shin.box[0] + 0.035, (shin.box[1] + shin.box[3]) / 2 + 0.01, 0.04, 0.008, Math.PI / 2, 0.85]] });
    corner(shin.shape, shinFace.map(([x, y]): Vec => [x, y, 0.064]), [[sx0, -0.268, 0.064], [sx0, -0.12, 0.064]], true);
    within(shin.shape, () => {
      onFront(0.064, () => seam(ctx, () => poly(ctx, shinFace, 0.02), [[sx0, -0.238], [sg * 0.118, -0.222], [sx1, -0.238]]));
      onSide(sx0, () => seam(ctx, () => rr(ctx, -0.058, -0.3, 0.122, 0.2, 0.02), [[-0.07, -0.226], [0.02, -0.232], [0.07, -0.238]]));
    });
    if (far) sitBack(shin.shape);
    ink(ctx, shin.shape, edge);

    // the boot: a big round mound, with the lit stripe round its sole
    const bx = sg * 0.146;
    const ring = (y: number, half: number, zb: number, zf: number): Vec[] => [[bx - half, y, zb], [bx - half, y, zf], [bx + half, y, zf], [bx + half, y, zb]];
    const boot = solid([...ring(-0.018, 0.125, -0.1, 0.155), ...ring(-0.075, 0.125, -0.1, 0.155), ...ring(-0.118, 0.098, -0.078, 0.122), ...ring(-0.142, 0.05, -0.04, 0.062)], 0.035);
    glossy(ctx, boot.shape, black, DARK, boot.box, {
      tint: COOL,
      light: 0.3,
      shade: 0.4,
      rim: 0.65,
      depth: 0.018,
      sky: 0.9,
      spots: [[boot.box[0] + 0.1, boot.box[1] + 0.03, 0.05, 0.01, 0.18, 0.7]],
    });
    corner(boot.shape, ring(-0.018, 0.125, 0.155, 0.155).concat(ring(-0.142, 0.125, 0.155, 0.155).reverse()), [[bx - 0.125, -0.02, 0.155], [bx - 0.125, -0.075, 0.155], [bx - 0.098, -0.118, 0.122]], false);
    cast(ctx, boot.shape, shin.shape, 0.008, 0.03, 0.012, 0.7);
    if (far) sitBack(boot.shape);
    ink(ctx, boot.shape, DARK);
    onSide(bx - 0.125, () => sole(k, -0.1, 0.255, 1));
    onFront(0.155, () => sole(k, bx - 0.125, 0.25, 1));
  };

  /** One arm, hanging a little forward of straight down. */
  const arm = (sg: number): void => {
    const far = sg > 0;
    const lean = (y: number): number => (y + 0.57) * 0.09;
    // the ribbed joint under the shoulder
    const j0: Pt = [sg * 0.268, -0.56];
    const j1: Pt = [sg * 0.282, -0.495];
    const ribbed = solid(slab(limbCorners(j0, j1, 0.044, 0.044), -0.04, 0.04, lean), 0.012);
    glossy(ctx, ribbed.shape, black, DARK, ribbed.box, JOINT);
    for (const t of [0.45, 0.7]) {
      const m = lerp(j0, j1, t);
      band(ribbed.shape, m[0] - 0.05, m[0] + 0.05, m[1], lean(m[1]) - 0.04, lean(m[1]) + 0.04, COOL);
    }
    ink(ctx, ribbed.shape, DARK);
    // the wrist
    const W: Pt = [sg * 0.314, -0.402];
    const H: Pt = [sg * 0.32, -0.335];
    const wrist = solid(slab(limbCorners(lerp(W, H, -0.2), lerp(W, H, 0.4), 0.04, 0.04), -0.036, 0.036, lean), 0.01);
    glossy(ctx, wrist.shape, black, DARK, wrist.box, JOINT);
    // the forearm
    const f0: Pt = [sg * 0.286, -0.512];
    const armFace = limbCorners(f0, W, 0.056, 0.066);
    const forearm = solid(slab(armFace, -0.054, 0.054, lean), 0.026);
    glossy(ctx, forearm.shape, suit, edge, forearm.box, { spots: [[forearm.box[0] + 0.036, (forearm.box[1] + forearm.box[3]) / 2, 0.034, 0.008, Math.PI / 2, 0.85]] });
    const ax0 = (y: number): number => Math.min(...armFace.map((q) => q[0])) + (sg < 0 ? 0 : 0) + (y - y) * 0;
    corner(forearm.shape, armFace.map(([x, y]): Vec => [x, y, lean(y) + 0.054]), [[f0[0] - 0.056, f0[1], lean(f0[1]) + 0.054], [W[0] - 0.066, W[1], lean(W[1]) + 0.054]], true);
    void ax0;
    const cuff = lerp(f0, W, 0.72);
    band(forearm.shape, cuff[0] - 0.066, cuff[0] + 0.066, cuff[1], lean(cuff[1]) - 0.054, lean(cuff[1]) + 0.054);
    if (far) sitBack(forearm.shape);
    ink(ctx, forearm.shape, edge);
    // the fist: the back of the hand, and four fingers curled under. No thumb.
    const [hx, hy] = H;
    const hz = lean(hy);
    const fistFace: Pt[] = [[hx - 0.068, hy - 0.056], [hx + 0.068, hy - 0.056], [hx + 0.068, hy + 0.068], [hx - 0.068, hy + 0.068]];
    const fist = solid(slab(fistFace, hz - 0.056, hz + 0.056), 0.034);
    glossy(ctx, fist.shape, suit, edge, fist.box, { depth: 0.012, spots: [[fist.box[0] + 0.04, fist.box[1] + 0.028, 0.028, 0.008, 0.2, 0.85]] });
    corner(fist.shape, fistFace.map(([x, y]): Vec => [x, y, hz + 0.056]), [[hx - 0.068, hy - 0.05, hz + 0.056], [hx - 0.068, hy + 0.06, hz + 0.056]], true);
    within(fist.shape, () => {
      onFront(hz + 0.056, () => {
        const front: Shape = () => rr(ctx, hx - 0.068, hy - 0.056, 0.136, 0.124, [0.03, 0.03, 0.042, 0.042]);
        seam(ctx, front, [[hx - 0.075, hy - 0.004], [hx, hy + 0.004], [hx + 0.075, hy - 0.004]]);
        ctx.save();
        front();
        ctx.clip();
        ctx.strokeStyle = edge;
        ctx.lineWidth = 0.005;
        ctx.beginPath();
        for (const fx of [-0.034, 0, 0.034]) {
          ctx.moveTo(hx + fx, hy + 0.012);
          ctx.lineTo(hx + fx, hy + 0.08);
        }
        ctx.stroke();
        const curl = ctx.createLinearGradient(0, hy + 0.01, 0, hy + 0.068);
        curl.addColorStop(0, `rgba(${SUIT_DIM},0)`);
        curl.addColorStop(1, `rgba(${SUIT_DIM},0.36)`);
        ctx.fillStyle = curl;
        ctx.fillRect(hx - 0.08, hy + 0.01, 0.16, 0.07);
        ctx.restore();
      });
      onSide(hx - 0.068, () => seam(ctx, () => rr(ctx, hz - 0.056, hy - 0.056, 0.112, 0.124, [0.03, 0.03, 0.042, 0.042]), [[hz - 0.07, hy], [hz + 0.07, hy]]));
    });
    cast(ctx, fist.shape, forearm.shape, 0.004, 0.022, 0.01, 0.55);
    if (far) sitBack(fist.shape);
    ink(ctx, fist.shape, edge);
  };

  /** A shoulder: a rounded pad with a black panel set into the top. */
  const shoulder = (sg: number): void => {
    const pad = padAt(sg);
    glossy(ctx, pad.shape, suit, edge, [pad.c[0] - pad.rx, pad.c[1] - pad.ry, pad.c[0] + pad.rx, pad.c[1] + pad.ry], { depth: 0.016, spots: [[pad.c[0] - 0.024, pad.c[1] - 0.006, 0.023, 0.0095, -0.5, 0.9]] });
    if (sg > 0) cast(ctx, pad.shape, rimShape, 0.01, 0.04, 0.016, 0.5);
    padPanel(ctx, pad.shape, pad.c[0] + 0.006, pad.c[1] + 0.024 * sp * 3, pad.ry, edge);
  };
  /** The black joint between a shoulder pad and the chest. */
  const socket = (sg: number): void => {
    const c = pr([sg * 0.196, -0.556, 0]);
    const shape: Shape = () => dot(ctx, c[0], c[1], 0.04);
    glossy(ctx, shape, black, DARK, [c[0] - 0.04, c[1] - 0.04, c[0] + 0.04, c[1] + 0.04], JOINT);
    cast(ctx, shape, padAt(sg).shape, 0.006, 0.02, 0.01, 0.75);
  };

  // ---- from the far side of the body to the near side
  arm(1);
  leg(1);
  leg(-1);

  glossy(ctx, waist.shape, black, DARK, waist.box, { ...JOINT, spots: [[waist.box[0] + 0.07, waist.box[1] + 0.03, 0.05, 0.006, 0.2, 0.45]] });
  band(waist.shape, -0.16, 0.16, -0.421, -0.11, 0.117, COOL);
  band(waist.shape, -0.16, 0.16, -0.404, -0.112, 0.12, COOL);
  cast(ctx, waist.shape, chest.shape, 0.006, 0.02, 0.01, 0.7);
  ink(ctx, waist.shape, DARK);

  glossy(ctx, pelvis.shape, black, DARK, pelvis.box, { tint: COOL, light: 0.28, shade: 0.4, rim: 0.6, depth: 0.014, sky: 0.9, spots: [[pelvis.box[0] + 0.06, pelvis.box[1] + 0.03, 0.04, 0.005, 0.25, 0.55]] });
  // the three machined lines: across the front as in the front view, and carried round the side to meet them
  within(pelvis.shape, () => {
    onFront(0.137, () => pelvisLines(ctx, () => rr(ctx, -0.172, -0.42, 0.4, 0.2, 0), [-0.172, -0.362], [-0.066, -0.298], [0.066, -0.298], [0.225, -0.394]));
    onSide(-0.172, () => pelvisLines(ctx, () => rr(ctx, -0.2, -0.42, 0.337, 0.2, 0), [-0.22, -0.385], [-0.08, -0.31], [0.06, -0.31], [0.137, -0.362]));
  });
  cast(ctx, pelvis.shape, waist.shape, 0.005, 0.016, 0.008, 0.6);
  ink(ctx, pelvis.shape, DARK);

  socket(1);

  // ---- chest: a plate with a crease round its widest line; below the crease it turns away from the light
  glossy(ctx, chest.shape, suit, edge, chest.box, { shade: 0.34, depth: 0.016 });
  // no corner or edge down the chest: it would read as a line down the middle of the torso, which the owner turned down
  within(chest.shape, () => {
    const under: Pt[] = [pr([-0.186, -0.53, -0.138]), pr([-0.186, -0.53, 0.155]), pr([0.186, -0.53, 0.155]), pr([0.124, -0.424, 0.112]), pr([-0.124, -0.424, 0.112]), pr([-0.124, -0.424, -0.098])];
    const facet = ctx.createLinearGradient(0, under[1][1], 0, under[4][1]);
    facet.addColorStop(0, `rgba(${SUIT_DIM},0.14)`);
    facet.addColorStop(1, `rgba(${SUIT_DIM},0.46)`);
    ctx.fillStyle = facet;
    ctx.beginPath();
    under.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
    const crease = ctx.createLinearGradient(under[0][0], 0, under[2][0], 0);
    crease.addColorStop(0, 'rgba(255,255,255,0.95)');
    crease.addColorStop(0.6, 'rgba(255,255,255,0.45)');
    crease.addColorStop(1, 'rgba(255,255,255,0.15)');
    ctx.strokeStyle = crease;
    ctx.lineWidth = 0.005;
    ctx.beginPath();
    under.slice(0, 3).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  });
  cast(ctx, chest.shape, rimShape, 0.008, 0.045, 0.02, 0.6);
  cast(ctx, chest.shape, padAt(1).shape, 0.01, 0.02, 0.012, 0.45);
  ink(ctx, chest.shape, edge);

  // the collar, between chest and helmet
  const collar = solid([...level(-0.625, 0.095, -0.06, 0.076), ...level(-0.573, 0.095, -0.06, 0.076)], 0.014);
  glossy(ctx, collar.shape, black, DARK, collar.box, JOINT);
  cast(ctx, collar.shape, rimShape, 0, 0.02, 0.008, 0.7);

  shoulder(1);
  helmet(k, 'turned', 1, head[0], head[1], turnedTrim(TURN, TILT));
  socket(-1);
  arm(-1);
  shoulder(-1);
}

/**
 * Draw the robot turned and seen from a little above (see "the turned view"), standing on (x, y), for
 * artwork. `s` is the size of one tile, as for drawRobot.
 */
export function drawRobotTurned(ctx: Ctx, x: number, y: number, s: number, c: BotColor): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s * K, s * K);
  turned(kitFor(ctx, c, false, false));
  ctx.restore();
}

// ---------------------------------------------------------------- sprites

/** A walk is cut into this many pictures. */
const WALK_FRAMES = 8;
/** A raised arm is drawn at this many heights between hanging and right up. */
const ARM_STEPS = 8;
// how big a sprite is, in tiles, and where on it the robot's feet are
const SPRITE_W = 1.3 * K;
const SPRITE_H = 1.5 * K;
const SPRITE_X = 0.65 * K;
const SPRITE_Y = 1.361 * K;
/** More sprites than this and they are all thrown away and made again as needed (a change of screen size leaves the old ones unused). */
const SPRITE_LIMIT = 700;

function spriteKey(c: BotColor, facing: Dir, frame: number, armL: number, armR: number, pale: boolean, xEyes: boolean, px: number, fine = true): string {
  return `${c.id}|${c.body}|${facing}|${frame}|${armL}|${armR}|${pale ? 1 : 0}${xEyes ? 1 : 0}${fine ? '' : 'p'}|${px}`;
}

interface Sprite {
  canvas: HTMLCanvasElement;
  /** the robot's feet, in the sprite's pixels */
  ox: number;
  oy: number;
}
const sprites = new Map<string, Sprite>();

/**
 * The picture of one robot in one stance, `px` pixels to the tile: made the
 * first time it is asked for and kept.
 */
function sprite(c: BotColor, facing: Dir, frame: number, armL: number, armR: number, pale: boolean, xEyes: boolean, px: number, fine = true): Sprite {
  const key = spriteKey(c, facing, frame, armL, armR, pale, xEyes, px, fine);
  let sp = sprites.get(key);
  if (sp) return sp;
  if (sprites.size >= SPRITE_LIMIT) sprites.clear();
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(SPRITE_W * px);
  canvas.height = Math.ceil(SPRITE_H * px);
  sp = { canvas, ox: Math.round(SPRITE_X * px), oy: Math.round(SPRITE_Y * px) };
  const g = canvas.getContext('2d')!;
  g.translate(sp.ox, sp.oy);
  g.scale(px * K, px * K);
  const phase = frame < 0 ? 0 : (frame / WALK_FRAMES) * Math.PI * 2;
  const stance: Stance = {
    sw: frame < 0 ? 0 : Math.sin(phase),
    bob: frame < 0 ? 0 : -Math.abs(Math.cos(phase)) * 0.018,
    arms: [armL / ARM_STEPS, armR / ARM_STEPS],
  };
  const k = kitFor(g, c, pale, xEyes, fine);
  if (facing === 3) sideView(k, -1, stance);
  else if (facing === 4) sideView(k, 1, stance);
  else frontBack(k, facing === 1, stance);
  sprites.set(key, sp);
  return sp;
}

/**
 * A robot whose sprites are wanted soon, and for what: walking about, burnt (knocked out), as a ghost,
 * dancing as the winner, or on the title screen (`stand`: facing the viewer; `wave`: the same, then raising
 * the arm on the right of the picture in every other step, as the title screen's wave uses). The two
 * title kinds are made without the soft rounding (`Pose.fine` false), as the title screen draws them.
 */
export interface Wanted {
  c: BotColor;
  kind: 'walk' | 'burnt' | 'ghost' | 'dance' | 'stand' | 'wave';
}
/** The arms of the ghost: a little way out from its sides. */
export const GHOST_ARMS: [number, number] = [0.25, 0.25];
let warmed = '';

/**
 * Make sprites ahead of the moment they are needed, a few at a time. Making
 * one takes a few thousandths of a second, which is a dropped frame if four
 * robots each need a new one at once (the first time each walks a new way).
 * Call this every frame with the robots in the round; it makes what is
 * missing for at most `ms` thousandths of a second and then stops until the
 * next call. `ctx` and `s` are what drawRobot will be given.
 */
export function warmRobots(ctx: Ctx, s: number, wanted: Wanted[], ms: number): void {
  const m = ctx.getTransform();
  const px = Math.max(4, Math.round(s * Math.hypot(m.a, m.b)));
  const sig = `${px}|${wanted.map((w) => w.c.id + w.c.body + w.kind).join('|')}`;
  if (sig === warmed) return;
  const t0 = performance.now();
  const need = (c: BotColor, facing: Dir, frame: number, armL: number, armR: number, pale: boolean, xEyes: boolean, fine = true): boolean => {
    if (sprites.has(spriteKey(c, facing, frame, armL, armR, pale, xEyes, px, fine))) return true;
    sprite(c, facing, frame, armL, armR, pale, xEyes, px, fine);
    return performance.now() - t0 < ms;
  };
  const ways: Dir[] = [2, 1, 4, 3];
  // standing first, so that nothing is missing from the very first picture; then the walks
  for (const w of wanted) {
    if (w.kind === 'walk') for (const f of ways) if (!need(w.c, f, -1, 0, 0, false, false)) return;
  }
  for (const w of wanted) {
    if (w.kind === 'walk') {
      for (const f of ways) for (let i = 0; i < WALK_FRAMES; i++) if (!need(w.c, f, i, 0, 0, false, false)) return;
    } else if (w.kind === 'burnt') {
      for (const f of ways) if (!need(w.c, f, -1, 0, 0, false, true)) return;
    } else if (w.kind === 'stand' || w.kind === 'wave') {
      if (!need(w.c, 2, -1, 0, 0, false, false, false)) return;
      if (w.kind === 'wave') for (let i = 2; i <= ARM_STEPS; i += 2) if (!need(w.c, 2, -1, 0, i, false, false, false)) return;
    } else if (w.kind === 'ghost') {
      const a = Math.round(GHOST_ARMS[0] * ARM_STEPS);
      if (!need(w.c, 2, -1, a, a, true, false)) return;
    } else {
      // the winner's jump (one arm up), then each step of the dance (one arm rising as the other falls)
      if (!need(w.c, 2, -1, 0, ARM_STEPS, false, false)) return;
      for (let i = 0; i <= ARM_STEPS; i++) if (!need(w.c, 2, -1, i, ARM_STEPS - i, false, false)) return;
    }
  }
  warmed = sig;
}

/**
 * Throw away the pictures made at `px` pixels to the tile. The title screen's robots are drawn far larger
 * than the game's, a few megabytes each, so it lets go of them when it closes.
 */
export function forgetSprites(px: number): void {
  for (const key of sprites.keys()) if (key.endsWith(`|${px}`)) sprites.delete(key);
  warmed = '';
}

/**
 * A gold crown sitting crooked on a helmet. The helmet is centred on (hx, hy)
 * and is `HR` from centre to edge; the crown is sized for a helmet about a
 * third of a unit across, so scale the canvas to suit.
 */
function drawCrown(ctx: Ctx, hx: number, hy: number, HR: number): void {
  const w = 0.2; // half the width of the band
  const m = ctx.getTransform();
  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(CROWN_TILT);
  ctx.translate(0.01, -HR * 0.8);
  const gold = ctx.createLinearGradient(-w, -0.2, w, 0.05);
  gold.addColorStop(0, '#fff0a0');
  gold.addColorStop(0.5, '#ffc93c');
  gold.addColorStop(1, '#e08a12');
  ctx.beginPath();
  ctx.moveTo(-w, 0.03);
  ctx.lineTo(-w - 0.035, -0.17);
  ctx.lineTo(-w * 0.5, -0.075);
  ctx.lineTo(0, -0.22);
  ctx.lineTo(w * 0.5, -0.075);
  ctx.lineTo(w + 0.035, -0.17);
  ctx.lineTo(w, 0.03);
  ctx.quadraticCurveTo(0, 0.085, -w, 0.03);
  ctx.closePath();
  ctx.fillStyle = gold;
  ctx.shadowColor = 'rgba(255, 200, 60, 0.7)';
  ctx.shadowBlur = Math.hypot(m.a, m.b) * 0.08;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'rgba(0,0,0,0)';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 0.022;
  ctx.strokeStyle = '#7a4a00';
  ctx.stroke();
  // the band along the bottom, with one red stone
  ctx.strokeStyle = '#b86e08';
  ctx.lineWidth = 0.028;
  ctx.beginPath();
  ctx.moveTo(-w + 0.02, 0.0);
  ctx.quadraticCurveTo(0, 0.05, w - 0.02, 0.0);
  ctx.stroke();
  ctx.fillStyle = '#ff4063';
  ctx.beginPath();
  ctx.arc(0, 0.0, 0.03, 0, Math.PI * 2);
  ctx.fill();
  // a bead on each point
  ctx.fillStyle = '#fff6c8';
  for (const [bx, by] of [[-w - 0.035, -0.17], [0, -0.22], [w + 0.035, -0.17]]) {
    ctx.beginPath();
    ctx.arc(bx, by, 0.028, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
/** How far the crown is tipped over, in radians. */
const CROWN_TILT = 0.36;

/**
 * Draw one robot. (x, y) is the point between its feet and `s` is one tile in
 * the canvas's units. The robot is about 0.71 tiles wide and 1.09 tall.
 *
 * `walk` is the phase of its walk (it steps once every 2π) and only counts
 * while `moving`.
 */
export function drawRobot(ctx: Ctx, x: number, y: number, s: number, c: BotColor, facing: Dir, walk: number, moving: boolean, pose: Pose = {}): void {
  const m = ctx.getTransform();
  const scale = Math.hypot(m.a, m.b);
  const px = Math.max(4, Math.round(s * scale)); // pixels to the tile in the sprite
  const frame = moving ? ((Math.round((walk / (Math.PI * 2)) * WALK_FRAMES) % WALK_FRAMES) + WALK_FRAMES) % WALK_FRAMES : -1;
  const steps = (v: number): number => Math.round(Math.max(0, Math.min(1, v)) * ARM_STEPS);
  const front = facing !== 3 && facing !== 4;
  const armL = pose.arms && front ? steps(pose.arms[0]) : 0;
  const armR = pose.arms && front ? steps(pose.arms[1]) : 0;
  const sp = sprite(c, facing === 0 ? 2 : facing, frame, armL, armR, !!pose.pale, !!pose.xEyes, px, pose.fine !== false);
  const jump = pose.jump ?? 0;
  const still = !pose.lean && !jump && pose.shrink === undefined && m.b === 0 && m.c === 0;
  ctx.save();
  // standing on whole pixels keeps the picture sharp
  if (still) ctx.translate((Math.round(m.a * x + m.e) - m.e) / m.a, (Math.round(m.d * y + m.f) - m.f) / m.d);
  else ctx.translate(x, y);
  if (pose.shrink !== undefined) ctx.scale(pose.shrink, pose.shrink);
  if (!pose.noShadow) {
    const shrink = 1 - Math.min(0.6, jump * 0.9);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.333 * K * s * shrink, 0.065 * K * s * shrink, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (jump) ctx.translate(0, -jump * s);
  if (pose.lean) ctx.rotate(pose.lean);
  const u = s / px; // canvas units to one sprite pixel
  ctx.drawImage(sp.canvas, -sp.ox * u, -sp.oy * u, sp.canvas.width * u, sp.canvas.height * u);
  if (pose.crown) {
    const bob = frame < 0 ? 0 : -Math.abs(Math.cos((frame / WALK_FRAMES) * Math.PI * 2)) * 0.018 * K;
    ctx.scale(s, s);
    drawCrown(ctx, facing === 3 ? -0.015 * K : facing === 4 ? 0.015 * K : 0, ROBOT.headY + bob, ROBOT.headR);
  }
  ctx.restore();
}

/**
 * Just a robot's head, for the scoreboard: the helmet of a robot facing the
 * viewer, centred on (cx, cy), `r` across from centre to rim.
 */
export function drawHead(ctx: Ctx, cx: number, cy: number, r: number, c: BotColor, pose: Pose = {}): void {
  if (!pose.crownOnly) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(r / R, r / R);
    ctx.translate(0, -HY);
    helmet(kitFor(ctx, c, !!pose.pale, !!pose.xEyes), 'front', 1, 0, HY);
    ctx.restore();
  }
  if (pose.crown || pose.crownOnly) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(r / 0.31, r / 0.31);
    drawCrown(ctx, 0, 0, 0.31);
    ctx.restore();
  }
}
