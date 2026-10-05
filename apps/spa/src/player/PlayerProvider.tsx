import Hls from "hls.js/light";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { FADE_IN_SECONDS, FADE_OUT_SECONDS, PREVIEW_SECONDS, WALRUS_AGGREGATOR } from "../config";
import { hlsUrl, trackDurationSeconds } from "../lib/media";
import type { Release } from "../lib/types";

// One <audio> element for the whole app, so playback survives page navigation.
// Each track plays a 30 s preview window from the middle of the song, with a fade in and out.

type Current = { release: Release; index: number };

type Player = {
  current: Current | null;
  playing: boolean;
  loading: boolean;
  error: string | null;
  position: number; // seconds into the preview window
  length: number; // length of the preview window in seconds
  playRelease: (release: Release, trackIndex: number) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (secondsIntoPreview: number) => void;
};

const PlayerContext = createContext<Player | null>(null);

export function usePlayer() {
  const player = useContext(PlayerContext);
  if (!player) throw new Error("usePlayer must be used inside <PlayerProvider>");
  return player;
}

function previewWindow(durationSeconds: number) {
  const start = Math.max(0, durationSeconds / 2 - PREVIEW_SECONDS / 2);
  return { start, end: Math.min(durationSeconds, start + PREVIEW_SECONDS) };
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [current, setCurrent] = useState<Current | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState(0);

  const track = current ? current.release.tracks[current.index] : null;
  const preview = track ? previewWindow(trackDurationSeconds(track)) : { start: 0, end: 0 };

  function play(audio: HTMLAudioElement) {
    // play() returns a promise that rejects e.g. when autoplay is blocked or the source fails.
    audio.play().catch((err: Error) => {
      if (err.name === "AbortError") return; // interrupted by a newer load, not a real error
      setLoading(false);
      setError("Playback was blocked or failed.");
    });
  }

  function playRelease(release: Release, index: number) {
    const audio = audioRef.current;
    const nextTrack = release.tracks[index];
    if (!audio || !nextTrack) return;
    const { start } = previewWindow(trackDurationSeconds(nextTrack));

    hlsRef.current?.destroy();
    hlsRef.current = null;
    audio.volume = 0; // the fade loop raises it
    setCurrent({ release, index });
    setPosition(0);
    setError(null);
    setLoading(true);

    if (Hls.isSupported()) {
      // Chrome, Firefox, Edge: hls.js feeds the stream into the <audio> element via Media Source Extensions.
      const hls = new Hls({ startPosition: start });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        // The CDN does not host this track: retry once from the Walrus aggregator.
        // Segment URLs in the playlist are relative, so switching the playlist URL is enough.
        const fallback = hlsUrl(nextTrack, WALRUS_AGGREGATOR);
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && hls.url !== fallback) {
          hls.loadSource(fallback); // this new load interrupts the pending play(), so play again
          hls.once(Hls.Events.MANIFEST_PARSED, () => play(audio));
          return;
        }
        hls.destroy();
        setLoading(false);
        setPlaying(false);
        setError("Could not load this track.");
      });
      hls.loadSource(hlsUrl(nextTrack));
      hls.attachMedia(audio);
      hlsRef.current = hls;
    } else if (audio.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari plays HLS natively.
      audio.src = hlsUrl(nextTrack);
      audio.addEventListener("loadedmetadata", () => (audio.currentTime = start), { once: true });
      audio.onerror = () => {
        audio.onerror = null; // once: retry from the Walrus aggregator
        audio.src = hlsUrl(nextTrack, WALRUS_AGGREGATOR);
        play(audio);
      };
    }
    play(audio);
  }

  function stop() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = preview.start; // so pressing play again restarts the preview
    setPosition(0);
  }

  function next() {
    if (!current) return;
    if (current.index + 1 < current.release.tracks.length) playRelease(current.release, current.index + 1);
    else stop(); // end of the release
  }

  function prev() {
    if (!current) return;
    if (position > 3 || current.index === 0) seek(0);
    else playRelease(current.release, current.index - 1);
  }

  function toggle() {
    const audio = audioRef.current;
    if (!audio || !current) return;
    if (audio.paused) play(audio);
    else audio.pause();
  }

  function seek(secondsIntoPreview: number) {
    const audio = audioRef.current;
    if (!audio) return;
    const clamped = Math.min(Math.max(0, secondsIntoPreview), preview.end - preview.start);
    audio.currentTime = preview.start + clamped;
    setPosition(clamped);
  }

  // While playing: every animation frame, set the volume for the fades,
  // update the position and move on when the preview window ends.
  useEffect(() => {
    const audio = audioRef.current;
    if (!playing || !audio) return;
    let frame = 0;
    const tick = () => {
      const t = audio.currentTime;
      const fadeIn = (t - preview.start) / FADE_IN_SECONDS;
      const fadeOut = (preview.end - t) / FADE_OUT_SECONDS;
      audio.volume = Math.min(1, Math.max(0, Math.min(fadeIn, fadeOut)));
      // Round to a quarter second so React re-renders ~4x per second, not 60x.
      setPosition(Math.max(0, Math.floor((t - preview.start) * 4) / 4));
      if (t >= preview.end) next();
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, current]);

  // Space bar toggles playback, unless the user is typing or on a button.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || !current) return;
      if (event.target instanceof Element && event.target.closest("input, textarea, select, button, a")) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const player: Player = {
    current,
    playing,
    loading,
    error,
    position,
    length: preview.end - preview.start,
    playRelease,
    toggle,
    next,
    prev,
    seek,
  };

  return (
    <PlayerContext.Provider value={player}>
      {children}
      <audio
        ref={audioRef}
        onPlaying={() => {
          setPlaying(true);
          setLoading(false);
        }}
        onPause={() => setPlaying(false)}
        onWaiting={() => setLoading(true)}
      />
    </PlayerContext.Provider>
  );
}
