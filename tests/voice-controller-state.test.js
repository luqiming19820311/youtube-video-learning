const test = require("node:test");
const assert = require("node:assert/strict");

const settings = require("../settings.js");
const voiceController = require("../voice-controller.js");

class FakeButton {
  constructor() {
    this.disabled = true;
    this.dataset = {};
    this.attributes = { "aria-checked": "false" };
    this.listeners = new Map();
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  click() { this.listeners.get("click")?.(); }
}

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test("does not speak a future segment before its video timestamp", async () => {
  const button = new FakeButton();
  const spoken = [];
  let currentTime = 0;
  class FakeUtterance {
    constructor(text) { this.text = text; }
  }
  const controller = voiceController.createController({
    button,
    storage: { async get() {
      return { [settings.STORAGE_KEY]: settings.normalize({ voice: { activeProvider: "system" } }) };
    } },
    runtime: { async sendMessage() {} },
    relay: async (message) => message.action === "getVoicePlaybackState"
      ? { currentTime, playbackRate: 1, paused: false, pausedByVoice: false }
      : { success: true },
    speechSynthesis: {
      getVoices: () => [{ voiceURI: "zh", lang: "zh-CN" }],
      speak(utterance) { spoken.push(utterance.text); queueMicrotask(utterance.onend); },
      cancel() {}, pause() {}, resume() {},
    },
    SpeechSynthesisUtteranceCtor: FakeUtterance,
    setIntervalFn: () => 1,
    clearIntervalFn() {},
  });
  await controller.initialize();
  controller.setTranscript({
    videoId: "timeline",
    language: "zh-CN",
    segments: [      { id: "segment-0-0", start: 0, end: 4.0, text: "现在播报。" },
      { id: "segment-1-4000", start: 4, end: 8.0, text: "稍后播报。" }
    ],
  });
  await controller.start();
  await nextTurn();
  assert.deepEqual(spoken, ["现在播报。"]);
  currentTime = 4;
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.deepEqual(spoken, ["现在播报。", "稍后播报。"]);
  await controller.stop();
});

test("startup failure returns Voice to a safe error state", async () => {
  const button = new FakeButton();
  const statuses = [];
  const controller = voiceController.createController({
    button,
    storage: { async get() {
      return { [settings.STORAGE_KEY]: settings.normalize({
        voice: { activeProvider: "mimo", mimo: { apiKey: "key", verifiedAt: 1 } },
      }) };
    } },
    runtime: { async sendMessage() {} },
    relay: async () => ({ success: true }),
    streamPlayerFactory: () => ({ async resume() { throw new Error("Audio unavailable"); } }),
    onStatus: (message, state) => statuses.push({ message, state }),
    setIntervalFn: () => 1,
    clearIntervalFn() {},
  });
  await controller.initialize();
  controller.setTranscript({
    videoId: "failed-start",
    language: "zh-CN",
    segments: [{ id: "segment-0-0", start: 0, end: 4.0, text: "测试。" }],
  });

  await controller.start();
  assert.equal(controller.getState().enabled, false);
  assert.equal(button.dataset.state, "error");
  assert.deepEqual(statuses.at(-1), { message: "Audio unavailable", state: "error" });
});

test("user-paused video holds TTS while a Voice catch-up pause does not", async () => {
  const button = new FakeButton();
  const spoken = [];
  let paused = true;
  let pausedByVoice = false;
  class FakeUtterance { constructor(text) { this.text = text; } }
  const controller = voiceController.createController({
    button,
    storage: { async get() {
      return { [settings.STORAGE_KEY]: settings.normalize({ voice: { activeProvider: "system" } }) };
    } },
    runtime: { async sendMessage() {} },
    relay: async (message) => message.action === "getVoicePlaybackState"
      ? { currentTime: 0, playbackRate: 1, paused, pausedByVoice }
      : { success: true },
    speechSynthesis: {
      getVoices: () => [{ voiceURI: "zh", lang: "zh-CN" }],
      speak(utterance) { spoken.push(utterance.text); },
      cancel() {}, pause() {}, resume() {},
    },
    SpeechSynthesisUtteranceCtor: FakeUtterance,
    setIntervalFn: () => 1,
    clearIntervalFn() {},
  });
  await controller.initialize();
  controller.setTranscript({
    videoId: "pause",
    language: "zh-CN",
    segments: [{ id: "segment-0-0", start: 0, end: 4.0, text: "暂停测试。" }],
  });
  await controller.start();
  await new Promise((resolve) => setTimeout(resolve, 110));
  assert.deepEqual(spoken, []);
  pausedByVoice = true;
  await new Promise((resolve) => setTimeout(resolve, 110));
  assert.deepEqual(spoken, ["暂停测试。"]);
  await controller.stop();
});

test("Voice switch exposes paused state and returns to playing state", async () => {
  const button = new FakeButton();
  let paused = false;
  let tick;
  class FakeUtterance { constructor(text) { this.text = text; } }
  const controller = voiceController.createController({
    button,
    storage: { async get() {
      return { [settings.STORAGE_KEY]: settings.normalize({ voice: { activeProvider: "system" } }) };
    } },
    runtime: { async sendMessage() {} },
    relay: async (message) => message.action === "getVoicePlaybackState"
      ? { currentTime: 0, playbackRate: 1, paused, pausedByVoice: false }
      : { success: true },
    speechSynthesis: {
      getVoices: () => [{ voiceURI: "zh", lang: "zh-CN" }],
      speak() {}, cancel() {}, pause() {}, resume() {},
    },
    SpeechSynthesisUtteranceCtor: FakeUtterance,
    setIntervalFn(callback) { tick = callback; return 1; },
    clearIntervalFn() {},
  });
  await controller.initialize();
  controller.setTranscript({
    videoId: "pause-state",
    language: "zh-CN",
    segments: [{ id: "segment-0-0", start: 0, end: 4.0, text: "状态测试。" }],
  });
  await controller.start();
  paused = true;
  tick();
  await nextTurn();
  assert.equal(button.dataset.state, "paused");
  paused = false;
  tick();
  await nextTurn();
  assert.equal(button.dataset.state, "on");
  await controller.stop();
});

test("discarded translation generations cannot populate a new video", async () => {
  const button = new FakeButton();
  const spoken = [];
  let firstCall;
  let resolveFirst;
  let calls = 0;
  const cancelled = [];
  class FakeUtterance { constructor(text) { this.text = text; } }
  const controller = voiceController.createController({
    button,
    storage: { async get() {
      return { [settings.STORAGE_KEY]: settings.normalize({ voice: { activeProvider: "system" } }) };
    } },
    runtime: { sendMessage(message) {
      if (message.action === "cancelVoiceTranslation") {
        cancelled.push(message.generation);
        return Promise.resolve({ success: true });
      }
      calls += 1;
      if (calls === 1) {
        firstCall = message;
        return new Promise((resolve) => { resolveFirst = resolve; });
      }
      return Promise.resolve({
        success: true,
        translatedContent: { segments: message.content.segments.map(({ id }) => ({ id, text: "新视频中文" })) },
      });
    } },
    relay: async (message) => message.action === "getVoicePlaybackState"
      ? { currentTime: 0, playbackRate: 1, paused: false, pausedByVoice: false }
      : { success: true },
    speechSynthesis: {
      getVoices: () => [{ voiceURI: "zh", lang: "zh-CN" }],
      speak(utterance) { spoken.push(utterance.text); },
      cancel() {}, pause() {}, resume() {},
    },
    SpeechSynthesisUtteranceCtor: FakeUtterance,
    setIntervalFn: () => 1,
    clearIntervalFn() {},
  });
  await controller.initialize();
  controller.setTranscript({
    videoId: "old",
    language: "en",
    segments: [{ id: "segment-0-0", start: 0, end: 4.0, text: "Old video" }],
  });
  await controller.start();
  await nextTurn();
  await controller.clearTranscript();
  controller.setTranscript({
    videoId: "new",
    language: "en",
    segments: [{ id: "segment-0-0", start: 0, end: 4.0, text: "New video" }],
  });
  resolveFirst({
    success: true,
    translatedContent: { segments: firstCall.content.segments.map(({ id }) => ({ id, text: "旧视频中文" })) },
  });
  await nextTurn();
  await controller.start();
  await nextTurn();

  assert.equal(calls, 2);
  assert.ok(cancelled.length >= 1);
  assert.equal(spoken[0], "新视频中文");
  await controller.stop();
});
