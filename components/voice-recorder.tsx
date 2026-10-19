"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle, Clapperboard, Download, Info, Loader2, Mic, Save, Search, Sparkles, Square, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, errorText, waitForJob } from "@/lib/client/api";
import { formatBytes } from "@/lib/shared/timeline";
import { PITCH_PRESETS, enhanceOptionsSchema, type EnhanceOptions } from "@/lib/shared/recording";
import { parseVoiceKey, voiceName } from "@/lib/shared/voice-names";
import type { JobInfo, VoiceFeaturesLite, VoiceMatch } from "@/lib/shared/types";
import { ErrorBlock, LicenseBadge } from "./common";
import { SampleButton, usePreviewPlayer } from "./voice-manager";

type Take = { id: string; duration: number; features: VoiceFeaturesLite | null; n: number };

function fmt(sec: number) {
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
}

function useMicrophones() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const refresh = async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter((d) => d.kind === "audioinput"));
    } catch {
      setDevices([]);
    }
  };
  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((all) => !cancelled && setDevices(all.filter((d) => d.kind === "audioinput")))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return { devices, refresh };
}

/**
 * Record your own narration, clean it up with FFmpeg, and find the Piper voices
 * that sound closest to you (optionally in another accent).
 */
export function VoiceRecorder({
  projectId,
  script,
  onUseVoice,
}: {
  projectId: string;
  script: string;
  onUseVoice: (voiceKey: string) => void;
}) {
  const router = useRouter();
  const mics = useMicrophones();
  const [deviceId, setDeviceId] = useState<string>("default");
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [takes, setTakes] = useState<Take[]>([]);
  const [current, setCurrent] = useState<Take | null>(null);
  // Earlier takes in this project (they're kept in the project's recordings folder).
  useEffect(() => {
    let cancelled = false;
    api<Omit<Take, "n">[]>(`/api/projects/${projectId}/recordings`).then(
      (list) => {
        if (cancelled || !list.length) return;
        const withN = list.map((t, i) => ({ ...t, n: i + 1 }));
        setTakes(withN);
        setCurrent((c) => c ?? withN[withN.length - 1]);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  const [opts, setOpts] = useState<EnhanceOptions>(enhanceOptionsSchema.parse({}));
  const [enhancedLoading, setEnhancedLoading] = useState(false);
  const [name, setName] = useState("My voice");
  const [saving, setSaving] = useState<null | "save" | "narration">(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number>(0);

  const cleanupMic = () => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
    setLevel(0);
  };
  useEffect(() => () => cleanupMic(), []);

  const start = async () => {
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: deviceId !== "default" ? { exact: deviceId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: false, channelCount: 1 },
      });
      streamRef.current = stream;
      void mics.refresh(); // device names become visible after permission
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      const t0 = performance.now();
      let lastUi = 0;
      const tick = (now: number) => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        if (now - lastUi > 60) {
          lastUi = now;
          setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
          setElapsed((now - t0) / 1000);
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);

      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 128_000 } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = async () => {
        cleanupMic();
        setRecording(false);
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        setUploading(true);
        try {
          const info = await api<Take>(`/api/projects/${projectId}/recordings`, {
            method: "POST",
            body: blob,
            headers: { "content-type": blob.type.split(";")[0] || "audio/webm" },
          });
          setTakes((t) => {
            const take = { ...info, n: t.length + 1 };
            setCurrent(take);
            return [...t, take];
          });
          if (!info.features?.f0) toast.warning("Recording saved, but no clear voice was detected. Speak a bit closer to the microphone.");
        } catch (e) {
          toast.error(errorText(e));
        } finally {
          setUploading(false);
        }
      };
      recorderRef.current = rec;
      rec.start(1000);
      setElapsed(0);
      setRecording(true);
    } catch (e) {
      cleanupMic();
      const err = e as DOMException;
      setMicError(
        err?.name === "NotAllowedError"
          ? "Microphone access was blocked. Click the lock icon in the address bar, allow the microphone, then try again."
          : err?.name === "NotFoundError"
            ? "No microphone found. Plug one in (or choose another input) and try again."
            : `Couldn't start recording: ${errorText(e)}`,
      );
    }
  };

  const stop = () => recorderRef.current?.state === "recording" && recorderRef.current.stop();

  const enhancedUrl = current
    ? `/api/projects/${projectId}/recordings/${current.id}/audio?version=enhanced&noise=${+opts.noise}&rumble=${+opts.rumble}&level=${+opts.level}&trim=${+opts.trim}&pitch=${opts.pitch}`
    : null;

  const save = async (useAsNarration: boolean) => {
    if (!current) return;
    setSaving(useAsNarration ? "narration" : "save");
    try {
      await api(`/api/projects/${projectId}/recordings/${current.id}/save`, {
        method: "POST",
        json: { options: opts, name, useAsNarration, script },
      });
      if (useAsNarration) {
        toast.success("Your voice is now the narration", { description: "Captions were created from your script (timing estimated)." });
        router.push(`/editor/${projectId}`);
      } else {
        toast.success(`Saved “${name}.wav” to the project's audio`);
      }
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="scrollbar-thin min-h-0 space-y-5 overflow-y-auto p-6">
        {/* 1. Record */}
        <section className="rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
            <span className="grid size-6 place-items-center rounded-full bg-brand-gradient text-xs font-bold text-emerald-950">1</span>
            <h2 className="font-semibold">Record your voice</h2>
            <div className="ml-auto flex items-center gap-2">
              <Label htmlFor="mic" className="text-xs text-muted-foreground">
                Microphone
              </Label>
              <Select value={deviceId} onValueChange={setDeviceId} disabled={recording}>
                <SelectTrigger id="mic" size="sm" className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Default microphone</SelectItem>
                  {mics.devices
                    .filter((d) => d.deviceId && d.deviceId !== "default")
                    .map((d, i) => (
                      <SelectItem key={d.deviceId} value={d.deviceId}>
                        {d.label || `Microphone ${i + 1}`}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-4 p-4">
            <div
              className={cn(
                "scrollbar-thin max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-background/60 p-4 text-lg leading-relaxed",
                recording && "border-rose-500/40",
              )}
              aria-label="Teleprompter"
            >
              {script.trim() ? script : <span className="text-base text-muted-foreground">Write your script in the AI voice tab first — it will show here as a teleprompter while you record.</span>}
            </div>
            <div className="flex flex-wrap items-center gap-4">
              {recording ? (
                <Button size="lg" variant="destructive" className="h-12 rounded-full px-6" onClick={stop}>
                  <Square className="fill-current" /> Stop
                </Button>
              ) : (
                <Button size="lg" className="h-12 rounded-full bg-rose-500 px-6 text-white hover:bg-rose-500/90" style={{ backgroundImage: "none" }} onClick={() => void start()} disabled={uploading}>
                  {uploading ? <Loader2 className="animate-spin" /> : <Circle className="fill-current" />} {uploading ? "Saving…" : takes.length ? "Record again" : "Start recording"}
                </Button>
              )}
              <div className="font-mono text-lg tabular-nums">{fmt(recording ? elapsed : current?.duration ?? 0)}</div>
              <div className="h-2.5 min-w-40 flex-1 overflow-hidden rounded-full bg-muted" role="meter" aria-label="Microphone level" aria-valuenow={Math.round(level * 100)} aria-valuemin={0} aria-valuemax={100}>
                <div className={cn("h-full rounded-full transition-[width] duration-75", level > 0.9 ? "bg-rose-500" : "bg-brand-gradient")} style={{ width: `${level * 100}%` }} />
              </div>
            </div>
            {recording && <p className="flex items-center gap-2 text-sm text-rose-300"><Mic className="size-4 animate-pulse" /> Recording… read your script naturally. Keep the meter out of the red.</p>}
            {micError && <ErrorBlock message={micError} />}
            {takes.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {takes.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setCurrent(t)}
                    className={cn("rounded-full border px-3 py-1 text-xs", current?.id === t.id ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground")}
                  >
                    Take {t.n} · {fmt(t.duration)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* 2. Clean up */}
        <section className={cn("rounded-xl border border-border bg-card", !current && "opacity-50")}>
          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            <span className="grid size-6 place-items-center rounded-full bg-brand-gradient text-xs font-bold text-emerald-950">2</span>
            <h2 className="font-semibold">Clean it up</h2>
            <span className="text-xs text-muted-foreground">Done on this computer with FFmpeg</span>
          </div>
          <div className="grid gap-4 p-4 md:grid-cols-2">
            <div className="space-y-3">
              {(
                [
                  ["noise", "Remove background noise", "Fans, hiss, computer hum"],
                  ["rumble", "Remove low rumble", "Desk bumps, traffic, mic handling"],
                  ["level", "Even out volume", "Steady, broadcast-level loudness (-16 LUFS)"],
                  ["trim", "Trim silence", "Cut dead air at the start and end"],
                ] as const
              ).map(([k, label, hint]) => (
                <label key={k} className="flex items-center justify-between gap-3">
                  <span>
                    <span className="block text-sm">{label}</span>
                    <span className="block text-xs text-muted-foreground">{hint}</span>
                  </span>
                  <Switch checked={opts[k]} disabled={!current} onCheckedChange={(v) => setOpts((o) => ({ ...o, [k]: v }))} aria-label={label} />
                </label>
              ))}
              <div className="space-y-1.5">
                <Label>Voice effect</Label>
                <Select value={String(opts.pitch)} disabled={!current} onValueChange={(v) => setOpts((o) => ({ ...o, pitch: Number(v) }))}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PITCH_PRESETS.map((p) => (
                      <SelectItem key={p.value} value={String(p.value)}>
                        {p.label}
                        {p.value !== 0 && <span className="text-xs text-muted-foreground">{p.value > 0 ? "+" : ""}{p.value} semitones</span>}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">Before (original)</div>
                {current ? <audio controls className="w-full" src={`/api/projects/${projectId}/recordings/${current.id}/audio`} /> : <div className="h-10 rounded-lg bg-muted/40" />}
              </div>
              <div>
                <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  After (cleaned up) {enhancedLoading && <Loader2 className="size-3 animate-spin" />}
                </div>
                {enhancedUrl ? (
                  <audio
                    key={enhancedUrl}
                    controls
                    className="w-full"
                    src={enhancedUrl}
                    preload="auto"
                    onLoadStart={() => setEnhancedLoading(true)}
                    onCanPlay={() => setEnhancedLoading(false)}
                    onError={() => setEnhancedLoading(false)}
                  />
                ) : (
                  <div className="h-10 rounded-lg bg-muted/40" />
                )}
              </div>
              {current?.features?.f0 ? (
                <p className="text-xs text-muted-foreground">
                  Your voice: about <b className="text-foreground">{Math.round(current.features.f0)} Hz</b> average pitch
                  {current.features.f0 < 140 ? " (lower, typical male range)" : current.features.f0 > 165 ? " (higher, typical female range)" : " (middle range)"}.
                </p>
              ) : null}
            </div>
          </div>
        </section>

        {/* 3. Use it */}
        <section className={cn("rounded-xl border border-border bg-card", !current && "opacity-50")}>
          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            <span className="grid size-6 place-items-center rounded-full bg-brand-gradient text-xs font-bold text-emerald-950">3</span>
            <h2 className="font-semibold">Use your recording</h2>
          </div>
          <div className="flex flex-wrap items-end gap-3 p-4">
            <div className="min-w-56 flex-1 space-y-1.5">
              <Label htmlFor="rec-name">File name</Label>
              <Input id="rec-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} disabled={!current} />
            </div>
            <Button variant="outline" disabled={!current || !!saving} onClick={() => void save(false)}>
              {saving === "save" ? <Loader2 className="animate-spin" /> : <Save />} Save to project
            </Button>
            <Button disabled={!current || !!saving} onClick={() => void save(true)}>
              {saving === "narration" ? <Loader2 className="animate-spin" /> : <Clapperboard />} Use as narration
            </Button>
          </div>
          <p className="px-4 pb-4 text-xs text-muted-foreground">
            “Use as narration” puts the cleaned-up recording on the video&apos;s voice track and makes captions from your script (timing is estimated from the
            recording length — adjust it in the editor if needed).
          </p>
        </section>
      </div>

      <MatchPanel projectId={projectId} take={current} onUseVoice={onUseVoice} />
    </div>
  );
}

function MatchPanel({ projectId, take, onUseVoice }: { projectId: string; take: Take | null; onUseVoice: (key: string) => void }) {
  const preview = usePreviewPlayer();
  const [region, setRegion] = useState<"any" | "en_US" | "en_GB">("any");
  const [commercialOnly, setCommercialOnly] = useState(true);
  const [job, setJob] = useState<JobInfo | null>(null);
  const [matches, setMatches] = useState<VoiceMatch[] | null>(null);
  const [installing, setInstalling] = useState<Record<string, number>>({});
  const running = job?.status === "running" || job?.status === "queued";

  const find = async () => {
    if (!take) return;
    try {
      const j = await api<JobInfo>(`/api/projects/${projectId}/recordings/${take.id}/match`, { method: "POST", json: { region, commercialOnly } });
      setJob(j);
      const final = await waitForJob(j.id, setJob);
      if (final.status !== "done") throw new Error(final.error ?? "Matching failed");
      const r = final.result as { matches: VoiceMatch[]; failed: number };
      setMatches(r.matches);
      if (r.failed) toast.warning(`${r.failed} voice samples couldn't be downloaded — results may be incomplete.`);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setJob(null);
    }
  };

  const use = async (m: VoiceMatch) => {
    if (!m.installed) {
      try {
        const catalog = await api<{ catalog: { key: string; totalBytes: number }[] }>("/api/voices");
        const entry = catalog.catalog.find((c) => c.key === m.key);
        if (!entry) throw new Error("Voice not found");
        const j = await api<JobInfo>("/api/voices/install", { method: "POST", json: { key: m.key, confirmBytes: entry.totalBytes } });
        const final = await waitForJob(j.id, (u) => setInstalling((s) => ({ ...s, [m.key]: u.progress })));
        if (final.status !== "done") throw new Error(final.error ?? "Install failed");
        setMatches((list) => list?.map((x) => (x.key === m.key ? { ...x, installed: true } : x)) ?? null);
      } catch (e) {
        toast.error(errorText(e));
        return;
      } finally {
        setInstalling((s) => {
          const n = { ...s };
          delete n[m.key];
          return n;
        });
      }
    }
    onUseVoice(m.key);
    toast.success(`${voiceName(m.key)} will read your script`, { description: "Generate the narration in the AI voice tab." });
  };

  return (
    <aside className="scrollbar-thin min-h-0 space-y-4 overflow-y-auto border-l border-border/60 bg-card/30 p-5">
      <div>
        <h2 className="flex items-center gap-2 font-semibold">
          <Sparkles className="size-4 text-primary" /> AI voices that sound like you
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">Compares the pitch and tone of your recording with each voice&apos;s official sample.</p>
      </div>
      <div className="space-y-3 rounded-lg border border-border p-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Accent</Label>
          <ToggleGroup type="single" variant="outline" size="sm" value={region} onValueChange={(v) => v && setRegion(v as typeof region)} className="w-full">
            <ToggleGroupItem value="any" className="flex-1">Any</ToggleGroupItem>
            <ToggleGroupItem value="en_US" className="flex-1">American</ToggleGroupItem>
            <ToggleGroupItem value="en_GB" className="flex-1">British</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <label className="flex items-center justify-between text-xs">
          Commercial-use voices only
          <Switch checked={commercialOnly} onCheckedChange={setCommercialOnly} aria-label="Commercial-use voices only" />
        </label>
        <Button className="w-full" disabled={!take || running} onClick={() => void find()}>
          {running ? <Loader2 className="animate-spin" /> : <Search />} Find matching voices
        </Button>
        {!take && <p className="text-xs text-muted-foreground">Record at least 5–10 seconds first.</p>}
        {running && job && (
          <div className="space-y-1" role="status">
            <Progress value={job.progress * 100} className="h-1.5" />
            <p className="text-xs text-muted-foreground">{job.message}</p>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">The first search downloads the official voice samples (about 90 KB each, needs internet); later searches are instant.</p>
      </div>

      {matches && matches.length === 0 && <p className="text-sm text-muted-foreground">No voices match these filters.</p>}
      {matches && matches.length > 0 && (
        <ol className="space-y-2">
          {matches.map((m, i) => {
            const p = parseVoiceKey(m.key);
            const progress = installing[m.key];
            return (
              <li key={m.key} className={cn("rounded-lg border bg-card p-3", i === 0 ? "border-primary/50" : "border-border")}>
                <div className="flex items-center gap-2">
                  <span className="w-5 text-xs text-muted-foreground">{i + 1}.</span>
                  <span className="font-semibold" title={m.key}>
                    {voiceName(m.key)}
                  </span>
                  {p.quality && p.quality !== "Medium" && <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">{p.quality}</span>}
                  <span className="text-xs text-muted-foreground">
                    {p.region === "UK" ? "British" : p.region === "US" ? "American" : p.region} · {m.gender === "male" ? "Male" : m.gender === "female" ? "Female" : m.gender}
                  </span>
                  <span className="ml-auto text-sm font-semibold tabular-nums text-primary">{m.similarity}%</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-brand-gradient" style={{ width: `${m.similarity}%` }} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <LicenseBadge use={m.commercialUse} className="text-[10px]" />
                  <SampleButton k={m.key} preview={preview} />
                  {progress !== undefined ? (
                    <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="size-3 animate-spin" /> Installing {Math.round(progress * 100)}%
                    </span>
                  ) : (
                    <Button size="sm" className="ml-auto" onClick={() => void use(m)} title={m.installed ? undefined : `Downloads ${formatBytes(m.totalBytes)}`}>
                      {m.installed ? <CheckCircle2 /> : <Download />} {m.installed ? "Use for my script" : `Install & use (${formatBytes(m.totalBytes)})`}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <div className="flex gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <span>
          <b className="text-foreground">About accents:</b> StickForge can&apos;t turn <i>your own</i> recording into another accent — that needs voice-cloning AI
          that isn&apos;t free to run offline. Instead, pick the closest-sounding voice in the accent you want (American or British) and let it read your
          script. <Wand2 className="inline size-3" /> The “Deeper narrator” effect can make your own recording sound bigger.
        </span>
      </div>
      <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={() => setMatches(null)} disabled={!matches}>
        <Trash2 /> Clear results
      </Button>
    </aside>
  );
}
