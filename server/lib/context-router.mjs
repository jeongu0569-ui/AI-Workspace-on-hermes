import fs from "node:fs/promises";
import path from "node:path";
import { fileKind, resolveWorkspacePath } from "./path-utils.mjs";

const DEFAULT_MAX_INLINE_CHARS = 12000;
const DEFAULT_MAX_FILES_LISTED = 500;
const DEFAULT_MAX_INLINE_FILES = 8;
const DEFAULT_INLINE_FILE_CHARS = 4000;

export async function buildWorkspaceContext(workspaceRoot, request = {}) {
  const scopeType = normalizeScopeType(request.scopeType || request.type || "none");
  const maxInlineChars = clampNumber(request.maxInlineChars, 1000, 100000, DEFAULT_MAX_INLINE_CHARS);
  const context = {
    workspace: {
      scopeType,
      scopePath: "",
      activePath: cleanOptionalPath(workspaceRoot, request.activePath),
      ragRecommended: false,
      ragSearchProvider: "docsearch-mcp",
      fallbackSearchProvider: "workspace-scan",
      searchEndpoint: "/api/search",
      generatedAt: new Date().toISOString()
    },
    inlineBlocks: [],
    resources: [],
    fileList: []
  };

  if (request.selection) {
    context.inlineBlocks.push({
      kind: "selection",
      title: "Selected text",
      content: truncateMiddle(String(request.selection), maxInlineChars)
    });
  }

  if (scopeType === "none") {
    await addMentionContexts(workspaceRoot, context, request.mentions || [], maxInlineChars);
    return finalizeContext(context);
  }

  if (scopeType === "selection") {
    await addMentionContexts(workspaceRoot, context, request.mentions || [], maxInlineChars);
    return finalizeContext(context);
  }

  if (scopeType === "current" || scopeType === "note") {
    const scopePath = requireContextPath(request.scopePath || request.activePath, scopeType);
    context.workspace.scopePath = scopePath;
    await attachSmallFile(workspaceRoot, context, scopePath, {
      label: scopeType === "current" ? "Current resource" : "Mentioned note",
      maxChars: maxInlineChars
    });
    await addMentionContexts(workspaceRoot, context, request.mentions || [], maxInlineChars);
    return finalizeContext(context);
  }

  if (scopeType === "pdf") {
    const scopePath = requireContextPath(request.scopePath || request.activePath, scopeType);
    context.workspace.scopePath = scopePath;
    context.workspace.ragRecommended = true;
    context.workspace.ragSearchScopeType = "pdf";
    context.workspace.ragSearchScopePath = scopePath;
    context.resources.push(await fileResource(workspaceRoot, scopePath, "pdf"));
    await addMentionContexts(workspaceRoot, context, request.mentions || [], maxInlineChars);
    return finalizeContext(context);
  }

  if (scopeType === "folder" || scopeType === "workspace" || scopeType === "tag" || scopeType === "linked") {
    const scopePath = scopeType === "workspace" ? "" : cleanRequiredPath(workspaceRoot, request.scopePath || "");
    context.workspace.scopePath = scopePath;
    context.workspace.ragRecommended = true;
    context.workspace.ragSearchScopeType = scopeType;
    context.workspace.ragSearchScopePath = scopePath;
    if (scopeType === "tag") context.workspace.tag = String(request.tag || request.scopePath || "");
    if (scopeType === "folder" || scopeType === "workspace") {
      await attachFolderSummary(workspaceRoot, context, scopePath, request);
    }
    await addMentionContexts(workspaceRoot, context, request.mentions || [], maxInlineChars);
    return finalizeContext(context);
  }

  await addMentionContexts(workspaceRoot, context, request.mentions || [], maxInlineChars);
  return finalizeContext(context);
}

async function attachFolderSummary(workspaceRoot, context, scopePath, request) {
  const files = await listWorkspaceFiles(workspaceRoot, scopePath, {
    maxFiles: clampNumber(request.maxFilesListed, 20, 2000, DEFAULT_MAX_FILES_LISTED)
  });
  context.fileList = files.map((file) => ({
    path: file.path,
    kind: file.kind,
    size: file.size,
    modifiedAt: file.modifiedAt
  }));
  const inlineCandidates = files
    .filter((file) => file.kind === "markdown")
    .slice(0, clampNumber(request.maxInlineFiles, 0, 24, DEFAULT_MAX_INLINE_FILES));
  for (const file of inlineCandidates) {
    await attachSmallFile(workspaceRoot, context, file.path, {
      label: "Folder note snippet",
      maxChars: clampNumber(request.inlineFileChars, 500, 12000, DEFAULT_INLINE_FILE_CHARS)
    });
  }
}

async function addMentionContexts(workspaceRoot, context, mentions, maxInlineChars) {
  if (!Array.isArray(mentions)) return;
  for (const mention of mentions.slice(0, 16)) {
    const type = normalizeScopeType(mention.type || mention.kind || "note");
    if (type === "note" || type === "current") {
      const mentionPath = cleanRequiredPath(workspaceRoot, mention.path || mention.scopePath || "");
      await attachSmallFile(workspaceRoot, context, mentionPath, {
        label: "Mentioned note",
        maxChars: Math.max(1000, Math.floor(maxInlineChars / Math.max(mentions.length, 1)))
      });
    } else if (type === "pdf") {
      const mentionPath = cleanRequiredPath(workspaceRoot, mention.path || mention.scopePath || "");
      context.workspace.ragRecommended = true;
      context.resources.push(await fileResource(workspaceRoot, mentionPath, "pdf"));
    } else if (type === "folder") {
      const mentionPath = cleanRequiredPath(workspaceRoot, mention.path || mention.scopePath || "");
      context.workspace.ragRecommended = true;
      context.resources.push({
        kind: "folder",
        path: mentionPath,
        ragRecommended: true,
        ragSearchProvider: "docsearch-mcp"
      });
    }
  }
}

async function attachSmallFile(workspaceRoot, context, relativePath, options) {
  const resolved = resolveWorkspacePath(workspaceRoot, relativePath);
  const stat = await fs.stat(resolved.absolutePath);
  if (stat.isDirectory()) {
    context.resources.push({
      kind: "folder",
      path: resolved.relativePath,
      ragRecommended: true,
      ragSearchProvider: "docsearch-mcp"
    });
    context.workspace.ragRecommended = true;
    return;
  }
  const kind = fileKind(resolved.relativePath);
  if (kind === "pdf") {
    context.resources.push(await fileResource(workspaceRoot, resolved.relativePath, "pdf"));
    context.workspace.ragRecommended = true;
    return;
  }
  const content = await fs.readFile(resolved.absolutePath, "utf8");
  context.inlineBlocks.push({
    kind,
    title: options.label,
    path: resolved.relativePath,
    truncated: content.length > options.maxChars,
    content: truncateMiddle(content, options.maxChars)
  });
  context.resources.push({
    kind,
    path: resolved.relativePath,
    size: stat.size,
    modifiedAt: stat.mtime.toISOString()
  });
}

async function fileResource(workspaceRoot, relativePath, forcedKind) {
  const resolved = resolveWorkspacePath(workspaceRoot, relativePath);
  const stat = await fs.stat(resolved.absolutePath);
  return {
    kind: forcedKind || fileKind(resolved.relativePath, stat.isDirectory()),
    path: resolved.relativePath,
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    ragRecommended: true,
    ragSearchProvider: "docsearch-mcp"
  };
}

async function listWorkspaceFiles(workspaceRoot, relativePath, options) {
  const resolved = resolveWorkspacePath(workspaceRoot, relativePath);
  const root = resolved.absolutePath;
  const results = [];
  async function walk(directory) {
    if (results.length >= options.maxFiles) return;
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name === ".DS_Store" || entry.name === ".hermes-workspace") continue;
      const absolutePath = path.join(directory, entry.name);
      const rel = path.relative(workspaceRoot, absolutePath).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else {
        const stat = await fs.stat(absolutePath);
        results.push({
          path: rel,
          kind: fileKind(rel),
          size: stat.size,
          modifiedAt: stat.mtime.toISOString()
        });
        if (results.length >= options.maxFiles) return;
      }
    }
  }
  const stat = await fs.stat(root);
  if (stat.isDirectory()) await walk(root);
  else {
    results.push({
      path: resolved.relativePath,
      kind: fileKind(resolved.relativePath),
      size: stat.size,
      modifiedAt: stat.mtime.toISOString()
    });
  }
  return results;
}

function finalizeContext(context) {
  context.summary = {
    inlineBlockCount: context.inlineBlocks.length,
    resourceCount: context.resources.length,
    fileListCount: context.fileList.length,
    ragRecommended: Boolean(context.workspace.ragRecommended)
  };
  return context;
}

function normalizeScopeType(value) {
  const type = String(value || "none").toLowerCase();
  const map = {
    active: "current",
    currentnote: "current",
    current_note: "current",
    currentfile: "current",
    current_file: "current",
    note: "note",
    file: "note",
    md: "note",
    folder: "folder",
    directory: "folder",
    pdf: "pdf",
    tag: "tag",
    linked: "linked",
    linkedresources: "linked",
    linked_resources: "linked",
    workspace: "workspace",
    vault: "workspace",
    all: "workspace",
    selection: "selection",
    none: "none"
  };
  return map[type] || type;
}

function cleanOptionalPath(workspaceRoot, value) {
  if (!value) return "";
  return resolveWorkspacePath(workspaceRoot, value).relativePath;
}

function cleanRequiredPath(workspaceRoot, value) {
  if (!value) throw Object.assign(new Error("Missing context path."), { status: 400 });
  return resolveWorkspacePath(workspaceRoot, value).relativePath;
}

function requireContextPath(value, scopeType) {
  if (!value) throw Object.assign(new Error(`Missing ${scopeType} context path.`), { status: 400 });
  return value;
}

function truncateMiddle(value, maxChars) {
  const text = String(value || "");
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.65);
  const tail = Math.max(0, maxChars - head - 40);
  return `${text.slice(0, head)}\n\n... [truncated] ...\n\n${text.slice(text.length - tail)}`;
}

function clampNumber(value, min, max, fallback) {
  const number = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}
