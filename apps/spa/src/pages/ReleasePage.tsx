import { Link, useParams } from "react-router";
import { ErrorMessage } from "../components/ErrorMessage";
import { PlayIcon } from "../components/Icons";
import { RecordBox } from "../components/RecordBox";
import { TrackRow } from "../components/TrackRow";
import { getRelease, primaryArtists } from "../lib/miso";
import { coverFallback, coverUrl, formatKind, formatTime, trackDurationSeconds } from "../lib/media";
import { useAsync } from "../lib/useAsync";
import { usePlayer } from "../player/PlayerProvider";

export function ReleasePage() {
  const { id = "" } = useParams();
  const { data: release, loading, error, retry } = useAsync(() => getRelease(id), [id]);
  const player = usePlayer();

  if (loading) return <div className="release-hero skeleton-hero"><div className="cover skeleton" /></div>;
  if (error) return <ErrorMessage error={error} onRetry={retry} />;
  if (!release) return null;

  const cover = coverUrl(release, 1024);
  const year = new Date(release.publishedAtMs).getFullYear();
  const runtime = release.tracks.reduce((total, track) => total + trackDurationSeconds(track), 0);
  const trackCount = release.tracks.length;

  return (
    <>
      <section className="release-hero">
        <div className="cover cover-large">{cover && <img src={cover} alt={`Cover of ${release.title}`} onError={coverFallback} />}</div>
        <div className="release-info">
          <div className="eyebrow">
            {formatKind(release.kind)} · {year}
          </div>
          <h1>{release.title}</h1>
          {release.subtitle && <p className="subtitle">{release.subtitle}</p>}
          <p className="release-artists">
            {primaryArtists(release).map((artist, i) => (
              <span key={artist.name}>
                {i > 0 && ", "}
                {artist.partyId ? <Link to={`/artist/${artist.partyId}`}>{artist.name}</Link> : artist.name}
              </span>
            ))}
          </p>
          <div className="chips">
            {release.genres.map((genre) => (
              <span key={genre} className="chip static">
                {genre}
              </span>
            ))}
          </div>
          {release.description && <p className="description">{release.description}</p>}
          <div className="release-actions">
            <button className="button" onClick={() => player.playRelease(release, 0)} disabled={trackCount === 0}>
              <PlayIcon /> Play
            </button>
            <span className="muted">
              {trackCount} {trackCount === 1 ? "track" : "tracks"} · {formatTime(runtime)}
            </span>
          </div>
          <RecordBox releaseId={release.id} />
        </div>
      </section>

      <section>
        <h2>Tracklist</h2>
        <ol className="tracklist">
          {release.tracks.map((track, index) => (
            <TrackRow key={track.recording.id} release={release} index={index} />
          ))}
        </ol>
        <p className="muted small">Previews are 30 seconds from the middle of each track.</p>
      </section>
    </>
  );
}
