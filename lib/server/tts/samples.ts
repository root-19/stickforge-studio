import "server-only";
import fs from "node:fs";
import path from "node:path";
import { HttpError } from "../errors";
import { tempDir } from "../env";
import { getCatalogEntry } from "./catalog";
import { VOICE_KEY_RE } from "./voices";

const SAMPLES_BASE = "https://rhasspy.github.io/piper-samples/samples";
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Path to the official Piper sample recording of a catalog voice (MP3),
 * downloaded once from the Piper samples site and cached locally.
 */
export async function getVoiceSample(key: string, speaker = 0): Promise<string> {
  if (!VOICE_KEY_RE.test(key)) throw new HttpError(400, "Invalid voice key");
  const entry = getCatalogEntry(key);
  if (!entry) throw new HttpError(404, "Unknown voice");
  // Catalog paths look like "en/en_US/kristin/medium/en_US-kristin-medium.onnx".
  const dir = path.posix.dirname(entry.files.find((f) => f.path.endsWith(".onnx"))?.path ?? "");
  if (!/^[a-z]{2,3}\/[a-z]{2,3}_[A-Z]{2}\/[A-Za-z0-9_]+\/(x_low|low|medium|high)$/.test(dir)) throw new HttpError(404, "No sample for this voice");
  const spk = Math.max(0, Math.min(entry.numSpeakers - 1, Math.floor(speaker) || 0));
  const cacheDir = path.join(tempDir(), "voice-samples");
  fs.mkdirSync(cacheDir, { recursive: true });
  const file = path.join(cacheDir, `${key}-${spk}.mp3`);
  if (fs.existsSync(file)) return file;
  let res: Response;
  try {
    res = await fetch(`${SAMPLES_BASE}/${dir}/speaker_${spk}.mp3`, { signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new HttpError(502, "Couldn't load the sample. Check your internet connection.");
  }
  if (res.status === 404) throw new HttpError(404, "No official sample for this voice");
  if (!res.ok) throw new HttpError(502, `Sample download failed (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES || buf.length < 1000) throw new HttpError(502, "Unexpected sample file");
  fs.writeFileSync(`${file}.part`, buf);
  fs.renameSync(`${file}.part`, file);
  return file;
}
