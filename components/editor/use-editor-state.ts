"use client";

import { useCallback, useRef, useState } from "react";
import type { ProjectState } from "@/lib/shared/types";

type History = { past: ProjectState[]; present: ProjectState; future: ProjectState[] };

const MAX_HISTORY = 200;
const MERGE_WINDOW_MS = 900;

/**
 * Editor state with undo/redo. `commit(fn, mergeKey)` applies an immutable
 * update; consecutive commits with the same mergeKey (e.g. dragging a slider)
 * within a short window collapse into one undo step.
 */
export function useEditorState(initial: ProjectState) {
  const [history, setHistory] = useState<History>({ past: [], present: initial, future: [] });
  const lastMerge = useRef<{ key: string; at: number } | null>(null);
  const [version, setVersion] = useState(0);

  const commit = useCallback((fn: (s: ProjectState) => ProjectState, mergeKey?: string) => {
    setHistory((h) => {
      const next = fn(h.present);
      if (next === h.present) return h;
      const now = Date.now();
      const merge = mergeKey && lastMerge.current?.key === mergeKey && now - lastMerge.current.at < MERGE_WINDOW_MS;
      lastMerge.current = mergeKey ? { key: mergeKey, at: now } : null;
      return {
        past: merge ? h.past : [...h.past, h.present].slice(-MAX_HISTORY),
        present: next,
        future: [],
      };
    });
    setVersion((v) => v + 1);
  }, []);

  const undo = useCallback(() => {
    lastMerge.current = null;
    setHistory((h) => (h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h));
    setVersion((v) => v + 1);
  }, []);

  const redo = useCallback(() => {
    lastMerge.current = null;
    setHistory((h) => (h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h));
    setVersion((v) => v + 1);
  }, []);

  /** Replace state without an undo step (loading, server conflicts). */
  const reset = useCallback((s: ProjectState) => {
    lastMerge.current = null;
    setHistory({ past: [], present: s, future: [] });
  }, []);

  return {
    state: history.present,
    commit,
    undo,
    redo,
    reset,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    /** Increments on every user change; used to trigger autosave. */
    version,
  };
}

let counter = 0;
export function localId(prefix: string) {
  counter = (counter + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}
