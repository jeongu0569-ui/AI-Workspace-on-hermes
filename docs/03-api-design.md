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

## Future Live API

The client should eventually connect to:

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

