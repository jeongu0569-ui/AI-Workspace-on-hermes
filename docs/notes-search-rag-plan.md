# Notes, PDF, Search, And RAG Plan

Codmes should treat notes, PDFs, attachments, and code projects as
server-owned workspace resources. Clients display and edit them, but indexing
and retrieval belong to the Workspace Server.

## Workspace Structure

Default workspace root:

```text
Codmes/
├── Notes/
├── Code/
├── Documents/
├── Attachments/
└── .codmes/
```

The user sees an Obsidian/VS Code-style tree. Internally, the server tracks
metadata, index state, sessions, tasks, approvals, and tool logs.

## Current File Index

Implemented module:

```text
server/lib/file-index.mjs
```

Index path:

```text
.codmes/index/files.json
```

Index item:

```json
{
  "path": "Notes/example.md",
  "kind": "markdown",
  "extension": ".md",
  "size": 1234,
  "modifiedAt": "2026-07-09T00:00:00.000Z",
  "hash": "sha256-...",
  "indexedAt": "2026-07-09T00:00:01.000Z",
  "indexStatus": "indexed"
}
```

Current APIs:

```text
GET  /api/file/metadata?path=Notes/example.md
GET  /api/index/status
POST /api/index/rebuild
```

This rebuilds both file metadata and the native Codmes Search chunk index.
Embedding provider/model settings are stored with the search index metadata.
Actual vector embedding generation is planned as the next server-owned layer.

## Current Search

Implemented module:

```text
server/lib/search-service.mjs
```

Current provider:

```text
codmes-search-index
```

Capabilities:

- native chunk index under `.codmes/index/search.json`
- scope-limited indexing roots
- partial indexing when watched files change
- PDF/Office/HWP/Excel/image/ZIP extraction through the document ingest worker
- scope search
- content search
- filename search
- result snippets
- `kind` / `kinds` filter
- `modifiedAfter` / `modifiedBefore` filter

Search API:

```text
GET  /api/search/status
POST /api/search
```

Example:

```json
{
  "query": "architecture",
  "scopePath": "Notes",
  "kinds": ["markdown"],
  "maxResults": 10
}
```

## PDF Strategy

Phase 2 uses a GoodNotes-style structure with a thin first feature set:

1. Serve PDFs as raw files for client preview.
2. Store file metadata in `.codmes/index/files.json`.
3. Add PDF/Office/HWP/Excel text extraction where possible.
4. Add extracted text blocks to the search layer.
5. Store server-owned annotation layers in a hidden state folder inside the
   document folder, such as `Notes/.codmes/annotations/mypage.codmes.json`.
6. Add iOS/iPadOS page-level PencilKit ink overlays through PDFKit.
7. Add page/coordinate-aware PDF search result highlights for text-layer blocks.

PDF annotations should not be stored only inside a client-local app cache. They
should be workspace-owned so iPhone, iPad, and Mac see the same annotation
state.

Current annotation state:

```text
Notes/mypage.pdf
Notes/.codmes/annotations/mypage.codmes.json
```

The current Apple implementation saves PencilKit ink per PDF page and stores
text/image annotation objects with page-relative bbox metadata. This lets a
user move or copy a document folder and keep editable Codmes state with it
without showing JSON files next to every PDF, while global sessions,
credentials, and approvals remain in the workspace root `.codmes`.

The first page-level document operation pass supports iOS/iPadOS page range
export and PDF insertion. Range export remaps Codmes annotation pages to the
new exported page order. Insertion merges the selected PDF after the current
page, shifts existing annotation page indexes, optionally imports a matching
`.codmes.json` state file, and asks the server to refresh the changed PDF in the
search index. True page-level OCR/embedding invalidation is still planned.

Ink storage must remain platform-neutral. PencilKit is treated as the current
iOS/iPadOS input adapter, not the long-term storage format. Codmes annotation
state now stores legacy `inkDataBase64` for current Apple rendering and also
stores normalized `inkStrokes` with points, pressure, color, width, and timing.
macOS now has a first direct `inkStrokes` render/edit adapter for preview, pen
input, stroke erasing, and text/image object select/move/delete. Future Windows
and Android/Galaxy Tab clients should render and edit the same common
`inkStrokes` and annotation object format directly.

## RAG Direction

The Workspace Server should decide when to inline context and when to search.
Clients should send compact context requests, not huge file bundles.

Recommended context flow:

```text
user message
  -> contextRequest
  -> Workspace Server context router
  -> small scope: inline text
  -> large scope: search/RAG hint
  -> runtime prompt/tool calls
```

For whole-folder, whole-workspace, or PDF-heavy questions, the runtime should
prefer server-side search tools rather than attaching many raw files.

## Codmes Search Integration

Codmes Search is a built-in server capability. It does not require adding a
document search MCP server.

Expected path:

```text
question
  -> model decides search is needed
  -> Codmes Search tool call
  -> retrieved chunks
  -> model answer
```

Search reads workspace files and index state. It should not require an approval
round-trip for normal read-only retrieval.

## Roadmap

### Step 1: Metadata Index

Done:

- `server/lib/file-index.mjs`
- `/api/file/metadata`
- `/api/index/status`
- `/api/index/rebuild`

### Step 2: Search Quality

Done:

- filename hit support
- kind filter
- modified date filter
- native chunk index
- search roots configuration
- partial update API for changed files
- server file watchers while `codmes serve` is running

Next:

- rank exact filename matches higher
- include index metadata in search results
- expose search/index status in Apple UI

### Step 3: PDF Text

Next:

- extract text from selectable PDFs
- store extraction status in index metadata
- expose extraction errors as index status

### Step 4: RAG Provider

Next:

- generate embeddings with the selected embedding provider/model
- add a local vector or FTS-backed retrieval store
- add top-k chunk retrieval API for server-internal use
- preserve page/source/bbox metadata in retrieval responses

### Step 5: Client UX

Next:

- show file metadata panel
- show indexed/not indexed badges
- show PDF text extraction state
- show document extraction library availability
- show search provider status
- let users rebuild index from Settings/Diagnostics

## Non-goals For This Phase

- Full multi-user permission model
- Handwritten PDF annotation sync
- Free/local scanned document text extraction design
- Native-binary OCR dependency management
- Client-only OCR
- Client-owned vector indexing
- Client-side direct indexing
