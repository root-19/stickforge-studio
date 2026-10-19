"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export type SessionUser = { id: string; email: string; name: string; role: "owner" | "member"; createdAt: string };
export type SessionInfo = { user: SessionUser | null; registrationOpen: boolean; hasUsers: boolean };

const AuthContext = createContext<SessionUser | null>(null);

export function useCurrentUser(): SessionUser | null {
  return useContext(AuthContext);
}

export async function fetchSession(): Promise<SessionInfo> {
  const res = await fetch("/api/auth/session", { cache: "no-store" });
  if (!res.ok) throw new Error(`Session check failed (${res.status})`);
  return (await res.json()) as SessionInfo;
}

/** Only allow same-site relative paths as post-login destinations. */
export function safeNext(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}

/** Wraps the app area: shows the app only to a signed-in user, otherwise goes to /login. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchSession().then(
      (s) => {
        if (cancelled) return;
        if (!s.user) {
          router.replace(`/login?next=${encodeURIComponent(pathname || "/dashboard")}`);
          return;
        }
        setUser(s.user);
        setChecked(true);
      },
      () => !cancelled && router.replace("/login"),
    );
    return () => {
      cancelled = true;
    };
  }, [router, pathname]);

  if (!checked || !user) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground" role="status">
        <Loader2 className="mr-2 size-4 animate-spin" /> Checking your session…
      </div>
    );
  }
  return <AuthContext.Provider value={user}>{children}</AuthContext.Provider>;
}
