import { withApi } from "@/lib/server/api";
import { runSystemChecks } from "@/lib/server/system";

export const GET = withApi(async () => Response.json(await runSystemChecks()));
