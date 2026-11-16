/**
 * The victory dances: what a robot does when it wins a round. Each player picks one in the lobby (yours on
 * the Players page, under your robot; another player here with up and down on their controller; a CPU
 * player in its panel), and sees it played there before picking.
 *
 * A dance is worked out from the time alone (`danceFrame`): which way the robot faces, whether its legs
 * step, how high it is off the floor, how it leans, how far it has slid sideways, and how high each arm is.
 * Nothing here draws (render.ts and lobby.ts do) and nothing is random, so the same time always gives the
 * same picture.
 *
 * Arms can only be raised in the front view, and a robot's pictures are made once and kept, so the dances
 * stick to a few arm heights each: the first time a dance is played it is not slowed by making many new ones.
 */
import type { Pose } from './robot';
import type { Dir } from './sim';

export type DanceId = 'party' | 'spin' | 'griddy' | 'percolator' | 'gangnam';

export interface Dance {
  id: DanceId;
  name: string;
  /** a few words on it, for the lobby */
  blurb: string;
}

/** In the order the lobby's arrows go through them. Party was the only dance before there was a choice. */
export const DANCES: Dance[] = [
  { id: 'party', name: 'Party', blurb: 'A jump, then a bounce side to side, pumping each arm' },
  { id: 'spin', name: 'Spin', blurb: 'Two spins in the air, then both arms up: ta-da' },
  { id: 'griddy', name: 'Griddy', blurb: 'The touchdown dance: quick steps, arms swinging, sliding side to side' },
  { id: 'percolator', name: 'Percolator', blurb: 'The house dance: knees snapping in and out on the beat, a bubbly bounce, hands rolling low' },
  { id: 'gangnam', name: 'Gangnam', blurb: 'Gangnam Style, the horse-riding dance: a galloping hop holding the reins, then one arm up swinging the lasso' },
];
export const DANCE_IDS: DanceId[] = DANCES.map((d) => d.id);

export function isDance(v: unknown): v is DanceId {
  return typeof v === 'string' && (DANCE_IDS as string[]).includes(v);
}
export function danceOf(id: DanceId): Dance {
  return DANCES.find((d) => d.id === id) ?? DANCES[0];
}
/** The next dance that way (1 or -1), going round. */
export function stepDance(id: DanceId, d: number): DanceId {
  const i = DANCE_IDS.indexOf(id);
  return DANCE_IDS[(i + d + DANCE_IDS.length * 4) % DANCE_IDS.length];
}

/** One moment of a dance. */
export interface DanceFrame {
  /** 2 facing the viewer, 1 its back, 3 and 4 its sides (sim.ts's directions) */
  facing: Dir;
  /** stepping: true, with `walk` the step's phase in radians (as a walking robot's) */
  moving: boolean;
  walk: number;
  /** slid sideways from its tile, in tiles (right is +) */
  dx: number;
  /** off the floor, leaning, arms */
  pose: Pose;
}

const TAU = Math.PI * 2;
/** the same number of steps as a robot's walk pictures (robot.ts WALK_FRAMES), so each step is one picture */
const STEP_PICS = 8;

/** Dance `id`, `t` seconds after the round was decided. */
export function danceFrame(id: DanceId, t: number): DanceFrame {
  if (id === 'spin') return spin(t);
  if (id === 'griddy') return griddy(t);
  if (id === 'percolator') return percolator(t);
  if (id === 'gangnam') return gangnam(t);
  return party(t);
}

/** Party: a jump with one arm in the air, then bouncing from side to side, one arm rising as the other falls. */
function party(t: number): DanceFrame {
  const JUMP = 0.7;
  const still = { facing: 2 as Dir, moving: false, walk: 0, dx: 0 };
  if (t < JUMP) return { ...still, pose: { jump: Math.sin((Math.PI * t) / JUMP) * 0.5, arms: [0, 1] } };
  const s = Math.sin((t - JUMP) * 7.5);
  return { ...still, pose: { jump: Math.abs(s) * 0.1, lean: s * 0.14, arms: [0.5 + 0.5 * s, 0.5 - 0.5 * s] } };
}

/**
 * Spin: a big jump turning round twice in the air (front, side, back, other side), a landing, then both
 * arms flung up with a little bounce, held, and again.
 */
function spin(t: number): DanceFrame {
  const AIR = 0.8;
  const LAND = 0.12;
  const CYCLE = 2.1;
  const u = t % CYCLE;
  const base = { moving: false, walk: 0, dx: 0 };
  if (u < AIR) {
    const turns: Dir[] = [2, 4, 1, 3];
    const q = Math.min(7, Math.floor((u / AIR) * 8)); // two turns, a quarter at a time
    return { ...base, facing: turns[q % 4], pose: { jump: Math.sin((Math.PI * u) / AIR) * 0.6 } };
  }
  if (u < AIR + LAND) return { ...base, facing: 2, pose: { arms: [0.5, 0.5], shrink: 0.94 } }; // knees bent on landing
  const v = u - AIR - LAND;
  const up = v < 0.95; // ta-da, then the arms come down ready for the next jump
  return { ...base, facing: 2, pose: { jump: up ? Math.abs(Math.sin(v * 8)) * 0.06 : 0, arms: up ? [1, 1] : [0.25, 0.25] } };
}

/**
 * Griddy (the touchdown dance): quick steps on the spot, the arms swinging in time with the steps, and the
 * whole robot sliding from side to side as it goes, leaning into the slide.
 */
function griddy(t: number): DanceFrame {
  const walk = t * 17; // a step about every 0.18 s
  const pic = Math.round((walk / TAU) * STEP_PICS); // the arms follow the step picture, so there are only eight of them
  const s = Math.sin((pic / STEP_PICS) * TAU);
  const slide = Math.sin(t * 2.4);
  return {
    facing: 2,
    moving: true,
    walk,
    dx: slide * 0.2,
    pose: { jump: Math.abs(Math.sin(walk)) * 0.035, lean: Math.cos(t * 2.4) * 0.09, arms: [0.35 + 0.35 * s, 0.35 - 0.35 * s] },
  };
}

/**
 * Percolator (the Chicago house dance, to the 1992 track of that name), from how dancers teach it: weight on
 * the balls of the feet, knees soft and bent; then the knees snap in together (heels turn out) and back apart
 * (toes turn out), over and over on the beat, Charleston-like, with a small bounce on the off-beat that gives
 * it its "bubbling" look. The upper body stays fairly still; the hands roll in front, "wax on, wax off".
 *
 * Here: a little crouch the whole time; knees in on the beat and out on the "and" (`Pose.knees`); a hop as the
 * knees open; a slight sway of the shoulders; the arms low in front, one up as the other comes down, rolling
 * with the knees. The tempo is the track's, about 126 beats a minute. Knees and arms are worked out from one
 * step of eight per beat, so it needs only eight pictures.
 */
function percolator(t: number): DanceFrame {
  const BEATS_PER_S = 126 / 60;
  const beat = t * BEATS_PER_S;
  const step = Math.floor(beat * STEP_PICS) % STEP_PICS; // eight steps a beat
  const a = (step / STEP_PICS) * TAU;
  const knees = Math.cos(a); // in together on the beat, apart on the "and"
  const roll = Math.sin(a); // the hands roll a quarter beat behind the knees
  return {
    facing: 2,
    moving: false,
    walk: 0,
    dx: 0,
    pose: {
      knees,
      shrink: 0.95 - 0.02 * Math.max(0, knees), // a little lower as the knees come in
      jump: 0.045 * Math.max(0, -knees), // the bubble: up off the floor as they open
      lean: Math.sin((beat / 2) * TAU) * 0.035, // a slight sway, side to side every two beats
      arms: [0.22 + 0.14 * roll, 0.22 - 0.14 * roll],
    },
  };
}

/**
 * Gangnam Style (the horse-riding dance): a galloping hop on the spot with both hands low, holding the
 * reins; then one arm goes up, swinging the lasso, and it steps from side to side, and back to the reins.
 */
function gangnam(t: number): DanceFrame {
  const REINS = 2.2;
  const u = t % (REINS * 2);
  const walk = t * 14;
  // a gallop: two quick hops, a short rest
  const hop = Math.max(0, Math.sin(t * 14)) * 0.08;
  const lasso = u >= REINS;
  return {
    facing: 2,
    moving: true,
    walk,
    dx: lasso ? Math.sin((u - REINS) * 2.86) * 0.16 : 0,
    pose: { jump: hop, lean: lasso ? Math.sin(t * 7) * 0.07 : 0, arms: lasso ? [0.12, 1] : [0.12, 0.12] },
  };
}

/** Every moment worth having a picture of ahead of time, sampled across one go of the dance. */
export function danceSamples(id: DanceId): DanceFrame[] {
  const out: DanceFrame[] = [];
  for (let t = 0; t < 3; t += 1 / 40) out.push(danceFrame(id, t));
  return out;
}
