import { assertProjectAccess, projectIdOfExport } from "@/lib/server/auth";
import { withApi } from "@/lib/server/api";
import { cancelExport, deleteExportRecord, getExport } from "@/lib/server/exporter";

type Ctx = RouteContext<"/api/exports/[id]">;

export const GET = withApi<Ctx>(async (_req, ctx, { user }) => {
  const { id } = await ctx.params;
  assertProjectAccess(user, projectIdOfExport(id));
  return Response.json(getExport(id));
});

/** POST = cancel. */
export const POST = withApi<Ctx>(async (_req, ctx, { user }) => {
  const { id } = await ctx.params;
  assertProjectAccess(user, projectIdOfExport(id));
  return Response.json(cancelExport(id));
});

export const DELETE = withApi<Ctx>(async (req, ctx, { user }) => {
  const { id } = await ctx.params;
  assertProjectAccess(user, projectIdOfExport(id));
  deleteExportRecord(id, new URL(req.url).searchParams.get("deleteFile") === "1");
  return Response.json({ ok: true });
});
