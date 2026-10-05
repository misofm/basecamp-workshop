import { Link } from "react-router";
import { artistNames } from "../lib/miso";
import { coverFallback, coverUrl, formatTime } from "../lib/media";
import { NextIcon, PauseIcon, PlayIcon, PrevIcon } from "../components/Icons";
import { usePlayer } from "./PlayerProvider";

export function PlayerBar() {
  const player = usePlayer();
  if (!player.current) return null; // hidden until something has been played

  const { release, index } = player.current;
  const track = release.tracks[index];
  const cover = coverUrl(release, 512);

  return (
    <div className="player-bar" role="region" aria-label="Player">
      <Link to={`/release/${release.id}`} className="player-track">
        {cover && <img src={cover} alt="" width={56} height={56} onError={coverFallback} />}
        <div className="player-text">
          <div className="player-title">{track.title}</div>
          <div className="player-artist">{player.error ?? artistNames(release)}</div>
        </div>
      </Link>

      <div className="player-controls">
        <button className="icon-button" onClick={player.prev} aria-label="Previous track">
          <PrevIcon />
        </button>
        <button
          className="icon-button play-button"
          onClick={player.toggle}
          aria-label={player.playing ? "Pause" : "Play"}
        >
          {player.loading ? <span className="spinner" /> : player.playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button className="icon-button" onClick={player.next} aria-label="Next track">
          <NextIcon />
        </button>
      </div>

      <div className="player-scrub">
        <span className="time">{formatTime(player.position)}</span>
        <input
          type="range"
          min={0}
          max={player.length}
          step={0.25}
          value={player.position}
          onChange={(event) => player.seek(Number(event.target.value))}
          aria-label="Seek within preview"
        />
        <span className="time">{formatTime(player.length)}</span>
        <span className="badge">Preview</span>
      </div>
    </div>
  );
}
