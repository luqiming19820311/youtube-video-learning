const test = require("node:test");
const assert = require("node:assert/strict");

const ttsOptions = require("../tts-options.js");
const ttsSettings = require("../tts-settings.js");

class FakeElement {
  constructor(value = "") {
    this.value = value;
    this.hidden = false;
    this.disabled = false;
    this.textContent = "";
    this.handlers = new Map();
  }
  addEventListener(type, listener) { this.handlers.set(type, listener); }
  click() { this.handlers.get("click")?.(); }
  setAttribute() {}
  replaceChildren() {}
  append() {}
  querySelectorAll() { return []; }
}

function createTtsHarness() {
  const elements = {
    ttsProviderList: new FakeElement(),
    voiceSpeedPreference: new FakeElement("1.15"),
    systemTtsPanel: new FakeElement(),
    mimoTtsPanel: new FakeElement(),
    systemVoice: new FakeElement("zh"),
    testSystemVoiceBtn: new FakeElement(),
    mimoAccessMode: new FakeElement("standard"),
    mimoTtsBaseUrl: new FakeElement("https://api.xiaomimimo.com/v1"),
    mimoTtsApiKey: new FakeElement("key"),
    mimoTtsModel: new FakeElement("mimo-v2.5-tts"),
    mimoTtsVoice: new FakeElement("茉莉"),
    mimoTtsTimeout: new FakeElement("15000"),
    mimoTtsRetries: new FakeElement("1"),
    testTtsBtn: new FakeElement(),
    ttsStatus: new FakeElement(),
  };
  const spoken = [];
  let cancelCalls = 0;
  const cancelledPlayers = [];
  const makePlayer = () => ({
    async resume() {},
    enqueue: () => new Promise(() => {}),
    async activate() {},
    async cancelAll(reason) { cancelledPlayers.push(reason); },
    async destroy() {},
  });
  const root = {
    speechSynthesis: {
      getVoices: () => [{ name: "婷婷", lang: "zh-CN", voiceURI: "zh" }],
      cancel: () => { cancelCalls += 1; },
      speak: (utterance) => spoken.push(utterance),
    },
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    chrome: { permissions: { request: async () => true }, runtime: {} },
    YTD_TTS_STREAM_PLAYER: { createPlayer: makePlayer },
  };
  const document = {
    getElementById: (id) => elements[id] || null,
    createElement: () => new FakeElement(),
    documentElement: { lang: "en" },
  };
  const controller = ttsOptions.createController({
    root,
    document,
    ttsSettings,
    onChange() {},
  });
  return { elements, spoken, cancelCalls: () => cancelCalls, cancelledPlayers, root, controller };
}

test("starting a TTS test stops the other engine's playback", async () => {
  const harness = createTtsHarness();
  harness.controller.load(ttsSettings.normalize({}));
  harness.elements.mimoTtsApiKey.value = "key";

  harness.elements.testSystemVoiceBtn.click();
  assert.equal(harness.spoken.length, 1);

  // While the system voice is still speaking, a MiMo test must cancel it.
  harness.elements.testTtsBtn.click();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.cancelCalls() >= 2, true);
  assert.equal(harness.elements.testTtsBtn.disabled, true);

  // And while a MiMo stream is pending, a new system test must cancel it.
  harness.elements.testSystemVoiceBtn.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.cancelledPlayers.length, 1);
  assert.equal(harness.spoken.length, 2);
});

test("lists only installed Chinese system voices", () => {
  const voices = ttsOptions.getChineseVoices([
    { name: "English", lang: "en-US", voiceURI: "en" },
    { name: "普通话", lang: "zh-CN", voiceURI: "zh-cn" },
    { name: "粤语", lang: "zh-HK", voiceURI: "zh-hk" },
  ]);

  assert.deepEqual(voices.map((voice) => voice.voiceURI), ["zh-cn", "zh-hk"]);
});

test("editing MiMo fields invalidates connection verification", () => {
  const voice = ttsOptions.invalidateMimoVerification({
    activeProvider: "mimo",
    mimo: { verifiedAt: 123, apiKey: "key" },
  });

  assert.equal(voice.mimo.verifiedAt, 0);
  assert.equal(voice.activeProvider, "system");
});

test("MiMo can only activate after a successful verified test", () => {
  assert.equal(
    ttsOptions.canActivateMimo({ apiKey: "key", verifiedAt: Date.now() }),
    true,
  );
  assert.equal(ttsOptions.canActivateMimo({ apiKey: "key", verifiedAt: 0 }), false);
  assert.equal(ttsOptions.canActivateMimo({ apiKey: "", verifiedAt: 123 }), false);
});

test("narration pace is captured without invalidating MiMo verification", async () => {
  const harness = createTtsHarness();
  harness.controller.load(ttsSettings.normalize({
    activeProvider: "mimo",
    speedMultiplier: 0.9,
    mimo: { apiKey: "key", verifiedAt: 123 },
  }));
  assert.equal(harness.elements.voiceSpeedPreference.value, "0.9");

  harness.elements.voiceSpeedPreference.value = "1.3";
  harness.elements.voiceSpeedPreference.handlers.get("change")?.();
  const captured = harness.controller.capture();

  assert.equal(captured.speedMultiplier, 1.3);
  // Changing pace must not force a MiMo re-test.
  assert.equal(captured.mimo.verifiedAt, 123);
  assert.equal(captured.activeProvider, "mimo");

  // Unsupported values fall back to the default pace.
  harness.elements.voiceSpeedPreference.value = "2";
  harness.elements.voiceSpeedPreference.handlers.get("change")?.();
  assert.equal(harness.controller.capture().speedMultiplier, 1.15);
});
