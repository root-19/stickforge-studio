/**
 * Friendly names for Piper voice keys, e.g. "en_US-kristin-medium" → "Kristin".
 * The full key is still used internally and shown as a tooltip.
 */

const SPECIAL: Record<string, string> = {
  hfc_male: "HFC Male",
  hfc_female: "HFC Female",
  ljspeech: "LJ Speech",
  libritts: "LibriTTS",
  libritts_r: "LibriTTS-R",
  l2arctic: "L2-ARCTIC",
  arctic: "CMU Arctic",
  vctk: "VCTK",
  jenny_dioco: "Jenny",
  reza_ibrahim: "Reza Ibrahim",
};

const REGION: Record<string, string> = { en_US: "US", en_GB: "UK" };

const QUALITY: Record<string, string> = { x_low: "Extra low", low: "Low", medium: "Medium", high: "High" };

export type VoiceNameParts = { name: string; region: string | null; quality: string | null };

export function parseVoiceKey(key: string): VoiceNameParts {
  const m = key.match(/^([a-z]{2,3}_[A-Z]{2})-(.+)-(x_low|low|medium|high)$/);
  if (!m) return { name: titleCase(key.replace(/[-_]+/g, " ")), region: null, quality: null };
  const [, lang, speaker, quality] = m;
  return {
    name: SPECIAL[speaker] ?? titleCase(speaker.replace(/_/g, " ")),
    region: REGION[lang] ?? lang.split("_")[1] ?? null,
    quality: QUALITY[quality] ?? quality,
  };
}

/** "en_US-kristin-medium" → "Kristin". */
export function voiceName(key: string): string {
  return parseVoiceKey(key).name;
}

/** Name plus what's needed to tell versions apart, e.g. "Ryan · High". */
export function voiceLabel(key: string, opts: { quality?: boolean; region?: boolean } = {}): string {
  const p = parseVoiceKey(key);
  return [p.name, opts.region ? p.region : null, opts.quality ? p.quality : null].filter(Boolean).join(" · ");
}

function titleCase(s: string): string {
  return s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}
