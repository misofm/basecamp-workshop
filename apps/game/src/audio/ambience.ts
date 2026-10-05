/**
 * Nozomi back-street ambience at dusk (world bible §7.8): a layered procedural
 * soundscape, generated locally. Original sound design and music, no samples.
 *
 * Owns: every ambient layer, the door chime and the player's footsteps.
 * Routes into the shared master bus (context.ts).
 *
 * Layers (each a GainNode the caller mixes by distance via setSources):
 *   - street:  cold gusting wind (live filtered noise + slow gust LFOs), the faint
 *              buzz of the festival bulbs (live), water dripping from buckets (events).
 *   - fire:    the dying roof fire's hiss + crackle (baked loop), the casino's
 *              murmur of evacuated people (baked loop), the creak of a burned beam (events).
 *   - diner:   a muffled ORIGINAL 1950s-style jukebox loop (I–vi–IV–V in B♭, shuffle bass,
 *              triplet piano, sax-ish lead) baked heavily low-passed, as if through glass.
 *   - band:    murmured banter of three voices + Ongaku idly picking a slow classical
 *              figure (Karplus-Strong plucks), baked into one loop; sake-bottle clinks (events).
 *   - vending: the vending machine's compressor hum (live).
 * Plus the room tone + mains hum heard inside the shop. Nothing drives: no traffic.
 *
 * CPU: loops are baked once at start() (OfflineAudioContext / plain JS DSP, folded
 * so they loop seamlessly) and played as looping buffers; only a handful of live
 * nodes run. A layer whose level falls to ~0 is disconnected from the graph (so it
 * is not pulled) and its events are not scheduled. Events use a 200 ms lookahead timer.
 *
 * Must not: know about world geometry. The caller pushes state in:
 *   - setSources({ fire, diner, band, vending, street }): each 0..1, every frame (cheap;
 *     smoothed here). `street` = how much open street is around the listener.
 *     Default before the first call: street 1, everything else 0.
 *   - setOutdoors(0..1): 1 = open street, 0 = deep inside the shop; ducks all street
 *     layers and brings up the room tone.
 *   - update(moving, running): call every frame; schedules footsteps.
 *   - setPlaying(true) ducks the ambience while the deck plays.
 */
import { audioContext, masterBus, unlockAudio } from "./context";

export interface AmbienceLevels {
  fire: number;
  diner: number;
  band: number;
  vending: number;
  street: number;
}
type LayerName = keyof AmbienceLevels;

/** Per-layer gain at level 1 (baked loops are normalised to LOOP_RMS). Kept quiet. */
const WEIGHT: Record<LayerName, number> = { fire: 0.42, diner: 0.38, band: 0.4, vending: 1, street: 1 };
const LOOP_RMS = 0.1;

interface Layer {
  gain: GainNode;
  target: number;
  sent: number;
  connected: boolean;
}

export class ShopAmbience {
  private ctx?: AudioContext;
  private master?: GainNode;
  /** Every street-side layer goes through here; ducked indoors. */
  private outBus?: GainNode;
  private room?: GainNode;
  private layers?: Record<LayerName, Layer>;
  private noise?: AudioBuffer;
  private sources: AudioScheduledSourceNode[] = [];
  private timer?: number;
  private generation = 0;
  private muted = false;
  private enabled = true;
  private playing = false;
  private readonly baseVolume = 0.12;
  private lastFootstep = 0;
  private started = false;
  private outdoors = 1;
  private levels: AmbienceLevels = { fire: 0, diner: 0, band: 0, vending: 0, street: 1 };
  private nextDrip = 0;
  private nextClink = 0;
  private nextCreak = 0;

  /** Start the beds (after a user gesture). Safe to call repeatedly. */
  async start() {
    this.ctx ??= audioContext();
    await unlockAudio();
    if (this.started) return;
    this.started = true;
    const gen = ++this.generation;
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this.targetVolume();
    this.master.connect(masterBus());
    this.outBus = c.createGain();
    this.outBus.connect(this.master);
    this.room = c.createGain();
    this.room.connect(this.master);
    this.noise = brownNoise(c, 4);

    const layer = (): Layer => ({ gain: c.createGain(), target: 0, sent: -1, connected: false });
    this.layers = { fire: layer(), diner: layer(), band: layer(), vending: layer(), street: layer() };
    for (const l of Object.values(this.layers)) l.gain.gain.value = 0;

    // One brown-noise source feeds both the room tone and the wind.
    const roomLp = c.createBiquadFilter();
    roomLp.type = "lowpass";
    roomLp.frequency.value = 190;
    roomLp.connect(this.room);
    const src = this.loop(this.noise, roomLp);
    this.osc("sine", 60, 0.008 / 0.055, this.room); // mains hum, indoors

    // Wind: band-passed brown noise, gusting with two slow LFOs on level and colour.
    const street = this.layers.street.gain;
    const windBp = c.createBiquadFilter();
    windBp.type = "bandpass";
    windBp.frequency.value = 380;
    windBp.Q.value = 0.8;
    const wind = c.createGain();
    wind.gain.value = 0.22;
    src.connect(windBp).connect(wind).connect(street);
    const gust = this.osc("sine", 0.061, 0.1, wind.gain);
    const colour = c.createGain();
    colour.gain.value = 120;
    gust.connect(colour).connect(windBp.frequency);
    this.osc("sine", 0.143, 0.06, wind.gain);

    // Festival bulbs: a faint mains buzz with harmonics.
    const buzzBp = c.createBiquadFilter();
    buzzBp.type = "bandpass";
    buzzBp.frequency.value = 360;
    buzzBp.Q.value = 1.2;
    buzzBp.connect(street);
    this.osc("sawtooth", 120, 0.014, buzzBp);

    // Vending machine: compressor hum, fundamental + a slightly sour second harmonic.
    const vend = this.layers.vending.gain;
    this.osc("sine", 98, 0.045, vend);
    this.osc("triangle", 197.3, 0.012, vend);

    const now = c.currentTime;
    this.nextDrip = now + 1;
    this.nextClink = now + 6;
    this.nextCreak = now + 8;
    this.timer = window.setInterval(() => this.tick(), 200);
    this.chime();
    this.applyOutdoors();
    this.applyLevels();

    // Bake the loops; attach each when ready (unless disposed meanwhile).
    const attach = (buf: AudioBuffer, layerName: LayerName, gain = 1) => {
      if (gen !== this.generation || !this.layers) return;
      const g = c.createGain();
      g.gain.value = gain;
      g.connect(this.layers[layerName].gain);
      this.loop(buf, g, Math.random() * buf.duration);
    };
    attach(bakeFire(c), "fire");
    try {
      const [jukebox, band, crowd] = await Promise.all([bakeJukebox(c), bakeBand(c), bakeCrowd(c)]);
      attach(jukebox, "diner");
      attach(band, "band");
      attach(crowd, "fire", 0.6);
    } catch {
      // OfflineAudioContext unavailable: the live beds still play.
    }
  }

  /** A looping buffer source into `out`, tracked for dispose. */
  private loop(buf: AudioBuffer, out: AudioNode, offset = 0): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.connect(out);
    s.start(0, offset);
    this.sources.push(s);
    return s;
  }

  /** A free-running oscillator through a gain of `level` into `out` (a node or a param). */
  private osc(type: OscillatorType, hz: number, level: number, out: AudioNode | AudioParam): OscillatorNode {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = hz;
    const g = c.createGain();
    g.gain.value = level;
    o.connect(g);
    if (out instanceof AudioParam) g.connect(out);
    else g.connect(out);
    o.start();
    this.sources.push(o);
    return o;
  }

  /** Mix the positional layers (each 0..1). Call every frame; smoothed internally. */
  setSources(levels: AmbienceLevels) {
    for (const k of Object.keys(this.levels) as LayerName[]) {
      const v = levels[k];
      this.levels[k] = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
    }
    this.applyLevels();
  }

  private applyLevels() {
    if (!this.ctx || !this.layers || !this.outBus) return;
    const t = this.ctx.currentTime;
    for (const k of Object.keys(this.layers) as LayerName[]) {
      const l = this.layers[k];
      l.target = this.levels[k] * WEIGHT[k];
      if (l.target > 0.003 && !l.connected) {
        l.gain.connect(this.outBus);
        l.connected = true;
      }
      if (Math.abs(l.target - l.sent) < 0.004 && !(l.target === 0 && l.sent !== 0)) continue;
      l.sent = l.target;
      l.gain.gain.setTargetAtTime(l.target, t, 0.25);
    }
  }

  /** Lookahead scheduler: one-shot events, and parking silent layers. */
  private tick() {
    if (!this.ctx || !this.layers || !this.outBus) return;
    const t = this.ctx.currentTime;
    for (const l of Object.values(this.layers)) {
      if (l.connected && l.target <= 0.003 && l.gain.gain.value < 0.002) {
        l.gain.disconnect();
        l.connected = false;
      }
    }
    const audible = this.targetVolume() > 0;
    const horizon = t + 0.3;
    const L = this.levels;
    if (this.nextDrip < horizon) {
      if (audible && L.street > 0.03) this.drip(Math.max(t, this.nextDrip));
      this.nextDrip = Math.max(t, this.nextDrip) + 0.6 + Math.random() * 2.6;
    }
    if (this.nextClink < horizon) {
      if (audible && L.band > 0.03) this.clink(Math.max(t, this.nextClink));
      this.nextClink = Math.max(t, this.nextClink) + 9 + Math.random() * 18;
    }
    if (this.nextCreak < horizon) {
      if (audible && L.fire > 0.03) this.creak(Math.max(t, this.nextCreak));
      this.nextCreak = Math.max(t, this.nextCreak) + 11 + Math.random() * 20;
    }
  }

  /** A short decaying oscillator into `out`, optionally gliding to `endHz`. */
  private ping(out: AudioNode, hz: number, t: number, dur: number, vol: number, type: OscillatorType = "sine", endHz?: number) {
    const c = this.ctx!;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(hz, t);
    if (endHz) o.frequency.exponentialRampToValueAtTime(endHz, t + dur * 0.5);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
  }

  /** Water dripping into a bucket: a little upward plink, sometimes a double. */
  private drip(t: number) {
    const out = this.layers!.street.gain;
    const hz = 650 + Math.random() * 900;
    const vol = 0.012 + Math.random() * 0.018;
    this.ping(out, hz, t, 0.09, vol, "sine", hz * 1.9);
    if (Math.random() < 0.3) this.ping(out, hz * 1.12, t + 0.07 + Math.random() * 0.05, 0.07, vol * 0.5, "sine", hz * 2.1);
  }

  /** Two sake bottles touching. */
  private clink(t: number) {
    const out = this.layers!.band.gain;
    const hz = 2100 + Math.random() * 500;
    const hits: [number, number][] = [
      [0, 1],
      [0.13 + Math.random() * 0.05, 0.6],
    ];
    for (const [dt, v] of hits) {
      this.ping(out, hz, t + dt, 0.35, 0.05 * v);
      this.ping(out, hz * 2.71, t + dt, 0.18, 0.02 * v);
      this.ping(out, hz * 0.62, t + dt, 0.25, 0.018 * v, "triangle");
    }
  }

  /** A burned beam creaking: a slow stick-slip pulse train ringing a wooden resonance. */
  private creak(t: number) {
    const c = this.ctx!;
    const dur = 0.7 + Math.random() * 1.1;
    const o = c.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(22 + Math.random() * 14, t);
    o.frequency.linearRampToValueAtTime(35 + Math.random() * 20, t + dur * 0.45);
    o.frequency.linearRampToValueAtTime(14 + Math.random() * 10, t + dur);
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 380 + Math.random() * 450;
    bp.Q.value = 9;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.35, t + 0.18);
    g.gain.setValueAtTime(0.35, t + dur - 0.25);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(bp).connect(g).connect(this.layers!.fire.gain);
    o.start(t);
    o.stop(t + dur + 0.02);
    o.onended = () => {
      o.disconnect();
      bp.disconnect();
      g.disconnect();
    };
  }

  /** Door chime (e.g. when entering the shop). */
  chime() {
    if (!this.ctx || !this.master) return;
    [1174.66, 1567.98].forEach((hz, i) => {
      const c = this.ctx!,
        t = c.currentTime + i * 0.16,
        o = c.createOscillator(),
        g = c.createGain();
      o.frequency.value = hz;
      g.gain.setValueAtTime(0.04, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
      o.connect(g);
      g.connect(this.master!);
      o.start(t);
      o.stop(t + 1.4);
      o.onended = () => {
        o.disconnect();
        g.disconnect();
      };
    });
  }

  /** Silence and release the ambience (e.g. on teardown). start() can run again. */
  dispose() {
    window.clearInterval(this.timer);
    this.generation++;
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
      s.disconnect();
    }
    this.sources = [];
    this.master?.disconnect();
    this.master = this.outBus = this.room = undefined;
    this.layers = undefined;
    this.started = false;
  }

  /** 0 = inside the shop, 1 = out on the street. Street layers duck indoors. */
  setOutdoors(amount: number) {
    this.outdoors = Math.min(1, Math.max(0, amount));
    this.applyOutdoors();
  }
  private applyOutdoors() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.outBus?.gain.setTargetAtTime(0.2 + this.outdoors * 0.8, t, 0.2);
    this.room?.gain.setTargetAtTime(0.055 * (1 - this.outdoors * 0.7), t, 0.2);
  }

  /** Call every frame with the player's movement; schedules footsteps. */
  update(moving: boolean, running: boolean) {
    if (!this.ctx || !this.master || !this.noise) return;
    const c = this.ctx,
      t = c.currentTime;
    if (!moving || t - this.lastFootstep < (running ? 0.29 : 0.46)) return;
    this.lastFootstep = t;
    const source = c.createBufferSource(),
      g = c.createGain(),
      filter = c.createBiquadFilter();
    source.buffer = this.noise;
    filter.type = "lowpass";
    filter.frequency.value = running ? 1050 : 720;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.28, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    source.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    source.start(t, Math.random() * 2, 0.15);
    const o = c.createOscillator(),
      thud = c.createGain();
    o.frequency.setValueAtTime(105 + Math.random() * 20, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.09);
    thud.gain.setValueAtTime(0.035, t);
    thud.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(thud);
    thud.connect(this.master);
    o.start();
    o.stop(t + 0.14);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      g.disconnect();
    };
    o.onended = () => {
      o.disconnect();
      thud.disconnect();
    };
  }
  private targetVolume() {
    return this.muted || !this.enabled ? 0 : this.baseVolume * (this.playing ? 0.4 : 1);
  }
  private updateVolume() {
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(this.targetVolume(), this.ctx.currentTime, 0.15);
  }
  setMuted(value: boolean) {
    this.muted = value;
    this.updateVolume();
  }
  setPlaying(value: boolean) {
    this.playing = value;
    this.updateVolume();
  }
  toggleEnabled() {
    this.enabled = !this.enabled;
    this.updateVolume();
    return this.enabled;
  }
}

// ---------------------------------------------------------------------------
// Baking helpers (run once at start).

function brownNoise(c: BaseAudioContext, seconds: number): AudioBuffer {
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate);
  const data = buf.getChannelData(0);
  let brown = 0;
  for (let i = 0; i < data.length; i++) {
    brown = (brown + (Math.random() * 2 - 1) * 0.025) / 1.025;
    data[i] = brown * 5;
  }
  return buf;
}

function whiteNoise(c: BaseAudioContext, seconds: number): AudioBuffer {
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function rms(data: Float32Array): number {
  let s = 0;
  for (let i = 0; i < data.length; i++) s += data[i] * data[i];
  return Math.sqrt(s / Math.max(1, data.length));
}

function scaleTo(data: Float32Array, target: number): void {
  const r = rms(data);
  if (r > 1e-9) for (let i = 0; i < data.length; i++) data[i] *= target / r;
}

/**
 * Wrap everything rendered past `loopLen` back onto the start, so tails ring over the
 * loop seam, normalise, and return a buffer for the live context.
 */
function fold(c: BaseAudioContext, data: Float32Array, loopLen: number, rate: number): AudioBuffer {
  const out = new Float32Array(loopLen);
  out.set(data.subarray(0, loopLen));
  for (let i = loopLen; i < data.length && i - loopLen < loopLen; i++) out[i - loopLen] += data[i];
  scaleTo(out, LOOP_RMS);
  const buf = c.createBuffer(1, loopLen, rate);
  buf.getChannelData(0).set(out);
  return buf;
}

/** Render `build` offline for loop + tail seconds and fold it into a seamless loop. */
async function bake(
  c: BaseAudioContext,
  rate: number,
  seconds: number,
  tail: number,
  build: (oc: OfflineAudioContext, out: AudioNode) => void,
  post?: (data: Float32Array) => void,
): Promise<AudioBuffer> {
  const oc = new OfflineAudioContext(1, Math.ceil((seconds + tail) * rate), rate);
  build(oc, oc.destination);
  const rendered = await oc.startRendering();
  const data = rendered.getChannelData(0);
  post?.(data);
  return fold(c, data, Math.round(seconds * rate), rate);
}

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

/** The dying roof fire: low roar, hiss and sparse crackles, all flickering. Plain JS DSP. */
function bakeFire(c: BaseAudioContext): AudioBuffer {
  const rate = 22050;
  const seconds = 9;
  const n = Math.ceil((seconds + 0.3) * rate);
  const data = new Float32Array(n);
  const crackle = new Float32Array(n);
  // Crackles: Poisson events, mostly tiny, a few loud pops, some in little bursts.
  for (let t = Math.random() * 0.2; t < seconds - 0.05; t += -Math.log(1 - Math.random()) / 6) {
    const bursts = Math.random() < 0.2 ? 2 + Math.floor(Math.random() * 4) : 1;
    let at = Math.floor(t * rate);
    for (let b = 0; b < bursts; b++) {
      const amp = 0.08 + 0.9 * Math.pow(Math.random(), 3);
      const len = 20 + Math.floor(Math.random() * 350);
      const tau = len / 4;
      for (let k = 0; k < len && at + k < n; k++) crackle[at + k] += amp * (Math.random() * 2 - 1) * Math.exp(-k / tau);
      at += Math.floor(rate * (0.01 + Math.random() * 0.04));
    }
  }
  let brown = 0,
    hissPrevX = 0,
    hissY = 0,
    crPrevX = 0,
    crY = 0,
    flicker = 0.6,
    flickerTarget = 0.6;
  for (let i = 0; i < n; i++) {
    if (i % 4000 === 0) flickerTarget = 0.35 + Math.random() * 0.65;
    flicker += (flickerTarget - flicker) * 0.0004;
    const w = Math.random() * 2 - 1;
    brown = (brown + w * 0.02) / 1.02;
    hissY = 0.82 * (hissY + w - hissPrevX); // one-pole high-pass: the hiss
    hissPrevX = w;
    crY = 0.9 * (crY + crackle[i] - crPrevX); // snappier crackles
    crPrevX = crackle[i];
    data[i] = brown * 3.5 * flicker + hissY * 0.035 * flicker + crY;
  }
  return fold(c, data, Math.round(seconds * rate), rate);
}

interface VoiceOpts {
  pitch: number;
  formant: number;
  level: number;
  from: number;
  to: number;
  pause: [number, number];
}

/**
 * One murmuring voice: a sawtooth "larynx" plus breath noise through a moving band-pass
 * "formant", gated into syllables and phrases. A few nodes per voice, all automation.
 */
function voice(oc: OfflineAudioContext, out: AudioNode, breath: AudioBuffer, v: VoiceOpts): void {
  const o = oc.createOscillator();
  o.type = "sawtooth";
  o.frequency.value = v.pitch;
  const ns = oc.createBufferSource();
  ns.buffer = breath;
  ns.loop = true;
  const ng = oc.createGain();
  ng.gain.value = 0.25;
  const bp = oc.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 3;
  bp.frequency.value = v.formant;
  const env = oc.createGain();
  env.gain.value = 0;
  o.connect(bp);
  ns.connect(ng).connect(bp);
  bp.connect(env).connect(out);
  let t = v.from + Math.random() * v.pause[1];
  while (t < v.to) {
    const syllables = 2 + Math.floor(Math.random() * 8);
    for (let s = 0; s < syllables; s++) {
      const d = 0.08 + Math.random() * 0.15;
      if (t + d > v.to) break;
      bp.frequency.setValueAtTime(v.formant * (0.75 + Math.random() * 0.6), t);
      o.frequency.setTargetAtTime(v.pitch * (0.92 + Math.random() * 0.22) * (1 - (0.14 * s) / syllables), t, 0.04);
      env.gain.setTargetAtTime(v.level * (0.5 + Math.random() * 0.5), t, 0.012);
      env.gain.setTargetAtTime(0, t + d * 0.65, 0.025);
      t += d + 0.02 + Math.random() * 0.06;
    }
    t += v.pause[0] + Math.random() * (v.pause[1] - v.pause[0]);
  }
  o.start(0);
  ns.start(0, Math.random() * breath.duration);
}

/** Casino: the low murmur of a crowd of evacuated people, through walls. */
function bakeCrowd(c: BaseAudioContext): Promise<AudioBuffer> {
  const seconds = 16;
  return bake(c, 16000, seconds, 1, (oc, out) => {
    const lp = oc.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 650;
    lp.connect(out);
    const breath = whiteNoise(oc, 2);
    for (let i = 0; i < 9; i++) {
      voice(oc, lp, breath, {
        pitch: 85 + Math.random() * 120,
        formant: 380 + Math.random() * 500,
        level: 0.2 + Math.random() * 0.15,
        from: 0,
        to: seconds - 0.4,
        pause: [0.3, 1.8],
      });
    }
  });
}

/** Karplus-Strong pluck (nylon-ish: soft excitation) mixed into `data`. Keep hz ≤ ~350. */
function pluck(data: Float32Array, rate: number, at: number, hz: number, amp: number): void {
  const n = Math.max(2, Math.round(rate / hz));
  const ring = new Float32Array(n);
  for (let i = 0; i < n; i++) ring[i] = Math.random() * 2 - 1;
  for (let pass = 0; pass < 3; pass++) for (let i = 0; i < n; i++) ring[i] = 0.5 * (ring[i] + ring[(i + 1) % n]);
  let peak = 1e-6;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(ring[i]));
  for (let i = 0; i < n; i++) ring[i] *= amp / peak;
  const i0 = Math.max(0, Math.floor(at * rate));
  const len = Math.min(data.length - i0, Math.floor(rate * 2.8));
  let idx = 0;
  for (let k = 0; k < len; k++) {
    const y = ring[idx];
    const next = (idx + 1) % n;
    ring[idx] = 0.4985 * (y + ring[next]);
    data[i0 + k] += y;
    idx = next;
  }
}

/**
 * Band corner: three voices of murmured banter, then Ongaku's slow classical figure
 * (p-i-m-a-m-i arpeggios, A minor, with a little rubato) mixed in after rendering.
 */
function bakeBand(c: BaseAudioContext): Promise<AudioBuffer> {
  const rate = 24000;
  const seconds = 22;
  const voices = [
    { pitch: 112, formant: 620 },
    { pitch: 138, formant: 760 },
    { pitch: 96, formant: 520 },
  ];
  return bake(
    c,
    rate,
    seconds,
    2.8,
    (oc, out) => {
      const lp = oc.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 1700;
      lp.connect(out);
      const breath = whiteNoise(oc, 2);
      for (const v of voices) voice(oc, lp, breath, { ...v, level: 0.3, from: 0, to: seconds - 0.4, pause: [1.2, 5.5] });
    },
    (data) => {
      scaleTo(data, 0.05); // banter level relative to the guitar
      const guitar = new Float32Array(data.length);
      const bars: number[][] = [
        [45, 52, 57, 60, 57, 52], // Am
        [50, 57, 62, 65, 62, 57], // Dm
        [40, 47, 52, 56, 59, 56], // E
        [45, 52, 57, 60, 64, 60], // Am
        [41, 48, 53, 57, 60, 57], // F
        [43, 50, 55, 59, 62, 59], // G
        [48, 55, 60, 64, 60, 55], // C
        [40, 47, 52, 56, 59, 52], // E
      ];
      const eighth = 0.36;
      let t = 0.3;
      bars.forEach((bar, b) => {
        bar.forEach((m, i) => {
          const rubato = (Math.random() - 0.5) * 0.04 + (i === 5 && b % 4 === 3 ? 0.12 : 0);
          pluck(guitar, rate, t + rubato, midi(m), i === 0 ? 0.5 : 0.32);
          t += eighth * (b % 4 === 3 ? 1.12 : 1); // slows into each cadence
        });
        if (b === 3) t += 1.6; // an idle pause between phrases
      });
      scaleTo(guitar, 0.08);
      for (let i = 0; i < data.length; i++) data[i] += guitar[i];
    },
  );
}

/**
 * The diner jukebox: an original 1950s-style doo-wop / rock'n'roll loop, I–vi–IV–V in B♭
 * at a 138 bpm shuffle. Boogie bass, triplet piano, kick/snare, a breathy sax-ish lead.
 * Baked through a low-pass + a boxy resonance, as if heard through the diner's glass.
 */
function bakeJukebox(c: BaseAudioContext): Promise<AudioBuffer> {
  const beat = 60 / 138;
  const bar = beat * 4;
  const bars = 8;
  return bake(c, 22050, bars * bar, 1.2, (oc, out) => {
    const glass = oc.createBiquadFilter();
    glass.type = "lowpass";
    glass.frequency.value = 950;
    glass.Q.value = 0.6;
    const box = oc.createBiquadFilter();
    box.type = "peaking";
    box.frequency.value = 260;
    box.gain.value = 5;
    box.Q.value = 1.2;
    glass.connect(box).connect(out);
    const noise = whiteNoise(oc, 1);
    /** Swung position: x.5 lands on the last triplet of the beat. */
    const swing = (pos: number) => Math.floor(pos) * beat + (pos % 1 ? (beat * 2) / 3 : 0);

    const note = (hz: number, t: number, dur: number, vol: number, type: OscillatorType, endHz?: number) => {
      const o = oc.createOscillator();
      const g = oc.createGain();
      o.type = type;
      o.frequency.setValueAtTime(hz, t);
      if (endHz) o.frequency.exponentialRampToValueAtTime(endHz, t + dur * 0.5);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(glass);
      o.start(t);
      o.stop(t + dur + 0.02);
    };

    // Chords: [bass root, minor?, piano voicing].
    const prog: [number, boolean, number[]][] = [
      [34, false, [58, 62, 65]], // B♭
      [31, true, [55, 58, 62]], // Gm
      [39, false, [55, 58, 63]], // E♭
      [41, false, [57, 60, 65]], // F
    ];
    // Sax-ish lead: [beat (swung .5), length in beats, midi], one list per bar. Original.
    const lead: [number, number, number][][] = [
      [[0, 1.5, 65], [1.5, 0.5, 67], [2, 1, 65], [3, 1, 62]],
      [[0, 1, 67], [1, 0.5, 70], [1.5, 1.5, 67], [3, 1, 62]],
      [[0, 1.5, 63], [1.5, 0.5, 65], [2, 1, 67], [3, 0.5, 70], [3.5, 0.5, 67]],
      [[0, 2, 65], [2, 1, 69], [3, 1, 72]],
      [[0, 1, 70], [1, 0.5, 69], [1.5, 0.5, 67], [2, 2, 65]],
      [[0, 1, 62], [1, 1, 65], [2, 1.5, 67], [3.5, 0.5, 65]],
      [[0, 1, 63], [1, 1, 67], [2, 1, 70], [3, 1, 67]],
      [[0, 1.5, 72], [1.5, 0.5, 69], [2, 2, 65]],
    ];
    const vib = oc.createOscillator();
    vib.frequency.value = 5.3;
    const vibDepth = oc.createGain();
    vibDepth.gain.value = 14; // cents
    vib.connect(vibDepth);
    vib.start(0);

    for (let b = 0; b < bars; b++) {
      const t0 = b * bar;
      const [root, minor, voicing] = prog[b % 4];
      // Boogie bass: R 3 5 6 8 6 5 3 on swung eighths.
      const walk = [0, minor ? 3 : 4, 7, 9, 12, 9, 7, minor ? 3 : 4];
      walk.forEach((iv, k) => note(midi(root + iv), t0 + swing(k / 2), 0.32, 0.5, "triangle"));
      // Triplet piano comping, accent on the beat: one oscillator per chord tone, gated.
      for (const m of voicing) {
        const o = oc.createOscillator();
        o.type = "triangle";
        o.frequency.value = midi(m);
        const g = oc.createGain();
        g.gain.setValueAtTime(0, t0);
        for (let j = 0; j < 12; j++) {
          const tj = t0 + (j * beat) / 3;
          g.gain.setValueAtTime(0, tj);
          g.gain.linearRampToValueAtTime(j % 3 ? 0.035 : 0.06, tj + 0.005);
          g.gain.setTargetAtTime(0, tj + 0.01, 0.045);
        }
        o.connect(g).connect(glass);
        o.start(t0);
        o.stop(t0 + bar);
      }
      // Drums: kick on 1 & 3, snare on 2 & 4.
      for (let k = 0; k < 4; k++) {
        const tk = t0 + k * beat;
        if (k % 2 === 0) note(120, tk, 0.25, 0.7, "sine", 45);
        else {
          const s = oc.createBufferSource();
          s.buffer = noise;
          const f = oc.createBiquadFilter();
          f.type = "bandpass";
          f.frequency.value = 1500;
          f.Q.value = 0.8;
          const g = oc.createGain();
          g.gain.setValueAtTime(0.5, tk);
          g.gain.exponentialRampToValueAtTime(0.0001, tk + 0.16);
          s.connect(f).connect(g).connect(glass);
          s.start(tk, Math.random() * 0.7, 0.2);
        }
      }
      // Lead.
      for (const [pos, len, m] of lead[b]) {
        const t = t0 + swing(pos);
        const d = Math.max(0.12, len * beat * 0.92);
        const g = oc.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.11, t + 0.04);
        g.gain.setTargetAtTime(0.08, t + 0.05, 0.1);
        g.gain.setTargetAtTime(0, t + d - 0.05, 0.04);
        const lp = oc.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.setValueAtTime(700, t);
        lp.frequency.linearRampToValueAtTime(1500, t + 0.06);
        lp.Q.value = 2;
        lp.connect(g).connect(glass);
        for (const detune of [-6, 6]) {
          const o = oc.createOscillator();
          o.type = "sawtooth";
          o.frequency.value = midi(m);
          o.detune.value = detune;
          vibDepth.connect(o.detune);
          o.connect(lp);
          o.start(t);
          o.stop(t + d + 0.25);
        }
      }
    }
  });
}
