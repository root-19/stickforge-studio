import { withApi } from "@/lib/server/api";
import { assertProjectAccess } from "@/lib/server/auth";
import { HttpError } from "@/lib/server/errors";
import { listRecordings, saveRecording } from "@/lib/server/recordings";

type Ctx = RouteContext<"/api/projects/[id]/recordings">;

export const GET = withApi<Ctx>(async (_req, ctx, { user }) => {
  const { id } = await ctx.params;
  assertProjectAccess(user, id);
  return Response.json(listRecordings(id));
});

/** Upload a microphone recording (raw body, e.g. audio/webm from MediaRecorder). */
export const POST = withApi<Ctx>(async (req, ctx, { user }) => {
  const { id } = await ctx.params;
  assertProjectAccess(user, id);
  if (!req.body) throw new HttpError(400, "No audio received");
  return Response.json(await saveRecording(id, req.body, req.headers.get("content-type") ?? ""), { status: 201 });
});
