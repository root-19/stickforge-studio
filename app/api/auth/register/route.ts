import { z } from "zod";
import { readJson, withPublicApi } from "@/lib/server/api";
import { createSession, registerUser, sessionCookie } from "@/lib/server/auth";

export const POST = withPublicApi(async (req) => {
  const body = await readJson(
    req,
    z.object({ name: z.string().max(80), email: z.string().max(200), password: z.string().max(200), remember: z.boolean().default(true) }),
  );
  const user = await registerUser(body);
  const s = createSession(user.id, body.remember);
  return Response.json({ user }, { status: 201, headers: { "Set-Cookie": sessionCookie(s.token, s.maxAge) } });
});
