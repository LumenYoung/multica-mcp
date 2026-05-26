# multica-mcp Context

`multica-mcp` is the MCP adapter context for letting MCP-capable chat clients delegate work through Multica without taking ownership of remote runtime execution.

## Language

**Multica API Base URL**:
The backend HTTP origin that `multica-mcp` calls to reach Multica's API.
_Avoid_: app URL, frontend URL, public domain

**Internal API Base URL**:
A Multica API Base URL that resolves through the deployment's private container network, canonically `http://multica-backend:8080` for the self-hosted Hermes deployment.
_Avoid_: public API URL, `backend`

**Public API Base URL**:
A Multica API Base URL that reaches the backend through the public HTTPS endpoint, such as `https://kanban-api.lumeny.io`.
_Avoid_: internal API URL

**Multica Web Base URL**:
The frontend/web origin used only to build human-facing links to Multica resources.
_Avoid_: API URL, backend URL, internal link

**Multica Backend Alias**:
The Docker-network service alias that makes the Multica backend reachable to `multica-mcp`; for the self-hosted Hermes deployment this alias is `multica-backend`.
_Avoid_: generic `backend`

**Workspace ID**:
The explicit Multica workspace identifier supplied to a workspace-scoped tool call.
_Avoid_: implicit workspace, global workspace

**Multica API Token**:
The secret bearer token supplied to `multica-mcp` through process environment or secret management for authenticating API calls.
_Avoid_: tool argument token, CLI profile token, browser session

**Multica Tool Error**:
A structured error object returned by a `multica-mcp` tool when it cannot complete successfully.
_Avoid_: naked exception text, ad-hoc per-tool error shape

**Multica Tool Result**:
The natural, tool-specific success payload returned by a `multica-mcp` tool.
_Avoid_: mandatory success envelope, discriminated union envelope

**Complete HTTP Tool Surface**:
The first HTTP-backed implementation scope that covers every existing CLI-backed `multica-mcp` tool, including delegation, project, autopilot, attachment, runtime, and workspace tools.
_Avoid_: delegation-only subset, permanent CLI split

**Production HTTP Mode**:
The `multica-mcp` runtime mode where tool calls use only the configured **Multica API Base URL** and never shell out to the `multica` CLI.
_Avoid_: per-tool CLI fallback, mixed production backend

## Relationships

- `multica-mcp` calls exactly one **Multica API Base URL** at runtime.
- An **Internal API Base URL** depends on a **Multica Backend Alias** being resolvable from the `multica-mcp` runtime container.
- A **Public API Base URL** is a fallback/development option, not the preferred self-hosted Hermes path.
- The **Multica Web Base URL** is separate from the **Multica API Base URL** and is used for human links, not API calls.
- Every workspace-scoped tool call carries a **Workspace ID** explicitly; `multica_list_workspaces` is the discovery tool for finding valid workspace IDs.
- `multica-mcp` authenticates API calls with a **Multica API Token** from process environment or secret management, never from tool arguments.
- Failed tool calls return a **Multica Tool Error** shape so Hermes can classify retryable deployment/auth/user-input failures.
- Successful tool calls return a **Multica Tool Result** with tool-specific fields rather than a mandatory envelope; workspace-scoped results echo the **Workspace ID**.
- The first HTTP-backed implementation targets the **Complete HTTP Tool Surface**, not a delegation-only subset.
- In **Production HTTP Mode**, missing HTTP coverage fails explicitly instead of falling back to the CLI.

## Example dialogue

> **Dev:** "Should Hermes call `kanban-api.lumeny.io`?"
> **Domain expert:** "No, in self-hosted deployment `multica-mcp` should use the **Internal API Base URL** `http://multica-backend:8080`; keep the **Public API Base URL** only as a configurable fallback."

## Flagged ambiguities

- "domain" previously referred both to the public API hostname and the backend API origin — resolved: use **Multica API Base URL** for the API origin and **Multica Web Base URL** for frontend links.
- "internal link" is ambiguous with **Internal API Base URL** — resolved: use **Multica Web Base URL** for human-facing links, even when the link points to the public web app.
- "backend" is too generic as a container/service name — resolved: use the **Multica Backend Alias** `multica-backend` for Hermes self-host deployment wiring.
