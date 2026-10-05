import { useEffect, useState, type DependencyList } from "react";

type AsyncState<T> = { data?: T; error?: Error; loading: boolean };

/** Run an async function when `deps` change; exposes { data, error, loading, retry }. */
export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList) {
  const [state, setState] = useState<AsyncState<T>>({ loading: true });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false; // ignore results that arrive after the deps changed
    setState({ loading: true });
    fn().then(
      (data) => !cancelled && setState({ data, loading: false }),
      (error: Error) => !cancelled && setState({ error, loading: false }),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);

  return { ...state, retry: () => setAttempt((n) => n + 1) };
}
