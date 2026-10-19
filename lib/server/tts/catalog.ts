import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { CommercialUse, VoiceCatalogEntry } from "@/lib/shared/types";
import snapshot from "./piper-voices-snapshot.json";
import { appHome } from "../env";
import { writeFileAtomic } from "../paths";

/** Official Piper voice repository (Rhasspy / Open Home Foundation). */
export const PIPER_VOICES_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main";
export const PIPER_VOICES_PAGE = "https://huggingface.co/rhasspy/piper-voices";

type Curated = {
  gender: VoiceCatalogEntry["gender"];
  license: string;
  licenseUrl: string | null;
  commercialUse: CommercialUse;
  recommended?: boolean;
  description: string;
};

/**
 * Dataset licenses as stated in each voice's official MODEL_CARD
 * (checked 2026-10-18). Gender labels describe the speaker of the dataset;
 * always preview a voice before choosing. The full MODEL_CARD is downloaded
 * with every voice and shown in the Voice Manager.
 */
const CURATED: Record<string, Curated> = {
  "en_US-joe-medium": { gender: "male", license: "CC0", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/", commercialUse: "allowed", recommended: true, description: "American male voice. Default narrator." },
  "en_US-john-medium": { gender: "male", license: "Public domain (LibriVox)", licenseUrl: null, commercialUse: "allowed", recommended: true, description: "American male audiobook-style voice." },
  "en_US-norman-medium": { gender: "male", license: "Public domain (LibriVox)", licenseUrl: null, commercialUse: "allowed", recommended: true, description: "American male audiobook-style voice." },
  "en_US-bryce-medium": { gender: "male", license: "Public domain", licenseUrl: null, commercialUse: "allowed", description: "American male voice." },
  "en_US-mike-medium": { gender: "male", license: "CC0", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/", commercialUse: "allowed", description: "American male voice." },
  "en_US-reza_ibrahim-medium": { gender: "male", license: "CC0", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/", commercialUse: "allowed", description: "Male English voice (Quran-recitation dataset)." },
  "en_US-ryan-high": { gender: "male", license: "CC BY-NC-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-nc-sa/4.0/", commercialUse: "non-commercial", description: "Popular American male voice — NOT for monetized videos." },
  "en_US-ryan-medium": { gender: "male", license: "CC BY-NC-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-nc-sa/4.0/", commercialUse: "non-commercial", description: "American male — non-commercial license." },
  "en_US-ryan-low": { gender: "male", license: "CC BY-NC-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-nc-sa/4.0/", commercialUse: "non-commercial", description: "American male — non-commercial license." },
  "en_US-hfc_male-medium": { gender: "male", license: "CC BY-NC-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-nc-sa/4.0/", commercialUse: "non-commercial", description: "American male (Hi-Fi CAPTAIN) — non-commercial license." },
  "en_US-danny-low": { gender: "male", license: "See source (Mycroft mimic3)", licenseUrl: "https://github.com/MycroftAI/mimic3-voices", commercialUse: "unclear", description: "American male, low quality." },
  "en_US-kusal-medium": { gender: "male", license: "See source (Mycroft mimic2)", licenseUrl: "https://github.com/MycroftAI/mimic2", commercialUse: "unclear", description: "Male English voice." },
  "en_US-kristin-medium": { gender: "female", license: "Public domain (LibriVox)", licenseUrl: null, commercialUse: "allowed", recommended: true, description: "American female audiobook-style voice. Default female narrator." },
  "en_US-ljspeech-high": { gender: "female", license: "Public domain (LJ Speech)", licenseUrl: "https://keithito.com/LJ-Speech-Dataset/", commercialUse: "allowed", recommended: true, description: "American female, high quality (larger download)." },
  "en_US-ljspeech-medium": { gender: "female", license: "Public domain (LJ Speech)", licenseUrl: "https://keithito.com/LJ-Speech-Dataset/", commercialUse: "allowed", description: "American female voice." },
  "en_US-kathleen-low": { gender: "female", license: "CC0", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/", commercialUse: "allowed", description: "American female, low quality." },
  "en_US-amy-medium": { gender: "female", license: "See source (Mycroft mimic3)", licenseUrl: "https://github.com/MycroftAI/mimic3-voices", commercialUse: "unclear", description: "American female voice." },
  "en_US-amy-low": { gender: "female", license: "See source (Mycroft mimic3)", licenseUrl: "https://github.com/MycroftAI/mimic3-voices", commercialUse: "unclear", description: "American female, low quality." },
  "en_US-hfc_female-medium": { gender: "female", license: "CC BY-NC-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-nc-sa/4.0/", commercialUse: "non-commercial", description: "American female — non-commercial license." },
  "en_US-lessac-high": { gender: "female", license: "Blizzard 2013 (Lessac) license", licenseUrl: "https://www.cstr.ed.ac.uk/projects/blizzard/2013/lessac_blizzard2013/license.html", commercialUse: "non-commercial", description: "American female — research/non-commercial license." },
  "en_US-lessac-medium": { gender: "female", license: "Blizzard 2013 (Lessac) license", licenseUrl: "https://www.cstr.ed.ac.uk/projects/blizzard/2013/lessac_blizzard2013/license.html", commercialUse: "non-commercial", description: "American female — research/non-commercial license." },
  "en_US-lessac-low": { gender: "female", license: "Blizzard 2013 (Lessac) license", licenseUrl: "https://www.cstr.ed.ac.uk/projects/blizzard/2013/lessac_blizzard2013/license.html", commercialUse: "non-commercial", description: "American female — research/non-commercial license." },
  "en_US-sam-medium": { gender: "neutral", license: "Apache-2.0", licenseUrl: "https://www.apache.org/licenses/LICENSE-2.0.txt", commercialUse: "attribution", description: "Non-binary voice." },
  "en_US-libritts_r-medium": { gender: "mixed", license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/", commercialUse: "attribution", description: "904 speakers (male and female). Credit LibriTTS-R when used." },
  "en_US-libritts-high": { gender: "mixed", license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/", commercialUse: "attribution", description: "904 speakers (male and female), high quality. Credit LibriTTS." },
  "en_US-arctic-medium": { gender: "mixed", license: "CMU ARCTIC license (see source)", licenseUrl: "http://www.festvox.org/cmu_arctic/", commercialUse: "unclear", description: "18 speakers." },
  "en_US-l2arctic-medium": { gender: "mixed", license: "CC BY-NC 4.0", licenseUrl: "https://creativecommons.org/licenses/by-nc/4.0/", commercialUse: "non-commercial", description: "24 non-native English speakers — non-commercial." },
  "en_GB-northern_english_male-medium": { gender: "male", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/", commercialUse: "share-alike", description: "British (Northern English) male." },
  "en_GB-alan-medium": { gender: "male", license: "See source (Mycroft mimic3)", licenseUrl: "https://github.com/MycroftAI/mimic3-voices", commercialUse: "unclear", description: "British male." },
  "en_GB-alan-low": { gender: "male", license: "See source (Mycroft mimic3)", licenseUrl: "https://github.com/MycroftAI/mimic3-voices", commercialUse: "unclear", description: "British male, low quality." },
  "en_GB-cori-high": { gender: "female", license: "Public domain (LibriVox)", licenseUrl: null, commercialUse: "allowed", description: "British female, high quality." },
  "en_GB-cori-medium": { gender: "female", license: "Public domain (LibriVox)", licenseUrl: null, commercialUse: "allowed", description: "British female." },
  "en_GB-alba-medium": { gender: "female", license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/", commercialUse: "attribution", description: "Scottish English female." },
  "en_GB-southern_english_female-low": { gender: "female", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/", commercialUse: "share-alike", description: "British (Southern English) female, low quality." },
  "en_GB-jenny_dioco-medium": { gender: "female", license: "See source", licenseUrl: "https://github.com/dioco-group/jenny-tts-dataset", commercialUse: "unclear", description: "British female." },
  "en_GB-vctk-medium": { gender: "mixed", license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/", commercialUse: "attribution", description: "109 British English speakers." },
  "en_GB-aru-medium": { gender: "mixed", license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/", commercialUse: "attribution", description: "12 British English speakers." },
  "en_GB-semaine-medium": { gender: "mixed", license: "CC BY-NC-SA 4.0", licenseUrl: "http://creativecommons.org/licenses/by-nc-sa/4.0/", commercialUse: "non-commercial", description: "4 British speakers — non-commercial." },
};

type SnapshotEntry = {
  key: string;
  name: string;
  quality: string;
  num_speakers: number;
  speaker_id_map: Record<string, number>;
  language: { code: string; name_english: string; country_english: string };
  files: Record<string, { size_bytes: number; md5_digest: string }>;
};

function catalogCacheFile() {
  return path.join(appHome(), "voices-catalog.json");
}

/** Use a refreshed catalog (downloaded by the user) when present, else the bundled snapshot. */
function loadRaw(): Record<string, SnapshotEntry> {
  try {
    const cached = JSON.parse(fs.readFileSync(catalogCacheFile(), "utf8")) as Record<string, SnapshotEntry>;
    if (cached && typeof cached === "object" && Object.keys(cached).length > 0) return cached;
  } catch {
    /* fall back */
  }
  return snapshot as unknown as Record<string, SnapshotEntry>;
}

function toEntry(raw: SnapshotEntry): VoiceCatalogEntry {
  const c = CURATED[raw.key];
  const files = Object.entries(raw.files).map(([p, f]) => ({ path: p, sizeBytes: f.size_bytes, md5: f.md5_digest }));
  return {
    key: raw.key,
    name: raw.name,
    languageCode: raw.language.code,
    languageLabel: `${raw.language.name_english} (${raw.language.country_english})`,
    quality: raw.quality,
    numSpeakers: raw.num_speakers,
    gender: c?.gender ?? "unknown",
    license: c?.license ?? "Unknown — read the MODEL_CARD",
    licenseUrl: c?.licenseUrl ?? null,
    commercialUse: c?.commercialUse ?? "unclear",
    recommended: c?.recommended ?? false,
    description: c?.description ?? "",
    files,
    totalBytes: files.reduce((n, f) => n + f.sizeBytes, 0),
    sourceUrl: `${PIPER_VOICES_PAGE}/tree/main/${path.posix.dirname(files[0]?.path ?? "")}`,
  };
}

export function getCatalog(): VoiceCatalogEntry[] {
  const raw = loadRaw();
  const order = { allowed: 0, attribution: 1, "share-alike": 2, unclear: 3, "non-commercial": 4 } as const;
  return Object.values(raw)
    .filter((r) => r.language.code.startsWith("en_"))
    .map(toEntry)
    .sort(
      (a, b) =>
        Number(b.recommended) - Number(a.recommended) ||
        order[a.commercialUse] - order[b.commercialUse] ||
        a.key.localeCompare(b.key),
    );
}

export function getCatalogEntry(key: string): VoiceCatalogEntry | null {
  return getCatalog().find((v) => v.key === key) ?? null;
}

/** Fetch the latest voices.json from the official repository (user-initiated). */
export async function refreshCatalog(): Promise<number> {
  const res = await fetch(`${PIPER_VOICES_BASE}/voices.json`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Could not download the voice list (HTTP ${res.status})`);
  const all = (await res.json()) as Record<string, SnapshotEntry & { language: SnapshotEntry["language"] & { code: string } }>;
  const en: Record<string, SnapshotEntry> = {};
  for (const [k, v] of Object.entries(all)) {
    if (!v?.language?.code?.startsWith("en_")) continue;
    en[k] = {
      key: k,
      name: v.name,
      quality: v.quality,
      num_speakers: v.num_speakers,
      speaker_id_map: v.num_speakers <= 30 ? v.speaker_id_map ?? {} : {},
      language: { code: v.language.code, name_english: v.language.name_english, country_english: v.language.country_english },
      files: v.files,
    };
  }
  if (Object.keys(en).length === 0) throw new Error("The downloaded voice list contained no English voices");
  writeFileAtomic(catalogCacheFile(), JSON.stringify(en));
  return Object.keys(en).length;
}
