import { z } from "zod";
import { readJson, withApi } from "@/lib/server/api";
import { HttpError } from "@/lib/server/errors";
import { startJob } from "@/lib/server/jobs";
import { getCatalogEntry } from "@/lib/server/tts/catalog";
import { findInstalledVoice, installVoice, VOICE_KEY_RE } from "@/lib/server/tts/voices";

/**
 * Start downloading a voice. The UI must have shown size, source and license
 * and asked for confirmation; `confirmBytes` must match the catalog size so a
 * request can't silently download something bigger than what was shown.
 */
export const POST = withApi(async (req, _ctx, { user }) => {
  const { key, confirmBytes } = await readJson(
    req,
    z.object({ key: z.string().regex(VOICE_KEY_RE), confirmBytes: z.number().int().positive() }),
  );
  const entry = getCatalogEntry(key);
  if (!entry) throw new HttpError(404, "Unknown voice");
  if (confirmBytes !== entry.totalBytes) throw new HttpError(409, "Download size changed; review the voice details again.");
  if (findInstalledVoice(key)) throw new HttpError(409, "Already installed");
  const job = startJob("voice-install", (ctx) => installVoice(key, ctx), { queue: "voice-install", meta: { key, userId: user.id } });
  return Response.json(job, { status: 202 });
});
