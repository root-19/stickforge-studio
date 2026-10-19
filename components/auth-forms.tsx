"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Eye, EyeOff, Info, Loader2, ShieldCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { api, errorText } from "@/lib/client/api";
import { fetchSession, safeNext, type SessionInfo } from "./auth-context";
import { ErrorBlock } from "./common";

function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle: React.ReactNode; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="relative flex min-h-full items-center justify-center px-4 py-12">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,oklch(0.8_0.19_150/18%),transparent_55%)]" />
      <div className="relative w-full max-w-md">
        <Link href="/" className="mx-auto mb-8 flex w-fit items-center gap-2.5" aria-label="StickForge Studio home">
          <span className="grid size-10 place-items-center rounded-xl bg-brand-gradient text-sm font-black text-emerald-950 shadow-lg shadow-emerald-500/25">SF</span>
          <span className="text-lg font-semibold tracking-tight">StickForge Studio</span>
        </Link>
        <div className="rounded-2xl border border-border bg-card p-7 shadow-2xl shadow-black/40">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          <div className="mt-6">{children}</div>
        </div>
        <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div>
        <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5 text-primary" /> Accounts are stored only on this computer. Nothing is sent online.
        </p>
      </div>
    </div>
  );
}

function PasswordInput({ id, value, onChange, autoComplete, invalid }: { id: string; value: string; onChange: (v: string) => void; autoComplete: string; invalid?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        className="pr-10"
        aria-invalid={invalid || undefined}
        required
        maxLength={200}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground hover:text-foreground"
        aria-label={show ? "Hide password" : "Show password"}
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

function useSessionInfo() {
  const [info, setInfo] = useState<SessionInfo | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchSession().then((s) => !cancelled && setInfo(s), () => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return info;
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const info = useSessionInfo();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showReset, setShowReset] = useState(false);

  useEffect(() => {
    if (info?.user) router.replace(next);
    else if (info && !info.hasUsers) router.replace(`/register${params.get("next") ? `?next=${encodeURIComponent(next)}` : ""}`);
  }, [info, next, router, params]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/login", { method: "POST", json: { email, password, remember } });
      router.replace(next);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Log in to your StickForge studio."
      footer={
        info?.registrationOpen !== false ? (
          <>
            New here?{" "}
            <Link href={`/register${params.get("next") ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-medium text-primary underline-offset-2 hover:underline">
              Create an account
            </Link>
          </>
        ) : (
          "New accounts are turned off on this computer."
        )
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="login-email">Email</Label>
          <Input id="login-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={200} autoFocus />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="login-password">Password</Label>
            <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => setShowReset((s) => !s)}>
              Forgot password?
            </button>
          </div>
          <PasswordInput id="login-password" value={password} onChange={setPassword} autoComplete="current-password" invalid={!!error} />
        </div>
        {showReset && (
          <div className="flex gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Accounts are local, so there&apos;s no reset email. On this computer, open the StickForge folder and run:{" "}
              <code className="rounded bg-background px-1 py-0.5 text-foreground">npm run reset-password -- you@example.com</code>
            </span>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={remember} onCheckedChange={(v) => setRemember(v === true)} /> Keep me signed in for 30 days
        </label>
        {error && <ErrorBlock message={error} />}
        <Button type="submit" className="h-10 w-full" disabled={busy || !email || !password}>
          {busy && <Loader2 className="animate-spin" />} Log in
        </Button>
      </form>
    </AuthShell>
  );
}

const RULES: { label: string; test: (p: string) => boolean }[] = [
  { label: "At least 8 characters", test: (p) => p.length >= 8 },
  { label: "Contains a letter", test: (p) => /[A-Za-z]/.test(p) },
  { label: "Contains a number", test: (p) => /[0-9]/.test(p) },
];

export function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const info = useSessionInfo();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (info?.user) router.replace(next);
  }, [info, next, router]);

  const rulesOk = RULES.every((r) => r.test(password));
  const matches = confirm.length > 0 && confirm === password;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canSubmit = name.trim() && emailOk && rulesOk && matches && !busy;
  const closed = info && !info.registrationOpen;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/register", { method: "POST", json: { name, email, password } });
      router.replace(next);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title={info && !info.hasUsers ? "Set up your studio" : "Create your account"}
      subtitle={
        info && !info.hasUsers ? (
          <>You&apos;re the first person here, so this will be the <b className="text-foreground">owner</b> account (it can change Settings).</>
        ) : (
          "Free, local account — your projects stay private to you."
        )
      }
      footer={
        <>
          Already have an account?{" "}
          <Link href={`/login${params.get("next") ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-medium text-primary underline-offset-2 hover:underline">
            Log in
          </Link>
        </>
      }
    >
      {closed ? (
        <ErrorBlock message="New accounts are turned off on this computer. Ask the owner to enable them in Settings → Account." />
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="reg-name">Name</Label>
            <Input id="reg-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reg-email">Email</Label>
            <Input id="reg-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={200} aria-invalid={email.length > 3 && !emailOk ? true : undefined} />
            <p className="text-xs text-muted-foreground">Used only to sign in on this computer — no emails are sent.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reg-password">Password</Label>
            <PasswordInput id="reg-password" value={password} onChange={setPassword} autoComplete="new-password" />
            <ul className="grid grid-cols-1 gap-1 pt-1 text-xs sm:grid-cols-3" aria-label="Password requirements">
              {RULES.map((r) => {
                const ok = r.test(password);
                return (
                  <li key={r.label} className={cn("flex items-center gap-1", ok ? "text-emerald-400" : "text-muted-foreground")}>
                    {ok ? <Check className="size-3" /> : <X className="size-3" />} {r.label}
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reg-confirm">Confirm password</Label>
            <PasswordInput id="reg-confirm" value={confirm} onChange={setConfirm} autoComplete="new-password" invalid={confirm.length > 0 && !matches} />
            {confirm.length > 0 && !matches && <p className="text-xs text-destructive">Passwords don&apos;t match.</p>}
          </div>
          {error && <ErrorBlock message={error} />}
          <Button type="submit" className="h-10 w-full" disabled={!canSubmit}>
            {busy && <Loader2 className="animate-spin" />} Create account
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
