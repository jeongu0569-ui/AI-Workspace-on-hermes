export class AuthRuntime {
  constructor({ stateStore }) {
    this.stateStore = stateStore;
  }

  async listCredentials() {
    const config = await this.stateStore.readConfig();
    const credentials = config.credentials || [];
    return credentials.map(c => ({
      id: c.id,
      provider: c.provider,
      label: c.label || "",
      apiKey: c.apiKey ? this.maskKey(c.apiKey) : ""
    }));
  }

  async addCredential(credentialData) {
    const config = await this.stateStore.readConfig();
    config.credentials = config.credentials || [];
    const id = credentialData.id || `cred-${Math.random().toString(36).substring(2, 9)}`;
    const newCred = {
      id,
      provider: credentialData.provider,
      apiKey: credentialData.apiKey || "",
      label: credentialData.label || ""
    };
    config.credentials.push(newCred);
    await this.stateStore.writeConfig(config);
    return {
      id,
      provider: newCred.provider,
      label: newCred.label,
      apiKey: this.maskKey(newCred.apiKey)
    };
  }

  async removeCredential(id) {
    const config = await this.stateStore.readConfig();
    config.credentials = config.credentials || [];
    const index = config.credentials.findIndex(c => c.id === id);
    if (index === -1) {
      throw Object.assign(new Error(`Credential '${id}' not found.`), { status: 404 });
    }
    config.credentials.splice(index, 1);
    await this.stateStore.writeConfig(config);
    return { ok: true };
  }

  async getApiKeyForProvider(provider) {
    const config = await this.stateStore.readConfig();
    const credentials = config.credentials || [];
    const match = credentials.find(c => c.provider === provider);
    return match ? match.apiKey : null;
  }

  maskKey(key) {
    if (!key) return "";
    if (key.length <= 8) return "*".repeat(key.length);
    return `${key.slice(0, 4)}...${key.slice(-4)}`;
  }
}
