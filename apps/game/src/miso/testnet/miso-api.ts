/**
 * Keyless Miso API client (api.testnet.miso.fm, CORS *, ~300 req/min/IP) with an
 * in-memory cache so the game makes a handful of requests per session.
 *
 * Owns: response shapes we rely on and the cache (releases forever, pressings/listings
 * for a short TTL; in-flight requests are shared).
 * Must not: talk to the chain or know game types.
 */
import { FUSD_TYPE, MISO_API, READ_TIMEOUT_MS } from "./config";
import { HttpError, fetchJson } from "./net";

export interface ApiRelease {
  id: string;
  title: string;
  description?: string | null;
  publishedAtMs?: number | null;
  cover?: { still?: { kind: string; blobId: string } | null } | null;
  credits?: { partyId: string; displayName: string; roles: string[] }[];
  primaryArtists?: string[];
  genres?: string[];
  /** Per-recording credits (requested with include=trackCredits). */
  trackCredits?: Record<string, { recordingCredits?: { credits?: { displayName: string; roles: string[] }[] } }>;
  tracks?: {
    no: string | number;
    title: string;
    transcodeQuiltId?: string | null;
    master?: { sample_rate_hz?: number; samples?: string | number } | null;
  }[];
}

export interface ApiPressing {
  id: string;
  releaseId: string;
  edition: number;
  supply: number;
  maxSupply: number;
}

export interface ApiListing {
  id: string;
  pressingId: string;
  releaseId: string;
  pricing: { kind: "floor" | "fixed"; amount: string };
  currency: { type: string; symbol: string; decimals: number };
  state: "enabled" | "disabled";
}

const PRESSING_TTL_MS = 15_000;
const cache = new Map<string, { at: number; value: Promise<unknown> }>();

function cached<T>(url: string, ttlMs: number, notFoundAsNull: boolean): Promise<T | null> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T | null>;
  const value = fetchJson<T>(url, { timeoutMs: READ_TIMEOUT_MS }).catch((error: unknown) => {
    if (notFoundAsNull && error instanceof HttpError && error.status === 404) return null;
    cache.delete(url); // never cache failures
    throw error;
  });
  cache.set(url, { at: Date.now(), value });
  return value;
}

export function getRelease(releaseId: string): Promise<ApiRelease | null> {
  return cached<ApiRelease>(`${MISO_API}/protocol/releases/${releaseId}?include=trackCredits`, Infinity, true);
}

export function getPressing(pressingId: string, fresh = false): Promise<ApiPressing | null> {
  return cached<ApiPressing>(`${MISO_API}/platform/pressings/${pressingId}`, fresh ? 0 : PRESSING_TTL_MS, true);
}

export function getListing(pressingId: string, fresh = false): Promise<ApiListing | null> {
  return cached<ApiListing>(
    `${MISO_API}/platform/pressings/${pressingId}/listing?currencyType=${encodeURIComponent(FUSD_TYPE)}`,
    fresh ? 0 : PRESSING_TTL_MS,
    true,
  );
}
