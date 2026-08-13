/** Persistent master switch for the side-panel primary tabs. */
(() => {
  const STORAGE_KEY = "ytd_transcript_tabs_enabled";
  const DEFAULT_ENABLED = false;

  function createController({ document, storage }) {
    let enabled = DEFAULT_ENABLED;
    let revision = 0;

    function setEnabled(value) {
      const next = value === true;
      if (next !== enabled) revision += 1;
      enabled = next;
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
        // Keep the current page state when persistence is unavailable.
      }
      return next;
    }

    return {
      initialize,
      toggle,
      setEnabled,
      isEnabled: () => enabled,
      createRequestToken: () => (enabled ? revision : null),
      isRequestCurrent: (token) => enabled && token === revision,
    };
  }

  const api = { STORAGE_KEY, DEFAULT_ENABLED, createController };
  globalThis.YTD_TRANSCRIPT_TOGGLE = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
