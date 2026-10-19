import "server-only";
import crypto from "node:crypto";
import { promisify } from "node:util";
import { getDb, newId, nowIso } from "./db";
import { HttpError } from "./errors";
import { getSettings } from "./settings";

/**
 * Local accounts. Everything is stored in this computer's SQLite database —
 * no cloud service, no email. Passwords are hashed with scrypt; sessions are
 * random tokens kept in an HttpOnly cookie (only a SHA-256 hash is stored).
 */

export const SESSION_COOKIE = "sf_session";
const SESSION_DAYS_REMEMBER = 30;
const SESSION_HOURS_SHORT = 12;

export type UserRole = "owner" | "member";
export type PublicUser = { id: string; email: string; name: string; role: UserRole; createdAt: string };

type UserRow = { id: string; email: string; name: string; password_hash: string; role: UserRole; created_at: string; last_login_at: string | null };

const scrypt = promisify(crypto.scrypt) as (pw: string | Buffer, salt: Buffer, keylen: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, saltB64, keyB64] = stored.split("$");
  if (alg !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const key = await scrypt(password.normalize("NFKC"), Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024,
  });
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validatePassword(pw: string): string | null {
  if (pw.length < 8) return "Password must be at least 8 characters.";
  if (pw.length > 200) return "Password is too long.";
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return "Use at least one letter and one number.";
  return null;
}

function toPublic(u: UserRow): PublicUser {
  return { id: u.id, email: u.email, name: u.name, role: u.role, createdAt: u.created_at };
}

export function countUsers(): number {
  return (getDb().prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
}

export function registrationOpen(): boolean {
  return countUsers() === 0 || getSettings().allowRegistration;
}

export async function registerUser(input: { email: string; name: string; password: string }): Promise<PublicUser> {
  const email = normalizeEmail(input.email);
  const name = input.name.trim().slice(0, 80);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) throw new HttpError(400, "Enter a valid email address.");
  if (!name) throw new HttpError(400, "Enter your name.");
  const pwError = validatePassword(input.password);
  if (pwError) throw new HttpError(400, pwError);
  if (!registrationOpen()) throw new HttpError(403, "New accounts are turned off on this computer. Ask the owner to enable them in Settings.");
  const db = getDb();
  if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) throw new HttpError(409, "An account with this email already exists. Log in instead.");
  const isFirst = countUsers() === 0;
  const id = newId("usr");
  const hash = await hashPassword(input.password);
  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      id, email, name, hash, isFirst ? "owner" : "member", nowIso(),
    );
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return getUser(id)!;
}

export function getUser(id: string): PublicUser | null {
  const r = getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  return r ? toPublic(r) : null;
}

// ---- Login throttling (in memory): 5 failed attempts per email → wait 30 s, doubling.
type Attempt = { failures: number; lockedUntil: number };
function attempts(): Map<string, Attempt> {
  const g = globalThis as typeof globalThis & { __stickforgeLogin?: Map<string, Attempt> };
  if (!g.__stickforgeLogin) g.__stickforgeLogin = new Map();
  return g.__stickforgeLogin;
}

export async function authenticate(emailInput: string, password: string): Promise<PublicUser> {
  const email = normalizeEmail(emailInput);
  const a = attempts().get(email);
  if (a && a.lockedUntil > Date.now()) {
    throw new HttpError(429, `Too many attempts. Try again in ${Math.ceil((a.lockedUntil - Date.now()) / 1000)} seconds.`);
  }
  const row = getDb().prepare("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined;
  // Always run scrypt so response time doesn't reveal whether the email exists.
  const ok = row ? await verifyPassword(password, row.password_hash) : (await hashPassword(password), false);
  if (!row || !ok) {
    const failures = (a?.failures ?? 0) + 1;
    const lockedUntil = failures >= 5 ? Date.now() + 30_000 * 2 ** Math.min(5, failures - 5) : 0;
    attempts().set(email, { failures, lockedUntil });
    throw new HttpError(401, "Email or password is incorrect.");
  }
  attempts().delete(email);
  getDb().prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(nowIso(), row.id);
  return toPublic(row);
}

const hashToken = (t: string) => crypto.createHash("sha256").update(t).digest("hex");

export function createSession(userId: string, remember: boolean): { token: string; maxAge: number | null; expiresAt: string } {
  const token = crypto.randomBytes(32).toString("base64url");
  const ms = remember ? SESSION_DAYS_REMEMBER * 86_400_000 : SESSION_HOURS_SHORT * 3_600_000;
  const now = nowIso();
  const expiresAt = new Date(Date.now() + ms).toISOString();
  getDb().prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)").run(hashToken(token), userId, now, expiresAt, now);
  // Housekeeping: drop expired sessions.
  getDb().prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
  return { token, maxAge: remember ? Math.floor(ms / 1000) : null, expiresAt };
}

export function sessionTokenFrom(headers: Headers): string | null {
  const cookie = headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === SESSION_COOKIE) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function userFromRequest(headers: Headers): PublicUser | null {
  const token = sessionTokenFrom(headers);
  if (!token || token.length > 200) return null;
  const db = getDb();
  const s = db.prepare("SELECT user_id, expires_at FROM sessions WHERE token_hash = ?").get(hashToken(token)) as { user_id: string; expires_at: string } | undefined;
  if (!s || Date.parse(s.expires_at) < Date.now()) return null;
  db.prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?").run(nowIso(), hashToken(token));
  return getUser(s.user_id);
}

export function destroySession(headers: Headers) {
  const token = sessionTokenFrom(headers);
  if (token) getDb().prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

export function sessionCookie(token: string, maxAge: number | null): string {
  // HttpOnly: scripts can't read it. SameSite=Strict: other sites can't send it.
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict${maxAge ? `; Max-Age=${maxAge}` : ""}`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

/** Change a password (used by Settings and the local reset script). Signs out other sessions. */
export async function setPassword(userId: string, password: string) {
  const err = validatePassword(password);
  if (err) throw new HttpError(400, err);
  getDb().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(await hashPassword(password), userId);
  getDb().prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

// ---- Ownership -------------------------------------------------------------

/** 404 (not 403) so other users' project ids aren't revealed. */
export function assertProjectAccess(user: PublicUser, projectId: string) {
  const r = getDb().prepare("SELECT owner_id FROM projects WHERE id = ?").get(projectId) as { owner_id: string | null } | undefined;
  if (!r || r.owner_id !== user.id) throw new HttpError(404, "Project not found");
}

export function projectIdOfAsset(assetId: string): string {
  const r = getDb().prepare("SELECT project_id FROM assets WHERE id = ?").get(assetId) as { project_id: string } | undefined;
  if (!r) throw new HttpError(404, "Media not found");
  return r.project_id;
}

export function projectIdOfNarration(id: string): string {
  const r = getDb().prepare("SELECT project_id FROM narrations WHERE id = ?").get(id) as { project_id: string } | undefined;
  if (!r) throw new HttpError(404, "Narration not found");
  return r.project_id;
}

export function projectIdOfExport(id: string): string {
  const r = getDb().prepare("SELECT project_id FROM exports WHERE id = ?").get(id) as { project_id: string } | undefined;
  if (!r) throw new HttpError(404, "Export not found");
  return r.project_id;
}

/** Projects that belong to no account (made before accounts existed). Shown only to the owner, in Settings. */
export function unownedProjects(): { id: string; name: string; folder: string; createdAt: string }[] {
  return (getDb().prepare("SELECT id, name, folder, created_at FROM projects WHERE owner_id IS NULL ORDER BY created_at").all() as {
    id: string;
    name: string;
    folder: string;
    created_at: string;
  }[]).map((r) => ({ id: r.id, name: r.name, folder: r.folder, createdAt: r.created_at }));
}

export function claimUnownedProjects(userId: string, ids: string[]): number {
  const stmt = getDb().prepare("UPDATE projects SET owner_id = ? WHERE id = ? AND owner_id IS NULL");
  return ids.reduce((n, id) => n + Number(stmt.run(userId, id).changes), 0);
}

export function userProjectIds(userId: string): Set<string> {
  return new Set((getDb().prepare("SELECT id FROM projects WHERE owner_id = ?").all(userId) as { id: string }[]).map((r) => r.id));
}
