import { describe, expect, it } from "vitest";
import { alternateWikimediaUrl, commercialFromLicense, isAllowedDownloadUrl, pickPexelsFile, stripHtml } from "@/lib/server/stock";
import { buildCardAss, stickFigurePaths } from "@/lib/server/templates";
import { TEMPLATES } from "@/lib/shared/templates";
import { VOICE_PRESETS } from "@/lib/shared/narration";
import { captionStyleSchema } from "@/lib/shared/types";

describe("stock helpers", () => {
  it("maps Commons licenses to commercial-use categories", () => {
    expect(commercialFromLicense("CC0")).toBe("allowed");
    expect(commercialFromLicense("Public domain")).toBe("allowed");
    expect(commercialFromLicense("CC BY 4.0")).toBe("attribution");
    expect(commercialFromLicense("CC BY-SA 3.0")).toBe("share-alike");
    expect(commercialFromLicense("CC BY-NC-SA 2.0")).toBe("non-commercial");
    expect(commercialFromLicense("CC BY-ND 4.0")).toBe("non-commercial");
    expect(commercialFromLicense("GFDL")).toBe("unclear");
  });
  it("only allows downloads from official media hosts over https", () => {
    expect(isAllowedDownloadUrl("https://upload.wikimedia.org/wikipedia/commons/a/b.webm")).toBe(true);
    expect(isAllowedDownloadUrl("https://videos.pexels.com/video-files/1/x.mp4")).toBe(true);
    expect(isAllowedDownloadUrl("https://images.pexels.com/photos/1/x.jpeg")).toBe(true);
    expect(isAllowedDownloadUrl("https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/x.jpg/1920px-x.jpg")).toBe(true);
    expect(isAllowedDownloadUrl("http://upload.wikimedia.org/x")).toBe(false);
    expect(isAllowedDownloadUrl("https://evil.example/x.mp4")).toBe(false);
    expect(isAllowedDownloadUrl("https://upload.wikimedia.org.evil.example/x")).toBe(false);
    expect(isAllowedDownloadUrl("file:///C:/Windows/win.ini")).toBe(false);
  });
  it("picks the Pexels MP4 closest to Full HD", () => {
    const f = pickPexelsFile({
      video_files: [
        { quality: "sd", file_type: "video/mp4", width: 640, height: 360, link: "a" },
        { quality: "hd", file_type: "video/mp4", width: 1920, height: 1080, link: "b" },
        { quality: "uhd", file_type: "video/mp4", width: 3840, height: 2160, link: "c" },
        { quality: "hls", file_type: "video/mp4", width: 1920, height: 1080, link: "d" },
      ],
    });
    expect(f?.link).toBe("b");
    expect(pickPexelsFile({ video_files: [{ quality: "sd", file_type: "video/mp4", width: 960, height: 540, link: "x" }] })?.link).toBe("x");
    expect(pickPexelsFile({ video_files: [] })).toBeNull();
  });
  it("alternates between Wikimedia hosts for thumbnails", () => {
    expect(alternateWikimediaUrl("https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/x.jpg/330px-x.jpg")).toBe("https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/x.jpg/330px-x.jpg");
    expect(alternateWikimediaUrl("https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/x.jpg/330px-x.jpg")).toBe("https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/x.jpg/330px-x.jpg");
    expect(alternateWikimediaUrl("https://upload.wikimedia.org/wikipedia/commons/a/ab/x.webm")).toBe("https://upload.wikimedia.org/wikipedia/commons/a/ab/x.webm");
  });
  it("strips HTML from Commons author fields", () => {
    expect(stripHtml('<a href="//commons.wikimedia.org/wiki/User:X">Ian &amp; Wendy</a>')).toBe("Ian & Wendy");
  });
});

describe("templates", () => {
  it("are all valid", () => {
    const ids = new Set<string>();
    for (const t of TEMPLATES) {
      expect(ids.has(t.id)).toBe(false);
      ids.add(t.id);
      expect(t.cards.length).toBeGreaterThan(0);
      expect(VOICE_PRESETS.some((p) => p.id === t.voicePresetId)).toBe(true);
      expect(() => captionStyleSchema.parse(t.caption)).not.toThrow();
      expect(t.script.trim().length).toBeGreaterThan(20);
      for (const c of t.colors) expect(c).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
    // Every ratio has at least one template.
    for (const a of ["9:16", "16:9", "1:1", "4:5"]) expect(TEMPLATES.some((t) => t.aspect === a)).toBe(true);
  });
  it("builds card ASS with title, subtitle and a stick figure", () => {
    const t = TEMPLATES[0];
    const ass = buildCardAss(t.cards[0], t, 1080, 1920);
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toContain("DID YOU KNOW?");
    expect(ass).toContain(t.cards[0].subtitle!);
    expect(ass).toMatch(/\\p1\}m 0 0 b/); // head drawing
    const landscape = buildCardAss(t.cards[0], t, 1920, 1080);
    expect(landscape).toContain("PlayResX: 1920");
  });
  it("draws every pose", () => {
    for (const pose of ["stand", "point", "think", "shrug"] as const) expect(stickFigurePaths(pose).body.split(" m ").length).toBeGreaterThan(4);
  });
});
