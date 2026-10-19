import { describe, expect, it } from "vitest";
import { fitScenesToDuration, moveScene, placeScenes, sceneAt, splitSceneAt, timelineDuration, formatTimecode, formatBytes } from "@/lib/shared/timeline";
import { sceneSchema, type Scene } from "@/lib/shared/types";

const scene = (id: string, assetId: string, duration: number, trimStart = 0): Scene =>
  sceneSchema.parse({ id, assetId, duration, trimStart });

describe("timeline", () => {
  const scenes = [scene("a", "img", 3), scene("b", "vid", 5, 2), scene("c", "img", 2)];
  const isVideo = (id: string) => id === "vid";

  it("places scenes back to back", () => {
    const placed = placeScenes(scenes);
    expect(placed.map((s) => [s.start, s.end])).toEqual([[0, 3], [3, 8], [8, 10]]);
    expect(timelineDuration({ scenes })).toBe(10);
    expect(sceneAt(placed, 3)?.id).toBe("b");
    expect(sceneAt(placed, 99)?.id).toBe("c");
  });

  it("splits a video scene and advances the second half's trim", () => {
    const r = splitSceneAt(scenes, 4.5, isVideo, () => "b2")!;
    expect(r.scenes.map((s) => [s.id, s.duration, s.trimStart])).toEqual([
      ["a", 3, 0],
      ["b", 1.5, 2],
      ["b2", 3.5, 3.5],
      ["c", 2, 0],
    ]);
    expect(timelineDuration(r)).toBe(10);
  });

  it("splits an image scene without changing trim", () => {
    const r = splitSceneAt(scenes, 1, isVideo, () => "a2")!;
    expect(r.scenes.slice(0, 2).map((s) => [s.duration, s.trimStart])).toEqual([[1, 0], [2, 0]]);
  });

  it("refuses to split at an edge", () => {
    expect(splitSceneAt(scenes, 3, isVideo, () => "x")).toBeNull();
    expect(splitSceneAt(scenes, 3.05, isVideo, () => "x")).toBeNull();
  });

  it("moves scenes", () => {
    expect(moveScene(scenes, 0, 2).map((s) => s.id)).toEqual(["b", "c", "a"]);
    expect(moveScene(scenes, 0, 9)).toBe(scenes);
  });

  it("fits scenes to a target duration without overrunning video sources", () => {
    const src = (id: string) => (id === "vid" ? 8 : null); // video has 8s, trimStart 2 → max 6s
    const fitted = fitScenesToDuration(scenes, 20, src);
    expect(fitted[1].duration).toBeLessThanOrEqual(6);
    expect(timelineDuration({ scenes: fitted })).toBeCloseTo(20, 3);
  });

  it("formats", () => {
    expect(formatTimecode(65.5, 30)).toBe("01:05:15");
    expect(formatBytes(63_201_294)).toBe("60.3 MB");
  });
});
