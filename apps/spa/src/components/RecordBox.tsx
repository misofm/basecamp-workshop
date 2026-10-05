import { getListing, getPressings } from "../lib/miso";
import type { Listing } from "../lib/types";
import { useAsync } from "../lib/useAsync";

function formatPrice(listing: Listing) {
  const amount = Number(listing.pricing.amount) / 10 ** listing.currency.decimals;
  const price = `${amount.toFixed(2)} FakeUSD`;
  return listing.pricing.kind === "floor" ? `from ${price}` : price;
}

/** Read-only view of the release's vinyl-style pressings and their price. */
export function RecordBox({ releaseId }: { releaseId: string }) {
  const { data } = useAsync(async () => {
    const pressings = await getPressings(releaseId);
    return Promise.all(
      pressings.map(async (pressing) => ({ pressing, listing: await getListing(pressing.id) })),
    );
  }, [releaseId]);

  if (!data || data.length === 0) return null;

  return (
    <section className="record-box">
      <h3>Own the record</h3>
      {data.map(({ pressing, listing }) => (
        <div key={pressing.id} className="record-row">
          <span className="record-edition">Edition {pressing.edition}</span>
          {listing && <span className="record-price">{formatPrice(listing)}</span>}
          <span className="muted">
            {pressing.supply} / {pressing.maxSupply} pressed
          </span>
          {listing?.state === "disabled" && <span className="tag">Listing paused</span>}
        </div>
      ))}
    </section>
  );
}
