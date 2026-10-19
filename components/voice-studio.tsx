"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle, AudioLines, CheckCircle2, Clapperboard, Info, Loader2, Mic, Mic2, Pause, Play, Plus, RefreshCw, Save, Sparkles, Square, Undo2, Wand2, X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useApi, useDebouncedCallback } from "@/lib/client/hooks";
import { api, errorText, waitForJob } from "@/lib/client/api";
import { cleanupScript, countCharacters, countWords, estimateDurationSeconds, splitParagraphs, splitSentences, type CleanupChange } from "@/lib/shared/script";
import { VOICE_PRESETS } from "@/lib/shared/narration";
import { formatDuration } from "@/lib/shared/timeline";
import type { InstalledVoice, JobInfo, Narration, NarrationSegment, ProjectSummary, SentenceTiming, VoiceSettings } from "@/lib/shared/types";
import type { Settings as AppSettings } from "@/lib/server/settings";
import { EmptyState, ErrorBlock, LicenseBadge, LoadingBlock, PageBody } from "./common";
import { parseVoiceKey, voiceName } from "@/lib/shared/voice-names";
import { NewProjectDialog } from "./project-dialogs";
import { VoiceRecorder } from "./voice-recorder";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const EXAMPLE_SCRIPT = `In 1587, more than one hundred English settlers landed on Roanoke Island.

Three years later, they had vanished. The only clue? A single word carved into a wooden post: CROATOAN.

To this day, nobody knows for sure what happened to the Lost Colony.`;

function SliderRow({
  label,
  hint,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const id = `s-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <Label htmlFor={id} className="flex items-center gap-1.5">
          {label}
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="size-3.5 text-muted-foreground" aria-label={`About ${label}`} />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">{hint}</TooltipContent>
          </Tooltip>
        </Label>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">{format(value)}</span>
      </div>
      <Slider id={id} value={[value]} min={min} max={max} step={step} onValueChange={(v) => onChange(v[0])} aria-label={label} />
    </div>
  );
}

const STATUS: Record<NarrationSegment["status"], { label: string; className: string }> = {
  ready: { label: "Ready", className: "border-emerald-500/40 text-emerald-300" },
  pending: { label: "Needs audio", className: "border-zinc-500/40 text-zinc-300" },
  stale: { label: "Outdated", className: "border-amber-500/40 text-amber-300" },
  error: { label: "Error", className: "border-rose-500/40 text-rose-300" },
};

export function VoiceStudio() {
  const router = useRouter();
  const params = useSearchParams();
  const projectId = params.get("project");
  const narrationParam = params.get("narration");

  const projects = useApi<ProjectSummary[]>("/api/projects");
  const voices = useApi<{ installed: InstalledVoice[] }>("/api/voices");
  const settings = useApi<AppSettings>("/api/settings");
  const narrations = useApi<Narration[]>(projectId ? `/api/narrations?projectId=${projectId}` : null);

  const [narration, setNarration] = useState<Narration | null>(null);
  const [timings, setTimings] = useState<SentenceTiming[]>([]);
  const [script, setScript] = useState("");
  const [voice, setVoice] = useState<VoiceSettings | null>(null);
  const [job, setJob] = useState<JobInfo | null>(null);
  const [newProject, setNewProject] = useState(false);
  const [cleanup, setCleanup] = useState<{ text: string; changes: CleanupChange[]; title: string } | null>(null);
  const [undoScript, setUndoScript] = useState<string | null>(null);
  const [useDialog, setUseDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [playingSeg, setPlayingSeg] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [mode, setMode] = useState<"ai" | "record">("ai");
  const segAudio = useRef<HTMLAudioElement | null>(null);
  const previewAudio = useRef<HTMLAudioElement | null>(null);
  const creating = useRef(false);

  const installed = voices.data?.installed ?? [];
  const reloadNarrations = narrations.reload;
  const activeId = narration?.id ?? null;

  const loadNarration = useCallback(async (id: string) => {
    const r = await api<{ narration: Narration; timings: SentenceTiming[] }>(`/api/narrations/${id}`);
    setNarration(r.narration);
    setTimings(r.timings);
    return r.narration;
  }, []);

  // Pick (or create) the narration for this project.
  useEffect(() => {
    if (!projectId || !narrations.data || !voices.data || !settings.data) return;
    const list = narrations.data;
    const wanted = list.find((n) => n.id === narrationParam) ?? list[0];
    if (wanted) {
      if (wanted.id === activeId) return;
      let cancelled = false;
      api<{ narration: Narration; timings: SentenceTiming[] }>(`/api/narrations/${wanted.id}`).then(
        (r) => {
          if (cancelled) return;
          setNarration(r.narration);
          setTimings(r.timings);
          setScript(r.narration.script);
          setVoice(r.narration.settings);
        },
        (e) => !cancelled && toast.error(errorText(e)),
      );
      return () => {
        cancelled = true;
      };
    }
    if (creating.current) return;
    creating.current = true;
    const def = settings.data.defaultVoice;
    const keys = voices.data.installed.map((v) => v.key);
    const voiceKey = keys.includes(def.voiceKey) ? def.voiceKey : keys[0] ?? def.voiceKey;
    void api<Narration>("/api/narrations", {
      method: "POST",
      json: { projectId, name: "Narration", script: "", settings: { ...def, voiceKey } },
    })
      .then((n) => {
        setNarration(n);
        setScript(n.script);
        setVoice(n.settings);
        void reloadNarrations();
      })
      .catch((e) => toast.error(errorText(e)))
      .finally(() => (creating.current = false));
  }, [projectId, narrationParam, narrations.data, voices.data, settings.data, activeId, reloadNarrations]);

  const { call: persist, flush: flushPersist } = useDebouncedCallback(async (id: string, patch: { script?: string; settings?: VoiceSettings }) => {
    try {
      const n = await api<Narration>(`/api/narrations/${id}`, { method: "PATCH", json: patch });
      setNarration((cur) => (cur && cur.id === id ? n : cur));
    } catch (e) {
      toast.error(`Could not save: ${errorText(e)}`);
    }
  }, 600);

  const updateScript = (text: string) => {
    setScript(text);
    if (narration) persist(narration.id, { script: text, settings: voice ?? undefined });
  };
  const updateVoice = (patch: Partial<VoiceSettings>) => {
    if (!voice) return;
    const next = { ...voice, ...patch };
    setVoice(next);
    if (narration) persist(narration.id, { script, settings: next });
  };

  const applyEdit = (text: string) => {
    setUndoScript(script);
    updateScript(text);
    setCleanup(null);
  };

  const stats = useMemo(
    () => ({
      words: countWords(script),
      chars: countCharacters(script),
      paragraphs: splitParagraphs(script).length,
      sentences: splitParagraphs(script).reduce((n, p) => n + splitSentences(p).length, 0),
      estimate: estimateDurationSeconds(script, voice?.speed ?? 1, voice?.sentencePause ?? 0.25, voice?.paragraphPause ?? 0.5),
    }),
    [script, voice],
  );

  const segments = narration?.segments ?? [];
  const needAudio = segments.filter((s) => s.status !== "ready");
  const running = job?.status === "running" || job?.status === "queued";
  const selectedVoice = installed.find((v) => v.key === voice?.voiceKey) ?? null;

  const generate = async (segmentIds?: string[]) => {
    if (!narration) return;
    flushPersist();
    await new Promise((r) => setTimeout(r, 50));
    try {
      const j = await api<JobInfo>(`/api/narrations/${narration.id}/generate`, { method: "POST", json: { segmentIds } });
      setJob(j);
      const poll = setInterval(() => void loadNarration(narration.id).catch(() => undefined), 1500);
      const final = await waitForJob(j.id, setJob).finally(() => clearInterval(poll));
      await loadNarration(narration.id);
      if (final.status === "done") toast.success(segmentIds ? "Paragraph regenerated" : "Narration ready");
      else if (final.status === "cancelled") toast.message("Generation cancelled");
      else toast.error(final.error ?? "Generation failed");
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setJob(null);
    }
  };

  const playSegment = (seg: NarrationSegment) => {
    if (!narration) return;
    segAudio.current?.pause();
    if (playingSeg === seg.id) {
      setPlayingSeg(null);
      return;
    }
    const a = new Audio(`/api/narrations/${narration.id}/audio?segment=${seg.id}&v=${seg.audioHash}`);
    segAudio.current = a;
    a.onended = () => setPlayingSeg(null);
    void a.play().then(() => setPlayingSeg(seg.id)).catch((e) => toast.error(errorText(e)));
  };

  const previewVoice = async () => {
    if (!voice) return;
    previewAudio.current?.pause();
    if (previewing) {
      setPreviewing(false);
      return;
    }
    const first = splitSentences(splitParagraphs(script)[0] ?? "").slice(0, 2).join(" ");
    const text = (first || "This is how your narration will sound. Let's uncover a mystery from history.").slice(0, 590);
    setPreviewing(true);
    try {
      const blob = await api<Blob>("/api/tts/preview", { method: "POST", json: { ...voice, text } });
      const url = URL.createObjectURL(blob);
      const a = new Audio(url);
      previewAudio.current = a;
      a.onended = () => {
        setPreviewing(false);
        URL.revokeObjectURL(url);
      };
      await a.play();
    } catch (e) {
      setPreviewing(false);
      toast.error(errorText(e));
    }
  };

  const saveAudio = async (opts: { mp3: boolean; useInProject: boolean; buildCaptions?: boolean; fitScenes?: boolean }) => {
    if (!narration) return;
    setSaving(true);
    try {
      const r = await api<{ wavPath: string; mp3Path: string | null; mp3Error: string | null }>(`/api/narrations/${narration.id}/save-audio`, {
        method: "POST",
        json: { ...opts, fileName: narration.name },
      });
      toast.success(`Saved ${r.wavPath.split(/[\\/]/).pop()}${r.mp3Path ? " and MP3" : ""}`, { description: r.wavPath });
      if (r.mp3Error) toast.warning(r.mp3Error);
      if (opts.useInProject) router.push(`/editor/${narration.projectId}`);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setSaving(false);
      setUseDialog(false);
    }
  };

  // --- Render -------------------------------------------------------------

  if (!projectId) {
    return (
      <PageBody>
        <div className="mx-auto max-w-4xl px-8 py-10">
          <h1 className="text-2xl font-semibold tracking-tight">AI Voice Studio</h1>
          <p className="mt-1 text-muted-foreground">Narration belongs to a project so it can go straight into the video editor. Pick one:</p>
          {projects.loading && <LoadingBlock />}
          {projects.error && <ErrorBlock message={projects.error} onRetry={projects.reload} />}
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <button onClick={() => setNewProject(true)} className="flex items-center gap-3 rounded-xl border border-dashed border-primary/50 p-4 text-left hover:bg-primary/5">
              <Plus className="size-5 text-primary" />
              <span>
                <span className="block font-medium">New project</span>
                <span className="text-sm text-muted-foreground">Start with a script</span>
              </span>
            </button>
            {projects.data?.map((p) => (
              <Link key={p.id} href={`/voice?project=${p.id}`} className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 hover:border-primary/50">
                <Mic2 className="size-5 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="text-sm text-muted-foreground">Updated {new Date(p.updatedAt).toLocaleString()}</span>
                </span>
              </Link>
            ))}
          </div>
        </div>
        <NewProjectDialog open={newProject} onOpenChange={setNewProject} defaultParent={settings.data?.projectsDir} then="voice" />
      </PageBody>
    );
  }

  const project = projects.data?.find((p) => p.id === projectId);
  const loadingAll = !narration || !voice || !voices.data;

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-border/60 px-6 py-3">
        <Mic2 className="size-5 text-primary" />
        <div className="min-w-0">
          <h1 className="text-base font-semibold leading-tight">AI Voice Studio</h1>
          <p className="truncate text-xs text-muted-foreground">{project?.name ?? "Project"} · Piper TTS runs on this computer</p>
        </div>
        <ToggleGroup
          type="single"
          variant="outline"
          value={mode}
          onValueChange={(v) => v && setMode(v as "ai" | "record")}
          className="ml-4"
          aria-label="Narration source"
        >
          <ToggleGroupItem value="ai" className="px-3">
            <Sparkles /> AI voice
          </ToggleGroupItem>
          <ToggleGroupItem value="record" className="px-3">
            <Mic /> Record my voice
          </ToggleGroupItem>
        </ToggleGroup>
        <div className="ml-auto flex items-center gap-2">
          {narrations.data && narrations.data.length > 1 && (
            <Select value={narration?.id} onValueChange={(id) => router.replace(`/voice?project=${projectId}&narration=${id}`)}>
              <SelectTrigger className="w-48" aria-label="Narration">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {narrations.data.map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    {n.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button variant="outline" asChild>
            <Link href={`/editor/${projectId}`}>
              <Clapperboard /> Open editor
            </Link>
          </Button>
        </div>
      </header>

      {/* Kept mounted (just hidden) so takes and results survive switching tabs. */}
      <div className={cn("min-h-0 flex-1 flex-col", mode === "record" ? "flex" : "hidden")}>
        <VoiceRecorder
          projectId={projectId}
          script={script}
          onUseVoice={async (key) => {
            await voices.reload();
            updateVoice({ voiceKey: key, speakerId: 0 });
            setMode("ai");
          }}
        />
      </div>
      {mode === "record" ? null : voices.data && installed.length === 0 ? (
        <div className="p-8">
          <EmptyState
            icon={AudioLines}
            title="No voice installed"
            action={
              <Button asChild>
                <Link href="/voices">
                  <Wand2 /> Install a voice
                </Link>
              </Button>
            }
          >
            Install a free Piper voice (male or female) in the Voice Manager. It downloads once and then works offline.
          </EmptyState>
        </div>
      ) : loadingAll ? (
        <LoadingBlock />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_380px]">
          {/* Script + paragraphs */}
          <div className="scrollbar-thin min-h-0 overflow-y-auto p-6">
            <div className="rounded-xl border border-border bg-card">
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
                <Label htmlFor="script" className="font-medium">
                  Narration script
                </Label>
                <span className="text-xs text-muted-foreground">Blank lines separate paragraphs. Each paragraph can be regenerated on its own.</span>
                <div className="ml-auto flex gap-1">
                  {undoScript !== null && (
                    <Button size="sm" variant="ghost" onClick={() => { updateScript(undoScript); setUndoScript(null); }}>
                      <Undo2 /> Undo edit
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" disabled={!script.trim()} onClick={() => setCleanup({ ...cleanupScript(script), title: "Clean up punctuation & spacing" })}>
                    <Sparkles /> Clean up
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!script.trim()}
                    onClick={() => {
                      const text = splitParagraphs(script).flatMap(splitSentences).join("\n\n");
                      setCleanup({ text, changes: [{ rule: "Put every sentence in its own paragraph", count: stats.sentences }], title: "Split into sentences" });
                    }}
                  >
                    Split sentences
                  </Button>
                  {!script.trim() && (
                    <Button size="sm" variant="ghost" onClick={() => updateScript(EXAMPLE_SCRIPT)}>
                      Insert example
                    </Button>
                  )}
                </div>
              </div>
              <Textarea
                id="script"
                value={script}
                onChange={(e) => updateScript(e.target.value)}
                placeholder="Paste or type your narration here…"
                className="min-h-64 resize-y rounded-none border-0 bg-transparent px-4 py-3 text-[15px] leading-relaxed shadow-none focus-visible:ring-0"
                spellCheck
              />
              <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-border px-4 py-2 text-xs text-muted-foreground">
                <span><b className="text-foreground tabular-nums">{stats.words}</b> words</span>
                <span><b className="text-foreground tabular-nums">{stats.chars}</b> characters</span>
                <span><b className="text-foreground tabular-nums">{stats.paragraphs}</b> paragraphs · {stats.sentences} sentences</span>
                <span>
                  Estimated length <b className="text-foreground">{formatDuration(stats.estimate)}</b>
                  {stats.estimate > 60 && <span className="text-amber-400"> · over 60 s</span>}
                </span>
                {narration?.duration ? <span>Generated: <b className="text-foreground">{formatDuration(narration.duration)}</b></span> : null}
              </div>
            </div>

            <div className="mt-6">
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <h2 className="font-semibold">Paragraphs</h2>
                <span className="text-sm text-muted-foreground">
                  {segments.length - needAudio.length}/{segments.length} ready
                </span>
                <div className="ml-auto flex items-center gap-2">
                  {running ? (
                    <Button variant="outline" onClick={() => job && api(`/api/jobs/${job.id}`, { method: "DELETE" })}>
                      <X /> Cancel
                    </Button>
                  ) : (
                    <Button onClick={() => void generate()} disabled={!selectedVoice || needAudio.length === 0}>
                      <AudioLines /> {needAudio.length ? `Generate ${needAudio.length} paragraph${needAudio.length === 1 ? "" : "s"}` : "All paragraphs ready"}
                    </Button>
                  )}
                </div>
              </div>
              {running && job && (
                <div className="mb-3 rounded-lg border border-primary/30 bg-primary/5 p-3" role="status" aria-live="polite">
                  <div className="mb-2 flex justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <Loader2 className="size-4 animate-spin" /> {job.message}
                    </span>
                    <span className="tabular-nums">{Math.round(job.progress * 100)}%</span>
                  </div>
                  <Progress value={job.progress * 100} className="h-1.5" />
                </div>
              )}
              {!selectedVoice && (
                <div className="mb-3">
                  <ErrorBlock message={`The selected voice "${voiceName(voice?.voiceKey ?? "")}" is not installed. Choose another voice on the right or install it in the Voice Manager.`} />
                </div>
              )}
              {segments.length === 0 ? (
                <EmptyState icon={Mic2} title="No paragraphs yet">Write or paste a script above.</EmptyState>
              ) : (
                <ol className="space-y-2">
                  {segments.map((seg, i) => (
                    <li key={seg.id} className="flex items-start gap-3 rounded-lg border border-border bg-card/60 p-3">
                      <span className="mt-0.5 w-6 shrink-0 text-right font-mono text-xs text-muted-foreground">{i + 1}</span>
                      <p className="line-clamp-3 min-w-0 flex-1 text-sm">{seg.text}</p>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Badge variant="outline" className={STATUS[seg.status].className} title={seg.error}>
                          {seg.status === "error" && <AlertTriangle className="size-3" />}
                          {STATUS[seg.status].label}
                        </Badge>
                        <span className="w-12 text-right font-mono text-xs tabular-nums text-muted-foreground">{seg.duration ? formatDuration(seg.duration) : ""}</span>
                        <Button size="icon-sm" variant="ghost" disabled={!seg.audioHash} onClick={() => playSegment(seg)} aria-label={`Play paragraph ${i + 1}`}>
                          {playingSeg === seg.id ? <Pause /> : <Play />}
                        </Button>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button size="icon-sm" variant="ghost" disabled={running || !selectedVoice} onClick={() => void generate([seg.id])} aria-label={`Regenerate paragraph ${i + 1}`}>
                              <RefreshCw />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Regenerate only this paragraph</TooltipContent>
                        </Tooltip>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            {narration?.combinedHash && (
              <div className="mt-6 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <CheckCircle2 className="size-4 text-emerald-400" /> Full narration · {formatDuration(narration.duration)} · {timings.length} timed sentences
                </div>
                <audio controls className="w-full" src={`/api/narrations/${narration.id}/audio?v=${narration.combinedHash}`} aria-label="Full narration" />
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button onClick={() => setUseDialog(true)} disabled={saving}>
                    <Clapperboard /> Use in video editor
                  </Button>
                  <Button variant="outline" disabled={saving} onClick={() => void saveAudio({ mp3: false, useInProject: false })}>
                    <Save /> Save WAV
                  </Button>
                  <Button variant="outline" disabled={saving} onClick={() => void saveAudio({ mp3: true, useInProject: false })}>
                    <Save /> Save WAV + MP3
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">Files are saved to the project&apos;s “audio” folder and added to its media.</p>
              </div>
            )}
          </div>

          {/* Voice settings */}
          <aside className="scrollbar-thin min-h-0 overflow-y-auto border-l border-border/60 bg-card/30 p-5">
            <h2 className="mb-4 font-semibold">Voice</h2>
            <div className="space-y-5">
              <div className="space-y-2">
                <Label>Voice model</Label>
                <Select value={voice!.voiceKey} onValueChange={(k) => updateVoice({ voiceKey: k, speakerId: 0 })}>
                  <SelectTrigger className="w-full" aria-label="Voice model">
                    <SelectValue placeholder="Choose a voice" />
                  </SelectTrigger>
                  <SelectContent>
                    {(["male", "female", "mixed", "neutral", "unknown"] as const).map((g) => {
                      const list = installed.filter((v) => (v.catalog?.gender ?? "unknown") === g);
                      if (!list.length) return null;
                      return (
                        <SelectGroup key={g}>
                          <SelectLabel className="capitalize">{g === "mixed" ? "Multi-speaker" : g === "unknown" ? "Other" : g}</SelectLabel>
                          {list.map((v) => (
                            <SelectItem key={v.key} value={v.key} title={v.key}>
                              {voiceName(v.key)}
                              <span className="text-xs text-muted-foreground">
                                {[parseVoiceKey(v.key).region, parseVoiceKey(v.key).quality].filter(Boolean).join(" · ")}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      );
                    })}
                    {!selectedVoice && <SelectItem value={voice!.voiceKey}>{voiceName(voice!.voiceKey)} (not installed)</SelectItem>}
                  </SelectContent>
                </Select>
                {selectedVoice?.catalog && (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <LicenseBadge use={selectedVoice.catalog.commercialUse} /> {selectedVoice.catalog.license}
                  </div>
                )}
                <Link href="/voices" className="text-xs text-primary underline-offset-2 hover:underline">
                  Install more male &amp; female voices →
                </Link>
              </div>

              {selectedVoice && selectedVoice.numSpeakers > 1 && (
                <div className="space-y-2">
                  <Label htmlFor="speaker">Speaker</Label>
                  {selectedVoice.speakers.length > 0 ? (
                    <Select value={String(voice!.speakerId)} onValueChange={(v) => updateVoice({ speakerId: Number(v) })}>
                      <SelectTrigger id="speaker" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {selectedVoice.speakers.map((s) => (
                          <SelectItem key={s.id} value={String(s.id)}>
                            {s.name} (#{s.id})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      id="speaker"
                      type="number"
                      min={0}
                      max={selectedVoice.numSpeakers - 1}
                      value={voice!.speakerId}
                      onChange={(e) => updateVoice({ speakerId: Math.max(0, Math.min(selectedVoice.numSpeakers - 1, Number(e.target.value) || 0)) })}
                    />
                  )}
                  <p className="text-xs text-muted-foreground">{selectedVoice.numSpeakers} speakers in this model — preview to find one you like.</p>
                </div>
              )}

              <Button variant="secondary" className="w-full" onClick={() => void previewVoice()} disabled={!selectedVoice}>
                {previewing ? <Square /> : <Play />} {previewing ? "Stop preview" : "Preview voice (first lines)"}
              </Button>

              <div className="space-y-2">
                <Label>Preset</Label>
                <Select
                  value={VOICE_PRESETS.find((p) => Object.entries(p.values).every(([k, v]) => voice![k as keyof VoiceSettings] === v))?.id ?? "custom"}
                  onValueChange={(id) => {
                    const p = VOICE_PRESETS.find((x) => x.id === id);
                    if (p) updateVoice(p.values);
                  }}
                >
                  <SelectTrigger className="w-full" aria-label="Preset">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VOICE_PRESETS.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.label}
                      </SelectItem>
                    ))}
                    <SelectItem value="custom" disabled>
                      Custom
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Presets just set the real engine values below.</p>
              </div>

              <SliderRow
                label="Speed"
                hint="Real Piper setting (length_scale = 1 / speed). 1.05× is a lively documentary pace."
                value={voice!.speed}
                min={0.5}
                max={2}
                step={0.01}
                format={(v) => `${v.toFixed(2)}×`}
                onChange={(v) => updateVoice({ speed: v })}
              />
              <SliderRow
                label="Intonation variation"
                hint="Real Piper setting (noise_scale). Higher = more pitch variation, too high can sound unstable. It does not add emotion."
                value={voice!.noiseScale}
                min={0}
                max={1.2}
                step={0.01}
                format={(v) => v.toFixed(2)}
                onChange={(v) => updateVoice({ noiseScale: v })}
              />
              <SliderRow
                label="Rhythm variation"
                hint="Real Piper setting (noise_w): variation in how long sounds are held."
                value={voice!.noiseW}
                min={0}
                max={1.2}
                step={0.01}
                format={(v) => v.toFixed(2)}
                onChange={(v) => updateVoice({ noiseW: v })}
              />
              <SliderRow
                label="Pause after sentences"
                hint="Silence StickForge inserts between sentences."
                value={voice!.sentencePause}
                min={0}
                max={1.5}
                step={0.05}
                format={(v) => `${v.toFixed(2)} s`}
                onChange={(v) => updateVoice({ sentencePause: v })}
              />
              <SliderRow
                label="Pause between paragraphs"
                hint="Silence inserted between paragraphs when the full narration is combined."
                value={voice!.paragraphPause}
                min={0}
                max={3}
                step={0.05}
                format={(v) => `${v.toFixed(2)} s`}
                onChange={(v) => updateVoice({ paragraphPause: v })}
              />
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
                <b className="text-foreground">What Piper can and can&apos;t do:</b> it reads in the voice it was trained on. Speed, variation and
                pauses are real engine controls; it can&apos;t act out emotions or change accent. For an energetic read, write short punchy sentences,
                use question marks and exclamation points, and keep speed around 1.05–1.15×.
              </div>
            </div>
          </aside>
        </div>
      )}

      <Dialog open={!!cleanup} onOpenChange={(o) => !o && setCleanup(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{cleanup?.title}</DialogTitle>
            <DialogDescription>Review the proposed text. Your script only changes if you click Apply (and you can undo it).</DialogDescription>
          </DialogHeader>
          {cleanup && cleanup.changes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing to clean up — your script already looks good.</p>
          ) : (
            <>
              <ul className="flex flex-wrap gap-2 text-xs">
                {cleanup?.changes.map((c) => (
                  <li key={c.rule} className="rounded-full border border-border px-2.5 py-1">
                    {c.rule} <span className="text-muted-foreground">×{c.count}</span>
                  </li>
                ))}
              </ul>
              <pre className="scrollbar-thin max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-lg bg-muted/40 p-4 font-sans text-sm">{cleanup?.text}</pre>
            </>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCleanup(null)}>
              Cancel
            </Button>
            <Button disabled={!cleanup || cleanup.changes.length === 0} onClick={() => cleanup && applyEdit(cleanup.text)}>
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <UseInEditorDialog open={useDialog} onOpenChange={setUseDialog} busy={saving} onConfirm={(o) => void saveAudio({ mp3: false, useInProject: true, ...o })} />
    </div>
  );
}

function UseInEditorDialog({
  open,
  onOpenChange,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  busy: boolean;
  onConfirm: (o: { buildCaptions: boolean; fitScenes: boolean }) => void;
}) {
  const [captions, setCaptions] = useState(true);
  const [fit, setFit] = useState(true);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send narration to the video editor</DialogTitle>
          <DialogDescription>Saves the WAV in the project and puts it on the narration track.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <label className="flex items-start gap-2">
            <Checkbox checked={captions} onCheckedChange={(v) => setCaptions(v === true)} className="mt-0.5" />
            <span>
              Create captions from the script
              <span className="block text-xs text-muted-foreground">
                Sentence start/end times are measured from the generated audio; word groups inside a sentence are estimated. Replaces existing captions.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <Checkbox checked={fit} onCheckedChange={(v) => setFit(v === true)} className="mt-0.5" />
            <span>
              Stretch scene durations to match the narration
              <span className="block text-xs text-muted-foreground">Only if the timeline already has scenes. Videos are never stretched past their length.</span>
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => onConfirm({ buildCaptions: captions, fitScenes: fit })}>
            {busy && <Loader2 className="animate-spin" />} Send to editor
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
