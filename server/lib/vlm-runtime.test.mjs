import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOllamaNativeVlmChatBody,
  buildOpenAICompatibleVlmBody,
  buildVlmOcrPrompt,
  normalizeVlmMaxTokens,
  VLM_DETERMINISTIC_POLICY
} from "./vlm-runtime.mjs";

test("VLM deterministic policy disables sampling-oriented behavior", () => {
  assert.equal(VLM_DETERMINISTIC_POLICY.temperature, 0);
  assert.equal(VLM_DETERMINISTIC_POLICY.reasoning, "off");
  assert.equal(VLM_DETERMINISTIC_POLICY.stream, false);
});

test("OpenAI-compatible VLM body uses deterministic OCR defaults", () => {
  const body = buildOpenAICompatibleVlmBody({
    model: "gemma-4-12b-it-mlx",
    prompt: "Read this image.",
    imageUrl: "data:image/png;base64,abc",
    maxTokens: 1200
  });
  assert.equal(body.model, "gemma-4-12b-it-mlx");
  assert.equal(body.temperature, 0);
  assert.equal(body.stream, false);
  assert.equal(body.max_tokens, 1200);
  assert.equal(body.messages[0].content[0].type, "text");
  assert.equal(body.messages[0].content[1].type, "image_url");
});

test("Ollama native VLM body turns thinking off and uses temperature zero", () => {
  const body = buildOllamaNativeVlmChatBody({
    model: "gemma4:12b-mlx",
    prompt: "Read this image.",
    imageBase64: "abc",
    maxTokens: 1200
  });
  assert.equal(body.model, "gemma4:12b-mlx");
  assert.equal(body.stream, false);
  assert.equal(body.think, false);
  assert.equal(body.options.temperature, 0);
  assert.equal(body.options.num_predict, 1200);
});

test("VLM max token normalization keeps bounded OCR output", () => {
  assert.equal(normalizeVlmMaxTokens("bad"), 800);
  assert.equal(normalizeVlmMaxTokens(8), 64);
  assert.equal(normalizeVlmMaxTokens(9000), 4000);
});

test("VLM OCR prompt asks for extraction without hallucination", () => {
  const prompt = buildVlmOcrPrompt({ language: "Korean" });
  assert.match(prompt, /Read the image exactly/);
  assert.match(prompt, /Korean/);
  assert.match(prompt, /Do not invent/);
});

