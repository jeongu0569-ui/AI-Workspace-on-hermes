export class ProviderRuntime {
  constructor({ stateStore }) {
    this.stateStore = stateStore;
  }

  async listProviders() {
    const config = await this.stateStore.readConfig();
    const providers = config.providers || {};
    return Object.entries(providers).map(([id, p]) => ({
      id,
      ...p
    }));
  }

  async addProvider(id, providerData) {
    const config = await this.stateStore.readConfig();
    config.providers = config.providers || {};
    config.providers[id] = {
      type: providerData.type || "openai-compatible",
      baseUrl: providerData.baseUrl || "",
      apiKeyRequired: providerData.apiKeyRequired !== false
    };
    await this.stateStore.writeConfig(config);
    return { id, ...config.providers[id] };
  }

  async updateProvider(id, providerData) {
    const config = await this.stateStore.readConfig();
    config.providers = config.providers || {};
    if (!config.providers[id]) {
      throw Object.assign(new Error(`Provider '${id}' not found.`), { status: 404 });
    }
    config.providers[id] = {
      ...config.providers[id],
      ...providerData
    };
    await this.stateStore.writeConfig(config);
    return { id, ...config.providers[id] };
  }

  async removeProvider(id) {
    const config = await this.stateStore.readConfig();
    config.providers = config.providers || {};
    if (!config.providers[id]) {
      throw Object.assign(new Error(`Provider '${id}' not found.`), { status: 404 });
    }
    delete config.providers[id];
    await this.stateStore.writeConfig(config);
    return { ok: true };
  }
}
