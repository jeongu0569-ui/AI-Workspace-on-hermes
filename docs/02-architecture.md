# Architecture

## High-Level Shape

```text
iOS / macOS Client
        │
        ▼
Workspace Server
        │
        ├── Filesystem workspace root
        ├── Metadata DB
        ├── Search/index state
        ├── Hermes API proxy
        └── Future live event bridge
        │
        ▼
Hermes Server
        ├── Sessions
        ├── Models
        ├── Tools
        ├── Approvals
        └── MCP/docsearch
```

The client should not talk directly to random filesystem paths. It talks to the
Workspace Server using workspace-relative paths.

## Why App → Workspace Server → Hermes

The Obsidian plugin connected directly to Hermes because the Vault already lived
inside Obsidian. The new app should put the Workspace Server in the middle.

Benefits:

- One place to enforce path safety.
- One place to map file IDs, relative paths, and metadata.
- One place to issue Hermes login and WebSocket tickets.
- One place to control mobile caching.
- One place to translate `@folder`, `@pdf`, and `@workspace` into RAG/search
  scope metadata.

## Filesystem As Source Of Truth

Files remain visible as normal folders and files:

```text
HermesWorkspace/Notes/Work/meeting.md
HermesWorkspace/Documents/os-book.pdf
HermesWorkspace/Code/my-app/package.json
```

The metadata DB should not replace files. It augments them:

- stable file ID
- relative path
- type
- tags
- backlinks
- checksum
- indexed status
- thumbnail/cache paths
- Hermes session associations

## Path Rule

Clients only send relative paths:

```text
Notes/Work/meeting.md
Code/project-a/src/main.ts
Documents/os-book.pdf
```

The server rejects:

```text
/Users/user/Desktop/secret.txt
../../etc/passwd
C:/Users/user/secret.txt
```

This is the most important early invariant.

## Hermes Integration

The existing Hermes Connection plugin proved these useful flows:

```text
POST /api/auth/ws-ticket
WS   /api/ws
RPC  session.create
RPC  session.resume
RPC  prompt.submit
RPC  approval.respond
```

The Workspace Server should eventually expose a client-friendly live endpoint
that bridges those Hermes events:

```text
message.delta
thinking.delta
reasoning.delta
tool.start
tool.progress
tool.complete
approval.request
message.complete
```

The first scaffold only includes REST proxy endpoints for models and sessions.
Live streaming is intentionally left as the next implementation step.

## Notes Context Router

Small context can be sent inline:

- selected text
- current markdown note
- one short note

Large context should be passed as search scope metadata:

- PDF
- folder
- tag
- linked resources
- whole workspace

Example metadata:

```json
{
  "workspace": {
    "scopeType": "folder",
    "scopePath": "Notes/Operating Systems",
    "ragRecommended": true,
    "ragSearchProvider": "docsearch-mcp"
  }
}
```

Hermes/docsearch should perform the actual search.

## Code Area

Code projects live under `Code/`, but should have stricter permission handling
than Notes.

Future modes:

```text
Safe: Hermes dangerous-command approval prompts stay on.
Full: Hermes yolo/full mode may bypass dangerous-command prompts.
```

The client should show diffs and approvals before users trust automated code
changes.

