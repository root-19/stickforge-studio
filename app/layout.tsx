import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "StickForge Studio", template: "%s · StickForge Studio" },
  description: "Local-first video editor for YouTube Shorts, Facebook Reels and YouTube videos with free offline AI narration.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`dark ${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}>
      <body className="h-full overflow-hidden bg-background text-foreground">
        <TooltipProvider delayDuration={300}>
          {children}
          <Toaster theme="dark" position="bottom-right" richColors closeButton />
        </TooltipProvider>
      </body>
    </html>
  );
}
