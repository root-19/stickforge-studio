import { z } from "zod";
import { readJson, withApi } from "@/lib/server/api";
import { HttpError } from "@/lib/server/errors";
import { createSession, sessionCookie, setPassword, verifyPassword } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";

/** Change your password (signs out your other sessions and starts a fresh one here). */
export const POST = withApi(async (req, _ctx, { user }) => {
  const { currentPassword, newPassword } = await readJson(req, z.object({ currentPassword: z.string().max(200), newPassword: z.string().max(200) }));
  const row = getDb().prepare("SELECT password_hash FROM users WHERE id = ?").get(user.id) as { password_hash: string };
  if (!(await verifyPassword(currentPassword, row.password_hash))) throw new HttpError(400, "Current password is incorrect.");
  await setPassword(user.id, newPassword);
  const s = createSession(user.id, true);
  return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie(s.token, s.maxAge) } });
});
