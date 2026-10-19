"use client";

import { useSyncExternalStore } from "react";

/** Tiny external store for the playhead so only time-aware components re-render every frame. */
export type Clock = {
  get: () => number;
  set: (t: number) => void;
  subscribe: (fn: () => void) => () => void;
};

export function createClock(): Clock {
  let t = 0;
  const subs = new Set<() => void>();
  return {
    get: () => t,
    set: (v) => {
      t = v;
      subs.forEach((f) => f());
    },
    subscribe: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

export function useClockTime(clock: Clock, quantize = 0): number {
  return useSyncExternalStore(
    clock.subscribe,
    () => (quantize ? Math.round(clock.get() / quantize) * quantize : clock.get()),
    () => 0,
  );
}
