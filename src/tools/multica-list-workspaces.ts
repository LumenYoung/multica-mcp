import { runMulticaRaw } from "../lib/multica-cli.js";
import {
  getMulticaBackendConfig,
  getMulticaHttpClient,
} from "../lib/multica-http-client.js";

export const multicaListWorkspacesSchema = {};

export type MulticaListWorkspacesInput = Record<string, never>;

function parseCliWorkspaces(out: string) {
  const lines = out
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const items = [];
  for (const line of lines) {
    if (/^ID\s+NAME$/i.test(line)) continue;
    const match = line.match(/^([0-9a-fA-F-]{36})\s+(.+)$/);
    if (match) items.push({ id: match[1], name: match[2].trim() });
  }
  return { items, count: items.length, raw: items.length === 0 ? out : undefined };
}

export async function multicaListWorkspaces(_input: MulticaListWorkspacesInput = {}) {
  const config = getMulticaBackendConfig();
  if (config.backend === "http") {
    const result = await getMulticaHttpClient().listWorkspaces();
    if (result.ok === false) return { error: result.error };
    return result.data;
  }

  const out = await runMulticaRaw(["workspace", "list"]);
  return parseCliWorkspaces(out);
}
