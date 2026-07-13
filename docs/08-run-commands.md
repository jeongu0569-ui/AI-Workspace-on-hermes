# Run Commands

## Server

```bash
git clone https://github.com/jeongu0569-ui/Codmes.git
cd Codmes
npm install
npm link
npm run runtime:bootstrap

CODMES_WORKSPACE_ROOT="$HOME/CodmesWorkspace" \
CODMES_HOST="127.0.0.1" \
CODMES_PORT="8787" \
codmes serve
```

Optional bearer-token protection:

```bash
CODMES_WORKSPACE_ROOT="$HOME/CodmesWorkspace" \
CODMES_HOST="0.0.0.0" \
CODMES_PORT="8787" \
CODMES_SERVER_TOKEN="choose-a-long-local-token" \
codmes serve
```

When `CODMES_SERVER_TOKEN` is set, the Apple client must store the same token in
Settings. CLI commands also read `CODMES_SERVER_TOKEN` and send it as
`Authorization: Bearer <token>`.

Equivalent development command:

```bash
CODMES_WORKSPACE_ROOT="$HOME/CodmesWorkspace" npm start
```

For iPhone/iPad testing over Tailscale or LAN:

```bash
CODMES_WORKSPACE_ROOT="$HOME/CodmesWorkspace" \
CODMES_HOST="0.0.0.0" \
CODMES_PORT="8787" \
codmes serve
```

Then connect the app to:

```text
http://<server-ip-or-tailscale-ip>:8787
```

## Status

```bash
codmes status
codmes status --json
curl http://127.0.0.1:8787/api/workspace
```

## Index

```bash
codmes index status
codmes index rebuild
codmes index search "architecture" --scope Notes --limit 10
```

Current index state is stored at:

```text
<workspace>/.codmes/index/files.json
```

Expected runtime fields:

```json
{
  "runtime": {
    "status": "ok",
    "owner": "codmes",
    "configPath": ".codmes/config"
  }
}
```

## Models / Providers / Auth

```bash
npm run runtime:bootstrap
codmes model
codmes provider list
codmes model list
codmes auth list
codmes auth set ollama-local CODMES_OLLAMA_BASE_URL http://127.0.0.1:11434
codmes model set-default ollama-local gemma4:e2b-mlx
```

Credential config is stored under:

```text
<workspace>/.codmes/config/auth.json
```

Runtime config is stored under:

```text
<workspace>/.codmes/config/config.yaml
```

Environment variables with the `CODMES_` prefix are preferred. Existing `AIW_`
variables are still detected as a deprecated fallback:

```bash
export CODMES_OPENAI_API_KEY="sk-..."
export CODMES_OLLAMA_BASE_URL="http://127.0.0.1:11434"
export CODMES_LMSTUDIO_BASE_URL="http://127.0.0.1:1234/v1"
```


### First Model Execution Backend

Codmes owns a first OpenAI-compatible execution backend. Configure a
provider/model pair, then `WS /api/live` can stream `message.delta` events
without starting a separate AI runtime server.

OpenAI Codex example:

```bash
codmes model
# Providers -> OpenAI Codex -> sign in
```

Ollama Local example:

```bash
codmes auth set ollama-local CODMES_OLLAMA_BASE_URL http://127.0.0.1:11434
codmes model set-default ollama-local gemma4:e2b-mlx
```

Local Ollama shortcut:

```bash
codmes ollama
codmes ollama --model gemma4:e2b-mlx
```

The interactive route is `codmes model` -> `Ollama` -> `Ollama Local`. It stores
the dedicated `ollama-local` provider rather than disguising the server as a
generic custom endpoint. The Apple Settings screen uses the same provider and
model APIs.

The normal user-facing provider list intentionally exposes only OpenAI Codex,
Ollama Cloud, and Ollama Local until the other provider transports are complete.
Legacy custom endpoint config is still read for compatibility, but it is not
shown as a primary setup path.

The literal `ollama launch codmes` integration must be added by Ollama upstream;
the local `codmes ollama` command performs the equivalent Codmes setup.

When the selected model supports OpenAI-compatible tool calls, Codmes
filters tools by surface:

```text
chat:
  conversation_search
  conversation_read
  memory_search
  tool_discovery

notes:
  workspace_search
  docsearch_search
  read_note_file
  read_file_metadata

code:
  search_project
  read_project_file
  inspect_git
  get_git_diff
  propose_patch
  apply_patch        (approval-gated)
  run_checks         (approval-gated)
  run_git_command    (approval-gated)
```

These tools run inside the Workspace Server, so the client can show
`tool.start` / `tool.complete` activity without handing raw filesystem access
to the model provider. `tool_discovery` can temporarily add safe tools to the
current turn, but it does not auto-enable approval-gated tools.

## Workspace APIs

```bash
curl http://127.0.0.1:8787/api/tree?root=notes
curl http://127.0.0.1:8787/api/models
curl http://127.0.0.1:8787/api/sessions
curl http://127.0.0.1:8787/api/doctor
curl http://127.0.0.1:8787/api/tool-modes
curl http://127.0.0.1:8787/api/tools/available
```

Create a session:

```bash
curl -X POST http://127.0.0.1:8787/api/sessions \
  -H 'content-type: application/json' \
  -d '{"title":"Test session","model":"gpt-5.4-mini"}'
```

## Code Tasks

```bash
codmes code create Code/demo-app "change the greeting"
codmes code list
codmes approvals list
```

General task resume/cancel commands:

```bash
codmes tasks list
codmes tasks show <taskId>
codmes tasks resume <taskId>
codmes tasks cancel <taskId> --reason "No longer needed"
```

Runtime work that needs approval, such as a policy-gated MCP tool call, is
stored as `approval_required` instead of blocking the server while it waits.
After approval, `codmes tasks resume <taskId>` or
`POST /api/agent/approvals/:id/respond` can continue the saved pending state.

General `[Chat]` sessions that are not attached to a folder or project are
kept as a rolling visible set. The latest 30 remain in the sidebar; older
overflow is archived. Pinned sessions and sessions with pending approvals are
not auto-archived.

Conversation search/read examples:

```bash
curl -X POST http://127.0.0.1:8787/api/conversations/search \
  -H 'content-type: application/json' \
  -d '{"query":"저번주에 들었던 음악","timeRange":"last_week"}'

curl -X POST http://127.0.0.1:8787/api/conversations/read \
  -H 'content-type: application/json' \
  -d '{"sessionId":"session-...","messageIds":["1"],"includeSurroundingMessages":true}'
```

Memory search/extraction examples:

```bash
curl 'http://127.0.0.1:8787/api/memory/search?query=dark%20mode&maxResults=5'

curl -X POST http://127.0.0.1:8787/api/memory/extract-from-session \
  -H 'content-type: application/json' \
  -d '{"sessionId":"session-..."}'
```

Manual patch proposal:

```bash
codmes code patch <taskId> \
  --path src/index.js \
  --find "return 'hello';" \
  --replace "return 'hello workspace';"
```

Apply after approval:

```bash
codmes code apply <taskId> <proposalId> --check --command "npm test"
```

## Apple Client

```bash
cd /Users/user/Desktop/Codmes/client/apple
swift run Codmes
```

In the app settings, set the server URL to:

```text
http://127.0.0.1:8787
```

For iPhone/iPad, use the Mac server's LAN or Tailscale address.

## Logs

For a background server:

```bash
cd /Users/user/Desktop/Codmes

CODMES_WORKSPACE_ROOT="$HOME/CodmesWorkspace" \
CODMES_HOST="0.0.0.0" \
CODMES_PORT="8787" \
node server/index.mjs > /tmp/Codmes.log 2>&1 &

echo $! > /tmp/Codmes.pid
tail -f /tmp/Codmes.log
```

Stop it:

```bash
kill "$(cat /tmp/Codmes.pid)"
```
