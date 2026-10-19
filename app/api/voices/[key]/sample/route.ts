import fs from "node:fs";
import { withApi } from "@/lib/server/api";
import { getVoiceSample } from "@/lib/server/tts/samples";

type Ctx = RouteContext<"/api/voices/[key]/sample">;

/**
 * Official Piper sample recording for a catalog voice, so you can listen
 * before downloading the model. Fetched once (internet) and cached locally.
 */
export const GET = withApi<Ctx>(async (req, ctx) => {
  const { key } = await ctx.params;
  const speaker = Number(new URL(req.url).searchParams.get("speaker") ?? 0) || 0;
  const file = await getVoiceSample(key, speaker);
  return new Response(new Uint8Array(fs.readFileSync(file)), {
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=86400" },
  });
});
