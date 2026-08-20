/** Side-panel streaming PCM player backed by an AudioWorklet. */
(() => {
  function decodePcm16Base64(value) {
    const clean = String(value || "").trim();
    if (!clean) throw new Error("PCM audio chunk is empty.");
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(clean)) {
      throw new Error("PCM audio chunk is not valid Base64.");
    }
    const binary = atob(clean);
    if (!binary.length) throw new Error("PCM audio chunk is empty.");
    if (binary.length % 2 !== 0) {
      throw new Error("PCM16 audio must contain an even number of bytes.");
    }
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    const view = new DataView(bytes.buffer);
    const samples = new Float32Array(binary.length / 2);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = view.getInt16(index * 2, true) / 32768;
    }
    return samples;
  }

  function createPlayer({
    runtime = chrome.runtime,
    AudioContextCtor = globalThis.AudioContext,
    AudioWorkletNodeCtor = globalThis.AudioWorkletNode,
  } = {}) {
    let context;
    let node;
    let port;
    let readyPromise;
    let destroyed = false;
    let activeRequestId = "";
    const order = [];
    const requests = new Map();

    function postSamples(samples) {
      node.port.postMessage({ type: "push", samples: samples.buffer }, [samples.buffer]);
    }

    function activateNow(requestId) {
      const active = requests.get(requestId);
      if (!active) return;
      activeRequestId = requestId;
      for (const samples of active.chunks.splice(0)) postSamples(samples);
      if (active.complete) node.port.postMessage({ type: "end" });
    }

    function settle(requestId, error) {
      const request = requests.get(requestId);
      if (!request) return;
      requests.delete(requestId);
      const index = order.indexOf(requestId);
      if (index >= 0) order.splice(index, 1);
      if (activeRequestId === requestId) activeRequestId = "";
      if (error) request.reject(error);
      else request.resolve();
    }

    function finishActive() {
      const requestId = activeRequestId;
      if (requestId) settle(requestId);
    }

    function handleBackgroundMessage(message) {
      const request = requests.get(message?.requestId);
      if (!request) return;
      if (message.generation !== undefined && message.generation !== request.generation) return;
      if (message.type === "audio") {
        try {
          const samples = decodePcm16Base64(message.data);
          if (activeRequestId === message.requestId) postSamples(samples);
          else request.chunks.push(samples);
        } catch (error) {
          port.postMessage({ type: "cancel", requestId: message.requestId });
          if (activeRequestId === message.requestId) node.port.postMessage({ type: "reset" });
          settle(message.requestId, error);
        }
        return;
      }
      if (message.type === "complete") {
        request.complete = true;
        if (activeRequestId === message.requestId) node.port.postMessage({ type: "end" });
        return;
      }
      if (message.type === "error") {
        if (activeRequestId === message.requestId) node.port.postMessage({ type: "reset" });
        settle(message.requestId, new Error(message.message || "MiMo TTS failed."));
      }
    }

    async function initialize() {
      if (readyPromise) return readyPromise;
      readyPromise = (async () => {
        context = new AudioContextCtor({ sampleRate: 24_000 });
        await context.audioWorklet.addModule(runtime.getURL("tts-audio-worklet.js"));
        node = new AudioWorkletNodeCtor(context, "ytd-pcm-player", {
          outputChannelCount: [1],
        });
        node.connect(context.destination);
        node.port.onmessage = (event) => {
          if (event.data?.type === "drained") finishActive();
        };
        port = runtime.connect({ name: "ytd-tts-stream" });
        port.onMessage.addListener(handleBackgroundMessage);
        port.onDisconnect.addListener(() => {
          for (const requestId of [...order]) {
            settle(requestId, new Error("TTS stream disconnected."));
          }
        });
      })();
      return readyPromise;
    }

    function enqueue({ requestId, generation, text, rate, config }) {
      return new Promise((resolve, reject) => {
        initialize().then(() => {
          if (destroyed) throw new Error("TTS player is closed.");
          if (!requestId || requests.has(requestId)) {
            throw new Error("TTS request ID must be unique.");
          }
          requests.set(requestId, {
            generation,
            chunks: [],
            complete: false,
            resolve,
            reject,
          });
          order.push(requestId);
          port.postMessage({
            type: "synthesize",
            requestId,
            generation,
            text,
            rate,
            ...(config ? { config } : {}),
          });
        }).catch(reject);
      });
    }

    async function resume() {
      await initialize();
      if (context.state === "suspended") await context.resume();
    }

    async function activate(requestId) {
      await initialize();
      if (activeRequestId === requestId) return;
      if (activeRequestId) throw new Error("Another TTS segment is still playing.");
      activateNow(requestId);
    }

    async function pause() {
      if (context?.state === "running") await context.suspend();
    }

    async function cancelAll(reason = "TTS playback cancelled.") {
      if (!readyPromise) return;
      await readyPromise.catch(() => {});
      node?.port.postMessage({ type: "reset" });
      for (const requestId of [...order]) {
        port?.postMessage({ type: "cancel", requestId });
        settle(requestId, new Error(reason));
      }
      activeRequestId = "";
    }

    async function destroy() {
      destroyed = true;
      await cancelAll();
      port?.disconnect();
      node?.disconnect();
      await context?.close?.();
    }

    return { activate, cancelAll, destroy, enqueue, initialize, pause, resume };
  }

  const api = { createPlayer, decodePcm16Base64 };
  globalThis.YTD_TTS_STREAM_PLAYER = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
