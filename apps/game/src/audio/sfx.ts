/**
 * Synthesized one-shot sound effects. No samples: everything is built from
 * oscillators and noise on the shared AudioContext (context.ts).
 *
 * Owns: glassSmash, carAlarm (the dead sedan's weak, dying alarm), boom (the
 * facility explosion + quake rumble), ironFootsteps (the distant marching army),
 * cashRegister, purchaseSuccess, error, uiBlip, pickup, recordThunk.
 * Must not: hold game state or loop forever (carAlarm, boom and ironFootsteps
 * all end by themselves and release their nodes).
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
 * The dead sedan's WEAK alarm (bible §7.4 step 8): a thin electronic whoop from a
 * flat battery, each cycle lower, slower and quieter, the last one sagging down
 * into silence. Ends by itself after `durationSec`, or early via the returned stop().
 */
export function carAlarm(durationSec = 6): () => void {
  const ctx = audioContext();
  const t = ctx.currentTime;
  const end = t + Math.max(1, durationSec);
  const o = ctx.createOscillator();
  o.type = "square";
  // Thin: no low end, no sparkle, like a tiny piezo siren.
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 550;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 2400;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  let at = t;
  let i = 0;
  while (at < end - 0.2) {
    const p = (at - t) / (end - t); // 0 → 1 over the alarm's life
    const len = 0.42 * (1 + 0.9 * p);
    const vol = 0.055 * Math.pow(1 - p, 1.4) + 0.004;
    const last = at + len * 1.6 >= end - 0.2;
    const lo = 720 * (1 - 0.45 * p) * (1 + (Math.random() - 0.5) * 0.02);
    const hi = 1350 * (1 - 0.55 * p);
    o.frequency.setValueAtTime(lo, at);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol, at + 0.03);
    if (last) {
      // Final gasp: half a whoop, then the pitch sags as the power dies.
      const peak = at + len * 0.5;
      o.frequency.exponentialRampToValueAtTime(hi * 0.8, peak);
      o.frequency.exponentialRampToValueAtTime(140, end);
      g.gain.linearRampToValueAtTime(vol * 0.7, peak);
      g.gain.linearRampToValueAtTime(0, end);
      break;
    }
    o.frequency.exponentialRampToValueAtTime(hi, at + len);
    g.gain.setValueAtTime(vol, at + len - 0.04);
    g.gain.linearRampToValueAtTime(0, at + len);
    at += len + 0.05 + 0.12 * p * (i % 2); // stutters as it weakens
    i++;
  }
  g.gain.setValueAtTime(0, end);
  o.connect(hp).connect(lp).connect(g).connect(masterBus());
  o.start(t);
  o.stop(end + 0.05);
  cleanupOnEnd(o, hp, lp, g);
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

/**
 * The facility boom (Book 3.0: "A loud echo boomed through the air. The ground started
 * quaking"): a deep impact with a sub-bass drop, a slapback echo off the towers, then a
 * long low rumble with an irregular tremor that fades over ~9 s.
 */
export function boom(): void {
  const ctx = audioContext();
  const t = ctx.currentTime;
  const out = masterBus();
  // Echo: a lowpassed feedback delay fed by the impact.
  const echoIn = ctx.createGain();
  echoIn.gain.value = 0.5;
  const delay = ctx.createDelay(1);
  delay.delayTime.value = 0.38;
  const fb = ctx.createGain();
  fb.gain.value = 0.45;
  const echoLp = ctx.createBiquadFilter();
  echoLp.type = "lowpass";
  echoLp.frequency.value = 420;
  echoIn.connect(delay).connect(echoLp).connect(fb).connect(delay);
  echoLp.connect(out);

  // Impact: lowpassed noise crack + body.
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  src.loop = true;
  const crackLp = ctx.createBiquadFilter();
  crackLp.type = "lowpass";
  crackLp.frequency.setValueAtTime(1800, t);
  crackLp.frequency.exponentialRampToValueAtTime(90, t + 1.6);
  const crack = ctx.createGain();
  crack.gain.setValueAtTime(0, t);
  crack.gain.linearRampToValueAtTime(0.65, t + 0.01);
  crack.gain.exponentialRampToValueAtTime(0.0001, t + 2);
  src.connect(crackLp).connect(crack);
  crack.connect(out);
  crack.connect(echoIn);
  src.start(t);
  src.stop(t + 2.1);
  cleanupOnEnd(src, crackLp, crack);

  // Sub drop.
  tone(62, t, 3.2, 0.6, "sine", out, 26);
  tone(44, t + 0.02, 2.4, 0.4, "triangle", echoIn, 24);

  // Rumble: deep band of noise swelling and decaying, with a tremor on its level.
  const dur = 9;
  const rs = ctx.createBufferSource();
  rs.buffer = noise(ctx);
  rs.loop = true;
  const rLp = ctx.createBiquadFilter();
  rLp.type = "lowpass";
  rLp.frequency.value = 110;
  rLp.Q.value = 0.9;
  const rLp2 = ctx.createBiquadFilter();
  rLp2.type = "lowpass";
  rLp2.frequency.value = 160;
  const rumble = ctx.createGain();
  rumble.gain.setValueAtTime(0, t);
  rumble.gain.linearRampToValueAtTime(1.6, t + 0.6);
  rumble.gain.setTargetAtTime(0.9, t + 0.8, 1.5);
  rumble.gain.setTargetAtTime(0, t + 4, 1.6);
  const tremor = ctx.createGain();
  tremor.gain.value = 1;
  const shake1 = ctx.createOscillator();
  shake1.frequency.value = 6.3;
  const shake2 = ctx.createOscillator();
  shake2.frequency.value = 9.7;
  const depth = ctx.createGain();
  depth.gain.value = 0.35;
  shake1.connect(depth);
  shake2.connect(depth);
  depth.connect(tremor.gain);
  rs.connect(rLp).connect(rLp2).connect(rumble).connect(tremor).connect(out);
  const sub = ctx.createOscillator();
  sub.frequency.setValueAtTime(34, t);
  sub.frequency.linearRampToValueAtTime(29, t + dur);
  const subG = ctx.createGain();
  subG.gain.setValueAtTime(0, t);
  subG.gain.linearRampToValueAtTime(0.3, t + 0.8);
  subG.gain.setTargetAtTime(0, t + 3.5, 1.5);
  sub.connect(subG).connect(tremor);
  for (const s of [rs, shake1, shake2, sub]) {
    s.start(t);
    s.stop(t + dur);
  }
  rs.onended = () => {
    for (const n of [rs, rLp, rLp2, rumble, tremor, shake1, shake2, depth, sub, subG, echoIn, delay, fb, echoLp]) n.disconnect();
  };
}

/**
 * Far-off "thousands of iron feet in chilling unison" (Book 2.5): perfectly regular,
 * low, muffled metallic marching thuds, slowly louder, then fading, over `seconds`.
 */
export function ironFootsteps(seconds = 7): void {
  const ctx = audioContext();
  const t = ctx.currentTime;
  const dur = Math.max(2, seconds);
  // Distance: everything through one muffling lowpass, a long dark echo and a swell.
  const bus = ctx.createGain();
  const peakAt = t + dur * 0.62;
  bus.gain.setValueAtTime(0.0001, t);
  bus.gain.exponentialRampToValueAtTime(0.3, peakAt);
  bus.gain.linearRampToValueAtTime(0, t + dur);
  const muffle = ctx.createBiquadFilter();
  muffle.type = "lowpass";
  muffle.frequency.value = 650;
  const delay = ctx.createDelay(1);
  delay.delayTime.value = 0.23;
  const fb = ctx.createGain();
  fb.gain.value = 0.35;
  bus.connect(muffle).connect(masterBus());
  muffle.connect(delay).connect(fb).connect(delay);
  fb.connect(masterBus());

  const step = 0.55; // a march: perfectly regular
  for (let at = t + 0.05; at < t + dur - 0.1; at += step) {
    // Many feet nearly together: a few hits a few ms apart read as a mass.
    for (let k = 0; k < 3; k++) {
      const h = at + k * 0.007;
      tone(78 - k * 6, h, 0.22, 0.3, "sine", bus, 38); // ground thud
      tone(190 + k * 23, h, 0.14, 0.05, "triangle", bus); // iron
      tone(287 + k * 31, h, 0.1, 0.035, "triangle", bus);
    }
    const src = ctx.createBufferSource();
    src.buffer = noise(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 320;
    bp.Q.value = 2.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
    src.connect(bp).connect(g).connect(bus);
    src.start(at, Math.random() * 1.5, 0.15);
    cleanupOnEnd(src, bp, g);
  }
  const closer = ctx.createConstantSource();
  closer.offset.value = 0;
  closer.connect(fb);
  closer.start(t);
  closer.stop(t + dur + 2);
  closer.onended = () => {
    for (const n of [closer, bus, muffle, delay, fb]) n.disconnect();
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
