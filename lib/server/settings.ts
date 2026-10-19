import "server-only";
import { z } from "zod";
import { getDb } from "./db";
import { defaultProjectsDir, defaultVoicesDir } from "./env";
import { voiceSettingsSchema } from "@/lib/shared/types";

export const DEFAULT_MALE_VOICE = "en_US-joe-medium";
export const DEFAULT_FEMALE_VOICE = "en_US-kristin-medium";

export const settingsSchema = z.object({
  projectsDir: z.string().max(1000),
  voicesDir: z.string().max(1000),
  /** Extra folders the app may read media from (link-in-place import + folder browser). */
  mediaFolders: z.array(z.string().max(1000)).max(50),
  /** Optional default export folder. Empty = each project's "exports" folder. */
  exportDir: z.string().max(1000),
  ffmpegPath: z.string().max(1000),
  ffprobePath: z.string().max(1000),
  defaultVoice: voiceSettingsSchema,
  /** Shown once on first launch. */
  onboardingDone: z.boolean(),
  /** Free key from https://www.pexels.com/api/ — optional, only for stock search. Never sent to the browser. */
  pexelsApiKey: z.string().max(200),
  /** Let new people create local accounts (the first account can always be created). */
  allowRegistration: z.boolean(),
});
export type Settings = z.infer<typeof settingsSchema>;

export function defaultSettings(): Settings {
  return {
    projectsDir: defaultProjectsDir(),
    voicesDir: defaultVoicesDir(),
    mediaFolders: [],
    exportDir: "",
    ffmpegPath: "",
    ffprobePath: "",
    defaultVoice: voiceSettingsSchema.parse({ voiceKey: DEFAULT_MALE_VOICE }),
    onboardingDone: false,
    pexelsApiKey: "",
    allowRegistration: true,
  };
}

export function getSettings(): Settings {
  const rows = getDb().prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const stored: Record<string, unknown> = {};
  for (const r of rows) {
    try {
      stored[r.key] = JSON.parse(r.value);
    } catch {
      /* ignore corrupt values; defaults apply */
    }
  }
  const merged = { ...defaultSettings(), ...stored };
  const parsed = settingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : defaultSettings();
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const next = settingsSchema.parse({ ...getSettings(), ...patch });
  const db = getDb();
  const stmt = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  db.exec("BEGIN");
  try {
    for (const k of Object.keys(patch)) {
      if (k in next) stmt.run(k, JSON.stringify(next[k as keyof Settings]));
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return next;
}
