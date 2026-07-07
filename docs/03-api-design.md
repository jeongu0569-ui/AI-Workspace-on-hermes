# API Design

Base URL during local development:

```text
http://127.0.0.1:8787
```

## Workspace

### `GET /api/health`

Returns service health.

### `GET /api/workspace`

Returns configured workspace root, top-level roots, and Hermes connection
status.

### `GET /api/tree?root=notes`

Returns a folder tree listing for a root.

Supported root keys:

```text
workspace
notes
code
documents
attachments
```

Optional nested path:

```text
GET /api/tree?root=notes&path=Work
```

### `GET /api/file?path=Notes/Work/a.md`

Reads a text file. This is for markdown and small text/code files.

Large files should use `/api/raw` or future search/index APIs.

### `GET /api/raw?path=Documents/a.pdf`

Streams a raw file. This is useful for PDFs and images.

### `PUT /api/file?path=Notes/Work/a.md`

Writes a text file.

Body:

```json
{
  "content": "# Hello"
}
```

### `POST /api/file`

Creates a new file and fails if it already exists.

```json
{
  "path": "Notes/Work/new.md",
  "content": "# New"
}
```

### `POST /api/folder`

Creates a folder.

```json
{
  "path": "Notes/Work"
}
```

### `PATCH /api/file/move`

Moves or renames a file/folder.

```json
{
  "from": "Notes/Work/a.md",
  "to": "Notes/Work/b.md"
}
```

### `DELETE /api/file?path=Notes/Work/a.md`

Deletes a file or folder.

This endpoint exists for MVP development, but production UI should add undo or
trash semantics before exposing it casually.

## Context Router

### `POST /api/context`

Builds a Hermes-ready workspace context object from a client mention/scope
request.

Example for a single note:

```json
{
  "scopeType": "note",
  "scopePath": "Notes/Work/a.md"
}
```

Example for a folder:

```json
{
  "scopeType": "folder",
  "scopePath": "Notes/Operating Systems",
  "maxInlineFiles": 3
}
```

Example for a PDF:

```json
{
  "scopeType": "pdf",
  "scopePath": "Documents/os-book.pdf"
}
```

Supported scope types:

```text
none
selection
current
note
folder
pdf
tag
linked
workspace
```

Policy:

- `selection`, `current`, and short `note` context can include inline text.
- `folder`, `pdf`, `tag`, `linked`, and `workspace` recommend RAG/docsearch.
- All paths must be workspace-relative.

## Search

### `GET /api/search/status`

Returns the active search provider and indexing capability.

Current MVP provider:

```text
workspace-scan
```

This is a dependency-free fallback that scans text files in the workspace. It is
not a vector index and does not replace docsearch-mcp. It gives the client and
server a stable search API while the proper indexer is added.

### `POST /api/search`

Searches within a workspace-relative scope.

```json
{
  "query": "scheduler",
  "scopePath": "Notes/Operating Systems",
  "maxResults": 10
}
```

Response:

```json
{
  "provider": "workspace-scan",
  "query": "scheduler",
  "scopePath": "Notes/Operating Systems",
  "resultCount": 1,
  "results": [
    {
      "path": "Notes/Operating Systems/os.md",
      "kind": "markdown",
      "snippet": "... scheduler chooses a process ..."
    }
  ]
}
```

Future provider:

```text
docsearch-mcp / vector index
```

## Hermes Proxy

### `GET /api/hermes/models`

Proxies Hermes model options.

Current target:

```text
GET {HERMES_SERVER_URL}/api/model/options
```

### `GET /api/hermes/sessions`

Proxies Hermes sessions.

Current target:

```text
GET {HERMES_SERVER_URL}/api/sessions?limit=200
```

### `POST /api/hermes/sessions`

Creates a Hermes session through the REST endpoint when available.

Live WebSocket session creation will be added separately because it needs a
stateful `/api/ws` bridge.

## Live API

The client can connect to:

```text
WS /api/live
```

The Workspace Server then connects to Hermes:

```text
POST /api/auth/ws-ticket
WS   /api/ws?ticket=...
```

Client-friendly messages should stay close to Hermes event names:

```json
{ "type": "message.delta", "sessionId": "...", "text": "..." }
{ "type": "thinking.delta", "sessionId": "...", "text": "..." }
{ "type": "tool.start", "sessionId": "...", "tool": "read_file" }
{ "type": "approval.request", "sessionId": "...", "approvalId": "..." }
```

### Client Commands

Client-to-server WebSocket messages are JSON:

```json
{ "id": "1", "command": "connect" }
```

Create a Hermes session:

```json
{
  "id": "2",
  "command": "session.create",
  "params": {
    "provider": "google-antigravity",
    "model": "claude-opus-4-6",
    "reasoningEffort": "medium",
    "accessMode": "confirm"
  }
}
```

Submit a prompt:

```json
{
  "id": "3",
  "command": "prompt.submit",
  "params": {
    "sessionId": "20260707_...",
    "message": "이 노트 요약해줘",
    "contextRequest": {
      "scopeType": "note",
      "scopePath": "Notes/Work/a.md"
    }
  }
}
```

Respond to an approval:

```json
{
  "id": "4",
  "command": "approval.respond",
  "params": {
    "sessionId": "20260707_...",
    "approved": true
  }
}
```

Server responses use:

```json
{ "kind": "ready", "service": "ai-workspace-live" }
{ "kind": "result", "id": "3", "result": { "ok": true } }
{ "kind": "hermes.event", "type": "message.delta", "text": "..." }
{ "kind": "error", "id": "3", "error": "..." }
```
