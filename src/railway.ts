/**
 * The Wild West's railway and its TNT, drawn (the owner's design, 25 November 2026). Reads the world, never
 * changes it; render.ts calls these at the right moments:
 * - drawRails (with the floor, drawn once): ballast, sleepers and rails along every line, a timber-framed tunnel
 *   in the outer wall at each end, and the crossing signals beside each tunnel, at rest (gates up, lamps dark)
 * - drawCrossing (every frame, while a train is coming or going): that line's signals with their lamps flashing
 *   in turn and the gates down, and a red pulse along the line so it is plain which one
 * - drawTrain (every frame while one is out): an old steam train, its engine, tender and two coaches, with
 *   smoke from the stack, a headlight, the drive wheels turning, darkening as it goes into a tunnel. Along a row
 *   it is seen from the side; down a column from above, with the end facing you showing
 * - drawBarrel: a barrel of TNT (a tile of the arena, in the picture of the breakable blocks); drawLitTnt makes
 *   one that a blast has reached glow white-hot before it goes
 * Sizes are in tiles (T), as in render.ts. Pictures that do not change are made once per size and stamped.
 */
import { World, Train, Rail, TRAIN_CARS, TRAIN_COUPLING, TRAIN_LENGTH, TRAIN_SPEED, GATE_TICKS, BELL_TICKS, TNT_FUSE_TICKS, trainSpan, railLength } from './sim';

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
/** A number from 0 to 1 that is always the same for the same n. */
function hash(n: number): number {
  const v = Math.sin(n * 12.9898) * 43758.5453;
  return v - Math.floor(v);
}

const WOOD = { beam: '#8a5a2b', lit: '#c48a4a', dark: '#4e3016', grain: 'rgba(40,20,6,0.35)' };
const RAIL = { ballast: 'rgba(46,36,30,0.62)', stone: 'rgba(150,132,112,0.35)', dark: 'rgba(16,12,10,0.4)', sleeper: '#5a3920', sleeperLit: '#7b5433', sleeperShade: '#3a2414', steel: '#3b3733', shine: '#d8d2c6', plate: '#22201d' };

// ---------------------------------------------------------------- the track (drawn once, with the floor)

/** One tile of a line: `dir` 'h' runs left to right. Each pass is one layer, so where two lines cross both sets of rails are on top. */
function trackLayer(ctx: Ctx, x: number, y: number, T: number, dir: 'h' | 'v', layer: 0 | 1 | 2, crossing: boolean): void {
  const px = x * T;
  const py = y * T;
  // in the line's own terms: `a` along it, `c` across it (0 to 1 over the tile)
  const at = (a: number, c: number): [number, number] => (dir === 'h' ? [px + a * T, py + c * T] : [px + c * T, py + a * T]);
  const rect = (a0: number, c0: number, a1: number, c1: number): void => {
    const [x0, y0] = at(a0, c0);
    const [x1, y1] = at(a1, c1);
    ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
  };
  if (layer === 0) {
    // the bed of stones it is laid on
    ctx.fillStyle = RAIL.ballast;
    rect(0, 0.1, 1, 0.9);
    ctx.fillStyle = RAIL.dark;
    rect(0, 0.86, 1, 0.92);
    for (let k = 0; k < 14; k++) {
      const n = x * 37.1 + y * 91.7 + k * 5.3 + (dir === 'h' ? 0 : 50);
      ctx.fillStyle = k % 3 ? RAIL.stone : RAIL.dark;
      const d = Math.max(1, T * (0.03 + 0.03 * hash(n + 2)));
      const [sx, sy] = at(hash(n), 0.12 + 0.74 * hash(n + 1));
      ctx.fillRect(sx, sy, d, d);
    }
  } else if (layer === 1) {
    if (crossing && dir === 'v') return; // (where two lines cross, one set of sleepers)
    // three sleepers a tile, lit along their top edge
    for (let k = 0; k < 3; k++) {
      const a = (k + 0.5) / 3;
      ctx.fillStyle = RAIL.sleeperShade;
      rect(a - 0.075, 0.14, a + 0.085, 0.88);
      ctx.fillStyle = RAIL.sleeper;
      rect(a - 0.075, 0.13, a + 0.07, 0.86);
      ctx.fillStyle = RAIL.sleeperLit;
      if (dir === 'h') rect(a - 0.075, 0.13, a + 0.07, 0.17);
      else rect(a - 0.075, 0.13, a - 0.035, 0.86);
      // a crack in the wood here and there
      if (hash(x * 3.3 + y * 7.1 + k) < 0.3) {
        ctx.fillStyle = RAIL.sleeperShade;
        rect(a - 0.01, 0.25 + 0.3 * hash(x + y + k), a + 0.012, 0.45 + 0.3 * hash(x + y + k));
      }
    }
  } else {
    // two rails, a dark web with a polished top, and the plates that hold them to each sleeper
    for (const c of [0.28, 0.72]) {
      ctx.fillStyle = RAIL.plate;
      for (let k = 0; k < 3; k++) {
        const a = (k + 0.5) / 3;
        rect(a - 0.07, c - 0.07, a + 0.065, c + 0.07);
      }
      ctx.fillStyle = RAIL.steel;
      rect(0, c - 0.045, 1, c + 0.045);
      ctx.fillStyle = RAIL.shine;
      rect(0, c - 0.03, 1, c - 0.005);
    }
  }
}

/** Which wall each end of a line is in, and its tile. */
function ends(world: World, r: Rail): { x: number; y: number; side: 'top' | 'bottom' | 'left' | 'right' }[] {
  return r.dir === 'h'
    ? [
        { x: 0, y: r.at, side: 'left' },
        { x: world.w - 1, y: r.at, side: 'right' },
      ]
    : [
        { x: r.at, y: 0, side: 'top' },
        { x: r.at, y: world.h - 1, side: 'bottom' },
      ];
}

/**
 * A tunnel mouth in the outer wall: a dark hole in a frame of heavy timbers, the rails running in. In the top
 * wall it faces you; in the others it is seen from above, its mouth on the arena side.
 */
function drawTunnel(ctx: Ctx, px: number, py: number, T: number, side: 'top' | 'bottom' | 'left' | 'right'): void {
  ctx.save();
  if (side === 'top') {
    ctx.translate(px, py);
    // the hole: deep black at the back, the faintest light at its mouth
    const g = ctx.createLinearGradient(0, T * 0.3, 0, T);
    g.addColorStop(0, '#040201');
    g.addColorStop(1, '#251509');
    ctx.fillStyle = g;
    ctx.fillRect(T * 0.15, T * 0.3, T * 0.7, T * 0.7);
    // the rails running in, fading
    ctx.strokeStyle = 'rgba(190,180,165,0.32)';
    ctx.lineWidth = Math.max(1, T * 0.04);
    line(ctx, T * 0.28, T, T * 0.36, T * 0.48);
    line(ctx, T * 0.72, T, T * 0.64, T * 0.48);
    ctx.fillStyle = 'rgba(90,57,32,0.4)';
    for (const v of [0.62, 0.82]) ctx.fillRect(T * (0.27 - (1 - v) * 0.1), T * v, T * (0.46 + (1 - v) * 0.2), T * 0.05);
    // the frame: two posts and a lintel, lit from the upper left
    beam(ctx, T * 0.05, T * 0.28, T * 0.12, T * 0.72, 'v', T);
    beam(ctx, T * 0.83, T * 0.28, T * 0.12, T * 0.72, 'v', T);
    beam(ctx, T * 0.01, T * 0.17, T * 0.98, T * 0.14, 'h', T);
    // and its shadow on the hole
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(T * 0.17, T * 0.31, T * 0.66, T * 0.07);
  } else {
    // seen from above, drawn as if the mouth were along the top edge (v = 0) and turned into place
    if (side === 'bottom') ctx.setTransform(ctx.getTransform().translate(px, py));
    else if (side === 'left') ctx.setTransform(ctx.getTransform().multiply(new DOMMatrix([0, 1, -1, 0, px + T, py])));
    else ctx.setTransform(ctx.getTransform().multiply(new DOMMatrix([0, 1, 1, 0, px, py])));
    const g = ctx.createLinearGradient(0, 0, 0, T * 0.7);
    g.addColorStop(0, '#2a180b');
    g.addColorStop(1, '#030100');
    ctx.fillStyle = g;
    ctx.fillRect(T * 0.15, 0, T * 0.7, T * 0.72);
    ctx.strokeStyle = 'rgba(190,180,165,0.3)';
    ctx.lineWidth = Math.max(1, T * 0.04);
    line(ctx, T * 0.28, 0, T * 0.31, T * 0.55);
    line(ctx, T * 0.72, 0, T * 0.69, T * 0.55);
    ctx.fillStyle = 'rgba(90,57,32,0.45)';
    for (const v of [0.12, 0.34]) ctx.fillRect(T * 0.24, T * v, T * 0.52, T * 0.05);
    // the timbers: one along each side, the roof beam at the mouth and another where the rock closes over
    beam(ctx, T * 0.04, 0, T * 0.12, T * 0.8, 'v', T);
    beam(ctx, T * 0.84, 0, T * 0.12, T * 0.8, 'v', T);
    beam(ctx, 0, T * 0.62, T, T * 0.13, 'h', T);
    beam(ctx, 0, 0, T, T * 0.12, 'h', T);
  }
  ctx.restore();
}

/** A squared timber with a lit edge, a shaded edge and a line of grain. */
function beam(ctx: Ctx, x: number, y: number, w: number, h: number, dir: 'h' | 'v', T: number): void {
  const e = Math.max(1, T * 0.025);
  ctx.fillStyle = WOOD.dark;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = WOOD.beam;
  ctx.fillRect(x + e * 0.5, y + e * 0.5, w - e, h - e);
  ctx.fillStyle = WOOD.lit;
  if (dir === 'h') ctx.fillRect(x + e * 0.5, y + e * 0.5, w - e, e);
  else ctx.fillRect(x + e * 0.5, y + e * 0.5, e, h - e);
  ctx.fillStyle = WOOD.grain;
  if (dir === 'h') ctx.fillRect(x + w * 0.1, y + h * 0.55, w * 0.8, Math.max(0.6, T * 0.012));
  else ctx.fillRect(x + w * 0.55, y + h * 0.1, Math.max(0.6, T * 0.012), h * 0.8);
}

// ---------------------------------------------------------------- crossing signals

/** A crossing signal on the outer wall beside a tunnel: its tile, the way into the arena, and the way along the wall away from the line. */
interface Signal {
  x: number;
  y: number;
  inward: [number, number];
  away: [number, number];
}
/** The four signals of a line: one each side of its tunnel at each end (the owner's ask: on the outer wall). */
export function signalsOf(world: World, line: number): Signal[] {
  const r = world.rails[line];
  if (r.dir === 'h')
    return [0, world.w - 1].flatMap((x) =>
      [-1, 1].map((s): Signal => ({ x, y: r.at + s, inward: [x === 0 ? 1 : -1, 0], away: [0, s] })),
    );
  return [0, world.h - 1].flatMap((y) => [-1, 1].map((s): Signal => ({ x: r.at + s, y, inward: [0, y === 0 ? 1 : -1], away: [s, 0] })));
}

/**
 * One signal. `gate` 0 is up (along the wall, out of the way) to 1, down (across the way onto the line, lying
 * along its edge). `lamp` -1 dark, 0 the left lamp lit, 1 the right one.
 */
function drawSignal(ctx: Ctx, s: Signal, T: number, gate: number, lamp: number): void {
  const px = s.x * T;
  const py = s.y * T;
  // the gate's arm, from a pivot at the corner of the block nearest the line and the arena
  const pvx = px + T * (0.5 - s.away[0] * 0.4 + s.inward[0] * 0.32);
  const pvy = py + T * (0.5 - s.away[1] * 0.4 + s.inward[1] * 0.32);
  const up = Math.atan2(s.away[1], s.away[0]);
  let down = Math.atan2(s.inward[1], s.inward[0]);
  if (down - up > Math.PI) down -= Math.PI * 2;
  if (up - down > Math.PI) down += Math.PI * 2;
  const k = gate * gate * (3 - 2 * gate); // (eased)
  const ang = up + (down - up) * k;
  const len = T * 0.98;
  const wide = Math.max(1.5, T * 0.095);
  ctx.save();
  ctx.translate(pvx, pvy);
  ctx.rotate(ang);
  // its shadow on whatever is under it
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(-T * 0.18, -wide / 2 + T * 0.05, len + T * 0.18, wide);
  // the counterweight behind the pivot
  ctx.fillStyle = '#2b2b2e';
  rr(ctx, -T * 0.2, -wide * 0.85, T * 0.17, wide * 1.7, T * 0.02);
  ctx.fill();
  // the arm: red and white bands with a dark edge
  ctx.fillStyle = '#1d1a18';
  ctx.fillRect(0, -wide / 2 - 0.5, len, wide + 1);
  const bands = 5;
  for (let b = 0; b < bands; b++) {
    ctx.fillStyle = b % 2 ? '#f3efe6' : '#d62a1e';
    ctx.fillRect((len * b) / bands, -wide / 2, len / bands + 0.5, wide);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(0, -wide / 2, len, Math.max(0.6, wide * 0.25));
  // a lamp at its tip, lit with the others
  const tipOn = lamp >= 0 && gate > 0.5;
  ctx.fillStyle = tipOn ? '#ff4a32' : '#5a1a14';
  circle(ctx, len - wide * 0.6, 0, wide * 0.42);
  ctx.fill();
  ctx.restore();
  // the pivot
  ctx.fillStyle = '#3a3a3e';
  circle(ctx, pvx, pvy, T * 0.06);
  ctx.fill();
  ctx.fillStyle = '#8b8b90';
  circle(ctx, pvx - T * 0.015, pvy - T * 0.015, T * 0.025);
  ctx.fill();

  // the mast, standing up off the block
  const mx = px + T * 0.5;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(mx + T * 0.04, py + T * 0.76, T * 0.13, T * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2c2c30';
  ctx.fillRect(mx - T * 0.1, py + T * 0.66, T * 0.2, T * 0.1);
  ctx.fillStyle = '#7b7c82';
  ctx.fillRect(mx - T * 0.035, py + T * 0.05, T * 0.07, T * 0.68);
  ctx.fillStyle = '#b9bac0';
  ctx.fillRect(mx - T * 0.035, py + T * 0.05, T * 0.025, T * 0.68);
  // the crossbuck: two white boards edged in red, crossed
  ctx.save();
  ctx.translate(mx, py + T * 0.17);
  for (const a of [-0.62, 0.62]) {
    ctx.save();
    ctx.rotate(a);
    ctx.fillStyle = '#b3241a';
    ctx.fillRect(-T * 0.33, -T * 0.055, T * 0.66, T * 0.11);
    ctx.fillStyle = '#f4efe2';
    ctx.fillRect(-T * 0.31, -T * 0.035, T * 0.62, T * 0.07);
    ctx.restore();
  }
  ctx.restore();
  // the lamps: a black plate with a hooded lamp at each side
  const ly = py + T * 0.45;
  ctx.fillStyle = '#121214';
  rr(ctx, mx - T * 0.38, ly - T * 0.12, T * 0.76, T * 0.24, T * 0.08);
  ctx.fill();
  for (const side of [0, 1]) {
    const lx = mx + (side ? 1 : -1) * T * 0.22;
    const on = lamp === side;
    ctx.fillStyle = '#050506';
    circle(ctx, lx, ly, T * 0.13);
    ctx.fill();
    ctx.fillStyle = on ? '#ff3b26' : '#4c1611';
    circle(ctx, lx, ly, T * 0.1);
    ctx.fill();
    ctx.fillStyle = on ? '#ffd2b8' : 'rgba(255,160,140,0.25)';
    circle(ctx, lx - T * 0.025, ly - T * 0.03, T * (on ? 0.045 : 0.03));
    ctx.fill();
    // the hood over it
    ctx.strokeStyle = '#2a2a2e';
    ctx.lineWidth = Math.max(1, T * 0.035);
    ctx.beginPath();
    ctx.arc(lx, ly, T * 0.13, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();
  }
}

/** The light a lit lamp throws: added on as light, so it glows over what is round it. */
function lampGlow(ctx: Ctx, s: Signal, T: number, lamp: number): void {
  if (lamp < 0) return;
  const lx = (s.x + 0.5) * T + (lamp ? 1 : -1) * T * 0.22;
  const ly = (s.y + 0.45) * T;
  const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, T * 0.55);
  g.addColorStop(0, 'rgba(255,70,40,0.75)');
  g.addColorStop(0.35, 'rgba(255,40,20,0.3)');
  g.addColorStop(1, 'rgba(255,20,10,0)');
  ctx.fillStyle = g;
  ctx.fillRect(lx - T * 0.55, ly - T * 0.55, T * 1.1, T * 1.1);
}

/**
 * The railway as it stands, drawn once with the floor and blocks: every line's track (but not where a falling
 * block has landed), its two tunnels, and its signals at rest. `wall(x, y)` draws the outer wall's tile there
 * again (render.ts's rock), which a signal or tunnel is drawn on.
 */
export function drawRails(ctx: Ctx, world: World, T: number): void {
  if (!world.rails.length) return;
  const open = (x: number, y: number): boolean => world.tiles[y * world.w + x] !== 1; // (1: HARD)
  const both = (x: number, y: number): boolean => world.rails.some((r) => r.dir === 'h' && r.at === y) && world.rails.some((r) => r.dir === 'v' && r.at === x);
  for (const layer of [0, 1, 2] as const) {
    for (const r of world.rails) {
      const len = railLength(world, world.rails.indexOf(r));
      for (let k = 1; k <= len; k++) {
        const x = r.dir === 'h' ? k : r.at;
        const y = r.dir === 'h' ? r.at : k;
        if (open(x, y)) trackLayer(ctx, x, y, T, r.dir, layer, both(x, y));
      }
    }
  }
  for (const r of world.rails) for (const e of ends(world, r)) drawTunnel(ctx, e.x * T, e.y * T, T, e.side);
  for (let i = 0; i < world.rails.length; i++) for (const s of signalsOf(world, i)) drawSignal(ctx, s, T, 0, -1);
}

/** Where a train's gates are: 0 up, 1 down. They come down over GATE_TICKS from the warning, and go up again once it has gone. */
export function gateOf(tr: Train, tick: number): number {
  if (tick < tr.warnAt) return 0;
  if (tick <= tr.exitAt) return Math.min(1, (tick - tr.warnAt) / GATE_TICKS);
  return Math.max(0, 1 - (tick - tr.exitAt) / GATE_TICKS);
}
/** Which lamp is lit (-1 none): they flash in turn with the bell, from the warning until the gates are nearly up. */
export function lampOf(tr: Train, tick: number): number {
  if (tick < tr.warnAt || tick > tr.exitAt + GATE_TICKS / 2) return -1;
  return Math.floor((tick - tr.warnAt) / BELL_TICKS) % 2;
}

/**
 * The line a train is coming or going on, every frame: a red pulse along it with the lamps, its signals with
 * the lamps flashing in turn and the gates coming down or going up. `wall(x, y)` draws the outer wall's tile
 * at (x, y) again, under the signal drawn on it.
 */
export function drawCrossing(ctx: Ctx, world: World, T: number, wall: (x: number, y: number) => void): void {
  const tr = world.train;
  if (!tr || world.tick < tr.warnAt) return;
  const gate = gateOf(tr, world.tick);
  const lamp = lampOf(tr, world.tick);
  const r = world.rails[tr.line];
  if (lamp >= 0) {
    // the line itself pulses red, faintly, with the lamps
    const since = (world.tick - tr.warnAt) % BELL_TICKS;
    const a = 0.1 + 0.12 * Math.max(0, 1 - since / BELL_TICKS);
    ctx.fillStyle = `rgba(255,40,24,${a.toFixed(3)})`;
    const len = railLength(world, tr.line);
    if (r.dir === 'h') ctx.fillRect(T, (r.at + 0.12) * T, len * T, T * 0.76);
    else ctx.fillRect((r.at + 0.12) * T, T, T * 0.76, len * T);
  }
  const sig = signalsOf(world, tr.line);
  for (const s of sig) {
    wall(s.x, s.y);
    drawSignal(ctx, s, T, gate, lamp < 0 ? -1 : (lamp + (s.away[0] + s.away[1] > 0 ? 1 : 0)) % 2);
  }
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const s of sig) lampGlow(ctx, s, T, lamp < 0 ? -1 : (lamp + (s.away[0] + s.away[1] > 0 ? 1 : 0)) % 2);
  ctx.restore();
}

// ---------------------------------------------------------------- the train

/** Where each car is along the train: [from, to] in tiles from its back, front car (the engine) first. */
const CARS: [number, number][] = (() => {
  const out: [number, number][] = [];
  let front = TRAIN_LENGTH;
  for (const c of TRAIN_CARS) {
    out.push([front - c, front]);
    front -= c + TRAIN_COUPLING;
  }
  return out;
})();

const LOCO = {
  boiler: '#262b35',
  boilerLit: '#5b6577',
  boilerDark: '#11141a',
  brass: '#d9a441',
  brassLit: '#ffe39a',
  brassDark: '#8a5f17',
  red: '#a8231b',
  redLit: '#d9493a',
  redDark: '#5e120d',
  iron: '#1a1b1f',
  ironLit: '#4a4c54',
  cab: '#7d1d16',
  coach: '#2f5a3d',
  coachLit: '#4c8460',
  coachDark: '#1b3524',
  cream: '#ecdcb0',
  window: '#ffd77a',
  windowDim: '#c48a2c',
  roof: '#3a3330',
  roofLit: '#6b5f58',
  coal: '#121214',
};

/** The picture of the whole train seen from its side, front to the right. Made once per size. Height above the rails: 1.4 tiles. */
const SIDE_UP = 1.42;
const SIDE_DOWN = 0.12;
const SIDE_PAD = 0.2;
const sides = new Map<number, HTMLCanvasElement>();
function sideSprite(T: number): HTMLCanvasElement {
  let c = sides.get(T);
  if (c) return c;
  if (sides.size > 4) sides.clear();
  c = document.createElement('canvas');
  c.width = Math.ceil((TRAIN_LENGTH + SIDE_PAD * 2) * T);
  c.height = Math.ceil((SIDE_UP + SIDE_DOWN) * T);
  const g = c.getContext('2d')!;
  const gy = SIDE_UP * T; // the rails
  // couplings between the cars
  g.fillStyle = LOCO.iron;
  for (let i = 1; i < CARS.length; i++) {
    const x = (SIDE_PAD + CARS[i][1]) * T;
    g.fillRect(x - T * 0.02, gy - T * 0.3, TRAIN_COUPLING * T + T * 0.04, T * 0.06);
  }
  sideEngine(g, (SIDE_PAD + CARS[0][1]) * T, gy, T);
  sideTender(g, (SIDE_PAD + CARS[1][0]) * T, (SIDE_PAD + CARS[1][1]) * T, gy, T);
  for (let i = 2; i < CARS.length; i++) sideCoach(g, (SIDE_PAD + CARS[i][0]) * T, (SIDE_PAD + CARS[i][1]) * T, gy, T, i);
  sides.set(T, c);
  return c;
}

/** A wheel seen from the side: a rim, spokes and a hub, in red with an iron tyre. */
function sideWheel(g: Ctx, x: number, y: number, r: number, spokes: number, turn: number): void {
  g.fillStyle = LOCO.iron;
  circle(g, x, y, r);
  g.fill();
  g.fillStyle = LOCO.red;
  circle(g, x, y, r * 0.84);
  g.fill();
  g.fillStyle = LOCO.redDark;
  circle(g, x, y, r * 0.66);
  g.fill();
  g.strokeStyle = LOCO.red;
  g.lineWidth = Math.max(1, r * 0.13);
  for (let k = 0; k < spokes; k++) {
    const a = turn + (k / spokes) * Math.PI * 2;
    line(g, x, y, x + Math.cos(a) * r * 0.78, y + Math.sin(a) * r * 0.78);
  }
  g.fillStyle = LOCO.brass;
  circle(g, x, y, r * 0.22);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.25)';
  g.lineWidth = Math.max(0.6, r * 0.08);
  g.beginPath();
  g.arc(x, y, r * 0.92, Math.PI * 1.1, Math.PI * 1.55);
  g.stroke();
}

/** The engine from the side, its front at `xf`, the rails at `gy`: cowcatcher, smokebox and headlight, a diamond stack, the boiler with brass bands and domes, the cab. The drive wheels are drawn each frame (drawTrain), turning. */
function sideEngine(g: Ctx, xf: number, gy: number, T: number): void {
  const X = (u: number): number => xf - u * T; // u: tiles back from its front
  const Y = (v: number): number => gy - v * T; // v: tiles up from the rails
  const box = (u0: number, u1: number, v0: number, v1: number, fill: string): void => {
    g.fillStyle = fill;
    g.fillRect(X(u1), Y(v1), (u1 - u0) * T, (v1 - v0) * T);
  };
  // the frame under it all
  box(0.24, 2.0, 0.17, 0.28, LOCO.iron);
  // small wheels under the front
  for (const u of [0.48, 0.74]) sideWheel(g, X(u), Y(0.12), T * 0.12, 6, 0.3);
  // the tender's coupling at the back
  box(1.96, 2.04, 0.22, 0.3, LOCO.iron);
  // the cowcatcher: a red wedge of slats, sloping forward to the rails
  g.fillStyle = LOCO.redDark;
  g.beginPath();
  g.moveTo(X(0.32), Y(0.34));
  g.lineTo(X(0.02), Y(0.03));
  g.lineTo(X(0.32), Y(0.03));
  g.closePath();
  g.fill();
  g.strokeStyle = LOCO.redLit;
  g.lineWidth = Math.max(1, T * 0.025);
  for (let k = 1; k <= 4; k++) {
    const u = 0.32 - k * 0.065;
    line(g, X(u), Y(0.03), X(Math.min(0.32, u + 0.18)), Y(Math.min(0.34, 0.03 + 0.18 * 1.03)));
  }
  box(0.26, 0.36, 0.26, 0.38, LOCO.red); // the buffer beam
  box(0.26, 0.36, 0.34, 0.38, LOCO.redLit);
  // the cylinder and its steam chest, low at the front
  box(0.36, 0.66, 0.2, 0.4, LOCO.ironLit);
  box(0.36, 0.66, 0.2, 0.24, LOCO.iron);
  box(0.4, 0.62, 0.36, 0.4, '#7a7c84');
  // the running board along the side, edged in brass
  box(0.32, 1.48, 0.36, 0.41, LOCO.iron);
  box(0.32, 1.48, 0.4, 0.415, LOCO.brass);
  // the boiler: a long black cylinder, lit along its top
  const bg = g.createLinearGradient(0, Y(0.8), 0, Y(0.4));
  bg.addColorStop(0, LOCO.boilerLit);
  bg.addColorStop(0.35, LOCO.boiler);
  bg.addColorStop(1, LOCO.boilerDark);
  g.fillStyle = bg;
  g.fillRect(X(1.5), Y(0.8), (1.5 - 0.6) * T, 0.4 * T);
  // the smokebox at its front, darker, with a round door
  const sg = g.createLinearGradient(0, Y(0.82), 0, Y(0.4));
  sg.addColorStop(0, '#454a55');
  sg.addColorStop(0.4, '#1c1f25');
  sg.addColorStop(1, '#0c0d10');
  g.fillStyle = sg;
  rr(g, X(0.62), Y(0.82), 0.3 * T, 0.42 * T, [T * 0.1, 0, 0, T * 0.1]);
  g.fill();
  // brass bands round the boiler
  for (const u of [0.66, 0.9, 1.16, 1.42]) box(u, u + 0.035, 0.4, 0.8, LOCO.brass);
  // the domes on top: the steam dome, all brass, and the sand dome, with a bell between
  const dome = (u: number, w: number, h: number, fill: string, lit: string): void => {
    g.fillStyle = fill;
    g.beginPath();
    g.moveTo(X(u + w / 2), Y(0.79));
    g.quadraticCurveTo(X(u + w / 2), Y(0.79 + h), X(u), Y(0.79 + h));
    g.quadraticCurveTo(X(u - w / 2), Y(0.79 + h), X(u - w / 2), Y(0.79));
    g.closePath();
    g.fill();
    g.fillStyle = lit;
    g.fillRect(X(u + w * 0.15), Y(0.79 + h * 0.85), w * 0.18 * T, h * 0.6 * T);
  };
  dome(0.98, 0.2, 0.22, LOCO.brass, LOCO.brassLit);
  dome(1.3, 0.16, 0.16, LOCO.red, LOCO.redLit);
  // the bell, in its little yoke
  box(1.12, 1.15, 0.79, 0.9, LOCO.iron);
  g.fillStyle = LOCO.brass;
  g.beginPath();
  g.moveTo(X(1.07), Y(0.86));
  g.quadraticCurveTo(X(1.135), Y(1.0), X(1.2), Y(0.86));
  g.closePath();
  g.fill();
  // the diamond stack: a short pipe, then the flared spark catcher, wide in the middle, with a cap
  box(0.42, 0.52, 0.8, 0.98, LOCO.iron);
  g.fillStyle = '#16171b';
  g.beginPath();
  g.moveTo(X(0.42), Y(0.97));
  g.lineTo(X(0.3), Y(1.16));
  g.lineTo(X(0.36), Y(1.3));
  g.lineTo(X(0.58), Y(1.3));
  g.lineTo(X(0.64), Y(1.16));
  g.lineTo(X(0.52), Y(0.97));
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.18)';
  g.beginPath();
  g.moveTo(X(0.5), Y(0.99));
  g.lineTo(X(0.6), Y(1.16));
  g.lineTo(X(0.56), Y(1.27));
  g.lineTo(X(0.52), Y(1.27));
  g.lineTo(X(0.55), Y(1.16));
  g.closePath();
  g.fill();
  box(0.34, 0.6, 1.29, 1.34, LOCO.brass);
  // the headlight: a big lamp box on the smokebox, its lens facing forward
  box(0.27, 0.52, 0.84, 1.06, '#2a2b30');
  box(0.27, 0.52, 1.03, 1.08, LOCO.brass);
  box(0.25, 0.29, 0.86, 1.04, LOCO.brass);
  g.fillStyle = '#fff3c4';
  g.beginPath();
  g.ellipse(X(0.265), Y(0.95), T * 0.025, T * 0.075, 0, 0, Math.PI * 2);
  g.fill();
  // the whistle on the cab's front, and a sand pipe down the side
  box(1.5, 1.53, 0.8, 1.17, '#8a8c94');
  box(1.47, 1.56, 1.16, 1.2, LOCO.brass);
  g.strokeStyle = LOCO.brassDark;
  g.lineWidth = Math.max(0.8, T * 0.018);
  line(g, X(1.3), Y(0.8), X(1.18), Y(0.3));
  // the cab: red wood, gold trim, a window with the firebox's glow, a roof that overhangs
  box(1.48, 2.0, 0.28, 1.12, LOCO.cab);
  box(1.48, 1.52, 0.28, 1.12, LOCO.redLit);
  box(1.48, 2.0, 0.44, 0.47, LOCO.brass);
  box(1.48, 2.0, 0.28, 0.31, LOCO.redDark);
  const wg = g.createLinearGradient(0, Y(1.0), 0, Y(0.62));
  wg.addColorStop(0, '#ffcf6a');
  wg.addColorStop(1, '#d4541d');
  g.fillStyle = wg;
  rr(g, X(1.92), Y(1.0), 0.34 * T, 0.36 * T, T * 0.05);
  g.fill();
  box(1.73, 1.76, 0.64, 1.0, LOCO.cab); // the window's middle bar
  box(1.44, 2.06, 1.11, 1.2, LOCO.roof);
  box(1.44, 2.06, 1.17, 1.2, LOCO.roofLit);
  // a number plate in brass on the cab side
  box(1.62, 1.86, 0.33, 0.42, LOCO.brass);
  box(1.64, 1.84, 0.35, 0.4, LOCO.brassDark);
}

/** The tender, between `x0` (back) and `x1` (front): a red tank on two little trucks, heaped with coal. */
function sideTender(g: Ctx, x0: number, x1: number, gy: number, T: number): void {
  const w = x1 - x0;
  const Y = (v: number): number => gy - v * T;
  for (const f of [0.17, 0.37, 0.63, 0.83]) sideWheel(g, x0 + w * f, Y(0.12), T * 0.12, 6, 0.6);
  g.fillStyle = LOCO.iron;
  g.fillRect(x0 + w * 0.08, Y(0.24), w * 0.84, T * 0.06);
  // the coal heap, lumps catching the light
  g.fillStyle = LOCO.coal;
  g.beginPath();
  g.moveTo(x0 + w * 0.06, Y(0.78));
  for (let k = 0; k <= 8; k++) {
    const f = 0.06 + (k / 8) * 0.88;
    g.lineTo(x0 + w * f, Y(0.83 + 0.07 * Math.sin(k * 1.7) + 0.05 * (1 - Math.abs(f - 0.5) * 2)));
  }
  g.lineTo(x0 + w * 0.94, Y(0.78));
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(160,170,190,0.35)';
  for (let k = 0; k < 7; k++) {
    g.fillRect(x0 + w * (0.12 + 0.11 * k), Y(0.86 + 0.04 * Math.sin(k * 2.3)), T * 0.04, T * 0.025);
  }
  // the tank
  const tg = g.createLinearGradient(0, Y(0.8), 0, Y(0.26));
  tg.addColorStop(0, LOCO.redLit);
  tg.addColorStop(0.3, LOCO.cab);
  tg.addColorStop(1, LOCO.redDark);
  g.fillStyle = tg;
  rr(g, x0 + w * 0.04, Y(0.8), w * 0.92, T * 0.54, T * 0.05);
  g.fill();
  g.fillStyle = LOCO.brass;
  g.fillRect(x0 + w * 0.04, Y(0.8), w * 0.92, T * 0.035);
  g.fillRect(x0 + w * 0.04, Y(0.35), w * 0.92, T * 0.025);
  // a gold panel line along its side
  g.strokeStyle = LOCO.brass;
  g.lineWidth = Math.max(0.8, T * 0.018);
  g.strokeRect(x0 + w * 0.14, Y(0.7), w * 0.72, T * 0.26);
}

/** A coach, between `x0` (back) and `x1` (front): green with a cream band, a row of lit windows, a roof with a raised clerestory, a platform at each end. */
function sideCoach(g: Ctx, x0: number, x1: number, gy: number, T: number, n: number): void {
  const w = x1 - x0;
  const Y = (v: number): number => gy - v * T;
  for (const f of [0.12, 0.27, 0.73, 0.88]) sideWheel(g, x0 + w * f, Y(0.12), T * 0.12, 6, 0.2 + n);
  g.fillStyle = LOCO.iron;
  g.fillRect(x0 + w * 0.06, Y(0.24), w * 0.88, T * 0.06);
  // the end platforms with their railings
  g.fillStyle = LOCO.iron;
  g.fillRect(x0, Y(0.3), w * 0.09, T * 0.05);
  g.fillRect(x1 - w * 0.09, Y(0.3), w * 0.09, T * 0.05);
  g.strokeStyle = '#6a6c74';
  g.lineWidth = Math.max(0.8, T * 0.02);
  for (const [a, b] of [
    [x0 + w * 0.01, x0 + w * 0.08],
    [x1 - w * 0.08, x1 - w * 0.01],
  ]) {
    line(g, a, Y(0.56), b, Y(0.56));
    line(g, a, Y(0.3), a, Y(0.56));
  }
  // the body
  const bx = x0 + w * 0.08;
  const bw = w * 0.84;
  const cg = g.createLinearGradient(0, Y(0.92), 0, Y(0.28));
  cg.addColorStop(0, LOCO.coachLit);
  cg.addColorStop(0.25, LOCO.coach);
  cg.addColorStop(1, LOCO.coachDark);
  g.fillStyle = cg;
  g.fillRect(bx, Y(0.92), bw, T * 0.64);
  // the cream band under the windows, and gold lining
  g.fillStyle = LOCO.cream;
  g.fillRect(bx, Y(0.48), bw, T * 0.07);
  g.fillStyle = LOCO.brass;
  g.fillRect(bx, Y(0.33), bw, T * 0.025);
  // the windows, warm with lamplight
  const nWin = 5;
  for (let k = 0; k < nWin; k++) {
    const wx = bx + bw * (0.07 + (k * 0.86) / nWin);
    const ww = (bw * 0.86) / nWin - bw * 0.04;
    const wg = g.createLinearGradient(0, Y(0.84), 0, Y(0.54));
    wg.addColorStop(0, LOCO.window);
    wg.addColorStop(1, LOCO.windowDim);
    g.fillStyle = wg;
    rr(g, wx, Y(0.84), ww, T * 0.3, [T * 0.06, T * 0.06, 0, 0]);
    g.fill();
    g.fillStyle = 'rgba(80,40,10,0.45)'; // someone sitting by it, now and then
    if (hash(n * 10 + k) < 0.45) {
      g.beginPath();
      g.arc(wx + ww * 0.5, Y(0.64), ww * 0.22, Math.PI, 0);
      g.fill();
    }
  }
  // the roof: dark, curved, with the clerestory along its middle and its little windows
  g.fillStyle = LOCO.roof;
  rr(g, x0 + w * 0.04, Y(1.02), w * 0.92, T * 0.11, T * 0.04);
  g.fill();
  g.fillStyle = LOCO.roofLit;
  g.fillRect(x0 + w * 0.06, Y(1.02), w * 0.88, T * 0.025);
  g.fillStyle = LOCO.roof;
  g.fillRect(x0 + w * 0.16, Y(1.11), w * 0.68, T * 0.1);
  g.fillStyle = 'rgba(255,215,122,0.55)';
  for (let k = 0; k < 6; k++) g.fillRect(x0 + w * (0.2 + k * 0.105), Y(1.08), w * 0.05, T * 0.035);
  g.fillStyle = LOCO.roofLit;
  g.fillRect(x0 + w * 0.16, Y(1.11), w * 0.68, T * 0.02);
}

/** The picture of the whole train seen from above, for a line down a column: front at the bottom if `frontSouth`. Lifted LIFT tiles off the floor, with the faces of its cars that face you under them. */
const LIFT = 0.3;
const TOP_PAD = 0.2;
const tops = new Map<string, HTMLCanvasElement>();
function topSprite(T: number, frontSouth: boolean): HTMLCanvasElement {
  const key = `${T}|${frontSouth}`;
  let c = tops.get(key);
  if (c) return c;
  if (tops.size > 8) tops.clear();
  c = document.createElement('canvas');
  c.width = Math.ceil(T * 1.2);
  c.height = Math.ceil((TRAIN_LENGTH + TOP_PAD * 2 + LIFT) * T);
  const g = c.getContext('2d')!;
  const cx = c.width / 2;
  // along the train: s tiles from its back; on the picture, the back at the top if the front is at the bottom
  const S = (s: number): number => (frontSouth ? (TOP_PAD + s) * T : (TOP_PAD + TRAIN_LENGTH - s) * T);
  // north to south, so each car hides the end of the one behind it (as the robots do)
  const order = CARS.map((c, i) => i).sort((a, b) => (frontSouth ? CARS[a][0] - CARS[b][0] : CARS[b][0] - CARS[a][0]));
  for (const i of order) {
    const [a, b] = CARS[i];
    const north = Math.min(S(a), S(b));
    const south = Math.max(S(a), S(b));
    // the end that faces you (its front when the train comes south): the engine's front or cab, a coach's end door
    topFace(g, cx, south, T, i, frontSouth);
    if (i === 0) topEngine(g, cx, north, south, T, frontSouth);
    else if (i === 1) topTender(g, cx, north, south, T);
    else topCoach(g, cx, north, south, T, i);
    // its coupling to the car north of it
    if (i !== order[0]) {
      g.fillStyle = LOCO.iron;
      g.fillRect(cx - T * 0.04, north - TRAIN_COUPLING * T - T * 0.02, T * 0.08, TRAIN_COUPLING * T + T * 0.04);
    }
  }
  tops.set(key, c);
  return c;
}

/** The face of a car that is towards you (drawn at its south end, from the floor up to its roof). */
function topFace(g: Ctx, cx: number, south: number, T: number, i: number, front: boolean): void {
  const y0 = south; // its roof's south edge, lifted
  const h = LIFT * T;
  if (i === 0 && front) {
    // the engine head on: the cowcatcher at the bottom, the smokebox door, the headlight
    g.fillStyle = LOCO.redDark;
    g.beginPath();
    g.moveTo(cx - T * 0.36, y0 + h * 0.55);
    g.lineTo(cx + T * 0.36, y0 + h * 0.55);
    g.lineTo(cx + T * 0.2, y0 + h * 1.05);
    g.lineTo(cx - T * 0.2, y0 + h * 1.05);
    g.closePath();
    g.fill();
    g.strokeStyle = LOCO.redLit;
    g.lineWidth = Math.max(1, T * 0.02);
    for (let k = -2; k <= 2; k++) line(g, cx + k * T * 0.11, y0 + h * 0.58, cx + k * T * 0.065, y0 + h);
    g.fillStyle = '#1a1c22';
    circle(g, cx, y0 + h * 0.2, T * 0.25);
    g.fill();
    g.strokeStyle = '#4a4e5a';
    g.lineWidth = Math.max(1, T * 0.03);
    circle(g, cx, y0 + h * 0.2, T * 0.17);
    g.stroke();
    g.fillStyle = LOCO.brass;
    circle(g, cx, y0 + h * 0.2, T * 0.035);
    g.fill();
    return;
  }
  // any other end: a dark panel of the car's colour
  const col = i === 0 ? LOCO.cab : i === 1 ? LOCO.redDark : LOCO.coachDark;
  g.fillStyle = col;
  g.fillRect(cx - T * 0.38, y0, T * 0.76, h);
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(cx - T * 0.38, y0 + h * 0.7, T * 0.76, h * 0.3);
  if (i >= 2) {
    // a coach's end door, lit through its glass, and the platform's railing
    g.fillStyle = LOCO.windowDim;
    g.fillRect(cx - T * 0.08, y0 + h * 0.12, T * 0.16, h * 0.4);
    g.strokeStyle = '#6a6c74';
    g.lineWidth = Math.max(0.8, T * 0.02);
    line(g, cx - T * 0.38, y0 + h * 0.62, cx + T * 0.38, y0 + h * 0.62);
  } else if (i === 0) {
    // the cab's back, its window glowing from the firebox
    g.fillStyle = '#e0782a';
    g.fillRect(cx - T * 0.12, y0 + h * 0.15, T * 0.24, h * 0.4);
  }
}

/** The engine from above, between `north` and `south` on the picture. */
function topEngine(g: Ctx, cx: number, north: number, south: number, T: number, frontSouth: boolean): void {
  const len = south - north;
  // positions along it from its front, in tiles
  const F = (u: number): number => (frontSouth ? south - u * T : north + u * T);
  const span = (u0: number, u1: number): [number, number] => {
    const a = F(u0);
    const b = F(u1);
    return [Math.min(a, b), Math.abs(b - a)];
  };
  // running boards along both sides, wheels' red just showing beyond them
  g.fillStyle = LOCO.red;
  for (const u of [1.05, 1.62]) {
    const [y, h] = span(u - 0.2, u + 0.2);
    g.fillRect(cx - T * 0.44, y, T * 0.05, h);
    g.fillRect(cx + T * 0.39, y, T * 0.05, h);
  }
  {
    const [y, h] = span(0.3, 1.48);
    g.fillStyle = LOCO.iron;
    g.fillRect(cx - T * 0.38, y, T * 0.76, h);
    g.fillStyle = LOCO.brass;
    g.fillRect(cx - T * 0.38, y, T * 0.025, h);
    g.fillRect(cx + T * 0.355, y, T * 0.025, h);
  }
  // the cowcatcher: a red point at its front
  g.fillStyle = LOCO.red;
  g.beginPath();
  g.moveTo(cx - T * 0.36, F(0.3));
  g.lineTo(cx, F(0.02));
  g.lineTo(cx + T * 0.36, F(0.3));
  g.closePath();
  g.fill();
  g.strokeStyle = LOCO.redDark;
  g.lineWidth = Math.max(1, T * 0.02);
  for (let k = 1; k <= 3; k++) line(g, cx - T * 0.36 + k * T * 0.18, F(0.3), cx, F(0.05));
  // the boiler: a cylinder, lit along one side of its top
  {
    const [y, h] = span(0.36, 1.5);
    const bg = g.createLinearGradient(cx - T * 0.27, 0, cx + T * 0.27, 0);
    bg.addColorStop(0, LOCO.boilerDark);
    bg.addColorStop(0.35, LOCO.boilerLit);
    bg.addColorStop(0.55, LOCO.boiler);
    bg.addColorStop(1, LOCO.boilerDark);
    g.fillStyle = bg;
    rr(g, cx - T * 0.27, y, T * 0.54, h, T * 0.06);
    g.fill();
    g.fillStyle = LOCO.brass;
    for (const u of [0.66, 0.9, 1.16, 1.42]) {
      const [by] = span(u, u + 0.035);
      g.fillRect(cx - T * 0.27, by, T * 0.54, Math.max(1, T * 0.035));
    }
  }
  // the headlight at its front
  {
    const [y, h] = span(0.3, 0.5);
    g.fillStyle = '#2a2b30';
    g.fillRect(cx - T * 0.12, y, T * 0.24, h);
    g.fillStyle = LOCO.brass;
    g.fillRect(cx - T * 0.12, frontSouth ? y + h - T * 0.04 : y, T * 0.24, T * 0.04);
  }
  // the stack, from above: a wide ring round a dark throat
  const st = F(0.47);
  g.fillStyle = '#16171b';
  circle(g, cx, st, T * 0.16);
  g.fill();
  g.strokeStyle = LOCO.brass;
  g.lineWidth = Math.max(1, T * 0.035);
  circle(g, cx, st, T * 0.15);
  g.stroke();
  g.fillStyle = '#050505';
  circle(g, cx, st, T * 0.08);
  g.fill();
  // the domes and the bell
  const dome = (u: number, r: number, fill: string, lit: string): void => {
    g.fillStyle = fill;
    circle(g, cx, F(u), r);
    g.fill();
    g.fillStyle = lit;
    circle(g, cx - r * 0.3, F(u) - r * 0.3, r * 0.4);
    g.fill();
  };
  dome(0.98, T * 0.13, LOCO.brass, LOCO.brassLit);
  dome(1.13, T * 0.06, LOCO.brass, LOCO.brassLit);
  dome(1.3, T * 0.09, LOCO.red, LOCO.redLit);
  // the cab roof at its back
  {
    const [y, h] = span(1.46, 2.0);
    g.fillStyle = LOCO.roof;
    rr(g, cx - T * 0.42, y, T * 0.84, h, T * 0.05);
    g.fill();
    g.fillStyle = LOCO.roofLit;
    g.fillRect(cx - T * 0.42, y + h * 0.45, T * 0.84, Math.max(1, T * 0.03));
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(cx - T * 0.42, y, T * 0.3, h);
  }
  void len;
}

/** The tender from above: its tank's edge round a heap of coal, a hatch at the back. */
function topTender(g: Ctx, cx: number, north: number, south: number, T: number): void {
  const h = south - north;
  g.fillStyle = LOCO.cab;
  rr(g, cx - T * 0.4, north, T * 0.8, h, T * 0.06);
  g.fill();
  g.fillStyle = LOCO.redLit;
  g.fillRect(cx - T * 0.4, north, T * 0.06, h);
  g.fillStyle = LOCO.coal;
  rr(g, cx - T * 0.32, north + h * 0.1, T * 0.64, h * 0.62, T * 0.08);
  g.fill();
  g.fillStyle = 'rgba(160,170,190,0.35)';
  for (let k = 0; k < 9; k++) {
    g.fillRect(cx + T * (hash(k * 3.1) * 0.5 - 0.27), north + h * (0.14 + hash(k * 7.7) * 0.52), T * 0.05, T * 0.03);
  }
  g.fillStyle = LOCO.brass;
  circle(g, cx, north + h * 0.84, T * 0.08);
  g.fill();
  g.fillStyle = LOCO.brassDark;
  circle(g, cx, north + h * 0.84, T * 0.045);
  g.fill();
}

/** A coach from above: its curved roof, darker at the edges, the clerestory along the middle with vents. */
function topCoach(g: Ctx, cx: number, north: number, south: number, T: number, n: number): void {
  const h = south - north;
  const rg = g.createLinearGradient(cx - T * 0.41, 0, cx + T * 0.41, 0);
  rg.addColorStop(0, '#1f1b19');
  rg.addColorStop(0.3, LOCO.roofLit);
  rg.addColorStop(0.7, LOCO.roof);
  rg.addColorStop(1, '#1f1b19');
  g.fillStyle = rg;
  rr(g, cx - T * 0.41, north + h * 0.04, T * 0.82, h * 0.92, T * 0.06);
  g.fill();
  // a line of the coach's green showing at each side, under the roof's edge
  g.fillStyle = LOCO.coach;
  g.fillRect(cx - T * 0.43, north + h * 0.07, T * 0.03, h * 0.86);
  g.fillRect(cx + T * 0.4, north + h * 0.07, T * 0.03, h * 0.86);
  // the clerestory and its lit little windows along both sides
  g.fillStyle = '#4c423d';
  g.fillRect(cx - T * 0.15, north + h * 0.14, T * 0.3, h * 0.72);
  g.fillStyle = 'rgba(255,215,122,0.6)';
  for (let k = 0; k < 6; k++) {
    const y = north + h * (0.18 + k * 0.11);
    g.fillRect(cx - T * 0.17, y, T * 0.03, h * 0.05);
    g.fillRect(cx + T * 0.14, y, T * 0.03, h * 0.05);
  }
  // vents along the top
  g.fillStyle = '#2a2523';
  for (let k = 0; k < 3; k++) {
    circle(g, cx, north + h * (0.28 + k * 0.22), T * 0.05);
    g.fill();
  }
  // the platforms at its ends
  g.fillStyle = LOCO.iron;
  g.fillRect(cx - T * 0.36, north, T * 0.72, h * 0.05);
  g.fillRect(cx - T * 0.36, south - h * 0.05, T * 0.72, h * 0.05);
  void n;
}

/** A persistent layer the train is drawn on before it goes onto the arena, so its ends can darken in its tunnels. */
let layer: HTMLCanvasElement | null = null;

/**
 * The train, if one is out on its line: from the side along a row, from above down a column, cut off at the
 * outer wall and darkening as it goes into a tunnel; smoke from its stack, its headlight's beam ahead of it, its
 * drive wheels turning. `ticks`: the world's tick with the fraction of the frame since, so it moves smoothly.
 */
export function drawTrain(ctx: Ctx, world: World, T: number, ticks: number, time: number): void {
  const tr = world.train;
  if (!tr || ticks < tr.enterAt - 1 || ticks > tr.exitAt + 1) return;
  const r = world.rails[tr.line];
  const [back, front] = trainSpan(world, tr, ticks);
  const len = railLength(world, tr.line);
  const W = world.w * T;
  const H = world.h * T;
  layer ??= document.createElement('canvas');
  const g = layer.getContext('2d')!;
  // (only the strip the train runs along)
  const lw = r.dir === 'h' ? Math.ceil(W) : Math.ceil(T * 1.4);
  const lh = r.dir === 'h' ? Math.ceil(T * (SIDE_UP + SIDE_DOWN + 0.1)) : Math.ceil(H);
  if (layer.width !== lw || layer.height !== lh) {
    layer.width = lw;
    layer.height = lh;
  } else g.clearRect(0, 0, lw, lh);
  // where the layer goes on the arena
  const ox = r.dir === 'h' ? 0 : (r.at + 0.5) * T - lw / 2;
  const oy = r.dir === 'h' ? (r.at + 0.5 + 0.4) * T - SIDE_UP * T : 0;
  const run = (ticks - tr.enterAt) * TRAIN_SPEED; // tiles it has come
  if (r.dir === 'h') {
    const sp = sideSprite(T);
    // its back, on the arena
    const bx = (back + 0.5) * T;
    g.save();
    if (tr.dir < 0) {
      g.translate(bx * 2 + TRAIN_LENGTH * T, 0);
      g.scale(-1, 1);
    }
    g.drawImage(sp, bx - SIDE_PAD * T, 0);
    // the drive wheels, turning, and the rods that turn them
    driveGear(g, bx + CARS[0][1] * T, SIDE_UP * T, T, run);
    g.restore();
  } else {
    const sp = topSprite(T, tr.dir > 0);
    const top = (back + 0.5) * T - TOP_PAD * T - LIFT * T;
    g.drawImage(sp, (lw - sp.width) / 2, top);
  }
  // into the dark at each end: what is near a tunnel darkens (only the train: drawn on its own layer)
  g.save();
  g.globalCompositeOperation = 'source-atop';
  const fade = T * 0.9;
  for (const end of [0, 1]) {
    const edge = end ? (len + 1) * T : T; // the inside of the outer wall
    if (r.dir === 'h') {
      const gr = g.createLinearGradient(edge, 0, edge + (end ? -fade : fade), 0);
      gr.addColorStop(0, 'rgba(6,3,1,0.92)');
      gr.addColorStop(1, 'rgba(6,3,1,0)');
      g.fillStyle = gr;
      g.fillRect(end ? edge - fade : edge, 0, fade, lh);
    } else {
      const gr = g.createLinearGradient(0, edge, 0, edge + (end ? -fade : fade));
      gr.addColorStop(0, 'rgba(6,3,1,0.92)');
      gr.addColorStop(1, 'rgba(6,3,1,0)');
      g.fillStyle = gr;
      g.fillRect(0, end ? edge - fade : edge, lw, fade);
    }
  }
  g.restore();
  // onto the arena, cut off at the outer wall
  ctx.save();
  ctx.beginPath();
  if (r.dir === 'h') ctx.rect(T, 0, len * T, H);
  else ctx.rect(0, T * (1 - LIFT), W, (len + LIFT) * T);
  ctx.clip();
  // its shadow on the ground, to the lower right like everything else's
  ctx.fillStyle = 'rgba(20,8,2,0.35)';
  const s0 = Math.max(1, back + 0.5);
  const s1 = Math.min(len + 1, front + 0.5);
  if (s1 > s0) {
    if (r.dir === 'h') ctx.fillRect(s0 * T, (r.at + 0.3) * T, (s1 - s0) * T, T * 0.66);
    else ctx.fillRect((r.at + 0.12) * T, s0 * T, T * 0.86, (s1 - s0) * T);
  }
  ctx.drawImage(layer, ox, oy);
  // the headlight's beam on the ground ahead
  headlight();
  ctx.restore();
  // smoke from the stack, left behind as it goes and rising
  smoke(ctx, world, tr, ticks, T, time);

  function headlight(): void {
    const nose = tr!.dir > 0 ? front : back;
    const d = tr!.dir;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const fx = r.dir === 'h' ? (nose + 0.5) * T : (r.at + 0.5) * T;
    const fy = r.dir === 'h' ? (r.at + 0.5) * T : (nose + 0.5) * T;
    const reach = T * 1.8;
    const gx = r.dir === 'h' ? fx + d * reach : fx;
    const gy2 = r.dir === 'h' ? fy : fy + d * reach;
    const gr = ctx.createLinearGradient(fx, fy, gx, gy2);
    gr.addColorStop(0, 'rgba(255,230,160,0.22)');
    gr.addColorStop(0.5, 'rgba(255,230,160,0.08)');
    gr.addColorStop(1, 'rgba(255,230,160,0)');
    ctx.fillStyle = gr;
    ctx.beginPath();
    if (r.dir === 'h') {
      ctx.moveTo(fx, fy - T * 0.1);
      ctx.lineTo(gx, fy - T * 0.42);
      ctx.lineTo(gx, fy + T * 0.42);
      ctx.lineTo(fx, fy + T * 0.1);
    } else {
      ctx.moveTo(fx - T * 0.1, fy);
      ctx.lineTo(fx - T * 0.42, gy2);
      ctx.lineTo(fx + T * 0.42, gy2);
      ctx.lineTo(fx + T * 0.1, fy);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

/** The engine's two big drive wheels, turned by how far it has come, and the rods between them. `xf`: the engine's front on the layer (facing right). */
function driveGear(g: Ctx, xf: number, gy: number, T: number, run: number): void {
  const r = T * 0.25;
  const turn = run / 0.25; // (a wheel of radius 0.25 tiles turns once in 2π × 0.25 tiles)
  const wheels = [1.05, 1.62].map((u) => xf - u * T);
  const wy = gy - r;
  for (const x of wheels) sideWheel(g, x, wy, r, 10, -turn);
  // the crank pins and the side rod joining them, and the main rod back from the cylinder
  const px = Math.cos(-turn) * r * 0.55;
  const py = Math.sin(-turn) * r * 0.55;
  g.strokeStyle = '#9a9ca6';
  g.lineWidth = Math.max(1.2, T * 0.05);
  line(g, wheels[0] + px, wy + py, wheels[1] + px, wy + py);
  g.strokeStyle = '#7c7e88';
  g.lineWidth = Math.max(1, T * 0.04);
  line(g, xf - 0.62 * T, gy - 0.3 * T, wheels[0] + px, wy + py);
  g.fillStyle = LOCO.brass;
  for (const x of wheels) {
    circle(g, x + px, wy + py, T * 0.035);
    g.fill();
  }
  // the crosshead sliding in its guide
  g.fillStyle = '#5a5c64';
  g.fillRect(xf - 0.7 * T, gy - 0.33 * T, T * 0.16, T * 0.06);
}

/** Puffs of smoke left behind where the stack has been, rising, swelling and fading. Drawn straight onto the arena. */
function smoke(ctx: Ctx, world: World, tr: Train, ticks: number, T: number, time: number): void {
  const r = world.rails[tr.line];
  const len = railLength(world, tr.line);
  const LIFE = 70; // ticks a puff lasts
  const EVERY = 5; // ticks between puffs
  ctx.save();
  ctx.beginPath();
  ctx.rect(T, 0, (world.w - 2) * T, (world.h - 1) * T);
  ctx.clip();
  const first = Math.ceil((ticks - LIFE) / EVERY) * EVERY;
  for (let t = first; t <= ticks; t += EVERY) {
    if (t < tr.enterAt || t > tr.exitAt) continue;
    const age = (ticks - t) / LIFE;
    if (age < 0 || age >= 1) continue;
    const [b, f] = trainSpan(world, tr, t);
    const stackAt = tr.dir > 0 ? f - 0.47 : b + 0.47; // along the line, where the stack was then
    if (stackAt < 0.5 || stackAt > len + 0.5) continue;
    const drift = (hash(t * 1.37) - 0.5) * 0.6;
    const rise = age * 1.1 + 0.15;
    let x: number;
    let y: number;
    if (r.dir === 'h') {
      x = (stackAt + 0.5) * T + drift * T * age;
      y = (r.at + 0.9) * T - 1.3 * T - rise * T;
    } else {
      // (seen from above it drifts off to the side as it rises)
      x = (r.at + 0.5) * T + (drift + (hash(t * 0.71) < 0.5 ? -0.3 : 0.3) * age) * T;
      y = (stackAt + 0.5) * T - LIFT * T - rise * T * 0.35;
    }
    const size = T * (0.16 + 0.4 * age);
    const a = (1 - age) * (1 - age) * 0.5;
    const shade = Math.round(60 + 120 * age);
    // a soft round puff: dark when fresh, paling as it spreads
    const g = ctx.createRadialGradient(x - size * 0.25, y - size * 0.25, 0, x, y, size);
    g.addColorStop(0, `rgba(${shade + 30},${shade + 26},${shade + 22},${a.toFixed(3)})`);
    g.addColorStop(0.6, `rgba(${shade},${shade - 4},${shade - 8},${(a * 0.7).toFixed(3)})`);
    g.addColorStop(1, `rgba(${shade},${shade - 4},${shade - 8},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - size, y - size, size * 2, size * 2);
  }
  ctx.restore();
  void time;
}

// ---------------------------------------------------------------- TNT

/**
 * A barrel of TNT on its tile: a red wooden barrel standing on the sand, its staves and two iron hoops, its lid
 * with a fuse, and a label saying TNT (the owner's ask: it must say TNT). Made once per size and stamped.
 */
const barrels = new Map<number, HTMLCanvasElement>();
export function drawBarrel(ctx: Ctx, px: number, py: number, T: number): void {
  if (Number.isInteger(T) && T <= 200) {
    let c = barrels.get(T);
    if (!c) {
      if (barrels.size > 8) barrels.clear();
      c = document.createElement('canvas');
      c.width = c.height = T;
      paintBarrel(c.getContext('2d')!, 0, 0, T);
      barrels.set(T, c);
    }
    ctx.drawImage(c, px, py);
  } else paintBarrel(ctx, px, py, T);
}

function paintBarrel(g: Ctx, px: number, py: number, T: number): void {
  const x = (f: number): number => px + f * T;
  const y = (f: number): number => py + f * T;
  // its shadow on the sand
  g.fillStyle = 'rgba(38,14,4,0.45)';
  g.beginPath();
  g.ellipse(x(0.54), y(0.9), T * 0.4, T * 0.1, 0, 0, Math.PI * 2);
  g.fill();
  // the body: wider in the middle, as a barrel is
  const L = 0.15;
  const R = 0.85;
  const top = 0.24;
  const bottom = 0.9;
  const bulge = 0.06;
  const outline = (): void => {
    g.beginPath();
    g.moveTo(x(L + bulge * 0.4), y(top));
    g.quadraticCurveTo(x(L - bulge), y((top + bottom) / 2), x(L + bulge * 0.4), y(bottom));
    g.ellipse(x(0.5), y(bottom), T * (0.5 - L - bulge * 0.4), T * 0.07, 0, Math.PI, 0, true);
    g.quadraticCurveTo(x(R + bulge), y((top + bottom) / 2), x(R - bulge * 0.4), y(top));
    g.closePath();
  };
  const body = g.createLinearGradient(x(L - bulge), 0, x(R + bulge), 0);
  body.addColorStop(0, '#5c1210');
  body.addColorStop(0.28, '#e0473a');
  body.addColorStop(0.45, '#c8322a');
  body.addColorStop(1, '#5a110e');
  g.fillStyle = body;
  outline();
  g.fill();
  // its staves: thin dark lines curving with it
  g.save();
  outline();
  g.clip();
  g.strokeStyle = 'rgba(70,10,6,0.55)';
  g.lineWidth = Math.max(0.7, T * 0.018);
  for (const f of [0.27, 0.39, 0.5, 0.61, 0.73]) {
    const bend = (f - 0.5) * 0.12;
    g.beginPath();
    g.moveTo(x(f), y(top));
    g.quadraticCurveTo(x(f + bend), y((top + bottom) / 2), x(f), y(bottom + 0.05));
    g.stroke();
  }
  // two iron hoops, round it
  for (const hy of [0.36, 0.8]) {
    g.fillStyle = '#26221f';
    g.beginPath();
    g.ellipse(x(0.5), y(hy), T * 0.4, T * 0.07, 0, 0, Math.PI);
    g.ellipse(x(0.5), y(hy - 0.055), T * 0.4, T * 0.07, 0, Math.PI, 0, true);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.28)';
    g.lineWidth = Math.max(0.6, T * 0.014);
    g.beginPath();
    g.ellipse(x(0.5), y(hy - 0.05), T * 0.4, T * 0.07, 0, Math.PI * 0.55, Math.PI * 0.85);
    g.stroke();
  }
  g.restore();
  // the lid: lighter wood, a dark rim, a fuse curling up out of it
  g.fillStyle = '#4a0f0c';
  g.beginPath();
  g.ellipse(x(0.5), y(top), T * (0.5 - L - bulge * 0.4), T * 0.1, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#b5562f';
  g.beginPath();
  g.ellipse(x(0.5), y(top), T * (0.5 - L - bulge * 0.4 - 0.035), T * 0.075, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(70,20,6,0.5)';
  g.lineWidth = Math.max(0.6, T * 0.012);
  line(g, x(0.32), y(top), x(0.68), y(top));
  g.strokeStyle = '#2a2420';
  g.lineWidth = Math.max(1, T * 0.035);
  g.beginPath();
  g.moveTo(x(0.56), y(top));
  g.quadraticCurveTo(x(0.66), y(top - 0.14), x(0.6), y(top - 0.19));
  g.stroke();
  // the label: a cream panel, TNT in heavy black letters
  const lx = x(0.24);
  const ly = y(0.45);
  const lw = T * 0.52;
  const lh = T * 0.27;
  g.fillStyle = '#2a0a08';
  rr(g, lx - T * 0.015, ly - T * 0.015, lw + T * 0.03, lh + T * 0.03, T * 0.04);
  g.fill();
  g.fillStyle = '#f2e3b6';
  rr(g, lx, ly, lw, lh, T * 0.03);
  g.fill();
  g.fillStyle = '#140504';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = T * 0.25;
  g.font = `900 ${size}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
  const fit = lw * 0.9;
  const m = g.measureText('TNT').width;
  if (m > fit) {
    size *= fit / m;
    g.font = `900 ${size}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
  }
  g.fillText('TNT', lx + lw / 2, ly + lh / 2 + T * 0.01);
}

/** A barrel a blast has reached, in the moment before it goes: it swells and glows white-hot, sparking. */
export function drawLitTnt(ctx: Ctx, world: World, T: number, time: number): void {
  for (const l of world.tntLit) {
    const k = 1 - Math.max(0, l.t) / TNT_FUSE_TICKS; // 0 when lit, 1 as it goes
    const cx = (l.cx + 0.5) * T;
    const cy = (l.cy + 0.55) * T;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, T * (0.5 + 0.4 * k));
    g.addColorStop(0, `rgba(255,250,220,${(0.5 + 0.5 * k).toFixed(3)})`);
    g.addColorStop(0.5, `rgba(255,150,60,${(0.35 + 0.4 * k).toFixed(3)})`);
    g.addColorStop(1, 'rgba(255,80,20,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - T, cy - T, T * 2, T * 2);
    ctx.fillStyle = '#fff0b0';
    for (let s = 0; s < 6; s++) {
      const a = s * 1.05 + time * 9;
      const d = T * (0.25 + 0.35 * ((time * 4 + s * 0.17) % 1));
      circle(ctx, cx + Math.cos(a) * d, cy - T * 0.2 + Math.sin(a) * d * 0.6, T * 0.025);
      ctx.fill();
    }
    ctx.restore();
  }
}

/** A crossing signal with a lamp lit, on sand, `s` across: for the menu's Key. */
export function drawSignalIcon(ctx: Ctx, s: number): void {
  ctx.fillStyle = '#93714a';
  ctx.fillRect(0, 0, s, s);
  const sig: Signal = { x: 0, y: 0, inward: [0, 1], away: [1, 0] };
  drawSignal(ctx, sig, s, 1, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  lampGlow(ctx, sig, s, 0);
  ctx.restore();
}

/** The tiles of the outer wall the railway uses (its tunnels and signals), by index: no cactus grows on them. */
export function railWalls(world: World): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < world.rails.length; i++) {
    for (const e of ends(world, world.rails[i])) out.add(e.y * world.w + e.x);
    for (const s of signalsOf(world, i)) out.add(s.y * world.w + s.x);
  }
  return out;
}
