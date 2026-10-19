import { z } from "zod";
import { readJson, withApi } from "@/lib/server/api";
import { assertProjectAccess } from "@/lib/server/auth";
import { HttpError } from "@/lib/server/errors";
import { startJob } from "@/lib/server/jobs";
import { getRecording } from "@/lib/server/recordings";
import { matchVoices } from "@/lib/server/voice-match";

type Ctx = RouteContext<"/api/projects/[id]/recordings/[rid]/match">;

/** Find AI voices that sound closest to this recording (downloads official samples once). */
export const POST = withApi<Ctx>(async (req, ctx, { user }) => {
  const { id, rid } = await ctx.params;
  assertProjectAccess(user, id);
  const body = await readJson(req, z.object({ region: z.enum(["en_US", "en_GB", "any"]).default("any"), commercialOnly: z.boolean().default(true) }));
  const rec = getRecording(id, rid);
  if (!rec.features || !rec.features.f0) throw new HttpError(422, "Couldn't hear a voice in this recording. Record at least 5 seconds of speech.");
  const features = rec.features;
  const job = startJob("convert", (c) => matchVoices(features, body, c), { queue: "voice-match", meta: { userId: user.id } });
  return Response.json(job, { status: 202 });
});
