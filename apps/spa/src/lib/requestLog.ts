import { useSyncExternalStore } from "react";
import { MISO_CDN, WALRUS_AGGREGATOR } from "../config";

// A tiny global store of every network request the app made, shown live in the "How this works" drawer.

export type LoggedRequest = {
  id: number;
  method: string;
  url: string;
  status: number | null; // null = network error or unknown (media timing without status)
  ms: number;
  kind: "api" | "media";
  cached?: boolean;
};

const MAX_ENTRIES = 200;
let entries: LoggedRequest[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

export function logRequest(entry: Omit<LoggedRequest, "id">) {
  // Newest first; replace the array so React sees a new snapshot.
  entries = [{ ...entry, id: nextId++ }, ...entries].slice(0, MAX_ENTRIES);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRequestLog() {
  return useSyncExternalStore(subscribe, () => entries);
}

// Covers and audio are loaded by <img> and hls.js, not by our fetch wrapper,
// so we pick them up from the browser's Resource Timing API instead.
export function observeMediaRequests() {
  const mediaHosts = [new URL(MISO_CDN).host, new URL(WALRUS_AGGREGATOR).host];
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
      if (!mediaHosts.includes(new URL(entry.name).host)) continue;
      logRequest({
        method: "GET",
        url: entry.name,
        status: entry.responseStatus || null,
        ms: Math.round(entry.duration),
        kind: "media",
      });
    }
  });
  observer.observe({ type: "resource", buffered: true });
}
