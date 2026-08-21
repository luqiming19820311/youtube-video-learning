/** Coordinates Chinese translation, TTS playback, and YouTube synchronization. */
(() => {
  const load = (globalValue, path) => globalValue || (
    typeof require === "function" ? require(path) : null
  );
  const voiceSync = load(globalThis.YTD_VOICE_SYNC, "./voice-sync.js");
  const settingsApi = load(globalThis.YTD_SETTINGS, "./settings.js");
  const defaultPlayerApi = load(globalThis.YTD_TTS_STREAM_PLAYER, "./tts-stream-player.js");
  const translationApi = load(globalThis.YTD_VOICE_TRANSLATION, "./voice-translation.js");
  const VOICE_ENABLED_KEY = "ytd_voice_enabled";
  const SPOKEN_THROUGH_KEY = "ytd_voice_spoken_through";
  const SPOKEN_THROUGH_TTL_MS = 6 * 60 * 60 * 1000;
  // Global narration ownership: Chrome gives every window its own side-panel
  // instance with its own speechSynthesis, so two panels could speak Chinese
  // over each other. Only one panel may narrate at a time — the current
  // owner heartbeats this key; a fresh foreign entry means takeover.
  const VOICE_OWNER_KEY = "ytd_voice_owner";
  const VOICE_OWNER_TTL_MS = 5_000;
  function findSegmentIndex(segments, currentTime) {
    if (segments.length && currentTime >= segments.at(-1).end) return segments.length;
    let index = 0;
    for (let candidate = 0; candidate < segments.length; candidate += 1) {
      if (segments[candidate].start <= currentTime) index = candidate;
      else break;
    }
    return index;
  }
  function createController({
    button,
    storage,
    runtime,
    relay,
    isTranscriptEnabled = () => true,
    speechSynthesis = globalThis.speechSynthesis,
    SpeechSynthesisUtteranceCtor = globalThis.SpeechSynthesisUtterance,
    streamPlayerFactory = () => defaultPlayerApi.createPlayer({ runtime }),
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    storageEvents = null,
    onStatus = () => {},
  }) {
    const sessionId = translationApi.createSessionId();
    let settings;
    let transcript = null, segments = [], zhSource = false;
    let localTranslations = new Map(), sharedTranslations = null, notifyTranslationsAdded = null;
    let enabled = false, generation = 0, currentIndex = 0, syncTimer = null;
    let persistedEnabled = false;
    let player = null, queued = new Map(), systemResolve = null, lastPlayback = null;
    let currentUtterance = null;
    let appliedSpeechPause = false;
    let adWasShowing = false;
    // Measured base speed (Chinese characters/second at rate 1.0) of the
    // active voice; the adaptive rate uses it to track the speaker's pace.
    let calibratedCps = 4.2;
    // Set when a resume skips the partially heard sentence: the next sentence
    // is spoken right away instead of waiting for its video timestamp, so
    // returning never feels silent.
    let resumeSpeakImmediately = false;
    // videoId -> { videoId, index, markedAt, characters, heardChars }: the
    // last segment whose speech BEGAN and how much of it was heard.
    let spokenThroughByVideo = new Map();
    function updateButton(state = "off") {
      button.setAttribute("aria-checked", String(enabled));
      const stateLabel = state === "loading" ? "loading" : state === "paused" ? "paused" : state === "error" ? "error" : "";
      button.setAttribute("aria-label", `${enabled ? "Disable" : "Enable"} Chinese Voice playback${stateLabel ? ` (${stateLabel})` : ""}`);
      button.dataset.state = state;
      button.disabled = !isTranscriptEnabled();
    }
    async function getPlaybackState() {
      const result = await relay({ action: "getVoicePlaybackState" });
      return result?.response || result;
    }
    // The content script may not be listening yet (slow page load, or the
    // extension was reloaded while the page stayed open). Retrying bridges
    // that window instead of failing the whole Voice session.
    async function relayWithRetry(payload, activeGeneration) {
      let lastError;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (!enabled || generation !== activeGeneration) throw lastError
          || new Error("Voice playback was cancelled.");
        try {
          return await relay(payload);
        } catch (error) {
          lastError = error;
          if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
      throw new Error(
        "Cannot reach the YouTube player. Refresh the page, then try again.",
      );
    }
    async function initialize() {
      const stored = await storage.get(settingsApi.STORAGE_KEY);
      settings = settingsApi.normalize(stored[settingsApi.STORAGE_KEY]);
      observeNarrationTakeover();
      try {
        const flag = await storage.get(VOICE_ENABLED_KEY) || {};
        persistedEnabled = flag[VOICE_ENABLED_KEY] === true;
      } catch (_error) {
        persistedEnabled = false;
      }
      try {
        const spoken = await storage.get(SPOKEN_THROUGH_KEY) || {};
        const entry = spoken[SPOKEN_THROUGH_KEY];
        if (entry && typeof entry.videoId === "string"
            && Number.isInteger(entry.index)
            && Number.isInteger(entry.characters)
            && Number.isInteger(entry.heardChars)
            && Date.now() - Number(entry.markedAt || 0) <= SPOKEN_THROUGH_TTL_MS) {
          spokenThroughByVideo.set(entry.videoId, { ...entry, markedAt: Number(entry.markedAt) });
        }
      } catch (_error) {
        // Resume-position memory is best-effort.
      }
      updateButton();
      button.addEventListener("click", () => void toggle());
    }
    function markSpokenThrough(text) {
      if (!transcript?.videoId) return;
      const entry = {
        videoId: transcript.videoId,
        index: currentIndex,
        markedAt: Date.now(),
        characters: (text || "").length,
        heardChars: 0,
      };
      spokenThroughByVideo.set(entry.videoId, entry);
      persistSpokenEntry(entry);
    }
    function recordSpeechProgress(text, natural, elapsedSeconds) {
      const videoId = transcript?.videoId;
      const entry = videoId && spokenThroughByVideo.get(videoId);
      if (!entry) return;
      entry.characters = text.length;
      entry.heardChars = natural
        ? text.length
        : Math.max(0, Math.min(text.length, Math.round(elapsedSeconds * calibratedCps)));
      persistSpokenEntry(entry);
    }
    function persistSpokenEntry(entry) {
      try {
        Promise.resolve(storage?.set?.({ [SPOKEN_THROUGH_KEY]: entry })).catch(() => {});
      } catch (_error) {
        // Persistence is best-effort.
      }
    }
    function spokenThroughIndex(videoId) {
      if (!videoId) return -1;
      const entry = spokenThroughByVideo.get(videoId);
      if (!entry || Date.now() - entry.markedAt > SPOKEN_THROUGH_TTL_MS) return -1;
      return Number.isInteger(entry.index) ? entry.index : -1;
    }
    function persistEnabled(value) {
      persistedEnabled = value;
      try {
        Promise.resolve(storage?.set?.({ [VOICE_ENABLED_KEY]: value })).catch(() => {});
      } catch (_error) {
        // Persistence is best-effort; in-memory behavior stays correct.
      }
    }
    // Narration uses the panel's semantic segments, so their stable IDs match
    // the transcript view's translation cache (`<videoId>:zh:semantic:<id>`).
    // Already-translated segments are spoken directly from that shared cache;
    // only gaps are sent to the AI, and those results are written back so the
    // bilingual view fills in as Voice progresses.
    function translationKey(id) {
      return `${transcript?.videoId || ""}:zh:semantic:${id}`;
    }
    function translationFor(segment) {
      if (zhSource) return segment.text;
      const shared = sharedTranslations?.get?.(translationKey(segment.id));
      if (typeof shared === "string" && shared.trim()) return shared;
      const local = localTranslations.get(segment.id);
      return typeof local === "string" && local ? local : "";
    }
    async function setTranscript({
      videoId,
      videoTitle = "",
      language = "",
      segments: sourceSegments = [],
      translationCache = null,
      onTranslationsAdded = null,
    }) {
      const videoChanged = !!transcript?.videoId && transcript.videoId !== videoId;
      // A video switch keeps the user's Voice intent: tear down everything
      // tied to the old video and let narration restart on the new transcript
      // instead of silently switching Voice off. A persisted choice also
      // resumes on later videos after the previous narration ended naturally.
      if (videoChanged && enabled) await haltPlayback();
      if (videoChanged && !enabled && persistedEnabled && isTranscriptEnabled()) {
        enabled = true;
      }
      const shouldRestart = enabled && (videoChanged || !segments.length);
      transcript = { videoId, videoTitle, language };
      sharedTranslations = translationCache;
      notifyTranslationsAdded = onTranslationsAdded;
      localTranslations = new Map();
      resumeSpeakImmediately = false;
      segments = (Array.isArray(sourceSegments) ? sourceSegments : [])
        .map((segment) => ({
          id: String(segment?.id ?? ""),
          start: Math.max(0, Number(segment?.start) || 0),
          end: Math.max(0, Number(segment?.end) || 0),
          text: String(segment?.text || "").replace(/\s+/g, " ").trim(),
        }))
        .filter((segment) => segment.id && segment.text && segment.end > segment.start)
        .sort((a, b) => a.start - b.start);
      zhSource = voiceSync.isChineseTranscript(
        language,
        segments.map((segment) => segment.text).join(" "),
      );
      if (shouldRestart && segments.length) {
        enabled = false;
        void (async () => {
          // Auto-restart (video switch) must not fire while another panel
          // owns narration; a manual toggle bypasses this check.
          if (!await canClaimNarration()) {
            updateButton("off");
            onStatus("Voice is narrating in another window.", "info");
            return;
          }
          await start();
        })();
        return;
      }
      updateButton(enabled ? (segments.length ? "on" : "loading") : "off");
    }
    // ---- Global narration ownership -------------------------------------
    // Narration is deliberately window-independent: switching windows never
    // stops it. The owner key only prevents a SECOND panel from starting
    // automatically while another one is already narrating.
    let ownershipListener = null;
    let ownerRenewTimer = null;
    async function readVoiceOwner() {
      try {
        const stored = await storage.get(VOICE_OWNER_KEY) || {};
        const entry = stored[VOICE_OWNER_KEY];
        if (!entry || typeof entry.id !== "string") return null;
        return entry;
      } catch (_error) {
        return null;
      }
    }
    async function canClaimNarration() {
      const entry = await readVoiceOwner();
      if (!entry || entry.id === sessionId) return true;
      return Date.now() - Number(entry.ts || 0) > VOICE_OWNER_TTL_MS;
    }
    function claimNarration() {
      try {
        Promise.resolve(storage?.set?.({ [VOICE_OWNER_KEY]: { id: sessionId, ts: Date.now() } }))
          .catch(() => {});
      } catch (_error) {
        // Best-effort ownership.
      }
      if (ownerRenewTimer === null) {
        ownerRenewTimer = setIntervalFn(() => {
          try {
            Promise.resolve(storage?.set?.({ [VOICE_OWNER_KEY]: { id: sessionId, ts: Date.now() } }))
              .catch(() => {});
          } catch (_error) {}
        }, 1_000);
      }
    }
    function renounceNarration() {
      if (ownerRenewTimer !== null) {
        clearIntervalFn(ownerRenewTimer);
        ownerRenewTimer = null;
      }
      readVoiceOwner().then((entry) => {
        if (!entry || entry.id !== sessionId) return;
        try {
          Promise.resolve(storage?.remove?.(VOICE_OWNER_KEY)).catch(() => {});
        } catch (_error) {}
      }).catch(() => {});
    }
    function observeNarrationTakeover() {
      // Another panel's user clicked its Voice switch: that panel now owns
      // narration; this one yields immediately.
      ownershipListener = (changes, area) => {
        const change = changes && changes[VOICE_OWNER_KEY];
        if (!change || area !== "local") return;
        const next = change.newValue;
        if (next && next.id !== sessionId && enabled) {
          void haltPlayback();
          updateButton("off");
          onStatus("Voice is narrating in another window.", "info");
        }
      };
      try {
        storageEvents?.addListener?.(ownershipListener);
      } catch (_error) {}
    }

    function refreshAvailability() {
      // Restore the persisted Voice choice as a waiting narrator: the panel
      // may have been rebuilt (tab switch, reopen) after the user enabled it.
      if (!enabled && !segments.length && persistedEnabled && isTranscriptEnabled()) {
        void (async () => {
          if (!await canClaimNarration()) {
            updateButton("off");
            onStatus("Voice is narrating in another window.", "info");
            return;
          }
          enabled = true;
          updateButton("loading");
          onStatus("");
          if (segments.length) {
            enabled = false;
            await start();
          }
        })();
        return;
      }
      updateButton(enabled ? (segments.length ? "on" : "loading") : "off");
    }
    async function ensureTranslations(startIndex, activeGeneration = generation) {
      const missing = segments
        .slice(startIndex, startIndex + 6)
        .filter((segment) => !translationFor(segment));
      if (!missing.length) return true;
      const result = await translationApi.translateSegmentBatches({
        segments: missing.map((segment) => ({ id: segment.id, sourceText: segment.text })),
        runtime,
        videoTitle: transcript?.videoTitle,
        generation: activeGeneration,
        sessionId,
      });
      if (!enabled || generation !== activeGeneration) return false;
      let sharedAny = false;
      for (const [id, text] of result) {
        localTranslations.set(id, text);
        if (sharedTranslations?.set) {
          sharedTranslations.set(translationKey(id), text);
          sharedAny = true;
        }
      }
      if (sharedAny) notifyTranslationsAdded?.();
      return true;
    }
    async function segmentRate(index, text = null) {
      let snapshot = { currentTime: segments[index].start, playbackRate: 1 };
      try {
        snapshot = await getPlaybackState();
      } catch (_error) {
        // Transient messaging failure: pace against the segment's own window.
      }
      const segment = segments[index];
      const videoIndex = findSegmentIndex(segments, snapshot.currentTime);
      return voiceSync.calculateAdaptiveRate({
        text: text ?? translationFor(segment),
        charactersPerSecond: calibratedCps,
        availableSeconds: Math.max(0.8, segment.end - snapshot.currentTime),
        playbackRate: snapshot.playbackRate,
        lagSegments: Math.max(0, videoIndex - index),
        speedMultiplier: Number(settings?.voice?.speedMultiplier) > 0
          ? Number(settings.voice.speedMultiplier)
          : 1,
      });
    }
    // Measures the installed voice's real base speed so the adaptive rate
    // tracks the English speaker's actual pace instead of a fixed constant.
    function calibrateVoiceSpeed(text, outcome) {
      const seconds = outcome && Number(outcome.speechSeconds);
      if (!Number.isFinite(seconds) || seconds < 1 || seconds > 120) return;
      const measured = text.length / seconds;
      if (!Number.isFinite(measured) || measured <= 0) return;
      calibratedCps = Math.round(
        Math.min(8, Math.max(2.5, calibratedCps * 0.7 + measured * 0.3)) * 100,
      ) / 100;
    }
    function speakSystem(text, rate) {
      return new Promise((resolve, reject) => {
        let started = false;
        let settled = false;
        let voicesTimer = null;
        let idleTimer = null;
        let watchdog = null;
        let speechStartedAt = 0;
        const settle = (ok, error, value) => {
          if (settled) return;
          settled = true;
          clearInterval(watchdog);
          clearTimeout(idleTimer);
          if (speechStartedAt) {
            recordSpeechProgress(
              text,
              ok && value?.natural === true,
              (Date.now() - speechStartedAt) / 1000,
            );
          }
          if (ok) resolve(value);
          else reject(error);
        };
        const begin = () => {
          if (started) return;
          started = true;
          if (voicesTimer !== null) clearTimeout(voicesTimer);
          speechSynthesis?.removeEventListener?.("voiceschanged", begin);
          const voices = speechSynthesis?.getVoices?.() || [];
          const voice = voices.find((item) => item.voiceURI === settings.voice.system.voiceURI)
            || voices.find((item) => /^zh(?:-|$)/i.test(item.lang));
          if (!voice || !SpeechSynthesisUtteranceCtor) {
            settle(false, new Error("No Chinese system voice is installed."));
            return;
          }
          const utterance = new SpeechSynthesisUtteranceCtor(text);
          utterance.voice = voice;
          utterance.lang = voice.lang || "zh-CN";
          utterance.rate = rate;
          utterance.onend = () => settle(true, null, { natural: true, speechSeconds: (Date.now() - speechStartedAt) / 1000 });
          utterance.onerror = () => settle(false, new Error("System Chinese speech failed."));
          // Keep a strong reference for the utterance's lifetime: Chrome can
          // drop events for collected utterances.
          currentUtterance = utterance;
          systemResolve = () => settle(true);
          speechStartedAt = Date.now();
          speechSynthesis.speak(utterance);

          // Chrome sometimes silently drops an utterance — no end/error
          // events, often after rapid pause/resume cycles from syncTick —
          // which used to hang the narration loop forever with the switch
          // still "on". Watch the engine and recover instead.
          const estimatedSeconds = Math.max(
            2,
            voiceSync.estimateSpeechSeconds(text, calibratedCps) / Math.max(0.5, rate || 1),
          );
          const hardLimitMs = (estimatedSeconds * 1.8 + 15) * 1000;
          const startedAt = Date.now();
          let pausedMs = 0;
          let lastTick = Date.now();
          let heartbeat = 0;
          watchdog = setInterval(() => {
            const now = Date.now();
            pausedMs += speechSynthesis?.paused ? now - lastTick : 0;
            lastTick = now;
            if (settled) return;
            // Persist progress about once a second: the write issued while
            // the page is tearing down (tab switch) may never land, so the
            // durable value must already be fresh.
            heartbeat += 1;
            if (heartbeat % 4 === 0) {
              recordSpeechProgress(text, false, (now - startedAt - pausedMs) / 1000);
            }
            const idle = !speechSynthesis?.speaking && !speechSynthesis?.pending && !speechSynthesis?.paused;
            if (idle && idleTimer === null) {
              idleTimer = setTimeout(() => settle(true), 1200);
            } else if (!idle && idleTimer !== null) {
              clearTimeout(idleTimer);
              idleTimer = null;
            }
            if (now - startedAt - pausedMs > hardLimitMs) settle(true);
          }, 250);
        };
        // Chrome fills the voice list asynchronously: a freshly opened panel
        // can observe an empty getVoices() until voiceschanged fires. Give
        // that a brief window before declaring no Chinese voice installed.
        const voices = speechSynthesis?.getVoices?.() || [];
        if (voices.length || typeof speechSynthesis?.addEventListener !== "function") {
          begin();
          return;
        }
        speechSynthesis.addEventListener("voiceschanged", begin, { once: true });
        voicesTimer = setTimeout(begin, 1500);
      }).finally(() => {
        systemResolve = null;
      });
    }
    async function queueMimo(index, activeGeneration) {
      if (!await ensureTranslations(index, activeGeneration)) return;
      for (let candidate = index; candidate < Math.min(segments.length, index + 2); candidate += 1) {
        if (queued.has(candidate)) continue;
        const speechText = translationFor(segments[candidate]);
        const rate = await segmentRate(candidate, speechText);
        if (!enabled || generation !== activeGeneration) return;
        const request = player.enqueue({
          requestId: `voice-${activeGeneration}-${candidate}`,
          generation: activeGeneration,
          text: speechText,
          rate,
        });
        request.catch(() => {});
        queued.set(candidate, request);
      }
    }
    async function waitForTimeline(activeGeneration) {
      while (enabled && generation === activeGeneration) {
        if (resumeSpeakImmediately) {
          resumeSpeakImmediately = false;
          return true;
        }
        let snapshot;
        try {
          snapshot = await getPlaybackState();
        } catch (_error) {
          // Transient messaging failure (page loading, tab navigating):
          // hold position and poll again rather than dropping the session.
          await new Promise((resolve) => setTimeout(resolve, 300));
          continue;
        }
        // Ads move the video onto their own timeline: hold narration there
        // instead of seek-restarting around every ad slot.
        const canSpeak = (!snapshot.paused || snapshot.pausedByVoice) && !snapshot.adShowing;
        if (canSpeak && snapshot.currentTime + 0.15 >= segments[currentIndex].start) return true;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return false;
    }
    async function runPlayback(activeGeneration) {
      try {
        while (enabled && generation === activeGeneration && currentIndex < segments.length) {
          if (!await ensureTranslations(currentIndex, activeGeneration)) return;
          if (settings.voice.activeProvider === "mimo") {
            await queueMimo(currentIndex, activeGeneration);
            if (!await waitForTimeline(activeGeneration)) return;
            markSpokenThrough(translationFor(segments[currentIndex]));
            await player.activate?.(`voice-${activeGeneration}-${currentIndex}`);
            const mimoStart = Date.now();
            try {
              await queued.get(currentIndex);
              const speechText = translationFor(segments[currentIndex]);
              recordSpeechProgress(speechText, true, 0);
              // Same measured-pace calibration as the system voice, so the
              // adaptive rate tracks MiMo's actual speaking speed too.
              calibrateVoiceSpeed(speechText, {
                speechSeconds: (Date.now() - mimoStart) / 1000,
              });
            } catch (error) {
              recordSpeechProgress(
                translationFor(segments[currentIndex]),
                false,
                (Date.now() - mimoStart) / 1000,
              );
              throw error;
            }
            queued.delete(currentIndex);
          } else {
            if (!await waitForTimeline(activeGeneration)) return;
            const speechText = translationFor(segments[currentIndex]);
            markSpokenThrough(speechText);
            const rate = await segmentRate(currentIndex, speechText);
            const outcome = await speakSystem(speechText, rate);
            calibrateVoiceSpeed(speechText, outcome);
          }
          if (!enabled || generation !== activeGeneration) return;
          currentIndex += 1;
        }
        if (enabled && generation === activeGeneration) await stop();
      } catch (error) {
        if (enabled && generation === activeGeneration) await fail(error);
      }
    }
    async function syncTick() {
      if (!enabled || !segments.length) return;
      try {
        const snapshot = await getPlaybackState();
        const checkedAt = Date.now();
        // While an ad plays, the video's timeline is the ad's: skip seek
        // detection and catch-up control entirely and refresh the baseline.
        if (snapshot.adShowing) {
          adWasShowing = true;
          lastPlayback = { time: snapshot.currentTime, checkedAt };
          applySpeechPause(true);
          updateButton("paused");
          return;
        }
        // First tick after the ad: the content timeline resumes where it
        // left, which looks like a huge backward seek against the ad clock.
        if (adWasShowing) {
          adWasShowing = false;
          lastPlayback = { time: snapshot.currentTime, checkedAt };
        } else if (lastPlayback && voiceSync.isPlaybackSeek(
          lastPlayback.time,
          snapshot.currentTime,
          checkedAt - lastPlayback.checkedAt,
          snapshot.paused ? 0 : snapshot.playbackRate,
        )) {
          await seekTo(snapshot.currentTime);
          return;
        }
        lastPlayback = { time: snapshot.currentTime, checkedAt };
        const videoIndex = findSegmentIndex(segments, snapshot.currentTime);
        const lag = Math.max(0, videoIndex - currentIndex);
        const action = voiceSync.getCatchUpAction(lag, snapshot.pausedByVoice);
        if (action.pauseVideo) await relay({ action: "pauseForVoiceCatchUp" });
        else if (action.resumeVideo) await relay({ action: "resumeAfterVoiceCatchUp" });

        if (snapshot.paused && !snapshot.pausedByVoice) {
          applySpeechPause(true);
          updateButton("paused");
        } else {
          applySpeechPause(false);
          updateButton("on");
        }
      } catch (_error) {
        // A navigation or closed tab is handled by the next lifecycle event.
      }
    }
    // Chrome can replay an utterance from its start after pause/resume
    // cycles, so the engine is only touched when the desired state changes.
    let resumeCheckTimer = null;
    function applySpeechPause(paused) {
      if (paused === appliedSpeechPause) return;
      appliedSpeechPause = paused;
      if (paused) {
        clearTimeout(resumeCheckTimer);
        speechSynthesis?.pause?.();
        void player?.pause?.().catch?.(() => {});
      } else {
        speechSynthesis?.resume?.();
        void player?.resume?.().catch?.(() => {});
        // macOS Chrome sometimes wedges after pause(): resume() silently
        // fails and the engine stays paused forever, hanging the narration
        // loop ("switch away and back, no speech until another switch").
        // Detect the wedge and cancel() to free the engine; the speakSystem
        // watchdog then settles the stuck utterance via its idle path.
        clearTimeout(resumeCheckTimer);
        resumeCheckTimer = setTimeout(() => {
          if (!appliedSpeechPause && speechSynthesis?.paused) {
            try { speechSynthesis.cancel(); } catch (_error) {}
          }
        }, 1500);
      }
    }
    async function start() {
      if (enabled || !isTranscriptEnabled()) return;
      enabled = true;
      generation += 1;
      const activeGeneration = generation;
      updateButton("loading");
      onStatus("");
      if (!segments.length) return;
      try {
        const stored = await storage.get(settingsApi.STORAGE_KEY);
        settings = settingsApi.normalize(stored[settingsApi.STORAGE_KEY]);
        if (settings.voice.activeProvider === "mimo" &&
            (!settings.voice.mimo.apiKey || !settings.voice.mimo.verifiedAt)) {
          throw new Error("Configure and test Xiaomi MiMo in Settings first.");
        }
        if (settings.voice.activeProvider === "mimo") {
          player = streamPlayerFactory();
          await player.resume();
        }
        await relayWithRetry({ action: "setVoiceDucking", enabled: true, factor: 0.15 }, activeGeneration);
        let snapshot;
        try {
          snapshot = await getPlaybackState();
        } catch (_error) {
          snapshot = await relayWithRetry({ action: "getVoicePlaybackState" }, activeGeneration)
            .then((result) => result?.response || result);
        }
        const startIndex = findSegmentIndex(segments, snapshot.currentTime);
        currentIndex = startIndex;
        // Coming back to a sentence that was already in progress: never
        // re-speak heard audio. Mostly heard → skip to the next sentence and
        // speak it right away (no replay, no silent wait for its timestamp);
        // barely started → the sentence effectively never played, so it
        // starts fresh.
        const spokenIndex = spokenThroughIndex(transcript?.videoId);
        if (spokenIndex === startIndex && startIndex < segments.length) {
          const entry = spokenThroughByVideo.get(transcript.videoId);
          const fullText = translationFor(segments[startIndex]);
          const heard = Number.isInteger(entry?.heardChars)
            ? Math.max(0, Math.min(entry.heardChars, fullText.length))
            : fullText.length;
          if (heard >= Math.ceil(fullText.length * 0.25)) {
            currentIndex = startIndex + 1;
            resumeSpeakImmediately = true;
          }
        }
        lastPlayback = { time: snapshot.currentTime, checkedAt: Date.now() };
        appliedSpeechPause = false;
        claimNarration();
        updateButton("on");
        syncTimer = setIntervalFn(() => void syncTick(), 250);
        void runPlayback(activeGeneration);
      } catch (error) {
        await fail(error);
      }
    }
    async function haltPlayback() {
      translationApi.cancelGeneration(runtime, generation, sessionId);
      generation += 1;
      if (syncTimer !== null) clearIntervalFn(syncTimer);
      syncTimer = null;
      renounceNarration();
      appliedSpeechPause = false;
      clearTimeout(resumeCheckTimer);
      resumeSpeakImmediately = false;
      speechSynthesis?.cancel?.();
      systemResolve?.();
      systemResolve = null;
      currentUtterance = null;
      await player?.cancelAll?.().catch(() => {});
      await player?.destroy?.().catch(() => {});
      player = null;
      queued = new Map();
      lastPlayback = null;
      await relay({ action: "restoreVoicePlayback" }).catch(() => {});
    }
    async function stop() {
      const wasEnabled = enabled;
      enabled = false;
      if (wasEnabled) await haltPlayback();
      updateButton("off");
    }
    async function fail(error) {
      await stop();
      button.dataset.state = "error";
      onStatus(error.message || "Voice playback failed.", "error");
    }
    async function toggle() {
      if (enabled) {
        await stop();
        persistEnabled(false);
      } else {
        await start();
        if (enabled) persistEnabled(true);
      }
    }
    async function seekTo(seconds) {
      if (!enabled || !segments.length) return;
      const targetSeconds = Math.max(0, Number(seconds) || 0);
      // A seek that lands inside the segment currently being narrated just
      // continues: cancelling and re-speaking made the same sentence replay
      // on small drags, timing jitter, and ad-slot time jumps.
      if (findSegmentIndex(segments, targetSeconds) === currentIndex) {
        lastPlayback = { time: targetSeconds, checkedAt: Date.now() };
        return;
      }
      translationApi.cancelGeneration(runtime, generation, sessionId);
      generation += 1;
      const activeGeneration = generation;
      speechSynthesis?.cancel?.();
      systemResolve?.();
      systemResolve = null;
      currentUtterance = null;
      await player?.cancelAll?.("Video seeked.").catch(() => {});
      queued = new Map();
      await relay({ action: "resumeAfterVoiceCatchUp" }).catch(() => {});
      currentIndex = findSegmentIndex(segments, Number(seconds) || 0);
      lastPlayback = { time: Number(seconds) || 0, checkedAt: Date.now() };
      void runPlayback(activeGeneration);
    }
    async function clearTranscript() {
      await stop();
      transcript = null;
      segments = [];
      zhSource = false;
      localTranslations = new Map();
      sharedTranslations = null;
      notifyTranslationsAdded = null;
      // startDigest calls this for the panel's FIRST video too (its
      // video-changed cleanup treats null as "different"), so a plain stop
      // here was wiping the restored waiting state right after boot. Keep the
      // persisted preference waiting for the transcript that follows.
      if (persistedEnabled && isTranscriptEnabled()) {
        enabled = true;
        updateButton("loading");
        onStatus("");
      } else {
        updateButton();
      }
    }
    return {
      clearTranscript, initialize, refreshAvailability, seekTo, setTranscript,
      start, stop, toggle,
      getState: () => ({
        enabled, generation, currentIndex, segmentCount: segments.length,
        voiceCharsPerSecond: calibratedCps,
      }),
    };
  }
  const api = {
    createController,
    findSegmentIndex,
    translateSegmentBatches: translationApi.translateSegmentBatches,
  };
  globalThis.YTD_VOICE_CONTROLLER = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
