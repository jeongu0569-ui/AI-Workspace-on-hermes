import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileKind, joinWorkspacePath, resolveWorkspacePath } from "./path-utils.mjs";
import { searchWorkspace } from "./search-service.mjs";

const execFileAsync = promisify(execFile);

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  ".nuxt",
  "dist",
  "build",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  ".swiftpm",
  "DerivedData"
]);

const TEXT_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  ".py", ".swift", ".go", ".rs", ".java", ".c", ".cc", ".cpp", ".h", ".hpp",
  ".cs", ".rb", ".php", ".html", ".css", ".json", ".yaml", ".yml", ".toml",
  ".sh", ".ps1", ".md", ".txt", ".xml", ".sql"
]);

export class CodeAgentRuntime {
  constructor({ workspaceRoot, stateStore }) {
    this.workspaceRoot = workspaceRoot;
    this.state = stateStore;
  }

  async inspectTask(params = {}) {
    const instruction = requireInstruction(params.instruction || params.message);
    const scope = this.resolveCodeScope(params.scopePath || "Code");
    const task = await this.state.startTask({
      type: "code",
      adapter: "code-runtime",
      message: instruction,
      scopePath: scope.relativePath,
      accessMode: params.accessMode || "confirm",
      requestedAction: "inspect"
    });

    try {
      await this.state.recordToolLog({
        type: "code.inspect.start",
        taskId: task.id,
        scopePath: scope.relativePath,
        instruction
      });
      const inspection = await this.inspectProject(scope, params);
      const search = await this.searchProject(scope, instruction, params);
      const git = await this.inspectGit(scope.absolutePath);
      const plan = this.buildInitialPlan({ instruction, scope, inspection, search, git });
      const diffRef = await this.state.writeDiff(task.id, git.diff || "");
      const decision = await this.state.recordDecision({
        type: "code.inspect.plan",
        taskId: task.id,
        scopePath: scope.relativePath,
        summary: plan.summary,
        nextStep: plan.steps[0]?.title
      });
      const updated = await this.state.finishTask(task.id, {
        status: "inspected",
        scopePath: scope.relativePath,
        inspection,
        search,
        git: {
          isRepository: git.isRepository,
          root: git.root,
          status: git.status,
          diffStat: git.diffStat,
          diffRef
        },
        plan,
        decisionRef: decision.path
      });
      await this.state.recordToolLog({
        type: "code.inspect.complete",
        taskId: task.id,
        scopePath: scope.relativePath,
        fileCount: inspection.fileCount,
        relevantResultCount: search.resultCount
      });
      return {
        ok: true,
        engine: "workspace-agent",
        runtime: "code-agent",
        taskId: task.id,
        status: updated.status,
        scopePath: scope.relativePath,
        summary: plan.summary,
        inspection,
        search,
        git: updated.git,
        plan
      };
    } catch (error) {
      await this.state.finishTask(task.id, {
        status: "failed",
        error: error?.message || "Code task failed."
      });
      await this.state.recordToolLog({
        type: "code.inspect.failed",
        taskId: task.id,
        scopePath: scope.relativePath,
        error: error?.message || "Code task failed."
      });
      throw error;
    }
  }

  resolveCodeScope(scopePath) {
    const relativePath = scopePath ? joinWorkspacePath(scopePath) : "Code";
    const scope = resolveWorkspacePath(this.workspaceRoot, relativePath);
    if (scope.relativePath !== "Code" && !scope.relativePath.startsWith("Code/")) {
      throw Object.assign(new Error("Code tasks must use a path under the Code workspace root."), { status: 400 });
    }
    return scope;
  }

  async inspectProject(scope, params) {
    const maxFiles = clampNumber(params.maxFiles, 20, 400, 120);
    const maxDepth = clampNumber(params.maxDepth, 1, 10, 5);
    const files = [];
    await walkProject(scope.absolutePath, scope.relativePath, {
      maxFiles,
      maxDepth,
      files
    });
    const packageInfo = await readPackageInfo(scope.absolutePath);
    const markers = await detectProjectMarkers(scope.absolutePath);
    return {
      scopePath: scope.relativePath,
      fileCount: files.length,
      files,
      package: packageInfo,
      markers,
      suggestedCheckCommands: suggestedCheckCommands(packageInfo, markers)
    };
  }

  async searchProject(scope, instruction, params) {
    const maxResults = clampNumber(params.maxSearchResults, 1, 20, 8);
    const queries = searchQueriesFromInstruction(instruction);
    if (!queries.length) {
      return {
        provider: "workspace-scan",
        query: "",
        scopePath: scope.relativePath,
        resultCount: 0,
        results: []
      };
    }
    const merged = [];
    let provider = "workspace-scan";
    let usedQuery = queries[0];
    for (const query of queries) {
      const result = await searchWorkspace(this.workspaceRoot, {
        query,
        scopePath: scope.relativePath,
        maxResults
      });
      provider = result.provider;
      if (result.resultCount > 0 && usedQuery === queries[0]) usedQuery = query;
      for (const item of result.results) {
        if (merged.some((existing) => existing.path === item.path)) continue;
        merged.push(item);
        if (merged.length >= maxResults) break;
      }
      if (merged.length >= maxResults) break;
    }
    return {
      provider,
      query: usedQuery,
      scopePath: scope.relativePath,
      resultCount: merged.length,
      results: merged.map((item) => ({
        path: item.path,
        kind: item.kind,
        score: item.score,
        snippet: item.snippet
      }))
    };
  }

  async inspectGit(cwd) {
    const root = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
    if (!root.ok) {
      return {
        isRepository: false,
        root: "",
        status: "",
        diffStat: "",
        diff: ""
      };
    }
    const status = await runGit(cwd, ["status", "--short"]);
    const diffStat = await runGit(cwd, ["diff", "--stat"]);
    const diff = await runGit(cwd, ["diff", "--binary"]);
    return {
      isRepository: true,
      root: root.stdout.trim(),
      status: status.stdout.trim(),
      diffStat: diffStat.stdout.trim(),
      diff: diff.stdout
    };
  }

  buildInitialPlan({ instruction, scope, inspection, search, git }) {
    const relevantFiles = search.results.map((item) => item.path);
    const steps = [
      {
        id: "inspect",
        title: "Inspect relevant files",
        status: "done",
        detail: `Scanned ${inspection.fileCount} files under ${scope.relativePath}.`
      },
      {
        id: "plan",
        title: "Build edit plan",
        status: "ready",
        detail: relevantFiles.length
          ? `Use the search hits first: ${relevantFiles.slice(0, 5).join(", ")}.`
          : "No direct text hits were found; start from project markers and file tree."
      },
      {
        id: "patch",
        title: "Apply patches after approval",
        status: "blocked_on_approval",
        detail: "The initial CodeAgentRuntime is inspect-only; patch execution will be added behind the same task id."
      },
      {
        id: "verify",
        title: "Run checks and collect diff",
        status: "pending",
        detail: inspection.suggestedCheckCommands.length
          ? `Suggested checks: ${inspection.suggestedCheckCommands.join("; ")}.`
          : "No project check command was detected yet."
      }
    ];
    return {
      summary: [
        `Code task prepared for ${scope.relativePath}.`,
        git.isRepository ? "Git repository detected." : "No git repository detected.",
        search.resultCount ? `${search.resultCount} relevant search results found.` : "No direct search hits found."
      ].join(" "),
      instruction,
      steps,
      risks: [
        "Patch/test execution is not enabled in this first runtime pass.",
        "Detected check commands are suggestions only and were not run automatically."
      ]
    };
  }
}

async function walkProject(absoluteRoot, relativeRoot, options, depth = 0) {
  if (options.files.length >= options.maxFiles || depth > options.maxDepth) return;
  let entries;
  try {
    entries = await fs.readdir(absoluteRoot, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (options.files.length >= options.maxFiles) return;
    if (entry.name.startsWith(".DS_Store")) continue;
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
    const absolutePath = path.join(absoluteRoot, entry.name);
    const relativePath = joinWorkspacePath(relativeRoot, entry.name);
    if (entry.isDirectory()) {
      await walkProject(absolutePath, relativePath, options, depth + 1);
      continue;
    }
    const stat = await fs.stat(absolutePath);
    options.files.push({
      path: relativePath,
      kind: fileKind(entry.name, false),
      size: stat.size,
      readable: isLikelyText(entry.name, stat.size)
    });
  }
}

async function readPackageInfo(projectRoot) {
  try {
    const text = await fs.readFile(path.join(projectRoot, "package.json"), "utf8");
    const json = JSON.parse(text);
    return {
      name: stringValue(json.name),
      type: stringValue(json.type),
      scripts: Object.fromEntries(Object.entries(json.scripts || {}).map(([key, value]) => [key, String(value)]))
    };
  } catch {
    return null;
  }
}

async function detectProjectMarkers(projectRoot) {
  const markers = [];
  for (const marker of [
    "package.json",
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
    "pyproject.toml",
    "requirements.txt",
    "Cargo.toml",
    "go.mod",
    "Package.swift",
    "Makefile",
    "Dockerfile"
  ]) {
    try {
      await fs.access(path.join(projectRoot, marker));
      markers.push(marker);
    } catch {}
  }
  return markers;
}

function suggestedCheckCommands(packageInfo, markers) {
  const commands = [];
  const scripts = packageInfo?.scripts || {};
  for (const name of ["test", "check", "lint", "typecheck", "build"]) {
    if (scripts[name]) commands.push(`npm run ${name}`);
  }
  if (markers.includes("pyproject.toml")) commands.push("pytest");
  if (markers.includes("Cargo.toml")) commands.push("cargo test");
  if (markers.includes("go.mod")) commands.push("go test ./...");
  if (markers.includes("Package.swift")) commands.push("swift test");
  if (markers.includes("Makefile")) commands.push("make test");
  return [...new Set(commands)].slice(0, 8);
}

async function runGit(cwd, args) {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      timeout: 5000,
      maxBuffer: 2 * 1024 * 1024
    });
    return { ok: true, stdout, stderr };
  } catch (error) {
    return {
      ok: false,
      stdout: error?.stdout || "",
      stderr: error?.stderr || error?.message || ""
    };
  }
}

function searchQueriesFromInstruction(instruction) {
  const words = String(instruction || "")
    .replace(/[^\p{L}\p{N}_./:-]+/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 2)
    .slice(0, 12);
  const useful = words.filter((word) => word.length >= 4);
  return [...new Set([
    words.join(" "),
    ...useful,
    ...useful.slice(0, 6).flatMap((word, index) => useful[index + 1] ? [`${word} ${useful[index + 1]}`] : [])
  ].map((query) => query.trim()).filter(Boolean))];
}

function isLikelyText(name, size) {
  if (size > 2 * 1024 * 1024) return false;
  return TEXT_EXTENSIONS.has(path.extname(name).toLowerCase());
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function requireInstruction(value) {
  const text = String(value || "").trim();
  if (!text) throw Object.assign(new Error("Missing code task instruction."), { status: 400 });
  return text;
}

function stringValue(value) {
  return typeof value === "string" ? value : "";
}
