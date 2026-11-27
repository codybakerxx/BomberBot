/**
 * ALL HAIL THE HUMAN: the special victory (the owner's design, 27 November 2026, option 1 of five offered).
 *
 * Shown when you, playing alone on this screen, win the match against CPU players who are all on Hard
 * (Randomize CPUs giving them all Hard counts too). It plays over the whole screen before the result panel:
 * gold letters slam down one at a time, ALL HAIL / THE HUMAN, each word landing with a thud and a shake;
 * your robot hops up in the middle wearing the crown, pumping its arms; the CPU players hop in from both
 * sides, stand in a half circle round it and bow to it, stiffly, in a wave; fireworks in your colour and gold
 * burst behind; then "Hard mode CPUs have been… humbled." About 4.6 s, or a tap (a key, a controller button)
 * to skip. `main.ts` decides when (`hailWorthy`) and shows the result panel when it ends.
 *
 * Its robots are drawn from the same sprites as the round's, made here at this screen's size, one a frame
 * while the letters land so none is made mid-animation; they are let go of when it closes. The CPU players
 * hop rather than walk, so each needs only its standing picture from the side.
 */
import { BotColor } from './render';
import { drawRobot, forgetSprites, type Pose } from './robot';
import type { Dir } from './sim';

/** How long it plays, in seconds, before it fades. */
export const HAIL_SECONDS = 4.6;
/** The fade at the end (and after a skip), seconds. */
const FADE = 0.3;
/** The first letter lands this long after the start; each next one this much later; the second line a little after the first. */
const FIRST = 0.18;
const EVERY = 0.07;
const LINE_GAP = 0.14;
/** A letter falls from this many times its size, for this long. */
const SLAM_FROM = 3.4;
const SLAM_TIME = 0.16;
/** When your robot hops up, when the CPU players start hopping in (each a little after the one before), and how long they take. */
const HERO_AT = 0.85;
const CPUS_AT = 1.05;
const CPU_GAP = 0.07;
const HOP_IN = 0.75;
/** When the bowing starts, how long one bow takes, and how deep it goes (radians). */
const BOW_AT = 1.95;
const BOW_TIME = 1.1;
const BOW_DEEP = 0.55;

/**
 * What plays: ALL HAIL THE HUMAN, or the plain YOU WON! (the owner's ask, 27 November 2026: a normal win
 * animation for every other match won, not special like the first). Fireworks run from `fireFrom` to
 * `fireUntil`, a rocket about every `fireEvery` seconds.
 */
export interface Show {
  lines: string[];
  seconds: number;
  fireFrom: number;
  fireUntil: number;
  fireEvery: number;
  /** the line under the robots, when it comes up, and when "Tap to continue" does (none: no such lines) */
  tagline?: string;
  tagAt: number;
  tapAt: number;
  /** how dark the screen behind goes */
  backdrop: number;
  /** your robot and the CPU players bowing (ALL HAIL THE HUMAN only) */
  stage: boolean;
}
export const HAIL: Show = {
  lines: ['ALL HAIL', 'THE HUMAN'],
  seconds: HAIL_SECONDS,
  fireFrom: 1.15,
  fireUntil: 4.0,
  fireEvery: 0.26,
  tagline: 'Hard mode CPUs have been… humbled.',
  tagAt: 2.25,
  tapAt: 3.0,
  backdrop: 0.9,
  stage: true,
};
/**
 * YOU WON!: every match you win but the special one. Shorter and lighter: the letters and a few fireworks
 * over the arena, darkened only a little so your robot's victory dance shows through. No robots of its own.
 */
export const YOU_WON: Show = {
  lines: ['YOU WON!'],
  seconds: 2.6,
  fireFrom: 0.5,
  fireUntil: 2.2,
  fireEvery: 0.3,
  tagAt: 99,
  tapAt: 99,
  backdrop: 0.5,
  stage: false,
};

export interface HailCast {
  /** your robot's colour */
  hero: BotColor;
  /** the CPU players' colours */
  cpus: BotColor[];
}

export interface HailHooks {
  /** a letter-word thud, and a firework bursting (sounds; each may be switched off in Settings) */
  slam: () => void;
  firework: () => void;
  /** the page's drawing density (Settings › Graphics › Sharpness) */
  density: () => number;
  /** Less movement: no shaking, fewer fireworks */
  calm: boolean;
  /** called once it has gone, played out or skipped */
  done: () => void;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  col: string;
  size: number;
}
interface Rocket {
  x: number;
  y: number;
  toY: number;
  born: number;
  rise: number;
  col: string;
  burst: boolean;
}

/** A small seeded random, so the fireworks differ each time without Math.random in the drawing's sums. */
function rand(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

const ease = (k: number): number => 1 - Math.pow(1 - Math.max(0, Math.min(1, k)), 3);

/** When each letter lands, line by line (spaces get none). */
function landings(lines: string[]): number[][] {
  let t = FIRST;
  return lines.map((line, li) => {
    if (li > 0) t += LINE_GAP;
    return [...line].map((ch) => {
      if (ch === ' ') return -1;
      const at = t;
      t += EVERY;
      return at;
    });
  });
}
/** When each word's last letter lands: one thud a word. */
function thuds(lines: string[]): number[] {
  const out: number[] = [];
  const at = landings(lines);
  lines.forEach((line, li) => {
    [...line].forEach((ch, i) => {
      if (ch !== ' ' && (i === line.length - 1 || line[i + 1] === ' ')) out.push(at[li][i]);
    });
  });
  return out;
}
/** The time the last letter lands. */
export const lettersDone = (show: Show): number => Math.max(...landings(show.lines).flat());

/**
 * Where the CPU players stand: a half circle round your robot, those on the left facing right and those on
 * the right facing left, the middle (behind you) left empty so nobody hides behind your robot. Returned in
 * units of the stage: x across from your feet in tiles, y back (up the screen) in tiles, and which way each faces.
 */
export function ring(n: number): { x: number; y: number; facing: Dir; from: number }[] {
  const left = Math.ceil(n / 2);
  const right = n - left;
  const out: { x: number; y: number; facing: Dir; from: number }[] = [];
  const arc = (count: number, a0: number, a1: number, facing: Dir, from: number): void => {
    for (let k = 0; k < count; k++) {
      const a = count === 1 ? (a0 + a1) / 2 : a0 + ((a1 - a0) * k) / (count - 1);
      const r = (a * Math.PI) / 180;
      out.push({ x: Math.cos(r) * 2.35, y: Math.sin(r) * 0.7 - 0.1, facing, from });
    }
  };
  // left: from just beside you round to the far left; right: the same, mirrored
  arc(left, 118, 172, 4, -1);
  arc(right, 62, 8, 3, 1);
  return out;
}

/** ALL HAIL THE HUMAN over the whole screen. Returns a function that skips it. */
export function playHail(cast: HailCast, hooks: HailHooks): () => void {
  return playShow(HAIL, cast, hooks);
}
/** YOU WON! over the whole screen (`cast.cpus` is not used). Returns a function that skips it. */
export function playWon(hero: BotColor, hooks: HailHooks): () => void {
  return playShow(YOU_WON, { hero, cpus: [] }, hooks);
}

function playShow(show: Show, cast: HailCast, hooks: HailHooks): () => void {
  const LINES = show.lines;
  const box = document.getElementById('hail') as HTMLDivElement;
  const cv = document.getElementById('hailCv') as HTMLCanvasElement;
  const ctx = cv.getContext('2d')!;
  const r = rand((Date.now() & 0xffff) * 2654435761);
  const spots = ring(cast.cpus.length);
  const lands = landings(LINES);
  const thudAt = thuds(LINES);
  let thudNext = 0;
  const rockets: Rocket[] = [];
  const sparks: Spark[] = [];
  let nextRocket = show.fireFrom;
  let start = -1;
  let endAt = show.seconds; // when the fade starts (sooner after a skip)
  let raf = 0;
  let gone = false;
  let shakeAt = -1;
  let px = 0; // the sprites' size, to let go of them at the end
  let warmed = 0; // robots whose sprites are made
  const colours = [cast.hero.glow, cast.hero.light, '#ffd36a', '#fff4d6', cast.hero.glow];

  const size = (): { W: number; H: number; d: number } => {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const d = hooks.density();
    const w = Math.round(W * d);
    const h = Math.round(H * d);
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
      cv.style.width = `${W}px`;
      cv.style.height = `${H}px`;
    }
    return { W, H, d };
  };

  const skip = (): void => {
    if (start < 0 || gone) return;
    const t = (performance.now() - start) / 1000;
    if (t < endAt) endAt = t;
  };
  const onKey = (e: KeyboardEvent): void => {
    // while it plays no key reaches the game; these skip it
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') skip();
  };
  const onHide = (): void => {
    if (document.hidden) close();
  };
  const padDown = (): boolean => {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.buttons.some((b) => b.pressed)) return true;
    return false;
  };
  let padWasDown = padDown();

  function close(): void {
    if (gone) return;
    gone = true;
    cancelAnimationFrame(raf);
    box.removeEventListener('pointerdown', skip);
    window.removeEventListener('keydown', onKey, true);
    document.removeEventListener('visibilitychange', onHide);
    box.hidden = true;
    document.body.classList.remove('hail-open');
    cv.width = cv.height = 1;
    if (px) forgetSprites(px);
    hooks.done();
  }

  function frame(now: number): void {
    if (gone) return;
    if (start < 0) start = now;
    const t = (now - start) / 1000;
    const pd = padDown();
    if (pd && !padWasDown) skip();
    padWasDown = pd;
    if (t >= endAt + FADE) {
      close();
      return;
    }
    const { W, H, d } = size();
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const fade = t > endAt ? 1 - (t - endAt) / FADE : 1;
    ctx.globalAlpha = fade;

    // the backdrop: the round darkened behind, a warm glow rising from the stage
    ctx.fillStyle = `rgba(5, 7, 16, ${show.backdrop * ease(t / 0.25)})`;
    ctx.fillRect(0, 0, W, H);

    // the stage: sizes from the screen
    const tile = Math.max(28, Math.min(H * 0.15, W * 0.19, 140));
    const feetY = H * (W > H ? 0.8 : 0.62);
    const cx = W / 2;
    const glow = ctx.createRadialGradient(cx, feetY, 0, cx, feetY, Math.max(W, H) * 0.55);
    glow.addColorStop(0, hexA(cast.hero.glow, (show.stage ? 0.28 : 0.12) * ease((t - (show.stage ? HERO_AT : 0.3)) / 0.6)));
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // shake: a short jolt when each word lands
    while (thudNext < thudAt.length && t >= thudAt[thudNext] + SLAM_TIME) {
      thudNext++;
      hooks.slam();
      shakeAt = t;
    }
    let sx = 0;
    let sy = 0;
    if (!hooks.calm && shakeAt >= 0 && t - shakeAt < 0.18) {
      const k = 1 - (t - shakeAt) / 0.18;
      sx = Math.round((r() - 0.5) * 7 * k);
      sy = Math.round((r() - 0.5) * 7 * k);
    }

    // fireworks, behind everything else
    fireworks(t, W, H, feetY, fade);

    ctx.save();
    ctx.translate(sx, sy);

    // the robots: made one a frame while the letters land, so none is made mid-animation
    px = Math.max(4, Math.round(tile * d));
    if (show.stage && warmed <= cast.cpus.length) {
      ctx.save();
      ctx.globalAlpha = 0;
      if (warmed === 0) {
        for (const a of [[0, 0], [1, 1], [1, 0.35], [0.35, 1]] as [number, number][]) drawRobot(ctx, -tile * 3, -tile * 3, tile, cast.hero, 2, 0, false, { arms: a, fine: false, noShadow: true });
      } else {
        const s = spots[warmed - 1];
        drawRobot(ctx, -tile * 3, -tile * 3, tile, cast.cpus[warmed - 1], s.facing, 0, false, { fine: false, noShadow: true });
      }
      warmed++;
      ctx.restore();
    }
    if (show.stage) drawStage(t, tile, cx, feetY, W);

    // the letters
    drawLetters(t, W, H);
    ctx.restore();

    // the line under, and how to go on
    if (show.tagline && t >= show.tagAt) {
      const k = ease((t - show.tagAt) / 0.4);
      ctx.save();
      ctx.globalAlpha = fade * k;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const fs = Math.max(13, Math.min(W * 0.045, H * 0.04, 22));
      ctx.font = `600 ${fs}px "Chakra Petch", system-ui, sans-serif`;
      ctx.fillStyle = '#fff1d0';
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 6;
      const y = Math.min(H - fs * 2.2, feetY + tile * 0.55 + (1 - k) * 8);
      fitText(show.tagline, cx, y, W * 0.92);
      if (t >= show.tapAt) {
        ctx.globalAlpha = fade * ease((t - show.tapAt) / 0.4) * (0.55 + 0.25 * Math.sin(t * 5));
        ctx.font = `500 ${fs * 0.72}px "Chakra Petch", system-ui, sans-serif`;
        ctx.fillStyle = '#c9cfe0';
        ctx.fillText('Tap to continue', cx, Math.min(H - fs, y + fs * 1.5));
      }
      ctx.restore();
    }
    raf = requestAnimationFrame(frame);
  }

  /** Text centred on (x, y), squeezed to `max` wide if it would be wider. */
  function fitText(text: string, x: number, y: number, max: number): void {
    const w = ctx.measureText(text).width;
    if (w <= max) ctx.fillText(text, x, y);
    else {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(max / w, 1);
      ctx.fillText(text, 0, 0);
      ctx.restore();
    }
  }

  /** ALL HAIL / THE HUMAN, each letter slamming down from big and faint to its place. */
  function drawLetters(t: number, W: number, H: number): void {
    const wide = W > H;
    // as big as fits: the wider line 92% of the screen across, and not too tall
    const at = (px: number): string => `700 ${px}px "Chakra Petch", "Trebuchet MS", system-ui, sans-serif`;
    ctx.font = at(100);
    const widest = Math.max(...LINES.map((l) => ctx.measureText(l).width * (1 + 0.04 * l.length / 4)));
    const fs = Math.round(Math.min((100 * W * (show.stage ? 0.92 : 0.8)) / widest, H * (wide ? 0.15 : 0.11), 120));
    ctx.font = at(fs);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    // (YOU WON! sits lower, over the middle of the arena)
    const top = H * (show.stage ? (wide ? 0.05 : 0.1) : wide ? 0.32 : 0.2) + fs * 0.85;
    LINES.forEach((line, li) => {
      const track = fs * 0.04; // a little room between letters
      const widths = [...line].map((ch) => ctx.measureText(ch).width + track);
      const total = widths.reduce((a, b) => a + b, 0) - track;
      let x = W / 2 - total / 2;
      const y = top + li * fs * 1.08;
      [...line].forEach((ch, i) => {
        const at = lands[li][i];
        const w = widths[i];
        if (ch !== ' ' && t >= at - SLAM_TIME) {
          const k = Math.min(1, (t - (at - SLAM_TIME)) / SLAM_TIME); // 0 high up and faint, 1 landed
          const sc = 1 + (SLAM_FROM - 1) * (1 - k) * (1 - k);
          const mx = x + (w - track) / 2;
          const my = y - fs * 0.35;
          ctx.save();
          ctx.globalAlpha *= Math.min(1, k * 1.6);
          ctx.translate(mx, my);
          ctx.scale(sc, sc);
          ctx.translate(-mx, -my);
          const g = ctx.createLinearGradient(0, y - fs * 0.8, 0, y + fs * 0.05);
          g.addColorStop(0, '#fff6c4');
          g.addColorStop(0.45, '#ffcf45');
          g.addColorStop(1, '#d4790c');
          // a dark edge, a glow, the gold, and a flash as it lands
          ctx.lineJoin = 'round';
          ctx.lineWidth = Math.max(2, fs * 0.09);
          ctx.strokeStyle = '#3a1d02';
          ctx.strokeText(ch, x, y);
          ctx.shadowColor = 'rgba(255, 190, 60, 0.75)';
          ctx.shadowBlur = fs * 0.22;
          ctx.fillStyle = g;
          ctx.fillText(ch, x, y);
          const flash = t - at;
          if (flash >= 0 && flash < 0.2) {
            ctx.shadowBlur = 0;
            ctx.globalAlpha *= 1 - flash / 0.2;
            ctx.fillStyle = '#ffffff';
            ctx.fillText(ch, x, y);
          }
          ctx.restore();
          // dust kicked up where it lands
          if (flash >= 0 && flash < 0.35) {
            const f = flash / 0.35;
            ctx.save();
            ctx.globalAlpha *= (1 - f) * 0.7;
            ctx.fillStyle = '#ffe3a0';
            for (const side of [-1, 1]) {
              for (let p = 0; p < 3; p++) {
                ctx.beginPath();
                ctx.arc(mx + side * (w * 0.35 + f * fs * (0.3 + p * 0.15)), y - f * fs * 0.15 * (p + 1), Math.max(1, fs * 0.035 * (1 - f)), 0, Math.PI * 2);
                ctx.fill();
              }
            }
            ctx.restore();
          }
        }
        x += w;
      });
    });
  }

  /** Your robot in the middle, the CPU players in a half circle bowing to it. Back to front. */
  function drawStage(t: number, tile: number, cx: number, feetY: number, W: number): void {
    const people: { y: number; draw: () => void }[] = [];
    // a soft pool of light on the floor
    ctx.save();
    ctx.globalAlpha *= ease((t - HERO_AT) / 0.5) * 0.9;
    const pool = ctx.createRadialGradient(cx, feetY, 0, cx, feetY, tile * 2.8);
    pool.addColorStop(0, 'rgba(255, 214, 120, 0.32)');
    pool.addColorStop(1, 'rgba(255, 214, 120, 0)');
    ctx.fillStyle = pool;
    ctx.beginPath();
    ctx.ellipse(cx, feetY, tile * 2.8, tile * 0.75, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // the half circle is squeezed to fit a narrow screen
    const spread = Math.min(1, (W / 2 - tile * 0.45) / (tile * 2.35));
    spots.forEach((s, i) => {
      const at = CPUS_AT + i * CPU_GAP;
      if (t < at) return;
      const k = Math.min(1, (t - at) / HOP_IN);
      const homeX = cx + s.x * tile * spread;
      const homeY = feetY - s.y * tile;
      const fromX = s.from < 0 ? -tile : W + tile;
      const x = fromX + (homeX - fromX) * ease(k);
      // hopping in: five little hops, then still
      const hop = k < 1 ? Math.abs(Math.sin(k * Math.PI * 5)) * 0.22 : 0;
      // bowing: down, hold, up, one after the other along the half circle, twice
      let lean = 0;
      const b = t - BOW_AT - i * 0.09;
      if (b > 0) {
        const p = (b % BOW_TIME) / BOW_TIME;
        const depth = p < 0.35 ? ease(p / 0.35) : p < 0.6 ? 1 : 1 - ease((p - 0.6) / 0.4);
        lean = depth * BOW_DEEP * (s.facing === 4 ? 1 : -1);
      }
      const pose: Pose = { fine: false, jump: hop, lean };
      people.push({ y: homeY, draw: () => drawRobot(ctx, x, homeY, tile, cast.cpus[i], s.facing, 0, false, pose) });
    });
    if (t >= HERO_AT) {
      const k = Math.min(1, (t - HERO_AT) / 0.45);
      const pop = k < 1 ? Math.sin(k * Math.PI) * 0.55 : 0;
      // arms: up in triumph, then pumping one after the other
      let arms: [number, number] = [1, 1];
      if (t > BOW_AT) arms = Math.floor((t - BOW_AT) / 0.32) % 2 ? [1, 0.35] : [0.35, 1];
      const hop = t > BOW_AT ? Math.abs(Math.sin((t - BOW_AT) * Math.PI / 0.64)) * 0.08 : 0;
      people.push({ y: feetY + 0.001, draw: () => drawRobot(ctx, cx, feetY, tile, cast.hero, 2, 0, false, { fine: false, arms, jump: pop + hop, crown: true }) });
    }
    people.sort((a, b) => a.y - b.y);
    for (const p of people) p.draw();
  }

  /** Rockets going up and bursting in your colour and gold, with a little gravity on the sparks. */
  function fireworks(t: number, W: number, H: number, feetY: number, fade: number): void {
    const every = hooks.calm ? show.fireEvery * 2 : show.fireEvery;
    while (t >= nextRocket && nextRocket < show.fireUntil) {
      rockets.push({ x: W * (0.12 + r() * 0.76), y: feetY, toY: H * (0.12 + r() * 0.38), born: nextRocket, rise: 0.45 + r() * 0.2, col: colours[Math.floor(r() * colours.length)], burst: false });
      nextRocket += every * (0.6 + r() * 0.8);
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const k of rockets) {
      const a = (t - k.born) / k.rise;
      if (a < 1) {
        const y = k.y + (k.toY - k.y) * ease(a);
        ctx.fillStyle = 'rgba(255, 230, 170, 0.9)';
        ctx.beginPath();
        ctx.arc(k.x, y, 1.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 180, 80, 0.35)';
        ctx.fillRect(k.x - 0.8, y, 1.6, 14);
      } else if (!k.burst) {
        k.burst = true;
        hooks.firework();
        const n = hooks.calm ? 22 : 40;
        const speed = Math.min(W, H) * (0.62 + r() * 0.3);
        const second = colours[Math.floor(r() * colours.length)];
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * Math.PI * 2 + r() * 0.2;
          const v = speed * (0.75 + r() * 0.35);
          sparks.push({ x: k.x, y: k.toY, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, born: t, life: 0.9 + r() * 0.5, col: i % 3 === 0 ? second : k.col, size: 2.2 + r() * 1.8 });
        }
      }
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      const a = (t - s.born) / s.life;
      if (a >= 1) {
        sparks.splice(i, 1);
        continue;
      }
      const tt = t - s.born;
      // slowed by the air, pulled down a little
      const drag = (1 - Math.exp(-2.6 * tt)) / 2.6;
      const x = s.x + s.vx * drag;
      const y = s.y + s.vy * drag + 60 * tt * tt;
      const rr = s.size * (1 - a * 0.5);
      ctx.fillStyle = s.col;
      ctx.globalAlpha = fade * (1 - a) * 0.25; // a soft halo
      ctx.beginPath();
      ctx.arc(x, y, rr * 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = fade * (1 - a) * (1 - a);
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  box.hidden = false;
  document.body.classList.add('hail-open');
  box.addEventListener('pointerdown', skip);
  window.addEventListener('keydown', onKey, true);
  document.addEventListener('visibilitychange', onHide);
  size();
  raf = requestAnimationFrame(frame);
  return skip;
}

/** A colour from '#rrggbb' with an alpha. */
function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(1, a))})`;
}
