import { assertProjectAccess, projectIdOfNarration } from "@/lib/server/auth";
import { z } from "zod";
import { readJson, withApi } from "@/lib/server/api";
import { deleteNarration, getNarration, narrationTimings, updateNarration } from "@/lib/server/narrations";
import { voiceSettingsSchema } from "@/lib/shared/types";

type Ctx = RouteContext<"/api/narrations/[id]">;

export const GET = withApi<Ctx>(async (_req, ctx, { user }) => {
  const { id } = await ctx.params;
  assertProjectAccess(user, projectIdOfNarration(id));
  const narration = getNarration(id);
  return Response.json({ narration, timings: narration.combinedHash ? narrationTimings(narration) : [] });
});

export const PATCH = withApi<Ctx>(async (req, ctx, { user }) => {
  const { id } = await ctx.params;
  assertProjectAccess(user, projectIdOfNarration(id));
  const body = await readJson(
    req,
    z.object({ name: z.string().max(100).optional(), script: z.string().max(100_000).optional(), settings: voiceSettingsSchema.optional() }),
  );
  return Response.json(updateNarration(id, body));
});

export const DELETE = withApi<Ctx>(async (_req, ctx, { user }) => {
  const { id } = await ctx.params;
  assertProjectAccess(user, projectIdOfNarration(id));
  deleteNarration(id);
  return Response.json({ ok: true });
});
