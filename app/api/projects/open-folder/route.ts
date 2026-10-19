import { z } from "zod";
import { readJson, withApi } from "@/lib/server/api";
import { openProjectFolder } from "@/lib/server/projects";

export const POST = withApi(async (req, _ctx, { user }) => {
  const { folder } = await readJson(req, z.object({ folder: z.string().max(1000) }));
  return Response.json(openProjectFolder(folder, user.id));
});
