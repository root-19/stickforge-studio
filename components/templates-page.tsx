"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, FolderOpen, LayoutTemplate, Loader2, Mic2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useApi } from "@/lib/client/hooks";
import { api, errorText } from "@/lib/client/api";
import { TEMPLATES, type FigurePose, type ProjectTemplate } from "@/lib/shared/templates";
import { VOICE_PRESETS } from "@/lib/shared/narration";
import { formatDuration } from "@/lib/shared/timeline";
import { ASPECTS, ASPECT_IDS, type AspectId, type Project, type ProjectSummary } from "@/lib/shared/types";
import { PageBody, PageHeader } from "./common";
import { FolderPickerDialog } from "./folder-picker";
import { RatioIcon } from "./editor/ratio-picker";
import { StockBrowser } from "./stock-browser";

function Figure({ pose }: { pose: FigurePose }) {
  if (pose === "none") return null;
  const arms: Record<Exclude<FigurePose, "none">, string> = {
    stand: "M50 62 L28 86 M50 62 L72 86",
    point: "M50 62 L28 86 M50 62 L80 38",
    think: "M50 62 L28 86 M50 62 L72 70 L62 40",
    shrug: "M50 62 L30 56 L22 38 M50 62 L70 56 L78 38",
  };
  return (
    <svg viewBox="0 0 100 160" className="h-full w-auto" aria-hidden>
      <g stroke="white" strokeWidth="4" strokeLinecap="round" fill="none">
        <circle cx="50" cy="30" r="14" />
        <path d={`M50 44 L50 105 ${arms[pose]} M50 105 L32 150 M50 105 L68 150`} />
      </g>
    </svg>
  );
}

/** CSS preview of a template's first card (same layout idea as the rendered PNG). */
function TemplatePreview({ t, cardIndex = 0 }: { t: ProjectTemplate; cardIndex?: number }) {
  const card = t.cards[cardIndex];
  const a = ASPECTS[t.aspect];
  const landscape = a.w > a.h;
  return (
    <div
      className="relative mx-auto overflow-hidden rounded-lg shadow-lg ring-1 ring-white/10 [container-type:inline-size]"
      style={{ aspectRatio: `${a.w}/${a.h}`, background: `linear-gradient(135deg, ${t.colors[0]}, ${t.colors[1]})`, height: landscape ? undefined : "100%", width: landscape ? "100%" : undefined }}
    >
      <div className={cn("absolute inset-0 flex p-[6%]", landscape ? "items-center" : "flex-col items-center")}>
        <div className={cn("text-center", landscape ? "w-[62%]" : card.figure === "none" ? "mt-[38%]" : "mt-[22%]")}>
          {/* Sizes in cqw (percent of the preview width) so long titles always fit, like the rendered card. */}
          <div
            className="font-black leading-tight text-white [text-shadow:0_2px_0_#000,0_0_6px_#000]"
            style={{ fontFamily: '"Arial Black", Arial', fontSize: `${(landscape ? 6.5 : 11) * (card.title.length > 14 ? 0.75 : 1)}cqw`, overflowWrap: "anywhere" }}
          >
            {card.title}
          </div>
          {card.subtitle && (
            <div className="mt-1 font-bold" style={{ color: t.accent, textShadow: "0 1px 0 #000", fontSize: `${landscape ? 3.6 : 6.5}cqw` }}>
              {card.subtitle}
            </div>
          )}
        </div>
        <div className={cn(landscape ? "ml-auto h-[70%]" : "mt-[8%] h-[38%]")}>
          <Figure pose={card.figure} />
        </div>
      </div>
    </div>
  );
}

function UseTemplateDialog({ template, onOpenChange }: { template: ProjectTemplate | null; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const settings = useApi<{ projectsDir: string }>(template ? "/api/settings" : null);
  const [name, setName] = useState("");
  const [aspect, setAspect] = useState<AspectId | null>(null);
  const [parent, setParent] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const chosenAspect = aspect ?? template?.aspect ?? "9:16";

  const create = async (then: "editor" | "voice") => {
    if (!template) return;
    setBusy(true);
    try {
      const p = await api<Project>(`/api/templates/${template.id}/use`, {
        method: "POST",
        json: { name: name.trim() || template.name, aspect: chosenAspect, parentDir: parent ?? undefined },
      });
      toast.success(`Created “${p.name}” from template`, { description: "Replace the title cards with your own footage, and edit the script in Voice Studio." });
      onOpenChange(false);
      router.push(then === "voice" ? `/voice?project=${p.id}` : `/editor/${p.id}`);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open={!!template} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{template?.name}</DialogTitle>
            <DialogDescription>{template?.description}</DialogDescription>
          </DialogHeader>
          {template && (
            <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
              <div className="flex h-72 items-center justify-center">
                <TemplatePreview t={{ ...template, aspect: chosenAspect }} />
              </div>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="tpl-name">Project name</Label>
                  <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={template.name} maxLength={100} />
                </div>
                <div className="space-y-1.5">
                  <Label>Ratio</Label>
                  <Select value={chosenAspect} onValueChange={(v) => setAspect(v as AspectId)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ASPECT_IDS.map((id) => (
                        <SelectItem key={id} value={id}>
                          <RatioIcon aspect={id} /> {ASPECTS[id].label} <span className="text-xs text-muted-foreground">{ASPECTS[id].hint}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Save in</Label>
                  <div className="flex gap-2">
                    <div className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">{parent ?? settings.data?.projectsDir ?? "Default projects folder"}</div>
                    <Button variant="outline" size="sm" onClick={() => setPicker(true)}>
                      <FolderOpen /> Change
                    </Button>
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
                  <div className="mb-1 font-medium text-foreground">You get</div>
                  <ul className="list-disc space-y-0.5 pl-4">
                    <li>{template.cards.length} title cards with a stick figure on the timeline ({formatDuration(template.cards.reduce((n, c) => n + c.duration, 0))})</li>
                    <li>An example script ready for Voice Studio — voice preset “{VOICE_PRESETS.find((p) => p.id === template.voicePresetId)?.label}”</li>
                    <li>Caption style ({template.caption.font ?? "Arial Black"}{template.caption.background === "box" ? ", boxed" : ", outlined"}) with keyword highlights</li>
                  </ul>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => void create("voice")}>
              <Mic2 /> Create & write script
            </Button>
            <Button disabled={busy} onClick={() => void create("editor")}>
              {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} Create & open editor
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <FolderPickerDialog open={picker} onOpenChange={setPicker} title="Save the new project in" initialPath={parent ?? settings.data?.projectsDir} onChoose={(p) => setParent(p)} />
    </>
  );
}

const OTHER_SITES: { name: string; url: string; what: string; how: string; cost: string; tone: "ok" | "warn" | "no" }[] = [
  {
    name: "Pexels",
    url: "https://www.pexels.com/videos/",
    what: "Free stock videos and photos",
    how: "Built in: search it in the “Free stock footage” tab (free API key).",
    cost: "Free · commercial use allowed",
    tone: "ok",
  },
  {
    name: "Mixkit",
    url: "https://mixkit.co/free-stock-video/",
    what: "Free stock clips, music and sound effects. Its video templates are for Final Cut Pro / Premiere / After Effects.",
    how: "No API: download clips or music on mixkit.co, then Upload them in the editor. The .motn / .mogrt template files only open in those apps.",
    cost: "Free · check each item's Mixkit license",
    tone: "warn",
  },
  {
    name: "Canva",
    url: "https://www.canva.com/video-editor/templates/",
    what: "Video templates you edit inside Canva",
    how: "Templates can't be exported as editable projects. Edit in Canva, download the MP4, then Upload it here as a clip.",
    cost: "Free + Pro templates",
    tone: "warn",
  },
  {
    name: "CapCut",
    url: "https://www.capcut.com/",
    what: "Templates that only run inside the CapCut app",
    how: "Not importable. Finish in CapCut and Upload the exported MP4 here if you want to combine it with your narration.",
    cost: "Free + Pro",
    tone: "warn",
  },
  {
    name: "Motion Array",
    url: "https://motionarray.com/",
    what: "Premiere / After Effects / DaVinci templates and stock",
    how: "Requires a paid subscription for most items; downloads need an account. Upload exported clips here.",
    cost: "Paid subscription",
    tone: "no",
  },
];

export function TemplatesPage() {
  const [selected, setSelected] = useState<ProjectTemplate | null>(null);
  const [filter, setFilter] = useState<"all" | AspectId>("all");
  const projects = useApi<ProjectSummary[]>("/api/projects");
  const [stockProject, setStockProject] = useState<string | null>(null);
  const targetProject = projects.data?.find((p) => p.id === stockProject) ?? projects.data?.[0] ?? null;
  const list = TEMPLATES.filter((t) => filter === "all" || t.aspect === filter);

  return (
    <PageBody>
      <PageHeader
        title="Templates"
        description="Start a video from a ready-made StickForge template, grab free stock footage, or see how to use templates from other sites."
      />
      <div className="px-8 py-6">
        <Tabs defaultValue="templates" className="gap-5">
          <TabsList>
            <TabsTrigger value="templates">
              <LayoutTemplate /> StickForge templates
            </TabsTrigger>
            <TabsTrigger value="stock">Free stock footage</TabsTrigger>
            <TabsTrigger value="other">Other template sites</TabsTrigger>
          </TabsList>

          <TabsContent value="templates" className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {(["all", ...ASPECT_IDS] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-3 py-1",
                    filter === f ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {f !== "all" && <RatioIcon aspect={f} size={12} />} {f === "all" ? "All" : f}
                </button>
              ))}
              <span className="ml-auto text-xs text-muted-foreground">Original StickForge designs — free to use, including in monetized videos.</span>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {list.map((t) => (
                <button key={t.id} onClick={() => setSelected(t)} className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card text-left transition hover:border-primary/60">
                  <div className="checkerboard flex h-56 items-center justify-center p-4">
                    <TemplatePreview t={t} />
                  </div>
                  <div className="space-y-1.5 p-4">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="gap-1">
                        <RatioIcon aspect={t.aspect} size={10} /> {t.aspect}
                      </Badge>
                      <Badge variant="secondary">{t.category}</Badge>
                      <span className="ml-auto text-xs text-muted-foreground">{t.cards.length} cards</span>
                    </div>
                    <div className="font-medium group-hover:text-primary">{t.name}</div>
                    <p className="line-clamp-2 text-xs text-muted-foreground">{t.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="stock" className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
              <span className="text-sm font-medium">Add to project</span>
              {projects.data && projects.data.length > 0 ? (
                <Select value={targetProject?.id} onValueChange={setStockProject}>
                  <SelectTrigger className="w-72" aria-label="Project to add media to">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.data.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        <RatioIcon aspect={p.aspect} size={12} /> {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className="text-sm text-muted-foreground">Create a project (or use a template) first.</span>
              )}
              <span className="text-xs text-muted-foreground">Files are downloaded into that project&apos;s media folder with their license and credit.</span>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <StockBrowser key={targetProject?.id ?? "none"} projectId={targetProject?.id ?? null} aspect={targetProject?.aspect ?? "9:16"} showTimelineOption />
            </div>
          </TabsContent>

          <TabsContent value="other">
            <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
              These sites are great for ideas and footage, but their <b className="text-foreground">templates only work inside their own apps</b> (Canva, CapCut,
              Final Cut, Premiere…) and their terms don&apos;t allow copying them into another editor. Here&apos;s how to use each one with StickForge:
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              {OTHER_SITES.map((s) => (
                <div key={s.name} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{s.name}</span>
                    <Badge
                      variant="outline"
                      className={cn(
                        s.tone === "ok" && "border-emerald-500/40 text-emerald-300",
                        s.tone === "warn" && "border-amber-500/40 text-amber-300",
                        s.tone === "no" && "border-rose-500/40 text-rose-300",
                      )}
                    >
                      {s.cost}
                    </Badge>
                    <a href={s.url} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline">
                      Open site <ExternalLink className="size-3" />
                    </a>
                  </div>
                  <p className="mt-2 text-sm">{s.what}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{s.how}</p>
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>
      <UseTemplateDialog template={selected} onOpenChange={(o) => !o && setSelected(null)} />
    </PageBody>
  );
}
