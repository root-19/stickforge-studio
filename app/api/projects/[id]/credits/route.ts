import { assertProjectAccess } from "@/lib/server/auth";
import { withApi } from "@/lib/server/api";
import { projectCredits } from "@/lib/server/assets";

type Ctx = RouteContext<"/api/projects/[id]/credits">;

/** Credits for downloaded stock media, ready to paste into a video description. */
export const GET = withApi<Ctx>(async (_req, ctx, { user }) => {
  const { id } = await ctx.params;
  assertProjectAccess(user, id);
  return Response.json(projectCredits(id));
});
