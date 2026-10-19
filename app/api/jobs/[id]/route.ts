import { withApi } from "@/lib/server/api";
import { HttpError } from "@/lib/server/errors";
import { cancelJob, getJob } from "@/lib/server/jobs";

type Ctx = RouteContext<"/api/jobs/[id]">;

/** Jobs record who started them; other accounts can't see or cancel them. */
function mine(job: ReturnType<typeof getJob>, userId: string) {
  return !!job && (!job.meta.userId || job.meta.userId === userId);
}

export const GET = withApi<Ctx>(async (_req, ctx, { user }) => {
  const { id } = await ctx.params;
  const job = getJob(id);
  if (!job || !mine(job, user.id)) throw new HttpError(404, "Job not found (the app may have restarted)");
  return Response.json(job);
});

/** Cancel a running or queued job. */
export const DELETE = withApi<Ctx>(async (_req, ctx, { user }) => {
  const { id } = await ctx.params;
  if (!mine(getJob(id), user.id)) throw new HttpError(404, "Job not found");
  const job = cancelJob(id);
  if (!job) throw new HttpError(404, "Job not found");
  return Response.json(job);
});
