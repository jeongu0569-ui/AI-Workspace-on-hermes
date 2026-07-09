process.env.NODE_ENV = "test";
import test from "node:test";
import assert from "node:assert/strict";
import { buildSessionSummary, SessionRuntime } from "./session-runtime.mjs";

test("SessionRuntime summary captures topics, decisions, preferences, entities, and covered ids", () => {
  const summary = buildSessionSummary({
    id: "session-summary",
    messages: [
      { id: "u1", role: "user", content: "AI Workspace 방향은 Hermes wrapper가 아니라 독립 런타임으로 가기로 결정했어." },
      { id: "a1", role: "assistant", content: "좋아요. docsearch MCP와 RAG를 내부 경로로 정리하겠습니다." },
      { id: "u2", role: "user", content: "나는 Codex 스타일 UI를 좋아하고 Obsidian처럼 보여주길 원해." }
    ]
  });

  assert.ok(summary.content);
  assert.equal(summary.content.includes("Conversation starting with"), false);
  assert.ok(summary.topics.includes("AI Workspace"));
  assert.ok(summary.entities.includes("AI Workspace"));
  assert.ok(summary.entities.includes("Obsidian"));
  assert.ok(summary.decisions.some((item) => /결정/.test(item)));
  assert.ok(summary.preferences.some((item) => /좋아|원해/.test(item)));
  assert.deepEqual(summary.coveredMessageIds, ["u1", "a1", "u2"]);
  assert.deepEqual(summary.sourceMessageIds, ["u1", "a1", "u2"]);
});

test("SessionRuntime promptHistory returns recent visible user and assistant turns only", () => {
  const runtime = new SessionRuntime({});
  const history = runtime.promptHistory({
    messages: [
      { role: "system", content: "hidden" },
      { role: "tool", content: "tool output" },
      { role: "user", content: "one" },
      { role: "assistant", content: "two" },
      { role: "user", content: "three" }
    ]
  }, { recentLimit: 2 });

  assert.deepEqual(history, [
    { role: "assistant", content: "two" },
    { role: "user", content: "three" }
  ]);
});
