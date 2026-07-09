export class ModelRuntime {
  constructor({ hermesCompat, stateStore }) {
    this.compat = hermesCompat;
    this.stateStore = stateStore;
  }

  async listModels() {
    let configModels = [];
    let activeProviders = [];
    let source = "workspace-config";
    let hermesStatus = "disabled";

    if (this.stateStore) {
      try {
        const config = await this.stateStore.readConfig();
        const providers = config.providers || {};
        activeProviders = Object.entries(providers).map(([id, p]) => ({
          id,
          type: p.type || "openai-compatible",
          baseUrl: p.baseUrl || "",
          status: "unknown"
        }));

        for (const prov of activeProviders) {
          try {
            const res = await fetch(`${prov.baseUrl.replace(/\/$/, "")}/models`, {
              signal: AbortSignal.timeout(3000)
            });
            if (res.ok) {
              prov.status = "reachable";
              const data = await res.json();
              const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
              for (const m of list) {
                configModels.push({
                  id: m.id || m.name,
                  name: m.name || m.id,
                  provider: prov.id,
                  source: "workspace-provider-api",
                  isActive: config.model?.default === (m.id || m.name)
                });
              }
            } else {
              prov.status = "error";
            }
          } catch {
            prov.status = "unreachable";
          }
        }

        if (configModels.length === 0 && config?.model?.default) {
          configModels.push({
            id: config.model.default,
            name: config.model.default,
            provider: config.model.provider || "unknown",
            source: "workspace-config",
            isActive: true
          });
        }
      } catch (e) {
        // Ignored if config is missing or cannot be read
      }
    }

    let compatModels = [];
    if (this.compat) {
      try {
        const result = await this.compat.fetchHermesJson("/api/model/options");
        hermesStatus = "enabled";
        source = "workspace-config+hermes-compat";
        if (Array.isArray(result?.models)) {
          compatModels = result.models;
        } else if (Array.isArray(result)) {
          compatModels = result;
        }
      } catch (err) {
        hermesStatus = "error";
      }
    }

    const seen = new Set();
    const mergedModels = [];

    for (const m of configModels) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        mergedModels.push(m);
      }
    }

    for (const m of compatModels) {
      const id = m.id || m.name;
      if (id && !seen.has(id)) {
        seen.add(id);
        mergedModels.push({
          id,
          name: m.name || id,
          provider: m.provider || "hermes",
          source: m.source || "hermes-compat",
          isActive: m.isActive || false
        });
      }
    }

    return {
      runtime: "model-runtime",
      source,
      compat: {
        hermes: hermesStatus
      },
      providers: activeProviders,
      models: mergedModels
    };
  }
}
