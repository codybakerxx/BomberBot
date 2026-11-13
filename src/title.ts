/**
 * The title screen's picture: drawn in code like everything else.
 *
 * Your robot, in the colour you have chosen, stands front and centre and waves now and then. Two rivals
 * stand a step behind it, and a bomb with a lit fuse sits at its feet. Behind them is a stretch of arena
 * (the game's own floor, solid blocks and bricks) that fades into the dark at the top and bottom, where the
 * name and the buttons go.
 *
 * The canvas covers the whole screen. The robots stand in `stage`: the part of the screen the page leaves
 * free between the name and the buttons (the element #titleStage in page.html). main.ts measures it and
 * hands it in.
 *
 * Reads nothing of the game and changes nothing: it is only a picture.
 */
import { type BotColor, colorById, drawRobot, drawBombArt, drawHard, drawSoft, forgetSprites, warmRobots } from './render';

type Ctx = CanvasRenderingContext2D;

/** A rectangle, in canvas pixels. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The rivals' colours, in order of preference: bright ones that stand out on the dark arena. */
const RIVALS = ['blue', 'pink', 'red', 'green', 'orange', 'purple', 'white', 'gold', 'black'];

/** How big a rival is next to your robot: they stand a step further back. */
const BACK = 0.72;
/** How far up the screen the rivals' feet are, in your robot's tiles: a step behind it. */
const BACK_RISE = 0.17;
/** How far either side of your robot the rivals stand, in your robot's tiles: partly behind it. */
const BACK_OUT = 0.64;
/** The arena behind them is drawn in tiles this share of your robot's tile. */
const FLOOR_TILE = 0.3;
/** The bomb, as a share of your robot's tile, and where its ball sits from your robot's feet. */
const BOMB_SIZE = 0.56;
const BOMB_AT: [number, number] = [-0.42, 0.1];
/** How much of the fuse is left: the spark burns there, flickering, but never reaches the cap. */
const FUSE_LEFT = 0.72;

/** The wave: every WAVE_EVERY seconds your robot raises the arm on the right of the picture and waves it. */
const WAVE_EVERY = 6.5;
const WAVE_FIRST = 1.6; // the first wave, this long after the title opens
const WAVE_UP = 0.28; // raising the arm
const WAVE_HOLD = 1.3; // waving it
const WAVE_DOWN = 0.3; // lowering it
const WAVE_RATE = 9; // how fast the hand goes to and fro, in radians a second

/** Your robot's two rivals: different from your colour and from each other. */
function rivalsOf(me: BotColor): [BotColor, BotColor] {
  const ids = RIVALS.filter((id) => id !== me.id);
  return [colorById(ids[0]), colorById(ids[1])];
}

/** How far the waving arm is raised, `t` seconds after the title opened: 0 hanging, 1 right up. */
function waveAt(t: number): number {
  if (t < WAVE_FIRST) return 0;
  const k = (t - WAVE_FIRST) % WAVE_EVERY;
  if (k < WAVE_UP) return k / WAVE_UP;
  if (k < WAVE_UP + WAVE_HOLD) return 0.82 + 0.18 * Math.cos((k - WAVE_UP) * WAVE_RATE);
  if (k < WAVE_UP + WAVE_HOLD + WAVE_DOWN) return 1 - (k - WAVE_UP - WAVE_HOLD) / WAVE_DOWN;
  return 0;
}

/** A number from 0 to 1 that is always the same for the same tile: which tiles of the backdrop have bricks. */
function hash(i: number, j: number): number {
  const v = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

/** Where everything goes for one size of screen and stage. */
interface Scene {
  /** your robot's feet, and the size of its tile */
  x: number;
  y: number;
  S: number;
  /** the rivals' tile size */
  t: number;
}

function sceneFor(stage: Box): Scene {
  // The group, in your robot's tiles from its feet: the rivals reach about 0.9 either side (BACK_OUT, plus
  // half a rival's width); the raised arm reaches about 1.3 up; the bomb's shadow about 0.3 down. It is as
  // big as the stage allows and sits in the middle of it.
  const S = Math.max(24, Math.min(stage.w / 1.95, stage.h / 1.65));
  const y = stage.y + stage.h / 2 + S * (1.3 - 0.3) / 2;
  return { x: stage.x + stage.w / 2, y, S, t: S * BACK };
}

/**
 * The arena behind the robots, with the dark coming in over it, drawn once for a size of screen and kept.
 * Tiles are counted from the rivals' feet: they stand on row 0, in columns -1 and 1.
 */
function drawBackdrop(g: Ctx, W: number, H: number, sc: Scene, me: BotColor, stage: Box): void {
  const t = Math.max(8, Math.round(sc.S * FLOOR_TILE));
  const ox = sc.x - t / 2; // the left edge of column 0, under your robot
  const oy = sc.y - t * 0.96; // the top edge of row 0, which your robot's feet are on (near the bottom of the tile, as in play)
  // the robots stand in an open corridor across the arena, from over the raised arm to under the bomb
  const clearUp = Math.ceil((sc.S * 1.3) / t);
  g.fillStyle = '#05060b';
  g.fillRect(0, 0, W, H);
  const i0 = Math.floor(-ox / t) - 1;
  const i1 = Math.ceil((W - ox) / t);
  const j0 = Math.floor(-oy / t) - 1;
  const j1 = Math.ceil((H - oy) / t);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const px = Math.round(ox + i * t);
      const py = Math.round(oy + j * t);
      g.fillStyle = '#0e1220';
      g.fillRect(px, py, t, t);
      // the corridor the robots stand in stays clear, so they stand out against the floor
      if (j >= -clearUp && j <= 1) continue;
      // solid blocks on every other row and column, as in the arena; bricks scattered between them
      if (i % 2 === 0 && j % 2 !== 0) drawHard(g, px, py, t);
      else if (hash(i, j) < 0.42) drawSoft(g, px, py, t);
    }
  }
  // the dark comes in: a veil over everything, deeper at the top (the name) and bottom (the buttons)
  g.fillStyle = 'rgba(5,6,11,0.3)';
  g.fillRect(0, 0, W, H);
  // (upright, the name is over the stage and the buttons under it; sideways they sit beside it, and the
  // stage reaches the top and bottom of the screen, so this fade is gentle there)
  const fade = g.createLinearGradient(0, 0, 0, H);
  const at = (y: number): number => Math.max(0, Math.min(1, y / H));
  const top = at(stage.y);
  const bottom = Math.max(top, at(stage.y + stage.h));
  fade.addColorStop(0, 'rgba(5,6,11,0.97)');
  fade.addColorStop(at(stage.y * 0.85), 'rgba(5,6,11,0.9)');
  fade.addColorStop(Math.max(top, at(stage.y + sc.S * 0.15)), 'rgba(5,6,11,0.35)');
  fade.addColorStop(Math.max(top, (top + bottom) / 2), 'rgba(5,6,11,0)');
  fade.addColorStop(bottom, 'rgba(5,6,11,0.5)');
  fade.addColorStop(Math.max(bottom, at(stage.y + stage.h + (H - stage.y - stage.h) * 0.25)), 'rgba(5,6,11,0.88)');
  fade.addColorStop(1, 'rgba(5,6,11,0.97)');
  g.fillStyle = fade;
  g.fillRect(0, 0, W, H);
  // darker at the sides, so the eye goes to the middle
  const side = g.createRadialGradient(sc.x, sc.y - sc.S * 0.6, sc.S * 0.6, sc.x, sc.y - sc.S * 0.6, Math.max(W, H) * 0.75);
  side.addColorStop(0, 'rgba(5,6,11,0)');
  side.addColorStop(1, 'rgba(5,6,11,0.6)');
  g.fillStyle = side;
  g.fillRect(0, 0, W, H);
  // a soft light in your colour behind your robot
  const glow = g.createRadialGradient(sc.x, sc.y - sc.S * 0.62, 0, sc.x, sc.y - sc.S * 0.62, sc.S * 1.15);
  glow.addColorStop(0, me.glow);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalAlpha = 0.2;
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
}

const backdrop = document.createElement('canvas');
let backdropKey = '';
/** The tile sizes the robots were last drawn at, so their pictures can be let go when the title closes. */
const usedPx = new Set<number>();

/**
 * Draw the title picture. `ctx` is the full-screen canvas, `stage` where the robots stand (both in canvas
 * pixels), `me` your colour, `t` seconds since the title opened.
 */
export function drawTitle(ctx: Ctx, stage: Box, me: BotColor, t: number): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const sc = sceneFor(stage);
  const key = `${W}x${H}|${Math.round(stage.x)},${Math.round(stage.y)},${Math.round(stage.w)},${Math.round(stage.h)}|${me.id}`;
  if (key !== backdropKey) {
    backdropKey = key;
    backdrop.width = W;
    backdrop.height = H;
    drawBackdrop(backdrop.getContext('2d')!, W, H, sc, me, stage);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(backdrop, 0, 0);

  const [left, right] = rivalsOf(me);
  const backY = sc.y - sc.S * BACK_RISE;
  // the two rivals, a step behind
  drawRobot(ctx, sc.x - sc.S * BACK_OUT, backY, sc.t, left, 2, 0, false, { fine: false });
  drawRobot(ctx, sc.x + sc.S * BACK_OUT, backY, sc.t, right, 2, 0, false, { fine: false });
  // your robot, waving now and then. Its arm is drawn in whole steps of a quarter (the pictures made
  // ahead of time: see `wave` in robot.ts), which is plenty for a wave.
  const arm = Math.round(waveAt(t) * 4) / 4;
  drawRobot(ctx, sc.x, sc.y, sc.S, me, 2, 0, false, { arms: [0, arm], fine: false });
  // the bomb at its feet, lit
  const T = sc.S * BOMB_SIZE;
  drawBombArt(ctx, sc.x + sc.S * BOMB_AT[0], sc.y + sc.S * BOMB_AT[1] - T * 0.3, T, me.glow, FUSE_LEFT, Math.floor(t * 60));
  // the pictures of the wave, made a few at a time ahead of the first one
  warmRobots(ctx, sc.S, [{ c: me, kind: 'wave' }], 6);
  usedPx.add(Math.max(4, Math.round(sc.S)));
  usedPx.add(Math.max(4, Math.round(sc.t)));
}

/** The title has closed: let go of its large pictures and its backdrop. */
export function closeTitle(): void {
  for (const px of usedPx) forgetSprites(px);
  usedPx.clear();
  backdrop.width = 1;
  backdrop.height = 1;
  backdropKey = '';
}
