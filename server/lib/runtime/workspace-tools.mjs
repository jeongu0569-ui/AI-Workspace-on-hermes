import fs from "node:fs/promises";
import path from "node:path";
import { fileKind, resolveWorkspacePath } from "../path-utils.mjs";
import { searchWorkspace } from "../search-service.mjs";

const MAX_READ_CHARS = 60000;
const MAX_TREE_ENTRIES = 200;

export const WORKSPACE_TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "workspace_search",
      description: "Search text files in the AI Workspace. Use this when the user asks about notes, code, or documents that are not already in context.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: {
            type: "string",
            description: "Text to search for."
          },
          scopePath: {
            type: "string",
            description: "Optional workspace-relative folder/file path to limit search."
          },
          maxResults: {
            type: "integer",
            minimum: 1,
            maximum: 20,
            description: "Maximum search results to return."
          }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "workspace_read_file",
      description: "Read a text/markdown/code file by workspace-relative path.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: {
            type: "string",
            description: "Workspace-relative file path."
          },
          maxChars: {
            type: "integer",
            minimum: 1000,
            maximum: 100000,
            description: "Maximum characters to return."
          }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "workspace_list_tree",
      description: "List files and folders under a workspace-relative path.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: {
            type: "string",
            description: "Workspace-relative folder path. Empty means workspace root."
          },
          depth: {
            type: "integer",
            minimum: 1,
            maximum: 4,
            description: "How many directory levels to list."
          },
          maxEntries: {
            type: "integer",
            minimum: 1,
            maximum: 200,
            description: "Maximum entries to return."
          }
        }
      }
    }
  }
];

export async function executeWorkspaceTool(workspaceRoot, toolName, rawArgs = {}) {
  const args = typeof rawArgs === "string" ? parseToolArgs(rawArgs) : rawArgs;
  if (toolName === "workspace_search") {
    return await searchWorkspace(workspaceRoot, {
      query: args.query,
      scopePath: args.scopePath || "",
      maxResults: clampNumber(args.maxResults, 1, 20, 8)
    });
  }
  if (toolName === "workspace_read_file") {
    return await readWorkspaceFile(workspaceRoot, args);
  }
  if (toolName === "workspace_list_tree") {
    return await listWorkspaceTree(workspaceRoot, args);
  }
  throw Object.assign(new Error(`Unknown workspace tool: ${toolName}`), { status: 400 });
}

async function readWorkspaceFile(workspaceRoot, args) {
  const resolved = resolveWorkspacePath(workspaceRoot, args.path || "");
  if (!resolved.relativePath) {
    throw Object.assign(new Error("workspace_read_file requires a file path."), { status: 400 });
  }
  const stat = await fs.stat(resolved.absolutePath);
  if (stat.isDirectory()) {
    throw Object.assign(new Error("workspace_read_file cannot read a folder."), { status: 400 });
  }
  const content = await fs.readFile(resolved.absolutePath, "utf8");
  const maxChars = clampNumber(args.maxChars, 1000, 100000, MAX_READ_CHARS);
  return {
    path: resolved.relativePath,
    kind: fileKind(resolved.relativePath),
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    truncated: content.length > maxChars,
    content: truncateMiddle(content, maxChars)
  };
}

async function listWorkspaceTree(workspaceRoot, args) {
  const resolved = resolveWorkspacePath(workspaceRoot, args.path || "");
  const stat = await fs.stat(resolved.absolutePath);
  const maxEntries = clampNumber(args.maxEntries, 1, 200, MAX_TREE_ENTRIES);
  const depth = clampNumber(args.depth, 1, 4, 2);
  const entries = [];

  if (!stat.isDirectory()) {
    return {
      path: resolved.relativePath,
      entries: [{
        path: resolved.relativePath,
        name: path.basename(resolved.relativePath),
        kind: fileKind(resolved.relativePath),
        size: stat.size,
        modifiedAt: stat.mtime.toISOString()
      }]
    };
  }

  async function visit(directory, currentDepth) {
    if (entries.length >= maxEntries || currentDepth > depth) return;
    const dirEntries = await fs.readdir(directory, { withFileTypes: true });
    dirEntries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (const entry of dirEntries) {
      if (entries.length >= maxEntries) return;
      if (entry.name === ".DS_Store" || entry.name === ".ai-workspace" || entry.name === ".hermes-workspace") continue;
      const absolutePath = path.join(directory, entry.name);
      const rel = path.relative(workspaceRoot, absolutePath).replace(/\\/g, "/");
      const itemStat = await fs.stat(absolutePath);
      const kind = fileKind(rel, entry.isDirectory());
      entries.push({
        path: rel,
        name: entry.name,
        kind,
        size: itemStat.size,
        modifiedAt: itemStat.mtime.toISOString()
      });
      if (entry.isDirectory()) await visit(absolutePath, currentDepth + 1);
    }
  }

  await visit(resolved.absolutePath, 1);
  return {
    path: resolved.relativePath,
    depth,
    maxEntries,
    entryCount: entries.length,
    entries
  };
}

function parseToolArgs(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

function clampNumber(value, min, max, fallback) {
  const number = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function truncateMiddle(value, maxChars) {
  const text = String(value || "");
  if (text.length <= maxChars) return text;
  const head = Math.ceil(maxChars * 0.7);
  const tail = Math.max(0, maxChars - head);
  return `${text.slice(0, head)}\n\n... [truncated] ...\n\n${text.slice(text.length - tail)}`;
}
