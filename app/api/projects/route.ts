import { z } from "zod";
import { readJson, withApi } from "@/lib/server/api";
import { createProject, listProjects } from "@/lib/server/projects";

export const GET = withApi((_req, _ctx, { user }) => Response.json(listProjects(user.id)));

export const POST = withApi(async (req, _ctx, { user }) => {
  const body = await readJson(
    req,
    z.object({ name: z.string().max(100), parentDir: z.string().max(1000).optional(), aspect: z.enum(["9:16", "16:9", "1:1", "4:5"]).optional() }),
  );
  return Response.json(createProject({ ...body, ownerId: user.id }), { status: 201 });
});
