import { withApi } from "@/lib/server/api";
import { refreshCatalog } from "@/lib/server/tts/catalog";

/** Download the latest official voice list (internet; user-initiated only). */
export const POST = withApi(async () => {
  const count = await refreshCatalog();
  return Response.json({ ok: true, count });
}, { role: "owner" });
