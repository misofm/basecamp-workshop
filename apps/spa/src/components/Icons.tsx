// Small inline SVG icons (no icon font, no emoji: they look the same on every OS).

function Svg({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export const PlayIcon = () => <Svg d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />;
export const PauseIcon = () => <Svg d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />;
export const PrevIcon = () => <Svg d="M6 5h2v14H6zM20 5.5v13a.8.8 0 0 1-1.2.7L9.5 12.7a.8.8 0 0 1 0-1.4l9.3-6.5a.8.8 0 0 1 1.2.7z" />;
export const NextIcon = () => <Svg d="M16 5h2v14h-2zM4 5.5v13a.8.8 0 0 0 1.2.7l9.3-6.5a.8.8 0 0 0 0-1.4L5.2 4.8A.8.8 0 0 0 4 5.5z" />;
export const ChevronIcon = () => <Svg d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z" />;

/** Animated bars shown next to the track that is playing. */
export function Equalizer({ animate }: { animate: boolean }) {
  return (
    <span className={animate ? "equalizer playing" : "equalizer"} aria-label="Now playing">
      <span />
      <span />
      <span />
    </span>
  );
}
