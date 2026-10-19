import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { isInside, safeFileName, uniquePath, validateAbsolutePath, writeFileAtomic } from "@/lib/server/paths";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sf-paths-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("isInside", () => {
  it("accepts children and the root itself", () => {
    expect(isInside(tmp, path.join(tmp, "a", "b.mp4"))).toBe(true);
    expect(isInside(tmp, tmp)).toBe(true);
  });
  it("rejects traversal and siblings with a shared prefix", () => {
    expect(isInside(tmp, path.join(tmp, "..", "x"))).toBe(false);
    expect(isInside(path.join(tmp, "proj"), path.join(tmp, "proj-evil", "f"))).toBe(false);
  });
  it("is case-insensitive on Windows", () => {
    if (process.platform === "win32") expect(isInside(tmp.toUpperCase(), path.join(tmp.toLowerCase(), "f"))).toBe(true);
  });
});

describe("validateAbsolutePath", () => {
  it("accepts absolute paths with spaces and unicode", () => {
    const p = path.join(tmp, "My Folder", "ñ & 'quotes'");
    expect(validateAbsolutePath(p)).toBe(path.resolve(p));
  });
  it("rejects relative, UNC, device and NUL paths", () => {
    expect(() => validateAbsolutePath("relative\\x")).toThrow(/absolute/);
    expect(() => validateAbsolutePath("\\\\server\\share\\x")).toThrow();
    expect(() => validateAbsolutePath("\\\\?\\C:\\x")).toThrow(/device/);
    expect(() => validateAbsolutePath("C:\\a\0b")).toThrow(/invalid/);
    expect(() => validateAbsolutePath("")).toThrow(/required/);
  });
});

describe("safeFileName / uniquePath", () => {
  it("removes reserved characters and names", () => {
    expect(safeFileName('a<b>:c"/d\\e|f?g*h')).toBe("a_b__c__d_e_f_g_h");
    expect(safeFileName("CON")).toBe("file_CON");
    expect(safeFileName("  ..  ")).toBe("file");
    expect(safeFileName("Mystery of the Pyramids.mp4")).toBe("Mystery of the Pyramids.mp4");
  });
  it("never returns an existing file", () => {
    const first = uniquePath(tmp, "out.mp4");
    fs.writeFileSync(first, "");
    const second = uniquePath(tmp, "out.mp4");
    expect(second).toBe(path.join(tmp, "out (2).mp4"));
  });
  it("writes atomically", () => {
    const f = path.join(tmp, "sub", "state.json");
    writeFileAtomic(f, "{}");
    expect(fs.readFileSync(f, "utf8")).toBe("{}");
    expect(fs.readdirSync(path.dirname(f)).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });
});
