import type { Metadata } from "next";
import { ExportQueue } from "@/components/export-queue";

export const metadata: Metadata = { title: "Export Queue" };

export default function Page() {
  return <ExportQueue />;
}
