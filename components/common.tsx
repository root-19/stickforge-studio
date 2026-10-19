"use client";

import { AlertTriangle, CheckCircle2, CircleHelp, Loader2, ShieldAlert, ShieldCheck, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { CommercialUse, JobStatus } from "@/lib/shared/types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border/60 px-8 pb-5 pt-7">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function PageBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("scrollbar-thin h-full overflow-y-auto", className)}>{children}</div>;
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 px-6 py-12 text-center", className)}>
      <div className="mb-3 grid size-12 place-items-center rounded-full bg-muted">
        <Icon className="size-5 text-muted-foreground" />
      </div>
      <h3 className="font-medium">{title}</h3>
      {children && <div className="mt-1 max-w-md text-sm text-muted-foreground">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function LoadingBlock({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div className={cn("flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground", className)} role="status">
      <Loader2 className="size-4 animate-spin" /> {label}
    </div>
  );
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
      <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1 whitespace-pre-wrap break-words">{message}</div>
      {onRetry && (
        <button className="shrink-0 text-xs font-medium underline underline-offset-2" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

const LICENSE_STYLE: Record<CommercialUse, { label: string; className: string; icon: React.ComponentType<{ className?: string }>; tip: string }> = {
  allowed: {
    label: "Commercial OK",
    className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    icon: ShieldCheck,
    tip: "The model card lists a public-domain/CC0 dataset. Still verify the full license before monetizing.",
  },
  attribution: {
    label: "Commercial w/ credit",
    className: "border-sky-500/40 bg-sky-500/10 text-sky-300",
    icon: ShieldCheck,
    tip: "Commercial use allowed with attribution (e.g. CC BY 4.0). Credit the dataset in your video description.",
  },
  "share-alike": {
    label: "Share-alike",
    className: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    icon: ShieldAlert,
    tip: "CC BY-SA: commercial use allowed with credit, but derived works may need the same license. Check before monetizing.",
  },
  "non-commercial": {
    label: "Non-commercial",
    className: "border-rose-500/40 bg-rose-500/10 text-rose-300",
    icon: ShieldAlert,
    tip: "License forbids commercial use. Do not use for monetized YouTube/Facebook videos.",
  },
  unclear: {
    label: "License unclear",
    className: "border-zinc-500/40 bg-zinc-500/10 text-zinc-300",
    icon: CircleHelp,
    tip: "The model card points to an external license. Read it before using commercially.",
  },
};

export function LicenseBadge({ use, className }: { use: CommercialUse; className?: string }) {
  const s = LICENSE_STYLE[use];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={cn("gap-1 font-medium", s.className, className)}>
          <s.icon className="size-3" />
          {s.label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{s.tip}</TooltipContent>
    </Tooltip>
  );
}

export function JobStatusBadge({ status }: { status: JobStatus }) {
  const map: Record<JobStatus, { label: string; className: string; icon: React.ComponentType<{ className?: string }> }> = {
    queued: { label: "Queued", className: "border-zinc-500/40 text-zinc-300", icon: Loader2 },
    running: { label: "Running", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300", icon: Loader2 },
    done: { label: "Done", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300", icon: CheckCircle2 },
    error: { label: "Failed", className: "border-rose-500/40 bg-rose-500/10 text-rose-300", icon: XCircle },
    cancelled: { label: "Cancelled", className: "border-amber-500/40 bg-amber-500/10 text-amber-300", icon: AlertTriangle },
  };
  const s = map[status];
  return (
    <Badge variant="outline" className={cn("gap-1", s.className)}>
      <s.icon className={cn("size-3", status === "running" && "animate-spin")} />
      {s.label}
    </Badge>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{children}</kbd>
  );
}
