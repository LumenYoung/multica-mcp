import { z } from "zod";
import { getAgentsCached, mapAgentIdToName } from "../lib/agents.js";
import { getIssueById, getLatestRunForIssue, resolveIssueId } from "../lib/issues.js";
import {
  getProjectDisplayName,
  getProjectsCached,
} from "../lib/projects.js";
import { runMulticaJson } from "../lib/multica-cli.js";
import {
  getMulticaBackendConfig,
  getMulticaHttpClient,
} from "../lib/multica-http-client.js";
import type { Comment } from "../lib/types.js";

export const multicaGetIssueSchema = z.object({
  issue_id: z.string().min(1),
  workspace_id: z.string().min(1).optional(),
  include_comments: z.boolean().optional().default(true),
});

export type MulticaGetIssueInput = z.infer<typeof multicaGetIssueSchema>;

export async function multicaGetIssue(input: MulticaGetIssueInput) {
  const backendConfig = getMulticaBackendConfig();
  if (backendConfig.backend === "http") {
    if (!input.workspace_id) {
      return { error: { code: "workspace_id_required", message: "workspace_id is required in HTTP mode.", retryable: false } };
    }
    const result = await getMulticaHttpClient().getIssue(input.issue_id, input.workspace_id);
    if (result.ok === false) return { error: result.error };
    const issue = result.data;
    return {
      id: issue.id,
      short_id: issue.identifier,
      title: issue.title,
      description: issue.description,
      status: issue.status,
      assignee: issue.assignee_id ?? null,
      project: issue.project_id ?? null,
      priority: issue.priority,
      task: null,
    };
  }

  const issueId = await resolveIssueId(input.issue_id);
  const includeComments = input.include_comments ?? true;

  const [issue, comments, latestRun, agents, projects] = await Promise.all([
    getIssueById(issueId),
    includeComments
      ? runMulticaJson<Comment[]>(["issue", "comment", "list", issueId])
      : Promise.resolve([] as Comment[]),
    getLatestRunForIssue(issueId),
    getAgentsCached(),
    getProjectsCached(),
  ]);

  const base = {
    id: issue.id,
    short_id: issue.identifier,
    title: issue.title,
    description: issue.description,
    status: issue.status,
    assignee: mapAgentIdToName(agents, issue.assignee_id),
    project: issue.project_id
      ? getProjectDisplayName(
          projects.find((project) => project.id === issue.project_id) ?? {
            id: issue.project_id,
          },
        )
      : null,
    priority: issue.priority,
    task: latestRun
      ? {
          status: latestRun.status,
          work_dir: latestRun.result?.work_dir ?? null,
          started_at: latestRun.started_at,
          completed_at: latestRun.completed_at,
          output_summary: latestRun.result?.output?.slice(0, 500) ?? null,
        }
      : null,
  };

  if (!includeComments) return base;

  return {
    ...base,
    comments: comments.map((comment) => ({
      author:
        comment.author_type === "agent"
          ? mapAgentIdToName(agents, comment.author_id) ?? comment.author_id
          : comment.author_id,
      content: comment.content,
      created_at: comment.created_at,
    })),
  };
}
