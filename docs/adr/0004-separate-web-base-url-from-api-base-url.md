# Separate web base URL from API base URL

`multica-mcp` should use `MULTICA_API_BASE_URL` only for machine API requests and a separate Multica Web Base URL only for human-facing links returned in tool results. The adapter must not derive the API base URL from the web URL and must not use the web URL for API calls.

Use the env name `MULTICA_WEB_BASE_URL` for the web/link origin going forward. Existing `MULTICA_APP_URL` may remain as a backwards-compatible alias during migration, but docs and new code should prefer `MULTICA_WEB_BASE_URL`.

**Consequences:** if the web base URL is missing, tools should still succeed and return stable identifiers with `url: null` or omit `url`. Tool results should prefer stable IDs plus an optional web URL, for example `{ "id": "...", "short_id": "ABC-12", "url": "https://kanban.lumeny.io/issues/ABC-12" }`. This keeps machine connectivity independent from human navigation links.
