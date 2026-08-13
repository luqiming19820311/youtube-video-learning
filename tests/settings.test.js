const test = require("node:test");
const assert = require("node:assert/strict");

const settings = require("../settings.js");

test("DeepSeek defaults use V4 Flash", () => {
  const normalized = settings.normalize({
    provider: "unexpected",
    aiApiKey: "  example-key  ",
    aiBaseUrl: "https://api.example.com/v1",
    aiModel: "example-model",
    supadataApiKey: "  example-supadata  ",
  });

  assert.equal(normalized.provider, "deepseek");
  assert.equal(normalized.aiBaseUrl, "https://api.deepseek.com");
  assert.equal(normalized.aiModel, "deepseek-v4-flash");
  assert.equal(normalized.aiApiKey, "example-key");
  assert.equal(normalized.supadataApiKey, "example-supadata");
  assert.equal(
    settings.chatCompletionsUrl(),
    "https://api.deepseek.com/chat/completions",
  );
});

test("legacy custom migration clears only the AI key and is idempotent", () => {
  const legacy = {
    provider: "custom",
    aiApiKey: "custom-secret",
    aiBaseUrl: "https://api.example.com/v1",
    aiModel: "example-model",
    supadataApiKey: " supadata-secret ",
  };
  const first = settings.migrateLegacyCustom(legacy);

  assert.equal(first.migrated, true);
  assert.equal(first.settings.provider, "deepseek");
  assert.equal(first.settings.aiBaseUrl, settings.DEFAULTS.aiBaseUrl);
  assert.equal(first.settings.aiModel, settings.DEFAULTS.aiModel);
  assert.equal(first.settings.aiApiKey, "");
  assert.equal(first.settings.supadataApiKey, "supadata-secret");

  const second = settings.migrateLegacyCustom(first.settings);
  assert.equal(second.migrated, false);
  assert.deepEqual(second.settings, first.settings);

  const configuredDeepSeek = settings.normalize({
    ...first.settings,
    aiApiKey: "new-deepseek-key",
  });
  assert.equal(configuredDeepSeek.aiApiKey, "new-deepseek-key");
});

test("Supadata receives a canonical YouTube URL", () => {
  assert.equal(
    settings.canonicalYouTubeUrl("ydTeb_I0b94"),
    "https://www.youtube.com/watch?v=ydTeb_I0b94",
  );
  assert.throws(
    () => settings.canonicalYouTubeUrl('"><script>'),
    /Invalid YouTube video ID/,
  );
});

test("normalizes multi-provider settings and migrates the legacy DeepSeek fields", () => {
  const migrated = settings.migrateLegacyCustom({
    aiApiKey: " old-key ",
    aiModel: "deepseek-v4-pro",
    supadataApiKey: " supadata-key ",
  });

  assert.equal(migrated.settings.activeProvider, "deepseek");
  assert.equal(migrated.settings.activeModel, "deepseek-v4-pro");
  assert.equal(migrated.settings.providers.deepseek.apiKey, "old-key");
  assert.equal(migrated.settings.supadataApiKey, "supadata-key");

  const normalized = settings.normalize({
    activeProvider: "zhipu",
    activeModel: "glm-4.5",
    providers: {
      zhipu: {
        apiKey: " zhipu-key ",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4/",
        models: [{ id: "glm-4.5", name: "GLM-4.5" }],
        activeModel: "glm-4.5",
      },
    },
    supadataApiKey: "supadata",
  });

  assert.equal(normalized.activeProvider, "zhipu");
  assert.equal(normalized.activeModel, "glm-4.5");
  assert.equal(normalized.providers.zhipu.apiKey, "zhipu-key");
  assert.equal(normalized.providers.deepseek.apiKey, "");
});
