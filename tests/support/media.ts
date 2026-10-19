import { spawnSync } from "node:child_process";
import path from "node:path";

/** Locate ffmpeg for tests without going through app settings. */
export function testFfmpeg(): string | null {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", ["ffmpeg"], { encoding: "utf8" });
  const first = r.stdout?.split(/\r?\n/).find((l) => l.trim());
  return r.status === 0 && first ? first.trim() : null;
}

export function testFfprobe(): string | null {
  const ff = testFfmpeg();
  if (!ff) return null;
  return path.join(path.dirname(ff), process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
}

function run(ffmpeg: string, args: string[]) {
  const r = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
}

/** Generate small synthetic test media with FFmpeg's built-in sources. */
export function makeTestMedia(ffmpeg: string, dir: string) {
  const landscapeVideo = path.join(dir, "landscape clip (1).mp4");
  const portraitImage = path.join(dir, "portrait image's.png");
  const squareImage = path.join(dir, "square.jpg");
  const music = path.join(dir, "music track.wav");
  const tone = path.join(dir, "narration.wav");
  run(ffmpeg, ["-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=3", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", landscapeVideo]);
  run(ffmpeg, ["-f", "lavfi", "-i", "testsrc=size=720x1280:rate=1", "-frames:v", "1", portraitImage]);
  run(ffmpeg, ["-f", "lavfi", "-i", "smptebars=size=800x800:rate=1", "-frames:v", "1", squareImage]);
  run(ffmpeg, ["-f", "lavfi", "-i", "sine=frequency=220:duration=4", "-ac", "2", music]);
  run(ffmpeg, ["-f", "lavfi", "-i", "sine=frequency=660:duration=2", "-ac", "1", "-ar", "22050", tone]);
  return { landscapeVideo, portraitImage, squareImage, music, tone };
}

export function probeJson(ffprobe: string, file: string) {
  const r = spawnSync(ffprobe, ["-v", "error", "-show_format", "-show_streams", "-of", "json", file], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout) as {
    format: { duration: string };
    streams: { codec_type: string; codec_name: string; width?: number; height?: number; r_frame_rate?: string; pix_fmt?: string; sample_rate?: string }[];
  };
}
