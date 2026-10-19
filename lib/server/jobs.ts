import "server-only";
import type { JobInfo } from "@/lib/shared/types";
import { newId, nowIso } from "./db";
import { errorMessage } from "./errors";

export class CancelledError extends Error {
  constructor() {
    super("Cancelled by user");
    this.name = "CancelledError";
  }
}

export type JobContext = {
  signal: AbortSignal;
  progress: (fraction: number, message?: string) => void;
  throwIfCancelled: () => void;
};

type JobEntry = JobInfo & { controller: AbortController };

type JobStore = { jobs: Map<string, JobEntry>; queues: Map<string, Promise<unknown>> };

function store(): JobStore {
  const g = globalThis as typeof globalThis & { __stickforgeJobs?: JobStore };
  if (!g.__stickforgeJobs) g.__stickforgeJobs = { jobs: new Map(), queues: new Map() };
  return g.__stickforgeJobs;
}

function publicInfo(j: JobEntry): JobInfo {
  const info: Partial<JobEntry> = { ...j };
  delete info.controller;
  return info as JobInfo;
}

/**
 * Start a background job in this server process. Jobs that share a `queue`
 * name run one at a time (e.g. exports, so two FFmpeg encodes don't compete).
 */
export function startJob(
  kind: JobInfo["kind"],
  run: (ctx: JobContext) => Promise<unknown>,
  opts: { queue?: string; id?: string; meta?: Record<string, string>; onFinish?: (info: JobInfo) => void } = {},
): JobInfo {
  const s = store();
  const id = opts.id ?? newId("job");
  const controller = new AbortController();
  const entry: JobEntry = {
    id,
    kind,
    status: "queued",
    progress: 0,
    message: "Queued",
    error: null,
    result: null,
    meta: opts.meta ?? {},
    createdAt: nowIso(),
    updatedAt: nowIso(),
    controller,
  };
  s.jobs.set(id, entry);

  const update = (patch: Partial<JobInfo>) => {
    Object.assign(entry, patch, { updatedAt: nowIso() });
  };
  const ctx: JobContext = {
    signal: controller.signal,
    progress: (fraction, message) =>
      update({ progress: Math.max(0, Math.min(1, fraction)), ...(message ? { message } : {}) }),
    throwIfCancelled: () => {
      if (controller.signal.aborted) throw new CancelledError();
    },
  };

  const exec = async () => {
    if (controller.signal.aborted) {
      update({ status: "cancelled", message: "Cancelled" });
      return;
    }
    update({ status: "running", message: "Starting…" });
    try {
      const result = await run(ctx);
      if (controller.signal.aborted) update({ status: "cancelled", message: "Cancelled" });
      else update({ status: "done", progress: 1, message: "Done", result });
    } catch (e) {
      if (controller.signal.aborted || e instanceof CancelledError) update({ status: "cancelled", message: "Cancelled" });
      else update({ status: "error", error: errorMessage(e), message: "Failed" });
    } finally {
      opts.onFinish?.(publicInfo(entry));
      pruneOldJobs();
    }
  };

  if (opts.queue) {
    const prev = s.queues.get(opts.queue) ?? Promise.resolve();
    const next = prev.then(exec, exec);
    s.queues.set(opts.queue, next);
  } else {
    void exec();
  }
  return publicInfo(entry);
}

export function getJob(id: string): JobInfo | null {
  const j = store().jobs.get(id);
  return j ? publicInfo(j) : null;
}

export function cancelJob(id: string): JobInfo | null {
  const j = store().jobs.get(id);
  if (!j) return null;
  if (j.status === "queued" || j.status === "running") {
    j.controller.abort();
    if (j.status === "queued") Object.assign(j, { status: "cancelled", message: "Cancelled", updatedAt: nowIso() });
  }
  return publicInfo(j);
}

export function listJobs(): JobInfo[] {
  return [...store().jobs.values()].map(publicInfo);
}

function pruneOldJobs() {
  const s = store();
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, j] of s.jobs) {
    const finished = j.status === "done" || j.status === "error" || j.status === "cancelled";
    if (finished && Date.parse(j.updatedAt) < cutoff) s.jobs.delete(id);
  }
}
