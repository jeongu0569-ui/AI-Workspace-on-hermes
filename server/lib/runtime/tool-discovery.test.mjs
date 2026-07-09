process.env.NODE_ENV = "test";
import test from "node:test";
import assert from "node:assert/strict";
import { executeToolDiscovery } from "./tool-discovery.mjs";

test("Tool Discovery: execute matching capabilities", async () => {
  const res = await executeToolDiscovery("/tmp", "chat", {
    reason: "testing notes search",
    desiredCapability: "search notes"
  });
  
  assert.ok(res.availableToolGroups.length > 0);
  const notesGroup = res.availableToolGroups.find(g => g.group === "notes_search");
  assert.ok(notesGroup);
  assert.ok(notesGroup.tools.some(t => t.name === "docsearch_search"));
  assert.ok(res.recommendation.enableForThisTurn.includes("docsearch_search"));
});

test("Tool Discovery: match case insensitive and return empty for unmatched", async () => {
  const res = await executeToolDiscovery("/tmp", "chat", {
    reason: "nothing",
    desiredCapability: "unmatched-nonexistent-capability"
  });
  
  assert.equal(res.availableToolGroups.length, 0);
  assert.equal(res.recommendation.enableForThisTurn.length, 0);
});

test("Tool Discovery: does not auto-enable approval-gated tools", async () => {
  const res = await executeToolDiscovery("/tmp", "chat", {
    reason: "need edits",
    desiredCapability: "apply patch and run git command"
  });

  assert.ok(res.availableToolGroups.some((group) => group.requiresApproval));
  assert.equal(res.expandedToolsForThisTurn.includes("apply_patch"), false);
  assert.equal(res.expandedToolsForThisTurn.includes("run_git_command"), false);
  assert.equal(res.recommendation.enableForThisTurn.includes("apply_patch"), false);
});

test("Tool Discovery: disabled tools are discoverable but blocked from turn expansion", async () => {
  const res = await executeToolDiscovery("/tmp", "chat", {
    reason: "need indexed notes",
    desiredCapability: "search indexed pdf notes documents"
  }, {
    disabledTools: ["docsearch_search"]
  });

  assert.ok(res.availableToolGroups.some((group) =>
    group.tools.some((tool) => tool.name === "docsearch_search" && tool.disabledByUser === true)
  ));
  assert.equal(res.expandedToolsForThisTurn.includes("docsearch_search"), false);
  assert.equal(res.blockedTools.some((tool) => tool.name === "docsearch_search" && tool.reason === "disabled_by_surface_mode"), true);
});
