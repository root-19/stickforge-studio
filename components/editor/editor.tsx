"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowLeft, Globe, Captions as CaptionsIcon, Check, CloudOff, Download, Images, Loader2, Mic2, Pause, Play, Redo2, Scissors, SkipBack, SkipForward, Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ApiError, api, errorText } from "@/lib/client/api";
import { useLatest } from "@/lib/client/hooks";
import { fitScenesToDuration, moveScene, splitSceneAt, timelineDuration } from "@/lib/shared/timeline";
import { ASPECTS, DEFAULT_CAPTION_Y, sceneSchema, type AspectId, type Asset, type Captions, type Project, type ProjectState, type Scene } from "@/lib/shared/types";
import { RatioPicker } from "./ratio-picker";
import { StockBrowser } from "../stock-browser";
import { readAutoPlace } from "./media-panel";
import { ErrorBlock, LoadingBlock } from "../common";
import { createClock } from "./clock";
import { Preview } from "./preview";
import { Timeline, type Selection } from "./timeline";
import { MediaPanel } from "./media-panel";
import { CaptionsPanel } from "./captions-panel";
import { Inspector } from "./inspector";
import { ExportDialog } from "./export-dialog";
import { localId, useEditorState } from "./use-editor-state";

type SaveStatus = "saved" | "unsaved" | "saving" | "error" | "conflict";
type Draft = { baseRevision: number; savedAt: string; state: ProjectState };

const draftKey = (id: string) => `stickforge:draft:${id}`;
function readDraft(id: string): Draft | null {
  try {
    const raw = localStorage.getItem(draftKey(id));
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}
function writeDraft(id: string, d: Draft | null) {
  try {
    if (d) localStorage.setItem(draftKey(id), JSON.stringify(d));
    else localStorage.removeItem(draftKey(id));
  } catch {
    /* storage full or disabled: server autosave still works */
  }
}

export function Editor({ projectId }: { projectId: string }) {
  const [loaded, setLoaded] = useState<{ project: Project; assets: Asset[] } | null>(null);
  const [assetsList, setAssetsList] = useState<Asset[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [attempt, setAttempt] = useState(0);
  // Revision this window last loaded or saved. With Cache Components, a visited
  // route stays mounted (hidden) and its effects re-run when it is shown again,
  // so this refetch picks up changes made elsewhere (e.g. Voice Studio).
  const knownRevision = useRef<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    api<{ project: Project; assets: Asset[] }>(`/api/projects/${projectId}?open=1`).then(
      (r) => {
        if (cancelled) return;
        setLoadError(null);
        // Media can change without a project revision (e.g. narration saved in Voice Studio).
        setAssetsList(r.assets);
        if (knownRevision.current !== null && r.project.revision === knownRevision.current) return;
        knownRevision.current = r.project.revision;
        setLoaded(r);
      },
      (e) => !cancelled && setLoadError(errorText(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [projectId, attempt]);
  const load = () => setAttempt((a) => a + 1);
  const refreshAssets = useCallback(async () => {
    try {
      setAssetsList(await api<Asset[]>(`/api/projects/${projectId}/assets`));
    } catch (e) {
      toast.error(errorText(e));
    }
  }, [projectId]);
  // Pick up files added in another tab/window as soon as you come back.
  useEffect(() => {
    const onFocus = () => void refreshAssets();
    const onVisible = () => document.visibilityState === "visible" && onFocus();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshAssets]);
  const onSaved = useCallback((rev: number) => {
    knownRevision.current = rev;
  }, []);

  if (loadError) {
    return (
      <div className="p-8">
        <ErrorBlock message={loadError} onRetry={load} />
        <Button variant="link" asChild className="mt-2 px-0">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </div>
    );
  }
  if (!loaded) return <LoadingBlock label="Opening project…" />;
  return (
    <EditorInner
      key={`${loaded.project.id}:${loaded.project.revision}`}
      initialProject={loaded.project}
      assetsList={assetsList}
      setAssetsList={setAssetsList}
      refreshAssets={refreshAssets}
      onSaved={onSaved}
    />
  );
}

function EditorInner({
  initialProject,
  assetsList,
  setAssetsList,
  refreshAssets,
  onSaved,
}: {
  initialProject: Project;
  assetsList: Asset[];
  setAssetsList: React.Dispatch<React.SetStateAction<Asset[]>>;
  refreshAssets: () => Promise<void>;
  onSaved: (revision: number) => void;
}) {
  const projectId = initialProject.id;
  const ed = useEditorState(initialProject.state);
  const { state, commit } = ed;
  const assets = useMemo(() => new Map(assetsList.map((a) => [a.id, a])), [assetsList]);
  const [name, setName] = useState(initialProject.name);
  const revision = useRef(initialProject.revision);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const saveStatusRef = useLatest(saveStatus);
  const [selection, setSelection] = useState<Selection>(null);
  const [leftTab, setLeftTab] = useState("media");
  const [exportOpen, setExportOpen] = useState(false);
  // This component only renders in the browser (after the project is fetched), so localStorage is available.
  const [draft, setDraft] = useState<Draft | null>(() => {
    const d = readDraft(projectId);
    return d && JSON.stringify(d.state) !== JSON.stringify(initialProject.state) ? d : null;
  });
  const clock = useMemo(() => createClock(), []);
  const [playing, setPlaying] = useState(false);
  const stateRef = useLatest(state);

  const duration = timelineDuration(state);
  const narrationAsset = state.narration ? assets.get(state.narration.assetId) : undefined;
  const narrationDuration = narrationAsset?.duration ?? null;
  const usedIds = new Set([...state.scenes.map((s) => s.assetId), state.narration?.assetId, state.music?.assetId].filter(Boolean) as string[]);
  const missing = [...usedIds].map((id) => assets.get(id)).filter((a) => !a || !a.available);

  // ---- Crash recovery: a stale draft identical to the server copy is just removed.
  useEffect(() => {
    if (!draft) writeDraft(projectId, null);
    // Only on first mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Autosave
  const saveNow = useCallback(
    async (force = false): Promise<boolean> => {
      setSaveStatus("saving");
      try {
        const p = await api<Project>(`/api/projects/${projectId}`, {
          method: "PATCH",
          json: { state: stateRef.current, baseRevision: force ? undefined : revision.current },
        });
        revision.current = p.revision;
        onSaved(p.revision);
        setSaveStatus("saved");
        writeDraft(projectId, null);
        return true;
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          setSaveStatus("conflict");
        } else {
          setSaveStatus("error");
          toast.error(`Autosave failed: ${errorText(e)}`);
        }
        return false;
      }
    },
    [projectId, stateRef, onSaved],
  );
  // Leaving the editor (route hidden or unmounted): save pending edits right away.
  useEffect(
    () => () => {
      if (saveStatusRef.current === "unsaved") void saveNow();
    },
    [saveNow, saveStatusRef],
  );
  // Autosave only reacts to real edits (version changes). Effects also re-run
  // when a hidden route is shown again; those runs must not trigger a save.
  const handledVersion = useRef(ed.version);
  const saveNowRef = useLatest(saveNow);
  useEffect(() => {
    if (ed.version === handledVersion.current) return;
    handledVersion.current = ed.version;
    if (saveStatusRef.current !== "conflict") setSaveStatus("unsaved");
    writeDraft(projectId, { baseRevision: revision.current, savedAt: new Date().toISOString(), state: stateRef.current });
    const t = setTimeout(() => {
      if (saveStatusRef.current !== "conflict") void saveNowRef.current();
    }, 1200);
    return () => clearTimeout(t);
  }, [ed.version, projectId, saveNowRef, saveStatusRef, stateRef]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (saveStatus !== "saved") e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveStatus]);

  // New imports appear instantly (from the upload response) and are placed automatically.
  const onImported = useCallback(
    (added: Asset[], autoPlace: boolean) => {
      setAssetsList((list) => [...list, ...added.filter((a) => !list.some((x) => x.id === a.id))]);
      if (!autoPlace) return;
      const visuals = added.filter((a) => a.kind !== "audio" && a.available);
      const audios = added.filter((a) => a.kind === "audio" && a.available);
      const placed: string[] = [];
      commit((s) => {
        let next = s;
        if (visuals.length) {
          const scenes = visuals.map((a) =>
            sceneSchema.parse({
              id: localId("s"),
              assetId: a.id,
              duration: a.kind === "video" ? Math.round(Math.max(0.5, Math.min(a.duration ?? 5, 15)) * 100) / 100 : 3,
              motion: a.kind === "image" ? "zoomIn" : "none",
              fit: "cover",
              clipMuted: true,
            }),
          );
          next = { ...next, scenes: [...next.scenes, ...scenes] };
          placed.push(`${visuals.length} to the timeline`);
        }
        for (const a of audios) {
          const looksLikeVoice = /narrat|voice|\bvo\b|tts|speech/i.test(a.name);
          if (looksLikeVoice && !next.narration) {
            next = { ...next, narration: { assetId: a.id, volume: 1, muted: false, offset: 0 } };
            placed.push(`${a.name} as narration`);
          } else if (!next.music) {
            next = { ...next, music: { assetId: a.id, volume: 0.25, muted: false, offset: 0, loop: true, duck: true, fadeOut: 1.5 } };
            placed.push(`${a.name} as music`);
          } else if (!next.narration) {
            next = { ...next, narration: { assetId: a.id, volume: 1, muted: false, offset: 0 } };
            placed.push(`${a.name} as narration`);
          }
        }
        return next;
      });
      if (placed.length) toast.success(`Added ${placed.join(", ")}`, { description: "Undo with Ctrl+Z" });
    },
    [commit, setAssetsList],
  );

  // ---- Playback
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const startWall = performance.now();
    const startT = clock.get() >= duration - 0.01 ? 0 : clock.get();
    const tick = () => {
      const t = startT + (performance.now() - startWall) / 1000;
      if (t >= duration) {
        clock.set(duration);
        setPlaying(false);
        return;
      }
      clock.set(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, clock, duration]);

  const seek = useCallback((t: number) => clock.set(Math.max(0, Math.min(duration, t))), [clock, duration]);
  const togglePlay = useCallback(() => {
    if (duration <= 0) return;
    setPlaying((p) => !p);
  }, [duration]);

  // ---- Edit operations
  const addScene = useCallback(
    (a: Asset, index: number | null = null) => {
      if (a.kind === "audio") return;
      const dur = a.kind === "video" ? Math.max(0.5, Math.min(a.duration ?? 5, 15)) : 3;
      const scene = sceneSchema.parse({ id: localId("s"), assetId: a.id, duration: Math.round(dur * 100) / 100, motion: a.kind === "image" ? "zoomIn" : "none", fit: "cover", clipMuted: true });
      commit((s) => {
        const scenes = [...s.scenes];
        scenes.splice(index ?? scenes.length, 0, scene);
        return { ...s, scenes };
      });
      setSelection({ kind: "scene", id: scene.id });
    },
    [commit],
  );
  const updateScene = useCallback(
    (id: string, patch: Partial<Scene>, mergeKey?: string) => commit((s) => ({ ...s, scenes: s.scenes.map((x) => (x.id === id ? { ...x, ...patch } : x)) }), mergeKey),
    [commit],
  );
  const deleteScene = useCallback(
    (id: string) => {
      commit((s) => ({ ...s, scenes: s.scenes.filter((x) => x.id !== id) }));
      setSelection(null);
    },
    [commit],
  );
  const duplicateScene = useCallback(
    (id: string) => {
      const nid = localId("s");
      commit((s) => {
        const i = s.scenes.findIndex((x) => x.id === id);
        if (i < 0) return s;
        const scenes = [...s.scenes];
        scenes.splice(i + 1, 0, { ...s.scenes[i], id: nid });
        return { ...s, scenes };
      });
      setSelection({ kind: "scene", id: nid });
    },
    [commit],
  );
  const split = useCallback(() => {
    const t = clock.get();
    const r = splitSceneAt(stateRef.current.scenes, t, (id) => assets.get(id)?.kind === "video", () => localId("s"));
    if (!r) {
      toast.message("Move the playhead inside a scene (not at its edge) to split it");
      return;
    }
    commit((s) => ({ ...s, scenes: r.scenes }));
    setSelection({ kind: "scene", id: r.newSceneId });
  }, [assets, clock, commit, stateRef]);
  const fitToNarration = useCallback(() => {
    if (!narrationDuration) return;
    const target = narrationDuration + (stateRef.current.narration?.offset ?? 0);
    commit((s) => ({ ...s, scenes: fitScenesToDuration(s.scenes, target, (id) => (assets.get(id)?.kind === "video" ? assets.get(id)?.duration ?? null : null)) }));
    toast.success(`Scenes now fill ${target.toFixed(1)}s`);
  }, [assets, commit, narrationDuration, stateRef]);

  // ---- Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveNow();
        return;
      }
      if (typing) return;
      if (e.key === " ") {
        e.preventDefault();
        togglePlay();
      } else if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) ed.redo();
        else ed.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        ed.redo();
      } else if (mod && e.key.toLowerCase() === "b") {
        e.preventDefault();
        split();
      } else if (mod && e.key.toLowerCase() === "d" && selection?.kind === "scene") {
        e.preventDefault();
        duplicateScene(selection.id);
      } else if (mod && e.key.toLowerCase() === "e") {
        e.preventDefault();
        setExportOpen(true);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selection?.kind === "scene") {
        e.preventDefault();
        deleteScene(selection.id);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selection?.kind === "caption") {
        e.preventDefault();
        commit((s) => ({ ...s, captions: { ...s.captions, items: s.captions.items.filter((c) => c.id !== selection.id) } }));
        setSelection(null);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 1 / 30;
        seek(clock.get() + (e.key === "ArrowLeft" ? -step : step));
      } else if (e.key === "Home") {
        seek(0);
      } else if (e.key === "End") {
        seek(duration);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clock, commit, deleteScene, duplicateScene, duration, ed, saveNow, seek, selection, split, togglePlay]);

  const commitCaptions = useCallback((fn: (c: Captions) => Captions, mergeKey?: string) => commit((s) => ({ ...s, captions: fn(s.captions) }), mergeKey), [commit]);

  const statusView: Record<SaveStatus, React.ReactNode> = {
    saved: (
      <>
        <Check className="size-3.5 text-emerald-400" /> Saved
      </>
    ),
    unsaved: <>Unsaved changes…</>,
    saving: (
      <>
        <Loader2 className="size-3.5 animate-spin" /> Saving…
      </>
    ),
    error: (
      <button className="flex items-center gap-1 text-destructive underline" onClick={() => void saveNow()}>
        <CloudOff className="size-3.5" /> Save failed — retry
      </button>
    ),
    conflict: (
      <>
        <AlertTriangle className="size-3.5 text-amber-400" /> Conflict
      </>
    ),
  };

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <Button size="icon-sm" variant="ghost" asChild aria-label="Back to dashboard">
          <Link href="/dashboard">
            <ArrowLeft />
          </Link>
        </Button>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={async () => {
            if (!name.trim() || name === initialProject.name) return;
            try {
              await api(`/api/projects/${projectId}`, { method: "PATCH", json: { name } });
            } catch (e) {
              toast.error(errorText(e));
            }
          }}
          className="h-8 w-64 border-transparent bg-transparent font-medium hover:border-border focus-visible:border-border"
          aria-label="Project name"
          maxLength={100}
        />
        <span className="flex items-center gap-1 text-xs text-muted-foreground" aria-live="polite">
          {statusView[saveStatus]}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <RatioPicker
            value={state.aspect}
            onChange={(aspect: AspectId) =>
              commit((s) => {
                // Move captions to the new ratio's default spot unless the user placed them elsewhere.
                const y = s.captions.style.positionY;
                const keep = Math.abs(y - DEFAULT_CAPTION_Y[s.aspect]) > 0.005;
                return { ...s, aspect, captions: { ...s.captions, style: { ...s.captions.style, positionY: keep ? y : DEFAULT_CAPTION_Y[aspect] } } };
              })
            }
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-sm" variant="ghost" onClick={ed.undo} disabled={!ed.canUndo} aria-label="Undo">
                <Undo2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Undo (Ctrl+Z)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-sm" variant="ghost" onClick={ed.redo} disabled={!ed.canRedo} aria-label="Redo">
                <Redo2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Redo (Ctrl+Shift+Z)</TooltipContent>
          </Tooltip>
          <Button size="sm" variant="outline" asChild>
            <Link href={`/voice?project=${projectId}`}>
              <Mic2 /> Voice Studio
            </Link>
          </Button>
          <Button size="sm" onClick={() => setExportOpen(true)} disabled={state.scenes.length === 0}>
            <Download /> Export
          </Button>
        </div>
      </header>

      {draft && (
        <div className="flex flex-wrap items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm">
          <AlertTriangle className="size-4 text-amber-400" />
          Unsaved changes from {new Date(draft.savedAt).toLocaleString()} were found (the app may have closed unexpectedly).
          <Button
            size="xs"
            onClick={() => {
              commit(() => draft.state);
              setDraft(null);
              toast.success("Recovered your unsaved changes");
            }}
          >
            Restore them
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              writeDraft(projectId, null);
              setDraft(null);
            }}
          >
            Discard
          </Button>
        </div>
      )}
      {saveStatus === "conflict" && (
        <div className="flex flex-wrap items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm">
          <AlertTriangle className="size-4 text-amber-400" /> This project was changed in another window or tab.
          <Button size="xs" variant="outline" onClick={() => location.reload()}>
            Reload theirs
          </Button>
          <Button size="xs" onClick={() => void saveNow(true)}>
            Keep mine (overwrite)
          </Button>
        </div>
      )}
      {missing.length > 0 && (
        <div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm">
          <AlertTriangle className="size-4 text-amber-400" />
          {missing.length} file{missing.length === 1 ? " is" : "s are"} missing ({missing.map((a) => a?.name ?? "unknown").join(", ")}). Relink {missing.length === 1 ? "it" : "them"} in the
          Media panel before exporting.
        </div>
      )}

      {/* Workspace */}
      <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)_300px] overflow-hidden">
        <aside className="flex min-h-0 flex-col border-r border-border/60 bg-card/30">
          <Tabs value={leftTab} onValueChange={setLeftTab} className="flex min-h-0 flex-1 flex-col gap-0">
            <TabsList className="m-2 grid w-auto grid-cols-3">
              <TabsTrigger value="media">
                <Images /> Media
              </TabsTrigger>
              <TabsTrigger value="stock">
                <Globe /> Stock
              </TabsTrigger>
              <TabsTrigger value="captions">
                <CaptionsIcon /> Captions
              </TabsTrigger>
            </TabsList>
            <TabsContent value="media" className="min-h-0 flex-1">
              <MediaPanel
                projectId={projectId}
                assets={assetsList}
                narrationAssetId={state.narration?.assetId ?? null}
                musicAssetId={state.music?.assetId ?? null}
                onAssetsChanged={() => void refreshAssets()}
                onImported={onImported}
                onAddScene={(a) => addScene(a)}
                onSetNarration={(a) => commit((s) => ({ ...s, narration: a ? { assetId: a.id, volume: s.narration?.volume ?? 1, muted: false, offset: 0 } : null }))}
                onSetMusic={(a) => commit((s) => ({ ...s, music: a ? { assetId: a.id, volume: 0.25, muted: false, offset: 0, loop: true, duck: true, fadeOut: 1.5 } : null }))}
              />
            </TabsContent>
            <TabsContent value="stock" className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-3 pb-3">
              <StockBrowser projectId={projectId} aspect={state.aspect} compact onImported={(a) => onImported([a], readAutoPlace())} />
            </TabsContent>
            <TabsContent value="captions" className="min-h-0 flex-1">
              <CaptionsPanel
                captions={state.captions}
                narrationId={state.narrationId}
                narrationOffset={state.narration?.offset ?? 0}
                narrationDuration={narrationDuration}
                selectedId={selection?.kind === "caption" ? selection.id : null}
                currentTime={clock.get}
                projectName={name}
                aspect={state.aspect}
                onChange={commitCaptions}
                onSelect={(id) => setSelection({ kind: "caption", id })}
                onSeek={seek}
              />
            </TabsContent>
          </Tabs>
        </aside>

        <section className="flex min-h-0 flex-col">
          <div className="min-h-0 flex-1 p-3">
            <Preview state={state} assets={assets} clock={clock} playing={playing} aspect={ASPECTS[state.aspect].w / ASPECTS[state.aspect].h} />
          </div>
          <div className="flex items-center justify-center gap-1 pb-2">
            <Button size="icon-sm" variant="ghost" onClick={() => seek(0)} aria-label="Go to start">
              <SkipBack />
            </Button>
            <Button size="icon" className="rounded-full" onClick={togglePlay} disabled={duration <= 0} aria-label={playing ? "Pause" : "Play"}>
              {playing ? <Pause /> : <Play />}
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={() => seek(duration)} aria-label="Go to end">
              <SkipForward />
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon-sm" variant="ghost" onClick={split} disabled={!state.scenes.length} aria-label="Split at playhead">
                  <Scissors />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Split at playhead (Ctrl+B)</TooltipContent>
            </Tooltip>
          </div>
        </section>

        <aside className={cn("scrollbar-thin min-h-0 overflow-y-auto border-l border-border/60 bg-card/30")}>
          <Inspector
            state={state}
            selection={selection}
            assets={assets}
            narrationDuration={narrationDuration}
            onScene={updateScene}
            onDeleteScene={deleteScene}
            onDuplicateScene={duplicateScene}
            onSplit={split}
            onNarration={(patch, key) => commit((s) => ({ ...s, narration: patch === null ? null : s.narration ? { ...s.narration, ...patch } : null }), key)}
            onMusic={(patch, key) => commit((s) => ({ ...s, music: patch === null ? null : s.music ? { ...s.music, ...patch } : null }), key)}
            onFitToNarration={fitToNarration}
          />
        </aside>
      </div>

      <div className="h-[286px] shrink-0 border-t border-border/60">
        <Timeline
          state={state}
          assets={assets}
          clock={clock}
          narrationDuration={narrationDuration}
          selection={selection}
          onSelect={(s) => {
            setSelection(s);
            if (s?.kind === "caption") setLeftTab("captions");
          }}
          onSeek={seek}
          onReorder={(from, to) => commit((s) => ({ ...s, scenes: moveScene(s.scenes, from, to) }))}
          onResizeScene={(id, patch) => updateScene(id, patch, `resize-${id}`)}
          onDropAsset={(id, index) => {
            const a = assets.get(id);
            if (a) addScene(a, index);
          }}
        />
      </div>

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        projectId={projectId}
        projectName={name}
        duration={duration}
        hasCaptions={state.captions.items.length > 0}
        aspect={state.aspect}
        beforeExport={() => (saveStatus === "saved" ? Promise.resolve(true) : saveNow())}
      />
    </div>
  );
}
