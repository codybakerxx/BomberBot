/**
 * Tiny synthesised sound effects. No audio files: each sound is a short tone
 * or burst of noise made with the Web Audio API.
 */
let ac: AudioContext | null = null;

/** Switch sound on. Browsers only allow this from a tap or key press, so it is called from those. */
export function initAudio(): void {
  try {
    ac = ac ?? new AudioContext();
    void ac.resume();
  } catch {
    ac = null;
  }
}

/** A tone that slides from one pitch to another while fading out. */
function tone(from: number, to: number, dur: number, type: OscillatorType, vol: number): void {
  if (!ac || ac.state !== 'running') return;
  const t = ac.currentTime;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(ac.destination);
  o.start(t);
  o.stop(t + dur);
}

/** A burst of low rumbling noise, for blasts. */
function noise(dur: number, vol: number): void {
  if (!ac || ac.state !== 'running') return;
  const n = Math.floor(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, n, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const f = ac.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 900;
  const g = ac.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(ac.destination);
  src.start();
}

/** One function per sound. main.ts calls these for the events the rules report. */
export const sfx = {
  place: (): void => tone(300, 160, 0.09, 'square', 0.06),
  kick: (): void => tone(220, 520, 0.12, 'square', 0.07),
  lift: (): void => tone(180, 260, 0.07, 'triangle', 0.12),
  explode: (): void => {
    noise(0.45, 0.5);
    tone(140, 40, 0.3, 'sawtooth', 0.12);
  },
  pickup: (): void => {
    tone(520, 780, 0.09, 'triangle', 0.12);
    setTimeout(() => tone(780, 1170, 0.12, 'triangle', 0.12), 80);
  },
  /** picking up a curse: a sour falling note */
  curse: (): void => {
    tone(330, 150, 0.3, 'sawtooth', 0.09);
    setTimeout(() => tone(250, 110, 0.35, 'square', 0.06), 110);
  },
  /** a shield taking a blast: a bright ping that falls away */
  shield: (): void => {
    tone(1500, 500, 0.25, 'triangle', 0.14);
    noise(0.12, 0.15);
  },
  /** a falling block landing: a short low thud */
  block: (): void => {
    tone(110, 45, 0.14, 'square', 0.09);
    noise(0.08, 0.2);
  },
  /** blocks are about to start falling: two rising notes */
  hurry: (): void => {
    tone(440, 660, 0.14, 'square', 0.08);
    setTimeout(() => tone(660, 990, 0.2, 'square', 0.08), 150);
  },
  /** a round is won: three rising notes */
  win: (): void => {
    tone(523, 523, 0.12, 'square', 0.08);
    setTimeout(() => tone(659, 659, 0.12, 'square', 0.08), 120);
    setTimeout(() => tone(784, 1046, 0.3, 'square', 0.09), 240);
  },
  death: (): void => tone(600, 60, 0.6, 'sawtooth', 0.1),
};
