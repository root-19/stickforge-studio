import "server-only";
import fs from "node:fs";
import path from "node:path";
import { getDb, newId, nowIso } from "./db";
import { HttpError } from "./errors";
import { getSettings } from "./settings";
import { getProject, projectFolder } from "./projects";
import { assertServable, getAssetRow } from "./assets";
import { ensureWritableDir, isInsideAny, safeFileName, uniquePath, validateAbsolutePath, writeFileAtomic } from "./paths";
import { startJob, getJob, cancelJob, type JobContext } from "./jobs";
import { tempDir } from "./env";
import { requireTool, ffmpegCapabilities } from "./ffmpeg/locate";
import { runFfmpeg } from "./ffmpeg/run";
import { buildAss } from "./ffmpeg/ass";
import { buildFfmpegArgs, SUBTITLE_FILE_NAME, type RenderScene, type RenderSpec } from "./ffmpeg/render";
import { toSrt, sortAndValidateCaptions } from "@/lib/shared/captions";
import { timelineDuration } from "@/lib/shared/timeline";
import { EXPORT_PRESETS, QUALITY_CRF, QUALITY_X264_PRESET, exportRequestSchema, outputSize, type ExportRequestInput, type ExportRecord, type ExportRequest, type JobStatus } from "@/lib/shared/types";

type ExportRow = {
  id: string;
  project_id: string;
  project_name: string;
  status: JobStatus;
  progress: number;
  preset: string;
  width: number;
  height: number;
  fps: number;
  output_path: string;
  srt_path: string | null;
  duration: number;
  error: string | null;
  created_at: string;
  finished_at: string | null;
};

function toRecord(r: ExportRow): ExportRecord {
  const live = getJob(r.id);
  const status = live && (live.status === "running" || live.status === "queued") ? live.status : r.status;
  return {
    id: r.id,
    projectId: r.project_id,
    projectName: r.project_name,
    status,
    progress: live ? live.progress : r.progress,
    preset: r.preset,
    width: r.width,
    height: r.height,
    fps: r.fps,
    outputPath: r.output_path,
    srtPath: r.srt_path,
    duration: r.duration,
    error: r.error,
    createdAt: r.created_at,
    finishedAt: r.finished_at,
    fileExists: fs.existsSync(r.output_path),
  };
}

export function listExports(): ExportRecord[] {
  return (getDb().prepare("SELECT * FROM exports ORDER BY created_at DESC LIMIT 200").all() as ExportRow[]).map(toRecord);
}

export function getExport(id: string): ExportRecord {
  const r = getDb().prepare("SELECT * FROM exports WHERE id = ?").get(id) as ExportRow | undefined;
  if (!r) throw new HttpError(404, "Export not found");
  return toRecord(r);
}

/** Exports left "running" by a crashed/stopped server are marked as interrupted on startup. */
export function recoverInterruptedExports() {
  const rows = getDb().prepare("SELECT id, output_path FROM exports WHERE status IN ('queued','running')").all() as { id: string; output_path: string }[];
  for (const r of rows) {
    if (getJob(r.id)) continue;
    fs.rmSync(`${r.output_path}`, { force: true });
    getDb().prepare("UPDATE exports SET status = 'error', error = ?, finished_at = ? WHERE id = ?").run("Interrupted (the app was closed during export)", nowIso(), r.id);
  }
}

export type ExportPlan = { spec: RenderSpec; ass: string | null; srt: string | null; warnings: string[] };

/** Resolve a project into a render spec. Throws a helpful error listing missing media. */
export function planExport(req: ExportRequest, outputPath: string): ExportPlan {
  const project = getProject(req.projectId);
  const state = project.state;
  const preset = EXPORT_PRESETS[req.preset];
  const presetAspect = preset.aspect ?? state.aspect;
  const sized = outputSize(presetAspect, req.resolution);
  const width = req.preset === "custom" ? req.width ?? sized.width : sized.width;
  const height = req.preset === "custom" ? req.height ?? sized.height : sized.height;
  const fps = req.preset === "custom" ? req.fps ?? preset.fps : preset.fps;
  if (state.scenes.length === 0) throw new HttpError(400, "Add at least one scene to the timeline before exporting.");

  const problems: string[] = [];
  const resolve = (assetId: string) => {
    try {
      const row = getAssetRow(assetId);
      assertServable(row);
      return row;
    } catch (e) {
      problems.push(e instanceof Error ? e.message : String(e));
      return null;
    }
  };

  const scenes: RenderScene[] = [];
  for (const s of state.scenes) {
    const row = resolve(s.assetId);
    if (!row) continue;
    if (row.kind === "audio") {
      problems.push(`"${row.name}" is audio and cannot be used as a scene`);
      continue;
    }
    scenes.push({
      kind: row.kind,
      path: row.path,
      duration: s.duration,
      trimStart: row.kind === "video" ? s.trimStart : 0,
      fit: s.fit,
      motion: s.motion,
      clipVolume: s.clipVolume,
      clipMuted: s.clipMuted,
      hasAudio: !!row.has_audio,
    });
  }
  const narrationRow = state.narration && !state.narration.muted ? resolve(state.narration.assetId) : null;
  const musicRow = state.music && !state.music.muted ? resolve(state.music.assetId) : null;
  if (problems.length) throw new HttpError(409, `Some media is missing or not accessible:\n• ${[...new Set(problems)].join("\n• ")}`);

  const ffmpeg = requireTool("ffmpeg");
  const caps = ffmpegCapabilities(ffmpeg);
  const warnings: string[] = [];
  const encoder = caps.libx264 ? "libx264" : caps.h264_mf ? "h264_mf" : null;
  if (!encoder) throw new HttpError(500, "Your FFmpeg build has no H.264 encoder (libx264 or h264_mf).");
  if (encoder !== "libx264") warnings.push("libx264 is unavailable; using Windows Media Foundation H.264 (h264_mf).");

  const duration = timelineDuration(state);
  if (preset.aspect && preset.aspect !== state.aspect) {
    warnings.push(`This project is ${state.aspect} but ${preset.label} is ${preset.aspect}; scenes are re-fitted to ${preset.aspect}.`);
  }
  if (Math.max(width, height) > 3000) warnings.push("4K export can take several times longer than 1080p.");
  if (preset.maxDuration && duration > preset.maxDuration) {
    warnings.push(`Video is ${Math.round(duration)}s; ${preset.label} recommends ${preset.maxDuration}s or less. Check current platform limits.`);
  }

  const captions = sortAndValidateCaptions(state.captions.items).filter((c) => c.start < duration);
  let ass: string | null = null;
  if (req.burnCaptions && state.captions.enabled && captions.length) {
    if (!caps.subtitles) warnings.push("This FFmpeg build cannot burn subtitles (no libass); captions were skipped.");
    else ass = buildAss(captions, state.captions.style, width, height);
  }
  const srt = req.writeSrt && captions.length ? toSrt(captions, state.captions.style.uppercase) : null;

  const motionUsed = scenes.some((s) => s.kind === "image" && s.motion !== "none");
  if (motionUsed && !caps.zoompan) {
    warnings.push("zoompan filter unavailable; image motion was disabled.");
    for (const s of scenes) s.motion = "none";
  }
  const duck = !!state.music?.duck && caps.sidechaincompress;

  const spec: RenderSpec = {
    width,
    height,
    fps,
    crf: QUALITY_CRF[req.quality],
    x264Preset: QUALITY_X264_PRESET[req.quality],
    encoder,
    scenes,
    narration: narrationRow ? { path: narrationRow.path, volume: state.narration!.volume, offset: state.narration!.offset } : null,
    music: musicRow ? { path: musicRow.path, volume: state.music!.volume, loop: state.music!.loop, duck, fadeOut: state.music!.fadeOut } : null,
    subtitlesFile: ass ? SUBTITLE_FILE_NAME : null,
    outputPath,
  };
  // Never write over a source file.
  const inputs = [...scenes.map((s) => s.path), narrationRow?.path, musicRow?.path].filter(Boolean).map((p) => path.resolve(p!).toLowerCase());
  if (inputs.includes(path.resolve(outputPath).toLowerCase())) throw new HttpError(400, "Output file would overwrite a source file");
  return { spec, ass, srt, warnings };
}

function resolveOutputDir(req: ExportRequest): string {
  const projectExports = path.join(projectFolder(req.projectId), "exports");
  const settings = getSettings();
  let dir = projectExports;
  if (req.outputDir) {
    dir = validateAbsolutePath(req.outputDir, "Output folder");
    const approved = [projectFolder(req.projectId), settings.exportDir, ...settings.mediaFolders].filter(Boolean);
    if (!isInsideAny(approved, dir)) {
      throw new HttpError(403, "Output folder must be the project folder, the default export folder, or an approved media folder.");
    }
  } else if (settings.exportDir) {
    dir = settings.exportDir;
  }
  const w = ensureWritableDir(dir);
  if (!w.ok) throw new HttpError(400, `Cannot write to ${dir}: ${w.error}`);
  return dir;
}

export function startExport(input: ExportRequestInput, userId: string | null = null): { record: ExportRecord; warnings: string[] } {
  const req = exportRequestSchema.parse(input);
  const project = getProject(req.projectId);
  const dir = resolveOutputDir(req);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
  const base = safeFileName(req.fileName?.replace(/\.mp4$/i, "") || `${project.name} ${stamp}`, "export");
  const outputPath = uniquePath(dir, `${base}.mp4`);
  const plan = planExport(req, outputPath);
  const id = newId("exp");
  const srtPath = plan.srt ? uniquePath(dir, `${base}.srt`) : null;
  getDb()
    .prepare(
      "INSERT INTO exports (id, project_id, project_name, status, progress, preset, width, height, fps, output_path, srt_path, duration, error, created_at, finished_at) VALUES (?, ?, ?, 'queued', 0, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)",
    )
    .run(id, project.id, project.name, req.preset, plan.spec.width, plan.spec.height, plan.spec.fps, outputPath, srtPath, timelineDuration(project.state), nowIso());

  // Reserve the file name so a second export started right away picks a different one.
  fs.writeFileSync(outputPath, "");

  startJob("export", (ctx) => runExport(id, plan, srtPath, ctx), {
    id,
    queue: "export",
    meta: userId ? { userId } : {},
    onFinish: (info) => {
      getDb()
        .prepare("UPDATE exports SET status = ?, progress = ?, error = ?, finished_at = ? WHERE id = ?")
        .run(info.status, info.progress, info.error, nowIso(), id);
      if (info.status !== "done") {
        fs.rmSync(outputPath, { force: true });
        if (srtPath) fs.rmSync(srtPath, { force: true });
      }
    },
  });
  return { record: getExport(id), warnings: plan.warnings };
}

async function runExport(id: string, plan: ExportPlan, srtPath: string | null, ctx: JobContext) {
  getDb().prepare("UPDATE exports SET status = 'running' WHERE id = ?").run(id);
  const work = fs.mkdtempSync(path.join(tempDir(), "export-"));
  try {
    if (plan.ass) fs.writeFileSync(path.join(work, SUBTITLE_FILE_NAME), plan.ass, "utf8");
    // Remove the placeholder; `-n` makes FFmpeg refuse to overwrite anything else.
    fs.rmSync(plan.spec.outputPath, { force: true });
    const { args, duration } = buildFfmpegArgs(plan.spec);
    ctx.progress(0, "Rendering video…");
    await runFfmpeg(requireTool("ffmpeg"), args, {
      cwd: work,
      signal: ctx.signal,
      totalDuration: duration,
      onProgress: (f) => {
        ctx.progress(f, `Rendering ${Math.round(f * 100)}%`);
        getDb().prepare("UPDATE exports SET progress = ? WHERE id = ?").run(f, id);
      },
    });
    if (srtPath && plan.srt) writeFileAtomic(srtPath, plan.srt);
    return { outputPath: plan.spec.outputPath, srtPath };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

export function cancelExport(id: string) {
  const job = cancelJob(id);
  if (!job) {
    const rec = getExport(id);
    if (rec.status === "queued" || rec.status === "running") {
      getDb().prepare("UPDATE exports SET status = 'cancelled', finished_at = ? WHERE id = ?").run(nowIso(), id);
    }
  }
  return getExport(id);
}

export function deleteExportRecord(id: string, deleteFile: boolean) {
  const rec = getExport(id);
  if (rec.status === "running" || rec.status === "queued") throw new HttpError(409, "Cancel the export first");
  if (deleteFile) {
    for (const p of [rec.outputPath, rec.srtPath]) if (p && fs.existsSync(p)) fs.rmSync(p, { force: true });
  }
  getDb().prepare("DELETE FROM exports WHERE id = ?").run(id);
}
