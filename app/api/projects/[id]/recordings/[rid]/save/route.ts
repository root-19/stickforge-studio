import { z } from "zod";
import { readJson, withApi } from "@/lib/server/api";
import { assertProjectAccess } from "@/lib/server/auth";
import { saveRecordingAsAsset } from "@/lib/server/recordings";
import { getProject, saveProjectState } from "@/lib/server/projects";
import { captionsFromScript } from "@/lib/shared/captions";
import { enhanceOptionsSchema } from "@/lib/shared/recording";

type Ctx = RouteContext<"/api/projects/[id]/recordings/[rid]/save">;

/**
 * Save the recording (cleaned up or original) as project audio. Optionally put
 * it on the narration track and build captions from the script (timing estimated).
 */
export const POST = withApi<Ctx>(async (req, ctx, { user }) => {
  const { id, rid } = await ctx.params;
  assertProjectAccess(user, id);
  const body = await readJson(
    req,
    z.object({
      options: enhanceOptionsSchema.nullable(),
      name: z.string().max(100).default("My voice"),
      useAsNarration: z.boolean().default(false),
      script: z.string().max(100_000).optional(),
    }),
  );
  const asset = await saveRecordingAsAsset(id, rid, body.options, body.name);
  let project = null;
  if (body.useAsNarration) {
    const p = getProject(id);
    const state = structuredClone(p.state);
    state.narration = { assetId: asset.id, volume: 1, muted: false, offset: 0 };
    if (body.script?.trim() && asset.duration) {
      state.captions.items = captionsFromScript(body.script, asset.duration, state.captions.style.wordsPerCaption);
      state.captions.timing = "estimated";
    }
    project = saveProjectState(id, state);
  }
  return Response.json({ asset, project }, { status: 201 });
});
