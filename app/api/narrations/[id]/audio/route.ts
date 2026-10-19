import fs from "node:fs";
import { assertProjectAccess, projectIdOfNarration } from "@/lib/server/auth";
import { withApi } from "@/lib/server/api";
import { HttpError } from "@/lib/server/errors";
import { combinedFile, getNarration, segmentFile } from "@/lib/server/narrations";
import { serveFile } from "@/lib/server/stream";

type Ctx = RouteContext<"/api/narrations/[id]/audio">;

/** Stream the full narration, or one paragraph with ?segment=<id>. */
export const GET = withApi<Ctx>(async (req, ctx, { user }) => {
  const { id } = await ctx.params;
  assertProjectAccess(user, projectIdOfNarration(id));
  const n = getNarration(id);
  const segId = new URL(req.url).searchParams.get("segment");
  let file: string;
  if (segId) {
    const seg = n.segments.find((s) => s.id === segId);
    if (!seg?.audioHash) throw new HttpError(404, "This paragraph has no audio yet");
    file = segmentFile(n, seg.audioHash);
  } else {
    if (!n.combinedHash) throw new HttpError(404, "Generate the narration first");
    file = combinedFile(n, n.combinedHash);
  }
  if (!fs.existsSync(file)) throw new HttpError(404, "Audio file missing; generate again");
  return serveFile(req, file);
});
