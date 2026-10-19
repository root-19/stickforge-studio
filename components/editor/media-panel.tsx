"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Copy, Film, ScrollText, FolderSymlink, Image as ImageIcon, Link2, Mic, Music, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useApi } from "@/lib/client/hooks";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, assetThumbUrl, errorText, uploadFile } from "@/lib/client/api";
import { formatBytes, formatDuration } from "@/lib/shared/timeline";
import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, AUDIO_EXTENSIONS, type Asset } from "@/lib/shared/types";
import { MediaBrowserDialog } from "./media-browser";
import { MEDIA_DRAG_TYPE } from "./timeline";

const ACCEPT = [...VIDEO_EXTENSIONS, ...IMAGE_EXTENSIONS, ...AUDIO_EXTENSIONS].join(",");

type Uploading = { name: string; progress: number };

const UPLOAD_CONCURRENCY = 3;
const AUTO_PLACE_KEY = "stickforge:autoPlace";

export function readAutoPlace(): boolean {
  try {
    return localStorage.getItem(AUTO_PLACE_KEY) !== "0";
  } catch {
    return true;
  }
}

function CreditsDialog({ projectId, open, onOpenChange }: { projectId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const credits = useApi<{ lines: string[] }>(open ? `/api/projects/${projectId}/credits` : null);
  const text = credits.data?.lines.length ? `Credits:\n${credits.data.lines.join("\n")}` : "";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Credits for your video description</DialogTitle>
          <DialogDescription>Stock files added from Pexels or Wikimedia Commons, with author and license. CC BY / BY-SA files must be credited.</DialogDescription>
        </DialogHeader>
        {credits.data && credits.data.lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">No stock files in this project yet. Your own uploads don&apos;t need credits here.</p>
        ) : (
          <Textarea readOnly value={text} rows={8} className="font-mono text-xs" aria-label="Credits text" />
        )}
        <DialogFooter>
          <Button
            disabled={!text}
            onClick={async () => {
              await navigator.clipboard.writeText(text);
              toast.success("Credits copied");
            }}
          >
            <Copy /> Copy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function useImporter(projectId: string, onImported: (a: Asset[]) => void) {
  const [uploads, setUploads] = useState<Uploading[]>([]);
  const upload = async (files: File[]) => {
    setUploads((u) => [...u, ...files.map((f) => ({ name: f.name, progress: 0 }))]);
    const results: (Asset | null)[] = new Array(files.length).fill(null);
    let next = 0;
    // Several files upload at once; each one shows up as soon as it's ready.
    const worker = async () => {
      while (next < files.length) {
        const i = next++;
        const f = files[i];
        try {
          const a = (await uploadFile(projectId, f, (p) => setUploads((u) => u.map((x) => (x.name === f.name ? { ...x, progress: p } : x))))) as Asset;
          results[i] = a;
        } catch (e) {
          toast.error(`${f.name}: ${errorText(e)}`);
        } finally {
          setUploads((u) => u.filter((x) => x.name !== f.name));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, files.length) }, worker));
    const done = results.filter((a): a is Asset => !!a);
    if (done.length) {
      toast.success(`Imported ${done.length} file${done.length === 1 ? "" : "s"}`);
      onImported(done);
    }
  };
  const link = async (paths: string[]) => {
    const done: Asset[] = [];
    for (const p of paths) {
      try {
        done.push(await api<Asset>(`/api/projects/${projectId}/assets`, { method: "POST", json: { linkPath: p } }));
      } catch (e) {
        toast.error(`${p.split(/[\\/]/).pop()}: ${errorText(e)}`);
      }
    }
    if (done.length) {
      toast.success(`Linked ${done.length} file${done.length === 1 ? "" : "s"}`);
      onImported(done);
    }
  };
  return { upload, link, uploads };
}

function AssetTile({
  a,
  onAdd,
  onDelete,
  onRelink,
}: {
  a: Asset;
  onAdd: () => void;
  onDelete: () => void;
  onRelink: () => void;
}) {
  const [thumbOk, setThumbOk] = useState(true);
  return (
    <div
      className={cn("group relative overflow-hidden rounded-lg border bg-muted/30", a.available ? "border-border" : "border-amber-500/70")}
      draggable={a.available}
      onDragStart={(e) => {
        e.dataTransfer.setData(MEDIA_DRAG_TYPE, a.id);
        e.dataTransfer.effectAllowed = "copy";
      }}
      title={`${a.name}${a.width ? ` · ${a.width}×${a.height}` : ""} · ${a.storage === "linked" ? "linked in place" : "copied into project"}`}
    >
      <div className="aspect-square bg-black/40">
        {a.hasThumbnail && thumbOk ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={assetThumbUrl(a.id)} alt="" className="h-full w-full object-cover" onError={() => setThumbOk(false)} draggable={false} />
        ) : (
          <div className="grid h-full place-items-center text-muted-foreground">{a.kind === "video" ? <Film /> : <ImageIcon />}</div>
        )}
      </div>
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-black/65 px-1.5 py-0.5 text-[10px] text-white">
        {a.kind === "video" ? <Film className="size-3" /> : <ImageIcon className="size-3" />}
        <span className="truncate">{a.kind === "video" ? formatDuration(a.duration) : `${a.width}×${a.height}`}</span>
        {a.storage === "linked" && <Link2 className="ml-auto size-3 opacity-70" aria-label="Linked" />}
      </div>
      {!a.available && (
        <button onClick={onRelink} className="absolute inset-0 grid place-items-center bg-black/70 p-1 text-center text-[11px] text-amber-300">
          <span>
            <AlertTriangle className="mx-auto mb-1 size-4" /> Missing — relink
          </span>
        </button>
      )}
      <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
        {a.available && (
          <Button size="icon-xs" onClick={onAdd} aria-label={`Add ${a.name} to timeline`}>
            <Plus />
          </Button>
        )}
        <Button size="icon-xs" variant="secondary" onClick={onDelete} aria-label={`Remove ${a.name} from project`}>
          <Trash2 />
        </Button>
      </div>
    </div>
  );
}

export function MediaPanel({
  projectId,
  assets,
  narrationAssetId,
  musicAssetId,
  onAssetsChanged,
  onImported,
  onAddScene,
  onSetNarration,
  onSetMusic,
}: {
  projectId: string;
  assets: Asset[];
  narrationAssetId: string | null;
  musicAssetId: string | null;
  onAssetsChanged: () => void;
  onImported: (added: Asset[], autoPlace: boolean) => void;
  onAddScene: (a: Asset) => void;
  onSetNarration: (a: Asset | null) => void;
  onSetMusic: (a: Asset | null) => void;
}) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [browser, setBrowser] = useState(false);
  const [relinking, setRelinking] = useState<Asset | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [autoPlace, setAutoPlace] = useState(readAutoPlace);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const importer = useImporter(projectId, (added) => onImported(added, autoPlace));
  const visuals = assets.filter((a) => a.kind !== "audio");
  const audios = assets.filter((a) => a.kind === "audio");

  const remove = async (a: Asset) => {
    try {
      await api(`/api/assets/${a.id}`, { method: "DELETE" });
      toast.success(a.storage === "managed" ? `Deleted the project copy of ${a.name}` : `Unlinked ${a.name} (original file untouched)`);
      onAssetsChanged();
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  return (
    <div
      className={cn("flex h-full flex-col", dragOver && "bg-primary/5 ring-2 ring-inset ring-primary")}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        setDragOver(false);
        if (e.dataTransfer.files.length) {
          e.preventDefault();
          void importer.upload([...e.dataTransfer.files]);
        }
      }}
    >
      <div className="grid grid-cols-2 gap-2 p-3">
        <Button onClick={() => fileInput.current?.click()}>
          <Upload /> Upload
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" onClick={() => setBrowser(true)}>
              <FolderSymlink /> Link
            </Button>
          </TooltipTrigger>
          <TooltipContent>Reference files in an approved folder without copying them</TooltipContent>
        </Tooltip>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            void importer.upload(files);
          }}
        />
      </div>
      <label className="mx-3 -mt-1 mb-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>Put new files on the timeline automatically</span>
        <Switch
          checked={autoPlace}
          onCheckedChange={(v) => {
            setAutoPlace(v);
            try {
              localStorage.setItem(AUTO_PLACE_KEY, v ? "1" : "0");
            } catch {
              /* ignore */
            }
          }}
          aria-label="Put new files on the timeline automatically"
        />
      </label>
      {importer.uploads.map((u) => (
        <div key={u.name} className="mx-3 mb-2 rounded-md border border-border p-2 text-xs">
          <div className="mb-1 truncate">Uploading {u.name}</div>
          <Progress value={u.progress * 100} className="h-1" />
        </div>
      ))}
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <h3 className="mb-2 mt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Photos &amp; clips</h3>
        {visuals.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            Drop MP4, MOV, WebM, PNG or JPG files here
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {visuals.map((a) => (
              <AssetTile key={a.id} a={a} onAdd={() => onAddScene(a)} onDelete={() => void remove(a)} onRelink={() => setRelinking(a)} />
            ))}
          </div>
        )}

        <h3 className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Audio</h3>
        <div className="space-y-1.5">
          {audios.length === 0 && (
            <div className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
              Drop WAV/MP3 files, or create narration in{" "}
              <Link href={`/voice?project=${projectId}`} className="text-primary underline underline-offset-2">
                AI Voice Studio
              </Link>
            </div>
          )}
          {audios.map((a) => {
            const isNarration = a.id === narrationAssetId;
            const isMusic = a.id === musicAssetId;
            return (
              <div key={a.id} className={cn("rounded-lg border p-2 text-xs", a.available ? "border-border" : "border-amber-500/70")}>
                <div className="flex items-center gap-2">
                  <Music className="size-3.5 shrink-0 text-fuchsia-300" />
                  <span className="min-w-0 flex-1 truncate" title={a.name}>
                    {a.name}
                  </span>
                  <span className="text-muted-foreground">{formatDuration(a.duration)}</span>
                </div>
                {!a.available ? (
                  <button className="mt-1 text-amber-300 underline" onClick={() => setRelinking(a)}>
                    File missing — relink
                  </button>
                ) : (
                  <div className="mt-1.5 flex gap-1">
                    <Button size="xs" variant={isNarration ? "default" : "outline"} onClick={() => onSetNarration(isNarration ? null : a)}>
                      <Mic /> {isNarration ? "Narration ✓" : "Narration"}
                    </Button>
                    <Button size="xs" variant={isMusic ? "default" : "outline"} onClick={() => onSetMusic(isMusic ? null : a)}>
                      <Music /> {isMusic ? "Music ✓" : "Music"}
                    </Button>
                    <Button size="icon-xs" variant="ghost" className="ml-auto" onClick={() => void remove(a)} aria-label={`Remove ${a.name}`}>
                      <Trash2 />
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <Button size="sm" variant="ghost" className="mt-3 w-full" onClick={() => setCreditsOpen(true)}>
          <ScrollText /> Credits for stock files
        </Button>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          Uploads are copied into the project&apos;s media folder ({formatBytes(assets.filter((a) => a.storage === "managed").reduce((n, a) => n + a.size, 0))}). Your
          original files are never modified.
        </p>
      </div>
      <MediaBrowserDialog open={browser} onOpenChange={setBrowser} onPick={importer.link} />
      <CreditsDialog projectId={projectId} open={creditsOpen} onOpenChange={setCreditsOpen} />
      <MediaBrowserDialog
        open={!!relinking}
        onOpenChange={(o) => !o && setRelinking(null)}
        single
        title={`Find “${relinking?.name}”`}
        onPick={async ([p]) => {
          await api(`/api/assets/${relinking!.id}`, { method: "PATCH", json: { path: p } });
          toast.success("Relinked");
          setRelinking(null);
          onAssetsChanged();
        }}
      />
    </div>
  );
}
