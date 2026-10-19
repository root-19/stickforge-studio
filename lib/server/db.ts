import "server-only";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { appHome } from "./env";

type GlobalWithDb = typeof globalThis & { __stickforgeDb?: { db: DatabaseSync; file: string; migrated?: number } };

const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    folder TEXT NOT NULL,
    state_json TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    opened_at TEXT
  );
  CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    storage TEXT NOT NULL,
    size INTEGER NOT NULL,
    duration REAL,
    width INTEGER,
    height INTEGER,
    has_audio INTEGER NOT NULL DEFAULT 0,
    thumb_path TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_assets_project ON assets(project_id);
  CREATE TABLE IF NOT EXISTS narrations (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    script TEXT NOT NULL,
    settings_json TEXT NOT NULL,
    segments_json TEXT NOT NULL,
    duration REAL,
    combined_hash TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_narrations_project ON narrations(project_id);
  CREATE TABLE IF NOT EXISTS exports (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    project_name TEXT NOT NULL,
    status TEXT NOT NULL,
    progress REAL NOT NULL DEFAULT 0,
    preset TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    fps INTEGER NOT NULL,
    output_path TEXT NOT NULL,
    srt_path TEXT,
    duration REAL NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL,
    finished_at TEXT
  );
  `,
  // 2: where downloaded stock media came from (author, license) for credits.
  `ALTER TABLE assets ADD COLUMN source_json TEXT;`,
  // 3: local user accounts and sessions; projects belong to a user.
  `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    created_at TEXT NOT NULL,
    last_login_at TEXT
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  ALTER TABLE projects ADD COLUMN owner_id TEXT;
  CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);
  `,
  // 4: projects made before accounts existed are no longer handed to the first account automatically.
  //    Un-assign the ones that were (created before their owner's account); the owner can claim them in Settings.
  `UPDATE projects SET owner_id = NULL
     WHERE owner_id IS NOT NULL
       AND created_at < (SELECT u.created_at FROM users u WHERE u.id = projects.owner_id);`,
];

function migrate(db: DatabaseSync) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const row = db.prepare("SELECT version FROM schema_version LIMIT 1").get() as { version: number } | undefined;
  let version = row?.version ?? 0;
  if (!row) db.prepare("INSERT INTO schema_version (version) VALUES (0)").run();
  while (version < MIGRATIONS.length) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[version]);
      version++;
      db.prepare("UPDATE schema_version SET version = ?").run(version);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
}

/** Shared SQLite connection (one per server process, survives dev hot reloads). */
export function getDb(): DatabaseSync {
  const g = globalThis as GlobalWithDb;
  const file = path.join(appHome(), "stickforge.db");
  if (g.__stickforgeDb && g.__stickforgeDb.file === file) {
    // After a code update in a running dev server, apply any new migrations to the open connection.
    if (g.__stickforgeDb.migrated !== MIGRATIONS.length) {
      migrate(g.__stickforgeDb.db);
      g.__stickforgeDb.migrated = MIGRATIONS.length;
    }
    return g.__stickforgeDb.db;
  }
  if (g.__stickforgeDb) g.__stickforgeDb.db.close();
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  g.__stickforgeDb = { db, file, migrated: MIGRATIONS.length };
  return db;
}

export function closeDb() {
  const g = globalThis as GlobalWithDb;
  g.__stickforgeDb?.db.close();
  g.__stickforgeDb = undefined;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  const rand = crypto.getRandomValues(new Uint8Array(9));
  const s = Array.from(rand, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 14);
  return `${prefix}_${Date.now().toString(36)}${s}`;
}
