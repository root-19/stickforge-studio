import { describe, expect, it } from "vitest";
import { ASPECT_IDS, EXPORT_PRESETS, outputSize, projectStateSchema } from "@/lib/shared/types";
import { captionLayout } from "@/lib/server/ffmpeg/ass";
import { captionStyleSchema } from "@/lib/shared/types";

describe("ratios and export sizes", () => {
  it("computes standard sizes", () => {
    expect(outputSize("9:16", "1080")).toEqual({ width: 1080, height: 1920 });
    expect(outputSize("9:16", "1440")).toEqual({ width: 1440, height: 2560 });
    expect(outputSize("9:16", "2160")).toEqual({ width: 2160, height: 3840 });
    expect(outputSize("16:9", "1080")).toEqual({ width: 1920, height: 1080 });
    expect(outputSize("16:9", "2160")).toEqual({ width: 3840, height: 2160 });
    expect(outputSize("1:1", "1440")).toEqual({ width: 1440, height: 1440 });
    expect(outputSize("4:5", "1080")).toEqual({ width: 1080, height: 1350 });
  });
  it("always produces even dimensions (required by H.264 yuv420p)", () => {
    for (const a of ASPECT_IDS) for (const r of ["1080", "1440", "2160"] as const) {
      const s = outputSize(a, r);
      expect(s.width % 2).toBe(0);
      expect(s.height % 2).toBe(0);
    }
  });
  it("has a preset for every ratio", () => {
    for (const a of ASPECT_IDS) expect(Object.values(EXPORT_PRESETS).some((p) => p.aspect === a)).toBe(true);
  });
  it("defaults old projects to 9:16", () => {
    expect(projectStateSchema.parse({ scenes: [] }).aspect).toBe("9:16");
  });
  it("scales captions by the short side so they match across ratios and sizes", () => {
    const style = captionStyleSchema.parse({ fontSize: 84 });
    expect(captionLayout(style, 1080, 1920).fontSize).toBe(84);
    expect(captionLayout(style, 1920, 1080).fontSize).toBe(84);
    expect(captionLayout(style, 2160, 3840).fontSize).toBe(168);
  });
});
