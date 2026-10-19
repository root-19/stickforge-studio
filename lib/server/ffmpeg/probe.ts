import "server-only";
import { requireTool } from "./locate";
import { runCapture } from "./run";

export type ProbeResult = {
  duration: number | null;
  width: number | null;
  height: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec: string | null;
  /** True for still images (single frame formats). */
  isStill: boolean;
};

type FfprobeJson = {
  format?: { duration?: string; format_name?: string };
  streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number; duration?: string; nb_frames?: string; tags?: { rotate?: string }; side_data_list?: { rotation?: number }[] }[];
};

export async function probeMedia(file: string): Promise<ProbeResult> {
  const ffprobe = requireTool("ffprobe");
  const out = await runCapture(ffprobe, ["-v", "error", "-show_format", "-show_streams", "-of", "json", file]);
  const json = JSON.parse(out) as FfprobeJson;
  const streams = json.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video");
  const a = streams.find((s) => s.codec_type === "audio");
  const formatName = json.format?.format_name ?? "";
  const isStill = !!v && /image2|png_pipe|jpeg_pipe|webp_pipe|_pipe$/.test(formatName);
  let width = v?.width ?? null;
  let height = v?.height ?? null;
  // Phone videos often store rotation metadata; report display dimensions.
  const rotation = Number(v?.tags?.rotate ?? v?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0);
  if (width && height && Math.abs(rotation) % 180 === 90) [width, height] = [height, width];
  const durRaw = json.format?.duration ?? v?.duration ?? a?.duration;
  const duration = durRaw && isFinite(Number(durRaw)) ? Number(durRaw) : null;
  return {
    duration: isStill ? null : duration,
    width,
    height,
    hasVideo: !!v,
    hasAudio: !!a,
    videoCodec: v?.codec_name ?? null,
    isStill,
  };
}
