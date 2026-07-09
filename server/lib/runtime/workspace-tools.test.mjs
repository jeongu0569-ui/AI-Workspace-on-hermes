process.env.NODE_ENV = "test";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { executeWorkspaceTool } from "./workspace-tools.mjs";

test("Workspace tools route code surface operations through CodeAgentRuntime", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aiw-workspace-tools-code-"));
  const calls = [];
  const codeRuntime = {
    resolveCodeScope(scopePath = "Code") {
      calls.push(["resolveCodeScope", scopePath]);
      return {
        relativePath: scopePath,
        absolutePath: path.join(root, scopePath)
      };
    },
    async searchProject(scope, query, options) {
      calls.push(["searchProject", scope.relativePath, query, options.maxSearchResults]);
      return { resultCount: 1, results: [{ path: "Code/a.js", snippet: "hello" }] };
    },
    async applyPatch(taskId, params) {
      calls.push(["applyPatch", taskId, params.proposalId, params.approved]);
      return { ok: true, taskId, proposalId: params.proposalId };
    }
  };

  const search = await executeWorkspaceTool(root, "search_project", {
    query: "hello",
    scopePath: "Code/demo",
    maxResults: 7
  }, { codeRuntime });
  assert.equal(search.resultCount, 1);

  const patch = await executeWorkspaceTool(root, "apply_patch", {
    taskId: "task-1",
    proposalId: "patch-1"
  }, { codeRuntime, approved: true });
  assert.equal(patch.ok, true);

  assert.deepEqual(calls, [
    ["resolveCodeScope", "Code/demo"],
    ["searchProject", "Code/demo", "hello", 7],
    ["applyPatch", "task-1", "patch-1", true]
  ]);
});

test("Workspace tools reject code surface operations without CodeAgentRuntime", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aiw-workspace-tools-no-code-runtime-"));
  await assert.rejects(
    () => executeWorkspaceTool(root, "search_project", { query: "hello" }),
    /requires CodeAgentRuntime/
  );
});

test("Workspace tools read project files only under Code", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aiw-workspace-tools-read-code-"));
  await fs.mkdir(path.join(root, "Code"), { recursive: true });
  await fs.mkdir(path.join(root, "Notes"), { recursive: true });
  await fs.writeFile(path.join(root, "Code", "a.js"), "console.log('ok');", "utf8");
  await fs.writeFile(path.join(root, "Notes", "a.md"), "# note", "utf8");

  const file = await executeWorkspaceTool(root, "read_project_file", {
    path: "Code/a.js"
  }, {
    codeRuntime: {}
  });
  assert.equal(file.path, "Code/a.js");
  assert.match(file.content, /console/);

  await assert.rejects(
    () => executeWorkspaceTool(root, "read_project_file", { path: "Notes/a.md" }, { codeRuntime: {} }),
    /only read files under Code/
  );
});
