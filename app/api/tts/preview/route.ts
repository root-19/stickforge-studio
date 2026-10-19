import { z } from "zod";
import { readJson, withApi } from "@/lib/server/api";
import { HttpError } from "@/lib/server/errors";
import { findInstalledVoice, modelPathFor } from "@/lib/server/tts/voices";
import { loadVoice, synthesizeTexts, withTtsLock } from "@/lib/server/tts/piper";
import { concatInt16, encodeWav, floatToInt16, peakNormalize, silence } from "@/lib/server/tts/wav";
import { splitSentences } from "@/lib/shared/script";
import { voiceSettingsSchema } from "@/lib/shared/types";

/** Quick, short synthesis for auditioning a voice. Returns audio/wav directly. */
export const POST = withApi(async (req) => {
  const body = await readJson(req, voiceSettingsSchema.extend({ text: z.string().min(1).max(600) }));
  const voice = findInstalledVoice(body.voiceKey);
  if (!voice) throw new HttpError(404, `Voice ${body.voiceKey} is not installed`);
  const loaded = await loadVoice(voice.key, modelPathFor(voice));
  const sr = loaded.config.audio.sample_rate;
  const sentences = splitSentences(body.text);
  if (sentences.length === 0) throw new HttpError(400, "Nothing to say");
  const pcms = await withTtsLock(() => synthesizeTexts(loaded, sentences, body));
  const parts: Int16Array[] = [];
  pcms.forEach((p, i) => {
    parts.push(floatToInt16(peakNormalize(p)));
    if (i < pcms.length - 1) parts.push(silence(body.sentencePause, sr));
  });
  return new Response(new Uint8Array(encodeWav(concatInt16(parts), sr)), {
    headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" },
  });
});
