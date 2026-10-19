"use client";

import { useState } from "react";
import { CheckCircle2, ExternalLink, Film, Globe, ImageIcon, KeyRound, Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api, errorText, waitForJob } from "@/lib/client/api";
import { useApi } from "@/lib/client/hooks";
import { formatDuration } from "@/lib/shared/timeline";
import type { AspectId, Asset, CommercialUse, JobInfo } from "@/lib/shared/types";
import { ErrorBlock, LicenseBadge } from "./common";

type Provider = "pexels" | "commons";
type Kind = "video" | "image";
type Orientation = "portrait" | "landscape" | "square" | "any";

type StockItem = {
  provider: Provider;
  id: string;
  kind: Kind;
  title: string;
  thumbUrl: string;
  previewUrl: string | null;
  width: number;
  height: number;
  duration: number | null;
  sizeBytes: number | null;
  author: string;
  pageUrl: string;
  license: string;
  commercialUse: CommercialUse;
};

const ORIENTATION_FOR: Record<AspectId, Orientation> = { "9:16": "portrait", "16:9": "landscape", "1:1": "square", "4:5": "portrait" };

const SUGGESTIONS = ["ancient Egypt", "old map", "castle", "ocean storm", "forest fog", "city night", "library", "desert"];

function PexelsKeySetup({ onSaved }: { onSaved: () => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">
      <div className="flex items-center gap-2 font-medium">
        <KeyRound className="size-4 text-primary" /> Pexels needs a free API key (one time)
      </div>
      <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
        <li>
          Create a free account and get your key at{" "}
          <a href="https://www.pexels.com/api/" target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
            pexels.com/api
          </a>{" "}
          (takes about a minute, no payment).
        </li>
        <li>Paste it here. It is stored only on this computer and is never shown in the browser again.</li>
      </ol>
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api("/api/settings", { method: "PUT", json: { pexelsApiKey: key } });
            toast.success("Pexels key saved");
            onSaved();
          } catch (err) {
            toast.error(errorText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste your Pexels API key" type="password" autoComplete="off" aria-label="Pexels API key" />
        <Button type="submit" disabled={busy || key.trim().length < 20}>
          {busy && <Loader2 className="animate-spin" />} Save key
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">No key? Use Wikimedia Commons above — it works without one.</p>
    </div>
  );
}

function ResultTile({
  item,
  state,
  onAdd,
  compact,
}: {
  item: StockItem;
  state: "idle" | "adding" | "added";
  onAdd: () => void;
  compact: boolean;
}) {
  const [hover, setHover] = useState(false);
  const blocked = item.commercialUse === "non-commercial";
  return (
    <div
      className="group relative overflow-hidden rounded-lg border border-border bg-black/40"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={`${item.title} — ${item.author} · ${item.license} · ${item.width}×${item.height}`}
    >
      <div className={cn("relative", compact ? "aspect-square" : "aspect-video")}>
        {hover && item.previewUrl ? (
          <video src={item.previewUrl} autoPlay muted loop playsInline className="h-full w-full object-cover" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/stock/thumb?url=${encodeURIComponent(item.thumbUrl)}`} alt={item.title} loading="lazy" className="h-full w-full object-cover" />
        )}
        <div className="absolute left-1.5 top-1.5 flex gap-1">
          {item.kind === "video" && item.duration ? (
            <span className="rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">{formatDuration(item.duration)}</span>
          ) : null}
          {!compact && (
            <span className="rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
              {item.width}×{item.height}
            </span>
          )}
        </div>
        <div className="absolute right-1.5 top-1.5">
          {state === "added" ? (
            <span className="flex items-center gap-1 rounded-md bg-emerald-500/90 px-2 py-0.5 text-[11px] font-medium text-emerald-950">
              <CheckCircle2 className="size-3" /> Added
            </span>
          ) : (
            <Button size="xs" onClick={onAdd} disabled={state === "adding" || blocked} aria-label={`Add ${item.title} to project`}>
              {state === "adding" ? <Loader2 className="animate-spin" /> : <Plus />} Add
            </Button>
          )}
        </div>
      </div>
      <div className="space-y-1 p-2">
        <div className="truncate text-xs font-medium">{item.title}</div>
        <div className="flex items-center justify-between gap-2">
          <a href={item.pageUrl} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1 truncate text-[11px] text-muted-foreground hover:text-foreground">
            <span className="truncate">{item.author}</span> <ExternalLink className="size-3 shrink-0" />
          </a>
          {!compact && <LicenseBadge use={item.commercialUse} className="shrink-0 text-[10px]" />}
        </div>
        {compact && <div className="truncate text-[10px] text-muted-foreground">{item.license}</div>}
      </div>
    </div>
  );
}

/**
 * Search free stock footage and photos (Pexels, Wikimedia Commons) and add them
 * to a project. Used on the Templates page and in the editor's Stock tab.
 */
export function StockBrowser({
  projectId,
  aspect,
  compact = false,
  onImported,
  showTimelineOption = false,
}: {
  projectId: string | null;
  aspect: AspectId;
  compact?: boolean;
  onImported?: (asset: Asset) => void;
  showTimelineOption?: boolean;
}) {
  const settings = useApi<{ pexelsApiKeySet: boolean }>("/api/settings");
  const [provider, setProvider] = useState<Provider>("commons");
  const [kind, setKind] = useState<Kind>("video");
  const [orientation, setOrientation] = useState<Orientation>(ORIENTATION_FOR[aspect]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<StockItem[]>([]);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [lastQuery, setLastQuery] = useState<{ q: string; page: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, "adding" | "added">>({});
  const [addToTimeline, setAddToTimeline] = useState(true);

  const needsKey = provider === "pexels" && settings.data && !settings.data.pexelsApiKeySet;

  const search = async (query: string, page = 1) => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ provider, kind, q: query.trim(), orientation, page: String(page) });
      const r = await api<{ items: StockItem[]; nextPage: number | null }>(`/api/stock/search?${params}`);
      setResults((cur) => (page === 1 ? r.items : [...cur, ...r.items.filter((i) => !cur.some((c) => c.id === i.id))]));
      setNextPage(r.nextPage);
      setLastQuery({ q: query.trim(), page });
    } catch (e) {
      setError(errorText(e));
      if (page === 1) setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const add = async (item: StockItem) => {
    if (!projectId) {
      toast.error("Choose a project first");
      return;
    }
    const key = `${item.provider}:${item.id}`;
    setStates((s) => ({ ...s, [key]: "adding" }));
    try {
      const job = await api<JobInfo>("/api/stock/import", {
        method: "POST",
        json: { projectId, provider: item.provider, kind: item.kind, id: item.id, addToTimeline: showTimelineOption && addToTimeline },
      });
      const final = await waitForJob(job.id);
      if (final.status !== "done") throw new Error(final.error ?? "Download failed");
      setStates((s) => ({ ...s, [key]: "added" }));
      const asset = final.result as Asset;
      toast.success(`Added “${item.title}”`, { description: `${item.license} · ${item.author}` });
      onImported?.(asset);
    } catch (e) {
      setStates((s) => {
        const n = { ...s };
        delete n[key];
        return n;
      });
      toast.error(errorText(e));
    }
  };

  return (
    <div className={cn("space-y-3", compact ? "text-sm" : "")}>
      <div className={cn("flex flex-wrap items-center gap-2", compact && "flex-col items-stretch [&_[data-slot=toggle-group-item]]:min-w-0 [&_[data-slot=toggle-group-item]]:px-1.5 [&_[data-slot=toggle-group-item]]:text-xs")}>
        <ToggleGroup type="single" variant="outline" size="sm" className={cn(compact && "w-full")} value={provider} onValueChange={(v) => v && (setProvider(v as Provider), setResults([]), setNextPage(null))} aria-label="Source">
          <ToggleGroupItem value="commons" className="flex-1">{compact ? "Wikimedia" : "Wikimedia Commons"}</ToggleGroupItem>
          <ToggleGroupItem value="pexels" className="flex-1">Pexels</ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup type="single" variant="outline" size="sm" className={cn(compact && "w-full")} value={kind} onValueChange={(v) => v && (setKind(v as Kind), setResults([]), setNextPage(null))} aria-label="Media type">
          <ToggleGroupItem value="video" className="flex-1">
            <Film /> Videos
          </ToggleGroupItem>
          <ToggleGroupItem value="image" className="flex-1">
            <ImageIcon /> Photos
          </ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup type="single" variant="outline" size="sm" className={cn(compact && "w-full")} value={orientation} onValueChange={(v) => v && setOrientation(v as Orientation)} aria-label="Orientation">
          <ToggleGroupItem value="portrait" className="flex-1">Portrait</ToggleGroupItem>
          <ToggleGroupItem value="landscape" className="flex-1">{compact ? "Wide" : "Landscape"}</ToggleGroupItem>
          <ToggleGroupItem value="square" className="flex-1">Square</ToggleGroupItem>
          <ToggleGroupItem value="any" className="flex-1">Any</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {needsKey ? (
        <PexelsKeySetup onSaved={() => void settings.reload()} />
      ) : (
        <>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void search(q);
            }}
          >
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={provider === "commons" ? "e.g. pyramids, Roman coin, 1920s street" : "e.g. foggy forest, old book, storm"} aria-label="Search stock media" />
            <Button type="submit" disabled={loading || !q.trim()}>
              {loading ? <Loader2 className="animate-spin" /> : <Search />} Search
            </Button>
          </form>
          {!lastQuery && (
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setQ(s);
                    void search(s);
                  }}
                  className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:border-primary/60 hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          {showTimelineOption && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox checked={addToTimeline} onCheckedChange={(v) => setAddToTimeline(v === true)} /> Also put added clips at the end of the timeline
            </label>
          )}
        </>
      )}

      {error && <ErrorBlock message={error} />}
      {results.length > 0 && (
        <div className={cn("grid gap-2", compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5")}>
          {results.map((item) => (
            <ResultTile key={`${item.provider}:${item.id}`} item={item} compact={compact} state={states[`${item.provider}:${item.id}`] ?? "idle"} onAdd={() => void add(item)} />
          ))}
        </div>
      )}
      {lastQuery && !loading && results.length === 0 && !error && <p className="py-6 text-center text-sm text-muted-foreground">No results — try other words or “Any” orientation.</p>}
      {nextPage && (
        <Button variant="outline" className="w-full" disabled={loading} onClick={() => lastQuery && void search(lastQuery.q, nextPage)}>
          {loading && <Loader2 className="animate-spin" />} Load more
        </Button>
      )}

      <div className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
        <Globe className="mt-0.5 size-3 shrink-0" />
        <span>
          Needs internet. Only your search words are sent to the provider; thumbnails load from their servers.{" "}
          {provider === "pexels" ? (
            <>
              <a href="https://www.pexels.com" target="_blank" rel="noreferrer" className="underline underline-offset-2">
                Photos and videos provided by Pexels
              </a>{" "}
              — free for commercial use (Pexels License); crediting the creator is appreciated.
            </>
          ) : (
            <>
              Files from{" "}
              <a href="https://commons.wikimedia.org" target="_blank" rel="noreferrer" className="underline underline-offset-2">
                Wikimedia Commons
              </a>{" "}
              each have their own license. CC BY / BY-SA need credit — StickForge saves it for you (Media → Credits). Non-commercial files can&apos;t be added.
            </>
          )}
        </span>
      </div>
    </div>
  );
}
