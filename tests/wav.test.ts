import { describe, expect, it } from "vitest";
import { concatInt16, decodeWav, encodeWav, floatToInt16, peakNormalize, resampleInt16, silence, wavDurationSeconds } from "@/lib/server/tts/wav";

describe("wav", () => {
  it("round-trips PCM16 mono", () => {
    const samples = Int16Array.from([0, 1000, -1000, 32767, -32768]);
    const buf = encodeWav(samples, 22050);
    expect(buf.length).toBe(44 + 10);
    const d = decodeWav(buf);
    expect(d.sampleRate).toBe(22050);
    expect(Array.from(d.samples)).toEqual(Array.from(samples));
  });
  it("reports duration", () => {
    expect(wavDurationSeconds(encodeWav(silence(1.5, 16000), 16000))).toBeCloseTo(1.5, 5);
  });
  it("clamps float to int16", () => {
    expect(Array.from(floatToInt16(Float32Array.from([2, -2, 0.5])))).toEqual([32767, -32768, 16384]);
  });
  it("peak-normalizes", () => {
    const out = peakNormalize(Float32Array.from([0.1, -0.2]), 0.8);
    expect(out[1]).toBeCloseTo(-0.8, 5);
    expect(out[0]).toBeCloseTo(0.4, 5);
  });
  it("concatenates and resamples", () => {
    expect(concatInt16([Int16Array.from([1]), Int16Array.from([2, 3])]).length).toBe(3);
    expect(resampleInt16(new Int16Array(100), 22050, 44100).length).toBe(200);
  });
  it("rejects non-wav data", () => {
    expect(() => decodeWav(Buffer.from("hello world, not a wav file....................................."))).toThrow();
  });
});
