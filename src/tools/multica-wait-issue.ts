import { z } from "zod";
import { resolveIssueId, getIssueById } from "../lib/issues.js";
import { multicaIssueRuns } from "./multica-issue-runs.js";
import { multicaIssueRunMessages } from "./multica-issue-run-messages.js";
import type { AgentTask } from "../lib/types.js";
import { getMulticaBackendConfig, getMulticaHttpClient } from "../lib/multica-http-client.js";

const TERMINAL_RUN_STATES = new Set(["completed", "failed", "cancelled", "canceled"]);
const TERMINAL_ISSUE_STATES = new Set(["done", "cancelled", "canceled"]);

export const multicaWaitIssueSchema = z.object({
  issue_id: z.string().min(1),
  workspace_id: z.string().min(1).optional(),
  timeout_seconds: z.number().int().min(1).max(300).optional().default(60),
  poll_interval_seconds: z.number().int().min(1).max(30).optional().default(5),
  since: z.number().int().min(0).optional(),
  max_messages: z.number().int().min(0).max(200).optional().default(40),
});

export type MulticaWaitIssueInput = z.infer<typeof multicaWaitIssueSchema>;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asTaskList(value: Awaited<ReturnType<typeof multicaIssueRuns>>): AgentTask[] {
  if ("error" in value) return [];
  return Array.isArray(value.items) ? value.items : [];
}

function latestRun(runs: AgentTask[]): AgentTask | null {
  if (runs.length === 0) return null;
  return runs
    .slice()
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))[0];
}

function compactMessages(messages: unknown[], maxMessages: number) {
  if (maxMessages <= 0) return [];
  return messages.slice(-maxMessages).map((message) => {
    if (!message || typeof message !== "object") return message;
    const obj = message as Record<string, unknown>;
    const compact: Record<string, unknown> = {
      seq: obj.seq,
      type: obj.type,
    };
    if (typeof obj.content === "string") compact.content = obj.content;
    if (typeof obj.tool === "string") compact.tool = obj.tool;
    if (typeof obj.output === "string") {
      compact.output = obj.output.length > 2000 ? `${obj.output.slice(0, 2000)}…` : obj.output;
    }
    if (obj.input !== undefined) compact.input = obj.input;
    return compact;
  });
}

export async function multicaWaitIssue(input: MulticaWaitIssueInput) {
  const backendConfig = getMulticaBackendConfig();
  if (backendConfig.backend === "http" && !input.workspace_id) {
    return { error: { code: "workspace_id_required", message: "workspace_id is required in HTTP mode.", retryable: false } };
  }
  const issueId = backendConfig.backend === "http" ? input.issue_id : await resolveIssueId(input.issue_id);
  const timeoutSeconds = input.timeout_seconds ?? 60;
  const pollIntervalSeconds = input.poll_interval_seconds ?? 5;
  const maxMessages = input.max_messages ?? 40;
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (true) {
    const httpIssueResult = backendConfig.backend === "http"
      ? await getMulticaHttpClient().getIssue(issueId, input.workspace_id)
      : null;
    if (httpIssueResult?.ok === false) return { error: httpIssueResult.error };
    const lastIssue = httpIssueResult?.ok ? httpIssueResult.data : await getIssueById(issueId);
    const runsResult = await multicaIssueRuns({ issue_id: issueId, workspace_id: input.workspace_id });
    if ("error" in runsResult) return runsResult;
    const runs = asTaskList(runsResult);
    const lastRun = latestRun(runs);
    let lastMessages: unknown[] = [];

    if (lastRun?.id) {
      const messagesResult = await multicaIssueRunMessages({
        task_id: lastRun.id,
        issue_id: issueId,
        workspace_id: input.workspace_id,
        since: input.since,
      });
      if ("error" in messagesResult) return messagesResult;
      lastMessages = Array.isArray(messagesResult.items) ? messagesResult.items : [];
    }

    const runStatus = String(lastRun?.status ?? "");
    const issueStatus = String(lastIssue.status ?? "");
    const isTerminalRun = TERMINAL_RUN_STATES.has(runStatus);
    const isTerminalIssue = TERMINAL_ISSUE_STATES.has(issueStatus);
    if (isTerminalRun || isTerminalIssue) {
      return {
        state: "terminal",
        timed_out: false,
        issue: {
          id: lastIssue.id,
          short_id: lastIssue.identifier,
          title: lastIssue.title,
          status: lastIssue.status,
          updated_at: lastIssue.updated_at,
        },
        latest_run: lastRun,
        messages: compactMessages(lastMessages, maxMessages),
        message_count: lastMessages.length,
      };
    }

    if (Date.now() >= deadline) {
      return {
        state: "timeout",
        timed_out: true,
        issue: {
          id: lastIssue.id,
          short_id: lastIssue.identifier,
          title: lastIssue.title,
          status: lastIssue.status,
          updated_at: lastIssue.updated_at,
        },
        latest_run: lastRun,
        messages: compactMessages(lastMessages, maxMessages),
        message_count: lastMessages.length,
        next_poll_hint: "Call multica_wait_issue again with the same issue_id and a short timeout, or call multica_issue_runs / multica_issue_run_messages directly.",
      };
    }

    const remainingMs = deadline - Date.now();
    await sleep(Math.min(pollIntervalSeconds * 1000, Math.max(0, remainingMs)));
  }
}
