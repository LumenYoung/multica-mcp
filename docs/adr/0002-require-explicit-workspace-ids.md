# Require explicit workspace IDs for workspace-scoped tools

`multica-mcp` should require each workspace-scoped tool call to provide a `workspace_id` instead of silently defaulting to `MULTICA_WORKSPACE_ID`. The adapter may still use environment values for configuration and examples, but execution should make the target workspace explicit so Hermes does not accidentally operate in `work` when the user meant `selfhost`, or vice versa.

**Consequences:** `multica_list_workspaces` must remain available as a discovery tool and does not require a workspace id. Workspace-scoped tool results should echo the effective `workspace_id`, and tests should cover missing-workspace validation. This is slightly more verbose for Hermes prompts, but it is safer for cross-workspace operation than relying on global ambient workspace state.
