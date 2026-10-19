import "server-only";
import { spawn } from "node:child_process";
import { requireTool } from "./ffmpeg/locate";

/**
 * Lightweight voice "fingerprint" used to find Piper voices that sound like a
 * recording: median pitch (F0), pitch spread, and spectral centroid (brightness).
 * This is a rough similarity measure, not speaker recognition.
 */

export type VoiceFeatures = {
  /** Median fundamental frequency of voiced frames, Hz. */
  f0: number;
  /** Interquartile spread of F0 in semitones (how expressive the pitch is). */
  f0Spread: number;
  /** Median spectral centroid of voiced frames, Hz (brightness / timbre). */
  centroid: number;
  /** Share of frames that contained voice. */
  voicedRatio: number;
  seconds: number;
};

export const ANALYSIS_RATE = 16000;

/** Decode any audio file to mono float PCM at 16 kHz using FFmpeg. */
export function decodeToPcm(file: string, maxSeconds = 120): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      requireTool("ffmpeg"),
      ["-hide_banner", "-loglevel", "error", "-nostdin", "-t", String(maxSeconds), "-i", `file:${file}`, "-ac", "1", "-ar", String(ANALYSIS_RATE), "-f", "f32le", "pipe:1"],
      { windowsHide: true, shell: false },
    );
    const chunks: Buffer[] = [];
    let err = "";
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", (c: Buffer) => (err += c.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`Could not decode audio: ${err.trim().split("\n").pop()}`));
      const buf = Buffer.concat(chunks);
      const copy = new Float32Array(Math.floor(buf.length / 4));
      for (let i = 0; i < copy.length; i++) copy[i] = buf.readFloatLE(i * 4);
      resolve(copy);
    });
  });
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function quantile(values: number[], q: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))];
}

/** In-place radix-2 FFT magnitude spectrum of a frame (length must be a power of two). */
function magnitudeSpectrum(frame: Float32Array): Float32Array {
  const n = frame.length;
  const re = Float64Array.from(frame);
  const im = new Float64Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
        const vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
      }
    }
  }
  const mag = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}

/** Pitch of one frame by normalized autocorrelation (65–400 Hz). Returns 0 when unvoiced. */
function framePitch(frame: Float32Array, rate: number): number {
  const minLag = Math.floor(rate / 400);
  const maxLag = Math.floor(rate / 65);
  let energy = 0;
  for (let i = 0; i < frame.length; i++) energy += frame[i] * frame[i];
  if (energy <= 0) return 0;
  let bestLag = 0;
  let best = 0;
  const corr = new Float64Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag + 1; lag++) {
    let s = 0;
    let e2 = 0;
    for (let i = 0; i + lag < frame.length; i++) {
      s += frame[i] * frame[i + lag];
      e2 += frame[i + lag] * frame[i + lag];
    }
    corr[lag] = s / Math.sqrt(energy * e2 + 1e-12);
  }
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (corr[lag] > best && corr[lag] >= corr[lag - 1] && corr[lag] >= corr[lag + 1]) {
      best = corr[lag];
      bestLag = lag;
    }
  }
  // Prefer the shortest lag whose correlation is close to the best (avoids octave errors).
  for (let lag = minLag; lag < bestLag; lag++) {
    if (corr[lag] > 0.9 * best && corr[lag] >= corr[lag - 1] && corr[lag] >= corr[lag + 1]) {
      bestLag = lag;
      break;
    }
  }
  return best > 0.55 && bestLag > 0 ? rate / bestLag : 0;
}

export function analyzePcm(pcm: Float32Array, rate = ANALYSIS_RATE): VoiceFeatures {
  const frameLen = 1024; // 64 ms at 16 kHz
  const hop = 512;
  const window = new Float32Array(frameLen).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frameLen - 1)));
  // Energy gate relative to the loudest frames (ignores pauses and room noise).
  const energies: number[] = [];
  for (let s = 0; s + frameLen <= pcm.length; s += hop) {
    let e = 0;
    for (let i = 0; i < frameLen; i++) e += pcm[s + i] * pcm[s + i];
    energies.push(e / frameLen);
  }
  const gate = quantile(energies, 0.9) * 0.08;
  const f0s: number[] = [];
  const centroids: number[] = [];
  let frames = 0;
  for (let s = 0, fi = 0; s + frameLen <= pcm.length; s += hop, fi++) {
    frames++;
    if (energies[fi] < gate || energies[fi] <= 1e-7) continue;
    const frame = pcm.subarray(s, s + frameLen);
    const f0 = framePitch(frame, rate);
    if (!f0) continue;
    f0s.push(f0);
    const windowed = new Float32Array(frameLen);
    for (let i = 0; i < frameLen; i++) windowed[i] = frame[i] * window[i];
    const mag = magnitudeSpectrum(windowed);
    let num = 0;
    let den = 0;
    for (let k = 1; k < mag.length; k++) {
      const hz = (k * rate) / frameLen;
      if (hz < 80 || hz > 7000) continue;
      num += hz * mag[k];
      den += mag[k];
    }
    if (den > 0) centroids.push(num / den);
  }
  const semis = f0s.map((f) => 12 * Math.log2(f));
  return {
    f0: Math.round(median(f0s) * 10) / 10,
    f0Spread: Math.round((quantile(semis, 0.75) - quantile(semis, 0.25)) * 100) / 100,
    centroid: Math.round(median(centroids)),
    voicedRatio: frames ? Math.round((f0s.length / frames) * 1000) / 1000 : 0,
    seconds: Math.round((pcm.length / rate) * 10) / 10,
  };
}

export async function analyzeFile(file: string): Promise<VoiceFeatures> {
  return analyzePcm(await decodeToPcm(file));
}

/**
 * Similarity 0–100 between two voices. Pitch matters most (a semitone apart is
 * close, an octave apart is very different); brightness and expressiveness refine it.
 */
export function voiceSimilarity(a: VoiceFeatures, b: VoiceFeatures): number {
  if (!a.f0 || !b.f0) return 0;
  const pitchSemis = Math.abs(12 * Math.log2(a.f0 / b.f0));
  const brightnessOctaves = a.centroid && b.centroid ? Math.abs(Math.log2(a.centroid / b.centroid)) : 0.5;
  const spread = Math.abs(a.f0Spread - b.f0Spread);
  const distance = pitchSemis * 1.0 + brightnessOctaves * 8 + spread * 0.6;
  return Math.round(100 * Math.exp(-distance / 7));
}
