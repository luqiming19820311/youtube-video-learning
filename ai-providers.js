/** Provider registry and protocol helpers. No secrets are stored here. */
(() => {
  const fallback = (models) => models.map((id) => ({ id, name: id }));
  const registry = [
    {
      id: "local",
      name: "本地 · Fully Local",
      protocol: "openai-compatible",
      defaultBaseUrl: "http://localhost:11434/v1",
      modelsEndpoint: "/models",
      defaultModels: fallback(["llama3.2", "qwen2.5", "gemma3"]),
    },
    {
      id: "groq",
      name: "Groq",
      protocol: "openai-compatible",
      defaultBaseUrl: "https://api.groq.com/openai/v1",
      modelsEndpoint: "/models",
      defaultModels: fallback(["llama-3.3-70b-versatile", "openai/gpt-oss-120b"]),
    },
    {
      id: "deepseek",
      name: "DeepSeek",
      protocol: "openai-compatible",
      defaultBaseUrl: "https://api.deepseek.com",
      modelsEndpoint: "/models",
      defaultModels: fallback(["deepseek-v4-flash", "deepseek-v4-pro"]),
    },
    {
      id: "custom",
      name: "自定义 / Custom",
      protocol: "openai-compatible",
      defaultBaseUrl: "https://api.openai.com/v1",
      modelsEndpoint: "/models",
      defaultModels: fallback(["gpt-4o-mini"]),
    },
    {
      id: "qwen",
      name: "通义千问 / Qwen",
      protocol: "openai-compatible",
      defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      modelsEndpoint: "/models",
      defaultModels: fallback(["qwen-plus", "qwen-turbo", "qwen-max"]),
    },
    {
      id: "volcengine",
      name: "火山引擎 / Volcengine",
      protocol: "openai-compatible",
      defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      modelsEndpoint: "/models",
      defaultModels: fallback(["doubao-1-5-pro-32k-250115", "doubao-1-5-lite-32k-250115"]),
    },
    {
      id: "gemini",
      name: "Gemini (Google)",
      protocol: "gemini",
      defaultBaseUrl: "https://generativelanguage.googleapis.com",
      modelsEndpoint: "/v1beta/models",
      defaultModels: fallback(["gemini-2.5-flash", "gemini-2.5-pro"]),
    },
    {
      id: "zhipu",
      name: "智谱 AI / Zhipu GLM",
      protocol: "openai-compatible",
      defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
      modelsEndpoint: "/models",
      defaultModels: fallback(["glm-4.5", "glm-4.5-air", "glm-4-flash"]),
    },
    {
      id: "mimo",
      name: "小米 MiMo",
      protocol: "openai-compatible",
      defaultBaseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
      modelsEndpoint: "/models",
      defaultModels: fallback(["mimo-v2.5-pro", "mimo-v2.5"]),
      retiredModelIds: ["mimo-v2-flash", "mimo-v2-pro"],
    },
  ];
  const byId = new Map(registry.map((provider) => [provider.id, provider]));

  function getProvider(id) {
    return byId.get(id) || byId.get("deepseek");
  }

  function listProviders() {
    return registry.map((provider) => ({
      ...provider,
      defaultModels: provider.defaultModels.map((model) => ({ ...model })),
    }));
  }

  function normalizeBaseUrl(value, fallbackUrl) {
    const raw = String(value || fallbackUrl || "").trim().replace(/\/+$/, "");
    try {
      const url = new URL(raw);
      if (!/^https?:$/.test(url.protocol)) throw new Error("Unsupported protocol");
      return url.toString().replace(/\/+$/, "");
    } catch (_error) {
      return fallbackUrl;
    }
  }

  function normalizeModel(model) {
    const id = typeof model?.id === "string" ? model.id.trim() : "";
    if (!/^[A-Za-z0-9._:/-]{1,160}$/.test(id)) return null;
    const name = typeof model.name === "string" && model.name.trim()
      ? model.name.trim().slice(0, 200)
      : id;
    return { id, name };
  }

  function normalizeModels(models, defaults, retiredModelIds = []) {
    const output = [];
    const seen = new Set();
    const retired = new Set(retiredModelIds);
    for (const candidate of Array.isArray(models) ? models : []) {
      const model = normalizeModel(candidate);
      if (model && !retired.has(model.id) && !seen.has(model.id)) {
        seen.add(model.id);
        output.push(model);
      }
    }
    return output.length ? output : defaults.map((model) => ({ ...model }));
  }

  function normalizeProviderConfig(id, input = {}) {
    const provider = getProvider(id);
    const models = normalizeModels(
      input.models,
      provider.defaultModels,
      provider.retiredModelIds,
    );
    const activeModel = normalizeModel({ id: input.activeModel })?.id;
    return {
      apiKey: typeof input.apiKey === "string" ? input.apiKey.trim() : "",
      baseUrl: normalizeBaseUrl(input.baseUrl, provider.defaultBaseUrl),
      models,
      activeModel: models.some((model) => model.id === activeModel)
        ? activeModel
        : models[0].id,
      modelsFetchedAt: Number.isFinite(input.modelsFetchedAt)
        ? input.modelsFetchedAt
        : 0,
    };
  }

  function parseModelResponse(protocol, payload) {
    const source = protocol === "gemini" ? payload?.models : payload?.data;
    if (!Array.isArray(source)) return [];
    return normalizeModels(
      source.map((item) => ({
        id: protocol === "gemini"
          ? String(item?.name || "").replace(/^models\//, "")
          : item?.id,
        name: item?.displayName || item?.name || item?.id,
      })),
      [],
    );
  }

  function withModelFallback(id, models) {
    const provider = getProvider(id);
    const normalized = normalizeModels(models, [], provider.retiredModelIds);
    return normalized.length
      ? { source: "remote", models: normalized }
      : { source: "fallback", models: provider.defaultModels.map((model) => ({ ...model })) };
  }

  function buildChatRequest(provider, config, model, messages, responseFormat) {
    const baseUrl = normalizeBaseUrl(config.baseUrl, getProvider(provider.id).defaultBaseUrl);
    if (provider.protocol === "gemini") {
      const contents = messages.map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: String(message.content || "") }],
      }));
      return {
        url: `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`,
        headers: { "Content-Type": "application/json" },
        body: { contents },
      };
    }
    return {
      url: `${baseUrl}/chat/completions`,
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: {
        model,
        messages,
        ...(responseFormat ? { response_format: responseFormat } : {}),
      },
    };
  }

  function parseChatResponse(provider, payload) {
    if (provider.protocol === "gemini") {
      return payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
    }
    return payload?.choices?.[0]?.message?.content || "";
  }

  const api = {
    listProviders,
    getProvider,
    normalizeBaseUrl,
    normalizeProviderConfig,
    parseModelResponse,
    withModelFallback,
    buildChatRequest,
    parseChatResponse,
  };
  globalThis.YTD_AI_PROVIDERS = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
