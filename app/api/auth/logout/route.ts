import { withPublicApi } from "@/lib/server/api";
import { clearedSessionCookie, destroySession } from "@/lib/server/auth";

export const POST = withPublicApi(async (req) => {
  destroySession(req.headers);
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearedSessionCookie() } });
});
