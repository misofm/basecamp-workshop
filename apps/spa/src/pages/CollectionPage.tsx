import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { ErrorMessage } from "../components/ErrorMessage";
import { RecordCard } from "../components/RecordCard";
import { EXAMPLE_COLLECTOR } from "../config";
import { getWalletRecords } from "../lib/miso";
import type { WalletRecord } from "../lib/types";
import { shortAddress, useWallet } from "../wallet/store";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{1,64}$/;
const REFRESH_MS = 10_000;

export function CollectionPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const wallet = useWallet();
  const typedAddress = searchParams.get("address") ?? "";
  // No ?address but a connected wallet: show the wallet's own records.
  const address = typedAddress || wallet.address || "";
  const isValid = ADDRESS_PATTERN.test(address);
  const isOwn = Boolean(wallet.address) && address.toLowerCase() === wallet.address?.toLowerCase();

  const [draft, setDraft] = useState(typedAddress);
  // Results are tagged with their address so we never show another wallet's records.
  const [result, setResult] = useState<{ address: string; records: WalletRecord[] } | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [freshIds, setFreshIds] = useState<string[]>([]);
  const [refreshCount, setRefreshCount] = useState(0);
  const seenIds = useRef(new Map<string, Set<string>>()); // address -> record ids already shown

  useEffect(() => setDraft(typedAddress), [typedAddress]);

  // Load the wallet's records, then poll every 10 s while the tab is visible,
  // so records bought elsewhere (e.g. inside the game) show up live.
  useEffect(() => {
    if (!isValid) return;
    let cancelled = false;

    async function refresh() {
      try {
        const records = await getWalletRecords(address);
        if (cancelled) return;
        const seen = seenIds.current.get(address);
        if (seen) setFreshIds(records.filter((record) => !seen.has(record.id)).map((record) => record.id));
        seenIds.current.set(address, new Set(records.map((record) => record.id)));
        setResult({ address, records });
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err as Error);
      }
    }

    refresh();
    const timer = setInterval(() => document.visibilityState === "visible" && refresh(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [address, isValid, refreshCount, wallet.recordsVersion]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSearchParams({ address: draft.trim() });
  }

  const records = result?.address === address ? result.records : null;
  const sorted = records?.toSorted((a, b) => Number(b.purchasedTimestampMs) - Number(a.purchasedTimestampMs));
  const draftInvalid = draft.trim() !== "" && !ADDRESS_PATTERN.test(draft.trim());

  return (
    <>
      <section className="page-intro">
        <h1>Collection</h1>
        <p className="lead">Records owned by any Sui wallet. Paste an address, or connect your wallet.</p>
      </section>

      <form className="address-form" onSubmit={onSubmit}>
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="0x… wallet address"
          aria-label="Wallet address"
          aria-invalid={draftInvalid}
          spellCheck={false}
        />
        <button className="button" type="submit" disabled={draftInvalid || draft.trim() === ""}>
          Show records
        </button>
      </form>
      {draftInvalid && <p className="field-error">That doesn't look like a Sui address (0x followed by hex).</p>}

      {!isValid && wallet.status !== "connecting" && (
        <div className="empty-state">
          <p className="lead">Enter a wallet address to see its records.</p>
          <Link to={`/collection?address=${EXAMPLE_COLLECTOR}`} className="button-secondary">Try an example wallet</Link>
        </div>
      )}

      {isValid && (
        <div className="collection-toolbar">
          {isOwn && (
            <span className="collection-owner">
              Your wallet <code>{shortAddress(address)}</code>
            </span>
          )}
          <span className="live">
            <span className="live-dot" /> Live · updates every 10 s
          </span>
          <button className="button-secondary" onClick={() => setRefreshCount((n) => n + 1)}>
            Refresh
          </button>
          {wallet.address && !isOwn && (
            <button className="button-secondary" onClick={() => setSearchParams({})}>
              Show my records
            </button>
          )}
        </div>
      )}

      {isValid && error && <ErrorMessage error={error} onRetry={() => setRefreshCount((n) => n + 1)} />}
      {isValid && !records && !error && <p className="muted">Loading records…</p>}
      {sorted?.length === 0 && (
        <div className="empty-state">
          <p className="lead">This wallet doesn't own any records yet.</p>
        </div>
      )}
      {sorted && sorted.length > 0 && (
        <div className="grid grid-large">
          {sorted.map((record) => (
            <RecordCard key={record.id} record={record} fresh={freshIds.includes(record.id)} />
          ))}
        </div>
      )}
    </>
  );
}
