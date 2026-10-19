import { withApi } from "@/lib/server/api";
import { assertProjectAccess } from "@/lib/server/auth";
import { deleteRecording, getRecording } from "@/lib/server/recordings";

type Ctx = RouteContext<"/api/projects/[id]/recordings/[rid]">;

export const GET = withApi<Ctx>(async (_req, ctx, { user }) => {
  const { id, rid } = await ctx.params;
  assertProjectAccess(user, id);
  return Response.json(getRecording(id, rid));
});

export const DELETE = withApi<Ctx>(async (_req, ctx, { user }) => {
  const { id, rid } = await ctx.params;
  assertProjectAccess(user, id);
  deleteRecording(id, rid);
  return Response.json({ ok: true });
});
