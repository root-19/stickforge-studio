import "server-only";
import fs from "node:fs";
import path from "node:path";
import { getTemplate, type FigurePose, type ProjectTemplate, type TemplateCard } from "@/lib/shared/templates";
import { VOICE_PRESETS } from "@/lib/shared/narration";
import { captionStyleSchema, outputSize, sceneSchema, type AspectId, type Project } from "@/lib/shared/types";
import { assColor, escapeAssText } from "./ffmpeg/ass";
import { requireTool } from "./ffmpeg/locate";
import { runFfmpeg } from "./ffmpeg/run";
import { HttpError } from "./errors";
import { createProject, getProject, saveProjectState } from "./projects";
import { registerGenerated } from "./assets";
import { createNarration } from "./narrations";
import { getSettings } from "./settings";
import { listInstalledVoices } from "./tts/voices";
import { safeFileName } from "./paths";

const CARD_FILE = "card.ass";

function hex6(c: string) {
  return c.replace("#", "").toLowerCase();
}

/**
 * Stick figure as ASS vector drawing. Coordinates are for a figure whose head
 * top is at (0,0) and which is ~700 px tall at scale 1; it is then placed with
 * \pos and scaled with \fscx/\fscy.
 */
export function stickFigurePaths(pose: FigurePose): { head: string; body: string } {
  const head = "m 0 0 b 60 0 100 40 100 100 b 100 160 60 200 0 200 b -60 200 -100 160 -100 100 b -100 40 -60 0 0 0";
  // Thin quads for torso, arms and legs (ASS draws filled shapes).
  const seg = (x1: number, y1: number, x2: number, y2: number, w = 9) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * w;
    const ny = (dx / len) * w;
    const r = (n: number) => Math.round(n);
    return `m ${r(x1 + nx)} ${r(y1 + ny)} l ${r(x2 + nx)} ${r(y2 + ny)} l ${r(x2 - nx)} ${r(y2 - ny)} l ${r(x1 - nx)} ${r(y1 - ny)}`;
  };
  const torso = seg(0, 200, 0, 470);
  const legs = `${seg(0, 465, -80, 690)} ${seg(0, 465, 80, 690)}`;
  let arms: string;
  switch (pose) {
    case "point":
      arms = `${seg(0, 260, -130, 370)} ${seg(0, 260, 150, 150)}`;
      break;
    case "think":
      arms = `${seg(0, 260, -130, 370)} ${seg(0, 260, 110, 300)} ${seg(110, 300, 60, 150)}`;
      break;
    case "shrug":
      arms = `${seg(0, 260, -110, 230)} ${seg(-110, 230, -150, 140)} ${seg(0, 260, 110, 230)} ${seg(110, 230, 150, 140)}`;
      break;
    default:
      arms = `${seg(0, 260, -130, 380)} ${seg(0, 260, 130, 380)}`;
  }
  return { head, body: `${torso} ${arms} ${legs}` };
}

/** ASS script for one title card at the given output size. */
export function buildCardAss(card: TemplateCard, t: Pick<ProjectTemplate, "accent">, width: number, height: number): string {
  const s = Math.min(width, height) / 1080;
  const landscape = width > height;
  const textX = landscape && card.figure !== "none" ? Math.round(width * 0.4) : Math.round(width / 2);
  const titleY = Math.round(height * (landscape ? 0.42 : card.figure === "none" ? 0.45 : 0.32));
  const titleSize = Math.round((card.title.length > 14 ? 96 : 128) * s);
  const subSize = Math.round(54 * s);
  const margin = Math.round(width * 0.08);
  const wrapW = landscape && card.figure !== "none" ? Math.round(width * 0.62) : width - 2 * margin;
  const lines = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    // Margins limit the wrap width around the \pos point.
    `Style: Title,Arial Black,${titleSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,${Math.round(6 * s)},${Math.round(4 * s)},5,${Math.round((width - wrapW) / 2)},${Math.round((width - wrapW) / 2)},0,1`,
    `Style: Sub,Arial,${subSize},${assColor(t.accent)},&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,${Math.round(3 * s)},${Math.round(2 * s)},5,${Math.round((width - wrapW) / 2)},${Math.round((width - wrapW) / 2)},0,1`,
    "Style: Fig,Arial,20,&H00FFFFFF,&H00FFFFFF,&H00FFFFFF,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    `Dialogue: 0,0:00:00.00,0:00:10.00,Title,,0,0,0,,{\\pos(${textX},${titleY})}${escapeAssText(card.title)}`,
  ];
  if (card.subtitle) {
    const subY = titleY + Math.round(titleSize * 0.85 + subSize);
    lines.push(`Dialogue: 0,0:00:00.00,0:00:10.00,Sub,,0,0,0,,{\\pos(${textX},${subY})}${escapeAssText(card.subtitle)}`);
  }
  if (card.figure !== "none") {
    const { head, body } = stickFigurePaths(card.figure);
    const figScale = Math.round((landscape ? 0.85 : 0.95) * s * 100);
    const fx = landscape ? Math.round(width * 0.8) : Math.round(width / 2);
    const fy = landscape ? Math.round(height * 0.2) : Math.round(height * 0.52);
    const common = `\\an7\\pos(${fx},${fy})\\fscx${figScale}\\fscy${figScale}`;
    lines.push(`Dialogue: 0,0:00:00.00,0:00:10.00,Fig,,0,0,0,,{${common}\\1a&HFF&\\3c&HFFFFFF&\\bord${Math.max(4, Math.round(10 * s))}\\p1}${head}{\\p0}`);
    lines.push(`Dialogue: 0,0:00:00.00,0:00:10.00,Fig,,0,0,0,,{${common}\\1c&HFFFFFF&\\bord0\\p1}${body}{\\p0}`);
  }
  return [...lines, ""].join("\n");
}

/**
 * Render one card PNG (gradient background + text + stick figure) and its
 * small JPEG thumbnail in a single FFmpeg run.
 */
export async function renderCard(card: TemplateCard, t: ProjectTemplate, width: number, height: number, outPath: string, workDir: string, thumbPath?: string) {
  fs.writeFileSync(path.join(workDir, CARD_FILE), buildCardAss(card, t, width, height), "utf8");
  const [c0, c1] = t.colors.map(hex6);
  const args = [
    "-f", "lavfi",
    "-i", `gradients=s=${width}x${height}:c0=0x${c0}:c1=0x${c1}:x0=0:y0=0:x1=${width}:y1=${height}:nb_colors=2:d=1:r=1`,
  ];
  if (thumbPath) {
    args.push(
      "-filter_complex", `[0:v]subtitles=filename=${CARD_FILE},split=2[full][t];[t]scale=360:-2[thumb]`,
      "-map", "[full]", "-frames:v", "1", "-n", `file:${outPath}`,
      "-map", "[thumb]", "-frames:v", "1", "-q:v", "4", "-n", `file:${thumbPath}`,
    );
  } else {
    args.push("-vf", `subtitles=filename=${CARD_FILE}`, "-frames:v", "1", "-n", `file:${outPath}`);
  }
  await runFfmpeg(requireTool("ffmpeg"), args, { cwd: workDir });
}

/** Create a new project from a template: rendered cards on the timeline, captions style and an example narration. */
const debugTiming = process.env.STICKFORGE_DEBUG_TIMING === "1";
function stamp(label: string, t0: number) {
  if (debugTiming) console.log(`[template] ${label} +${Date.now() - t0}ms`);
}

export async function createFromTemplate(templateId: string, input: { name?: string; parentDir?: string; aspect?: AspectId; ownerId?: string | null }): Promise<Project> {
  const t0 = Date.now();
  const t = getTemplate(templateId);
  if (!t) throw new HttpError(404, "Template not found");
  const aspect = input.aspect ?? t.aspect;
  const project = createProject({ name: input.name?.trim() || t.name, parentDir: input.parentDir, aspect, ownerId: input.ownerId });
  // Cards are rendered at 1080p for the chosen ratio; exports scale them as needed.
  const { width, height } = outputSize(aspect, "1080");
  const mediaDir = path.join(project.folder, "media");
  const work = fs.mkdtempSync(path.join(project.folder, ".thumbs", "tpl-"));
  const scenes: ReturnType<typeof sceneSchema.parse>[] = new Array(t.cards.length);
  try {
    // Render cards a few at a time (each FFmpeg run is a separate process), then add them in order.
    const files = t.cards.map((card, i) => path.join(mediaDir, `${String(i + 1).padStart(2, "0")} ${safeFileName(card.title, "card")}.png`));
    const thumbs = t.cards.map((_c, i) => path.join(project.folder, ".thumbs", `tpl-${Date.now().toString(36)}-${i}.jpg`));
    let next = 0;
    const worker = async () => {
      while (next < t.cards.length) {
        const i = next++;
        await renderCard(t.cards[i], t, width, height, files[i], fs.mkdtempSync(path.join(work, "c-")), thumbs[i]);
        stamp(`rendered card ${i + 1}`, t0);
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, t.cards.length) }, worker));
    for (let i = 0; i < t.cards.length; i++) {
      const card = t.cards[i];
      const asset = await registerGenerated(project.id, files[i], path.basename(files[i]), null, { width, height, thumbPath: thumbs[i] });
      stamp(`registered card ${i + 1}`, t0);
      scenes[i] = sceneSchema.parse({ id: `tpl${i}`, assetId: asset.id, duration: card.duration, motion: card.motion, fit: "cover" });
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }

  stamp("cards done", t0);
  const preset = VOICE_PRESETS.find((p) => p.id === t.voicePresetId) ?? VOICE_PRESETS[0];
  const def = getSettings().defaultVoice;
  const installed = listInstalledVoices().map((v) => v.key);
  const voiceKey = installed.includes(def.voiceKey) ? def.voiceKey : installed[0] ?? def.voiceKey;
  const narration = createNarration(project.id, { name: "Narration", script: t.script, settings: { ...def, ...preset.values, voiceKey } });

  const current = getProject(project.id);
  const style = captionStyleSchema.parse({ ...current.state.captions.style, ...t.caption });
  return saveProjectState(project.id, {
    ...current.state,
    scenes,
    narrationId: narration.id,
    captions: { ...current.state.captions, style },
  });
}
