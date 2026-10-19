/**
 * Local-request guard for every API route.
 *
 * The app binds to 127.0.0.1, but a web page open in the same browser could
 * still try to call http://localhost:<port>/api/... (CSRF) or reach it through
 * a DNS-rebinding hostname. We therefore require:
 *   1. A loopback Host header (blocks DNS rebinding).
 *   2. For state-changing requests: an Origin that matches the Host, and the
 *      custom `x-stickforge` header (cross-site pages cannot add it without a
 *      CORS preflight, which this app never approves).
 *   3. For reads: browsers' Sec-Fetch-Site must be same-origin or none.
 */

export const CSRF_HEADER = "x-stickforge";
export const CSRF_VALUE = "1";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function hostnameOf(hostHeader: string | null): string | null {
  if (!hostHeader) return null;
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    return end > 0 ? h.slice(0, end + 1) : null;
  }
  return h.split(":")[0] || null;
}

export type GuardResult = { ok: true } | { ok: false; status: number; reason: string };

export function checkLocalRequest(method: string, headers: Headers): GuardResult {
  const host = headers.get("host");
  const hostname = hostnameOf(host);
  if (!hostname || !LOOPBACK_HOSTS.has(hostname)) {
    return { ok: false, status: 403, reason: "StickForge only accepts requests addressed to localhost." };
  }
  const fetchSite = headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return { ok: false, status: 403, reason: "Cross-site requests are not allowed." };
  }
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return { ok: true };

  const origin = headers.get("origin");
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      return { ok: false, status: 403, reason: "Invalid Origin header." };
    }
    if (originHost !== host!.trim().toLowerCase()) {
      return { ok: false, status: 403, reason: "Request origin does not match this app." };
    }
  }
  if (headers.get(CSRF_HEADER) !== CSRF_VALUE) {
    return { ok: false, status: 403, reason: `Missing ${CSRF_HEADER} header.` };
  }
  return { ok: true };
}
