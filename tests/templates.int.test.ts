import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTempHome } from "./support/temp-home";
import { probeJson, testFfmpeg, testFfprobe } from "./support/media";

const home = setupTempHome();
const ffmpeg = testFfmpeg();
afterAll(() => home.cleanup());

const noopCtx = { signal: new AbortController().signal, progress: () => undefined, throwIfCancelled: () => undefined };

describe.skipIf(!ffmpeg)("templates (real FFmpeg)", () => {
  beforeAll(async () => {
    const { updateSettings } = await import("@/lib/server/settings");
    updateSettings({ projectsDir: path.join(home.dir, "Projects") });
  });

  it.each([
    ["did-you-know", undefined, 1080, 1920],
    ["documentary-explainer", undefined, 1920, 1080],
    ["did-you-know", "1:1", 1080, 1080],
  ] as const)("creates a project from %s (%s)", async (id, aspect, w, h) => {
    const { createFromTemplate } = await import("@/lib/server/templates");
    const { listAssets } = await import("@/lib/server/assets");
    const { listNarrations } = await import("@/lib/server/narrations");
    const { getTemplate } = await import("@/lib/shared/templates");
    const t = getTemplate(id)!;
    const p = await createFromTemplate(id, { aspect });
    expect(p.state.aspect).toBe(aspect ?? t.aspect);
    expect(p.state.scenes).toHaveLength(t.cards.length);
    const assets = listAssets(p.id);
    expect(assets).toHaveLength(t.cards.length);
    for (const a of assets) {
      expect(a.kind).toBe("image");
      expect(fs.existsSync(a.path)).toBe(true);
      expect([a.width, a.height]).toEqual([w, h]);
      expect(a.hasThumbnail).toBe(true);
    }
    const nar = listNarrations(p.id);
    expect(nar).toHaveLength(1);
    expect(nar[0].script).toBe(t.script);
    expect(p.state.narrationId).toBe(nar[0].id);
    expect(p.state.captions.style.font).toBe(t.caption.font ?? "Arial Black");
  }, 120_000);
});

/** Live network test against Wikimedia Commons. Opt-in: STICKFORGE_NETWORK_TESTS=1 */
describe.skipIf(!ffmpeg || process.env.STICKFORGE_NETWORK_TESTS !== "1")("Wikimedia Commons (live)", () => {
  it("searches, downloads a CC0/PD image and a video with credits", async () => {
    const { searchStock, importStock } = await import("@/lib/server/stock");
    const { createProject } = await import("@/lib/server/projects");
    const { projectCredits } = await import("@/lib/server/assets");
    const p = createProject({ name: "Stock test" });

    const images = await searchStock("commons", "image", "Great Pyramid of Giza", "any", 1);
    expect(images.items.length).toBeGreaterThan(0);
    const img = images.items.find((i) => i.commercialUse === "allowed" || i.commercialUse === "attribution") ?? images.items[0];
    const a1 = await importStock(p.id, "commons", "image", img.id, noopCtx);
    expect(a1.kind).toBe("image");
    expect(Math.max(a1.width!, a1.height!)).toBeLessThanOrEqual(1920 * 2);
    expect(a1.source?.pageUrl).toContain("commons.wikimedia.org");

    const videos = await searchStock("commons", "video", "Giza pyramid flyover", "any", 1);
    expect(videos.items.length).toBeGreaterThan(0);
    const vid = [...videos.items].sort((a, b) => (a.sizeBytes ?? 1e12) - (b.sizeBytes ?? 1e12))[0];
    const a2 = await importStock(p.id, "commons", "video", vid.id, noopCtx);
    expect(a2.kind).toBe("video");
    expect([".mp4", ".webm"]).toContain(path.extname(a2.path));
    const v = probeJson(testFfprobe()!, a2.path).streams.find((s) => s.codec_type === "video");
    expect(v).toBeTruthy();

    const credits = projectCredits(p.id);
    expect(credits.lines).toHaveLength(2);
    expect(credits.lines[0]).toMatch(/Wikimedia Commons/);
  }, 300_000);
});
