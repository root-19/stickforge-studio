import type { Caption, CaptionStyle, SentenceTiming } from "./types";
import { splitParagraphs, splitSentences } from "./script";

let idCounter = 0;
function captionId(): string {
  idCounter = (idCounter + 1) % 1e9;
  return `c${Date.now().toString(36)}${idCounter.toString(36)}`;
}

/** Character weight used to distribute time across words inside a sentence. */
function weightOf(text: string): number {
  return Math.max(1, text.replace(/\s+/g, "").length) + 2;
}

/**
 * Split a timed sentence into caption chunks of at most `wordsPerCaption` words.
 * Sentence start/end come from the synthesized audio; chunk boundaries inside the
 * sentence are ESTIMATED proportionally to character length.
 */
export function chunkSentence(s: SentenceTiming, wordsPerCaption: number): Caption[] {
  const words = s.text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const groups: string[] = [];
  for (let i = 0; i < words.length; i += wordsPerCaption) {
    groups.push(words.slice(i, i + wordsPerCaption).join(" "));
  }
  // Avoid a dangling single-word last chunk when possible.
  if (groups.length > 1 && groups[groups.length - 1].split(" ").length === 1 && wordsPerCaption > 2) {
    const last = groups.pop()!;
    groups[groups.length - 1] += " " + last;
  }
  const total = groups.reduce((n, g) => n + weightOf(g), 0);
  const span = Math.max(0.05, s.end - s.start);
  const out: Caption[] = [];
  let t = s.start;
  groups.forEach((g, i) => {
    const d = (weightOf(g) / total) * span;
    const end = i === groups.length - 1 ? s.end : t + d;
    out.push({ id: captionId(), start: round3(t), end: round3(end), text: g });
    t = end;
  });
  return out;
}

/** Build captions from measured sentence timings (absolute seconds). */
export function captionsFromSentences(sentences: SentenceTiming[], wordsPerCaption: number): Caption[] {
  return sentences.flatMap((s) => chunkSentence(s, wordsPerCaption));
}

/**
 * Build captions for a script when only the total audio duration is known.
 * All timings are estimated proportionally to text length.
 */
export function captionsFromScript(script: string, totalDuration: number, wordsPerCaption: number): Caption[] {
  const sentences = splitParagraphs(script).flatMap(splitSentences);
  if (sentences.length === 0 || totalDuration <= 0) return [];
  const total = sentences.reduce((n, s) => n + weightOf(s), 0);
  let t = 0;
  const timed: SentenceTiming[] = sentences.map((text) => {
    const d = (weightOf(text) / total) * totalDuration;
    const r = { text, start: t, end: t + d };
    t += d;
    return r;
  });
  return captionsFromSentences(timed, wordsPerCaption);
}

/** Shift and clip captions to the [0, maxEnd] range. */
export function offsetCaptions(captions: Caption[], offset: number, maxEnd?: number): Caption[] {
  return captions
    .map((c) => ({ ...c, start: round3(c.start + offset), end: round3(c.end + offset) }))
    .filter((c) => maxEnd === undefined || c.start < maxEnd)
    .map((c) => (maxEnd !== undefined && c.end > maxEnd ? { ...c, end: maxEnd } : c));
}

export function sortAndValidateCaptions(captions: Caption[]): Caption[] {
  return [...captions]
    .filter((c) => c.text.trim().length > 0 && c.end > c.start)
    .sort((a, b) => a.start - b.start);
}

function pad(n: number, w: number) {
  return String(n).padStart(w, "0");
}

export function formatSrtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms % 1000, 3)}`;
}

export function toSrt(captions: Caption[], uppercase = false): string {
  return (
    sortAndValidateCaptions(captions)
      .map((c, i) => {
        const text = uppercase ? c.text.toUpperCase() : c.text;
        return `${i + 1}\n${formatSrtTime(c.start)} --> ${formatSrtTime(c.end)}\n${text.trim()}\n`;
      })
      .join("\n") + (captions.length ? "" : "")
  );
}

export function parseSrtTime(s: string): number {
  const m = s.trim().match(/^(\d+):(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if (!m) throw new Error(`Invalid SRT time: ${s}`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, "0")) / 1000;
}

export function parseSrt(srt: string): Caption[] {
  const blocks = srt.replace(/\r\n?/g, "\n").trim().split(/\n\s*\n/);
  const out: Caption[] = [];
  for (const b of blocks) {
    const lines = b.split("\n");
    const timeIdx = lines.findIndex((l) => l.includes("-->"));
    if (timeIdx < 0) continue;
    const [a, z] = lines[timeIdx].split("-->");
    out.push({
      id: captionId(),
      start: parseSrtTime(a),
      end: parseSrtTime(z.trim().split(/\s+/)[0]),
      text: lines.slice(timeIdx + 1).join("\n").trim(),
    });
  }
  return out;
}

/** A word token with a flag telling the renderer whether to highlight it. */
export type CaptionToken = { text: string; highlight: boolean };

export function tokenizeCaption(text: string, style: Pick<CaptionStyle, "keywords" | "highlightNumbers" | "uppercase">): CaptionToken[] {
  const keywords = new Set(style.keywords.map((k) => k.trim().toLowerCase()).filter(Boolean));
  const shown = style.uppercase ? text.toUpperCase() : text;
  return shown.split(/(\s+)/).filter((t) => t.length > 0).map((tok) => {
    if (/^\s+$/.test(tok)) return { text: tok, highlight: false };
    const bare = tok.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").toLowerCase();
    const isNumber = style.highlightNumbers && /\p{N}/u.test(bare);
    return { text: tok, highlight: (bare !== "" && keywords.has(bare)) || isNumber };
  });
}

export function captionAt(captions: Caption[], t: number): Caption | null {
  for (const c of captions) if (t >= c.start && t < c.end) return c;
  return null;
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}
