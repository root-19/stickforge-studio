import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setupTempHome } from "./support/temp-home";

// Route handlers call next/server's connection(); outside Next.js it's a no-op.
vi.mock("next/server", () => ({ connection: async () => undefined }));

const home = setupTempHome();
afterAll(() => home.cleanup());

const BASE = "http://127.0.0.1:3210";
function req(method: string, path: string, opts: { cookie?: string; json?: unknown } = {}) {
  const headers: Record<string, string> = { host: "127.0.0.1:3210", "x-stickforge": "1", origin: BASE };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.json !== undefined) headers["content-type"] = "application/json";
  return new Request(BASE + path, { method, headers, body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined });
}
const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) });
const cookieFrom = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0];

describe("local accounts", () => {
  let auth: typeof import("@/lib/server/auth");
  beforeAll(async () => {
    auth = await import("@/lib/server/auth");
    const { updateSettings } = await import("@/lib/server/settings");
    updateSettings({ projectsDir: `${home.dir}/Projects` });
  });

  it("hashes passwords with scrypt and verifies them", async () => {
    const h = await auth.hashPassword("correct horse 1");
    expect(h).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(await auth.verifyPassword("correct horse 1", h)).toBe(true);
    expect(await auth.verifyPassword("wrong horse 1", h)).toBe(false);
    expect(await auth.hashPassword("correct horse 1")).not.toBe(h); // random salt
  });

  it("validates input", async () => {
    await expect(auth.registerUser({ email: "not-an-email", name: "A", password: "abcdefg1" })).rejects.toThrow(/valid email/);
    await expect(auth.registerUser({ email: "a@b.co", name: "A", password: "short1" })).rejects.toThrow(/8 characters/);
    await expect(auth.registerUser({ email: "a@b.co", name: "A", password: "onlyletters" })).rejects.toThrow(/letter and one number/);
    await expect(auth.registerUser({ email: "a@b.co", name: " ", password: "abcdefg1" })).rejects.toThrow(/name/);
  });

  it("makes the first account the owner, and new accounts start with no projects", async () => {
    const { createProject, listProjects } = await import("@/lib/server/projects");
    const legacy = createProject({ name: "Made before accounts" });
    const owner = await auth.registerUser({ email: "Owner@Example.com", name: "Olivia", password: "ownerpass1" });
    expect(owner.role).toBe("owner");
    expect(owner.email).toBe("owner@example.com");
    // Projects from before accounts are not shown to anyone automatically…
    expect(listProjects(owner.id).map((p) => p.id)).not.toContain(legacy.id);
    expect(auth.unownedProjects().map((p) => p.id)).toContain(legacy.id);
    // …until the owner adds them to their account.
    expect(auth.claimUnownedProjects(owner.id, [legacy.id])).toBe(1);
    expect(listProjects(owner.id).map((p) => p.id)).toContain(legacy.id);
    expect(auth.unownedProjects().map((p) => p.id)).not.toContain(legacy.id);
    const member = await auth.registerUser({ email: "member@example.com", name: "Marco", password: "memberpass1" });
    expect(member.role).toBe("member");
    expect(listProjects(member.id)).toEqual([]);
    await expect(auth.registerUser({ email: "MEMBER@example.com", name: "Dup", password: "memberpass1" })).rejects.toThrow(/already exists/);
  });

  it("authenticates, throttles repeated failures, and doesn't reveal which emails exist", async () => {
    const u = await auth.authenticate("OWNER@example.com", "ownerpass1");
    expect(u.name).toBe("Olivia");
    await expect(auth.authenticate("nobody@example.com", "x")).rejects.toThrow("Email or password is incorrect.");
    for (let i = 0; i < 5; i++) await expect(auth.authenticate("member@example.com", "wrongpass1")).rejects.toThrow();
    await expect(auth.authenticate("member@example.com", "memberpass1")).rejects.toThrow(/Too many attempts/);
  });

  it("creates, reads and destroys sessions (only a hash of the token is stored)", async () => {
    const { getDb } = await import("@/lib/server/db");
    const owner = await auth.authenticate("owner@example.com", "ownerpass1");
    const s = auth.createSession(owner.id, true);
    const headers = new Headers({ cookie: `other=1; ${auth.SESSION_COOKIE}=${encodeURIComponent(s.token)}` });
    expect(auth.userFromRequest(headers)?.id).toBe(owner.id);
    expect(getDb().prepare("SELECT COUNT(*) n FROM sessions WHERE token_hash = ?").get(s.token)).toMatchObject({ n: 0 });
    expect(auth.sessionCookie(s.token, s.maxAge)).toMatch(/HttpOnly; SameSite=Strict; Max-Age=2592000/);
    auth.destroySession(headers);
    expect(auth.userFromRequest(headers)).toBeNull();
    // Expired sessions are rejected.
    const s2 = auth.createSession(owner.id, false);
    getDb().prepare("UPDATE sessions SET expires_at = ? WHERE user_id = ?").run("2000-01-01T00:00:00.000Z", owner.id);
    expect(auth.userFromRequest(new Headers({ cookie: `${auth.SESSION_COOKIE}=${s2.token}` }))).toBeNull();
  });

  it("honours the owner's 'allow new accounts' switch", async () => {
    const { updateSettings } = await import("@/lib/server/settings");
    updateSettings({ allowRegistration: false });
    expect(auth.registrationOpen()).toBe(false);
    await expect(auth.registerUser({ email: "late@example.com", name: "Late", password: "latepass1" })).rejects.toThrow(/turned off/);
    updateSettings({ allowRegistration: true });
  });
});

describe("API routes enforce login and ownership", () => {
  it("works end to end through the real route handlers", async () => {
    const projectsRoute = await import("@/app/api/projects/route");
    const projectRoute = await import("@/app/api/projects/[id]/route");
    const loginRoute = await import("@/app/api/auth/login/route");
    const registerRoute = await import("@/app/api/auth/register/route");
    const sessionRoute = await import("@/app/api/auth/session/route");
    const logoutRoute = await import("@/app/api/auth/logout/route");
    const settingsRoute = await import("@/app/api/settings/route");

    // Not logged in → 401 with a machine-readable code.
    const anon = await projectsRoute.GET(req("GET", "/api/projects"), {});
    expect(anon.status).toBe(401);
    expect(await anon.json()).toMatchObject({ code: "auth_required" });
    expect(await (await sessionRoute.GET(req("GET", "/api/auth/session"), {})).json()).toMatchObject({ user: null, hasUsers: true });

    // Register a new member via the route: gets an HttpOnly cookie.
    const reg = await registerRoute.POST(req("POST", "/api/auth/register", { json: { name: "Rhea", email: "rhea@example.com", password: "rheapass12" } }), {});
    expect(reg.status).toBe(201);
    expect(reg.headers.get("set-cookie")).toMatch(/sf_session=.+; Path=\/; HttpOnly; SameSite=Strict/);
    const rhea = cookieFrom(reg);

    // Owner logs in and creates a project.
    const login = await loginRoute.POST(req("POST", "/api/auth/login", { json: { email: "owner@example.com", password: "ownerpass1" } }), {});
    expect(login.status).toBe(200);
    const owner = cookieFrom(login);
    const created = await projectsRoute.POST(req("POST", "/api/projects", { cookie: owner, json: { name: "Owner's secret project" } }), {});
    const project = (await created.json()) as { id: string };

    // The member can't list, read, rename or delete it.
    const list = (await (await projectsRoute.GET(req("GET", "/api/projects", { cookie: rhea }), {})).json()) as { id: string }[];
    expect(list.map((p) => p.id)).not.toContain(project.id);
    expect((await projectRoute.GET(req("GET", `/api/projects/${project.id}`, { cookie: rhea }), ctx({ id: project.id }) as never)).status).toBe(404);
    expect((await projectRoute.PATCH(req("PATCH", `/api/projects/${project.id}`, { cookie: rhea, json: { name: "hacked" } }), ctx({ id: project.id }) as never)).status).toBe(404);
    expect((await projectRoute.DELETE(req("DELETE", `/api/projects/${project.id}`, { cookie: rhea }), ctx({ id: project.id }) as never)).status).toBe(404);
    // The owner can.
    expect((await projectRoute.GET(req("GET", `/api/projects/${project.id}`, { cookie: owner }), ctx({ id: project.id }) as never)).status).toBe(200);

    // Shared settings: members can read but not change them.
    expect((await settingsRoute.PUT(req("PUT", "/api/settings", { cookie: rhea, json: { allowRegistration: false } }), {})).status).toBe(403);
    expect((await settingsRoute.PUT(req("PUT", "/api/settings", { cookie: owner, json: { allowRegistration: true } }), {})).status).toBe(200);

    // Logging out kills the session.
    const out = await logoutRoute.POST(req("POST", "/api/auth/logout", { cookie: rhea }), {});
    expect(out.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect((await projectsRoute.GET(req("GET", "/api/projects", { cookie: rhea }), {})).status).toBe(401);

    // A forged cookie is rejected; cross-site requests are still blocked before auth.
    expect((await projectsRoute.GET(req("GET", "/api/projects", { cookie: "sf_session=forged" }), {})).status).toBe(401);
    const cross = new Request(BASE + "/api/projects", { method: "POST", headers: { host: "127.0.0.1:3210", origin: "https://evil.example", cookie: owner, "x-stickforge": "1", "content-type": "application/json" }, body: "{}" });
    expect((await projectsRoute.POST(cross, {})).status).toBe(403);
  });
});
