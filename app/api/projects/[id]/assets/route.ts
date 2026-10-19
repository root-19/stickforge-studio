import { HttpError } from "@/lib/server/errors";
import { assertProjectAccess } from "@/lib/server/auth";
import { withApi } from "@/lib/server/api";
import { importLinked, importUpload, listAssets } from "@/lib/server/assets";

type Ctx = RouteContext<"/api/projects/[id]/assets">;

export const GET = withApi<Ctx>(async (_req, ctx, { user }) => {
  const { id } = await ctx.params;
  assertProjectAccess(user, id);
  return Response.json(listAssets(id));
});

/**
 * Two ways to import:
 *  - Upload: raw file bytes as the body, file name in `x-file-name` (copied into the project's media folder).
 *  - Link:   JSON `{ "linkPath": "C:\\...\\clip.mp4" }` for a file inside an approved media folder (no copy).
 */
export const POST = withApi<Ctx>(async (req, ctx, { user }) => {
  const { id } = await ctx.params;
  assertProjectAccess(user, id);
  const type = req.headers.get("content-type") ?? "";
  if (type.startsWith("application/json")) {
    const body = (await req.json()) as { linkPath?: unknown };
    if (typeof body.linkPath !== "string") throw new HttpError(400, "linkPath is required");
    return Response.json(await importLinked(id, body.linkPath), { status: 201 });
  }
  const rawName = req.headers.get("x-file-name");
  if (!rawName || !req.body) throw new HttpError(400, "Send the file as the request body with an x-file-name header");
  let name: string;
  try {
    name = decodeURIComponent(rawName);
  } catch {
    throw new HttpError(400, "Invalid x-file-name header");
  }
  const len = req.headers.get("content-length");
  const asset = await importUpload(id, name, req.body, len ? Number(len) : null);
  return Response.json(asset, { status: 201 });
});
