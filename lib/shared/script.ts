/**
 * Pure script-preparation helpers shared by the Voice Studio UI and the TTS service.
 * Nothing here mutates the user's script; callers decide whether to apply results.
 */

/** Average narration pace for energetic documentary delivery at speed 1.0. */
export const BASE_WORDS_PER_MINUTE = 160;

export function countWords(text: string): number {
  const m = text.trim().match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu);
  return m ? m.length : 0;
}

export function countCharacters(text: string): number {
  return [...text].length;
}

/**
 * Estimate narration seconds from word count, speed and pauses.
 * This is an estimate only; real duration comes from the generated audio.
 */
export function estimateDurationSeconds(
  text: string,
  speed = 1,
  sentencePause = 0.25,
  paragraphPause = 0.5,
): number {
  const words = countWords(text);
  if (words === 0) return 0;
  const speech = (words / (BASE_WORDS_PER_MINUTE * speed)) * 60;
  const paragraphs = splitParagraphs(text);
  const sentences = paragraphs.reduce((n, p) => n + splitSentences(p).length, 0);
  return speech + sentences * sentencePause + Math.max(0, paragraphs.length - 1) * paragraphPause;
}

/** Split on blank lines. Single line breaks inside a paragraph are kept as spaces. */
export function splitParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter((p) => p.length > 0);
}

const ABBREVIATIONS = [
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "mt", "vs", "etc", "e.g", "i.e",
  "u.s", "u.k", "a.m", "p.m", "no", "gen", "col", "lt", "capt", "sgt", "jan", "feb",
  "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec", "approx", "ca",
];

/**
 * Split a paragraph into sentences. Handles common abbreviations, decimals,
 * initials and closing quotes/brackets after terminal punctuation.
 */
export function splitSentences(paragraph: string): string[] {
  const text = paragraph.replace(/\s+/g, " ").trim();
  if (!text) return [];
  const out: string[] = [];
  let start = 0;
  const re = /([.!?…]+)(["'”’)\]]*)(\s+|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const end = m.index + m[1].length + m[2].length;
    const before = text.slice(start, m.index);
    const lastWord = (before.match(/([\p{L}.]+)$/u)?.[1] ?? "").toLowerCase();
    const isAbbrev = m[1] === "." && (ABBREVIATIONS.includes(lastWord) || /^\p{L}$/u.test(lastWord));
    const nextChar = text.charAt(m.index + m[0].length);
    const nextIsLower = nextChar !== "" && /\p{Ll}/u.test(nextChar);
    if (m[3] === "" || (!isAbbrev && !nextIsLower)) {
      const s = text.slice(start, end).trim();
      if (s) out.push(s);
      start = m.index + m[0].length;
    }
  }
  const rest = text.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

/**
 * Break very long sentences at commas/semicolons so each TTS call stays short.
 * Piper handles long input, but shorter chunks give finer caption timing.
 */
export function chunkLongSentence(sentence: string, maxChars = 220): string[] {
  if (sentence.length <= maxChars) return [sentence];
  const parts = sentence.split(/(?<=[,;:—–])\s+/);
  const chunks: string[] = [];
  let current = "";
  for (const part of parts) {
    if (current && (current + " " + part).length > maxChars) {
      chunks.push(current);
      current = part;
    } else {
      current = current ? `${current} ${part}` : part;
    }
  }
  if (current) chunks.push(current);
  // Hard-wrap anything still too long at word boundaries.
  return chunks.flatMap((c) => {
    if (c.length <= maxChars) return [c];
    const words = c.split(" ");
    const res: string[] = [];
    let cur = "";
    for (const w of words) {
      if (cur && (cur + " " + w).length > maxChars) {
        res.push(cur);
        cur = w;
      } else cur = cur ? `${cur} ${w}` : w;
    }
    if (cur) res.push(cur);
    return res;
  });
}

export type CleanupChange = { rule: string; count: number };

/**
 * Basic punctuation and spacing cleanup. Returns the proposed text and a list
 * of what changed so the UI can show it before the user applies it.
 */
export function cleanupScript(text: string): { text: string; changes: CleanupChange[] } {
  const changes: CleanupChange[] = [];
  let t = text;
  const apply = (rule: string, re: RegExp, rep: string | ((substring: string, ...args: string[]) => string)) => {
    let count = 0;
    t = t.replace(re, (...args) => {
      count++;
      return typeof rep === "string"
        ? rep.replace(/\$(\d)/g, (_s, d) => args[Number(d)] ?? "")
        : rep(...(args as [string, ...string[]]));
    });
    if (count) changes.push({ rule, count });
  };
  apply("Normalized line endings", /\r\n?/g, "\n");
  apply("Replaced tabs and non-breaking spaces", /[\t ]/g, " ");
  apply("Removed trailing spaces", /[ ]+\n/g, "\n");
  apply("Collapsed repeated spaces", / {2,}/g, " ");
  apply("Removed space before punctuation", / +([,.;:!?])/g, "$1");
  apply("Added space after punctuation", /([,;:!?])(?=[A-Za-z])/g, "$1 ");
  apply("Added space after sentence period", /([a-z])\.(?=[A-Z][a-z])/g, "$1. ");
  apply("Converted '...' to an ellipsis", /\.{3,}/g, "…");
  apply("Added space after ellipsis", /…(?=[A-Za-z])/g, "… ");
  apply("Reduced repeated punctuation", /([!?]){2,}/g, "$1");
  apply("Collapsed extra blank lines", /\n{3,}/g, "\n\n");
  const trimmed = t.trim();
  if (trimmed !== t) {
    changes.push({ rule: "Trimmed leading/trailing whitespace", count: 1 });
    t = trimmed;
  }
  apply("Capitalized sentence starts", /(^|[.!?]\s+|\n\s*)([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase());
  return { text: t, changes };
}

/** Stable small hash (FNV-1a, hex) used for cache keys of generated audio. */
export function hashString(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let h2 = 0x9e3779b9;
  for (let i = input.length - 1; i >= 0; i--) {
    h2 ^= input.charCodeAt(i);
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return h.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}
