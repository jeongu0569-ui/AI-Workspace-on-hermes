import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ensureRuntimeConfig,
  envAliases,
  listProviderRegistry,
  listCredentialStatus,
  providerEnvKeys,
  readCredentials,
  readRuntimeConfig,
  runtimeConfigDir,
  setCredentialValue,
  setDefaultModel
} from "./config-store.mjs";

test("provider registry only exposes usable user-facing providers", () => {
  const ids = listProviderRegistry().map((provider) => provider.id);
  assert.deepEqual(ids, ["openai-codex", "ollama-cloud", "ollama-local"]);
});

test("Hermes-compatible custom endpoint config is executable by Codmes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codmes-custom-model-"));
  await ensureRuntimeConfig(root);
  await fs.writeFile(path.join(runtimeConfigDir(root), "config.yaml"), `model:
  default: gemma4:e2b-mlx
  provider: custom
  base_url: http://127.0.0.1:11434/v1
  api_mode: chat_completions
custom_providers:
  - name: Ollama Local
    base_url: http://127.0.0.1:11434/v1
    model: gemma4:e2b-mlx
    api_mode: chat_completions
`);

  const config = await readRuntimeConfig(root);
  const credentials = await readCredentials(root);
  assert.equal(config.defaultModel.baseUrl, "http://127.0.0.1:11434/v1");
  assert.equal(config.defaultModel.apiMode, "chat_completions");
  assert.equal(credentials.providers.custom.values.baseUrl, "http://127.0.0.1:11434/v1");

  await setDefaultModel(root, "custom", "another-model");
  const updated = await fs.readFile(path.join(runtimeConfigDir(root), "config.yaml"), "utf8");
  assert.match(updated, /base_url: http:\/\/127\.0\.0\.1:11434\/v1/);
  assert.match(updated, /api_mode: chat_completions/);
  assert.match(updated, /model: gemma4:e2b-mlx/);
});

test("OAuth providers count token-only credentials as configured", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codmes-oauth-status-"));
  await ensureRuntimeConfig(root);
  await setCredentialValue(root, "openai-codex", "access_token", "token-value");
  const status = await listCredentialStatus(root, {});
  const codex = status.find((item) => item.provider === "openai-codex");
  assert.equal(codex.configured, true);
});

test("CODMES env aliases are preferred while AIW env aliases remain compatible", async () => {
  assert.deepEqual(envAliases("AIW_OPENAI_API_KEY"), ["CODMES_OPENAI_API_KEY", "AIW_OPENAI_API_KEY"]);
  assert.deepEqual(envAliases("CODMES_CUSTOM_API_KEY"), ["CODMES_CUSTOM_API_KEY", "AIW_CUSTOM_API_KEY"]);

  const keys = providerEnvKeys({ env: ["AIW_OPENAI_API_KEY", "OPENAI_API_KEY"] });
  assert.deepEqual(keys, ["CODMES_OPENAI_API_KEY", "AIW_OPENAI_API_KEY", "OPENAI_API_KEY"]);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codmes-env-status-"));
  await ensureRuntimeConfig(root);
  const status = await listCredentialStatus(root, {
    CODMES_OPENAI_API_KEY: "new-key",
    AIW_OPENAI_API_KEY: "legacy-key"
  });
  const openai = status.find((item) => item.provider === "openai-api");
  assert.equal(openai.configured, true);
  assert.ok(openai.envKeys.includes("CODMES_OPENAI_API_KEY"));
});
