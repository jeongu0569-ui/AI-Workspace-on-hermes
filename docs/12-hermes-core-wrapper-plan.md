# Hermes Core Wrapper Plan

AI Workspace must not grow a second model/provider/auth system. Hermes already
has that machinery, including Codex and Google Antigravity provider support.
The Workspace Server should wrap Hermes and add workspace-owned task, memory,
diff, search, and approval behavior around it.

## Current Boundary

Current runtime path:

```text
Client
  -> aiw serve
  -> WorkspaceAgentEngine
  -> ChatRuntime / ModelRuntime / SessionRuntime
  -> hermes-compat
  -> Hermes /api/ws and REST helper endpoints
```

This is still a bridge to `hermes serve`, but it is intentionally a Hermes
wrapper, not a provider reimplementation.

## Hermes Source Map

Verified local Hermes install:

```text
/Users/user/.local/bin/hermes
  -> /Users/user/.hermes/hermes-agent/venv/bin/hermes
  -> hermes_cli.main:main
```

Important Hermes implementation locations:

```text
/Users/user/.hermes/hermes-agent/hermes_cli/subcommands/model.py
/Users/user/.hermes/hermes-agent/hermes_cli/subcommands/auth.py
/Users/user/.hermes/hermes-agent/hermes_cli/providers.py
/Users/user/.hermes/hermes-agent/hermes_cli/provider_catalog.py
/Users/user/.hermes/hermes-agent/hermes_cli/model_catalog.py
/Users/user/.hermes/hermes-agent/hermes_cli/runtime_provider.py
/Users/user/.hermes/hermes-agent/hermes_cli/auth.py
/Users/user/.hermes/hermes-agent/hermes_cli/codex_models.py
/Users/user/.hermes/hermes-agent/hermes_cli/codex_runtime_switch.py
/Users/user/.hermes/hermes-agent/plugins/model-providers/*
```

Google Antigravity is already present in the installed Hermes tree:

```text
/Users/user/.hermes/hermes-agent/agent/google_antigravity_adapter.py
/Users/user/.hermes/hermes-agent/agent/google_antigravity_oauth.py
/Users/user/.hermes/hermes-agent/agent/antigravity_stream_grpc.py
/Users/user/.hermes/hermes-agent/agent/antigravity_quota_report.py
```

So the AI Workspace project should not keep a separate sitecustomize/hooking
strategy for Antigravity. Provider/auth behavior should flow through Hermes.

## What AI Workspace Owns

AI Workspace owns:

- workspace root file APIs
- path safety and relative path mapping
- notes/PDF/code context routing
- search/index API boundary
- `.ai-workspace/tasks`
- `.ai-workspace/approvals`
- `.ai-workspace/diffs`
- `.ai-workspace/tool-logs`
- code task inspect/propose/apply/check/git loop
- Apple client UI/UX

Hermes owns:

- provider catalog
- model picker
- model/provider config
- provider auth
- Codex provider auth/runtime behavior
- Google Antigravity provider behavior
- MCP/tool execution for normal chat sessions
- live thinking/tool/approval/message stream

## CLI Rule

`aiw model` delegates to `hermes model`.

`aiw auth` delegates to `hermes auth`.

`aiw provider list` is read-only orientation output from Hermes'
`hermes_cli.provider_catalog`. Provider creation, mutation, and credentials stay
in Hermes via `hermes model`, `hermes auth`, and `hermes config`.

## Removed Direction

The following direction was rejected:

- AI Workspace-owned `ProviderRuntime`
- AI Workspace-owned `AuthRuntime`
- AI Workspace-owned OpenAI-compatible `WorkspaceChatBackend`
- `.ai-workspace/config.json` as the source of model/provider/auth truth
- `aiw provider add/update/remove`
- `aiw auth set/add/remove` storing credentials in workspace config
- `aiw model set-default` storing default model in workspace config

That path duplicated Hermes and would create long-term maintenance drift.

## Next Steps

1. Keep the current WebSocket bridge stable.
2. Extract a formal `HermesCoreRuntime` boundary if deeper integration is
   needed.
3. Prefer importing/calling Hermes Python modules only behind that boundary.
4. Add provider-specific features, including Google Antigravity, in Hermes'
   provider/plugin structure rather than AI Workspace.
5. Keep CodeAgentRuntime focused on workspace task/diff/approval orchestration.
