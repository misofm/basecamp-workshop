/**
 * RecordDeck: the listening station's 30-second preview player.
 *
 * Owns: streaming a track's HLS rendition from the Miso CDN (hls.js, or native
 * HLS on Safari; retried once from the Walrus aggregator if the CDN can't serve it) or falling back to the procedural SynthLoop; the preview
 * window (30 s from the middle of the track, 1 s fade-in, 5 s fade-out); and
 * the deck's positional feel (distance attenuation + stereo pan).
 * Must not: change game state, touch the DOM beyond its own hidden <audio>
 * element, or know about wallets/chains. The controller reacts to onEnded.
 *
 * Signal chain (per play):
 *   <audio> -> MediaElementSource ─┐
 *                     SynthLoop  ──┴> envelope (fades) -> StereoPanner -> distance gain -> master
 *
 * Races: every play() bumps a generation counter; any async step that finds
 * a newer generation tears itself down silently, so play -> stop -> play in quick
 * succession never leaves two sources running.
 *
 * Coordinates: x/z on the ground plane; `heading` is the listener's yaw in the
 * world's convention where forward = (-sin h, -cos h) and right = (cos h, -sin h)
 * (the Three.js camera yaw). If the world uses another convention, adapt in the
 * caller or flip the sign of the pan.
 */
import Hls, { Events, type ErrorData, type LevelLoadedData } from "hls.js";
import { aggregatorFallback, MISO_CDN } from "../miso/media";
import type { ShopRecord, TrackRef } from "../miso/types";
import { audioContext, masterBus, unlockAudio } from "./context";
import { SynthLoop } from "./synth";

export type DeckKind = "hls" | "synth";

/** Preview window length and fades (seconds). */
export const PREVIEW_SECONDS = 30;
const FADE_IN = 1;
const FADE_OUT = 5;
const STOP_FADE = 0.25;
/** Give up if the stream hasn't started making sound in this long. */
const START_TIMEOUT_MS = 15000;
/** Relative loudness of the two sources before the envelope. */
const LEVEL: Record<DeckKind, number> = { hls: 0.9, synth: 0.24 };

export const hlsUrl = (quiltId: string): string =>
  `${MISO_CDN}/blobs/by-quilt-id/${quiltId}/aac-96.m3u8`;

/** Start of the preview window: centred on the middle of the track. */
export const previewStart = (durationSec: number): number =>
  Math.max(0, durationSec / 2 - PREVIEW_SECONDS / 2);

interface Session {
  gen: number;
  kind: DeckKind;
  record: ShopRecord;
  trackIndex: number;
  envelope: GainNode;
  el?: HTMLAudioElement;
  hls?: Hls;
  source?: MediaElementAudioSourceNode;
  synth?: SynthLoop;
  /** Seconds into the media (hls) or ctx time (synth) where the window began. */
  windowStart: number;
  windowLen: number;
  fadingOut: boolean;
  /** Rejects a still-pending start (used when the session is torn down early). */
  cancel?: () => void;
  timer?: ReturnType<typeof setInterval>;
}

export class RecordDeck {
  /** Fired when a preview reaches the end of its 30 s window (not on stop()). */
  onEnded: (() => void) | null = null;
  /** Fired ~5x per second while playing. */
  onProgress: ((elapsedSec: number, windowSec: number) => void) | null = null;
  /** Fired if a stream dies after it had started (the deck has already stopped). */
  onError: ((error: Error) => void) | null = null;
  /** Debug hook: hls.js events as they happen (name, short detail). */
  onDebug: ((event: string, detail?: string) => void) | null = null;

  private gen = 0;
  private session: Session | null = null;
  private panner: StereoPannerNode | null = null;
  private distanceGain: GainNode | null = null;
  private listener = { x: 0, z: 0, heading: 0 };
  private sourcePos = { x: 0, z: 0 };

  /** What is producing sound right now (null when idle). */
  get kind(): DeckKind | null {
    return this.session?.kind ?? null;
  }
  get isPlaying(): boolean {
    return this.session !== null;
  }
  get trackIndex(): number | null {
    return this.session?.trackIndex ?? null;
  }
  /** The hidden <audio> element of the current HLS session (tests/debug). */
  get mediaElement(): HTMLAudioElement | null {
    return this.session?.el ?? null;
  }
  /**
   * Tests/debug: what the deck is doing. For HLS, `currentTime` is the <audio>
   * element's media time and `windowStart` where the 30 s preview began (≈ mid-track).
   */
  debugInfo(): { kind: DeckKind | null; trackIndex: number | null; windowStart: number | null; currentTime: number | null; duration: number | null; paused: boolean | null } {
    const session = this.session;
    const el = session?.el;
    return {
      kind: session?.kind ?? null,
      trackIndex: session?.trackIndex ?? null,
      windowStart: session ? session.windowStart : null,
      currentTime: el ? el.currentTime : null,
      duration: el && Number.isFinite(el.duration) ? el.duration : null,
      paused: el ? el.paused : null,
    };
  }

  /**
   * Start a 30 s preview of `record.tracks[trackIndex]`. Resolves when sound
   * actually starts; rejects with a player-friendly Error. If a newer play()/stop()
   * supersedes it, rejects with an Error named "AbortError" (callers ignore those).
   */
  async play(record: ShopRecord, trackIndex = 0): Promise<void> {
    const track = record.tracks[trackIndex];
    if (!track) throw new Error("This record has no track there.");
    this.stopCurrent();
    const gen = ++this.gen;
    const ctx = audioContext();
    // Resume if we can, but never hang here waiting for a gesture.
    await Promise.race([unlockAudio().catch(() => {}), delay(400)]);
    if (gen !== this.gen) throw superseded();

    const envelope = ctx.createGain();
    envelope.gain.value = 0;
    envelope.connect(this.outputChain());
    const session: Session = {
      gen,
      kind: track.quiltId ? "hls" : "synth",
      record,
      trackIndex,
      envelope,
      windowStart: 0,
      windowLen: Math.min(PREVIEW_SECONDS, Math.max(1, track.durationSec)),
      fadingOut: false,
    };
    this.session = session;
    try {
      if (track.quiltId) await this.startHls(session, track, track.quiltId);
      else this.startSynth(session);
    } catch (error) {
      if (this.session === session) {
        this.session = null;
        this.teardown(session);
      }
      throw error;
    }
    if (gen !== this.gen) throw superseded();
    // Sound is starting: fade in and start the window clock.
    const now = ctx.currentTime;
    envelope.gain.cancelScheduledValues(now);
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(LEVEL[session.kind], now + FADE_IN);
    session.timer = setInterval(() => this.tick(session), 200);
  }

  /** Skip to the next track of the current record (wraps). No-op when idle. */
  async nextTrack(): Promise<void> {
    const s = this.session;
    if (!s) return;
    await this.play(s.record, (s.trackIndex + 1) % s.record.tracks.length);
  }

  /** Fade out quickly and release everything. Does not fire onEnded. */
  stop(): void {
    this.gen++;
    this.stopCurrent();
  }

  /** Listener (player/camera) position and yaw; see header for the convention. */
  setListener(x: number, z: number, heading: number): void {
    this.listener = { x, z, heading };
    this.updatePosition();
  }

  /** Where the deck is in the world. */
  setSourcePosition(x: number, z: number): void {
    this.sourcePos = { x, z };
    this.updatePosition();
  }

  // ------------------------------------------------------------ internals

  private outputChain(): AudioNode {
    if (!this.panner || !this.distanceGain) {
      const ctx = audioContext();
      this.panner = ctx.createStereoPanner();
      this.distanceGain = ctx.createGain();
      this.panner.connect(this.distanceGain);
      this.distanceGain.connect(masterBus());
      this.updatePosition();
    }
    return this.panner;
  }

  private updatePosition(): void {
    if (!this.panner || !this.distanceGain) return;
    const dx = this.sourcePos.x - this.listener.x;
    const dz = this.sourcePos.z - this.listener.z;
    const distance = Math.hypot(dx, dz);
    // Full volume within 2 m, then 1/(1 + k·d): ~15% at 15 m.
    const gain = distance <= 2 ? 1 : 1 / (1 + (distance - 2) * 0.436);
    const h = this.listener.heading;
    const rightness = distance > 0.01 ? (dx * Math.cos(h) - dz * Math.sin(h)) / distance : 0;
    const pan = Math.max(-1, Math.min(1, rightness * 0.75 * Math.min(1, distance / 1.5)));
    const t = audioContext().currentTime;
    this.distanceGain.gain.setTargetAtTime(gain, t, 0.08);
    this.panner.pan.setTargetAtTime(pan, t, 0.08);
  }

  private startSynth(session: Session): void {
    const ctx = audioContext();
    session.synth = new SynthLoop(ctx, session.envelope);
    session.synth.start(session.record.synth);
    session.windowStart = ctx.currentTime;
  }

  private startHls(session: Session, track: TrackRef, quiltId: string): Promise<void> {
    const ctx = audioContext();
    const el = document.createElement("audio");
    el.crossOrigin = "anonymous";
    el.preload = "auto";
    session.el = el;
    session.source = ctx.createMediaElementSource(el);
    session.source.connect(session.envelope);
    const url = hlsUrl(quiltId);
    const debug = (event: string, detail?: string) => this.onDebug?.(event, detail);

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let seekTarget = previewStart(track.durationSec);
      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(new Error(message));
      };
      session.cancel = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(superseded());
      };
      const timeout = setTimeout(
        () => fail("The record won't spin up — the audio stream timed out."),
        START_TIMEOUT_MS,
      );
      const begin = () => {
        if (settled || session.gen !== this.gen) return;
        el.currentTime = seekTarget;
        el.play().catch((error: unknown) => {
          const blocked = error instanceof DOMException && error.name === "NotAllowedError";
          fail(blocked ? "Audio is blocked by the browser — click the page and try again." : "Couldn't play this track.");
        });
      };
      el.addEventListener("playing", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        session.windowStart = el.currentTime;
        debug("playing", `t=${el.currentTime.toFixed(2)}`);
        resolve();
      });
      el.addEventListener("ended", () => {
        if (this.session === session) this.finish(session);
      });

      if (Hls.isSupported()) {
        const hls = new Hls({
          startPosition: seekTarget,
          maxBufferLength: 20,
          maxMaxBufferLength: 40,
          enableWorker: true,
        });
        session.hls = hls;
        hls.on(Events.MANIFEST_PARSED, (_e, data) => {
          debug("MANIFEST_PARSED", `levels=${data.levels.length}`);
        });
        hls.on(Events.LEVEL_LOADED, (_e, data: LevelLoadedData) => {
          const total = data.details.totalduration;
          debug("LEVEL_LOADED", `totalduration=${total.toFixed(2)}`);
          // Trust the playlist's real duration over catalog metadata.
          seekTarget = previewStart(total);
          session.windowLen = Math.min(PREVIEW_SECONDS, Math.max(1, total));
        });
        hls.on(Events.FRAG_LOADED, (_e, data) => {
          debug("FRAG_LOADED", `sn=${String(data.frag.sn)}`);
        });
        hls.on(Events.ERROR, (_e, data: ErrorData) => {
          debug("ERROR", `${data.type}/${data.details} fatal=${data.fatal}`);
          if (!data.fatal) return;
          // Not on the CDN: retry once from the aggregator. Segment URLs in the
          // playlist are relative, so switching the playlist URL is enough.
          const fallback = aggregatorFallback(hls.url ?? "");
          if (!settled && data.type === Hls.ErrorTypes.NETWORK_ERROR && fallback) {
            debug("FALLBACK", fallback);
            hls.loadSource(fallback);
            return;
          }
          if (!settled) fail("Couldn't load this track's audio. Check your connection.");
          else if (this.session === session) this.die(session, "The stream dropped out.");
        });
        el.addEventListener("canplay", begin, { once: true });
        hls.loadSource(url);
        hls.attachMedia(el);
      } else if (el.canPlayType("application/vnd.apple.mpegurl")) {
        el.addEventListener(
          "loadedmetadata",
          () => {
            if (Number.isFinite(el.duration)) {
              seekTarget = previewStart(el.duration);
              session.windowLen = Math.min(PREVIEW_SECONDS, Math.max(1, el.duration));
            }
            begin();
          },
          { once: true },
        );
        el.addEventListener("error", () => {
          const fallback = aggregatorFallback(el.src);
          if (!settled && fallback) {
            el.src = fallback; // not on the CDN: retry once from the aggregator
            return;
          }
          if (!settled) fail("Couldn't load this track's audio. Check your connection.");
          else if (this.session === session) this.die(session, "The stream dropped out.");
        });
        el.src = url;
      } else {
        fail("This browser can't stream the record's audio.");
      }
    });
  }

  /** Window clock: media time for HLS (pauses while buffering), ctx time for synth. */
  private elapsed(session: Session): number {
    if (session.el) return session.el.currentTime - session.windowStart;
    return audioContext().currentTime - session.windowStart;
  }

  private tick(session: Session): void {
    if (this.session !== session) return;
    const elapsed = Math.max(0, this.elapsed(session));
    const len = session.windowLen;
    this.onProgress?.(Math.min(elapsed, len), len);
    if (!session.fadingOut && elapsed >= len - FADE_OUT) {
      session.fadingOut = true;
      const t = audioContext().currentTime;
      const remaining = Math.max(0.1, len - elapsed);
      session.envelope.gain.cancelScheduledValues(t);
      session.envelope.gain.setValueAtTime(session.envelope.gain.value, t);
      session.envelope.gain.linearRampToValueAtTime(0, t + remaining);
    }
    if (elapsed >= len) this.finish(session);
  }

  /** Natural end of the preview window. */
  private finish(session: Session): void {
    if (this.session !== session) return;
    this.session = null;
    this.gen++;
    this.teardown(session);
    this.onEnded?.();
  }

  private die(session: Session, message: string): void {
    if (this.session !== session) return;
    this.session = null;
    this.gen++;
    this.teardown(session);
    this.onError?.(new Error(message));
  }

  /** Fade the current session out over STOP_FADE, then release it. */
  private stopCurrent(): void {
    const session = this.session;
    if (!session) return;
    this.session = null;
    const t = audioContext().currentTime;
    const g = session.envelope.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + STOP_FADE);
    clearInterval(session.timer);
    setTimeout(() => this.teardown(session), STOP_FADE * 1000 + 30);
  }

  private teardown(session: Session): void {
    session.cancel?.();
    clearInterval(session.timer);
    session.synth?.stop();
    session.hls?.destroy();
    session.hls = undefined;
    if (session.el) {
      session.el.pause();
      session.el.removeAttribute("src");
      session.el.load();
    }
    session.source?.disconnect();
    session.envelope.disconnect();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function superseded(): Error {
  const error = new Error("Playback was interrupted.");
  error.name = "AbortError";
  return error;
}
