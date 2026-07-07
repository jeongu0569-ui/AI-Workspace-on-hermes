import test from "node:test";
import assert from "node:assert/strict";
import { normalizeWorkspacePath, resolveWorkspacePath, rootPathFromKey } from "./path-utils.mjs";

test("normalizes workspace-relative paths", () => {
  assert.equal(normalizeWorkspacePath("Notes/Work/../Life/test.md"), "Notes/Life/test.md");
  assert.equal(normalizeWorkspacePath("Notes\\A.md"), "Notes/A.md");
  assert.equal(normalizeWorkspacePath("."), "");
});

test("rejects absolute and traversal paths", () => {
  assert.throws(() => normalizeWorkspacePath("/Users/user/secret.md"), /Absolute paths/);
  assert.throws(() => normalizeWorkspacePath("../../secret.md"), /Path traversal/);
  assert.throws(() => normalizeWorkspacePath("C:/Users/secret.md"), /Absolute paths/);
});

test("resolved paths stay inside workspace root", () => {
  const result = resolveWorkspacePath("/tmp/workspace", "Notes/a.md");
  assert.equal(result.relativePath, "Notes/a.md");
  assert.equal(result.absolutePath, "/tmp/workspace/Notes/a.md");
});

test("maps root keys to folder names", () => {
  assert.equal(rootPathFromKey("notes"), "Notes");
  assert.equal(rootPathFromKey("code"), "Code");
  assert.equal(rootPathFromKey("workspace"), "");
  assert.throws(() => rootPathFromKey("bad"), /Unknown workspace root/);
});
