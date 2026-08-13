/** Shared, non-secret settings normalization for the extension. */
(() => {
  const providerApi = globalThis.YTD_AI_PROVIDERS || (
    typeof require === "function" ? require("./ai-providers.js") : null
  );
  const STORAGE_KEY = "ytd_settings";
  const DEFAULTS = Object.freeze({
    provider: "deepseek",
    aiApiKey: "",
    aiBaseUrl: "https://api.deepseek.com",
    aiModel: "deepseek-v4-flash",
    activeProvider: "deepseek",
    activeModel: "deepseek-v4-flash",
    supadataApiKey: "",
  });

  function isLegacyCustom(input) {
    return !!input && input.provider === "custom";
  }

  function emptyProviderConfig(id) {
    const provider = providerApi.getProvider(id);
    return providerApi.normalizeProviderConfig(id, {
      baseUrl: provider.defaultBaseUrl,
      models: provider.defaultModels,
      activeModel: provider.defaultModels[0].id,
    });
  }

  function normalize(input = {}) {
    const rawProviders = input.providers && typeof input.providers === "object"
      ? input.providers
      : {};
    const providers = {};
    for (const provider of providerApi.listProviders()) {
      const legacyDeepSeek = provider.id === "deepseek"
        ? {
            apiKey: input.aiApiKey,
            activeModel: input.aiModel,
          }
        : {};
      const rawConfig = rawProviders[provider.id] || {};
      const mergedConfig = { ...legacyDeepSeek, ...rawConfig };
      if (provider.id === "deepseek" && !String(rawConfig.apiKey || "").trim()) {
        mergedConfig.apiKey = legacyDeepSeek.apiKey;
      }
      providers[provider.id] = providerApi.normalizeProviderConfig(
        provider.id,
        mergedConfig,
      );
    }

    const requestedProvider = typeof input.activeProvider === "string"
      ? input.activeProvider
      : typeof input.provider === "string" && input.provider !== "custom"
        ? input.provider
        : DEFAULTS.activeProvider;
    const activeProvider = providerApi.getProvider(requestedProvider).id;
    const activeModel = providers[activeProvider].activeModel;
    const deepseek = providers.deepseek;
    return {
      STORAGE_KEY,
      provider: activeProvider,
      aiApiKey: deepseek.apiKey,
      aiBaseUrl: deepseek.baseUrl,
      aiModel: deepseek.activeModel,
      activeProvider,
      activeModel,
      providers,
      supadataApiKey: typeof input.supadataApiKey === "string"
        ? input.supadataApiKey.trim()
        : "",
    };
  }

  function migrateLegacyCustom(input = {}) {
    if (isLegacyCustom(input)) {
      return {
        settings: normalize({ ...input, aiApiKey: "", provider: "deepseek" }),
        migrated: true,
      };
    }
    const hasNewShape = input && input.providers && input.activeProvider;
    return {
      settings: normalize(input),
      migrated: !hasNewShape && !!input && ("aiApiKey" in input || "aiModel" in input),
    };
  }

  function chatCompletionsUrl() {
    return `${DEFAULTS.aiBaseUrl}/chat/completions`;
  }

  function canonicalYouTubeUrl(videoId) {
    const normalized = String(videoId || "").trim();
    if (!/^[A-Za-z0-9_-]{6,20}$/.test(normalized)) {
      throw new Error("Invalid YouTube video ID.");
    }
    return `https://www.youtube.com/watch?v=${normalized}`;
  }

  const api = {
    STORAGE_KEY,
    DEFAULTS,
    isLegacyCustom,
    normalize,
    migrateLegacyCustom,
    chatCompletionsUrl,
    canonicalYouTubeUrl,
    emptyProviderConfig,
  };
  globalThis.YTD_SETTINGS = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
