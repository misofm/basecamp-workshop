import { Link } from "react-router";
import { artistNames, getPressing, getRelease } from "../lib/miso";
import { coverFallback, coverUrl } from "../lib/media";
import type { WalletRecord } from "../lib/types";
import { useAsync } from "../lib/useAsync";

/** One owned record: the release (for cover and title) and pressing (for max supply) both come from the cache. */
export function RecordCard({ record, fresh }: { record: WalletRecord; fresh: boolean }) {
  const { data } = useAsync(
    () => Promise.all([getRelease(record.releaseId), getPressing(record.pressingId)]),
    [record.releaseId, record.pressingId],
  );
  const [release, pressing] = data ?? [];
  const cover = release ? coverUrl(release) : null;
  const purchased = new Date(Number(record.purchasedTimestampMs)).toLocaleDateString(undefined, {
    dateStyle: "medium",
  });

  return (
    <Link to={`/release/${record.releaseId}`} className={fresh ? "card record-card fresh" : "card record-card"}>
      <div className="cover">
        {cover && <img src={cover} alt={release ? `Cover of ${release.title}` : ""} onError={coverFallback} />}
        <span className="record-number">#{record.number}</span>
      </div>
      <div className="card-title">{release?.title ?? "Loading…"}</div>
      <div className="card-meta">{release ? artistNames(release) : " "}</div>
      <div className="card-meta">
        Edition {record.edition} · No. {record.number}
        {pressing && ` / ${pressing.maxSupply}`}
      </div>
      <div className="card-meta small">Purchased {purchased}</div>
    </Link>
  );
}
