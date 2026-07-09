export class ModelRuntime {
  constructor({ hermesCompat } = {}) {
    this.compat = hermesCompat;
  }

  async listModels() {
    let source = "hermes-core";
    let hermesStatus = "disabled";

    let compatModels = [];
    if (this.compat) {
      try {
        const result = await this.compat.fetchHermesJson("/api/model/options");
        hermesStatus = "enabled";
        source = "hermes-compat";
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
      providers: [],
      models: mergedModels
    };
  }
}
