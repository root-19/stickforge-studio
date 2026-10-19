"use client";

import { Copy, Scissors, SlidersHorizontal, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Kbd } from "../common";
import { formatDuration } from "@/lib/shared/timeline";
import type { Asset, AudioTrack, MusicTrack, ProjectState, Scene } from "@/lib/shared/types";
import type { Selection } from "./timeline";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function VolumeRow({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <Field label={`${label} · ${Math.round(value * 100)}%`}>
      <Slider value={[value]} min={0} max={2} step={0.01} onValueChange={(v) => onChange(v[0])} aria-label={label} />
      {value > 1 && <p className="text-[11px] text-muted-foreground">Above 100% is applied on export; the preview plays at 100%.</p>}
    </Field>
  );
}

export function Inspector({
  state,
  selection,
  assets,
  narrationDuration,
  onScene,
  onDeleteScene,
  onDuplicateScene,
  onSplit,
  onNarration,
  onMusic,
  onFitToNarration,
}: {
  state: ProjectState;
  selection: Selection;
  assets: Map<string, Asset>;
  narrationDuration: number | null;
  onScene: (id: string, patch: Partial<Scene>, mergeKey?: string) => void;
  onDeleteScene: (id: string) => void;
  onDuplicateScene: (id: string) => void;
  onSplit: () => void;
  onNarration: (patch: Partial<AudioTrack> | null, mergeKey?: string) => void;
  onMusic: (patch: Partial<MusicTrack> | null, mergeKey?: string) => void;
  onFitToNarration: () => void;
}) {
  if (selection?.kind === "scene") {
    const s = state.scenes.find((x) => x.id === selection.id);
    if (!s) return null;
    const a = assets.get(s.assetId);
    const isVideo = a?.kind === "video";
    const maxDur = isVideo && a?.duration ? Math.max(0.2, a.duration - s.trimStart) : 600;
    return (
      <div className="space-y-4 p-4 text-sm">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Scene {state.scenes.indexOf(s) + 1}</div>
          <div className="truncate font-medium" title={a?.name}>
            {a?.name ?? "Missing media"}
          </div>
          {a && (
            <div className="text-xs text-muted-foreground">
              {a.kind} · {a.width}×{a.height}
              {isVideo && <> · source {formatDuration(a.duration)}</>}
            </div>
          )}
        </div>
        <Field label="Duration (seconds)">
          <Input
            type="number"
            min={0.2}
            max={maxDur}
            step={0.1}
            value={s.duration}
            onChange={(e) => onScene(s.id, { duration: Math.min(maxDur, Math.max(0.2, Number(e.target.value) || 0.2)) }, `dur-${s.id}`)}
          />
          {isVideo && <p className="text-[11px] text-muted-foreground">Max {maxDur.toFixed(1)}s from this trim point.</p>}
        </Field>
        {isVideo && (
          <Field label="Trim start (seconds into the clip)">
            <Input
              type="number"
              min={0}
              max={Math.max(0, (a?.duration ?? 0) - 0.2)}
              step={0.1}
              value={s.trimStart}
              onChange={(e) => {
                const ts = Math.max(0, Math.min((a?.duration ?? 0) - 0.2, Number(e.target.value) || 0));
                onScene(s.id, { trimStart: ts, duration: Math.min(s.duration, Math.max(0.2, (a?.duration ?? 0) - ts)) }, `trim-${s.id}`);
              }}
            />
          </Field>
        )}
        <Field label={`Fit to ${state.aspect} frame`}>
          <ToggleGroup type="single" variant="outline" size="sm" value={s.fit} onValueChange={(v) => v && onScene(s.id, { fit: v as Scene["fit"] })} className="w-full">
            <ToggleGroupItem value="cover" className="flex-1" title="Fill the frame, cropping edges">Fill</ToggleGroupItem>
            <ToggleGroupItem value="blur" className="flex-1" title="Whole picture over a blurred copy">Blur</ToggleGroupItem>
            <ToggleGroupItem value="contain" className="flex-1" title="Whole picture with black bars">Fit</ToggleGroupItem>
          </ToggleGroup>
          <p className="text-[11px] text-muted-foreground">Pictures are never stretched.</p>
        </Field>
        {a?.kind === "image" && (
          <Field label="Motion (Ken Burns)">
            <ToggleGroup type="single" variant="outline" size="sm" value={s.motion} onValueChange={(v) => v && onScene(s.id, { motion: v as Scene["motion"] })} className="w-full">
              <ToggleGroupItem value="none" className="flex-1">None</ToggleGroupItem>
              <ToggleGroupItem value="zoomIn" className="flex-1">Zoom in</ToggleGroupItem>
              <ToggleGroupItem value="zoomOut" className="flex-1">Zoom out</ToggleGroupItem>
            </ToggleGroup>
          </Field>
        )}
        {isVideo && a?.hasAudio && (
          <div className="space-y-3 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="clip-audio" className="text-xs">
                Use the clip&apos;s own sound
              </Label>
              <Switch id="clip-audio" checked={!s.clipMuted} onCheckedChange={(v) => onScene(s.id, { clipMuted: !v })} />
            </div>
            {!s.clipMuted && <VolumeRow label="Clip volume" value={s.clipVolume} onChange={(v) => onScene(s.id, { clipVolume: v }, `cv-${s.id}`)} />}
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          <Button size="sm" variant="outline" onClick={onSplit} title="Split at playhead (Ctrl+B)">
            <Scissors /> Split
          </Button>
          <Button size="sm" variant="outline" onClick={() => onDuplicateScene(s.id)} title="Duplicate (Ctrl+D)">
            <Copy /> Copy
          </Button>
          <Button size="sm" variant="destructive" onClick={() => onDeleteScene(s.id)} title="Delete (Del)">
            <Trash2 />
          </Button>
        </div>
      </div>
    );
  }

  const nar = state.narration;
  const mus = state.music;
  return (
    <div className="space-y-5 p-4 text-sm">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <SlidersHorizontal className="size-3.5" /> Audio mix
      </div>
      <section className="space-y-3 rounded-lg border border-border p-3">
        <div className="flex items-center justify-between">
          <span className="font-medium">Narration</span>
          {nar && (
            <div className="flex items-center gap-2 text-xs">
              Mute <Switch checked={nar.muted} onCheckedChange={(v) => onNarration({ muted: v })} aria-label="Mute narration" />
            </div>
          )}
        </div>
        {nar ? (
          <>
            <div className="truncate text-xs text-muted-foreground">
              {assets.get(nar.assetId)?.name} · {formatDuration(narrationDuration)}
            </div>
            <VolumeRow label="Volume" value={nar.volume} onChange={(v) => onNarration({ volume: v }, "nv")} />
            <Field label="Start at (seconds)">
              <Input type="number" min={0} step={0.1} value={nar.offset} onChange={(e) => onNarration({ offset: Math.max(0, Number(e.target.value) || 0) }, "no")} />
            </Field>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="flex-1" onClick={onFitToNarration} disabled={!state.scenes.length}>
                <Wand2 /> Fit scenes to narration
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onNarration(null)}>
                Remove
              </Button>
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Use AI Voice Studio, or mark an audio file as Narration in the Media panel.</p>
        )}
      </section>
      <section className="space-y-3 rounded-lg border border-border p-3">
        <div className="flex items-center justify-between">
          <span className="font-medium">Background music</span>
          {mus && (
            <div className="flex items-center gap-2 text-xs">
              Mute <Switch checked={mus.muted} onCheckedChange={(v) => onMusic({ muted: v })} aria-label="Mute music" />
            </div>
          )}
        </div>
        {mus ? (
          <>
            <div className="truncate text-xs text-muted-foreground">{assets.get(mus.assetId)?.name}</div>
            <VolumeRow label="Volume" value={mus.volume} onChange={(v) => onMusic({ volume: v }, "mv")} />
            <div className="flex items-center justify-between text-xs">
              <span>Loop to fill the video</span>
              <Switch checked={mus.loop} onCheckedChange={(v) => onMusic({ loop: v })} />
            </div>
            <div className="flex items-center justify-between text-xs">
              <span title="FFmpeg sidechain compression on export; not heard in the preview">Lower under narration (export)</span>
              <Switch checked={mus.duck} onCheckedChange={(v) => onMusic({ duck: v })} />
            </div>
            <Field label={`Fade out · ${mus.fadeOut.toFixed(1)}s`}>
              <Slider value={[mus.fadeOut]} min={0} max={6} step={0.1} onValueChange={(v) => onMusic({ fadeOut: v[0] }, "mf")} />
            </Field>
            <Button size="sm" variant="ghost" onClick={() => onMusic(null)}>
              Remove music
            </Button>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Mark an audio file as Music in the Media panel. Use only music you have rights to.</p>
        )}
      </section>
      <div className="space-y-1 rounded-lg border border-border/60 p-3 text-xs text-muted-foreground">
        <div className="mb-1 font-medium text-foreground">Shortcuts</div>
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <Kbd>Space</Kbd> <span>Play / pause</span>
          <Kbd>← →</Kbd> <span>Step 1 frame (Shift: 1 s)</span>
          <Kbd>Ctrl B</Kbd> <span>Split at playhead</span>
          <Kbd>Ctrl D</Kbd> <span>Duplicate scene</span>
          <Kbd>Del</Kbd> <span>Delete scene</span>
          <Kbd>Ctrl Z</Kbd> <span>Undo (Ctrl+Shift+Z redo)</span>
          <Kbd>Ctrl S</Kbd> <span>Save now</span>
          <Kbd>Ctrl E</Kbd> <span>Export</span>
        </div>
      </div>
    </div>
  );
}
