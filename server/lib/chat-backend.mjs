export class ChatBackend {
  async connect() {}
  async createSession(params) {}
  async resumeSession(sessionId) {}
  async submitPrompt(params) {}
  async respondToApproval(params) {}
  async setAccessMode(sessionId, accessMode) {}
  async setReasoning(sessionId, reasoningEffort) {}
  close() {}
}
