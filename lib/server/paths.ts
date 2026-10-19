import "server-only";
import fs from "node:fs";
import path from "node:path";
import { HttpError } from "./errors";

/** Case-insensitive on Windows, exact elsewhere. */
function normalizeForCompare(p: string): string {
  const r = path.resolve(p);
  return process.platform === "win32" ? r.toLowerCase() : r;
}

/** Resolve symlinks when the path exists; otherwise resolve lexically. */
export function realOrResolved(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

/** True when `child` is `root` or inside it (after resolving `..` and symlinks). */
export function isInside(root: string, child: string): boolean {
  const r = normalizeForCompare(realOrResolved(root));
  const c = normalizeForCompare(realOrResolved(child));
  if (r === c) return true;
  const rel = path.relative(r, c);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export function isInsideAny(roots: string[], child: string): boolean {
  return roots.some((r) => isInside(r, child));
}

/**
 * Validate a user-supplied absolute path. Rejects relative paths, device
 * paths, UNC paths and NUL bytes. Returns the resolved path.
 */
export function validateAbsolutePath(input: unknown, label = "path"): string {
  if (typeof input !== "string" || input.trim() === "") throw new HttpError(400, `${label} is required`);
  const p = input.trim();
  if (p.length > 1000) throw new HttpError(400, `${label} is too long`);
  if (p.includes("\0")) throw new HttpError(400, `${label} contains invalid characters`);
  if (/^\\\\[?.]\\/.test(p)) throw new HttpError(400, `${label}: device paths are not allowed`);
  if (/^(\\\\|\/\/)/.test(p)) throw new HttpError(400, `${label}: network (UNC) paths are not supported`);
  if (!path.isAbsolute(p)) throw new HttpError(400, `${label} must be an absolute path`);
  return path.resolve(p);
}

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/** Make a safe single path segment for Windows/macOS/Linux file names. */
export function safeFileName(name: string, fallback = "file"): string {
  let s = name
    .normalize("NFKC")
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^[ .]+|[ .]+$/g, "")
    .slice(0, 120);
  if (!s || RESERVED.test(s)) s = fallback + (s ? `_${s}` : "");
  return s;
}

/** Return a path in `dir` for `fileName` that does not exist yet (adds " (2)", " (3)" …). */
export function uniquePath(dir: string, fileName: string): string {
  const ext = path.extname(fileName);
  const stem = fileName.slice(0, fileName.length - ext.length);
  let candidate = path.join(dir, fileName);
  let n = 2;
  while (fs.existsSync(/*turbopackIgnore: true*/ candidate)) {
    candidate = path.join(dir, `${stem} (${n})${ext}`);
    n++;
    if (n > 10_000) throw new Error("Could not find a free file name");
  }
  return candidate;
}

/** Check that a folder exists (or can be created) and is writable. */
export function ensureWritableDir(dir: string): { ok: true } | { ok: false; error: string } {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.stickforge-write-test-${process.pid}-${Date.now()}`);
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Like ensureWritableDir but never creates anything: an existing folder must be
 * writable; a missing folder is OK if its nearest existing parent is writable.
 */
export function checkWritableDir(dir: string): { ok: true; exists: boolean } | { ok: false; error: string } {
  let probeDir = path.resolve(dir);
  const exists = fs.existsSync(probeDir);
  while (!fs.existsSync(probeDir)) {
    const parent = path.dirname(probeDir);
    if (parent === probeDir) return { ok: false, error: "No existing parent folder" };
    probeDir = parent;
  }
  try {
    fs.accessSync(probeDir, fs.constants.W_OK);
    const probe = path.join(probeDir, `.stickforge-write-test-${process.pid}-${Date.now()}`);
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
    return { ok: true, exists };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Atomically write a file (write temp + rename) so crashes never leave half-written JSON. */
export function writeFileAtomic(file: string, data: string | Uint8Array) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
