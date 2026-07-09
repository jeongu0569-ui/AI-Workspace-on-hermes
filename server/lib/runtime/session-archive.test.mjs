process.env.NODE_ENV = "test";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  archiveExpiredSessions,
  archiveOverflowGeneralSessions,
  listArchivedSessions,
  archiveSession,
  unarchiveSession,
  isArchiveExempt
} from "./session-archive.mjs";

test("Session Archive: exemption check", () => {
  assert.equal(isArchiveExempt({ projectId: "knu-ai" }), true);
  assert.equal(isArchiveExempt({ folderId: "music" }), true);
  assert.equal(isArchiveExempt({ pinned: true }), true);
  assert.equal(isArchiveExempt({ kind: "general" }), false);
});

test("Session Archive: automatic archive and manual restore", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aiw-session-archive-"));
  await fs.mkdir(path.join(root, ".ai-workspace", "sessions"), { recursive: true });
  
  const oldDate = new Date(Date.now() - 32 * 24 * 3600 * 1000).toISOString();
  
  const expiredSession = {
    id: "sess-expired",
    title: "old conversation",
    kind: "general",
    createdAt: oldDate,
    updatedAt: oldDate,
    visibleInSidebar: true
  };
  
  const activeSession = {
    id: "sess-active",
    title: "new conversation",
    kind: "general",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    visibleInSidebar: true
  };
  
  await fs.writeFile(path.join(root, ".ai-workspace", "sessions", "sess-expired.json"), JSON.stringify(expiredSession), "utf8");
  await fs.writeFile(path.join(root, ".ai-workspace", "sessions", "sess-active.json"), JSON.stringify(activeSession), "utf8");
  
  // Auto-archive
  const archiveRes = await archiveExpiredSessions(root, { thresholdDays: 30 });
  assert.equal(archiveRes.archivedCount, 1);
  
  const sess1 = JSON.parse(await fs.readFile(path.join(root, ".ai-workspace", "sessions", "sess-expired.json"), "utf8"));
  assert.ok(sess1.archivedAt);
  assert.equal(sess1.visibleInSidebar, false);
  
  const sess2 = JSON.parse(await fs.readFile(path.join(root, ".ai-workspace", "sessions", "sess-active.json"), "utf8"));
  assert.ok(!sess2.archivedAt);
  assert.equal(sess2.visibleInSidebar, true);
  
  // Manual unarchive
  await unarchiveSession(root, "sess-expired");
  const sessRestore = JSON.parse(await fs.readFile(path.join(root, ".ai-workspace", "sessions", "sess-expired.json"), "utf8"));
  assert.equal(sessRestore.archivedAt, null);
  assert.equal(sessRestore.visibleInSidebar, true);
});

test("Session Archive: general chat overflow keeps latest 30 visible and exempts scoped chats", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aiw-session-overflow-"));
  const sessionsDir = path.join(root, ".ai-workspace", "sessions");
  const approvalsDir = path.join(root, ".ai-workspace", "approvals");
  await fs.mkdir(sessionsDir, { recursive: true });
  await fs.mkdir(approvalsDir, { recursive: true });

  for (let i = 0; i < 32; i += 1) {
    const date = new Date(Date.UTC(2026, 6, 1, 0, i)).toISOString();
    await fs.writeFile(
      path.join(sessionsDir, `general-${i}.json`),
      JSON.stringify({
        id: `general-${i}`,
        title: `[Chat] ${i}`,
        kind: "general",
        createdAt: date,
        updatedAt: date,
        visibleInSidebar: true
      }, null, 2),
      "utf8"
    );
  }

  const exemptSessions = [
    { id: "folder-chat", folderId: "folder-1" },
    { id: "project-chat", projectId: "project-1" },
    { id: "pinned-chat", pinned: true },
    { id: "approval-chat" }
  ];
  for (const item of exemptSessions) {
    await fs.writeFile(
      path.join(sessionsDir, `${item.id}.json`),
      JSON.stringify({
        id: item.id,
        title: item.id,
        kind: "general",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        visibleInSidebar: true,
        ...item
      }, null, 2),
      "utf8"
    );
  }
  await fs.writeFile(
    path.join(approvalsDir, "approval-pending.json"),
    JSON.stringify({
      id: "approval-pending",
      sessionId: "approval-chat",
      status: "pending"
    }, null, 2),
    "utf8"
  );

  const result = await archiveOverflowGeneralSessions(root, { limit: 30 });
  assert.equal(result.archivedCount, 2);
  assert.equal(result.visibleLimit, 30);

  const files = await fs.readdir(sessionsDir);
  const sessions = await Promise.all(files.filter((file) => file.endsWith(".json")).map(async (file) => {
    return JSON.parse(await fs.readFile(path.join(sessionsDir, file), "utf8"));
  }));

  const visibleGeneral = sessions.filter((session) =>
    session.kind === "general"
    && !session.folderId
    && !session.projectId
    && !session.pinned
    && session.id !== "approval-chat"
    && session.visibleInSidebar !== false
  );
  assert.equal(visibleGeneral.length, 30);
  assert.equal(sessions.find((session) => session.id === "general-0").visibleInSidebar, false);
  assert.equal(sessions.find((session) => session.id === "general-1").visibleInSidebar, false);
  assert.equal(sessions.find((session) => session.id === "folder-chat").visibleInSidebar, true);
  assert.equal(sessions.find((session) => session.id === "project-chat").visibleInSidebar, true);
  assert.equal(sessions.find((session) => session.id === "pinned-chat").visibleInSidebar, true);
  assert.equal(sessions.find((session) => session.id === "approval-chat").visibleInSidebar, true);
});
