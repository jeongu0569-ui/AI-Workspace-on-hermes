# Product Goal

## Goal

Build a server-centered AI Workspace around Hermes.

This is not an Obsidian plugin and not a standalone chat app. The product should
combine three familiar surfaces:

```text
ChatGPT-like chat
+ Obsidian / GoodNotes-like notes, PDFs, and resources
+ Codex-like coding agent workspace
```

Hermes is the central AI engine. The app should use Hermes sessions, models,
tool execution, approvals, and MCP/docsearch instead of inventing a separate AI
runtime.

## Why Not Obsidian Plugin

Obsidian is a local Vault app. That is excellent for personal markdown notes,
but it conflicts with this product's final shape:

- PDFs in the Vault are synced to every device and can overload iPhone/iPad
  storage.
- PDFs outside the Vault become awkward links instead of first-class indexed
  resources.
- Large folder, tag, PDF, and workspace context should be searched on the
  server, not attached by a plugin.
- iPhone cannot reliably treat NAS/shared folders as a local Obsidian Vault.
- Code agent features need a Codex-like UI, not a cramped note plugin panel.

The new app should make Hermes and the Workspace Server the center. Clients
should fetch only the data they need.

## User-Facing Model

Users should still see a familiar file tree:

```text
Workspace
├── Notes
│   ├── Markdown notes
│   ├── PDFs
│   ├── Images
│   └── Attachments
└── Code
    ├── Projects
    ├── Folders
    └── Code files
```

The UI feels like Obsidian and VS Code. Internally, the server manages metadata,
search state, Hermes links, and permissions.

## Server Workspace Root

The server owns a real folder on disk:

```text
/Users/user/HermesWorkspace
/DATA/HermesWorkspace
/NAS/HermesWorkspace
```

Default layout:

```text
HermesWorkspace/
├── Notes/
├── Code/
├── Documents/
├── Attachments/
└── .hermes-workspace/
```

The `.hermes-workspace` folder is for metadata, index state, thumbnails, and
server-managed cache.

## First MVP Boundary

The first MVP should prove the architecture:

- Workspace root initialization
- Notes/Code file tree
- Markdown/text file open and save
- Basic PDF/raw file delivery
- Hermes sessions/models proxy
- Clear API contract for future live streaming
- Documentation for context routing and docsearch

Do not start with tags, handwritten PDF annotations, full Git UI, or complex
multi-user auth. Those come after the base architecture works.

