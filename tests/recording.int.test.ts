import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTempHome } from "./support/temp-home";
import { probeJson, testFfmpeg, testFfprobe } from "./support/media";
import { buildEnhanceFilter, enhanceOptionsSchema } from "@/lib/shared/recording";

const home = setupTempHome();
const ffmpeg = testFfmpeg();
afterAll(() => home.cleanup());

const ctx = { signal: new AbortController().signal, progress: () => undefined, throwIfCancelled: () => undefined };

describe("enhance filter", () => {
  it("builds the FFmpeg chain from options", () => {
    const all = buildEnhanceFilter(enhanceOptionsSchema.parse({ pitch: -2 }));
    expect(all).toContain("highpass=f=80");
    expect(all).toContain("afftdn");
    expect(all).toContain("rubberband=pitch=0.89090");
    expect(all).toContain("loudnorm=I=-16");
    expect(all.match(/silenceremove/g)).toHaveLength(2);
    expect(all.endsWith("aformat=sample_fmts=s16:channel_layouts=mono")).toBe(true);
    const none = buildEnhanceFilter(enhanceOptionsSchema.parse({ noise: false, rumble: false, level: false, trim: false }));
    expect(none).toBe("aresample=48000,aformat=sample_fmts=s16:channel_layouts=mono");
  });
});

describe.skipIf(!ffmpeg)("voice recordings (real FFmpeg)", () => {
  let projectId = "";
  let voiceLike = "";
  beforeAll(async () => {
    const { updateSettings } = await import("@/lib/server/settings");
    updateSettings({ projectsDir: path.join(home.dir, "Projects") });
    const { createProject } = await import("@/lib/server/projects");
    projectId = createProject({ name: "Rec test" }).id;
    // A "voice": 1 s silence, then a 120 Hz buzz with harmonics and pink-ish noise, then silence.
    voiceLike = path.join(home.dir, "mic.webm");
    const r = spawnSync(ffmpeg!, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "anoisesrc=d=6:c=pink:a=0.01",
      "-f", "lavfi", "-i", "aevalsrc='0.3*sin(2*PI*120*t)+0.15*sin(2*PI*240*t)+0.08*sin(2*PI*360*t)':d=4",
      "-filter_complex", "[1]adelay=1000[v];[0][v]amix=inputs=2:duration=first:normalize=0",
      "-c:a", "libopus", voiceLike,
    ]);
    expect(r.status).toBe(0);
  });

  it("stores, analyses, cleans up and saves a recording", async () => {
    const { saveRecording, enhancedFile, saveRecordingAsAsset, getRecording } = await import("@/lib/server/recordings");
    const body = new Blob([fs.readFileSync(voiceLike)]).stream();
    const rec = await saveRecording(projectId, body, "audio/webm;codecs=opus");
    expect(rec.id).toMatch(/^rec_/);
    expect(rec.duration).toBeCloseTo(6, 0);
    expect(rec.features!.f0).toBeGreaterThan(110);
    expect(rec.features!.f0).toBeLessThan(130);
    expect(getRecording(projectId, rec.id).id).toBe(rec.id);

    const opts = enhanceOptionsSchema.parse({ pitch: -4 });
    const out = await enhancedFile(projectId, rec.id, opts);
    const info = probeJson(testFfprobe()!, out);
    expect(info.streams[0]).toMatchObject({ codec_name: "pcm_s16le", sample_rate: "48000" });
    // Silence at both ends was trimmed (6 s → about 4 s of voice).
    expect(Number(info.format.duration)).toBeLessThan(5);
    // Pitch moved down by about 4 semitones (120 Hz → ~95 Hz).
    const { analyzeFile } = await import("@/lib/server/audio-analysis");
    const after = await analyzeFile(out);
    expect(after.f0).toBeGreaterThan(85);
    expect(after.f0).toBeLessThan(105);
    // Same options → cached file reused.
    expect(await enhancedFile(projectId, rec.id, opts)).toBe(out);

    const asset = await saveRecordingAsAsset(projectId, rec.id, opts, "My voice take 1");
    expect(asset).toMatchObject({ kind: "audio", storage: "managed", name: "My voice take 1.wav" });
    expect(fs.existsSync(asset.path)).toBe(true);
  }, 120_000);

  it("rejects unsupported formats and empty audio", async () => {
    const { saveRecording } = await import("@/lib/server/recordings");
    await expect(saveRecording(projectId, new Blob(["x"]).stream(), "text/plain")).rejects.toThrow(/Unsupported/);
    await expect(saveRecording(projectId, new Blob(["x"]).stream(), "audio/webm")).rejects.toThrow(/empty/);
  });

  it("ranks catalog voices by similarity (using cached voice fingerprints)", async () => {
    const { appHome } = await import("@/lib/server/env");
    // Pre-measured fingerprints so the test needs no internet.
    fs.writeFileSync(
      path.join(appHome(), "voice-features.json"),
      JSON.stringify({
        "en_US-joe-medium": { f0: 100.9, f0Spread: 3.57, centroid: 1192, voicedRatio: 0.36, seconds: 7 },
        "en_US-john-medium": { f0: 116.8, f0Spread: 3.41, centroid: 1201, voicedRatio: 0.49, seconds: 11 },
        "en_US-norman-medium": { f0: 103.2, f0Spread: 3.22, centroid: 959, voicedRatio: 0.45, seconds: 10 },
        "en_US-kristin-medium": { f0: 173.9, f0Spread: 3.9, centroid: 1052, voicedRatio: 0.53, seconds: 8 },
        "en_US-ljspeech-high": { f0: 190, f0Spread: 4, centroid: 1300, voicedRatio: 0.5, seconds: 8 },
        "en_GB-cori-medium": { f0: 185, f0Spread: 4, centroid: 1250, voicedRatio: 0.5, seconds: 8 },
        "en_GB-northern_english_male-medium": { f0: 110, f0Spread: 3.4, centroid: 1150, voicedRatio: 0.5, seconds: 8 },
      }),
    );
    const { matchVoices } = await import("@/lib/server/voice-match");
    const maleish = { f0: 115, f0Spread: 3.4, centroid: 1180, voicedRatio: 0.5, seconds: 10 };
    // Restrict to voices we have fingerprints for by giving the catalog filter a region and checking order only.
    const us = await matchVoices(maleish, { region: "en_US", commercialOnly: true, limit: 100 }, ctx);
    const usTop = us.matches.filter((m) => ["en_US-joe-medium", "en_US-john-medium", "en_US-norman-medium", "en_US-kristin-medium"].includes(m.key));
    expect(usTop[0].key).toBe("en_US-john-medium");
    expect(usTop.at(-1)!.key).toBe("en_US-kristin-medium");
    const uk = await matchVoices(maleish, { region: "en_GB", commercialOnly: false, limit: 100 }, ctx);
    const ukKnown = uk.matches.filter((m) => m.key.startsWith("en_GB-cori") || m.key.startsWith("en_GB-northern"));
    expect(ukKnown[0].key).toBe("en_GB-northern_english_male-medium");
    expect(uk.matches.every((m) => m.languageCode === "en_GB")).toBe(true);
  }, 300_000);
});
