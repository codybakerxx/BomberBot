/**
 * The Factory, drawn (the owner's design, 26 November 2026: the night shift in a factory, with conveyor belts;
 * steel floor plates, hazard stripes and the glow of furnaces; machines for solid blocks, cardboard boxes to
 * break). Reads the world, never changes it; render.ts calls these at the right moments:
 * - drawPlate, drawMachine, drawBox: one tile of floor, a solid block, a breakable block
 * - drawFactory (with the floor, drawn once): the hazard stripes along the walls, every belt at rest (its frame
 *   and its tread), the crossings (tables of rolling balls), a drive in the outer wall at each end of a belt
 *   with its beacon, and two furnaces in the side walls with their glow on the floor
 * - drawFactoryLive (every frame): the treads moving the way the belts run, their arrows and the beacons
 *   flashing amber while the alarm sounds, the machines' small lights blinking, the furnaces flickering
 * - drawBeltIcon: a belt for the menu's Key
 * Sizes are in tiles (T), as in render.ts. Pictures that do not change are made once per size and stamped.
 * Kept dark, like the other maps' floors, so blasts, soles, rings and ghosts still glow against it.
 */
import { World, Belt, BELT_WARN_TICKS, BELT_ALARM_TICKS, HARD, FLOOR, beltsAt } from './sim';

type Ctx = CanvasRenderingContext2D;

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number | number[]): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
function line(ctx: Ctx, x1: number, y1: number, x2: number, y2: number): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
function circle(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2);
}
/** A number from 0 to 1 that is always the same for the same n (render.ts's `scatter`, the same sum). */
function hash(n: number): number {
  const v = Math.sin(n * 12.9898) * 43758.5453;
  return v - Math.floor(v);
}

const STEEL = {
  floor: ['#171b22', '#151920'], // two tones, tile about, as on the other maps
  seam: '#0b0d11',
  seamLit: 'rgba(150,170,200,0.10)',
  tread: 'rgba(160,180,210,0.075)',
  treadDark: 'rgba(0,0,0,0.28)',
  bolt: 'rgba(175,190,215,0.22)',
  oil: 'rgba(0,0,0,0.22)',
};
const MACHINE = {
  top: '#3a4252',
  lit: '#6b778e',
  shade: '#1d222b',
  panel: '#2a303c',
  front: '#252b36',
  frontDark: '#151920',
  vent: '#10131a',
  rivet: '#8b96aa',
  dial: '#e6dfc8',
  needle: '#d0342a',
  copper: '#a8643a',
  copperLit: '#e0a06c',
  valve: '#b5302a',
  fin: '#20252e',
};
const HAZARD = { yellow: '#e2b21c', black: '#16171a' };
const BOX = {
  top: '#9a7044',
  topLit: '#b4885a',
  front: '#73512a',
  frontDark: '#5b3f1d',
  edge: '#36230f',
  seam: '#684722',
  tape: '#bea77a',
  tapeShine: 'rgba(255,255,255,0.22)',
  label: '#e9e3d3',
  ink: '#463624',
  crush: 'rgba(60,38,14,0.35)',
};
const BELT = {
  rubber: '#1f2228',
  slat: '#111317',
  slatLit: 'rgba(255,255,255,0.07)',
  arrow: '#667186',
  amber: '#ffb420',
  rail: '#2c323c',
  railLit: '#4d5666',
  railDark: '#0f1216',
  plate: '#29303a',
  ball: '#7f8999',
  ballLit: '#d0d8e2',
  socket: '#12151a',
};
const DRIVE = { body: '#434c5d', lit: '#6f7a90', dark: '#1d222b', roller: '#17191e', rollerLit: '#5b626e', grille: '#14171d', dome: '#7a5512', domeLit: '#ffc240' };

/** How much of a belt's tile its frame takes on each side; the tread runs between. */
const RAIL = 0.11;
/** How much of a block's tile is its top, seen from above; the rest is its front (as the Wild West's crates). */
const TOP = 0.78;

// ---------------------------------------------------------------- floor, machines, boxes

/** Floor plates are drawn once at each size and look, and stamped from then on (an arena has two hundred). */
const plates = new Map<string, HTMLCanvasElement>();
/** One steel floor plate, at column x and row y of the arena. */
export function drawPlate(ctx: Ctx, x: number, y: number, px: number, py: number, T: number): void {
  const h = hash(x * 3.1 + y * 17.3);
  const oil = h < 0.17 ? 1 + Math.floor(h * 18) % 3 : 0; // a dark stain of oil on about one plate in six
  if (!Number.isInteger(T) || T > 200) {
    paintPlate(ctx, (x + y) & 1, oil, px, py, T);
    return;
  }
  const key = `${T}|${(x + y) & 1}|${oil}`;
  let c = plates.get(key);
  if (!c) {
    if (plates.size > 24) plates.clear();
    c = document.createElement('canvas');
    c.width = c.height = T;
    paintPlate(c.getContext('2d')!, (x + y) & 1, oil, 0, 0, T);
    plates.set(key, c);
  }
  ctx.drawImage(c, px, py);
}

/** A steel floor plate: a raised tread of short slanted bars, sunk seams round it, a bolt in each corner, and (`oil` 1 to 3) a stain. */
function paintPlate(ctx: Ctx, tone: number, oil: number, px: number, py: number, T: number): void {
  ctx.fillStyle = STEEL.floor[tone];
  ctx.fillRect(px, py, T, T);
  // the tread: short raised bars at a slant, alternating, in a staggered grid
  const n = 4;
  const c = T / n;
  const bar = Math.max(1, T * 0.035);
  ctx.lineCap = 'round';
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const cx = px + (i + 0.5) * c;
      const cy = py + (j + 0.5) * c;
      const s = (i + j) % 2 === 0 ? 1 : -1;
      const a = c * 0.22;
      ctx.lineWidth = bar;
      ctx.strokeStyle = STEEL.treadDark;
      line(ctx, cx - a, cy + a * s + bar * 0.6, cx + a, cy - a * s + bar * 0.6);
      ctx.strokeStyle = STEEL.tread;
      line(ctx, cx - a, cy + a * s, cx + a, cy - a * s);
    }
  }
  // seams: dark, with a faint lit lip on the far side
  const e = Math.max(1, Math.round(T * 0.03));
  ctx.fillStyle = STEEL.seam;
  ctx.fillRect(px, py, T, e);
  ctx.fillRect(px, py, e, T);
  ctx.fillStyle = STEEL.seamLit;
  ctx.fillRect(px, py + e, T, Math.max(1, e / 2));
  ctx.fillRect(px + e, py, Math.max(1, e / 2), T);
  // bolts
  ctx.fillStyle = STEEL.bolt;
  const b = T * 0.11;
  for (const [bx, by] of [
    [b, b],
    [T - b, b],
    [b, T - b],
    [T - b, T - b],
  ]) {
    circle(ctx, px + bx, py + by, T * 0.025);
    ctx.fill();
  }
  if (oil) {
    ctx.fillStyle = STEEL.oil;
    ctx.beginPath();
    ctx.ellipse(px + T * (0.3 + oil * 0.12), py + T * (0.45 + oil * 0.05), T * 0.2, T * 0.12, oil * 1.7, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Where a machine's small light is, as a share of its tile, for each of its four kinds (none on the last). */
const LED: ([number, number] | null)[] = [
  [0.8, 0.18],
  [0.2, 0.18],
  [0.82, 0.6],
  null,
];
/** Which of the four kinds of machine stands at (x, y): from `deco` (render.ts passes its scatter of the tile). */
function kindOf(deco: number): number {
  return Math.min(3, Math.floor(deco * 4));
}
/** The `deco` render.ts gives the solid block at (x, y) (drawWall), worked out the same way. */
export function decoAt(x: number, y: number): number {
  return hash(x * 12.7 + y * 45.1 + 0.5);
}

const machines = new Map<string, HTMLCanvasElement>();
/**
 * A machine: a steel housing seen from above, its top lit from the upper left, its front darker with vents
 * (hidden when another solid block is right below: `joined`). Four kinds, by `deco`: a control cabinet with a
 * gauge, a cooling unit with a fan, a motor with fins and a band of hazard stripes, and a pipe junction with a
 * red valve wheel. The first three have a small light, which drawFactoryLive makes blink. Made once for each
 * size and look, and stamped.
 */
export function drawMachine(ctx: Ctx, px: number, py: number, T: number, joined: boolean, deco = 0.5): void {
  if (!Number.isInteger(T) || T > 200) {
    paintMachine(ctx, px, py, T, joined, deco);
    return;
  }
  const d = Math.floor(deco * 16) / 16; // (sixteen looks: the kind and where the gauge's needle points)
  const key = `${T}|${joined ? 1 : 0}|${d}`;
  let c = machines.get(key);
  if (!c) {
    if (machines.size > 80) machines.clear();
    c = document.createElement('canvas');
    c.width = c.height = T;
    paintMachine(c.getContext('2d')!, 0, 0, T, joined, d);
    machines.set(key, c);
  }
  ctx.drawImage(c, px, py);
}
function paintMachine(ctx: Ctx, px: number, py: number, T: number, joined: boolean, deco: number): void {
  const kind = kindOf(deco);
  const g = Math.max(1, Math.round(T * 0.035));
  const top = joined ? T : Math.round(T * TOP);
  ctx.fillStyle = MACHINE.shade;
  ctx.fillRect(px, py, T, T);
  // the top
  ctx.fillStyle = MACHINE.top;
  ctx.fillRect(px + g, py + g, T - g * 2, top - g * 2);
  ctx.fillStyle = MACHINE.lit;
  ctx.fillRect(px + g, py + g, T - g * 2, g);
  ctx.fillRect(px + g, py + g, g, top - g * 2);
  ctx.save();
  ctx.beginPath();
  ctx.rect(px + g * 2, py + g * 2, T - g * 4, top - g * 4);
  ctx.clip();
  const ix = px + T * 0.16;
  const iy = py + T * 0.14;
  const iw = T * 0.68;
  const ih = top - T * 0.28;
  if (kind === 0) {
    // a control cabinet: a sunk panel with a round gauge on it
    ctx.fillStyle = MACHINE.panel;
    rr(ctx, ix, iy, iw, ih, T * 0.05);
    ctx.fill();
    const cx = px + T * 0.42;
    const cy = py + top * 0.52;
    const r = T * 0.17;
    ctx.fillStyle = MACHINE.vent;
    circle(ctx, cx, cy, r + T * 0.03);
    ctx.fill();
    ctx.fillStyle = MACHINE.dial;
    circle(ctx, cx, cy, r);
    ctx.fill();
    ctx.strokeStyle = MACHINE.vent;
    ctx.lineWidth = Math.max(1, T * 0.018);
    for (let k = 0; k < 5; k++) {
      const a = Math.PI * (0.8 + k * 0.35);
      line(ctx, cx + Math.cos(a) * r * 0.72, cy + Math.sin(a) * r * 0.72, cx + Math.cos(a) * r * 0.92, cy + Math.sin(a) * r * 0.92);
    }
    ctx.strokeStyle = MACHINE.needle;
    ctx.lineWidth = Math.max(1, T * 0.025);
    const a = Math.PI * (1.15 + deco * 1.2);
    line(ctx, cx, cy, cx + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 0.8);
    // two buttons beside it
    ctx.fillStyle = '#1a1e26';
    rr(ctx, px + T * 0.64, py + top * 0.42, T * 0.13, T * 0.09, T * 0.02);
    ctx.fill();
    rr(ctx, px + T * 0.64, py + top * 0.62, T * 0.13, T * 0.09, T * 0.02);
    ctx.fill();
  } else if (kind === 1) {
    // a cooling unit: a round fan grille
    const cx = px + T * 0.5;
    const cy = py + top * 0.54;
    const r = Math.min(T * 0.27, top * 0.36);
    ctx.fillStyle = MACHINE.vent;
    circle(ctx, cx, cy, r);
    ctx.fill();
    ctx.strokeStyle = '#3a4252';
    ctx.lineWidth = Math.max(1, T * 0.03);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + deco * 3;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.62, a, a + 1.0);
      ctx.stroke();
    }
    ctx.strokeStyle = MACHINE.lit;
    ctx.lineWidth = Math.max(1, T * 0.02);
    circle(ctx, cx, cy, r);
    ctx.stroke();
    ctx.fillStyle = MACHINE.lit;
    circle(ctx, cx, cy, r * 0.16);
    ctx.fill();
  } else if (kind === 2) {
    // a motor: cooling fins, and a band of hazard stripes along its top edge
    ctx.fillStyle = MACHINE.fin;
    const fins = 5;
    for (let k = 0; k < fins; k++) ctx.fillRect(ix + (k * iw) / fins + T * 0.02, py + top * 0.34, Math.max(1, T * 0.05), ih * 0.7);
    stripes(ctx, px + g * 2, py + g * 2, T - g * 4, Math.max(2, T * 0.1), T);
  } else {
    // a pipe junction: two copper pipes crossing, and a red valve wheel where they meet
    const pw = Math.max(2, T * 0.13);
    ctx.fillStyle = MACHINE.copper;
    ctx.fillRect(px, py + top * 0.5 - pw / 2, T, pw);
    ctx.fillRect(px + T * 0.5 - pw / 2, py, pw, top);
    ctx.fillStyle = MACHINE.copperLit;
    ctx.fillRect(px, py + top * 0.5 - pw / 2, T, Math.max(1, pw * 0.25));
    ctx.fillRect(px + T * 0.5 - pw / 2, py, Math.max(1, pw * 0.25), top);
    ctx.strokeStyle = MACHINE.valve;
    ctx.lineWidth = Math.max(1, T * 0.04);
    const cx = px + T * 0.5;
    const cy = py + top * 0.5;
    circle(ctx, cx, cy, T * 0.15);
    ctx.stroke();
    line(ctx, cx - T * 0.15, cy, cx + T * 0.15, cy);
    line(ctx, cx, cy - T * 0.15, cx, cy + T * 0.15);
  }
  // the light's socket (dark: drawFactoryLive lights it)
  const led = LED[kind];
  if (led) {
    ctx.fillStyle = '#0c0e12';
    circle(ctx, px + led[0] * T, py + led[1] * top, T * 0.055);
    ctx.fill();
  }
  ctx.restore();
  // rivets in the top's corners
  ctx.fillStyle = MACHINE.rivet;
  const rv = T * 0.09;
  for (const [rx, ry] of [
    [rv, rv],
    [T - rv, rv],
    [rv, top - rv],
    [T - rv, top - rv],
  ]) {
    if (kind === 3 && (rx === rv || ry === rv)) continue; // (under the pipes)
    circle(ctx, px + rx, py + ry, T * 0.022);
    ctx.fill();
  }
  if (joined) return;
  // the front: darker, with vents
  ctx.fillStyle = MACHINE.front;
  ctx.fillRect(px + g, py + top, T - g * 2, T - top - g);
  ctx.fillStyle = MACHINE.vent;
  const vh = Math.max(1, Math.round(T * 0.025));
  for (const k of [0.3, 0.58]) ctx.fillRect(px + T * 0.2, py + top + (T - top) * k, T * 0.6, vh);
  ctx.fillStyle = MACHINE.frontDark;
  ctx.fillRect(px + g, py + T - g * 2, T - g * 2, g);
}

/** Yellow and black stripes at a slant, filling the box (x, y, w, h). */
function stripes(ctx: Ctx, x: number, y: number, w: number, h: number, T: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = HAZARD.black;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = HAZARD.yellow;
  const s = Math.max(3, T * 0.14);
  for (let k = -2; k * s < w + h + s * 2; k += 2) {
    ctx.beginPath();
    ctx.moveTo(x + k * s, y + h);
    ctx.lineTo(x + k * s + s, y + h);
    ctx.lineTo(x + k * s + s + h, y);
    ctx.lineTo(x + k * s + h, y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/**
 * A cardboard box (the owner's pick): its top, kraft brown, with the flaps' seam down the middle and packing
 * tape over it, and under it its front, darker. `variant` (0 to 3): tape along the seam; tape across it too; a
 * shipping label; a crushed corner and printed arrows on its front. A dark edge all round, so boxes side by side
 * read as boxes.
 */
export function drawBox(ctx: Ctx, px: number, py: number, T: number, variant = 0): void {
  const g = Math.max(1, Math.round(T * 0.035));
  const top = Math.round(T * TOP);
  ctx.fillStyle = BOX.edge;
  ctx.fillRect(px, py, T, T);
  const lx = px + g;
  const ly = py + g;
  const lw = T - g * 2;
  const lh = top - g;
  ctx.fillStyle = BOX.top;
  ctx.fillRect(lx, ly, lw, lh);
  ctx.fillStyle = BOX.topLit;
  ctx.fillRect(lx, ly, lw, Math.max(1, Math.round(T * 0.03)));
  ctx.fillRect(lx, ly, Math.max(1, Math.round(T * 0.03)), lh);
  // the flaps' seam, down the middle, and the tape over it
  const mid = Math.round(px + T / 2);
  const tw = Math.max(2, Math.round(T * 0.16));
  ctx.fillStyle = BOX.tape;
  ctx.fillRect(mid - tw / 2, ly, tw, lh);
  ctx.fillStyle = BOX.tapeShine;
  ctx.fillRect(mid - tw / 2, ly, Math.max(1, tw * 0.3), lh);
  ctx.fillStyle = BOX.seam;
  ctx.fillRect(mid - Math.max(1, T * 0.012), ly, Math.max(1, T * 0.025), lh);
  if (variant === 1) {
    // a second strip of tape, across
    const ty = Math.round(ly + lh / 2 - tw / 2);
    ctx.fillStyle = BOX.tape;
    ctx.fillRect(lx, ty, lw, tw);
    ctx.fillStyle = BOX.tapeShine;
    ctx.fillRect(lx, ty, lw, Math.max(1, tw * 0.3));
  } else if (variant === 2) {
    // a shipping label, with a few lines of print
    const lbx = px + T * 0.58;
    const lby = py + T * 0.16;
    ctx.fillStyle = BOX.label;
    ctx.fillRect(lbx, lby, T * 0.3, T * 0.24);
    ctx.fillStyle = BOX.ink;
    for (let k = 0; k < 3; k++) ctx.fillRect(lbx + T * 0.04, lby + T * (0.05 + k * 0.06), T * (k === 1 ? 0.14 : 0.21), Math.max(1, T * 0.025));
  } else if (variant === 3) {
    // a crushed corner
    ctx.fillStyle = BOX.crush;
    ctx.beginPath();
    ctx.moveTo(lx + lw, ly);
    ctx.lineTo(lx + lw - T * 0.26, ly);
    ctx.lineTo(lx + lw, ly + T * 0.24);
    ctx.closePath();
    ctx.fill();
  }
  // the front: darker, with the bottom edge darker still
  const fy = py + top;
  const fh = T - top - g;
  ctx.fillStyle = BOX.front;
  ctx.fillRect(lx, fy, lw, fh);
  ctx.fillStyle = BOX.frontDark;
  ctx.fillRect(lx, fy, lw, Math.max(1, Math.round(T * 0.025)));
  ctx.fillRect(mid - tw / 2, fy, tw, fh);
  if (variant === 3) {
    // "this way up": two small arrows printed on the front
    ctx.strokeStyle = BOX.ink;
    ctx.lineWidth = Math.max(1, T * 0.025);
    for (const ax of [0.22, 0.32]) {
      const x = px + T * ax;
      line(ctx, x, fy + fh * 0.85, x, fy + fh * 0.2);
      line(ctx, x - T * 0.03, fy + fh * 0.45, x, fy + fh * 0.2);
      line(ctx, x + T * 0.03, fy + fh * 0.45, x, fy + fh * 0.2);
    }
  }
}

// ---------------------------------------------------------------- the belts

/** Every tile of the belts inside the outer wall, and whether it is a crossing (a belt each way). */
function beltTiles(world: World): { x: number; y: number; belt: Belt; cross: boolean }[] {
  const out: { x: number; y: number; belt: Belt; cross: boolean }[] = [];
  for (const b of world.belts) {
    const len = (b.dir === 'h' ? world.w : world.h) - 2;
    for (let k = 1; k <= len; k++) {
      const x = b.dir === 'h' ? k : b.at;
      const y = b.dir === 'h' ? b.at : k;
      const cross = world.belts.some((o) => o !== b && o.dir !== b.dir && o.at === (o.dir === 'h' ? y : x));
      if (cross && b.dir === 'v') continue; // (one entry for a crossing)
      out.push({ x, y, belt: b, cross });
    }
  }
  return out;
}

/**
 * A box on a belt (not on a crossing) sits on its tread, between the belt's frame, so the belt still shows
 * under the boxes: the scale it is drawn at across the belt, about its tile's middle ([x, y]), or null.
 */
export function boxOnBelt(world: World, x: number, y: number): [number, number] | null {
  if (!world.belts.length) return null;
  const [h, v] = beltsAt(world, x, y);
  if (!h === !v) return null;
  const k = 1 - RAIL * 2;
  return h ? [1, k] : [k, 1];
}

/** The belts' tread, running left to right (`dir` 4), right to left (3), down (2) or up (1), arrows amber while the alarm sounds. */
const treads = new Map<string, HTMLCanvasElement>();
function tread(T: number, dir: number, alarm: boolean): HTMLCanvasElement {
  const key = `${T}|${dir}|${alarm ? 1 : 0}`;
  let c = treads.get(key);
  if (c) return c;
  if (treads.size > 32) treads.clear();
  const band = T - Math.round(T * RAIL) * 2;
  // made along a row, 2 tiles long (one tile of it is shown, from anywhere in its first tile), then turned
  const h = document.createElement('canvas');
  h.width = T * 2;
  h.height = band;
  const g = h.getContext('2d')!;
  g.fillStyle = BELT.rubber;
  g.fillRect(0, 0, T * 2, band);
  const sw = Math.max(1, Math.round(T * 0.035));
  for (let k = 0; k < 8; k++) {
    const x = Math.round((k * T) / 4);
    g.fillStyle = BELT.slat;
    g.fillRect(x, 0, sw, band);
    g.fillStyle = BELT.slatLit;
    g.fillRect(x + sw, 0, Math.max(1, sw / 2), band);
  }
  // an arrow each tile, pointing the way it runs
  g.strokeStyle = alarm ? BELT.amber : BELT.arrow;
  g.lineWidth = Math.max(1.5, T * 0.075);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const cx of [T * 0.5, T * 1.5]) {
    const a = T * 0.1;
    const b = band * 0.26;
    g.beginPath();
    g.moveTo(cx - a, band / 2 - b);
    g.lineTo(cx + a, band / 2);
    g.lineTo(cx - a, band / 2 + b);
    g.stroke();
  }
  c = document.createElement('canvas');
  const vertical = dir === 1 || dir === 2;
  c.width = vertical ? band : T * 2;
  c.height = vertical ? T * 2 : band;
  const o = c.getContext('2d')!;
  // turned so its arrows point the way it runs
  if (dir === 4) o.drawImage(h, 0, 0);
  else if (dir === 3) o.setTransform(-1, 0, 0, 1, T * 2, 0);
  else if (dir === 2) o.setTransform(0, 1, -1, 0, band, 0);
  else o.setTransform(0, -1, -1, 0, band, T * 2);
  if (dir !== 4) o.drawImage(h, 0, 0);
  treads.set(key, c);
  return c;
}

/** The way a belt runs now, as a Dir. */
function wayOf(world: World, b: Belt): number {
  const w = b.way * world.beltWay;
  return b.dir === 'h' ? (w > 0 ? 4 : 3) : w > 0 ? 2 : 1;
}

/** One tile of a belt's tread, moved on by how far the belt has run (`run`, in tiles, along its row or column). */
function treadTile(ctx: Ctx, world: World, b: Belt, x: number, y: number, T: number, run: number, alarm: boolean): void {
  const r = Math.round(T * RAIL);
  const band = T - r * 2;
  const img = tread(T, wayOf(world, b), alarm);
  const shift = (((-run * T) % T) + T) % T;
  const s = Math.round(shift) % T;
  if (b.dir === 'h') ctx.drawImage(img, s, 0, T, band, x * T, y * T + r, T, band);
  else ctx.drawImage(img, 0, s, band, T, x * T + r, y * T, band, T);
}

/** A belt's frame on one tile: a steel rail along each side, with a yellow line on its inner edge. */
function frame(ctx: Ctx, x: number, y: number, T: number, dir: 'h' | 'v'): void {
  const r = Math.round(T * RAIL);
  const px = x * T;
  const py = y * T;
  const e = Math.max(1, Math.round(T * 0.025));
  if (dir === 'h') {
    for (const [ry, inner] of [
      [py, py + r - e],
      [py + T - r, py + T - r],
    ]) {
      ctx.fillStyle = BELT.rail;
      ctx.fillRect(px, ry, T, r);
      ctx.fillStyle = BELT.railLit;
      ctx.fillRect(px, ry, T, Math.max(1, e / 2));
      ctx.fillStyle = HAZARD.yellow;
      ctx.fillRect(px, inner, T, e);
    }
    ctx.fillStyle = BELT.railDark; // the joint between two lengths of frame
    ctx.fillRect(px, py, Math.max(1, e / 2), r);
    ctx.fillRect(px, py + T - r, Math.max(1, e / 2), r);
  } else {
    for (const [rx, inner] of [
      [px, px + r - e],
      [px + T - r, px + T - r],
    ]) {
      ctx.fillStyle = BELT.rail;
      ctx.fillRect(rx, py, r, T);
      ctx.fillStyle = BELT.railLit;
      ctx.fillRect(rx, py, Math.max(1, e / 2), T);
      ctx.fillStyle = HAZARD.yellow;
      ctx.fillRect(inner, py, e, T);
    }
    ctx.fillStyle = BELT.railDark;
    ctx.fillRect(px, py, r, Math.max(1, e / 2));
    ctx.fillRect(px + T - r, py, r, Math.max(1, e / 2));
  }
}

/** A crossing: a steel table of rolling balls (things roll across it either way), yellow marks in its corners. */
function drawCrossTable(ctx: Ctx, x: number, y: number, T: number): void {
  const px = x * T;
  const py = y * T;
  ctx.fillStyle = BELT.plate;
  ctx.fillRect(px, py, T, T);
  const e = Math.max(1, Math.round(T * 0.03));
  ctx.fillStyle = BELT.railLit;
  ctx.fillRect(px, py, T, e);
  ctx.fillRect(px, py, e, T);
  ctx.fillStyle = BELT.railDark;
  ctx.fillRect(px, py + T - e, T, e);
  ctx.fillRect(px + T - e, py, e, T);
  const n = 4;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const cx = px + T * (0.2 + i * 0.2);
      const cy = py + T * (0.2 + j * 0.2);
      ctx.fillStyle = BELT.socket;
      circle(ctx, cx, cy, T * 0.065);
      ctx.fill();
      ctx.fillStyle = BELT.ball;
      circle(ctx, cx, cy, T * 0.045);
      ctx.fill();
      ctx.fillStyle = BELT.ballLit;
      circle(ctx, cx - T * 0.014, cy - T * 0.014, T * 0.016);
      ctx.fill();
    }
  }
  // yellow corner marks
  ctx.fillStyle = HAZARD.yellow;
  const m = T * 0.16;
  const w = Math.max(1, T * 0.04);
  for (const [cx, cy, sx, sy] of [
    [px + e, py + e, 1, 1],
    [px + T - e, py + e, -1, 1],
    [px + e, py + T - e, 1, -1],
    [px + T - e, py + T - e, -1, -1],
  ]) {
    ctx.fillRect(sx > 0 ? cx : cx - m, sy > 0 ? cy : cy - w, m, w);
    ctx.fillRect(sx > 0 ? cx : cx - w, sy > 0 ? cy : cy - m, w, m);
  }
}

/** Where each end of a belt meets the outer wall: the wall tile, and which side of the arena it is on. */
function ends(world: World, b: Belt): { x: number; y: number; side: 'top' | 'bottom' | 'left' | 'right' }[] {
  return b.dir === 'h'
    ? [
        { x: 0, y: b.at, side: 'left' },
        { x: world.w - 1, y: b.at, side: 'right' },
      ]
    : [
        { x: b.at, y: 0, side: 'top' },
        { x: b.at, y: world.h - 1, side: 'bottom' },
      ];
}

/** The two furnaces: in the middle of the left and right walls. */
function furnaces(world: World): { x: number; y: number; side: 'left' | 'right' }[] {
  const cy = Math.floor((world.h - 1) / 2);
  return [
    { x: 0, y: cy, side: 'left' },
    { x: world.w - 1, y: cy, side: 'right' },
  ];
}

/** The outer wall's tiles the belts' drives and the furnaces stand on, by index (they have no blinking light). */
export function factoryWalls(world: World): Set<number> {
  const out = new Set<number>();
  for (const b of world.belts) for (const e of ends(world, b)) out.add(e.y * world.w + e.x);
  for (const f of furnaces(world)) out.add(f.y * world.w + f.x);
  return out;
}

/** Turn the drawing so that `side` is drawn as if it were the top wall: the arena is then below (higher v). */
function facing(ctx: Ctx, px: number, py: number, T: number, side: 'top' | 'bottom' | 'left' | 'right'): void {
  if (side === 'top') ctx.translate(px, py);
  else if (side === 'bottom') ctx.setTransform(ctx.getTransform().multiply(new DOMMatrix([1, 0, 0, -1, px, py + T])));
  else if (side === 'left') ctx.setTransform(ctx.getTransform().multiply(new DOMMatrix([0, 1, 1, 0, px, py])));
  else ctx.setTransform(ctx.getTransform().multiply(new DOMMatrix([0, 1, -1, 0, px + T, py])));
}

/** Where a drive's beacon is, in a wall tile seen as the top wall (as `facing` turns it). */
const BEACON: [number, number] = [0.2, 0.3];

/**
 * A belt's drive, in the outer wall where the belt ends: a housing with the belt's roller along its arena side,
 * a motor with a fan, and an amber beacon on top (dark until the alarm: drawFactoryLive).
 */
function drawDrive(ctx: Ctx, px: number, py: number, T: number, side: 'top' | 'bottom' | 'left' | 'right'): void {
  ctx.save();
  facing(ctx, px, py, T, side);
  const g = Math.max(1, Math.round(T * 0.035));
  ctx.fillStyle = DRIVE.dark;
  ctx.fillRect(0, 0, T, T);
  ctx.fillStyle = DRIVE.body;
  ctx.fillRect(g, g, T - g * 2, T - g * 2);
  ctx.fillStyle = DRIVE.lit;
  ctx.fillRect(g, g, T - g * 2, g);
  // hazard stripes across the housing
  stripes(ctx, g, T * 0.08, T - g * 2, T * 0.1, T);
  // the motor, with a fan
  ctx.fillStyle = '#5a6376';
  rr(ctx, T * 0.42, T * 0.22, T * 0.44, T * 0.36, T * 0.04);
  ctx.fill();
  ctx.fillStyle = DRIVE.grille;
  circle(ctx, T * 0.64, T * 0.4, T * 0.13);
  ctx.fill();
  ctx.strokeStyle = '#3a4252';
  ctx.lineWidth = Math.max(1, T * 0.02);
  for (let k = 0; k < 3; k++) line(ctx, T * 0.53, T * (0.35 + k * 0.05), T * 0.75, T * (0.35 + k * 0.05));
  // the roller, along the arena side, as wide as the belt's tread
  const r = Math.round(T * RAIL);
  ctx.fillStyle = DRIVE.roller;
  rr(ctx, r - g, T * 0.68, T - (r - g) * 2, T * 0.3, T * 0.12);
  ctx.fill();
  ctx.fillStyle = DRIVE.rollerLit;
  ctx.fillRect(r, T * 0.74, T - r * 2, Math.max(1, T * 0.03));
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(r, T * 0.9, T - r * 2, Math.max(1, T * 0.04));
  // the beacon: a dark amber dome on a black base
  ctx.fillStyle = '#121418';
  circle(ctx, BEACON[0] * T, BEACON[1] * T + T * 0.02, T * 0.12);
  ctx.fill();
  ctx.fillStyle = DRIVE.dome;
  circle(ctx, BEACON[0] * T, BEACON[1] * T, T * 0.09);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  circle(ctx, BEACON[0] * T - T * 0.03, BEACON[1] * T - T * 0.03, T * 0.025);
  ctx.fill();
  ctx.restore();
}

/** A furnace in the outer wall: a brick housing with a grate on its arena side, glowing (it flickers: drawFactoryLive). */
function drawFurnace(ctx: Ctx, px: number, py: number, T: number, side: 'left' | 'right'): void {
  ctx.save();
  facing(ctx, px, py, T, side);
  // bricks
  ctx.fillStyle = '#3a1c14';
  ctx.fillRect(0, 0, T, T);
  ctx.fillStyle = '#5e2c1e';
  const bh = T / 4;
  for (let row = 0; row < 4; row++) {
    const off = row % 2 ? T / 4 : 0;
    for (let k = -1; k < 3; k++) {
      const x = off + k * (T / 2);
      ctx.fillRect(Math.max(0, x + 1), row * bh + 1, Math.min(T, x + T / 2 - 1) - Math.max(0, x + 1), bh - 2);
    }
  }
  // the mouth: white-hot at the back, orange, then deep red at the grate
  const grad = ctx.createLinearGradient(0, T * 0.2, 0, T);
  grad.addColorStop(0, '#ffe7a0');
  grad.addColorStop(0.45, '#ff8a1e');
  grad.addColorStop(1, '#7a1606');
  ctx.fillStyle = grad;
  rr(ctx, T * 0.16, T * 0.2, T * 0.68, T * 0.8, [T * 0.3, T * 0.3, 0, 0]);
  ctx.fill();
  // the grate
  ctx.fillStyle = '#1a0d08';
  for (let k = 0; k < 5; k++) ctx.fillRect(T * (0.2 + k * 0.13), T * 0.55, Math.max(1, T * 0.04), T * 0.45);
  ctx.fillRect(T * 0.16, T * 0.55, T * 0.68, Math.max(1, T * 0.04));
  ctx.restore();
}

/**
 * Drawn once with the floor: yellow and black stripes along the floor's edge by the walls, the belts at rest
 * (frame, tread, crossings), a drive at each end of each belt and the two furnaces with the glow they throw on
 * the floor. Belts under a fallen block are left out.
 */
export function drawFactory(ctx: Ctx, world: World, T: number): void {
  if (!world.belts.length) return;
  // the furnaces' glow on the floor
  for (const f of furnaces(world)) {
    const cx = (f.side === 'left' ? 1 : world.w - 1) * T;
    const cy = (f.y + 0.5) * T;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, T * 3.4);
    g.addColorStop(0, 'rgba(255,128,40,0.26)');
    g.addColorStop(0.5, 'rgba(255,100,30,0.09)');
    g.addColorStop(1, 'rgba(255,90,20,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - T * 3.4, cy - T * 3.4, T * 6.8, T * 6.8);
  }
  // hazard stripes along the floor's edge, by the walls (a keep-clear line)
  const s = Math.max(2, Math.round(T * 0.1));
  const inner = (x: number, y: number): boolean => world.tiles[y * world.w + x] !== HARD;
  for (let x = 1; x < world.w - 1; x++) {
    if (inner(x, 1)) stripes(ctx, x * T, T, T, s, T);
    if (inner(x, world.h - 2)) stripes(ctx, x * T, (world.h - 1) * T - s, T, s, T);
  }
  for (let y = 1; y < world.h - 1; y++) {
    if (inner(1, y)) stripes(ctx, T, y * T, s, T, T);
    if (inner(world.w - 2, y)) stripes(ctx, (world.w - 1) * T - s, y * T, s, T, T);
  }
  // the belts
  for (const t of beltTiles(world)) {
    if (world.tiles[t.y * world.w + t.x] === HARD) continue;
    if (t.cross) drawCrossTable(ctx, t.x, t.y, T);
    else {
      frame(ctx, t.x, t.y, T, t.belt.dir);
      treadTile(ctx, world, t.belt, t.x, t.y, T, t.belt.way * world.beltRun, false);
    }
  }
  for (const b of world.belts) for (const e of ends(world, b)) drawDrive(ctx, e.x * T, e.y * T, T, e.side);
  for (const f of furnaces(world)) drawFurnace(ctx, f.x * T, f.y * T, T, f.side);
}

/** Is the alarm sounding (the belts are about to turn round)? And is its light on this moment (it flashes twice a second)? */
export function alarmAt(world: World, tick = world.tick): { on: boolean; lit: boolean; k: number } {
  const from = world.beltFlip - BELT_WARN_TICKS;
  if (!world.belts.length || !world.beltFlip || world.over || tick < from || tick >= world.beltFlip) return { on: false, lit: false, k: 0 };
  const since = tick - from;
  return { on: true, lit: since % BELT_ALARM_TICKS < BELT_ALARM_TICKS / 2, k: Math.floor(since / BELT_ALARM_TICKS) };
}

/** The colour a machine's light blinks in, how fast, and its share of the time lit, from its tile. */
function ledOf(x: number, y: number): { col: string; rate: number; duty: number; phase: number } {
  const h = hash(x * 7.7 + y * 3.3 + 1.1);
  const col = h < 0.5 ? '#58ff86' : h < 0.78 ? '#ffc23a' : '#ff4b45';
  return { col, rate: 0.5 + hash(x * 1.3 + y * 9.1) * 1.4, duty: 0.35 + hash(x + y * 5.5) * 0.4, phase: hash(x * 2.9 + y * 0.7) };
}

/**
 * Every frame: the treads moving, their arrows and the beacons flashing amber while the alarm sounds, the
 * blocks' shadows put back over the moving treads, the machines' small lights blinking and the furnaces
 * flickering. Drawn over the floor and its blocks, under everything else.
 */
export function drawFactoryLive(ctx: Ctx, world: World, T: number, time: number): void {
  if (!world.belts.length) return;
  const alarm = alarmAt(world);
  // the treads, on belt tiles with nothing on them (a box or a fallen block stands over its belt)
  const shade = 'rgba(0,0,0,0.38)';
  const r = Math.round(T * RAIL);
  for (const t of beltTiles(world)) {
    if (t.cross || world.tiles[t.y * world.w + t.x] !== FLOOR) continue;
    if (world.burning.some((b) => b.cx === t.x && b.cy === t.y)) continue;
    treadTile(ctx, world, t.belt, t.x, t.y, T, t.belt.way * world.beltRun, alarm.lit);
    // the shadow of a block right above, put back over the tread
    if (t.y > 0 && world.tiles[(t.y - 1) * world.w + t.x] !== FLOOR) {
      ctx.fillStyle = shade;
      const top = t.belt.dir === 'h' ? r : 0;
      const sh = Math.round(T * 0.16) - top;
      if (sh > 0) ctx.fillRect(t.x * T + (t.belt.dir === 'v' ? r : 0), t.y * T + top, t.belt.dir === 'v' ? T - r * 2 : T, sh);
    }
  }
  const walls = factoryWalls(world);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // the machines' small lights
  for (let y = 0; y < world.h; y++) {
    for (let x = 0; x < world.w; x++) {
      const i = y * world.w + x;
      if (world.tiles[i] !== HARD || walls.has(i)) continue;
      const deco = decoAt(x, y);
      const led = LED[kindOf(deco)];
      if (!led) continue;
      const l = ledOf(x, y);
      const f = time * l.rate + l.phase;
      if (f - Math.floor(f) > l.duty) continue;
      const joined = y + 1 < world.h && world.tiles[i + world.w] === HARD;
      const top = joined ? T : Math.round(T * TOP);
      const lx = x * T + led[0] * T;
      const ly = y * T + led[1] * top;
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = l.col;
      circle(ctx, lx, ly, T * 0.11);
      ctx.fill();
      ctx.globalAlpha = 1;
      circle(ctx, lx, ly, T * 0.045);
      ctx.fill();
    }
  }
  // the furnaces flicker
  for (const f of furnaces(world)) {
    const cx = (f.side === 'left' ? 1 : world.w - 1) * T;
    const cy = (f.y + 0.5) * T;
    const k = 0.5 + 0.3 * Math.sin(time * 11 + f.x) + 0.2 * Math.sin(time * 23.7 + f.y * 3);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, T * 1.8);
    g.addColorStop(0, `rgba(255,120,30,${(0.1 + 0.1 * k).toFixed(3)})`);
    g.addColorStop(1, 'rgba(255,90,20,0)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = g;
    ctx.fillRect(cx - T * 1.8, cy - T * 1.8, T * 3.6, T * 3.6);
  }
  // the beacons: lit amber in turn while the alarm sounds, a glow round each
  if (alarm.on) {
    world.belts.forEach((b) => {
      ends(world, b).forEach((e, n) => {
        // a belt's two beacons flash in turn
        if (alarm.lit !== (n === 0)) return;
        ctx.save();
        facing(ctx, e.x * T, e.y * T, T, e.side);
        const bx = BEACON[0] * T;
        const by = BEACON[1] * T;
        ctx.globalAlpha = 1;
        ctx.fillStyle = DRIVE.domeLit;
        circle(ctx, bx, by, T * 0.09);
        ctx.fill();
        const g = ctx.createRadialGradient(bx, by, 0, bx, by, T * 1.3);
        g.addColorStop(0, 'rgba(255,180,40,0.6)');
        g.addColorStop(0.35, 'rgba(255,150,20,0.2)');
        g.addColorStop(1, 'rgba(255,140,20,0)');
        ctx.fillStyle = g;
        ctx.fillRect(bx - T * 1.3, by - T * 1.3, T * 2.6, T * 2.6);
        ctx.restore();
      });
    });
  }
  ctx.restore();
}

/** A belt for the menu's Key, `s` across: one tile of tread between its frame, its arrow pointing right. */
export function drawBeltIcon(ctx: Ctx, s: number): void {
  const T = Math.max(8, Math.round(s));
  ctx.fillStyle = STEEL.floor[0];
  ctx.fillRect(0, 0, T, T);
  frame(ctx, 0, 0, T, 'h');
  const r = Math.round(T * RAIL);
  ctx.drawImage(tread(T, 4, false), 0, 0, T, T - r * 2, 0, r, T, T - r * 2);
}
