import "server-only";
import { connection } from "next/server";
import { z } from "zod";
import { checkLocalRequest } from "./security";
import { HttpError, errorMessage } from "./errors";
import { userFromRequest, type PublicUser } from "./auth";

export type AuthContext = { user: PublicUser };
type Handler<C> = (req: Request, ctx: C, auth: AuthContext) => Promise<Response> | Response;
type PublicHandler<C> = (req: Request, ctx: C, auth: { user: PublicUser | null }) => Promise<Response> | Response;

function errorResponse(req: Request, e: unknown): Response {
  if (e instanceof HttpError) {
    return Response.json({ error: e.message, details: e.details ?? null }, { status: e.status });
  }
  if (e instanceof z.ZodError) {
    return Response.json({ error: "Invalid request", details: z.flattenError(e) }, { status: 400 });
  }
  console.error("[api]", req.method, new URL(req.url).pathname, e);
  return Response.json({ error: errorMessage(e) }, { status: 500 });
}

/**
 * Wrap every route handler: enforces the local-request guard and a signed-in
 * user (role "owner" for admin routes), opts out of prerendering (we read
 * SQLite synchronously), and converts errors to JSON.
 */
export function withApi<C = unknown>(handler: Handler<C>, opts: { role?: "user" | "owner" } = {}) {
  return async (req: Request, ctx: C): Promise<Response> => {
    await connection();
    const guard = checkLocalRequest(req.method, req.headers);
    if (!guard.ok) return Response.json({ error: guard.reason }, { status: guard.status });
    try {
      const user = userFromRequest(req.headers);
      if (!user) return Response.json({ error: "Please log in.", code: "auth_required" }, { status: 401 });
      if (opts.role === "owner" && user.role !== "owner") throw new HttpError(403, "Only the owner account can change this.");
      return await handler(req, ctx, { user });
    } catch (e) {
      return errorResponse(req, e);
    }
  };
}

/** Same guard, but no login required (register / login / session status). */
export function withPublicApi<C = unknown>(handler: PublicHandler<C>) {
  return async (req: Request, ctx: C): Promise<Response> => {
    await connection();
    const guard = checkLocalRequest(req.method, req.headers);
    if (!guard.ok) return Response.json({ error: guard.reason }, { status: guard.status });
    try {
      return await handler(req, ctx, { user: userFromRequest(req.headers) });
    } catch (e) {
      return errorResponse(req, e);
    }
  };
}

export async function readJson<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "Request body must be JSON");
  }
  return schema.parse(body);
}

export function notFound(what: string): never {
  throw new HttpError(404, `${what} not found`);
}
