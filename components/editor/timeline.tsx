"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertTriangle, Captions, Film, Image as ImageIcon, Mic, Music, VolumeX, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { assetThumbUrl } from "@/lib/client/api";
import { formatTimecode, placeScenes, type PlacedScene } from "@/lib/shared/timeline";
import type { Asset, ProjectState, Scene } from "@/lib/shared/types";
import { useClockTime, type Clock } from "./clock";

const TRACK_LABEL_W = 92;
export const MEDIA_DRAG_TYPE = "application/x-stickforge-asset";

export type Selection = { kind: "scene"; id: string } | { kind: "caption"; id: string } | { kind: "narration" } | { kind: "music" } | null;

function Playhead({ clock, pps }: { clock: Clock; pps: number }) {
  const t = useClockTime(clock);
  return (
    <div className="pointer-events-none absolute bottom-0 top-0 z-20 w-px bg-white" style={{ left: t * pps }}>
      <div className="absolute -left-[5px] -top-0 h-3 w-[11px] rounded-b-sm bg-white" />
    </div>
  );
}

function Ruler({ duration, pps, onSeek }: { duration: number; pps: number; onSeek: (t: number, drag: boolean) => void }) {
  const step = pps >= 120 ? 0.5 : pps >= 60 ? 1 : pps >= 25 ? 2 : pps >= 12 ? 5 : 10;
  const ticks: number[] = [];
  for (let t = 0; t <= duration + step; t += step) ticks.push(t);
  const handle = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const move = (ev: PointerEvent) => onSeek(Math.max(0, (ev.clientX - rect.left) / pps), true);
    onSeek(Math.max(0, (e.clientX - rect.left) / pps), false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", () => window.removeEventListener("pointermove", move), { once: true });
  };
  return (
    <div className="relative h-6 cursor-pointer select-none border-b border-border/70 text-[10px] text-muted-foreground" onPointerDown={handle} title="Click or drag to move the playhead (arrow keys also work)">
      {ticks.map((t) => (
        <div key={t} className="absolute top-0 h-full border-l border-border/70 pl-1" style={{ left: t * pps }}>
          {Number.isInteger(t) ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}` : ""}
        </div>
      ))}
    </div>
  );
}

function SceneBlock({
  scene,
  asset,
  pps,
  selected,
  onSelect,
  onResize,
}: {
  scene: PlacedScene;
  asset: Asset | undefined;
  pps: number;
  selected: boolean;
  onSelect: () => void;
  onResize: (edge: "start" | "end", deltaSeconds: number, done: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: scene.id });
  const width = Math.max(8, scene.duration * pps);
  const startDrag = (edge: "start" | "end") => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const x0 = e.clientX;
    const move = (ev: PointerEvent) => onResize(edge, (ev.clientX - x0) / pps, false);
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      onResize(edge, (ev.clientX - x0) / pps, true);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };
  const missing = !asset || !asset.available;
  return (
    <div
      ref={setNodeRef}
      style={{ width, transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "group relative h-full shrink-0 overflow-hidden rounded-md border bg-track-video/40 outline-none",
        selected ? "border-white ring-2 ring-primary" : "border-track-video/70",
        isDragging && "z-30 opacity-80",
        missing && "border-amber-500 bg-amber-500/20",
      )}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      {...attributes}
      {...listeners}
      aria-label={`Scene ${scene.index + 1}: ${asset?.name ?? "missing"}, ${scene.duration.toFixed(1)} seconds`}
    >
      {asset?.hasThumbnail && (
        <div className="absolute inset-0 bg-repeat-x opacity-70" style={{ backgroundImage: `url(${assetThumbUrl(asset.id)})`, backgroundSize: "auto 100%" }} />
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 truncate bg-black/55 px-1.5 py-0.5 text-[10px] text-white">
        {missing ? <AlertTriangle className="size-3 text-amber-400" /> : asset?.kind === "video" ? <Film className="size-3" /> : <ImageIcon className="size-3" />}
        <span className="truncate">{scene.duration.toFixed(1)}s</span>
        {asset?.kind === "video" && scene.clipMuted && asset.hasAudio && <VolumeX className="ml-auto size-3 opacity-70" />}
      </div>
      {asset?.kind === "video" && (
        <div onPointerDown={startDrag("start")} className="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-white/0 hover:bg-white/40" title="Trim start" />
      )}
      <div onPointerDown={startDrag("end")} className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-white/0 hover:bg-white/40" title="Change duration" />
    </div>
  );
}

export function Timeline({
  state,
  assets,
  clock,
  narrationDuration,
  selection,
  onSelect,
  onSeek,
  onReorder,
  onResizeScene,
  onDropAsset,
}: {
  state: ProjectState;
  assets: Map<string, Asset>;
  clock: Clock;
  narrationDuration: number | null;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onSeek: (t: number) => void;
  onReorder: (from: number, to: number) => void;
  onResizeScene: (id: string, patch: Partial<Scene>, done: boolean) => void;
  onDropAsset: (assetId: string, index: number | null) => void;
}) {
  const placed = useMemo(() => placeScenes(state.scenes), [state.scenes]);
  const videoDuration = placed.length ? placed[placed.length - 1].end : 0;
  const musicDuration = state.music ? videoDuration : 0;
  const total = Math.max(videoDuration, (state.narration?.offset ?? 0) + (narrationDuration ?? 0), 10);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [pps, setPps] = useState(40);
  const fittedOnce = useRef(false);
  const resizeStart = useRef<{ id: string; duration: number; trimStart: number } | null>(null);
  const [dropHover, setDropHover] = useState(false);

  // Fit the whole timeline on first render.
  useEffect(() => {
    if (fittedOnce.current || !scrollRef.current || videoDuration === 0) return;
    fittedOnce.current = true;
    const w = scrollRef.current.clientWidth - TRACK_LABEL_W - 40;
    setPps(Math.max(8, Math.min(160, w / Math.max(5, videoDuration))));
  }, [videoDuration]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = state.scenes.findIndex((s) => s.id === e.active.id);
    const to = state.scenes.findIndex((s) => s.id === e.over!.id);
    if (from >= 0 && to >= 0) onReorder(from, to);
  };

  const width = total * pps + 200;

  const resize = (s: PlacedScene) => (edge: "start" | "end", delta: number, done: boolean) => {
    if (!resizeStart.current || resizeStart.current.id !== s.id) resizeStart.current = { id: s.id, duration: s.duration, trimStart: s.trimStart };
    const base = resizeStart.current;
    const a = assets.get(s.assetId);
    const src = a?.kind === "video" ? a.duration ?? null : null;
    let patch: Partial<Scene>;
    if (edge === "end") {
      let d = Math.max(0.2, base.duration + delta);
      if (src !== null) d = Math.min(d, Math.max(0.2, src - base.trimStart));
      patch = { duration: Math.round(d * 100) / 100 };
    } else {
      const maxShift = base.duration - 0.2;
      const shift = Math.max(-base.trimStart, Math.min(maxShift, delta));
      patch = { trimStart: Math.round((base.trimStart + shift) * 100) / 100, duration: Math.round((base.duration - shift) * 100) / 100 };
    }
    onResizeScene(s.id, patch, done);
    if (done) resizeStart.current = null;
  };

  const trackRow = (label: string, Icon: React.ComponentType<{ className?: string }>, color: string, children: React.ReactNode, height = "h-14") => (
    <div className={cn("relative flex border-b border-border/50", height)}>
      <div
        className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-border/60 bg-card px-2 text-[11px] font-medium text-muted-foreground"
        style={{ width: TRACK_LABEL_W }}
      >
        <Icon className={cn("size-3.5", color)} /> {label}
      </div>
      <div className="relative flex-1 py-1.5">{children}</div>
    </div>
  );

  return (
    <div className="flex h-full flex-col bg-card/40">
      <div className="flex items-center gap-3 border-b border-border/60 px-3 py-1.5">
        <TimeReadout clock={clock} total={videoDuration} />
        <div className="ml-auto flex w-48 items-center gap-2">
          <Button size="icon-xs" variant="ghost" aria-label="Zoom out timeline" onClick={() => setPps((p) => Math.max(4, p / 1.4))}>
            <ZoomOut />
          </Button>
          <Slider value={[Math.log(pps)]} min={Math.log(4)} max={Math.log(300)} step={0.01} onValueChange={(v) => setPps(Math.exp(v[0]))} aria-label="Timeline zoom" />
          <Button size="icon-xs" variant="ghost" aria-label="Zoom in timeline" onClick={() => setPps((p) => Math.min(300, p * 1.4))}>
            <ZoomIn />
          </Button>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="scrollbar-thin relative min-h-0 flex-1 overflow-auto"
        onWheel={(e) => {
          if (e.ctrlKey) {
            e.preventDefault();
            setPps((p) => Math.max(4, Math.min(300, p * (e.deltaY < 0 ? 1.15 : 1 / 1.15))));
          }
        }}
        onClick={() => onSelect(null)}
      >
        <div style={{ width: width + TRACK_LABEL_W }} className="relative">
          <div className="flex">
            <div className="sticky left-0 z-10 shrink-0 border-b border-r border-border/60 bg-card" style={{ width: TRACK_LABEL_W }} />
            <div className="relative flex-1">
              <Ruler duration={total} pps={pps} onSeek={(t) => onSeek(t)} />
            </div>
          </div>
          {trackRow(
            "Video",
            Film,
            "text-sky-300",
            <div
              className={cn("flex h-full items-stretch gap-0.5 rounded-md", dropHover && "bg-primary/10 ring-1 ring-primary")}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes(MEDIA_DRAG_TYPE)) {
                  e.preventDefault();
                  setDropHover(true);
                }
              }}
              onDragLeave={() => setDropHover(false)}
              onDrop={(e) => {
                setDropHover(false);
                const id = e.dataTransfer.getData(MEDIA_DRAG_TYPE);
                if (!id) return;
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                const t = (e.clientX - rect.left) / pps;
                const idx = placed.findIndex((s) => t < s.start + s.duration / 2);
                onDropAsset(id, idx < 0 ? null : idx);
              }}
              style={{ minWidth: Math.max(200, videoDuration * pps + 120) }}
            >
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={state.scenes.map((s) => s.id)} strategy={horizontalListSortingStrategy}>
                  {placed.map((s) => (
                    <SceneBlock
                      key={s.id}
                      scene={s}
                      asset={assets.get(s.assetId)}
                      pps={pps}
                      selected={selection?.kind === "scene" && selection.id === s.id}
                      onSelect={() => onSelect({ kind: "scene", id: s.id })}
                      onResize={resize(s)}
                    />
                  ))}
                </SortableContext>
              </DndContext>
              {placed.length === 0 && (
                <div className="flex items-center px-3 text-xs text-muted-foreground">Drag photos or clips here, or click + in the Media panel</div>
              )}
            </div>,
            "h-16",
          )}
          {trackRow(
            "Voice",
            Mic,
            "text-emerald-300",
            state.narration && narrationDuration ? (
              <button
                className={cn(
                  "absolute inset-y-1.5 overflow-hidden rounded-md border bg-track-voice/35 px-2 text-left text-[10px] text-white",
                  selection?.kind === "narration" ? "border-white ring-2 ring-primary" : "border-track-voice/70",
                  state.narration.muted && "opacity-40",
                )}
                style={{ left: state.narration.offset * pps, width: narrationDuration * pps }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect({ kind: "narration" });
                }}
              >
                <span className="truncate">{assets.get(state.narration.assetId)?.name ?? "Narration"}</span>
              </button>
            ) : (
              <div className="flex h-full items-center px-3 text-xs text-muted-foreground">No narration — use AI Voice Studio or the Audio tab</div>
            ),
          )}
          {trackRow(
            "Music",
            Music,
            "text-fuchsia-300",
            state.music ? (
              <button
                className={cn(
                  "absolute inset-y-1.5 overflow-hidden rounded-md border bg-track-music/35 px-2 text-left text-[10px] text-white",
                  selection?.kind === "music" ? "border-white ring-2 ring-primary" : "border-track-music/70",
                  state.music.muted && "opacity-40",
                )}
                style={{ left: 0, width: Math.max(40, musicDuration * pps) }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect({ kind: "music" });
                }}
              >
                <span className="truncate">
                  {assets.get(state.music.assetId)?.name ?? "Music"} {state.music.loop ? "· loop" : ""}
                </span>
              </button>
            ) : (
              <div className="flex h-full items-center px-3 text-xs text-muted-foreground">No music</div>
            ),
            "h-11",
          )}
          {trackRow(
            "Captions",
            Captions,
            "text-amber-300",
            <>
              {state.captions.items.map((c) => (
                <button
                  key={c.id}
                  className={cn(
                    "absolute inset-y-1.5 overflow-hidden whitespace-nowrap rounded border bg-track-caption/30 px-1 text-left text-[10px] text-white",
                    selection?.kind === "caption" && selection.id === c.id ? "border-white ring-2 ring-primary" : "border-track-caption/60",
                    !state.captions.enabled && "opacity-40",
                  )}
                  style={{ left: c.start * pps, width: Math.max(4, (c.end - c.start) * pps - 1) }}
                  title={c.text}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect({ kind: "caption", id: c.id });
                    onSeek(c.start + 0.01);
                  }}
                >
                  {c.text}
                </button>
              ))}
              {state.captions.items.length === 0 && <div className="flex h-full items-center px-3 text-xs text-muted-foreground">No captions</div>}
            </>,
            "h-10",
          )}
          <div className="pointer-events-none absolute inset-y-0" style={{ left: TRACK_LABEL_W, right: 0 }}>
            <Playhead clock={clock} pps={pps} />
          </div>
        </div>
      </div>
    </div>
  );
}

function TimeReadout({ clock, total }: { clock: Clock; total: number }) {
  const t = useClockTime(clock, 1 / 30);
  return (
    <div className="font-mono text-xs tabular-nums">
      <span className="text-foreground">{formatTimecode(t)}</span>
      <span className="text-muted-foreground"> / {formatTimecode(total)}</span>
    </div>
  );
}
