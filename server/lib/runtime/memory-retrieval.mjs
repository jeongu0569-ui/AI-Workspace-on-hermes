import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { resolveTimeRange } from "./time-range.mjs";

export const MEMORY_SEARCH_DEFINITION = {
  type: "function",
  function: {
    name: "memory_search",
    description: "Search long-term user, project, folder, and session-summary memories.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string", description: "Memory search query." },
        currentFolderId: { type: "string" },
        currentProjectId: { type: "string" },
        timeRange: { type: "string", description: "today, yesterday, this_week, last_week, last_7_days, or ISO range." },
        maxResults: { type: "integer", minimum: 1, maximum: 50 }
      },
      required: ["query"]
    }
  }
};

export async function searchMemory(workspaceRoot, query, context = {}) {
  const q = String(query || "").toLowerCase();
  const timeRange = resolveTimeRange(context.timeRange, { now: context.now });
  
  // Sources to collect candidates from:
  // 1. User memories
  // 2. Project memories (if currentProjectId matches)
  // 3. Folder memories (if currentFolderId matches)
  // 4. Session summaries (from all sessions)
  
  const candidates = [];
  
  // 1. User memories
  try {
    const filePath = path.join(workspaceRoot, ".ai-workspace", "memory", "user", "memories.jsonl");
    const data = await fs.readFile(filePath, "utf8");
    const lines = data.split("\n").filter(Boolean).map(JSON.parse);
    lines.forEach(m => {
      candidates.push({
        type: "user_memory",
        content: m.content,
        createdAt: m.createdAt || new Date().toISOString(),
        pinned: Boolean(m.pinned),
        source: m.sourceSessionIds || []
      });
    });
  } catch {}

  // 2. Folder memories
  if (context.currentFolderId) {
    try {
      const filePath = path.join(workspaceRoot, ".ai-workspace", "memory", "folders", `folder-${context.currentFolderId}.json`);
      const data = await fs.readFile(filePath, "utf8");
      const list = JSON.parse(data);
      list.forEach(m => {
        candidates.push({
          type: "folder_memory",
          folderId: context.currentFolderId,
          content: m.content,
          createdAt: m.createdAt || new Date().toISOString(),
          pinned: Boolean(m.pinned)
        });
      });
    } catch {}
  }

  // 3. Project memories
  if (context.currentProjectId) {
    try {
      const filePath = path.join(workspaceRoot, ".ai-workspace", "memory", "projects", `project-${context.currentProjectId}.jsonl`);
      const data = await fs.readFile(filePath, "utf8");
      const lines = data.split("\n").filter(Boolean).map(JSON.parse);
      lines.forEach(m => {
        candidates.push({
          type: "project_memory",
          projectId: context.currentProjectId,
          content: m.content,
          createdAt: m.createdAt || new Date().toISOString(),
          pinned: Boolean(m.pinned)
        });
      });
    } catch {}
  }

  // 4. Session summaries
  const sessionsDir = path.join(workspaceRoot, ".ai-workspace", "sessions");
  try {
    const files = await fs.readdir(sessionsDir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const data = await fs.readFile(path.join(sessionsDir, file), "utf8");
        const session = JSON.parse(data);
        if (session.summary && session.summary.content) {
          candidates.push({
            type: "session_summary_memory",
            sessionId: session.id,
            folderId: session.folderId,
            projectId: session.projectId,
            content: session.summary.content,
            createdAt: session.summary.updatedAt || session.updatedAt || session.createdAt || new Date().toISOString(),
            pinned: Boolean(session.pinned)
          });
        }
      } catch {}
    }
  } catch {}

  // Filter & Score candidates
  const scored = candidates
    .filter((candidate) => isWithinTimeRange(candidate.createdAt, timeRange))
    .map(c => {
    const score = calculateMemoryScore(c, q, context);
    return { ...c, score };
  });

  // Sort by score desc
  return scored
    .filter(c => !q || c.score > 0.1)
    .sort((a, b) => b.score - a.score || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, context.maxResults || 10);
}

export async function updateMemoryFromSession(workspaceRoot, session, options = {}) {
  const candidates = extractMemoryCandidates(session, options);
  const saved = [];
  for (const candidate of candidates) {
    if (candidate.type === "user_memory") saved.push(await saveUserMemory(workspaceRoot, candidate));
    else if (candidate.type === "project_memory") saved.push(await saveProjectMemory(workspaceRoot, candidate.projectId, candidate));
    else if (candidate.type === "folder_memory") saved.push(await saveFolderMemory(workspaceRoot, candidate.folderId, candidate));
    else if (candidate.type === "session_summary_memory") saved.push(await saveSessionSummaryMemory(workspaceRoot, candidate));
  }
  return { saved };
}

export async function readMemoryById(workspaceRoot, memoryId) {
  const all = [];
  await collectJsonl(all, path.join(workspaceRoot, ".ai-workspace", "memory", "user", "memories.jsonl"));
  await collectJsonl(all, path.join(workspaceRoot, ".ai-workspace", "memory", "sessions", "session-summaries.jsonl"));
  await collectGlobJsonl(all, path.join(workspaceRoot, ".ai-workspace", "memory", "projects"));
  await collectFolderMemory(all, path.join(workspaceRoot, ".ai-workspace", "memory", "folders"));
  return all.find((memory) => memory.id === memoryId) || null;
}

export function extractMemoryCandidates(session, _options = {}) {
  if (!session || !Array.isArray(session.messages)) return [];
  const sourceMessageIds = session.messages.map((message, index) => message.id || String(index + 1));
  const content = [
    session.summary?.content || "",
    ...session.messages
      .filter((message) => ["user", "assistant"].includes(message.role))
      .slice(-12)
      .map((message) => message.content || "")
  ].join("\n").trim();
  if (!content) return [];

  const tags = extractTags(content);
  const base = {
    sourceSessionIds: [session.id].filter(Boolean),
    sourceMessageIds,
    tags,
    createdAt: session.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pinned: false
  };
  const candidates = [];

  if (session.summary?.content) {
    candidates.push({
      ...base,
      id: stableMemoryId("session", session.id || "", session.summary.content),
      type: "session_summary_memory",
      content: session.summary.content
    });
  }

  const preference = extractPreference(content);
  if (preference) {
    candidates.push({
      ...base,
      id: stableMemoryId("user", session.id || "", preference),
      type: "user_memory",
      content: preference
    });
  }

  if (session.projectId && session.summary?.content) {
    candidates.push({
      ...base,
      id: stableMemoryId("project", session.projectId, session.summary.content),
      type: "project_memory",
      projectId: session.projectId,
      content: session.summary.content
    });
  }

  if (session.folderId && session.summary?.content) {
    candidates.push({
      ...base,
      id: stableMemoryId("folder", session.folderId, session.summary.content),
      type: "folder_memory",
      folderId: session.folderId,
      content: session.summary.content
    });
  }

  return candidates;
}

export async function saveUserMemory(workspaceRoot, memory) {
  const filePath = path.join(workspaceRoot, ".ai-workspace", "memory", "user", "memories.jsonl");
  return await upsertJsonl(filePath, normalizeMemory(memory, "user_memory"));
}

export async function saveProjectMemory(workspaceRoot, projectId, memory) {
  const filePath = path.join(workspaceRoot, ".ai-workspace", "memory", "projects", `project-${safeId(projectId)}.jsonl`);
  return await upsertJsonl(filePath, normalizeMemory({ ...memory, projectId }, "project_memory"));
}

export async function saveFolderMemory(workspaceRoot, folderId, memory) {
  const filePath = path.join(workspaceRoot, ".ai-workspace", "memory", "folders", `folder-${safeId(folderId)}.json`);
  let list = [];
  try {
    list = JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {}
  const normalized = normalizeMemory({ ...memory, folderId }, "folder_memory");
  const next = upsertArray(list, normalized);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(next, null, 2) + "\n", "utf8");
  return normalized;
}

export async function saveSessionSummaryMemory(workspaceRoot, memory) {
  const filePath = path.join(workspaceRoot, ".ai-workspace", "memory", "sessions", "session-summaries.jsonl");
  return await upsertJsonl(filePath, normalizeMemory(memory, "session_summary_memory"));
}

function calculateMemoryScore(candidate, query, context) {
  const text = String(candidate.content || "").toLowerCase();
  
  // 1. Semantic/Keyword Similarity (45%)
  let similarity = 0;
  const words = query.split(/\s+/).filter(Boolean);
  if (words.length > 0) {
    let matchCount = 0;
    words.forEach(w => {
      if (text.includes(w)) matchCount++;
    });
    similarity = matchCount / words.length;
    if (similarity === 0) return 0;
  } else {
    similarity = 1.0;
  }

  // 2. Keyword Match (20%)
  const keywordMatch = text.includes(query) ? 1.0 : 0.0;

  // 3. Recency Weight (15%)
  const ageInMs = Date.now() - new Date(candidate.createdAt).getTime();
  const ageInDays = ageInMs / (24 * 3600 * 1000);
  let recencyWeight = 0.2;
  if (ageInDays <= 1) recencyWeight = 1.0;
  else if (ageInDays <= 7) recencyWeight = 0.8;
  else if (ageInDays <= 30) recencyWeight = 0.5;

  // Boost if date ranges are specified
  if (context.timeRange) {
    // optional boost
  }

  // 4. Folder/Project Boost (15%)
  let folderOrProjectBoost = 0.3;
  if (context.currentFolderId && candidate.folderId === context.currentFolderId) {
    folderOrProjectBoost = 1.0;
  }
  if (context.currentProjectId && candidate.projectId === context.currentProjectId) {
    folderOrProjectBoost = 1.0;
  }

  // 5. User Pinned Boost (5%)
  const userPinnedBoost = candidate.pinned ? 1.0 : 0.0;

  const finalScore =
    similarity * 0.45 +
    keywordMatch * 0.20 +
    recencyWeight * 0.15 +
    folderOrProjectBoost * 0.15 +
    userPinnedBoost * 0.05;

  return Number(finalScore.toFixed(3));
}

function isWithinTimeRange(createdAt, range) {
  if (!range) return true;
  const time = Date.parse(createdAt || "");
  if (!Number.isFinite(time)) return true;
  if (range.from && time < range.from.getTime()) return false;
  if (range.to && time > range.to.getTime()) return false;
  return true;
}

async function upsertJsonl(filePath, memory) {
  let list = [];
  try {
    list = (await fs.readFile(filePath, "utf8")).split("\n").filter(Boolean).map(JSON.parse);
  } catch {}
  const next = upsertArray(list, memory);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, next.map((item) => JSON.stringify(item)).join("\n") + "\n", "utf8");
  return memory;
}

async function collectJsonl(target, filePath) {
  try {
    const rows = (await fs.readFile(filePath, "utf8")).split("\n").filter(Boolean).map(JSON.parse);
    target.push(...rows);
  } catch {}
}

async function collectGlobJsonl(target, dirPath) {
  let files = [];
  try {
    files = await fs.readdir(dirPath);
  } catch {
    return;
  }
  for (const file of files) {
    if (file.endsWith(".jsonl")) await collectJsonl(target, path.join(dirPath, file));
  }
}

async function collectFolderMemory(target, dirPath) {
  let files = [];
  try {
    files = await fs.readdir(dirPath);
  } catch {
    return;
  }
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const rows = JSON.parse(await fs.readFile(path.join(dirPath, file), "utf8"));
      if (Array.isArray(rows)) target.push(...rows);
    } catch {}
  }
}

function upsertArray(list, memory) {
  const idx = list.findIndex((item) => item.id === memory.id);
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...memory, createdAt: list[idx].createdAt || memory.createdAt, updatedAt: new Date().toISOString() };
    return list;
  }
  return [...list, memory];
}

function normalizeMemory(memory, fallbackType) {
  const content = String(memory.content || "").trim();
  return {
    id: memory.id || stableMemoryId(fallbackType, memory.projectId || memory.folderId || "", content),
    type: memory.type || fallbackType,
    content,
    projectId: memory.projectId || undefined,
    folderId: memory.folderId || undefined,
    sourceSessionIds: memory.sourceSessionIds || [],
    sourceMessageIds: memory.sourceMessageIds || [],
    tags: memory.tags || [],
    createdAt: memory.createdAt || new Date().toISOString(),
    updatedAt: memory.updatedAt || new Date().toISOString(),
    pinned: Boolean(memory.pinned)
  };
}

function stableMemoryId(...parts) {
  return `memory-${crypto.createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 20)}`;
}

function extractTags(text) {
  const tags = [];
  const lower = String(text || "").toLowerCase();
  for (const [needle, tag] of [
    ["ai workspace", "ai-workspace"],
    ["hermes", "hermes"],
    ["codex", "code-agent"],
    ["docsearch", "rag"],
    ["pdf", "pdf"],
    ["옵시디언", "obsidian"],
    ["음악", "music"]
  ]) {
    if (lower.includes(needle)) tags.push(tag);
  }
  return Array.from(new Set(tags));
}

function extractPreference(text) {
  const lines = String(text || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const preferenceLine = lines.find((line) => /선호|원해|원한다|좋아|싫어|prefer|preference|want/i.test(line));
  if (!preferenceLine) return "";
  return preferenceLine.slice(0, 500);
}

function safeId(value) {
  return String(value || "default").replace(/[^a-zA-Z0-9_.-]/g, "_");
}
