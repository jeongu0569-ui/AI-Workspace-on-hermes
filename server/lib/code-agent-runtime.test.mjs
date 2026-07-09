import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CodeAgentRuntime } from "./code-agent-runtime.mjs";
import { WorkspaceAgentStateStore } from "./agent-engine.mjs";

test("code agent runtime inspects a Code project and records artifacts", async () => {
  const root = await fixtureCodeWorkspace();
  const state = new WorkspaceAgentStateStore(root);
  const runtime = new CodeAgentRuntime({ workspaceRoot: root, stateStore: state });

  const result = await runtime.inspectTask({
    scopePath: "Code/demo-app",
    instruction: "Change the greeting renderer",
    maxFiles: 20
  });

  assert.equal(result.ok, true);
  assert.equal(result.runtime, "code-agent");
  assert.equal(result.status, "inspected");
  assert.equal(result.scopePath, "Code/demo-app");
  assert.match(result.taskId, /^task-/);
  assert.ok(result.inspection.files.some((file) => file.path === "Code/demo-app/src/index.js"));
  assert.equal(result.inspection.package.name, "demo-app");
  assert.ok(result.inspection.suggestedCheckCommands.includes("npm run test"));
  assert.ok(result.search.resultCount >= 1);
  assert.equal(result.plan.steps[0].status, "done");
  assert.equal(result.plan.steps[2].status, "blocked_on_approval");

  const task = JSON.parse(await fs.readFile(
    path.join(root, ".ai-workspace", "tasks", `${result.taskId}.json`),
    "utf8"
  ));
  assert.equal(task.type, "code");
  assert.equal(task.status, "inspected");
  assert.equal(task.scopePath, "Code/demo-app");
  assert.equal(task.git.diffRef, `.ai-workspace/diffs/${result.taskId}.diff`);

  const toolLog = await fs.readFile(path.join(root, ".ai-workspace", "tool-logs", "tool-events.jsonl"), "utf8");
  assert.match(toolLog, /code.inspect.start/);
  assert.match(toolLog, /code.inspect.complete/);

  const decisions = await fs.readFile(path.join(root, ".ai-workspace", "decisions", "events.jsonl"), "utf8");
  assert.match(decisions, /code.inspect.plan/);
});

test("code agent runtime rejects non-Code scopes", async () => {
  const root = await fixtureCodeWorkspace();
  const state = new WorkspaceAgentStateStore(root);
  const runtime = new CodeAgentRuntime({ workspaceRoot: root, stateStore: state });

  await assert.rejects(
    () => runtime.inspectTask({
      scopePath: "Notes",
      instruction: "Change the greeting renderer"
    }),
    /under the Code workspace root/
  );
});

async function fixtureCodeWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-agent-runtime-"));
  const project = path.join(root, "Code", "demo-app");
  await fs.mkdir(path.join(project, "src"), { recursive: true });
  await fs.writeFile(path.join(project, "package.json"), JSON.stringify({
    name: "demo-app",
    scripts: {
      test: "node --test",
      lint: "eslint ."
    }
  }, null, 2) + "\n", "utf8");
  await fs.writeFile(path.join(project, "src", "index.js"), "export function greeting() {\n  return 'hello';\n}\n", "utf8");
  await fs.writeFile(path.join(project, "README.md"), "# Demo app\n\nThe greeting renderer is intentionally small.\n", "utf8");
  return root;
}
