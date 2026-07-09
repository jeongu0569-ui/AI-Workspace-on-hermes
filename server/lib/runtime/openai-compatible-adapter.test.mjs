import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OpenAICompatibleRuntimeAdapter } from "./openai-compatible-adapter.mjs";
import { setCredentialValue, setDefaultModel } from "./config-store.mjs";

test("OpenAI-compatible adapter streams chat completions from AI Workspace config", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aiw-openai-adapter-"));
  await setDefaultModel(root, "custom", "demo-model");
  await setCredentialValue(root, "custom", "AIW_CUSTOM_BASE_URL", "http://model.test/v1");
  await setCredentialValue(root, "custom", "AIW_CUSTOM_API_KEY", "test-key");

  let request = null;
  const adapter = new OpenAICompatibleRuntimeAdapter({
    workspaceRoot: root,
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return {
        ok: true,
        headers: { get: () => "text/event-stream" },
        body: streamChunks([
          'data: {"choices":[{"delta":{"content":"안녕"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"하세요"}}]}\n\n',
          'data: [DONE]\n\n'
        ])
      };
    }
  });

  const events = [];
  adapter.on("event", (event) => events.push(event));

  const result = await adapter.submitPrompt({
    sessionId: "session-1",
    message: "소개해줘",
    history: [
      { role: "user", content: "이전 질문" },
      { role: "assistant", content: "이전 답변" }
    ],
    context: {
      workspaceContext: {
        workspace: { scopeType: "current", activePath: "Notes/a.md" },
        inlineBlocks: [{ title: "Current resource", path: "Notes/a.md", content: "# Alpha" }]
      }
    }
  });

  assert.equal(result.reply, "안녕하세요");
  assert.equal(request.url, "http://model.test/v1/chat/completions");
  assert.equal(request.options.headers.authorization, "Bearer test-key");
  assert.equal(request.body.model, "demo-model");
  assert.equal(request.body.messages[0].role, "system");
  assert.match(request.body.messages[0].content, /Notes\/a\.md/);
  assert.deepEqual(request.body.messages.slice(-3).map((m) => m.role), ["user", "assistant", "user"]);
  assert.deepEqual(events.map((event) => event.type), ["turn.start", "message.delta", "message.delta", "turn.complete"]);
});

test("OpenAI-compatible adapter reports setup when no model is selected", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aiw-openai-adapter-missing-"));
  const adapter = new OpenAICompatibleRuntimeAdapter({ workspaceRoot: root });
  await assert.rejects(
    () => adapter.submitPrompt({ sessionId: "session-1", message: "hello" }),
    /No default model is configured/
  );
});

test("OpenAI-compatible adapter executes workspace search tool calls", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aiw-openai-adapter-tools-"));
  await fs.mkdir(path.join(root, "Notes"), { recursive: true });
  await fs.writeFile(path.join(root, "Notes", "git.md"), "# Git\n\ngit pull brings remote changes.", "utf8");
  await setDefaultModel(root, "custom", "demo-model");
  await setCredentialValue(root, "custom", "AIW_CUSTOM_BASE_URL", "http://model.test/v1");
  await setCredentialValue(root, "custom", "AIW_CUSTOM_API_KEY", "test-key");

  const requests = [];
  const adapter = new OpenAICompatibleRuntimeAdapter({
    workspaceRoot: root,
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      if (requests.length === 1) {
        return {
          ok: true,
          headers: { get: () => "text/event-stream" },
          body: streamChunks([
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_search","type":"function","function":{"name":"workspace_search","arguments":"{\\"query\\":\\"git pull\\",\\"scopePath\\":\\"Notes\\"}"}}]}}]}\n\n',
            'data: [DONE]\n\n'
          ])
        };
      }
      return {
        ok: true,
        headers: { get: () => "text/event-stream" },
        body: streamChunks([
          'data: {"choices":[{"delta":{"content":"git pull 설명을 찾았어요."}}]}\n\n',
          'data: [DONE]\n\n'
        ])
      };
    }
  });

  const events = [];
  adapter.on("event", (event) => events.push(event));

  const result = await adapter.submitPrompt({
    sessionId: "session-1",
    message: "git pull 관련 노트 있어?"
  });

  assert.equal(result.reply, "git pull 설명을 찾았어요.");
  assert.equal(result.toolRounds, 1);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].tools.length, 3);
  const toolMessage = requests[1].messages.find((message) => message.role === "tool");
  assert.equal(toolMessage.name, "workspace_search");
  assert.match(toolMessage.content, /Notes\/git\.md/);
  assert.deepEqual(events.map((event) => event.type), [
    "turn.start",
    "tool.start",
    "tool.complete",
    "message.delta",
    "turn.complete"
  ]);
});

async function* streamChunks(chunks) {
  for (const chunk of chunks) yield Buffer.from(chunk, "utf8");
}
