export type MulticaBackend = "http" | "cli";

export type StructuredToolErrorCode =
  | "api_unreachable"
  | "auth_not_configured"
  | "auth_failed"
  | "workspace_id_required"
  | "not_found"
  | "validation_failed"
  | "rate_limited"
  | "missing_backend_endpoint"
  | "not_implemented"
  | "internal_error";

export type StructuredToolError = {
  code: StructuredToolErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
};

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: StructuredToolError };

export type MulticaBackendConfig =
  | { backend: "cli" }
  | {
      backend: "http";
      apiBaseUrl: string;
      token: string;
      webBaseUrl?: string;
    };

export type MulticaWorkspace = {
  id: string;
  name: string;
};

export type MulticaAgent = {
  id: string;
  name: string;
  description: string;
  runtime_id: string;
  runtime_mode?: string;
  status?: string;
  custom_args?: string[];
  archived_at?: string | null;
};

export type MulticaRuntime = {
  id: string;
  name: string;
  provider: string;
  runtime_mode: string;
  status: string;
  last_seen_at: string;
};

export type MulticaIssue = {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  assignee_id?: string | null;
  project_id?: string | null;
  created_at?: string;
  updated_at: string;
};

export type MulticaIssueSummary = {
  id: string;
  short_id: string;
  title: string;
  status: string;
  priority: string;
  assignee_id: string | null;
  project_id: string | null;
  updated_at: string;
};

export type MulticaListIssuesResult = {
  items: MulticaIssueSummary[];
  state: "loaded" | "empty";
  total: number;
  offset: number;
  has_more: boolean;
  next_offset?: number;
};

export type MulticaIssueMutationPayload = {
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  assignee_id?: string;
  project_id?: string;
  parent_issue_id?: string;
};

export type MulticaCreateIssuePayload = MulticaIssueMutationPayload & {
  title: string;
};

export type MulticaCreateIssueResult = {
  id: string;
  short_id: string;
  title: string;
  status: string;
  assignee_id: string | null;
  project_id: string | null;
  url: string | null;
};

export type MulticaAgentTask = Record<string, unknown> & {
  id: string;
  issue_id?: string;
  status?: string;
  created_at?: string;
};

export type MulticaTaskMessage = Record<string, unknown> & {
  seq?: number;
  task_id?: string;
  issue_id?: string;
  type?: string;
  content?: string;
};

export type MulticaListWorkspacesResult = {
  items: MulticaWorkspace[];
  count: number;
};

export type MulticaListAgentsResult = {
  items: MulticaAgent[];
  count: number;
  workspace_id: string;
};

export type MulticaListRuntimesResult = {
  items: MulticaRuntime[];
  count: number;
  workspace_id: string;
};

export function isStructuredToolError(value: unknown): value is StructuredToolError {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<StructuredToolError>;
  return (
    typeof candidate.code === "string" &&
    typeof candidate.message === "string" &&
    typeof candidate.retryable === "boolean"
  );
}
