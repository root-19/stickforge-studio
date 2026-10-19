import { describe, expect, it } from "vitest";
import { assColor, assTime, buildAss, captionLayout, escapeAssText } from "@/lib/server/ffmpeg/ass";
import { captionStyleSchema } from "@/lib/shared/types";

describe("ASS helpers", () => {
  it("converts colors to &HAABBGGRR", () => {
    expect(assColor("#FFD400")).toBe("&H0000D4FF");
    expect(assColor("#000000", 0x80)).toBe("&H80000000");
  });
  it("formats centisecond times", () => {
    expect(assTime(0)).toBe("0:00:00.00");
    expect(assTime(3661.237)).toBe("1:01:01.24");
  });
  it("neutralizes override braces and backslashes", () => {
    expect(escapeAssText("a{\\b1}b\nc")).toBe("a(∖b1)b\\Nc");
  });
});

describe("buildAss", () => {
  const style = captionStyleSchema.parse({ keywords: ["tomb"], uppercase: true });
  const ass = buildAss(
    [
      { id: "1", start: 0, end: 1.5, text: "The tomb opened in 1922" },
      { id: "2", start: 1.5, end: 3, text: "{evil}" },
    ],
    style,
    1080,
    1920,
  );
  it("declares the canvas resolution and centred style with safe margins", () => {
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toContain("PlayResY: 1920");
    const L = captionLayout(style, 1080, 1920);
    expect(ass).toMatch(new RegExp(`Style: Default,Arial Black,${L.fontSize},`));
    expect(ass).toContain(`,5,${L.marginX},${L.marginX},0,1`);
  });
  it("positions each line and highlights keywords and numbers", () => {
    expect(ass).toContain(`{\\pos(540,${Math.round(0.62 * 1920)})}THE {\\c&H0000D4FF&}TOMB{\\c&H00FFFFFF&} OPENED IN {\\c&H0000D4FF&}1922{\\c&H00FFFFFF&}`);
  });
  it("escapes user text", () => {
    expect(ass).toContain("(EVIL)");
    expect(ass).not.toContain("{EVIL}");
  });
  it("scales font size with canvas height", () => {
    expect(captionLayout(style, 720, 1280).fontSize).toBe(Math.round(84 * (1280 / 1920)));
  });
});
