# Transcript Master Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent, default-off `Transcript` master switch that enables or disables the `Transcript`, `Overview`, and `Notes` tabs without hiding or clearing their current content.

**Architecture:** A focused `transcript-toggle.js` module owns normalization, local persistence, and DOM disabled-state synchronization. `sidepanel.js` creates the controller and uses its `isEnabled()` guard before switching tabs, while `sidepanel.html` starts tabs disabled to prevent an enabled flash before storage loads.

**Tech Stack:** Chrome Manifest V3, vanilla JavaScript, HTML/CSS, `chrome.storage.local`, Node.js built-in test runner.

## Global Constraints

- The switch defaults to off when no stored value exists or storage reads fail.
- Disabling tabs must not hide the current panel or clear transcript, analysis, translation, or notes data.
- Re-enabling restores tab interaction without refetching data.
- The state is stored outside `ytd_settings`; do not change that public settings structure.
- The player `CC` control and `Original / 中文 / 双语` transcript modes are out of scope.
- Do not add external dependencies, permissions, API calls, or version changes.

---

### Task 1: Transcript toggle state controller

**Files:**
- Create: `transcript-toggle.js`
- Create: `tests/transcript-toggle.test.js`

**Interfaces:**
- Produces: `YTD_TRANSCRIPT_TOGGLE.STORAGE_KEY`, `YTD_TRANSCRIPT_TOGGLE.DEFAULT_ENABLED`, and `YTD_TRANSCRIPT_TOGGLE.createController({ document, storage })`.
- Controller methods: `initialize(): Promise<boolean>`, `toggle(): Promise<boolean>`, `setEnabled(boolean): boolean`, and `isEnabled(): boolean`.
- DOM contract: `#transcriptToggle` is the switch; `.tab` selects the three controlled buttons.

- [ ] **Step 1: Write the failing controller tests**

Add Node tests that use minimal fake elements and fake storage:

```js
test("defaults off and disables every primary tab", async () => {
  const controller = toggle.createController({ document, storage });
  assert.equal(await controller.initialize(), false);
  assert.equal(switchButton.getAttribute("aria-checked"), "false");
  assert.ok(tabs.every((tab) => tab.disabled));
  assert.ok(tabs.every((tab) => tab.getAttribute("aria-disabled") === "true"));
});

test("toggle enables tabs and persists the choice", async () => {
  await controller.initialize();
  assert.equal(await controller.toggle(), true);
  assert.ok(tabs.every((tab) => !tab.disabled));
  assert.equal(stored[toggle.STORAGE_KEY], true);
});

test("restores a stored enabled choice and falls back off after read failure", async () => {
  stored[toggle.STORAGE_KEY] = true;
  assert.equal(await controller.initialize(), true);
  storage.get = async () => { throw new Error("unavailable"); };
  assert.equal(await anotherController.initialize(), false);
});
```

- [ ] **Step 2: Run the focused test and verify red**

Run: `node --test tests/transcript-toggle.test.js`

Expected: FAIL because `transcript-toggle.js` does not exist.

- [ ] **Step 3: Implement the minimal controller**

Create a dependency-free module with this behavior:

```js
const STORAGE_KEY = "ytd_transcript_tabs_enabled";
const DEFAULT_ENABLED = false;

function createController({ document, storage }) {
  let enabled = DEFAULT_ENABLED;

  function setEnabled(value) {
    enabled = value === true;
    const switchButton = document.getElementById("transcriptToggle");
    switchButton?.setAttribute("aria-checked", String(enabled));
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.disabled = !enabled;
      tab.setAttribute("aria-disabled", String(!enabled));
    });
    return enabled;
  }

  async function initialize() {
    try {
      const stored = await storage.get(STORAGE_KEY);
      return setEnabled(stored[STORAGE_KEY] === true);
    } catch (_error) {
      return setEnabled(DEFAULT_ENABLED);
    }
  }

  async function toggle() {
    const next = setEnabled(!enabled);
    try {
      await storage.set({ [STORAGE_KEY]: next });
    } catch (_error) {
      // Keep the current page usable even when persistence fails.
    }
    return next;
  }

  return { initialize, toggle, setEnabled, isEnabled: () => enabled };
}
```

Expose the API through `globalThis.YTD_TRANSCRIPT_TOGGLE` in extension contexts and `module.exports` in Node tests.

- [ ] **Step 4: Run the focused test and verify green**

Run: `node --test tests/transcript-toggle.test.js`

Expected: all controller tests PASS.

- [ ] **Step 5: Commit the controller slice**

```bash
git add transcript-toggle.js tests/transcript-toggle.test.js
git commit -m "feat: 新增 Transcript 总开关状态控制器"
```

---

### Task 2: Side-panel UI and guarded tab switching

**Files:**
- Modify: `sidepanel.html:13-36,207-208`
- Modify: `sidepanel.css:118-198`
- Modify: `sidepanel.js:17-31,232-246,350-385,963-983`
- Modify: `tests/transcript-toggle.test.js`

**Interfaces:**
- Consumes: `YTD_TRANSCRIPT_TOGGLE.createController({ document, storage })` from Task 1.
- Produces: a `#transcriptToggle` button with `role="switch"`; `switchTab(tabName)` becomes a no-op while the controller reports disabled.

- [ ] **Step 1: Write failing integration assertions**

Extend the test to read production HTML and JavaScript and assert:

```js
assert.match(html, /id="transcriptToggle"[^>]*role="switch"[^>]*aria-checked="false"/);
assert.equal((html.match(/class="tab[^\"]*"[^>]*disabled/g) || []).length, 3);
assert.match(html, /<script src="transcript-toggle\.js"><\/script>[\s\S]*<script src="sidepanel\.js"><\/script>/);
assert.match(source, /if \(!transcriptTabsController\?\.isEnabled\(\)\) return;/);
```

- [ ] **Step 2: Run the focused test and verify red**

Run: `node --test tests/transcript-toggle.test.js`

Expected: FAIL because the switch markup, script integration, and tab guard are absent.

- [ ] **Step 3: Add accessible default-off markup**

In `sidepanel.html`, place the switch next to Settings and mark all tabs disabled initially:

```html
<div class="header-actions">
  <button
    class="transcript-toggle"
    id="transcriptToggle"
    type="button"
    role="switch"
    aria-checked="false"
  >
    <span>Transcript</span>
    <span class="toggle-track" aria-hidden="true"><span class="toggle-thumb"></span></span>
  </button>
  <button class="settings-btn" id="settingsBtn" type="button">Settings</button>
</div>
```

Add `disabled aria-disabled="true"` to all three `.tab` buttons. Load `transcript-toggle.js` after `settings.js` and before `sidepanel.js`.

- [ ] **Step 4: Wire initialization, click handling, and the hard guard**

In `sidepanel.js`, create the controller before installing listeners:

```js
let transcriptTabsController = null;

document.addEventListener("DOMContentLoaded", async () => {
  transcriptTabsController = YTD_TRANSCRIPT_TOGGLE.createController({
    document,
    storage: chrome.storage.local,
  });
  setupEventListeners();
  await transcriptTabsController.initialize();
  // existing initialization continues here
});
```

Wire `#transcriptToggle` to `transcriptTabsController.toggle()` and add this first line to `switchTab`:

```js
if (!transcriptTabsController?.isEnabled()) return;
```

- [ ] **Step 5: Style enabled, disabled, hover, focus, and narrow-panel states**

Add `.header-actions`, `.transcript-toggle`, `.toggle-track`, and `.toggle-thumb` rules. Use `aria-checked="true"` to apply the terracotta active color and move the thumb. Add `.tab:disabled` rules with reduced opacity, no hover fill, `cursor: not-allowed`, and no active-state shadow.

- [ ] **Step 6: Run focused tests and verify green**

Run: `node --test tests/transcript-toggle.test.js tests/transcript-selection.test.js tests/transcript-translation.test.js`

Expected: all tests PASS; the guard prevents disabled Overview from starting analysis.

- [ ] **Step 7: Commit the UI slice**

```bash
git add sidepanel.html sidepanel.css sidepanel.js tests/transcript-toggle.test.js
git commit -m "feat: 为侧边栏页签增加 Transcript 总开关"
```

---

### Task 3: Release integration and complete verification

**Files:**
- Modify: `scripts/check-release.sh`
- Modify: `tests/release.test.js`
- Modify: `project-context.md`

**Interfaces:**
- Consumes: `transcript-toggle.js` as a production dependency referenced by `sidepanel.html`.
- Produces: packaged extension containing the controller and release checks that reject a missing controller file.

- [ ] **Step 1: Write the failing release assertion**

Add assertions that `transcript-toggle.js` appears in both the package allowlist and required file list, and that `sidepanel.html` references it before `sidepanel.js`.

- [ ] **Step 2: Run the release test and verify red**

Run: `node --test tests/release.test.js`

Expected: FAIL because the new production file is not allowlisted.

- [ ] **Step 3: Add the production file to release packaging and context**

Add `transcript-toggle.js` to `public_allowlist` and `required_public_files` in `scripts/check-release.sh`. Add a concise Transcript master-switch entry to `project-context.md`, including default-off behavior and the storage key.

- [ ] **Step 4: Run all verification commands**

Run:

```bash
npm test
npm run check
npm run package
git diff --check
```

Expected: all tests and release checks PASS, and `dist/youtube-digest-v1.1.6.zip` is recreated with `transcript-toggle.js` included.

- [ ] **Step 5: Commit release integration**

```bash
git add scripts/check-release.sh tests/release.test.js project-context.md
git commit -m "test: 验证 Transcript 总开关发布内容"
```
