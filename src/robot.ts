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
function kitFor(ctx: Ctx, c: BotColor, pale: boolean, xEyes: boolean): Kit {
  const m = ctx.getTransform();
  FINE = Math.hypot(m.a, m.b) >= FINE_FROM;
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

/** The helmet, centred on (hx, hy). `d` is 1 unless it is the side view of a robot facing left. */
function helmet(k: Kit, view: 'front' | 'back' | 'side', d: number, hx: number, hy: number): void {
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
  // the top edge of the chin piece: the line where glass meets colour
  const trim = (): void => {
    if (view === 'side') {
      ctx.moveTo(hx + SIDE_TRIM[0][0][0] * z * d, hy + SIDE_TRIM[0][0][1] * z);
      for (const q of SIDE_TRIM) ctx.bezierCurveTo(hx + q[1][0] * z * d, hy + q[1][1] * z, hx + q[2][0] * z * d, hy + q[2][1] * z, hx + q[3][0] * z * d, hy + q[3][1] * z);
    } else if (view === 'back') {
      ctx.moveTo(hx - 0.37 * z, hy - 0.11 * z);
      ctx.quadraticCurveTo(hx, hy + 0.31 * z, hx + 0.37 * z, hy - 0.11 * z);
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
        const v = t * SIDE_TRIM.length - i;
        const r = 1 - v;
        const p = SIDE_TRIM[i];
        const w = [r * r * r, 3 * r * r * v, 3 * r * v * v, v * v * v];
        return [hx + (p[0][0] * w[0] + p[1][0] * w[1] + p[2][0] * w[2] + p[3][0] * w[3]) * z * d, hy + (p[0][1] * w[0] + p[1][1] * w[1] + p[2][1] * w[2] + p[3][1] * w[3]) * z];
      }
      const u = 1 - t;
      const y0 = view === 'back' ? -0.11 : -0.04;
      const yc = view === 'back' ? 0.31 : 0.53;
      return [hx + (-0.37 * u * u + 0.37 * t * t) * z, hy + (y0 * u * u + yc * 2 * u * t + y0 * t * t) * z];
    };
    const normal = (t: number): Pt => {
      const a = at(Math.max(0, t - 0.01));
      const b = at(Math.min(1, t + 0.01));
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
    };
    // the chin piece is on the lower side of the trim (from the side, judged where the bar runs under the glass)
    const side = normal(view === 'side' ? 0.85 : 0.5)[1] > 0 ? 1 : -1;
    const steps = view === 'side' ? 160 : 48;
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
    ctx.beginPath();
    trim();
    if (view === 'side') {
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
  // the light bar: the lit edge between glass and chin piece
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
  if (view !== 'back') {
    // the streaks on the glass (two from the front, the nearer one from the side)
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 0.044;
    ctx.beginPath();
    if (d > 0) ctx.arc(hx, hy, DOME0 - 0.082, -1.05, -0.3);
    else ctx.arc(hx, hy, DOME0 - 0.082, Math.PI + 0.3, Math.PI + 1.05);
    ctx.stroke();
    if (view === 'front') {
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
  // from the back: a line down the spine
  if (back) seam(ctx, chestShape, [[0, -0.61], [0, -0.42]]);
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

function spriteKey(c: BotColor, facing: Dir, frame: number, armL: number, armR: number, pale: boolean, xEyes: boolean, px: number): string {
  return `${c.id}|${c.body}|${facing}|${frame}|${armL}|${armR}|${pale ? 1 : 0}${xEyes ? 1 : 0}|${px}`;
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
function sprite(c: BotColor, facing: Dir, frame: number, armL: number, armR: number, pale: boolean, xEyes: boolean, px: number): Sprite {
  const key = spriteKey(c, facing, frame, armL, armR, pale, xEyes, px);
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
  const k = kitFor(g, c, pale, xEyes);
  if (facing === 3) sideView(k, -1, stance);
  else if (facing === 4) sideView(k, 1, stance);
  else frontBack(k, facing === 1, stance);
  sprites.set(key, sp);
  return sp;
}

/** A robot whose sprites are wanted soon, and for what: walking about, burnt (knocked out), as a ghost, or dancing as the winner. */
export interface Wanted {
  c: BotColor;
  kind: 'walk' | 'burnt' | 'ghost' | 'dance';
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
  const need = (c: BotColor, facing: Dir, frame: number, armL: number, armR: number, pale: boolean, xEyes: boolean): boolean => {
    if (sprites.has(spriteKey(c, facing, frame, armL, armR, pale, xEyes, px))) return true;
    sprite(c, facing, frame, armL, armR, pale, xEyes, px);
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
  const sp = sprite(c, facing === 0 ? 2 : facing, frame, armL, armR, !!pose.pale, !!pose.xEyes, px);
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
