import "server-only";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { AssetSource, CommercialUse } from "@/lib/shared/types";
import { HttpError } from "./errors";
import { getSettings } from "./settings";
import { projectFolder } from "./projects";
import { safeFileName, uniquePath } from "./paths";
import { registerGenerated } from "./assets";
import { requireTool } from "./ffmpeg/locate";
import { runFfmpeg } from "./ffmpeg/run";
import type { JobContext } from "./jobs";
import { CancelledError } from "./jobs";

/**
 * Free stock media through official APIs:
 *  - Pexels (free API key, Pexels License: free for commercial use, no attribution required but appreciated)
 *  - Wikimedia Commons (no key; per-file Creative Commons / public-domain licenses — credits required for CC BY)
 * Searches send only the search words to these services. Nothing from the user's projects is uploaded.
 */

export type StockProvider = "pexels" | "commons";
export type StockKind = "video" | "image";
export type StockOrientation = "portrait" | "landscape" | "square" | "any";

export type StockItem = {
  provider: StockProvider;
  id: string;
  kind: StockKind;
  title: string;
  thumbUrl: string;
  /** Small video for hover preview (Pexels only). */
  previewUrl: string | null;
  width: number;
  height: number;
  duration: number | null;
  sizeBytes: number | null;
  author: string;
  authorUrl: string | null;
  pageUrl: string;
  license: string;
  licenseUrl: string | null;
  commercialUse: CommercialUse;
};

export type StockSearchResult = { items: StockItem[]; nextPage: number | null; total: number | null };

// Wikimedia's API policy asks for a descriptive User-Agent.
const USER_AGENT = "StickForgeStudio/0.1 (local-first video editor running on the user's own computer)";
const MAX_DOWNLOAD_BYTES = 600 * 1024 * 1024;
/** Only these hosts may be downloaded from (checked after redirects too). */
const DOWNLOAD_HOSTS = [/^videos\.pexels\.com$/, /^images\.pexels\.com$/, /^player\.vimeo\.com$/, /(^|\.)vimeocdn\.com$/, /^upload\.wikimedia\.org$/, /^thumb\.wikimedia\.org$/];

export function isAllowedDownloadUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === "https:" && DOWNLOAD_HOSTS.some((re) => re.test(url.hostname));
  } catch {
    return false;
  }
}

function orientationOf(w: number, h: number): Exclude<StockOrientation, "any"> {
  const r = w / h;
  return r > 1.15 ? "landscape" : r < 0.87 ? "portrait" : "square";
}

// ---------------------------------------------------------------------------
// Pexels
// ---------------------------------------------------------------------------

const PEXELS_API = "https://api.pexels.com";

type PexelsVideo = {
  id: number;
  width: number;
  height: number;
  url: string;
  image: string;
  duration: number;
  user: { name: string; url: string };
  video_files: { quality: string | null; file_type: string; width: number | null; height: number | null; link: string }[];
};
type PexelsPhoto = {
  id: number;
  width: number;
  height: number;
  url: string;
  alt: string | null;
  photographer: string;
  photographer_url: string;
  src: Record<string, string>;
};

function pexelsKey(): string {
  const key = getSettings().pexelsApiKey.trim();
  if (!key) throw new HttpError(412, "Add your free Pexels API key first (Templates → Free stock footage, or Settings).");
  return key;
}

async function pexelsGet<T>(pathAndQuery: string): Promise<T> {
  const res = await fetch(`${PEXELS_API}${pathAndQuery}`, {
    headers: { Authorization: pexelsKey(), "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 401 || res.status === 403) throw new HttpError(401, "Pexels rejected the API key. Check it in Settings.");
  if (res.status === 429) throw new HttpError(429, "Pexels rate limit reached (200 requests/hour). Try again later.");
  if (!res.ok) throw new HttpError(502, `Pexels error (HTTP ${res.status})`);
  return (await res.json()) as T;
}

const PEXELS_LICENSE = { license: "Pexels License", licenseUrl: "https://www.pexels.com/license/", commercialUse: "allowed" as const };

/** Pick the MP4 closest to Full HD for the clip's orientation (smaller downloads, enough for 1080p export). */
export function pickPexelsFile(v: Pick<PexelsVideo, "video_files">, targetLong = 1920) {
  const mp4 = v.video_files.filter((f) => f.file_type === "video/mp4" && f.width && f.height && f.quality !== "hls");
  if (!mp4.length) return null;
  const score = (f: (typeof mp4)[number]) => {
    const long = Math.max(f.width!, f.height!);
    return long >= targetLong ? long - targetLong : (targetLong - long) * 3; // prefer >= target
  };
  return [...mp4].sort((a, b) => score(a) - score(b))[0];
}

function pexelsVideoItem(v: PexelsVideo): StockItem {
  const small = [...v.video_files].filter((f) => f.file_type === "video/mp4" && f.width).sort((a, b) => (a.width ?? 0) - (b.width ?? 0))[0];
  return {
    provider: "pexels",
    id: String(v.id),
    kind: "video",
    title: titleFromPexelsUrl(v.url) || `Pexels video ${v.id}`,
    thumbUrl: v.image,
    previewUrl: small?.link ?? null,
    width: v.width,
    height: v.height,
    duration: v.duration,
    sizeBytes: null,
    author: v.user.name,
    authorUrl: v.user.url,
    pageUrl: v.url,
    ...PEXELS_LICENSE,
  };
}

function pexelsPhotoItem(p: PexelsPhoto): StockItem {
  return {
    provider: "pexels",
    id: String(p.id),
    kind: "image",
    title: p.alt || titleFromPexelsUrl(p.url) || `Pexels photo ${p.id}`,
    thumbUrl: p.src.medium ?? p.src.small,
    previewUrl: null,
    width: p.width,
    height: p.height,
    duration: null,
    sizeBytes: null,
    author: p.photographer,
    authorUrl: p.photographer_url,
    pageUrl: p.url,
    ...PEXELS_LICENSE,
  };
}

function titleFromPexelsUrl(u: string): string {
  const slug = u.replace(/\/$/, "").split("/").pop() ?? "";
  return slug.replace(/-\d+$/, "").replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

async function searchPexels(kind: StockKind, q: string, orientation: StockOrientation, page: number): Promise<StockSearchResult> {
  const params = new URLSearchParams({ query: q, per_page: "24", page: String(page) });
  if (orientation !== "any") params.set("orientation", orientation);
  if (kind === "video") {
    const r = await pexelsGet<{ videos: PexelsVideo[]; next_page?: string; total_results?: number }>(`/videos/search?${params}`);
    return { items: r.videos.map(pexelsVideoItem), nextPage: r.next_page ? page + 1 : null, total: r.total_results ?? null };
  }
  const r = await pexelsGet<{ photos: PexelsPhoto[]; next_page?: string; total_results?: number }>(`/v1/search?${params}`);
  return { items: r.photos.map(pexelsPhotoItem), nextPage: r.next_page ? page + 1 : null, total: r.total_results ?? null };
}

type DownloadInfo = { item: StockItem; url: string; ext: string; fallbackUrl: string | null };

async function pexelsDownloadInfo(kind: StockKind, id: string): Promise<DownloadInfo> {
  if (!/^\d{1,15}$/.test(id)) throw new HttpError(400, "Invalid Pexels id");
  if (kind === "video") {
    const v = await pexelsGet<PexelsVideo>(`/videos/videos/${id}`);
    const f = pickPexelsFile(v);
    if (!f) throw new HttpError(422, "This Pexels video has no MP4 file");
    return { item: pexelsVideoItem(v), url: f.link, ext: ".mp4", fallbackUrl: null };
  }
  const p = await pexelsGet<PexelsPhoto>(`/v1/photos/${id}`);
  // Pexels image URLs accept resize parameters; 2160 px on the long side is plenty for 4K export.
  const base = p.src.original;
  const sep = base.includes("?") ? "&" : "?";
  const long = p.width >= p.height ? "w" : "h";
  return { item: pexelsPhotoItem(p), url: `${base}${sep}auto=compress&cs=tinysrgb&${long}=2160`, ext: ".jpg", fallbackUrl: base };
}

// ---------------------------------------------------------------------------
// Wikimedia Commons
// ---------------------------------------------------------------------------

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";

type CommonsPage = {
  pageid: number;
  title: string;
  index?: number;
  imageinfo?: {
    url: string;
    thumburl?: string;
    width: number;
    height: number;
    size: number;
    mime: string;
    duration?: number;
    descriptionurl: string;
    extmetadata?: Record<string, { value: string }>;
  }[];
};

export function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Map a Commons license short name to what it means for monetized videos. */
export function commercialFromLicense(short: string): CommercialUse {
  const s = short.toLowerCase();
  if (/\b(nc|nd)\b|non-?commercial|no ?deriv/.test(s)) return "non-commercial";
  if (/^cc0|public domain|^pd\b|^pd-/.test(s)) return "allowed";
  if (/cc[ -]by[ -]sa/.test(s)) return "share-alike";
  if (/cc[ -]by\b/.test(s)) return "attribution";
  return "unclear";
}

function commonsItem(p: CommonsPage, kind: StockKind): StockItem | null {
  const ii = p.imageinfo?.[0];
  if (!ii) return null;
  const meta = ii.extmetadata ?? {};
  const license = stripHtml(meta.LicenseShortName?.value ?? "") || "See file page";
  const title = p.title.replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, "").replace(/_/g, " ");
  return {
    provider: "commons",
    id: String(p.pageid),
    kind,
    title,
    thumbUrl: ii.thumburl ?? ii.url,
    previewUrl: null,
    width: ii.width,
    height: ii.height,
    duration: ii.duration ?? null,
    sizeBytes: ii.size,
    author: stripHtml(meta.Artist?.value ?? "") || "Unknown author",
    authorUrl: null,
    pageUrl: ii.descriptionurl,
    license,
    licenseUrl: meta.LicenseUrl?.value ?? null,
    commercialUse: commercialFromLicense(license),
  };
}

/** Wikimedia only serves standard thumbnail widths efficiently (others may be rate-limited). */
const COMMONS_THUMB_WIDTH = "330";
const COMMONS_IMPORT_WIDTH = "1920";

async function commonsGet(params: Record<string, string>) {
  const qs = new URLSearchParams({ format: "json", formatversion: "2", ...params });
  let res: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(`${COMMONS_API}?${qs}`, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(20_000) });
    if (res.status !== 429 && res.status !== 503) break;
    // Be polite: honour Retry-After (capped) before trying again.
    const wait = Math.min(8, Number(res.headers.get("retry-after")) || 2 ** attempt);
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
  if (!res || res.status === 429) throw new HttpError(429, "Wikimedia Commons is busy (rate limit). Wait a moment and try again.");
  if (!res.ok) throw new HttpError(502, `Wikimedia Commons error (HTTP ${res.status})`);
  return (await res.json()) as { query?: { pages?: CommonsPage[] }; continue?: { gsroffset?: number } };
}

const COMMONS_PROPS = {
  prop: "imageinfo",
  iiprop: "url|size|mime|extmetadata",
  iiextmetadatafilter: "LicenseShortName|LicenseUrl|Artist",
};

async function searchCommons(kind: StockKind, q: string, orientation: StockOrientation, page: number): Promise<StockSearchResult> {
  const per = 24;
  const r = await commonsGet({
    action: "query",
    generator: "search",
    gsrsearch: `${kind === "video" ? "filetype:video" : "filetype:bitmap"} ${q}`,
    gsrnamespace: "6",
    gsrlimit: String(per),
    gsroffset: String((page - 1) * per),
    iiurlwidth: COMMONS_THUMB_WIDTH,
    ...COMMONS_PROPS,
  });
  let items = (r.query?.pages ?? [])
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((p) => commonsItem(p, kind))
    .filter((x): x is StockItem => !!x && x.width > 0);
  // Commons has few portrait/square files, so matching shapes are listed first instead of hiding the rest.
  if (orientation !== "any") {
    const match = (i: StockItem) => (orientationOf(i.width, i.height) === orientation ? 0 : 1);
    items = [...items].sort((a, b) => match(a) - match(b));
  }
  return { items, nextPage: r.continue?.gsroffset ? page + 1 : null, total: null };
}

async function commonsDownloadInfo(kind: StockKind, id: string): Promise<DownloadInfo> {
  if (!/^\d{1,12}$/.test(id)) throw new HttpError(400, "Invalid Commons id");
  // Images: a 1920 px standard rendition (also converts TIFF etc. to JPEG). Videos: the original file.
  const r = await commonsGet({ action: "query", pageids: id, iiurlwidth: kind === "image" ? COMMONS_IMPORT_WIDTH : COMMONS_THUMB_WIDTH, ...COMMONS_PROPS });
  const page = r.query?.pages?.[0];
  const item = page ? commonsItem(page, kind) : null;
  const ii = page?.imageinfo?.[0];
  if (!item || !ii) throw new HttpError(404, "File not found on Wikimedia Commons");
  const url = kind === "image" ? ii.thumburl ?? ii.url : ii.url;
  const ext = path.extname(new URL(url).pathname).toLowerCase() || (kind === "image" ? ".jpg" : ".webm");
  // If the resized copy can't be fetched, the original (≤ 40 MB) is an acceptable fallback.
  const fallbackUrl = kind === "image" && ii.thumburl && ii.size <= 40 * 1024 * 1024 ? ii.url : null;
  return { item, url, ext, fallbackUrl };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function searchStock(provider: StockProvider, kind: StockKind, q: string, orientation: StockOrientation, page: number) {
  const query = q.trim().slice(0, 100);
  if (!query) throw new HttpError(400, "Type something to search for");
  return provider === "pexels" ? searchPexels(kind, query, orientation, page) : searchCommons(kind, query, orientation, page);
}

/** Wikimedia serves the same files from two hosts; alternate between them when a connection drops. */
export function alternateWikimediaUrl(u: string): string {
  const url = new URL(u);
  if (url.hostname === "thumb.wikimedia.org") url.hostname = "upload.wikimedia.org";
  else if (url.hostname === "upload.wikimedia.org" && url.pathname.includes("/thumb/")) url.hostname = "thumb.wikimedia.org";
  return url.toString();
}

/** Fetch with a few retries for flaky connections (resets, timeouts) — never for HTTP errors. */
export async function fetchWithRetry(url: string, signal: AbortSignal, tries = 4): Promise<Response> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const attemptUrl = i % 2 === 1 ? alternateWikimediaUrl(url) : url;
      return await fetch(attemptUrl, { headers: { "User-Agent": USER_AGENT }, signal, redirect: "follow" });
    } catch (e) {
      if (signal.aborted) throw new CancelledError();
      last = e;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  const cause = (last as { cause?: { code?: string } })?.cause?.code;
  throw new HttpError(502, `Could not download the file${cause ? ` (${cause})` : ""}. Check your internet connection and try again.`);
}

async function downloadTo(url: string, target: string, ctx: JobContext) {
  if (!isAllowedDownloadUrl(url)) throw new HttpError(400, "Download host is not allowed");
  const res = await fetchWithRetry(url, ctx.signal);
  if (!isAllowedDownloadUrl(res.url)) throw new HttpError(400, "Download was redirected to an unexpected host");
  if (!res.ok || !res.body) throw new HttpError(502, `Download failed (HTTP ${res.status})`);
  const total = Number(res.headers.get("content-length") ?? 0);
  if (total > MAX_DOWNLOAD_BYTES) throw new HttpError(413, "File is larger than 600 MB");
  const part = `${target}.part`;
  const out = fs.createWriteStream(part);
  let bytes = 0;
  try {
    for await (const chunk of Readable.fromWeb(res.body as import("node:stream/web").ReadableStream<Uint8Array>)) {
      const buf = chunk as Buffer;
      bytes += buf.length;
      if (bytes > MAX_DOWNLOAD_BYTES) throw new HttpError(413, "File is larger than 600 MB");
      if (!out.write(buf)) await new Promise<void>((r) => out.once("drain", () => r()));
      ctx.progress(total ? Math.min(0.9, (bytes / total) * 0.9) : 0.5, `Downloading ${(bytes / 1e6).toFixed(1)} MB`);
    }
    await new Promise<void>((r, j) => out.end((e?: Error | null) => (e ? j(e) : r())));
    fs.renameSync(part, target);
  } catch (e) {
    out.destroy();
    fs.rmSync(part, { force: true });
    if (ctx.signal.aborted) throw new CancelledError();
    throw e;
  }
}

const BROWSER_SAFE = new Set([".mp4", ".webm", ".mov", ".m4v", ".jpg", ".jpeg", ".png", ".webp"]);

/** Download a stock item into the project's media folder and register it with its credits. */
export async function importStock(projectId: string, provider: StockProvider, kind: StockKind, id: string, ctx: JobContext) {
  ctx.progress(0.02, "Looking up the file…");
  const info = provider === "pexels" ? await pexelsDownloadInfo(kind, id) : await commonsDownloadInfo(kind, id);
  const mediaDir = path.join(projectFolder(projectId), "media");
  fs.mkdirSync(mediaDir, { recursive: true });
  const label = provider === "pexels" ? "Pexels" : "Wikimedia Commons";
  const baseName = safeFileName(`${label} ${id} ${info.item.title}`.slice(0, 90), "stock");
  let file = uniquePath(mediaDir, `${baseName}${info.ext}`);
  const fallback = info.fallbackUrl;
  try {
    await downloadTo(info.url, file, ctx);
  } catch (e) {
    if (!fallback || ctx.signal.aborted) throw e;
    const ext = path.extname(new URL(fallback).pathname).toLowerCase() || info.ext;
    file = uniquePath(mediaDir, `${baseName}${ext}`);
    await downloadTo(fallback, file, ctx);
  }
  if (!BROWSER_SAFE.has(info.ext)) {
    // e.g. Ogg Theora (.ogv) from Commons: convert to H.264 MP4 so it previews and edits smoothly.
    ctx.progress(0.92, "Converting to MP4…");
    const mp4 = uniquePath(mediaDir, `${baseName}.mp4`);
    try {
      await runFfmpeg(
        requireTool("ffmpeg"),
        ["-i", `file:${file}`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-n", `file:${mp4}`],
        { signal: ctx.signal },
      );
    } finally {
      fs.rmSync(file, { force: true });
    }
    file = mp4;
  }
  ctx.progress(0.97, "Adding to project…");
  const source: AssetSource = {
    provider,
    providerLabel: label,
    pageUrl: info.item.pageUrl,
    title: info.item.title,
    author: info.item.author,
    authorUrl: info.item.authorUrl,
    license: info.item.license,
    licenseUrl: info.item.licenseUrl,
    commercialUse: info.item.commercialUse,
  };
  try {
    return await registerGenerated(projectId, file, path.basename(file), source);
  } catch (e) {
    fs.rmSync(file, { force: true });
    throw e;
  }
}
