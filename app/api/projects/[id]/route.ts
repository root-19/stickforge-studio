import { z } from "zod";
import { assertProjectAccess } from "@/lib/server/auth";
import { readJson, withApi } from "@/lib/server/api";
import { deleteProject, getProject, markOpened, renameProject, saveProjectState } from "@/lib/server/projects";
import { listAssets } from "@/lib/server/assets";

type Ctx = RouteContext<"/api/projects/[id]">;

export const GET = withApi<Ctx>(async (req, ctx, { user }) => {
  const { id } = await ctx.params;
  assertProjectAccess(user, id);
  const project = getProject(id);
  if (new URL(req.url).searchParams.get("open") === "1") markOpened(id);
  return Response.json({ project, assets: listAssets(id) });
});

const patchSchema = z.object({
  name: z.string().max(100).optional(),
  state: z.unknown().optional(),
  baseRevision: z.number().int().optional(),
});

export const PATCH = withApi<Ctx>(async (req, ctx, { user }) => {
  const { id } = await ctx.params;
  assertProjectAccess(user, id);
  const body = await readJson(req, patchSchema);
  let project = getProject(id);
  if (body.name !== undefined) project = renameProject(id, body.name);
  if (body.state !== undefined) project = saveProjectState(id, body.state, body.baseRevision);
  return Response.json(project);
});

export const DELETE = withApi<Ctx>(async (req, ctx, { user }) => {
  const { id } = await ctx.params;
  assertProjectAccess(user, id);
  deleteProject(id, new URL(req.url).searchParams.get("deleteFiles") === "1");
  return Response.json({ ok: true });
});
