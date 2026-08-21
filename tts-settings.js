/** Voice/TTS settings normalization. Secrets are stored only in Chrome storage. */
(() => {
  const STANDARD_BASE_URL = "https://api.xiaomimimo.com/v1";
  const TOKEN_PLAN_BASE_URL = "https://token-plan-cn.xiaomimimo.com/v1";
  const MIMO_MODEL = "mimo-v2.5-tts";
  const MIMO_VOICES = Object.freeze(["冰糖", "茉莉", "苏打", "白桦"]);
  // User-facing narration pace (applies to BOTH system and MiMo voices);
  // defaults to "a bit fast" so the dub keeps up with the speaker.
  const SPEED_MULTIPLIERS = Object.freeze([0.9, 1, 1.15, 1.3]);
  const DEFAULT_SPEED_MULTIPLIER = 1.15;

  function normalizeSpeedMultiplier(value) {
    const parsed = Number(value);
    return SPEED_MULTIPLIERS.includes(parsed) ? parsed : DEFAULT_SPEED_MULTIPLIER;
  }

  function clampInteger(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
  }

  function defaultBaseUrl(accessMode) {
    return accessMode === "tokenPlan" ? TOKEN_PLAN_BASE_URL : STANDARD_BASE_URL;
  }

  function normalizeBaseUrl(value, accessMode) {
    const fallback = defaultBaseUrl(accessMode);
    const raw = String(value || fallback).trim().replace(/\/+$/, "");
    try {
      const url = new URL(raw);
      if (!/^https?:$/.test(url.protocol)) return fallback;
      return url.toString().replace(/\/+$/, "");
    } catch (_error) {
      return fallback;
    }
  }

  function normalize(input = {}) {
    const accessMode = input.mimo?.accessMode === "tokenPlan"
      ? "tokenPlan"
      : "standard";
    const voice = MIMO_VOICES.includes(input.mimo?.voice)
      ? input.mimo.voice
      : MIMO_VOICES[0];
    const verifiedAt = Number(input.mimo?.verifiedAt);
    return {
      activeProvider: input.activeProvider === "mimo" ? "mimo" : "system",
      speedMultiplier: normalizeSpeedMultiplier(input.speedMultiplier),
      system: {
        voiceURI: typeof input.system?.voiceURI === "string"
          ? input.system.voiceURI.trim().slice(0, 300)
          : "",
      },
      mimo: {
        accessMode,
        baseUrl: normalizeBaseUrl(input.mimo?.baseUrl, accessMode),
        apiKey: typeof input.mimo?.apiKey === "string"
          ? input.mimo.apiKey.trim()
          : "",
        model: input.mimo?.model === MIMO_MODEL ? input.mimo.model : MIMO_MODEL,
        voice,
        timeoutMs: clampInteger(input.mimo?.timeoutMs, 15_000, 5_000, 60_000),
        retries: clampInteger(input.mimo?.retries, 1, 0, 1),
        verifiedAt: Number.isFinite(verifiedAt) && verifiedAt > 0
          ? Math.round(verifiedAt)
          : 0,
      },
    };
  }

  function getAuthHeaders(config) {
    const normalized = normalize({ activeProvider: "mimo", mimo: config }).mimo;
    if (!normalized.apiKey) return {};
    return normalized.accessMode === "tokenPlan"
      ? { Authorization: `Bearer ${normalized.apiKey}` }
      : { "api-key": normalized.apiKey };
  }

  const api = {
    STANDARD_BASE_URL,
    TOKEN_PLAN_BASE_URL,
    MIMO_MODEL,
    MIMO_VOICES,
    SPEED_MULTIPLIERS,
    DEFAULT_SPEED_MULTIPLIER,
    defaultBaseUrl,
    getAuthHeaders,
    normalize,
    normalizeBaseUrl,
    normalizeSpeedMultiplier,
  };
  globalThis.YTD_TTS_SETTINGS = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
