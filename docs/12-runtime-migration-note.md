# Runtime Migration Note

AI Workspace started from a prototype that referenced behavior from an existing
local Hermes installation. That prototype proved useful UI and workflow ideas,
but the product direction is now standalone.

## Boundary

Wrong long-term shape:

```text
AI Workspace
  -> Workspace Server
  -> External AI server
  -> External runtime internals
```

Target shape:

```text
AI Workspace
  -> AI Workspace Server
  -> AI Workspace runtime
```

## What To Migrate

The local reference implementation is useful for:

- provider catalog shape
- model catalog and picker behavior
- auth and credential store shape
- session storage conventions
- streaming event names and grouping
- tool registry ideas
- approval request/response flow
- MCP/search integration
- sandbox and safety policies

Those ideas should be ported into AI Workspace-owned modules. They should not
remain as a dependency on a separately running server.

## Current Step

The first migration step is already underway:

- `aiw model`, `aiw provider`, and `aiw auth` are AI Workspace commands.
- Provider registry data is derived from the local reference provider catalog
  and stored in AI Workspace runtime code.
- Runtime/session state lives under `.ai-workspace/`.
- Public client APIs are moving to `/api/models`, `/api/sessions`, and
  `/api/live`.
- A first AI Workspace-owned OpenAI-compatible chat backend can execute
  configured models and stream `message.delta` events without a separate
  external runtime server.
- Surface-based tool modes let capable models call chat recall, memory,
  note/document search, and CodeAgentRuntime tools through AI Workspace-owned
  code. Mutating code tools remain approval-gated.
- `tool_discovery` can expand safe tools for the current turn without
  permanently enabling every tool for every chat.
- Conversation search/read and long-term memory now give the runtime compact
  recall without pasting all prior messages into every request.
- Assistant replies are now persisted to `.ai-workspace/sessions` from live
  streaming events, so session history and visible streamed output share the
  same runtime path.
- MCP tool calls that need approval now pause as workspace tasks with
  `status=approval_required`, `approvalIds[]`, and server-owned `pendingState`.
  They can be approved/resumed, rejected, or cancelled without keeping the
  original model/tool stream blocked.
- Security policy decisions now write a first audit log under
  `.ai-workspace/audit/audit.jsonl`, and `/api/doctor` reports recent denied and
  approval-required counts.

## Next Step

Move from configuration ownership to execution ownership:

```text
server/lib/runtime/
  provider.mjs
  auth.mjs
  model.mjs
  session.mjs
  stream.mjs
  tools.mjs
  approvals.mjs
  mcp.mjs
  sandbox.mjs
```

Next, broaden execution ownership: add provider-specific auth flows,
approval-gated mutating tools, MCP search orchestration, and richer model
capability metadata on top of the first OpenAI-compatible backend and read-only
workspace tools.
