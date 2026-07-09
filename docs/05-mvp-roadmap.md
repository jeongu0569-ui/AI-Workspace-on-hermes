# MVP Roadmap

## Phase 0: Direction Reset

Status: done.

- Product name is AI Workspace.
- `aiw` remains the user-facing CLI.
- AI Workspace owns runtime state.
- External server wrapper language is removed from the target architecture.
- Local reference runtime code remains a migration source, not the product
  boundary.

## Phase 1: Workspace Server

Status: in progress.

- Initialize workspace root.
- Create `Notes/`, `Code/`, `Documents/`, `Attachments/`.
- Add path-safe REST APIs.
- Add file/folder create, move, copy, upload, delete.
- Add metadata and `.ai-workspace` state root.
- Add render/search/context services.

Exit criteria:

- `npm run check` passes.
- Server can list `Notes` and `Code`.
- Server rejects absolute and traversal paths.
- Server can create/read/write/move/delete a markdown file.

## Phase 2: Runtime Ownership

Status: in progress.

- `aiw model` uses AI Workspace model config.
- `aiw provider list` uses AI Workspace provider registry.
- `aiw auth` writes AI Workspace credential config.
- `/api/models` returns AI Workspace model options.
- `/api/sessions` returns AI Workspace sessions.
- `/api/live` emits `runtime.event`.

Remaining:

- Implement real model execution backend.
- Stream model output through AI Workspace events.
- Persist assistant replies directly in `.ai-workspace/sessions`.
- Port provider/model/auth logic into dedicated `server/lib/runtime/*` modules.
- Add OAuth flows for account-based providers.

## Phase 3: Code Runtime

Status: in progress.

- Code project inspect: done.
- Related file search: done.
- Proposed patch creation: done.
- Approval inbox: done.
- Patch apply after approval: done.
- Check command execution with approval: done.
- Git status/diff capture: done.
- Task memory accumulation: done.
- Code-surface tool calls route through `CodeAgentRuntime`: done.
- Approval-required MCP tool calls propagate to task/approval state and resume only the approved pending tool: done.

Remaining:

- Rich diff viewer.
- Automatic LLM-authored patch generation through the AI Workspace runtime.
- Failure-log-based repair loop.
- Stronger sandbox policy.

## Phase 3.5: Runtime Recall And Tool Modes

Status: in progress.

- Surface-based tool modes: done.
- Same-turn safe tool discovery: done.
- Fuzzy conversation search/read: done.
- Calendar `last_week` and rolling `last_7_days` time ranges: done.
- Session summaries with topics/decisions/entities/preferences/source ids: done.
- Long-term user/project/folder/session memory extraction: first pass done.
- Prompt assembly with summary + recent messages + relevant memory: done.
- General `[Chat]` overflow archive policy, latest 30 visible: done.

Remaining:

- Stronger semantic memory ranking.
- Richer folder/project conversation management UI.
- Embedding-backed recall once native vector indexing matures.

## Phase 4: Apple Client

Status: in progress.

- Xcode project structure: done.
- macOS/iOS targets: started.
- Chat shell: in progress.
- Notes/Code tree: in progress.
- Markdown/code rendering: in progress.
- Session/model menus: in progress.
- Approval/task controls: in progress.

Remaining:

- Rename remaining internal Hermes-era Swift symbols.
- Make the client talk only to AI Workspace public APIs.
- Improve Notes/PDF/Code editor surfaces.
- Add right-side global chat panel polish.
- Add upload manager progress and retry UX.

## Phase 5: Notes/PDF/Search

Status: planned.

- Markdown reading mode and edit mode.
- PDF reading and annotation mode.
- Server-side thumbnails and page previews.
- Search/index status UI.
- MCP/docsearch ownership under AI Workspace runtime.
