import { withApi } from "@/lib/server/api";
import { getCatalog } from "@/lib/server/tts/catalog";
import { freeDiskBytes, listInstalledVoices, voicesDir } from "@/lib/server/tts/voices";
import { listJobs } from "@/lib/server/jobs";

export const GET = withApi(() => {
  const dir = voicesDir();
  const installing = listJobs()
    .filter((j) => j.kind === "voice-install" && (j.status === "running" || j.status === "queued"))
    .map((j) => ({ jobId: j.id, key: j.meta.key ?? "" }));
  return Response.json({
    voicesDir: dir,
    freeBytes: freeDiskBytes(dir),
    installed: listInstalledVoices(),
    catalog: getCatalog(),
    installing,
  });
});
