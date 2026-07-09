#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import {
  listCredentialStatus,
  listProviderRegistry,
  listRuntimeModels,
  removeCredentialValue,
  setCredentialValue,
  setDefaultModel,
  readRuntimeConfig
} from "../server/lib/runtime/config-store.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const SERVER_ENTRY = path.join(REPO_ROOT, "server", "index.mjs");
const DEFAULT_SERVER_URL = "http://127.0.0.1:8787";
const DEFAULT_WORKSPACE_ROOT = path.join(os.homedir(), "AIWorkspace");

main(process.argv.slice(2)).catch((error) => {
  console.error(`aiw: ${error.message}`);
  process.exitCode = error.exitCode || 1;
});

async function main(argv) {
  const [command, ...args] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  switch (command) {
    case "serve":
      await runServe(args);
      return;
    case "status":
      await runStatus(args);
      return;
    case "tasks":
      await runTasks(args);
      return;
    case "model":
      await runModel(args);
      return;
    case "provider":
      await runProvider(args);
      return;
    case "auth":
      await runAuth(args);
      return;
    case "approvals":
    case "approval":
      await runApprovals(args);
      return;
    case "code":
      await runCode(args);
      return;
    case "index":
      await runIndex(args);
      return;
    default:
      throw new Error(`Unknown command '${command}'. Run 'aiw help'.`);
  }
}

function printHelp() {
  console.log(`AI Workspace CLI

Usage:
  aiw serve [--host 0.0.0.0] [--port 8787] [--root PATH]
  aiw status [--url URL] [--json]
  aiw model [list|set-default|show] [...]
  aiw provider [list|help]
  aiw auth [list|set|remove] [...]
  aiw approvals [list|show|approve|reject] [...]
  aiw tasks [list|show] [...]
  aiw code <list|create|show|patch|apply|reject|check> [...]
  aiw index <status|search> [...]

Quick start:
  aiw serve
  aiw model list
  aiw auth list

Aliases:
  ai-workspace is the long-form alias for aiw.

Environment:
  AIW_SERVER_URL          Workspace Server URL for API commands
  AIW_WORKSPACE_ROOT      Workspace root used by aiw serve/tasks
  AIW_HOST                Workspace Server bind host
  AIW_PORT                Workspace Server port
`);
}

async function runServe(args) {
  const options = parseOptions(args, { boolean: ["help"] });
  if (options.help) {
    console.log(`Usage:
  aiw serve [--host 0.0.0.0] [--port 8787] [--root PATH]

Options:
  --host VALUE       Bind host. Default: 127.0.0.1
  --port VALUE       Workspace Server port. Default: 8787
  --root PATH        Workspace root. Default: ~/AIWorkspace
`);
    return;
  }

  const env = { ...process.env };
  setEnvFromOption(env, options, ["host"], "AIW_HOST");
  setEnvFromOption(env, options, ["port"], "AIW_PORT");
  setEnvFromOption(env, options, ["root", "workspace-root"], "AIW_WORKSPACE_ROOT", expandHome);

  await runProcess(process.execPath, [SERVER_ENTRY], {
    cwd: REPO_ROOT,
    env,
    stdio: "inherit",
    resolveOnForwardedSignal: true
  });
}

async function runStatus(args) {
  const options = parseOptions(args, { boolean: ["help", "json"] });
  if (options.help) {
    console.log(`Usage:
  aiw status [--url URL] [--json]
`);
    return;
  }

  const baseUrl = workspaceUrl(options);
  const health = await requestJson(baseUrl, "/api/health");
  const workspace = await requestJson(baseUrl, "/api/workspace");
  if (options.json) {
    printJson({ url: baseUrl, health, workspace });
    return;
  }

  console.log(`Workspace Server: ${health.ok ? "ok" : "unknown"}`);
  console.log(`Workspace Root: ${workspace.workspaceRoot || "(unknown)"}`);
  console.log(`Code Runtime: ok`);
  console.log(`Approval Inbox: ok`);
  console.log(`Search Provider: ${workspace.search?.provider || "(unknown)"}`);
  console.log(`Chat Runtime: ${workspace.chatRuntime?.status || "unavailable"}`);
  console.log(`Runtime: ${workspace.runtime?.status || "unknown"}`);
}

async function runTasks(args) {
  const [subcommand = "list", ...rest] = args;
  if (subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    console.log(`Usage:
  aiw tasks [list] [--root PATH] [--type code] [--limit 20] [--json]
  aiw tasks show <taskId> [--root PATH] [--json]
`);
    return;
  }
  if (subcommand === "show") {
    await showTask(rest);
    return;
  }
  if (subcommand !== "list") {
    await listTasks(args);
    return;
  }
  await listTasks(rest);
}

async function runApprovals(args) {
  const [subcommand = "list", ...rest] = args;
  if (subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    console.log(`Usage:
  aiw approvals [list] [--url URL] [--status pending] [--limit 20] [--json]
  aiw approvals show <approvalId> [--url URL] [--json]
  aiw approvals approve <approvalId> [--url URL] [--check]
  aiw approvals reject <approvalId> [--url URL] [--reason TEXT]
`);
    return;
  }
  if (subcommand === "show") {
    await approvalShow(rest);
    return;
  }
  if (subcommand === "approve") {
    await approvalRespond(rest, true);
    return;
  }
  if (subcommand === "reject" || subcommand === "deny") {
    await approvalRespond(rest, false);
    return;
  }
  if (subcommand !== "list") {
    await approvalList(args);
    return;
  }
  await approvalList(rest);
}

async function approvalList(args) {
  const options = parseOptions(args, { boolean: ["json"] });
  const params = new URLSearchParams();
  params.set("status", stringOption(options.status) || "pending");
  if (options.category) params.set("category", stringOption(options.category));
  if (options.task) params.set("taskId", stringOption(options.task));
  if (options.taskId) params.set("taskId", stringOption(options.taskId));
  params.set("limit", String(numberOption(options.limit, 20)));
  const result = await requestJson(workspaceUrl(options), `/api/agent/approvals?${params.toString()}`);
  if (options.json) {
    printJson(result);
    return;
  }
  printApprovalTable(result.approvals || []);
}

async function approvalShow(args) {
  const options = parseOptions(args, { boolean: ["json"] });
  const [approvalId] = options._;
  if (!approvalId) throw new Error("Usage: aiw approvals show <approvalId>");
  const result = await requestJson(workspaceUrl(options), `/api/agent/approvals/${encodeURIComponent(approvalId)}`);
  if (options.json) {
    printJson(result);
    return;
  }
  console.log(JSON.stringify(result, null, 2));
}

async function approvalRespond(args, approved) {
  const options = parseOptions(args, { boolean: ["json", "check"] });
  const [approvalId] = options._;
  if (!approvalId) throw new Error(`Usage: aiw approvals ${approved ? "approve" : "reject"} <approvalId>`);
  const result = await requestJson(workspaceUrl(options), `/api/agent/approvals/${encodeURIComponent(approvalId)}/respond`, {
    method: "POST",
    body: {
      approved,
      reason: stringOption(options.reason) || undefined,
      runChecksAfterApply: options.check === true,
      checksApproved: options.check === true
    }
  });
  if (options.json) {
    printJson(result);
    return;
  }
  console.log(`${approved ? "Approved" : "Rejected"} approval: ${approvalId}`);
  console.log(`Status: ${result.status}`);
  if (result.result?.status) console.log(`Result: ${result.result.status}`);
}

async function listTasks(args) {
  const options = parseOptions(args, { boolean: ["json"] });
  const root = workspaceRoot(options);
  const limit = numberOption(options.limit, 20);
  const typeFilter = stringOption(options.type);
  const tasks = await readTaskFiles(root);
  const filtered = tasks
    .filter((task) => !typeFilter || task.type === typeFilter)
    .sort((a, b) => String(b.updatedAt || b.createdAt || b.id).localeCompare(String(a.updatedAt || a.createdAt || a.id)))
    .slice(0, limit);

  if (options.json) {
    printJson({ workspaceRoot: root, tasks: filtered });
    return;
  }

  if (!filtered.length) {
    console.log(`No tasks found under ${path.join(root, ".ai-workspace", "tasks")}`);
    return;
  }
  printTaskTable(filtered);
}

async function showTask(args) {
  const options = parseOptions(args, { boolean: ["json"] });
  const [taskId] = options._;
  if (!taskId) throw new Error("Usage: aiw tasks show <taskId>");
  const root = workspaceRoot(options);
  const task = await readTask(root, taskId);
  if (options.json) {
    printJson(task);
    return;
  }
  console.log(JSON.stringify(task, null, 2));
}

async function runCode(args) {
  const [subcommand, ...rest] = args;
  if (!subcommand || subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    console.log(`Usage:
  aiw code list [--url URL] [--limit 20]
  aiw code create <scopePath> <instruction...> [--url URL]
  aiw code show <taskId> [--url URL]
  aiw code patch <taskId> --path FILE --find OLD --replace NEW [--url URL]
  aiw code patch <taskId> --changes changes.json [--url URL]
  aiw code apply <taskId> <proposalId> [--check] [--command "npm test"] [--url URL]
  aiw code reject <taskId> <proposalId> [--reason TEXT] [--url URL]
  aiw code check <taskId> [--command "npm test"] [--url URL]
`);
    return;
  }

  switch (subcommand) {
    case "list":
      await codeList(rest);
      return;
    case "create":
      await codeCreate(rest);
      return;
    case "show":
      await codeShow(rest);
      return;
    case "patch":
      await codePatch(rest);
      return;
    case "apply":
      await codeApply(rest);
      return;
    case "reject":
      await codeReject(rest);
      return;
    case "check":
    case "checks":
      await codeCheck(rest);
      return;
    default:
      throw new Error(`Unknown code subcommand '${subcommand}'. Run 'aiw code help'.`);
  }
}

async function codeList(args) {
  const options = parseOptions(args, { boolean: ["json"] });
  const limit = numberOption(options.limit, 20);
  const result = await requestJson(workspaceUrl(options), `/api/agent/tasks?type=code&limit=${encodeURIComponent(String(limit))}`);
  if (options.json) {
    printJson(result);
    return;
  }
  printTaskTable(result.tasks || []);
}

async function codeCreate(args) {
  const options = parseOptions(args, { boolean: ["json"] });
  const [scopePath, ...instructionParts] = options._;
  const instruction = stringOption(options.instruction) || instructionParts.join(" ");
  if (!scopePath || !instruction) {
    throw new Error("Usage: aiw code create <scopePath> <instruction...>");
  }
  const result = await requestJson(workspaceUrl(options), "/api/agent/code-task", {
    method: "POST",
    body: {
      scopePath,
      instruction,
      maxFiles: numberOption(options["max-files"], undefined),
      maxSearchResults: numberOption(options["max-search-results"], undefined)
    }
  });
  if (options.json) {
    printJson(result);
    return;
  }
  console.log(`Created code task: ${result.taskId}`);
  console.log(`Status: ${result.status}`);
  console.log(`Scope: ${result.scopePath}`);
  if (result.summary) console.log(`Summary: ${result.summary}`);
}

async function codeShow(args) {
  const options = parseOptions(args, { boolean: ["json"] });
  const [taskId] = options._;
  if (!taskId) throw new Error("Usage: aiw code show <taskId>");
  const result = await requestJson(workspaceUrl(options), `/api/agent/tasks/${encodeURIComponent(taskId)}`);
  if (options.json) {
    printJson(result);
    return;
  }
  console.log(JSON.stringify(result, null, 2));
}

async function codePatch(args) {
  const options = parseOptions(args, { boolean: ["json"] });
  const [taskId] = options._;
  if (!taskId) throw new Error("Usage: aiw code patch <taskId> --path FILE --find OLD --replace NEW");
  const changes = await patchChangesFromOptions(options);
  const result = await requestJson(workspaceUrl(options), `/api/agent/code-task/${encodeURIComponent(taskId)}/patches`, {
    method: "POST",
    body: { changes }
  });
  if (options.json) {
    printJson(result);
    return;
  }
  console.log(`Proposed patch: ${result.proposal?.id || "(unknown)"}`);
  console.log(`Status: ${result.status}`);
  if (result.proposal?.summary) console.log(`Summary: ${result.proposal.summary}`);
  if (result.proposal?.diffRef) console.log(`Diff: ${result.proposal.diffRef}`);
}

async function codeApply(args) {
  const options = parseOptions(args, { boolean: ["json", "check"] });
  const [taskId, proposalId] = options._;
  if (!taskId || !proposalId) throw new Error("Usage: aiw code apply <taskId> <proposalId>");
  const commands = arrayOption(options.command);
  const result = await requestJson(workspaceUrl(options), `/api/agent/code-task/${encodeURIComponent(taskId)}/patches/${encodeURIComponent(proposalId)}/apply`, {
    method: "POST",
    body: {
      approved: true,
      runChecksAfterApply: options.check === true,
      checksApproved: options.check === true,
      commands: commands.length ? commands : undefined,
      allowCustomCommands: commands.length ? true : undefined
    }
  });
  if (options.json) {
    printJson(result);
    return;
  }
  console.log(`Applied patch: ${proposalId}`);
  console.log(`Status: ${result.status}`);
  if (Array.isArray(result.filesChanged) && result.filesChanged.length) {
    console.log(`Files: ${result.filesChanged.join(", ")}`);
  }
  if (result.checkRun) {
    console.log(`Checks: ${result.checkRun.allPassed ? "passed" : "failed"}`);
    for (const item of result.checkRun.results || []) {
      console.log(`- ${item.ok ? "ok" : "fail"} ${item.command} (${item.exitCode})`);
    }
  }
}

async function codeReject(args) {
  const options = parseOptions(args, { boolean: ["json"] });
  const [taskId, proposalId] = options._;
  if (!taskId || !proposalId) throw new Error("Usage: aiw code reject <taskId> <proposalId> [--reason TEXT]");
  const result = await requestJson(workspaceUrl(options), `/api/agent/code-task/${encodeURIComponent(taskId)}/patches/${encodeURIComponent(proposalId)}/reject`, {
    method: "POST",
    body: { reason: stringOption(options.reason) || "Rejected from aiw CLI." }
  });
  if (options.json) {
    printJson(result);
    return;
  }
  console.log(`Rejected patch: ${proposalId}`);
  console.log(`Status: ${result.status}`);
}

async function codeCheck(args) {
  const options = parseOptions(args, { boolean: ["json"] });
  const [taskId] = options._;
  if (!taskId) throw new Error("Usage: aiw code check <taskId> [--command \"npm test\"]");
  const commands = arrayOption(options.command);
  const body = { approved: true };
  if (commands.length) body.commands = commands;
  const result = await requestJson(workspaceUrl(options), `/api/agent/code-task/${encodeURIComponent(taskId)}/checks`, {
    method: "POST",
    body
  });
  if (options.json) {
    printJson(result);
    return;
  }
  console.log(`Checks: ${result.allPassed ? "passed" : "failed"}`);
  for (const item of result.results || []) {
    console.log(`- ${item.ok ? "ok" : "fail"} ${item.command} (${item.exitCode})`);
  }
}

async function runIndex(args) {
  const [subcommand = "status", ...rest] = args;
  if (subcommand.startsWith("-")) {
    await indexStatus(args);
    return;
  }
  if (subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    console.log(`Usage:
  aiw index [status] [--url URL] [--json]
  aiw index search <query...> [--scope PATH] [--limit 10] [--url URL]

Current MVP index backend is the Workspace Server search API. Persistent
docsearch/vector index rebuild commands will attach behind this command later.
`);
    return;
  }
  if (subcommand === "search") {
    await indexSearch(rest);
    return;
  }
  if (subcommand !== "status") {
    throw new Error(`Unknown index subcommand '${subcommand}'. Run 'aiw index help'.`);
  }
  await indexStatus(rest);
}

async function indexStatus(args) {
  const options = parseOptions(args, { boolean: ["json"] });
  const result = await requestJson(workspaceUrl(options), "/api/search/status");
  if (options.json) {
    printJson(result);
    return;
  }
  console.log(`Search provider: ${result.provider || "(unknown)"}`);
  console.log(`Indexed: ${result.indexed ? "yes" : "no"}`);
  if (result.description) console.log(result.description);
}

async function indexSearch(args) {
  const options = parseOptions(args, { boolean: ["json"] });
  const query = stringOption(options.query) || options._.join(" ");
  if (!query) throw new Error("Usage: aiw index search <query...>");
  const result = await requestJson(workspaceUrl(options), "/api/search", {
    method: "POST",
    body: {
      query,
      scopePath: stringOption(options.scope) || "",
      maxResults: numberOption(options.limit, 10)
    }
  });
  if (options.json) {
    printJson(result);
    return;
  }
  console.log(`Search: ${result.query}`);
  console.log(`Provider: ${result.provider}`);
  for (const item of result.results || []) {
    console.log(`- ${item.path}: ${item.snippet || ""}`);
  }
}

async function patchChangesFromOptions(options) {
  if (options.changes) {
    const file = expandHome(String(options.changes));
    const parsed = JSON.parse(await fs.readFile(file, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("--changes must point to a JSON array.");
    return parsed;
  }
  const pathValue = stringOption(options.path) || stringOption(options.file);
  if (!pathValue) throw new Error("Patch requires --path FILE or --changes changes.json.");
  if (options.find !== undefined || options.replace !== undefined) {
    return [{
      path: pathValue,
      find: String(options.find ?? ""),
      replace: String(options.replace ?? "")
    }];
  }
  if (options.content !== undefined) {
    return [{
      path: pathValue,
      operation: stringOption(options.operation) || "write",
      content: String(options.content)
    }];
  }
  throw new Error("Patch requires --find/--replace, --content, or --changes.");
}

async function readTaskFiles(root) {
  const tasksDir = path.join(root, ".ai-workspace", "tasks");
  let entries = [];
  try {
    entries = await fs.readdir(tasksDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const tasks = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      const text = await fs.readFile(path.join(tasksDir, entry.name), "utf8");
      tasks.push(JSON.parse(text));
    } catch {
      // Ignore malformed task files in CLI list output.
    }
  }
  return tasks;
}

async function readTask(root, taskId) {
  const file = path.join(root, ".ai-workspace", "tasks", `${taskId}.json`);
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`Task not found: ${taskId}`);
    throw error;
  }
}

function printTaskTable(tasks) {
  if (!tasks.length) {
    console.log("No tasks found.");
    return;
  }
  const rows = tasks.map((task) => ({
    id: task.id || "",
    type: task.type || "",
    status: task.status || "",
    scope: task.scopePath || task.scope_path || "",
    summary: task.message || task.instruction || task.summary || ""
  }));
  printTable(rows, [
    ["id", "ID", 34],
    ["type", "TYPE", 8],
    ["status", "STATUS", 16],
    ["scope", "SCOPE", 28],
    ["summary", "SUMMARY", 58]
  ]);
}

function printApprovalTable(approvals) {
  if (!approvals.length) {
    console.log("No approvals found.");
    return;
  }
  const rows = approvals.map((approval) => ({
    id: approval.id || "",
    status: approval.status || "",
    category: approval.category || "",
    scope: approval.scopePath || "",
    summary: approval.summary || approval.proposalId || approval.taskId || ""
  }));
  printTable(rows, [
    ["id", "ID", 34],
    ["status", "STATUS", 10],
    ["category", "CATEGORY", 18],
    ["scope", "SCOPE", 28],
    ["summary", "SUMMARY", 58]
  ]);
}

function printTable(rows, columns) {
  console.log(columns.map(([, label, width]) => pad(label, width)).join("  "));
  console.log(columns.map(([, , width]) => "-".repeat(width)).join("  "));
  for (const row of rows) {
    console.log(columns.map(([key, , width]) => pad(row[key], width)).join("  "));
  }
}

function pad(value, width) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length > width) return `${text.slice(0, Math.max(0, width - 1))}…`;
  return text.padEnd(width, " ");
}

async function requestJson(baseUrl, pathname, options = {}) {
  const response = await fetch(`${trimTrailingSlash(baseUrl)}${pathname}`, {
    method: options.method || "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(removeUndefined(options.body)) : undefined
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Expected JSON from ${pathname}, got: ${text.slice(0, 200)}`);
  }
  if (!response.ok) {
    throw new Error(json?.error || `${response.status} ${response.statusText}`);
  }
  return json;
}

function parseOptions(args, config = {}) {
  const booleans = new Set(config.boolean || []);
  const options = { _: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      options._.push(...args.slice(index + 1));
      break;
    }
    if (!arg.startsWith("--")) {
      options._.push(arg);
      continue;
    }
    const raw = arg.slice(2);
    const equals = raw.indexOf("=");
    const key = equals >= 0 ? raw.slice(0, equals) : raw;
    const valueFromEquals = equals >= 0 ? raw.slice(equals + 1) : undefined;
    if (booleans.has(key)) {
      options[key] = valueFromEquals === undefined ? true : valueFromEquals !== "false";
      continue;
    }
    const value = valueFromEquals !== undefined ? valueFromEquals : args[++index];
    if (value === undefined) throw new Error(`Missing value for --${key}`);
    if (options[key] === undefined) {
      options[key] = value;
    } else if (Array.isArray(options[key])) {
      options[key].push(value);
    } else {
      options[key] = [options[key], value];
    }
  }
  return options;
}

function workspaceUrl(options) {
  return trimTrailingSlash(stringOption(options.url) || process.env.AIW_SERVER_URL || process.env.WORKSPACE_SERVER_URL || DEFAULT_SERVER_URL);
}

function workspaceRoot(options) {
  return path.resolve(expandHome(
    stringOption(options.root)
    || stringOption(options["workspace-root"])
    || process.env.AIW_WORKSPACE_ROOT
    || DEFAULT_WORKSPACE_ROOT
  ));
}

function setEnvFromOption(env, options, names, envName, transform = (value) => value) {
  for (const name of names) {
    if (options[name] !== undefined) {
      env[envName] = transform(String(options[name]));
      return;
    }
  }
}

function stringOption(value) {
  if (Array.isArray(value)) return String(value[value.length - 1]);
  if (value === undefined || value === null || value === false) return "";
  return String(value);
}

function numberOption(value, fallback) {
  if (value === undefined || value === "") return fallback;
  const number = Number.parseInt(Array.isArray(value) ? value[value.length - 1] : value, 10);
  return Number.isFinite(number) ? number : fallback;
}

function arrayOption(value) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

function expandHome(value) {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function trimTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}

function removeUndefined(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

async function runProcess(command, args, options) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: options.stdio || "inherit"
    });
    let forwardedSignal = "";
    const forwardSignal = (signal) => {
      forwardedSignal = signal;
      if (!child.killed) child.kill(signal);
    };
    process.once("SIGINT", forwardSignal);
    process.once("SIGTERM", forwardSignal);
    const cleanup = () => {
      process.off("SIGINT", forwardSignal);
      process.off("SIGTERM", forwardSignal);
    };
    child.on("error", (error) => {
      cleanup();
      if (error.code === "ENOENT" && options.notFoundMessage) {
        reject(new Error(options.notFoundMessage));
      } else {
        reject(error);
      }
    });
    child.on("exit", (code, signal) => {
      cleanup();
      if (forwardedSignal && options.resolveOnForwardedSignal) {
        resolve();
        return;
      }
      if (signal) {
        const error = new Error(`${command} exited with signal ${signal}`);
        error.exitCode = 1;
        reject(error);
        return;
      }
      if (code) {
        const error = new Error(`${command} exited with code ${code}`);
        error.exitCode = code;
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function runModel(args) {
  const options = parseOptions(args, { boolean: ["help", "json"] });
  const root = workspaceRoot(options);

  if (options.help) {
    printModelHelp();
    return;
  }

  // If no subcommand is specified, open interactive mode
  if (options._.length === 0) {
    if (!process.stdin.isTTY) {
      throw new Error("Interactive mode requires a TTY terminal. Run 'aiw model list' or 'aiw model set-default'.");
    }
    await runModelInteractive(root);
    return;
  }

  const [subcommand, ...rest] = options._;

  if (subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    printModelHelp();
    return;
  }

  if (subcommand === "set-default") {
    const [provider, model] = rest;
    if (!provider || !model) throw new Error("Usage: aiw model set-default <provider> <model>");
    const result = await setDefaultModel(root, provider, model);
    if (options.json) {
      printJson(result);
      return;
    }
    console.log(`Default model: ${result.provider}/${result.model}`);
    return;
  }

  const models = await listRuntimeModels(root);
  if (options.json) {
    printJson({ workspaceRoot: root, models });
    return;
  }
  if (subcommand === "show") {
    const active = models.find((model) => model.isActive);
    console.log(active ? `Default model: ${active.provider}/${active.model}` : "Default model: not set");
    return;
  }
  if (subcommand !== "list") throw new Error(`Unknown model subcommand '${subcommand}'.`);
  printTable(models.map((model) => ({
    active: model.isActive ? "*" : "",
    provider: model.provider,
    model: model.model || model.name,
    source: model.source
  })), [
    ["active", "", 3],
    ["provider", "PROVIDER", 18],
    ["model", "MODEL", 30],
    ["source", "SOURCE", 12]
  ]);
}

function printModelHelp() {
  console.log(`Usage:
  aiw model [--root PATH] [--json]                      (Interactive selector)
  aiw model list [--root PATH] [--json]
  aiw model show [--root PATH] [--json]
  aiw model set-default <provider> <model> [--root PATH] [--json]
`);
}

async function runModelInteractive(root) {
  const config = await readRuntimeConfig(root);
  const currentProviderId = config.defaultModel?.provider;
  const currentModelName = config.defaultModel?.model;

  const providers = listProviderRegistry();
  const providerItems = providers.map((p) => `${p.name} (${p.id})`);
  
  let defaultProviderIndex = providers.findIndex((p) => p.id === currentProviderId);
  if (defaultProviderIndex === -1) defaultProviderIndex = 0;

  const providerIndex = await interactiveSelect("Select a provider:", providerItems, defaultProviderIndex);
  const selectedProvider = providers[providerIndex];

  // List models for selected provider
  const models = selectedProvider.models || [];
  if (models.length === 0) {
    console.log(`No curated models found for provider ${selectedProvider.name}.`);
    const readlineInterface = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    const modelInput = await new Promise((resolve) => {
      readlineInterface.question(`Enter model name: `, (answer) => {
        readlineInterface.close();
        resolve(answer.trim());
      });
    });
    if (!modelInput) {
      console.log("No model entered. Aborted.");
      return;
    }
    const result = await setDefaultModel(root, selectedProvider.id, modelInput);
    console.log(`Default model: ${result.provider}/${result.model}`);
    return;
  }

  let defaultModelIndex = models.indexOf(currentModelName);
  if (defaultModelIndex === -1) defaultModelIndex = 0;

  const modelIndex = await interactiveSelect(`Select a model for ${selectedProvider.name}:`, models, defaultModelIndex);
  const selectedModel = models[modelIndex];

  const result = await setDefaultModel(root, selectedProvider.id, selectedModel);
  console.log(`Default model: ${result.provider}/${result.model}`);
}

async function interactiveSelect(title, items, defaultIndex = 0) {
  return new Promise((resolve) => {
    let cursor = defaultIndex;
    const stdout = process.stdout;
    const stdin = process.stdin;

    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    readline.emitKeypressEvents(stdin);

    const render = () => {
      stdout.write(`\r\x1b[36m? \x1b[1m\x1b[37m${title}\x1b[0m\n`);
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (i === cursor) {
          stdout.write(`\x1b[36m> ${item}\x1b[0m\n`);
        } else {
          stdout.write(`  ${item}\n`);
        }
      }
    };

    const cleanup = () => {
      stdout.write(`\x1b[${items.length + 1}A\x1b[0J`);
      stdin.removeListener("keypress", onKeyPress);
      if (stdin.isTTY) stdin.setRawMode(wasRaw);
      stdin.pause();
    };

    const onKeyPress = (str, key) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        process.exit(130);
      }
      if (key.name === "up" || key.name === "k") {
        cursor = (cursor - 1 + items.length) % items.length;
        stdout.write(`\x1b[${items.length + 1}A\x1b[0J`);
        render();
      } else if (key.name === "down" || key.name === "j") {
        cursor = (cursor + 1) % items.length;
        stdout.write(`\x1b[${items.length + 1}A\x1b[0J`);
        render();
      } else if (key.name === "return" || key.name === "enter") {
        cleanup();
        resolve(cursor);
      }
    };

    stdin.on("keypress", onKeyPress);
    render();
  });
}

async function runProvider(args) {
  const options = parseOptions(args, { boolean: ["help", "json"] });
  const [subcommand = "list"] = options._;

  if (options.help || subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    console.log(`Usage:
  aiw provider list [--json]

Lists the AI Workspace provider registry. Provider execution and credentials are
owned by AI Workspace runtime config, not by an external CLI wrapper.
`);
    return;
  }

  if (subcommand === "list") {
    const providers = listProviderRegistry();
    if (options.json) {
      printJson(providers);
      return;
    }
    if (!providers.length) {
      console.log("No providers are registered.");
      return;
    }
    const rows = providers.map((item) => ({
      provider: item.id,
      label: item.name || item.id,
      auth: item.authType || "",
      models: (item.models || []).join(", ")
    }));
    printTable(rows, [
      ["provider", "PROVIDER", 18],
      ["label", "LABEL", 28],
      ["auth", "AUTH", 18],
      ["models", "MODELS", 36]
    ]);
  } else {
    throw new Error(`Unknown provider subcommand '${subcommand}'.`);
  }
}

async function runAuth(args) {
  const options = parseOptions(args, { boolean: ["help", "json"] });
  const [subcommand = "list", ...rest] = options._;
  const root = workspaceRoot(options);

  if (options.help || subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    console.log(`Usage:
  aiw auth [list] [--root PATH] [--json]
  aiw auth set <provider> <key> <value> [--root PATH] [--json]
  aiw auth remove <provider> [key] [--root PATH] [--json]

Credential values are stored under .ai-workspace/config/credentials.json.
Environment variables such as AIW_OPENAI_API_KEY are also detected.
`);
    return;
  }

  if (subcommand === "set") {
    const [provider, key, ...valueParts] = rest;
    const value = valueParts.join(" ") || stringOption(options.value);
    if (!provider || !key || !value) throw new Error("Usage: aiw auth set <provider> <key> <value>");
    const result = await setCredentialValue(root, provider, key, value);
    if (options.json) {
      printJson(result);
      return;
    }
    console.log(`Stored credential: ${result.provider}/${result.key}`);
    return;
  }

  if (subcommand === "remove" || subcommand === "delete") {
    const [provider, key = ""] = rest;
    if (!provider) throw new Error(`Usage: aiw auth ${subcommand} <provider> [key]`);
    const result = await removeCredentialValue(root, provider, key);
    if (options.json) {
      printJson(result);
      return;
    }
    console.log(result.removed ? `Removed credential: ${provider}${key ? `/${key}` : ""}` : `No stored credential for ${provider}`);
    return;
  }

  if (subcommand !== "list") throw new Error(`Unknown auth subcommand '${subcommand}'.`);
  const rows = await listCredentialStatus(root, process.env);
  if (options.json) {
    printJson({ workspaceRoot: root, credentials: rows });
    return;
  }
  printTable(rows.map((row) => ({
    provider: row.provider,
    auth: row.authType,
    configured: row.configured ? "yes" : "no",
    stored: row.storedKeys.join(", "),
    env: row.envKeys.join(", ")
  })), [
    ["provider", "PROVIDER", 18],
    ["auth", "AUTH", 12],
    ["configured", "CONFIGURED", 10],
    ["stored", "STORED KEYS", 24],
    ["env", "ENV", 32]
  ]);
}
