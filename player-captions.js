(() => {
  const NATIVE_CAPTION_STYLE_ID = "ytd-player-captions-hide-native";
  const MAX_PRELOAD_SEGMENTS = 4;
  const state = {
    videoId: "",
    videoTitle: "",
    mode: "original",
    segments: [],
    translations: new Map(),
    failures: new Set(),
    requested: new Set(),
    enabled: false,
    generation: 0,
    player: null,
    video: null,
    host: null,
    lines: null,
    toggle: null,
  };

  function findActiveSegment(segments, currentTime) {
    if (!Array.isArray(segments) || currentTime < 0) return null;
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      if (currentTime >= segments[index].start) return segments[index];
    }
    return null;
  }

  function buildCaptionLines(segment, mode, translation, failed = false) {
    if (!segment) return [];
    const original = { text: segment.text, kind: "original" };
    const translated = translation
      ? { text: translation, kind: "translation" }
      : { text: failed ? "翻译不可用" : "翻译中…", kind: "status" };
    if (mode === "original") return [original];
    if (mode === "zh") return translation ? [translated] : [original, translated];
    return [original, translated];
  }

  function getTranslationBatch(segments, activeIndex, translations, requested) {
    const ids = [];
    const lastIndex = Math.min(
      segments.length - 1,
      Math.max(0, activeIndex) + MAX_PRELOAD_SEGMENTS - 1,
    );
    for (let index = Math.max(0, activeIndex); index <= lastIndex; index += 1) {
      const id = segments[index].id;
      if (!translations.has(id) && !requested.has(id)) ids.push(id);
    }
    return ids;
  }

  function findPlayer() {
    return document.querySelector(
      "#movie_player.html5-video-player, #movie_player, .html5-video-player",
    );
  }

  function removeNativeCaptionStyle() {
    document.getElementById(NATIVE_CAPTION_STYLE_ID)?.remove();
  }

  function updateNativeCaptionVisibility() {
    if (!state.enabled) {
      removeNativeCaptionStyle();
      return;
    }
    if (document.getElementById(NATIVE_CAPTION_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = NATIVE_CAPTION_STYLE_ID;
    style.textContent =
      "#movie_player .ytp-caption-window-container { display: none !important; }";
    document.head.appendChild(style);
  }

  function createUi(player) {
    if (state.host?.isConnected && state.host.parentElement === player) return;
    state.host?.remove();
    const host = document.createElement("div");
    host.id = "ytd-player-captions";
    host.style.cssText =
      "position:absolute;inset:0;z-index:9998;pointer-events:none;font-family:Arial,sans-serif;";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        .captions { position:absolute; left:3%; right:3%; bottom:11%; display:grid; gap:5px; text-align:center; color:#fff; font-size:clamp(16px,1.55vw,26px); font-weight:650; line-height:1.28; text-shadow:0 2px 5px #000; }
        .caption { width:fit-content; max-width:100%; margin:auto; padding:3px 9px; border-radius:3px; background:rgba(0,0,0,.72); box-decoration-break:clone; white-space:normal; overflow-wrap:anywhere; word-break:break-word; }
        .translation { color:#fff5c2; } .status { color:#d7d7d7; font-size:.78em; }
        button { position:absolute; top:16px; left:16px; bottom:auto; z-index:1; box-sizing:border-box; min-width:44px; height:44px; border:1px solid rgba(255,255,255,.65); border-radius:6px; color:#fff; background:rgba(0,0,0,.72); font-weight:700; cursor:pointer; pointer-events:auto; touch-action:manipulation; }
        button[aria-pressed="true"] { background:#c8674f; border-color:#c8674f; }
      </style>
      <div class="captions" aria-live="polite"></div>
      <button type="button" aria-label="Toggle YouTube Digest captions" aria-pressed="false">CC</button>
    `;
    state.host = host;
    state.lines = root.querySelector(".captions");
    state.toggle = root.querySelector("button");
    state.toggle.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    state.toggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      state.enabled = !state.enabled;
      state.toggle.setAttribute("aria-pressed", String(state.enabled));
      updateNativeCaptionVisibility();
      render();
    });
    player.appendChild(host);
  }

  function attachToPlayer() {
    const player = findPlayer();
    const video = player?.querySelector("video.html5-main-video");
    if (!player || !video) return false;
    if (state.video && state.video !== video) {
      state.video.removeEventListener("timeupdate", render);
      state.video.removeEventListener("seeking", render);
    }
    state.player = player;
    state.video = video;
    if (!player.style.position) player.style.position = "relative";
    createUi(player);
    video.removeEventListener("timeupdate", render);
    video.removeEventListener("seeking", render);
    video.addEventListener("timeupdate", render);
    video.addEventListener("seeking", render);
    updateNativeCaptionVisibility();
    return true;
  }

  function renderLines(lines) {
    if (!state.lines) return;
    state.lines.replaceChildren(
      ...lines.map((line) => {
        const element = document.createElement("div");
        element.className = `caption ${line.kind}`;
        element.textContent = line.text;
        return element;
      }),
    );
  }

  function render() {
    if (!state.enabled || !state.video || !state.segments.length) {
      renderLines([]);
      return;
    }
    const active = findActiveSegment(state.segments, state.video.currentTime);
    if (!active) {
      renderLines([]);
      return;
    }
    const activeIndex = state.segments.indexOf(active);
    renderLines(
      buildCaptionLines(
        active,
        state.mode,
        state.translations.get(active.id),
        state.failures.has(active.id),
      ),
    );
    if (state.mode !== "original") requestTranslations(activeIndex);
  }

  async function requestTranslations(activeIndex) {
    const ids = getTranslationBatch(
      state.segments,
      activeIndex,
      state.translations,
      state.requested,
    );
    if (!ids.length) return;
    ids.forEach((id) => state.requested.add(id));
    const generation = state.generation;
    const segments = state.segments.filter((segment) => ids.includes(segment.id));
    try {
      const result = await chrome.runtime.sendMessage({
        action: "translatePlayerCaptionBatch",
        videoId: state.videoId,
        videoTitle: state.videoTitle,
        content: { segments: segments.map(({ id, text }) => ({ id, text })) },
      });
      if (generation !== state.generation) return;
      if (result?.success) {
        for (const segment of result.translatedContent?.segments || []) {
          if (segment.text) state.translations.set(segment.id, segment.text);
          else state.failures.add(segment.id);
        }
      } else {
        ids.forEach((id) => state.failures.add(id));
      }
    } catch (_error) {
      if (generation === state.generation) ids.forEach((id) => state.failures.add(id));
    } finally {
      ids.forEach((id) => state.requested.delete(id));
      if (generation === state.generation) render();
    }
  }

  function setCaptionState(message) {
    const segments = Array.isArray(message.segments) ? message.segments : [];
    const isNewVideo = message.videoId !== state.videoId;
    state.generation += 1;
    state.videoId = typeof message.videoId === "string" ? message.videoId : "";
    state.videoTitle = typeof message.videoTitle === "string" ? message.videoTitle : "";
    state.mode = ["original", "zh", "bilingual"].includes(message.mode)
      ? message.mode
      : "original";
    state.segments = segments
      .filter((segment) => typeof segment?.id === "string" && typeof segment?.text === "string")
      .map((segment) => ({ id: segment.id, text: segment.text, start: Number(segment.start) || 0 }))
      .sort((a, b) => a.start - b.start);
    state.translations = new Map(
      Object.entries(message.translations || {}).filter(([, text]) => typeof text === "string" && text),
    );
    state.failures.clear();
    state.requested.clear();
    if (isNewVideo) state.enabled = false;
    if (!attachToPlayer()) setTimeout(() => {
      if (state.videoId === message.videoId) {
        attachToPlayer();
        render();
      }
    }, 500);
    if (state.toggle) state.toggle.setAttribute("aria-pressed", String(state.enabled));
    updateNativeCaptionVisibility();
    render();
  }

  function clearCaptionState() {
    state.generation += 1;
    state.enabled = false;
    state.segments = [];
    state.translations.clear();
    state.failures.clear();
    state.requested.clear();
    state.host?.remove();
    state.host = null;
    state.lines = null;
    state.toggle = null;
    state.video?.removeEventListener("timeupdate", render);
    state.video?.removeEventListener("seeking", render);
    state.video = null;
    state.player = null;
    removeNativeCaptionStyle();
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === "setPlayerCaptionState") {
      setCaptionState(message);
      sendResponse({ success: true });
      return false;
    }
    if (message.action === "clearPlayerCaptionState") {
      clearCaptionState();
      sendResponse({ success: true });
      return false;
    }
    return false;
  });

  document.addEventListener("yt-navigate-finish", clearCaptionState);
  globalThis.__YTD_PLAYER_CAPTIONS_TESTING__ = {
    buildCaptionLines,
    findActiveSegment,
    getTranslationBatch,
  };
})();
