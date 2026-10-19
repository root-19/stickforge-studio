import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTempHome } from "./support/temp-home";
import { makeTestMedia, testFfmpeg } from "./support/media";

const home = setupTempHome();
const ffmpeg = testFfmpeg();

type Mods = {
  projects: typeof import("@/lib/server/projects");
  assets: typeof import("@/lib/server/assets");
  settings: typeof import("@/lib/server/settings");
  db: typeof import("@/lib/server/db");
};
let m: Mods;
let media: ReturnType<typeof makeTestMedia>;
const mediaDir = path.join(home.dir, "My Media Folder");

beforeAll(async () => {
  m = {
    projects: await import("@/lib/server/projects"),
    assets: await import("@/lib/server/assets"),
    settings: await import("@/lib/server/settings"),
    db: await import("@/lib/server/db"),
  };
  m.settings.updateSettings({ projectsDir: path.join(home.dir, "Projects"), mediaFolders: [mediaDir] });
  fs.mkdirSync(mediaDir, { recursive: true });
  if (ffmpeg) media = makeTestMedia(ffmpeg, mediaDir);
});
afterAll(() => home.cleanup());

describe("projects", () => {
  it("creates, renames, saves state and lists projects", () => {
    const p = m.projects.createProject({ name: 'Mystery: "Lost" City?', ownerId: "usr_a" });
    expect(fs.existsSync(p.folder)).toBe(true);
    expect(path.basename(p.folder)).toBe("Mystery_ _Lost_ City_");
    for (const sub of m.projects.PROJECT_SUBDIRS) expect(fs.existsSync(path.join(p.folder, sub))).toBe(true);
    expect(fs.existsSync(path.join(p.folder, m.projects.PROJECT_FILE))).toBe(true);

    const r = m.projects.renameProject(p.id, "Lost City");
    expect(r.name).toBe("Lost City");
    expect(m.projects.listProjects("usr_a").map((x) => x.id)).toContain(p.id);
    expect(m.projects.listProjects("usr_b").map((x) => x.id)).not.toContain(p.id);

    // A second project with the same name gets its own folder.
    const p2 = m.projects.createProject({ name: "Lost City" });
    expect(p2.folder).not.toBe(r.folder);
  });

  it("rejects state that references unknown media and stale revisions", () => {
    const p = m.projects.createProject({ name: "State test" });
    expect(() =>
      m.projects.saveProjectState(p.id, { scenes: [{ id: "s1", assetId: "nope", duration: 2 }] }, p.revision),
    ).toThrow(/unknown media/);
    m.projects.saveProjectState(p.id, { scenes: [] }, p.revision);
    expect(() => m.projects.saveProjectState(p.id, { scenes: [] }, p.revision)).toThrow(/another window/);
  });
});

describe.skipIf(!ffmpeg)("assets", () => {
  it("links files from approved folders without copying, and probes them", async () => {
    const p = m.projects.createProject({ name: "Assets" });
    const video = await m.assets.importLinked(p.id, media.landscapeVideo);
    expect(video).toMatchObject({ kind: "video", storage: "linked", width: 1280, height: 720, hasAudio: true, available: true });
    expect(video.duration).toBeCloseTo(3, 0);
    expect(video.path).toBe(media.landscapeVideo);
    expect(video.hasThumbnail).toBe(true);
    const img = await m.assets.importLinked(p.id, media.portraitImage);
    expect(img).toMatchObject({ kind: "image", width: 720, height: 1280, duration: null });
    expect(fs.readdirSync(path.join(p.folder, "media"))).toEqual([]);
  });

  it("refuses files outside approved folders and unsupported types", async () => {
    const p = m.projects.createProject({ name: "Refuse" });
    const outside = path.join(home.dir, "outside.png");
    fs.copyFileSync(media.portraitImage, outside);
    await expect(m.assets.importLinked(p.id, outside)).rejects.toThrow(/approved media folder/);
    const txt = path.join(mediaDir, "notes.txt");
    fs.writeFileSync(txt, "x");
    await expect(m.assets.importLinked(p.id, txt)).rejects.toThrow(/Unsupported/);
  });

  it("copies uploads into the project folder and never touches the original", async () => {
    const p = m.projects.createProject({ name: "Upload" });
    const original = fs.readFileSync(media.squareImage);
    const body = new Blob([original]).stream();
    const a = await m.assets.importUpload(p.id, "my photo (final).jpg", body, original.length);
    expect(a.storage).toBe("managed");
    expect(path.dirname(a.path)).toBe(path.join(p.folder, "media"));
    expect(fs.readFileSync(a.path).equals(original)).toBe(true);
    // Same name again → unique name, no overwrite.
    const b = await m.assets.importUpload(p.id, "my photo (final).jpg", new Blob([original]).stream(), original.length);
    expect(b.path).not.toBe(a.path);
    // Deleting a managed asset removes only the copy.
    m.assets.deleteAsset(a.id);
    expect(fs.existsSync(a.path)).toBe(false);
    expect(fs.existsSync(media.squareImage)).toBe(true);
  });

  it("flags missing media, blocks deleting in-use media, and recovers a project from its folder", async () => {
    const p = m.projects.createProject({ name: "Recover" });
    const tmpCopy = path.join(mediaDir, "temp copy.png");
    fs.copyFileSync(media.portraitImage, tmpCopy);
    const a = await m.assets.importLinked(p.id, tmpCopy);
    const saved = m.projects.saveProjectState(p.id, { scenes: [{ id: "s1", assetId: a.id, duration: 2 }] }, p.revision);
    expect(() => m.assets.deleteAsset(a.id)).toThrow(/used in the timeline/);
    fs.rmSync(tmpCopy);
    expect(m.assets.getAsset(a.id).available).toBe(false);

    // Simulate a lost database: delete the row and re-open from the folder file.
    m.db.getDb().prepare("DELETE FROM projects WHERE id = ?").run(p.id);
    expect(() => m.projects.getProject(p.id)).toThrow(/not found/);
    const restored = m.projects.openProjectFolder(saved.folder);
    expect(restored.id).toBe(p.id);
    expect(restored.state.scenes).toHaveLength(1);
    expect(m.assets.listAssets(p.id).map((x) => x.id)).toEqual([a.id]);
  });

  it("deletes a project folder only when asked", () => {
    const p = m.projects.createProject({ name: "Delete me" });
    m.projects.deleteProject(p.id, false);
    expect(fs.existsSync(p.folder)).toBe(true);
    const q = m.projects.createProject({ name: "Delete files" });
    m.projects.deleteProject(q.id, true);
    expect(fs.existsSync(q.folder)).toBe(false);
  });
});
