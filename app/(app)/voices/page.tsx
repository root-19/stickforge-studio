import type { Metadata } from "next";
import { VoiceManager } from "@/components/voice-manager";

export const metadata: Metadata = { title: "Voice Manager" };

export default function Page() {
  return <VoiceManager />;
}
