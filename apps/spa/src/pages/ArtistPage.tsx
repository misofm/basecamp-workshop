import { useState } from "react";
import { useParams } from "react-router";
import { ErrorMessage } from "../components/ErrorMessage";
import { ReleaseGrid } from "../components/ReleaseGrid";
import { allTrackCredits, getArtist, loadCatalog } from "../lib/miso";
import { useAsync } from "../lib/useAsync";

export function ArtistPage() {
  const { id = "" } = useParams();
  const { data, loading, error, retry } = useAsync(() => Promise.all([getArtist(id), loadCatalog()]), [id]);

  if (error) return <ErrorMessage error={error} onRetry={retry} />;
  if (loading || !data) return <ReleaseGrid loading />;
  const [artist, catalog] = data;

  // The artist's releases are worked out client-side from the (cached) catalog.
  const releases = catalog.filter((release) => release.credits.some((credit) => credit.partyId === id));
  const appearsOn = catalog.filter(
    (release) => !releases.includes(release) && allTrackCredits(release).some((credit) => credit.partyId === id),
  );

  // Releases may credit the artist under a stage name that differs from the party's name.
  const creditedName = [...releases, ...appearsOn]
    .flatMap((release) => [...release.credits, ...allTrackCredits(release)])
    .find((credit) => credit.partyId === id)?.displayName;
  const name = creditedName ?? artist.name;
  const bio = artist.bioLong ?? artist.bioShort;

  return (
    <>
      <section className="artist-hero">
        <Avatar url={artist.avatarUrl} name={name} />
        <div>
          <div className="eyebrow">{artist.kind === "group" ? "Group" : "Artist"}</div>
          <h1>{name}</h1>
          {name !== artist.name && <p className="muted">{artist.name}</p>}
          {bio && <p className="description">{bio}</p>}
          {artist.links.length > 0 && (
            <ul className="inline-list">
              {artist.links.map((link) => (
                <li key={link.url}>
                  <a href={link.url} target="_blank" rel="noreferrer">
                    {link.platform}
                  </a>
                </li>
              ))}
            </ul>
          )}
          {artist.members.length > 0 && (
            <p className="muted">Members: {artist.members.map((member) => member.name).join(", ")}</p>
          )}
        </div>
      </section>

      {(releases.length > 0 || appearsOn.length === 0) && (
        <>
          <h2>Releases</h2>
          <ReleaseGrid releases={releases} emptyText="No releases yet." />
        </>
      )}
      {appearsOn.length > 0 && (
        <>
          <h2>Appears on</h2>
          <ReleaseGrid releases={appearsOn} />
        </>
      )}
    </>
  );
}

function Avatar({ url, name }: { url: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  const initials = name
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  if (!url || failed) return <div className="avatar initials">{initials}</div>;
  return <img className="avatar" src={url} alt="" onError={() => setFailed(true)} />;
}
