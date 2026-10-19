import { describe, expect, it } from "vitest";
import { buildFfmpegArgs, type RenderSpec } from "@/lib/server/ffmpeg/render";

const base: RenderSpec = {
  width: 1080,
  height: 1920,
  fps: 30,
  crf: 21,
  x264Preset: "faster",
  encoder: "libx264",
  scenes: [
    { kind: "image", path: "C:\\My Media\\it's a \"test\" & more;rm -rf.png", duration: 3, trimStart: 0, fit: "cover", motion: "zoomIn", clipVolume: 1, clipMuted: true, hasAudio: false },
    { kind: "video", path: "C:\\clips\\b-roll [1].mp4", duration: 4.5, trimStart: 2, fit: "blur", motion: "none", clipVolume: 0.5, clipMuted: false, hasAudio: true },
  ],
  narration: { path: "C:\\p\\narration.wav", volume: 1, offset: 0.25 },
  music: { path: "C:\\p\\music.mp3", volume: 0.2, loop: true, duck: true, fadeOut: 1.5 },
  subtitlesFile: "captions.ass",
  outputPath: "C:\\out\\My Video.mp4",
};

describe("buildFfmpegArgs", () => {
  const { args, filterGraph, duration } = buildFfmpegArgs(base);

  it("passes user paths only as standalone file: arguments", () => {
    expect(args).toContain("file:" + base.scenes[0].path);
    expect(args).toContain("file:" + base.scenes[1].path);
    expect(filterGraph).not.toContain("My Media");
    expect(filterGraph).not.toContain("b-roll");
    expect(args.at(-1)).toBe("file:C:\\out\\My Video.mp4");
    expect(args).toContain("-n"); // never overwrite
  });

  it("uses trim/seek for video and a single decoded frame for images", () => {
    const i = args.indexOf("file:" + base.scenes[1].path);
    expect(args.slice(i - 5, i)).toEqual(["-ss", "2", "-t", "4.5", "-i"]);
    const j = args.indexOf("file:" + base.scenes[0].path);
    expect(args.slice(j - 1, j)).toEqual(["-i"]);
    expect(args.slice(0, j)).not.toContain("-loop");
    expect(filterGraph).toContain("tpad=stop_mode=clone:stop_duration=3,trim=duration=3");
  });

  it("builds fit, motion, concat, captions and mixing filters", () => {
    expect(filterGraph).toContain("force_original_aspect_ratio=increase,crop=1620:2880"); // zoom source at 1.5x
    expect(filterGraph).toContain("zoompan=z='1+0.12*on/90'");
    expect(filterGraph).toContain(":d=90:s=1080x1920:fps=30");
    expect(filterGraph).toContain("boxblur");
    expect(filterGraph).toContain("[1:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=0.5");
    expect(filterGraph).toContain("anullsrc=r=48000:cl=stereo,atrim=duration=3[a0]");
    expect(filterGraph).toContain("[v0][a0][v1][a1]concat=n=2:v=1:a=1[vcat][acat]");
    expect(filterGraph).toContain("[vcat]subtitles=filename=captions.ass[vout]");
    expect(filterGraph).toContain("adelay=delays=250:all=1[nar]");
    expect(filterGraph).toContain("sidechaincompress");
    expect(filterGraph).toContain("afade=t=out:st=6:d=1.5");
    expect(filterGraph).toContain("[acat][nar1][mus]amix=inputs=3:duration=first");
    expect(args).toEqual(expect.arrayContaining(["-stream_loop", "-1", "-c:v", "libx264", "-preset", "faster", "-crf", "21", "-c:a", "aac", "-r", "30"]));
    expect(duration).toBe(7.5);
  });

  it("works without audio tracks or captions", () => {
    const r = buildFfmpegArgs({ ...base, narration: null, music: null, subtitlesFile: null, scenes: [{ ...base.scenes[0], motion: "none", fit: "contain" }] });
    expect(r.filterGraph).toContain("[vcat]null[vout]");
    expect(r.filterGraph).toContain("pad=1080:1920");
    expect(r.filterGraph).toContain("[acat]amix=inputs=1");
  });

  it("rejects unsafe subtitle names and empty timelines", () => {
    expect(() => buildFfmpegArgs({ ...base, subtitlesFile: "C:/x/y.ass" })).toThrow();
    expect(() => buildFfmpegArgs({ ...base, scenes: [] })).toThrow(/at least one scene/);
  });

  it("falls back to h264_mf with a bitrate", () => {
    const r = buildFfmpegArgs({ ...base, encoder: "h264_mf" });
    expect(r.args).toEqual(expect.arrayContaining(["-c:v", "h264_mf", "-b:v", "8M"]));
  });
});
