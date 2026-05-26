import { z } from "zod";
import {
  buildUnknownAssigneeMessage,
  getAgentsCached,
  mapAgentIdToName,
  resolveAgentByName,
} from "../lib/agents.js";
import { getIssueById, resolveIssueId } from "../lib/issues.js";
import { runMulticaJson } from "../lib/multica-cli.js";
import {
  getMulticaBackendConfig,
  getMulticaHttpClient,
} from "../lib/multica-http-client.js";
import type { Issue } from "../lib/types.js";

const STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
  "cancelled",
] as const;
const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

export const multicaUpdateIssueSchema = z.object({
  issue_id: z.string().min(1),
  workspace_id: z.string().min(1).optional(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  status: z.enum(STATUSES).optional(),
  assignee: z.string().optional(),
  assignee_id: z.string().optional(),
  project_id: z.string().optional(),
  parent_issue_id: z.string().optional(),
  priority: z.enum(PRIORITIES).optional(),
});

export type MulticaUpdateIssueInput = z.infer<typeof multicaUpdateIssueSchema>;

export async function multicaUpdateIssue(
  input: MulticaUpdateIssueInput,
) {
  const backendConfig = getMulticaBackendConfig();
  if (backendConfig.backend === "http") {
    if (!input.workspace_id) {
      return { error: { code: "workspace_id_required", message: "workspace_id is required in HTTP mode.", retryable: false } };
    }
    if (input.assignee) {
      return { error: { code: "validation_failed", message: "HTTP mode requires exact assignee_id; resolve agents first with multica_list_agents.", retryable: false } };
    }
    const hasUpdate = [
      input.title,
      input.description,
      input.status,
      input.assignee_id,
      input.project_id,
      input.parent_issue_id,
      input.priority,
    ].some((value) => value !== undefined);
    if (!hasUpdate) {
      return { error: { code: "validation_failed", message: "No fields provided to update.", retryable: false } };
    }
    const result = await getMulticaHttpClient().updateIssue(input.issue_id, {
      title: input.title,
      description: input.description,
      status: input.status,
      assignee_id: input.assignee_id,
      project_id: input.project_id,
      parent_issue_id: input.parent_issue_id,
      priority: input.priority,
    }, input.workspace_id);
    if (result.ok === false) return { error: result.error };
    return {
      id: result.data.id,
      short_id: result.data.short_id,
      title: result.data.title,
      status: result.data.status,
      assignee: result.data.assignee_id,
      priority: input.priority,
      updated_at: null,
    };
  }

  const issueId = await resolveIssueId(input.issue_id);
  const current = await getIssueById(issueId);

  if (input.assignee && input.assignee_id) {
    throw new Error("Provide either assignee or assignee_id, not both.");
  }

  if (input.assignee || input.assignee_id) {
    if (current.status === "done" || current.status === "cancelled") {
      throw new Error(
        `Cannot change assignee on a ${current.status} issue. Reopen it first.`,
      );
    }

    if (input.assignee) {
      const agent = await resolveAgentByName(input.assignee);
      if (!agent) {
        throw new Error(await buildUnknownAssigneeMessage(input.assignee));
      }
    }
  }

  const args = ["issue", "update", issueId];
  if (input.title !== undefined) args.push("--title", input.title);
  if (input.description !== undefined) {
    args.push("--description", input.description);
  }
  if (input.status !== undefined) args.push("--status", input.status);
  if (input.assignee_id !== undefined) args.push("--assignee-id", input.assignee_id);
  else if (input.assignee !== undefined) args.push("--assignee", input.assignee);
  if (input.project_id !== undefined) args.push("--project", input.project_id);
  if (input.parent_issue_id !== undefined) args.push("--parent", input.parent_issue_id);
  if (input.priority !== undefined) args.push("--priority", input.priority);

  if (args.length === 3) {
    throw new Error("No fields provided to update.");
  }

  const updated = await runMulticaJson<Issue>(args);
  const agents = await getAgentsCached();

  return {
    id: updated.id,
    short_id: updated.identifier,
    title: updated.title,
    status: updated.status,
    assignee: mapAgentIdToName(agents, updated.assignee_id),
    priority: updated.priority,
    updated_at: updated.updated_at,
  };
}
