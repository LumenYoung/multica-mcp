# multica-mcp

An MCP server (stdio, TypeScript) that wraps the `multica` CLI so an LLM chat can drive Multica directly: open issues, assign agents, follow progress, chain workflows.

## Why this exists

The Multica CLI is the main tool. It covers everything this MCP covers, plus more, and it is the right fit for most workflows. Nothing here is meant to replace it.

This MCP is for one specific situation:

> I find Claude Desktop (regular chat) is the best environment for brainstorming and architecture discussions, but I needed it to be able to open Multica issues, assign agents, follow progress, and chain sequential workflows directly from the conversation, without switching to a terminal. That is why I built this MCP.

If you spend your thinking time in an LLM chat (Claude Desktop, Codex Desktop, or any MCP-capable client), this lets the chat itself talk to Multica. If you live in the terminal, keep using the CLI.

### Concrete use cases

- Brainstorm in chat, then hand off concrete pieces to Multica agents without leaving the conversation
- Run a sprint planning from the chat: draft issues, set priorities, assign agents, queue follow-ups
- Review agent results from chat: pull run messages, read comments, comment back, re-open or re-assign

## Requirements

- `multica` installed on `PATH` and authenticated
- Multica daemon running
- Node.js 20+
- `pnpm`

## Build

```bash
cd /path/to/multica-mcp && pnpm install && pnpm build
```

The bundle is emitted at `dist/server.js`.

## Run

```bash
cd /path/to/multica-mcp && pnpm start
```

## Logs

Tool calls are logged as JSONL with `timestamp`, `tool`, `params`, `duration_ms`, `success`, and `error` when relevant. The log file is resolved in this order:

1. `MULTICA_MCP_LOG_PATH` environment variable (absolute path)
2. `$XDG_STATE_HOME/multica-mcp/calls.log`
3. `~/.local/state/multica-mcp/calls.log`

## Configuration

| Env var                | Purpose                                                   |
| ---------------------- | --------------------------------------------------------- |
| `MULTICA_WEB_BASE_URL` | Web base URL used only when building human-facing issue and project URLs |
| `MULTICA_APP_URL`      | Backwards-compatible alias for `MULTICA_WEB_BASE_URL` during migration   |
| `MULTICA_MCP_LOG_PATH` | Absolute path override for the JSONL log                                 |
| `XDG_STATE_HOME`       | Standard XDG base dir for the default log location                       |

When no web base URL is configured, tools still return stable IDs and use `null`/omitted URLs rather than guessing localhost. API requests must use `MULTICA_API_BASE_URL`, not the web base URL.

## Tools

### `multica_list_agents`

Returns `[{ id, name, provider, model_hint, description }]`.

```json
{}
```

### `multica_list_projects`

Returns `[{ id, name, description, issue_count }]`.

```json
{}
```

### `multica_create_project`

Returns `{ id, name, url }`.

```json
{
  "name": "Onboarding revamp",
  "description": "Agent coordination project for the onboarding revamp."
}
```

### `multica_create_issue`

Returns `{ id, short_id, title, status, assignee, url }`.

```json
{
  "title": "Add a login flow",
  "description": "Detailed context in markdown...",
  "assignee": "claude-sonnet",
  "project": "Onboarding revamp",
  "priority": "medium",
  "cwd": "/path/to/repo"
}
```

### `multica_list_issues`

Returns `{ items, state, total, offset, has_more, next_offset }`. Use `offset` together with `next_offset` to paginate past the first 100.

```json
{
  "status": ["todo", "in_progress"],
  "project": "Onboarding revamp",
  "limit": 20,
  "offset": 0,
  "sort": "updated_desc"
}
```

### `multica_get_issue`

Returns `{ id, short_id, title, description, status, assignee, project, priority, comments, task }`. Set `include_comments: false` to skip comments on heavily-threaded issues.

```json
{ "issue_id": "ABC-12", "include_comments": true }
```

### `multica_list_comments`

Paginated comment listing with `limit`, `offset`, `since` (RFC3339). Returns `{ id, parent_id, author, author_type, content, created_at }` per comment.

```json
{ "issue_id": "ABC-12", "since": "2026-04-01T00:00:00Z" }
```

### `multica_issue_runs`

Lists all execution runs for an issue (status, timestamps, errors).

```json
{ "issue_id": "ABC-12" }
```

### `multica_issue_run_messages`

Streams the messages of a single run, with incremental fetch via `since` (sequence number).

```json
{ "task_id": "<task-uuid>", "since": 0 }
```

### `multica_issue_search`

Full-text search on issue titles and descriptions.

```json
{ "query": "login redirect", "limit": 20 }
```

### `multica_add_comment`

Returns `{ comment_id, created_at }`.

```json
{
  "issue_id": "ABC-12",
  "content": "Additional context for the agent."
}
```

### `multica_update_issue`

Returns `{ id, short_id, title, status, assignee, priority, updated_at }`.

```json
{
  "issue_id": "ABC-12",
  "status": "in_review",
  "priority": "high"
}
```

### `multica_get_runtime_usage`

Per-runtime `{ runtime_id, name, tokens_today, models_used_today, usage_30d }`. Use `window` to scope: `today` | `30d` | `both` (default).

```json
{ "runtime_name": "Codex", "window": "today" }
```

### `multica_runtime_list`

Lists runtimes (provider, mode, status, `last_seen_at`). Needed to obtain the `runtime_id` used by `multica_agent_create`.

```json
{}
```

### `multica_agent_create`

Creates a new agent bound to a runtime.

```json
{
  "name": "claude-opus",
  "runtime_id": "<runtime-uuid>",
  "description": "Senior architect for design and refactoring.",
  "instructions": "Keep replies brief and evidence-based.",
  "custom_args": ["--model", "claude-opus-4-1"]
}
```

### `multica_agent_update`

Updates agent name, description, instructions, runtime, args, concurrency, visibility, or status.

```json
{
  "agent_id": "<uuid>",
  "status": "paused",
  "runtime_id": "<runtime-uuid>"
}
```

### `multica_workspace_members`

Lists workspace members. Required to build `@` mentions in comments.

```json
{}
```

### `multica_attachment_download`

Downloads an attachment to a local path. Returns `{ path, attachment_id }`.

```json
{ "attachment_id": "<uuid>", "output_dir": "./downloads" }
```

### `multica_list_autopilots`

Returns the autopilots defined in the workspace.

```json
{ "status": "active" }
```

### `multica_get_autopilot`

Returns a single autopilot with its triggers.

```json
{ "autopilot_id": "<uuid>" }
```

### `multica_create_autopilot`

Creates an autopilot (scheduled/triggered agent automation).

```json
{
  "title": "Daily triage",
  "agent": "claude-opus",
  "mode": "create_issue",
  "description": "Triage new issues every morning."
}
```

### `multica_update_autopilot`

Updates an autopilot (title, description, status).

```json
{ "autopilot_id": "<uuid>", "status": "paused" }
```

### `multica_trigger_autopilot`

Runs an autopilot once, on demand.

```json
{ "autopilot_id": "<uuid>" }
```

### `multica_delete_autopilot`

Deletes an autopilot.

```json
{ "autopilot_id": "<uuid>" }
```

### `multica_autopilot_trigger_add`

Attaches a cron trigger to an existing autopilot.

```json
{
  "autopilot_id": "<uuid>",
  "cron": "0 9 * * MON-FRI",
  "label": "weekday-morning",
  "timezone": "Europe/Paris"
}
```

### `multica_autopilot_trigger_update`

Updates cron, label, timezone, or enabled state.

```json
{ "autopilot_id": "<uuid>", "trigger_id": "<uuid>", "enabled": false }
```

### `multica_autopilot_trigger_delete`

Deletes a single trigger from an autopilot.

```json
{ "autopilot_id": "<uuid>", "trigger_id": "<uuid>" }
```

## Smoke test

```bash
cd /path/to/multica-mcp && pnpm test
```

The smoke test boots the server over stdio, verifies `initialize` and `tools/list`, then exercises the tools against a temporary project and issue before cleaning up.

## Install per client

The paths and commands below match the current public docs of each client and have been applied locally.

### Claude Desktop

Local MCP servers for Claude Desktop are declared in `claude_desktop_config.json`. On macOS:

`~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "multica": {
      "command": "node",
      "args": ["/absolute/path/to/multica-mcp/dist/server.js"]
    }
  }
}
```

Restart Claude Desktop afterwards.

### Claude Code

Claude Code exposes `claude mcp add-json` with `--scope user`:

```bash
claude mcp add-json --scope user multica '{"type":"stdio","command":"node","args":["/absolute/path/to/multica-mcp/dist/server.js"]}'
```

This entry is persisted in `~/.claude.json`.

Check:

```bash
claude mcp get multica
```

### Codex CLI

Codex CLI loads its configuration from `~/.codex/config.toml`:

```toml
[mcp_servers.multica]
command = "node"
args = [ "/absolute/path/to/multica-mcp/dist/server.js" ]
```

Equivalent CLI command:

```bash
codex mcp add multica -- node /absolute/path/to/multica-mcp/dist/server.js
```

Check:

```bash
codex mcp get multica
```

### Codex Desktop

The Codex app reuses the Codex CLI configuration. As long as `~/.codex/config.toml` contains the `multica` entry, there is nothing else to wire up.

## Known limitations

- Source of truth for the billed model is `multica runtime usage`, not the agent self-report
- Codex uses `-c key=value`, not `--profile`
- No persistent memory on the Multica side yet; a dedicated skill will come later
- `cwd` is not a native flag of `multica issue create`; the MCP injects it as a markdown hint
- If the Multica daemon is down, tools return a structured error: `daemon down, run 'multica daemon start'`

## Advanced usage

For advanced usage patterns and best practices — routing matrix, safe issue creation, sequential chaining, PQR (dual reviewer), tool-call caps, token optimization, known limitations, and anti-patterns — see [SKILL.md](SKILL.md).

It is written for agents driving Multica through this MCP, but it reads fine as a human guide too.

## Sources

- Anthropic Help Center, remote MCP connectors vs local servers declared in `claude_desktop_config.json`:
  `https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp`
- `claude mcp --help` and `claude mcp add-json --help` for the official Claude Code command
- OpenAI, "Introducing the Codex app", on the app reusing the Codex CLI configuration:
  `https://openai.com/index/introducing-the-codex-app/`
- `codex mcp --help` and `codex mcp add --help` for the official CLI syntax and persistence in `~/.codex/config.toml`
