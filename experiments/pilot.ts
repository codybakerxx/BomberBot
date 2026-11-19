/**
 * Experiment: how often does a CPU player flying a laptop's plane get the player it goes for?
 *
 * One CPU pilot of each level against one target, many arenas. The pilot is handed a laptop a second and a half
 * in and flies when its level says to; what is counted is whether the target is knocked out by the pilot by the
 * time the flight is over and its last bomb has landed. Three kinds of target:
 *
 *   - a runner, which keeps walking until a wall and then picks a way at random: a person busy elsewhere, who
 *     never looks up (it does wait for flames ahead of it to die down rather than walk into them)
 *   - a wanderer, which also turns at random every half second
 *   - a Normal CPU player, which dodges a falling bomb once it notices it (bot.ts, `dangerMap`)
 *
 * The runner and the wanderer are in an arena with no bricks (the worst case for them: nowhere to hide and
 * nothing to soak up a bomb); the CPU player is in an arena with some. Nothing here can say how a person does
 * against a CPU pilot, or how hard the plane is for a person to fly: that has to be played.
 *
 *   npx tsx experiments/pilot.ts           every level, 60 arenas each
 *   N=200 npx tsx experiments/pilot.ts     more arenas
 */
import { createWorld, step, makeRng, DX, DY, tileAt, FLOOR, type Dir, type PlayerInput } from '../src/sim';
import { botInput, createBot, LEVELS, BOT_LEVELS, type BotLevel } from '../src/bot';

type Target = 'runner' | 'wanderer' | 'normal';

/** Knocked out in how many flights, of how many. */
function flights(level: BotLevel, target: Target, n: number): [number, number] {
  let hits = 0;
  let flown = 0;
  for (let seed = 1; seed <= n; seed++) {
    const cpu = target === 'normal';
    const w = createWorld({ roundTicks: 0, seed, players: [{ colorId: 'gold' }, { colorId: 'blue' }], softDensity: cpu ? 0.4 : 0 });
    const me = w.players[0];
    const q = w.players[1];
    const rng = makeRng(seed * 31);
    const pilot = createBot(0, level, seed);
    const rival = cpu ? createBot(1, 'normal', seed + 100) : null;
    let d: Dir = 3;
    let launched = false;
    for (let t = 0; t < 40 * 60 && !w.over; t++) {
      if (t === 90) me.laptop = true;
      let other: PlayerInput;
      if (rival) other = botInput(w, rival);
      else {
        const qx = Math.round(q.x);
        const qy = Math.round(q.y);
        if ((target === 'wanderer' && t % 30 === 0) || d === 0 || tileAt(w, qx + DX[d], qy + DY[d]) !== FLOOR) {
          const open = ([1, 2, 3, 4] as Dir[]).filter((k) => tileAt(w, qx + DX[k], qy + DY[k]) === FLOOR);
          d = open[Math.floor(rng() * open.length)] ?? 0;
        }
        const fire = d !== 0 && w.flames.some((f) => f.cx === qx + DX[d] && f.cy === qy + DY[d]);
        other = { dir: fire ? 0 : d, a: false, b: false };
      }
      step(w, [botInput(w, pilot), other]);
      for (const e of w.events) {
        if (e.type === 'launch') {
          flown++;
          launched = true;
        }
        if (e.type === 'death' && e.player === 1 && e.by === 0 && launched) hits++;
      }
      if (launched && !me.laptop && !me.flying && !w.drops.length) break;
    }
  }
  return [hits, flown];
}

const N = Number(process.env.N ?? 60);
const pct = ([h, f]: [number, number]): string => (f ? `${Math.round((100 * h) / f)}% of ${f}` : '-');
console.log(`A CPU pilot against one target, ${N} arenas each: the share of flights that knocked the target out.\n`);
console.log('pilot'.padEnd(10) + 'fly  lead  slop  carry'.padEnd(26) + 'runner'.padStart(12) + 'wanderer'.padStart(12) + 'Normal CPU'.padStart(13));
for (const lv of BOT_LEVELS) {
  const s = LEVELS[lv];
  const knobs = `${s.fly}`.padEnd(5) + `${s.lead}`.padEnd(6) + `${s.slop}`.padEnd(6) + `${s.carry}`;
  console.log(s.label.padEnd(10) + knobs.padEnd(26) + pct(flights(lv, 'runner', N)).padStart(12) + pct(flights(lv, 'wanderer', N)).padStart(12) + pct(flights(lv, 'normal', N)).padStart(13));
}
