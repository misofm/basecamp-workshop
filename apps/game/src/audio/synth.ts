/**
 * Procedural demo loop: the fallback "music" for records with no real audio.
 *
 * Owns: generating an endless chord/bass/lead/hat loop from ShopRecord.synth
 * ({ bpm, notes: 4 frequencies }) into a caller-provided AudioNode.
 * Must not: decide volume envelopes, positioning or preview timing (deck.ts
 * does that) or connect to the destination directly.
 *
 * Ported from the original record-shop DemoAudio. Original sound design, no samples.
 */

export interface SynthParams {
  bpm: number;
  /** Four frequencies (Hz), e.g. a 7th chord. */
  notes: number[];
}

export class SynthLoop {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private step = 0;
  private running = false;
  /** Per-loop bus so stop() can silence already-scheduled tones instantly. */
  private bus: GainNode | null = null;

  constructor(
    private readonly ctx: AudioContext,
    private readonly output: AudioNode,
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  start(params: SynthParams): void {
    this.stop();
    const notes = params.notes.length >= 4 ? params.notes : [130.81, 164.81, 196, 246.94];
    const bpm = params.bpm > 0 ? params.bpm : 90;
    this.running = true;
    this.step = 0;
    const bus = this.ctx.createGain();
    bus.connect(this.output);
    this.bus = bus;

    const tick = () => {
      if (!this.running || this.bus !== bus) return;
      const ctx = this.ctx;
      const t = ctx.currentTime;
      const tone = (hz: number, duration: number, volume: number, type: OscillatorType = "sine", delay = 0) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = type;
        o.frequency.value = hz;
        g.gain.setValueAtTime(0, t + delay);
        g.gain.linearRampToValueAtTime(volume, t + delay + 0.018);
        g.gain.exponentialRampToValueAtTime(0.0001, t + delay + duration);
        o.connect(g);
        g.connect(bus);
        o.start(t + delay);
        o.stop(t + delay + duration + 0.02);
        o.onended = () => {
          o.disconnect();
          g.disconnect();
        };
      };
      // Chord pad every bar, kick + bass on beats, sparkly lead, off-beat hat.
      if (this.step % 8 === 0) notes.forEach((n, i) => tone(n * 2, 2.1, 0.08, "sine", i * 0.03));
      if (this.step % 2 === 0) {
        tone(54, 0.18, 0.45);
        tone(notes[Math.floor(this.step / 4) % 4] / 2, 0.32, 0.25, "triangle");
      }
      tone(notes[(this.step * 3) % 4] * 4, 0.19, 0.07, "sine");
      if (this.step % 2 === 1) tone(3800, 0.035, 0.025, "triangle");
      this.step++;
      this.timer = setTimeout(tick, 60000 / bpm / 2);
    };
    tick();
  }

  stop(): void {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.bus) {
      this.bus.disconnect();
      this.bus = null;
    }
  }
}
