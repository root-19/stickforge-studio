import { Suspense } from "react";
import type { Metadata } from "next";
import { VoiceStudio } from "@/components/voice-studio";
import { LoadingBlock } from "@/components/common";

export const metadata: Metadata = { title: "AI Voice Studio" };

export default function Page() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <VoiceStudio />
    </Suspense>
  );
}
