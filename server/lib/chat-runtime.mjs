import { WorkspaceChatBackend } from "./workspace-chat-backend.mjs";

import { ChatBackend } from "./chat-backend.mjs";

export class HermesCompatChatBackend extends ChatBackend {
  constructor(hermesCompat) {
    super();
    this.compat = hermesCompat;
  }

  async connect() {
    await this.compat.connect();
  }

  async createSession(params) {
    return await this.compat.createSession(params);
  }

  async resumeSession(sessionId) {
    return await this.compat.resumeSession(sessionId);
  }

  async submitPrompt(params) {
    return await this.compat.submitPrompt(params);
  }

  async respondToApproval(params) {
    return await this.compat.respondToApproval(params);
  }

  async setAccessMode(sessionId, accessMode) {
    await this.compat.setAccessMode(sessionId, accessMode);
  }

  async setReasoning(sessionId, reasoningEffort) {
    await this.compat.setReasoning(sessionId, reasoningEffort);
  }

  close() {
    this.compat.close();
  }
}

export class ChatRuntime {
  constructor({ hermesCompat, stateStore, authRuntime, providerRuntime }) {
    if (hermesCompat) {
      this.backend = new HermesCompatChatBackend(hermesCompat);
    } else if (stateStore && authRuntime && providerRuntime) {
      this.backend = new WorkspaceChatBackend({ stateStore, authRuntime, providerRuntime });
    } else {
      this.backend = null;
    }
  }

  isAvailable() {
    return this.backend !== null;
  }

  async connect() {
    if (!this.backend) {
      throw Object.assign(
        new Error("Chat runtime is unavailable because no local model backend or Hermes compatibility backend is configured."),
        { status: 503 }
      );
    }
    await this.backend.connect();
  }

  async createSession(params) {
    if (!this.backend) {
      throw Object.assign(
        new Error("Chat runtime is unavailable because no local model backend or Hermes compatibility backend is configured."),
        { status: 503 }
      );
    }
    return await this.backend.createSession(params);
  }

  async resumeSession(sessionId) {
    if (!this.backend) {
      throw Object.assign(
        new Error("Chat runtime is unavailable because no local model backend or Hermes compatibility backend is configured."),
        { status: 503 }
      );
    }
    return await this.backend.resumeSession(sessionId);
  }

  async submitPrompt(params) {
    if (!this.backend) {
      throw Object.assign(
        new Error("Chat runtime is unavailable because no local model backend or Hermes compatibility backend is configured."),
        { status: 503 }
      );
    }
    return await this.backend.submitPrompt(params);
  }

  async respondToApproval(params) {
    if (!this.backend) {
      throw Object.assign(
        new Error("Chat runtime is unavailable because no local model backend or Hermes compatibility backend is configured."),
        { status: 503 }
      );
    }
    return await this.backend.respondToApproval(params);
  }

  async setAccessMode(sessionId, accessMode) {
    if (!this.backend) return;
    await this.backend.setAccessMode(sessionId, accessMode);
  }

  async setReasoning(sessionId, reasoningEffort) {
    if (!this.backend) return;
    await this.backend.setReasoning(sessionId, reasoningEffort);
  }

  close() {
    if (this.backend) this.backend.close();
  }
}
