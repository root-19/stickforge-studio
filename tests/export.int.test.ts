import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTempHome } from "./support/temp-home";
import { makeTestMedia, probeJson, testFfmpeg, testFfprobe } from "./support/media";

const home = setupTempHome();
const ffmpeg = testFfmpeg();
const ffprobe = testFfprobe();

afterAll(() => home.cleanup());

async function waitForJob(getJob: (id: string) => { status: string; error: string | null } | null, id: string, timeoutMs = 240_000) {
  const start = Date.now();
  for (;;) {
    const j = getJob(id);
    if (j && j.status !== "queued" && j.status !== "running") return j;
    if (Date.now() - start > timeoutMs) throw new Error("timeout waiting for job");
    await new Promise((r) => setTimeout(r, 250));
  }
}

describe.skipIf(!ffmpeg)("vertical export (real FFmpeg)", () => {
  let mods: {
    projects: typeof import("@/lib/server/projects");
    assets: typeof import("@/lib/server/assets");
    exporter: typeof import("@/lib/server/exporter");
    jobs: typeof import("@/lib/server/jobs");
    settings: typeof import("@/lib/server/settings");
  };
  let media: ReturnType<typeof makeTestMedia>;
  const mediaDir = path.join(home.dir, "Media With Spaces & 'Quotes'");

  beforeAll(async () => {
    mods = {
      projects: await import("@/lib/server/projects"),
      assets: await import("@/lib/server/assets"),
      exporter: await import("@/lib/server/exporter"),
      jobs: await import("@/lib/server/jobs"),
      settings: await import("@/lib/server/settings"),
    };
    fs.mkdirSync(mediaDir, { recursive: true });
    mods.settings.updateSettings({ projectsDir: path.join(home.dir, "Projects"), mediaFolders: [mediaDir] });
    media = makeTestMedia(ffmpeg!, mediaDir);
  });

  it("renders 1080x1920 30fps H.264/AAC with burned captions, narration, ducked music and an SRT", async () => {
    const { projects, assets, exporter, jobs } = mods;
    const p = projects.createProject({ name: "Export Test" });
    const v = await assets.importLinked(p.id, media.landscapeVideo);
    const img = await assets.importLinked(p.id, media.portraitImage);
    const sq = await assets.importLinked(p.id, media.squareImage);
    const nar = await assets.importLinked(p.id, media.tone);
    const mus = await assets.importLinked(p.id, media.music);
    const sizesBefore = [media.landscapeVideo, media.portraitImage, media.squareImage, media.tone, media.music].map((f) => fs.readFileSync(f));

    projects.saveProjectState(p.id, {
      scenes: [
        { id: "s1", assetId: v.id, duration: 2, trimStart: 0.5, fit: "blur", clipMuted: false, clipVolume: 0.5 },
        { id: "s2", assetId: img.id, duration: 1.5, fit: "cover", motion: "zoomIn" },
        { id: "s3", assetId: sq.id, duration: 1, fit: "contain" },
      ],
      narration: { assetId: nar.id, volume: 1, muted: false, offset: 0.2 },
      music: { assetId: mus.id, volume: 0.3, muted: false, loop: true, duck: true, fadeOut: 1 },
      captions: {
        enabled: true,
        timing: "manual",
        items: [
          { id: "c1", start: 0, end: 1.5, text: "In 1922 the tomb opened" },
          { id: "c2", start: 1.5, end: 4.5, text: "And {nothing} was the same" },
        ],
        style: { keywords: ["tomb"] },
      },
    });

    const { record } = exporter.startExport({ projectId: p.id, preset: "youtube-shorts", quality: "small", burnCaptions: true, writeSrt: true });
    const job = await waitForJob(jobs.getJob, record.id);
    expect(job.error).toBeNull();
    expect(job.status).toBe("done");

    const rec = exporter.getExport(record.id);
    expect(rec.status).toBe("done");
    expect(rec.fileExists).toBe(true);
    expect(path.dirname(rec.outputPath)).toBe(path.join(p.folder, "exports"));
    const info = probeJson(ffprobe!, rec.outputPath);
    const vs = info.streams.find((s) => s.codec_type === "video")!;
    const as = info.streams.find((s) => s.codec_type === "audio")!;
    expect(vs).toMatchObject({ codec_name: "h264", width: 1080, height: 1920, r_frame_rate: "30/1", pix_fmt: "yuv420p" });
    expect(as).toMatchObject({ codec_name: "aac", sample_rate: "48000" });
    expect(Number(info.format.duration)).toBeCloseTo(4.5, 0);
    expect(fs.readFileSync(rec.srtPath!, "utf8")).toContain("00:00:01,500 --> 00:00:04,500\nAND {NOTHING} WAS THE SAME");

    // Sources untouched.
    [media.landscapeVideo, media.portraitImage, media.squareImage, media.tone, media.music].forEach((f, i) =>
      expect(fs.readFileSync(f).equals(sizesBefore[i])).toBe(true),
    );

    // A second export never overwrites the first.
    const second = exporter.startExport({ projectId: p.id, preset: "facebook-reels", quality: "small", burnCaptions: false, writeSrt: false, fileName: path.basename(rec.outputPath) });
    expect(second.record.outputPath).not.toBe(rec.outputPath);
    const j2 = await waitForJob(jobs.getJob, second.record.id);
    expect(j2.status).toBe("done");
  }, 300_000);

  it("exports a 16:9 project as a 1440p YouTube video", async () => {
    const { projects, assets, exporter, jobs } = mods;
    const p = projects.createProject({ name: "Landscape", aspect: "16:9" });
    expect(p.state.aspect).toBe("16:9");
    expect(p.state.captions.style.positionY).toBeCloseTo(0.84);
    const img = await assets.importLinked(p.id, media.portraitImage);
    const v = await assets.importLinked(p.id, media.landscapeVideo);
    projects.saveProjectState(p.id, {
      ...p.state,
      scenes: [
        { id: "a", assetId: v.id, duration: 1.5, fit: "cover" },
        { id: "b", assetId: img.id, duration: 1, fit: "blur" },
      ],
      captions: { ...p.state.captions, items: [{ id: "c", start: 0, end: 2, text: "Landscape caption" }] },
    });
    const { record, warnings } = exporter.startExport({ projectId: p.id, preset: "youtube", resolution: "1440", quality: "small" });
    expect(warnings).toEqual([]);
    expect(record).toMatchObject({ width: 2560, height: 1440 });
    const job = await waitForJob(jobs.getJob, record.id);
    expect(job.error).toBeNull();
    const vs = probeJson(ffprobe!, record.outputPath).streams.find((s) => s.codec_type === "video")!;
    expect(vs).toMatchObject({ width: 2560, height: 1440, codec_name: "h264" });
  }, 180_000);

  it("can be cancelled and cleans up the partial file", async () => {
    const { projects, assets, exporter, jobs } = mods;
    const p = projects.createProject({ name: "Cancel Test" });
    const img = await assets.importLinked(p.id, media.portraitImage);
    projects.saveProjectState(p.id, { scenes: [{ id: "s1", assetId: img.id, duration: 120, motion: "zoomOut" }] });
    const { record } = exporter.startExport({ projectId: p.id, preset: "custom", width: 1080, height: 1920, fps: 30, quality: "high", burnCaptions: false, writeSrt: false });
    await new Promise((r) => setTimeout(r, 1500));
    exporter.cancelExport(record.id);
    const job = await waitForJob(jobs.getJob, record.id, 30_000);
    expect(job.status).toBe("cancelled");
    expect(fs.existsSync(record.outputPath)).toBe(false);
    expect(exporter.getExport(record.id).status).toBe("cancelled");
  }, 60_000);

  it("marks exports left running by a closed app as interrupted and removes the partial file", async () => {
    const { exporter } = mods;
    const { getDb } = await import("@/lib/server/db");
    const partial = path.join(home.dir, "partial.mp4");
    fs.writeFileSync(partial, "half a video");
    getDb()
      .prepare("INSERT INTO exports (id, project_id, project_name, status, progress, preset, width, height, fps, output_path, srt_path, duration, error, created_at, finished_at) VALUES ('exp_ghost', 'p', 'Ghost', 'running', 0.4, 'youtube-shorts', 1080, 1920, 30, ?, NULL, 10, NULL, ?, NULL)")
      .run(partial, new Date().toISOString());
    exporter.recoverInterruptedExports();
    const rec = exporter.getExport("exp_ghost");
    expect(rec.status).toBe("error");
    expect(rec.error).toMatch(/Interrupted/);
    expect(fs.existsSync(partial)).toBe(false);
  });

  it("reports missing media clearly", async () => {
    const { projects, assets, exporter } = mods;
    const p = projects.createProject({ name: "Missing" });
    const gone = path.join(mediaDir, "gone.png");
    fs.copyFileSync(media.portraitImage, gone);
    const a = await assets.importLinked(p.id, gone);
    projects.saveProjectState(p.id, { scenes: [{ id: "s1", assetId: a.id, duration: 1 }] });
    fs.rmSync(gone);
    expect(() => exporter.startExport({ projectId: p.id, preset: "youtube-shorts", quality: "small", burnCaptions: false, writeSrt: false })).toThrow(/missing: gone.png/);
  });
});
