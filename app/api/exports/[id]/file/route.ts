import fs from "node:fs";
import path from "node:path";
import { assertProjectAccess, projectIdOfExport } from "@/lib/server/auth";
import { withApi } from "@/lib/server/api";
import { HttpError } from "@/lib/server/errors";
import { getExport } from "@/lib/server/exporter";
import { serveFile } from "@/lib/server/stream";

type Ctx = RouteContext<"/api/exports/[id]/file">;

/** Stream an exported MP4 (or its SRT with ?srt=1). Add ?download=1 to save it. */
export const GET = withApi<Ctx>(async (req, ctx, { user }) => {
  const { id } = await ctx.params;
  assertProjectAccess(user, projectIdOfExport(id));
  const rec = getExport(id);
  if (rec.status !== "done") throw new HttpError(409, "Export is not finished");
  const url = new URL(req.url);
  const file = url.searchParams.get("srt") === "1" ? rec.srtPath : rec.outputPath;
  if (!file || !fs.existsSync(file)) throw new HttpError(404, "The exported file was moved or deleted");
  return serveFile(req, file, { download: url.searchParams.get("download") === "1" ? path.basename(file) : undefined });
});
