import { z } from "zod";
import { invalidateAgentsCache } from "../lib/agents.js";
import { runMulticaJson } from "../lib/multica-cli.js";
import {
  buildAgentCreateArgs,
  buildAgentUpdateArgs,
} from "../lib/cli-arg-builders.js";
import type { Agent } from "../lib/types.js";

export const multicaAgentCreateSchema = z.object({
  name: z.string().min(1),
  runtime_id: z.string().min(1),
  description: z.string().optional(),
  instructions: z.string().optional(),
  model: z.string().optional(),
  custom_args: z.array(z.string()).optional(),
  custom_env: z.record(z.string(), z.string()).optional(),
  runtime_config: z.record(z.string(), z.unknown()).optional(),
  max_concurrent_tasks: z.number().int().min(1).optional(),
  visibility: z.enum(["workspace", "private"]).optional(),
});

export type MulticaAgentCreateInput = {
  name: string;
  runtime_id: string;
  description?: string;
  instructions?: string;
  model?: string;
  custom_args?: string[];
  custom_env?: Record<string, string>;
  runtime_config?: Record<string, unknown>;
  max_concurrent_tasks?: number;
  visibility?: "workspace" | "private";
};

export async function multicaAgentCreate(input: MulticaAgentCreateInput) {
  const agent = await runMulticaJson<Agent>(buildAgentCreateArgs(input), {
    stdin: input.custom_env ? JSON.stringify(input.custom_env) : undefined,
  });
  invalidateAgentsCache();
  return agent;
}

export const multicaAgentUpdateSchema = z.object({
  agent_id: z.string().min(1),
  name: z.string().optional(),
  description: z.string().optional(),
  instructions: z.string().optional(),
  model: z.string().optional(),
  custom_args: z.array(z.string()).optional(),
  custom_env: z.record(z.string(), z.string()).optional(),
  runtime_config: z.record(z.string(), z.unknown()).optional(),
  visibility: z.enum(["workspace", "private"]).optional(),
  runtime_id: z.string().optional(),
  status: z.enum(["active", "paused", "archived"]).optional(),
  max_concurrent_tasks: z.number().int().min(1).optional(),
});

export type MulticaAgentUpdateInput = {
  agent_id: string;
  name?: string;
  description?: string;
  instructions?: string;
  model?: string;
  custom_args?: string[];
  custom_env?: Record<string, string>;
  runtime_config?: Record<string, unknown>;
  visibility?: "workspace" | "private";
  runtime_id?: string;
  status?: "active" | "paused" | "archived";
  max_concurrent_tasks?: number;
};

export async function multicaAgentUpdate(input: MulticaAgentUpdateInput) {
  const agent = await runMulticaJson<Agent>(buildAgentUpdateArgs(input), {
    stdin: input.custom_env ? JSON.stringify(input.custom_env) : undefined,
  });
  invalidateAgentsCache();
  return agent;
}
