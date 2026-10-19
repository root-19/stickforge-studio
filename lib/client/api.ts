"use client";

import type { JobInfo } from "@/lib/shared/types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** Fetch an app API route. Adds the CSRF header and turns error JSON into ApiError. */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("x-stickforge", "1");
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  }
  const res = await fetch(path, { ...init, headers, body, cache: "no-store" });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    let details: unknown;
    let code: string | undefined;
    try {
      const j = (await res.json()) as { error?: string; details?: unknown; code?: string };
      if (j.error) msg = j.error;
      details = j.details;
      code = j.code;
    } catch {
      /* not JSON */
    }
    // Session expired or logged out in another tab: go to the login page and come back afterwards.
    if (res.status === 401 && code === "auth_required" && typeof window !== "undefined" && !location.pathname.startsWith("/login")) {
      // A full page load (not router.push) on purpose: it drops all in-memory state of the old session.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
    }
    throw new ApiError(res.status, msg, details);
  }
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("application/json")) return (await res.json()) as T;
  return (await res.blob()) as unknown as T;
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError || e instanceof Error) return e.message;
  return String(e);
}

/** Upload a file as the raw request body (streams on the server, no size-limited multipart parsing). */
export function uploadFile(projectId: string, file: File, onProgress?: (fraction: number) => void): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/projects/${projectId}/assets`);
    xhr.setRequestHeader("x-stickforge", "1");
    xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name));
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data: { error?: string } = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(xhr.status, data.error ?? `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new ApiError(0, "Upload failed: the StickForge server is not reachable"));
    xhr.send(file);
  });
}

export async function waitForJob(id: string, onUpdate?: (j: JobInfo) => void, signal?: AbortSignal): Promise<JobInfo> {
  for (;;) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const j = await api<JobInfo>(`/api/jobs/${id}`);
    onUpdate?.(j);
    if (j.status === "done" || j.status === "error" || j.status === "cancelled") return j;
    await new Promise((r) => setTimeout(r, 400));
  }
}

export const assetFileUrl = (id: string) => `/api/assets/${id}/file`;
export const assetThumbUrl = (id: string) => `/api/assets/${id}/thumbnail`;
