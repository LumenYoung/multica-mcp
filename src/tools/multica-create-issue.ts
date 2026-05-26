import { z } from "zod";
import {
  buildUnknownAssigneeMessage,
  resolveAgentByName,
} from "../lib/agents.js";
import {
  buildUnknownProjectMessage,
  resolveProject,
} from "../lib/projects.js";
import { runMulticaJson, runMulticaRaw } from "../lib/multica-cli.js";
import {
  getMulticaBackendConfig,
  getMulticaHttpClient,
} from "../lib/multica-http-client.js";
import type { Issue } from "../lib/types.js";

const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

let cachedAppUrl: string | undefined;

async function resolveAppUrl(): Promise<string> {
  if (process.env.MULTICA_APP_URL) return process.env.MULTICA_APP_URL;
  if (cachedAppUrl !== undefined) return cachedAppUrl;
  try {
    const out = await runMulticaRaw(["config", "show"]);
    const match = out.match(/app[_-]?url\s*[:=]\s*"?([^\s"]+)"?/i);
    if (match) {
      cachedAppUrl = match[1];
      return cachedAppUrl;
    }
  } catch {
    // fall through
  }
  cachedAppUrl = "";
  return "";
}

const STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
  "cancelled",
] as const;

export const multicaCreateIssueSchema = z.object({
  workspace_id: z.string().min(1).optional(),
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  assignee: z.string().optional(),
  assignee_id: z.string().optional(),
  project: z.string().optional(),
  project_id: z.string().optional(),
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional().default("medium"),
  parent_issue_id: z.string().optional(),
  cwd: z.string().optional(),
});

export type MulticaCreateIssueInput = z.infer<typeof multicaCreateIssueSchema>;

function withWorkingDirectoryHint(
  description: string | undefined,
  cwd: string | undefined,
): string | undefined {
  if (!cwd) return description;

  const prefix = [
    `**Working directory**: \`${cwd}\``,
    "",
    `Start with \`cd "${cwd}"\` before any file operation.`,
  ].join("\n");

  return description ? `${prefix}\n\n${description}` : prefix;
}

export async function multicaCreateIssue(
  input: MulticaCreateIssueInput,
) {
  if (input.assignee && input.assignee_id) {
    throw new Error("Provide either assignee or assignee_id, not both.");
  }
  if (input.project && input.project_id) {
    throw new Error("Provide either project or project_id, not both.");
  }

  const backendConfig = getMulticaBackendConfig();
  if (backendConfig.backend === "http") {
    if (!input.workspace_id) {
      return { error: { code: "workspace_id_required", message: "workspace_id is required.", retryable: false } };
    }
    if (input.assignee) {
      return { error: { code: "validation_failed", message: "HTTP mode requires exact assignee_id; resolve agents first with multica_list_agents.", retryable: false } };
    }
    if (input.project) {
      return { error: { code: "validation_failed", message: "HTTP mode requires exact project_id; project-name resolution is not migrated yet.", retryable: false } };
    }
    const result = await getMulticaHttpClient().createIssue(input.workspace_id, {
      title: input.title,
      description: withWorkingDirectoryHint(input.description, input.cwd),
      status: input.status,
      priority: input.priority ?? "medium",
      assignee_id: input.assignee_id,
      project_id: input.project_id,
      parent_issue_id: input.parent_issue_id,
    });
    if (result.ok === false) return { error: result.error };
    return result.data;
  }

  if (input.assignee) {
    const agent = await resolveAgentByName(input.assignee);
    if (!agent) {
      throw new Error(await buildUnknownAssigneeMessage(input.assignee));
    }
  }

  const args = ["issue", "create", "--title", input.title];
  const description = withWorkingDirectoryHint(input.description, input.cwd);

  if (description) {
    args.push("--description", description);
  }

  if (input.assignee_id) {
    args.push("--assignee-id", input.assignee_id);
  } else if (input.assignee) {
    args.push("--assignee", input.assignee);
  }

  if (input.status) args.push("--status", input.status);
  args.push("--priority", input.priority ?? "medium");

  if (input.parent_issue_id) {
    args.push("--parent", input.parent_issue_id);
  }

  if (input.project_id) {
    args.push("--project", input.project_id);
  } else if (input.project) {
    const project = await resolveProject(input.project);
    if (!project) {
      throw new Error(await buildUnknownProjectMessage(input.project));
    }
    args.push("--project", project.id);
  }

  const issue = await runMulticaJson<Issue>(args);
  const appUrl = await resolveAppUrl();

  return {
    id: issue.id,
    short_id: issue.identifier,
    title: issue.title,
    status: issue.status,
    assignee: input.assignee ?? null,
    assignee_id: issue.assignee_id ?? input.assignee_id ?? null,
    project_id: issue.project_id ?? input.project_id ?? null,
    url: appUrl ? `${appUrl}/issues/${issue.id}` : null,
  };
}
