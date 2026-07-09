import fs from "node:fs/promises";
import path from "node:path";

export class SessionRuntime {
  constructor({ runtime, stateStore }) {
    this.runtime = runtime;
    this.stateStore = stateStore;
  }

  async listSessions(limit = 200, options = {}) {
    let workspaceSessions = [];
    if (this.stateStore) {
      try {
        const { archiveOverflowGeneralSessions } = await import("./runtime/session-archive.mjs");
        await archiveOverflowGeneralSessions(this.stateStore.workspaceRoot, {
          limit: options.generalVisibleLimit || 30
        });
        workspaceSessions = await this.stateStore.listWorkspaceSessions();
      } catch {}
    }

    const seen = new Set();
    const merged = [];

    for (const s of workspaceSessions) {
      if (s.id && !seen.has(s.id)) {
        seen.add(s.id);
        
        // Archive/Sidebar filtering
        if (!options.includeArchived && s.visibleInSidebar === false) {
          continue;
        }
        if (options.folderId && s.folderId !== options.folderId) {
          continue;
        }
        if (options.projectId && s.projectId !== options.projectId) {
          continue;
        }

        merged.push({
          ...s,
          source: "workspace",
          runtime: "chat-runtime"
        });
      }
    }

    return {
      sessions: merged.slice(0, limit)
    };
  }

  async getSessionMessages(sessionId) {
    if (this.stateStore) {
      try {
        const session = await this.stateStore.readSession(sessionId);
        if (session && Array.isArray(session.messages)) {
          return {
            sessionId,
            messages: session.messages.map((m, idx) => ({
              id: String(idx + 1),
              role: m.role,
              content: m.content,
              timestamp: String(Math.floor(new Date(m.createdAt || 0).getTime() / 1000)),
              toolName: "",
              finishReason: "stop"
            }))
          };
        }
      } catch {}
    }
    return { sessionId, messages: [] };
  }

  async deleteSession(sessionId) {
    if (this.stateStore) {
      try {
        const filePath = path.join(this.stateStore.root, "sessions", `${sessionId}.json`);
        await fs.unlink(filePath).catch(() => {});
      } catch {}
    }
    return { ok: true };
  }

  async renameSession(sessionId, newTitle) {
    if (this.stateStore) {
      try {
        const session = await this.stateStore.readSession(sessionId);
        if (session) {
          session.title = newTitle;
          session.updatedAt = new Date().toISOString();
          await this.stateStore.writeSession(session);
          return { ok: true };
        }
      } catch {}
    }
    return { ok: false, error: "Session not found." };
  }

  async exportSession(sessionId) {
    if (this.stateStore) {
      try {
        const session = await this.stateStore.readSession(sessionId);
        if (session) {
          const lines = [
            `# Session: ${session.title || sessionId}`,
            `Model: ${session.model || "unknown"}`,
            `Updated: ${session.updatedAt}`,
            ""
          ];
          for (const m of session.messages || []) {
            lines.push(`## ${m.role.toUpperCase()}`);
            lines.push(m.content || "");
            lines.push("");
          }
          return { ok: true, markdown: lines.join("\n") };
        }
      } catch {}
    }
    return { ok: false, error: "Session not found." };
  }

  async pruneSessions() {
    if (this.stateStore) {
      try {
        const sessions = await this.stateStore.listWorkspaceSessions();
        let count = 0;
        for (const s of sessions) {
          const session = await this.stateStore.readSession(s.id);
          if (!session || !session.messages || session.messages.length === 0) {
            await this.deleteSession(s.id);
            count++;
          }
        }
        return { ok: true, pruned: count };
      } catch {}
    }
    return { ok: false, pruned: 0 };
  }

  async appendSessionMessage(sessionId, message) {
    if (this.stateStore) {
      try {
        const session = await this.stateStore.readSession(sessionId);
        if (session) {
          session.messages = session.messages || [];
          session.messages.push({
            role: message.role,
            content: message.content,
            createdAt: new Date().toISOString(),
            ...definedFields({
              taskId: message.taskId,
              source: message.source,
              toolName: message.toolName,
              finishReason: message.finishReason
            })
          });
          session.updatedAt = new Date().toISOString();
          if (message.content) {
            session.preview = message.content.slice(0, 60);
          }

          session.summary = buildSessionSummary(session);

          await this.stateStore.writeSession(session);

          // Update Search Index
          try {
            const { indexSession } = await import("./runtime/conversation-index.mjs");
            await indexSession(this.stateStore.workspaceRoot, session);
          } catch {}
          try {
            const { updateMemoryFromSession } = await import("./runtime/memory-retrieval.mjs");
            await updateMemoryFromSession(this.stateStore.workspaceRoot, session);
          } catch {}
        }
      } catch {}
    }
  }

  promptHistory(session, options = {}) {
    if (!session || !Array.isArray(session.messages)) return [];
    const limit = clampNumber(options.recentLimit, 2, 30, 12);
    return session.messages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .slice(-limit)
      .map((message) => ({
        role: message.role,
        content: message.content
      }));
  }
}

function definedFields(value) {
  return Object.fromEntries(
    Object.entries(value || {}).filter(([, item]) => item !== undefined && item !== null && item !== "")
  );
}

export function buildSessionSummary(session = {}) {
  const messages = Array.isArray(session.messages) ? session.messages : [];
  const visibleMessages = messages.filter((message) => message.role === "user" || message.role === "assistant");
  const coveredMessageIds = visibleMessages.map((message, index) => String(message.id || index + 1));
  const combined = visibleMessages
    .map((message) => `${message.role}: ${message.content || ""}`)
    .join("\n")
    .slice(0, 8000);
  const topics = extractTopics(combined);
  const entities = extractEntities(combined);
  const decisions = extractSentences(combined, /(결정|하기로|방향|목표|원칙|사용하지 않는다|사용한다|decided|decision|will use|will not)/i, 8);
  const preferences = extractSentences(combined, /(선호|원해|원한다|좋아|싫어|prefer|want|like|dislike)/i, 8);
  const content = summarizeContent(combined, { topics, decisions, preferences });
  return {
    content,
    topics,
    entities,
    decisions,
    preferences,
    sourceMessageIds: coveredMessageIds,
    coveredMessageIds,
    lastSummarizedMessageId: coveredMessageIds.at(-1) || null,
    recentMessageIds: coveredMessageIds.slice(-12),
    updatedAt: new Date().toISOString()
  };
}

function summarizeContent(text, { topics, decisions, preferences }) {
  const parts = [];
  if (topics.length) parts.push(`주제: ${topics.slice(0, 6).join(", ")}`);
  if (decisions.length) parts.push(`결정: ${decisions.slice(0, 3).join(" / ")}`);
  if (preferences.length) parts.push(`선호: ${preferences.slice(0, 2).join(" / ")}`);
  if (!parts.length) {
    const compact = text.replace(/\s+/g, " ").trim();
    return compact ? `대화 요약: ${compact.slice(0, 500)}` : "";
  }
  return parts.join("\n");
}

function extractTopics(text) {
  const topics = [];
  const lower = String(text || "").toLowerCase();
  const pairs = [
    ["ai workspace", "AI Workspace"],
    ["hermes", "Hermes"],
    ["codex", "Codex-style UX"],
    ["docsearch", "docsearch MCP"],
    ["rag", "RAG"],
    ["pdf", "PDF"],
    ["codeagentruntime", "CodeAgentRuntime"],
    ["tool", "tool mode"],
    ["memory", "memory"],
    ["session", "session"],
    ["음악", "음악"],
    ["옵시디언", "Obsidian"]
  ];
  for (const [needle, topic] of pairs) {
    if (lower.includes(needle)) topics.push(topic);
  }
  return Array.from(new Set(topics)).slice(0, 12);
}

function extractEntities(text) {
  const entities = new Set();
  const matches = String(text || "").match(/\b[A-Z][A-Za-z0-9_-]{2,}\b/g) || [];
  for (const match of matches) entities.add(match);
  for (const keyword of ["AI Workspace", "Hermes", "CodeAgentRuntime", "docsearch MCP", "Obsidian"]) {
    if (String(text || "").includes(keyword)) entities.add(keyword);
  }
  return Array.from(entities).slice(0, 20);
}

function extractSentences(text, pattern, limit) {
  return String(text || "")
    .split(/(?:\n|[.!?。]|다\.|요\.|음\.|함\.)+/)
    .map((sentence) => sentence.replace(/^(user|assistant):\s*/i, "").trim())
    .filter((sentence) => sentence && pattern.test(sentence))
    .map((sentence) => sentence.slice(0, 240))
    .slice(0, limit);
}

function clampNumber(value, min, max, fallback) {
  const number = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}
