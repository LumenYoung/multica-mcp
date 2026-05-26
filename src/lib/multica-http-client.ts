import { z } from "zod";

import type {
  MulticaAgentTask,
  MulticaBackendConfig,
  MulticaCreateIssuePayload,
  MulticaCreateIssueResult,
  MulticaIssue,
  MulticaIssueMutationPayload,
  MulticaListAgentsResult,
  MulticaListIssuesResult,
  MulticaListRuntimesResult,
  MulticaListWorkspacesResult,
  MulticaTaskMessage,
  Result,
  StructuredToolError,
} from "./multica-types.js";

export type MulticaEnv = Record<string, string | undefined>;

type RequestContext = {
  operation: string;
  endpoint: string;
  apiBaseUrl: string;
};

export function makeError(
  code: StructuredToolError["code"],
  message: string,
  retryable: boolean,
  details?: Record<string, unknown>,
): StructuredToolError {
  return details ? { code, message, retryable, details } : { code, message, retryable };
}

function normalizeBaseUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

let cachedConfig: MulticaBackendConfig | undefined;

export function clearMulticaBackendConfigCache(): void {
  cachedConfig = undefined;
}

function parseMulticaBackendConfig(env: MulticaEnv): Result<MulticaBackendConfig> {
  const backend = env.MULTICA_BACKEND;
  if (backend !== "http" && backend !== "cli") {
    return {
      ok: false,
      error: makeError(
        "validation_failed",
        "MULTICA_BACKEND must be explicitly set to 'http' or 'cli'.",
        false,
      ),
    };
  }

  if (backend === "cli") return { ok: true, data: { backend: "cli" } };

  const rawApiBaseUrl = env.MULTICA_API_BASE_URL;
  if (!rawApiBaseUrl) {
    return {
      ok: false,
      error: makeError("validation_failed", "MULTICA_API_BASE_URL is required when MULTICA_BACKEND=http.", false),
    };
  }
  const apiBaseUrl = normalizeBaseUrl(rawApiBaseUrl);
  if (!apiBaseUrl) {
    return {
      ok: false,
      error: makeError("validation_failed", "MULTICA_API_BASE_URL must be a valid http(s) URL.", false),
    };
  }

  const token = env.MULTICA_TOKEN;
  if (!token) {
    return {
      ok: false,
      error: makeError("auth_not_configured", "MULTICA_TOKEN is required when MULTICA_BACKEND=http.", false),
    };
  }

  const rawWebBaseUrl = env.MULTICA_WEB_BASE_URL ?? env.MULTICA_APP_URL;
  const webBaseUrl = rawWebBaseUrl ? normalizeBaseUrl(rawWebBaseUrl) : undefined;
  if (rawWebBaseUrl && !webBaseUrl) {
    return {
      ok: false,
      error: makeError("validation_failed", "MULTICA_WEB_BASE_URL must be a valid http(s) URL.", false),
    };
  }

  return {
    ok: true,
    data: webBaseUrl
      ? { backend: "http", apiBaseUrl, webBaseUrl, token }
      : { backend: "http", apiBaseUrl, token },
  };
}

export function loadMulticaBackendConfig(env: MulticaEnv = process.env): Result<MulticaBackendConfig> {
  if (env === process.env && cachedConfig) return { ok: true, data: cachedConfig };
  const result = parseMulticaBackendConfig(env);
  if (result.ok && env === process.env) cachedConfig = result.data;
  return result;
}

export function getMulticaBackendConfig(): MulticaBackendConfig {
  const result = loadMulticaBackendConfig();
  if (result.ok === false) throw new Error(JSON.stringify({ error: result.error }));
  return result.data;
}

export function getMulticaHttpClient(): MulticaHttpClient {
  const config = getMulticaBackendConfig();
  if (config.backend !== "http") {
    throw new Error("MULTICA_BACKEND is not http.");
  }
  return new MulticaHttpClient(config);
}

function redact(input: string): string {
  return input
    .replace(/Bearer\s+[A-Za-z0-9._~+\-/=]+/gi, "Bearer [REDACTED]")
    .replace(/(authorization\s*[:=]\s*)[^\s,}]+/gi, "$1[REDACTED]")
    .replace(/(token\s*[:=]\s*)[^\s,}]+/gi, "$1[REDACTED]");
}

export function mapFetchError(err: unknown, context: RequestContext): StructuredToolError {
  const message = err instanceof Error ? err.message : String(err);
  return makeError("api_unreachable", redact(message || "Multica API is unreachable"), true, {
    api_base_url: context.apiBaseUrl,
    endpoint: context.endpoint,
    operation: context.operation,
  });
}

const ApiWorkspaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
}).passthrough();

const ApiAgentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  runtime_id: z.string().min(1),
  runtime_mode: z.string().optional(),
  status: z.string().optional(),
  custom_args: z.array(z.string()).optional(),
  archived_at: z.string().nullable().optional(),
}).passthrough();

const ApiRuntimeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  provider: z.string().min(1),
  runtime_mode: z.string().min(1),
  status: z.string().min(1),
  last_seen_at: z.string().min(1),
}).passthrough();

const ApiIssueSchema = z.object({
  id: z.string().min(1),
  identifier: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  status: z.string().min(1),
  priority: z.string().min(1),
  assignee_id: z.string().nullable().optional(),
  project_id: z.string().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().min(1),
}).passthrough();

const ApiTaskSchema = z.object({
  id: z.string().min(1),
  issue_id: z.string().optional(),
  status: z.string().optional(),
  created_at: z.string().optional(),
}).passthrough();

const ApiTaskMessageSchema = z.object({
  seq: z.number().optional(),
  task_id: z.string().optional(),
  issue_id: z.string().optional(),
  type: z.string().optional(),
  content: z.string().optional(),
}).passthrough();

const ApiWorkspaceListSchema = z.union([
  z.object({ workspaces: z.array(ApiWorkspaceSchema) }).passthrough(),
  z.object({ items: z.array(ApiWorkspaceSchema) }).passthrough(),
  z.array(ApiWorkspaceSchema),
]);

const ApiAgentListSchema = z.union([
  z.object({ agents: z.array(ApiAgentSchema) }).passthrough(),
  z.object({ items: z.array(ApiAgentSchema) }).passthrough(),
  z.array(ApiAgentSchema),
]);

const ApiRuntimeListSchema = z.union([
  z.object({ runtimes: z.array(ApiRuntimeSchema) }).passthrough(),
  z.object({ items: z.array(ApiRuntimeSchema) }).passthrough(),
  z.array(ApiRuntimeSchema),
]);

const ApiIssueListSchema = z.object({
  issues: z.array(ApiIssueSchema),
  total: z.number().optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
  has_more: z.boolean().optional(),
}).passthrough();

const ApiTaskListSchema = z.array(ApiTaskSchema);
const ApiTaskMessageListSchema = z.array(ApiTaskMessageSchema);

type ApiWorkspace = { id: string; name: string };
type ApiAgent = {
  id: string;
  name: string;
  description?: string | null;
  runtime_id: string;
  runtime_mode?: string;
  status?: string;
  custom_args?: string[];
  archived_at?: string | null;
};
type ApiRuntime = {
  id: string;
  name: string;
  provider: string;
  runtime_mode: string;
  status: string;
  last_seen_at: string;
};
type ApiIssue = z.infer<typeof ApiIssueSchema>;
type ApiTask = z.infer<typeof ApiTaskSchema>;
type ApiTaskMessage = z.infer<typeof ApiTaskMessageSchema>;

type ApiWorkspaceList = ApiWorkspace[] | { workspaces: ApiWorkspace[] } | { items: ApiWorkspace[] };
type ApiAgentList = ApiAgent[] | { agents: ApiAgent[] } | { items: ApiAgent[] };
type ApiRuntimeList = ApiRuntime[] | { runtimes: ApiRuntime[] } | { items: ApiRuntime[] };

function extractItems<T, K extends string>(data: T[] | Record<K, T[]> | { items: T[] }, key: K): T[] {
  if (Array.isArray(data)) return data;
  if (key in data) return (data as Record<K, T[]>)[key];
  return (data as { items: T[] }).items;
}

function issueSummary(issue: ApiIssue) {
  return {
    id: issue.id,
    short_id: issue.identifier,
    title: issue.title,
    status: issue.status,
    priority: issue.priority,
    assignee_id: issue.assignee_id ?? null,
    project_id: issue.project_id ?? null,
    updated_at: issue.updated_at,
  };
}

function requireWorkspaceId<T>(workspaceId: string): Result<T> | undefined {
  if (!workspaceId) {
    return { ok: false, error: makeError("workspace_id_required", "workspace_id is required.", false) };
  }
  return undefined;
}

function addWorkspaceQuery(endpoint: string, workspaceId?: string): string {
  if (!workspaceId) return endpoint;
  const separator = endpoint.includes("?") ? "&" : "?";
  return `${endpoint}${separator}workspace_id=${encodeURIComponent(workspaceId)}`;
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

async function readErrorBody(response: Response): Promise<{ text: string; parsed?: unknown }> {
  const text = await response.text().catch(() => "");
  if (!text) return { text };
  try {
    return { text, parsed: JSON.parse(text) };
  } catch {
    return { text };
  }
}

function errorBodyMessage(body: { text: string; parsed?: unknown }): string {
  if (body.parsed && typeof body.parsed === "object") {
    const record = body.parsed as Record<string, unknown>;
    for (const key of ["message", "error", "detail"]) {
      if (typeof record[key] === "string") return record[key] as string;
    }
  }
  return body.text;
}

function validationError<T>(shape: string, endpoint: string, operation: string): Result<T> {
  return {
    ok: false,
    error: makeError("internal_error", `Multica API response did not match expected ${shape} shape.`, false, {
      source: "backend_response_validation",
      endpoint,
      operation,
    }),
  };
}

export class MulticaHttpClient {
  readonly config: Extract<MulticaBackendConfig, { backend: "http" }>;
  private readonly fetchImpl: FetchLike;

  constructor(
    config: Extract<MulticaBackendConfig, { backend: "http" }>,
    fetchImpl: FetchLike = fetch,
  ) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async listWorkspaces(): Promise<Result<MulticaListWorkspacesResult>> {
    const result = await this.requestJson("listWorkspaces", "/api/workspaces");
    if (result.ok === false) return { ok: false, error: result.error };

    const parsed = ApiWorkspaceListSchema.safeParse(result.data);
    if (!parsed.success) {
      return validationError("workspace list", "/api/workspaces", "listWorkspaces");
    }

    const workspaces = extractItems(parsed.data as ApiWorkspaceList, "workspaces");
    const items = workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name }));
    return { ok: true, data: { items, count: items.length } };
  }

  async listAgents(workspaceId: string): Promise<Result<MulticaListAgentsResult>> {
    if (!workspaceId) {
      return { ok: false, error: makeError("workspace_id_required", "workspace_id is required.", false) };
    }
    const endpoint = `/api/agents?workspace_id=${encodeURIComponent(workspaceId)}`;
    const result = await this.requestJson("listAgents", endpoint);
    if (result.ok === false) return { ok: false, error: result.error };

    const parsed = ApiAgentListSchema.safeParse(result.data);
    if (!parsed.success) return validationError("agent list", endpoint, "listAgents");

    const agents = extractItems(parsed.data as ApiAgentList, "agents");
    return {
      ok: true,
      data: {
        workspace_id: workspaceId,
        count: agents.length,
        items: agents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          description: agent.description ?? "",
          runtime_id: agent.runtime_id,
          runtime_mode: agent.runtime_mode,
          status: agent.status,
          custom_args: agent.custom_args,
          archived_at: agent.archived_at ?? null,
        })),
      },
    };
  }

  async listRuntimes(workspaceId: string): Promise<Result<MulticaListRuntimesResult>> {
    if (!workspaceId) {
      return { ok: false, error: makeError("workspace_id_required", "workspace_id is required.", false) };
    }
    const endpoint = `/api/runtimes?workspace_id=${encodeURIComponent(workspaceId)}`;
    const result = await this.requestJson("listRuntimes", endpoint);
    if (result.ok === false) return { ok: false, error: result.error };

    const parsed = ApiRuntimeListSchema.safeParse(result.data);
    if (!parsed.success) return validationError("runtime list", endpoint, "listRuntimes");

    const runtimes = extractItems(parsed.data as ApiRuntimeList, "runtimes");
    return {
      ok: true,
      data: {
        workspace_id: workspaceId,
        count: runtimes.length,
        items: runtimes.map((runtime) => ({
          id: runtime.id,
          name: runtime.name,
          provider: runtime.provider,
          runtime_mode: runtime.runtime_mode,
          status: runtime.status,
          last_seen_at: runtime.last_seen_at,
        })),
      },
    };
  }

  async createIssue(
    workspaceId: string,
    payload: MulticaCreateIssuePayload,
  ): Promise<Result<MulticaCreateIssueResult>> {
    const missingWorkspace = requireWorkspaceId<MulticaCreateIssueResult>(workspaceId);
    if (missingWorkspace) return missingWorkspace;
    const endpoint = `/api/issues?workspace_id=${encodeURIComponent(workspaceId)}`;
    const body: Record<string, unknown> = {
      title: payload.title,
    };
    if (payload.description !== undefined) body.description = payload.description;
    if (payload.status !== undefined) body.status = payload.status;
    if (payload.priority !== undefined) body.priority = payload.priority;
    if (payload.assignee_id !== undefined) {
      body.assignee_id = payload.assignee_id;
      body.assignee_type = "agent";
    }
    if (payload.project_id !== undefined) body.project_id = payload.project_id;
    if (payload.parent_issue_id !== undefined) body.parent_issue_id = payload.parent_issue_id;

    const result = await this.requestJson("createIssue", endpoint, { method: "POST", body });
    if (result.ok === false) return { ok: false, error: result.error };
    const parsed = ApiIssueSchema.safeParse(result.data);
    if (!parsed.success) return validationError("issue", endpoint, "createIssue");
    return {
      ok: true,
      data: {
        id: parsed.data.id,
        short_id: parsed.data.identifier,
        title: parsed.data.title,
        status: parsed.data.status,
        assignee_id: parsed.data.assignee_id ?? null,
        project_id: parsed.data.project_id ?? null,
        url: this.config.webBaseUrl ? `${this.config.webBaseUrl}/issues/${parsed.data.id}` : null,
      },
    };
  }

  async getIssue(issueId: string, workspaceId?: string): Promise<Result<MulticaIssue>> {
    const endpoint = addWorkspaceQuery(`/api/issues/${encodeURIComponent(issueId)}`, workspaceId);
    const result = await this.requestJson("getIssue", endpoint);
    if (result.ok === false) return { ok: false, error: result.error };
    const parsed = ApiIssueSchema.safeParse(result.data);
    if (!parsed.success) return validationError("issue", endpoint, "getIssue");
    return {
      ok: true,
      data: {
        id: parsed.data.id,
        identifier: parsed.data.identifier,
        title: parsed.data.title,
        description: parsed.data.description,
        status: parsed.data.status,
        priority: parsed.data.priority,
        assignee_id: parsed.data.assignee_id ?? null,
        project_id: parsed.data.project_id ?? null,
        created_at: parsed.data.created_at,
        updated_at: parsed.data.updated_at,
      },
    };
  }

  async listIssues(
    workspaceId: string,
    input: { status?: string; assignee_id?: string; project_id?: string; limit?: number; offset?: number } = {},
  ): Promise<Result<MulticaListIssuesResult>> {
    const missingWorkspace = requireWorkspaceId<MulticaListIssuesResult>(workspaceId);
    if (missingWorkspace) return missingWorkspace;
    const params = new URLSearchParams({ workspace_id: workspaceId });
    if (input.status) params.set("status", input.status);
    if (input.assignee_id) params.set("assignee_id", input.assignee_id);
    if (input.project_id) params.set("project_id", input.project_id);
    const limit = input.limit ?? 20;
    const offset = input.offset ?? 0;
    params.set("limit", String(limit));
    params.set("offset", String(offset));
    const endpoint = `/api/issues?${params.toString()}`;
    const result = await this.requestJson("listIssues", endpoint);
    if (result.ok === false) return { ok: false, error: result.error };
    const parsed = ApiIssueListSchema.safeParse(result.data);
    if (!parsed.success) return validationError("issue list", endpoint, "listIssues");
    const items = parsed.data.issues.map(issueSummary);
    const hasMore = parsed.data.has_more ?? false;
    return {
      ok: true,
      data: {
        items,
        state: items.length === 0 ? "empty" : "loaded",
        total: parsed.data.total ?? items.length,
        offset: parsed.data.offset ?? offset,
        has_more: hasMore,
        next_offset: hasMore ? offset + limit : undefined,
      },
    };
  }

  async updateIssue(
    issueId: string,
    payload: MulticaIssueMutationPayload,
    workspaceId?: string,
  ): Promise<Result<MulticaCreateIssueResult>> {
    const endpoint = addWorkspaceQuery(`/api/issues/${encodeURIComponent(issueId)}`, workspaceId);
    const body: Record<string, unknown> = {};
    if (payload.title !== undefined) body.title = payload.title;
    if (payload.description !== undefined) body.description = payload.description;
    if (payload.status !== undefined) body.status = payload.status;
    if (payload.priority !== undefined) body.priority = payload.priority;
    if (payload.assignee_id !== undefined) {
      body.assignee_id = payload.assignee_id;
      body.assignee_type = "agent";
    }
    if (payload.project_id !== undefined) body.project_id = payload.project_id;
    if (payload.parent_issue_id !== undefined) body.parent_issue_id = payload.parent_issue_id;
    const result = await this.requestJson("updateIssue", endpoint, { method: "PUT", body });
    if (result.ok === false) return { ok: false, error: result.error };
    const parsed = ApiIssueSchema.safeParse(result.data);
    if (!parsed.success) return validationError("issue", endpoint, "updateIssue");
    return {
      ok: true,
      data: {
        id: parsed.data.id,
        short_id: parsed.data.identifier,
        title: parsed.data.title,
        status: parsed.data.status,
        assignee_id: parsed.data.assignee_id ?? null,
        project_id: parsed.data.project_id ?? null,
        url: this.config.webBaseUrl ? `${this.config.webBaseUrl}/issues/${parsed.data.id}` : null,
      },
    };
  }

  async issueRuns(issueId: string, workspaceId?: string): Promise<Result<MulticaAgentTask[]>> {
    const endpoint = addWorkspaceQuery(`/api/issues/${encodeURIComponent(issueId)}/task-runs`, workspaceId);
    const result = await this.requestJson("issueRuns", endpoint);
    if (result.ok === false) return { ok: false, error: result.error };
    const parsed = ApiTaskListSchema.safeParse(result.data);
    if (!parsed.success) return validationError("task list", endpoint, "issueRuns");
    return { ok: true, data: parsed.data as Array<ApiTask & MulticaAgentTask> };
  }

  async issueRunMessages(taskId: string, since?: number, workspaceId?: string): Promise<Result<MulticaTaskMessage[]>> {
    const params = new URLSearchParams();
    if (since !== undefined) params.set("since", String(since));
    if (workspaceId) params.set("workspace_id", workspaceId);
    const endpoint = `/api/tasks/${encodeURIComponent(taskId)}/messages${params.size ? `?${params.toString()}` : ""}`;
    const result = await this.requestJson("issueRunMessages", endpoint);
    if (result.ok === false) return { ok: false, error: result.error };
    const parsed = ApiTaskMessageListSchema.safeParse(result.data);
    if (!parsed.success) return validationError("task message list", endpoint, "issueRunMessages");
    return { ok: true, data: parsed.data as Array<ApiTaskMessage & MulticaTaskMessage> };
  }

  async rerunIssue(issueId: string, workspaceId?: string): Promise<Result<MulticaAgentTask>> {
    const endpoint = addWorkspaceQuery(`/api/issues/${encodeURIComponent(issueId)}/rerun`, workspaceId);
    const result = await this.requestJson("rerunIssue", endpoint, { method: "POST" });
    if (result.ok === false) return { ok: false, error: result.error };
    const parsed = ApiTaskSchema.safeParse(result.data);
    if (!parsed.success) return validationError("task", endpoint, "rerunIssue");
    return { ok: true, data: parsed.data as ApiTask & MulticaAgentTask };
  }

  async cancelTask(issueId: string, taskId: string, workspaceId?: string): Promise<Result<MulticaAgentTask>> {
    const endpoint = addWorkspaceQuery(`/api/issues/${encodeURIComponent(issueId)}/tasks/${encodeURIComponent(taskId)}/cancel`, workspaceId);
    const result = await this.requestJson("cancelTask", endpoint, { method: "POST" });
    if (result.ok === false) return { ok: false, error: result.error };
    const parsed = ApiTaskSchema.safeParse(result.data);
    if (!parsed.success) return validationError("task", endpoint, "cancelTask");
    return { ok: true, data: parsed.data as ApiTask & MulticaAgentTask };
  }

  private async requestJson(
    operation: string,
    endpoint: string,
    options: { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown } = {},
  ): Promise<Result<unknown>> {
    const url = `${this.config.apiBaseUrl}${endpoint}`;
    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        Authorization: `Bearer ${this.config.token}`,
      };
      let body: string | undefined;
      if (options.body !== undefined) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(options.body);
      }
      const response = await this.fetchImpl(url, {
        method: options.method ?? "GET",
        headers,
        body,
      });

      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          error: makeError("auth_failed", "Multica API authentication failed.", false, {
            endpoint,
            operation,
          }),
        };
      }
      if (response.status === 404) {
        return {
          ok: false,
          error: makeError("missing_backend_endpoint", "Multica API endpoint is not available.", false, {
            endpoint,
            operation,
          }),
        };
      }
      if (response.status === 429) {
        return {
          ok: false,
          error: makeError("rate_limited", "Multica API rate limit exceeded.", true, {
            endpoint,
            operation,
          }),
        };
      }
      if (!response.ok) {
        const errorBody = await readErrorBody(response);
        const backendMessage = errorBodyMessage(errorBody);
        if (response.status === 400 && /workspace[_ -]?id\s+is\s+required/i.test(backendMessage)) {
          return {
            ok: false,
            error: makeError("workspace_id_required", "workspace_id is required for this Multica API operation.", false, {
              endpoint,
              operation,
              status: response.status,
              backend_message: backendMessage,
            }),
          };
        }
        return {
          ok: false,
          error: makeError("api_unreachable", `Multica API request failed with HTTP ${response.status}.`, response.status >= 500, {
            endpoint,
            operation,
            backend_message: backendMessage || undefined,
          }),
        };
      }

      return { ok: true, data: await response.json() };
    } catch (err) {
      return {
        ok: false,
        error: mapFetchError(err, { operation, endpoint, apiBaseUrl: this.config.apiBaseUrl }),
      };
    }
  }
}
