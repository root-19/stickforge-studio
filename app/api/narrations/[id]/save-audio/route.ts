import { assertProjectAccess, projectIdOfNarration } from "@/lib/server/auth";
import { z } from "zod";
import { readJson, withApi } from "@/lib/server/api";
import { exportNarrationAudio, getNarration, narrationTimings } from "@/lib/server/narrations";
import { getProject, saveProjectState } from "@/lib/server/projects";
import { captionsFromSentences } from "@/lib/shared/captions";
import { fitScenesToDuration } from "@/lib/shared/timeline";
import { getAssetRow } from "@/lib/server/assets";

type Ctx = RouteContext<"/api/narrations/[id]/save-audio">;

/**
 * Save the narration as WAV (+ optional MP3) in the project's audio folder.
 * With `useInProject`, also put it on the editor's narration track and build
 * captions from the measured sentence timings.
 */
export const POST = withApi<Ctx>(async (req, ctx, { user }) => {
  const { id } = await ctx.params;
  assertProjectAccess(user, projectIdOfNarration(id));
  const body = await readJson(
    req,
    z.object({
      mp3: z.boolean().default(false),
      fileName: z.string().max(100).optional(),
      useInProject: z.boolean().default(false),
      buildCaptions: z.boolean().default(true),
      fitScenes: z.boolean().default(false),
    }),
  );
  const result = await exportNarrationAudio(id, body);
  let project = null;
  if (body.useInProject) {
    const n = getNarration(id);
    const current = getProject(n.projectId);
    const state = structuredClone(current.state);
    state.narration = { assetId: result.asset.id, volume: state.narration?.volume ?? 1, muted: false, offset: 0 };
    state.narrationId = n.id;
    if (body.buildCaptions) {
      state.captions.items = captionsFromSentences(narrationTimings(n), state.captions.style.wordsPerCaption);
      state.captions.timing = "sentence";
    }
    if (body.fitScenes && state.scenes.length && n.duration) {
      state.scenes = fitScenesToDuration(state.scenes, n.duration, (assetId) => {
        const row = getAssetRow(assetId);
        return row.kind === "video" ? row.duration : null;
      });
    }
    project = saveProjectState(n.projectId, state);
  }
  return Response.json({ ...result, project });
});
