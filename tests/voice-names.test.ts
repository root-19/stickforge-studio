import { describe, expect, it } from "vitest";
import { parseVoiceKey, voiceLabel, voiceName } from "@/lib/shared/voice-names";

describe("voice names", () => {
  it("shows just the speaker name", () => {
    expect(voiceName("en_US-kristin-medium")).toBe("Kristin");
    expect(voiceName("en_US-joe-medium")).toBe("Joe");
    expect(voiceName("en_GB-northern_english_male-medium")).toBe("Northern English Male");
    expect(voiceName("en_US-hfc_female-medium")).toBe("HFC Female");
    expect(voiceName("en_US-libritts_r-medium")).toBe("LibriTTS-R");
    expect(voiceName("my_narrator")).toBe("My Narrator");
  });
  it("keeps accent and quality available for labels", () => {
    expect(parseVoiceKey("en_GB-alan-low")).toEqual({ name: "Alan", region: "UK", quality: "Low" });
    expect(voiceLabel("en_US-ryan-high", { quality: true })).toBe("Ryan · High");
    expect(voiceLabel("en_US-ryan-high", { quality: true, region: true })).toBe("Ryan · US · High");
  });
});
