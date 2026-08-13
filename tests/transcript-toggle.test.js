const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

class FakeElement {
  constructor() {
    this.attributes = {};
    this.disabled = false;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name];
  }
}

function createDocument() {
  const switchButton = new FakeElement();
  const tabs = [new FakeElement(), new FakeElement(), new FakeElement()];
  return {
    switchButton,
    tabs,
    api: {
      getElementById(id) {
        return id === "transcriptToggle" ? switchButton : null;
      },
      querySelectorAll(selector) {
        return selector === ".tab" ? tabs : [];
      },
    },
  };
}

function createStorage(initial = {}) {
  const values = { ...initial };
  return {
    values,
    api: {
      async get(key) {
        return Object.hasOwn(values, key) ? { [key]: values[key] } : {};
      },
      async set(items) {
        Object.assign(values, items);
      },
    },
  };
}

test("defaults off and disables every primary tab", async () => {
  const toggle = require("../transcript-toggle.js");
  const document = createDocument();
  const storage = createStorage();
  const controller = toggle.createController({
    document: document.api,
    storage: storage.api,
  });

  assert.equal(await controller.initialize(), false);
  assert.equal(document.switchButton.getAttribute("aria-checked"), "false");
  assert.ok(document.tabs.every((tab) => tab.disabled));
  assert.ok(
    document.tabs.every(
      (tab) => tab.getAttribute("aria-disabled") === "true",
    ),
  );
});

test("toggle enables tabs and persists the choice", async () => {
  const toggle = require("../transcript-toggle.js");
  const document = createDocument();
  const storage = createStorage();
  const controller = toggle.createController({
    document: document.api,
    storage: storage.api,
  });

  await controller.initialize();
  assert.equal(await controller.toggle(), true);
  assert.ok(document.tabs.every((tab) => !tab.disabled));
  assert.equal(storage.values[toggle.STORAGE_KEY], true);
});

test("restores enabled state and falls back off after read failure", async () => {
  const toggle = require("../transcript-toggle.js");
  const enabledDocument = createDocument();
  const enabledStorage = createStorage({ [toggle.STORAGE_KEY]: true });
  const enabledController = toggle.createController({
    document: enabledDocument.api,
    storage: enabledStorage.api,
  });

  assert.equal(await enabledController.initialize(), true);
  assert.ok(enabledDocument.tabs.every((tab) => !tab.disabled));

  const failedDocument = createDocument();
  const failedController = toggle.createController({
    document: failedDocument.api,
    storage: {
      async get() {
        throw new Error("unavailable");
      },
      async set() {},
    },
  });
  assert.equal(await failedController.initialize(), false);
  assert.ok(failedDocument.tabs.every((tab) => tab.disabled));
});

test("turning off invalidates requests started while Transcript was enabled", async () => {
  const toggle = require("../transcript-toggle.js");
  const document = createDocument();
  const storage = createStorage({ [toggle.STORAGE_KEY]: true });
  const controller = toggle.createController({
    document: document.api,
    storage: storage.api,
  });

  await controller.initialize();
  const requestToken = controller.createRequestToken();
  assert.equal(controller.isRequestCurrent(requestToken), true);

  await controller.toggle();

  assert.equal(controller.isRequestCurrent(requestToken), false);
  assert.equal(controller.createRequestToken(), null);
});

test("side panel starts disabled and guards programmatic tab switching", () => {
  const html = fs.readFileSync(path.join(root, "sidepanel.html"), "utf8");
  const source = fs.readFileSync(path.join(root, "sidepanel.js"), "utf8");

  assert.match(
    html,
    /id="transcriptToggle"[^>]*role="switch"[^>]*aria-checked="false"/,
  );
  assert.equal(
    (html.match(/class="tab[^\"]*"[^>]*disabled/g) || []).length,
    3,
  );
  assert.match(
    html,
    /<script src="transcript-toggle\.js"><\/script>[\s\S]*<script src="sidepanel\.js"><\/script>/,
  );
  assert.match(
    source,
    /function switchTab\(tabName\) \{\s*if \(!transcriptTabsController\?\.isEnabled\(\)\) return;/,
  );
  assert.match(html, /id="transcriptDisabledState"/);
  assert.match(
    source,
    /async function activateTranscriptFeature\(\)[\s\S]*checkCurrentTab\(\)/,
  );
  assert.match(
    source,
    /async function checkCurrentTab\(\) \{\s*if \(!transcriptTabsController\?\.isEnabled\(\)\) return;/,
  );
  assert.match(
    source,
    /message\.action === "startDigestFromButton"[\s\S]*if \(transcriptTabsController\?\.isEnabled\(\)\) checkCurrentTab\(\)/,
  );
  assert.match(
    source,
    /async function startDigest\(videoId, videoUrl\) \{\s*const requestToken = transcriptTabsController\?\.createRequestToken\(\);\s*if \(!requestToken\) return;/,
  );
  assert.match(
    source,
    /action: "fetchTranscript"[\s\S]*if \(!transcriptTabsController\.isRequestCurrent\(requestToken\)\) return;/,
  );
  assert.match(
    source,
    /function translateTranscript\(\) \{\s*if \(!transcriptTabsController\?\.isEnabled\(\)\) return;/,
  );
  assert.match(
    source,
    /function deactivateTranscriptFeature\(\)[\s\S]*clearPlayerCaptionOverlay\(\);[\s\S]*showState\("disabled"\);/,
  );
  assert.match(
    source,
    /if \(state !== "disabled" && !transcriptTabsController\?\.isEnabled\(\)\) \{\s*state = "disabled";/,
  );
});
