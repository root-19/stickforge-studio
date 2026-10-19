"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { Editor } from "@/components/editor/editor";
import { LoadingBlock } from "@/components/common";

function EditorRoute() {
  const { id } = useParams<{ id: string }>();
  return <Editor projectId={id} />;
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingBlock label="Opening project…" />}>
      <EditorRoute />
    </Suspense>
  );
}
