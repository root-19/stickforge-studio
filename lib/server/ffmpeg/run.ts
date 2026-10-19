import "server-only";
import { spawn } from "node:child_process";
import { CancelledError } from "../jobs";

export type RunOptions = {
  cwd?: string;
  signal?: AbortSignal;
  /** Expected output duration in seconds, for progress reporting. */
  totalDuration?: number;
  onProgress?: (fraction: number) => void;
};

/**
 * Run FFmpeg with an argument array (never through a shell), report progress
 * from `-progress pipe:1`, and kill the process on cancellation.
 */
export function runFfmpeg(ffmpegPath: string, args: string[], opts: RunOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new CancelledError());
    const fullArgs = ["-hide_banner", "-nostdin", "-loglevel", "error", "-progress", "pipe:1", "-nostats", ...args];
    const child = spawn(ffmpegPath, fullArgs, { cwd: opts.cwd, windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const errLines: string[] = [];
    let stdoutBuf = "";
    let cancelled = false;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdoutBuf += chunk;
      let idx: number;
      while ((idx = stdoutBuf.indexOf("\n")) >= 0) {
        const line = stdoutBuf.slice(0, idx).trim();
        stdoutBuf = stdoutBuf.slice(idx + 1);
        const m = line.match(/^out_time_(?:us|ms)=(\d+)/);
        if (m && opts.totalDuration && opts.onProgress) {
          opts.onProgress(Math.min(0.999, Number(m[1]) / 1e6 / opts.totalDuration));
        }
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      for (const l of chunk.split(/\r?\n/)) if (l.trim()) errLines.push(l.trim());
      if (errLines.length > 80) errLines.splice(0, errLines.length - 80);
    });

    const onAbort = () => {
      cancelled = true;
      child.kill("SIGKILL");
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    child.on("error", (e) => {
      opts.signal?.removeEventListener("abort", onAbort);
      reject(new Error(`Could not start FFmpeg: ${e.message}`));
    });
    child.on("close", (code) => {
      opts.signal?.removeEventListener("abort", onAbort);
      if (cancelled) return reject(new CancelledError());
      if (code === 0) return resolve();
      const detail = errLines.slice(-12).join("\n") || `exit code ${code}`;
      reject(new Error(`FFmpeg failed: ${detail}`));
    });
  });
}

/** Run a tool and capture stdout (used for ffprobe). */
export function runCapture(exe: string, args: string[], timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (c: string) => (out += c));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (c: string) => (err += c));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(err.trim().split("\n").slice(-5).join("\n") || `exit code ${code}`));
    });
  });
}
