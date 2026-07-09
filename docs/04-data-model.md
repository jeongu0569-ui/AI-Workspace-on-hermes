# Data Model

The first scaffold uses a JSON metadata file so the repository stays dependency
free. The intended production shape is SQLite first, then Postgres if multi-user
deployment needs it.

## Files

```text
files
- id
- relative_path
- kind
- size
- checksum
- created_at
- modified_at
- indexed_at
- index_status
```

The real file content stays on disk. The DB exists to track metadata that the
filesystem alone cannot represent reliably.

## Tags

```text
tags
- id
- name

file_tags
- file_id
- tag_id
```

Tags should be server metadata, not only YAML frontmatter. Frontmatter can be
imported/exported later.

## Links

```text
links
- from_file_id
- to_file_id
- link_type
```

Link types:

```text
markdown-link
pdf-link
attachment-link
code-reference
external-url
```

## Search Index State

```text
index_jobs
- id
- relative_path
- provider
- status
- started_at
- finished_at
- error

index_entries
- file_id
- provider
- indexed_at
- checksum
- chunk_count
```

`docsearch-mcp` should be treated as a server-side index/search capability, not
as a client plugin detail.

## Hermes Session Associations

```text
workspace_sessions
- hermes_session_id
- area
- scope_type
- scope_path
- last_opened_at
```

Areas:

```text
chat
notes
code
```

The app should not duplicate Hermes messages. Hermes remains the source of truth
for conversation history while Hermes is the active adapter.

## Workspace Agent State

The newer agent-engine state root is:

```text
.ai-workspace/
├── sessions/
├── tasks/
├── memory/
├── decisions/
├── tool-logs/
├── diffs/
└── index/
```

This folder belongs to the Workspace Server, not to Hermes. It is designed so
Hermes-style chat and Codex-style code work can share one workspace-owned state
layer.

Current implemented files:

```text
.ai-workspace/sessions/events.jsonl
.ai-workspace/tasks/events.jsonl
.ai-workspace/tasks/task-<timestamp>-<uuid>.json
.ai-workspace/tool-logs/live-events.jsonl
.ai-workspace/tool-logs/tool-events.jsonl
```

Task records currently store:

```text
id
type
status
created_at / updated_at
adapter
session_id
message
context_request
provider / model
access_mode
reasoning_effort
result or error
scope_path
inspection
search
git.diff_ref
plan
decision_ref
```

This is intentionally small. It does not yet replace Hermes conversation
history. It records the Workspace Server's own view of the work so future code
agent loops can attach diffs, test results, shell output, approvals, and
decision logs to the same task id.

The current code inspect task already adds:

```text
scope_path
inspection.file_count
inspection.files
inspection.package
inspection.markers
inspection.suggested_check_commands
search.results
git.status
git.diff_stat
git.diff_ref
plan.steps
decision_ref
```

Future patch/test task records should add:

```text
workspace_scope
changed_files
diff_refs
test_commands
test_results
approval_refs
decision_refs
```
