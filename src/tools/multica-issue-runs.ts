import { z } from "zod";
import { resolveIssueId } from "../lib/issues.js";
import { runMulticaJson } from "../lib/multica-cli.js";
import {
  getMulticaBackendConfig,
  getMulticaHttpClient,
} from "../lib/multica-http-client.js";
import type { AgentTask, ListResult } from "../lib/types.js";

export const multicaIssueRunsSchema = z.object({
  issue_id: z.string().min(1),
  workspace_id: z.string().min(1).optional(),
});

export type MulticaIssueRunsInput = z.infer<typeof multicaIssueRunsSchema>;

export async function multicaIssueRuns(
  input: MulticaIssueRunsInput,
): Promise<ListResult<AgentTask> | { error: unknown }> {
  const backendConfig = getMulticaBackendConfig();
  if (backendConfig.backend === "http") {
    if (!input.workspace_id) {
      return { error: { code: "workspace_id_required", message: "workspace_id is required in HTTP mode.", retryable: false } };
    }
    const result = await getMulticaHttpClient().issueRuns(input.issue_id, input.workspace_id);
    if (result.ok === false) return { error: result.error };
    const runs = result.data as unknown as AgentTask[];
    if (runs.length === 0) {
      return { items: [], state: "empty", message: "No runs for this issue." };
    }
    const sorted = runs.slice().sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
    return { items: sorted, state: "loaded" };
  }
  const issueId = await resolveIssueId(input.issue_id);
  const runs = (await runMulticaJson<AgentTask[]>(["issue", "runs", issueId])) ?? [];
  if (runs.length === 0) {
    return { items: [], state: "empty", message: "No runs for this issue." };
  }
  const sorted = runs
    .slice()
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { items: sorted, state: "loaded" };
}
