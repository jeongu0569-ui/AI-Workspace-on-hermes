# Architecture

## High-Level Shape

Current shape (`aiw serve` workspace bridge + Hermes core wrapper):

```text
iOS / macOS Client
        │
        ▼
aiw serve (Workspace Server)
        │
        ├── Filesystem workspace root
        ├── .ai-workspace/ state store
        │   ├── tasks/, approvals/, decisions/
        │   ├── diffs/, tool-logs/, memory/
        │   └── sessions/<id>.json
        └── WorkspaceAgentEngine
            ├── ChatRuntime       – Hermes live backend wrapper
            ├── ModelRuntime      – Hermes model options wrapper
            ├── SessionRuntime    – Hermes sessions + workspace summaries
            ├── LLMRuntime        – structured LLM calls through Hermes
            └── CodeAgentRuntime  – task/patch/approval/git loop
```

Target shape:

```text
iOS / macOS Client
        │
        ▼
aiw serve
        │
        ├── Workspace Server
        ├── Workspace Engine
        │   ├── Hermes chat/session/model/provider/auth wrapper
        │   ├── Tool/MCP router
        │   ├── Notes/PDF context runtime
        │   └── CodeAgentRuntime
        ├── Filesystem workspace root
        ├── Search/index state
        ├── Task memory/log/diff store
        └── Approval/safety gate
```

Hermes remains the owner of model/provider/auth/codex/provider-plugin behavior.
AI Workspace does not keep a parallel provider registry or credential store.
When Hermes is unavailable, chat and automatic LLM patch generation are
unavailable, while filesystem, search, task, diff, approval, and manual patch
features continue to work.

## Why App → Workspace Server → Agent Engine

The Obsidian plugin connected directly to Hermes because the Vault already lived
inside Obsidian. The new app puts the Workspace Server in the middle.

Benefits:

- One place to enforce path safety.
- One place to map file IDs, relative paths, and metadata.
- One place to issue Hermes login and WebSocket tickets.
- One place to control mobile caching.
- One place to translate `@folder`, `@pdf`, and `@workspace` into RAG/search
  scope metadata.
- One place to own task logs, decisions, diffs, and memory even if the live
  model/tool backend changes later.

## Filesystem As Source Of Truth

Files remain visible as normal folders and files:

```text
HermesWorkspace/Notes/Work/meeting.md
HermesWorkspace/Documents/os-book.pdf
HermesWorkspace/Code/my-app/package.json
HermesWorkspace/.ai-workspace/tasks/task-....json
HermesWorkspace/.ai-workspace/sessions/<sessionId>.json
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
- session associations

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

## Hermes Core Wrapper Layer

`server/lib/hermes-compat.mjs` is the current Hermes wrapper boundary. It
connects to Hermes `/api/ws`, uses dashboard auth when configured, forwards
thinking/tool/approval/message events, and exposes session/model helpers.

- `HermesCompatChatBackend` wraps `HermesLiveClient` with the `ChatBackend`
  interface.
- `ChatRuntime` uses this Hermes backend only. There is no direct
  OpenAI-compatible fallback inside AI Workspace.
- `ModelRuntime` reads Hermes model options instead of scanning workspace
  provider settings.
- `SessionRuntime` keeps workspace-friendly normalized session views but does
  not replace Hermes session ownership.

Future work can replace the WebSocket compatibility boundary with a tighter
in-process Hermes core integration, but it should still reuse Hermes'
`hermes_cli` provider/auth/model implementation rather than cloning it.

## Chat / Provider / Auth Ownership

Hermes owns:

```text
hermes model
hermes auth
hermes config
hermes_cli/providers.py
hermes_cli/auth.py
hermes_cli/runtime_provider.py
plugins/model-providers/*
```

AI Workspace owns task state and UI-facing workflow state, not model
credentials. The `aiw model` and `aiw auth` commands delegate directly to
Hermes. `aiw provider list` is read-only orientation output from Hermes'
provider catalog; provider mutation stays in Hermes.

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

Implemented server API:

```text
POST /api/context
POST /api/search
GET  /api/search/status
```

The same context request shape can be sent inside live `prompt.submit` as
`contextRequest`, so clients do not need to duplicate folder/PDF/RAG routing
logic.

The first search implementation is `workspace-scan`, a dependency-free text scan
fallback. It is intentionally simple. The API boundary exists so `docsearch-mcp`
or a vector index can replace the internals without changing the client.

## Code Area

Code projects live under `Code/`. Permission handling is stricter than Notes.

The Code Agent safety policy:

```text
git status / add / commit / diff / log  – requires approved: true on the task
git push                                 – requires gitPushApproved: true (or dangerApproved: true)
git push --force / -f                    – requires dangerApproved: true only
shell metacharacters in git arguments   – blocked unconditionally
```

`CodeAgentRuntime` owns the full loop:

1. `inspectProject` – scan files, detect test/package commands, record git status
2. `proposePatch` – store LLM-authored or human diff artifact (no file writes yet)
3. `rejectPatch` – discard proposal without applying
4. `applyPatch` – write file changes only after `approved: true` decision
5. `runChecks` – execute test/lint commands inside the task scope
6. `runGitCommand` – execute safe git commands via `execFile` (no shell expansion)
7. `generateAutomaticPatch` – call `LLMRuntime.generateCodePatch` to produce a
   structured `{ summary, changes: [{ path, find, replace }] }` response

A coding task is recorded under `.ai-workspace/tasks`, approval requests under
`.ai-workspace/approvals`, tool activity under `.ai-workspace/tool-logs`,
decisions under `.ai-workspace/decisions`, and produced or captured diffs under
`.ai-workspace/diffs`.
