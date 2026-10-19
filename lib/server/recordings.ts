import "server-only";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { HttpError } from "./errors";
import { newId, nowIso } from "./db";
import { projectFolder, writeProjectFile } from "./projects";
import { safeFileName, uniquePath, writeFileAtomic } from "./paths";
import { requireTool } from "./ffmpeg/locate";
import { runFfmpeg } from "./ffmpeg/run";
import { analyzeFile, type VoiceFeatures } from "./audio-analysis";
import { registerGenerated } from "./assets";
import { buildEnhanceFilter, enhanceKey, type EnhanceOptions, type RecordingInfo } from "@/lib/shared/recording";

/**
 * Voice recordings made in the browser. Stored in the project folder:
 *   recordings/<id>/original.<ext>  — exactly what the microphone captured
 *   recordings/<id>/raw.wav         — decoded original (48 kHz mono)
 *   recordings/<id>/enhanced-<opts>.wav — cleaned-up versions (cached per option set)
 */

const MAX_RECORDING_BYTES = 300 * 1024 * 1024;
const ID_RE = /^rec_[a-z0-9]{6,40}$/;
const TYPES: Record<string, string> = { "audio/webm": ".webm", "audio/ogg": ".ogg", "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/mp4": ".m4a", "audio/mpeg": ".mp3" };

function recordingDir(projectId: string, id: string): string {
  if (!ID_RE.test(id)) throw new HttpError(400, "Invalid recording id");
  return path.join(projectFolder(projectId), "recordings", id);
}

function readMeta(dir: string): RecordingInfo {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8")) as RecordingInfo;
  } catch {
    throw new HttpError(404, "Recording not found");
  }
}

export async function saveRecording(projectId: string, body: ReadableStream<Uint8Array>, mime: string): Promise<RecordingInfo & { features: VoiceFeatures | null }> {
  const ext = TYPES[mime.split(";")[0].trim().toLowerCase()];
  if (!ext) throw new HttpError(415, `Unsupported recording format: ${mime}`);
  const id = newId("rec").toLowerCase().replace(/[^a-z0-9_]/g, "");
  const dir = recordingDir(projectId, id);
  fs.mkdirSync(dir, { recursive: true });
  const original = path.join(dir, `original${ext}`);
  let bytes = 0;
  const limiter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, c) {
      bytes += chunk.byteLength;
      if (bytes > MAX_RECORDING_BYTES) c.error(new HttpError(413, "Recording is too large"));
      else c.enqueue(chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(body.pipeThrough(limiter) as import("node:stream/web").ReadableStream<Uint8Array>), fs.createWriteStream(original));
    if (bytes < 1000) throw new HttpError(400, "The recording is empty. Check your microphone.");
    const raw = path.join(dir, "raw.wav");
    await runFfmpeg(requireTool("ffmpeg"), ["-i", `file:${original}`, "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", "-y", `file:${raw}`]);
    const features = await analyzeFile(raw).catch(() => null);
    const info: RecordingInfo = { id, duration: features?.seconds ?? 0, createdAt: nowIso(), features };
    writeFileAtomic(path.join(dir, "meta.json"), JSON.stringify(info));
    return { ...info, features };
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

/** Recordings already made in this project (newest last). */
export function listRecordings(projectId: string): RecordingInfo[] {
  const root = path.join(projectFolder(projectId), "recordings");
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && ID_RE.test(e.name))
    .map((e) => {
      try {
        return readMeta(path.join(root, e.name));
      } catch {
        return null;
      }
    })
    .filter((r): r is RecordingInfo => !!r)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function getRecording(projectId: string, id: string): RecordingInfo {
  return readMeta(recordingDir(projectId, id));
}

/** Render (or reuse) the cleaned-up version for these options. */
export async function enhancedFile(projectId: string, id: string, opts: EnhanceOptions): Promise<string> {
  const dir = recordingDir(projectId, id);
  readMeta(dir);
  const raw = path.join(dir, "raw.wav");
  const out = path.join(dir, `enhanced-${enhanceKey(opts)}.wav`);
  if (!fs.existsSync(out)) {
    const tmp = `${out}.${Date.now()}.tmp.wav`;
    try {
      await runFfmpeg(requireTool("ffmpeg"), ["-i", `file:${raw}`, "-af", buildEnhanceFilter(opts), "-c:a", "pcm_s16le", "-y", `file:${tmp}`]);
      fs.renameSync(tmp, out);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }
  return out;
}

export function originalWav(projectId: string, id: string): string {
  const dir = recordingDir(projectId, id);
  readMeta(dir);
  return path.join(dir, "raw.wav");
}

/** Save a (cleaned-up) recording into the project's audio folder as media. */
export async function saveRecordingAsAsset(projectId: string, id: string, opts: EnhanceOptions | null, name: string) {
  const src = opts ? await enhancedFile(projectId, id, opts) : originalWav(projectId, id);
  const audioDir = path.join(projectFolder(projectId), "audio");
  fs.mkdirSync(audioDir, { recursive: true });
  const dest = uniquePath(audioDir, `${safeFileName(name || "My voice", "My voice")}.wav`);
  fs.copyFileSync(src, dest);
  const asset = await registerGenerated(projectId, dest, path.basename(dest));
  writeProjectFile(projectId);
  return asset;
}

export function deleteRecording(projectId: string, id: string) {
  fs.rmSync(recordingDir(projectId, id), { recursive: true, force: true });
}
