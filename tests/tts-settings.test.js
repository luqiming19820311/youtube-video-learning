const test = require("node:test");
const assert = require("node:assert/strict");

const ttsSettings = require("../tts-settings.js");

test("defaults Voice to the local system provider", () => {
  const voice = ttsSettings.normalize();

  assert.equal(voice.activeProvider, "system");
  assert.equal(voice.system.voiceURI, "");
  assert.equal(voice.mimo.accessMode, "standard");
  assert.equal(voice.mimo.baseUrl, "https://api.xiaomimimo.com/v1");
  assert.equal(voice.mimo.model, "mimo-v2.5-tts");
  assert.equal(voice.mimo.voice, "冰糖");
  assert.equal(voice.mimo.timeoutMs, 15_000);
  assert.equal(voice.mimo.retries, 1);
  assert.equal(voice.mimo.verifiedAt, 0);
});

test("normalizes both MiMo access modes and their authentication", () => {
  const tokenPlan = ttsSettings.normalize({
    activeProvider: "mimo",
    mimo: {
      accessMode: "tokenPlan",
      apiKey: "  secret-token  ",
      voice: "苏打",
      verifiedAt: 123,
    },
  });

  assert.equal(tokenPlan.activeProvider, "mimo");
  assert.equal(
    tokenPlan.mimo.baseUrl,
    "https://token-plan-cn.xiaomimimo.com/v1",
  );
  assert.equal(tokenPlan.mimo.apiKey, "secret-token");
  assert.equal(tokenPlan.mimo.voice, "苏打");
  assert.deepEqual(ttsSettings.getAuthHeaders(tokenPlan.mimo), {
    Authorization: "Bearer secret-token",
  });

  assert.deepEqual(
    ttsSettings.getAuthHeaders(
      ttsSettings.normalize({ mimo: { apiKey: "standard-key" } }).mimo,
    ),
    { "api-key": "standard-key" },
  );
});

test("rejects unsupported MiMo models, voices, and unsafe values", () => {
  const voice = ttsSettings.normalize({
    activeProvider: "unexpected",
    system: { voiceURI: "x".repeat(600) },
    mimo: {
      baseUrl: "javascript:alert(1)",
      model: "mimo-v2.5-tts-voiceclone",
      voice: "unknown",
      timeoutMs: 999_999,
      retries: 9,
      verifiedAt: -1,
    },
  });

  assert.equal(voice.activeProvider, "system");
  assert.equal(voice.system.voiceURI.length, 300);
  assert.equal(voice.mimo.baseUrl, "https://api.xiaomimimo.com/v1");
  assert.equal(voice.mimo.model, "mimo-v2.5-tts");
  assert.equal(voice.mimo.voice, "冰糖");
  assert.equal(voice.mimo.timeoutMs, 60_000);
  assert.equal(voice.mimo.retries, 1);
  assert.equal(voice.mimo.verifiedAt, 0);
});
