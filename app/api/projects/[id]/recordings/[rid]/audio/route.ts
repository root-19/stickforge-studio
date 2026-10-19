import { withApi } from "@/lib/server/api";
import { assertProjectAccess } from "@/lib/server/auth";
import { enhancedFile, originalWav } from "@/lib/server/recordings";
import { serveFile } from "@/lib/server/stream";
import { enhanceOptionsSchema } from "@/lib/shared/recording";

type Ctx = RouteContext<"/api/projects/[id]/recordings/[rid]/audio">;

/** Stream the original recording, or a cleaned-up version (?version=enhanced&noise=1&...). */
export const GET = withApi<Ctx>(async (req, ctx, { user }) => {
  const { id, rid } = await ctx.params;
  assertProjectAccess(user, id);
  const q = new URL(req.url).searchParams;
  if (q.get("version") !== "enhanced") return serveFile(req, originalWav(id, rid));
  const flag = (k: string) => q.get(k) === "1";
  const opts = enhanceOptionsSchema.parse({ noise: flag("noise"), rumble: flag("rumble"), level: flag("level"), trim: flag("trim"), pitch: Number(q.get("pitch") ?? 0) });
  return serveFile(req, await enhancedFile(id, rid, opts));
});
