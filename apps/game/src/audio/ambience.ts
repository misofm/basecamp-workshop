/**
 * City + shop ambience: a layered procedural soundscape, generated locally.
 *
 * Owns: the street noise bed, room tone, mains hum, passing-vehicle swooshes,
 * the door chime and footsteps. Routes into the shared master bus (context.ts).
 * Must not: know about world geometry. The caller pushes state in:
 *   - setOutdoors(0..1): how "outside" the listener is (1 = open street,
 *     0 = deep inside the shop). Replaces the old z-based street level now that
 *     the street is an open city. Ease it near the doorway for a smooth blend.
 *   - update(moving, running): call every frame; schedules footsteps.
 *   - setPlaying(true) ducks the ambience while the deck plays.
 * Moved from src/ambience.ts. Original sound design, no samples.
 */
import { audioContext, masterBus, unlockAudio } from "./context";

export class ShopAmbience {
  private ctx?: AudioContext;
  private master?: GainNode;
  private street?: GainNode;
  private room?: GainNode;
  private noise?: AudioBuffer;
  private timer?: number;
  private muted = false;
  private enabled = true;
  private playing = false;
  private readonly baseVolume = 0.12;
  private lastFootstep = 0;
  private started = false;
  private outdoors = 1;
  /** Start the beds (after a user gesture). Safe to call repeatedly. */
  async start() {
    this.ctx ??= audioContext();
    await unlockAudio();
    if (this.started) return;
    this.started = true;
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this.targetVolume();
    this.master.connect(masterBus());
    this.noise = c.createBuffer(1, c.sampleRate * 4, c.sampleRate);
    const data = this.noise.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < data.length; i++) {
      brown = (brown + (Math.random() * 2 - 1) * 0.025) / 1.025;
      data[i] = brown * 5;
    }
    const bed = (hz: number, gain: number) => {
      const source = c.createBufferSource();
      source.buffer = this.noise!;
      source.loop = true;
      const filter = c.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = hz;
      const g = c.createGain();
      g.gain.value = gain;
      source.connect(filter);
      filter.connect(g);
      g.connect(this.master!);
      source.start();
      return g;
    };
    this.street = bed(750, 0.13);
    this.room = bed(190, 0.055);
    const hum = c.createOscillator(),
      humGain = c.createGain();
    hum.frequency.value = 60;
    humGain.gain.value = 0.008;
    hum.connect(humGain);
    humGain.connect(this.master);
    hum.start();
    const pass = () => {
      this.vehicle();
      this.timer = window.setTimeout(pass, 7000 + Math.random() * 8000);
    };
    this.timer = window.setTimeout(pass, 2200);
    this.chime();
    this.applyOutdoors();
  }
  private vehicle() {
    if (!this.ctx || !this.noise || !this.master) return;
    const c = this.ctx,
      t = c.currentTime,
      source = c.createBufferSource(),
      filter = c.createBiquadFilter(),
      gain = c.createGain(),
      pan = c.createStereoPanner();
    source.buffer = this.noise;
    source.loop = true;
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(250, t);
    filter.frequency.linearRampToValueAtTime(950, t + 2.5);
    filter.frequency.linearRampToValueAtTime(180, t + 6);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.12, t + 2.7);
    gain.gain.linearRampToValueAtTime(0, t + 6);
    pan.pan.setValueAtTime(-1, t);
    pan.pan.linearRampToValueAtTime(1, t + 6);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(pan);
    pan.connect(this.street!);
    source.start();
    source.stop(t + 6.1);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
      pan.disconnect();
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
    window.clearTimeout(this.timer);
    this.master?.disconnect();
    this.master = this.street = this.room = undefined;
    this.started = false;
  }
  /** 0 = inside the shop, 1 = out on the street. Street bed level follows it. */
  setOutdoors(amount: number) {
    this.outdoors = Math.min(1, Math.max(0, amount));
    this.applyOutdoors();
  }
  private applyOutdoors() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.street?.gain.setTargetAtTime(0.04 + this.outdoors * 0.17, t, 0.2);
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
    return this.muted || !this.enabled
      ? 0
      : this.baseVolume * (this.playing ? 0.4 : 1);
  }
  private updateVolume() {
    if (this.ctx && this.master)
      this.master.gain.setTargetAtTime(
        this.targetVolume(),
        this.ctx.currentTime,
        0.15,
      );
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
