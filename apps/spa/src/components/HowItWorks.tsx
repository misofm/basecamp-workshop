import { useEffect, useRef } from "react";
import {
  FAKEUSD_FAUCET_PACKAGE,
  MISO_API,
  MISO_CDN,
  RECORD_SHOP_PACKAGE,
  SUI_FULLNODE,
  SUI_GRAPHQL,
  WALRUS_AGGREGATOR,
} from "../config";
import { RELEASES_QUERY } from "../lib/sui";
import { shortId } from "../lib/media";
import { useRequestLog, type LoggedRequest } from "../lib/requestLog";

const ENDPOINTS = [
  `POST ${SUI_GRAPHQL}  (every Release object; polled every 15 s)`,
  `GET  ${MISO_API}/protocol/releases/{id}?include=trackCredits`,
  `GET  ${MISO_API}/compositions/{id}/lyrics`,
  `GET  ${MISO_API}/platform/artists/{id}`,
  `GET  ${MISO_API}/platform/pressings/{id}`,
  `GET  ${MISO_API}/platform/pressings/{id}/listing?currencyType={type}`,
  `GET  ${MISO_API}/platform/wallets/{address}/records`,
  `GET  ${MISO_CDN}/blobs/{blobId}?w=512&f=webp`,
  `GET  ${MISO_CDN}/blobs/by-quilt-id/{quiltId}/aac-96.m3u8`,
  `GET  ${WALRUS_AGGREGATOR}/blobs/{blobId}  (fallback when the CDN 404s)`,
  `GET  ${WALRUS_AGGREGATOR}/blobs/by-quilt-id/{quiltId}/aac-96.m3u8  (fallback)`,
  `POST ${SUI_FULLNODE}  (gRPC-web: balances, simulate, transaction status; wallet only)`,
];

// The only two Move functions a wallet is ever asked to call.
const MOVE_CALLS = [
  `${RECORD_SHOP_PACKAGE}::listing::purchase`,
  `${FAKEUSD_FAUCET_PACKAGE}::faucet::mint`,
];

function statusClass(entry: LoggedRequest) {
  if (entry.status === null) return entry.kind === "api" ? "status-bad" : "";
  // 404 is an expected answer here ("no such pressing"), so it is shown neutral, not as an error.
  if (entry.status === 404) return "status-neutral";
  return entry.status >= 400 ? "status-bad" : "status-ok";
}

export function HowItWorks({ onClose }: { onClose: () => void }) {
  const log = useRequestLog();
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="drawer-header">
          <h2 id="drawer-title">How this works</h2>
          <button ref={closeButton} className="icon-button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <ol className="steps">
          <li>
            <strong>Sui GraphQL</strong> lists every Release object on the chain (the query is below).
          </li>
          <li>
            <strong>The Miso read API</strong> returns the release, credits, artist, pressings and wallet
            records as JSON.
          </li>
          <li>
            <strong>cdn.miso.fm</strong> streams covers and audio (HLS) for media Miso uploaded itself. Anything else
            falls back to the public Walrus aggregator.
          </li>
          <li>
            <strong>Buying a record and the faucet are the only writes:</strong> your wallet signs a transaction
            that calls the record shop's <code>listing::purchase</code> or the FakeUSD <code>faucet::mint</code> Move
            function. The app simulates it first (gas, sold out) and never sees a key.
          </li>
        </ol>

        <p className="big-line">
          No API key. No signup. No backend. Reading needs no wallet. Every request below went straight from your
          browser.
        </p>

        <h3>Endpoints</h3>
        <ul className="endpoints">
          {ENDPOINTS.map((endpoint) => (
            <li key={endpoint}>
              <code>{endpoint}</code>
            </li>
          ))}
        </ul>

        <h3>Move calls (signed by your wallet)</h3>
        <ul className="endpoints">
          {MOVE_CALLS.map((target) => (
            <li key={target}>
              <code>{target}</code>
            </li>
          ))}
        </ul>

        <h3>GraphQL query</h3>
        <pre className="gql">
          <code>{RELEASES_QUERY}</code>
        </pre>

        <h3>Live request log</h3>
        <ul className="request-log">
          {log.map((entry) => {
            const url = new URL(entry.url);
            return (
              <li key={entry.id}>
                <span className="log-method">{entry.method}</span>
                <span className={`log-status ${statusClass(entry)}`}>{entry.status ?? "—"}</span>
                <span className="log-ms">{entry.ms} ms</span>
                <span className="log-url" title={entry.url}>
                  {shortId(url.host + url.pathname)}
                </span>
                {entry.cached && <span className="tag">cached</span>}
                {entry.kind === "media" && <span className="tag">media</span>}
                {entry.kind === "rpc" && <span className="tag">wallet</span>}
              </li>
            );
          })}
        </ul>
      </aside>
    </div>
  );
}
