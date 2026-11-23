/**
 * Everything that draws. Reads the world, never changes it.
 *
 * All the art is drawn with canvas shapes in code: there are no image files.
 * - the robots themselves are in robot.ts (drawRobot, drawHead)
 * - drawStatic: the floor and solid blocks (drawn once, then reused)
 * - drawDynamic: bricks, power-ups, bombs, blasts and robots (drawn every frame), and over everything the
 *   laptops' planes and the bombs falling from them
 * - drawItemIcon: the eight power-up icons, also used by the top bar
 */
import { drawRobot, warmRobots, CRACK, GHOST_ARMS, ROBOT, type Pose, type Wanted } from './robot';
import { danceFrame, danceSamples, type DanceId } from './dances';
import { TEAMS, type MapId } from './setup';
export { warmRobots } from './robot';
import { World, FLOOR, HARD, SOFT, FLAME_TICKS, DEATH_TICKS, GHOST_TICKS, SHIELD_GRACE_TICKS, FALL_TICKS, TICK_HZ, ItemKind, Player, Bomb, FLY_TICKS_PER_TILE, THROW_TILES, FUSE_TICKS, CARRY_FUSE_TICKS, DX, DY, DROP_TICKS, TURN_STEPS, allies, angelAim, angelReach, perimeterAt } from './sim';

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
  // a whole size (every tile of an arena): stamped from a picture made once. Any other size: drawn here.
  if (Number.isInteger(T) && T <= 200) ctx.drawImage(softSprite(map, T, variant & 3), px, py);
  else if (map === 'western') drawCrate(ctx, px, py, T);
  else drawBricks(ctx, px, py, T, variant & 3);
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

/**
 * Four staggered courses of bricks (made more real at the owner's ask, November 2026): each brick its own
 * shade of the blue, lit along its top and left and shaded along its bottom and right, set back from the
 * mortar so the joints look sunk; specks and a chipped corner here and there, now and then a hairline
 * crack. `variant` (0 to 3) shuffles the shades and marks, so neighbouring blocks are not copies.
 */
function drawBricks(ctx: Ctx, px: number, py: number, T: number, variant = 0): void {
  ctx.fillStyle = '#1d2340'; // mortar, in shadow
  ctx.fillRect(px, py, T, T);
  const rows = 4;
  const h = T / rows;
  const g = Math.max(1, Math.round(T * 0.045)); // a joint's width
  const e = Math.max(1, Math.round(T * 0.03)); // a lit or shaded edge
  let n = 0;
  for (let row = 0; row < rows; row++) {
    const y = Math.round(py + row * h);
    const bh = Math.round(py + (row + 1) * h) - y - g;
    const edges = row % 2 === 0 ? [0, 0.5, 1] : [0, 0.25, 0.75, 1];
    for (let k = 0; k < edges.length - 1; k++) {
      const x0 = Math.round(px + edges[k] * T);
      const x1 = Math.round(px + edges[k + 1] * T);
      const last = k === edges.length - 2;
      const bw = x1 - x0 - (last ? 0 : g);
      const r = scatter(variant * 17.3 + n++ * 3.71 + 0.2); // this brick's own luck
      // its face: a shade of the blue, a little lighter or darker than its neighbours
      const l = Math.round((r - 0.5) * 22);
      ctx.fillStyle = `rgb(${115 + l},${131 + l},${182 + l})`;
      ctx.fillRect(x0, y, bw, bh);
      // a soft fall of light down its face
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(x0, y, bw, Math.round(bh * 0.45));
      // lit along the top and left, shaded along the bottom and right
      ctx.fillStyle = 'rgba(214,224,255,0.55)';
      ctx.fillRect(x0, y, bw, e);
      ctx.fillStyle = 'rgba(214,224,255,0.25)';
      ctx.fillRect(x0, y, e, bh);
      ctx.fillStyle = 'rgba(22,26,52,0.45)';
      ctx.fillRect(x0, y + bh - e, bw, e);
      if (!last) ctx.fillRect(x0 + bw - e, y, e, bh);
      // specks in the clay
      for (let sp = 0; sp < 3; sp++) {
        const q = scatter(r * 91.3 + sp * 7.7);
        const q2 = scatter(r * 53.1 + sp * 3.3);
        ctx.fillStyle = sp % 2 ? 'rgba(30,36,70,0.35)' : 'rgba(200,212,250,0.3)';
        const d = Math.max(1, Math.round(T * 0.025));
        ctx.fillRect(Math.round(x0 + e + q * (bw - e * 2 - d)), Math.round(y + e + q2 * (bh - e * 2 - d)), d, d);
      }
      // a chipped corner on some
      if (r > 0.78) {
        const c = Math.max(2, Math.round(T * 0.06));
        ctx.fillStyle = '#1d2340';
        ctx.beginPath();
        const right = r > 0.89;
        const cx = right ? x0 + bw : x0;
        ctx.moveTo(cx, y);
        ctx.lineTo(cx + (right ? -c : c), y);
        ctx.lineTo(cx, y + c);
        ctx.closePath();
        ctx.fill();
      }
      // now and then a hairline crack
      if (r < 0.12 && bw > T * 0.3) {
        ctx.strokeStyle = 'rgba(22,26,52,0.6)';
        ctx.lineWidth = Math.max(0.6, T * 0.012);
        ctx.beginPath();
        const sx = x0 + bw * (0.3 + r * 2);
        ctx.moveTo(sx, y + e);
        ctx.lineTo(sx + bw * 0.08, y + bh * 0.45);
        ctx.lineTo(sx - bw * 0.03, y + bh - e);
        ctx.stroke();
      }
    }
    // the joint under this course catches a little light at its lower edge
    ctx.fillStyle = 'rgba(120,134,190,0.18)';
    ctx.fillRect(px, y + bh + g - 1, T, 1);
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
function softSprite(map: MapId, T: number, variant = 0): HTMLCanvasElement {
  const v = map === 'western' ? 0 : variant; // (crates are all alike)
  const key = `${map}|${T}|${v}`;
  let c = softs.get(key);
  if (!c) {
    if (softs.size > 48) softs.clear();
    c = document.createElement('canvas');
    c.width = c.height = T;
    const g = c.getContext('2d')!;
    if (map === 'western') drawCrate(g, 0, 0, T);
    else drawBricks(g, 0, 0, T, v);
    softs.set(key, c);
  }
  return c;
}

/** Floor and fixed walls. Redrawn only when the screen size changes. */
export function drawStatic(ctx: Ctx, world: World, T: number): void {
  // the fire every robot here burns with: made now, at the start of a round, so the first blast does not wait
  for (const p of world.players) fireOf(world, p.id);
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
  laptop: '#6f86ff',
};
/** A power-up lying on the floor is this share of a tile across (it was 0.92; made 10% smaller). */
const ITEM_SIZE = 0.83;
/** How far it bobs, as a share of a tile, and how fast (2.2 gives one slow bob about every 3 seconds). */
const ITEM_BOB = 0.05;
const ITEM_BOB_RATE = 2.2;
/** the dark colour icons are drawn in on a power-up tile */
const ICON_DARK = '#0b0e18';

/** A power-up as it lies on the floor, on its own: its coloured square, `size` across at (x, y), with its icon. */
export function drawItemTile(ctx: Ctx, kind: ItemKind, x: number, y: number, size: number): void {
  ctx.fillStyle = ITEM_COLOR[kind];
  rr(ctx, x, y, size, size, size * 0.12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = Math.max(1, size * 0.05);
  ctx.stroke();
  drawItemIcon(ctx, kind, x + size / 2, y + size / 2, size * 0.36, ICON_DARK);
}

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
  } else if (kind === 'laptop') {
    // an open laptop, with a little plane on its screen (it flies one)
    rr(ctx, -r * 0.66, -r * 0.78, r * 1.32, r * 0.98, r * 0.12);
    ctx.fill();
    ctx.fillStyle = hole;
    rr(ctx, -r * 0.52, -r * 0.64, r * 1.04, r * 0.7, r * 0.06);
    ctx.fill();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(-r * 0.84, r * 0.3);
    ctx.lineTo(r * 0.84, r * 0.3);
    ctx.lineTo(r * 0.98, r * 0.62);
    ctx.lineTo(-r * 0.98, r * 0.62);
    ctx.closePath();
    ctx.fill();
    // the plane on the screen: a body, swept wings and a tail, flying up and right
    ctx.save();
    ctx.translate(0, -r * 0.29);
    ctx.rotate(-Math.PI / 4);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.3, r * 0.065, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(r * 0.06, 0);
    ctx.lineTo(-r * 0.1, -r * 0.27);
    ctx.lineTo(-r * 0.04, 0);
    ctx.lineTo(-r * 0.1, r * 0.27);
    ctx.closePath();
    ctx.moveTo(-r * 0.2, 0);
    ctx.lineTo(-r * 0.29, -r * 0.11);
    ctx.lineTo(-r * 0.25, 0);
    ctx.lineTo(-r * 0.29, r * 0.11);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
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
/** One blast tile's line, from (x1, y1) to (x2, y2), in pixels: its arm, or a short cross at the centre. */
function flameLine(f: World['flames'][number], T: number): [number, number, number, number][] {
  const cx = (f.cx + 0.5) * T;
  const cy = (f.cy + 0.5) * T;
  const h = T / 2;
  if (f.kind === 'c') return [[cx - h * 0.25, cy, cx + h * 0.25, cy], [cx, cy - h * 0.25, cx, cy + h * 0.25]];
  if (f.tip) {
    const reach = 0.3;
    if (f.tip === 4) return [[cx - h, cy, cx + h * reach, cy]];
    if (f.tip === 3) return [[cx + h, cy, cx - h * reach, cy]];
    if (f.tip === 2) return [[cx, cy - h, cx, cy + h * reach]];
    return [[cx, cy + h, cx, cy - h * reach]];
  }
  return f.kind === 'h' ? [[cx - h, cy, cx + h, cy]] : [[cx, cy - h, cx, cy + h]];
}

// ---------------------------------------------------------------- breaking blocks

/**
 * A breakable block breaking (the owner's ask, November 2026: a realistic crumbling effect; it used to flash
 * white and vanish). Over the time a blast lasts (FLAME_TICKS) the block shudders and cracks, then collapses:
 * its own picture is cut into chunks that come down in one of four ways (see below), settling as rubble,
 * with a few small pieces knocked off on every side and a low cloud of dust. Bricks break into blue-grey rubble, crates into splinters and
 * planks with tan dust. All of it from the block's own picture, so it matches whatever the block looks like.
 */
function drawCrumble(ctx: Ctx, b: { cx: number; cy: number; ttl: number }, T: number, time: number): void {
  const west = mapNow === 'western';
  const e = 1 - b.ttl / FLAME_TICKS; // 0 as it is hit, 1 as it is gone
  const x0 = b.cx * T;
  const y0 = b.cy * T;
  const v = softVariant(b.cx, b.cy);
  const img = Number.isInteger(T) && T <= 200 ? softSprite(mapNow, T, v) : null;
  const seed = b.cx * 12.9 + b.cy * 78.2;
  const CRACK = 0.16; // the share of the time it shudders before it bursts
  ctx.save();
  const base = ctx.getTransform();
  if (e < CRACK || !img) {
    // shuddering, with cracks spreading over it
    const j = Math.max(1, T * 0.03) * (e / CRACK);
    const dx = Math.round(Math.sin(time * 90 + seed) * j);
    const dy = Math.round(Math.cos(time * 77 + seed) * j);
    if (img) ctx.drawImage(img, x0 + dx, y0 + dy);
    else drawSoft(ctx, x0 + dx, y0 + dy, T, mapNow, v);
    ctx.strokeStyle = west ? 'rgba(40,20,6,0.85)' : 'rgba(12,14,30,0.85)';
    ctx.lineWidth = Math.max(1, T * 0.03);
    ctx.lineCap = 'round';
    const grow = Math.min(1, e / CRACK + 0.25);
    for (let c = 0; c < 4; c++) {
      const a = (c / 4) * Math.PI * 2 + scatter(seed + c) * 1.2;
      ctx.beginPath();
      ctx.moveTo(x0 + dx + T / 2, y0 + dy + T / 2);
      const mx = T / 2 + Math.cos(a) * T * 0.25 * grow;
      const my = T / 2 + Math.sin(a) * T * 0.25 * grow;
      ctx.lineTo(x0 + dx + mx + Math.cos(a + 0.6) * T * 0.06, y0 + dy + my + Math.sin(a + 0.6) * T * 0.06);
      ctx.lineTo(x0 + dx + T / 2 + Math.cos(a) * T * 0.48 * grow, y0 + dy + T / 2 + Math.sin(a) * T * 0.48 * grow);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }
  const u = (e - CRACK) / (1 - CRACK); // 0 as it bursts, 1 as the last of it fades
  // dust rolling out from where it stood
  const dust = west ? [196, 160, 110] : [128, 140, 182];
  for (let d = 0; d < 4; d++) {
    const a = (d / 4) * Math.PI * 2 + scatter(seed + d * 3) * 1.4;
    const r = T * (0.1 + 0.25 * Math.sqrt(u));
    const size = T * (0.35 + 0.35 * u) * (0.8 + 0.4 * scatter(seed + d));
    const cx = x0 + T / 2 + Math.cos(a) * r;
    const cy = y0 + T * 0.55 + Math.sin(a) * r * 0.8;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, size);
    const al = 0.28 * (1 - u) * Math.min(1, u * 6 + 0.3);
    grad.addColorStop(0, `rgba(${dust[0]},${dust[1]},${dust[2]},${al})`);
    grad.addColorStop(1, `rgba(${dust[0]},${dust[1]},${dust[2]},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(cx - size, cy - size, size * 2, size * 2);
  }
  // The pieces come from the block's own picture. How it comes apart is one of four ways,
  // picked by the tile (so blocks breaking side by side differ), each a collapse in place, not a blast:
  //   0 slump:    it sags and spreads out on every side, like a pile settling
  //   1 cave in:  the middle gives way, pieces drop in towards the centre and heap there
  //   2 topple:   it leans and goes over one way (any of four), the far side sliding furthest
  //   3 split:    it cracks down the middle and the two halves fall apart, crumbling as they go
  // Pieces do not all go at once: each starts at its own moment, sinks (shrinks) as it falls to the floor,
  // tips, gathers dust and fades as rubble. (The owner's ask, November 2026: collapsing and crumbling in
  // almost all directions, in a few different ways at random. It first burst outwards and up, then fell
  // straight down.)
  const way = Math.floor(scatter(seed + 0.77) * 4);
  const side = Math.floor(scatter(seed + 0.31) * 4); // topple: which way; split: across or down
  const tdx = [0, 1, 0, -1][side];
  const tdy = [-1, 0, 1, 0][side];
  // The pieces (the owner's ask: rocks of all sizes and shapes, and more of them): on a jittered 5 by 5 grid
  // over the block, each a rough stone of five to seven corners, from crumbs to chunks a third of the block
  // across, cut from the block's own picture where it lay. Then a scatter of grit.
  const N = 5;
  for (let k = 0; k < N * N + 10; k++) {
    const s = seed + k * 2.37;
    const grit = k >= N * N;
    const gx = grit ? scatter(s + 0.1) * N : (k % N) + 0.15 + scatter(s + 0.1) * 0.7;
    const gy = grit ? scatter(s + 0.2) * N : Math.floor(k / N) + 0.15 + scatter(s + 0.2) * 0.7;
    const hx = (gx / N) * T; // where it was, in the block
    const hy = (gy / N) * T;
    const big = scatter(s + 0.3);
    const rad = grit ? T * (0.025 + 0.025 * big) : T * (0.09 + 0.14 * big * big + 0.04 * scatter(s + 0.4));
    const ox = (hx / T) * 2 - 1; // -1 to 1 across the block
    const oy = (hy / T) * 2 - 1;
    // its own moment to go (the small ones first), then gathering speed until it lies still
    const delay = scatter(s + 7) * 0.3 * (grit ? 0.4 : 1);
    const v = Math.min(1, Math.max(0, (u - delay) / 0.6));
    const fall = v * v * (3 - 2 * v);
    let mx: number;
    let my: number;
    if (way === 0) {
      mx = ox * 0.24;
      my = oy * 0.2 + 0.06;
    } else if (way === 1) {
      mx = -ox * 0.16;
      my = -oy * 0.14 + 0.08;
    } else if (way === 2) {
      const far = (ox * tdx + oy * tdy + 1) / 2; // 0 on the near side, 1 on the far side
      mx = tdx * (0.08 + 0.38 * far) + ox * 0.06;
      my = tdy * (0.08 + 0.38 * far) + oy * 0.05 + 0.04;
    } else {
      const across = side % 2 === 0;
      mx = across ? Math.sign(ox) * 0.22 + ox * 0.06 : ox * 0.08;
      my = across ? oy * 0.08 + 0.05 : Math.sign(oy) * 0.2 + oy * 0.05;
    }
    // small stones roll further than big ones, and no two alike
    const roll = grit ? 1.8 : 1.25 - big * 0.5;
    mx = mx * roll + (scatter(s + 1) - 0.5) * 0.14;
    my = my * roll + (scatter(s + 2) - 0.5) * 0.12;
    const px = x0 + hx + mx * T * fall;
    const py = y0 + hy + my * T * fall;
    const turn = (scatter(s + 4) - 0.5) * 2 * fall;
    const shrink = 1 - (0.12 + 0.15 * scatter(s + 5)) * fall; // sinking to the floor, wearing smaller
    const alpha = u < 0.62 ? 1 : 1 - (u - 0.62) / 0.38;
    ctx.globalAlpha = alpha;
    ctx.translate(px, py);
    ctx.rotate(turn);
    ctx.scale(shrink, shrink);
    // its outline: a rough stone
    const corners = 5 + Math.floor(scatter(s + 6) * 3);
    ctx.beginPath();
    for (let c = 0; c < corners; c++) {
      const a = (c / corners) * Math.PI * 2 + scatter(s + c) * 0.5;
      const r = rad * (0.65 + 0.5 * scatter(s + c * 1.7 + 3));
      const vx = Math.cos(a) * r;
      const vy = Math.sin(a) * r * (0.75 + 0.4 * scatter(s + 8));
      if (c) ctx.lineTo(vx, vy);
      else ctx.moveTo(vx, vy);
    }
    ctx.closePath();
    ctx.save();
    ctx.clip();
    // the block's picture as it lay under this stone (grit takes a darker look of it)
    ctx.drawImage(img, -hx, -hy);
    ctx.fillStyle = `rgba(${dust[0] * 0.35},${dust[1] * 0.35},${dust[2] * 0.35},${(grit ? 0.3 : 0.04) + 0.16 * fall})`;
    ctx.fillRect(-rad * 1.3, -rad * 1.3, rad * 2.6, rad * 2.6);
    // lit on its upper left, shaded below: a stone, not a flat cut-out
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(-rad * 1.3, -rad * 1.3, rad * 2.6, rad * 0.9);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(-rad * 1.3, rad * 0.35, rad * 2.6, rad);
    ctx.restore();
    ctx.setTransform(base);
  }
  // a few small pieces knocked off, skittering out in other directions
  ctx.fillStyle = west ? '#c99554' : '#8d9cd0';
  for (let c = 0; c < 6; c++) {
    const s = seed + c * 9.7;
    const a = ((c + scatter(s) * 0.8) / 6) * Math.PI * 2; // (spread round every side)
    const dist = T * (0.3 + 0.35 * scatter(s + 1)) * (1 - (1 - u) * (1 - u));
    const hop = Math.sin(Math.min(1, u * 1.8) * Math.PI) * T * 0.08;
    const sz = Math.max(1, T * (0.035 + 0.03 * scatter(s + 2)));
    ctx.globalAlpha = u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4;
    ctx.fillRect(x0 + T / 2 + Math.cos(a) * dist - sz / 2, y0 + T / 2 + Math.sin(a) * dist * 0.8 - hop - sz / 2, sz, sz * (west ? 2.2 : 1));
  }
  ctx.restore();
}

// ---------------------------------------------------------------- fire

/**
 * Fire, as real flames look (the owner's ask, November 2026: "ultra realistic, like real life"). Real fire is
 * many soft, ragged tongues of glowing gas, white-yellow where it is hottest at the base, orange, then deep
 * red at the edges where it cools, rising and curling as it goes, with smoke above and sparks thrown off.
 * Drawn here as particles: a few soft pictures of a lick of flame and a puff of smoke, made once from noise
 * (`fireSprites`), stamped many times a frame, each rising, swelling and cooling over its short life. A blast
 * lives under half a second, so each flame tile is born, roars and dies away in that time.
 */
const SPRITE_PX = 96;
interface FireSprites {
  hot: HTMLCanvasElement[];
  cool: HTMLCanvasElement[];
  smoke: HTMLCanvasElement[];
  glow: HTMLCanvasElement;
  /** the colour of its sparks */
  spark: string;
}
/** Made once for each colour of fire (by robot colour id, or 'classic' for orange fire). */
const fireCache = new Map<string, FireSprites>();

/** Heat to colour: [heat 0 to 1, red, green, blue], from the cool edge to the white-hot heart. */
type Ramp = [number, number, number, number][];
/** Fire as it really is: deep red, orange, yellow, white. */
const CLASSIC_RAMP: Ramp = [
  [0.0, 110, 12, 2],
  [0.22, 196, 38, 6],
  [0.42, 246, 98, 14],
  [0.62, 255, 166, 40],
  [0.8, 255, 222, 120],
  [1.0, 255, 250, 228],
];
/**
 * Each robot's fire (the owner's ask, November 2026: fire the colour of the player, still realistic): the
 * colour flames burn in, a little deeper than the robot's glow so it reads as fire and not as light. Black
 * burns a smoky steel and White an icy white, so the two can be told apart.
 */
const FIRE_HUE: Record<string, string> = {
  gold: '#ffb02e',
  black: '#7c86a0',
  pink: '#ff3fae',
  blue: '#2ea8ff',
  red: '#ff2a2a',
  orange: '#ff6f14',
  white: '#dce8ff',
  green: '#2cf06c',
  purple: '#9a62ff',
};
/** Off: each blast burns in its robot's colour. On: every blast is ordinary orange fire (Settings › Graphics). */
let orangeFire = false;
export function setOrangeFire(on: boolean): void {
  orangeFire = on;
}
/** The same build of heat as real fire, in one colour: dark at the edge, that colour, then towards white at the heart. */
function rampOf(hex: string): Ramp {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const at = (h: number, dark: number, white: number): [number, number, number, number] => {
    const [r, g, b] = c.map((v) => v * dark + (255 - v * dark) * white);
    return [h, r, g, b];
  };
  return [at(0.0, 0.3, 0), at(0.22, 0.62, 0), at(0.42, 0.95, 0.04), at(0.62, 1, 0.25), at(0.8, 1, 0.55), at(1.0, 1, 0.88)];
}

/** Smooth value noise in 2-D, 0 to 1, from `scatter` on a grid (the same every time: no Math.random). */
function noise2(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const h = (i: number, j: number): number => scatter(i * 127.1 + j * 311.7 + seed * 74.7);
  const a = h(xi, yi) + (h(xi + 1, yi) - h(xi, yi)) * u;
  const b = h(xi, yi + 1) + (h(xi + 1, yi + 1) - h(xi, yi + 1)) * u;
  return a + (b - a) * v;
}
function fbm(x: number, y: number, seed: number): number {
  return noise2(x, y, seed) * 0.55 + noise2(x * 2.1, y * 2.1, seed + 1) * 0.3 + noise2(x * 4.3, y * 4.3, seed + 2) * 0.15;
}

/**
 * One picture: a lick of flame (taller than wide, ragged, hottest low in its middle), or a puff of smoke.
 * `cool`: the colours a flame has as it dies (no white heart, more red).
 */
function makeSprite(kind: 'hot' | 'cool' | 'smoke', seed: number, stops: Ramp = CLASSIC_RAMP): HTMLCanvasElement {
  const n = SPRITE_PX;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  const img = g.createImageData(n, n);
  const d = img.data;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = (x / (n - 1)) * 2 - 1; // -1 to 1 across
      const w = (y / (n - 1)) * 2 - 1; // -1 top to 1 bottom
      let heat: number;
      if (kind === 'smoke') {
        const r = Math.hypot(u, w) + (fbm(x / 14, y / 14, seed) - 0.5) * 0.7;
        heat = Math.max(0, 1 - r);
      } else {
        // a flame: narrower towards its top, its edge eaten by noise that streams upwards
        const width = 0.55 + 0.4 * ((w + 1) / 2); // wider at the bottom
        const r = Math.hypot(u / width, (w - 0.25) / 1.15);
        const eat = (fbm(x / 11, y / 7 + seed, seed) - 0.5) * 0.9;
        heat = Math.max(0, 1 - r + eat * (0.4 + 0.6 * (1 - (w + 1) / 2)));
      }
      const i = (y * n + x) * 4;
      if (heat <= 0) continue;
      let R: number, G: number, B: number, A: number;
      if (kind === 'smoke') {
        R = 46;
        G = 42;
        B = 40;
        A = Math.min(1, heat * 1.4) * 0.55;
      } else {
        // the colour of fire by its heat: deep red, orange, yellow, white (cooler for a dying flame)
        const h = kind === 'cool' ? heat * 0.72 : heat;
        let k = 0;
        while (k < stops.length - 2 && h > stops[k + 1][0]) k++;
        const [h0, r0, g0, b0] = stops[k];
        const [h1, r1, g1, b1] = stops[k + 1];
        const f = Math.min(1, Math.max(0, (h - h0) / (h1 - h0)));
        R = r0 + (r1 - r0) * f;
        G = g0 + (g1 - g0) * f;
        B = b0 + (b1 - b0) * f;
        A = Math.min(1, heat * 2.6);
      }
      d[i] = R;
      d[i + 1] = G;
      d[i + 2] = B;
      d[i + 3] = A * 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}
/** The pictures one colour of fire is drawn with: `colorId` a robot's colour, or 'classic' for orange fire. */
function fireSprites(colorId = 'classic'): FireSprites {
  const key = FIRE_HUE[colorId] ? colorId : 'classic';
  let f = fireCache.get(key);
  if (!f) {
    const ramp = key === 'classic' ? CLASSIC_RAMP : rampOf(FIRE_HUE[key]);
    const rgb = (k: number, a: number): string => `rgba(${ramp[k][1] | 0},${ramp[k][2] | 0},${ramp[k][3] | 0},${a})`;
    const glow = document.createElement('canvas');
    glow.width = glow.height = 64;
    const gg = glow.getContext('2d')!;
    const grad = gg.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, rgb(3, 0.5));
    grad.addColorStop(0.35, rgb(2, 0.24));
    grad.addColorStop(0.7, rgb(1, 0.07));
    grad.addColorStop(1, rgb(1, 0));
    gg.fillStyle = grad;
    gg.fillRect(0, 0, 64, 64);
    // (the smoke is the same for every colour: made once and shared)
    const smoke = key === 'classic' ? [8, 9, 10].map((sd) => makeSprite('smoke', sd)) : fireSprites('classic').smoke;
    f = {
      hot: [1, 2, 3, 4].map((sd) => makeSprite('hot', sd, ramp)),
      cool: [5, 6, 7].map((sd) => makeSprite('cool', sd, ramp)),
      smoke,
      glow,
      spark: rgb(4, 1),
    };
    fireCache.set(key, f);
  }
  return f;
}
/** The fire a blast of `owner`'s burns with. */
function fireOf(world: World, owner: number): FireSprites {
  return fireSprites(orangeFire ? 'classic' : (world.players[owner]?.colorId ?? 'classic'));
}

/** A soft round glow in one colour (whose blast it is), made once per colour. */
const tints = new Map<string, HTMLCanvasElement>();
function tintGlow(col: string): HTMLCanvasElement {
  let c = tints.get(col);
  if (!c) {
    c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, col);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = 0.35;
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    tints.set(col, c);
  }
  return c;
}

/** The blasts, drawn as fire (see where drawDynamic calls it, and `fireSprites`). */
function drawFire(ctx: Ctx, world: World, T: number, time: number, west: boolean): void {
  if (!world.flames.length) return;
  ctx.save();
  const stamp = (img: HTMLCanvasElement, x: number, y: number, w: number, h: number, turn: number): void => {
    if (w < 0.5 || h < 0.5) return;
    if (turn) {
      ctx.translate(x, y);
      ctx.rotate(turn);
      ctx.drawImage(img, -w / 2, -h * 0.62, w, h);
      ctx.setTransform(baseTf);
    } else ctx.drawImage(img, x - w / 2, y - h * 0.62, w, h);
  };
  const baseTf = ctx.getTransform();
  // each tile: where along its line the fire sits, how far through its life it is
  const tiles = world.flames.map((f) => {
    const t = f.ttl / FLAME_TICKS; // 1 when it bursts, 0 as it dies
    const life = 1 - t;
    const k = Math.sqrt(t > 0.85 ? (1 - t) / 0.15 : t / 0.85); // bursts fast, then dies down
    const pts: [number, number][] = [];
    for (const [x1, y1, x2, y2] of flameLine(f, T)) {
      const n = 3;
      for (let i = 0; i <= n; i++) pts.push([x1 + ((x2 - x1) * i) / n, y1 + ((y2 - y1) * i) / n]);
    }
    return { f, t, life, k, pts, seed: f.cx * 13.1 + f.cy * 7.7, sp: fireOf(world, f.owner) };
  });

  // scorch and the shadow of smoke on the ground
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = west ? 'rgba(30,10,2,0.42)' : 'rgba(8,5,4,0.4)';
  for (const { pts, k } of tiles) {
    for (const [x, y] of pts) {
      ctx.beginPath();
      ctx.arc(x, y + T * 0.05, T * 0.42 * Math.max(0.4, k), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // the light it throws on the ground round it
  ctx.globalCompositeOperation = 'lighter';
  for (const { pts, k, sp } of tiles) {
    // (one per tile, at its middle: soft enough that the tiles of a blast run into one light)
    const [x, y] = pts[Math.floor(pts.length / 2)];
    ctx.globalAlpha = 0.5 * k;
    ctx.drawImage(sp.glow, x - T * 0.9, y - T * 0.9, T * 1.8, T * 1.8);
  }
  // orange fire: a faint glow in the colour of whoever placed the bomb, so it is still clear whose blast it is
  // (fire in the robot's own colour says so already)
  for (const { f, pts, k } of orangeFire ? tiles : []) {
    const tint = tintGlow(colorById(world.players[f.owner]?.colorId ?? 'gold').glow);
    const [x, y] = pts[Math.floor(pts.length / 2)];
    ctx.globalAlpha = 0.6 * k;
    ctx.drawImage(tint, x - T * 0.8, y - T * 0.8, T * 1.6, T * 1.6);
  }

  // the flames: tongues that rise, swell, curl and cool over their short lives, many of them overlapping
  ctx.globalCompositeOperation = 'source-over';
  for (const { pts, k, t, seed, sp } of tiles) {
    pts.forEach(([x, y], i) => {
      for (let j = 0; j < 2; j++) {
        const s = seed + i * 3.3 + j * 1.7;
        // each tongue lives about a fifth of a second and is born again, at its own moment
        const p = (time * 5.2 + scatter(s)) % 1;
        const rise = p * T * 0.42;
        const sway = Math.sin(time * 7 + s * 5) * T * 0.07 * p;
        const size = T * (0.72 + 0.5 * scatter(s + 9)) * (0.75 + 0.5 * p) * k;
        const cool = p > 0.55 || t < 0.3;
        const set = cool ? sp.cool : sp.hot;
        const img = set[Math.floor(scatter(s + 2) * set.length) % set.length];
        ctx.globalAlpha = Math.min(1, (1 - p) * 1.6) * Math.min(1, k * 1.5);
        stamp(img, x + sway + (scatter(s + 4) - 0.5) * T * 0.18, y - rise, size * 0.8, size * 1.15, (scatter(s + 6) - 0.5) * 0.5);
      }
    });
  }
  // the white-hot heart, added on as light
  ctx.globalCompositeOperation = 'lighter';
  for (const { pts, k, t, seed, sp } of tiles) {
    if (t < 0.25) continue;
    pts.forEach(([x, y], i) => {
      if (i % 2) return; // (every other point is enough for the heart)
      const s = seed + i * 5.1;
      const img = sp.hot[i % sp.hot.length];
      ctx.globalAlpha = 0.45 * k * (0.75 + 0.25 * Math.sin(time * 23 + s));
      stamp(img, x, y + T * 0.04, T * 0.5 * k, T * 0.62 * k, 0);
    });
  }
  // smoke: dark puffs rising off it, more of it as the fire dies
  ctx.globalCompositeOperation = 'source-over';
  for (const { pts, life, seed, sp } of tiles) {
    for (let j = 0; j < 1; j++) {
      const [x, y] = pts[(j * 2 + 1) % pts.length];
      const s = seed + j * 4.4;
      const p = (life * 1.4 + scatter(s) * 0.3) % 1;
      const img = sp.smoke[j % sp.smoke.length];
      ctx.globalAlpha = Math.sin(Math.PI * Math.min(1, p)) * (0.25 + 0.5 * life);
      const size = T * (0.5 + 0.7 * p);
      stamp(img, x + Math.sin(time * 2 + s) * T * 0.08, y - T * (0.3 + 0.7 * p), size, size, 0);
    }
  }
  // sparks thrown up and out
  ctx.globalCompositeOperation = 'lighter';
  for (const { f, t, life, sp } of tiles) {
    ctx.fillStyle = sp.spark;
    for (let e = 0; e < 3; e++) {
      const s = f.cx * 5.3 + f.cy * 8.9 + e * 2.1;
      const age = (life * 1.6 + scatter(s) * 0.6) % 1;
      const dx = (scatter(s + 1) - 0.5) * T * 0.9 * age;
      const x = (f.cx + 0.5) * T + dx;
      const y = (f.cy + 0.5) * T - age * T * (0.6 + 0.6 * scatter(s + 3)) + age * age * T * 0.25;
      ctx.globalAlpha = Math.max(0, 1 - age) * Math.min(1, t * 4);
      ctx.beginPath();
      ctx.arc(x, y, T * 0.022 * (1 - age * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

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
      if (world.tiles[y * world.w + x] !== SOFT) continue;
      // (a block that is breaking is drawn every frame instead, crumbling: drawCrumble)
      if (world.burning.some((b) => b.cx === x && b.cy === y)) continue;
      drawSoft(ctx, x * T, y * T, T, mapNow, softVariant(x, y));
    }
  }
}
/** Which of the four looks a breakable block at (x, y) has, so neighbours differ. */
export function softVariant(x: number, y: number): number {
  return Math.floor(scatter(x * 3.17 + y * 7.31 + 0.4) * 4);
}
/** A number that is different whenever the arena's blocks are (so drawGround's picture would be too). */
export function groundKey(world: World): number {
  const t = world.tiles;
  let h = world.w * 131 + world.h;
  for (let i = 0; i < t.length; i++) h = (Math.imul(h, 31) + t[i]) | 0;
  for (const b of world.burning) h = (Math.imul(h, 37) + b.cy * world.w + b.cx + 7) | 0; // (breaking blocks leave the picture)
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
  for (const b of world.burning) drawCrumble(ctx, b, T, time);

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

  // blasts: fire (the owner's ask, November 2026, for more realistic fire; it was three bars of light in the
  // bomb owner's colour). Each tile of a blast is a row of flickering balls of flame along its line, red at
  // the edge, orange, then yellow-white at the heart, with tongues licking upwards and embers rising, over a
  // scorch of smoke. A faint glow round it in the colour of whoever placed the bomb still says whose it is.
  drawFire(ctx, world, T, time, west);

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

  // the falling blocks themselves, over everything: larger while high up, speeding up as they drop. Each comes
  // in from its own side of the arena, from outside, so it never hides the open floor it is closing in on (the
  // owner's ask, 23 November 2026; they all came down from above, over the floor below them): the top row's
  // fall downwards, the right side's to the left, the bottom row's upwards, the left side's to the right
  for (const f of world.falling) {
    const e = 1 - Math.max(0, f.landAt - world.tick) / FALL_TICKS;
    const high = 1 - e * e; // 1 at the top, 0 on the floor
    const size = T * (1 + 0.3 * high);
    const [ox, oy] = fallFrom(world, f.cx, f.cy);
    const px = f.cx * T - (size - T) / 2 + ox * high * T * 2.4;
    const py = f.cy * T - (size - T) / 2 + oy * high * T * 2.4;
    ctx.save();
    ctx.globalAlpha = Math.min(1, 0.35 + e * 1.3);
    drawHard(ctx, px, py, size);
    ctx.restore();
  }

  // the laptops' planes, and the bombs falling from them, highest of all
  drawSkies(ctx, world, T, time);
}

/**
 * Planes (the laptop power-up) and the bombs falling from them. Seen from above: a plane is drawn over the
 * point it flies over, in its pilot's colours, with its shadow on the floor a little way off (the light is from
 * the top left). A bomb let go is drawn over the point it is falling to, shrinking as it falls away, with no
 * shadow and nothing to say where it will land (the owner's design: it should not be easy to hit with). Near an
 * edge of the map, where the plane wraps round, it is drawn at both sides.
 */
function drawSkies(ctx: Ctx, world: World, T: number, time: number): void {
  const W = world.w * T;
  const H = world.h * T;
  // the place and its copies across the edges it is close to
  const spots = (x: number, y: number, reach: number): [number, number][] => {
    const xs = [x, ...(x < reach ? [x + W] : []), ...(x > W - reach ? [x - W] : [])];
    const ys = [y, ...(y < reach ? [y + H] : []), ...(y > H - reach ? [y - H] : [])];
    return xs.flatMap((a) => ys.map((b): [number, number] => [a, b]));
  };
  for (const d of world.drops) {
    const e = 1 - d.t / DROP_TICKS; // 0 as it leaves the plane, 1 as it lands
    const spin = Math.atan2(d.vy, d.vx);
    const owner = world.players[d.owner];
    const glow = owner ? colorById(owner.colorId).glow : '#ffffff';
    for (const [x, y] of spots((d.x + 0.5) * T, (d.y + 0.5) * T, T)) drawFallingBomb(ctx, x, y, T * (0.3 - 0.11 * e), spin, glow, time);
  }
  for (const p of world.players) {
    if (!p.alive || p.flying <= 0) continue;
    const col = colorById(p.colorId);
    const heading = (p.planeDir / TURN_STEPS) * Math.PI * 2;
    for (const [x, y] of spots((p.planeX + 0.5) * T, (p.planeY + 0.5) * T, T * 1.2)) drawPlane(ctx, x, y, T, heading, col, time, p.flying);
  }
}

/**
 * The side a falling block on (cx, cy) comes in from, as a step outwards: the ring of the arena it is in decides
 * (top row [0, -1], bottom row [0, 1], left side [-1, 0], right side [1, 0]; a corner goes with its row).
 */
export function fallFrom(world: World, cx: number, cy: number): [number, number] {
  const ring = Math.min(cx, cy, world.w - 1 - cx, world.h - 1 - cy);
  if (cy === ring) return [0, -1];
  if (cy === world.h - 1 - ring) return [0, 1];
  if (cx === ring) return [-1, 0];
  return [1, 0];
}

/** A bomb falling from a plane, seen from above, `r` across its body: an iron body, four tail fins behind it, its owner's colour round it. */
function drawFallingBomb(ctx: Ctx, x: number, y: number, r: number, spin: number, glow: string, time: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(spin + Math.sin(time * 18) * 0.12);
  // the fins: a cross behind the body
  ctx.fillStyle = '#2b2f3a';
  ctx.strokeStyle = '#0b0d12';
  ctx.lineWidth = Math.max(1, r * 0.12);
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(-r * 0.55, s * r * 0.18);
    ctx.lineTo(-r * 1.35, s * r * 0.78);
    ctx.lineTo(-r * 1.5, s * r * 0.5);
    ctx.lineTo(-r * 1.2, s * r * 0.08);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  // the body: a fat iron teardrop, nose first
  const g = ctx.createRadialGradient(r * 0.25, -r * 0.3, r * 0.1, 0, 0, r * 1.1);
  g.addColorStop(0, '#6c7280');
  g.addColorStop(0.45, '#262a33');
  g.addColorStop(1, '#0b0d12');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 1.05, r * 0.82, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.1);
  ctx.stroke();
  // a band of its owner's colour
  ctx.strokeStyle = glow;
  ctx.lineWidth = Math.max(1, r * 0.2);
  ctx.beginPath();
  ctx.ellipse(-r * 0.32, 0, r * 0.14, r * 0.74, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * A plane seen from above at (x, y), flying `heading` (radians, clockwise from right), about a tile across
 * the wings: the body and wings in its pilot's armour colour, dark glass, a spinning propeller, the pilot's glow
 * on the wing tips, and its shadow on the floor. It blinks as its flight runs out.
 */
function drawPlane(ctx: Ctx, x: number, y: number, T: number, heading: number, c: BotColor, time: number, left: number): void {
  if (left < 90 && Math.floor(left / 6) % 2 === 0) return; // (the last second and a half: going home)
  const s = T;
  const shape = (): void => {
    // body
    ctx.beginPath();
    ctx.moveTo(s * 0.5, 0);
    ctx.bezierCurveTo(s * 0.46, -s * 0.09, s * 0.2, -s * 0.1, -s * 0.1, -s * 0.07);
    ctx.lineTo(-s * 0.44, -s * 0.035);
    ctx.lineTo(-s * 0.44, s * 0.035);
    ctx.lineTo(-s * 0.1, s * 0.07);
    ctx.bezierCurveTo(s * 0.2, s * 0.1, s * 0.46, s * 0.09, s * 0.5, 0);
    ctx.closePath();
    // wings, swept back a little
    ctx.moveTo(s * 0.16, -s * 0.06);
    ctx.lineTo(-s * 0.04, -s * 0.52);
    ctx.lineTo(-s * 0.16, -s * 0.52);
    ctx.lineTo(-s * 0.12, -s * 0.06);
    ctx.closePath();
    ctx.moveTo(s * 0.16, s * 0.06);
    ctx.lineTo(-s * 0.04, s * 0.52);
    ctx.lineTo(-s * 0.16, s * 0.52);
    ctx.lineTo(-s * 0.12, s * 0.06);
    ctx.closePath();
    // tail
    ctx.moveTo(-s * 0.3, -s * 0.03);
    ctx.lineTo(-s * 0.42, -s * 0.2);
    ctx.lineTo(-s * 0.48, -s * 0.2);
    ctx.lineTo(-s * 0.44, -s * 0.03);
    ctx.closePath();
    ctx.moveTo(-s * 0.3, s * 0.03);
    ctx.lineTo(-s * 0.42, s * 0.2);
    ctx.lineTo(-s * 0.48, s * 0.2);
    ctx.lineTo(-s * 0.44, s * 0.03);
    ctx.closePath();
  };
  // its shadow on the floor, down and to the right
  ctx.save();
  ctx.translate(x + s * 0.32, y + s * 0.46);
  ctx.rotate(heading);
  ctx.scale(0.86, 0.86);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  shape();
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  // a faint trail of air behind it
  const trail = ctx.createLinearGradient(-s * 1.4, 0, -s * 0.4, 0);
  trail.addColorStop(0, 'rgba(255,255,255,0)');
  trail.addColorStop(1, 'rgba(255,255,255,0.22)');
  ctx.fillStyle = trail;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(-s * 0.1, side * s * 0.49);
    ctx.lineTo(-s * 1.2, side * s * 0.5);
    ctx.lineTo(-s * 1.2, side * s * 0.47);
    ctx.lineTo(-s * 0.1, side * s * 0.47);
    ctx.closePath();
    ctx.fill();
  }
  // the plane, in the pilot's colours, with a dark edge so it reads over anything
  const g = ctx.createLinearGradient(0, -s * 0.5, 0, s * 0.5);
  g.addColorStop(0, c.light);
  g.addColorStop(0.5, c.body);
  g.addColorStop(1, c.dark);
  ctx.fillStyle = g;
  ctx.strokeStyle = '#0b0d14';
  ctx.lineWidth = Math.max(1, s * 0.035);
  ctx.lineJoin = 'round';
  shape();
  ctx.fill();
  ctx.stroke();
  // the cockpit's dark glass, with a glint
  ctx.fillStyle = '#10131c';
  ctx.beginPath();
  ctx.ellipse(s * 0.24, 0, s * 0.1, s * 0.045, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.ellipse(s * 0.27, -s * 0.015, s * 0.035, s * 0.012, 0, 0, Math.PI * 2);
  ctx.fill();
  // the pilot's glow on the wing tips
  ctx.fillStyle = c.glow;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(-s * 0.1, side * s * 0.5, s * 0.035, 0, Math.PI * 2);
    ctx.fill();
  }
  // a spinning propeller at the nose: a blur, with one blade showing
  ctx.fillStyle = 'rgba(230,236,255,0.28)';
  ctx.beginPath();
  ctx.ellipse(s * 0.52, 0, s * 0.03, s * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  const a = time * 40;
  ctx.strokeStyle = 'rgba(20,22,30,0.8)';
  ctx.lineWidth = Math.max(1, s * 0.03);
  ctx.beginPath();
  ctx.moveTo(s * 0.52, Math.sin(a) * s * 0.2);
  ctx.lineTo(s * 0.52, -Math.sin(a) * s * 0.2);
  ctx.stroke();
  ctx.restore();
}

/**
 * A robot holding a laptop (the power-up), drawn over it: in front of it facing you or to either side, out of
 * sight facing away. While its plane is up the screen glows brighter and signal waves rise over its helmet, so
 * it is plain that it is busy flying (and standing still). (x, y) is the robot's feet.
 */
function drawLaptopHeld(ctx: Ctx, p: Player, x: number, y: number, T: number, time: number): void {
  const col = colorById(p.colorId);
  const flying = p.flying > 0;
  const hy = y - T * 0.36; // about where its hands are
  const screen = flying ? 0.75 + 0.25 * Math.sin(time * 9) : 0.55;
  ctx.save();
  ctx.lineJoin = 'round';
  if (p.facing === 2) {
    // facing you: the back of the lid, the screen towards the robot, the keyboard's edge under it
    ctx.fillStyle = `rgba(150,180,255,${0.25 * screen})`; // the screen's light round the lid's edges
    rr(ctx, x - T * 0.24, hy - T * 0.25, T * 0.48, T * 0.3, T * 0.05);
    ctx.fill();
    ctx.fillStyle = '#3a4152';
    ctx.strokeStyle = '#0b0d14';
    ctx.lineWidth = Math.max(1, T * 0.025);
    rr(ctx, x - T * 0.2, hy - T * 0.22, T * 0.4, T * 0.25, T * 0.035);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#c9cfdc';
    rr(ctx, x - T * 0.23, hy + T * 0.02, T * 0.46, T * 0.055, T * 0.02);
    ctx.fill();
    ctx.stroke();
    // a glowing mark on the lid in the robot's colour
    ctx.fillStyle = col.glow;
    ctx.globalAlpha = 0.6 + 0.4 * screen;
    ctx.beginPath();
    ctx.arc(x, hy - T * 0.095, T * 0.035, 0, Math.PI * 2);
    ctx.fill();
  } else if (p.facing === 3 || p.facing === 4) {
    // to the side: the keyboard held out in front, the lid open towards the robot, its screen lit
    const d = p.facing === 4 ? 1 : -1;
    const fx = x + d * T * 0.3; // the far edge, where the lid is hinged
    ctx.strokeStyle = '#0b0d14';
    ctx.lineWidth = Math.max(1, T * 0.025);
    ctx.fillStyle = '#c9cfdc';
    rr(ctx, Math.min(fx, x + d * T * 0.02), hy, T * 0.28, T * 0.05, T * 0.02);
    ctx.fill();
    ctx.stroke();
    // the screen's face, lit, with its light spilling towards the robot (a soft shadow: iPhones have no blur filter)
    ctx.fillStyle = `rgba(175,208,255,${0.55 + 0.45 * screen})`;
    ctx.shadowColor = `rgba(140,180,255,${0.8 * screen})`;
    ctx.shadowBlur = T * 0.16;
    ctx.beginPath();
    ctx.moveTo(fx, hy);
    ctx.lineTo(fx - d * T * 0.08, hy - T * 0.26);
    ctx.lineTo(fx - d * T * 0.02, hy - T * 0.26);
    ctx.lineTo(fx + d * T * 0.04, hy);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#3a4152';
    ctx.beginPath();
    ctx.moveTo(fx + d * T * 0.04, hy);
    ctx.lineTo(fx - d * T * 0.02, hy - T * 0.26);
    ctx.lineTo(fx + d * T * 0.01, hy - T * 0.27);
    ctx.lineTo(fx + d * T * 0.07, hy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  if (flying) {
    // signal waves over the helmet: it is flying its plane
    const top = y + (ROBOT.top - 0.12) * T;
    ctx.strokeStyle = col.glow;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.5, T * 0.04);
    for (let i = 0; i < 3; i++) {
      const k = (time * 1.6 + i / 3) % 1;
      ctx.globalAlpha = (1 - k) * 0.9;
      ctx.beginPath();
      ctx.arc(x, top + T * 0.1, T * (0.06 + 0.16 * k), -Math.PI * 0.8, -Math.PI * 0.2);
      ctx.stroke();
    }
  }
  ctx.restore();
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
 * reaches the cap as the bomb goes off: 2.55 seconds from being dropped (FUSE_TICKS); a bomb that has been picked up was
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
  // the winner's dance (in a teams match its teammates dance it with it)
  if (world.over && world.over.winner >= 0) {
    const w = world.players[world.over.winner];
    for (const p of world.players) if (p === w || allies(p, w)) wanted.push({ c: colorById(p.colorId), kind: 'dance', moves: danceSamples(dance) });
  }
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

/**
 * A teams match: a ring on the floor round the robot's feet in its team's colour (TEAMS), so who is on whose
 * team can be seen at a glance. Inside it, a faint, dull wash of the same colour (the owner's ask).
 */
function drawTeamRing(ctx: Ctx, p: Player, x: number, y: number, T: number): void {
  const c = TEAMS[p.team]?.color ?? '#ffffff';
  const cy = y - T * 0.05;
  ctx.save();
  ctx.globalAlpha = p.safeTicks > 0 ? 0.45 : 0.9;
  ctx.beginPath();
  ctx.ellipse(x, cy, T * 0.4, T * 0.15, 0, 0, Math.PI * 2);
  ctx.fillStyle = dullWash(c);
  ctx.fill();
  ctx.strokeStyle = c;
  ctx.lineWidth = Math.max(1.5, T * 0.055);
  ctx.stroke();
  ctx.restore();
}
/** A colour greyed halfway and nearly see-through: the inside of a team ring. */
const washes = new Map<string, string>();
function dullWash(hex: string): string {
  let w = washes.get(hex);
  if (!w) {
    const n = parseInt(hex.slice(1), 16);
    const grey = (v: number): number => Math.round(v * 0.55 + 110 * 0.45);
    w = `rgba(${grey((n >> 16) & 255)},${grey((n >> 8) & 255)},${grey(n & 255)},0.32)`;
    washes.set(hex, w);
  }
  return w;
}

/** A robot on its tile; the winner celebrating; or, for a moment after being knocked out, its remains and its ghost. */
function drawPlayer(ctx: Ctx, world: World, p: Player, T: number, time: number, celebrate?: Celebration, crowned = -1): void {
  const col = colorById(p.colorId);
  const x = (p.x + 0.5) * T;
  const y = (p.y + 0.5) * T + T * 0.46;
  if (p.alive) {
    if (p.team >= 0 && !p.zombie) drawTeamRing(ctx, p, x, y, T);
    const won = world.players[celebrate?.player ?? -1];
    if (celebrate && won && (won === p || allies(won, p))) {
      // the winner: their victory dance (in a teams match, everyone on the winning side still standing)
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
      if (p.laptop) drawLaptopHeld(ctx, p, x, y, T, time);
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
