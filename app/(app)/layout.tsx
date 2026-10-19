import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-context";
import { LoadingBlock } from "@/components/common";

/** Everything in this group requires a local account. */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<LoadingBlock label="Loading…" className="h-full" />}>
      <AuthGate>
        <AppShell>{children}</AppShell>
      </AuthGate>
    </Suspense>
  );
}
