import { z } from "zod";
import { resolveIssueId } from "../lib/issues.js";
import { runMulticaJson } from "../lib/multica-cli.js";
import {
  getMulticaBackendConfig,
  getMulticaHttpClient,
} from "../lib/multica-http-client.js";

export const multicaRerunIssueSchema = z.object({
  issue_id: z.string().min(1),
  workspace_id: z.string().min(1).optional(),
});

export type MulticaRerunIssueInput = z.infer<typeof multicaRerunIssueSchema>;

export async function multicaRerunIssue(input: MulticaRerunIssueInput) {
  const backendConfig = getMulticaBackendConfig();
  if (backendConfig.backend === "http") {
    if (!input.workspace_id) {
      return { error: { code: "workspace_id_required", message: "workspace_id is required in HTTP mode.", retryable: false } };
    }
    const result = await getMulticaHttpClient().rerunIssue(input.issue_id, input.workspace_id);
    if (result.ok === false) return { error: result.error };
    return result.data;
  }
  const issueId = await resolveIssueId(input.issue_id);
  const result = await runMulticaJson<unknown>(["issue", "rerun", issueId]);
  return result;
}
