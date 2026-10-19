import { z } from "zod";
import { readJson, withApi } from "@/lib/server/api";
import { claimUnownedProjects, unownedProjects } from "@/lib/server/auth";
import { deleteProject } from "@/lib/server/projects";

/** Projects from before accounts existed — hidden from every dashboard until the owner decides. */
export const GET = withApi(() => Response.json(unownedProjects()), { role: "owner" });

export const POST = withApi(
  async (req, _ctx, { user }) => {
    const { action, ids } = await readJson(req, z.object({ action: z.enum(["claim", "remove"]), ids: z.array(z.string().max(64)).max(1000) }));
    const unowned = new Set(unownedProjects().map((p) => p.id));
    const targets = ids.filter((id) => unowned.has(id));
    if (action === "claim") return Response.json({ count: claimUnownedProjects(user.id, targets) });
    // "Remove" only forgets the project in StickForge; its folder and files stay on disk.
    for (const id of targets) deleteProject(id, false);
    return Response.json({ count: targets.length });
  },
  { role: "owner" },
);
