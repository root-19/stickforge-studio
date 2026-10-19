import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function routeFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return routeFiles(p);
    return e.name === "route.ts" ? [p] : [];
  });
}

describe("API routes", () => {
  const files = routeFiles(path.join(import.meta.dirname, "..", "app", "api"));

  it("exist", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files.map((f) => [path.relative(path.join(import.meta.dirname, ".."), f), f]))("%s wraps every handler in withApi (local-request guard)", (_rel, file) => {
    const src = fs.readFileSync(file, "utf8");
    const exported = [...src.matchAll(/export\s+(?:async\s+)?(?:const|function)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map((m) => m[1]);
    expect(exported.length).toBeGreaterThan(0);
    // Only login/register/logout/session may skip the login requirement; they still get the local-request guard.
    const publicRoute = /[\\/]api[\\/]auth[\\/](login|register|logout|session)[\\/]/.test(file);
    for (const method of exported) {
      expect(src).toMatch(new RegExp(`export const ${method} = ${publicRoute ? "withPublicApi" : "withApi"}(<[^>]+>)?\\(`));
    }
    // Shell execution helpers must never appear in route handlers.
    expect(src).not.toMatch(/\bexec(Sync)?\(|shell:\s*true/);
  });
});
