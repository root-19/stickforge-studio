import { z } from "zod";

/** Media kinds the editor understands. */
export const ASSET_KINDS = ["video", "image", "audio"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm", ".m4v", ".mkv"] as const;
export const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"] as const;
export const AUDIO_EXTENSIONS = [".wav", ".mp3", ".m4a", ".aac", ".ogg", ".flac"] as const;

export function assetKindForExtension(ext: string): AssetKind | null {
  const e = ext.toLowerCase();
  if ((VIDEO_EXTENSIONS as readonly string[]).includes(e)) return "video";
  if ((IMAGE_EXTENSIONS as readonly string[]).includes(e)) return "image";
  if ((AUDIO_EXTENSIONS as readonly string[]).includes(e)) return "audio";
  return null;
}

/** Where a downloaded stock file came from — used for credits/attribution. */
export type AssetSource = {
  provider: "pexels" | "commons";
  providerLabel: string;
  pageUrl: string;
  title: string;
  author: string;
  authorUrl: string | null;
  license: string;
  licenseUrl: string | null;
  commercialUse: CommercialUse;
};

export type Asset = {
  id: string;
  projectId: string;
  kind: AssetKind;
  /** Absolute path on disk. Only ever resolved by the server. */
  path: string;
  name: string;
  /** "managed" = copied into the project folder, "linked" = referenced in place. */
  storage: "managed" | "linked";
  size: number;
  duration: number | null;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
  createdAt: string;
  /** Computed on read: false when the file no longer exists. */
  available: boolean;
  hasThumbnail: boolean;
  source: AssetSource | null;
};

// ---------------------------------------------------------------------------
// Project (editor) state
// ---------------------------------------------------------------------------

export const FIT_MODES = ["cover", "contain", "blur"] as const;

/** Canvas ratios a project can use (CapCut-style "Ratio"). */
export const ASPECTS = {
  "9:16": { w: 9, h: 16, label: "9:16", hint: "Phone — Shorts, Reels, TikTok" },
  "16:9": { w: 16, h: 9, label: "16:9", hint: "Landscape — YouTube, Facebook video" },
  "1:1": { w: 1, h: 1, label: "1:1", hint: "Square — Facebook / Instagram feed" },
  "4:5": { w: 4, h: 5, label: "4:5", hint: "Portrait feed — Facebook / Instagram" },
} as const;
export type AspectId = keyof typeof ASPECTS;
export const ASPECT_IDS = Object.keys(ASPECTS) as AspectId[];

/** Export sizes by the frame's SHORT side. */
export const RESOLUTIONS = {
  "1080": { short: 1080, label: "1080p", hint: "Standard" },
  "1440": { short: 1440, label: "1440p (2K)", hint: "Large" },
  "2160": { short: 2160, label: "2160p (4K)", hint: "Extra large — slow to render" },
} as const;
export type ResolutionId = keyof typeof RESOLUTIONS;

/** Output size for a ratio at a resolution, e.g. 9:16 @ 1080 → 1080×1920. Always even numbers. */
export function outputSize(aspect: AspectId, resolution: ResolutionId): { width: number; height: number } {
  const a = ASPECTS[aspect];
  const short = RESOLUTIONS[resolution].short;
  const long = Math.round((short * Math.max(a.w, a.h)) / Math.min(a.w, a.h) / 2) * 2;
  return a.w >= a.h ? { width: long, height: short } : { width: short, height: long };
}

/** Caption position that suits each ratio (fraction of height). */
export const DEFAULT_CAPTION_Y: Record<AspectId, number> = { "9:16": 0.62, "16:9": 0.84, "1:1": 0.8, "4:5": 0.74 };
export const MOTIONS = ["none", "zoomIn", "zoomOut"] as const;

export const sceneSchema = z.object({
  id: z.string().min(1).max(64),
  assetId: z.string().min(1).max(64),
  /** Seconds this scene occupies on the timeline. */
  duration: z.number().min(0.1).max(3600),
  /** Seconds skipped at the start of a video source. Ignored for images. */
  trimStart: z.number().min(0).max(36000).default(0),
  fit: z.enum(FIT_MODES).default("cover"),
  motion: z.enum(MOTIONS).default("none"),
  /** Volume of the clip's own audio (videos only). 0..2 */
  clipVolume: z.number().min(0).max(2).default(1),
  clipMuted: z.boolean().default(true),
});
export type Scene = z.infer<typeof sceneSchema>;

export const audioTrackSchema = z.object({
  assetId: z.string().min(1).max(64),
  volume: z.number().min(0).max(2).default(1),
  muted: z.boolean().default(false),
  /** Seconds from timeline start. */
  offset: z.number().min(0).max(3600).default(0),
});
export type AudioTrack = z.infer<typeof audioTrackSchema>;

export const musicTrackSchema = audioTrackSchema.extend({
  loop: z.boolean().default(true),
  /** Lower the music while narration plays (FFmpeg sidechain compression on export). */
  duck: z.boolean().default(true),
  fadeOut: z.number().min(0).max(10).default(1.5),
});
export type MusicTrack = z.infer<typeof musicTrackSchema>;

export const captionSchema = z.object({
  id: z.string().min(1).max(64),
  start: z.number().min(0).max(36000),
  end: z.number().min(0).max(36000),
  text: z.string().max(500),
});
export type Caption = z.infer<typeof captionSchema>;

export const CAPTION_FONTS = ["Arial", "Arial Black", "Impact", "Segoe UI", "Verdana", "Georgia"] as const;

export const captionStyleSchema = z.object({
  font: z.enum(CAPTION_FONTS).default("Arial Black"),
  /** Font size in pixels for a frame whose SHORT side is 1080 px (scaled for other sizes and ratios). */
  fontSize: z.number().min(24).max(200).default(84),
  /** Vertical centre of the caption as a fraction of canvas height (0 = top). */
  positionY: z.number().min(0.1).max(0.9).default(0.62),
  /** Horizontal safe margin as a fraction of canvas width on each side. */
  marginX: z.number().min(0.02).max(0.3).default(0.08),
  textColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#FFFFFF"),
  highlightColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#FFD400"),
  background: z.enum(["outline", "box"]).default("outline"),
  outlineWidth: z.number().min(0).max(12).default(6),
  uppercase: z.boolean().default(true),
  /** Words to highlight (case-insensitive, whole words). */
  keywords: z.array(z.string().max(60)).max(200).default([]),
  /** Highlight numbers like 1922 automatically. */
  highlightNumbers: z.boolean().default(true),
  wordsPerCaption: z.number().int().min(1).max(12).default(4),
});
export type CaptionStyle = z.infer<typeof captionStyleSchema>;

export const captionsSchema = z.object({
  enabled: z.boolean().default(true),
  /** How the current timings were produced, shown to the user. */
  timing: z.enum(["sentence", "estimated", "manual"]).default("estimated"),
  items: z.array(captionSchema).max(5000).default([]),
  style: captionStyleSchema.default(captionStyleSchema.parse({})),
});
export type Captions = z.infer<typeof captionsSchema>;

export const projectStateSchema = z.object({
  version: z.literal(1).default(1),
  /** Canvas ratio. Older projects without it are 9:16. */
  aspect: z.enum(["9:16", "16:9", "1:1", "4:5"]).default("9:16"),
  scenes: z.array(sceneSchema).max(500).default([]),
  narration: audioTrackSchema.nullable().default(null),
  /** Narration record this track was produced from (used to rebuild captions). */
  narrationId: z.string().max(64).nullable().default(null),
  music: musicTrackSchema.nullable().default(null),
  captions: captionsSchema.default(captionsSchema.parse({})),
});
export type ProjectState = z.infer<typeof projectStateSchema>;

export function emptyProjectState(): ProjectState {
  return projectStateSchema.parse({});
}

export type ProjectSummary = {
  id: string;
  name: string;
  folder: string;
  createdAt: string;
  updatedAt: string;
  sceneCount: number;
  duration: number;
  thumbnailAssetId: string | null;
  folderAvailable: boolean;
  aspect: AspectId;
};

export type Project = ProjectSummary & {
  state: ProjectState;
  revision: number;
};

// ---------------------------------------------------------------------------
// Narration / TTS
// ---------------------------------------------------------------------------

export const voiceSettingsSchema = z.object({
  voiceKey: z.string().min(1).max(120),
  speakerId: z.number().int().min(0).max(5000).default(0),
  /** 1.0 = model default. Converted to Piper length_scale = default / speed. */
  speed: z.number().min(0.5).max(2).default(1.05),
  /** Piper noise_scale: variation in intonation. */
  noiseScale: z.number().min(0).max(1.5).default(0.667),
  /** Piper noise_w: variation in phoneme timing. */
  noiseW: z.number().min(0).max(1.5).default(0.8),
  /** Silence inserted after each sentence (seconds). */
  sentencePause: z.number().min(0).max(3).default(0.25),
  /** Silence inserted between paragraphs (seconds). */
  paragraphPause: z.number().min(0).max(5).default(0.5),
});
export type VoiceSettings = z.infer<typeof voiceSettingsSchema>;

export type SentenceTiming = { text: string; start: number; end: number };

export type NarrationSegment = {
  id: string;
  text: string;
  /** Hash of text + voice settings for the generated audio; null = not generated. */
  audioHash: string | null;
  duration: number | null;
  /** Sentence timings relative to the segment start (measured from synthesized audio). */
  sentences: SentenceTiming[];
  status: "pending" | "ready" | "stale" | "error";
  error?: string;
};

export type Narration = {
  id: string;
  projectId: string;
  name: string;
  script: string;
  settings: VoiceSettings;
  segments: NarrationSegment[];
  /** Duration of the combined narration WAV, if built. */
  duration: number | null;
  combinedHash: string | null;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Voices
// ---------------------------------------------------------------------------

export type CommercialUse = "allowed" | "attribution" | "share-alike" | "non-commercial" | "unclear";

export type VoiceCatalogEntry = {
  key: string;
  name: string;
  languageCode: string;
  languageLabel: string;
  quality: string;
  numSpeakers: number;
  gender: "male" | "female" | "mixed" | "neutral" | "unknown";
  license: string;
  licenseUrl: string | null;
  commercialUse: CommercialUse;
  recommended: boolean;
  description: string;
  files: { path: string; sizeBytes: number; md5: string }[];
  totalBytes: number;
  sourceUrl: string;
};

export type InstalledVoice = {
  key: string;
  name: string;
  languageCode: string;
  quality: string;
  numSpeakers: number;
  speakers: { id: number; name: string }[];
  sampleRate: number;
  sizeBytes: number;
  dir: string;
  catalog: VoiceCatalogEntry | null;
  modelCard: string | null;
};

// ---------------------------------------------------------------------------
// Jobs & exports
// ---------------------------------------------------------------------------

export type JobStatus = "queued" | "running" | "done" | "error" | "cancelled";

export type JobInfo = {
  id: string;
  kind: "tts" | "voice-install" | "export" | "convert";
  status: JobStatus;
  progress: number;
  message: string;
  error: string | null;
  result: unknown;
  meta: Record<string, string>;
  createdAt: string;
  updatedAt: string;
};

export const EXPORT_PRESETS = {
  "youtube-shorts": { label: "YouTube Shorts", aspect: "9:16", fps: 30, maxDuration: 180 },
  "facebook-reels": { label: "Facebook Reels", aspect: "9:16", fps: 30, maxDuration: 90 },
  youtube: { label: "YouTube video", aspect: "16:9", fps: 30, maxDuration: null },
  square: { label: "Square post", aspect: "1:1", fps: 30, maxDuration: null },
  feed: { label: "Portrait feed post", aspect: "4:5", fps: 30, maxDuration: null },
  custom: { label: "Custom size", aspect: null, fps: 30, maxDuration: null },
} as const satisfies Record<string, { label: string; aspect: AspectId | null; fps: number; maxDuration: number | null }>;
export type ExportPresetId = keyof typeof EXPORT_PRESETS;

export const QUALITY_CRF = { high: 18, standard: 21, small: 26 } as const;
/** Faster presets for lower quality settings (measured ~2.5x faster for "veryfast" vs "medium"). */
export const QUALITY_X264_PRESET = { high: "medium", standard: "faster", small: "veryfast" } as const;
export type ExportQuality = keyof typeof QUALITY_CRF;

export const exportRequestSchema = z.object({
  projectId: z.string().min(1).max(64),
  preset: z.enum(["youtube-shorts", "facebook-reels", "youtube", "square", "feed", "custom"]).default("youtube-shorts"),
  /** Short-side resolution for presets. */
  resolution: z.enum(["1080", "1440", "2160"]).default("1080"),
  width: z.number().int().min(240).max(4096).optional(),
  height: z.number().int().min(240).max(4096).optional(),
  fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(60)]).optional(),
  quality: z.enum(["high", "standard", "small"]).default("standard"),
  burnCaptions: z.boolean().default(true),
  writeSrt: z.boolean().default(true),
  fileName: z.string().max(120).optional(),
  /** Optional output folder; must be an approved folder. Defaults to the project's exports folder. */
  outputDir: z.string().max(1000).optional(),
});
export type ExportRequest = z.infer<typeof exportRequestSchema>;
export type ExportRequestInput = z.input<typeof exportRequestSchema>;

export type ExportRecord = {
  id: string;
  projectId: string;
  projectName: string;
  status: JobStatus;
  progress: number;
  preset: string;
  width: number;
  height: number;
  fps: number;
  outputPath: string;
  srtPath: string | null;
  duration: number;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  fileExists: boolean;
};

/** Pitch/tone summary of a recording (see lib/server/audio-analysis.ts). */
export type VoiceFeaturesLite = { f0: number; f0Spread: number; centroid: number; voicedRatio: number; seconds: number };

export type VoiceMatch = {
  key: string;
  similarity: number;
  f0: number;
  gender: VoiceCatalogEntry["gender"];
  languageCode: string;
  commercialUse: CommercialUse;
  license: string;
  installed: boolean;
  totalBytes: number;
};
