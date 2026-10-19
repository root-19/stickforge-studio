import { z } from "zod";

/** Clean-up options for a voice recording (all applied locally with FFmpeg). */
export const enhanceOptionsSchema = z.object({
  /** Reduce steady background noise (fan, hiss). */
  noise: z.boolean().default(true),
  /** Remove low rumble below ~80 Hz (desk bumps, traffic). */
  rumble: z.boolean().default(true),
  /** Even out volume and bring it to a standard loudness (-16 LUFS). */
  level: z.boolean().default(true),
  /** Cut silence at the start and end. */
  trim: z.boolean().default(true),
  /** Pitch shift in semitones (negative = deeper). 0 = natural. */
  pitch: z.number().int().min(-6).max(6).default(0),
});
export type EnhanceOptions = z.infer<typeof enhanceOptionsSchema>;

export const PITCH_PRESETS: { value: number; label: string }[] = [
  { value: 0, label: "Natural (no change)" },
  { value: -2, label: "Slightly deeper" },
  { value: -4, label: "Deeper narrator" },
  { value: 2, label: "Slightly higher" },
];

/** FFmpeg audio filter chain for the chosen options. Output: 48 kHz mono. */
export function buildEnhanceFilter(o: EnhanceOptions): string {
  const f: string[] = [];
  if (o.rumble) f.push("highpass=f=80");
  if (o.noise) f.push("afftdn=nr=12:nf=-40:tn=1");
  if (o.pitch) f.push(`rubberband=pitch=${Math.pow(2, o.pitch / 12).toFixed(5)}`);
  if (o.level) f.push("acompressor=threshold=-21dB:ratio=3:attack=8:release=120:makeup=2", "loudnorm=I=-16:TP=-1.5:LRA=11");
  if (o.trim) {
    const trimStart = "silenceremove=start_periods=1:start_duration=0.05:start_threshold=-45dB";
    f.push(trimStart, "areverse", trimStart, "areverse");
  }
  f.push("aresample=48000", "aformat=sample_fmts=s16:channel_layouts=mono");
  return f.join(",");
}

export function enhanceKey(o: EnhanceOptions): string {
  return [o.noise ? "n" : "", o.rumble ? "r" : "", o.level ? "l" : "", o.trim ? "t" : "", `p${o.pitch}`].join("");
}

export type RecordingInfo = { id: string; duration: number; createdAt: string; features: import("./types").VoiceFeaturesLite | null };
