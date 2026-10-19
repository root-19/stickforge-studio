import "server-only";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getSettings } from "../settings";

export type ToolName = "ffmpeg" | "ffprobe";

const exe = (name: ToolName) => (process.platform === "win32" ? `${name}.exe` : name);

function isExecutableFile(p: string, name: ToolName): boolean {
  try {
    const base = path.basename(p).toLowerCase();
    if (base !== exe(name).toLowerCase()) return false;
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function fromPathEnv(name: ToolName): string | null {
  const dirs = (process.env.PATH || process.env.Path || "").split(path.delimiter).filter(Boolean);
  for (const d of dirs) {
    const candidate = path.join(d.replace(/^"|"$/g, ""), exe(name));
    if (isExecutableFile(candidate, name)) return candidate;
  }
  return null;
}

/** winget installs Gyan.FFmpeg under %LOCALAPPDATA%\Microsoft\WinGet\Packages. */
function fromWinget(name: ToolName): string | null {
  const local = process.env.LOCALAPPDATA;
  if (!local || process.platform !== "win32") return null;
  const links = path.join(local, "Microsoft", "WinGet", "Links", exe(name));
  if (isExecutableFile(links, name)) return links;
  const pkgs = path.join(local, "Microsoft", "WinGet", "Packages");
  try {
    for (const pkg of fs.readdirSync(pkgs)) {
      if (!pkg.toLowerCase().includes("ffmpeg")) continue;
      const pkgDir = path.join(pkgs, pkg);
      for (const sub of fs.readdirSync(pkgDir)) {
        const candidate = path.join(pkgDir, sub, "bin", exe(name));
        if (isExecutableFile(candidate, name)) return candidate;
      }
    }
  } catch {
    /* not installed */
  }
  return null;
}

export type ToolLocation = { path: string; source: "settings" | "env" | "path" | "winget" } | null;

export function locateTool(name: ToolName): ToolLocation {
  const settings = getSettings();
  const configured = name === "ffmpeg" ? settings.ffmpegPath : settings.ffprobePath;
  if (configured && isExecutableFile(configured, name)) return { path: configured, source: "settings" };
  const envVar = name === "ffmpeg" ? process.env.FFMPEG_PATH : process.env.FFPROBE_PATH;
  if (envVar && isExecutableFile(envVar, name)) return { path: envVar, source: "env" };
  const onPath = fromPathEnv(name);
  if (onPath) return { path: onPath, source: "path" };
  const wg = fromWinget(name);
  if (wg) return { path: wg, source: "winget" };
  return null;
}

export function requireTool(name: ToolName): string {
  const loc = locateTool(name);
  if (!loc) {
    throw new Error(
      `${name} was not found. Install FFmpeg (for example: winget install --id Gyan.FFmpeg -e) or set its path in Settings.`,
    );
  }
  return loc.path;
}

export function isValidToolPath(p: string, name: ToolName): boolean {
  return path.isAbsolute(p) && isExecutableFile(p, name);
}

export type FfmpegCapabilities = {
  version: string;
  libx264: boolean;
  h264_mf: boolean;
  aac: boolean;
  libmp3lame: boolean;
  subtitles: boolean;
  zoompan: boolean;
  sidechaincompress: boolean;
};

const capsCache = new Map<string, FfmpegCapabilities>();

export function ffmpegCapabilities(ffmpegPath: string): FfmpegCapabilities {
  const cached = capsCache.get(ffmpegPath);
  if (cached) return cached;
  const run = (args: string[]) =>
    spawnSync(ffmpegPath, ["-hide_banner", ...args], { encoding: "utf8", windowsHide: true, timeout: 20_000, shell: false }).stdout ?? "";
  const versionOut = run(["-version"]);
  const encoders = run(["-encoders"]);
  const filters = run(["-filters"]);
  const has = (text: string, name: string) => new RegExp(`\\s${name}\\s`).test(text);
  const caps: FfmpegCapabilities = {
    version: versionOut.split("\n")[0]?.replace(/^ffmpeg version\s*/, "").split(" ")[0] ?? "unknown",
    libx264: has(encoders, "libx264"),
    h264_mf: has(encoders, "h264_mf"),
    aac: has(encoders, "aac"),
    libmp3lame: has(encoders, "libmp3lame"),
    subtitles: has(filters, "subtitles"),
    zoompan: has(filters, "zoompan"),
    sidechaincompress: has(filters, "sidechaincompress"),
  };
  capsCache.set(ffmpegPath, caps);
  return caps;
}
