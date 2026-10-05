import { Link } from "react-router";
import { artistNames } from "../lib/miso";
import { coverFallback, coverUrl, formatKind } from "../lib/media";
import type { Release } from "../lib/types";

export function ReleaseCard({ release }: { release: Release }) {
  const cover = coverUrl(release);
  return (
    <Link to={`/release/${release.id}`} className="card">
      <div className="cover">{cover && <img src={cover} alt={`Cover of ${release.title}`} loading="lazy" onError={coverFallback} />}</div>
      <div className="card-title" title={release.title}>
        {release.title}
      </div>
      <div className="card-meta">
        {artistNames(release)} · {formatKind(release.kind)}
      </div>
    </Link>
  );
}
