"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Download, FolderOpen, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, errorText, waitForJob } from "@/lib/client/api";
import { formatDuration } from "@/lib/shared/timeline";
import { EXPORT_PRESETS, RESOLUTIONS, outputSize, type AspectId, type ExportPresetId, type ResolutionId, type ExportRecord, type ExportRequest, type JobInfo } from "@/lib/shared/types";
import { ErrorBlock } from "../common";
import { FolderPickerDialog } from "../folder-picker";

export function ExportDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
  duration,
  hasCaptions,
  aspect,
  beforeExport,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: string;
  projectName: string;
  duration: number;
  hasCaptions: boolean;
  aspect: AspectId;
  beforeExport: () => Promise<boolean>;
}) {
  // Presets made for this project's ratio, plus Custom.
  const presetIds = (Object.keys(EXPORT_PRESETS) as ExportPresetId[]).filter((id) => EXPORT_PRESETS[id].aspect === aspect || id === "custom");
  const [presetChoice, setPreset] = useState<ExportPresetId | null>(null);
  const preset: ExportPresetId = presetChoice && presetIds.includes(presetChoice) ? presetChoice : presetIds[0];
  const [resolution, setResolution] = useState<ResolutionId>("1080");
  const [quality, setQuality] = useState<ExportRequest["quality"]>("standard");
  const [width, setWidth] = useState(() => outputSize(aspect, "1080").width);
  const [height, setHeight] = useState(() => outputSize(aspect, "1080").height);
  const [fps, setFps] = useState<24 | 25 | 30 | 60>(30);
  const [burn, setBurn] = useState(true);
  const [srt, setSrt] = useState(true);
  const [fileName, setFileName] = useState("");
  const [outputDir, setOutputDir] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [job, setJob] = useState<JobInfo | null>(null);
  const [record, setRecord] = useState<ExportRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const running = job && (job.status === "queued" || job.status === "running");
  const p = EXPORT_PRESETS[preset];
  const size = outputSize(aspect, resolution);

  const start = async () => {
    setError(null);
    setWarnings([]);
    setRecord(null);
    if (!(await beforeExport())) {
      setError("Could not save the project before exporting. Check the save status and try again.");
      return;
    }
    try {
      const r = await api<{ record: ExportRecord; warnings: string[] }>("/api/exports", {
        method: "POST",
        json: {
          projectId,
          preset,
          resolution,
          quality,
          burnCaptions: burn,
          writeSrt: srt,
          fileName: fileName.trim() || undefined,
          outputDir: outputDir ?? undefined,
          ...(preset === "custom" ? { width, height, fps } : {}),
        },
      });
      setWarnings(r.warnings);
      setRecord(r.record);
      const final = await waitForJob(r.record.id, setJob);
      const rec = await api<ExportRecord>(`/api/exports/${r.record.id}`);
      setRecord(rec);
      if (final.status === "done") toast.success("Export finished", { description: rec.outputPath });
      else if (final.status === "cancelled") toast.message("Export cancelled");
      else setError(final.error ?? "Export failed");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setJob((j) => (j && (j.status === "running" || j.status === "queued") ? null : j));
    }
  };

  const done = job?.status === "done" && record;

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !running && onOpenChange(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Export video</DialogTitle>
            <DialogDescription>
              {formatDuration(duration)} · MP4 (H.264 + AAC) rendered locally with FFmpeg. Source files are never modified.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Preset</Label>
              <ToggleGroup type="single" variant="outline" value={preset} onValueChange={(v) => v && setPreset(v as ExportPresetId)} className="w-full">
                {presetIds.map((id) => (
                  <ToggleGroupItem key={id} value={id} className="flex-1">
                    {EXPORT_PRESETS[id].label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              {preset !== "custom" ? (
                <>
                  <Label className="pt-2">Size</Label>
                  <ToggleGroup type="single" variant="outline" value={resolution} onValueChange={(v) => v && setResolution(v as ResolutionId)} className="w-full">
                    {(Object.keys(RESOLUTIONS) as ResolutionId[]).map((r) => {
                      const s = outputSize(aspect, r);
                      return (
                        <ToggleGroupItem key={r} value={r} className="h-auto flex-1 flex-col gap-0 py-1.5">
                          <span>{RESOLUTIONS[r].label}</span>
                          <span className="text-[10px] font-normal opacity-70">
                            {s.width}×{s.height}
                          </span>
                        </ToggleGroupItem>
                      );
                    })}
                  </ToggleGroup>
                  <p className="text-xs text-muted-foreground">
                    {size.width}×{size.height} · {p.fps} fps · {aspect} · {RESOLUTIONS[resolution].hint}
                    {p.maxDuration && duration > p.maxDuration && (
                      <span className="text-amber-400"> · longer than the recommended {p.maxDuration}s — check current platform limits</span>
                    )}
                  </p>
                </>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  <Input type="number" min={240} max={4096} step={2} value={width} onChange={(e) => setWidth(Number(e.target.value))} aria-label="Width" />
                  <Input type="number" min={240} max={4096} step={2} value={height} onChange={(e) => setHeight(Number(e.target.value))} aria-label="Height" />
                  <Select value={String(fps)} onValueChange={(v) => setFps(Number(v) as 24 | 25 | 30 | 60)}>
                    <SelectTrigger aria-label="Frame rate">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[24, 25, 30, 60].map((f) => (
                        <SelectItem key={f} value={String(f)}>
                          {f} fps
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Quality</Label>
              <ToggleGroup type="single" variant="outline" value={quality} onValueChange={(v) => v && setQuality(v as ExportRequest["quality"])} className="w-full">
                <ToggleGroupItem value="high" className="flex-1">High</ToggleGroupItem>
                <ToggleGroupItem value="standard" className="flex-1">Standard</ToggleGroupItem>
                <ToggleGroupItem value="small" className="flex-1">Small / fast</ToggleGroupItem>
              </ToggleGroup>
              <p className="text-xs text-muted-foreground">High is slowest to render. Standard is a good default for uploads.</p>
            </div>
            <div className="space-y-2 text-sm">
              <label className="flex items-center gap-2">
                <Checkbox checked={burn} onCheckedChange={(v) => setBurn(v === true)} disabled={!hasCaptions} /> Burn captions into the video
              </label>
              <label className="flex items-center gap-2">
                <Checkbox checked={srt} onCheckedChange={(v) => setSrt(v === true)} disabled={!hasCaptions} /> Also save an .srt subtitle file
              </label>
              {!hasCaptions && <p className="text-xs text-muted-foreground">No captions in this project.</p>}
            </div>
            <div className="grid grid-cols-[1fr_auto] items-end gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="exp-name">File name</Label>
                <Input id="exp-name" placeholder={`${projectName} <date>`} value={fileName} onChange={(e) => setFileName(e.target.value)} maxLength={120} />
              </div>
              <Button variant="outline" onClick={() => setPicker(true)} title={outputDir ?? "Project exports folder"}>
                <FolderOpen /> {outputDir ? "Folder ✓" : "Folder"}
              </Button>
            </div>
            <p className="-mt-2 truncate text-xs text-muted-foreground" title={outputDir ?? undefined}>
              Saving to {outputDir ?? "the project's exports folder (or your default export folder)"} · existing files are never overwritten.
            </p>
            {running && job && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3" role="status" aria-live="polite">
                <div className="mb-2 flex justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" /> {job.status === "queued" ? "Waiting for another export…" : job.message}
                  </span>
                  <span className="tabular-nums">{Math.round(job.progress * 100)}%</span>
                </div>
                <Progress value={job.progress * 100} className="h-1.5" />
              </div>
            )}
            {done && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
                <div className="flex items-center gap-2 font-medium">
                  <CheckCircle2 className="size-4 text-emerald-400" /> Export ready
                </div>
                <div className="mt-1 break-all text-xs text-muted-foreground">{record.outputPath}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" asChild>
                    <a href={`/api/exports/${record.id}/file?download=1`}>
                      <Download /> Download copy
                    </a>
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => api(`/api/exports/${record.id}/reveal`, { method: "POST" }).catch((e) => toast.error(errorText(e)))}>
                    <FolderOpen /> Show in folder
                  </Button>
                  <Button size="sm" variant="ghost" asChild>
                    <Link href="/exports">Export queue</Link>
                  </Button>
                </div>
              </div>
            )}
            {warnings.map((w) => (
              <p key={w} className="text-xs text-amber-400">
                {w}
              </p>
            ))}
            {error && <ErrorBlock message={error} />}
          </div>
          <DialogFooter>
            {running && job ? (
              <Button variant="outline" onClick={() => api(`/api/exports/${job.id}`, { method: "POST" })}>
                <X /> Cancel export
              </Button>
            ) : (
              <>
                <Button variant="ghost" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
                <Button onClick={() => void start()} disabled={duration <= 0}>
                  <Download /> {done ? "Export again" : "Export"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <FolderPickerDialog
        open={picker}
        onOpenChange={setPicker}
        title="Export folder"
        description="Must be the project folder, your default export folder (Settings) or an approved media folder."
        onChoose={(p) => setOutputDir(p)}
      />
    </>
  );
}
