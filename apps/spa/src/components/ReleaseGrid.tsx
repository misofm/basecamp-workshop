import type { Release } from "../lib/types";
import { ReleaseCard } from "./ReleaseCard";

type Props = { releases?: Release[]; loading?: boolean; emptyText?: string; fresh?: ReadonlySet<string> };

export function ReleaseGrid({ releases, loading, emptyText = "Nothing here yet.", fresh }: Props) {
  if (loading) {
    return (
      <div className="grid" aria-busy="true" aria-label="Loading releases">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="card skeleton-card">
            <div className="cover skeleton" />
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line short" />
          </div>
        ))}
      </div>
    );
  }
  if (!releases || releases.length === 0) return <p className="muted">{emptyText}</p>;
  return (
    <div className="grid">
      {releases.map((release) => (
        <ReleaseCard key={release.id} release={release} isNew={fresh?.has(release.id)} />
      ))}
    </div>
  );
}
