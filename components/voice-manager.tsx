"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Download, ExternalLink, FileText, Globe, Loader2, Play, RefreshCw, Square, Trash2, Volume2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useApi } from "@/lib/client/hooks";
import { api, errorText, waitForJob } from "@/lib/client/api";
import { formatBytes } from "@/lib/shared/timeline";
import type { InstalledVoice, JobInfo, VoiceCatalogEntry } from "@/lib/shared/types";
import { EmptyState, ErrorBlock, LicenseBadge, LoadingBlock, PageBody, PageHeader } from "./common";
import { parseVoiceKey, voiceName } from "@/lib/shared/voice-names";

type VoicesResp = {
  voicesDir: string;
  freeBytes: number | null;
  installed: InstalledVoice[];
  catalog: VoiceCatalogEntry[];
  installing: { jobId: string; key: string }[];
};

const SAMPLE =
  "In nineteen twenty-two, archaeologists opened a tomb that had been sealed for over three thousand years. What they found changed history forever.";

const GENDER_LABEL: Record<VoiceCatalogEntry["gender"], string> = {
  male: "Male",
  female: "Female",
  mixed: "Multi-speaker",
  neutral: "Non-binary",
  unknown: "Unknown",
};

export function usePreviewPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const stop = () => {
    audioRef.current?.pause();
    setPlayingKey(null);
  };
  /** `body` = synthesize with an installed voice; omit it to play the official sample (works before installing). */
  const play = async (key: string, body?: Record<string, unknown>) => {
    stop();
    setLoadingKey(key);
    try {
      const blob = body
        ? await api<Blob>("/api/tts/preview", { method: "POST", json: body })
        : await api<Blob>(`/api/voices/${encodeURIComponent(key.replace(/^sample:/, ""))}/sample`);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        setPlayingKey(null);
        URL.revokeObjectURL(url);
      };
      await audio.play();
      setPlayingKey(key);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setLoadingKey(null);
    }
  };
  return { play, stop, playingKey, loadingKey };
}

/** Plays the official Piper sample of a voice (no install needed). */
export function SampleButton({ k, preview, className, label = "Listen" }: { k: string; preview: ReturnType<typeof usePreviewPlayer>; className?: string; label?: string }) {
  const playing = preview.playingKey === `sample:${k}`;
  const loading = preview.loadingKey === `sample:${k}`;
  return (
    <Button
      size="sm"
      variant="ghost"
      className={className}
      disabled={loading}
      onClick={() => (playing ? preview.stop() : void preview.play(`sample:${k}`))}
      aria-label={`${playing ? "Stop" : "Listen to"} the ${voiceName(k)} sample`}
      title="Official Piper sample recording (needs internet the first time)"
    >
      {loading ? <Loader2 className="animate-spin" /> : playing ? <Square /> : <Volume2 />} {playing ? "Stop" : label}
    </Button>
  );
}

export function VoiceManager() {
  const voices = useApi<VoicesResp>("/api/voices");
  const [onlyCommercial, setOnlyCommercial] = useState(true);
  const [gender, setGender] = useState<string>("all");
  const [region, setRegion] = useState<string>("en_US");
  const [confirm, setConfirm] = useState<VoiceCatalogEntry | null>(null);
  const [removing, setRemoving] = useState<InstalledVoice | null>(null);
  const [card, setCard] = useState<InstalledVoice | null>(null);
  const [jobs, setJobs] = useState<Record<string, JobInfo>>({});
  const [refreshing, setRefreshing] = useState(false);
  const preview = usePreviewPlayer();

  const installedKeys = new Set(voices.data?.installed.map((v) => v.key));
  const catalog = useMemo(
    () =>
      (voices.data?.catalog ?? []).filter(
        (v) =>
          (region === "all" || v.languageCode === region) &&
          (gender === "all" || v.gender === gender) &&
          (!onlyCommercial || v.commercialUse === "allowed" || v.commercialUse === "attribution" || v.commercialUse === "share-alike"),
      ),
    [voices.data, region, gender, onlyCommercial],
  );

  const install = async (v: VoiceCatalogEntry) => {
    setConfirm(null);
    try {
      const job = await api<JobInfo>("/api/voices/install", { method: "POST", json: { key: v.key, confirmBytes: v.totalBytes } });
      setJobs((j) => ({ ...j, [v.key]: job }));
      const final = await waitForJob(job.id, (u) => setJobs((j) => ({ ...j, [v.key]: u })));
      if (final.status === "done") toast.success(`${voiceName(v.key)} installed and verified`);
      else if (final.status === "cancelled") toast.message(`Download of ${voiceName(v.key)} cancelled`);
      else toast.error(final.error ?? "Install failed");
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setJobs((j) => {
        const n = { ...j };
        delete n[v.key];
        return n;
      });
      void voices.reload();
    }
  };

  return (
    <PageBody>
      <PageHeader
        title="Voice Manager"
        description={
          <>
            Free <a className="underline underline-offset-2" href="https://github.com/OHF-Voice/piper1-gpl" target="_blank" rel="noreferrer">Piper</a> voice models from the official{" "}
            <a className="underline underline-offset-2" href="https://huggingface.co/rhasspy/piper-voices" target="_blank" rel="noreferrer">rhasspy/piper-voices</a> repository. Downloads are verified (size + MD5) and stored on this computer.
          </>
        }
        actions={
          <Button
            variant="outline"
            disabled={refreshing}
            onClick={async () => {
              setRefreshing(true);
              try {
                const r = await api<{ count: number }>("/api/voices/refresh", { method: "POST" });
                toast.success(`Voice list updated (${r.count} English voices)`);
                void voices.reload();
              } catch (e) {
                toast.error(errorText(e));
              } finally {
                setRefreshing(false);
              }
            }}
          >
            {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />} Refresh voice list
            <Globe className="text-muted-foreground" aria-label="needs internet" />
          </Button>
        }
      />
      <div className="space-y-8 px-8 py-6">
        {voices.error && <ErrorBlock message={voices.error} onRetry={voices.reload} />}
        {voices.loading && !voices.data && <LoadingBlock />}
        {voices.data && (
          <>
            <section>
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-semibold">Installed voices</h2>
                <p className="text-xs text-muted-foreground">
                  Folder: <span className="font-mono">{voices.data.voicesDir}</span>
                  {voices.data.freeBytes !== null && <> · {formatBytes(voices.data.freeBytes)} free</>} ·{" "}
                  <Link href="/settings" className="underline underline-offset-2">
                    change
                  </Link>
                </p>
              </div>
              {voices.data.installed.length === 0 ? (
                <EmptyState icon={Download} title="No voices installed">
                  Pick a voice below. We recommend <b>Joe</b> (male, CC0) and <b>Kristin</b> (female, public domain).
                </EmptyState>
              ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {voices.data.installed.map((v) => (
                    <div key={v.key} className="rounded-xl border border-border bg-card p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-base font-semibold" title={v.key}>
                            {voiceName(v.key)}
                          </div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {v.catalog ? GENDER_LABEL[v.catalog.gender] : "Custom voice"}
                            {parseVoiceKey(v.key).region && <> · {parseVoiceKey(v.key).region} English</>} · {parseVoiceKey(v.key).quality ?? v.quality} quality · {v.sampleRate / 1000} kHz · {formatBytes(v.sizeBytes)}
                            {v.numSpeakers > 1 && <> · {v.numSpeakers} speakers</>}
                          </div>
                        </div>
                        <CheckCircle2 className="size-4 shrink-0 text-emerald-400" aria-label="Installed" />
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {v.catalog ? <LicenseBadge use={v.catalog.commercialUse} /> : <Badge variant="outline">License: see voice files</Badge>}
                        {v.catalog && <span className="text-xs text-muted-foreground">{v.catalog.license}</span>}
                      </div>
                      <div className="mt-4 flex gap-2">
                        {preview.playingKey === v.key ? (
                          <Button size="sm" variant="secondary" onClick={preview.stop}>
                            <Square /> Stop
                          </Button>
                        ) : (
                          <Button size="sm" variant="secondary" disabled={preview.loadingKey === v.key} onClick={() => preview.play(v.key, { voiceKey: v.key, text: SAMPLE })}>
                            {preview.loadingKey === v.key ? <Loader2 className="animate-spin" /> : <Play />} Preview
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setCard(v)} disabled={!v.modelCard}>
                          <FileText /> Model card
                        </Button>
                        <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground hover:text-destructive" onClick={() => setRemoving(v)} aria-label={`Remove ${voiceName(v.key)}`}>
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Available English voices</h2>
                <div className="flex flex-wrap items-center gap-3">
                  <ToggleGroup type="single" variant="outline" size="sm" value={region} onValueChange={(v) => v && setRegion(v)} aria-label="Accent">
                    <ToggleGroupItem value="en_US">US</ToggleGroupItem>
                    <ToggleGroupItem value="en_GB">UK</ToggleGroupItem>
                    <ToggleGroupItem value="all">All</ToggleGroupItem>
                  </ToggleGroup>
                  <ToggleGroup type="single" variant="outline" size="sm" value={gender} onValueChange={(v) => v && setGender(v)} aria-label="Voice type">
                    <ToggleGroupItem value="all">Any</ToggleGroupItem>
                    <ToggleGroupItem value="male">Male</ToggleGroupItem>
                    <ToggleGroupItem value="female">Female</ToggleGroupItem>
                    <ToggleGroupItem value="mixed">Multi</ToggleGroupItem>
                  </ToggleGroup>
                  <div className="flex items-center gap-2">
                    <Switch id="commercial" checked={onlyCommercial} onCheckedChange={setOnlyCommercial} />
                    <Label htmlFor="commercial" className="text-sm">
                      Commercial-use licenses only
                    </Label>
                  </div>
                </div>
              </div>
              <div className="overflow-hidden rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 font-medium">Voice</th>
                      <th className="px-4 py-2 font-medium">Type</th>
                      <th className="px-4 py-2 font-medium">Quality</th>
                      <th className="px-4 py-2 font-medium">Size</th>
                      <th className="px-4 py-2 font-medium">License (from model card)</th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {catalog.map((v) => {
                      const job = jobs[v.key] ?? null;
                      const installed = installedKeys.has(v.key);
                      return (
                        <tr key={v.key} className="border-t border-border/70 align-top">
                          <td className="px-4 py-3">
                            <div className="font-medium" title={v.key}>
                              {voiceName(v.key)}
                              <span className="ml-1.5 text-xs font-normal text-muted-foreground">{parseVoiceKey(v.key).region}</span>
                              {v.recommended && (
                                <Badge className="ml-2 bg-primary/15 text-primary" variant="secondary">
                                  Recommended
                                </Badge>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground">{v.description || v.languageLabel}</div>
                          </td>
                          <td className="px-4 py-3">{GENDER_LABEL[v.gender]}{v.numSpeakers > 1 ? ` (${v.numSpeakers})` : ""}</td>
                          <td className="px-4 py-3 capitalize">{v.quality.replace("_", " ")}</td>
                          <td className="px-4 py-3 tabular-nums">{formatBytes(v.totalBytes)}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-col items-start gap-1">
                              <LicenseBadge use={v.commercialUse} />
                              <span className="text-xs text-muted-foreground">{v.license}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                            <SampleButton k={v.key} preview={preview} />
                            {installed ? (
                              <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                                <CheckCircle2 className="size-3.5" /> Installed
                              </span>
                            ) : job ? (
                              <div className="ml-auto flex w-44 items-center gap-2">
                                <Progress value={job.progress * 100} className="h-1.5" aria-label={`Downloading ${voiceName(v.key)}`} />
                                <span className="w-9 text-xs tabular-nums">{Math.round(job.progress * 100)}%</span>
                                <Button size="icon-xs" variant="ghost" aria-label="Cancel download" onClick={() => api(`/api/jobs/${job.id}`, { method: "DELETE" })}>
                                  <X />
                                </Button>
                              </div>
                            ) : (
                              <Button size="sm" variant="outline" onClick={() => setConfirm(v)}>
                                <Download /> Install
                              </Button>
                            )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {catalog.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                          No voices match these filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                License labels summarize each voice&apos;s official MODEL_CARD (dataset license). They are not legal advice — open the model card and the
                dataset license and confirm commercial use is permitted before monetizing videos.
              </p>
            </section>
          </>
        )}
      </div>

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Download the {confirm && voiceName(confirm.key)} voice?</DialogTitle>
            <DialogDescription>This needs an internet connection once. Nothing else is sent — only the voice files are downloaded.</DialogDescription>
          </DialogHeader>
          {confirm && (
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Download size</dt>
              <dd className="font-medium">{formatBytes(confirm.totalBytes)} ({confirm.files.length} files)</dd>
              <dt className="text-muted-foreground">Free space</dt>
              <dd>{voices.data?.freeBytes != null ? formatBytes(voices.data.freeBytes) : "unknown"}</dd>
              <dt className="text-muted-foreground">Saved to</dt>
              <dd className="break-all font-mono text-xs">{voices.data?.voicesDir}</dd>
              <dt className="text-muted-foreground">Source</dt>
              <dd>
                <a href={confirm.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all underline underline-offset-2">
                  huggingface.co/rhasspy/piper-voices <ExternalLink className="size-3" />
                </a>
              </dd>
              <dt className="text-muted-foreground">License</dt>
              <dd className="space-y-1">
                <LicenseBadge use={confirm.commercialUse} />
                <div>
                  {confirm.licenseUrl ? (
                    <a href={confirm.licenseUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                      {confirm.license}
                    </a>
                  ) : (
                    confirm.license
                  )}
                </div>
              </dd>
              <dt className="text-muted-foreground">Verification</dt>
              <dd>Size and MD5 of every file are checked against the official voices.json.</dd>
            </dl>
          )}
          {confirm?.commercialUse === "non-commercial" && (
            <ErrorBlock message="This voice's license does not allow commercial use. Don't use it for monetized YouTube or Facebook videos." />
          )}
          <DialogFooter>
            {confirm && <SampleButton k={confirm.key} preview={preview} className="sm:mr-auto" label="Listen first" />}
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button onClick={() => confirm && void install(confirm)}>
              <Download /> Download {confirm && formatBytes(confirm.totalBytes)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove the {removing && voiceName(removing.key)} voice?</AlertDialogTitle>
            <AlertDialogDescription>
              Frees {removing && formatBytes(removing.sizeBytes)}. Narration you already generated is kept. You can download the voice again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={async () => {
                try {
                  await api(`/api/voices/${removing!.key}`, { method: "DELETE" });
                  toast.success("Voice removed");
                  void voices.reload();
                } catch (e) {
                  toast.error(errorText(e));
                }
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!card} onOpenChange={(o) => !o && setCard(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Model card — {card && voiceName(card.key)}</DialogTitle>
            <DialogDescription>Downloaded with the voice from the official repository.</DialogDescription>
          </DialogHeader>
          <pre className="scrollbar-thin max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg bg-muted/40 p-4 text-xs">{card?.modelCard}</pre>
        </DialogContent>
      </Dialog>
    </PageBody>
  );
}
