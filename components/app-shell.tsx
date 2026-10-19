"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AudioLines, Clapperboard, Download, Home, LayoutDashboard, LayoutTemplate, LogOut, Mic2, Settings, UserRound, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/client/api";
import { useCurrentUser } from "./auth-context";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type NavItem = { href: string; label: string; icon: LucideIcon; match: (p: string) => boolean };

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, match: (p) => p.startsWith("/dashboard") },
  { href: "/templates", label: "Templates", icon: LayoutTemplate, match: (p) => p.startsWith("/templates") },
  { href: "/voice", label: "AI Voice Studio", icon: Mic2, match: (p) => p.startsWith("/voice") && !p.startsWith("/voices") },
  { href: "/editor", label: "Video Editor", icon: Clapperboard, match: (p) => p.startsWith("/editor") },
  { href: "/voices", label: "Voice Manager", icon: AudioLines, match: (p) => p.startsWith("/voices") },
  { href: "/exports", label: "Export Queue", icon: Download, match: (p) => p.startsWith("/exports") },
  { href: "/settings", label: "Settings", icon: Settings, match: (p) => p.startsWith("/settings") },
];

function Logo({ compact }: { compact: boolean }) {
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5 px-1 py-1" aria-label="StickForge Studio dashboard">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-gradient text-[13px] font-black text-emerald-950 shadow-lg shadow-emerald-500/25">
        SF
      </span>
      {!compact && (
        <span className="leading-tight">
          <span className="block text-sm font-semibold tracking-tight">StickForge</span>
          <span className="block text-[11px] text-muted-foreground">Studio · local</span>
        </span>
      )}
    </Link>
  );
}

function Sidebar({ pathname }: { pathname: string | null }) {
  // The editor gets an icon-only rail to leave room for the timeline.
  const compact = !!pathname?.startsWith("/editor/");
  return (
    <nav
      aria-label="Main"
      className={cn(
        "flex shrink-0 flex-col gap-1 border-r border-sidebar-border bg-sidebar p-2 text-sidebar-foreground",
        compact ? "w-14 items-center" : "w-56",
      )}
    >
      <div className={cn("mb-3", compact ? "" : "px-1 pt-1")}>
        <Logo compact={compact} />
      </div>
      {NAV.map((item) => {
        const active = pathname !== null && item.match(pathname);
        const link = (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg text-sm transition-colors",
              compact ? "size-10 justify-center" : "px-3 py-2",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_2px_0_0_var(--sidebar-primary)]"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
            )}
          >
            <item.icon className={cn("size-4 shrink-0", active && "text-sidebar-primary")} aria-hidden />
            {compact ? <span className="sr-only">{item.label}</span> : item.label}
          </Link>
        );
        return compact ? (
          <Tooltip key={item.href}>
            <TooltipTrigger asChild>{link}</TooltipTrigger>
            <TooltipContent side="right">{item.label}</TooltipContent>
          </Tooltip>
        ) : (
          link
        );
      })}
      <UserMenu compact={compact} />
    </nav>
  );
}

function UserMenu({ compact }: { compact: boolean }) {
  const user = useCurrentUser();
  const router = useRouter();
  if (!user) return null;
  const initials = user.name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const logout = async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      /* the cookie is cleared server-side anyway */
    }
    router.replace("/login");
  };
  return (
    <div className="mt-auto">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg border border-sidebar-border/80 bg-sidebar-accent/30 text-left hover:bg-sidebar-accent",
              compact ? "size-10 justify-center p-0" : "p-2",
            )}
            aria-label={`Account: ${user.name}`}
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-gradient text-[11px] font-bold text-emerald-950">{initials || "?"}</span>
            {!compact && (
              <span className="min-w-0 leading-tight">
                <span className="block truncate text-sm font-medium">{user.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{user.email}</span>
              </span>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side={compact ? "right" : "top"} align="start" className="w-56">
          <DropdownMenuLabel className="font-normal">
            <div className="truncate font-medium">{user.name}</div>
            <div className="truncate text-xs text-muted-foreground">
              {user.email} · {user.role === "owner" ? "Owner" : "Member"}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/settings#account">
              <UserRound /> Account & password
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/">
              <Home /> Landing page
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void logout()}>
            <LogOut /> Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {!compact && (
        <p className="mt-2 px-1 text-[10px] leading-snug text-muted-foreground">Account and files stay on this computer.</p>
      )}
    </div>
  );
}

function SidebarWithPath() {
  return <Sidebar pathname={usePathname()} />;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full">
      <Suspense fallback={<Sidebar pathname={null} />}>
        <SidebarWithPath />
      </Suspense>
      <main className="min-w-0 flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
