import { z } from "zod";
import {
  getAgentsCached,
  getRuntimeProviderMap,
} from "../lib/agents.js";
import {
  getMulticaBackendConfig,
  getMulticaHttpClient,
} from "../lib/multica-http-client.js";
import { extractModelHint } from "../lib/model-hint.js";
import type { ListResult } from "../lib/types.js";

export const multicaListAgentsSchema = z.object({
  workspace_id: z.string().min(1).optional(),
});

export type MulticaListAgentsInput = z.infer<typeof multicaListAgentsSchema>;

type AgentSummary = {
  id: string;
  name: string;
  provider: string;
  model_hint: string;
  description: string;
};

export async function multicaListAgents(
  input: MulticaListAgentsInput = {},
): Promise<ListResult<AgentSummary> | { error: unknown }> {
  const config = getMulticaBackendConfig();
  if (config.backend === "http") {
    if (!input.workspace_id) {
      return { error: { code: "workspace_id_required", message: "workspace_id is required.", retryable: false } };
    }
    const result = await getMulticaHttpClient().listAgents(input.workspace_id);
    if (result.ok === false) return { error: result.error };
    const items = result.data.items
      .filter((agent) => !agent.archived_at)
      .map((agent) => ({
        id: agent.id,
        name: agent.name,
        provider: agent.runtime_mode ?? "unknown",
        model_hint: extractModelHint(agent.custom_args ?? []),
        description: agent.description ?? "",
      }));
    if (items.length === 0) {
      return {
        items: [],
        state: "empty",
        message: `No active agents in workspace ${input.workspace_id}. Create an agent to get started.`,
      };
    }
    return { items, state: "loaded" };
  }

  const [agents, runtimeProviderMap] = await Promise.all([
    getAgentsCached(),
    getRuntimeProviderMap(),
  ]);

  const items = agents
    .filter((agent) => !agent.archived_at)
    .map((agent) => ({
      id: agent.id,
      name: agent.name,
      provider:
        runtimeProviderMap.get(agent.runtime_id) ?? agent.runtime_mode ?? "unknown",
      model_hint: extractModelHint(agent.custom_args ?? []),
      description: agent.description ?? "",
    }));

  if (items.length === 0) {
    return {
      items: [],
      state: "empty",
      message: "No active agents in this workspace. Create an agent to get started.",
    };
  }

  return { items, state: "loaded" };
}
