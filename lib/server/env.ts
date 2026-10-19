import "server-only";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

/**
 * Root folder for app data (database, default voice folder, temp files).
 * Override with STICKFORGE_HOME (used by tests and portable installs).
 */
export function appHome(): string {
  const fromEnv = process.env.STICKFORGE_HOME;
  const base = fromEnv
    ? path.resolve(fromEnv)
    : path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "StickForgeStudio");
  fs.mkdirSync(base, { recursive: true });
  return base;
}

export function defaultProjectsDir(): string {
  return path.join(os.homedir(), "Documents", "StickForge Projects");
}

export function defaultVoicesDir(): string {
  return path.join(appHome(), "voices");
}

export function tempDir(): string {
  const d = path.join(appHome(), "tmp");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/** Directory containing the app's package.json (Next.js server cwd). */
export function appRoot(): string {
  return process.cwd();
}
