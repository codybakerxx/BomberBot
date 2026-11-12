/**
 * Everything that draws. Reads the world, never changes it.
 *
 * All the art is drawn with canvas shapes in code: there are no image files.
 * - the robots themselves are in robot.ts (drawRobot, drawHead)
 * - drawStatic: the floor and solid blocks (drawn once, then reused)
 * - drawDynamic: bricks, power-ups, bombs, blasts and robots (drawn every frame)
 * - drawItemIcon: the seven power-up icons, also used by the top bar
 */
import { drawRobot, warmRobots, GHOST_ARMS, ROBOT, type Pose, type Wanted } from './robot';
import { World, FLOOR, HARD, SOFT, FLAME_TICKS, DEATH_TICKS, GHOST_TICKS, SHIELD_GRACE_TICKS, FALL_TICKS, TICK_HZ, ItemKind, Player, Bomb, FLY_TICKS_PER_TILE, THROW_TILES } from './sim';

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

type Ctx = CanvasRenderingContext2D;

/** Start a rounded-rectangle path. */
function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/*
 * The robot itself is drawn in robot.ts: drawRobot, drawHead, and the ways it
 * can be posed. They are handed on from here so that the rest of the game
 * still finds all the drawing in one place.
 */
export { drawRobot, drawHead, ROBOT, type Pose } from './robot';


/** What a robot burnt to a crisp is drawn in. */
const CHARRED: BotColor = { id: 'charred', name: '', body: '#17171a', light: '#34343c', dark: '#060607', glow: '#3d3d46' };
/** The colours of a missing player's place on the scoreboard. */
export const NOBODY: BotColor = { id: 'nobody', name: '', body: '#4a4f5c', light: '#666c7c', dark: '#30333d', glow: '#767c8e' };

/** A colour part of the way from one hex colour to another. */
function mix(a: string, b: string, k: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number): number => Math.round(((pa >> shift) & 255) + (((pb >> shift) & 255) - ((pa >> shift) & 255)) * k);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

const ghosts = new Map<string, BotColor>();
/** A robot's colours washed out toward white: what its ghost is drawn in. */
function ghostOf(c: BotColor): BotColor {
  let g = ghosts.get(c.id);
  if (!g) {
    g = { id: c.id, name: c.name, body: mix(c.body, '#ffffff', 0.55), light: mix(c.light, '#ffffff', 0.6), dark: mix(c.dark, '#ffffff', 0.45), glow: mix(c.glow, '#ffffff', 0.5) };
    ghosts.set(c.id, g);
  }
  return g;
}

/** A number from 0 to 1 that is always the same for the same `n`: for scattering ash without a random generator. */
function scatter(n: number): number {
  const v = Math.sin(n * 12.9898) * 43758.5453;
  return v - Math.floor(v);
}

/**
 * The winner's celebration, `t` seconds after the round was decided: a jump
 * with one arm in the air, then a dance (bouncing from side to side, pumping
 * each arm in turn).
 */
export function winPose(t: number): Pose {
  const JUMP = 0.7;
  if (t < JUMP) return { jump: Math.sin((Math.PI * t) / JUMP) * 0.5, arms: [0, 1] };
  const beat = (t - JUMP) * 7.5;
  const s = Math.sin(beat);
  return { jump: Math.abs(s) * 0.1, lean: s * 0.14, arms: [0.5 + 0.5 * s, 0.5 - 0.5 * s] };
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
  shield: '#f1f5ff',
  curse: '#ff4063',
};
/** A power-up lying on the floor is this share of a tile across (it was 0.92; made 10% smaller). */
const ITEM_SIZE = 0.83;
/** How far it bobs, as a share of a tile, and how fast (2.2 gives one slow bob about every 3 seconds). */
const ITEM_BOB = 0.05;
const ITEM_BOB_RATE = 2.2;
/** the dark colour icons are drawn in on a power-up tile */
const ICON_DARK = '#0b0e18';

/** Draw a power-up's icon centred on (cx, cy), about `r` pixels in radius, in its own colour unless one is given. */
export function drawItemIcon(ctx: Ctx, kind: ItemKind, cx: number, cy: number, r: number, color?: string): void {
  const col = color ?? ITEM_COLOR[kind];
  // for details cut into an icon: dark on a light icon, the power-up's colour on a dark one
  const hole = col === ICON_DARK ? ITEM_COLOR[kind] : ICON_DARK;
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
  } else if (kind === 'shield') {
    // a shield: flat top, pointed foot, with a cross on it
    ctx.beginPath();
    ctx.moveTo(-r * 0.66, -r * 0.7);
    ctx.lineTo(r * 0.66, -r * 0.7);
    ctx.lineTo(r * 0.66, -r * 0.05);
    ctx.quadraticCurveTo(r * 0.6, r * 0.55, 0, r * 0.84);
    ctx.quadraticCurveTo(-r * 0.6, r * 0.55, -r * 0.66, -r * 0.05);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = hole;
    ctx.lineWidth = r * 0.16;
    line(ctx, 0, -r * 0.44, 0, r * 0.48);
    line(ctx, -r * 0.36, -r * 0.16, r * 0.36, -r * 0.16);
  } else if (kind === 'curse') {
    // a skull: round head, square jaw, two eyes and two gaps between teeth
    ctx.beginPath();
    ctx.arc(0, -r * 0.16, r * 0.62, 0, Math.PI * 2);
    ctx.fill();
    rr(ctx, -r * 0.36, r * 0.18, r * 0.72, r * 0.56, r * 0.12);
    ctx.fill();
    ctx.fillStyle = hole;
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(sx * r * 0.25, -r * 0.16, r * 0.17, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = hole;
    ctx.lineWidth = r * 0.1;
    ctx.lineCap = 'butt';
    line(ctx, -r * 0.12, r * 0.44, -r * 0.12, r * 0.74);
    line(ctx, r * 0.12, r * 0.44, r * 0.12, r * 0.74);
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
export function drawDynamic(ctx: Ctx, world: World, T: number, time: number, focusId = 0, celebrate?: Celebration, crowned = -1): void {
  // every block casts a strip of shadow onto the floor below it
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  for (let y = 0; y < world.h - 1; y++) {
    for (let x = 0; x < world.w; x++) {
      if (world.tiles[y * world.w + x] !== FLOOR && world.tiles[(y + 1) * world.w + x] === FLOOR) {
        ctx.fillRect(x * T, (y + 1) * T, T, Math.round(T * 0.16));
      }
    }
  }

  // power-ups: a square of solid colour that pulses, with a dark icon. It is a little smaller
  // than its tile and hovers: it bobs slowly up and down over a shadow that stays on the floor.
  for (const it of world.items) {
    const pop = Math.min(1, it.age / 8);
    const m = (T * (1 - ITEM_SIZE)) / 2 + ((T * ITEM_SIZE) / 2) * (1 - pop);
    const size = T - m * 2;
    // each one bobs out of step with its neighbours; `lift` runs from 0 (lowest) to 1 (highest)
    const lift = 0.5 + 0.5 * Math.sin(time * ITEM_BOB_RATE + it.cx * 1.7 + it.cy * 2.3);
    const px = it.cx * T + m;
    const py = it.cy * T + m - T * ITEM_BOB * (lift * 2 - 0.4);
    ctx.fillStyle = `rgba(0,0,0,${0.34 - 0.14 * lift})`;
    ctx.beginPath();
    ctx.ellipse((it.cx + 0.5) * T, (it.cy + 1) * T - T * 0.07, size * (0.44 - 0.07 * lift), T * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
    const pulse = 0.5 + 0.5 * Math.sin(time * 6 + it.cx + it.cy);
    ctx.fillStyle = ITEM_COLOR[it.kind];
    rr(ctx, px, py, size, size, T * 0.1);
    ctx.fill();
    ctx.fillStyle = `rgba(255,255,255,${0.05 + 0.4 * pulse})`;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = Math.max(1, T * 0.04);
    ctx.stroke();
    drawItemIcon(ctx, it.kind, px + size / 2, py + size / 2, size * 0.36, ICON_DARK);
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

  // where a block is about to land: a shadow that darkens and fills the tile as the block comes down
  for (const f of world.falling) {
    const e = 1 - Math.max(0, f.landAt - world.tick) / FALL_TICKS; // 0 as it starts to fall, 1 as it lands
    const m = T * 0.3 * (1 - e);
    ctx.fillStyle = `rgba(0,0,0,${0.25 + 0.45 * e})`;
    rr(ctx, f.cx * T + m, f.cy * T + m, T - m * 2, T - m * 2, T * 0.12);
    ctx.fill();
    ctx.strokeStyle = `rgba(255,90,110,${0.35 + 0.5 * e})`;
    ctx.lineWidth = Math.max(1, T * 0.05);
    ctx.strokeRect(f.cx * T + 1, f.cy * T + 1, T - 2, T - 2);
  }

  // robots, back to front
  const order = [...world.players].sort((a, b) => a.y - b.y);
  for (const p of order) drawPlayer(ctx, world, p, T, celebrate, crowned);

  // carried and flying bombs go on top
  for (const b of world.bombs) {
    const gx = (b.x + 0.5) * T;
    const gy = (b.y + 0.5) * T;
    if (b.state === 'held') drawBomb(ctx, world, b, gx, gy + T * (0.46 + ROBOT.top - 0.09), T, false); // just over the helmet of the robot carrying it
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

  // the falling blocks themselves, over everything: larger while high up, speeding up as they drop
  for (const f of world.falling) {
    const e = 1 - Math.max(0, f.landAt - world.tick) / FALL_TICKS;
    const high = 1 - e * e; // 1 at the top, 0 on the floor
    const size = T * (1 + 0.3 * high);
    const px = f.cx * T - (size - T) / 2;
    const py = f.cy * T - (size - T) / 2 - high * T * 2.4;
    ctx.save();
    ctx.globalAlpha = Math.min(1, 0.35 + e * 1.3);
    drawHard(ctx, px, py, size);
    ctx.restore();
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

/**
 * What a robot is under, drawn over it so everyone can see: a ring while it
 * has a shield (blinking for the last 5 seconds), a ring flying outward when
 * the shield takes a blast, and a small skull over its head while cursed
 * (blinking for the last 2 seconds).
 */
function drawStatus(ctx: Ctx, p: Player, cx: number, cy: number, T: number): void {
  const shield = ITEM_COLOR.shield;
  // the shield is a ring round the whole robot, from its feet to the top of its helmet
  const feet = cy + T * 0.46;
  const ringY = feet + ROBOT.midY * T;
  const ringR = (-ROBOT.top / 2 + 0.05) * T;
  if (p.shieldTicks > 0 && (p.shieldTicks > 5 * TICK_HZ || p.shieldTicks % 16 < 10)) {
    const pulse = 0.5 + 0.5 * Math.sin(p.shieldTicks * 0.2);
    ctx.save();
    ctx.shadowColor = '#8fd0ff';
    ctx.shadowBlur = T * 0.3;
    ctx.strokeStyle = shield;
    ctx.globalAlpha = 0.6 + 0.35 * pulse;
    ctx.lineWidth = Math.max(2, T * 0.07);
    ctx.beginPath();
    ctx.arc(cx, ringY, ringR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.1 + 0.06 * pulse;
    ctx.fillStyle = shield;
    ctx.fill();
    ctx.restore();
  }
  if (p.graceTicks > 0) {
    const k = 1 - p.graceTicks / SHIELD_GRACE_TICKS;
    ctx.save();
    ctx.strokeStyle = shield;
    ctx.globalAlpha = 1 - k;
    ctx.lineWidth = Math.max(2, T * 0.1 * (1 - k));
    ctx.beginPath();
    ctx.arc(cx, ringY, ringR + T * k * 0.7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  if (p.curseTicks > 0 && (p.curseTicks > 2 * TICK_HZ || p.curseTicks % 16 < 10)) {
    const bob = Math.sin(p.curseTicks * 0.15) * T * 0.04;
    const r = T * 0.2;
    const iy = feet + (ROBOT.top - 0.17) * T + bob; // just over the top of the helmet
    ctx.save();
    ctx.fillStyle = 'rgba(11,14,24,0.75)';
    ctx.beginPath();
    ctx.arc(cx, iy, r * 1.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    drawItemIcon(ctx, 'curse', cx, iy, r);
  }
}

/**
 * Get the robots' pictures ready a little ahead of when they are needed (see
 * warmRobots in robot.ts): everyone's walk in all four directions, the burnt
 * robot, each ghost, and the winner's dance once there is a winner. Call it
 * once a frame; it works for at most `ms` thousandths of a second each time.
 */
export function warmSprites(ctx: Ctx, world: World, T: number, ms = 4): void {
  const wanted: Wanted[] = world.players.map((p) => ({ c: colorById(p.colorId), kind: 'walk' as const }));
  wanted.push({ c: CHARRED, kind: 'burnt' });
  for (const p of world.players) wanted.push({ c: ghostOf(colorById(p.colorId)), kind: 'ghost' });
  if (world.over && world.over.winner >= 0) wanted.push({ c: colorById(world.players[world.over.winner].colorId), kind: 'dance' });
  warmRobots(ctx, T, wanted, ms);
}

/** The winner of a round, and how many seconds ago it was decided. */
export interface Celebration {
  player: number;
  t: number;
}

// the knocked-out animation, in ticks out of DEATH_TICKS
const CRISP_HOLD = 26; // the burnt robot stands this long before it starts to go
const CRISP_FADE = 34; // and takes this long to crumble away
const GHOST_FROM = 8; // the ghost starts to rise
const GHOST_SPEED = 0.075; // how fast it floats up once it is under way, in tiles a tick (4.5 tiles a second)
const GHOST_EASE = 18; // it takes about this many ticks to get up to that speed
const GHOST_FADE = 2.5; // it fades over the last few tiles before its head reaches the top of the screen
const ASH = 18; // specks of ash

/** A robot on its tile; the winner celebrating; or, for a moment after being knocked out, its remains and its ghost. */
function drawPlayer(ctx: Ctx, world: World, p: Player, T: number, celebrate?: Celebration, crowned = -1): void {
  const col = colorById(p.colorId);
  const x = (p.x + 0.5) * T;
  const y = (p.y + 0.5) * T + T * 0.46;
  if (p.alive) {
    if (celebrate && celebrate.player === p.id) {
      // the winner: facing the viewer, jumping and then dancing
      drawRobot(ctx, x, y, T, col, 2, 0, false, { ...winPose(celebrate.t), crown: crowned === p.id });
    } else drawRobot(ctx, x, y, T, col, p.facing, p.walk, p.moving, crowned === p.id ? { crown: true } : undefined);
    drawStatus(ctx, p, x, (p.y + 0.5) * T, T);
    return;
  }
  const t = p.deadTicks;
  if (t >= DEATH_TICKS) return;
  // Knocked out. Two things happen at once: what is left of the robot, burnt black with crosses for
  // eyes, crumbles to ash that drifts up and away; and a pale ghost of it floats up off the screen.
  // The ghost leaves the arena, so it is drawn by drawGhosts on a layer of its own.
  // (Under a fallen block there is nothing left to see, so only the ghost.)
  const crushed = world.tiles[Math.round(p.y) * world.w + Math.round(p.x)] === HARD;
  if (!crushed) {
    if (t < 10) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = col.glow;
      ctx.globalAlpha = (1 - t / 10) * 0.7;
      ctx.beginPath();
      ctx.arc(x, y - T * 0.5, T * (0.35 + t * 0.05), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    const left = t < CRISP_HOLD ? 1 : Math.max(0, 1 - (t - CRISP_HOLD) / CRISP_FADE);
    if (left > 0) {
      ctx.save();
      ctx.globalAlpha = left;
      drawRobot(ctx, x, y, T, CHARRED, p.facing, 0, false, { xEyes: true, shrink: 0.9 + 0.1 * left });
      ctx.restore();
    }
    for (let i = 0; i < ASH; i++) {
      const n = p.id * 97 + i * 13;
      const age = t - (6 + scatter(n) * 34);
      const life = 34 + scatter(n + 1) * 22;
      if (age < 0 || age > life) continue;
      const k = age / life;
      const side = scatter(n + 2) - 0.5;
      const px = x + side * T * (0.55 + 0.5 * k) + Math.sin(age * 0.13 + scatter(n + 3) * 6) * T * 0.07;
      const py = y - T * (0.08 + scatter(n + 4) * 0.8) - k * T * (0.45 + scatter(n + 5) * 0.6);
      const size = T * (0.045 + scatter(n + 6) * 0.05) * (1 - k * 0.5);
      ctx.globalAlpha = (1 - k) * 0.9;
      ctx.fillStyle = i % 6 === 0 ? col.glow : i % 2 ? '#131316' : '#2d2d35'; // mostly ash, the odd ember
      ctx.fillRect(px - size / 2, py - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
  }
}

/**
 * A ghost's two angel wings, drawn before the ghost so they are behind it.
 * (x, y) is the ghost's feet and `s` its size, as for drawRobot. `beat` goes up
 * steadily; the wings flap slowly with it.
 */
function drawWings(ctx: Ctx, x: number, y: number, s: number, beat: number): void {
  const flap = Math.sin(beat) * 0.2;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.lineJoin = 'round';
  for (const dir of [1, -1]) {
    ctx.save();
    ctx.scale(dir, 1);
    ctx.translate(ROBOT.shoulderX * 0.6, ROBOT.shoulderY + 0.04 * ROBOT.scale); // behind the shoulder
    ctx.scale(ROBOT.scale, ROBOT.scale); // the wing is drawn at its first size and follows the robot's
    ctx.rotate(-0.12 - flap);
    const g = ctx.createLinearGradient(0, -0.4, 0.6, 0.1);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#cfdcff');
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(0.14, -0.44, 0.5, -0.52, 0.64, -0.3); // the top edge, out to the tip
    ctx.quadraticCurveTo(0.58, -0.12, 0.47, -0.15); // three feathers along the bottom
    ctx.quadraticCurveTo(0.45, 0.02, 0.33, -0.03);
    ctx.quadraticCurveTo(0.29, 0.12, 0.17, 0.05);
    ctx.quadraticCurveTo(0.09, 0.14, 0, 0.09);
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = '#9fb4ee';
    ctx.lineWidth = 0.02;
    ctx.stroke();
    // the lines between the feathers
    ctx.beginPath();
    ctx.moveTo(0.47, -0.15);
    ctx.quadraticCurveTo(0.36, -0.2, 0.2, -0.2);
    ctx.moveTo(0.33, -0.03);
    ctx.quadraticCurveTo(0.24, -0.08, 0.12, -0.08);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

/** A ghost's halo: a gold ring floating over its helmet. Drawn after the ghost. */
function drawHalo(ctx: Ctx, x: number, y: number, s: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.shadowColor = 'rgba(255, 220, 110, 0.9)';
  ctx.shadowBlur = s * 0.12;
  ctx.strokeStyle = '#ffe27a';
  const k = ROBOT.scale;
  ctx.lineWidth = 0.045 * k;
  ctx.beginPath();
  ctx.ellipse(0, ROBOT.top - 0.1 * k, 0.2 * k, 0.062 * k, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * The ghosts of knocked-out robots: a pale robot in a faint version of its suit
 * colour, with angel wings and a halo, floating straight up from where it was
 * caught to the top of the screen, and fading as it gets near the top.
 *
 * It is drawn in the arena's own pixels (0, 0 is the arena's top-left corner),
 * on a layer that reaches above the arena. `top` is where the top of the screen
 * is in those pixels: 0 if the arena starts there, negative if there is
 * something above it. Returns whether anything was drawn.
 */
export function drawGhosts(ctx: Ctx, world: World, T: number, top: number): boolean {
  let any = false;
  for (const p of world.players) {
    if (p.alive || p.deadTicks < GHOST_FROM || p.deadTicks >= GHOST_TICKS) continue;
    const t = p.deadTicks - GHOST_FROM;
    const rise = ((GHOST_SPEED * t * t) / (t + GHOST_EASE)) * T;
    const x = (p.x + 0.5) * T + Math.sin(p.deadTicks * 0.12) * T * 0.07;
    const y = (p.y + 0.5) * T + T * 0.38 - rise; // its feet
    const room = y + (ROBOT.top - 0.17 * ROBOT.scale) * T - top; // from the top of its halo to the top of the screen
    if (room <= 0) continue;
    ctx.save();
    // it appears over a few ticks, stays clear on the way up, and goes as it nears the top
    // (and, on a screen so tall that it runs out of time first, just before the count stops)
    ctx.globalAlpha = 0.6 * Math.min(1, t / 8) * Math.min(1, room / (GHOST_FADE * T)) * Math.min(1, (GHOST_TICKS - p.deadTicks) / 20);
    drawWings(ctx, x, y, T, p.deadTicks * 0.16);
    drawRobot(ctx, x, y, T, ghostOf(colorById(p.colorId)), 2, 0, false, { noShadow: true, pale: true, arms: GHOST_ARMS });
    drawHalo(ctx, x, y, T);
    ctx.restore();
    any = true;
  }
  return any;
}
