import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { setupTempHome } from "./support/temp-home";

/**
 * Real Piper synthesis. Needs an installed voice: set STICKFORGE_TEST_VOICES_DIR
 * to a folder containing en_US-joe-medium (or install it once in the app; the
 * default app voice folder is used otherwise). Skipped when no voice is found.
 */
const VOICE = "en_US-joe-medium";
const candidates = [
  process.env.STICKFORGE_TEST_VOICES_DIR,
  path.join(process.env.LOCALAPPDATA ?? "", "StickForgeStudio", "voices"),
].filter((d): d is string => !!d);
const voicesDir = candidates.find((d) => fs.existsSync(path.join(d, VOICE, `${VOICE}.onnx`)) || fs.existsSync(path.join(d, `${VOICE}.onnx`)));

const home = setupTempHome();
afterAll(() => home.cleanup());

describe.skipIf(!voicesDir)(`Piper TTS with ${VOICE}`, () => {
  it("phonemizes and synthesizes speech; speed really changes duration", async () => {
    const { updateSettings } = await import("@/lib/server/settings");
    updateSettings({ voicesDir: voicesDir! });
    const { findInstalledVoice, modelPathFor } = await import("@/lib/server/tts/voices");
    const { loadVoice, synthesizeTexts, phonemize } = await import("@/lib/server/tts/piper");
    const v = findInstalledVoice(VOICE)!;
    expect(v).toBeTruthy();
    expect(v.sampleRate).toBe(22050);
    const ph = await phonemize(["Hello world.", "Roanoke, 1587!"], "en-us");
    expect(ph).toHaveLength(2);
    expect(ph[0].join("")).toContain("h");
    const voice = await loadVoice(v.key, modelPathFor(v));
    const text = ["The colony vanished without a trace, leaving only one carved word behind."];
    const [slow] = await synthesizeTexts(voice, text, { speakerId: 0, speed: 0.8, noiseScale: 0.667, noiseW: 0.8 });
    const [fast] = await synthesizeTexts(voice, text, { speakerId: 0, speed: 1.5, noiseScale: 0.667, noiseW: 0.8 });
    const secs = (pcm: Float32Array) => pcm.length / 22050;
    expect(secs(slow)).toBeGreaterThan(2);
    expect(secs(fast)).toBeLessThan(secs(slow) * 0.75);
    let peak = 0;
    for (const s of slow) peak = Math.max(peak, Math.abs(s));
    expect(peak).toBeGreaterThan(0.05); // not silence
  }, 120_000);

  it("detects custom Piper voices dropped directly into the voices folder", async () => {
    const { updateSettings } = await import("@/lib/server/settings");
    const { listInstalledVoices } = await import("@/lib/server/tts/voices");
    const src = fs.existsSync(path.join(voicesDir!, VOICE)) ? path.join(voicesDir!, VOICE) : voicesDir!;
    const custom = path.join(home.dir, "custom-voices");
    fs.mkdirSync(custom, { recursive: true });
    fs.copyFileSync(path.join(src, `${VOICE}.onnx.json`), path.join(custom, "my_narrator.onnx.json"));
    fs.writeFileSync(path.join(custom, "my_narrator.onnx"), "placeholder"); // detection reads only the config
    fs.writeFileSync(path.join(custom, "orphan.onnx"), "no config next to it");
    updateSettings({ voicesDir: custom });
    const found = listInstalledVoices();
    expect(found.map((v) => v.key)).toEqual(["my_narrator"]);
    expect(found[0].catalog).toBeNull();
    updateSettings({ voicesDir: voicesDir! });
  });

  it("generates a narration with per-paragraph audio and measured sentence timings", async () => {
    const { createProject } = await import("@/lib/server/projects");
    const { createNarration, generateNarration, getNarration, narrationTimings, updateNarration, segmentFile } = await import("@/lib/server/narrations");
    const { decodeWav } = await import("@/lib/server/tts/wav");
    const { voiceSettingsSchema } = await import("@/lib/shared/types");
    const p = createProject({ name: "TTS test" });
    const settings = voiceSettingsSchema.parse({ voiceKey: VOICE, sentencePause: 0.3, paragraphPause: 0.6 });
    const n = createNarration(p.id, { script: "First sentence here. Second one!\n\nA new paragraph.", settings });
    const ctx = { signal: new AbortController().signal, progress: () => undefined, throwIfCancelled: () => undefined };
    await generateNarration(n.id, null, ctx);
    const done = getNarration(n.id);
    expect(done.segments.every((s) => s.status === "ready")).toBe(true);
    expect(done.combinedHash).toMatch(/^[0-9a-f]{16}$/);
    const t = narrationTimings(done);
    expect(t.map((x) => x.text)).toEqual(["First sentence here.", "Second one!", "A new paragraph."]);
    // Sentence pause inside the paragraph, paragraph pause between paragraphs.
    expect(t[1].start - t[0].end).toBeCloseTo(0.3, 2);
    expect(t[2].start - t[1].end).toBeCloseTo(0.6, 2);
    expect(done.duration).toBeCloseTo(t[2].end, 2);
    const seg0 = decodeWav(fs.readFileSync(segmentFile(done, done.segments[0].audioHash!)));
    expect(seg0.samples.length / seg0.sampleRate).toBeCloseTo(done.segments[0].duration!, 2);

    // Editing one paragraph only invalidates that paragraph.
    const edited = updateNarration(n.id, { script: "First sentence here. Second one!\n\nA changed paragraph." });
    expect(edited.segments.map((s) => s.status)).toEqual(["ready", "pending"]);
    expect(edited.combinedHash).toBeNull();
  }, 120_000);
});
