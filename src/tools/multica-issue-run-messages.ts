import { z } from "zod";
import { buildIssueRunMessagesArgs } from "../lib/cli-arg-builders.js";
import { runMulticaJson } from "../lib/multica-cli.js";
import {
  getMulticaBackendConfig,
  getMulticaHttpClient,
} from "../lib/multica-http-client.js";

export const multicaIssueRunMessagesSchema = z.object({
  task_id: z.string().min(1),
  issue_id: z.string().min(1).optional(),
  workspace_id: z.string().min(1).optional(),
  since: z.number().int().min(0).optional(),
});

export type MulticaIssueRunMessagesInput = {
  task_id: string;
  issue_id?: string;
  workspace_id?: string;
  since?: number;
};

export async function multicaIssueRunMessages(
  input: MulticaIssueRunMessagesInput,
) {
  const backendConfig = getMulticaBackendConfig();
  if (backendConfig.backend === "http") {
    if (!input.workspace_id) {
      return { error: { code: "workspace_id_required", message: "workspace_id is required in HTTP mode.", retryable: false } };
    }
    const result = await getMulticaHttpClient().issueRunMessages(input.task_id, input.since, input.workspace_id);
    if (result.ok === false) return { error: result.error };
    return { items: result.data, count: result.data.length };
  }
  const messages = (await runMulticaJson<unknown[]>(
    buildIssueRunMessagesArgs(input),
  )) ?? [];
  return { items: messages, count: messages.length };
}
