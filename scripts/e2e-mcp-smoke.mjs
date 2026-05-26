#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const WORKSPACE_ID = process.env.E2E_WORKSPACE_ID || '84ec55ae-55bb-4423-a007-b007fae0af07';
const API_BASE = process.env.MULTICA_API_BASE_URL || 'https://kanban-api.lumeny.io';
const WEB_BASE = process.env.MULTICA_WEB_BASE_URL || 'https://kanban.lumeny.io';
if (!process.env.MULTICA_TOKEN) {
  console.error('MULTICA_TOKEN missing');
  process.exit(2);
}

const child = spawn('node', ['dist/server.js'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: {
    ...process.env,
    MULTICA_BACKEND: 'http',
    MULTICA_API_BASE_URL: API_BASE,
    MULTICA_WEB_BASE_URL: WEB_BASE,
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let nextId = 1;
let buffer = '';
const responses = new Map();
const stderr = [];
child.stderr.on('data', d => stderr.push(String(d)));
child.stdout.on('data', d => {
  buffer += String(d);
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined) responses.set(msg.id, msg);
    } catch {}
  }
});

function send(method, params) {
  const id = nextId++;
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return id;
}
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'e2e-smoke', version: '0' } } }) + '\n');
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');

async function waitResp(id, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (responses.has(id)) return responses.get(id);
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error(`timeout waiting for response ${id}; stderr=${stderr.join('').slice(-1000)}`);
}

async function callTool(name, args, timeoutMs = 60000) {
  const id = send('tools/call', { name, arguments: args });
  const resp = await waitResp(id, timeoutMs);
  if (resp.error) throw new Error(`${name} JSON-RPC error: ${JSON.stringify(resp.error)}`);
  const text = resp.result?.content?.find(c => c.type === 'text')?.text ?? '';
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  return { raw: resp.result, parsed };
}

function failIfToolError(name, result) {
  if (result.raw?.isError || result.parsed?.error) {
    throw new Error(`${name} tool error: ${JSON.stringify(result.parsed)}`);
  }
}

try {
  await waitResp(1, 10000);
  const toolsId = send('tools/list', {});
  const toolsResp = await waitResp(toolsId, 10000);
  const toolNames = toolsResp.result.tools.map(t => t.name);

  const workspaces = await callTool('multica_list_workspaces', {});
  failIfToolError('multica_list_workspaces', workspaces);

  const agents = await callTool('multica_list_agents', { workspace_id: WORKSPACE_ID });
  failIfToolError('multica_list_agents', agents);

  const runtimes = await callTool('multica_runtime_list', { workspace_id: WORKSPACE_ID });
  failIfToolError('multica_runtime_list', runtimes);

  const agentItems = agents.parsed.items || [];
  const runtimeItems = runtimes.parsed.items || [];
  const chosen = agentItems.find(a => /dgx/i.test(`${a.name} ${a.provider}`) && /codex/i.test(`${a.name} ${a.provider} ${a.model_hint}`))
    || agentItems.find(a => /codex/i.test(`${a.name} ${a.provider} ${a.model_hint}`))
    || agentItems[0];
  if (!chosen?.id) throw new Error('No agent available for E2E');

  const stamp = new Date().toISOString();
  const issue = await callTool('multica_create_issue', {
    workspace_id: WORKSPACE_ID,
    title: `[MCP E2E] read-only smoke ${stamp}`,
    description: `Goal: Perform a read-only smoke test for the multica-mcp integration.\n\nPlease respond with exactly:\n- your runtime/agent identity if available\n- current working directory\n- result: MCP_E2E_OK\n\nConstraints: Do not modify files, do not commit, do not push, do not access secrets. This is a disposable test issue created by Hermes MCP E2E.`,
    assignee_id: chosen.id,
    priority: 'low',
  }, 60000);
  failIfToolError('multica_create_issue', issue);

  const issueId = issue.parsed.id;
  let latestRuns = null;
  let latestMessages = null;
  let terminal = false;
  const start = Date.now();
  while (Date.now() - start < 180000) {
    const runs = await callTool('multica_issue_runs', { issue_id: issueId, workspace_id: WORKSPACE_ID }, 30000);
    failIfToolError('multica_issue_runs', runs);
    latestRuns = runs.parsed;
    const run = runs.parsed.items?.[0];
    if (run?.id) {
      const messages = await callTool('multica_issue_run_messages', { task_id: run.id, issue_id: issueId, workspace_id: WORKSPACE_ID }, 30000);
      if (!messages.raw?.isError && !messages.parsed?.error) latestMessages = messages.parsed;
      if (['completed', 'failed', 'cancelled', 'canceled'].includes(String(run.status))) {
        terminal = true;
        break;
      }
    }
    await new Promise(r => setTimeout(r, 5000));
  }

  console.log(JSON.stringify({
    ok: terminal,
    workspace_id: WORKSPACE_ID,
    api_base: API_BASE,
    tools_count: toolNames.length,
    discovery: {
      workspaces_count: workspaces.parsed.count ?? workspaces.parsed.items?.length ?? null,
      agents_count: agentItems.length,
      runtimes_count: runtimeItems.length,
    },
    selected_agent: chosen,
    issue: issue.parsed,
    latest_run: latestRuns?.items?.[0] ?? null,
    messages_count: latestMessages?.items?.length ?? latestMessages?.count ?? null,
    last_messages: (latestMessages?.items ?? []).slice(-10).map(m => ({ seq: m.seq, type: m.type, content: typeof m.content === 'string' ? m.content.slice(0, 1000) : undefined, output: typeof m.output === 'string' ? m.output.slice(0, 1000) : undefined })),
  }, null, 2));
} catch (err) {
  console.error(String(err?.stack || err));
  if (stderr.length) console.error('server stderr tail:', stderr.join('').slice(-2000));
  process.exitCode = 1;
} finally {
  child.stdin.end();
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), new Promise(r => setTimeout(r, 1000))]);
}
