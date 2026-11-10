/**
 * Everything that draws. Reads the world, never changes it.
 *
 * All the art is drawn with canvas shapes in code: there are no image files.
 * - drawRobot: one robot in any of the bot colours, facing any of four ways
 * - drawStatic: the floor and solid blocks (drawn once, then reused)
 * - drawDynamic: bricks, power-ups, bombs, blasts and robots (drawn every frame)
 * - drawItemIcon: the five power-up icons, also used by the top bar
 */
import { World, Dir, FLOOR, HARD, SOFT, FLAME_TICKS, DEATH_TICKS, ItemKind, Player, Bomb, FLY_TICKS_PER_TILE, THROW_TILES } from './sim';

export interface BotColor {
  /** saved with the player's choice and sent to the rules as Player.colorId */
  id: string;
  /** shown under the bot in the menu */
  name: string;
  /** the armour colour, with a lighter and a darker shade of it for shading */
  body: string;
  light: string;
  dark: string;
  /** the glowing trim on the helmet and boots, and the colour of this bot's bombs and blasts */
  glow: string;
}

/** Only these parts change between bots. The black parts are shared by all nine. */
export const COLORS: BotColor[] = [
  { id: 'gold', name: 'Gold', body: '#d6b068', light: '#f3dba0', dark: '#9c7a3a', glow: '#ffc56a' },
  { id: 'black', name: 'Black', body: '#31333c', light: '#555966', dark: '#1b1c22', glow: '#ffffff' },
  { id: 'pink', name: 'Pink', body: '#ff4fa6', light: '#ff9ccd', dark: '#c0206f', glow: '#ff5fd2' },
  { id: 'blue', name: 'Blue', body: '#3fb4f0', light: '#93dcff', dark: '#1b7fb8', glow: '#5fd6ff' },
  { id: 'red', name: 'Red', body: '#dc2130', light: '#ff6a70', dark: '#96101c', glow: '#ff4040' },
  { id: 'orange', name: 'Orange', body: '#f27c1c', light: '#ffb46a', dark: '#b3520a', glow: '#ff9a3c' },
  { id: 'white', name: 'White', body: '#eceef4', light: '#ffffff', dark: '#b4b8c6', glow: '#ffffff' },
  { id: 'green', name: 'Green', body: '#34d06a', light: '#8cf5ac', dark: '#16903f', glow: '#5cff8e' },
  { id: 'purple', name: 'Purple', body: '#8d5cf6', light: '#c2a6ff', dark: '#5a2fc0', glow: '#b48cff' },
];

/** The colour with this id, or gold if there is no such colour. */
export function colorById(id: string): BotColor {
  return COLORS.find((c) => c.id === id) ?? COLORS[0];
}

// the parts of every robot that stay black whatever its colour
const BLACK = '#0c0c11';
const BLACK_HI = '#262833';

type Ctx = CanvasRenderingContext2D;

/** Start a rounded-rectangle path. */
function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/**
 * Draw one robot. (x, y) is the point between its feet and `s` is one tile in
 * pixels. The robot is about 0.9 tiles wide and 1.06 tall, so it reads as
 * filling the tile it stands on.
 */
export function drawRobot(
  ctx: Ctx,
  x: number,
  y: number,
  s: number,
  c: BotColor,
  facing: Dir,
  walk: number,
  moving: boolean,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  const sw = moving ? Math.sin(walk) : 0;
  const bob = moving ? -Math.abs(Math.cos(walk)) * 0.02 : 0;

  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.38, 0.07, 0, 0, Math.PI * 2);
  ctx.fill();

  if (facing === 3) ctx.scale(-1, 1);
  const grad = ctx.createLinearGradient(-0.35, -0.48, 0.35, 0);
  grad.addColorStop(0, c.light);
  grad.addColorStop(0.45, c.body);
  grad.addColorStop(1, c.dark);

  const side = facing === 3 || facing === 4;
  const back = facing === 1;
  const HR = 0.34;
  const hy = -0.72 + bob; // head centre

  const boot = (bx: number, lift: number, w: number, fwd: number): void => {
    ctx.fillStyle = BLACK;
    rr(ctx, bx - w / 2 + fwd, -0.12 - lift, w, 0.12, 0.05);
    ctx.fill();
    ctx.fillStyle = BLACK_HI;
    rr(ctx, bx - w / 2 + fwd + 0.02, -0.11 - lift, w - 0.06, 0.03, 0.015);
    ctx.fill();
    ctx.save();
    ctx.shadowColor = c.glow;
    ctx.shadowBlur = s * 0.08;
    ctx.fillStyle = c.glow;
    rr(ctx, bx - w / 2 + fwd, -0.03 - lift, w, 0.03, 0.012);
    ctx.fill();
    ctx.restore();
  };
  const leg = (lx: number, lift: number): void => {
    ctx.fillStyle = grad;
    rr(ctx, lx - 0.09, -0.21, 0.18, 0.13 - lift, 0.03);
    ctx.fill();
  };
  const arm = (ax: number, ay: number, ex: number, ey: number): void => {
    ctx.lineCap = 'round';
    ctx.strokeStyle = grad;
    ctx.lineWidth = 0.14;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.strokeStyle = BLACK;
    ctx.lineWidth = 0.145;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(ax + (ex - ax) * 0.4, ay + (ey - ay) * 0.4);
    ctx.lineTo(ax + (ex - ax) * 0.62, ay + (ey - ay) * 0.62);
    ctx.stroke();
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(ex, ey + 0.03, 0.088, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = BLACK;
    rr(ctx, ex - 0.055, ey + 0.05, 0.11, 0.022, 0.01);
    ctx.fill();
  };

  if (side) {
    const stride = sw * 0.09;
    leg(-0.08 - stride, Math.max(0, -sw) * 0.04);
    boot(-0.08 - stride, Math.max(0, -sw) * 0.04, 0.28, 0.03);
    ctx.fillStyle = grad;
    rr(ctx, -0.22, -0.47 + bob, 0.44, 0.2, 0.08);
    ctx.fill();
    ctx.fillStyle = BLACK;
    ctx.fillRect(-0.2, -0.3 + bob, 0.4, 0.07);
    ctx.fillStyle = grad;
    rr(ctx, -0.21, -0.245 + bob, 0.42, 0.085, 0.03);
    ctx.fill();
    leg(0.08 + stride, Math.max(0, sw) * 0.04);
    boot(0.08 + stride, Math.max(0, sw) * 0.04, 0.28, 0.03);
    arm(0, -0.41 + bob, -stride * 1.3, -0.26 + bob);
  } else {
    for (const sg of [-1, 1]) {
      const lift = Math.max(0, sg * sw) * 0.045;
      leg(sg * 0.125, lift);
      boot(sg * 0.14, lift, 0.25, 0);
    }
    for (const sg of [-1, 1]) {
      arm(sg * 0.31, -0.41 + bob, sg * 0.37, -0.26 + bob - sg * sw * 0.03);
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-0.28, -0.48 + bob);
    ctx.lineTo(0.28, -0.48 + bob);
    ctx.lineTo(0.21, -0.28 + bob);
    ctx.lineTo(-0.21, -0.28 + bob);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = BLACK;
    ctx.fillRect(-0.21, -0.3 + bob, 0.42, 0.07);
    ctx.fillStyle = grad;
    rr(ctx, -0.22, -0.245 + bob, 0.44, 0.085, 0.03);
    ctx.fill();
  }

  // helmet
  const hx = side ? 0.03 : 0;
  const hg = ctx.createRadialGradient(hx - 0.11, hy - 0.15, 0.02, hx, hy, HR);
  hg.addColorStop(0, '#23252f');
  hg.addColorStop(0.6, '#0b0b10');
  hg.addColorStop(1, '#040406');
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.arc(hx, hy, HR, 0, Math.PI * 2);
  ctx.fill();

  const trim = (): void => {
    if (side) {
      ctx.moveTo(hx - 0.31, hy - 0.18);
      ctx.bezierCurveTo(hx - 0.28, hy + 0.13, hx - 0.04, hy + 0.31, hx + 0.37, hy + 0.19);
    } else if (back) {
      ctx.moveTo(-0.37, hy - 0.11);
      ctx.quadraticCurveTo(0, hy + 0.31, 0.37, hy - 0.11);
    } else {
      ctx.moveTo(-0.37, hy - 0.04);
      ctx.quadraticCurveTo(0, hy + 0.53, 0.37, hy - 0.04);
    }
  };
  ctx.save();
  ctx.beginPath();
  ctx.arc(hx, hy, HR, 0, Math.PI * 2);
  ctx.clip();
  const pg = ctx.createLinearGradient(-0.3, hy, 0.3, hy + 0.4);
  pg.addColorStop(0, c.light);
  pg.addColorStop(0.5, c.body);
  pg.addColorStop(1, c.dark);
  ctx.fillStyle = pg;
  ctx.beginPath();
  trim();
  if (side) {
    ctx.lineTo(hx + 0.5, hy + 0.6);
    ctx.lineTo(hx - 0.6, hy + 0.6);
    ctx.lineTo(hx - 0.6, hy - 0.5);
  } else {
    ctx.lineTo(0.5, hy + 0.6);
    ctx.lineTo(-0.5, hy + 0.6);
  }
  ctx.closePath();
  ctx.fill();
  ctx.shadowColor = c.glow;
  ctx.shadowBlur = s * 0.1;
  ctx.strokeStyle = c.glow;
  ctx.lineWidth = 0.03;
  ctx.lineCap = 'round';
  ctx.beginPath();
  trim();
  ctx.stroke();
  ctx.shadowBlur = 0;
  if (!back) {
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 0.045;
    ctx.beginPath();
    ctx.arc(hx, hy, HR - 0.09, -1.05, -0.3);
    ctx.stroke();
    if (!side) {
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 0.036;
      ctx.beginPath();
      ctx.arc(hx, hy, HR - 0.09, -2.45, -2.15);
      ctx.stroke();
    }
  }
  ctx.restore();
  ctx.restore();
}

// ---------------------------------------------------------------- arena

/** Solid block: fills its whole tile, raised bevel with a sunken square in the middle. */
function drawHard(ctx: Ctx, px: number, py: number, T: number): void {
  const e = Math.max(1, Math.round(T * 0.07));
  ctx.fillStyle = '#39456b';
  ctx.fillRect(px, py, T, T);
  ctx.fillStyle = '#6676a8'; // lit top and left edges
  ctx.fillRect(px, py, T, e);
  ctx.fillRect(px, py, e, T);
  ctx.fillStyle = '#1a2036'; // shaded bottom and right edges
  ctx.fillRect(px, py + T - e, T, e);
  ctx.fillRect(px + T - e, py, e, T);
  const i = Math.round(T * 0.26);
  const w = T - i * 2;
  ctx.fillStyle = '#1a2036';
  ctx.fillRect(px + i, py + i, w, w);
  ctx.fillStyle = '#2b3454';
  ctx.fillRect(px + i + e, py + i + e, w - e, w - e);
  ctx.fillStyle = '#6676a8';
  ctx.fillRect(px + i, py + i + w - e, w, e);
  ctx.fillRect(px + i + w - e, py + i, e, w);
}

/** Breakable block: fills its whole tile with four staggered courses of bricks. */
function drawSoft(ctx: Ctx, px: number, py: number, T: number): void {
  ctx.fillStyle = '#232a45'; // mortar
  ctx.fillRect(px, py, T, T);
  const rows = 4;
  const h = T / rows;
  const g = Math.max(1, Math.round(T * 0.045));
  for (let row = 0; row < rows; row++) {
    const y = Math.round(py + row * h);
    const bh = Math.round(py + (row + 1) * h) - y - g;
    const edges = row % 2 === 0 ? [0, 0.5, 1] : [0, 0.25, 0.75, 1];
    for (let k = 0; k < edges.length - 1; k++) {
      const x0 = Math.round(px + edges[k] * T);
      const x1 = Math.round(px + edges[k + 1] * T);
      const last = k === edges.length - 2;
      const bw = x1 - x0 - (last ? 0 : g);
      ctx.fillStyle = '#7383b6';
      ctx.fillRect(x0, y, bw, bh);
      ctx.fillStyle = '#9aa8d4';
      ctx.fillRect(x0, y, bw, Math.max(1, Math.round(g * 0.8)));
    }
  }
}

/** Floor and fixed walls. Redrawn only when the screen size changes. */
export function drawStatic(ctx: Ctx, world: World, T: number): void {
  for (let y = 0; y < world.h; y++) {
    for (let x = 0; x < world.w; x++) {
      const px = x * T;
      const py = y * T;
      ctx.fillStyle = '#0e1220';
      ctx.fillRect(px, py, T, T);
      // a few flecks so the floor is not dead flat
      ctx.fillStyle = 'rgba(120,150,255,0.06)';
      for (let k = 0; k < 5; k++) {
        const n = (x * 73 + y * 131 + k * 197) % 97;
        ctx.fillRect(px + ((n * 37) % 89) / 89 * T * 0.9, py + ((n * 53) % 83) / 83 * T * 0.9, T * 0.06, T * 0.06);
      }
      if (world.tiles[y * world.w + x] === HARD) drawHard(ctx, px, py, T);
    }
  }
}

const ITEM_COLOR: Record<ItemKind, string> = {
  bomb: '#5fd6ff',
  fire: '#ff8a3c',
  speed: '#6dff8a',
  kick: '#ffd84a',
  grab: '#d08cff',
};

/** Draw a power-up's icon centred on (cx, cy), about `r` pixels in radius, in its own colour unless one is given. */
export function drawItemIcon(ctx: Ctx, kind: ItemKind, cx: number, cy: number, r: number, color?: string): void {
  const col = color ?? ITEM_COLOR[kind];
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = col;
  ctx.strokeStyle = col;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (kind === 'bomb') {
    ctx.beginPath();
    ctx.arc(-r * 0.08, r * 0.12, r * 0.56, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = r * 0.2;
    ctx.beginPath();
    ctx.moveTo(r * 0.3, -r * 0.36);
    ctx.lineTo(r * 0.58, -r * 0.66);
    ctx.stroke();
  } else if (kind === 'fire') {
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.8);
    ctx.bezierCurveTo(r * 0.75, -r * 0.1, r * 0.6, r * 0.75, 0, r * 0.75);
    ctx.bezierCurveTo(-r * 0.6, r * 0.75, -r * 0.7, r * 0.1, -r * 0.3, -r * 0.2);
    ctx.bezierCurveTo(-r * 0.15, r * 0.05, 0.05 * r, -r * 0.3, 0, -r * 0.8);
    ctx.fill();
  } else if (kind === 'speed') {
    ctx.lineWidth = r * 0.28;
    for (const o of [-0.38, 0.22]) {
      ctx.beginPath();
      ctx.moveTo(r * (o - 0.22), -r * 0.5);
      ctx.lineTo(r * (o + 0.28), 0);
      ctx.lineTo(r * (o - 0.22), r * 0.5);
      ctx.stroke();
    }
  } else if (kind === 'kick') {
    // a boot
    ctx.lineWidth = r * 0.16;
    ctx.beginPath();
    ctx.moveTo(-r * 0.5, -r * 0.7);
    ctx.lineTo(-r * 0.02, -r * 0.7);
    ctx.lineTo(-r * 0.02, -r * 0.02);
    ctx.lineTo(r * 0.62, r * 0.2);
    ctx.lineTo(r * 0.62, r * 0.6);
    ctx.lineTo(-r * 0.5, r * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else {
    // a glove
    rr(ctx, -r * 0.5, -r * 0.72, r * 0.78, r * 1.1, r * 0.32);
    ctx.fill();
    rr(ctx, r * 0.2, -r * 0.2, r * 0.42, r * 0.56, r * 0.2);
    ctx.fill();
    rr(ctx, -r * 0.46, r * 0.5, r * 0.7, r * 0.26, r * 0.08);
    ctx.fill();
  }
  ctx.restore();
}

/** Stroke one straight line. */
function line(ctx: Ctx, x1: number, y1: number, x2: number, y2: number): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

/**
 * Everything that moves or changes, drawn every frame on top of the static
 * layer, back to front: shadows under blocks, power-ups, bricks, the ring on
 * the tile player `focusId` counts as standing on, bombs on the floor, blasts,
 * robots (those further down the screen in front), then carried and flying bombs.
 */
export function drawDynamic(ctx: Ctx, world: World, T: number, time: number, focusId = 0): void {
  // every block casts a strip of shadow onto the floor below it
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  for (let y = 0; y < world.h - 1; y++) {
    for (let x = 0; x < world.w; x++) {
      if (world.tiles[y * world.w + x] !== FLOOR && world.tiles[(y + 1) * world.w + x] === FLOOR) {
        ctx.fillRect(x * T, (y + 1) * T, T, Math.round(T * 0.16));
      }
    }
  }

  // power-ups: a full tile of solid colour that pulses, with a dark icon
  for (const it of world.items) {
    const pop = Math.min(1, it.age / 8);
    const m = T * 0.04 + (T * 0.46) * (1 - pop);
    const px = it.cx * T + m;
    const py = it.cy * T + m;
    const size = T - m * 2;
    const pulse = 0.5 + 0.5 * Math.sin(time * 6 + it.cx + it.cy);
    ctx.fillStyle = ITEM_COLOR[it.kind];
    rr(ctx, px, py, size, size, T * 0.1);
    ctx.fill();
    ctx.fillStyle = `rgba(255,255,255,${0.05 + 0.4 * pulse})`;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = Math.max(1, T * 0.04);
    ctx.stroke();
    drawItemIcon(ctx, it.kind, (it.cx + 0.5) * T, (it.cy + 0.5) * T, size * 0.36, '#0b0e18');
  }

  // breakable blocks (burning ones flash and shrink)
  for (let y = 0; y < world.h; y++) {
    for (let x = 0; x < world.w; x++) {
      if (world.tiles[y * world.w + x] === SOFT) drawSoft(ctx, x * T, y * T, T);
    }
  }
  for (const b of world.burning) {
    const k = b.ttl / FLAME_TICKS;
    ctx.fillStyle = `rgba(255,240,210,${0.25 + 0.6 * k})`;
    ctx.fillRect(b.cx * T, b.cy * T, T, T);
  }

  // the tile you count as standing on
  const me = world.players[focusId];
  if (me && me.alive) {
    const g = colorById(me.colorId).glow;
    const m = T * 0.05;
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = g;
    ctx.lineWidth = Math.max(1.5, T * 0.05);
    rr(ctx, Math.round(me.x) * T + m, Math.round(me.y) * T + m, T - 2 * m, T - 2 * m, T * 0.14);
    ctx.stroke();
    ctx.restore();
  }

  // bombs on the floor
  for (const b of world.bombs) {
    if (b.state === 'ground') drawBomb(ctx, world, b, (b.x + 0.5) * T, (b.y + 0.5) * T, T, true);
  }

  // blasts, in the colour of whoever placed the bomb
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const pass of [0, 1, 2]) {
    for (const f of world.flames) {
      const col = colorById(world.players[f.owner]?.colorId ?? 'gold');
      const t = f.ttl / FLAME_TICKS;
      const k = Math.sqrt(t > 0.8 ? (1 - t) / 0.2 : t / 0.8);
      const width = T * [0.92, 0.62, 0.3][pass] * k;
      if (width < 0.5) continue;
      ctx.strokeStyle = pass === 2 ? '#ffffff' : col.glow;
      ctx.globalAlpha = [0.3, 0.75, 0.95][pass];
      ctx.lineWidth = width;
      const cx = (f.cx + 0.5) * T;
      const cy = (f.cy + 0.5) * T;
      const h = T / 2;
      ctx.lineCap = 'butt';
      if (f.kind === 'c') {
        ctx.lineCap = 'round';
        line(ctx, cx - h * 0.2, cy, cx + h * 0.2, cy);
        line(ctx, cx, cy - h * 0.2, cx, cy + h * 0.2);
      } else if (f.tip) {
        ctx.lineCap = 'round';
        const reach = 0.25;
        if (f.tip === 4) line(ctx, cx - h, cy, cx + h * reach, cy);
        else if (f.tip === 3) line(ctx, cx + h, cy, cx - h * reach, cy);
        else if (f.tip === 2) line(ctx, cx, cy - h, cx, cy + h * reach);
        else line(ctx, cx, cy + h, cx, cy - h * reach);
      } else if (f.kind === 'h') line(ctx, cx - h, cy, cx + h, cy);
      else line(ctx, cx, cy - h, cx, cy + h);
    }
  }
  ctx.restore();

  // robots, back to front
  const order = [...world.players].sort((a, b) => a.y - b.y);
  for (const p of order) drawPlayer(ctx, p, T);

  // carried and flying bombs go on top
  for (const b of world.bombs) {
    const gx = (b.x + 0.5) * T;
    const gy = (b.y + 0.5) * T;
    if (b.state === 'held') drawBomb(ctx, world, b, gx, gy - T * 0.98, T, false);
    else if (b.state === 'air') {
      const p = b.flyT / FLY_TICKS_PER_TILE;
      const h = p < THROW_TILES ? Math.sin((Math.PI * p) / THROW_TILES) * 0.9 : Math.abs(Math.sin(Math.PI * (p - THROW_TILES))) * 0.4;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(gx, gy + T * 0.3, T * 0.26, T * 0.09, 0, 0, Math.PI * 2);
      ctx.fill();
      drawBomb(ctx, world, b, gx, gy - T * (0.25 + h), T, false);
    }
  }
}

/** A bomb: a dark ball with a glowing arc and spark in its owner's colour, pulsing faster when about to go off. */
function drawBomb(ctx: Ctx, world: World, b: Bomb, cx: number, cy: number, T: number, shadow: boolean): void {
  const col = colorById(world.players[b.owner]?.colorId ?? 'gold');
  const urgent = b.fuse < 45;
  const pulse = 1 + 0.07 * Math.sin(b.age * (urgent ? 0.6 : 0.22));
  const r = T * 0.34 * pulse;
  if (shadow) {
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + T * 0.3, r * 0.9, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.05, cx, cy, r);
  g.addColorStop(0, '#3a3d4c');
  g.addColorStop(0.5, '#101117');
  g.addColorStop(1, '#030304');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.shadowColor = col.glow;
  ctx.shadowBlur = T * 0.3;
  ctx.strokeStyle = col.glow;
  ctx.lineWidth = Math.max(1.5, T * 0.06);
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.62, Math.PI * 0.15, Math.PI * 0.85);
  ctx.stroke();
  ctx.fillStyle = urgent && b.age % 8 < 4 ? '#ffffff' : col.glow;
  ctx.beginPath();
  ctx.arc(cx, cy - r * 0.98, T * 0.07, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A robot on its tile, or fading upward for a moment after being knocked out. */
function drawPlayer(ctx: Ctx, p: Player, T: number): void {
  const col = colorById(p.colorId);
  const x = (p.x + 0.5) * T;
  const y = (p.y + 0.5) * T + T * 0.46;
  if (p.alive) {
    drawRobot(ctx, x, y, T, col, p.facing, p.walk, p.moving);
    return;
  }
  if (p.deadTicks >= DEATH_TICKS) return;
  const k = p.deadTicks / DEATH_TICKS;
  ctx.save();
  ctx.globalAlpha = 1 - k;
  drawRobot(ctx, x, y - k * T * 0.5, T * (1 + k * 0.5), col, p.facing, 0, false);
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = col.glow;
  ctx.globalAlpha = (1 - k) * 0.6;
  ctx.beginPath();
  ctx.arc(x, y - T * 0.5, T * (0.3 + k * 0.9), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
