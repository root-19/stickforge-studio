import { z } from "zod";
import { withApi } from "@/lib/server/api";
import { searchStock } from "@/lib/server/stock";

const querySchema = z.object({
  provider: z.enum(["pexels", "commons"]),
  kind: z.enum(["video", "image"]).default("video"),
  q: z.string().min(1).max(100),
  orientation: z.enum(["portrait", "landscape", "square", "any"]).default("any"),
  page: z.coerce.number().int().min(1).max(100).default(1),
});

/** Search free stock media (internet). Only the search words are sent to the provider. */
export const GET = withApi(async (req) => {
  const p = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return Response.json(await searchStock(p.provider, p.kind, p.q, p.orientation, p.page));
});
