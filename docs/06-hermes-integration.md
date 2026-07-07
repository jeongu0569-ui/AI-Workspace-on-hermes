# Hermes Integration Notes

This project should reuse the lessons from the Obsidian Hermes Connection
plugin, but not its Obsidian-specific assumptions.

## Useful Hermes Connection Patterns

The plugin proved that the most useful Hermes path is the live WebSocket path:

```text
Dashboard login
→ POST /api/auth/ws-ticket
→ WS /api/ws?ticket=...
→ JSON-RPC session.create
→ JSON-RPC prompt.submit
→ live events
→ JSON-RPC approval.respond
```

Important event types:

```text
message.delta
thinking.delta
reasoning.delta
tool.start
tool.progress
tool.complete
approval.request
message.complete
turn.complete
```

## Implemented Workspace Live Bridge

The Workspace Server now exposes:

```text
WS /api/live
```

The client sends JSON commands such as:

```text
connect
session.create
session.resume
prompt.submit
approval.respond
config.accessMode
```

The server logs in to the Hermes dashboard with the configured username and
password, requests `/api/auth/ws-ticket`, opens Hermes `/api/ws`, and forwards
Hermes events back to the app as `hermes.event` messages.

The bridge keeps the client app from needing to know Hermes dashboard cookies or
WebSocket tickets.

## Why Workspace Server Should Bridge Hermes

The client could connect directly to Hermes, but a server bridge is better:

- iPhone/macOS clients only need one workspace URL.
- Credentials stay server-side when desired.
- Workspace paths can be translated to safe relative metadata.
- Notes/PDF/code context routing can be applied before the prompt reaches
  Hermes.
- Future multi-user profile routing can live in one place.

## REST Fallback

Hermes REST endpoints are useful for:

```text
GET /api/model/options
GET /api/sessions
POST /api/sessions
```

But live chat should use `/api/live` when available because REST fallback may
not show full reasoning/tool/approval activity.

## Context Metadata Shape

The app should send workspace context as structured metadata where Hermes
supports it. Until Hermes has a richer metadata channel for live prompts, the
server may need to include a compact context preface.

Example:

```json
{
  "workspace": {
    "rootName": "HermesWorkspace",
    "activePath": "Notes/Work/os.md",
    "scopeType": "folder",
    "scopePath": "Notes/Work",
    "ragRecommended": true,
    "ragSearchProvider": "docsearch-mcp"
  }
}
```

## RAG Principle

Do not attach everything.

Inline:

- selected text
- current short markdown note
- one short mentioned note

Search hint:

- folders
- PDFs
- tags
- linked resources
- whole workspace
- code projects

Hermes should use MCP/docsearch for broad questions.
