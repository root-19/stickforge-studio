import "server-only";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import type { InstalledVoice } from "@/lib/shared/types";
import { getSettings } from "../settings";
import { isInside, ensureWritableDir } from "../paths";
import { HttpError } from "../errors";
import type { JobContext } from "../jobs";
import { CancelledError } from "../jobs";
import { PIPER_VOICES_BASE, getCatalogEntry } from "./catalog";
import { readVoiceConfig, unloadVoice } from "./piper";

export const VOICE_KEY_RE = /^[A-Za-z0-9_\-]{3,120}$/;

export function voicesDir(): string {
  const dir = path.resolve(getSettings().voicesDir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function dirSize(dir: string): number {
  let n = 0;
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (f.isFile()) n += fs.statSync(path.join(dir, f.name)).size;
  }
  return n;
}

/**
 * Find installed voices: any `<name>.onnx` with a matching `<name>.onnx.json`
 * in the voices folder or one level below it (so users can drop in their own
 * Piper voices too).
 */
export function listInstalledVoices(): InstalledVoice[] {
  const root = voicesDir();
  const found: InstalledVoice[] = [];
  const consider = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isFile() || !e.name.toLowerCase().endsWith(".onnx")) continue;
      const modelPath = path.join(dir, e.name);
      if (!fs.existsSync(`${modelPath}.json`)) continue;
      const key = e.name.slice(0, -5);
      if (!VOICE_KEY_RE.test(key) || found.some((v) => v.key === key)) continue;
      try {
        const cfg = readVoiceConfig(`${modelPath}.json`);
        const catalog = getCatalogEntry(key);
        const speakerMap = cfg.speaker_id_map ?? {};
        const speakers = Object.entries(speakerMap)
          .map(([name, id]) => ({ id, name }))
          .sort((a, b) => a.id - b.id);
        const cardPath = path.join(dir, "MODEL_CARD");
        found.push({
          key,
          name: catalog?.name ?? key,
          languageCode: catalog?.languageCode ?? "unknown",
          quality: catalog?.quality ?? cfg.audio.quality ?? "unknown",
          numSpeakers: cfg.num_speakers,
          speakers,
          sampleRate: cfg.audio.sample_rate,
          sizeBytes: dirSize(dir),
          dir,
          catalog,
          modelCard: fs.existsSync(cardPath) ? fs.readFileSync(cardPath, "utf8").slice(0, 20_000) : null,
        });
      } catch (err) {
        console.warn(`[voices] skipping ${modelPath}:`, err);
      }
    }
  };
  consider(root);
  for (const e of fs.readdirSync(root, { withFileTypes: true })) if (e.isDirectory()) consider(path.join(root, e.name));
  return found.sort((a, b) => a.key.localeCompare(b.key));
}

export function findInstalledVoice(key: string): InstalledVoice | null {
  if (!VOICE_KEY_RE.test(key)) return null;
  return listInstalledVoices().find((v) => v.key === key) ?? null;
}

export function modelPathFor(v: InstalledVoice): string {
  return path.join(v.dir, `${v.key}.onnx`);
}

export function freeDiskBytes(dir: string): number | null {
  try {
    const s = fs.statfsSync(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

/** Download a catalog voice from the official repository, verifying size and MD5 of every file. */
export async function installVoice(key: string, ctx: JobContext): Promise<{ key: string; dir: string; bytes: number }> {
  const entry = getCatalogEntry(key);
  if (!entry) throw new HttpError(404, `Voice ${key} is not in the catalog`);
  if (findInstalledVoice(key)) throw new HttpError(409, `${key} is already installed`);
  const root = voicesDir();
  const writable = ensureWritableDir(root);
  if (!writable.ok) throw new Error(`Voice folder is not writable: ${writable.error}`);
  const free = freeDiskBytes(root);
  const needed = entry.totalBytes + 50 * 1024 * 1024;
  if (free !== null && free < needed) {
    throw new Error(`Not enough disk space: ${Math.round(needed / 1e6)} MB needed, ${Math.round(free / 1e6)} MB free`);
  }
  const dir = path.join(root, key);
  if (!isInside(root, dir)) throw new Error("Invalid voice folder");
  const existed = fs.existsSync(dir);
  fs.mkdirSync(dir, { recursive: true });

  let done = 0;
  const total = entry.totalBytes;
  try {
    for (const file of entry.files) {
      ctx.throwIfCancelled();
      const fileName = path.posix.basename(file.path);
      if (!/^[A-Za-z0-9_.\-]+$/.test(fileName)) throw new Error(`Unexpected file name ${fileName}`);
      const target = path.join(dir, fileName);
      const part = `${target}.part`;
      const url = `${PIPER_VOICES_BASE}/${file.path.split("/").map(encodeURIComponent).join("/")}`;
      ctx.progress(done / total, `Downloading ${fileName}`);
      const res = await fetch(url, { signal: ctx.signal, redirect: "follow" });
      if (!res.ok || !res.body) throw new Error(`Download failed for ${fileName} (HTTP ${res.status})`);
      const hash = crypto.createHash("md5");
      const out = fs.createWriteStream(part);
      let fileBytes = 0;
      try {
        for await (const chunk of Readable.fromWeb(res.body as import("node:stream/web").ReadableStream<Uint8Array>)) {
          const buf = chunk as Buffer;
          hash.update(buf);
          fileBytes += buf.length;
          if (!out.write(buf)) await new Promise<void>((r) => out.once("drain", () => r()));
          ctx.progress((done + fileBytes) / total, `Downloading ${fileName}`);
        }
      } finally {
        await new Promise<void>((r) => out.end(() => r()));
      }
      const md5 = hash.digest("hex");
      if (fileBytes !== file.sizeBytes || md5 !== file.md5) {
        fs.rmSync(part, { force: true });
        throw new Error(
          `Verification failed for ${fileName} (expected ${file.sizeBytes} bytes / md5 ${file.md5}, got ${fileBytes} / ${md5}). ` +
            "The voice may have been updated upstream — refresh the voice list and try again.",
        );
      }
      fs.renameSync(part, target);
      done += file.sizeBytes;
    }
    fs.writeFileSync(
      path.join(dir, "install.json"),
      JSON.stringify({ key, source: PIPER_VOICES_BASE, installedAt: new Date().toISOString(), verified: "md5", license: entry.license }, null, 2),
    );
    // Sanity check: the config must parse.
    readVoiceConfig(path.join(dir, `${key}.onnx.json`));
    return { key, dir, bytes: done };
  } catch (e) {
    if (!existed) fs.rmSync(dir, { recursive: true, force: true });
    else for (const f of fs.readdirSync(dir)) if (f.endsWith(".part")) fs.rmSync(path.join(dir, f), { force: true });
    if (ctx.signal.aborted) throw new CancelledError();
    throw e;
  }
}

export function removeVoice(key: string) {
  const v = findInstalledVoice(key);
  if (!v) throw new HttpError(404, `${key} is not installed`);
  const root = voicesDir();
  unloadVoice(key);
  if (path.resolve(v.dir) !== root && isInside(root, v.dir)) {
    fs.rmSync(v.dir, { recursive: true, force: true });
  } else {
    // Voice files live directly in the voices folder: remove just its files.
    for (const f of [`${key}.onnx`, `${key}.onnx.json`]) fs.rmSync(path.join(v.dir, f), { force: true });
  }
}
