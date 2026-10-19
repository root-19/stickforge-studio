import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { withApi } from "@/lib/server/api";
import { HttpError } from "@/lib/server/errors";
import { tempDir } from "@/lib/server/env";
import { fetchWithRetry, isAllowedDownloadUrl } from "@/lib/server/stock";

const MAX_THUMB_BYTES = 5 * 1024 * 1024;

/**
 * Stock thumbnails are fetched by the local server (allow-listed hosts only)
 * and cached on disk, so previews load reliably and quickly.
 */
export const GET = withApi(async (req) => {
  const url = new URL(req.url).searchParams.get("url") ?? "";
  if (!isAllowedDownloadUrl(url)) throw new HttpError(400, "Thumbnail host is not allowed");
  const dir = path.join(tempDir(), "stock-thumbs");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, crypto.createHash("sha1").update(url).digest("hex"));
  if (!fs.existsSync(file)) {
    const res = await fetchWithRetry(url, AbortSignal.timeout(30_000)).catch(() => null);
    if (!res || !res.ok || !isAllowedDownloadUrl(res.url)) throw new HttpError(502, "Could not load thumbnail");
    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) throw new HttpError(415, "Not an image");
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_THUMB_BYTES) throw new HttpError(413, "Thumbnail too large");
    fs.writeFileSync(`${file}.type`, type);
    fs.writeFileSync(file, buf);
  }
  const type = fs.existsSync(`${file}.type`) ? fs.readFileSync(`${file}.type`, "utf8") : "image/jpeg";
  return new Response(new Uint8Array(fs.readFileSync(file)), {
    headers: { "Content-Type": type, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" },
  });
});
