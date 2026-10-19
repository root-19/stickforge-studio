"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ASPECTS, ASPECT_IDS, type AspectId } from "@/lib/shared/types";

/** Small rectangle drawn in the ratio's proportions. */
export function RatioIcon({ aspect, size = 14 }: { aspect: AspectId; size?: number }) {
  const a = ASPECTS[aspect];
  const scale = size / Math.max(a.w, a.h);
  return (
    <span className="inline-grid shrink-0 place-items-center" style={{ width: size, height: size }} aria-hidden>
      <span className="rounded-[2px] border-[1.5px] border-current" style={{ width: a.w * scale, height: a.h * scale }} />
    </span>
  );
}

export function RatioPicker({ value, onChange }: { value: AspectId; onChange: (a: AspectId) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as AspectId)}>
      <SelectTrigger size="sm" className="w-auto gap-2" aria-label="Video ratio">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ASPECT_IDS.map((id) => (
          <SelectItem key={id} value={id}>
            <RatioIcon aspect={id} />
            <span className="font-medium">{ASPECTS[id].label}</span>
            <span className="text-xs text-muted-foreground">{ASPECTS[id].hint}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
