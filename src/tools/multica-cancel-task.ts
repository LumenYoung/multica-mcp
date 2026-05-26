import { z } from "zod";
import { runMulticaJson } from "../lib/multica-cli.js";
import {
  getMulticaBackendConfig,
  getMulticaHttpClient,
} from "../lib/multica-http-client.js";

export const multicaCancelTaskSchema = z.object({
  issue_id: z.string().min(1).optional(),
  workspace_id: z.string().min(1).optional(),
  task_id: z.string().min(1),
});

export type MulticaCancelTaskInput = z.infer<typeof multicaCancelTaskSchema>;

export async function multicaCancelTask(input: MulticaCancelTaskInput) {
  const backendConfig = getMulticaBackendConfig();
  if (backendConfig.backend === "http") {
    if (!input.issue_id) {
      return { error: { code: "validation_failed", message: "HTTP mode requires issue_id to cancel a task safely.", retryable: false } };
    }
    if (!input.workspace_id) {
      return { error: { code: "workspace_id_required", message: "workspace_id is required in HTTP mode.", retryable: false } };
    }
    const result = await getMulticaHttpClient().cancelTask(input.issue_id, input.task_id, input.workspace_id);
    if (result.ok === false) return { error: result.error };
    return result.data;
  }
  return await runMulticaJson<unknown>(["task", "cancel", input.task_id]);
}
