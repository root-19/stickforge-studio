"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, AudioLines, Clapperboard, Download, Film, FolderOpen, Mic2, MoreHorizontal, Pencil, Plus, Settings, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useApi } from "@/lib/client/hooks";
import { api, assetThumbUrl, errorText } from "@/lib/client/api";
import { formatDuration } from "@/lib/shared/timeline";
import type { InstalledVoice, Project, ProjectSummary } from "@/lib/shared/types";
import type { Settings as AppSettings } from "@/lib/server/settings";
import { EmptyState, ErrorBlock, LoadingBlock, PageBody } from "./common";
import { DeleteProjectDialog, NewProjectDialog, RenameProjectDialog } from "./project-dialogs";
import { FolderPickerDialog } from "./folder-picker";

type SystemResp = { summary: "ok" | "warn" | "error"; checks: { id: string; label: string; status: string; detail: string; fix?: string }[] };

function timeAgo(iso: string) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

function ProjectCard({ p, onRename, onDelete }: { p: ProjectSummary; onRename: () => void; onDelete: () => void }) {
  const [thumbOk, setThumbOk] = useState(true);
  return (
    <div className="group relative overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary/50">
      <Link href={`/editor/${p.id}`} className="block" aria-label={`Open ${p.name}`}>
        <div className="checkerboard relative aspect-[9/12] overflow-hidden">
          {p.thumbnailAssetId && thumbOk ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={assetThumbUrl(p.thumbnailAssetId)} alt="" className="h-full w-full object-cover opacity-90 transition group-hover:scale-[1.03]" onError={() => setThumbOk(false)} />
          ) : (
            <div className="grid h-full place-items-center">
              <Film className="size-8 text-muted-foreground/50" />
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/85 to-transparent p-3 pt-10">
            <div className="truncate font-medium">{p.name}</div>
            <div className="text-xs text-white/60">
              {p.sceneCount} scene{p.sceneCount === 1 ? "" : "s"} · {formatDuration(p.duration)} · {timeAgo(p.updatedAt)}
            </div>
          </div>
          <div className="absolute left-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white/90">{p.aspect}</div>
          {!p.folderAvailable && (
            <div className="absolute left-2 top-8 flex items-center gap-1 rounded-md bg-amber-500/90 px-2 py-0.5 text-[11px] font-medium text-black">
              <AlertTriangle className="size-3" /> Folder missing
            </div>
          )}
        </div>
      </Link>
      <div className="absolute right-2 top-2 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="secondary" aria-label={`More actions for ${p.name}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/editor/${p.id}`}>
                <Clapperboard /> Open in editor
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/voice?project=${p.id}`}>
                <Mic2 /> Voice Studio
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onRename}>
              <Pencil /> Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 /> Delete…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export function Dashboard() {
  const router = useRouter();
  const projects = useApi<ProjectSummary[]>("/api/projects");
  const system = useApi<SystemResp>("/api/system");
  const voices = useApi<{ installed: InstalledVoice[] }>("/api/voices");
  const settings = useApi<AppSettings>("/api/settings");
  const [newOpen, setNewOpen] = useState(false);
  const [openFolder, setOpenFolder] = useState(false);
  const [renaming, setRenaming] = useState<ProjectSummary | null>(null);
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null);

  const noVoices = voices.data && voices.data.installed.length === 0;
  const problems = system.data?.checks.filter((c) => c.status !== "ok") ?? [];

  return (
    <PageBody>
      <div className="relative overflow-hidden border-b border-border/60">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,oklch(0.8_0.19_150/20%),transparent_55%),radial-gradient(ellipse_at_bottom_right,oklch(0.88_0.2_128/12%),transparent_50%)]" />
        <div className="relative flex flex-wrap items-end justify-between gap-6 px-8 pb-8 pt-10">
          <div className="max-w-2xl">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">StickForge Studio</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">
              Make your next <span className="text-brand-gradient">video.</span>
            </h1>
            <p className="mt-2 text-muted-foreground">
              History, mystery and documentary videos — scripted, narrated by a free offline AI voice, captioned and exported for Shorts, Reels or YouTube — up to 4K.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="lg" onClick={() => setNewOpen(true)} className="h-11 px-5">
              <Plus /> New project
            </Button>
            <Button size="lg" variant="outline" className="h-11" onClick={() => setOpenFolder(true)}>
              <FolderOpen /> Open project folder
            </Button>
          </div>
        </div>
        <div className="relative grid gap-3 px-8 pb-8 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { href: "/voice", icon: Mic2, title: "AI Voice Studio", text: "Script → narration with Piper TTS" },
            { href: projects.data?.[0] ? `/editor/${projects.data[0].id}` : "/editor", icon: Clapperboard, title: "Video Editor", text: projects.data?.[0] ? `Continue “${projects.data[0].name}”` : "Scenes, captions, music" },
            { href: "/exports", icon: Download, title: "Export History", text: "Rendered Shorts & Reels" },
            { href: "/settings", icon: Settings, title: "Settings", text: "Folders, FFmpeg, privacy" },
          ].map((a) => (
            <Link key={a.title} href={a.href} className="group flex items-center gap-3 rounded-xl border border-border bg-card/70 p-4 backdrop-blur transition hover:border-primary/50 hover:bg-card">
              <span className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
                <a.icon className="size-5" />
              </span>
              <span className="min-w-0">
                <span className="block font-medium">{a.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{a.text}</span>
              </span>
            </Link>
          ))}
        </div>
      </div>

      <div className="space-y-8 px-8 py-8">
        {noVoices && (
          <div className="flex flex-wrap items-center gap-4 rounded-xl border border-primary/30 bg-primary/5 p-5">
            <AudioLines className="size-6 text-primary" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">Install a narrator voice to get started</div>
              <div className="text-sm text-muted-foreground">
                Voices are free Piper models (about 60–120 MB each). Downloading needs internet once; after that narration works offline.
              </div>
            </div>
            <Button asChild>
              <Link href="/voices">
                <Wand2 /> Open Voice Manager
              </Link>
            </Button>
          </div>
        )}
        {problems.length > 0 && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
            <div className="mb-2 flex items-center gap-2 font-medium">
              <AlertTriangle className="size-4 text-amber-400" /> Setup needs attention
            </div>
            <ul className="space-y-1 text-sm">
              {problems.map((c) => (
                <li key={c.id}>
                  <span className="font-medium">{c.label}:</span> <span className="text-muted-foreground">{c.fix ?? c.detail}</span>
                </li>
              ))}
            </ul>
            <Button variant="link" className="mt-1 h-auto px-0" asChild>
              <Link href="/settings#system">Open system check</Link>
            </Button>
          </div>
        )}

        <section aria-labelledby="recent-heading">
          <div className="mb-4 flex items-center justify-between">
            <h2 id="recent-heading" className="text-lg font-semibold">
              Recent projects
            </h2>
            {projects.data && projects.data.length > 0 && (
              <span className="text-sm text-muted-foreground">{projects.data.length} total</span>
            )}
          </div>
          {projects.loading && !projects.data ? (
            <LoadingBlock />
          ) : projects.error ? (
            <ErrorBlock message={projects.error} onRetry={projects.reload} />
          ) : projects.data && projects.data.length === 0 ? (
            <EmptyState
              icon={Film}
              title="No projects yet"
              action={
                <Button onClick={() => setNewOpen(true)}>
                  <Plus /> Create your first project
                </Button>
              }
            >
              A project keeps your scenes, narration, captions and exports together.
            </EmptyState>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {projects.data?.map((p) => (
                <ProjectCard key={p.id} p={p} onRename={() => setRenaming(p)} onDelete={() => setDeleting(p)} />
              ))}
            </div>
          )}
        </section>
      </div>

      <NewProjectDialog open={newOpen} onOpenChange={setNewOpen} defaultParent={settings.data?.projectsDir} />
      <RenameProjectDialog project={renaming} onOpenChange={(o) => !o && setRenaming(null)} onDone={projects.reload} />
      <DeleteProjectDialog
        project={deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        onDone={() => {
          setDeleting(null);
          void projects.reload();
        }}
      />
      <FolderPickerDialog
        open={openFolder}
        onOpenChange={setOpenFolder}
        title="Open a project folder"
        description="Choose a folder that contains project.stickforge.json — useful after moving a project or reinstalling."
        initialPath={settings.data?.projectsDir}
        confirmLabel="Open project"
        onChoose={async (folder) => {
          try {
            const p = await api<Project>("/api/projects/open-folder", { method: "POST", json: { folder } });
            router.push(`/editor/${p.id}`);
          } catch (e) {
            toast.error(errorText(e));
            throw e;
          }
        }}
      />
    </PageBody>
  );
}
