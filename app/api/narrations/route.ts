import { z } from "zod";
import { assertProjectAccess } from "@/lib/server/auth";
import { readJson, withApi } from "@/lib/server/api";
import { HttpError } from "@/lib/server/errors";
import { createNarration, listNarrations } from "@/lib/server/narrations";
import { voiceSettingsSchema } from "@/lib/shared/types";

export const GET = withApi(async (req, _ctx, { user }) => {
  const projectId = new URL(req.url).searchParams.get("projectId");
  if (!projectId) throw new HttpError(400, "projectId is required");
  assertProjectAccess(user, projectId);
  return Response.json(listNarrations(projectId));
});

export const POST = withApi(async (req, _ctx, { user }) => {
  const body = await readJson(
    req,
    z.object({
      projectId: z.string().min(1).max(64),
      name: z.string().max(100).optional(),
      script: z.string().max(100_000).optional(),
      settings: voiceSettingsSchema,
    }),
  );
  assertProjectAccess(user, body.projectId);
  return Response.json(createNarration(body.projectId, body), { status: 201 });
});
