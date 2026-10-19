import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { withApi } from "@/lib/server/api";
import { HttpError } from "@/lib/server/errors";
import { validateAbsolutePath } from "@/lib/server/paths";

/**
 * Folder picker: lists sub-FOLDERS only (never file names or contents) so the
 * user can choose project/media/export folders. With no path, returns drives
 * and common user folders.
 */
export const GET = withApi(async (req) => {
  const raw = new URL(req.url).searchParams.get("path");
  if (!raw) {
    const home = os.homedir();
    const quick = ["Desktop", "Documents", "Videos", "Pictures", "Music", "Downloads"]
      .map((n) => ({ name: n, path: path.join(/*turbopackIgnore: true*/ home, n) }))
      .filter((q) => fs.existsSync(/*turbopackIgnore: true*/ q.path));
    const drives: { name: string; path: string }[] = [];
    if (process.platform === "win32") {
      for (let c = 67; c <= 90; c++) {
        const d = `${String.fromCharCode(c)}:\\`;
        if (fs.existsSync(d)) drives.push({ name: d, path: d });
      }
    } else drives.push({ name: "/", path: "/" });
    return Response.json({ path: null, parent: null, dirs: [...quick, ...drives] });
  }
  const dir = validateAbsolutePath(raw, "Folder");
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    throw new HttpError(404, `Cannot open folder: ${(e as Error).message}`);
  }
  const dirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !e.name.startsWith("$"))
    .map((e) => ({ name: e.name, path: path.join(dir, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
    .slice(0, 1000);
  const parent = path.dirname(dir) === dir ? null : path.dirname(dir);
  return Response.json({ path: dir, parent, dirs });
});
