import type { Caption, CaptionStyle } from "@/lib/shared/types";
import { sortAndValidateCaptions, tokenizeCaption } from "@/lib/shared/captions";

/** "#RRGGBB" → ASS "&HAABBGGRR" (alpha 00 = opaque). */
export function assColor(hex: string, alpha = 0): string {
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) throw new Error(`Invalid color ${hex}`);
  const a = alpha.toString(16).padStart(2, "0");
  return `&H${a}${m[3]}${m[2]}${m[1]}`.toUpperCase();
}

export function assTime(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

/** Neutralize ASS override syntax in user text. */
export function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, "∖")
    .replace(/\{/g, "(")
    .replace(/\}/g, ")")
    .replace(/\r?\n/g, "\\N");
}

export function captionLayout(style: CaptionStyle, width: number, height: number) {
  // Sizes are defined for a 1080 px short side, so captions look the same in every ratio.
  const scale = Math.min(width, height) / 1080;
  return {
    fontSize: Math.round(style.fontSize * scale),
    outline: Math.max(0, Math.round(style.outlineWidth * scale * 10) / 10),
    marginX: Math.round(style.marginX * width),
    x: Math.round(width / 2),
    y: Math.round(style.positionY * height),
  };
}

export function buildAss(captions: Caption[], style: CaptionStyle, width: number, height: number): string {
  const L = captionLayout(style, width, height);
  const primary = assColor(style.textColor);
  const highlight = assColor(style.highlightColor);
  const box = style.background === "box";
  // BorderStyle 1 = outline + shadow; 3 = opaque box (box colour comes from OutlineColour).
  const outlineColour = box ? assColor("#000000", 0x55) : assColor("#000000");
  const backColour = assColor("#000000", box ? 0xff : 0x80);
  const borderStyle = box ? 3 : 1;
  const outline = box ? Math.max(8, Math.round(L.fontSize * 0.22)) : L.outline;
  const shadow = box ? 0 : Math.round(L.fontSize * 0.04);

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "YCbCr Matrix: TV.709",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${style.font},${L.fontSize},${primary},${primary},${outlineColour},${backColour},-1,0,0,0,100,100,0,0,${borderStyle},${outline},${shadow},5,${L.marginX},${L.marginX},0,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const events = sortAndValidateCaptions(captions).map((c) => {
    const body = tokenizeCaption(c.text, style)
      .map((t) => {
        const txt = escapeAssText(t.text);
        return t.highlight ? `{\\c${highlight}&}${txt}{\\c${primary}&}` : txt;
      })
      .join("");
    return `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,{\\pos(${L.x},${L.y})}${body}`;
  });
  return [...header, ...events, ""].join("\n");
}
