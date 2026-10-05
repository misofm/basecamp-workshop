import { useState } from "react";
import { getLyrics } from "../lib/miso";
import { formatTime, trackDurationSeconds } from "../lib/media";
import type { Release } from "../lib/types";
import { useAsync } from "../lib/useAsync";
import { usePlayer } from "../player/PlayerProvider";
import { CreditList } from "./CreditList";
import { ChevronIcon, Equalizer, PlayIcon } from "./Icons";

type Props = { release: Release; index: number };

export function TrackRow({ release, index }: Props) {
  const player = usePlayer();
  const [expanded, setExpanded] = useState(false);
  const track = release.tracks[index];
  const isCurrent = player.current?.release.id === release.id && player.current.index === index;
  const credits = release.trackCredits?.[track.recording.id];

  return (
    <li className={isCurrent ? "track current" : "track"}>
      <div className="track-main">
        <button
          className="track-play"
          onClick={() => (isCurrent ? player.toggle() : player.playRelease(release, index))}
          aria-label={isCurrent && player.playing ? `Pause ${track.title}` : `Play preview of ${track.title}`}
        >
          <span className="track-no">{isCurrent ? <Equalizer animate={player.playing} /> : track.no}</span>
          <span className="track-icon">
            <PlayIcon />
          </span>
          <span className="track-title">{track.title}</span>
          <span className="track-duration">{formatTime(trackDurationSeconds(track))}</span>
        </button>
        <button
          className={expanded ? "icon-button expand open" : "icon-button expand"}
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-label={`Credits and lyrics for ${track.title}`}
        >
          <ChevronIcon />
        </button>
      </div>
      {expanded && (
        <div className="track-details">
          <div className="track-credits">
            <CreditList title="Recording" credits={credits?.recordingCredits.credits ?? []} />
            <CreditList title="Composition" credits={credits?.compositionCredits ?? []} />
          </div>
          <TrackLyrics compositionId={track.composition.id} />
        </div>
      )}
    </li>
  );
}

// Lyrics stay collapsed until asked for (they can be explicit, and this app is shown on stage),
// so they are fetched only after the button is pressed.
function TrackLyrics({ compositionId }: { compositionId: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="lyrics">
      <h4>Lyrics</h4>
      {shown ? (
        <LyricsText compositionId={compositionId} />
      ) : (
        <button className="text-button" onClick={() => setShown(true)}>
          Show lyrics
        </button>
      )}
    </div>
  );
}

function LyricsText({ compositionId }: { compositionId: string }) {
  const { data, loading, error } = useAsync(() => getLyrics(compositionId), [compositionId]);
  if (loading) return <p className="muted">Loading lyrics…</p>;
  if (error) return <p className="muted">Could not load lyrics.</p>;
  if (!data?.[0]) return <p className="muted">No lyrics published.</p>;
  return <p className="lyrics-text">{data[0].text}</p>;
}
