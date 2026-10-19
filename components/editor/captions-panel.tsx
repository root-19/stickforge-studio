"use client";

import { useRef, useState } from "react";
import { Download, Info, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api, errorText } from "@/lib/client/api";
import { captionsFromScript, captionsFromSentences, parseSrt, sortAndValidateCaptions, toSrt } from "@/lib/shared/captions";
import { CAPTION_FONTS, type AspectId, type Caption, type CaptionStyle, type Captions, type Narration, type SentenceTiming } from "@/lib/shared/types";
import { localId } from "./use-editor-state";

const TIMING_LABEL: Record<Captions["timing"], string> = {
  sentence: "Sentence start/end measured from the narration audio; word groups inside sentences are estimated.",
  estimated: "Timings are estimated from text length — check them against the audio.",
  manual: "Edited by you.",
};

function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/x-subrip;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function CaptionsPanel({
  captions,
  narrationId,
  narrationOffset,
  narrationDuration,
  selectedId,
  currentTime,
  projectName,
  aspect,
  onChange,
  onSelect,
  onSeek,
}: {
  captions: Captions;
  narrationId: string | null;
  narrationOffset: number;
  narrationDuration: number | null;
  selectedId: string | null;
  currentTime: () => number;
  projectName: string;
  aspect: AspectId;
  onChange: (fn: (c: Captions) => Captions, mergeKey?: string) => void;
  onSelect: (id: string) => void;
  onSeek: (t: number) => void;
}) {
  const [busy, setBusy] = useState(false);
  const srtInput = useRef<HTMLInputElement | null>(null);
  const style = captions.style;
  const setStyle = (patch: Partial<CaptionStyle>, key?: string) => onChange((c) => ({ ...c, style: { ...c.style, ...patch } }), key ? `style-${key}` : undefined);
  const setItem = (id: string, patch: Partial<Caption>, key: string) =>
    onChange((c) => ({ ...c, timing: "manual", items: c.items.map((x) => (x.id === id ? { ...x, ...patch } : x)) }), `cap-${id}-${key}`);

  const rebuild = async () => {
    if (!narrationId) return;
    setBusy(true);
    try {
      const r = await api<{ narration: Narration; timings: SentenceTiming[] }>(`/api/narrations/${narrationId}`);
      let items: Caption[];
      let timing: Captions["timing"];
      if (r.timings.length) {
        items = captionsFromSentences(r.timings, style.wordsPerCaption);
        timing = "sentence";
      } else {
        items = captionsFromScript(r.narration.script, narrationDuration ?? r.narration.duration ?? 0, style.wordsPerCaption);
        timing = "estimated";
      }
      items = items.map((c) => ({ ...c, start: c.start + narrationOffset, end: c.end + narrationOffset }));
      onChange((c) => ({ ...c, items, timing }));
      toast.success(`Created ${items.length} captions`);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const items = captions.items;

  return (
    <div className="scrollbar-thin h-full space-y-5 overflow-y-auto p-3 text-sm">
      <div className="flex items-center justify-between">
        <Label htmlFor="cap-on" className="font-medium">
          Show captions
        </Label>
        <Switch id="cap-on" checked={captions.enabled} onCheckedChange={(v) => onChange((c) => ({ ...c, enabled: v }))} />
      </div>

      <div className="space-y-2">
        <div className="flex gap-2">
          <Button size="sm" className="flex-1" disabled={!narrationId || busy} onClick={() => void rebuild()}>
            <RefreshCw className={cn(busy && "animate-spin")} /> From narration
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const t = currentTime();
              const c: Caption = { id: localId("c"), start: Math.round(t * 100) / 100, end: Math.round((t + 1.5) * 100) / 100, text: "New caption" };
              onChange((x) => ({ ...x, timing: "manual", items: sortAndValidateCaptions([...x.items, c]) }));
              onSelect(c.id);
            }}
          >
            <Plus /> At playhead
          </Button>
        </div>
        {!narrationId && <p className="text-xs text-muted-foreground">Send narration from AI Voice Studio to build captions automatically.</p>}
        {captions.items.length > 0 && (
          <p className="flex gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3 shrink-0" /> {TIMING_LABEL[captions.timing]}
          </p>
        )}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={!captions.items.length}
            onClick={() => downloadText(`${projectName.replace(/[^\w\- ]+/g, "_") || "captions"}.srt`, toSrt(captions.items, style.uppercase))}
          >
            <Download /> Export SRT
          </Button>
          <Button size="sm" variant="ghost" onClick={() => srtInput.current?.click()}>
            <Upload /> Import SRT
          </Button>
          <input
            ref={srtInput}
            type="file"
            accept=".srt"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              try {
                const parsed = parseSrt(await f.text());
                onChange((c) => ({ ...c, timing: "manual", items: parsed }));
                toast.success(`Imported ${parsed.length} captions`);
              } catch (err) {
                toast.error(errorText(err));
              }
            }}
          />
        </div>
      </div>

      <section className="space-y-3 rounded-lg border border-border p-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Style</h3>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Font</Label>
            <Select value={style.font} onValueChange={(v) => setStyle({ font: v as CaptionStyle["font"] })}>
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CAPTION_FONTS.map((f) => (
                  <SelectItem key={f} value={f} style={{ fontFamily: f }}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Background</Label>
            <ToggleGroup type="single" size="sm" variant="outline" value={style.background} onValueChange={(v) => v && setStyle({ background: v as CaptionStyle["background"] })} className="w-full">
              <ToggleGroupItem value="outline" className="flex-1">Outline</ToggleGroupItem>
              <ToggleGroupItem value="box" className="flex-1">Box</ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
        {(
          [
            ["Size", "fontSize", 36, 160, 1, (v: number) => `${v}px`],
            ["Vertical position", "positionY", 0.15, 0.85, 0.01, (v: number) => `${Math.round(v * 100)}%`],
            ["Side safe margin", "marginX", 0.04, 0.2, 0.01, (v: number) => `${Math.round(v * 100)}%`],
            ["Outline width", "outlineWidth", 0, 12, 0.5, (v: number) => `${v}px`],
            ["Words per caption", "wordsPerCaption", 1, 8, 1, (v: number) => String(v)],
          ] as const
        ).map(([label, key, min, max, step, fmt]) => (
          <div key={key} className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span>{label}</span>
              <span className="font-mono text-muted-foreground">{fmt(style[key])}</span>
            </div>
            <Slider value={[style[key]]} min={min} max={max} step={step} onValueChange={(v) => setStyle({ [key]: v[0] } as Partial<CaptionStyle>, key)} aria-label={label} />
          </div>
        ))}
        {aspect === "9:16" && style.positionY > 0.78 && <p className="text-xs text-amber-400">Captions this low can be covered by the Shorts/Reels title and buttons.</p>}
        <div className="grid grid-cols-2 gap-2">
          <label className="flex items-center justify-between gap-2 text-xs">
            Text colour
            <input type="color" value={style.textColor} onChange={(e) => setStyle({ textColor: e.target.value.toUpperCase() }, "textColor")} className="h-7 w-10 cursor-pointer rounded border border-border bg-transparent" />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs">
            Highlight
            <input type="color" value={style.highlightColor} onChange={(e) => setStyle({ highlightColor: e.target.value.toUpperCase() }, "hl")} className="h-7 w-10 cursor-pointer rounded border border-border bg-transparent" />
          </label>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span>UPPERCASE</span>
          <Switch checked={style.uppercase} onCheckedChange={(v) => setStyle({ uppercase: v })} aria-label="Uppercase captions" />
        </div>
        <div className="flex items-center justify-between text-xs">
          <span>Highlight numbers (years, dates)</span>
          <Switch checked={style.highlightNumbers} onCheckedChange={(v) => setStyle({ highlightNumbers: v })} aria-label="Highlight numbers" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="keywords" className="text-xs">
            Highlight keywords (comma separated)
          </Label>
          <Input
            id="keywords"
            defaultValue={style.keywords.join(", ")}
            key={style.keywords.join("|")}
            placeholder="Roanoke, Croatoan, pharaoh"
            onBlur={(e) => setStyle({ keywords: e.target.value.split(",").map((k) => k.trim()).filter(Boolean).slice(0, 200) })}
          />
        </div>
      </section>

      <section className="space-y-1.5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Captions ({captions.items.length})</h3>
        {items.map((c) => (
          <div
            key={c.id}
            className={cn("rounded-md border p-2", selectedId === c.id ? "border-primary bg-primary/5" : "border-border")}
            onClick={() => onSelect(c.id)}
          >
            <div className="mb-1 flex items-center gap-1">
              <button className="font-mono text-[10px] text-muted-foreground hover:text-foreground" onClick={() => onSeek(c.start + 0.01)} aria-label="Jump to caption">
                ▶
              </button>
              <Input
                type="number"
                step={0.05}
                min={0}
                value={c.start}
                onChange={(e) => setItem(c.id, { start: Math.max(0, Number(e.target.value)) }, "start")}
                className="h-6 w-20 px-1 font-mono text-[11px]"
                aria-label="Start (seconds)"
              />
              <span className="text-muted-foreground">→</span>
              <Input
                type="number"
                step={0.05}
                min={0}
                value={c.end}
                onChange={(e) => setItem(c.id, { end: Math.max(0, Number(e.target.value)) }, "end")}
                className={cn("h-6 w-20 px-1 font-mono text-[11px]", c.end <= c.start && "border-destructive")}
                aria-label="End (seconds)"
              />
              <Button
                size="icon-xs"
                variant="ghost"
                className="ml-auto"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange((x) => ({ ...x, items: x.items.filter((i) => i.id !== c.id) }));
                }}
                aria-label="Delete caption"
              >
                <Trash2 />
              </Button>
            </div>
            <Textarea
              value={c.text}
              rows={1}
              onChange={(e) => setItem(c.id, { text: e.target.value.slice(0, 500) }, "text")}
              className="min-h-0 resize-none px-2 py-1 text-xs"
              aria-label="Caption text"
            />
          </div>
        ))}
      </section>
    </div>
  );
}
