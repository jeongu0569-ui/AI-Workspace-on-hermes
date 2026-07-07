import path from "node:path";

export const WORKSPACE_DIRS = Object.freeze({
  notes: "Notes",
  code: "Code",
  documents: "Documents",
  attachments: "Attachments"
});

export function normalizeWorkspacePath(input) {
  const raw = String(input ?? "").replace(/\\/g, "/").trim();
  if (!raw || raw === ".") return "";
  if (raw.startsWith("/") || /^[a-zA-Z]:\//.test(raw)) {
    throw Object.assign(new Error("Absolute paths are not allowed."), { status: 400 });
  }
  const normalized = path.posix.normalize(raw).replace(/^\/+/, "");
  if (normalized === "." || normalized === "") return "";
  if (normalized === ".." || normalized.startsWith("../")) {
    throw Object.assign(new Error("Path traversal is not allowed."), { status: 400 });
  }
  return normalized.replace(/\/+$/, "");
}

export function resolveWorkspacePath(workspaceRoot, input) {
  const relativePath = normalizeWorkspacePath(input);
  const root = path.resolve(workspaceRoot);
  const absolutePath = path.resolve(root, relativePath);
  const inside = absolutePath === root || absolutePath.startsWith(root + path.sep);
  if (!inside) {
    throw Object.assign(new Error("Resolved path escaped the workspace root."), { status: 400 });
  }
  return { root, relativePath, absolutePath };
}

export function rootPathFromKey(rootKey) {
  const key = String(rootKey ?? "").toLowerCase();
  if (!key || key === "workspace") return "";
  if (!Object.hasOwn(WORKSPACE_DIRS, key)) {
    throw Object.assign(new Error(`Unknown workspace root: ${rootKey}`), { status: 400 });
  }
  return WORKSPACE_DIRS[key];
}

export function joinWorkspacePath(...parts) {
  return normalizeWorkspacePath(parts.filter(Boolean).join("/"));
}

export function fileKind(name, isDirectory = false) {
  if (isDirectory) return "folder";
  const lower = String(name).toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".pdf")) return "pdf";
  if (/\.(png|jpe?g|gif|webp|heic|svg)$/.test(lower)) return "image";
  if (/\.(js|jsx|ts|tsx|py|swift|go|rs|java|c|cc|cpp|h|hpp|cs|rb|php|html|css|json|yaml|yml|toml|sh|ps1)$/.test(lower)) {
    return "code";
  }
  return "file";
}

