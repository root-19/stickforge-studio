import type { NarrationSegment, SentenceTiming, VoiceSettings } from "./types";
import { hashString, splitParagraphs } from "./script";

export const ENGINE_VERSION = "piper-onnx-1";

/** Cache key for one segment's audio: changes when text or any audio-affecting setting changes. */
export function segmentAudioHash(text: string, s: VoiceSettings): string {
  return hashString(
    JSON.stringify([ENGINE_VERSION, text, s.voiceKey, s.speakerId, s.speed, s.noiseScale, s.noiseW, s.sentencePause]),
  );
}

export function combinedAudioHash(segments: NarrationSegment[], s: VoiceSettings): string {
  return hashString(JSON.stringify([segments.map((g) => g.audioHash), s.paragraphPause]));
}

/**
 * Match new paragraphs to existing segments so unchanged paragraphs keep their
 * generated audio. Matching is by exact text first, then by position.
 */
export function reconcileSegments(
  old: NarrationSegment[],
  script: string,
  settings: VoiceSettings,
  makeId: () => string,
): NarrationSegment[] {
  const paragraphs = splitParagraphs(script);
  const unused = [...old];
  return paragraphs.map((text) => {
    const idx = unused.findIndex((s) => s.text === text);
    if (idx >= 0) {
      const seg = unused.splice(idx, 1)[0];
      return refreshStatus(seg, settings);
    }
    return { id: makeId(), text, audioHash: null, duration: null, sentences: [], status: "pending" };
  });
}

/** Mark a segment stale when its audio was generated with different text/settings. */
export function refreshStatus(seg: NarrationSegment, settings: VoiceSettings): NarrationSegment {
  if (!seg.audioHash) return { ...seg, status: seg.status === "error" ? "error" : "pending" };
  const expected = segmentAudioHash(seg.text, settings);
  return { ...seg, status: expected === seg.audioHash ? "ready" : "stale" };
}

/** Absolute sentence timings across the combined narration. */
export function combinedSentenceTimings(segments: NarrationSegment[], paragraphPause: number): SentenceTiming[] {
  const out: SentenceTiming[] = [];
  let t = 0;
  segments.forEach((seg, i) => {
    for (const s of seg.sentences) out.push({ text: s.text, start: t + s.start, end: t + s.end });
    t += seg.duration ?? 0;
    if (i < segments.length - 1) t += paragraphPause;
  });
  return out;
}

export type VoicePreset = {
  id: string;
  label: string;
  description: string;
  values: Pick<VoiceSettings, "speed" | "noiseScale" | "noiseW" | "sentencePause" | "paragraphPause">;
};

/**
 * Presets only set real Piper parameters and pause lengths. Piper cannot act
 * out emotions; "energetic" here means a faster pace with shorter pauses.
 */
export const VOICE_PRESETS: VoicePreset[] = [
  {
    id: "documentary-energetic",
    label: "Energetic documentary (default)",
    description: "Speed 1.05×, short pauses, standard intonation variation.",
    values: { speed: 1.05, noiseScale: 0.667, noiseW: 0.8, sentencePause: 0.25, paragraphPause: 0.5 },
  },
  {
    id: "shorts-fast",
    label: "Fast Shorts pace",
    description: "Speed 1.15×, very short pauses — packs more into 60 seconds.",
    values: { speed: 1.15, noiseScale: 0.667, noiseW: 0.8, sentencePause: 0.15, paragraphPause: 0.3 },
  },
  {
    id: "mystery-slow",
    label: "Slow mystery build-up",
    description: "Speed 0.92×, longer pauses for suspense.",
    values: { speed: 0.92, noiseScale: 0.6, noiseW: 0.7, sentencePause: 0.45, paragraphPause: 0.9 },
  },
  {
    id: "steady-explainer",
    label: "Steady explainer",
    description: "Speed 1.0×, lower intonation variation for an even read.",
    values: { speed: 1.0, noiseScale: 0.5, noiseW: 0.6, sentencePause: 0.3, paragraphPause: 0.6 },
  },
];
