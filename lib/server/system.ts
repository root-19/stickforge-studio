import "server-only";
import { voiceName } from "@/lib/shared/voice-names";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { appHome } from "./env";
import { getDb } from "./db";
import { getSettings } from "./settings";
import { checkWritableDir } from "./paths";
import { ffmpegCapabilities, locateTool } from "./ffmpeg/locate";
import { listInstalledVoices, freeDiskBytes } from "./tts/voices";
import { phonemize, phonemizerBuildDir } from "./tts/piper";
import { createRequire } from "node:module";
import { appRoot } from "./env";

export type CheckStatus = "ok" | "warn" | "error";
export type SystemCheck = { id: string; label: string; status: CheckStatus; detail: string; fix?: string };

export async function runSystemChecks(): Promise<{ checks: SystemCheck[]; summary: CheckStatus }> {
  const checks: SystemCheck[] = [];
  const settings = getSettings();

  const [major, minor] = process.versions.node.split(".").map(Number);
  const nodeOk = major > 22 || (major === 22 && minor >= 13);
  checks.push({
    id: "node",
    label: "Node.js",
    status: nodeOk ? "ok" : "error",
    detail: `v${process.versions.node}${nodeOk ? "" : " — StickForge needs Node.js 22.13 or newer (24 LTS recommended)"}`,
    fix: nodeOk ? undefined : "Install Node.js 24 LTS from https://nodejs.org and run scripts\\setup.ps1 again.",
  });

  try {
    getDb();
    const v = (new DatabaseSync(":memory:").prepare("select sqlite_version() v").get() as { v: string }).v;
    checks.push({ id: "sqlite", label: "SQLite database", status: "ok", detail: `SQLite ${v} at ${path.join(appHome(), "stickforge.db")}` });
  } catch (e) {
    checks.push({ id: "sqlite", label: "SQLite database", status: "error", detail: String(e) });
  }

  const ffmpeg = locateTool("ffmpeg");
  const ffprobe = locateTool("ffprobe");
  if (!ffmpeg) {
    checks.push({
      id: "ffmpeg",
      label: "FFmpeg",
      status: "error",
      detail: "Not found. Needed for importing media, MP3 conversion and video export.",
      fix: "Run: winget install --id Gyan.FFmpeg -e   (then restart StickForge), or set the path in Settings.",
    });
  } else {
    const caps = ffmpegCapabilities(ffmpeg.path);
    const missing = [
      !caps.libx264 && !caps.h264_mf ? "H.264 encoder" : null,
      !caps.aac ? "AAC encoder" : null,
      !caps.subtitles ? "subtitles filter (libass)" : null,
    ].filter(Boolean);
    checks.push({
      id: "ffmpeg",
      label: "FFmpeg",
      status: missing.length ? "warn" : "ok",
      detail: `${caps.version} (${ffmpeg.source}: ${ffmpeg.path}) · H.264: ${caps.libx264 ? "libx264" : caps.h264_mf ? "h264_mf" : "none"} · AAC: ${caps.aac ? "yes" : "no"} · burn-in captions: ${caps.subtitles ? "yes" : "no"} · MP3: ${caps.libmp3lame ? "yes" : "no"}`,
      fix: missing.length ? `This build lacks: ${missing.join(", ")}. Install the full build: winget install --id Gyan.FFmpeg -e` : undefined,
    });
  }
  checks.push({
    id: "ffprobe",
    label: "FFprobe",
    status: ffprobe ? "ok" : "error",
    detail: ffprobe ? ffprobe.path : "Not found (ships with FFmpeg).",
    fix: ffprobe ? undefined : "Install FFmpeg (includes ffprobe): winget install --id Gyan.FFmpeg -e",
  });

  try {
    const req = createRequire(path.join(appRoot(), "package.json"));
    const ortVersion = (req("onnxruntime-node/package.json") as { version: string }).version;
    req("onnxruntime-node");
    checks.push({ id: "onnx", label: "ONNX Runtime (Piper inference)", status: "ok", detail: `onnxruntime-node ${ortVersion} (CPU)` });
  } catch (e) {
    checks.push({ id: "onnx", label: "ONNX Runtime (Piper inference)", status: "error", detail: String(e), fix: "Run npm install again (scripts\\setup.ps1)." });
  }

  try {
    const ph = await phonemize(["Test."], "en-us");
    checks.push({ id: "phonemizer", label: "Piper phonemizer (espeak-ng WASM)", status: ph[0]?.length ? "ok" : "warn", detail: phonemizerBuildDir() });
  } catch (e) {
    checks.push({ id: "phonemizer", label: "Piper phonemizer (espeak-ng WASM)", status: "error", detail: String(e), fix: "Run npm install again (scripts\\setup.ps1)." });
  }

  let voices: ReturnType<typeof listInstalledVoices> = [];
  try {
    voices = listInstalledVoices();
  } catch {
    /* reported below */
  }
  checks.push({
    id: "voices",
    label: "Voice models",
    status: voices.length ? "ok" : "warn",
    detail: voices.length ? `${voices.length} installed: ${voices.map((v) => voiceName(v.key)).join(", ")}` : "No voice installed yet.",
    fix: voices.length ? undefined : "Open the Voice Manager and install a voice (e.g. Joe or Kristin, ~60 MB each). Requires internet once.",
  });

  for (const [id, label, dir] of [
    ["dir-home", "App data folder", appHome()],
    ["dir-projects", "Projects folder", settings.projectsDir],
    ["dir-voices", "Voices folder", settings.voicesDir],
  ] as const) {
    const w = checkWritableDir(dir);
    const free = w.ok && w.exists ? freeDiskBytes(dir) : null;
    checks.push({
      id,
      label,
      status: w.ok ? (free !== null && free < 2e9 ? "warn" : "ok") : "error",
      detail: w.ok
        ? `${dir}${w.exists ? "" : " (will be created when first used)"}${free !== null ? ` · ${(free / 1e9).toFixed(1)} GB free` : ""}`
        : `${dir}: ${w.error}`,
      fix: w.ok ? undefined : "Choose a different folder in Settings.",
    });
  }

  const missingMediaFolders = settings.mediaFolders.filter((f) => !fs.existsSync(f));
  if (missingMediaFolders.length) {
    checks.push({ id: "media-folders", label: "Media folders", status: "warn", detail: `Missing: ${missingMediaFolders.join(", ")}` });
  }

  const summary: CheckStatus = checks.some((c) => c.status === "error") ? "error" : checks.some((c) => c.status === "warn") ? "warn" : "ok";
  return { checks, summary };
}
