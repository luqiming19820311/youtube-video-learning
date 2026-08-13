const test = require("node:test");
const assert = require("node:assert/strict");

const providers = require("../ai-providers.js");
const settings = require("../settings.js");
const options = require("../options.js");

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.dataset = {};
    this.attributes = {};
    this.children = [];
    this.listeners = new Map();
    this.value = "";
    this.textContent = "";
    this.hidden = false;
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this.selectionDirection = "none";
    this.scrollTop = 0;
    this.scrollLeft = 0;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  click() {
    for (const listener of this.listeners.get("click") || []) {
      listener({ preventDefault() {} });
    }
  }

  append(child) {
    this.children.push(child);
    if (this.tagName === "SELECT" && (child.selected || !this.value)) {
      this.value = child.value;
    }
  }

  replaceChildren() {
    this.children = [];
    if (this.tagName === "SELECT") this.value = "";
  }

  querySelectorAll(selector) {
    return selector === "button"
      ? this.children.filter((child) => child.tagName === "BUTTON")
      : [];
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name];
  }

  setSelectionRange(start, end, direction) {
    this.selectionStart = start;
    this.selectionEnd = end;
    this.selectionDirection = direction;
  }
}

function createDocument() {
  const ids = [
    "settingsForm", "aiApiKey", "aiBaseUrl", "aiModel", "providerList",
    "providerName", "providerHelp", "providerKeyLink", "privacyNote", "fetchModelsBtn",
    "modelStatus", "supadataApiKey", "customizationPrompt",
    "copyCustomizationPromptBtn", "copyStatus", "saveStatus", "dataStatus",
    "clearCacheBtn", "clearNotesBtn", "resetBtn",
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, new FakeElement()]));
  elements.aiModel.tagName = "SELECT";
  elements.customizationPrompt.value = "Prompt";
  const languageButtons = ["en", "zh-CN"].map((language) => {
    const button = new FakeElement("button");
    button.dataset.language = language;
    return button;
  });
  return {
    readyState: "complete",
    documentElement: {},
    title: "",
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    getElementById(id) {
      return elements[id];
    },
    querySelectorAll(selector) {
      return selector === "[data-language]" ? languageButtons : [];
    },
    elements,
    languageButtons,
  };
}

function createChromeStorage(initialSettings) {
  const values = { [settings.STORAGE_KEY]: initialSettings };
  return {
    values,
    api: {
      storage: {
        local: {
          async get(key) {
            return Object.hasOwn(values, key) ? { [key]: values[key] } : {};
          },
          async set(items) {
            Object.assign(values, items);
          },
          async remove() {},
          async clear() {},
        },
      },
    },
  };
}

function createDelayedChromeStorage(initialSettings) {
  const values = { [settings.STORAGE_KEY]: initialSettings };
  const writes = [];
  return {
    values,
    writes,
    api: {
      storage: {
        local: {
          async get(key) {
            return Object.hasOwn(values, key) ? { [key]: values[key] } : {};
          },
          set(items) {
            return new Promise((resolve) => {
              writes.push({
                items,
                resolved: false,
                resolve() {
                  if (this.resolved) return;
                  this.resolved = true;
                  Object.assign(values, items);
                  resolve();
                },
              });
            });
          },
          async remove() {},
          async clear() {},
        },
      },
    },
  };
}

const flushTasks = () => new Promise((resolve) => setImmediate(resolve));

test("clicking Zhipu switches every provider-specific field and persists it", async () => {
  const document = createDocument();
  const chrome = createChromeStorage(settings.normalize());

  options.initialize({
    document,
    chrome: chrome.api,
    YTD_SETTINGS: settings,
    YTD_AI_PROVIDERS: providers,
    navigator: { clipboard: { async writeText() {} } },
    confirm: () => true,
  });
  await flushTasks();

  const providerButtons = document.elements.providerList.children;
  const zhipuButton = providerButtons.find(
    (button) => button.dataset.provider === "zhipu",
  );
  zhipuButton.click();
  await flushTasks();

  assert.equal(zhipuButton.getAttribute("aria-selected"), "true");
  assert.equal(
    providerButtons.find((button) => button.dataset.provider === "deepseek")
      .getAttribute("aria-selected"),
    "false",
  );
  assert.equal(document.elements.providerName.textContent, "智谱 AI / Zhipu GLM");
  assert.equal(
    document.elements.aiBaseUrl.value,
    "https://open.bigmodel.cn/api/paas/v4",
  );
  assert.equal(document.elements.aiModel.value, "glm-4.5");
  assert.match(document.elements.aiApiKey.placeholder, /Zhipu GLM/);
  assert.match(document.elements.providerHelp.textContent, /Zhipu GLM/);
  assert.match(document.elements.privacyNote.textContent, /Zhipu GLM/);
  assert.equal(chrome.values[settings.STORAGE_KEY].activeProvider, "zhipu");
  assert.equal(chrome.values[settings.STORAGE_KEY].activeModel, "glm-4.5");
});

test("a late provider save cannot restore stale provider state", async () => {
  const document = createDocument();
  const chrome = createDelayedChromeStorage(settings.normalize());

  options.initialize({
    document,
    chrome: chrome.api,
    YTD_SETTINGS: settings,
    YTD_AI_PROVIDERS: providers,
    navigator: { clipboard: { async writeText() {} } },
    confirm: () => true,
  });
  await flushTasks();

  const buttons = document.elements.providerList.children;
  const zhipu = buttons.find((button) => button.dataset.provider === "zhipu");
  const qwen = buttons.find((button) => button.dataset.provider === "qwen");
  zhipu.click();
  qwen.click();
  await flushTasks();

  if (chrome.writes[1]) {
    chrome.writes[1].resolve();
    await flushTasks();
  }
  chrome.writes[0].resolve();
  await flushTasks();
  if (chrome.writes[1] && !chrome.writes[1].resolved) {
    chrome.writes[1].resolve();
    await flushTasks();
  }

  zhipu.click();

  assert.equal(document.elements.providerName.textContent, "智谱 AI / Zhipu GLM");
  assert.equal(
    document.elements.aiBaseUrl.value,
    "https://open.bigmodel.cn/api/paas/v4",
  );
  assert.equal(document.elements.aiModel.value, "glm-4.5");
});

test("fetching MiMo models refreshes the visible V2.5 fallback immediately", async () => {
  const document = createDocument();
  const chrome = createChromeStorage(settings.normalize());
  chrome.api.permissions = { async request() { return true; } };
  chrome.api.runtime = {
    async sendMessage(message) {
      assert.equal(message.providerId, "mimo");
      return {
        success: false,
        source: "fallback",
        models: providers.getProvider("mimo").defaultModels,
      };
    },
  };

  options.initialize({
    document,
    chrome: chrome.api,
    YTD_SETTINGS: settings,
    YTD_AI_PROVIDERS: providers,
    navigator: { clipboard: { async writeText() {} } },
    confirm: () => true,
  });
  await flushTasks();

  document.elements.providerList.children
    .find((button) => button.dataset.provider === "mimo")
    .click();
  document.elements.aiBaseUrl.value = "https://token-plan-cn.xiaomimimo.com/v1";
  document.elements.aiApiKey.value = "test-key";
  document.elements.fetchModelsBtn.click();
  await flushTasks();
  await flushTasks();

  assert.equal(document.elements.providerName.textContent, "小米 MiMo");
  assert.equal(
    document.elements.aiBaseUrl.value,
    "https://token-plan-cn.xiaomimimo.com/v1",
  );
  assert.deepEqual(
    document.elements.aiModel.children.map((option) => option.value),
    ["mimo-v2.5-pro", "mimo-v2.5"],
  );
  assert.equal(document.elements.aiModel.value, "mimo-v2.5-pro");
});

test("switching interface language keeps unsaved MiMo endpoint and key fields", async () => {
  const document = createDocument();
  const chrome = createChromeStorage(settings.normalize());

  options.initialize({
    document,
    chrome: chrome.api,
    YTD_SETTINGS: settings,
    YTD_AI_PROVIDERS: providers,
    navigator: { clipboard: { async writeText() {} } },
    confirm: () => true,
  });
  await flushTasks();

  document.elements.providerList.children
    .find((button) => button.dataset.provider === "mimo")
    .click();
  document.elements.aiBaseUrl.value = "https://token-plan-cn.xiaomimimo.com/v1";
  document.elements.aiApiKey.value = "unsaved-key";
  document.languageButtons.find((button) => button.dataset.language === "zh-CN").click();
  await flushTasks();

  assert.equal(document.elements.providerName.textContent, "小米 MiMo");
  assert.equal(
    document.elements.aiBaseUrl.value,
    "https://token-plan-cn.xiaomimimo.com/v1",
  );
  assert.equal(document.elements.aiApiKey.value, "unsaved-key");
  assert.equal(document.elements.aiModel.value, "mimo-v2.5-pro");
});
