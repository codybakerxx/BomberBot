/**
 * Blackout, drawn (the owner's design, 27 November 2026: a pitch black map, a flash of light now and then, a
 * flashlight power-up; black and white tiles, solid blocks as triangular chrome spikes, reflective like a mirror,
 * a punk rock look). Reads the world, never changes it; render.ts calls these:
 * - drawCheck, drawSpike, drawSpeaker: one tile of floor (black and white checks), a solid block (a chrome spike
 *   on a studded black plate), a breakable block (a battered speaker cabinet with studs, tape and stickers)
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
 * A chrome spike: a tall three-sided pyramid seen a little from the front, standing on a studded black plate.
 * Mirror chrome is hard-edged bands of near white and near black (it reflects the checks and the dark), so each
 * face is a gradient with sharp stops, the lit face light, the shaded face dark, a hot white edge down the ridge.
 */
export function drawSpike(ctx: Ctx, px: number, py: number, T: number, joined: boolean, deco: number): void {
  // the plate
  ctx.fillStyle = '#0b0b0e';
  ctx.fillRect(px, py, T, T);
  ctx.fillStyle = '#1d1d23';
  ctx.fillRect(px + T * 0.05, py + T * 0.05, T * 0.9, T * 0.9);
  // studs round the plate
  for (const [sx, sy] of [[0.13, 0.13], [0.87, 0.13], [0.13, 0.87], [0.87, 0.87]]) {
    const g = ctx.createRadialGradient(px + sx * T - T * 0.015, py + sy * T - T * 0.015, 0, px + sx * T, py + sy * T, T * 0.05);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.4, '#9a9aa6');
    g.addColorStop(1, '#25252c');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px + sx * T, py + sy * T, T * 0.045, 0, Math.PI * 2);
    ctx.fill();
  }
  // the pyramid: apex near the top of the tile, base along the lower part, a little to one side for a front face
  const lean = (deco - 0.5) * 0.06; // (each spike leans a hair differently)
  const ax = px + T * (0.5 + lean);
  const ay = py + T * (joined ? 0.04 : -0.06);
  const bl = [px + T * 0.12, py + T * 0.84];
  const br = [px + T * 0.88, py + T * 0.84];
  const bf = [px + T * (0.56 + lean * 0.5), py + T * 0.96]; // the front corner of the base
  // shadow on the plate
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.ellipse(px + T * 0.55, py + T * 0.88, T * 0.42, T * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  // left face: lit, bands of sky and checks
  const left = ctx.createLinearGradient(bl[0], bl[1], ax, ay);
  for (const [o, c] of [[0, '#23262e'], [0.3, '#4c5260'], [0.31, '#f2f5fa'], [0.5, '#bcc4d1'], [0.72, '#ffffff'], [1, '#dfe5ee']] as [number, string][]) left.addColorStop(o, c);
  ctx.fillStyle = left;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bl[0], bl[1]);
  ctx.lineTo(bf[0], bf[1]);
  ctx.closePath();
  ctx.fill();
  // right face: in shade, darker bands with one sharp highlight
  const right = ctx.createLinearGradient(br[0], br[1], ax, ay);
  for (const [o, c] of [[0, '#06070a'], [0.32, '#15171c'], [0.33, '#6f7584'], [0.41, '#1a1c22'], [0.78, '#383c46'], [1, '#9298a5']] as [number, string][]) right.addColorStop(o, c);
  ctx.fillStyle = right;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bf[0], bf[1]);
  ctx.lineTo(br[0], br[1]);
  ctx.closePath();
  ctx.fill();
  // the hot edge down the front ridge, and a glint at the tip
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = Math.max(1, T * 0.022);
  ctx.beginPath();
  ctx.moveTo(ax, ay + T * 0.02);
  ctx.lineTo(bf[0], bf[1] - T * 0.02);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = Math.max(1, T * 0.012);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bl[0], bl[1]);
  ctx.lineTo(bf[0], bf[1]);
  ctx.lineTo(br[0], br[1]);
  ctx.closePath();
  ctx.stroke();
  const tip = ctx.createRadialGradient(ax, ay + T * 0.05, 0, ax, ay + T * 0.05, T * 0.12);
  tip.addColorStop(0, 'rgba(255,255,255,0.9)');
  tip.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = tip;
  ctx.fillRect(ax - T * 0.12, ay - T * 0.07, T * 0.24, T * 0.24);
}

// ---------------------------------------------------------------- the breakable blocks

const STICKERS = ['#ff3d8b', '#d7ff3a', '#3de1ff', '#ffffff'];

/** A battered speaker cabinet: black tolex, a studded edge, a grille with one big cone, gaffer tape, a sticker. */
export function drawSpeaker(ctx: Ctx, px: number, py: number, T: number, variant: number): void {
  const e = T * 0.06;
  ctx.fillStyle = '#121214';
  ctx.fillRect(px, py, T, T);
  // lit top edge and shaded bottom, like the other maps' blocks
  ctx.fillStyle = '#2c2c32';
  ctx.fillRect(px, py, T, e);
  ctx.fillStyle = '#050506';
  ctx.fillRect(px, py + T - e, T, e);
  // the grille
  const gx = px + T * 0.14;
  const gy = py + T * 0.16;
  const gw = T * 0.72;
  const gh = T * 0.66;
  ctx.fillStyle = '#1f1f24';
  ctx.fillRect(gx, gy, gw, gh);
  ctx.strokeStyle = 'rgba(160,160,175,0.16)';
  ctx.lineWidth = Math.max(1, T * 0.01);
  ctx.beginPath();
  for (let k = 1; k < 9; k++) {
    ctx.moveTo(gx + (gw * k) / 9, gy);
    ctx.lineTo(gx + (gw * k) / 9, gy + gh);
  }
  ctx.stroke();
  // the cone
  const cx = gx + gw / 2;
  const cy = gy + gh / 2;
  const cone = ctx.createRadialGradient(cx - T * 0.04, cy - T * 0.05, T * 0.02, cx, cy, T * 0.25);
  cone.addColorStop(0, '#55555e');
  cone.addColorStop(0.25, '#1a1a1e');
  cone.addColorStop(0.8, '#2a2a30');
  cone.addColorStop(1, '#0a0a0c');
  ctx.fillStyle = cone;
  ctx.beginPath();
  ctx.arc(cx, cy, T * 0.24, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#6d6d78';
  ctx.lineWidth = Math.max(1, T * 0.02);
  ctx.stroke();
  ctx.fillStyle = '#7a7a86';
  ctx.beginPath();
  ctx.arc(cx, cy, T * 0.05, 0, Math.PI * 2);
  ctx.fill();
  // studs along the top and bottom edges
  for (let k = 0; k < 6; k++) {
    for (const sy of [py + T * 0.08, py + T * 0.9]) {
      const sx = px + T * (0.1 + k * 0.16);
      const g = ctx.createRadialGradient(sx - T * 0.01, sy - T * 0.01, 0, sx, sy, T * 0.035);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.5, '#a3a3ae');
      g.addColorStop(1, '#303036');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sx, sy, T * 0.03, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // gaffer tape across a corner, and a sticker: a bolt, a star, a pin or a stripe, by variant
  ctx.save();
  ctx.translate(px + T * (variant & 1 ? 0.78 : 0.22), py + T * 0.24);
  ctx.rotate(variant & 1 ? 0.7 : -0.7);
  ctx.fillStyle = 'rgba(150,150,140,0.75)';
  ctx.fillRect(-T * 0.2, -T * 0.05, T * 0.4, T * 0.1);
  ctx.restore();
  const col = STICKERS[variant & 3];
  const sx = px + T * (variant & 2 ? 0.27 : 0.73);
  const sy = py + T * 0.7;
  ctx.fillStyle = col;
  ctx.strokeStyle = '#0a0a0a';
  ctx.lineWidth = Math.max(1, T * 0.012);
  ctx.beginPath();
  if ((variant & 3) === 0) {
    // a lightning bolt
    ctx.moveTo(sx + T * 0.02, sy - T * 0.12);
    ctx.lineTo(sx - T * 0.06, sy + T * 0.01);
    ctx.lineTo(sx, sy + T * 0.01);
    ctx.lineTo(sx - T * 0.03, sy + T * 0.12);
    ctx.lineTo(sx + T * 0.07, sy - T * 0.02);
    ctx.lineTo(sx + T * 0.01, sy - T * 0.02);
    ctx.closePath();
  } else if ((variant & 3) === 1) {
    // a star
    for (let k = 0; k < 10; k++) {
      const r = k % 2 ? T * 0.04 : T * 0.09;
      const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
      if (k) ctx.lineTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r);
      else ctx.moveTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r);
    }
    ctx.closePath();
  } else if ((variant & 3) === 2) {
    // a safety pin
    ctx.ellipse(sx, sy, T * 0.1, T * 0.03, -0.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(sx + T * 0.08, sy - T * 0.05, T * 0.025, 0, Math.PI * 2);
  } else {
    // a striped sticker
    ctx.rect(sx - T * 0.09, sy - T * 0.05, T * 0.18, T * 0.1);
  }
  ctx.fill();
  ctx.stroke();
  if ((variant & 3) === 3) {
    ctx.fillStyle = '#ff3d8b';
    for (let k = 0; k < 3; k++) ctx.fillRect(sx - T * 0.09 + k * T * 0.07, sy - T * 0.05, T * 0.035, T * 0.1);
  }
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
