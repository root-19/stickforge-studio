"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clapperboard, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/client/hooks";
import type { ProjectSummary } from "@/lib/shared/types";
import { EmptyState, ErrorBlock, LoadingBlock, PageBody, PageHeader } from "@/components/common";
import { NewProjectDialog } from "@/components/project-dialogs";

/** /editor without a project: jump to the most recent one, or offer to create one. */
export default function Page() {
  const router = useRouter();
  const projects = useApi<ProjectSummary[]>("/api/projects");
  const [newOpen, setNewOpen] = useState(false);
  const latest = projects.data?.[0];
  useEffect(() => {
    if (latest) router.replace(`/editor/${latest.id}`);
  }, [latest, router]);
  return (
    <PageBody>
      <PageHeader title="Video Editor" />
      <div className="p-8">
        {projects.error ? (
          <ErrorBlock message={projects.error} onRetry={projects.reload} />
        ) : !projects.data || latest ? (
          <LoadingBlock label="Opening your latest project…" />
        ) : (
          <EmptyState
            icon={Clapperboard}
            title="No projects yet"
            action={
              <div className="flex gap-2">
                <Button onClick={() => setNewOpen(true)}>
                  <Plus /> New project
                </Button>
                <Button variant="outline" asChild>
                  <Link href="/dashboard">Dashboard</Link>
                </Button>
              </div>
            }
          >
            Create a project to start editing.
          </EmptyState>
        )}
      </div>
      <NewProjectDialog open={newOpen} onOpenChange={setNewOpen} />
    </PageBody>
  );
}
