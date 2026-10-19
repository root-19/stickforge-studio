import { z } from "zod";
import { readJson, withApi } from "@/lib/server/api";
import { createFromTemplate } from "@/lib/server/templates";

type Ctx = RouteContext<"/api/templates/[id]/use">;

/** Create a new project from a built-in template (renders its title cards locally with FFmpeg). */
export const POST = withApi<Ctx>(async (req, ctx, { user }) => {
  const { id } = await ctx.params;
  const body = await readJson(
    req,
    z.object({
      name: z.string().max(100).optional(),
      parentDir: z.string().max(1000).optional(),
      aspect: z.enum(["9:16", "16:9", "1:1", "4:5"]).optional(),
    }),
  );
  return Response.json(await createFromTemplate(id, { ...body, ownerId: user.id }), { status: 201 });
});
