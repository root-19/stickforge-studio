"use client";

import { useEffect, useState } from "react";
import { ChevronUp, Folder, HardDrive, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, errorText } from "@/lib/client/api";
import { ErrorBlock } from "./common";

type DirListing = { path: string | null; parent: string | null; dirs: { name: string; path: string }[] };

/**
 * In-app folder chooser (browsers cannot reveal real folder paths, so the
 * local server lists sub-folders — folder names only, never file contents).
 */
type PickerProps = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  initialPath?: string | null;
  confirmLabel?: string;
  onChoose: (path: string) => void | Promise<void>;
};

export function FolderPickerDialog(props: PickerProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <FolderPickerContent {...props} />}
    </Dialog>
  );
}

const fetchDirs = (p: string | null) => api<DirListing>(`/api/fs/dirs${p ? `?path=${encodeURIComponent(p)}` : ""}`);

function FolderPickerContent({ onOpenChange, title, description, initialPath, confirmLabel = "Choose this folder", onChoose }: PickerProps) {
  const [listing, setListing] = useState<DirListing | null>(null);
  const [typed, setTyped] = useState(initialPath ?? "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = async (p: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const l = await fetchDirs(p);
      setListing(l);
      setTyped(l.path ?? "");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    // A folder that doesn't exist yet falls back to the drive list.
    fetchDirs(initialPath ?? null)
      .catch(() => fetchDirs(null))
      .then(
        (l) => {
          if (cancelled) return;
          setListing(l);
          if (l.path) setTyped(l.path);
        },
        (e) => !cancelled && setError(errorText(e)),
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [initialPath]);

  const choose = async () => {
    const p = typed.trim();
    if (!p) return;
    setBusy(true);
    try {
      await onChoose(p);
      onOpenChange(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void load(typed.trim() || null);
          }}
        >
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="C:\Users\you\Videos" aria-label="Folder path" />
          <Button type="submit" variant="outline">
            Go
          </Button>
        </form>
        <div className="scrollbar-thin h-72 overflow-y-auto rounded-lg border border-border bg-muted/20 p-1">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" /> Loading…
            </div>
          ) : (
            <ul>
              {listing?.path && (
                <li>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                    onClick={() => void load(listing.parent)}
                  >
                    <ChevronUp className="size-4" /> {listing.parent ? "Up one level" : "Drives & common folders"}
                  </button>
                </li>
              )}
              {listing?.dirs.map((d) => (
                <li key={d.path}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                    onDoubleClick={() => void load(d.path)}
                    onClick={() => void load(d.path)}
                  >
                    {/^[A-Z]:\\$/.test(d.path) ? <HardDrive className="size-4 text-muted-foreground" /> : <Folder className="size-4 text-emerald-300/80" />}
                    <span className="truncate">{d.name}</span>
                  </button>
                </li>
              ))}
              {listing && listing.dirs.length === 0 && <li className="px-2 py-6 text-center text-sm text-muted-foreground">No sub-folders</li>}
            </ul>
          )}
        </div>
        {error && <ErrorBlock message={error} />}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void choose()} disabled={!typed.trim() || busy}>
            {busy && <Loader2 className="animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </>
  );
}
