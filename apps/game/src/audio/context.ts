/**
 * The one shared AudioContext and master bus for the whole game.
 *
 * Owns: lazily creating the AudioContext, resuming it after a user gesture,
 * suspending it while the tab is hidden, and the master GainNode (with mute).
 * Must not: make sounds itself. Every audio module routes into `masterBus()`.
 *
 * Browsers refuse to start audio before a user gesture: call `unlockAudio()`
 * from the first click/keydown handler (it is safe to call repeatedly).
 */

/** Master level, leaving headroom so stacked sfx + music don't clip. */
const MASTER_LEVEL = 0.8;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

/** The shared AudioContext (created on first use, possibly still suspended). */
export function audioContext(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER_LEVEL;
    // A gentle limiter on the master keeps surprise peaks (alarm + music) civil.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    master.connect(limiter);
    limiter.connect(ctx.destination);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (!ctx) return;
        if (document.hidden) void ctx.suspend();
        else void ctx.resume().catch(() => {});
      });
    }
  }
  return ctx;
}

/** Node every sound connects to. */
export function masterBus(): GainNode {
  audioContext();
  return master!;
}

/** Resume the context; call from a user gesture. Resolves once running (or rejects). */
export async function unlockAudio(): Promise<void> {
  const c = audioContext();
  if (c.state !== "running") await c.resume();
}

export function setMuted(value: boolean): void {
  muted = value;
  if (ctx && master) master.gain.setTargetAtTime(muted ? 0 : MASTER_LEVEL, ctx.currentTime, 0.05);
}

export function isMuted(): boolean {
  return muted;
}

/** Flip mute; returns the new muted state. */
export function toggleMuted(): boolean {
  setMuted(!muted);
  return muted;
}
