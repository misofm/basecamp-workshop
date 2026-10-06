import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { getListing, getPressings } from "../lib/miso";
import type { Listing } from "../lib/types";
import { useAsync } from "../lib/useAsync";
import type { Row } from "./BuyPanel";

const BuyPanel = lazy(() => import("./BuyPanel"));

function formatPrice(listing: Listing) {
  const amount = Number(listing.pricing.amount) / 10 ** listing.currency.decimals;
  const price = `${amount.toFixed(2)} FakeUSD`;
  return listing.pricing.kind === "floor" ? `from ${price}` : price;
}

async function loadRows(releaseId: string, fresh = false): Promise<Row[]> {
  const pressings = await getPressings(releaseId, fresh);
  return Promise.all(pressings.map(async (pressing) => ({ pressing, listing: await getListing(pressing.id, fresh) })));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The release's vinyl-style pressings and their price, plus a Buy button for the next available edition. */
export function RecordBox({ releaseId }: { releaseId: string }) {
  const { data: initial } = useAsync(() => loadRows(releaseId), [releaseId]);
  // Fresh rows after a purchase (or a failed fresh check) replace the first, cached read.
  const [updated, setUpdated] = useState<{ releaseId: string; rows: Row[] } | null>(null);
  const rows = updated?.releaseId === releaseId ? updated.rows : initial;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Re-read with fresh API calls; after a purchase, retry every 2 s (up to 30 s) until the indexer shows it. */
  async function refresh(until?: { edition: number; minSupply: number }) {
    for (let attempt = 0; attempt < 15; attempt++) {
      const fresh = await loadRows(releaseId, true).catch(() => null);
      if (!mounted.current) return;
      if (fresh) setUpdated({ releaseId, rows: fresh });
      const row = fresh?.find((r) => r.pressing.edition === until?.edition);
      if (fresh && (!until || (row && row.pressing.supply >= until.minSupply))) return;
      await sleep(2000);
    }
  }

  if (!rows || rows.length === 0) return null;

  return (
    <section className="record-box">
      <h3>Own the record</h3>
      {rows.map(({ pressing, listing }) => (
        <div key={pressing.id} className="record-row">
          <span className="record-edition">Edition {pressing.edition}</span>
          {listing && <span className="record-price">{formatPrice(listing)}</span>}
          <span className="muted">
            {pressing.supply} / {pressing.maxSupply} pressed
          </span>
          {listing?.state === "disabled" && <span className="tag">Listing paused</span>}
        </div>
      ))}
      {rows.some((row) => row.listing) && (
        <Suspense
          fallback={
            <div className="buy-panel">
              <button className="button" disabled>
                Buy
              </button>
            </div>
          }
        >
          <BuyPanel releaseId={releaseId} rows={rows} onRefresh={refresh} />
        </Suspense>
      )}
    </section>
  );
}
