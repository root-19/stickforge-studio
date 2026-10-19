"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight, AudioLines, Captions, Check, Clapperboard, Download, Film, LayoutTemplate, Lock, Maximize2, Mic2, ShieldCheck, Sparkles, WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchSession, type SessionInfo } from "./auth-context";

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label="StickForge Studio">
      <span className="grid size-9 place-items-center rounded-xl bg-brand-gradient text-sm font-black text-emerald-950 shadow-lg shadow-emerald-500/25">SF</span>
      <span className="leading-tight">
        <span className="block font-semibold tracking-tight">StickForge Studio</span>
        <span className="block text-[11px] text-muted-foreground">Faceless videos, made locally</span>
      </span>
    </Link>
  );
}

function StickFigure({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 160" className={className} aria-hidden>
      <g stroke="white" strokeWidth="4.5" strokeLinecap="round" fill="none">
        <circle cx="50" cy="30" r="14" />
        <path d="M50 44 L50 105 M50 62 L28 86 M50 62 L80 38 M50 105 L32 150 M50 105 L68 150" />
      </g>
    </svg>
  );
}

/** A CSS-only mock of the editor (not a screenshot) so the page works offline. */
function EditorMock() {
  return (
    <div className="relative mx-auto w-full max-w-5xl 2xl:max-w-6xl">
      <div className="pointer-events-none absolute -inset-8 rounded-[2rem] bg-[radial-gradient(ellipse_at_center,oklch(0.8_0.19_150/25%),transparent_65%)]" />
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-card shadow-2xl shadow-black/60">
        <div className="flex items-center gap-1.5 border-b border-border px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-rose-400/70" />
          <span className="size-2.5 rounded-full bg-amber-400/70" />
          <span className="size-2.5 rounded-full bg-emerald-400/70" />
          <span className="ml-3 text-xs text-muted-foreground">The Lost Colony of Roanoke · 9:16</span>
          <span className="ml-auto rounded-md bg-brand-gradient px-2 py-0.5 text-[10px] font-semibold text-emerald-950">Export</span>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] gap-4 p-4">
          <div className="hidden space-y-2 sm:block">
            {["Narration.wav", "old map.jpg", "drone shot.mp4", "music bed.wav"].map((n, i) => (
              <div key={n} className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2 py-1.5 text-[11px] text-muted-foreground">
                {i === 0 || i === 3 ? <AudioLines className="size-3 text-emerald-300" /> : <Film className="size-3 text-teal-300" />}
                <span className="truncate">{n}</span>
              </div>
            ))}
          </div>
          <div className="relative h-64 w-36 overflow-hidden rounded-lg bg-linear-to-br from-[#06261B] to-[#118A55] ring-1 ring-white/10 sm:h-72 sm:w-40">
            <div className="absolute inset-x-0 top-10 text-center text-sm font-black text-white [text-shadow:0_2px_0_#000]">DID YOU KNOW?</div>
            <StickFigure className="absolute bottom-16 left-1/2 h-24 -translate-x-1/2" />
            <div className="absolute inset-x-2 bottom-6 text-center text-[13px] font-black leading-tight text-white [paint-order:stroke_fill] [-webkit-text-stroke:3px_#000]">
              ONE CLUE: <span className="text-[#C8FF3D]">CROATOAN</span>
            </div>
          </div>
          <div className="hidden space-y-3 text-[11px] sm:block">
            {[
              ["Voice", "Joe (male)"],
              ["Speed", "1.05×"],
              ["Captions", "Sentence-timed"],
              ["Size", "1080 × 1920"],
            ].map(([k, v]) => (
              <div key={k}>
                <div className="text-muted-foreground">{k}</div>
                <div className="font-medium">{v}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-1.5 border-t border-border bg-muted/20 p-3">
          {[
            ["bg-track-video/60", "w-[92%]"],
            ["bg-track-voice/60", "w-[86%]"],
            ["bg-track-music/50", "w-[92%]"],
          ].map(([c, w], i) => (
            <div key={i} className="h-3 rounded bg-muted/40">
              <div className={`h-3 rounded ${c} ${w}`} />
            </div>
          ))}
          <div className="flex gap-1">
            {[18, 14, 20, 12, 16, 15].map((w, i) => (
              <div key={i} className="h-3 rounded bg-track-caption/50" style={{ width: `${w}%` }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const FEATURES = [
  { icon: Mic2, title: "Free offline AI voice", text: "Piper TTS male and female narrators run on your own PC. No per-generation fees, no cloud — regenerate one paragraph at a time." },
  { icon: Clapperboard, title: "CapCut-style editor", text: "Drag scenes on a timeline, trim, split, Ken Burns zoom, blur-fill, music with auto-ducking, undo/redo and autosave." },
  { icon: Captions, title: "Automatic captions", text: "Captions timed from the generated narration, bold outlined style, keyword highlights, SRT export and burn-in." },
  { icon: LayoutTemplate, title: "Templates & free stock", text: "History and mystery templates with stick-figure title cards, plus Wikimedia Commons and Pexels search built in." },
  { icon: Maximize2, title: "Every size, up to 4K", text: "9:16 Shorts & Reels, 16:9 YouTube, 1:1 and 4:5 feed posts — exported as H.264 MP4 at 1080p, 2K or 4K." },
  { icon: ShieldCheck, title: "Private by design", text: "Your scripts, media and account stay on this computer. No telemetry. Internet only for voice downloads and stock search." },
];

const STEPS = [
  { n: 1, title: "Write the script", text: "Paste your history or mystery script, or start from a template." },
  { n: 2, title: "Generate the voice", text: "Pick a deep male or a female voice and generate narration locally." },
  { n: 3, title: "Add scenes", text: "Drop in clips, photos or stock footage; captions appear automatically." },
  { n: 4, title: "Export", text: "Render an MP4 for YouTube Shorts, Facebook Reels or YouTube." },
];

const FAQ = [
  {
    q: "Is it really free?",
    a: "Yes. StickForge runs on your computer with free, open tools (Piper TTS, FFmpeg). There are no subscriptions or per-video fees.",
  },
  {
    q: "Do I need the internet?",
    a: "Only to download a voice model once (about 60–120 MB) and when you search stock footage. Writing, narration, editing and export all work offline.",
  },
  {
    q: "Can I monetize videos made with it?",
    a: "Your own media and the StickForge templates, yes. Voices have their own licenses — the Voice Manager labels each one (for example joe and kristin are public domain/CC0). Always check the license of voices, music and stock you use.",
  },
  {
    q: "Is my account stored online?",
    a: "No. Accounts are local to this computer, so several people can share one PC with separate projects. There's no email and nothing is sent anywhere.",
  },
  {
    q: "Which video sizes can I make?",
    a: "9:16 for YouTube Shorts, Facebook Reels and TikTok, 16:9 for regular YouTube videos, plus 1:1 and 4:5 feed posts — exported at 1080p, 2K or 4K.",
  },
  {
    q: "Where are my files?",
    a: "In normal folders on your PC (Documents\\StickForge Projects by default). Original media is never modified; exports never overwrite files.",
  },
];

export function LandingPage() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchSession().then((s) => !cancelled && setSession(s), () => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  const signedIn = !!session?.user;

  const primaryCta = signedIn ? (
    <Button size="lg" className="h-12 px-6 text-base" asChild>
      <Link href="/dashboard">
        Open your studio <ArrowRight />
      </Link>
    </Button>
  ) : (
    <Button size="lg" className="h-12 px-6 text-base" asChild>
      <Link href="/register">
        Get started free <ArrowRight />
      </Link>
    </Button>
  );

  return (
    <div className="relative min-h-full overflow-x-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[720px] bg-[radial-gradient(ellipse_at_top,oklch(0.8_0.19_150/22%),transparent_60%),radial-gradient(ellipse_at_80%_20%,oklch(0.88_0.2_128/12%),transparent_45%)]" />

      <header className="relative z-10 flex w-full px-5 sm:px-8 lg:px-12 2xl:px-20 items-center gap-4 py-5">
        <Logo />
        <nav className="ml-auto hidden items-center gap-6 text-sm text-muted-foreground md:flex" aria-label="Page sections">
          <a href="#features" className="hover:text-foreground">Features</a>
          <a href="#how" className="hover:text-foreground">How it works</a>
          <a href="#faq" className="hover:text-foreground">FAQ</a>
        </nav>
        <div className="ml-auto flex items-center gap-2 md:ml-6">
          {signedIn ? (
            <Button asChild>
              <Link href="/dashboard">Dashboard</Link>
            </Button>
          ) : (
            <>
              <Button variant="ghost" asChild>
                <Link href="/login">Log in</Link>
              </Button>
              <Button asChild>
                <Link href="/register">Create account</Link>
              </Button>
            </>
          )}
        </div>
      </header>

      <main className="relative z-10">
        <section className="w-full px-5 sm:px-8 lg:px-12 2xl:px-20 pb-20 pt-10 text-center md:pt-16">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <Sparkles className="size-3.5" /> Free · Offline AI narration · No subscription
          </span>
          <h1 className="mx-auto mt-6 max-w-5xl text-4xl font-semibold leading-[1.05] tracking-tight md:text-6xl 2xl:text-7xl">
            Turn history & mystery scripts into <span className="text-brand-gradient">scroll-stopping Shorts</span>
          </h1>
          <p className="mx-auto mt-5 max-w-3xl text-lg text-muted-foreground">
            StickForge Studio voices your script with a free AI narrator, times the captions, and exports vertical videos for YouTube Shorts and
            Facebook Reels — all on your own computer.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {primaryCta}
            <Button size="lg" variant="outline" className="h-12 px-6 text-base" asChild>
              <a href="#how">See how it works</a>
            </Button>
          </div>
          <ul className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
            {["No credit card", "Male & female AI voices", "Export up to 4K"].map((t) => (
              <li key={t} className="flex items-center gap-1.5">
                <Check className="size-4 text-primary" /> {t}
              </li>
            ))}
          </ul>
          <div className="mt-14">
            <EditorMock />
          </div>
        </section>

        <section className="border-y border-border/60 bg-card/40">
          <div className="grid w-full px-5 sm:px-8 lg:px-12 2xl:px-20 grid-cols-2 gap-6 py-10 text-center md:grid-cols-4">
            {[
              ["$0", "per voice generation"],
              ["4", "video ratios"],
              ["4K", "maximum export"],
              ["100%", "on your computer"],
            ].map(([v, l]) => (
              <div key={l}>
                <div className="text-brand-gradient text-3xl font-semibold md:text-4xl">{v}</div>
                <div className="mt-1 text-sm text-muted-foreground">{l}</div>
              </div>
            ))}
          </div>
        </section>

        <section id="features" className="w-full px-5 sm:px-8 lg:px-12 2xl:px-20 scroll-mt-8 py-20">
          <h2 className="text-center text-3xl font-semibold tracking-tight">Everything a faceless channel needs</h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-muted-foreground">From script to finished Short in one place — built for educational, history and mystery stick-figure videos.</p>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:gap-6">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-2xl border border-border bg-card p-6 transition hover:border-primary/50">
                <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
                  <f.icon className="size-5" />
                </span>
                <h3 className="mt-4 font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="how" className="scroll-mt-8 border-y border-border/60 bg-card/40">
          <div className="w-full px-5 sm:px-8 lg:px-12 2xl:px-20 py-20">
            <h2 className="text-center text-3xl font-semibold tracking-tight">From idea to upload in four steps</h2>
            <ol className="mt-12 grid gap-4 md:grid-cols-4">
              {STEPS.map((s) => (
                <li key={s.n} className="relative rounded-2xl border border-border bg-background p-6">
                  <span className="grid size-9 place-items-center rounded-full bg-brand-gradient text-sm font-bold text-emerald-950">{s.n}</span>
                  <h3 className="mt-4 font-semibold">{s.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="w-full px-5 sm:px-8 lg:px-12 2xl:px-20 py-20">
          <div className="grid items-center gap-10 md:grid-cols-2 2xl:gap-20">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">Private, offline, yours</h2>
              <p className="mt-3 text-muted-foreground">
                StickForge runs only on this computer and refuses requests from other websites. There is no cloud account, no tracking, and nothing
                to cancel.
              </p>
              <ul className="mt-6 space-y-3 text-sm">
                {[
                  [WifiOff, "Narration, editing and export work without internet"],
                  [Lock, "Local accounts — passwords hashed, sessions in a secure cookie"],
                  [Download, "Your originals are never modified; exports never overwrite files"],
                ].map(([Icon, t]) => {
                  const I = Icon as typeof WifiOff;
                  return (
                    <li key={t as string} className="flex items-start gap-3">
                      <I className="mt-0.5 size-4 shrink-0 text-primary" /> <span>{t as string}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="rounded-2xl border border-border bg-card p-6 font-mono text-xs leading-relaxed text-muted-foreground">
              <div className="text-foreground">Voice Studio · Joe</div>
              <div className="mt-3">✓ Paragraph 1 · 5.7 s</div>
              <div>✓ Paragraph 2 · 6.5 s</div>
              <div>✓ Paragraph 3 · 2.7 s</div>
              <div className="mt-3 text-primary">Full narration ready · 15.9 s · 5 timed sentences</div>
              <div className="mt-3">Export · YouTube Shorts · 1080×1920 · H.264 + AAC</div>
              <div className="text-primary">✓ Saved to Documents\StickForge Projects\…\exports</div>
            </div>
          </div>
        </section>

        <section id="faq" className="scroll-mt-8 border-t border-border/60 bg-card/40">
          <div className="w-full px-5 sm:px-8 lg:px-12 2xl:px-20 py-20">
            <h2 className="text-center text-3xl font-semibold tracking-tight">Questions</h2>
            <div className="mt-10 grid items-start gap-3 md:grid-cols-2">
              {FAQ.map((f) => (
                <details key={f.q} className="group rounded-xl border border-border bg-background p-5 open:border-primary/40">
                  <summary className="flex cursor-pointer list-none items-center justify-between font-medium">
                    {f.q}
                    <span className="text-muted-foreground transition group-open:rotate-45">+</span>
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="w-full px-5 sm:px-8 lg:px-12 2xl:px-20 py-20">
          <div className="relative overflow-hidden rounded-3xl border border-primary/30 bg-card p-10 text-center md:p-14">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,oklch(0.8_0.19_150/18%),transparent_70%)]" />
            <h2 className="relative text-3xl font-semibold tracking-tight md:text-4xl">Your next Short is one script away</h2>
            <p className="relative mx-auto mt-3 max-w-xl text-muted-foreground">Create a free local account and start with a template in under a minute.</p>
            <div className="relative mt-8 flex justify-center">{primaryCta}</div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/60">
        <div className="flex w-full px-5 sm:px-8 lg:px-12 2xl:px-20 flex-wrap items-center gap-4 py-8 text-sm text-muted-foreground">
          <Logo />
          <span className="ml-auto">Runs locally on Windows · Piper TTS · FFmpeg · Next.js</span>
        </div>
      </footer>
    </div>
  );
}
