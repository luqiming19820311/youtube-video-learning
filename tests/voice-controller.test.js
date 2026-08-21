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

test("Voice derives availability from the Transcript state source", async () => {
  const button = new FakeButton();
  const spoken = [];
  class FakeUtterance {
    constructor(text) { this.text = text; }
  }
  const controller = voiceController.createController({
    button,
    storage: {
      async get() {
        return { [settings.STORAGE_KEY]: settings.normalize({}) };
      },
    },
    isTranscriptEnabled: () => true,
    runtime: { async sendMessage() { return { success: true }; } },
    relay: async (message) => message.action === "getVoicePlaybackState"
      ? { currentTime: 0, playbackRate: 1, paused: false, pausedByVoice: false }
      : { success: true },
    speechSynthesis: {
      getVoices: () => [{ voiceURI: "zh", lang: "zh-CN" }],
      speak: (utterance) => spoken.push(utterance),
      cancel() {},
    },
    SpeechSynthesisUtteranceCtor: FakeUtterance,
    setIntervalFn: () => 1,
    clearIntervalFn() {},
  });

  await controller.initialize();
  assert.equal(button.disabled, false);

  button.click();
  await nextTurn();
  assert.equal(button.getAttribute("aria-checked"), "true");
  assert.equal(button.dataset.state, "loading");

  controller.setTranscript({
    videoId: "video-1",
    language: "zh-CN",
    segments: [{ id: "segment-0-0", start: 0, end: 4.0, text: "字幕到达后自动播报。" }],
  });
  await nextTurn();
  await nextTurn();
  assert.equal(button.dataset.state, "on");
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].text, "字幕到达后自动播报。");
});

test("Voice starts off and restores playback after stopping", async () => {
  const button = new FakeButton();
  const relayMessages = [];
  const utterances = [];
  class FakeUtterance {
    constructor(text) { this.text = text; }
  }
  const speech = {
    getVoices() { return [{ voiceURI: "zh", name: "中文", lang: "zh-CN" }]; },
    speak(utterance) { utterances.push(utterance); },
    cancel() {},
    pause() {},
    resume() {},
  };
  const controller = voiceController.createController({
    button,
    storage: {
      async get() {
        return { [settings.STORAGE_KEY]: settings.normalize({
          voice: { activeProvider: "system", system: { voiceURI: "zh" } },
        }) };
      },
    },
    runtime: { async sendMessage() { throw new Error("translation not expected"); } },
    relay: async (message) => {
      relayMessages.push(message);
      if (message.action === "getVoicePlaybackState") {
        return { currentTime: 0, playbackRate: 1, paused: false, pausedByVoice: false };
      }
      return { success: true };
    },
    speechSynthesis: speech,
    SpeechSynthesisUtteranceCtor: FakeUtterance,
    setIntervalFn: () => 1,
    clearIntervalFn() {},
  });

  await controller.initialize();
  assert.equal(button.disabled, false);
  assert.equal(button.getAttribute("aria-checked"), "false");
  controller.setTranscript({
    videoId: "video-1",
    language: "zh-CN",
    segments: [{ id: "segment-0-0", start: 0, end: 4.0, text: "这是第一段中文播报。" }],
  });
  assert.equal(button.disabled, false);

  button.click();
  await nextTurn();
  await nextTurn();
  assert.equal(button.getAttribute("aria-checked"), "true");
  assert.ok(relayMessages.some((message) => message.action === "setVoiceDucking" && message.enabled));
  assert.equal(utterances[0].text, "这是第一段中文播报。");
  assert.ok(utterances[0].rate >= 0.85 && utterances[0].rate <= 1.8);

  await controller.stop();
  assert.equal(button.getAttribute("aria-checked"), "false");
  assert.ok(relayMessages.some((message) => message.action === "restoreVoicePlayback"));
});

test("Voice preference persists across panel rebuilds and resumes as waiting", async () => {
  const button = new FakeButton();
  const spoken = [];
  const savedFlags = [];
  class FakeUtterance {
    constructor(text) { this.text = text; }
  }
  const controller = voiceController.createController({
    button,
    storage: {
      async get(key) {
        if (key === "ytd_voice_enabled") return { "ytd_voice_enabled": true };
        return { [settings.STORAGE_KEY]: settings.normalize({}) };
      },
      async set(value) { savedFlags.push(value); },
    },
    isTranscriptEnabled: () => true,
    runtime: { async sendMessage() { return { success: true }; } },
    relay: async (message) => message.action === "getVoicePlaybackState"
      ? { currentTime: 0, playbackRate: 1, paused: false, pausedByVoice: false }
      : { success: true },
    speechSynthesis: {
      getVoices: () => [{ voiceURI: "zh", lang: "zh-CN" }],
      speak: (utterance) => spoken.push(utterance),
      cancel() {}, pause() {}, resume() {},
    },
    SpeechSynthesisUtteranceCtor: FakeUtterance,
    setIntervalFn: () => 1,
    clearIntervalFn() {},
  });
  await controller.initialize();
  controller.refreshAvailability();
  await nextTurn();
  await nextTurn();
  assert.equal(button.getAttribute("aria-checked"), "true");
  assert.equal(button.dataset.state, "loading");

  controller.setTranscript({
    videoId: "restored",
    language: "zh-CN",
    segments: [{ id: "segment-0-0", start: 0, end: 4, text: "恢复后自动播报。" }],
  });
  await nextTurn();
  await nextTurn();
  assert.deepEqual(spoken.map((utterance) => utterance.text), ["恢复后自动播报。"]);

  // An internal stop (natural end, teardown) must not clear the preference.
  await controller.stop();
  assert.ok(savedFlags.every((flag) => flag["ytd_voice_enabled"] !== false));
});

test("video switch keeps Voice enabled and restarts narration on the new transcript", async () => {
  const button = new FakeButton();
  const spoken = [];
  const relayMessages = [];
  class FakeUtterance {
    constructor(text) { this.text = text; }
  }
  const controller = voiceController.createController({
    button,
    storage: {
      async get() {
        return { [settings.STORAGE_KEY]: settings.normalize({}) };
      },
    },
    isTranscriptEnabled: () => true,
    runtime: { async sendMessage() { return { success: true }; } },
    relay: async (message) => {
      relayMessages.push(message.action);
      if (message.action === "getVoicePlaybackState") {
        return { currentTime: 0, playbackRate: 1, paused: false, pausedByVoice: false };
      }
      return { success: true };
    },
    speechSynthesis: {
      getVoices: () => [{ voiceURI: "zh", lang: "zh-CN" }],
      speak: (utterance) => spoken.push(utterance),
      cancel() {}, pause() {}, resume() {},
    },
    SpeechSynthesisUtteranceCtor: FakeUtterance,
    setIntervalFn: () => 1,
    clearIntervalFn() {},
  });
  await controller.initialize();
  controller.setTranscript({
    videoId: "video-a",
    language: "zh-CN",
    segments: [{ id: "segment-0-0", start: 0, end: 4, text: "第一个视频的句子。" }],
  });
  button.click();
  await nextTurn();
  await nextTurn();
  assert.deepEqual(spoken.map((utterance) => utterance.text), ["第一个视频的句子。"]);

  await controller.setTranscript({
    videoId: "video-b",
    language: "zh-CN",
    segments: [{ id: "segment-0-0", start: 0, end: 4, text: "第二个视频的句子。" }],
  });
  await nextTurn();
  await nextTurn();

  assert.equal(button.getAttribute("aria-checked"), "true");
  assert.ok(spoken.some((utterance) => utterance.text === "第二个视频的句子。"));
  assert.ok(relayMessages.includes("restoreVoicePlayback"));
  await controller.stop();
});

test("panel video-switch flow (clearTranscript then setTranscript) keeps Voice narrating", async () => {
  const button = new FakeButton();
  const spoken = [];
  class FakeUtterance {
    constructor(text) { this.text = text; }
  }
  const controller = voiceController.createController({
    button,
    storage: {
      async get(key) {
        if (key === "ytd_voice_enabled") return { "ytd_voice_enabled": true };
        return { [settings.STORAGE_KEY]: settings.normalize({}) };
      },
    },
    isTranscriptEnabled: () => true,
    runtime: { async sendMessage() { return { success: true }; } },
    relay: async (message) => message.action === "getVoicePlaybackState"
      ? { currentTime: 0, playbackRate: 1, paused: false, pausedByVoice: false }
      : { success: true },
    speechSynthesis: {
      getVoices: () => [{ voiceURI: "zh", lang: "zh-CN" }],
      speak: (utterance) => spoken.push(utterance),
      cancel() {}, pause() {}, resume() {},
    },
    SpeechSynthesisUtteranceCtor: FakeUtterance,
    setIntervalFn: () => 1,
    clearIntervalFn() {},
  });
  await controller.initialize();
  controller.refreshAvailability();
  // startDigest's video-changed cleanup runs before the new transcript
  // arrives — including for the panel's very first video after a rebuild.
  await controller.clearTranscript();
  assert.equal(button.getAttribute("aria-checked"), "true");
  assert.equal(button.dataset.state, "loading");

  controller.setTranscript({
    videoId: "first-video-after-rebuild",
    language: "zh-CN",
    segments: [{ id: "segment-0-0", start: 0, end: 4, text: "重建后第一句继续播报。" }],
  });
  await nextTurn();
  await nextTurn();
  assert.deepEqual(spoken.map((utterance) => utterance.text), ["重建后第一句继续播报。"]);
  await controller.stop();
});

test("Voice waits for the async system voice list instead of failing fast", async () => {
  const button = new FakeButton();
  const spoken = [];
  class FakeUtterance {
    constructor(text) { this.text = text; }
  }
  let voices = [];
  const voicesChangedHandlers = [];
  const controller = voiceController.createController({
    button,
    storage: {
      async get() {
        return { [settings.STORAGE_KEY]: settings.normalize({}) };
      },
    },
    isTranscriptEnabled: () => true,
    runtime: { async sendMessage() { return { success: true }; } },
    relay: async (message) => message.action === "getVoicePlaybackState"
      ? { currentTime: 0, playbackRate: 1, paused: false, pausedByVoice: false }
      : { success: true },
    speechSynthesis: {
      // Chrome's first getVoices() in a fresh panel returns [] until the
      // asynchronous voice load completes and fires voiceschanged.
      getVoices: () => voices,
      speak: (utterance) => spoken.push(utterance),
      cancel() {},
      addEventListener(type, handler) { voicesChangedHandlers.push(handler); },
      removeEventListener() {},
    },
    SpeechSynthesisUtteranceCtor: FakeUtterance,
    setIntervalFn: () => 1,
    clearIntervalFn() {},
  });

  await controller.initialize();
  controller.setTranscript({
    videoId: "video-voices",
    language: "zh-CN",
    segments: [{ id: "segment-0-0", start: 0, end: 4.0, text: "语音列表稍后到达。" }],
  });
  button.click();
  await nextTurn();
  await nextTurn();

  assert.equal(spoken.length, 0);
  assert.notEqual(button.dataset.state, "error");

  voices = [{ voiceURI: "zh", lang: "zh-CN" }];
  for (const handler of voicesChangedHandlers) handler();
  await nextTurn();
  await nextTurn();

  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].text, "语音列表稍后到达。");
  await controller.stop();
});

test("translation prefetch batches six segments and preserves stable IDs", async () => {
  const calls = [];
  const segments = Array.from({ length: 7 }, (_, index) => ({
    id: `voice-${index}-0`,
    sourceText: `English segment ${index}`,
  }));
  const translated = await voiceController.translateSegmentBatches({
    segments,
    generation: 12,
    sessionId: "batch",
    runtime: {
      async sendMessage(message) {
        calls.push(message);
        return {
          success: true,
          translatedContent: {
            segments: message.content.segments.map((segment) => ({
              id: segment.id,
              text: `中文 ${segment.id}`,
            })),
          },
        };
      },
    },
    videoTitle: "Video",
  });

  assert.deepEqual(calls.map((call) => call.content.segments.length), [6, 1]);
  assert.deepEqual(calls.map((call) => call.voiceRequestId), ["voice-batch-12-0", "voice-batch-12-6"]);
  assert.equal(translated.get("voice-6-0"), "中文 voice-6-0");
});

test("segment lookup stops after the final narration window", () => {
  assert.equal(voiceController.findSegmentIndex([{ start: 0, end: 4 }], 4), 1);
});

test("Voice speaks cached panel translations without new AI requests", async () => {
  const button = new FakeButton();
  const spoken = [];
  let translationCalls = 0;
  class FakeUtterance {
    constructor(text) { this.text = text; }
  }
  const controller = voiceController.createController({
    button,
    storage: {
      async get() {
        return { [settings.STORAGE_KEY]: settings.normalize({}) };
      },
    },
    runtime: { async sendMessage(message) {
      if (message.action === "translateContent") translationCalls += 1;
      return { success: true };
    } },
    isTranscriptEnabled: () => true,
    relay: async (message) => message.action === "getVoicePlaybackState"
      ? { currentTime: 0, playbackRate: 1, paused: false, pausedByVoice: false }
      : { success: true },
    speechSynthesis: {
      getVoices: () => [{ voiceURI: "zh", lang: "zh-CN" }],
      speak: (utterance) => spoken.push(utterance),
      cancel() {},
    },
    SpeechSynthesisUtteranceCtor: FakeUtterance,
    setIntervalFn: () => 1,
    clearIntervalFn() {},
  });
  await controller.initialize();

  // The bilingual view already translated this segment; the cache is shared.
  const sharedCache = new Map([
    ["reuse-video:zh:semantic:segment-0-0", "面板里已经翻好的中文。"],
  ]);
  controller.setTranscript({
    videoId: "reuse-video",
    language: "en",
    segments: [{ id: "segment-0-0", start: 0, end: 4, text: "Already translated text." }],
    translationCache: sharedCache,
  });
  await controller.start();
  await nextTurn();

  assert.deepEqual(spoken.map((utterance) => utterance.text), ["面板里已经翻好的中文。"]);
  assert.equal(translationCalls, 0);
  await controller.stop();
});

test("Voice translation results fill the shared panel cache", async () => {
  const button = new FakeButton();
  const spoken = [];
  let addedNotifications = 0;
  class FakeUtterance {
    constructor(text) { this.text = text; }
  }
  const controller = voiceController.createController({
    button,
    storage: {
      async get() {
        return { [settings.STORAGE_KEY]: settings.normalize({}) };
      },
    },
    runtime: { async sendMessage(message) {
      if (message.action !== "translateContent") return { success: true };
      return {
        success: true,
        translatedContent: {
          segments: message.content.segments.map(({ id }) => ({ id, text: "语音翻好的中文。" })),
        },
      };
    } },
    isTranscriptEnabled: () => true,
    relay: async (message) => message.action === "getVoicePlaybackState"
      ? { currentTime: 0, playbackRate: 1, paused: false, pausedByVoice: false }
      : { success: true },
    speechSynthesis: {
      getVoices: () => [{ voiceURI: "zh", lang: "zh-CN" }],
      speak: (utterance) => spoken.push(utterance),
      cancel() {},
    },
    SpeechSynthesisUtteranceCtor: FakeUtterance,
    setIntervalFn: () => 1,
    clearIntervalFn() {},
  });
  await controller.initialize();

  const sharedCache = new Map();
  controller.setTranscript({
    videoId: "fill-video",
    language: "en",
    segments: [{ id: "segment-0-0", start: 0, end: 4, text: "Not yet translated." }],
    translationCache: sharedCache,
    onTranslationsAdded: () => { addedNotifications += 1; },
  });
  await controller.start();
  await nextTurn();
  await nextTurn();

  assert.equal(sharedCache.get("fill-video:zh:semantic:segment-0-0"), "语音翻好的中文。");
  assert.equal(addedNotifications, 1);
  assert.deepEqual(spoken.map((utterance) => utterance.text), ["语音翻好的中文。"]);
  await controller.stop();
});

test("recovers when Chrome drops an utterance without end or error events", async () => {
  const button = new FakeButton();
  const spoken = [];
  class FakeUtterance {
    constructor(text) { this.text = text; }
  }
  const controller = voiceController.createController({
    button,
    storage: {
      async get() {
        return { [settings.STORAGE_KEY]: settings.normalize({}) };
      },
    },
    isTranscriptEnabled: () => true,
    runtime: { async sendMessage() { return { success: true }; } },
    relay: async (message) => message.action === "getVoicePlaybackState"
      ? { currentTime: 0, playbackRate: 1, paused: false, pausedByVoice: false }
      : { success: true },
    speechSynthesis: {
      getVoices: () => [{ voiceURI: "zh", lang: "zh-CN" }],
      speak: (utterance) => spoken.push(utterance),
      cancel() {},
      // The engine neither reports activity nor ever fires onend/onerror —
      // the watchdog must treat the utterance as finished so narration
      // recovers instead of hanging with the switch stuck "on".
      get speaking() { return false; },
      get pending() { return false; },
      get paused() { return false; },
    },
    SpeechSynthesisUtteranceCtor: FakeUtterance,
    setIntervalFn: () => 1,
    clearIntervalFn() {},
  });
  await controller.initialize();
  controller.setTranscript({
    videoId: "dropped",
    language: "zh-CN",
    segments: [{ id: "segment-0-0", start: 0, end: 4, text: "这句朗读的结束事件丢失了。" }],
  });
  await controller.start();

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && button.getAttribute("aria-checked") !== "false") {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(spoken.length, 1);
  assert.equal(button.getAttribute("aria-checked"), "false");
});

test("Voice translation rejects when the message port wedges", async () => {
  await assert.rejects(
    voiceController.translateSegmentBatches({
      segments: [{ id: "segment-0-0", sourceText: "Hello" }],
      runtime: { sendMessage: () => new Promise(() => {}) },
      videoTitle: "Video",
      timeoutMs: 40,
    }),
    /timed out/i,
  );
});

test("a seek inside the current segment continues narration instead of replaying it", async () => {
  const button = new FakeButton();
  const spoken = [];
  let cancelCalls = 0;
  let currentTime = 0;
  class FakeUtterance {
    constructor(text) { this.text = text; }
  }
  const controller = voiceController.createController({
    button,
    storage: {
      async get() {
        return { [settings.STORAGE_KEY]: settings.normalize({}) };
      },
    },
    isTranscriptEnabled: () => true,
    runtime: { async sendMessage() { return { success: true }; } },
    relay: async (message) => message.action === "getVoicePlaybackState"
      ? { currentTime, playbackRate: 1, paused: false, pausedByVoice: false }
      : { success: true },
    speechSynthesis: {
      getVoices: () => [{ voiceURI: "zh", lang: "zh-CN" }],
      speak: (utterance) => spoken.push(utterance),
      cancel: () => { cancelCalls += 1; },
      pause() {}, resume() {},
    },
    SpeechSynthesisUtteranceCtor: FakeUtterance,
    setIntervalFn: () => 1,
    clearIntervalFn() {},
  });
  await controller.initialize();
  controller.setTranscript({
    videoId: "dedupe",
    language: "zh-CN",
    segments: [
      { id: "segment-0-0", start: 0, end: 4, text: "这段话不应重复播报。" },
      { id: "segment-1-4000", start: 4, end: 8, text: "下一句。" },
    ],
  });
  await controller.start();
  await nextTurn();
  assert.deepEqual(spoken.map((utterance) => utterance.text), ["这段话不应重复播报。"]);

  // A small in-segment jump (drag, timing jitter, ad round-trip) must not
  // cancel and re-speak the current sentence.
  currentTime = 2;
  await controller.seekTo(2);
  await nextTurn();
  await nextTurn();
  assert.deepEqual(spoken.map((utterance) => utterance.text), ["这段话不应重复播报。"]);
  assert.equal(cancelCalls, 0);
  assert.equal(controller.getState().currentIndex, 0);

  // A cross-segment seek still restarts at the target segment.
  currentTime = 5;
  await controller.seekTo(5);
  await nextTurn();
  await nextTurn();
  assert.equal(spoken.at(-1).text, "下一句。");
  await controller.stop();
});

test("returning mid-sentence skips to the next sentence and speaks it immediately", async () => {
  const button = new FakeButton();
  const spoken = [];
  let currentTime = 0;
  class FakeUtterance {
    constructor(text) { this.text = text; }
  }
  const controller = voiceController.createController({
    button,
    storage: {
      async get(key) {
        if (key === "ytd_voice_spoken_through") {
          return { ytd_voice_spoken_through: {
            videoId: "resume",
            index: 0,
            markedAt: Date.now(),
            characters: 30,
            heardChars: 12,
          } };
        }
        return { [settings.STORAGE_KEY]: settings.normalize({}) };
      },
    },
    isTranscriptEnabled: () => true,
    runtime: { async sendMessage() { return { success: true }; } },
    relay: async (message) => message.action === "getVoicePlaybackState"
      ? { currentTime, playbackRate: 1, paused: false, pausedByVoice: false }
      : { success: true },
    speechSynthesis: {
      getVoices: () => [{ voiceURI: "zh", lang: "zh-CN" }],
      speak: (utterance) => spoken.push(utterance),
      cancel() {}, pause() {}, resume() {},
    },
    SpeechSynthesisUtteranceCtor: FakeUtterance,
    setIntervalFn: () => 1,
    clearIntervalFn() {},
  });
  await controller.initialize();
  controller.setTranscript({
    videoId: "resume",
    language: "zh-CN",
    segments: [
      { id: "segment-0-0", start: 0, end: 4, text: "这句已经听过一多半不再重复播报。" },
      { id: "segment-1-4000", start: 4, end: 8, text: "回来后立即播报的下一句。" },
    ],
  });
  currentTime = 2;
  await controller.start();
  await nextTurn();
  await nextTurn();

  // Video time (2s) has not reached the next segment's start (4s), but the
  // resume speaks it right away instead of replaying the heard sentence.
  assert.deepEqual(spoken.map((utterance) => utterance.text), ["回来后立即播报的下一句。"]);
  await controller.stop();
});

test("a sentence barely started plays whole on return", async () => {
  const button = new FakeButton();
  const spoken = [];
  class FakeUtterance {
    constructor(text) { this.text = text; }
  }
  const controller = voiceController.createController({
    button,
    storage: {
      async get(key) {
        if (key === "ytd_voice_spoken_through") {
          return { ytd_voice_spoken_through: {
            videoId: "bare",
            index: 0,
            markedAt: Date.now(),
            characters: 30,
            heardChars: 2,
          } };
        }
        return { [settings.STORAGE_KEY]: settings.normalize({}) };
      },
    },
    isTranscriptEnabled: () => true,
    runtime: { async sendMessage() { return { success: true }; } },
    relay: async (message) => message.action === "getVoicePlaybackState"
      ? { currentTime: 1, playbackRate: 1, paused: false, pausedByVoice: false }
      : { success: true },
    speechSynthesis: {
      getVoices: () => [{ voiceURI: "zh", lang: "zh-CN" }],
      speak: (utterance) => spoken.push(utterance),
      cancel() {}, pause() {}, resume() {},
    },
    SpeechSynthesisUtteranceCtor: FakeUtterance,
    setIntervalFn: () => 1,
    clearIntervalFn() {},
  });
  await controller.initialize();
  controller.setTranscript({
    videoId: "bare",
    language: "zh-CN",
    segments: [
      { id: "segment-0-0", start: 0, end: 4, text: "这句几乎还没有听过完整重播。" },
      { id: "segment-1-4000", start: 4, end: 8, text: "下一句。" },
    ],
  });
  await controller.start();
  await nextTurn();
  await nextTurn();

  assert.deepEqual(spoken.map((utterance) => utterance.text), ["这句几乎还没有听过完整重播。"]);
  await controller.stop();
});

test("start retries the player connection when the content script is late", async () => {
  const button = new FakeButton();
  const spoken = [];
  let duckAttempts = 0;
  class FakeUtterance {
    constructor(text) { this.text = text; }
  }
  const controller = voiceController.createController({
    button,
    storage: {
      async get() {
        return { [settings.STORAGE_KEY]: settings.normalize({}) };
      },
    },
    isTranscriptEnabled: () => true,
    runtime: { async sendMessage() { return { success: true }; } },
    relay: async (message) => {
      if (message.action === "setVoiceDucking") {
        duckAttempts += 1;
        if (duckAttempts < 3) throw new Error("Could not establish connection. Receiving end does not exist.");
        return { success: true };
      }
      if (message.action === "getVoicePlaybackState") {
        return { currentTime: 0, playbackRate: 1, paused: false, pausedByVoice: false };
      }
      return { success: true };
    },
    speechSynthesis: {
      getVoices: () => [{ voiceURI: "zh", lang: "zh-CN" }],
      speak: (utterance) => spoken.push(utterance),
      cancel() {}, pause() {}, resume() {},
    },
    SpeechSynthesisUtteranceCtor: FakeUtterance,
    setIntervalFn: () => 1,
    clearIntervalFn() {},
  });
  await controller.initialize();
  controller.setTranscript({
    videoId: "slow-page",
    language: "zh-CN",
    segments: [{ id: "segment-0-0", start: 0, end: 4, text: "页面脚本加载慢也要能开始播报。" }],
  });
  await controller.start();
  await nextTurn();
  await nextTurn();

  assert.equal(duckAttempts, 3);
  assert.deepEqual(spoken.map((utterance) => utterance.text), ["页面脚本加载慢也要能开始播报。"]);
  assert.equal(button.dataset.state, "on");
  await controller.stop();
});

test("a wedged speech engine is cancelled so narration can continue", async () => {
  const button = new FakeButton();
  const spoken = [];
  let videoPaused = false;
  let currentTime = 0;
  let enginePaused = false;
  let cancelCalls = 0;
  let tick = () => {};
  class FakeUtterance {
    constructor(text) { this.text = text; }
  }
  const controller = voiceController.createController({
    button,
    storage: {
      async get() {
        return { [settings.STORAGE_KEY]: settings.normalize({}) };
      },
    },
    isTranscriptEnabled: () => true,
    runtime: { async sendMessage() { return { success: true }; } },
    relay: async (message) => message.action === "getVoicePlaybackState"
      ? { currentTime, playbackRate: 1, paused: videoPaused, pausedByVoice: false }
      : { success: true },
    speechSynthesis: {
      getVoices: () => [{ voiceURI: "zh", lang: "zh-CN" }],
      speak: (utterance) => spoken.push(utterance.text),
      pause: () => { enginePaused = true; },
      // macOS wedge: resume() does not clear the paused flag.
      resume: () => {},
      get paused() { return enginePaused && cancelCalls === 0; },
      get speaking() { return spoken.length > 0 && !enginePaused && cancelCalls === 0; },
      get pending() { return false; },
      cancel: () => { cancelCalls += 1; enginePaused = false; },
    },
    SpeechSynthesisUtteranceCtor: FakeUtterance,
    setIntervalFn: (callback) => { tick = callback; return 1; },
    clearIntervalFn() {},
  });
  try {
    await controller.initialize();
    controller.setTranscript({
      videoId: "wedge",
      language: "zh-CN",
      segments: [
        { id: "segment-0-0", start: 0, end: 4, text: "这句会被引擎卡住。" },
        { id: "segment-1-4000", start: 4, end: 8, text: "解锁后继续这一句。" },
      ],
    });
    await controller.start();
    await nextTurn();
    assert.equal(spoken.length, 1);

    // User leaves (video pauses → engine pauses), then returns and plays;
    // the video keeps advancing while the wedged engine refuses to resume.
    videoPaused = true;
    await tick(); await nextTurn();
    assert.equal(button.dataset.state, "paused");
    videoPaused = false;
    currentTime = 4.2;
    await tick(); await nextTurn();
    // resume() failed silently; the wedge check fires after ~1.5s (a second
    // cancel may come from the natural-end stop() cleanup — also fine).
    await new Promise((resolve) => setTimeout(resolve, 1900));
    assert.ok(cancelCalls >= 1);
    // The watchdog's idle path settles the stuck utterance and narration
    // proceeds to the next sentence.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    assert.equal(spoken.at(-1), "解锁后继续这一句。");
  } finally {
    await controller.stop();
  }
});

test("narration is window-independent: an active owner blocks only auto-start", async () => {
  const button = new FakeButton();
  const spoken = [];
  const store = new Map();
  const statusMessages = [];
  const storageEvents = { addListener() {} };
  class FakeUtterance {
    constructor(text) { this.text = text; }
  }
  const makeController = () => voiceController.createController({
    button: new FakeButton(),
    storage: {
      async get(key) { return store.has(key) ? { [key]: store.get(key) } : {}; },
      async set(value) { for (const [k, v] of Object.entries(value)) store.set(k, v); },
      async remove(key) { store.delete(key); },
    },
    storageEvents,
    isTranscriptEnabled: () => true,
    runtime: { async sendMessage() { return { success: true }; } },
    relay: async (message) => message.action === "getVoicePlaybackState"
      ? { currentTime: 0, playbackRate: 1, paused: false, pausedByVoice: false }
      : { success: true },
    speechSynthesis: {
      getVoices: () => [{ voiceURI: "zh", lang: "zh-CN" }],
      speak: (utterance) => spoken.push(utterance),
      cancel() {}, pause() {}, resume() {},
    },
    SpeechSynthesisUtteranceCtor: FakeUtterance,
    setIntervalFn: () => 1,
    clearIntervalFn() {},
    onStatus: (message) => statusMessages.push(message),
  });

  // Panel A starts narrating and owns the global key.
  const panelA = makeController();
  await panelA.initialize();
  panelA.setTranscript({
    videoId: "owner-demo",
    language: "zh-CN",
    segments: [{ id: "segment-0-0", start: 0, end: 4, text: "面板A在播报。" }],
  });
  await panelA.start();
  await nextTurn();
  assert.deepEqual(spoken.map((utterance) => utterance.text), ["面板A在播报。"]);
  assert.ok(store.has("ytd_voice_owner"));

  // Panel B boots with the same preference: auto-restore must NOT start a
  // second narration while A's owner heartbeat is fresh.
  const buttonB = new FakeButton();
  const controllerB = voiceController.createController({
    button: buttonB,
    storage: {
      async get(key) {
        if (key === "ytd_voice_enabled") return { ytd_voice_enabled: true };
        return store.has(key) ? { [key]: store.get(key) } : {};
      },
      async set(value) { for (const [k, v] of Object.entries(value)) store.set(k, v); },
      async remove(key) { store.delete(key); },
    },
    storageEvents,
    isTranscriptEnabled: () => true,
    runtime: { async sendMessage() { return { success: true }; } },
    relay: async () => ({ currentTime: 0, playbackRate: 1, paused: false, pausedByVoice: false }),
    speechSynthesis: { getVoices: () => [], cancel() {} },
    SpeechSynthesisUtteranceCtor: FakeUtterance,
    setIntervalFn: () => 1,
    clearIntervalFn() {},
    onStatus: (message) => statusMessages.push(message),
  });
  await controllerB.initialize();
  controllerB.refreshAvailability();
  await nextTurn();
  await nextTurn();
  assert.equal(buttonB.getAttribute("aria-checked"), "false");
  assert.ok(statusMessages.some((message) => /another window/.test(message)));

  // A manual click on B still takes over: B claims the key, A yields.
  assert.equal(spoken.length, 1);
  await panelA.stop();
  spoken.length = 0;
  assert.ok(!store.has("ytd_voice_owner") || store.get("ytd_voice_owner").id !== "stale");
  await controllerB.stop();
});

test("a stale ownership heartbeat stops blocking auto-restore", async () => {
  const button = new FakeButton();
  const store = new Map([
    ["ytd_voice_owner", { id: "dead-panel", ts: Date.now() }],
    ["ytd_voice_enabled", true],
  ]);
  const statuses = [];
  class FakeUtterance {
    constructor(text) { this.text = text; }
  }
  const controller = voiceController.createController({
    button,
    storage: {
      async get(key) { return store.has(key) ? { [key]: store.get(key) } : {}; },
      async set(value) { for (const [k, v] of Object.entries(value)) store.set(k, v); },
      async remove(key) { store.delete(key); },
    },
    storageEvents: { addListener() {} },
    isTranscriptEnabled: () => true,
    runtime: { async sendMessage() { return { success: true }; } },
    relay: async () => ({ currentTime: 0, playbackRate: 1, paused: false, pausedByVoice: false }),
    speechSynthesis: {
      getVoices: () => [{ voiceURI: "zh", lang: "zh-CN" }],
      speak: () => {},
      cancel() {}, pause() {}, resume() {},
    },
    SpeechSynthesisUtteranceCtor: FakeUtterance,
    setIntervalFn: () => 1,
    clearIntervalFn() {},
    onStatus: (message) => statuses.push(message),
  });
  await controller.initialize();

  // Fresh foreign heartbeat: restore is blocked and a recheck is armed.
  controller.refreshAvailability();
  await nextTurn();
  await nextTurn();
  assert.equal(button.getAttribute("aria-checked"), "false");
  assert.ok(statuses.some((message) => /another window/.test(message)));

  // The owning panel was killed; its heartbeat goes stale (the armed
  // recheck fires and calls refreshAvailability again).
  store.set("ytd_voice_owner", { id: "dead-panel", ts: Date.now() - 6_000 });
  controller.refreshAvailability();
  await nextTurn();
  await nextTurn();
  assert.equal(button.getAttribute("aria-checked"), "true");
  assert.equal(button.dataset.state, "loading");
  await controller.stop();
});

test("a sentence that finished naturally is not repeated on return", async () => {
  const button = new FakeButton();
  const spoken = [];
  class FakeUtterance {
    constructor(text) { this.text = text; }
  }
  const controller = voiceController.createController({
    button,
    storage: {
      async get(key) {
        if (key === "ytd_voice_spoken_through") return {};
        return { [settings.STORAGE_KEY]: settings.normalize({}) };
      },
    },
    isTranscriptEnabled: () => true,
    runtime: { async sendMessage() { return { success: true }; } },
    relay: async (message) => message.action === "getVoicePlaybackState"
      ? { currentTime: 0, playbackRate: 1, paused: false, pausedByVoice: false }
      : { success: true },
    speechSynthesis: {
      getVoices: () => [{ voiceURI: "zh", lang: "zh-CN" }],
      speak: (utterance) => {
        spoken.push(utterance);
        // Finish naturally so the whole sentence counts as heard.
        queueMicrotask(() => utterance.onend && utterance.onend());
      },
      cancel() {}, pause() {}, resume() {},
    },
    SpeechSynthesisUtteranceCtor: FakeUtterance,
    setIntervalFn: () => 1,
    clearIntervalFn() {},
  });
  await controller.initialize();
  controller.setTranscript({
    videoId: "finished",
    language: "zh-CN",
    segments: [{ id: "segment-0-0", start: 0, end: 4, text: "这句已经完整播完了。" }],
  });
  await controller.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(spoken.length, 1);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(button.getAttribute("aria-checked"), "false");

  // Come back inside that (fully heard) segment: nothing replays.
  await controller.start();
  await nextTurn();
  assert.equal(spoken.length, 1);
  await controller.stop();
});

test("ad breaks hold narration without seek-restarts and touch the engine once", async () => {
  const button = new FakeButton();
  const spoken = [];
  let pauseCount = 0;
  let resumeCount = 0;
  let snapshot = { currentTime: 0, playbackRate: 1, paused: false, pausedByVoice: false, adShowing: false };
  let tick;
  class FakeUtterance {
    constructor(text) { this.text = text; }
  }
  const controller = voiceController.createController({
    button,
    storage: {
      async get() {
        return { [settings.STORAGE_KEY]: settings.normalize({}) };
      },
    },
    isTranscriptEnabled: () => true,
    runtime: { async sendMessage() { return { success: true }; } },
    relay: async (message) => message.action === "getVoicePlaybackState" ? snapshot : { success: true },
    speechSynthesis: {
      getVoices: () => [{ voiceURI: "zh", lang: "zh-CN" }],
      speak: (utterance) => spoken.push(utterance),
      cancel() {},
      pause: () => { pauseCount += 1; },
      resume: () => { resumeCount += 1; },
    },
    SpeechSynthesisUtteranceCtor: FakeUtterance,
    setIntervalFn(callback) { tick = callback; return 1; },
    clearIntervalFn() {},
  });
  await controller.initialize();
  controller.setTranscript({
    videoId: "ads",
    language: "zh-CN",
    segments: [
      { id: "segment-0-0", start: 0, end: 4, text: "广告前的句子。" },
      { id: "segment-1-4000", start: 4, end: 8, text: "广告后的句子。" },
    ],
  });
  await controller.start();
  await nextTurn();
  assert.equal(spoken.length, 1);

  // Mid-roll ad: the video clock jumps onto the ad timeline.
  snapshot = { currentTime: 900, playbackRate: 1, paused: false, pausedByVoice: false, adShowing: true };
  await tick(); await nextTurn();
  await tick(); await nextTurn();
  await tick(); await nextTurn();
  assert.equal(pauseCount, 1);
  assert.equal(spoken.length, 1);
  assert.equal(button.dataset.state, "paused");

  // Ad ends: content resumes near where it left; narration continues on
  // the same utterance with no seek-restart replay.
  snapshot = { currentTime: 3, playbackRate: 1, paused: false, pausedByVoice: false, adShowing: false };
  await tick(); await nextTurn();
  await tick(); await nextTurn();
  assert.equal(resumeCount, 1);
  assert.equal(pauseCount, 1);
  assert.equal(spoken.length, 1);
  assert.equal(button.dataset.state, "on");
  await controller.stop();
});

test("MiMo starts the current segment and prefetches the next segment", async () => {
  const button = new FakeButton();
  const queued = [];
  const player = {
    async resume() {},
    async activate() {},
    enqueue(request) {
      queued.push(request);
      return new Promise(() => {});
    },
    async pause() {},
    async cancelAll() {},
    async destroy() {},
  };
  const controller = voiceController.createController({
    button,
    storage: {
      async get() {
        return { [settings.STORAGE_KEY]: settings.normalize({
          voice: {
            activeProvider: "mimo",
            mimo: { apiKey: "key", verifiedAt: 123 },
          },
        }) };
      },
    },
    runtime: { async sendMessage() {} },
    relay: async (message) => message.action === "getVoicePlaybackState"
      ? { currentTime: 0, playbackRate: 1, paused: false, pausedByVoice: false }
      : { success: true },
    streamPlayerFactory: () => player,
    setIntervalFn: () => 1,
    clearIntervalFn() {},
  });
  await controller.initialize();
  controller.setTranscript({
    videoId: "video-2",
    language: "zh-CN",
    segments: [      { id: "segment-0-0", start: 0, end: 4.0, text: "第一段。" },
      { id: "segment-1-4000", start: 4, end: 8.0, text: "第二段。" },
      { id: "segment-2-8000", start: 8, end: 12.0, text: "第三段。" }
    ],
  });

  button.click();
  await nextTurn();
  await nextTurn();
  assert.equal(queued.length, 2);
  assert.deepEqual(queued.map((item) => item.text), ["第一段。", "第二段。"]);
});

test("seek cancels stale speech and restarts from the target segment", async () => {
  const button = new FakeButton();
  const spoken = [];
  let cancelCalls = 0;
  let currentTime = 0;
  class FakeUtterance {
    constructor(text) { this.text = text; }
  }
  const controller = voiceController.createController({
    button,
    storage: {
      async get() {
        return { [settings.STORAGE_KEY]: settings.normalize({
          voice: { activeProvider: "system", system: { voiceURI: "zh" } },
        }) };
      },
    },
    runtime: { async sendMessage() {} },
    relay: async (message) => message.action === "getVoicePlaybackState"
      ? { currentTime, playbackRate: 1, paused: false, pausedByVoice: false }
      : { success: true },
    speechSynthesis: {
      getVoices: () => [{ voiceURI: "zh", lang: "zh-CN" }],
      speak: (utterance) => spoken.push(utterance.text),
      cancel: () => { cancelCalls += 1; },
      pause() {},
      resume() {},
    },
    SpeechSynthesisUtteranceCtor: FakeUtterance,
    setIntervalFn: () => 1,
    clearIntervalFn() {},
  });
  await controller.initialize();
  controller.setTranscript({
    videoId: "video-seek",
    language: "zh-CN",
    segments: [      { id: "segment-0-0", start: 0, end: 4.0, text: "第一段。" },
      { id: "segment-1-4000", start: 4, end: 8.0, text: "第二段。" },
      { id: "segment-2-8000", start: 8, end: 12.0, text: "第三段。" }
    ],
  });
  await controller.start();
  await nextTurn();
  currentTime = 8;
  await controller.seekTo(8);
  await nextTurn();

  assert.ok(cancelCalls >= 1);
  assert.equal(controller.getState().currentIndex, 2);
  assert.equal(spoken.at(-1), "第三段。");
  await controller.stop();
});
