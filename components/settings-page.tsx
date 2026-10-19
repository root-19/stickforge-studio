"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, FolderOpen, Loader2, Plus, RefreshCw, ShieldCheck, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApi } from "@/lib/client/hooks";
import { api, errorText } from "@/lib/client/api";
import type { Settings } from "@/lib/server/settings";
import { ErrorBlock, LoadingBlock, PageBody, PageHeader } from "./common";
import { FolderPickerDialog } from "./folder-picker";
import { useCurrentUser } from "./auth-context";
import { Switch } from "@/components/ui/switch";

function UnownedProjects() {
  const list = useApi<{ id: string; name: string; folder: string; createdAt: string }[]>("/api/projects/unowned");
  const [busy, setBusy] = useState(false);
  if (!list.data || list.data.length === 0) return null;
  const act = async (action: "claim" | "remove") => {
    setBusy(true);
    try {
      const r = await api<{ count: number }>("/api/projects/unowned", { method: "POST", json: { action, ids: list.data!.map((p) => p.id) } });
      toast.success(action === "claim" ? `Added ${r.count} project(s) to your account` : `Removed ${r.count} project(s) from StickForge (files kept on disk)`);
      void list.reload();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-5 rounded-lg border border-border p-3">
      <div className="text-sm font-medium">Projects from before accounts ({list.data.length})</div>
      <p className="text-xs text-muted-foreground">These were made before anyone signed up, so they aren&apos;t shown on any dashboard.</p>
      <ul className="mt-2 space-y-1 text-xs">
        {list.data.map((p) => (
          <li key={p.id} className="flex gap-2">
            <span className="font-medium">{p.name}</span>
            <span className="truncate text-muted-foreground" title={p.folder}>
              {p.folder}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void act("claim")}>
          Add to my account
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act("remove")}>
          Remove from StickForge (keep files)
        </Button>
      </div>
    </div>
  );
}

function AccountSection({ allowRegistration, onToggleRegistration }: { allowRegistration: boolean; onToggleRegistration: (v: boolean) => void }) {
  const user = useCurrentUser();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  return (
    <section id="account" className="rounded-xl border border-border bg-card p-5">
      <h2 className="font-semibold">Account</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Signed in as <b className="text-foreground">{user.name}</b> ({user.email}) · {user.role === "owner" ? "Owner" : "Member"}. Accounts live only on this
        computer; each account sees only its own projects.
      </p>
      <form
        className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api("/api/auth/password", { method: "POST", json: { currentPassword: current, newPassword: next } });
            toast.success("Password changed. Other sessions were signed out.");
            setCurrent("");
            setNext("");
          } catch (err) {
            toast.error(errorText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="cur-pw">Current password</Label>
          <Input id="cur-pw" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-pw">New password</Label>
          <Input id="new-pw" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="8+ characters, a letter and a number" />
        </div>
        <Button type="submit" variant="outline" disabled={busy || !current || next.length < 8}>
          {busy && <Loader2 className="animate-spin" />} Change password
        </Button>
      </form>
      {user.role === "owner" && (
        <div className="mt-5 flex items-center justify-between gap-4 rounded-lg border border-border p-3">
          <div className="text-sm">
            <div className="font-medium">Allow new accounts</div>
            <div className="text-xs text-muted-foreground">When off, only existing accounts can log in on this computer.</div>
          </div>
          <Switch checked={allowRegistration} onCheckedChange={onToggleRegistration} aria-label="Allow new accounts" />
        </div>
      )}
      {user.role === "owner" && <UnownedProjects />}
      <p className="mt-3 text-xs text-muted-foreground">
        Forgot a password? In the StickForge folder run <code className="rounded bg-muted px-1">npm run reset-password -- email@example.com</code>.
      </p>
    </section>
  );
}

type Check = { id: string; label: string; status: "ok" | "warn" | "error"; detail: string; fix?: string };

function Section({ id, title, description, children }: { id?: string; title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="rounded-xl border border-border bg-card p-5">
      <h2 className="font-semibold">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function FolderRow({ label, value, hint, onPick, onClear }: { label: string; value: string; hint?: string; onPick: () => void; onClear?: () => void }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <div className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/30 px-3 py-1.5 font-mono text-xs leading-5" title={value}>
          {value || <span className="text-muted-foreground">Not set</span>}
        </div>
        <Button variant="outline" size="sm" onClick={onPick}>
          <FolderOpen /> Change
        </Button>
        {onClear && value && (
          <Button variant="ghost" size="sm" onClick={onClear}>
            Reset
          </Button>
        )}
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function SettingsPage() {
  const settings = useApi<Settings & { pexelsApiKeySet: boolean }>("/api/settings");
  const system = useApi<{ checks: Check[] }>("/api/system");
  const [picker, setPicker] = useState<null | "projectsDir" | "voicesDir" | "exportDir" | "media">(null);
  const [ffmpegPath, setFfmpegPath] = useState<string | null>(null);
  const [ffprobePath, setFfprobePath] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [pexelsKey, setPexelsKey] = useState("");

  const save = async (patch: Partial<Settings>) => {
    try {
      const s = await api<Settings & { pexelsApiKeySet: boolean }>("/api/settings", { method: "PUT", json: patch });
      settings.setData(s);
      toast.success("Settings saved");
      void system.reload();
    } catch (e) {
      toast.error(errorText(e));
      throw e;
    }
  };

  const s = settings.data;
  const isOwner = useCurrentUser()?.role === "owner";
  return (
    <PageBody>
      <PageHeader title="Settings" description="Everything is stored on this computer. No account, no API keys, no telemetry." />
      <div className="mx-auto max-w-4xl space-y-6 px-8 py-6">
        {settings.error && <ErrorBlock message={settings.error} onRetry={settings.reload} />}
        {s && <AccountSection allowRegistration={s.allowRegistration} onToggleRegistration={(v) => void save({ allowRegistration: v })} />}
        {s && !isOwner && (
          <p className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
            Folder, FFmpeg and stock settings are shared by everyone on this computer and can only be changed by the owner account.
          </p>
        )}
        {!s ? (
          <LoadingBlock />
        ) : (
          <>
            <Section title="Folders">
              <FolderRow label="Projects folder" value={s.projectsDir} hint="New projects are created here. Each project gets its own folder." onPick={() => setPicker("projectsDir")} />
              <FolderRow label="Voice models folder" value={s.voicesDir} hint="Piper voices (.onnx + .onnx.json). You can also drop your own Piper voices here." onPick={() => setPicker("voicesDir")} />
              <FolderRow
                label="Default export folder"
                value={s.exportDir}
                hint="Empty = each project's own “exports” folder."
                onPick={() => setPicker("exportDir")}
                onClear={() => void save({ exportDir: "" })}
              />
            </Section>

            <Section
              title="Media folders"
              description="Folders StickForge may read media from when you link files in place (no copying). The app cannot read anything outside these folders and your project folders."
            >
              {s.mediaFolders.length === 0 && <p className="text-sm text-muted-foreground">No media folders yet. Uploading files still works without one.</p>}
              <ul className="space-y-2">
                {s.mediaFolders.map((f) => (
                  <li key={f} className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5">
                    <span className="min-w-0 flex-1 truncate font-mono text-xs" title={f}>
                      {f}
                    </span>
                    <Button size="icon-xs" variant="ghost" aria-label={`Remove ${f}`} onClick={() => void save({ mediaFolders: s.mediaFolders.filter((x) => x !== f) })}>
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
              <Button variant="outline" size="sm" onClick={() => setPicker("media")}>
                <Plus /> Add media folder
              </Button>
            </Section>

            <Section title="FFmpeg" description="Used for importing media, MP3 conversion and video export. Leave empty to detect automatically (PATH or winget install).">
              {(["ffmpegPath", "ffprobePath"] as const).map((key) => {
                const local = key === "ffmpegPath" ? ffmpegPath : ffprobePath;
                const set = key === "ffmpegPath" ? setFfmpegPath : setFfprobePath;
                return (
                  <div key={key} className="space-y-1.5">
                    <Label htmlFor={key}>{key === "ffmpegPath" ? "ffmpeg.exe path" : "ffprobe.exe path"}</Label>
                    <div className="flex gap-2">
                      <Input id={key} value={local ?? s[key]} onChange={(e) => set(e.target.value)} placeholder="Auto-detect" className="font-mono text-xs" />
                      <Button size="sm" variant="outline" disabled={local === null} onClick={() => void save({ [key]: local ?? "" }).then(() => set(null))}>
                        Save
                      </Button>
                    </div>
                  </div>
                );
              })}
            </Section>

            <Section
              title="Stock footage (Pexels)"
              description={
                <>
                  Optional. A free key from{" "}
                  <a href="https://www.pexels.com/api/" target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
                    pexels.com/api
                  </a>{" "}
                  enables Pexels search in Templates → Free stock footage and the editor&apos;s Stock tab. Wikimedia Commons works without a key.
                </>
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className={s.pexelsApiKeySet ? "text-sm text-emerald-400" : "text-sm text-muted-foreground"}>
                  {s.pexelsApiKeySet ? "✓ Key saved on this computer" : "No key saved"}
                </span>
                <Input
                  type="password"
                  autoComplete="off"
                  placeholder={s.pexelsApiKeySet ? "Paste a new key to replace it" : "Paste your Pexels API key"}
                  value={pexelsKey}
                  onChange={(e) => setPexelsKey(e.target.value)}
                  className="w-72"
                  aria-label="Pexels API key"
                />
                <Button size="sm" variant="outline" disabled={pexelsKey.trim().length < 20} onClick={() => void save({ pexelsApiKey: pexelsKey }).then(() => setPexelsKey(""))}>
                  Save key
                </Button>
                {s.pexelsApiKeySet && (
                  <Button size="sm" variant="ghost" onClick={() => void save({ pexelsApiKey: "" })}>
                    Remove key
                  </Button>
                )}
              </div>
            </Section>

            <Section
              title="Privacy & internet use"
              description={
                <span className="flex items-start gap-2">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-400" />
                  StickForge runs on 127.0.0.1 only and rejects requests from other websites. Scripts, media, narration and exports never leave this computer.
                </span>
              }
            >
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                <li>
                  <b className="text-foreground">Needs internet:</b> downloading a voice model and “Refresh voice list” (huggingface.co/rhasspy/piper-voices), and stock
                  footage search/download (Pexels, Wikimedia Commons — only your search words are sent) — all only when you click them.
                </li>
                <li>
                  <b className="text-foreground">Works offline:</b> narration (Piper TTS), captions, editing, preview and export (FFmpeg).
                </li>
                <li>No analytics or telemetry are collected.</li>
                <li>Voice licenses come from each model card. Verify commercial-use permission before monetizing.</li>
              </ul>
            </Section>
          </>
        )}

        <Section
          id="system"
          title="System check"
          description="Checks that everything StickForge needs is installed and writable."
        >
          <Button
            size="sm"
            variant="outline"
            disabled={checking}
            onClick={async () => {
              setChecking(true);
              await system.reload();
              setChecking(false);
            }}
          >
            {checking ? <Loader2 className="animate-spin" /> : <RefreshCw />} Run again
          </Button>
          {system.error && <ErrorBlock message={system.error} />}
          {!system.data ? (
            <LoadingBlock />
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {system.data.checks.map((c) => (
                <li key={c.id} className="flex gap-3 p-3">
                  {c.status === "ok" ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" />
                  ) : c.status === "warn" ? (
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
                  ) : (
                    <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                  )}
                  <div className="min-w-0 text-sm">
                    <div className="font-medium">{c.label}</div>
                    <div className="break-all text-xs text-muted-foreground">{c.detail}</div>
                    {c.fix && <div className="mt-1 text-xs text-amber-300">{c.fix}</div>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="About & licenses">
          <ul className="space-y-1 text-sm text-muted-foreground">
            <li>StickForge Studio — local-first editor for Shorts & Reels.</li>
            <li>Piper voices: individual dataset licenses (see each voice&apos;s model card in the Voice Manager).</li>
            <li>Phonemizer: espeak-ng compiled to WebAssembly (@diffusionstudio/piper-wasm, MIT wrapper; espeak-ng is GPL-3.0).</li>
            <li>ONNX Runtime (MIT) runs the voice models on your CPU.</li>
            <li>FFmpeg is a separate program you install (LGPL/GPL depending on the build).</li>
          </ul>
        </Section>
      </div>

      <FolderPickerDialog
        open={picker !== null}
        onOpenChange={(o) => !o && setPicker(null)}
        title={
          picker === "media" ? "Add a media folder" : picker === "projectsDir" ? "Projects folder" : picker === "voicesDir" ? "Voice models folder" : "Default export folder"
        }
        initialPath={picker && picker !== "media" ? s?.[picker] || null : null}
        onChoose={async (p) => {
          if (!s || !picker) return;
          if (picker === "media") await save({ mediaFolders: [...s.mediaFolders, p] });
          else await save({ [picker]: p });
        }}
      />
    </PageBody>
  );
}
