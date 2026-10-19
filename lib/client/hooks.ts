"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, errorText } from "./api";

export type Loadable<T> = { data: T | null; error: string | null; loading: boolean; reload: () => Promise<void> };

/** Keep a ref pointing at the latest value (updated after render, never during it). */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/** Load JSON from an API route; optionally poll while `pollMs` is set. */
export function useApi<T>(path: string | null, pollMs?: number | null): Loadable<T> & { setData: (d: T) => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedPath, setLoadedPath] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    api<T>(path).then(
      (d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
        setLoadedPath(path);
      },
      (e) => {
        if (cancelled) return;
        setError(errorText(e));
        setLoadedPath(path);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [path, tick]);

  useEffect(() => {
    if (!path || !pollMs) return;
    const t = setInterval(() => setTick((x) => x + 1), pollMs);
    return () => clearInterval(t);
  }, [path, pollMs]);

  const reload = useCallback(async () => {
    if (!path) return;
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [path]);

  return { data, error, loading: !!path && loadedPath !== path, reload, setData };
}

/** Debounce a callback. `flush()` runs a pending call immediately. */
export function useDebouncedCallback<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  const fnRef = useLatest(fn);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<A | null>(null);
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (pending.current) {
      const args = pending.current;
      pending.current = null;
      fnRef.current(...args);
    }
  }, [fnRef]);
  const call = useCallback(
    (...args: A) => {
      pending.current = args;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, ms);
    },
    [ms, flush],
  );
  useEffect(() => () => flush(), [flush]);
  return { call, flush };
}
