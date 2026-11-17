/**
 * Everything that draws. Reads the world, never changes it.
 *
 * All the art is drawn with canvas shapes in code: there are no image files.
 * - the robots themselves are in robot.ts (drawRobot, drawHead)
 * - drawStatic: the floor and solid blocks (drawn once, then reused)
 * - drawDynamic: bricks, power-ups, bombs, blasts and robots (drawn every frame)
 * - drawItemIcon: the seven power-up icons, also used by the top bar
 */
import { drawRobot, warmRobots, CRACK, GHOST_ARMS, ROBOT, type Pose, type Wanted } from './robot';
import { danceFrame, danceSamples, type DanceId } from './dances';
import type { MapId } from './setup';
export { warmRobots } from './robot';
import { World, FLOOR, HARD, SOFT, FLAME_TICKS, DEATH_TICKS, GHOST_TICKS, SHIELD_GRACE_TICKS, FALL_TICKS, TICK_HZ, ItemKind, Player, Bomb, FLY_TICKS_PER_TILE, THROW_TILES, FUSE_TICKS, CARRY_FUSE_TICKS, DX, DY, angelAim, angelReach, perimeterAt } from './sim';

export interface BotColor {
  /** saved with the player's choice and sent to the rules as Player.colorId */
  id: string;
  /** the colour's name */
  name: string;
  /**
   * The robot's own name: each colour is a robot character (Claude's names, asked for by the owner). Shown
   * in the lobby and the menus in place of the colour's name. A real player can use their own name instead.
   */
  bot?: string;
  /** the armour colour, with a lighter and a darker shade of it for shading */
  body: string;
  light: string;
  dark: string;
  /** the glowing trim on the helmet and boots, and the colour of this bot's bombs and blasts */
  glow: string;
  /** drawn as a zombie: scorched black and rotted green in patches, the helmet cracked (robot.ts `decay`) */
  zombie?: boolean;
}

/** Only these parts change between bots. The black parts are shared by all nine. */
export const COLORS: BotColor[] = [
  { id: 'gold', name: 'Gold', bot: 'Auric', body: '#d6b068', light: '#f3dba0', dark: '#9c7a3a', glow: '#ffc56a' },
  { id: 'black', name: 'Black', bot: 'Onyx', body: '#31333c', light: '#555966', dark: '#1b1c22', glow: '#ffffff' },
  { id: 'pink', name: 'Pink', bot: 'Fizz', body: '#ff4fa6', light: '#ff9ccd', dark: '#c0206f', glow: '#ff5fd2' },
  { id: 'blue', name: 'Blue', bot: 'Volt', body: '#3fb4f0', light: '#93dcff', dark: '#1b7fb8', glow: '#5fd6ff' },
  { id: 'red', name: 'Red', bot: 'Blaze', body: '#dc2130', light: '#ff6a70', dark: '#96101c', glow: '#ff4040' },
  { id: 'orange', name: 'Orange', bot: 'Tango', body: '#f27c1c', light: '#ffb46a', dark: '#b3520a', glow: '#ff9a3c' },
  { id: 'white', name: 'White', bot: 'Frost', body: '#eceef4', light: '#ffffff', dark: '#b4b8c6', glow: '#ffffff' },
  { id: 'green', name: 'Green', bot: 'Gizmo', body: '#34d06a', light: '#8cf5ac', dark: '#16903f', glow: '#5cff8e' },
  { id: 'purple', name: 'Purple', bot: 'Vortex', body: '#8d5cf6', light: '#c2a6ff', dark: '#5a2fc0', glow: '#b48cff' },
];

/** The colour with this id, or gold if there is no such colour. */
/** A robot's name: its own (Auric, Volt...) or, for a colour without one, the colour's name. */
export function botName(c: BotColor): string {
  return c.bot ?? c.name;
}

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
export { drawRobot, drawHead, forgetSprites, ROBOT, type Pose } from './robot';


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

const zombies = new Map<string, BotColor>();
/**
 * A robot as a zombie: its own colours, dulled and a little greener, with green-glowing lights; the sprite
 * then scorches it black and rots it green in patches and cracks its helmet (`zombie`, robot.ts `decay`).
 */
function zombieOf(c: BotColor): BotColor {
  let z = zombies.get(c.id);
  if (!z) {
    z = { ...c, body: mix(c.body, '#5f7a45', 0.3), light: mix(c.light, '#a9c48c', 0.3), dark: mix(c.dark, '#22301a', 0.35), glow: '#a4ff63', zombie: true };
    zombies.set(c.id, z);
  }
  return z;
}
/** A zombie's arms: held out from its sides, facing the viewer or away; held out in front from the side. */
const ZOMBIE_ARMS: [number, number] = [0.38, 0.38];
const ZOMBIE_REACH: [number, number] = [1, 0.875];
const zombieArms = (facing: number): [number, number] => (facing === 3 || facing === 4 ? ZOMBIE_REACH : ZOMBIE_ARMS);

/**
 * Now and then a spark jumps from a zombie's cracked helmet, like a bad circuit: a short jagged bolt, bright
 * white-blue with a glow, for a frame or two. When is worked out from the time and the player, so each
 * zombie sparks on its own rhythm.
 */
function drawSparks(ctx: Ctx, p: Player, x: number, y: number, T: number, time: number): void {
  const beat = Math.floor(time * 14);
  const r = scatter(beat * 7 + p.id * 131);
  if (r > 0.3) return; // sparking about a third of the time, in bursts
  const side = p.facing === 3 ? -1 : 1;
  const cx = x + CRACK.x * T * (p.facing === 1 ? -1 : side) * (p.facing === 3 || p.facing === 4 ? 0.6 : 1);
  const cy = y + CRACK.y * T;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [w, col, blur] of [
    [T * 0.05, 'rgba(120,220,255,0.35)', T * 0.12],
    [T * 0.018, 'rgba(235,250,255,0.95)', 0],
  ] as const) {
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(1, w);
    ctx.shadowColor = 'rgba(120,220,255,0.9)';
    ctx.shadowBlur = blur;
    ctx.beginPath();
    let px = cx;
    let py = cy;
    ctx.moveTo(px, py);
    const dir = scatter(beat * 13 + p.id) * Math.PI * 2;
    for (let i = 1; i <= 3; i++) {
      const a = dir + (scatter(beat * 31 + i * 17 + p.id) - 0.5) * 1.8;
      px += Math.cos(a) * T * 0.09;
      py += Math.sin(a) * T * 0.09;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.restore();
}
/** A zombie on the move sways from side to side. */
const zombieLean = (p: Player): number => (p.moving ? Math.sin(p.walk * 0.5) * 0.09 : Math.sin(p.walk * 0.5) * 0.03);

/** A number from 0 to 1 that is always the same for the same `n`: for scattering ash without a random generator. */
function scatter(n: number): number {
  const v = Math.sin(n * 12.9898) * 43758.5453;
  return v - Math.floor(v);
}

// ---------------------------------------------------------------- arena

/**
 * The map being drawn (setup.ts, MAPS): how the floor, the solid blocks and the breakable ones look. Only a
 * look: the rules are the same on every map. main.ts and the lobby say which before they draw an arena.
 */
let mapNow: MapId = 'midnight';
export function setMap(id: MapId): void {
  mapNow = id;
}

/** Solid block: fills its whole tile. `joined`: another solid block is right below it (its front is hidden). `deco`: see drawRock. */
export function drawHard(ctx: Ctx, px: number, py: number, T: number, map: MapId = mapNow, joined = false, deco = 1): void {
  if (map === 'western') drawRock(ctx, px, py, T, joined, deco);
  else drawSteel(ctx, px, py, T);
}

/** Breakable block: fills its whole tile. `variant` 0 or 1 gives neighbours a little variety. */
export function drawSoft(ctx: Ctx, px: number, py: number, T: number, map: MapId = mapNow, variant = 0): void {
  void variant;
  // a whole size (every tile of an arena): stamped from a picture made once. Any other size: drawn here.
  if (Number.isInteger(T) && T <= 200) ctx.drawImage(softSprite(map, T), px, py);
  else if (map === 'western') drawCrate(ctx, px, py, T);
  else drawBricks(ctx, px, py, T);
}

/** One tile of floor, at column x and row y of the arena. */
export function drawFloor(ctx: Ctx, x: number, y: number, px: number, py: number, T: number, map: MapId = mapNow): void {
  if (map === 'western') {
    drawSand(ctx, x, y, px, py, T);
    return;
  }
  ctx.fillStyle = '#0e1220';
  ctx.fillRect(px, py, T, T);
  // a few flecks so the floor is not dead flat
  ctx.fillStyle = 'rgba(120,150,255,0.06)';
  for (let k = 0; k < 5; k++) {
    const n = (x * 73 + y * 131 + k * 197) % 97;
    ctx.fillRect(px + ((n * 37) % 89) / 89 * T * 0.9, py + ((n * 53) % 83) / 83 * T * 0.9, T * 0.06, T * 0.06);
  }
}

// Midnight (the game's first look): steel blocks and bricks on a dark floor

/** A steel block: raised bevel with a sunken square in the middle. */
function drawSteel(ctx: Ctx, px: number, py: number, T: number): void {
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

/** Four staggered courses of bricks. */
function drawBricks(ctx: Ctx, px: number, py: number, T: number): void {
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

// Wild West (the owner's ask, November 2026: a western map, clean and good to look at, with a solid and a
// breakable of its own): red rock and wooden crates on desert sand in evening light. The ground is kept
// fairly dark, like Midnight's floor, because everything that glows (blasts, the robots' soles, the ring
// under your robot, ghosts) is drawn to be seen against the dark.
const WEST = {
  sand: ['#93714a', '#8c6a44'], // two tones, tile about (very close: a hint of a checker to judge distance by)
  grain: 'rgba(255,220,160,0.10)',
  speck: 'rgba(40,18,6,0.15)',
  rockTop: '#b95737',
  rockLit: '#e48d62',
  rockSlab: '#c76643',
  rockShade: '#8e3f27',
  rockFront: '#76301d',
  rockBand: '#a24f2f',
  rockFoot: '#4a1c0f',
  cactus: '#4c8a4e',
  cactusDark: '#2c5a35',
  cactusLit: '#86c070',
  bloom: '#ffd35e',
  wood: '#e3b672',
  woodLine: '#bf9050',
  frame: '#b37b3d',
  frameLit: '#d9a560',
  woodFront: '#8e5d2d',
  woodFrontLine: '#6c4420',
  woodEdge: '#3a220f',
};

/** Desert sand: two close tones, grains, and now and then a pebble, a tuft of dry grass or ripples left by the wind. */
function drawSand(ctx: Ctx, x: number, y: number, px: number, py: number, T: number): void {
  ctx.fillStyle = WEST.sand[(x + y) & 1];
  ctx.fillRect(px, py, T, T);
  for (let k = 0; k < 6; k++) {
    const n = (x * 73 + y * 131 + k * 197) % 97;
    const d = Math.max(1, Math.round(T * (k < 2 ? 0.06 : 0.04)));
    ctx.fillStyle = k % 2 ? WEST.grain : WEST.speck;
    ctx.fillRect(Math.round(px + (((n * 37) % 89) / 89) * T * 0.9), Math.round(py + (((n * 53) % 83) / 83) * T * 0.9), d, d);
  }
  const h = scatter(x * 31.7 + y * 57.3 + 4.1);
  const cx = px + T * (0.3 + 0.4 * scatter(x * 7.9 + y * 3.3));
  const cy = py + T * (0.35 + 0.35 * scatter(x * 2.1 + y * 9.7));
  ctx.lineCap = 'round';
  if (h < 0.1) {
    // a pebble, lit from the upper left
    ctx.fillStyle = 'rgba(40,18,6,0.35)';
    ctx.beginPath();
    ctx.ellipse(cx + T * 0.015, cy + T * 0.02, T * 0.075, T * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#b08c68';
    ctx.beginPath();
    ctx.ellipse(cx, cy, T * 0.07, T * 0.045, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,235,200,0.4)';
    ctx.beginPath();
    ctx.ellipse(cx - T * 0.02, cy - T * 0.012, T * 0.03, T * 0.016, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (h < 0.2) {
    // a tuft of dry grass: a few short blades fanning out
    ctx.strokeStyle = 'rgba(222,190,104,0.65)';
    ctx.lineWidth = Math.max(1, T * 0.025);
    for (const lean of [-0.11, -0.04, 0.03, 0.1]) {
      ctx.beginPath();
      ctx.moveTo(cx, cy + T * 0.07);
      ctx.quadraticCurveTo(cx + lean * T * 0.4, cy, cx + lean * T, cy - T * (0.09 - Math.abs(lean) * 0.25));
      ctx.stroke();
    }
  } else if (h < 0.34) {
    // ripples the wind left in the sand: two soft curved lines
    ctx.strokeStyle = 'rgba(255,224,170,0.13)';
    ctx.lineWidth = Math.max(1, T * 0.03);
    for (const dy of [0, 0.11]) {
      ctx.beginPath();
      ctx.moveTo(cx - T * 0.2, cy + T * dy);
      ctx.quadraticCurveTo(cx, cy + T * (dy - 0.07), cx + T * 0.2, cy + T * dy);
      ctx.stroke();
    }
  }
  ctx.lineCap = 'butt';
}

/**
 * A block of red rock: a flat top lit from the upper left, with a worn slab on it, and (unless another block
 * is right below) its front face under that, in layers, so the block stands up off the sand. `deco` (0 to 1,
 * the same for the same tile) puts a small barrel cactus on about one block in six.
 */
function drawRock(ctx: Ctx, px: number, py: number, T: number, joined: boolean, deco = 1): void {
  const e = Math.max(1, Math.round(T * 0.07));
  const top = joined ? T : Math.round(T * 0.74);
  ctx.fillStyle = WEST.rockTop;
  ctx.fillRect(px, py, T, top);
  ctx.fillStyle = WEST.rockLit; // lit top and left edges
  ctx.fillRect(px, py, T, e);
  ctx.fillRect(px, py, e, top);
  ctx.fillStyle = WEST.rockShade; // shaded right edge, and the bottom one where the top runs on into the next block
  ctx.fillRect(px + T - e, py, e, top);
  if (joined) ctx.fillRect(px, py + T - e, T, e);
  // the worn slab on top: a lighter patch with soft corners and a lit rim, set in from the edges
  const i = Math.round(T * 0.19);
  const sw = T - i * 2;
  const sh = top - i * 2 + (joined ? 0 : Math.round(T * 0.05));
  if (sh > e * 3) {
    const r = T * 0.1;
    ctx.fillStyle = WEST.rockShade;
    rr(ctx, px + i + e * 0.5, py + i + e * 0.5, sw, sh, r);
    ctx.fill();
    ctx.fillStyle = WEST.rockLit;
    rr(ctx, px + i - e * 0.35, py + i - e * 0.35, sw, sh, r);
    ctx.fill();
    ctx.fillStyle = WEST.rockSlab;
    rr(ctx, px + i, py + i, sw, sh, r);
    ctx.fill();
    if (deco < 0.17) {
      // a barrel cactus, seen from above: a green ball with ribs and a small bloom
      const cx = px + T / 2;
      const cy = py + i + sh / 2;
      const cr = Math.min(sw, sh) * 0.36;
      ctx.fillStyle = 'rgba(60,20,8,0.35)';
      ctx.beginPath();
      ctx.ellipse(cx + cr * 0.18, cy + cr * 0.28, cr * 1.05, cr * 0.95, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = WEST.cactusDark;
      ctx.beginPath();
      ctx.arc(cx, cy, cr, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = WEST.cactus;
      ctx.beginPath();
      ctx.arc(cx, cy, cr * 0.84, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = WEST.cactusLit;
      ctx.lineWidth = Math.max(1, cr * 0.13);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + 0.3;
        line(ctx, cx + Math.cos(a) * cr * 0.3, cy + Math.sin(a) * cr * 0.3, cx + Math.cos(a) * cr * 0.78, cy + Math.sin(a) * cr * 0.78);
      }
      ctx.fillStyle = WEST.bloom;
      ctx.beginPath();
      ctx.arc(cx, cy, cr * 0.24, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (joined) return;
  // the front face: darker rock in layers, a paler band through it
  const fh = T - top;
  ctx.fillStyle = WEST.rockFront;
  ctx.fillRect(px, py + top, T, fh);
  ctx.fillStyle = WEST.rockBand;
  ctx.fillRect(px, py + top + Math.round(fh * 0.3), T, Math.max(1, Math.round(fh * 0.24)));
  ctx.fillStyle = WEST.rockShade; // the lip just under the top's edge
  ctx.fillRect(px, py + top, T, Math.max(1, Math.round(e * 0.5)));
  ctx.fillStyle = WEST.rockFoot;
  ctx.fillRect(px, py + T - e, T, e);
}

/**
 * A wooden crate, standing up off the sand like the rocks: its lid (three planks in a frame of four boards,
 * with a brace corner to corner) and under it its front, darker. A dark edge all round, so crates side by
 * side read as crates. Bold shapes and few lines: on a phone a tile is under half a centimetre.
 */
function drawCrate(ctx: Ctx, px: number, py: number, T: number): void {
  const g = Math.max(1, Math.round(T * 0.04)); // the dark edge
  const top = Math.round(T * 0.78); // the lid; the rest is the front
  const f = Math.max(2, Math.round(T * 0.13)); // a frame board's width
  ctx.fillStyle = WEST.woodEdge;
  ctx.fillRect(px, py, T, T);
  // the lid's planks
  const lx = px + g;
  const ly = py + g;
  const lw = T - g * 2;
  const lh = top - g;
  ctx.fillStyle = WEST.wood;
  ctx.fillRect(lx, ly, lw, lh);
  const ix = lx + f;
  const iy = ly + f;
  const iw = lw - f * 2;
  const ih = lh - f * 2;
  ctx.fillStyle = WEST.woodLine;
  const t = Math.max(1, Math.round(T * 0.025));
  for (const k of [1, 2]) ctx.fillRect(Math.round(ix + (k * iw) / 3 - t / 2), iy, t, ih);
  // the brace, corner to corner, the same wood as the frame
  ctx.save();
  ctx.beginPath();
  ctx.rect(ix, iy, iw, ih);
  ctx.clip();
  ctx.strokeStyle = WEST.frame;
  ctx.lineWidth = f * 0.9;
  line(ctx, ix + iw + f * 0.3, iy - f * 0.3, ix - f * 0.3, iy + ih + f * 0.3);
  ctx.strokeStyle = WEST.frameLit;
  ctx.lineWidth = Math.max(1, t);
  line(ctx, ix + iw - f * 0.32, iy - f * 0.3, ix - f * 0.32 - f * 0.3, iy + ih);
  ctx.restore();
  // the frame: four boards, lit along the top
  ctx.fillStyle = WEST.frame;
  ctx.fillRect(lx, ly, lw, f);
  ctx.fillRect(lx, ly + lh - f, lw, f);
  ctx.fillRect(lx, ly, f, lh);
  ctx.fillRect(lx + lw - f, ly, f, lh);
  ctx.fillStyle = WEST.frameLit;
  ctx.fillRect(lx, ly, lw, t);
  ctx.fillRect(lx, ly, t, lh);
  ctx.fillRect(ix, ly + lh - f, iw, t);
  // the front: darker boards, a line between each
  const fy = py + top;
  const fh = T - top - g;
  ctx.fillStyle = WEST.woodFront;
  ctx.fillRect(lx, fy, lw, fh);
  ctx.fillStyle = WEST.woodFrontLine;
  ctx.fillRect(lx, fy, lw, t);
  for (const k of [1, 2]) ctx.fillRect(Math.round(ix + (k * iw) / 3 - t / 2), fy, t, fh);
  ctx.fillRect(lx + f - t, fy, t, fh);
  ctx.fillRect(lx + lw - f, fy, t, fh);
}
/** A breakable block is drawn once at each size and stamped from then on (an arena has a hundred of them). */
const softs = new Map<string, HTMLCanvasElement>();
function softSprite(map: MapId, T: number): HTMLCanvasElement {
  const key = `${map}|${T}`;
  let c = softs.get(key);
  if (!c) {
    if (softs.size > 24) softs.clear();
    c = document.createElement('canvas');
    c.width = c.height = T;
    const g = c.getContext('2d')!;
    if (map === 'western') drawCrate(g, 0, 0, T);
    else drawBricks(g, 0, 0, T);
    softs.set(key, c);
  }
  return c;
}

/** Floor and fixed walls. Redrawn only when the screen size changes. */
export function drawStatic(ctx: Ctx, world: World, T: number): void {
  for (let y = 0; y < world.h; y++) {
    for (let x = 0; x < world.w; x++) {
      const px = x * T;
      const py = y * T;
      drawFloor(ctx, x, y, px, py, T);
      if (world.tiles[y * world.w + x] === HARD) drawHard(ctx, px, py, T, mapNow, y + 1 < world.h && world.tiles[(y + 1) * world.w + x] === HARD, scatter(x * 12.7 + y * 45.1 + 0.5));
    }
  }
}

export const ITEM_COLOR: Record<ItemKind, string> = {
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
/**
 * The part of the arena that changes only when a block breaks or lands: the strip of shadow every block
 * casts onto the floor below it, and the breakable blocks themselves. It goes over the floor and solid blocks
 * (drawStatic) and under everything else. main.ts keeps a picture of the three together and draws that once
 * a frame, making it again only when `groundKey` says the blocks have changed: drawn afresh every frame, the
 * bricks alone were over two thousand rectangles.
 */
export function drawGround(ctx: Ctx, world: World, T: number): void {
  ctx.fillStyle = mapNow === 'western' ? 'rgba(38,14,4,0.42)' : 'rgba(0,0,0,0.38)';
  for (let y = 0; y < world.h - 1; y++) {
    for (let x = 0; x < world.w; x++) {
      if (world.tiles[y * world.w + x] !== FLOOR && world.tiles[(y + 1) * world.w + x] === FLOOR) {
        ctx.fillRect(x * T, (y + 1) * T, T, Math.round(T * 0.16));
      }
    }
  }
  for (let y = 0; y < world.h; y++) {
    for (let x = 0; x < world.w; x++) {
      if (world.tiles[y * world.w + x] === SOFT) drawSoft(ctx, x * T, y * T, T, mapNow, x + y);
    }
  }
}
/** A number that is different whenever the arena's blocks are (so drawGround's picture would be too). */
export function groundKey(world: World): number {
  const t = world.tiles;
  let h = world.w * 131 + world.h;
  for (let i = 0; i < t.length; i++) h = (Math.imul(h, 31) + t[i]) | 0;
  return h;
}

/**
 * Everything that moves, every frame. `grounded`: the picture already has the shadows and breakable blocks
 * in it (drawGround), so they are not drawn again.
 */
export function drawDynamic(ctx: Ctx, world: World, T: number, time: number, focusId = 0, celebrate?: Celebration, crowned = -1, grounded = false): void {
  const west = mapNow === 'western';
  if (!grounded) drawGround(ctx, world, T);

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

  // breakable blocks that are burning flash as they go
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
    if (b.state === 'ground') drawBomb(ctx, world, b, (b.x + 0.5) * T, (b.y + 0.5 + BOMB_DROP) * T, T, true);
  }

  // blasts, in the colour of whoever placed the bomb
  ctx.save();
  // (on the sand of the Wild West a blast first darkens the ground under it, so its light and its owner's
  // colour show as they do on Midnight's dark floor: pass -1)
  for (const pass of west ? [-1, 0, 1, 2] : [0, 1, 2]) {
    ctx.globalCompositeOperation = pass < 0 ? 'source-over' : 'lighter';
    for (const f of world.flames) {
      const col = colorById(world.players[f.owner]?.colorId ?? 'gold');
      const t = f.ttl / FLAME_TICKS;
      const k = Math.sqrt(t > 0.8 ? (1 - t) / 0.2 : t / 0.8);
      const width = T * (pass < 0 ? 0.92 : [0.92, 0.62, 0.3][pass]) * k;
      if (width < 0.5) continue;
      ctx.strokeStyle = pass < 0 ? '#1c0b04' : pass === 2 ? '#ffffff' : col.glow;
      ctx.globalAlpha = pass < 0 ? 0.5 : [0.3, 0.75, 0.95][pass];
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
  for (const p of order) drawPlayer(ctx, world, p, T, time, celebrate, crowned);

  // carried and flying bombs go on top
  for (const b of world.bombs) {
    const gx = (b.x + 0.5) * T;
    const gy = (b.y + 0.5) * T;
    if (b.state === 'held') drawBomb(ctx, world, b, gx, gy + T * (0.46 + ROBOT.top - 0.2), T, false); // resting on the helmet of the robot carrying it
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

const BOMB_R = 0.3; // the ball's radius, in tiles (0.34 when the ball was the whole bomb: it gave up room for the fuse)
const BOMB_DROP = 0.06; // on the floor the ball sits this far below the middle of its tile, so ball and fuse together look centred
/** The fuse, from the cap to its far end: a curve (start, two handles, end) in ball radii from the middle of the ball. */
const FUSE_CURVE: [number, number][] = [
  [0.545, -1.07],
  [0.727, -1.426],
  [1.3, -1.8],
  [1.5, -0.95],
];
const FUSE_STEPS = 24;
/** Points along the fuse, the same distance apart, so the spark runs down it at a steady speed. */
const FUSE_POINTS: [number, number][] = (() => {
  const fine: [number, number][] = [];
  const along: number[] = [];
  for (let i = 0; i <= 96; i++) {
    const v = i / 96;
    const u = 1 - v;
    const w = [u * u * u, 3 * u * u * v, 3 * u * v * v, v * v * v];
    const c = FUSE_CURVE;
    fine.push([c[0][0] * w[0] + c[1][0] * w[1] + c[2][0] * w[2] + c[3][0] * w[3], c[0][1] * w[0] + c[1][1] * w[1] + c[2][1] * w[2] + c[3][1] * w[3]]);
    along.push(i ? along[i - 1] + Math.hypot(fine[i][0] - fine[i - 1][0], fine[i][1] - fine[i - 1][1]) : 0);
  }
  const out: [number, number][] = [];
  let j = 1;
  for (let i = 0; i <= FUSE_STEPS; i++) {
    const want = (along[96] * i) / FUSE_STEPS;
    while (j < 96 && along[j] < want) j++;
    const k = (want - along[j - 1]) / (along[j] - along[j - 1] || 1);
    out.push([fine[j - 1][0] + (fine[j][0] - fine[j - 1][0]) * k, fine[j - 1][1] + (fine[j][1] - fine[j - 1][1]) * k]);
  }
  return out;
})();
const CAP_TILT = Math.atan2(FUSE_CURVE[0][0], -FUSE_CURVE[0][1]); // the cap leans the way the fuse leaves the ball

/**
 * A bomb: a black iron ball with a cap and a rope fuse, a band of light in its owner's colour, and a spark
 * burning down the fuse. (cx, cy) is the middle of the ball.
 *
 * The fuse is a clock. The length of rope left is the share of the bomb's time that is left, so the spark
 * reaches the cap as the bomb goes off: 2.5 seconds from being dropped; a bomb that has been picked up was
 * given 3 seconds then, so its fuse is measured against that (it grows back at the first lift, because the
 * bomb really does get more time). A bomb caught in a blast has a few ticks left, so its spark jumps to
 * the cap. In the last three quarters of a second the ball throbs faster and flashes red-hot.
 */
function drawBomb(ctx: Ctx, world: World, b: Bomb, cx: number, cy: number, T: number, shadow: boolean): void {
  const col = colorById(world.players[b.owner]?.colorId ?? 'gold');
  const left = b.fuse / (b.lifted ? CARRY_FUSE_TICKS : FUSE_TICKS); // the share of the fuse still to burn
  paintBomb(ctx, cx, cy, T, col.glow, left, b.fuse < 45, b.age, b.id, shadow);
}

/**
 * A bomb on its own, for screens outside a round (the title screen): the same drawing as in play.
 * (cx, cy) is the middle of the ball and `T` the size of a tile. `left` is the share of the fuse still to
 * burn, `age` how many ticks it has been lit (it sets the throb and the flicker of the spark).
 */
export function drawBombArt(ctx: Ctx, cx: number, cy: number, T: number, glow: string, left: number, age: number): void {
  paintBomb(ctx, cx, cy, T, glow, left, false, age, 7, true);
}

/** The drawing of a bomb itself, for drawBomb and drawBombArt. `id` keeps one bomb's spark from flickering in step with another's. */
function paintBomb(ctx: Ctx, cx: number, cy: number, T: number, band: string, share: number, urgent: boolean, age: number, id: number, shadow: boolean): void {
  const pulse = 1 + 0.07 * Math.sin(age * (urgent ? 0.6 : 0.22));
  const r = T * BOMB_R * pulse;
  if (shadow) {
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + T * BOMB_R, r * 0.95, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const left = Math.max(0, Math.min(1, share));
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(r, r); // from here on, 1 is the ball's radius
  const thin = 1 / r; // one pixel
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // the rope that is left, from the cap out to where the spark is (drawn first: the cap sits over its root)
  const at = left * FUSE_STEPS;
  const whole = Math.floor(at);
  const part = at - whole;
  const tip: [number, number] =
    whole >= FUSE_STEPS
      ? FUSE_POINTS[FUSE_STEPS]
      : [FUSE_POINTS[whole][0] + (FUSE_POINTS[whole + 1][0] - FUSE_POINTS[whole][0]) * part, FUSE_POINTS[whole][1] + (FUSE_POINTS[whole + 1][1] - FUSE_POINTS[whole][1]) * part];
  if (left > 0.01) {
    const rope = (): void => {
      ctx.beginPath();
      ctx.moveTo(FUSE_POINTS[0][0], FUSE_POINTS[0][1]);
      for (let i = 1; i <= whole; i++) ctx.lineTo(FUSE_POINTS[i][0], FUSE_POINTS[i][1]);
      ctx.lineTo(tip[0], tip[1]);
    };
    ctx.strokeStyle = '#241b12';
    ctx.lineWidth = Math.max(0.22, 2.6 * thin);
    rope();
    ctx.stroke();
    ctx.strokeStyle = '#d2b98c';
    ctx.lineWidth = Math.max(0.12, 1.4 * thin);
    rope();
    ctx.stroke();
  }

  // the ball: black iron, lit from the upper left
  const g = ctx.createRadialGradient(-0.35, -0.4, 0.05, 0, 0, 1);
  g.addColorStop(0, '#4b4f62');
  g.addColorStop(0.45, '#15161d');
  g.addColorStop(1, '#020203');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  if (urgent) {
    // red-hot, flashing, when it is about to go
    ctx.fillStyle = age % 8 < 4 ? 'rgba(255,80,40,0.42)' : 'rgba(255,80,40,0.16)';
    ctx.fill();
  }
  // a band of light low on the ball in its owner's colour: whose bomb it is, and what colour the blast will be
  ctx.strokeStyle = band;
  ctx.globalAlpha = 0.28;
  ctx.lineWidth = 0.26;
  ctx.beginPath();
  ctx.arc(0, 0, 0.7, Math.PI * 0.2, Math.PI * 0.8);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.lineWidth = Math.max(0.11, 1.3 * thin);
  ctx.beginPath();
  ctx.arc(0, 0, 0.7, Math.PI * 0.2, Math.PI * 0.8);
  ctx.stroke();
  // the shine on the iron
  ctx.save();
  ctx.translate(-0.4, -0.46);
  ctx.rotate(-0.72);
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.3, 0.13, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.beginPath();
  ctx.arc(-0.66, -0.08, 0.06, 0, Math.PI * 2);
  ctx.fill();

  // the cap the fuse comes out of: a short steel collar, leaning the way the fuse does
  ctx.save();
  ctx.rotate(CAP_TILT);
  const steel = ctx.createLinearGradient(-0.26, 0, 0.26, 0);
  steel.addColorStop(0, '#aab0c4');
  steel.addColorStop(0.45, '#5a5f72');
  steel.addColorStop(1, '#22242e');
  ctx.fillStyle = steel;
  ctx.strokeStyle = '#050508';
  ctx.lineWidth = Math.max(0.05, 0.8 * thin);
  rr(ctx, -0.26, -1.15, 0.52, 0.3, 0.07);
  ctx.fill();
  ctx.stroke();
  rr(ctx, -0.17, -1.24, 0.34, 0.12, 0.04);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // the spark at the end of the rope: a flickering white-hot point, a warm glow, rays and a few flying embers
  const seed = id * 31 + (age >> 1); // changes every other tick
  const flick = (0.8 + 0.45 * scatter(seed)) * (urgent ? 1.3 : 1);
  ctx.save();
  ctx.translate(tip[0], tip[1]);
  ctx.globalCompositeOperation = 'lighter';
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.8 * flick);
  glow.addColorStop(0, 'rgba(255,200,110,0.85)');
  glow.addColorStop(0.4, 'rgba(255,140,40,0.4)');
  glow.addColorStop(1, 'rgba(255,90,10,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, 0.8 * flick, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = '#ffe7a0';
  ctx.lineWidth = Math.max(0.07, 1.1 * thin);
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3 + scatter(seed + i * 7 + 1) * 0.9;
    const reach = (0.26 + 0.42 * scatter(seed + i * 7 + 2)) * flick;
    ctx.moveTo(Math.cos(a) * 0.1, Math.sin(a) * 0.1);
    ctx.lineTo(Math.cos(a) * reach, Math.sin(a) * reach);
  }
  ctx.stroke();
  for (let i = 0; i < 3; i++) {
    // an ember: thrown up and out, slowing and falling, gone in a quarter of a second
    const clock = age + i * 5 + id * 3;
    const k = (clock % 15) / 15;
    const a = -Math.PI / 2 + (scatter(id * 17 + i * 29 + Math.floor(clock / 15)) - 0.5) * 2.6;
    ctx.globalAlpha = 1 - k;
    ctx.fillStyle = '#ffb347';
    ctx.beginPath();
    ctx.arc(Math.cos(a) * (0.25 + k * 0.95), Math.sin(a) * (0.25 + k * 0.95) + k * k * 0.55, Math.max(0.06, 0.7 * thin), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#fffbe2';
  ctx.beginPath();
  ctx.arc(0, 0, 0.15 * flick, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

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
 * robot, each ghost, and the winner's dance (`dance`, theirs) once there is a winner. Call it once a
 * frame; it works for at most `ms` thousandths of a second each time.
 */
export function warmSprites(ctx: Ctx, world: World, T: number, ms = 4, dance: DanceId = 'party'): void {
  const wanted: Wanted[] = world.players.map((p) => ({ c: colorById(p.colorId), kind: 'walk' as const }));
  wanted.push({ c: CHARRED, kind: 'burnt' });
  for (const p of world.players) wanted.push({ c: ghostOf(colorById(p.colorId)), kind: 'ghost' });
  // zombies: their walk, arms out, in every direction
  for (const p of world.players) if (p.zombie) wanted.push({ c: zombieOf(colorById(p.colorId)), kind: 'dance', moves: ZOMBIE_MOVES });
  if (world.over && world.over.winner >= 0) wanted.push({ c: colorById(world.players[world.over.winner].colorId), kind: 'dance', moves: danceSamples(dance) });
  warmRobots(ctx, T, wanted, ms);
}

/** Every picture a zombie walking about needs: standing and each step of the walk, each way, arms out. */
const ZOMBIE_MOVES = ([1, 2, 3, 4] as const).flatMap((facing) =>
  [-1, 0, 1, 2, 3, 4, 5, 6, 7].map((f) => ({ facing, walk: f < 0 ? 0 : (f / 8) * Math.PI * 2, moving: f >= 0, pose: { arms: zombieArms(facing) } })),
);

/** The winner of a round, how many seconds ago it was decided, and the victory dance they picked (dances.ts). */
export interface Celebration {
  player: number;
  t: number;
  dance?: DanceId;
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
function drawPlayer(ctx: Ctx, world: World, p: Player, T: number, time: number, celebrate?: Celebration, crowned = -1): void {
  const col = colorById(p.colorId);
  const x = (p.x + 0.5) * T;
  const y = (p.y + 0.5) * T + T * 0.46;
  if (p.alive) {
    if (celebrate && celebrate.player === p.id) {
      // the winner: their victory dance
      const f = danceFrame(celebrate.dance ?? 'party', celebrate.t);
      drawRobot(ctx, x + f.dx * T, y, T, col, f.facing, f.walk, f.moving, { ...f.pose, crown: crowned === p.id });
    } else {
      // just back after losing a life (or an angel back in the round): blinking while blasts cannot hurt it
      const blink = p.safeTicks > 0 && Math.floor(p.safeTicks / 5) % 2 === 0;
      if (blink) {
        ctx.save();
        ctx.globalAlpha = 0.3;
      }
      if (p.zombie) {
        drawRobot(ctx, x, y, T, zombieOf(col), p.facing, p.walk, p.moving, { arms: zombieArms(p.facing), lean: zombieLean(p) });
        drawSparks(ctx, p, x, y, T, time);
      }
      else drawRobot(ctx, x, y, T, col, p.facing, p.walk, p.moving, crowned === p.id ? { crown: true } : undefined);
      if (blink) ctx.restore();
    }
    drawStatus(ctx, p, x, (p.y + 0.5) * T, T);
    return;
  }
  const t = p.deadTicks;
  // a zombie knocked down lies where it fell and gets up again; one just out of lives climbs out of the
  // floor once its knocked-out animation has played
  if (p.zombie && (p.zombieDown || t >= DEATH_TICKS)) {
    // ticks until it is up. Once the round is decided it never gets up (the rules stop there), so it stays
    // where it is: down, or not yet out of the floor. (It once kept "rising" past full size, filling the screen.)
    const left = world.over ? Infinity : Math.max(0, p.respawnAt - world.tick);
    const z = zombieOf(col);
    ctx.save();
    if (p.zombieDown) {
      const up = Math.max(0, Math.min(1, 1 - left / 30)); // the last half second: getting up
      const side = p.id % 2 ? 1 : -1;
      ctx.globalAlpha = 0.85;
      drawRobot(ctx, x, y, T, z, 2, 0, false, { lean: side * 1.45 * (1 - up), shrink: 0.85 + 0.15 * up, xEyes: up < 0.5 });
    } else if (left <= 30) {
      const k = Math.max(0.08, 1 - left / 30);
      ctx.globalAlpha = Math.min(1, k * 1.5);
      drawRobot(ctx, x, y, T, z, 2, 0, false, { shrink: k, arms: [1, 1] });
    }
    ctx.restore();
    return;
  }
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
    // (an angel goes to the wall instead: drawAngels; a robot with a life left comes back instead)
    if (p.alive || p.angel || p.respawnAt >= 0 || p.deadTicks < GHOST_FROM || p.deadTicks >= GHOST_TICKS) continue;
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

/**
 * Angels: robots out of lives (with angels on) haunting the outer wall, on the ghost layer so their wings and
 * halo can reach above the arena. Each is its ghost (pale, wings, halo), a little smaller, bobbing gently,
 * fading in as it takes to the wall. Winding up a throw it holds both arms up with a bomb over its head, and a
 * ring in its colour marks where the bomb will land, moving further in the longer A is held. Returns whether
 * anything was drawn.
 */
export function drawAngels(ctx: Ctx, world: World, T: number, time: number): boolean {
  let any = false;
  for (const p of world.players) {
    if (!p.angel || p.alive || world.tick < p.angelFrom - 20) continue;
    any = true;
    const col = colorById(p.colorId);
    const at = perimeterAt(world, p.angelS);
    const x = (at.x + 0.5) * T;
    const y = (at.y + 0.5) * T + T * 0.36 + Math.sin(time * 2.4 + p.id) * T * 0.05; // its feet
    const s = T * 0.8;
    const winding = p.angelHeld > 0;
    ctx.save();
    ctx.globalAlpha = 0.92 * Math.min(1, (world.tick - (p.angelFrom - 20)) / 20);
    // where the throw will land, while it is wound up
    if (winding) {
      const aim = angelAim(world, p);
      if (aim.dir) {
        const d = angelReach(world, aim.dir, p.angelHeld);
        const tx = (aim.cx + DX[aim.dir] * d + 0.5) * T;
        const ty = (aim.cy + DY[aim.dir] * d + 0.5) * T;
        ctx.strokeStyle = col.glow;
        ctx.lineWidth = Math.max(1.5, T * 0.06);
        ctx.setLineDash([T * 0.12, T * 0.08]);
        ctx.beginPath();
        ctx.arc(tx, ty, T * 0.36, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(tx, ty, T * 0.06, 0, Math.PI * 2);
        ctx.fillStyle = col.glow;
        ctx.fill();
      }
    }
    drawWings(ctx, x, y, s, time * 9 + p.id);
    drawRobot(ctx, x, y, s, ghostOf(col), 2, 0, false, { noShadow: true, pale: true, arms: winding ? [1, 1] : GHOST_ARMS });
    drawHalo(ctx, x, y, s);
    if (winding) drawBombArt(ctx, x, y + (ROBOT.top - 0.12) * s, s * 0.85, col.glow, 0.7, Math.floor(time * 60));
    ctx.restore();
  }
  return any;
}
