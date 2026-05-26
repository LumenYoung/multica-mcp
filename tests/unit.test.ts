import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  multicaDeleteAutopilotSchema,
  multicaGetAutopilotSchema,
  multicaTriggerAutopilotSchema,
  multicaUpdateAutopilotSchema,
} from "../src/lib/autopilot-input-schemas.ts";
import { resolveIssueId } from "../src/lib/issues.ts";
import {
  MulticaHttpClient,
  loadMulticaBackendConfig,
  mapFetchError,
} from "../src/lib/multica-http-client.ts";
import { isStructuredToolError } from "../src/lib/multica-types.ts";

import { TtlCache } from "../src/lib/cache.ts";
import {
  buildAttachmentDownloadArgs,
  buildAgentCreateArgs,
  buildAgentUpdateArgs,
  buildAutopilotTriggerAddArgs,
  buildAutopilotTriggerDeleteArgs,
  buildAutopilotTriggerUpdateArgs,
  buildIssueRunMessagesArgs,
} from "../src/lib/cli-arg-builders.ts";
import { parseAttachmentDownloadPath } from "../src/lib/attachment-download.ts";
import { closestMatch, levenshtein } from "../src/lib/fuzzy.ts";
import { extractModelHint } from "../src/lib/model-hint.ts";

test("loadMulticaBackendConfig: rejects unset backend", () => {
  const result = loadMulticaBackendConfig({});
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "validation_failed");
    assert.match(result.error.message, /MULTICA_BACKEND/);
  }
});

test("loadMulticaBackendConfig: validates http config without pinging backend", () => {
  const result = loadMulticaBackendConfig({
    MULTICA_BACKEND: "http",
    MULTICA_API_BASE_URL: "http://multica-backend:8080",
    MULTICA_WEB_BASE_URL: "https://kanban.lumeny.io",
    MULTICA_TOKEN: "secret-token",
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.backend, "http");
    assert.equal(result.data.apiBaseUrl, "http://multica-backend:8080");
    assert.equal(result.data.webBaseUrl, "https://kanban.lumeny.io");
    assert.equal(result.data.token, "secret-token");
  }
});

test("loadMulticaBackendConfig: rejects http mode without token", () => {
  const result = loadMulticaBackendConfig({
    MULTICA_BACKEND: "http",
    MULTICA_API_BASE_URL: "http://multica-backend:8080",
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "auth_not_configured");
    assert.equal(result.error.retryable, false);
  }
});

test("mapFetchError: redacts token-like material", () => {
  const error = mapFetchError(
    new Error("fetch failed for Authorization: Bearer abc123token"),
    { operation: "listWorkspaces", endpoint: "/api/workspaces", apiBaseUrl: "http://multica-backend:8080" },
  );

  assert.equal(error.code, "api_unreachable");
  assert.equal(error.retryable, true);
  assert.doesNotMatch(error.message, /abc123token/);
  assert.equal(error.details?.api_base_url, "http://multica-backend:8080");
});

test("MulticaHttpClient: maps workspace list response to natural result", async () => {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const client = new MulticaHttpClient(
    {
      backend: "http",
      apiBaseUrl: "http://multica-backend:8080",
      webBaseUrl: "https://kanban.lumeny.io",
      token: "secret-token",
    },
    async (url, init) => {
      calls.push({
        url: String(url),
        headers: init?.headers as Record<string, string>,
      });
      return new Response(JSON.stringify({ workspaces: [{ id: "w1", name: "work" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  );

  const result = await client.listWorkspaces();
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.data, { items: [{ id: "w1", name: "work" }], count: 1 });
  }
  assert.equal(calls[0]?.url, "http://multica-backend:8080/api/workspaces");
  assert.equal(calls[0]?.headers.Authorization, "Bearer secret-token");
});

test("MulticaHttpClient: schema drift returns structured internal_error", async () => {
  const client = new MulticaHttpClient(
    {
      backend: "http",
      apiBaseUrl: "http://multica-backend:8080",
      token: "secret-token",
    },
    async () => new Response(JSON.stringify({ workspaces: [{ name: "missing id" }] }), { status: 200 }),
  );

  const result = await client.listWorkspaces();
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "internal_error");
    assert.equal(result.error.details?.source, "backend_response_validation");
    assert.equal(isStructuredToolError(result.error), true);
  }
});

test("MulticaHttpClient: maps backend workspace_id 400 to workspace_id_required", async () => {
  const client = new MulticaHttpClient(
    { backend: "http", apiBaseUrl: "http://multica-backend:8080", token: "secret-token" },
    async () => new Response(JSON.stringify({ error: "workspace_id is required" }), { status: 400 }),
  );

  const result = await client.issueRuns("i1");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "workspace_id_required");
    assert.equal(result.error.retryable, false);
    assert.equal(result.error.details?.status, 400);
  }
});

test("MulticaHttpClient: listAgents requires explicit workspace_id", async () => {
  const client = new MulticaHttpClient(
    { backend: "http", apiBaseUrl: "http://multica-backend:8080", token: "secret-token" },
    async () => {
      throw new Error("fetch should not be called");
    },
  );

  const result = await client.listAgents("");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "workspace_id_required");
});

test("MulticaHttpClient: listAgents echoes workspace_id and maps result", async () => {
  const client = new MulticaHttpClient(
    { backend: "http", apiBaseUrl: "http://multica-backend:8080", token: "secret-token" },
    async () => new Response(JSON.stringify({ agents: [{ id: "a1", name: "Codex DGX", runtime_id: "r1", runtime_mode: "codex", status: "active", custom_args: ["--model", "gpt-5"] }] }), { status: 200 }),
  );

  const result = await client.listAgents("w1");
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.workspace_id, "w1");
    assert.equal(result.data.count, 1);
    assert.equal(result.data.items[0]?.name, "Codex DGX");
  }
});

test("MulticaHttpClient: listRuntimes echoes workspace_id", async () => {
  const client = new MulticaHttpClient(
    { backend: "http", apiBaseUrl: "http://multica-backend:8080", token: "secret-token" },
    async () => new Response(JSON.stringify({ runtimes: [{ id: "r1", name: "dgx", provider: "codex", runtime_mode: "agent", status: "online", last_seen_at: "2026-01-01T00:00:00Z" }] }), { status: 200 }),
  );

  const result = await client.listRuntimes("w1");
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.workspace_id, "w1");
    assert.deepEqual(result.data.items.map((runtime) => runtime.id), ["r1"]);
  }
});

test("MulticaHttpClient: createIssue posts workspace-scoped payload", async () => {
  const calls: Array<{ url: string; init?: RequestInit; body: unknown }> = [];
  const client = new MulticaHttpClient(
    { backend: "http", apiBaseUrl: "http://multica-backend:8080", webBaseUrl: "https://kanban.lumeny.io", token: "secret-token" },
    async (url, init) => {
      calls.push({ url: String(url), init, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ id: "i1", identifier: "WOR-1", title: "Test", status: "todo", priority: "low", assignee_id: "a1", project_id: null, updated_at: "2026-01-01T00:00:00Z" }), { status: 201 });
    },
  );

  const result = await client.createIssue("w1", { title: "Test", description: "Body", priority: "low", assignee_id: "a1" });
  assert.equal(result.ok, true);
  assert.equal(calls[0]?.url, "http://multica-backend:8080/api/issues?workspace_id=w1");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.deepEqual(calls[0]?.body, { title: "Test", description: "Body", priority: "low", assignee_id: "a1", assignee_type: "agent" });
  if (result.ok) assert.equal(result.data.url, "https://kanban.lumeny.io/issues/i1");
});

test("MulticaHttpClient: listIssues maps pagination", async () => {
  const client = new MulticaHttpClient(
    { backend: "http", apiBaseUrl: "http://multica-backend:8080", token: "secret-token" },
    async () => new Response(JSON.stringify({ issues: [{ id: "i1", identifier: "WOR-1", title: "T", status: "todo", priority: "medium", assignee_id: null, project_id: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z" }], total: 1, limit: 20, offset: 0, has_more: false }), { status: 200 }),
  );

  const result = await client.listIssues("w1", { status: "todo", limit: 20, offset: 0 });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.items[0]?.short_id, "WOR-1");
    assert.equal(result.data.total, 1);
  }
});

test("MulticaHttpClient: issue runs and messages use real user-facing endpoints", async () => {
  const seen: string[] = [];
  const client = new MulticaHttpClient(
    { backend: "http", apiBaseUrl: "http://multica-backend:8080", token: "secret-token" },
    async (url) => {
      seen.push(String(url));
      if (String(url).includes("task-runs")) {
        return new Response(JSON.stringify([{ id: "t1", issue_id: "i1", status: "completed", created_at: "2026-01-01T00:00:00Z" }]), { status: 200 });
      }
      return new Response(JSON.stringify([{ seq: 1, task_id: "t1", issue_id: "i1", type: "text", content: "done" }]), { status: 200 });
    },
  );

  const runs = await client.issueRuns("i1", "w1");
  const messages = await client.issueRunMessages("t1", 1, "w1");
  assert.equal(runs.ok, true);
  assert.equal(messages.ok, true);
  assert.equal(seen[0], "http://multica-backend:8080/api/issues/i1/task-runs?workspace_id=w1");
  assert.equal(seen[1], "http://multica-backend:8080/api/tasks/t1/messages?since=1&workspace_id=w1");
});

test("MulticaHttpClient: createIssue posts JSON and constructs web URL", async () => {
  const calls: Array<{ url: string; method?: string; body?: string }> = [];
  const client = new MulticaHttpClient(
    { backend: "http", apiBaseUrl: "http://multica-backend:8080", webBaseUrl: "https://kanban.lumeny.io", token: "secret-token" },
    async (url, init) => {
      calls.push({ url: String(url), method: init?.method, body: String(init?.body) });
      return new Response(JSON.stringify({ id: "i1", identifier: "WRK-1", title: "Test", status: "todo", priority: "medium", assignee_id: "a1", project_id: null, updated_at: "2026-01-01T00:00:00Z" }), { status: 200 });
    },
  );

  const result = await client.createIssue("w1", { title: "Test", assignee_id: "a1", priority: "medium" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.url, "https://kanban.lumeny.io/issues/i1");
  assert.equal(calls[0]?.url, "http://multica-backend:8080/api/issues?workspace_id=w1");
  assert.equal(calls[0]?.method, "POST");
  assert.match(calls[0]?.body ?? "", /"assignee_type":"agent"/);
});

test("MulticaHttpClient: updateIssue uses PUT", async () => {
  const calls: Array<{ method?: string; body?: string }> = [];
  const client = new MulticaHttpClient(
    { backend: "http", apiBaseUrl: "http://multica-backend:8080", token: "secret-token" },
    async (_url, init) => {
      calls.push({ method: init?.method, body: String(init?.body) });
      return new Response(JSON.stringify({ id: "i1", identifier: "WRK-1", title: "Test", status: "cancelled", priority: "medium", assignee_id: null, project_id: null, updated_at: "2026-01-01T00:00:00Z" }), { status: 200 });
    },
  );

  const result = await client.updateIssue("i1", { status: "cancelled" });
  assert.equal(result.ok, true);
  assert.equal(calls[0]?.method, "PUT");
  assert.match(calls[0]?.body ?? "", /"status":"cancelled"/);
});

test("MulticaHttpClient: issue runs/messages/rerun/cancel map endpoints", async () => {
  const urls: string[] = [];
  const client = new MulticaHttpClient(
    { backend: "http", apiBaseUrl: "http://multica-backend:8080", token: "secret-token" },
    async (url, init) => {
      urls.push(`${init?.method ?? "GET"} ${String(url)}`);
      if (String(url).includes("messages")) return new Response(JSON.stringify([{ seq: 1, content: "hi" }]), { status: 200 });
      if (String(url).includes("task-runs")) return new Response(JSON.stringify([{ id: "t1", status: "running", created_at: "2026-01-01T00:00:00Z" }]), { status: 200 });
      return new Response(JSON.stringify({ id: "t1", status: "cancelled", created_at: "2026-01-01T00:00:00Z" }), { status: 200 });
    },
  );

  assert.equal((await client.issueRuns("i1", "w1")).ok, true);
  assert.equal((await client.issueRunMessages("t1", 2, "w1")).ok, true);
  assert.equal((await client.rerunIssue("i1", "w1")).ok, true);
  assert.equal((await client.cancelTask("i1", "t1", "w1")).ok, true);
  assert.deepEqual(urls, [
    "GET http://multica-backend:8080/api/issues/i1/task-runs?workspace_id=w1",
    "GET http://multica-backend:8080/api/tasks/t1/messages?since=2&workspace_id=w1",
    "POST http://multica-backend:8080/api/issues/i1/rerun?workspace_id=w1",
    "POST http://multica-backend:8080/api/issues/i1/tasks/t1/cancel?workspace_id=w1",
  ]);
});

test("TtlCache: get returns stored value within TTL", () => {
  const cache = new TtlCache<number>(1_000);
  cache.set("a", 1);
  assert.equal(cache.get("a"), 1);
});

test("TtlCache: entries expire after TTL", async () => {
  const cache = new TtlCache<number>(10);
  cache.set("a", 1);
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(cache.get("a"), undefined);
});

test("TtlCache: invalidate() clears all", () => {
  const cache = new TtlCache<number>(1_000);
  cache.set("a", 1);
  cache.set("b", 2);
  cache.invalidate();
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.get("b"), undefined);
});

test("TtlCache: invalidate(key) clears only that key", () => {
  const cache = new TtlCache<number>(1_000);
  cache.set("a", 1);
  cache.set("b", 2);
  cache.invalidate("a");
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.get("b"), 2);
});

test("levenshtein: identical strings yield 0", () => {
  assert.equal(levenshtein("hello", "hello"), 0);
});

test("levenshtein: single substitution yields 1", () => {
  assert.equal(levenshtein("hello", "hallo"), 1);
});

test("levenshtein: case-insensitive", () => {
  assert.equal(levenshtein("Hello", "hello"), 0);
});

test("closestMatch: finds nearest by threshold", () => {
  assert.equal(
    closestMatch("claude-sonet", ["claude-sonnet", "claude-opus"]),
    "claude-sonnet",
  );
});

test("closestMatch: returns undefined when nothing is close enough", () => {
  assert.equal(
    closestMatch("zzz", ["claude-sonnet", "claude-opus"]),
    undefined,
  );
});

test("closestMatch: handles empty input", () => {
  assert.equal(closestMatch("", ["claude-sonnet"]), undefined);
  assert.equal(closestMatch("foo", []), undefined);
});

test("extractModelHint: returns default for empty args", () => {
  assert.equal(extractModelHint([]), "default");
});

test("extractModelHint: reads --model flag", () => {
  assert.equal(extractModelHint(["--model", "claude-opus-4-7"]), "claude-opus-4-7");
});

test("extractModelHint: reads -m flag", () => {
  assert.equal(extractModelHint(["-m", "gpt-5"]), "gpt-5");
});

test("extractModelHint: parses codex -c model= syntax", () => {
  assert.equal(
    extractModelHint(["-c", "model=\"gpt-5\""]),
    "gpt-5",
  );
});

test("extractModelHint: falls back to default when not found", () => {
  assert.equal(extractModelHint(["--foo", "bar"]), "default");
});

test("buildAgentCreateArgs: matches the current Multica CLI contract", () => {
  assert.deepEqual(
    buildAgentCreateArgs({
      name: "reviewer",
      runtime_id: "runtime-123",
      description: "Reviews pull requests.",
      instructions: "Stay concise.",
      visibility: "workspace",
      max_concurrent_tasks: 2,
      model: "gpt-5",
      custom_args: ["--reasoning", "high"],
      custom_env: { SAFE_KEY: "value" },
      runtime_config: { region: "eu-west-1" },
    }),
    [
      "agent",
      "create",
      "--name",
      "reviewer",
      "--runtime-id",
      "runtime-123",
      "--description",
      "Reviews pull requests.",
      "--instructions",
      "Stay concise.",
      "--visibility",
      "workspace",
      "--model",
      "gpt-5",
      "--max-concurrent-tasks",
      "2",
      "--custom-args",
      "[\"--reasoning\",\"high\"]",
      "--custom-env-stdin",
      "--runtime-config",
      "{\"region\":\"eu-west-1\"}",
    ],
  );
});

test("buildAgentUpdateArgs: serializes updated fields with CLI flag names", () => {
  assert.deepEqual(
    buildAgentUpdateArgs({
      agent_id: "agent-123",
      description: "Updated.",
      runtime_id: "runtime-456",
      status: "paused",
      custom_args: ["--model", "o3"],
    }),
    [
      "agent",
      "update",
      "agent-123",
      "--description",
      "Updated.",
      "--runtime-id",
      "runtime-456",
      "--status",
      "paused",
      "--custom-args",
      "[\"--model\",\"o3\"]",
    ],
  );
});

test("buildAgentUpdateArgs: rejects empty updates", () => {
  assert.throws(
    () => buildAgentUpdateArgs({ agent_id: "agent-123" }),
    /No fields provided to update/,
  );
});

test("buildAutopilotTriggerAddArgs: uses trigger-add subcommand", () => {
  assert.deepEqual(
    buildAutopilotTriggerAddArgs({
      autopilot_id: "auto-123",
      cron: "0 9 * * *",
      label: "Daily",
      timezone: "Europe/Paris",
    }),
    [
      "autopilot",
      "trigger-add",
      "auto-123",
      "--cron",
      "0 9 * * *",
      "--label",
      "Daily",
      "--timezone",
      "Europe/Paris",
    ],
  );
});

test("buildAutopilotTriggerUpdateArgs: carries autopilot and trigger IDs", () => {
  assert.deepEqual(
    buildAutopilotTriggerUpdateArgs({
      autopilot_id: "auto-123",
      trigger_id: "trigger-456",
      enabled: false,
    }),
    [
      "autopilot",
      "trigger-update",
      "auto-123",
      "trigger-456",
      "--enabled=false",
    ],
  );
});

test("buildAutopilotTriggerDeleteArgs: uses trigger-delete subcommand", () => {
  assert.deepEqual(
    buildAutopilotTriggerDeleteArgs({
      autopilot_id: "auto-123",
      trigger_id: "trigger-456",
    }),
    ["autopilot", "trigger-delete", "auto-123", "trigger-456"],
  );
});

test("buildIssueRunMessagesArgs: includes issue and since when provided", () => {
  assert.deepEqual(
    buildIssueRunMessagesArgs({
      task_id: "task-123",
      issue_id: "issue-456",
      since: 42,
    }),
    ["issue", "run-messages", "task-123", "--issue", "issue-456", "--since", "42"],
  );
});

test("buildIssueRunMessagesArgs: omits since when absent", () => {
  assert.deepEqual(
    buildIssueRunMessagesArgs({
      task_id: "task-123",
    }),
    ["issue", "run-messages", "task-123"],
  );
});

test("buildAttachmentDownloadArgs: includes output_dir when provided", () => {
  assert.deepEqual(
    buildAttachmentDownloadArgs({
      attachment_id: "attachment-123",
      output_dir: "/tmp/with spaces",
    }),
    ["attachment", "download", "attachment-123", "-o", "/tmp/with spaces"],
  );
});

test("parseAttachmentDownloadPath: preserves spaces in returned path", () => {
  assert.equal(
    parseAttachmentDownloadPath("/tmp/My Report.pdf\n"),
    "/tmp/My Report.pdf",
  );
});

test("parseAttachmentDownloadPath: uses the last non-empty line", () => {
  assert.equal(
    parseAttachmentDownloadPath("\n/tmp/downloads/Quarterly Notes.txt\n\n"),
    "/tmp/downloads/Quarterly Notes.txt",
  );
});

test("autopilot schemas: get/update/delete/trigger require autopilot_id", () => {
  const schemas = [
    multicaGetAutopilotSchema,
    multicaUpdateAutopilotSchema,
    multicaDeleteAutopilotSchema,
    multicaTriggerAutopilotSchema,
  ];

  for (const schema of schemas) {
    assert.doesNotThrow(() => schema.parse({ autopilot_id: "auto-123" }));
    assert.throws(() => schema.parse({ id: "auto-123" }), /autopilot_id/);
  }
});

// --- resolveIssueId ---

const FAKE_UUID = "11111111-2222-3333-4444-555555555555";
const OTHER_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function makePage(issues: Array<{ id: string; identifier: string }>, has_more = false) {
  return {
    issues: issues.map((i) => ({
      ...i,
      number: 1,
      title: "t",
      description: null,
      status: "todo",
      priority: "medium",
      assignee_id: null,
      assignee_type: null,
      project_id: null,
      parent_issue_id: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    })),
    total: issues.length,
    limit: 100,
    offset: 0,
    has_more,
  };
}

test("resolveIssueId: UUID passthrough — no fetch call", async () => {
  let called = false;
  const result = await resolveIssueId(FAKE_UUID, async () => {
    called = true;
    return makePage([]);
  });
  assert.equal(result, FAKE_UUID);
  assert.equal(called, false);
});

test("resolveIssueId: short ID resolves to UUID", async () => {
  const fetcher = async () =>
    makePage([{ id: OTHER_UUID, identifier: "ABC-123" }]);
  const result = await resolveIssueId("ABC-123", fetcher);
  assert.equal(result, OTHER_UUID);
});

test("resolveIssueId: invalid ID format throws", async () => {
  const fetcher = async () => makePage([]);
  await assert.rejects(
    () => resolveIssueId("not-valid-id", fetcher),
    /not found/,
  );
});

test("resolveIssueId: short ID not in list throws", async () => {
  const fetcher = async () =>
    makePage([{ id: OTHER_UUID, identifier: "ABC-999" }]);
  await assert.rejects(
    () => resolveIssueId("ABC-123", fetcher),
    /Issue "ABC-123" not found/,
  );
});

test("resolveIssueId: paginates until has_more false", async () => {
  let calls = 0;
  const fetcher = async (offset: number) => {
    calls++;
    if (offset === 0) return makePage([{ id: "x", identifier: "ABC-000" }], true);
    return makePage([{ id: OTHER_UUID, identifier: "ABC-123" }], false);
  };
  const result = await resolveIssueId("ABC-123", fetcher);
  assert.equal(result, OTHER_UUID);
  assert.equal(calls, 2);
});
