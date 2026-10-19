import { describe, expect, it } from "vitest";
import { combinedSentenceTimings, reconcileSegments, refreshStatus, segmentAudioHash, VOICE_PRESETS } from "@/lib/shared/narration";
import { voiceSettingsSchema, type NarrationSegment } from "@/lib/shared/types";

const settings = voiceSettingsSchema.parse({ voiceKey: "en_US-joe-medium" });
let n = 0;
const makeId = () => `seg${++n}`;

describe("reconcileSegments", () => {
  it("keeps generated audio for unchanged paragraphs and marks new ones pending", () => {
    const first = reconcileSegments([], "Para one.\n\nPara two.", settings, makeId);
    const ready: NarrationSegment[] = first.map((s) => ({ ...s, audioHash: segmentAudioHash(s.text, settings), duration: 1, status: "ready" }));
    const next = reconcileSegments(ready, "Para one.\n\nPara two changed.\n\nPara three.", settings, makeId);
    expect(next[0]).toMatchObject({ id: ready[0].id, status: "ready" });
    expect(next[1]).toMatchObject({ status: "pending", audioHash: null });
    expect(next[2].status).toBe("pending");
  });

  it("follows reordered paragraphs", () => {
    const a = reconcileSegments([], "A.\n\nB.", settings, makeId).map((s) => ({ ...s, audioHash: segmentAudioHash(s.text, settings), status: "ready" as const }));
    const swapped = reconcileSegments(a, "B.\n\nA.", settings, makeId);
    expect(swapped.map((s) => s.id)).toEqual([a[1].id, a[0].id]);
  });

  it("marks audio stale when a real voice setting changes", () => {
    const seg: NarrationSegment = { id: "x", text: "Hi.", audioHash: segmentAudioHash("Hi.", settings), duration: 1, sentences: [], status: "ready" };
    expect(refreshStatus(seg, settings).status).toBe("ready");
    expect(refreshStatus(seg, { ...settings, speed: 1.2 }).status).toBe("stale");
    // Paragraph pause only affects how segments are joined, not the segment audio.
    expect(refreshStatus(seg, { ...settings, paragraphPause: 2 }).status).toBe("ready");
  });
});

describe("combinedSentenceTimings", () => {
  it("offsets sentences by previous segment durations and paragraph pauses", () => {
    const segs: NarrationSegment[] = [
      { id: "1", text: "", audioHash: "a", duration: 2, sentences: [{ text: "s1", start: 0, end: 2 }], status: "ready" },
      { id: "2", text: "", audioHash: "b", duration: 3, sentences: [{ text: "s2", start: 0, end: 1 }, { text: "s3", start: 1.2, end: 3 }], status: "ready" },
    ];
    expect(combinedSentenceTimings(segs, 0.5)).toEqual([
      { text: "s1", start: 0, end: 2 },
      { text: "s2", start: 2.5, end: 3.5 },
      { text: "s3", start: 3.7, end: 5.5 },
    ]);
  });
});

describe("presets", () => {
  it("only contain valid real settings", () => {
    for (const p of VOICE_PRESETS) expect(() => voiceSettingsSchema.parse({ voiceKey: "x", ...p.values })).not.toThrow();
    expect(VOICE_PRESETS[0].values.speed).toBe(1.05);
  });
});
