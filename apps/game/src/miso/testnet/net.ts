/**
 * Small network helpers shared by the testnet modules: timeouts and JSON fetch.
 *
 * Owns: TimeoutError and the `withTimeout` / `fetchJson` wrappers.
 * Must not: know about game types or Sui SDK internals.
 */

export class TimeoutError extends Error {
  constructor(what: string, ms: number) {
    super(`${what} timed out after ${ms} ms`);
    this.name = "TimeoutError";
  }
}

/** Reject with TimeoutError if `promise` takes longer than `ms` (the work itself is not cancelled). */
export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(what, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
    this.name = "HttpError";
  }
}

/** GET/POST JSON with a timeout. Non-2xx → HttpError (body parsed as JSON when possible). */
export async function fetchJson<T>(url: string, init: RequestInit & { timeoutMs: number }): Promise<T> {
  const { timeoutMs, ...rest } = init;
  const res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) throw new HttpError(res.status, body, url);
  return body as T;
}
