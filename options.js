const YTD_OPTIONS = (() => {
  const LANGUAGE_STORAGE_KEY = "ytd_options_language";
  const PREVIEW_STORAGE_PREFIX = "youtubeDigestPreview:";
  const SUPPORTED_LANGUAGES = new Set(["en", "zh-CN"]);

  const COPY = {
    en: {
      pageTitle: "YouTube Digest Settings",
      languageGroupLabel: "Interface language",
      heading: "Bring your own API keys",
      lede:
        "Keys stay in this Chrome profile and are sent only to the selected AI provider and Supadata. This open-source extension has no developer server or analytics.",
      transcriptProvider: "Transcript provider",
      supadataApiKeyLabel: "Supadata API key",
      supadataHelp: "Used to fetch timestamped YouTube subtitles. ",
      supadataLink: "Create a Supadata account and key",
      supadataHelpSuffix:
        ". Supadata generates the key during onboarding.",
      aiProvider: "AI provider",
      endpointLabel: "API endpoint",
      providerApiKeyLabel: "API key",
      modelLabel: "Model",
      fetchModels: "Fetch models",
      providerHelp: "The selected provider and model power all AI features. ",
      providerKeyLink: "Create an API key",
      providerHelpText: ({ name }) =>
        `The selected ${name} provider and model power all AI features.`,
      localProviderHelpText:
        "The selected local OpenAI-compatible service powers all AI features. An API key is optional.",
      providerPrivacyText: ({ name }) =>
        `When you use AI features, ${name} receives the video transcript and relevant video context. Review the provider's terms and pricing before saving.`,
      localProviderPrivacyText:
        "When you use AI features, video transcripts and related context are sent only to your configured local service.",
      providerKeyPlaceholder: ({ name }) => `Paste your ${name} key`,
      localKeyPlaceholder: "Optional API key",
      providerSummaryLabel: "Supported AI provider",
      providerBadge: "Supported in this version",
      deepseekApiKeyLabel: "DeepSeek API key",
      deepseekHelp:
        "YouTube Digest uses DeepSeek V4 Flash for overviews, explanations, translation, and note polishing. ",
      deepseekLink: "Create a DeepSeek API key",
      deepseekHelpSuffix: ".",
      privacyNote:
        "When you use AI features, DeepSeek receives the video transcript and relevant video context. Review DeepSeek's terms and pricing before saving.",
      saveSettings: "Save settings",
      localRemix: "Local remix",
      customizationTitle: "Want to use another AI model?",
      customizationPurpose: "Edit and copy a safe prompt for your coding agent",
      agentBadge: "Coding agent ready",
      customizationIntro:
        "You can edit the prompt directly. Complete these three steps before copying:",
      customizationStepFolder:
        "Open the extracted YouTube Digest project folder in your coding agent.",
      customizationStepReplace:
        "Replace [PROVIDER] and [MODEL] with the service and model you want to use.",
      customizationStepKeys:
        "Never include API keys in the prompt or chat. Enter them yourself after the code is ready.",
      customizationPromptLabel: "Editable customization prompt",
      customizationReminderLabel: "Prompt reminder",
      customizationReminder:
        "Before copying, replace [PROVIDER] and [MODEL] with the provider and model you want to use.",
      customizationPrompt:
        "Customize this local YouTube Digest workspace to use [PROVIDER] with [MODEL]. Work only in the current workspace. Before editing, verify that it contains manifest.json and that the manifest name is YouTube Digest. If verification fails, stop and ask me to open the extracted YouTube Digest project folder in my coding agent. Do not search other folders, edit a guessed copy, assume an installation path, or claim Chrome can reveal the absolute OS source path. Update the provider's API endpoint, request format, and minimum Chrome host permissions. Preserve bring-your-own-key and local Chrome storage. Never put API keys in source code, commits, logs, screenshots, this prompt, or chat; after the code is ready, tell me where to enter the key myself. Keep DeepSeek-only request fields and retry behavior isolated to DeepSeek. Handle provider-specific rules separately so one provider does not affect another. Update README.md, README.zh-CN.md, PRIVACY.md, SECURITY.md, and tests. Run npm test, npm run check, and npm run package. Then explain how to reload the unpacked extension and test it on a real YouTube video.",
      copyCustomizationPrompt: "Copy edited prompt",
      localData: "Local data",
      localDataHelp:
        "Digests, translations, and notes are stored only in this Chrome profile. You can remove them at any time.",
      clearCache: "Clear cached digests",
      deleteNotes: "Delete all notes",
      resetData: "Reset extension data",
      footer:
        'Read <a href="PRIVACY.md" target="_blank">PRIVACY.md</a> in the repository for the complete data-flow description.',
      migrationWarning:
        "Custom provider settings were removed safely. Your Supadata key was kept, but the AI key was cleared. Enter a DeepSeek API key to continue.",
      saving: "Saving…",
      addSupadataKey: "Add a Supadata API key.",
      addDeepseekKey: "Add a DeepSeek API key.",
      addProviderKey: "Add an API key for the selected provider.",
      saved: "Saved. Reopen YouTube Digest to use these settings.",
      saveFailed: "Could not save settings. Please try again.",
      copying: "Copying…",
      promptCopied: "Edited prompt copied.",
      copyFailed:
        "Could not copy the prompt. Select the prompt text and copy it manually.",
      clearedDigests: ({ count }) =>
        `Cleared ${count} cached digest${count === 1 ? "" : "s"}.`,
      notesDeleted: "Deleted all saved notes.",
      resetConfirm:
        "Delete API keys, cached digests, translations, and saved notes from this Chrome profile?",
      allDataDeleted: "All YouTube Digest data was deleted.",
      settingsLoadFailed:
        "Could not load saved settings. You can still preview this page.",
    },
    "zh-CN": {
      pageTitle: "YouTube Digest 设置",
      languageGroupLabel: "界面语言",
      heading: "使用你自己的 API 密钥",
      lede:
        "密钥仅保存在当前 Chrome 个人资料中，只会发送给 Supadata 和当前选择的 AI 服务。本开源扩展没有开发者服务器，也不使用分析服务。",
      transcriptProvider: "字幕服务",
      supadataApiKeyLabel: "Supadata API 密钥",
      supadataHelp: "用于获取带时间戳的 YouTube 字幕。",
      supadataLink: "创建 Supadata 账号并获取密钥",
      supadataHelpSuffix: "。Supadata 会在引导流程中生成密钥。",
      aiProvider: "AI 服务",
      endpointLabel: "API Endpoint",
      providerApiKeyLabel: "API 密钥",
      modelLabel: "模型",
      fetchModels: "获取模型",
      providerHelp: "当前选择的服务商和模型会用于全部 AI 功能。",
      providerKeyLink: "创建 API 密钥",
      providerHelpText: ({ name }) =>
        `当前选择的 ${name} 服务商和模型会用于全部 AI 功能。`,
      localProviderHelpText:
        "当前选择的本地 OpenAI-compatible 服务会用于全部 AI 功能，API 密钥可不填写。",
      providerPrivacyText: ({ name }) =>
        `使用 AI 功能时，${name} 会收到视频字幕及相关视频上下文。保存前请查看该服务商的条款和价格。`,
      localProviderPrivacyText:
        "使用 AI 功能时，视频字幕及相关上下文只会发送到你配置的本地服务。",
      providerKeyPlaceholder: ({ name }) => `粘贴 ${name} API 密钥`,
      localKeyPlaceholder: "可选 API 密钥",
      providerSummaryLabel: "支持的 AI 服务",
      providerBadge: "当前版本支持",
      deepseekApiKeyLabel: "DeepSeek API 密钥",
      deepseekHelp:
        "YouTube Digest 使用 DeepSeek V4 Flash 生成概览、解释内容、翻译字幕和润色笔记。",
      deepseekLink: "创建 DeepSeek API 密钥",
      deepseekHelpSuffix: "。",
      privacyNote:
        "使用 AI 功能时，DeepSeek 会收到视频字幕及相关视频上下文。保存前请查看 DeepSeek 的服务条款和价格。",
      saveSettings: "保存设置",
      localRemix: "本地改造",
      customizationTitle: "想使用其他 AI 模型？",
      customizationPurpose: "编辑并复制一段可安全交给编程 Agent 的提示词",
      agentBadge: "可交给编程 Agent",
      customizationIntro: "你可以直接编辑提示词。复制前完成以下三步：",
      customizationStepFolder:
        "在编程 Agent 中打开 YouTube Digest 解压后的项目文件夹。",
      customizationStepReplace:
        "把 [PROVIDER] 和 [MODEL] 替换成你想使用的服务和模型。",
      customizationStepKeys:
        "不要在提示词或聊天中加入 API 密钥。代码准备好后，请自行填写。",
      customizationPromptLabel: "可编辑的自定义提示词",
      customizationReminderLabel: "提示词提醒",
      customizationReminder:
        "复制前，请先把 [PROVIDER] 和 [MODEL] 替换成你想使用的服务和模型。",
      customizationPrompt:
        "请把当前本地 YouTube Digest 工作区改为使用 [PROVIDER] 提供的 [MODEL]。只在当前工作区中操作。编辑前，先确认其中包含 manifest.json，且 manifest 中的 name 是 YouTube Digest。如果验证失败，请停止，并让我在编程 Agent 中打开 YouTube Digest 解压后的项目文件夹。不要搜索其他文件夹，不要编辑猜测的副本，不要假设安装路径，也不要声称 Chrome 可以显示操作系统中的绝对源码路径。更新该服务的 API endpoint、请求格式和最少的 Chrome host permissions。保留用户自带密钥模式和 Chrome 本地存储。不要把 API 密钥写入源代码、提交记录、日志、截图、这段提示词或聊天；代码准备好后，请告诉我应该在哪里自行填写密钥。DeepSeek 专用的请求参数和重试逻辑继续只用于 DeepSeek。新服务的专属规则请单独处理，避免相互影响。更新 README.md、README.zh-CN.md、PRIVACY.md、SECURITY.md 和测试。运行 npm test、npm run check 和 npm run package。最后，说明如何重新加载已解压的扩展，并在真实 YouTube 视频上测试。",
      copyCustomizationPrompt: "复制编辑后的提示词",
      localData: "本地数据",
      localDataHelp:
        "摘要、翻译和笔记仅保存在当前 Chrome 个人资料中。你可以随时删除。",
      clearCache: "清除缓存的摘要",
      deleteNotes: "删除全部笔记",
      resetData: "重置扩展数据",
      footer:
        '完整数据流说明请参阅仓库中的 <a href="PRIVACY.md" target="_blank">PRIVACY.md</a>。',
      migrationWarning:
        "已安全移除自定义服务设置。Supadata 密钥已保留，AI 密钥已清除。请输入 DeepSeek API 密钥以继续使用。",
      saving: "正在保存…",
      addSupadataKey: "请添加 Supadata API 密钥。",
      addDeepseekKey: "请添加 DeepSeek API 密钥。",
      addProviderKey: "请添加当前服务商的 API 密钥。",
      saved: "已保存。请重新打开 YouTube Digest 以使用这些设置。",
      saveFailed: "无法保存设置，请重试。",
      copying: "正在复制…",
      promptCopied: "已复制编辑后的提示词。",
      copyFailed: "无法复制提示词。请选中提示词文本并手动复制。",
      clearedDigests: ({ count }) => `已清除 ${count} 条缓存摘要。`,
      notesDeleted: "已删除全部已保存的笔记。",
      resetConfirm:
        "要从当前 Chrome 个人资料中删除 API 密钥、缓存摘要、翻译和已保存的笔记吗？",
      allDataDeleted: "已删除全部 YouTube Digest 数据。",
      settingsLoadFailed: "无法加载已保存的设置，但你仍可预览此页面。",
    },
  };

  function normalizeLanguage(language) {
    return SUPPORTED_LANGUAGES.has(language) ? language : "en";
  }

  function translate(language, key, params = {}) {
    const normalizedLanguage = normalizeLanguage(language);
    const value = COPY[normalizedLanguage][key] ?? COPY.en[key] ?? "";
    return typeof value === "function" ? value(params) : value;
  }

  function createStorageAdapter(chromeApi, fallbackStorage) {
    const chromeStorage = chromeApi?.storage?.local;
    const memoryStorage = new Map();

    function fallbackKeys() {
      const keys = [];
      if (!fallbackStorage) return keys;
      try {
        for (let index = 0; index < fallbackStorage.length; index += 1) {
          const key = fallbackStorage.key(index);
          if (key?.startsWith(PREVIEW_STORAGE_PREFIX)) keys.push(key);
        }
      } catch (_error) {
        return [];
      }
      return keys;
    }

    function readFallbackValue(key) {
      try {
        const rawValue = fallbackStorage?.getItem(
          `${PREVIEW_STORAGE_PREFIX}${key}`,
        );
        if (rawValue !== null && rawValue !== undefined) {
          return JSON.parse(rawValue);
        }
      } catch (_error) {
        // Fall through to memory when localStorage is unavailable or malformed.
      }
      return memoryStorage.get(key);
    }

    function writeFallbackValue(key, value) {
      memoryStorage.set(key, value);
      try {
        fallbackStorage?.setItem(
          `${PREVIEW_STORAGE_PREFIX}${key}`,
          JSON.stringify(value),
        );
      } catch (_error) {
        // The in-memory copy keeps a restricted preview functional.
      }
    }

    return {
      async get(keys) {
        if (chromeStorage) return chromeStorage.get(keys);

        const requestedKeys =
          keys === null
            ? [
                ...new Set([
                  ...memoryStorage.keys(),
                  ...fallbackKeys().map((key) =>
                    key.slice(PREVIEW_STORAGE_PREFIX.length),
                  ),
                ]),
              ]
            : Array.isArray(keys)
              ? keys
              : [keys];

        return Object.fromEntries(
          requestedKeys
            .map((key) => [key, readFallbackValue(key)])
            .filter(([, value]) => value !== undefined),
        );
      },

      async set(items) {
        if (chromeStorage) return chromeStorage.set(items);
        for (const [key, value] of Object.entries(items)) {
          writeFallbackValue(key, value);
        }
      },

      async remove(keys) {
        if (chromeStorage) return chromeStorage.remove(keys);
        for (const key of Array.isArray(keys) ? keys : [keys]) {
          memoryStorage.delete(key);
          try {
            fallbackStorage?.removeItem(`${PREVIEW_STORAGE_PREFIX}${key}`);
          } catch (_error) {
            // Memory removal is sufficient for this preview session.
          }
        }
      },

      async clear() {
        if (chromeStorage) return chromeStorage.clear();
        memoryStorage.clear();
        for (const key of fallbackKeys()) {
          try {
            fallbackStorage.removeItem(key);
          } catch (_error) {
            // Continue clearing any remaining preview keys.
          }
        }
      },
    };
  }

  async function readPreferredLanguage(storage) {
    const stored = await storage.get(LANGUAGE_STORAGE_KEY);
    return normalizeLanguage(stored[LANGUAGE_STORAGE_KEY]);
  }

  async function persistPreferredLanguage(storage, language) {
    const normalizedLanguage = normalizeLanguage(language);
    await storage.set({ [LANGUAGE_STORAGE_KEY]: normalizedLanguage });
    return normalizedLanguage;
  }

  function updateLanguageButtonState(buttons, language) {
    const normalizedLanguage = normalizeLanguage(language);
    for (const button of buttons) {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.language === normalizedLanguage),
      );
    }
  }

  function updateLocalizedPrompt(textarea, prompt) {
    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    const selectionDirection = textarea.selectionDirection;
    const scrollTop = textarea.scrollTop;
    const scrollLeft = textarea.scrollLeft;

    textarea.value = prompt;

    if (
      Number.isInteger(selectionStart) &&
      Number.isInteger(selectionEnd) &&
      typeof textarea.setSelectionRange === "function"
    ) {
      textarea.setSelectionRange(
        Math.min(selectionStart, prompt.length),
        Math.min(selectionEnd, prompt.length),
        selectionDirection || "none",
      );
    }
    textarea.scrollTop = scrollTop;
    textarea.scrollLeft = scrollLeft;
  }

  function createPromptDrafts() {
    return {
      en: translate("en", "customizationPrompt"),
      "zh-CN": translate("zh-CN", "customizationPrompt"),
    };
  }

  function switchPromptDraft(
    drafts,
    currentLanguage,
    nextLanguage,
    currentValue,
  ) {
    const normalizedCurrentLanguage = normalizeLanguage(currentLanguage);
    const normalizedNextLanguage = normalizeLanguage(nextLanguage);
    drafts[normalizedCurrentLanguage] = String(currentValue ?? "");
    if (typeof drafts[normalizedNextLanguage] !== "string") {
      drafts[normalizedNextLanguage] = translate(
        normalizedNextLanguage,
        "customizationPrompt",
      );
    }
    return {
      language: normalizedNextLanguage,
      prompt: drafts[normalizedNextLanguage],
    };
  }

  async function copyPromptValue(clipboard, value) {
    await clipboard.writeText(value);
  }

  function getSafeLocalStorage(root) {
    try {
      return root.localStorage;
    } catch (_error) {
      return null;
    }
  }

  function initialize(root = globalThis) {
    const doc = root.document;
    const settingsApi = root.YTD_SETTINGS;
    const providerApi = root.YTD_AI_PROVIDERS;
    if (!doc || !settingsApi || !providerApi) return;

    const storage = createStorageAdapter(
      root.chrome,
      getSafeLocalStorage(root),
    );
    const form = doc.getElementById("settingsForm");
    const aiApiKeyInput = doc.getElementById("aiApiKey");
    const aiBaseUrlInput = doc.getElementById("aiBaseUrl");
    const aiModelSelect = doc.getElementById("aiModel");
    const providerList = doc.getElementById("providerList");
    const providerName = doc.getElementById("providerName");
    const providerHelp = doc.getElementById("providerHelp");
    const privacyNote = doc.getElementById("privacyNote");
    const providerKeyLink = doc.getElementById("providerKeyLink");
    const fetchModelsBtn = doc.getElementById("fetchModelsBtn");
    const modelStatus = doc.getElementById("modelStatus");
    const supadataApiKeyInput = doc.getElementById("supadataApiKey");
    const customizationPrompt = doc.getElementById("customizationPrompt");
    const copyCustomizationPromptBtn = doc.getElementById(
      "copyCustomizationPromptBtn",
    );
    const copyStatus = doc.getElementById("copyStatus");
    const saveStatus = doc.getElementById("saveStatus");
    const dataStatus = doc.getElementById("dataStatus");
    const languageButtons = [...doc.querySelectorAll("[data-language]")];
    const statusStates = new Map();
    const promptDrafts = createPromptDrafts();
    let currentLanguage = "en";
    let currentSettings = settingsApi.normalize();
    let persistenceQueue = Promise.resolve();
    const providerKeyUrls = {
      deepseek: "https://platform.deepseek.com/api_keys",
      groq: "https://console.groq.com/keys",
      qwen: "https://dashscope.console.aliyun.com/apiKey",
      volcengine: "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",
      gemini: "https://aistudio.google.com/app/apikey",
      zhipu: "https://open.bigmodel.cn/usercenter/apikeys",
      mimo: "https://platform.xiaomimimo.com/",
      custom: "https://platform.openai.com/api-keys",
      local: "",
    };

    function setModelStatus(text = "") {
      modelStatus.textContent = text;
    }

    function renderModelOptions(config) {
      aiModelSelect.replaceChildren();
      for (const model of config.models) {
        const option = doc.createElement("option");
        option.value = model.id;
        option.textContent = model.name;
        option.selected = model.id === config.activeModel;
        aiModelSelect.append(option);
      }
    }

    function renderProvider() {
      const provider = providerApi.getProvider(currentSettings.activeProvider);
      const config = currentSettings.providers[provider.id];
      providerName.textContent = provider.name;
      aiBaseUrlInput.value = config.baseUrl;
      aiApiKeyInput.value = config.apiKey;
      aiApiKeyInput.placeholder = translate(
        currentLanguage,
        provider.id === "local" ? "localKeyPlaceholder" : "providerKeyPlaceholder",
        { name: provider.name },
      );
      renderModelOptions(config);
      providerHelp.textContent = translate(
        currentLanguage,
        provider.id === "local" ? "localProviderHelpText" : "providerHelpText",
        { name: provider.name },
      );
      privacyNote.textContent = translate(
        currentLanguage,
        provider.id === "local" ? "localProviderPrivacyText" : "providerPrivacyText",
        { name: provider.name },
      );
      providerKeyLink.href = providerKeyUrls[provider.id] || "#";
      providerKeyLink.hidden = !providerKeyUrls[provider.id];
      for (const button of providerList.querySelectorAll("button")) {
        button.setAttribute("aria-selected", String(button.dataset.provider === provider.id));
      }
    }

    function renderProviderList() {
      providerList.replaceChildren();
      for (const provider of providerApi.listProviders()) {
        const button = doc.createElement("button");
        button.type = "button";
        button.dataset.provider = provider.id;
        button.textContent = provider.name;
        button.setAttribute("role", "option");
        button.addEventListener("click", () => switchProvider(provider.id));
        providerList.append(button);
      }
    }

    function captureCurrentProvider() {
      const provider = providerApi.getProvider(currentSettings.activeProvider);
      currentSettings.providers[provider.id] = providerApi.normalizeProviderConfig(provider.id, {
        ...currentSettings.providers[provider.id],
        baseUrl: aiBaseUrlInput.value,
        apiKey: aiApiKeyInput.value,
        activeModel: aiModelSelect.value,
      });
      currentSettings.activeModel = currentSettings.providers[provider.id].activeModel;
    }

    function persistCurrentSelection() {
      captureCurrentProvider();
      currentSettings = settingsApi.normalize(currentSettings);
      const snapshot = currentSettings;
      const write = persistenceQueue
        .catch(() => {})
        .then(() => storage.set({ [settingsApi.STORAGE_KEY]: snapshot }));
      persistenceQueue = write;
      return write;
    }

    function switchProvider(providerId) {
      captureCurrentProvider();
      currentSettings.activeProvider = providerApi.getProvider(providerId).id;
      currentSettings.activeModel = currentSettings.providers[currentSettings.activeProvider].activeModel;
      setModelStatus("");
      renderProvider();
      void persistCurrentSelection().catch(() => {
        setModelStatus(currentLanguage === "zh-CN" ? "服务商切换未保存，请点击保存设置。" : "Provider selection was not saved; click Save settings.");
      });
    }

    async function requestProviderPermission(baseUrl) {
      if (!root.chrome?.permissions?.request) return true;
      try {
        const origin = new URL(baseUrl).origin;
        return await root.chrome.permissions.request({ origins: [`${origin}/*`] });
      } catch (_error) {
        return false;
      }
    }

    async function fetchModels() {
      captureCurrentProvider();
      const provider = providerApi.getProvider(currentSettings.activeProvider);
      const config = currentSettings.providers[provider.id];
      renderProvider();
      setModelStatus(currentLanguage === "zh-CN" ? "正在获取模型…" : "Fetching models…");
      if (!(await requestProviderPermission(config.baseUrl))) {
        setModelStatus(currentLanguage === "zh-CN" ? "未获得该服务商的域名权限。" : "Provider domain permission was not granted.");
        return;
      }
      try {
        await persistCurrentSelection();
        const result = root.chrome?.runtime?.sendMessage
          ? await root.chrome.runtime.sendMessage({ action: "fetchProviderModels", providerId: provider.id })
          : { success: false, models: provider.defaultModels, source: "fallback" };
        const models = providerApi.withModelFallback(provider.id, result?.models).models;
        currentSettings.providers[provider.id] = providerApi.normalizeProviderConfig(provider.id, {
          ...config,
          models,
          activeModel: config.activeModel,
          modelsFetchedAt: Date.now(),
        });
        currentSettings.activeModel = currentSettings.providers[provider.id].activeModel;
        renderProvider();
        await persistCurrentSelection();
        setModelStatus(result?.source === "fallback"
          ? (currentLanguage === "zh-CN" ? "在线列表不可用，已使用内置模型。" : "Online list unavailable; built-in models are shown.")
          : (currentLanguage === "zh-CN" ? "模型列表已更新。" : "Model list updated."));
      } catch (_error) {
        setModelStatus(currentLanguage === "zh-CN" ? "获取模型失败，已保留当前列表。" : "Could not fetch models; current list was kept.");
      }
    }

    function renderStatus(element) {
      const state = statusStates.get(element);
      element.textContent = state
        ? translate(currentLanguage, state.key, state.params)
        : "";
    }

    function setStatus(element, key, params = {}) {
      statusStates.set(element, { key, params });
      renderStatus(element);
    }

    function applyLanguage(language) {
      const nextDraft = switchPromptDraft(
        promptDrafts,
        currentLanguage,
        language,
        customizationPrompt.value,
      );
      currentLanguage = nextDraft.language;
      doc.documentElement.lang = currentLanguage;
      doc.title = translate(currentLanguage, "pageTitle");

      for (const element of doc.querySelectorAll("[data-i18n]")) {
        element.textContent = translate(
          currentLanguage,
          element.dataset.i18n,
        );
      }
      for (const element of doc.querySelectorAll("[data-i18n-html]")) {
        element.innerHTML = translate(
          currentLanguage,
          element.dataset.i18nHtml,
        );
      }
      for (const element of doc.querySelectorAll("[data-i18n-aria-label]")) {
        element.setAttribute(
          "aria-label",
          translate(currentLanguage, element.dataset.i18nAriaLabel),
        );
      }

      updateLocalizedPrompt(
        customizationPrompt,
        nextDraft.prompt,
      );
      updateLanguageButtonState(languageButtons, currentLanguage);
      for (const element of statusStates.keys()) renderStatus(element);
      if (providerList.children.length) renderProvider();
    }

    async function loadSettings() {
      try {
        const stored = await storage.get(settingsApi.STORAGE_KEY);
        const migration = settingsApi.migrateLegacyCustom(
          stored[settingsApi.STORAGE_KEY],
        );
        const settings = migration.settings;
        currentSettings = settings;
        renderProviderList();
        renderProvider();
        supadataApiKeyInput.value = settings.supadataApiKey;
        if (migration.migrated) {
          await storage.set({ [settingsApi.STORAGE_KEY]: settings });
          setStatus(saveStatus, "migrationWarning");
        }
      } catch (_error) {
        setStatus(saveStatus, "settingsLoadFailed");
      }
    }

    async function loadOptions() {
      try {
        applyLanguage(await readPreferredLanguage(storage));
      } catch (_error) {
        applyLanguage("en");
      }
      await loadSettings();
    }

    async function saveSettings(event) {
      event.preventDefault();
      setStatus(saveStatus, "saving");

      captureCurrentProvider();
      currentSettings.supadataApiKey = supadataApiKeyInput.value;
      const settings = settingsApi.normalize(currentSettings);

      if (!settings.supadataApiKey) {
        setStatus(saveStatus, "addSupadataKey");
        return;
      }
      const activeConfig = settings.providers[settings.activeProvider];
      if (settings.activeProvider !== "local" && !activeConfig.apiKey) {
        setStatus(saveStatus, "addProviderKey");
        return;
      }
      if (!(await requestProviderPermission(activeConfig.baseUrl))) {
        setStatus(saveStatus, "saveFailed");
        return;
      }

      try {
        await storage.set({ [settingsApi.STORAGE_KEY]: settings });
        currentSettings = settings;
        setStatus(saveStatus, "saved");
      } catch (_error) {
        setStatus(saveStatus, "saveFailed");
      }
    }

    async function copyCustomizationPrompt() {
      setStatus(copyStatus, "copying");
      try {
        await copyPromptValue(
          root.navigator.clipboard,
          customizationPrompt.value,
        );
        setStatus(copyStatus, "promptCopied");
      } catch (_error) {
        setStatus(copyStatus, "copyFailed");
      }
    }

    async function clearCachedDigests() {
      const all = await storage.get(null);
      const keys = Object.keys(all).filter((key) => key.startsWith("digest_"));
      if (keys.length) await storage.remove(keys);
      setStatus(dataStatus, "clearedDigests", { count: keys.length });
    }

    async function clearNotes() {
      await storage.remove("ytd_notes");
      setStatus(dataStatus, "notesDeleted");
    }

    async function resetAllData() {
      const confirmed = root.confirm(
        translate(currentLanguage, "resetConfirm"),
      );
      if (!confirmed) return;

      await storage.clear();
      await persistPreferredLanguage(storage, currentLanguage);
      await loadSettings();
      setStatus(dataStatus, "allDataDeleted");
    }

    form.addEventListener("submit", saveSettings);
    fetchModelsBtn.addEventListener("click", fetchModels);
    aiModelSelect.addEventListener("change", () => {
      currentSettings.activeModel = aiModelSelect.value;
      captureCurrentProvider();
      void persistCurrentSelection().catch(() => {
        setModelStatus(currentLanguage === "zh-CN" ? "模型切换未保存，请点击保存设置。" : "Model selection was not saved; click Save settings.");
      });
    });
    copyCustomizationPromptBtn.addEventListener(
      "click",
      copyCustomizationPrompt,
    );
    doc
      .getElementById("clearCacheBtn")
      .addEventListener("click", clearCachedDigests);
    doc.getElementById("clearNotesBtn").addEventListener("click", clearNotes);
    doc.getElementById("resetBtn").addEventListener("click", resetAllData);
    for (const button of languageButtons) {
      button.addEventListener("click", async () => {
        const language = button.dataset.language;
        captureCurrentProvider();
        applyLanguage(language);
        await persistPreferredLanguage(storage, language);
      });
    }

    if (doc.readyState === "loading") {
      doc.addEventListener("DOMContentLoaded", loadOptions, { once: true });
    } else {
      void loadOptions();
    }
  }

  return {
    COPY,
    LANGUAGE_STORAGE_KEY,
    copyPromptValue,
    createPromptDrafts,
    createStorageAdapter,
    normalizeLanguage,
    persistPreferredLanguage,
    readPreferredLanguage,
    translate,
    updateLanguageButtonState,
    updateLocalizedPrompt,
    switchPromptDraft,
    initialize,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = YTD_OPTIONS;
}

if (typeof document !== "undefined") {
  YTD_OPTIONS.initialize();
}
