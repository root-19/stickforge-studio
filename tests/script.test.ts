import { describe, expect, it } from "vitest";
import {
  chunkLongSentence,
  cleanupScript,
  countCharacters,
  countWords,
  estimateDurationSeconds,
  hashString,
  splitParagraphs,
  splitSentences,
} from "@/lib/shared/script";

describe("script stats", () => {
  it("counts words including contractions, hyphens and numbers", () => {
    expect(countWords("In 1922, Howard Carter's team found a well-preserved tomb.")).toBe(9);
    expect(countWords("   ")).toBe(0);
  });
  it("counts characters by code point", () => {
    expect(countCharacters("héllo…")).toBe(6);
  });
  it("estimates duration from words, speed and pauses", () => {
    const text = Array(160).fill("word").join(" ") + ".";
    expect(estimateDurationSeconds(text, 1, 0, 0)).toBeCloseTo(60, 5);
    expect(estimateDurationSeconds(text, 2, 0, 0)).toBeCloseTo(30, 5);
    expect(estimateDurationSeconds("", 1)).toBe(0);
  });
});

describe("splitParagraphs", () => {
  it("splits on blank lines and joins wrapped lines", () => {
    expect(splitParagraphs("One\nline two.\r\n\r\n\nSecond para.\n\n  ")).toEqual(["One line two.", "Second para."]);
  });
});

describe("splitSentences", () => {
  it("splits on terminal punctuation", () => {
    expect(splitSentences("It was dark. Nobody knew! Why?")).toEqual(["It was dark.", "Nobody knew!", "Why?"]);
  });
  it("keeps abbreviations, initials and decimals together", () => {
    expect(splitSentences("Dr. Smith met Mr. J. Doe at 3.5 p.m. yesterday. Then he left.")).toEqual([
      "Dr. Smith met Mr. J. Doe at 3.5 p.m. yesterday.",
      "Then he left.",
    ]);
  });
  it("includes closing quotes with the sentence", () => {
    expect(splitSentences('He said "run!" Then silence.')).toEqual(['He said "run!"', "Then silence."]);
  });
  it("returns the remainder without punctuation", () => {
    expect(splitSentences("No ending here")).toEqual(["No ending here"]);
  });
});

describe("chunkLongSentence", () => {
  it("leaves short sentences alone", () => {
    expect(chunkLongSentence("Short one.")).toEqual(["Short one."]);
  });
  it("splits long sentences at commas then words, within the limit", () => {
    const s = "This is a long clause, " + "and another clause that keeps going, ".repeat(10) + "end.";
    const chunks = chunkLongSentence(s, 80);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(80);
    expect(chunks.join(" ").replace(/\s+/g, " ")).toBe(s.replace(/\s+/g, " ").trim());
  });
});

describe("cleanupScript", () => {
  it("fixes spacing and punctuation and reports changes, without touching the input", () => {
    const input = "  hello  world ,this is   great!!!\n\n\n\nwait...what?  ";
    const { text, changes } = cleanupScript(input);
    expect(text).toBe("Hello world, this is great!\n\nWait… what?");
    expect(changes.map((c) => c.rule)).toContain("Collapsed repeated spaces");
    expect(input).toBe("  hello  world ,this is   great!!!\n\n\n\nwait...what?  ");
  });
  it("is idempotent", () => {
    const once = cleanupScript("so.it  begins ,again").text;
    expect(cleanupScript(once).text).toBe(once);
    expect(cleanupScript(once).changes).toEqual([]);
  });
});

describe("hashString", () => {
  it("is stable and 16 hex chars", () => {
    expect(hashString("abc")).toMatch(/^[0-9a-f]{16}$/);
    expect(hashString("abc")).toBe(hashString("abc"));
    expect(hashString("abc")).not.toBe(hashString("abd"));
  });
});
