import { logRequest } from "./requestLog";

// A thin fetch wrapper. Three jobs:
// 1. cache responses in memory (the API allows ~300 requests/min per IP, so fetch each URL once),
// 2. treat 404 as "no such thing" (null) instead of an exception where callers expect it,
// 3. record every request in the request log.

export class HttpError extends Error {
  constructor(public status: number, url: string) {
    super(`HTTP ${status} for ${url}`);
  }
}

// Keyed by URL (+ body for POST). Storing the promise also de-duplicates in-flight requests.
const cache = new Map<string, Promise<unknown>>();

async function send(method: "GET" | "POST", url: string, body?: unknown): Promise<unknown> {
  const started = performance.now();
  let status: number | null = null;
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    status = res.status;
    if (res.status === 404) return null;
    if (!res.ok) throw new HttpError(res.status, url);
    return await res.json();
  } finally {
    logRequest({ method, url, status, ms: Math.round(performance.now() - started), kind: "api" });
  }
}

function cached(key: string, method: "GET" | "POST", url: string, body?: unknown) {
  const hit = cache.get(key);
  if (hit) {
    logRequest({ method, url, status: 200, ms: 0, kind: "api", cached: true });
    return hit;
  }
  const promise = send(method, url, body);
  cache.set(key, promise);
  promise.catch(() => cache.delete(key)); // a failed request should be retryable
  return promise;
}

/** GET a JSON resource; resolves to null on 404. */
export function getJsonOrNull<T>(url: string, options = { cache: true }): Promise<T | null> {
  const promise = options.cache ? cached(url, "GET", url) : send("GET", url);
  return promise as Promise<T | null>;
}

/** GET a JSON resource that must exist; a 404 becomes an HttpError. */
export async function getJson<T>(url: string, options = { cache: true }): Promise<T> {
  const data = await getJsonOrNull<T>(url, options);
  if (data === null) throw new HttpError(404, url);
  return data;
}

/** POST a JSON body (used for GraphQL queries, which are read-only, so caching is safe). */
export async function postJson<T>(url: string, body: unknown, options = { cache: true }): Promise<T> {
  const data = options.cache ? await cached(url + JSON.stringify(body), "POST", url, body) : await send("POST", url, body);
  if (data === null) throw new HttpError(404, url);
  return data as T;
}
