const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const voiceControllerApi = require("../voice-controller.js");

class FakeButton {
  constructor() {
    this.disabled = true;
    this.dataset = {};
    this.attributes = {};
  }
  addEventListener() {}
  setAttribute(name, value) { this.attributes[name] = String(value); }
}

function loadSidepanel() {
  const listeners = { addListener() {} };
  const sandbox = {
    console,
    URL,
    TextDecoder,
    TextEncoder,
    setTimeout() { return 0; },
    clearTimeout() {},
    setInterval() { return 0; },
    clearInterval() {},
    IntersectionObserver: class {},
    CSS: { escape: (value) => value },
    window: { close() {}, getSelection: () => null },
    document: {
      addEventListener() {},
      querySelectorAll: () => [],
      querySelector: () => null,
      getElementById: () => null,
      createElement: () => ({}),
    },
    chrome: {
      runtime: { onMessage: listeners, sendMessage: async () => ({}) },
      windows: {
        getCurrent: async () => ({ id: 1 }),
        WINDOW_ID_NONE: -1,
        onFocusChanged: listeners,
      },
      tabs: { onUpdated: listeners, onActivated: listeners },
    },
    YTD_SETTINGS: {},
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const source = fs.readFileSync(path.resolve(__dirname, "../sidepanel.js"), "utf8");
  vm.runInContext(source, sandbox);
  return sandbox;
}

test("restores Voice segments when Transcript reopens an analyzed video", async () => {
  const button = new FakeButton();
  const controller = voiceControllerApi.createController({
    button,
    storage: { get: async () => ({}) },
    runtime: { sendMessage: async () => ({ success: true }) },
    relay: async () => ({ success: true }),
  });
  const sandbox = loadSidepanel();
  sandbox.injectedVoiceController = controller;
  sandbox.loadedTranscript = [
    { start: 0, duration: 4, text: "这段字幕应该可以重新播报。" },
  ];
  vm.runInContext(`
    transcriptTabsController = {
      createRequestToken: () => 1,
      isRequestCurrent: () => true,
    };
    voiceController = injectedVoiceController;
    currentVideoId = "video-1";
    currentVideoUrl = "https://www.youtube.com/watch?v=video-1";
    currentVideoTitle = "Cached video";
    currentTranscriptLanguage = "zh-CN";
    currentTranscript = loadedTranscript;
    currentAnalysis = { summary: "cached" };
    showState = () => {};
    syncPlayerCaptionOverlay = async () => {};
  `, sandbox);

  await controller.clearTranscript();
  assert.equal(button.disabled, false);

  await sandbox.startDigest("video-1", sandbox.currentVideoUrl);

  assert.equal(button.disabled, false);
  assert.equal(controller.getState().segmentCount, 1);
});

test("Voice switch availability follows the Transcript master switch", async () => {  const button = new FakeButton();
  let transcriptEnabled = true;
  const controller = voiceControllerApi.createController({
    button,
    storage: { get: async () => ({}) },
    runtime: { sendMessage: async () => ({ success: true }) },
    relay: async () => ({ success: true }),
    isTranscriptEnabled: () => transcriptEnabled,
  });
  await controller.initialize();

  const sandbox = loadSidepanel();
  sandbox.injectedVoiceController = controller;
  sandbox.chrome.runtime.sendMessage = async () => ({
    hasSupadataKey: true,
    hasAiKey: true,
  });
  vm.runInContext(`
    transcriptTabsController = { isEnabled: () => true };
    voiceController = injectedVoiceController;
    checkCurrentTab = async () => {};
    showState = () => {};
    clearPlayerCaptionOverlay = () => {};
    stopPlaybackTracking = () => {};
  `, sandbox);

  await sandbox.activateTranscriptFeature();
  assert.equal(button.disabled, false);

  transcriptEnabled = false;
  sandbox.deactivateTranscriptFeature();
  assert.equal(button.disabled, true);
});

test("focus moving to another browser window pauses the tracked video", async () => {
  const focusListeners = [];
  const sent = [];
  const listeners = { addListener(fn) { focusListeners.push(fn); } };
  const sandbox = {
    console,
    URL,
    TextDecoder,
    TextEncoder,
    setTimeout() { return 0; },
    clearTimeout() {},
    setInterval() { return 0; },
    clearInterval() {},
    IntersectionObserver: class {},
    CSS: { escape: (value) => value },
    window: { close() {} },
    document: {
      addEventListener() {},
      querySelectorAll: () => [],
      querySelector: () => null,
      getElementById: () => null,
      createElement: () => ({}),
    },
    chrome: {
      runtime: {
        onMessage: { addListener() {} },
        sendMessage: async (message) => {
          sent.push(message);
          return {};
        },
      },
      windows: {
        getCurrent: async () => ({ id: 1 }),
        WINDOW_ID_NONE: -1,
        onFocusChanged: listeners,
      },
      tabs: {
        onUpdated: { addListener() {} },
        onActivated: { addListener() {} },
        sendMessage: async (tabId, message) => {
          sent.push(message);
          return {};
        },
      },
    },
    YTD_SETTINGS: {},
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, "../sidepanel.js"), "utf8"), sandbox);

  // The panel learns which tab it is tracking, then focus leaves its window.
  await vm.runInContext(`
    youtubeTabId = 77;
    panelWindowId = 1;
  `, sandbox);
  const onFocusChanged = focusListeners.at(-1);
  onFocusChanged(42);

  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(sent.some((message) => message.action === "pauseVideo"));

  // Focus leaving Chrome entirely (another app/browser) and any other
  // browser window must both pause; refocusing our own window must not.
  sent.length = 0;
  onFocusChanged(-1);
  onFocusChanged(42);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent.filter((message) => message.action === "pauseVideo").length, 2);
  sent.length = 0;
  onFocusChanged(1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent.filter((message) => message.action === "pauseVideo").length, 0);
});
