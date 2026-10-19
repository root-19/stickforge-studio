import { z } from "zod";
import { assertProjectAccess } from "@/lib/server/auth";
import { readJson, withApi } from "@/lib/server/api";
import { startJob } from "@/lib/server/jobs";
import { importStock } from "@/lib/server/stock";
import { getProject, saveProjectState } from "@/lib/server/projects";
import { sceneSchema } from "@/lib/shared/types";

/**
 * Download a stock item (looked up again by id on the provider's API — the
 * browser never supplies a download URL) into the project's media folder.
 */
export const POST = withApi(async (req, _ctx, { user }) => {
  const body = await readJson(
    req,
    z.object({
      projectId: z.string().min(1).max(64),
      provider: z.enum(["pexels", "commons"]),
      kind: z.enum(["video", "image"]),
      id: z.string().min(1).max(20),
      addToTimeline: z.boolean().default(false),
    }),
  );
  assertProjectAccess(user, body.projectId);
  getProject(body.projectId);
  const job = startJob(
    "convert",
    async (ctx) => {
      const asset = await importStock(body.projectId, body.provider, body.kind, body.id, ctx);
      if (body.addToTimeline && asset.kind !== "audio") {
        const p = getProject(body.projectId);
        const scene = sceneSchema.parse({
          id: `stk${Date.now().toString(36)}`,
          assetId: asset.id,
          duration: asset.kind === "video" ? Math.round(Math.max(0.5, Math.min(asset.duration ?? 5, 10)) * 100) / 100 : 4,
          motion: asset.kind === "image" ? "zoomIn" : "none",
          fit: "cover",
        });
        saveProjectState(body.projectId, { ...p.state, scenes: [...p.state.scenes, scene] });
      }
      return asset;
    },
    { queue: "stock", meta: { provider: body.provider, id: body.id, userId: user.id } },
  );
  return Response.json(job, { status: 202 });
});
