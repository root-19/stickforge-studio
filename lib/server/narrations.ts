import "server-only";
import fs from "node:fs";
import path from "node:path";
import { getDb, newId, nowIso } from "./db";
import { HttpError } from "./errors";
import { projectFolder, writeProjectFile } from "./projects";
import { safeFileName, uniquePath, writeFileAtomic } from "./paths";
import type { JobContext } from "./jobs";
import { findInstalledVoice, modelPathFor } from "./tts/voices";
import { loadVoice, synthesizeTexts, withTtsLock } from "./tts/piper";
import { concatInt16, decodeWav, encodeWav, floatToInt16, peakNormalize, resampleInt16, silence } from "./tts/wav";
import { registerGenerated } from "./assets";
import { locateTool, ffmpegCapabilities } from "./ffmpeg/locate";
import { runFfmpeg } from "./ffmpeg/run";
import { chunkLongSentence, splitSentences } from "@/lib/shared/script";
import { combinedAudioHash, combinedSentenceTimings, reconcileSegments, refreshStatus, segmentAudioHash } from "@/lib/shared/narration";
import { voiceSettingsSchema, type Narration, type NarrationSegment, type SentenceTiming, type VoiceSettings } from "@/lib/shared/types";

type NarrationRow = {
  id: string;
  project_id: string;
  name: string;
  script: string;
  settings_json: string;
  segments_json: string;
  duration: number | null;
  combined_hash: string | null;
  created_at: string;
  updated_at: string;
};

function toNarration(r: NarrationRow): Narration {
  const settings = voiceSettingsSchema.parse(JSON.parse(r.settings_json));
  const segments = (JSON.parse(r.segments_json) as NarrationSegment[]).map((s) => refreshStatus(s, settings));
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    script: r.script,
    settings,
    segments,
    duration: r.duration,
    combinedHash: r.combined_hash,
    updatedAt: r.updated_at,
  };
}

function getRow(id: string): NarrationRow {
  const r = getDb().prepare("SELECT * FROM narrations WHERE id = ?").get(id) as NarrationRow | undefined;
  if (!r) throw new HttpError(404, "Narration not found");
  return r;
}

export function getNarration(id: string): Narration {
  return toNarration(getRow(id));
}

export function listNarrations(projectId: string): Narration[] {
  return (getDb().prepare("SELECT * FROM narrations WHERE project_id = ? ORDER BY updated_at DESC").all(projectId) as NarrationRow[]).map(toNarration);
}

function save(n: Narration) {
  getDb()
    .prepare("UPDATE narrations SET name = ?, script = ?, settings_json = ?, segments_json = ?, duration = ?, combined_hash = ?, updated_at = ? WHERE id = ?")
    .run(n.name, n.script, JSON.stringify(n.settings), JSON.stringify(n.segments), n.duration, n.combinedHash, nowIso(), n.id);
}

export function narrationDir(n: Pick<Narration, "id" | "projectId">): string {
  const d = path.join(projectFolder(n.projectId), "narration", n.id);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function segmentFile(n: Pick<Narration, "id" | "projectId">, hash: string) {
  if (!/^[0-9a-f]{16}$/.test(hash)) throw new HttpError(400, "Invalid audio hash");
  return path.join(narrationDir(n), `seg-${hash}.wav`);
}

export function combinedFile(n: Pick<Narration, "id" | "projectId">, hash: string) {
  if (!/^[0-9a-f]{16}$/.test(hash)) throw new HttpError(400, "Invalid audio hash");
  return path.join(narrationDir(n), `narration-${hash}.wav`);
}

export function createNarration(projectId: string, input: { name?: string; script?: string; settings: VoiceSettings }): Narration {
  projectFolder(projectId);
  const id = newId("nar");
  const now = nowIso();
  const settings = voiceSettingsSchema.parse(input.settings);
  const script = input.script ?? "";
  const segments = reconcileSegments([], script, settings, () => newId("seg"));
  getDb()
    .prepare("INSERT INTO narrations (id, project_id, name, script, settings_json, segments_json, duration, combined_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)")
    .run(id, projectId, (input.name ?? "Narration").slice(0, 100), script, JSON.stringify(settings), JSON.stringify(segments), now, now);
  writeProjectFile(projectId);
  return getNarration(id);
}

export function updateNarration(id: string, patch: { name?: string; script?: string; settings?: VoiceSettings }): Narration {
  const n = getNarration(id);
  const settings = patch.settings ? voiceSettingsSchema.parse(patch.settings) : n.settings;
  const script = patch.script ?? n.script;
  const segments = reconcileSegments(n.segments, script, settings, () => newId("seg"));
  const next: Narration = { ...n, name: patch.name?.slice(0, 100) ?? n.name, script, settings, segments };
  if (next.combinedHash !== combinedAudioHash(segments, settings)) {
    next.combinedHash = null;
    next.duration = null;
  }
  save(next);
  writeProjectFile(n.projectId);
  return getNarration(id);
}

export function deleteNarration(id: string) {
  const n = getNarration(id);
  const dir = path.join(projectFolder(n.projectId), "narration", n.id);
  fs.rmSync(dir, { recursive: true, force: true });
  getDb().prepare("DELETE FROM narrations WHERE id = ?").run(id);
  writeProjectFile(n.projectId);
}

/** Sentence-sized pieces actually sent to Piper for one paragraph. */
export function segmentPieces(text: string): string[] {
  return splitSentences(text).flatMap((s) => chunkLongSentence(s));
}

/**
 * Generate audio for the requested segments (default: every segment that is
 * not ready). Each paragraph is synthesized sentence by sentence so we know the
 * exact start/end of every sentence for captions.
 */
export async function generateNarration(id: string, segmentIds: string[] | null, ctx: JobContext) {
  const initial = getNarration(id);
  const settings = initial.settings;
  const voice = findInstalledVoice(settings.voiceKey);
  if (!voice) throw new Error(`Voice "${settings.voiceKey}" is not installed. Install it in the Voice Manager.`);
  const targets = initial.segments.filter((s) => (segmentIds ? segmentIds.includes(s.id) : s.status !== "ready"));
  ctx.progress(0, "Loading voice model…");
  const loaded = await loadVoice(voice.key, modelPathFor(voice));
  const sr = loaded.config.audio.sample_rate;

  const totalPieces = targets.reduce((n, s) => n + segmentPieces(s.text).length, 0) || 1;
  let donePieces = 0;

  for (const target of targets) {
    ctx.throwIfCancelled();
    const pieces = segmentPieces(target.text);
    const hash = segmentAudioHash(target.text, settings);
    try {
      const pcms = await withTtsLock(() =>
        synthesizeTexts(loaded, pieces, settings, () => {
          donePieces++;
          ctx.progress(donePieces / totalPieces, `Speaking paragraph ${initial.segments.indexOf(target) + 1} of ${initial.segments.length}`);
          ctx.throwIfCancelled();
        }),
      );
      // Normalize the whole paragraph together so sentence loudness stays consistent.
      const joinedFloat = new Float32Array(pcms.reduce((n, p) => n + p.length, 0));
      let o = 0;
      for (const p of pcms) {
        joinedFloat.set(p, o);
        o += p.length;
      }
      const normalized = floatToInt16(peakNormalize(joinedFloat));
      const parts: Int16Array[] = [];
      const sentences: SentenceTiming[] = [];
      let cursor = 0;
      let t = 0;
      pcms.forEach((p, i) => {
        const piece = normalized.subarray(cursor, cursor + p.length);
        cursor += p.length;
        const start = t;
        t += piece.length / sr;
        sentences.push({ text: pieces[i], start: round3(start), end: round3(t) });
        parts.push(piece);
        if (i < pcms.length - 1 && settings.sentencePause > 0) {
          parts.push(silence(settings.sentencePause, sr));
          t += Math.round(settings.sentencePause * sr) / sr;
        }
      });
      const samples = concatInt16(parts);
      writeFileAtomic(segmentFile(initial, hash), encodeWav(samples, sr));
      updateSegment(id, target.id, { audioHash: hash, duration: round3(samples.length / sr), sentences, status: "ready", error: undefined });
    } catch (e) {
      if (ctx.signal.aborted) throw e;
      updateSegment(id, target.id, { status: "error", error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  }
  ctx.progress(0.99, "Combining narration…");
  return combineNarration(id);
}

function updateSegment(narrationId: string, segmentId: string, patch: Partial<NarrationSegment>) {
  // Re-read so concurrent script edits made while generating are not lost.
  const n = getNarration(narrationId);
  const segments = n.segments.map((s) => (s.id === segmentId ? { ...s, ...patch } : s));
  save({ ...n, segments, combinedHash: null, duration: null });
}

/** Join all ready segments (with paragraph pauses) into one WAV. */
export function combineNarration(id: string): Narration {
  const n = getNarration(id);
  if (n.segments.length === 0) throw new HttpError(400, "The script is empty");
  const notReady = n.segments.filter((s) => s.status !== "ready" || !s.audioHash);
  if (notReady.length) throw new HttpError(409, `${notReady.length} paragraph(s) still need audio. Generate them first.`);
  const decoded = n.segments.map((s) => decodeWav(fs.readFileSync(segmentFile(n, s.audioHash!))));
  const sr = decoded[0].sampleRate;
  const parts: Int16Array[] = [];
  decoded.forEach((d, i) => {
    parts.push(resampleInt16(d.samples, d.sampleRate, sr));
    if (i < decoded.length - 1) parts.push(silence(n.settings.paragraphPause, sr));
  });
  const samples = concatInt16(parts);
  const hash = combinedAudioHash(n.segments, n.settings);
  writeFileAtomic(combinedFile(n, hash), encodeWav(samples, sr));
  // Clean up audio files no segment refers to anymore.
  const keep = new Set([`narration-${hash}.wav`, ...n.segments.map((s) => `seg-${s.audioHash}.wav`)]);
  for (const f of fs.readdirSync(narrationDir(n))) if (f.endsWith(".wav") && !keep.has(f)) fs.rmSync(path.join(narrationDir(n), f), { force: true });
  save({ ...n, combinedHash: hash, duration: round3(samples.length / sr) });
  return getNarration(id);
}

export function narrationTimings(n: Narration): SentenceTiming[] {
  // Rounded to the sample grid used when combining.
  return combinedSentenceTimings(n.segments, n.settings.paragraphPause).map((s) => ({ ...s, start: round3(s.start), end: round3(s.end) }));
}

/**
 * Save the combined narration into the project's audio folder as WAV (and MP3
 * when FFmpeg has an MP3 encoder) and register it as project media.
 */
export async function exportNarrationAudio(id: string, opts: { mp3: boolean; fileName?: string }) {
  const n = getNarration(id);
  if (!n.combinedHash) throw new HttpError(409, "Generate the full narration first");
  const src = combinedFile(n, n.combinedHash);
  if (!fs.existsSync(src)) throw new HttpError(409, "Combined narration file is missing; generate again");
  const audioDir = path.join(projectFolder(n.projectId), "audio");
  fs.mkdirSync(audioDir, { recursive: true });
  const base = safeFileName(opts.fileName || n.name || "narration", "narration");
  const wavPath = uniquePath(audioDir, `${base}.wav`);
  fs.copyFileSync(src, wavPath);
  const wavAsset = await registerGenerated(n.projectId, wavPath, path.basename(wavPath));
  let mp3Path: string | null = null;
  let mp3Error: string | null = null;
  if (opts.mp3) {
    const ff = locateTool("ffmpeg");
    if (!ff) mp3Error = "FFmpeg not found — MP3 conversion skipped (WAV saved).";
    else if (!ffmpegCapabilities(ff.path).libmp3lame) mp3Error = "This FFmpeg build has no MP3 encoder (libmp3lame) — WAV saved.";
    else {
      mp3Path = uniquePath(audioDir, `${base}.mp3`);
      await runFfmpeg(ff.path, ["-i", `file:${wavPath}`, "-c:a", "libmp3lame", "-q:a", "2", "-n", `file:${mp3Path}`]);
    }
  }
  return { wavPath, mp3Path, mp3Error, asset: wavAsset, duration: n.duration };
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}
