import "server-only";
import fs from "node:fs";
import path from "node:path";
import { getDb, newId, nowIso } from "./db";
import { getSettings } from "./settings";
import { HttpError } from "./errors";
import { ensureWritableDir, isInside, safeFileName, uniquePath, validateAbsolutePath, writeFileAtomic } from "./paths";
import { DEFAULT_CAPTION_Y, emptyProjectState, projectStateSchema, type AspectId, type Project, type ProjectState, type ProjectSummary } from "@/lib/shared/types";

function stateForAspect(aspect: AspectId): ProjectState {
  const s = emptyProjectState();
  return { ...s, aspect, captions: { ...s.captions, style: { ...s.captions.style, positionY: DEFAULT_CAPTION_Y[aspect] } } };
}
import { timelineDuration } from "@/lib/shared/timeline";

export const PROJECT_FILE = "project.stickforge.json";
export const PROJECT_SUBDIRS = ["media", "audio", "narration", "exports", ".thumbs"] as const;

type ProjectRow = {
  id: string;
  name: string;
  folder: string;
  state_json: string;
  revision: number;
  created_at: string;
  updated_at: string;
  opened_at: string | null;
};

function parseState(json: string): ProjectState {
  try {
    const r = projectStateSchema.safeParse(JSON.parse(json));
    if (r.success) return r.data;
  } catch {
    /* fall through */
  }
  return emptyProjectState();
}

function toSummary(row: ProjectRow, state: ProjectState): ProjectSummary {
  const firstVisual = state.scenes[0]?.assetId ?? null;
  return {
    id: row.id,
    name: row.name,
    folder: row.folder,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sceneCount: state.scenes.length,
    duration: timelineDuration(state),
    thumbnailAssetId: firstVisual,
    folderAvailable: fs.existsSync(row.folder),
    aspect: state.aspect,
  };
}

function getRow(id: string): ProjectRow {
  const row = getDb().prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
  if (!row) throw new HttpError(404, "Project not found");
  return row;
}

export function listProjects(ownerId: string): ProjectSummary[] {
  const rows = getDb()
    .prepare("SELECT * FROM projects WHERE owner_id = ? ORDER BY COALESCE(opened_at, updated_at) DESC")
    .all(ownerId) as ProjectRow[];
  return rows.map((r) => toSummary(r, parseState(r.state_json)));
}

export function getProject(id: string): Project {
  const row = getRow(id);
  const state = parseState(row.state_json);
  return { ...toSummary(row, state), state, revision: row.revision };
}

export function projectFolder(id: string): string {
  return getRow(id).folder;
}

export function allProjectFolders(): string[] {
  return (getDb().prepare("SELECT folder FROM projects").all() as { folder: string }[]).map((r) => r.folder);
}

/** Write the portable project file so the project can be recovered from its folder alone. */
export function writeProjectFile(id: string) {
  const row = getRow(id);
  if (!fs.existsSync(row.folder)) return;
  const assets = getDb().prepare("SELECT * FROM assets WHERE project_id = ?").all(id);
  const narrations = getDb().prepare("SELECT * FROM narrations WHERE project_id = ?").all(id);
  writeFileAtomic(
    path.join(row.folder, PROJECT_FILE),
    JSON.stringify(
      {
        format: "stickforge-project",
        formatVersion: 1,
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        revision: row.revision,
        state: parseState(row.state_json),
        assets,
        narrations,
      },
      null,
      1,
    ),
  );
}

export function createProject(input: { name: string; parentDir?: string; aspect?: AspectId; ownerId?: string | null }): Project {
  const name = input.name.trim().slice(0, 100) || "Untitled project";
  const parent = input.parentDir ? validateAbsolutePath(input.parentDir, "Project folder") : path.resolve(getSettings().projectsDir);
  const w = ensureWritableDir(parent);
  if (!w.ok) throw new HttpError(400, `Cannot write to ${parent}: ${w.error}`);
  const folder = uniquePath(parent, safeFileName(name, "Project"));
  fs.mkdirSync(folder, { recursive: true });
  for (const sub of PROJECT_SUBDIRS) fs.mkdirSync(path.join(/*turbopackIgnore: true*/ folder, sub), { recursive: true });
  const id = newId("prj");
  const now = nowIso();
  getDb()
    .prepare("INSERT INTO projects (id, name, folder, state_json, revision, created_at, updated_at, opened_at, owner_id) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)")
    .run(id, name, folder, JSON.stringify(stateForAspect(input.aspect ?? "9:16")), now, now, now, input.ownerId ?? null);
  writeProjectFile(id);
  return getProject(id);
}

export function renameProject(id: string, name: string): Project {
  const n = name.trim().slice(0, 100);
  if (!n) throw new HttpError(400, "Name is required");
  getDb().prepare("UPDATE projects SET name = ?, updated_at = ? WHERE id = ?").run(n, nowIso(), id);
  writeProjectFile(id);
  return getProject(id);
}

export function markOpened(id: string) {
  getDb().prepare("UPDATE projects SET opened_at = ? WHERE id = ?").run(nowIso(), id);
}

/**
 * Save editor state. `baseRevision` guards against two tabs overwriting each
 * other: a stale revision gets a 409 with the current server copy.
 */
export function saveProjectState(id: string, state: unknown, baseRevision?: number): Project {
  const row = getRow(id);
  if (baseRevision !== undefined && baseRevision !== row.revision) {
    throw new HttpError(409, "This project was changed in another window.", { revision: row.revision });
  }
  const parsed = projectStateSchema.parse(state);
  const assetIds = new Set(
    (getDb().prepare("SELECT id FROM assets WHERE project_id = ?").all(id) as { id: string }[]).map((r) => r.id),
  );
  const referenced = [
    ...parsed.scenes.map((s) => s.assetId),
    ...(parsed.narration ? [parsed.narration.assetId] : []),
    ...(parsed.music ? [parsed.music.assetId] : []),
  ];
  const unknown = referenced.filter((a) => !assetIds.has(a));
  if (unknown.length) throw new HttpError(400, `State references unknown media: ${[...new Set(unknown)].join(", ")}`);
  getDb()
    .prepare("UPDATE projects SET state_json = ?, revision = revision + 1, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(parsed), nowIso(), id);
  writeProjectFile(id);
  return getProject(id);
}

export function deleteProject(id: string, deleteFiles: boolean) {
  const row = getRow(id);
  if (deleteFiles && fs.existsSync(row.folder)) {
    // Only delete folders that are clearly StickForge project folders.
    if (!fs.existsSync(path.join(row.folder, PROJECT_FILE))) {
      throw new HttpError(400, "Folder does not look like a StickForge project folder; not deleting files.");
    }
    const root = path.parse(row.folder).root;
    if (path.resolve(row.folder) === path.resolve(root)) throw new HttpError(400, "Refusing to delete a drive root");
    fs.rmSync(row.folder, { recursive: true, force: true });
  }
  getDb().prepare("DELETE FROM projects WHERE id = ?").run(id);
}

/** Re-register a project from its folder (after reinstalling, or if the database was lost). */
export function openProjectFolder(folderInput: string, ownerId: string | null = null): Project {
  const folder = validateAbsolutePath(folderInput, "Project folder");
  const file = path.join(folder, PROJECT_FILE);
  if (!fs.existsSync(file)) throw new HttpError(404, `No ${PROJECT_FILE} found in that folder`);
  const data = JSON.parse(fs.readFileSync(file, "utf8")) as {
    format?: string;
    id?: string;
    name?: string;
    createdAt?: string;
    state?: unknown;
    assets?: Record<string, unknown>[];
    narrations?: Record<string, unknown>[];
  };
  if (data.format !== "stickforge-project" || typeof data.id !== "string") throw new HttpError(400, "Not a StickForge project file");
  const db = getDb();
  const existing = db.prepare("SELECT id, folder, owner_id FROM projects WHERE id = ?").get(data.id) as { id: string; folder: string; owner_id: string | null } | undefined;
  if (existing && ownerId && existing.owner_id && existing.owner_id !== ownerId) {
    throw new HttpError(409, "This project folder is already open in another account on this computer.");
  }
  if (existing) {
    if (ownerId && !existing.owner_id) db.prepare("UPDATE projects SET owner_id = ? WHERE id = ?").run(ownerId, data.id);
    if (path.resolve(existing.folder) !== folder) db.prepare("UPDATE projects SET folder = ? WHERE id = ?").run(folder, data.id);
    markOpened(data.id);
    return getProject(data.id);
  }
  const now = nowIso();
  const state = projectStateSchema.safeParse(data.state);
  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO projects (id, name, folder, state_json, revision, created_at, updated_at, opened_at, owner_id) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)").run(
      data.id,
      String(data.name ?? path.basename(folder)).slice(0, 100),
      folder,
      JSON.stringify(state.success ? state.data : emptyProjectState()),
      String(data.createdAt ?? now),
      now,
      now,
      ownerId,
    );
    const insAsset = db.prepare(
      "INSERT OR IGNORE INTO assets (id, project_id, kind, path, name, storage, size, duration, width, height, has_audio, thumb_path, created_at, source_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const a of data.assets ?? []) {
      // Managed files move with the folder: rebase their paths onto the new location.
      let p = String(a.path ?? "");
      if (a.storage === "managed") {
        const rel = String(a.path).split(/[\\/]/).slice(-2).join(path.sep);
        p = path.join(folder, rel);
      }
      insAsset.run(
        String(a.id), data.id, String(a.kind), p, String(a.name), String(a.storage), Number(a.size ?? 0),
        (a.duration as number | null) ?? null, (a.width as number | null) ?? null, (a.height as number | null) ?? null,
        Number(a.has_audio ?? 0), null, String(a.created_at ?? now), (a.source_json as string | null) ?? null,
      );
    }
    const insNar = db.prepare(
      "INSERT OR IGNORE INTO narrations (id, project_id, name, script, settings_json, segments_json, duration, combined_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const n of data.narrations ?? []) {
      insNar.run(
        String(n.id), data.id, String(n.name), String(n.script), String(n.settings_json), String(n.segments_json),
        (n.duration as number | null) ?? null, (n.combined_hash as string | null) ?? null, String(n.created_at ?? now), now,
      );
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return getProject(data.id);
}

/** Folders the server may read media from. */
export function approvedMediaRoots(): string[] {
  const s = getSettings();
  return [...s.mediaFolders, ...allProjectFolders()].filter(Boolean);
}

export function assertInsideProject(projectId: string, p: string) {
  if (!isInside(projectFolder(projectId), p)) throw new HttpError(403, "Path is outside the project folder");
}
