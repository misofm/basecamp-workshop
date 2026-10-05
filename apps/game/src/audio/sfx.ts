/**
 * Synthesized one-shot sound effects. No samples: everything is built from
 * oscillators and noise on the shared AudioContext (context.ts).
 *
 * Owns: glassSmash, carAlarm, cashRegister, purchaseSuccess, error, uiBlip,
 * pickup, recordThunk.
 * Must not: hold game state or loop forever (carAlarm stops itself).
 * Levels are kept modest; the master bus has a limiter for headroom.
 * Calls before the context is unlocked are harmless (they just stay silent).
 */
import { audioContext, masterBus } from "./context";

let noiseBuffer: AudioBuffer | null = null;

/** 2 s of white noise, shared by every noisy effect. */
function noise(ctx: AudioContext): AudioBuffer {
  if (!noiseBuffer || noiseBuffer.sampleRate !== ctx.sampleRate) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

/** Disconnect a set of nodes when `source` finishes. */
function cleanupOnEnd(source: AudioScheduledSourceNode, ...nodes: AudioNode[]): void {
  source.onended = () => {
    source.disconnect();
    for (const n of nodes) n.disconnect();
  };
}

/** A decaying oscillator note. */
function tone(
  hz: number,
  start: number,
  duration: number,
  volume: number,
  type: OscillatorType = "sine",
  out: AudioNode = masterBus(),
  endHz?: number,
): void {
  const ctx = audioContext();
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(hz, start);
  if (endHz) o.frequency.exponentialRampToValueAtTime(endHz, start + duration);
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(volume, start + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  o.connect(g);
  g.connect(out);
  o.start(start);
  o.stop(start + duration + 0.02);
  cleanupOnEnd(o, g);
}

/** A filtered noise burst. */
function burst(
  start: number,
  duration: number,
  volume: number,
  filterType: BiquadFilterType,
  hz: number,
  q = 1,
): void {
  const ctx = audioContext();
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  const f = ctx.createBiquadFilter();
  f.type = filterType;
  f.frequency.value = hz;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(volume, start);
  g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  src.connect(f);
  f.connect(g);
  g.connect(masterBus());
  src.start(start, Math.random() * 1.5, duration + 0.05);
  cleanupOnEnd(src, f, g);
}

/** Windscreen going: a crunchy impact, a shatter wash, then glass tinkles. */
export function glassSmash(): void {
  const t = audioContext().currentTime;
  tone(140, t, 0.18, 0.35, "sine", masterBus(), 45); // body thump
  burst(t, 0.12, 0.5, "bandpass", 2500, 0.7); // crack
  burst(t + 0.02, 0.6, 0.3, "highpass", 4000); // shatter wash
  for (let i = 0; i < 14; i++) {
    const at = t + 0.05 + Math.random() * 0.7;
    tone(3000 + Math.random() * 5000, at, 0.05 + Math.random() * 0.12, 0.04 + Math.random() * 0.03, "sine");
  }
}

/**
 * Classic car alarm: alternating two-tone honk, then a rising whoop, looping
 * until `durationSec` passes or the returned stop() is called.
 */
export function carAlarm(durationSec = 6): () => void {
  const ctx = audioContext();
  const t = ctx.currentTime;
  const end = t + durationSec;
  const o = ctx.createOscillator();
  o.type = "square";
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 2200;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.09, t + 0.03);
  // Schedule the pattern: 1.5 s of two-tone, 1.5 s of whoops, repeat.
  let at = t;
  while (at < end) {
    for (let i = 0; i < 6 && at < end; i++, at += 0.25) o.frequency.setValueAtTime(i % 2 ? 1000 : 750, at);
    for (let i = 0; i < 3 && at < end; i++, at += 0.5) {
      o.frequency.setValueAtTime(600, at);
      o.frequency.exponentialRampToValueAtTime(1500, at + 0.45);
    }
  }
  g.gain.setValueAtTime(0.09, end - 0.05);
  g.gain.linearRampToValueAtTime(0, end);
  o.connect(lp);
  lp.connect(g);
  g.connect(masterBus());
  o.start(t);
  o.stop(end + 0.02);
  cleanupOnEnd(o, lp, g);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    const now = ctx.currentTime;
    if (now >= end) return;
    g.gain.cancelScheduledValues(now);
    g.gain.setValueAtTime(g.gain.value, now);
    g.gain.linearRampToValueAtTime(0, now + 0.08);
    o.stop(now + 0.1);
  };
}

/** Cha-ching: drawer clunk, coin rattle, then a bright bell. */
export function cashRegister(): void {
  const t = audioContext().currentTime;
  burst(t, 0.08, 0.25, "lowpass", 600); // drawer clunk
  tone(90, t, 0.1, 0.2, "sine", masterBus(), 50);
  for (let i = 0; i < 7; i++) {
    const at = t + 0.06 + i * 0.035 + Math.random() * 0.02;
    tone(5200 + Math.random() * 2400, at, 0.06, 0.035, "triangle"); // coins
    burst(at, 0.03, 0.06, "highpass", 6000);
  }
  // The bell: two inharmonic partials, long ring.
  const bell = t + 0.28;
  tone(2093, bell, 1.1, 0.12, "sine");
  tone(2093 * 2.76, bell, 0.6, 0.04, "sine");
  tone(2637, bell + 0.09, 1.2, 0.1, "sine");
  tone(2637 * 2.76, bell + 0.09, 0.5, 0.03, "sine");
}

/** Short rising arpeggio for "it's yours". */
export function purchaseSuccess(): void {
  const t = audioContext().currentTime;
  [523.25, 659.25, 783.99, 1046.5].forEach((hz, i) => tone(hz, t + i * 0.08, 0.35, 0.09, "triangle"));
}

/** Low double buzz. */
export function error(): void {
  const t = audioContext().currentTime;
  tone(150, t, 0.16, 0.12, "sawtooth");
  tone(110, t + 0.18, 0.22, 0.12, "sawtooth");
}

/** Tiny UI tick for menu navigation. */
export function uiBlip(): void {
  const t = audioContext().currentTime;
  tone(1320, t, 0.05, 0.05, "square");
}

/** Cardboard sleeve swish + soft tap when picking a record up. */
export function pickup(): void {
  const t = audioContext().currentTime;
  burst(t, 0.12, 0.12, "bandpass", 1800, 0.8);
  tone(420, t + 0.05, 0.08, 0.06, "triangle", masterBus(), 300);
}

/** Heavy vinyl/platter impact (setting a record down hard, or the swing landing). */
export function recordThunk(): void {
  const t = audioContext().currentTime;
  tone(95, t, 0.3, 0.35, "sine", masterBus(), 40);
  burst(t, 0.07, 0.2, "lowpass", 900);
  tone(240, t, 0.08, 0.08, "triangle", masterBus(), 120);
}
