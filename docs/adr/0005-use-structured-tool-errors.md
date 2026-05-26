# Use structured tool errors

`multica-mcp` tools should return a stable structured error object instead of exposing naked exception strings or tool-specific ad-hoc failure shapes. The standard shape is:

```json
{
  "error": {
    "code": "api_unreachable",
    "message": "Multica API is unreachable",
    "retryable": true,
    "details": {
      "api_base_url": "http://multica-backend:8080"
    }
  }
}
```

`code` is the machine-readable classifier, `message` is safe human-facing text, `retryable` tells Hermes whether retry/polling may help, and `details` carries sanitized context such as configured base URLs, workspace ids, HTTP status codes, or remediation hints. Details must not include bearer tokens, raw `Authorization` headers, or other secrets.

**Consequences:** wrapper code should normalize lower-level HTTP/network/auth/validation failures into this shape. Known codes include `api_unreachable`, `auth_not_configured`, `auth_failed`, `workspace_id_required`, `not_found`, `validation_failed`, `rate_limited`, `missing_backend_endpoint`, `not_implemented`, and `internal_error`. Unexpected exceptions may still be caught and mapped to `internal_error`, but raw stack traces should stay in logs, not tool output.

Use `missing_backend_endpoint` when the Multica backend does not expose the HTTP API needed for an existing tool operation. Use `not_implemented` when the backend API exists or is expected to exist, but `multica-mcp` has not wired the HTTP adapter/tool path yet. Both errors should include sanitized `details` naming the tool/operation and, when useful, the expected endpoint or capability.
