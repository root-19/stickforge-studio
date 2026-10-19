"use client";

import { tokenizeCaption } from "@/lib/shared/captions";
import type { Caption, CaptionStyle } from "@/lib/shared/types";

/**
 * CSS rendering of a caption that mirrors the ASS style used for burn-in:
 * same font, size (scaled from a 1080 px short side), centre position,
 * horizontal safe margins, outline or box, and keyword colours.
 */
export function CaptionOverlay({ caption, style, width, height }: { caption: Caption | null; style: CaptionStyle; width: number; height: number }) {
  if (!caption) return null;
  const scale = Math.min(width, height) / 1080;
  const fontSize = style.fontSize * scale;
  const outline = style.outlineWidth * scale;
  const tokens = tokenizeCaption(caption.text, style);
  const box = style.background === "box";
  return (
    <div
      className="pointer-events-none absolute left-1/2 -translate-x-1/2 -translate-y-1/2 text-center"
      style={{ top: `${style.positionY * 100}%`, width: `${(1 - 2 * style.marginX) * 100}%` }}
      aria-live="off"
    >
      <span
        className={box ? "" : "caption-outline"}
        style={{
          fontFamily: `"${style.font}", Arial, sans-serif`,
          fontWeight: 900,
          fontSize,
          lineHeight: 1.18,
          color: style.textColor,
          WebkitTextStrokeWidth: box ? 0 : outline * 2,
          textShadow: box ? undefined : `0 ${fontSize * 0.04}px ${fontSize * 0.06}px rgba(0,0,0,.6)`,
          background: box ? "rgba(0,0,0,0.67)" : undefined,
          padding: box ? `${fontSize * 0.08}px ${fontSize * 0.22}px` : undefined,
          borderRadius: box ? fontSize * 0.12 : undefined,
          boxDecorationBreak: "clone",
          WebkitBoxDecorationBreak: "clone",
          wordBreak: "break-word",
        }}
      >
        {tokens.map((t, i) => (
          <span key={i} style={t.highlight ? { color: style.highlightColor } : undefined}>
            {t.text}
          </span>
        ))}
      </span>
    </div>
  );
}
