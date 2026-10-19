import { withApi } from "@/lib/server/api";
import { HttpError } from "@/lib/server/errors";
import { removeVoice, VOICE_KEY_RE } from "@/lib/server/tts/voices";

type Ctx = RouteContext<"/api/voices/[key]">;

export const DELETE = withApi<Ctx>(async (_req, ctx) => {
  const { key } = await ctx.params;
  if (!VOICE_KEY_RE.test(key)) throw new HttpError(400, "Invalid voice key");
  removeVoice(key);
  return Response.json({ ok: true });
}, { role: "owner" });
