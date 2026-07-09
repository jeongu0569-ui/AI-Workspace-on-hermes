import { ChatBackend } from "./chat-backend.mjs";

export class WorkspaceChatBackend extends ChatBackend {
  constructor({ stateStore, authRuntime, providerRuntime }) {
    super();
    this.stateStore = stateStore;
    this.authRuntime = authRuntime;
    this.providerRuntime = providerRuntime;
  }

  async connect() {
    return;
  }

  async createSession(params) {
    const sessionId = `ws-sess-${Math.random().toString(36).substring(2, 9)}`;
    return {
      sessionId,
      runtimeSessionId: sessionId
    };
  }

  async resumeSession(sessionId) {
    return sessionId;
  }

  async submitPrompt(params) {
    const config = await this.stateStore.readConfig();
    const providerId = params.provider || config.model?.provider || "openai";
    const model = params.model || config.model?.default || "gpt-4";

    const providers = config.providers || {};
    const provider = providers[providerId] || {};
    const baseUrl = provider.baseUrl || "https://api.openai.com/v1";
    const apiKey = await this.authRuntime.getApiKeyForProvider(providerId) || "";

    const headers = {
      "Content-Type": "application/json"
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const messages = params.messages || [];
    if (params.prompt) {
      messages.push({ role: "user", content: params.prompt });
    }

    const reqBody = {
      model,
      messages,
      temperature: params.temperature || 0.2
    };

    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(reqBody)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw Object.assign(new Error(`LLM provider error: ${res.status} ${errText}`), { status: res.status });
    }

    const data = await res.json();
    const reply = data?.choices?.[0]?.message?.content || "";

    return {
      ok: true,
      sessionId: params.sessionId,
      reply,
      messages: [
        ...messages,
        { role: "assistant", content: reply }
      ]
    };
  }

  close() {
    return;
  }
}
