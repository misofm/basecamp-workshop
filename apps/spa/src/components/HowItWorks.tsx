import { useEffect, useRef } from "react";
import { MISO_API, MISO_CDN, SUI_GRAPHQL, WALRUS_AGGREGATOR } from "../config";
import { shortId } from "../lib/media";
import { useRequestLog, type LoggedRequest } from "../lib/requestLog";

const ENDPOINTS = [
  `POST ${SUI_GRAPHQL}  (objects of type Release)`,
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
];

function statusClass(entry: LoggedRequest) {
  if (entry.status === null) return entry.kind === "media" ? "" : "status-bad";
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
            <strong>Sui GraphQL</strong> finds every Release object on chain.
          </li>
          <li>
            <strong>The Miso read API</strong> returns the release, credits, artist, pressings and wallet
            records as JSON.
          </li>
          <li>
            <strong>cdn.miso.fm</strong> streams covers and audio (HLS) for media Miso uploaded itself. Anything else
            falls back to the public Walrus aggregator.
          </li>
        </ol>

        <p className="big-line">
          No API key. No signup. No backend. Every request below went straight from your browser.
        </p>

        <h3>Endpoints</h3>
        <ul className="endpoints">
          {ENDPOINTS.map((endpoint) => (
            <li key={endpoint}>
              <code>{endpoint}</code>
            </li>
          ))}
        </ul>

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
              </li>
            );
          })}
        </ul>
      </aside>
    </div>
  );
}
