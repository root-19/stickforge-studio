import { describe, expect, it } from "vitest";
import { checkLocalRequest, hostnameOf } from "@/lib/server/security";

const h = (init: Record<string, string>) => new Headers(init);

describe("checkLocalRequest", () => {
  it("parses host names", () => {
    expect(hostnameOf("localhost:3210")).toBe("localhost");
    expect(hostnameOf("[::1]:3210")).toBe("[::1]");
    expect(hostnameOf(null)).toBeNull();
  });

  it("allows same-origin reads and writes from the app", () => {
    expect(checkLocalRequest("GET", h({ host: "127.0.0.1:3210", "sec-fetch-site": "same-origin" })).ok).toBe(true);
    expect(
      checkLocalRequest("POST", h({ host: "localhost:3210", origin: "http://localhost:3210", "x-stickforge": "1", "sec-fetch-site": "same-origin" })).ok,
    ).toBe(true);
  });

  it("blocks DNS-rebinding hosts", () => {
    expect(checkLocalRequest("GET", h({ host: "evil.example:3210" })).ok).toBe(false);
    expect(checkLocalRequest("GET", h({})).ok).toBe(false);
  });

  it("blocks cross-site requests", () => {
    expect(checkLocalRequest("GET", h({ host: "localhost:3210", "sec-fetch-site": "cross-site" })).ok).toBe(false);
    expect(checkLocalRequest("POST", h({ host: "localhost:3210", origin: "https://evil.example", "x-stickforge": "1" })).ok).toBe(false);
    // A different local port is a different origin.
    expect(checkLocalRequest("POST", h({ host: "localhost:3210", origin: "http://localhost:8080", "x-stickforge": "1" })).ok).toBe(false);
  });

  it("requires the custom header for writes (forces a CORS preflight for other sites)", () => {
    expect(checkLocalRequest("POST", h({ host: "localhost:3210", origin: "http://localhost:3210" })).ok).toBe(false);
    expect(checkLocalRequest("DELETE", h({ host: "localhost:3210" })).ok).toBe(false);
    expect(checkLocalRequest("PATCH", h({ host: "localhost:3210", "x-stickforge": "1" })).ok).toBe(true);
  });
});
