/**
 * The sound effects, made in code (no sound files: rule 4 in CLAUDE.md). Each sound is a few layers played
 * together with the Web Audio API: tones that slide in pitch (`voice`) and bursts of filtered noise (`hiss`),
 * timed on the audio clock so their parts land exactly. Everything goes through one master volume and a
 * compressor, so a chain of blasts is loud without crackling.
 *
 * Upgraded in November 2026 (the owner's list: "Sound FX upgrade"): each sound used to be one or two plain
 * beeps. The ids and when they play are unchanged.
 */
let ac: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let crunch: WaveShaperNode | null = null;

/**
 * Your sound settings (Settings › Sound, `Prefs` in setup.ts): every sound is scaled by `level` (0 to 1),
 * and a sound whose id is in `muted` is not played at all. `level` 0 is silence.
 */
let level = 0.8;
let muted = new Set<string>();
export function setSound(on: boolean, volume: number, off: string[]): void {
  level = on ? Math.max(0, Math.min(1, volume / 100)) : 0;
  muted = new Set(off);
  if (master) master.gain.value = level;
}

/** Switch sound on. Browsers only allow this from a tap or key press, so it is called from those. */
export function initAudio(): void {
  try {
    if (!ac) {
      ac = new AudioContext();
      const squash = ac.createDynamicsCompressor();
      squash.threshold.value = -16;
      squash.knee.value = 10;
      squash.ratio.value = 5;
      squash.attack.value = 0.003;
      squash.release.value = 0.18;
      master = ac.createGain();
      master.gain.value = level;
      master.connect(squash).connect(ac.destination);
      // a second of white noise, used by every hiss from a random point in it
      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      // a gentle overdrive, for the grit in blasts
      crunch = ac.createWaveShaper();
      const curve = new Float32Array(1024);
      for (let i = 0; i < curve.length; i++) {
        const x = (i / (curve.length - 1)) * 2 - 1;
        curve[i] = Math.tanh(x * 3);
      }
      crunch.curve = curve;
      crunch.connect(master);
    }
    void ac.resume();
  } catch {
    ac = null;
  }
}

/**
 * Wake the sound up again if the phone has put it to sleep: after the game has been in the background, a
 * call, or the screen locking, a phone leaves sound switched off until it is asked for again from a touch.
 * Called on every touch and key, and when the game comes back into view; it does nothing while sound is
 * running, or before sound has ever been switched on.
 */
export function wakeAudio(): void {
  if (ac && ac.state !== 'running' && ac.state !== 'closed') void ac.resume().catch(() => {});
}

const ready = (): boolean => !!ac && !!master && ac.state === 'running' && level > 0;
/** a little variety, so the same sound twice in a row is not identical (pitch ±`by`) */
const vary = (by = 0.06): number => 1 + (Math.random() * 2 - 1) * by;

interface Voice {
  type: OscillatorType;
  /** pitch at the start and the end (Hz); it slides between them */
  from: number;
  to?: number;
  dur: number;
  vol: number;
  /** seconds from now */
  at?: number;
  /** seconds to reach full volume */
  attack?: number;
  /** a lowpass filter, falling from `lp` to `lpTo` (Hz) */
  lp?: number;
  lpTo?: number;
  /** a wobble in pitch: [rate Hz, depth Hz] */
  wobble?: [number, number];
  /** through the overdrive */
  grit?: boolean;
}
/** A tone that slides in pitch and dies away. */
function voice(v: Voice): void {
  if (!ready()) return;
  const a = ac!;
  const t = a.currentTime + (v.at ?? 0);
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = v.type;
  o.frequency.setValueAtTime(v.from, t);
  if (v.to !== undefined && v.to !== v.from) o.frequency.exponentialRampToValueAtTime(Math.max(20, v.to), t + v.dur);
  const atk = v.attack ?? 0.004;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v.vol, t + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, t + v.dur);
  let out: AudioNode = o;
  if (v.lp) {
    const f = a.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(v.lp, t);
    if (v.lpTo) f.frequency.exponentialRampToValueAtTime(v.lpTo, t + v.dur);
    out = out.connect(f);
  }
  if (v.wobble) {
    const lfo = a.createOscillator();
    const depth = a.createGain();
    lfo.frequency.value = v.wobble[0];
    depth.gain.value = v.wobble[1];
    lfo.connect(depth).connect(o.frequency);
    lfo.start(t);
    lfo.stop(t + v.dur + 0.02);
  }
  out.connect(g).connect(v.grit ? crunch! : master!);
  o.start(t);
  o.stop(t + v.dur + 0.02);
}

interface Hiss {
  dur: number;
  vol: number;
  at?: number;
  /** the filter: its kind, and its frequency at the start and the end (Hz) */
  kind: BiquadFilterType;
  from: number;
  to?: number;
  q?: number;
  attack?: number;
  grit?: boolean;
}
/** A burst of noise through a sweeping filter: blasts, thuds, whooshes, clicks. */
function hiss(h: Hiss): void {
  if (!ready() || !noiseBuf) return;
  const a = ac!;
  const t = a.currentTime + (h.at ?? 0);
  const src = a.createBufferSource();
  src.buffer = noiseBuf;
  const f = a.createBiquadFilter();
  f.type = h.kind;
  f.Q.value = h.q ?? 0.8;
  f.frequency.setValueAtTime(h.from, t);
  if (h.to) f.frequency.exponentialRampToValueAtTime(h.to, t + h.dur);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(h.vol, t + (h.attack ?? 0.003));
  g.gain.exponentialRampToValueAtTime(0.0001, t + h.dur);
  src.connect(f).connect(g).connect(h.grit ? crunch! : master!);
  src.start(t, Math.random() * 0.5, h.dur + 0.02);
}

/** The sounds themselves, one function each, by id. */
const sounds = {
  /** a bomb set down: a soft iron clunk, and the fuse catching */
  place: (): void => {
    const p = vary();
    voice({ type: 'sine', from: 210 * p, to: 95 * p, dur: 0.14, vol: 0.32 });
    voice({ type: 'triangle', from: 640 * p, to: 420 * p, dur: 0.05, vol: 0.08 });
    hiss({ kind: 'highpass', from: 4200, dur: 0.16, vol: 0.05, at: 0.05, attack: 0.04 });
  },
  /** a bomb kicked: a thwack and a whoosh as it slides away */
  kick: (): void => {
    const p = vary();
    voice({ type: 'triangle', from: 190 * p, to: 70 * p, dur: 0.09, vol: 0.35 });
    hiss({ kind: 'bandpass', from: 1200, dur: 0.05, vol: 0.18 });
    hiss({ kind: 'bandpass', from: 500, to: 2600, q: 1.6, dur: 0.24, vol: 0.12, at: 0.03, attack: 0.06 });
  },
  /** a bomb lifted overhead: a springy rise */
  lift: (): void => {
    const p = vary(0.04);
    voice({ type: 'sine', from: 180 * p, to: 470 * p, dur: 0.16, vol: 0.26, wobble: [28, 18] });
    voice({ type: 'triangle', from: 360 * p, to: 940 * p, dur: 0.1, vol: 0.06 });
  },
  /** a blast: a deep boom, a crack on top, and a rumble that rolls off */
  explode: (): void => {
    const p = vary(0.1);
    voice({ type: 'sine', from: 110 * p, to: 32, dur: 0.7, vol: 0.9 });
    voice({ type: 'triangle', from: 70 * p, to: 30, dur: 0.45, vol: 0.4, grit: true });
    hiss({ kind: 'highpass', from: 2400, dur: 0.06, vol: 0.32 });
    hiss({ kind: 'lowpass', from: 4200 * p, to: 180, dur: 0.75, vol: 0.75, grit: true });
    hiss({ kind: 'lowpass', from: 500, to: 90, dur: 1.1, vol: 0.35, at: 0.06, attack: 0.08 });
  },
  /** a power-up: a quick bright arpeggio with a sparkle */
  pickup: (): void => {
    const notes = [659, 880, 1319];
    notes.forEach((f, i) => {
      voice({ type: 'triangle', from: f, dur: 0.14, vol: 0.14, at: i * 0.055 });
      voice({ type: 'sine', from: f * 2, dur: 0.1, vol: 0.06, at: i * 0.055 });
    });
    voice({ type: 'sine', from: 2637, to: 3520, dur: 0.18, vol: 0.05, at: 0.16 });
  },
  /** picking up a curse: a sour, wobbling slide down */
  curse: (): void => {
    voice({ type: 'sawtooth', from: 330, to: 140, dur: 0.42, vol: 0.13, lp: 1800, lpTo: 400, wobble: [7, 14] });
    voice({ type: 'sawtooth', from: 349, to: 148, dur: 0.42, vol: 0.1, lp: 1800, lpTo: 400 });
    voice({ type: 'square', from: 220, to: 92, dur: 0.38, vol: 0.06, at: 0.12, lp: 900 });
  },
  /** a shield taking a blast: a ringing metal ping that falls away */
  shield: (): void => {
    voice({ type: 'sine', from: 1480, to: 1320, dur: 0.6, vol: 0.22 });
    voice({ type: 'sine', from: 2290, to: 2100, dur: 0.4, vol: 0.12 });
    voice({ type: 'sine', from: 3710, dur: 0.22, vol: 0.06 });
    hiss({ kind: 'highpass', from: 3000, dur: 0.1, vol: 0.14 });
  },
  /** a falling block landing: a heavy stone thud */
  block: (): void => {
    const p = vary();
    voice({ type: 'sine', from: 130 * p, to: 42, dur: 0.26, vol: 0.6 });
    voice({ type: 'square', from: 90 * p, to: 50, dur: 0.1, vol: 0.08, lp: 600 });
    hiss({ kind: 'lowpass', from: 1400, to: 200, dur: 0.18, vol: 0.4 });
    hiss({ kind: 'bandpass', from: 2500, dur: 0.04, vol: 0.1 });
  },
  /** blocks are about to start falling: an alarm, twice */
  hurry: (): void => {
    for (const at of [0, 0.32]) {
      voice({ type: 'square', from: 587, to: 880, dur: 0.14, vol: 0.12, at, lp: 2600 });
      voice({ type: 'square', from: 880, to: 1175, dur: 0.14, vol: 0.12, at: at + 0.15, lp: 2600 });
    }
  },
  /** a round is won: a little fanfare ending on a chord */
  win: (): void => {
    const lead = [523, 659, 784];
    lead.forEach((f, i) => {
      voice({ type: 'square', from: f, dur: 0.13, vol: 0.09, at: i * 0.12, lp: 3000 });
      voice({ type: 'triangle', from: f, dur: 0.14, vol: 0.14, at: i * 0.12 });
    });
    for (const f of [523, 659, 784, 1047]) voice({ type: 'triangle', from: f, dur: 0.75, vol: 0.12, at: 0.36, attack: 0.02 });
    voice({ type: 'square', from: 1047, dur: 0.7, vol: 0.06, at: 0.36, lp: 2400, lpTo: 900, wobble: [6, 6] });
    hiss({ kind: 'highpass', from: 6000, dur: 0.5, vol: 0.04, at: 0.36, attack: 0.05 });
  },
  /** a level-crossing bell (Wild West): one bright metal strike, ringing on; it comes twice a second while the lamps flash */
  bell: (): void => {
    for (const [f, v, d] of [
      [1180, 0.16, 0.42],
      [2710, 0.07, 0.3],
      [4020, 0.035, 0.18],
      [590, 0.05, 0.36],
    ] as const)
      voice({ type: 'sine', from: f, to: f * 0.995, dur: d, vol: v });
    hiss({ kind: 'highpass', from: 5000, dur: 0.03, vol: 0.12 });
  },
  /** a steam train coming (Wild West): its whistle, a chord that rises and holds, breathy; then its wheels and chuffing rolling past */
  train: (): void => {
    for (const [f, v] of [
      [415, 0.07],
      [523, 0.06],
      [622, 0.05],
    ] as const) {
      voice({ type: 'sawtooth', from: f * 0.94, to: f, dur: 0.16, vol: v, lp: 2200, attack: 0.05 });
      voice({ type: 'sawtooth', from: f, dur: 0.95, vol: v, at: 0.15, lp: 2400, lpTo: 1500, wobble: [5.5, 3], attack: 0.02 });
    }
    hiss({ kind: 'bandpass', from: 1900, q: 3, dur: 1.1, vol: 0.09, attack: 0.06 });
    // the train rolling by: a low rumble and the clack of wheels over the rail joints, chuffing as it goes
    hiss({ kind: 'lowpass', from: 260, to: 140, dur: 2.6, vol: 0.32, at: 0.7, attack: 0.5 });
    voice({ type: 'triangle', from: 46, to: 40, dur: 2.4, vol: 0.18, at: 0.75, attack: 0.4 });
    for (let k = 0; k < 14; k++) {
      const at = 0.8 + k * 0.15;
      hiss({ kind: 'bandpass', from: 900, to: 400, q: 1.2, dur: 0.09, vol: 0.1 * Math.sin(Math.PI * Math.min(1, (k + 1) / 14)), at, attack: 0.01 });
      if (k % 2 === 0) hiss({ kind: 'bandpass', from: 2800, q: 4, dur: 0.03, vol: 0.06, at: at + 0.05 });
    }
  },
  /** a barrel of TNT (Wild West): a bigger, deeper blast than a bomb's, with wood splintering in it */
  tnt: (): void => {
    const p = vary(0.08);
    voice({ type: 'sine', from: 90 * p, to: 26, dur: 1.0, vol: 1 });
    voice({ type: 'triangle', from: 60 * p, to: 24, dur: 0.7, vol: 0.5, grit: true });
    hiss({ kind: 'highpass', from: 2000, dur: 0.08, vol: 0.4 });
    hiss({ kind: 'lowpass', from: 3600 * p, to: 120, dur: 1.1, vol: 0.85, grit: true });
    hiss({ kind: 'lowpass', from: 420, to: 70, dur: 1.6, vol: 0.4, at: 0.08, attack: 0.1 });
    for (let k = 0; k < 5; k++) hiss({ kind: 'bandpass', from: 1400 + k * 500, q: 3, dur: 0.05, vol: 0.12, at: 0.05 + k * 0.045 });
  },
  /** the Factory's belts are about to turn round: a short factory alarm, a buzzing two-tone klaxon (twice a second while the beacons flash) */
  alarm: (): void => {
    voice({ type: 'square', from: 440, dur: 0.16, vol: 0.08, lp: 1800, wobble: [28, 8] });
    voice({ type: 'sawtooth', from: 330, dur: 0.16, vol: 0.06, lp: 1400, wobble: [28, 6] });
    voice({ type: 'square', from: 220, dur: 0.16, vol: 0.05, lp: 900 });
  },
  /** the Factory's belts turn round: a heavy clunk, then the motors whirring up again */
  reverse: (): void => {
    voice({ type: 'triangle', from: 120, to: 60, dur: 0.18, vol: 0.32 });
    hiss({ kind: 'bandpass', from: 700, to: 300, q: 2, dur: 0.08, vol: 0.2 });
    voice({ type: 'sawtooth', from: 70, to: 150, dur: 0.6, vol: 0.06, at: 0.08, lp: 700, attack: 0.08 });
    hiss({ kind: 'lowpass', from: 240, to: 380, dur: 0.6, vol: 0.12, at: 0.08, attack: 0.1 });
  },
  /** decoys appear: a shimmering swirl that rises, and a soft puff */
  decoy: (): void => {
    for (const [f, at] of [
      [523, 0],
      [659, 0.05],
      [784, 0.1],
      [1047, 0.15],
    ] as const) {
      voice({ type: 'sine', from: f, to: f * 1.5, dur: 0.22, vol: 0.07, at, wobble: [18, 22] });
      voice({ type: 'triangle', from: f * 0.5, to: f * 0.75, dur: 0.18, vol: 0.05, at });
    }
    hiss({ kind: 'bandpass', from: 800, to: 3200, q: 1.2, dur: 0.35, vol: 0.1, attack: 0.08 });
  },
  /** a decoy popped: a soft pop and a puff of smoke */
  poof: (): void => {
    const p = vary(0.08);
    voice({ type: 'sine', from: 420 * p, to: 160 * p, dur: 0.09, vol: 0.22 });
    hiss({ kind: 'bandpass', from: 2200, to: 500, q: 0.9, dur: 0.28, vol: 0.18, attack: 0.01 });
    hiss({ kind: 'lowpass', from: 900, to: 200, dur: 0.4, vol: 0.08, at: 0.04, attack: 0.05 });
  },
  /** a trip wire strung: a taut wire plucked, ringing a little */
  wire: (): void => {
    voice({ type: 'triangle', from: 196, to: 192, dur: 0.5, vol: 0.18, wobble: [9, 3] });
    voice({ type: 'sawtooth', from: 392, to: 386, dur: 0.32, vol: 0.05, lp: 2400, lpTo: 600 });
    voice({ type: 'sine', from: 1180, to: 1150, dur: 0.12, vol: 0.05 });
    hiss({ kind: 'highpass', from: 5000, dur: 0.03, vol: 0.1 });
  },
  /** a trip wire set off: the wire snapping, then a blast rolling away down the lane */
  trip: (): void => {
    voice({ type: 'sawtooth', from: 900, to: 140, dur: 0.12, vol: 0.12, lp: 3000 });
    hiss({ kind: 'highpass', from: 3500, dur: 0.05, vol: 0.25 });
    const p = vary(0.06);
    voice({ type: 'sine', from: 100 * p, to: 30, dur: 0.9, vol: 0.9, at: 0.05 });
    voice({ type: 'triangle', from: 66 * p, to: 28, dur: 0.6, vol: 0.45, grit: true, at: 0.05 });
    hiss({ kind: 'lowpass', from: 4000 * p, to: 160, dur: 0.9, vol: 0.75, grit: true, at: 0.05 });
    // the fire racing off along the lane both ways: two whooshes falling away
    hiss({ kind: 'bandpass', from: 1800, to: 300, q: 1.4, dur: 0.8, vol: 0.2, at: 0.12, attack: 0.05 });
    hiss({ kind: 'lowpass', from: 600, to: 80, dur: 1.4, vol: 0.35, at: 0.1, attack: 0.1 });
  },
  /** knocked out: a robot powering down, wobbling as it goes */
  death: (): void => {
    voice({ type: 'sawtooth', from: 640, to: 55, dur: 0.75, vol: 0.14, lp: 2600, lpTo: 220, wobble: [11, 30] });
    voice({ type: 'square', from: 320, to: 40, dur: 0.7, vol: 0.06, lp: 800 });
    hiss({ kind: 'bandpass', from: 1800, to: 300, dur: 0.3, vol: 0.12, q: 2 });
  },
};

export type SoundId = keyof typeof sounds;

/**
 * One function per sound. main.ts calls these for the events the rules report. A sound switched off in
 * Settings › Sound stays quiet; `preview` plays one whatever its switch says, for the Settings list.
 */
export const sfx = Object.fromEntries(
  (Object.keys(sounds) as SoundId[]).map((id) => [id, (): void => (muted.has(id) ? undefined : sounds[id]())]),
) as Record<SoundId, () => void>;
export function preview(id: string): void {
  if (id in sounds) sounds[id as SoundId]();
}
