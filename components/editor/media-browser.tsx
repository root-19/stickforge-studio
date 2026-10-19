"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronUp, File, Film, Folder, Image as ImageIcon, Loader2, Music } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { api, errorText } from "@/lib/client/api";
import { formatBytes } from "@/lib/shared/timeline";
import type { AssetKind } from "@/lib/shared/types";
import { ErrorBlock } from "../common";

type Listing = {
  path: string | null;
  parent: string | null;
  roots: string[];
  dirs: { name: string; path: string }[];
  files: { name: string; path: string; kind: AssetKind; size: number }[];
};

/** Browse approved media folders and pick files to reference in place (no copying). */
type BrowserProps = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPick: (paths: string[]) => Promise<void>;
  single?: boolean;
  title?: string;
};

export function MediaBrowserDialog(props: BrowserProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <MediaBrowserContent {...props} />}
    </Dialog>
  );
}

const fetchListing = (p: string | null) => api<Listing>(`/api/fs/browse${p ? `?path=${encodeURIComponent(p)}` : ""}`);

function MediaBrowserContent({ onOpenChange, onPick, single = false, title = "Link media from your folders" }: BrowserProps) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = async (p: string | null) => {
    setLoading(true);
    setError(null);
    try {
      setListing(await fetchListing(p));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    let cancelled = false;
    fetchListing(null)
      .then(
        (l) => !cancelled && setListing(l),
        (e) => !cancelled && setError(errorText(e)),
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (p: string) =>
    setPicked((s) => {
      const n = new Set(single ? [] : s);
      if (s.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });

  const icon = (k: AssetKind) => (k === "video" ? <Film className="size-4 text-sky-300" /> : k === "image" ? <ImageIcon className="size-4 text-emerald-300" /> : <Music className="size-4 text-fuchsia-300" />);

  return (
    <>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Linked files stay where they are — StickForge only stores a reference. Only folders approved in Settings are shown.
          </DialogDescription>
        </DialogHeader>
        {listing && listing.roots.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No media folders approved yet.{" "}
            <Link href="/settings" className="text-primary underline underline-offset-2">
              Add a media folder in Settings
            </Link>{" "}
            (e.g. your Videos or Pictures folder), or upload files instead.
          </div>
        ) : (
          <div className="scrollbar-thin h-80 overflow-y-auto rounded-lg border border-border bg-muted/20 p-1">
            {loading ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 size-4 animate-spin" /> Loading…
              </div>
            ) : (
              <ul className="text-sm">
                {listing?.path && (
                  <li>
                    <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent" onClick={() => void load(listing.parent)}>
                      <ChevronUp className="size-4" /> {listing.parent ? "Up" : "Approved folders"}
                      <span className="ml-auto truncate text-xs text-muted-foreground">{listing.path}</span>
                    </button>
                  </li>
                )}
                {listing?.dirs.map((d) => (
                  <li key={d.path}>
                    <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent" onClick={() => void load(d.path)}>
                      <Folder className="size-4 text-emerald-300/80" /> <span className="truncate">{d.name}</span>
                    </button>
                  </li>
                ))}
                {listing?.files.map((f) => (
                  <li key={f.path}>
                    <label className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent">
                      <Checkbox checked={picked.has(f.path)} onCheckedChange={() => toggle(f.path)} />
                      {icon(f.kind)}
                      <span className="truncate">{f.name}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{formatBytes(f.size)}</span>
                    </label>
                  </li>
                ))}
                {listing && listing.path && listing.dirs.length === 0 && listing.files.length === 0 && (
                  <li className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                    <File className="size-4" /> No supported media here
                  </li>
                )}
              </ul>
            )}
          </div>
        )}
        {error && <ErrorBlock message={error} />}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={picked.size === 0 || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onPick([...picked]);
                onOpenChange(false);
              } catch (e) {
                setError(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Loader2 className="animate-spin" />} {single ? "Use this file" : `Link ${picked.size || ""} file${picked.size === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </>
  );
}
