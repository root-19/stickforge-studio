import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Point the app at a throwaway data folder for one test file. */
export function setupTempHome(prefix = "stickforge-test-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.env.STICKFORGE_HOME = dir;
  return {
    dir,
    cleanup: async () => {
      const { closeDb } = await import("@/lib/server/db");
      closeDb();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
