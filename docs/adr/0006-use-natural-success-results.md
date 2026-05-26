# Use natural success results

`multica-mcp` should not force all successful tool calls into a universal envelope such as `{ "ok": true, "data": ... }`. Successful results should keep tool-specific, natural payload shapes that are easy for Hermes/LLMs to read and summarize.

Failures remain standardized through the structured tool error shape documented separately.

**Minimum success-result rules:** workspace-scoped tools must echo the effective `workspace_id`; creation tools should return stable identifiers such as `id`/`short_id` plus an optional human-facing `url`; list tools should return clear collection fields such as `items` and `count` when appropriate. Do not include `api_base_url` in ordinary success payloads unless it is directly relevant to the tool result, because that adds noise and may encourage callers to depend on deployment details.
