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
for conversation history.

