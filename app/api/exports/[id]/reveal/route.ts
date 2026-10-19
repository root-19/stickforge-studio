import fs from "node:fs";
import { assertProjectAccess, projectIdOfExport } from "@/lib/server/auth";
import { spawn } from "node:child_process";
import { withApi } from "@/lib/server/api";
import { HttpError } from "@/lib/server/errors";
import { getExport } from "@/lib/server/exporter";

type Ctx = RouteContext<"/api/exports/[id]/reveal">;

/** Show the exported file in Windows Explorer. */
export const POST = withApi<Ctx>(async (_req, ctx, { user }) => {
  const { id } = await ctx.params;
  assertProjectAccess(user, projectIdOfExport(id));
  const rec = getExport(id);
  if (!fs.existsSync(rec.outputPath)) throw new HttpError(404, "The exported file was moved or deleted");
  if (process.platform !== "win32") throw new HttpError(501, "Reveal is only implemented on Windows");
  if (/["\r\n]/.test(rec.outputPath)) throw new HttpError(400, "Unsupported path");
  // explorer.exe needs `/select,"<path>"` verbatim; the path is app-generated and quote-free.
  spawn("explorer.exe", [`/select,"${rec.outputPath}"`], { windowsVerbatimArguments: true, detached: true, stdio: "ignore" }).unref();
  return Response.json({ ok: true });
});
