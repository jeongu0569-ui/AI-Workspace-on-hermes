import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export async function ensureFoldersDir(workspaceRoot) {
  const dir = path.join(workspaceRoot, ".ai-workspace", "conversation-folders");
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(path.join(workspaceRoot, ".ai-workspace", "memory", "folders"), { recursive: true });
  return dir;
}

export async function listFolders(workspaceRoot) {
  const dir = await ensureFoldersDir(workspaceRoot);
  const filePath = path.join(dir, "folders.json");
  try {
    const data = await fs.readFile(filePath, "utf8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export async function createFolder(workspaceRoot, { name, icon, color }) {
  await ensureFoldersDir(workspaceRoot);
  const folders = await listFolders(workspaceRoot);
  const newFolder = {
    id: `folder-${randomUUID()}`,
    name,
    icon: icon || "folder",
    color: color || "blue",
    createdAt: new Date().toISOString()
  };
  folders.push(newFolder);
  const filePath = path.join(workspaceRoot, ".ai-workspace", "conversation-folders", "folders.json");
  await fs.writeFile(filePath, JSON.stringify(folders, null, 2), "utf8");
  return newFolder;
}

export async function updateFolder(workspaceRoot, folderId, patch) {
  const folders = await listFolders(workspaceRoot);
  const idx = folders.findIndex(f => f.id === folderId);
  if (idx === -1) {
    throw new Error(`Folder with id ${folderId} not found`);
  }
  folders[idx] = {
    ...folders[idx],
    ...patch,
    updatedAt: new Date().toISOString()
  };
  const filePath = path.join(workspaceRoot, ".ai-workspace", "conversation-folders", "folders.json");
  await fs.writeFile(filePath, JSON.stringify(folders, null, 2), "utf8");
  return folders[idx];
}

export async function deleteFolder(workspaceRoot, folderId) {
  const folders = await listFolders(workspaceRoot);
  const filtered = folders.filter(f => f.id !== folderId);
  const filePath = path.join(workspaceRoot, ".ai-workspace", "conversation-folders", "folders.json");
  await fs.writeFile(filePath, JSON.stringify(filtered, null, 2), "utf8");

  const unassignedSessions = await unassignFolderSessions(workspaceRoot, folderId);
  return { ok: true, unassignedSessions };
}

export async function getFolderMemory(workspaceRoot, folderId) {
  const filePath = path.join(workspaceRoot, ".ai-workspace", "memory", "folders", `folder-${folderId}.json`);
  try {
    const data = await fs.readFile(filePath, "utf8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export async function updateFolderMemory(workspaceRoot, folderId, memoryEntries) {
  const dir = path.join(workspaceRoot, ".ai-workspace", "memory", "folders");
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `folder-${folderId}.json`);
  await fs.writeFile(filePath, JSON.stringify(memoryEntries, null, 2), "utf8");
  return memoryEntries;
}

export async function moveSessionToFolder(workspaceRoot, sessionId, folderId) {
  const sessionPath = path.join(workspaceRoot, ".ai-workspace", "sessions", `${sessionId}.json`);
  let session = null;
  try {
    const data = await fs.readFile(sessionPath, "utf8");
    session = JSON.parse(data);
  } catch {
    throw new Error(`Session with id ${sessionId} not found`);
  }
  
  session.folderId = folderId || null;
  session.kind = folderId ? "folder" : (session.projectId ? "project" : "general");
  session.updatedAt = new Date().toISOString();
  
  await fs.writeFile(sessionPath, JSON.stringify(session, null, 2), "utf8");
  
  // Re-index session since metadata changed
  const { indexSession } = await import("./conversation-index.mjs");
  await indexSession(workspaceRoot, session);
  
  return session;
}

async function unassignFolderSessions(workspaceRoot, folderId) {
  const sessionsDir = path.join(workspaceRoot, ".ai-workspace", "sessions");
  let files = [];
  try {
    files = await fs.readdir(sessionsDir);
  } catch {
    return 0;
  }
  let count = 0;
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const sessionPath = path.join(sessionsDir, file);
    try {
      const session = JSON.parse(await fs.readFile(sessionPath, "utf8"));
      if (session.folderId !== folderId) continue;
      session.folderId = null;
      session.kind = session.projectId ? "project" : "general";
      session.updatedAt = new Date().toISOString();
      await fs.writeFile(sessionPath, JSON.stringify(session, null, 2), "utf8");
      const { indexSession } = await import("./conversation-index.mjs");
      await indexSession(workspaceRoot, session);
      count += 1;
    } catch {}
  }
  return count;
}
