import { withPublicApi } from "@/lib/server/api";
import { countUsers, registrationOpen } from "@/lib/server/auth";

/** Who is signed in (or null), and whether new accounts can be created. */
export const GET = withPublicApi(async (_req, _ctx, { user }) =>
  Response.json({ user, registrationOpen: registrationOpen(), hasUsers: countUsers() > 0 }),
);
