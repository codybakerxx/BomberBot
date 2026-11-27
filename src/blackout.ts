/**
 * Blackout, drawn (the owner's design, 27 November 2026: a pitch black map, a flash of light now and then, a
 * flashlight power-up; black and white tiles, solid blocks as triangular chrome spikes, reflective like a mirror,
 * a punk rock look). Reads the world, never changes it; render.ts calls these:
 * - drawCheck, drawStud, drawMarble: one tile of floor (black and white checks), a solid block (a
 *   mirror-chrome pyramid stud), a breakable block (polished black marble
 *   with fine white veins)
 * - drawDark (every frame, over the round, under the planes): the dark itself. Nothing shows but what is lit:
 *   the whole arena while the flash is on (sim.ts `flashLight`), and round each light (`lights`): a flashlight's
 *   3 tiles, a bomb and its burning fuse, a blast, a flashlight lying on the floor. No robot glows, yours
 *   included (the owner's pick).
 * - drawTorchIcon: the flashlight for the menu's Key; drawTorchHeld: one in a robot's hand
 * Sizes are in tiles (T), as in render.ts.
 */
import { World, flashLight, lights } from './sim';

type Ctx = CanvasRenderingContext2D;

/** A number from 0 to 1 that is always the same for the same n (render.ts's `scatter`, the same sum). */
function hash(n: number): number {
  const v = Math.sin(n * 12.9898) * 43758.5453;
  return v - Math.floor(v);
}

// ---------------------------------------------------------------- the floor

/** Black and white checks, four to a tile, scuffed. */
export function drawCheck(ctx: Ctx, x: number, y: number, px: number, py: number, T: number): void {
  const h = T / 2;
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 2; i++) {
      const white = (x * 2 + i + y * 2 + j) % 2 === 0;
      const n = hash(x * 31.7 + y * 17.3 + i * 5.1 + j * 2.3);
      ctx.fillStyle = white ? `hsl(45, 6%, ${64 + n * 8}%)` : `hsl(240, 6%, ${7 + n * 3}%)`;
      ctx.fillRect(px + i * h, py + j * h, h, h);
    }
  }
  // grout between the checks, and a little grime
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = Math.max(1, T * 0.012);
  ctx.beginPath();
  ctx.moveTo(px + h, py);
  ctx.lineTo(px + h, py + T);
  ctx.moveTo(px, py + h);
  ctx.lineTo(px + T, py + h);
  ctx.stroke();
  for (let k = 0; k < 4; k++) {
    const n = hash(x * 91.1 + y * 47.9 + k * 13.3);
    ctx.fillStyle = n > 0.5 ? 'rgba(20,20,24,0.25)' : 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.ellipse(px + hash(n * 7 + k) * T, py + hash(n * 11 + k) * T, T * (0.03 + n * 0.05), T * (0.015 + n * 0.02), n * 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------- the solid blocks

/**
 * A chrome pyramid stud (the owner's design, from his reference photo of pyramid studs, 27 November 2026): the
 * whole block is a square pyramid seen from above, four triangular faces meeting at a point in the middle,
 * mirror chrome. The light comes from the top left, so the top face is brightest, the left next, the right
 * dark and the bottom darkest; each face has the hard-edged bands of a mirror (a dark horizon across it), the
 * ridges up from the lit corners catch a thin white line, and the point has a glint. (A triangle standing on a
 * studded plate came first, and a flat chrome block for an hour: neither read as a block.)
 */
export function drawStud(ctx: Ctx, px: number, py: number, T: number, joined: boolean, deco: number): void {
  const g = Math.max(1, T * 0.02); // a hairline gap round each stud, so neighbours read as separate blocks
  const x0 = px + g;
  const y0 = py + g;
  const x1 = px + T - g;
  const y1 = py + T - g;
  const ax = px + T * (0.5 + (deco - 0.5) * 0.03);
  const ay = py + T * (0.5 + (deco - 0.5) * 0.03);
  ctx.fillStyle = '#050506';
  ctx.fillRect(px, py, T, T);
  /** one face, from the middle of its base edge (bx, by) up to the point, banded like a mirror */
  const face = (pts: number[][], bx: number, by: number, stops: [number, string][]): void => {
    const grad = ctx.createLinearGradient(bx, by, ax, ay);
    for (const [o, c] of stops) grad.addColorStop(o, c);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const q of pts.slice(1)) ctx.lineTo(q[0], q[1]);
    ctx.closePath();
    ctx.fill();
  };
  // top: brightest, sky with a sharp dark horizon low down
  face([[x0, y0], [x1, y0], [ax, ay]], (x0 + x1) / 2, y0, [[0, '#cfd6e1'], [0.22, '#f6f8fc'], [0.23, '#4a505c'], [0.4, '#8a919e'], [0.41, '#ffffff'], [1, '#e8edf4']]);
  // left: lit, a little darker
  face([[x0, y0], [ax, ay], [x0, y1]], x0, (y0 + y1) / 2, [[0, '#8f96a3'], [0.3, '#c6cdd8'], [0.31, '#353a44'], [0.48, '#6b7280'], [0.49, '#dfe4ec'], [1, '#aeb5c1']]);
  // right: in shade, one bright streak
  face([[x1, y0], [x1, y1], [ax, ay]], x1, (y0 + y1) / 2, [[0, '#0c0d11'], [0.36, '#23262e'], [0.37, '#9aa1ae'], [0.45, '#2c3039'], [1, '#5a606c']]);
  // bottom: darkest
  face([[x0, y1], [ax, ay], [x1, y1]], (x0 + x1) / 2, y1, [[0, '#050608'], [0.5, '#15171c'], [0.51, '#4b505b'], [0.6, '#16181d'], [1, joined ? '#2a2d35' : '#3b3f49']]);
  // the ridges: white up from the lit corner, dark down to the shaded one
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1, T * 0.018);
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(ax, ay);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath();
  ctx.moveTo(x1, y0);
  ctx.lineTo(ax, ay);
  ctx.moveTo(x0, y1);
  ctx.lineTo(ax, ay);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(ax, ay);
  ctx.stroke();
  // the point's glint
  const tip = ctx.createRadialGradient(ax, ay, 0, ax, ay, T * 0.1);
  tip.addColorStop(0, 'rgba(255,255,255,0.85)');
  tip.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = tip;
  ctx.fillRect(ax - T * 0.1, ay - T * 0.1, T * 0.2, T * 0.2);
}

// ---------------------------------------------------------------- the breakable blocks

/**
 * Black marble (the owner's pick, 27 November 2026: E1 of six marble sketches, after ten other ideas; speaker
 * cabinets came first): polished near-black stone, three fine white veins wandering across it in smooth curves,
 * a soft shine and a lit top edge. `variant` (0 to 3) gives neighbours different veins.
 */
export function drawMarble(ctx: Ctx, px: number, py: number, T: number, variant: number): void {
  const base = ctx.createLinearGradient(px, py, px + T, py + T);
  base.addColorStop(0, '#2a2a2f');
  base.addColorStop(1, '#0e0e11');
  ctx.fillStyle = base;
  ctx.fillRect(px, py, T, T);
  ctx.save();
  ctx.beginPath();
  ctx.rect(px, py, T, T);
  ctx.clip();
  ctx.strokeStyle = 'rgb(235,235,245)';
  ctx.lineWidth = Math.max(1, T * 0.016);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let k = 0; k < 3; k++) {
    const pts: number[][] = [];
    let y = py + T * (0.15 + 0.7 * hash(variant * 7 + k * 3.3 + 1));
    for (let st = 0; st <= 8; st++) {
      y += (hash(variant * 13 + k * 5 + st * 1.7 + 2) - 0.5) * T * 0.28;
      pts.push([px + (T * st) / 8, y]);
    }
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let m = 1; m < pts.length - 1; m++) ctx.quadraticCurveTo(pts[m][0], pts[m][1], (pts[m][0] + pts[m + 1][0]) / 2, (pts[m][1] + pts[m + 1][1]) / 2);
    ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    ctx.stroke();
  }
  ctx.restore();
  const sheen = ctx.createLinearGradient(px, py, px + T, py + T);
  sheen.addColorStop(0.18, 'rgba(255,255,255,0)');
  sheen.addColorStop(0.3, 'rgba(255,255,255,0.12)');
  sheen.addColorStop(0.4, 'rgba(255,255,255,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(px, py, T, T);
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.fillRect(px, py, T, T * 0.035);
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(px, py + T * 0.965, T, T * 0.035);
}

// ---------------------------------------------------------------- the dark

let shade: HTMLCanvasElement | null = null;
/** how fine the dark is drawn, against the screen's pixels: it is all soft edges, so half is plenty */
const SHADE_SCALE = 0.5;

/**
 * The dark over the arena (Blackout). Pitch black but for the flash (`flashLight`, the whole arena) and each
 * light (`lights`): a hole of light with a soft edge, a flashlight's a wide clear circle, a bomb's and a blast's
 * flickering a little. A flashlight also warms what it lights. The planes are drawn after this, over the dark.
 */
export function drawDark(ctx: Ctx, world: World, T: number, time: number): void {
  const dark = 1 - flashLight(world);
  if (dark <= 0.001) return;
  const m = ctx.getTransform();
  const q = Math.max(0.25, Math.hypot(m.a, m.b) * SHADE_SCALE);
  const W = world.w * T;
  const H = world.h * T;
  const cw = Math.ceil(W * q);
  const ch = Math.ceil(H * q);
  if (!shade) shade = document.createElement('canvas');
  if (shade.width !== cw || shade.height !== ch) {
    shade.width = cw;
    shade.height = ch;
  }
  const g = shade.getContext('2d')!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'copy';
  g.fillStyle = `rgba(0,0,0,${dark})`;
  g.fillRect(0, 0, cw, ch);
  g.globalCompositeOperation = 'destination-out';
  const ls = lights(world);
  ls.forEach((l, i) => {
    const torch = l.r >= 2.5;
    const flicker = torch ? 1 : 1 + 0.07 * Math.sin(time * 19 + i * 1.7) + 0.04 * Math.sin(time * 31 + i);
    const R = l.r * T * q * flicker;
    const x = (l.x + 0.5) * T * q;
    const y = (l.y + 0.5) * T * q;
    const grad = g.createRadialGradient(x, y, 0, x, y, R);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(torch ? 0.62 : 0.35, 'rgba(0,0,0,0.97)');
    grad.addColorStop(torch ? 0.86 : 0.7, 'rgba(0,0,0,0.45)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(x - R, y - R, R * 2, R * 2);
  });
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(shade, 0, 0, cw, ch, 0, 0, W, H);
  // a flashlight's light is a little warm
  ctx.globalCompositeOperation = 'lighter';
  for (const l of ls) {
    if (l.r < 2.5) continue;
    const x = (l.x + 0.5) * T;
    const y = (l.y + 0.5) * T;
    const R = l.r * T;
    const warm = ctx.createRadialGradient(x, y, 0, x, y, R);
    warm.addColorStop(0, `rgba(255,236,180,${0.14 * dark})`);
    warm.addColorStop(1, 'rgba(255,236,180,0)');
    ctx.fillStyle = warm;
    ctx.fillRect(x - R, y - R, R * 2, R * 2);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- the flashlight

/** A flashlight lying flat, lens to the right, with a little beam: for the power-up's tile and the Key. */
export function drawTorchIcon(ctx: Ctx, cx: number, cy: number, s: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.5);
  // the beam
  const beam = ctx.createLinearGradient(s * 0.2, 0, s * 0.95, 0);
  beam.addColorStop(0, 'rgba(255,244,200,0.85)');
  beam.addColorStop(1, 'rgba(255,244,200,0)');
  ctx.fillStyle = beam;
  ctx.beginPath();
  ctx.moveTo(s * 0.2, -s * 0.12);
  ctx.lineTo(s * 0.95, -s * 0.36);
  ctx.lineTo(s * 0.95, s * 0.36);
  ctx.lineTo(s * 0.2, s * 0.12);
  ctx.closePath();
  ctx.fill();
  // the body and the head
  const body = ctx.createLinearGradient(0, -s * 0.1, 0, s * 0.1);
  body.addColorStop(0, '#9aa0ad');
  body.addColorStop(0.5, '#2b2e36');
  body.addColorStop(1, '#14161b');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.roundRect(-s * 0.5, -s * 0.09, s * 0.52, s * 0.18, s * 0.04);
  ctx.fill();
  ctx.fillStyle = '#c8ccd6';
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.12);
  ctx.lineTo(s * 0.2, -s * 0.17);
  ctx.lineTo(s * 0.2, s * 0.17);
  ctx.lineTo(0, s * 0.12);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#fff6d0';
  ctx.fillRect(s * 0.18, -s * 0.15, s * 0.04, s * 0.3);
  ctx.fillStyle = '#ff3d8b'; // the switch
  ctx.fillRect(-s * 0.22, -s * 0.12, s * 0.08, s * 0.04);
  ctx.restore();
}
