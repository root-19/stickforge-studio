import fs from "node:fs";
import { assertProjectAccess, projectIdOfAsset } from "@/lib/server/auth";
import { withApi } from "@/lib/server/api";
import { HttpError } from "@/lib/server/errors";
import { getAssetRow } from "@/lib/server/assets";
import { projectFolder } from "@/lib/server/projects";
import { isInside } from "@/lib/server/paths";
import { serveFile } from "@/lib/server/stream";

type Ctx = RouteContext<"/api/assets/[id]/thumbnail">;

export const GET = withApi<Ctx>(async (req, ctx, { user }) => {
  const { id } = await ctx.params;
  assertProjectAccess(user, projectIdOfAsset(id));
  const row = getAssetRow(id);
  if (!row.thumb_path || !fs.existsSync(row.thumb_path) || !isInside(projectFolder(row.project_id), row.thumb_path)) {
    throw new HttpError(404, "No thumbnail");
  }
  return serveFile(req, row.thumb_path, { cache: true });
});
