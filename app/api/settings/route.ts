import fs from "node:fs";
import { z } from "zod";
import { readJson, withApi } from "@/lib/server/api";
import { HttpError } from "@/lib/server/errors";
import { getSettings, settingsSchema, updateSettings } from "@/lib/server/settings";
import { ensureWritableDir, validateAbsolutePath } from "@/lib/server/paths";
import { isValidToolPath } from "@/lib/server/ffmpeg/locate";

/** The Pexels key stays on the server; the UI only learns whether one is set. */
function publicSettings(s: ReturnType<typeof getSettings>) {
  const { pexelsApiKey, ...rest } = s;
  return { ...rest, pexelsApiKey: "", pexelsApiKeySet: pexelsApiKey.trim().length > 0 };
}

export const GET = withApi(() => Response.json(publicSettings(getSettings())));

const patchSchema = settingsSchema.partial().extend({ mediaFolders: z.array(z.string().max(1000)).max(50).optional() });

export const PUT = withApi(async (req) => {
  const patch = await readJson(req, patchSchema);
  for (const key of ["projectsDir", "voicesDir"] as const) {
    if (patch[key] !== undefined) {
      const p = validateAbsolutePath(patch[key], key === "projectsDir" ? "Projects folder" : "Voices folder");
      const w = ensureWritableDir(p);
      if (!w.ok) throw new HttpError(400, `Cannot write to ${p}: ${w.error}`);
      patch[key] = p;
    }
  }
  if (patch.exportDir) {
    const p = validateAbsolutePath(patch.exportDir, "Export folder");
    const w = ensureWritableDir(p);
    if (!w.ok) throw new HttpError(400, `Cannot write to ${p}: ${w.error}`);
    patch.exportDir = p;
  }
  if (patch.mediaFolders) {
    patch.mediaFolders = [...new Set(patch.mediaFolders.map((f) => validateAbsolutePath(f, "Media folder")))];
    for (const f of patch.mediaFolders) {
      if (!fs.existsSync(f) || !fs.statSync(f).isDirectory()) throw new HttpError(400, `Folder not found: ${f}`);
    }
  }
  for (const [key, tool] of [["ffmpegPath", "ffmpeg"], ["ffprobePath", "ffprobe"]] as const) {
    const v = patch[key];
    if (v && !isValidToolPath(v, tool)) throw new HttpError(400, `${key}: must be the full path to ${tool}.exe`);
  }
  if (patch.pexelsApiKey !== undefined) {
    patch.pexelsApiKey = patch.pexelsApiKey.trim();
    if (patch.pexelsApiKey && !/^[A-Za-z0-9]{20,100}$/.test(patch.pexelsApiKey)) throw new HttpError(400, "That doesn't look like a Pexels API key");
  }
  return Response.json(publicSettings(updateSettings(patch)));
}, { role: "owner" });
