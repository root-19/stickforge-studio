import "server-only";
import fs from "node:fs";
import path from "node:path";
import { appHome } from "./env";
import { writeFileAtomic } from "./paths";
import type { JobContext } from "./jobs";
import { analyzeFile, voiceSimilarity, type VoiceFeatures } from "./audio-analysis";
import { getCatalog } from "./tts/catalog";
import { getVoiceSample } from "./tts/samples";
import { listInstalledVoices } from "./tts/voices";
import type { VoiceMatch } from "@/lib/shared/types";

/**
 * Rank catalog voices by how close their official sample sounds to a recording
 * (pitch + brightness). Voice fingerprints are cached in voice-features.json so
 * the samples are only downloaded and analysed once.
 */

type FeatureCache = Record<string, VoiceFeatures>;
const cacheFile = () => path.join(appHome(), "voice-features.json");

function readCache(): FeatureCache {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(), "utf8")) as FeatureCache;
  } catch {
    return {};
  }
}

export async function matchVoices(
  features: VoiceFeatures,
  opts: { region: "en_US" | "en_GB" | "any"; commercialOnly: boolean; limit?: number },
  ctx: JobContext,
): Promise<{ matches: VoiceMatch[]; analysed: number; failed: number }> {
  const catalog = getCatalog().filter(
    (v) =>
      v.numSpeakers === 1 &&
      (opts.region === "any" || v.languageCode === opts.region) &&
      // CC BY-SA also allows commercial use (with credit + share-alike).
      (!opts.commercialOnly || v.commercialUse === "allowed" || v.commercialUse === "attribution" || v.commercialUse === "share-alike"),
  );
  const cache = readCache();
  const todo = catalog.filter((v) => !cache[v.key]);
  let done = 0;
  let failed = 0;
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      ctx.throwIfCancelled();
      const v = todo[next++];
      try {
        cache[v.key] = await analyzeFile(await getVoiceSample(v.key));
      } catch {
        failed++;
      }
      done++;
      ctx.progress(done / Math.max(1, todo.length), `Listening to voice samples (${done}/${todo.length})…`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, todo.length) }, worker));
  if (todo.length) writeFileAtomic(cacheFile(), JSON.stringify(cache));

  const installed = new Set(listInstalledVoices().map((v) => v.key));
  const matches = catalog
    .filter((v) => cache[v.key])
    .map((v) => ({
      key: v.key,
      similarity: voiceSimilarity(features, cache[v.key]),
      f0: cache[v.key].f0,
      gender: v.gender,
      languageCode: v.languageCode,
      commercialUse: v.commercialUse,
      license: v.license,
      installed: installed.has(v.key),
      totalBytes: v.totalBytes,
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, opts.limit ?? 8);
  return { matches, analysed: catalog.length - failed, failed };
}
