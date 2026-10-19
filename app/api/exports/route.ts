import { assertProjectAccess, userProjectIds } from "@/lib/server/auth";
import { readJson, withApi } from "@/lib/server/api";
import { listExports, recoverInterruptedExports, startExport } from "@/lib/server/exporter";
import { exportRequestSchema } from "@/lib/shared/types";

let recovered = false;

export const GET = withApi((_req, _ctx, { user }) => {
  if (!recovered) {
    recovered = true;
    recoverInterruptedExports();
  }
  const mine = userProjectIds(user.id);
  return Response.json(listExports().filter((e) => mine.has(e.projectId)));
});

export const POST = withApi(async (req, _ctx, { user }) => {
  const body = await readJson(req, exportRequestSchema);
  assertProjectAccess(user, body.projectId);
  return Response.json(startExport(body, user.id), { status: 202 });
});
