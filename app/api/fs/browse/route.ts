import fs from "node:fs";
import path from "node:path";
import { withApi } from "@/lib/server/api";
import { HttpError } from "@/lib/server/errors";
import { getSettings } from "@/lib/server/settings";
import { isInsideAny, validateAbsolutePath } from "@/lib/server/paths";
import { assetKindForExtension } from "@/lib/shared/types";

/** Media browser for "link in place" imports. Restricted to approved media folders. */
export const GET = withApi(async (req) => {
  const roots = getSettings().mediaFolders.filter((f) => fs.existsSync(f));
  const raw = new URL(req.url).searchParams.get("path");
  if (!raw) {
    return Response.json({ path: null, parent: null, roots, dirs: roots.map((r) => ({ name: r, path: r })), files: [] });
  }
  const dir = validateAbsolutePath(raw, "Folder");
  if (!isInsideAny(roots, dir)) throw new HttpError(403, "Folder is not inside an approved media folder (Settings → Media folders)");
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const dirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => ({ name: e.name, path: path.join(dir, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const files = entries
    .filter((e) => e.isFile() && assetKindForExtension(path.extname(e.name)))
    .map((e) => {
      const p = path.join(dir, e.name);
      return { name: e.name, path: p, kind: assetKindForExtension(path.extname(e.name)), size: fs.statSync(p).size };
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 2000);
  const parentDir = path.dirname(dir);
  const parent = parentDir !== dir && isInsideAny(roots, parentDir) ? parentDir : null;
  return Response.json({ path: dir, parent, roots, dirs, files });
});
