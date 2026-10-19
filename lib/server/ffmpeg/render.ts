/**
 * Pure builder for the FFmpeg export command. Produces an argument ARRAY
 * (no shell). User-controlled paths only ever appear as standalone `-i`
 * arguments prefixed with `file:`; the filter graph contains no paths except
 * the fixed relative subtitle file name, so no escaping of user input is needed.
 */

export type RenderScene = {
  kind: "video" | "image";
  path: string;
  duration: number;
  trimStart: number;
  fit: "cover" | "contain" | "blur";
  motion: "none" | "zoomIn" | "zoomOut";
  clipVolume: number;
  clipMuted: boolean;
  hasAudio: boolean;
};

export type RenderSpec = {
  width: number;
  height: number;
  fps: number;
  crf: number;
  /** libx264 speed/size trade-off. */
  x264Preset: "medium" | "fast" | "faster" | "veryfast";
  encoder: "libx264" | "h264_mf";
  scenes: RenderScene[];
  narration: { path: string; volume: number; offset: number } | null;
  music: { path: string; volume: number; loop: boolean; duck: boolean; fadeOut: number } | null;
  /** Relative file name inside the FFmpeg working directory, or null. */
  subtitlesFile: string | null;
  outputPath: string;
};

export const SUBTITLE_FILE_NAME = "captions.ass";

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
const num = (n: number) => String(Math.round(n * 1000) / 1000);

export function totalDuration(spec: Pick<RenderSpec, "scenes">): number {
  return Math.round(spec.scenes.reduce((n, s) => n + s.duration, 0) * 1000) / 1000;
}

function fitChain(fit: RenderScene["fit"], W: number, H: number, input: string, label: string): string {
  if (fit === "cover") {
    return `${input}scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1[${label}]`;
  }
  if (fit === "contain") {
    return `${input}scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[${label}]`;
  }
  const bw = even(W / 4);
  const bh = even(H / 4);
  return [
    `${input}split=2[${label}bg][${label}fg]`,
    `[${label}bg]scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},boxblur=8:2,scale=${W}:${H},setsar=1[${label}bgs]`,
    `[${label}fg]scale=${W}:${H}:force_original_aspect_ratio=decrease,setsar=1[${label}fgs]`,
    `[${label}bgs][${label}fgs]overlay=(W-w)/2:(H-h)/2[${label}]`,
  ].join(";");
}

export function buildFfmpegArgs(spec: RenderSpec): { args: string[]; filterGraph: string; duration: number } {
  if (spec.scenes.length === 0) throw new Error("Add at least one scene before exporting.");
  const W = even(spec.width);
  const H = even(spec.height);
  const fps = spec.fps;
  const T = totalDuration(spec);
  const args: string[] = [];
  const filters: string[] = [];

  spec.scenes.forEach((s) => {
    if (s.kind === "video") {
      args.push("-ss", num(s.trimStart), "-t", num(s.duration), "-i", `file:${s.path}`);
    } else {
      // A still image is decoded and scaled ONCE; the filter chain then holds it (tpad) or animates it (zoompan).
      args.push("-i", `file:${s.path}`);
    }
  });
  let nextInput = spec.scenes.length;
  const narrationIdx = spec.narration ? nextInput++ : -1;
  if (spec.narration) args.push("-i", `file:${spec.narration.path}`);
  const musicIdx = spec.music ? nextInput++ : -1;
  if (spec.music) {
    if (spec.music.loop) args.push("-stream_loop", "-1");
    args.push("-i", `file:${spec.music.path}`);
  }

  const concatInputs: string[] = [];
  spec.scenes.forEach((s, i) => {
    const D = num(s.duration);
    const useMotion = s.kind === "image" && s.motion !== "none";
    // Zoom from a 1.5x source so the moving crop stays sharp without the cost of 2x.
    const fw = useMotion ? even(W * 1.5) : W;
    const fh = useMotion ? even(H * 1.5) : H;
    filters.push(fitChain(s.fit, fw, fh, `[${i}:v]`, `f${i}`));
    let chain = `[f${i}]`;
    if (useMotion) {
      const frames = Math.max(1, Math.round(s.duration * fps));
      const z = s.motion === "zoomIn" ? `1+0.12*on/${frames}` : `1.12-0.12*on/${frames}`;
      chain += `zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${fps},`;
    }
    // Normalize every source (JPEGs are full-range) to limited-range BT.709 so concat inputs match.
    chain += `fps=${fps},scale=out_range=tv:out_color_matrix=bt709,format=yuv420p,setrange=tv,tpad=stop_mode=clone:stop_duration=${D},trim=duration=${D},setpts=PTS-STARTPTS[v${i}]`;
    filters.push(chain);

    if (s.kind === "video" && s.hasAudio && !s.clipMuted && s.clipVolume > 0) {
      filters.push(
        `[${i}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${num(s.clipVolume)},apad,atrim=duration=${D},asetpts=PTS-STARTPTS[a${i}]`,
      );
    } else {
      filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${D}[a${i}]`);
    }
    concatInputs.push(`[v${i}][a${i}]`);
  });
  filters.push(`${concatInputs.join("")}concat=n=${spec.scenes.length}:v=1:a=1[vcat][acat]`);

  if (spec.subtitlesFile) {
    if (!/^[A-Za-z0-9_.-]+$/.test(spec.subtitlesFile)) throw new Error("Subtitle file name must be a plain relative name");
    filters.push(`[vcat]subtitles=filename=${spec.subtitlesFile}[vout]`);
  } else {
    filters.push(`[vcat]null[vout]`);
  }

  const mixInputs = ["[acat]"];
  let narrationLabel: string | null = null;
  if (spec.narration) {
    const delayMs = Math.round(spec.narration.offset * 1000);
    filters.push(
      `[${narrationIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${num(spec.narration.volume)},adelay=delays=${delayMs}:all=1[nar]`,
    );
    narrationLabel = "[nar]";
  }
  if (spec.music) {
    filters.push(`[${musicIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${num(spec.music.volume)}[mus0]`);
    let musLabel = "[mus0]";
    if (spec.music.duck && narrationLabel) {
      filters.push(`${narrationLabel}asplit=2[nar1][narsc]`);
      filters.push(`[mus0][narsc]sidechaincompress=threshold=0.04:ratio=6:attack=30:release=500:makeup=1[mus1]`);
      narrationLabel = "[nar1]";
      musLabel = "[mus1]";
    }
    const fade = Math.min(spec.music.fadeOut, T / 2);
    const fadePart = fade > 0 ? `,afade=t=out:st=${num(Math.max(0, T - fade))}:d=${num(fade)}` : "";
    filters.push(`${musLabel}atrim=duration=${num(T)},asetpts=PTS-STARTPTS${fadePart}[mus]`);
    mixInputs.push("[mus]");
  }
  if (narrationLabel) mixInputs.splice(1, 0, narrationLabel);
  filters.push(
    `${mixInputs.join("")}amix=inputs=${mixInputs.length}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95,atrim=duration=${num(T)}[aout]`,
  );

  const filterGraph = filters.join(";");
  args.push("-filter_complex", filterGraph, "-map", "[vout]", "-map", "[aout]");
  if (spec.encoder === "libx264") {
    args.push("-c:v", "libx264", "-preset", spec.x264Preset, "-crf", String(spec.crf), "-profile:v", "high");
  } else {
    const mbps = spec.crf <= 18 ? 12 : spec.crf <= 21 ? 8 : 5;
    args.push("-c:v", "h264_mf", "-b:v", `${mbps}M`);
  }
  args.push(
    "-pix_fmt", "yuv420p",
    "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
    "-r", String(fps),
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-movflags", "+faststart",
    "-t", num(T),
    "-n",
    `file:${spec.outputPath}`,
  );
  return { args, filterGraph, duration: T };
}
