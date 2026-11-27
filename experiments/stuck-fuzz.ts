// Fuzz: play rounds with a robot pressing things at random (and CPU rivals), on every map, and look for a moment
// when it straddles two tiles, next to bombs, and no direction held for 20 ticks moves it.
import { createWorld, cloneWorld, step, World, PlayerInput, Dir } from '../src/sim';
import { createBot, botInput } from '../src/bot';
const MAPS = [{}, { rails: true, tnt: true }, { ice: true }, { belts: true }] as const;
const N = Number(process.env.N ?? 60);
let checks = 0, stuck = 0;
for (const [mi, extra] of MAPS.entries()) {
  for (let seed = 1; seed <= N; seed++) {
    const w: World = createWorld({ seed, players: [0, 1, 2, 3].map((i) => ({ colorId: String(i) })), roundTicks: 0, ...extra });
    const me = w.players[0];
    me.canKick = seed % 2 === 0;
    (me as any).canLift = seed % 3 === 0;
    me.bombsMax = 4;
    me.fire = 2;
    const bots = [1, 2, 3].map((i) => createBot(i, 'hard', seed * 7 + i));
    let r = seed * 99991;
    const rnd = (): number => ((r = (r * 1103515245 + 12345) >>> 0) / 4294967296);
    let dir: Dir = 0;
    for (let t = 0; t < 60 * 60 && !w.over && me.alive; t++) {
      if (rnd() < 0.12) dir = Math.floor(rnd() * 5) as Dir;
      const a = rnd() < 0.05;
      const b = rnd() < 0.02;
      const ins: PlayerInput[] = [{ dir, a, b }, ...bots.map((bt) => botInput(w, bt))];
      step(w, ins);
      if (t % 3) continue;
      const fx = Math.abs(me.x - Math.round(me.x)), fy = Math.abs(me.y - Math.round(me.y));
      if (Math.max(fx, fy) < 0.25 || !me.alive || me.flying) continue;
      const near = w.bombs.filter((bm) => Math.abs(bm.cx - me.x) <= 1.6 && Math.abs(bm.cy - me.y) <= 1.6);
      if (near.length < 2) continue;
      checks++;
      let free = false;
      for (const d of [1, 2, 3, 4] as Dir[]) {
        const c = cloneWorld(w);
        for (let k = 0; k < 20 && !free; k++) {
          step(c, [{ dir: d, a: false, b: false }, none(), none(), none()]);
          const q = c.players[0];
          if (!q.alive || Math.abs(q.x - me.x) > 0.2 || Math.abs(q.y - me.y) > 0.2) free = true;
        }
        if (free) break;
      }
      if (!free) {
        stuck++;
        if (stuck <= 6) console.log(`map ${mi} seed ${seed} tick ${w.tick}: robot ${me.x.toFixed(3)},${me.y.toFixed(3)} bombs ${near.map((bm) => `${bm.cx},${bm.cy}${bm.owner === 0 ? '(own)' : ''} slide${bm.slide} ${bm.state}`).join(' | ')}`);
      }
    }
  }
}
function none(): PlayerInput { return { dir: 0, a: false, b: false }; }
console.log(`straddling moments next to 2+ bombs: ${checks}, stuck: ${stuck}`);
