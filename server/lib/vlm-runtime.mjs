const DEFAULT_VLM_MAX_TOKENS = 800;

export const VLM_DETERMINISTIC_POLICY = Object.freeze({
  temperature: 0,
  reasoning: "off",
  stream: false
});

export function normalizeVlmMaxTokens(value, fallback = DEFAULT_VLM_MAX_TOKENS) {
  const number = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(4000, Math.max(64, number));
}

export function buildOpenAICompatibleVlmBody({
  model,
  prompt,
  imageUrl,
  maxTokens = DEFAULT_VLM_MAX_TOKENS
} = {}) {
  if (!model) throw new Error("Missing VLM model.");
  if (!prompt) throw new Error("Missing VLM prompt.");
  if (!imageUrl) throw new Error("Missing VLM image URL.");
  return {
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: String(prompt) },
          { type: "image_url", image_url: { url: String(imageUrl) } }
        ]
      }
    ],
    temperature: VLM_DETERMINISTIC_POLICY.temperature,
    max_tokens: normalizeVlmMaxTokens(maxTokens),
    stream: false
  };
}

export async function callOpenAICompatibleVlm({
  fetchImpl = globalThis.fetch,
  baseUrl,
  apiKey,
  model,
  prompt,
  imageUrl,
  maxTokens = DEFAULT_VLM_MAX_TOKENS
} = {}) {
  if (!fetchImpl) throw new Error("fetch() is required for VLM calls.");
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const response = await fetchImpl(`${normalizedBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
    },
    body: JSON.stringify(buildOpenAICompatibleVlmBody({
      model,
      prompt,
      imageUrl,
      maxTokens
    }))
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`VLM request failed: ${response.status} ${text.slice(0, 500)}`);
  }
  const data = await response.json();
  return String(data?.choices?.[0]?.message?.content || "").trim();
}

export function buildOllamaNativeVlmChatBody({
  model,
  prompt,
  imageBase64,
  maxTokens = DEFAULT_VLM_MAX_TOKENS
} = {}) {
  if (!model) throw new Error("Missing VLM model.");
  if (!prompt) throw new Error("Missing VLM prompt.");
  if (!imageBase64) throw new Error("Missing VLM image data.");
  return {
    model,
    messages: [
      {
        role: "user",
        content: String(prompt),
        images: [String(imageBase64)]
      }
    ],
    stream: false,
    think: false,
    options: {
      temperature: VLM_DETERMINISTIC_POLICY.temperature,
      num_predict: normalizeVlmMaxTokens(maxTokens)
    }
  };
}

export async function callOllamaNativeVlm({
  fetchImpl = globalThis.fetch,
  baseUrl,
  model,
  prompt,
  imageBase64,
  maxTokens = DEFAULT_VLM_MAX_TOKENS
} = {}) {
  if (!fetchImpl) throw new Error("fetch() is required for VLM calls.");
  const host = normalizeBaseUrl(baseUrl || "http://127.0.0.1:11434")
    .replace(/\/v1\/?$/, "");
  const response = await fetchImpl(`${host}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildOllamaNativeVlmChatBody({
      model,
      prompt,
      imageBase64,
      maxTokens
    }))
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Ollama VLM request failed: ${response.status} ${text.slice(0, 500)}`);
  }
  const data = await response.json();
  return String(data?.message?.content || "").trim();
}

export function buildVlmOcrPrompt({ language = "auto", output = "markdown" } = {}) {
  const languageLine = language && language !== "auto"
    ? `The expected document language is ${language}.`
    : "Detect the document language automatically.";
  return [
    "Read the image exactly.",
    languageLine,
    "Extract visible text, table structure, and important layout cues.",
    "Do not invent missing text.",
    "If text is unreadable, mark that part as [unreadable].",
    output === "json"
      ? "Return compact JSON with text blocks."
      : "Return concise Markdown preserving headings, lists, and tables when visible."
  ].join("\n");
}

export function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").trim().replace(/\/+$/, "");
}
