import "server-only";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getDb, newId, nowIso } from "./db";
import { HttpError } from "./errors";
import { getSettings } from "./settings";
import { isInside, isInsideAny, safeFileName, uniquePath, validateAbsolutePath } from "./paths";
import { getProject, projectFolder, writeProjectFile } from "./projects";
import { probeMedia } from "./ffmpeg/probe";
import { locateTool } from "./ffmpeg/locate";
import { runFfmpeg } from "./ffmpeg/run";
import { assetKindForExtension, type Asset, type AssetKind, type AssetSource } from "@/lib/shared/types";

type AssetRow = {
  id: string;
  project_id: string;
  kind: AssetKind;
  path: string;
  name: string;
  storage: "managed" | "linked";
  size: number;
  duration: number | null;
  width: number | null;
  height: number | null;
  has_audio: number;
  thumb_path: string | null;
  created_at: string;
  source_json: string | null;
};

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024 * 1024; // 8 GB

function parseSource(json: string | null): AssetSource | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as AssetSource;
  } catch {
    return null;
  }
}

function toAsset(r: AssetRow): Asset {
  return {
    id: r.id,
    projectId: r.project_id,
    kind: r.kind,
    path: r.path,
    name: r.name,
    storage: r.storage,
    size: r.size,
    duration: r.duration,
    width: r.width,
    height: r.height,
    hasAudio: !!r.has_audio,
    createdAt: r.created_at,
    available: fs.existsSync(r.path),
    hasThumbnail: !!r.thumb_path && fs.existsSync(r.thumb_path),
    source: parseSource(r.source_json),
  };
}

export function listAssets(projectId: string): Asset[] {
  const rows = getDb().prepare("SELECT * FROM assets WHERE project_id = ? ORDER BY created_at").all(projectId) as AssetRow[];
  return rows.map(toAsset);
}

export function getAssetRow(id: string): AssetRow {
  const r = getDb().prepare("SELECT * FROM assets WHERE id = ?").get(id) as AssetRow | undefined;
  if (!r) throw new HttpError(404, "Media not found");
  return r;
}

export function getAsset(id: string): Asset {
  return toAsset(getAssetRow(id));
}

/** Every path served to the browser must be a registered asset inside an approved place. */
export function assertServable(row: AssetRow) {
  const folder = projectFolder(row.project_id);
  const roots = row.storage === "managed" ? [folder] : [folder, ...getSettings().mediaFolders];
  if (!isInsideAny(roots, row.path)) {
    throw new HttpError(
      403,
      row.storage === "managed"
        ? "Media file is outside its project folder"
        : `The folder containing "${row.name}" is no longer an approved media folder (Settings → Media folders).`,
    );
  }
  if (!fs.existsSync(row.path)) throw new HttpError(404, `Media file is missing: ${row.name}`);
}

async function makeThumbnail(assetId: string, kind: AssetKind, file: string, folder: string): Promise<string | null> {
  if (kind === "audio") return null;
  const ffmpeg = locateTool("ffmpeg");
  if (!ffmpeg) return null;
  const out = path.join(folder, ".thumbs", `${assetId}.jpg`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const seek = kind === "video" ? ["-ss", "0.5"] : [];
  try {
    await runFfmpeg(ffmpeg.path, [...seek, "-i", `file:${file}`, "-frames:v", "1", "-vf", "scale=360:-2", "-q:v", "4", "-y", `file:${out}`]);
    return fs.existsSync(out) ? out : null;
  } catch {
    if (kind === "video") {
      // Very short clips: retry from the first frame.
      try {
        await runFfmpeg(ffmpeg.path, ["-i", `file:${file}`, "-frames:v", "1", "-vf", "scale=360:-2", "-q:v", "4", "-y", `file:${out}`]);
        return fs.existsSync(out) ? out : null;
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** For files the app rendered itself: known size and a ready thumbnail (skips FFprobe + thumbnail runs). */
export type PreparedMedia = { width: number; height: number; thumbPath: string };

async function registerFile(
  projectId: string,
  file: string,
  storage: Asset["storage"],
  displayName: string,
  source: AssetSource | null = null,
  prepared: PreparedMedia | null = null,
): Promise<Asset> {
  const kind = assetKindForExtension(path.extname(file));
  if (!kind) throw new HttpError(415, `Unsupported file type: ${path.extname(file) || "(none)"}`);
  const stat = fs.statSync(file);
  const id = newId("ast");
  const folder = projectFolder(projectId);
  // Probe and thumbnail run in parallel to keep imports quick.
  const [probeResult, thumb] = prepared
    ? [
        { ok: true as const, r: { duration: null, width: prepared.width, height: prepared.height, hasVideo: true, hasAudio: false, videoCodec: null, isStill: true } },
        isInside(folder, prepared.thumbPath) && fs.existsSync(prepared.thumbPath) ? prepared.thumbPath : null,
      ]
    : await Promise.all([
        probeMedia(file).then(
          (r) => ({ ok: true as const, r }),
          (e: Error) => ({ ok: false as const, e }),
        ),
        makeThumbnail(id, kind, file, folder),
      ]);
  if (!probeResult.ok) {
    if (thumb) fs.rmSync(thumb, { force: true });
    throw new HttpError(422, `Could not read this media file: ${probeResult.e.message.split("\n")[0]}`);
  }
  const probe = probeResult.r;
  const reject = (msg: string) => {
    if (thumb) fs.rmSync(thumb, { force: true });
    return new HttpError(422, msg);
  };
  if ((kind === "video" || kind === "image") && !probe.hasVideo) throw reject("File contains no picture");
  if (kind === "audio" && !probe.hasAudio) throw reject("File contains no audio");
  getDb()
    .prepare(
      "INSERT INTO assets (id, project_id, kind, path, name, storage, size, duration, width, height, has_audio, thumb_path, created_at, source_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      id, projectId, kind, file, displayName.slice(0, 200), storage, stat.size,
      kind === "image" ? null : probe.duration, probe.width, probe.height, probe.hasAudio ? 1 : 0, thumb, nowIso(),
      source ? JSON.stringify(source) : null,
    );
  writeProjectFile(projectId);
  return getAsset(id);
}

/** Save an uploaded file into the project's media folder (originals are never modified). */
export async function importUpload(projectId: string, fileName: string, body: ReadableStream<Uint8Array>, declaredSize: number | null) {
  getProject(projectId);
  const clean = safeFileName(fileName, "media");
  if (!assetKindForExtension(path.extname(clean))) throw new HttpError(415, `Unsupported file type: ${path.extname(clean) || "(none)"}`);
  if (declaredSize !== null && declaredSize > MAX_UPLOAD_BYTES) throw new HttpError(413, "File is larger than 8 GB");
  const dir = path.join(projectFolder(projectId), "media");
  fs.mkdirSync(dir, { recursive: true });
  const target = uniquePath(dir, clean);
  const part = `${target}.part`;
  let bytes = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > MAX_UPLOAD_BYTES) controller.error(new HttpError(413, "File is larger than 8 GB"));
      else controller.enqueue(chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(body.pipeThrough(counter) as import("node:stream/web").ReadableStream<Uint8Array>), fs.createWriteStream(part));
    fs.renameSync(part, target);
  } catch (e) {
    fs.rmSync(part, { force: true });
    throw e;
  }
  try {
    return await registerFile(projectId, target, "managed", fileName);
  } catch (e) {
    fs.rmSync(target, { force: true });
    throw e;
  }
}

/** Reference a file in place (no copy). It must be inside a media folder approved in Settings. */
export async function importLinked(projectId: string, filePath: string) {
  getProject(projectId);
  const p = validateAbsolutePath(filePath, "File path");
  const roots = getSettings().mediaFolders;
  if (!isInsideAny(roots, p)) {
    throw new HttpError(403, "That file is not inside an approved media folder. Add its folder under Settings → Media folders first.");
  }
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) throw new HttpError(404, "File not found");
  return registerFile(projectId, p, "linked", path.basename(p));
}

/** Register a file the app generated inside the project folder (e.g. narration WAV). */
export async function registerGenerated(projectId: string, file: string, displayName: string, source: AssetSource | null = null, prepared: PreparedMedia | null = null) {
  if (!isInside(projectFolder(projectId), file)) throw new HttpError(403, "Generated file is outside the project folder");
  return registerFile(projectId, file, "managed", displayName, source, prepared);
}

/** Credits text for every downloaded stock file in the project (paste into the video description). */
export function projectCredits(projectId: string): { lines: string[]; sources: AssetSource[] } {
  const sources = listAssets(projectId)
    .map((a) => a.source)
    .filter((s): s is AssetSource => !!s);
  const seen = new Set<string>();
  const unique = sources.filter((s) => (seen.has(s.pageUrl) ? false : (seen.add(s.pageUrl), true)));
  const lines = unique.map((s) => `"${s.title}" by ${s.author} (${s.providerLabel}, ${s.license}) — ${s.pageUrl}`);
  return { lines, sources: unique };
}

export function relinkAsset(assetId: string, newPath: string): Asset {
  const row = getAssetRow(assetId);
  const p = validateAbsolutePath(newPath, "File path");
  const roots = [projectFolder(row.project_id), ...getSettings().mediaFolders];
  if (!isInsideAny(roots, p)) throw new HttpError(403, "The new location must be inside the project folder or an approved media folder");
  if (!fs.existsSync(p)) throw new HttpError(404, "File not found");
  if (assetKindForExtension(path.extname(p)) !== row.kind) throw new HttpError(400, `Replacement must also be a ${row.kind} file`);
  getDb().prepare("UPDATE assets SET path = ?, size = ? WHERE id = ?").run(p, fs.statSync(p).size, assetId);
  writeProjectFile(row.project_id);
  return getAsset(assetId);
}

export function deleteAsset(assetId: string) {
  const row = getAssetRow(assetId);
  const state = getProject(row.project_id).state;
  const used =
    state.scenes.some((s) => s.assetId === assetId) || state.narration?.assetId === assetId || state.music?.assetId === assetId;
  if (used) throw new HttpError(409, "This media is used in the timeline. Remove it from the timeline first.");
  const folder = projectFolder(row.project_id);
  // Only files the app copied into the project folder are deleted; linked originals are never touched.
  if (row.storage === "managed" && isInside(folder, row.path)) fs.rmSync(row.path, { force: true });
  if (row.thumb_path && isInside(folder, row.thumb_path)) fs.rmSync(row.thumb_path, { force: true });
  getDb().prepare("DELETE FROM assets WHERE id = ?").run(assetId);
  writeProjectFile(row.project_id);
}
