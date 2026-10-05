/**
 * Adaptive render quality: steps the render scale, GTAO and bloom down when frames are slow
 * and back up when they are comfortably fast. PURE (no DOM, no three.js) so it is unit-tested.
 *
 * Owns: the frame-time window, the warm-up after a tab comes back, outlier rejection and the
 * hysteresis (down above 20 ms average, up only after 3 consecutive windows under 12 ms).
 * Order: down = render scale, then GTAO, then bloom (past 40 ms); up = bloom, GTAO, scale.
 * Must not: touch the renderer; the world applies the returned change.
 */
export const WINDOW_FRAMES = 40;
/** Frames ignored after the tab becomes visible again (or at start). */
export const WARMUP_FRAMES = 60;
/** A single frame longer than this is a hitch / tab switch, never a measurement. */
export const OUTLIER_MS = 250;
export const DOWN_MS = 20;
export const BLOOM_DOWN_MS = 40;
export const UP_MS = 12;
export const UP_WINDOWS = 3;
export const SCALE_STEP = 0.15;

export interface Stages {
  ao: boolean;
  bloom: boolean;
}

export interface QualityChange {
  scale?: number;
  ao?: boolean;
  bloom?: boolean;
}

export class AdaptiveQuality {
  scale: number;
  /** Stages this controller switched off (and may switch back on). */
  aoOff = false;
  bloomOff = false;
  private frames = 0;
  private ms = 0;
  private warmup = WARMUP_FRAMES;
  private fastWindows = 0;

  constructor(
    private readonly startScale: number,
    private readonly minScale: number,
  ) {
    this.scale = startScale;
  }

  /** The tab was hidden / shown or the window refocused: drop the measurement, skip a warm-up. */
  reset(warmupFrames = WARMUP_FRAMES): void {
    this.frames = 0;
    this.ms = 0;
    this.fastWindows = 0;
    this.warmup = warmupFrames;
  }

  /** Feed one frame time. `stages` = what the renderer currently has on (null: no post-processing). */
  frame(rawDelta: number, stages: Stages | null): QualityChange | null {
    if (rawDelta > OUTLIER_MS || rawDelta <= 0) return null;
    if (this.warmup > 0) {
      this.warmup--;
      return null;
    }
    this.frames++;
    this.ms += rawDelta;
    if (this.frames < WINDOW_FRAMES) return null;
    const average = this.ms / this.frames;
    this.frames = 0;
    this.ms = 0;

    if (average > DOWN_MS) {
      this.fastWindows = 0;
      if (this.scale > this.minScale) {
        this.scale = Math.max(this.minScale, this.scale - SCALE_STEP);
        return { scale: this.scale };
      }
      if (stages?.ao) {
        this.aoOff = true;
        return { ao: false };
      }
      if (average > BLOOM_DOWN_MS && stages?.bloom) {
        this.bloomOff = true;
        return { bloom: false };
      }
      return null;
    }
    if (average < UP_MS) {
      if (++this.fastWindows < UP_WINDOWS) return null;
      this.fastWindows = 0;
      if (this.bloomOff) {
        this.bloomOff = false;
        return { bloom: true };
      }
      if (this.aoOff) {
        this.aoOff = false;
        return { ao: true };
      }
      if (this.scale < this.startScale) {
        this.scale = Math.min(this.startScale, this.scale + SCALE_STEP);
        return { scale: this.scale };
      }
      return null;
    }
    this.fastWindows = 0;
    return null;
  }
}
