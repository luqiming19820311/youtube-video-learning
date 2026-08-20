/** Batches subtitle translation into stable Chinese Voice segments. */
(() => {
  const TRANSLATION_TIMEOUT_MS = 45_000;

  function createSessionId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  // The underlying Chrome message cannot be cancelled; without a deadline a
  // wedged message port would leave narration paused on a segment boundary
  // with no error surfaced.
  function sendMessageWithTimeout(runtime, message, timeoutMs) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error("Chinese translation timed out. Please Retry."));
      }, timeoutMs);
      Promise.resolve(runtime.sendMessage(message)).then(
        (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  async function translateSegmentBatches({
    segments,
    runtime,
    videoTitle,
    generation = 0,
    sessionId = "test",
    timeoutMs = TRANSLATION_TIMEOUT_MS,
  }) {
    const translations = new Map();
    for (let start = 0; start < segments.length; start += 6) {
      const batch = segments.slice(start, start + 6);
      const result = await sendMessageWithTimeout(runtime, {
        action: "translateContent",
        contentType: "transcriptBatch",
        targetLanguage: "zh",
        videoTitle: videoTitle || "Unknown",
        voiceRequestId: `voice-${sessionId}-${generation}-${start}`,
        voiceGeneration: generation,
        voiceSessionId: sessionId,
        content: {
          segments: batch.map(({ id, sourceText }) => ({ id, text: sourceText })),
        },
      }, timeoutMs);
      if (!result?.success) {
        throw new Error(result?.error || "Chinese translation failed.");
      }
      for (const item of result.translatedContent?.segments || []) {
        if (typeof item?.id === "string" && typeof item?.text === "string" && item.text.trim()) {
          translations.set(item.id, item.text.trim());
        }
      }
      for (const segment of batch) {
        if (!translations.has(segment.id)) {
          throw new Error("Chinese translation is unavailable.");
        }
      }
    }
    return translations;
  }

  function cancelGeneration(runtime, generation, sessionId) {
    try {
      Promise.resolve(runtime.sendMessage({
        action: "cancelVoiceTranslation",
        generation,
        voiceSessionId: sessionId,
      })).catch(() => {});
    } catch (_error) {
      // The service worker may already be gone during panel teardown.
    }
  }

  const api = { cancelGeneration, createSessionId, translateSegmentBatches };
  globalThis.YTD_VOICE_TRANSLATION = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
