import { assertProjectAccess, projectIdOfAsset } from "@/lib/server/auth";
import { z } from "zod";
import { readJson, withApi } from "@/lib/server/api";
import { deleteAsset, getAsset, relinkAsset } from "@/lib/server/assets";

type Ctx = RouteContext<"/api/assets/[id]">;

export const GET = withApi<Ctx>(async (_req, ctx, { user }) => {
  const { id } = await ctx.params;
  assertProjectAccess(user, projectIdOfAsset(id));
  return Response.json(getAsset(id));
});

/** Point a missing asset at its new location. */
export const PATCH = withApi<Ctx>(async (req, ctx, { user }) => {
  const { id } = await ctx.params;
  assertProjectAccess(user, projectIdOfAsset(id));
  const { path } = await readJson(req, z.object({ path: z.string().max(1000) }));
  return Response.json(relinkAsset(id, path));
});

export const DELETE = withApi<Ctx>(async (_req, ctx, { user }) => {
  const { id } = await ctx.params;
  assertProjectAccess(user, projectIdOfAsset(id));
  deleteAsset(id);
  return Response.json({ ok: true });
});
