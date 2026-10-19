import { assertProjectAccess, projectIdOfNarration } from "@/lib/server/auth";
import { z } from "zod";
import { readJson, withApi } from "@/lib/server/api";
import { HttpError } from "@/lib/server/errors";
import { startJob } from "@/lib/server/jobs";
import { generateNarration, getNarration } from "@/lib/server/narrations";

type Ctx = RouteContext<"/api/narrations/[id]/generate">;

/** Generate audio for all paragraphs that need it, or just `segmentIds` (regenerate one paragraph). */
export const POST = withApi<Ctx>(async (req, ctx, { user }) => {
  const { id } = await ctx.params;
  assertProjectAccess(user, projectIdOfNarration(id));
  const { segmentIds } = await readJson(req, z.object({ segmentIds: z.array(z.string().max(64)).max(1000).optional() }));
  const n = getNarration(id);
  if (n.segments.length === 0) throw new HttpError(400, "The script is empty");
  if (segmentIds?.some((s) => !n.segments.find((g) => g.id === s))) throw new HttpError(400, "Unknown paragraph");
  const job = startJob("tts", (c) => generateNarration(id, segmentIds ?? null, c), { queue: "tts", meta: { userId: user.id } });
  return Response.json(job, { status: 202 });
});
