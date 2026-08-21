/** Settings-page controller for system and Xiaomi MiMo TTS providers. */
(() => {
  const defaultSettingsApi = globalThis.YTD_TTS_SETTINGS || (
    typeof require === "function" ? require("./tts-settings.js") : null
  );
  const SAMPLE_TEXT = "你好，这是一段 YouTube Digest 中文语音测试。";

  function getChineseVoices(voices) {
    return (Array.isArray(voices) ? voices : [])
      .filter((voice) => /^zh(?:-|$)/i.test(String(voice?.lang || "")))
      .slice()
      .sort((a, b) => String(a.lang).localeCompare(String(b.lang)));
  }

  function invalidateMimoVerification(value, settingsApi = defaultSettingsApi) {
    const normalized = settingsApi.normalize(value);
    normalized.activeProvider = "system";
    normalized.mimo.verifiedAt = 0;
    return normalized;
  }

  function canActivateMimo(config) {
    return !!String(config?.apiKey || "").trim() && Number(config?.verifiedAt) > 0;
  }

  function createController({ root, document, ttsSettings, onChange = () => {} }) {
    const byId = (id) => document.getElementById(id);
    const elements = {
      providerList: byId("ttsProviderList"),
      systemPanel: byId("systemTtsPanel"),
      mimoPanel: byId("mimoTtsPanel"),
      systemVoice: byId("systemVoice"),
      testSystem: byId("testSystemVoiceBtn"),
      accessMode: byId("mimoAccessMode"),
      baseUrl: byId("mimoTtsBaseUrl"),
      apiKey: byId("mimoTtsApiKey"),
      model: byId("mimoTtsModel"),
      voice: byId("mimoTtsVoice"),
      timeout: byId("mimoTtsTimeout"),
      retries: byId("mimoTtsRetries"),
      testMimo: byId("testTtsBtn"),
      status: byId("ttsStatus"),
    };
    let current = ttsSettings.normalize();
    let viewProvider = current.activeProvider;
    let activeTestPlayer = null;

    // Only one engine may audition at a time: starting a test stops the
    // system voice and any in-flight MiMo stream so they never overlap.
    function stopTestPlayback() {
      try { root.speechSynthesis?.cancel?.(); } catch (_error) {}
      const player = activeTestPlayer;
      activeTestPlayer = null;
      if (player) void player.cancelAll?.("TTS test superseded.").catch(() => {});
    }

    function setStatus(en, zh = en) {
      elements.status.textContent = document.documentElement.lang === "zh-CN" ? zh : en;
    }

    function captureInputs() {
      current.system.voiceURI = elements.systemVoice.value;
      current.mimo = ttsSettings.normalize({
        activeProvider: "mimo",
        mimo: {
          ...current.mimo,
          accessMode: elements.accessMode.value,
          baseUrl: elements.baseUrl.value,
          apiKey: elements.apiKey.value,
          model: elements.model.value,
          voice: elements.voice.value,
          timeoutMs: elements.timeout.value,
          retries: elements.retries.value,
        },
      }).mimo;
      onChange(ttsSettings.normalize(current));
    }

    function renderProvider() {
      for (const button of elements.providerList.querySelectorAll("button")) {
        button.setAttribute("aria-selected", String(button.dataset.ttsProvider === current.activeProvider));
      }
      elements.systemPanel.hidden = viewProvider !== "system";
      elements.mimoPanel.hidden = viewProvider !== "mimo";
    }

    function renderInputs() {
      elements.accessMode.value = current.mimo.accessMode;
      elements.baseUrl.value = current.mimo.baseUrl;
      elements.apiKey.value = current.mimo.apiKey;
      elements.model.value = current.mimo.model;
      elements.voice.value = current.mimo.voice;
      elements.timeout.value = String(current.mimo.timeoutMs);
      elements.retries.value = String(current.mimo.retries);
      populateSystemVoices();
      renderProvider();
    }

    function populateSystemVoices() {
      const voices = getChineseVoices(root.speechSynthesis?.getVoices?.() || []);
      elements.systemVoice.replaceChildren();
      for (const voice of voices) {
        const option = document.createElement("option");
        option.value = voice.voiceURI;
        option.textContent = `${voice.name} (${voice.lang})`;
        option.selected = voice.voiceURI === current.system.voiceURI;
        elements.systemVoice.append(option);
      }
      if (!current.system.voiceURI && voices[0]) {
        current.system.voiceURI = voices[0].voiceURI;
        elements.systemVoice.value = voices[0].voiceURI;
      }
      elements.testSystem.disabled = voices.length === 0;
      if (!voices.length) setStatus("No Chinese system voice is installed.", "未检测到系统中文语音。");
    }

    function markMimoDirty() {
      captureInputs();
      current = invalidateMimoVerification(current, ttsSettings);
      renderProvider();
      setStatus("MiMo changes must be tested before saving.", "MiMo 配置已更改，保存前必须重新测试。");
      onChange(ttsSettings.normalize(current));
    }

    function testSystemVoice() {
      const voices = getChineseVoices(root.speechSynthesis?.getVoices?.() || []);
      const voice = voices.find((item) => item.voiceURI === elements.systemVoice.value);
      if (!voice || !root.SpeechSynthesisUtterance) return;
      stopTestPlayback();
      const utterance = new root.SpeechSynthesisUtterance(SAMPLE_TEXT);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      utterance.onend = () => {
        current.activeProvider = "system";
        renderProvider();
        onChange(ttsSettings.normalize(current));
        setStatus("System voice selected.", "已选择系统本地语音。");
      };
      utterance.onerror = () => setStatus("System voice test failed.", "系统语音测试失败。");
      root.speechSynthesis.speak(utterance);
    }

    async function testMimo() {
      captureInputs();
      if (!current.mimo.apiKey) {
        setStatus("Enter a MiMo API key or access token.", "请输入 MiMo API 密钥或访问令牌。");
        return;
      }
      elements.testMimo.disabled = true;
      setStatus("Testing MiMo streaming audio…", "正在测试 MiMo 流式语音…");
      stopTestPlayback();
      let player;
      try {
        const origin = new URL(current.mimo.baseUrl).origin;
        if (root.chrome.permissions?.request) {
          const granted = await root.chrome.permissions.request({ origins: [`${origin}/*`] });
          if (!granted) throw new Error("MiMo host permission was not granted.");
        }
        const playerApi = root.YTD_TTS_STREAM_PLAYER;
        if (!playerApi?.createPlayer) throw new Error("Streaming audio is unavailable.");
        player = playerApi.createPlayer({ runtime: root.chrome.runtime });
        activeTestPlayer = player;
        await player.resume();
        const requestId = `tts-test-${Date.now()}`;
        const playback = player.enqueue({
          requestId,
          generation: 1,
          text: SAMPLE_TEXT,
          rate: 1,
          config: current.mimo,
        });
        await player.activate(requestId);
        await playback;
        current.mimo.verifiedAt = Date.now();
        current.activeProvider = "mimo";
        renderProvider();
        onChange(ttsSettings.normalize(current));
        setStatus("MiMo test passed and was selected.", "MiMo 测试通过并已选中。");
      } catch (error) {
        current.mimo.verifiedAt = 0;
        current.activeProvider = "system";
        renderProvider();
        setStatus(error.message || "MiMo test failed.", error.message || "MiMo 测试失败。");
      } finally {
        if (activeTestPlayer === player) activeTestPlayer = null;
        await player?.destroy?.().catch(() => {});
        elements.testMimo.disabled = false;
      }
    }

    function load(value) {
      current = ttsSettings.normalize(value);
      viewProvider = current.activeProvider;
      renderInputs();
    }

    function capture() {
      captureInputs();
      return ttsSettings.normalize(current);
    }

    function validate() {
      return current.activeProvider !== "mimo" || canActivateMimo(current.mimo);
    }

    for (const button of elements.providerList.querySelectorAll("button")) {
      button.addEventListener("click", () => {
        viewProvider = button.dataset.ttsProvider;
        if (viewProvider === "system") current.activeProvider = "system";
        renderProvider();
        onChange(ttsSettings.normalize(current));
      });
    }
    elements.accessMode.addEventListener("change", () => {
      elements.baseUrl.value = ttsSettings.defaultBaseUrl(elements.accessMode.value);
      markMimoDirty();
    });
    for (const element of [elements.baseUrl, elements.apiKey, elements.model, elements.voice, elements.timeout, elements.retries]) {
      element.addEventListener("input", markMimoDirty);
      element.addEventListener("change", markMimoDirty);
    }
    elements.systemVoice.addEventListener("change", captureInputs);
    elements.testSystem.addEventListener("click", testSystemVoice);
    elements.testMimo.addEventListener("click", testMimo);
    if (root.speechSynthesis) root.speechSynthesis.onvoiceschanged = populateSystemVoices;

    return { capture, load, validate };
  }

  const api = {
    SAMPLE_TEXT,
    canActivateMimo,
    createController,
    getChineseVoices,
    invalidateMimoVerification,
  };
  globalThis.YTD_TTS_OPTIONS = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
