process.env.NODE_ENV = "test";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readMemoryById, searchMemory, updateMemoryFromSession } from "./memory-retrieval.mjs";

test("Memory Retrieval: search across memory pools", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aiw-memory-retrieval-"));
  await fs.mkdir(path.join(root, ".ai-workspace", "memory", "user"), { recursive: true });
  await fs.mkdir(path.join(root, ".ai-workspace", "memory", "folders"), { recursive: true });
  await fs.mkdir(path.join(root, ".ai-workspace", "sessions"), { recursive: true });
  
  // 1. User memory
  await fs.writeFile(
    path.join(root, ".ai-workspace", "memory", "user", "memories.jsonl"),
    JSON.stringify({ content: "User has a MacBook Pro 16 inch.", pinned: true, createdAt: new Date().toISOString() }) + "\n",
    "utf8"
  );
  
  // 2. Folder memory
  await fs.writeFile(
    path.join(root, ".ai-workspace", "memory", "folders", "folder-computer.json"),
    JSON.stringify([{ content: "Computer folder: local LLM setup.", pinned: false, createdAt: new Date().toISOString() }]),
    "utf8"
  );
  
  // Search without folder ID
  const search1 = await searchMemory(root, "macbook");
  assert.equal(search1.length, 1);
  assert.equal(search1[0].type, "user_memory");
  
  // Search with folder ID (computer)
  const search2 = await searchMemory(root, "local LLM", {
    currentFolderId: "computer"
  });
  
  assert.equal(search2.length, 1);
  assert.equal(search2[0].type, "folder_memory");
  assert.equal(search2[0].folderId, "computer");
});

test("Memory Retrieval: update pipeline saves user, project, folder, and session memories with sources", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aiw-memory-update-"));
  const session = {
    id: "session-memory",
    projectId: "project-alpha",
    folderId: "folder-notes",
    createdAt: "2026-07-08T10:00:00+09:00",
    summary: {
      content: "주제: AI Workspace, RAG\n결정: docsearch MCP를 공식 검색 경로로 사용한다\n선호: 사용자는 다크 모드 UI를 좋아한다",
      coveredMessageIds: ["u1", "a1"],
      updatedAt: "2026-07-08T10:05:00+09:00"
    },
    messages: [
      { id: "u1", role: "user", content: "나는 다크 모드 UI를 좋아해" },
      { id: "a1", role: "assistant", content: "기억해둘게요." }
    ]
  };

  const result = await updateMemoryFromSession(root, session);
  assert.equal(result.saved.length, 4);
  assert.ok(result.saved.every((memory) => memory.sourceSessionIds.includes("session-memory")));
  assert.ok(result.saved.every((memory) => memory.sourceMessageIds.includes("u1")));

  const userMemory = result.saved.find((memory) => memory.type === "user_memory");
  assert.ok(userMemory);
  const loaded = await readMemoryById(root, userMemory.id);
  assert.equal(loaded.id, userMemory.id);
  assert.match(loaded.content, /다크 모드/);

  const projectSearch = await searchMemory(root, "docsearch", {
    currentProjectId: "project-alpha",
    maxResults: 10
  });
  assert.equal(projectSearch.some((memory) => memory.type === "project_memory"), true);

  const folderSearch = await searchMemory(root, "AI Workspace", {
    currentFolderId: "folder-notes",
    maxResults: 10
  });
  assert.equal(folderSearch.some((memory) => memory.type === "folder_memory"), true);
});
