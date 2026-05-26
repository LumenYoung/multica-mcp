import { z } from "zod";
import { runMulticaJson } from "../lib/multica-cli.js";
import {
  getMulticaBackendConfig,
  getMulticaHttpClient,
} from "../lib/multica-http-client.js";
import type { ListResult, Runtime } from "../lib/types.js";

export const multicaRuntimeListSchema = z.object({
  workspace_id: z.string().min(1).optional(),
});

export type MulticaRuntimeListInput = z.infer<typeof multicaRuntimeListSchema>;

type RuntimeSummary = {
  id: string;
  name: string;
  provider: string;
  runtime_mode: string;
  status: string;
  last_seen_at: string;
};

export async function multicaRuntimeList(
  input: MulticaRuntimeListInput = {},
): Promise<ListResult<RuntimeSummary> | { error: unknown }> {
  const config = getMulticaBackendConfig();
  if (config.backend === "http") {
    if (!input.workspace_id) {
      return { error: { code: "workspace_id_required", message: "workspace_id is required.", retryable: false } };
    }
    const result = await getMulticaHttpClient().listRuntimes(input.workspace_id);
    if (result.ok === false) return { error: result.error };
    if (result.data.items.length === 0) {
      return { items: [], state: "empty", message: `No runtimes registered in workspace ${input.workspace_id}.` };
    }
    return { items: result.data.items, state: "loaded" };
  }

  const runtimes = (await runMulticaJson<Runtime[]>(["runtime", "list"])) ?? [];
  if (runtimes.length === 0) {
    return { items: [], state: "empty", message: "No runtimes registered." };
  }
  const items = runtimes.map((runtime) => ({
    id: runtime.id,
    name: runtime.name,
    provider: runtime.provider,
    runtime_mode: runtime.runtime_mode,
    status: runtime.status,
    last_seen_at: runtime.last_seen_at,
  }));
  return { items, state: "loaded" };
}
