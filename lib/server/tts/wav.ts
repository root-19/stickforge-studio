/** Minimal 16-bit PCM mono WAV helpers (Piper outputs mono float PCM). */

export function floatToInt16(pcm: Float32Array): Int16Array {
  const out = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    const v = Math.max(-1, Math.min(1, pcm[i]));
    out[i] = v < 0 ? Math.round(v * 32768) : Math.round(v * 32767);
  }
  return out;
}

/** Scale so the loudest sample reaches `target` (Piper's reference CLI also peak-normalizes). */
export function peakNormalize(pcm: Float32Array, target = 0.89): Float32Array {
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) {
    const a = Math.abs(pcm[i]);
    if (a > peak) peak = a;
  }
  if (peak < 1e-4) return pcm;
  const gain = target / peak;
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] * gain;
  return out;
}

export function encodeWav(samples: Int16Array, sampleRate: number): Buffer {
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataBytes, 40);
  Buffer.from(samples.buffer, samples.byteOffset, dataBytes).copy(buf, 44);
  return buf;
}

export type DecodedWav = { sampleRate: number; samples: Int16Array };

/** Decode a 16-bit PCM mono WAV produced by `encodeWav` (or any simple PCM16 mono WAV). */
export function decodeWav(buf: Buffer): DecodedWav {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("Not a WAV file");
  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bits = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      const format = buf.readUInt16LE(body);
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
      if (format !== 1 || bits !== 16 || channels !== 1) throw new Error("Only 16-bit PCM mono WAV is supported here");
    } else if (id === "data") {
      const end = Math.min(buf.length, body + size);
      const copy = Buffer.from(buf.subarray(body, end));
      const samples = new Int16Array(copy.buffer, copy.byteOffset, Math.floor(copy.length / 2));
      return { sampleRate, samples };
    }
    offset = body + size + (size % 2);
  }
  throw new Error("WAV file has no data chunk");
}

export function wavDurationSeconds(buf: Buffer): number {
  const w = decodeWav(buf);
  return w.samples.length / w.sampleRate;
}

export function silence(seconds: number, sampleRate: number): Int16Array {
  return new Int16Array(Math.max(0, Math.round(seconds * sampleRate)));
}

export function concatInt16(parts: Int16Array[]): Int16Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Int16Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Linear resample (used only if voices with different sample rates are combined). */
export function resampleInt16(samples: Int16Array, from: number, to: number): Int16Array {
  if (from === to) return samples;
  const ratio = from / to;
  const outLen = Math.round(samples.length / ratio);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(samples.length - 1, i0 + 1);
    const f = pos - i0;
    out[i] = Math.round(samples[i0] * (1 - f) + samples[i1] * f);
  }
  return out;
}
