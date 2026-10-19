"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FolderOpen, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { api, errorText } from "@/lib/client/api";
import { ASPECTS, ASPECT_IDS, type AspectId, type Project, type ProjectSummary } from "@/lib/shared/types";
import { cn } from "@/lib/utils";
import { RatioIcon } from "./editor/ratio-picker";
import { FolderPickerDialog } from "./folder-picker";

export function NewProjectDialog({
  open,
  onOpenChange,
  defaultParent,
  then = "editor",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultParent?: string;
  then?: "editor" | "voice";
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [aspect, setAspect] = useState<AspectId>("9:16");
  const [parent, setParent] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const p = await api<Project>("/api/projects", { method: "POST", json: { name: name.trim() || "Untitled project", parentDir: parent ?? undefined, aspect } });
      toast.success(`Created “${p.name}”`);
      onOpenChange(false);
      setName("");
      router.push(then === "voice" ? `/voice?project=${p.id}` : `/editor/${p.id}`);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>A project folder holds your imported copies, narration audio and exports. Linked media stays where it is.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="project-name">Project name</Label>
              <Input id="project-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="The Mystery of the Lost Colony" maxLength={100} />
            </div>
            <div className="space-y-2">
              <Label>Video size (ratio)</Label>
              <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Video ratio">
                {ASPECT_IDS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={aspect === id}
                    onClick={() => setAspect(id)}
                    title={ASPECTS[id].hint}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-lg border p-2 text-xs transition-colors",
                      aspect === id ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/50",
                    )}
                  >
                    <RatioIcon aspect={id} size={26} />
                    <span className="font-semibold text-foreground">{ASPECTS[id].label}</span>
                    <span className="leading-tight">{ASPECTS[id].hint.split(" — ")[0]}</span>
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{ASPECTS[aspect].hint}. You can change it later in the editor.</p>
            </div>
            <div className="space-y-2">
              <Label>Save in</Label>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/30 px-3 py-1.5 text-sm text-muted-foreground" title={parent ?? defaultParent}>
                  {parent ?? defaultParent ?? "Default projects folder"}
                </div>
                <Button type="button" variant="outline" onClick={() => setPicker(true)}>
                  <FolderOpen /> Change
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="animate-spin" />} Create project
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <FolderPickerDialog
        open={picker}
        onOpenChange={setPicker}
        title="Choose where to save the project"
        initialPath={parent ?? defaultParent}
        onChoose={(p) => setParent(p)}
      />
    </>
  );
}

export function RenameProjectDialog({ project, onOpenChange, onDone }: { project: ProjectSummary | null; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const open = !!project;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o && project) setName(project.name);
        onOpenChange(o);
      }}
    >
      <DialogContent onOpenAutoFocus={() => project && setName(project.name)}>
        <DialogHeader>
          <DialogTitle>Rename project</DialogTitle>
          <DialogDescription>The project folder on disk keeps its current name.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!project) return;
            setBusy(true);
            try {
              await api(`/api/projects/${project.id}`, { method: "PATCH", json: { name } });
              toast.success("Renamed");
              onOpenChange(false);
              onDone();
            } catch (err) {
              toast.error(errorText(err));
            } finally {
              setBusy(false);
            }
          }}
          className="space-y-4"
        >
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={100} aria-label="New name" />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteProjectDialog({ project, onOpenChange, onDone }: { project: ProjectSummary | null; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [deleteFiles, setDeleteFiles] = useState(false);
  return (
    <AlertDialog open={!!project} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{project?.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            The project is removed from StickForge. Linked media files outside the project folder are never deleted.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <label className="flex items-start gap-2 rounded-md border border-border p-3 text-sm">
          <Checkbox checked={deleteFiles} onCheckedChange={(v) => setDeleteFiles(v === true)} className="mt-0.5" />
          <span>
            Also delete the project folder from disk
            <span className="block break-all text-xs text-muted-foreground">{project?.folder}</span>
            <span className="block text-xs text-muted-foreground">Includes copied media, generated narration and exports inside it.</span>
          </span>
        </label>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90"
            onClick={async () => {
              if (!project) return;
              try {
                await api(`/api/projects/${project.id}${deleteFiles ? "?deleteFiles=1" : ""}`, { method: "DELETE" });
                toast.success("Project deleted");
                setDeleteFiles(false);
                onDone();
              } catch (e) {
                toast.error(errorText(e));
              }
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
