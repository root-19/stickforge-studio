"use client";

import { useState } from "react";
import Link from "next/link";
import { Download, FileText, FolderOpen, Play, Trash2, X, Clapperboard } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useApi } from "@/lib/client/hooks";
import { api, errorText } from "@/lib/client/api";
import { formatDuration } from "@/lib/shared/timeline";
import type { ExportRecord } from "@/lib/shared/types";
import { EmptyState, ErrorBlock, JobStatusBadge, LoadingBlock, PageBody, PageHeader } from "./common";

const PRESET_LABEL: Record<string, string> = { "youtube-shorts": "YouTube Shorts", "facebook-reels": "Facebook Reels", custom: "Custom" };

export function ExportQueue() {
  // Local request, so polling every 1.5 s is cheap and keeps progress live.
  const exports = useApi<ExportRecord[]>("/api/exports", 1500);
  const [playing, setPlaying] = useState<ExportRecord | null>(null);
  const [removing, setRemoving] = useState<ExportRecord | null>(null);
  const [deleteFile, setDeleteFile] = useState(false);

  return (
    <PageBody>
      <PageHeader title="Export Queue" description="Exports render one at a time on this computer with FFmpeg. Finished videos stay in their folders until you delete them." />
      <div className="px-8 py-6">
        {exports.error && <ErrorBlock message={exports.error} onRetry={exports.reload} />}
        {exports.loading && !exports.data && <LoadingBlock />}
        {exports.data?.length === 0 && (
          <EmptyState
            icon={Download}
            title="No exports yet"
            action={
              <Button asChild>
                <Link href="/editor">
                  <Clapperboard /> Open the editor
                </Link>
              </Button>
            }
          >
            Use the Export button in the video editor to render a YouTube Short or Facebook Reel.
          </EmptyState>
        )}
        <ul className="space-y-3">
          {exports.data?.map((e) => (
            <li key={e.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{e.projectName}</span>
                    <JobStatusBadge status={e.status} />
                    <span className="text-xs text-muted-foreground">
                      {PRESET_LABEL[e.preset] ?? e.preset} · {e.width}×{e.height} · {e.fps} fps · {formatDuration(e.duration)}
                    </span>
                  </div>
                  <div className="mt-1 break-all text-xs text-muted-foreground" title={e.outputPath}>
                    {e.outputPath}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    Started {new Date(e.createdAt).toLocaleString()}
                    {e.finishedAt && <> · finished {new Date(e.finishedAt).toLocaleTimeString()}</>}
                  </div>
                  {e.status === "done" && !e.fileExists && <div className="mt-1 text-xs text-amber-400">The file was moved or deleted.</div>}
                  {e.error && <div className="mt-2 whitespace-pre-wrap rounded-md bg-destructive/10 p-2 text-xs text-destructive">{e.error}</div>}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {(e.status === "running" || e.status === "queued") && (
                    <Button size="sm" variant="outline" onClick={() => api(`/api/exports/${e.id}`, { method: "POST" }).then(exports.reload).catch((err) => toast.error(errorText(err)))}>
                      <X /> Cancel
                    </Button>
                  )}
                  {e.status === "done" && e.fileExists && (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => setPlaying(e)}>
                        <Play /> Play
                      </Button>
                      <Button size="sm" variant="outline" asChild>
                        <a href={`/api/exports/${e.id}/file?download=1`}>
                          <Download /> Download
                        </a>
                      </Button>
                      {e.srtPath && (
                        <Button size="sm" variant="ghost" asChild>
                          <a href={`/api/exports/${e.id}/file?srt=1&download=1`}>
                            <FileText /> SRT
                          </a>
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => api(`/api/exports/${e.id}/reveal`, { method: "POST" }).catch((err) => toast.error(errorText(err)))}>
                        <FolderOpen /> Show in folder
                      </Button>
                    </>
                  )}
                  {e.status !== "running" && e.status !== "queued" && (
                    <Button size="icon-sm" variant="ghost" onClick={() => setRemoving(e)} aria-label="Remove from history">
                      <Trash2 />
                    </Button>
                  )}
                </div>
              </div>
              {(e.status === "running" || e.status === "queued") && (
                <div className="mt-3 flex items-center gap-3">
                  <Progress value={e.progress * 100} className="h-1.5" />
                  <span className="w-10 text-right text-xs tabular-nums">{Math.round(e.progress * 100)}%</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      <Dialog open={!!playing} onOpenChange={(o) => !o && setPlaying(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="truncate">{playing?.projectName}</DialogTitle>
          </DialogHeader>
          {playing && <video src={`/api/exports/${playing.id}/file`} controls autoPlay className="mx-auto max-h-[70vh] rounded-lg bg-black" style={{ aspectRatio: `${playing.width}/${playing.height}` }} />}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from export history?</AlertDialogTitle>
            <AlertDialogDescription>The record is removed. The video file stays on disk unless you tick the box.</AlertDialogDescription>
          </AlertDialogHeader>
          {removing?.fileExists && (
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={deleteFile} onCheckedChange={(v) => setDeleteFile(v === true)} className="mt-0.5" />
              <span>
                Also delete the exported file
                <span className="block break-all text-xs text-muted-foreground">{removing.outputPath}</span>
              </span>
            </label>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                try {
                  await api(`/api/exports/${removing!.id}${deleteFile ? "?deleteFile=1" : ""}`, { method: "DELETE" });
                  setDeleteFile(false);
                  void exports.reload();
                } catch (err) {
                  toast.error(errorText(err));
                }
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageBody>
  );
}
