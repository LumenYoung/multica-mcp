# Use environment/secret API token only

`multica-mcp` should authenticate direct HTTP API calls with a Multica API Token supplied through process environment or secret management, not through MCP tool parameters and not by falling back to CLI profile files. Tool schemas must not accept token fields.

**Consequences:** deployments must provide `MULTICA_TOKEN` (or an equivalent secret-backed environment value) before API-backed tools can succeed. During the HTTP migration stage, `MULTICA_BACKEND=http` should fail fast at server startup if `MULTICA_TOKEN` is missing rather than starting and returning `auth_not_configured` on every affected tool call. Logs, errors, and tool outputs must redact bearer tokens and should never include raw `Authorization` headers. CLI-backed mode may continue to use CLI authentication only when explicitly selected for development/debugging, but the production HTTP backend must not depend on human shell profile state.
