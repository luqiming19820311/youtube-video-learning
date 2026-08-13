const test = require("node:test");
const assert = require("node:assert/strict");

const providers = require("../ai-providers.js");

test("registers all supported AI providers with fallback models", () => {
  const ids = providers.listProviders().map((provider) => provider.id);

  assert.deepEqual(ids, [
    "local",
    "groq",
    "deepseek",
    "custom",
    "qwen",
    "volcengine",
    "gemini",
    "zhipu",
    "mimo",
  ]);

  for (const provider of providers.listProviders()) {
    assert.ok(provider.defaultBaseUrl);
    assert.ok(provider.protocol);
    assert.ok(provider.defaultModels.length > 0);
    assert.ok(provider.modelsEndpoint);
  }

  assert.deepEqual(
    providers.getProvider("mimo").defaultModels.map((model) => model.id),
    ["mimo-v2.5-pro", "mimo-v2.5"],
  );
  assert.equal(
    providers.getProvider("mimo").defaultBaseUrl,
    "https://token-plan-cn.xiaomimimo.com/v1",
  );
});

test("replaces retired MiMo fallback models with the V2.5 lineup", () => {
  const normalized = providers.normalizeProviderConfig("mimo", {
    models: [
      { id: "mimo-v2-flash", name: "mimo-v2-flash" },
      { id: "mimo-v2-pro", name: "mimo-v2-pro" },
    ],
    activeModel: "mimo-v2-flash",
  });

  assert.deepEqual(
    normalized.models.map((model) => model.id),
    ["mimo-v2.5-pro", "mimo-v2.5"],
  );
  assert.equal(normalized.activeModel, "mimo-v2.5-pro");
});

test("normalizes provider configuration without accepting arbitrary models", () => {
  const normalized = providers.normalizeProviderConfig("deepseek", {
    apiKey: "  secret  ",
    baseUrl: "https://api.deepseek.com/",
    models: [
      { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
      { id: "bad id", name: "Invalid" },
    ],
    activeModel: "bad id",
  });

  assert.equal(normalized.apiKey, "secret");
  assert.equal(normalized.baseUrl, "https://api.deepseek.com");
  assert.deepEqual(normalized.models, [
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
  ]);
  assert.equal(normalized.activeModel, "deepseek-v4-pro");
});

test("parses and filters OpenAI-compatible model responses", () => {
  assert.deepEqual(
    providers.parseModelResponse("openai-compatible", {
      data: [
        { id: " model-a " },
        { id: "model-a", name: "Duplicate" },
        { id: "" },
        { id: "x".repeat(300) },
      ],
    }),
    [{ id: "model-a", name: "model-a" }],
  );
});

test("builds provider-specific chat requests", () => {
  const openAi = providers.buildChatRequest(
    { id: "groq", protocol: "openai-compatible" },
    { baseUrl: "https://api.groq.com/openai/v1", apiKey: "key" },
    "llama-3.3-70b-versatile",
    [{ role: "user", content: "hello" }],
  );
  assert.equal(openAi.url, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(openAi.body.model, "llama-3.3-70b-versatile");
  assert.equal(openAi.headers.Authorization, "Bearer key");

  const gemini = providers.buildChatRequest(
    { id: "gemini", protocol: "gemini" },
    { baseUrl: "https://generativelanguage.googleapis.com", apiKey: "key" },
    "gemini-2.5-flash",
    [{ role: "user", content: "hello" }],
  );
  assert.match(gemini.url, /models\/gemini-2\.5-flash:generateContent\?key=key$/);
  assert.deepEqual(gemini.body.contents, [
    { role: "user", parts: [{ text: "hello" }] },
  ]);
});

test("falls back to built-in models when remote models are unavailable", () => {
  const result = providers.withModelFallback("deepseek", null);
  assert.equal(result.source, "fallback");
  assert.deepEqual(result.models, providers.getProvider("deepseek").defaultModels);
});
