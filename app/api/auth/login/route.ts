import { z } from "zod";
import { readJson, withPublicApi } from "@/lib/server/api";
import { authenticate, createSession, sessionCookie } from "@/lib/server/auth";

export const POST = withPublicApi(async (req) => {
  const body = await readJson(req, z.object({ email: z.string().max(200), password: z.string().max(200), remember: z.boolean().default(true) }));
  const user = await authenticate(body.email, body.password);
  const s = createSession(user.id, body.remember);
  return Response.json({ user }, { headers: { "Set-Cookie": sessionCookie(s.token, s.maxAge) } });
});
