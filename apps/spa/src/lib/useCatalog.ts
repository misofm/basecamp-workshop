import { useCallback, useEffect, useRef, useState } from "react";
import { POLL_MS } from "../config";
import { loadCatalog } from "./miso";
import type { Release } from "./types";

/**
 * The catalog, re-checked every POLL_MS while the tab is visible. At most one request round is in flight.
 * `fresh` holds ids that appeared after the first load. Releases themselves are cached per id (http.ts),
 * so a poll costs one GraphQL request plus one API call per *new* release.
 */
export function useCatalog() {
  const [releases, setReleases] = useState<Release[]>();
  const [error, setError] = useState<Error>();
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const known = useRef<Set<string> | null>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const next = await loadCatalog();
      const seen = known.current;
      if (seen) {
        const added = next.filter((release) => !seen.has(release.id)).map((release) => release.id);
        if (added.length > 0) setFresh((old) => new Set([...old, ...added]));
      }
      known.current = new Set(next.map((release) => release.id));
      setReleases(next);
      setError(undefined);
    } catch (e) {
      // keep showing what we have; only surface the error if there is nothing to show
      setError(e as Error);
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (timer || document.hidden) return;
      void refresh();
      timer = setInterval(() => void refresh(), POLL_MS);
    };
    const stop = () => {
      clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVisibility);
    start();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [refresh]);

  return { releases, error: releases ? undefined : error, loading: !releases && !error, retry: refresh, fresh };
}
