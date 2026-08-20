/** Xiaomi MiMo TTS request and SSE parsing helpers. */
(() => {
  const ttsSettings = globalThis.YTD_TTS_SETTINGS || (
    typeof require === "function" ? require("./tts-settings.js") : null
  );
  const voiceSync = globalThis.YTD_VOICE_SYNC || (
    typeof require === "function" ? require("./voice-sync.js") : null
  );
  const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

  function buildRequest(config, text, rate = 1) {
    const normalized = ttsSettings.normalize({
      activeProvider: "mimo",
      mimo: config,
    }).mimo;
    const pace = voiceSync.describePace(rate);
    return {
      url: `${normalized.baseUrl}/chat/completions`,
      headers: {
        "Content-Type": "application/json",
        ...ttsSettings.getAuthHeaders(normalized),
      },
      body: {
        model: normalized.model,
        messages: [
          {
            role: "user",
            content: `请使用清晰自然的普通话知识类旁白，${pace}。不要改写、增补或省略内容。`,
          },
          { role: "assistant", content: String(text || "").trim() },
        ],
        audio: { format: "pcm16", voice: normalized.voice },
        stream: true,
      },
      config: normalized,
    };
  }

  function decodedBase64Bytes(value) {
    const clean = String(value || "").trim();
    if (!clean || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(clean)) {
      throw new Error("MiMo returned invalid Base64 audio.");
    }
    const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
    return clean.length * 3 / 4 - padding;
  }

  function createSseAudioParser(onAudio, maxBytes = MAX_AUDIO_BYTES) {
    let buffer = "";
    let decodedBytes = 0;

    function parseEvent(rawEvent) {
      const data = rawEvent
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n")
        .trim();
      if (!data || data === "[DONE]") return;
      let payload;
      try {
        payload = JSON.parse(data);
      } catch (_error) {
        throw new Error("MiMo returned invalid SSE JSON.");
      }
      const audio = payload?.choices?.[0]?.delta?.audio?.data;
      if (typeof audio !== "string" || !audio) return;
      decodedBytes += decodedBase64Bytes(audio);
      if (decodedBytes > maxBytes) {
        throw new Error("MiMo audio exceeded the 4 MiB limit.");
      }
      onAudio(audio);
    }

    function drainEvents() {
      while (true) {
        const match = buffer.match(/\r?\n\r?\n/);
        if (!match || match.index === undefined) return;
        const rawEvent = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        parseEvent(rawEvent);
      }
    }

    return {
      push(chunk) {
        buffer += String(chunk || "");
        drainEvents();
      },
      finish() {
        if (buffer.trim()) parseEvent(buffer);
        buffer = "";
      },
      getDecodedBytes() {
        return decodedBytes;
      },
    };
  }

  async function readErrorMessage(response) {
    try {
      const text = await response.text();
      const payload = JSON.parse(text);
      return payload?.error?.message || payload?.message || text;
    } catch (_error) {
      return `MiMo TTS error: ${response.status}`;
    }
  }

  async function streamAttempt({ config, text, rate, fetchImpl, signal, onAudio }) {
    const request = buildRequest(config, text, rate);
    if (!request.config.apiKey) throw new Error("MiMo API key or access token is required.");
    const controller = new AbortController();
    let timeoutKind = "";
    let idleTimer;
    let hardTimer;
    const abort = (kind) => {
      if (controller.signal.aborted) return;
      timeoutKind = kind;
      controller.abort();
    };
    const resetIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => abort("idle"), request.config.timeoutMs);
    };
    const abortFromCaller = () => abort("cancelled");
    // A signal that aborted earlier (e.g. while the port handler was still
    // awaiting its config) never fires again, so check it before listening.
    if (signal?.aborted) abortFromCaller();
    else signal?.addEventListener?.("abort", abortFromCaller, { once: true });
    resetIdle();
    hardTimer = setTimeout(() => abort("hard"), 60_000);

    try {
      const response = await fetchImpl(request.url, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: controller.signal,
      });
      resetIdle();
      if (!response.ok) {
        const detail = await readErrorMessage(response);
        const message = [401, 403].includes(response.status)
          ? `MiMo authentication failed (HTTP ${response.status}). ${detail}`
          : response.status === 429 ? `MiMo rate limit reached (HTTP 429). ${detail}` : detail;
        const error = new Error(message);
        error.status = response.status;
        throw error;
      }

      const parser = createSseAudioParser(onAudio);
      const reader = response.body?.getReader?.();
      const decoder = new TextDecoder();
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          resetIdle();
          parser.push(decoder.decode(value, { stream: true }));
        }
        parser.push(decoder.decode());
      } else {
        parser.push(await response.text());
      }
      parser.finish();
      if (parser.getDecodedBytes() === 0) {
        throw new Error("MiMo TTS returned no audio.");
      }
      return { audioBytes: parser.getDecodedBytes() };
    } catch (error) {
      if (timeoutKind === "idle") {
        throw new Error(`MiMo TTS was inactive for ${request.config.timeoutMs / 1000} seconds.`);
      }
      if (timeoutKind === "hard") {
        throw new Error("MiMo TTS exceeded the 60-second limit.");
      }
      if (timeoutKind === "cancelled") {
        throw new Error("MiMo TTS request was cancelled.");
      }
      throw error;
    } finally {
      clearTimeout(idleTimer);
      clearTimeout(hardTimer);
      signal?.removeEventListener?.("abort", abortFromCaller);
    }
  }

  async function streamTts({
    config,
    text,
    rate = 1,
    fetchImpl = fetch,
    signal,
    onAudio,
  }) {
    const normalized = ttsSettings.normalize({ activeProvider: "mimo", mimo: config }).mimo;
    let lastError;
    for (let attempt = 0; attempt <= normalized.retries; attempt += 1) {
      let emitted = false;
      try {
        const result = await streamAttempt({
          config: normalized,
          text,
          rate,
          fetchImpl,
          signal,
          onAudio(chunk) {
            emitted = true;
            onAudio(chunk);
          },
        });
        return { ...result, attempts: attempt + 1 };
      } catch (error) {
        lastError = error;
        const terminalHttpError = [401, 403, 429].includes(error.status);
        if (emitted || terminalHttpError || attempt >= normalized.retries || signal?.aborted) throw error;
      }
    }
    throw lastError;
  }

  function createPortHandler({
    getConfig,
    stream = streamTts,
    cleanup = async () => {},
  }) {
    return function attachPort(port) {
      if (port?.name !== "ytd-tts-stream") return;
      const controllers = new Map();
      const safePost = (message) => {
        try {
          port.postMessage(message);
        } catch (_error) {
          // The side panel may close while a final chunk is in flight.
        }
      };

      port.onMessage.addListener((message) => {
        const requestId = typeof message?.requestId === "string"
          ? message.requestId
          : "";
        if (!requestId) return;
        if (message.type === "cancel") {
          controllers.get(requestId)?.abort();
          controllers.delete(requestId);
          return;
        }
        if (message.type !== "synthesize" || controllers.has(requestId)) return;

        const controller = new AbortController();
        controllers.set(requestId, controller);
        const generation = message.generation;
        (async () => {
          try {
            const config = message.config || await getConfig();
            await stream({
              config,
              text: message.text,
              rate: message.rate,
              signal: controller.signal,
              onAudio(data) {
                safePost({ type: "audio", requestId, generation, data });
              },
            });
            if (!controller.signal.aborted) {
              safePost({ type: "complete", requestId, generation });
            }
          } catch (error) {
            if (!controller.signal.aborted) {
              safePost({
                type: "error",
                requestId,
                generation,
                message: error.message || "MiMo TTS failed.",
              });
            }
          } finally {
            controllers.delete(requestId);
          }
        })();
      });

      port.onDisconnect.addListener(() => {
        for (const controller of controllers.values()) controller.abort();
        controllers.clear();
        void cleanup();
      });
    };
  }

  const api = {
    MAX_AUDIO_BYTES,
    buildRequest,
    createPortHandler,
    createSseAudioParser,
    decodedBase64Bytes,
    streamTts,
  };
  globalThis.YTD_MIMO_TTS = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
