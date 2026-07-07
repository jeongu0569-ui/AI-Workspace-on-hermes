import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { searchStatus, searchWorkspace } from "./search-service.mjs";

test("searches workspace text files within scope", async () => {
  const root = await fixtureWorkspace();
  const result = await searchWorkspace(root, {
    query: "scheduler",
    scopePath: "Notes",
    maxResults: 5
  });
  assert.equal(result.provider, "workspace-scan");
  assert.equal(result.resultCount, 1);
  assert.equal(result.results[0].path, "Notes/os.md");
  assert.match(result.results[0].snippet, /scheduler/i);
});

test("does not search outside the requested scope", async () => {
  const root = await fixtureWorkspace();
  const result = await searchWorkspace(root, {
    query: "scheduler",
    scopePath: "Code"
  });
  assert.equal(result.resultCount, 0);
});

test("reports fallback search status", async () => {
  const status = searchStatus("/tmp/workspace");
  assert.equal(status.provider, "workspace-scan");
  assert.equal(status.available, true);
  assert.equal(status.indexed, false);
  assert.ok(status.searchableExtensions.includes(".md"));
});

async function fixtureWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "search-service-"));
  await fs.mkdir(path.join(root, "Notes"), { recursive: true });
  await fs.mkdir(path.join(root, "Code"), { recursive: true });
  await fs.writeFile(path.join(root, "Notes", "os.md"), "# OS\n\nA scheduler chooses a process.", "utf8");
  await fs.writeFile(path.join(root, "Code", "main.js"), "console.log('hello')", "utf8");
  return root;
}

