import { describe, expect, it } from "vitest";
import {
  captionAt,
  captionsFromScript,
  captionsFromSentences,
  chunkSentence,
  formatSrtTime,
  offsetCaptions,
  parseSrt,
  toSrt,
  tokenizeCaption,
} from "@/lib/shared/captions";

describe("chunkSentence", () => {
  it("splits into word groups that exactly cover the sentence span", () => {
    const caps = chunkSentence({ text: "The tomb had been sealed for three thousand years", start: 1, end: 4 }, 3);
    expect(caps.map((c) => c.text)).toEqual(["The tomb had", "been sealed for", "three thousand years"]);
    expect(caps[0].start).toBe(1);
    expect(caps.at(-1)!.end).toBe(4);
    for (let i = 1; i < caps.length; i++) expect(caps[i].start).toBeCloseTo(caps[i - 1].end, 3);
  });
  it("merges a dangling single word into the previous chunk", () => {
    const caps = chunkSentence({ text: "one two three four five", start: 0, end: 2 }, 4);
    expect(caps.map((c) => c.text)).toEqual(["one two three four five"]);
  });
});

describe("captionsFromScript", () => {
  it("spreads estimated timings across the full duration", () => {
    const caps = captionsFromScript("First sentence here. Second one is longer than the first.\n\nThird.", 10, 4);
    expect(caps[0].start).toBe(0);
    expect(caps.at(-1)!.end).toBeCloseTo(10, 3);
  });
  it("returns nothing for empty input", () => {
    expect(captionsFromScript("", 10, 3)).toEqual([]);
    expect(captionsFromScript("Hi.", 0, 3)).toEqual([]);
  });
});

describe("SRT", () => {
  it("formats times", () => {
    expect(formatSrtTime(0)).toBe("00:00:00,000");
    expect(formatSrtTime(3725.5)).toBe("01:02:05,500");
  });
  it("round-trips through toSrt/parseSrt", () => {
    const caps = captionsFromSentences([{ text: "Hello there friend", start: 0.5, end: 2.25 }], 2);
    const srt = toSrt(caps);
    expect(srt).toContain("1\n00:00:00,500 --> ");
    const parsed = parseSrt(srt);
    expect(parsed.map((c) => c.text)).toEqual(caps.map((c) => c.text));
    expect(parsed[0].start).toBeCloseTo(0.5, 3);
    expect(parsed.at(-1)!.end).toBeCloseTo(2.25, 3);
  });
  it("drops empty and zero-length captions and sorts", () => {
    const srt = toSrt([
      { id: "b", start: 2, end: 3, text: "second" },
      { id: "a", start: 0, end: 1, text: "first" },
      { id: "c", start: 4, end: 4, text: "zero" },
      { id: "d", start: 5, end: 6, text: "  " },
    ]);
    expect(parseSrt(srt).map((c) => c.text)).toEqual(["first", "second"]);
  });
});

describe("tokenizeCaption", () => {
  const style = { keywords: ["Pharaoh"], highlightNumbers: true, uppercase: true };
  it("highlights keywords case-insensitively and numbers", () => {
    const toks = tokenizeCaption("The pharaoh's tomb, 1922!", style).filter((t) => t.text.trim());
    expect(toks.map((t) => [t.text, t.highlight])).toEqual([
      ["THE", false],
      ["PHARAOH'S", false],
      ["TOMB,", false],
      ["1922!", true],
    ]);
    const toks2 = tokenizeCaption("A pharaoh, buried.", style).filter((t) => t.text.trim());
    expect(toks2.find((t) => t.text.startsWith("PHARAOH"))!.highlight).toBe(true);
  });
});

describe("offsetCaptions / captionAt", () => {
  it("shifts and clips", () => {
    const caps = offsetCaptions([{ id: "a", start: 0, end: 2, text: "x" }, { id: "b", start: 2, end: 4, text: "y" }], 1, 4);
    expect(caps).toEqual([
      { id: "a", start: 1, end: 3, text: "x" },
      { id: "b", start: 3, end: 4, text: "y" },
    ]);
    expect(captionAt(caps, 3.5)?.text).toBe("y");
    expect(captionAt(caps, 0.5)).toBeNull();
  });
});
