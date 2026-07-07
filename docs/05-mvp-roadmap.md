# MVP Roadmap

## Phase 0: Planning

Status: started.

- Define product goal.
- Define server-centered workspace architecture.
- Define first API surface.
- Keep Hermes as the AI runtime.

## Phase 1: Workspace Server

Status: in progress.

- Initialize workspace root.
- Create `Notes/`, `Code/`, `Documents/`, `Attachments/`.
- Add path-safe REST APIs.
- Add basic Hermes models/sessions proxy.
- Add metadata placeholder.

Exit criteria:

- `npm run check` passes.
- Server can list `Notes` and `Code`.
- Server rejects absolute and traversal paths.
- Server can create/read/write/move/delete a markdown file.

## Phase 2: Hermes Live Bridge

Status: next.

- Dashboard username/password login.
- `/api/auth/ws-ticket` support.
- Workspace Server `/api/live` WebSocket.
- Bridge Hermes events:
  - message
  - thinking/reasoning
  - tools
  - approvals
- Client-friendly approval response command.

## Phase 3: Apple Client MVP

Status: planned.

- SwiftUI app shell.
- Sidebar:
  - Chat
  - Notes
  - Code
- Notes file tree.
- Markdown editor.
- PDF viewer through server raw file endpoint.
- Hermes chat view.

## Phase 4: Notes Context Router

Status: planned.

Mention types:

```text
@current
@selection
@note
@folder
@pdf
@tag
@linked
@workspace
```

Rule:

- small context inline
- large context as RAG/search metadata

## Phase 5: docsearch Integration

Status: planned.

- Watch workspace root.
- Index markdown, PDF, and selected text/code file types.
- Store index status.
- Send search hints to Hermes.

## Phase 6: Code Workspace

Status: planned.

- Project tree under `Code/`.
- File viewer/editor.
- Hermes coding session creation.
- Diff viewer.
- Approval UI.
- Git operation visibility.

