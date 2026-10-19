import "server-only";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

const TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".srt": "application/x-subrip",
};

export function contentTypeFor(file: string): string {
  return TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

/** Stream a local file with HTTP Range support (needed for video seeking). */
export function serveFile(req: Request, file: string, opts: { download?: string; cache?: boolean } = {}): Response {
  const stat = fs.statSync(file);
  const size = stat.size;
  const headers = new Headers({
    "Content-Type": contentTypeFor(file),
    "Accept-Ranges": "bytes",
    "Cache-Control": opts.cache ? "private, max-age=3600" : "no-store",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
  });
  if (opts.download) headers.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(opts.download)}`);
  const range = req.headers.get("range");
  let start = 0;
  let end = size - 1;
  let status = 200;
  if (range && size > 0) {
    const m = range.match(/^bytes=(\d*)-(\d*)$/);
    if (!m || (m[1] === "" && m[2] === "")) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    if (m[1] === "") {
      start = Math.max(0, size - Number(m[2]));
    } else {
      start = Number(m[1]);
      end = m[2] === "" ? size - 1 : Math.min(size - 1, Number(m[2]));
    }
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    status = 206;
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  }
  headers.set("Content-Length", String(size === 0 ? 0 : end - start + 1));
  if (req.method === "HEAD" || size === 0) return new Response(null, { status, headers });
  const stream = fs.createReadStream(file, { start, end });
  return new Response(Readable.toWeb(stream) as ReadableStream, { status, headers });
}
