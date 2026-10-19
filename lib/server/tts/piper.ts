import "server-only";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { InferenceSession } from "onnxruntime-node";
import { appRoot } from "../env";

/**
 * Offline Piper TTS running inside the Next.js server process:
 *  - text → phonemes with piper-phonemize (espeak-ng compiled to WebAssembly)
 *  - phonemes → ids with the voice's own phoneme_id_map
 *  - ids → audio with the voice's VITS ONNX model on onnxruntime-node (CPU)
 * No network access, no Python.
 */

const nodeRequire = createRequire(path.join(appRoot(), "package.json"));

export type PiperConfig = {
  audio: { sample_rate: number; quality?: string };
  espeak: { voice: string };
  inference: { noise_scale: number; length_scale: number; noise_w: number };
  phoneme_type?: string;
  phoneme_id_map: Record<string, number[]>;
  num_speakers: number;
  speaker_id_map?: Record<string, number>;
};

export type LoadedVoice = {
  key: string;
  modelPath: string;
  config: PiperConfig;
  session: InferenceSession;
};

type PhonemizerModule = { callMain: (args: string[]) => void };
type PiperState = {
  voices: Map<string, Promise<LoadedVoice>>;
  phonemizer: Promise<PhonemizerModule> | null;
  phonemizerOut: string[];
  lock: Promise<unknown>;
};

function state(): PiperState {
  const g = globalThis as typeof globalThis & { __stickforgePiper?: PiperState };
  if (!g.__stickforgePiper) g.__stickforgePiper = { voices: new Map(), phonemizer: null, phonemizerOut: [], lock: Promise.resolve() };
  return g.__stickforgePiper;
}

/** Serialize all synthesis calls (one ONNX run at a time keeps memory predictable). */
export function withTtsLock<T>(fn: () => Promise<T>): Promise<T> {
  const s = state();
  const run = s.lock.then(fn, fn);
  s.lock = run.catch(() => undefined);
  return run;
}

export function phonemizerBuildDir(): string {
  return path.dirname(nodeRequire.resolve("@diffusionstudio/piper-wasm/build/piper_phonemize.js"));
}

function getPhonemizer(): Promise<PhonemizerModule> {
  const s = state();
  if (!s.phonemizer) {
    const buildDir = phonemizerBuildDir();
    const create = nodeRequire(path.join(buildDir, "piper_phonemize.js")) as (opts: object) => Promise<PhonemizerModule>;
    s.phonemizer = create({
      print: (line: string) => s.phonemizerOut.push(line),
      printErr: (line: string) => console.warn("[piper-phonemize]", line),
      locateFile: (file: string) => path.join(buildDir, file),
    }).catch((e) => {
      s.phonemizer = null;
      throw e;
    });
  }
  return s.phonemizer;
}

/** Phonemize several texts in one call. Returns one phoneme list per input text. */
export async function phonemize(texts: string[], espeakVoice: string): Promise<string[][]> {
  if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(espeakVoice)) throw new Error(`Unsupported espeak voice "${espeakVoice}"`);
  const mod = await getPhonemizer();
  const s = state();
  s.phonemizerOut = [];
  mod.callMain(["-l", espeakVoice, "--input", JSON.stringify(texts.map((text) => ({ text }))), "--espeak_data", "/espeak-ng-data"]);
  const lines = s.phonemizerOut.splice(0);
  if (lines.length !== texts.length) throw new Error(`Phonemizer returned ${lines.length} results for ${texts.length} texts`);
  return lines.map((l) => (JSON.parse(l) as { phonemes: string[] }).phonemes);
}

export function phonemesToIds(phonemes: string[], idMap: Record<string, number[]>): number[] {
  const pad = idMap["_"] ?? [0];
  const bos = idMap["^"] ?? [1];
  const eos = idMap["$"] ?? [2];
  const ids: number[] = [...bos, ...pad];
  for (const ph of phonemes) {
    const mapped = idMap[ph];
    if (!mapped) continue; // Piper skips phonemes missing from the voice's map
    ids.push(...mapped, ...pad);
  }
  ids.push(...eos);
  return ids;
}

export function readVoiceConfig(configPath: string): PiperConfig {
  const cfg = JSON.parse(fs.readFileSync(configPath, "utf8")) as PiperConfig;
  if (!cfg?.audio?.sample_rate || !cfg.phoneme_id_map) throw new Error(`${path.basename(configPath)} is not a Piper voice config`);
  if (cfg.phoneme_type && cfg.phoneme_type !== "espeak") {
    throw new Error(`Voice uses phoneme_type "${cfg.phoneme_type}", which is not supported (espeak voices only)`);
  }
  const inf: Partial<PiperConfig["inference"]> = cfg.inference ?? {};
  cfg.inference = { noise_scale: inf.noise_scale ?? 0.667, length_scale: inf.length_scale ?? 1, noise_w: inf.noise_w ?? 0.8 };
  return cfg;
}

export function loadVoice(key: string, modelPath: string): Promise<LoadedVoice> {
  const s = state();
  const cacheKey = `${key}|${modelPath}`;
  let p = s.voices.get(cacheKey);
  if (!p) {
    p = (async () => {
      const config = readVoiceConfig(`${modelPath}.json`);
      const ort = nodeRequire("onnxruntime-node") as typeof import("onnxruntime-node");
      const session = await ort.InferenceSession.create(modelPath, {
        executionProviders: ["cpu"],
        graphOptimizationLevel: "all",
      });
      return { key, modelPath, config, session };
    })();
    p.catch(() => s.voices.delete(cacheKey));
    s.voices.set(cacheKey, p);
    // Keep at most two voices in memory.
    while (s.voices.size > 2) {
      const oldest = s.voices.keys().next().value as string;
      const old = s.voices.get(oldest);
      s.voices.delete(oldest);
      old?.then((v) => v.session.release()).catch(() => undefined);
    }
  }
  return p;
}

export function unloadVoice(key: string) {
  const s = state();
  for (const [k, p] of s.voices) {
    if (k.startsWith(`${key}|`)) {
      s.voices.delete(k);
      p.then((v) => v.session.release()).catch(() => undefined);
    }
  }
}

export type SynthOptions = { speakerId: number; speed: number; noiseScale: number; noiseW: number };

/** Synthesize one short text (a sentence) to float PCM at the voice's sample rate. */
export async function synthesizeIds(voice: LoadedVoice, ids: number[], opts: SynthOptions): Promise<Float32Array> {
  const ort = nodeRequire("onnxruntime-node") as typeof import("onnxruntime-node");
  const lengthScale = voice.config.inference.length_scale / Math.max(0.1, opts.speed);
  const feeds: Record<string, InstanceType<typeof ort.Tensor>> = {
    input: new ort.Tensor("int64", BigInt64Array.from(ids, (n) => BigInt(n)), [1, ids.length]),
    input_lengths: new ort.Tensor("int64", BigInt64Array.from([BigInt(ids.length)]), [1]),
    scales: new ort.Tensor("float32", Float32Array.from([opts.noiseScale, lengthScale, opts.noiseW]), [3]),
  };
  if (voice.config.num_speakers > 1) {
    const sid = Math.min(Math.max(0, opts.speakerId), voice.config.num_speakers - 1);
    feeds.sid = new ort.Tensor("int64", BigInt64Array.from([BigInt(sid)]), [1]);
  }
  const result = await voice.session.run(feeds);
  const out = result.output ?? Object.values(result)[0];
  return out.data as Float32Array;
}

export async function synthesizeTexts(voice: LoadedVoice, texts: string[], opts: SynthOptions, onEach?: (i: number) => void | Promise<void>) {
  const phonemes = await phonemize(texts, voice.config.espeak.voice);
  const out: Float32Array[] = [];
  for (let i = 0; i < texts.length; i++) {
    const ids = phonemesToIds(phonemes[i], voice.config.phoneme_id_map);
    out.push(ids.length <= 3 ? new Float32Array(0) : await synthesizeIds(voice, ids, opts));
    await onEach?.(i);
  }
  return out;
}
