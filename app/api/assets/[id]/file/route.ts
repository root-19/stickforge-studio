import { assertProjectAccess, projectIdOfAsset } from "@/lib/server/auth";
import { withApi } from "@/lib/server/api";
import { assertServable, getAssetRow } from "@/lib/server/assets";
import { serveFile } from "@/lib/server/stream";

type Ctx = RouteContext<"/api/assets/[id]/file">;

export const GET = withApi<Ctx>(async (req, ctx, { user }) => {
  const { id } = await ctx.params;
  assertProjectAccess(user, projectIdOfAsset(id));
  const row = getAssetRow(id);
  assertServable(row);
  return serveFile(req, row.path);
});
