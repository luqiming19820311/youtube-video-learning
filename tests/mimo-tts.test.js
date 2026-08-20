const test = require("node:test");
const assert = require("node:assert/strict");

const mimoTts = require("../mimo-tts.js");

test("builds a streaming MiMo request with provider-specific authentication", () => {
  const standard = mimoTts.buildRequest({
    accessMode: "standard",
    baseUrl: "https://api.xiaomimimo.com/v1",
    apiKey: "standard-key",
    model: "mimo-v2.5-tts",
    voice: "茉莉",
  }, "需要播报的中文。", 1.35);

  assert.equal(standard.url, "https://api.xiaomimimo.com/v1/chat/completions");
  assert.equal(standard.headers["api-key"], "standard-key");
  assert.equal(standard.body.stream, true);
  assert.equal(standard.body.audio.format, "pcm16");
  assert.equal(standard.body.audio.voice, "茉莉");
  assert.equal(standard.body.messages[1].role, "assistant");
  assert.equal(standard.body.messages[1].content, "需要播报的中文。");
  assert.match(standard.body.messages[0].content, /稍快/);

  const tokenPlan = mimoTts.buildRequest({
    accessMode: "tokenPlan",
    apiKey: "token",
  }, "中文", 1);
  assert.equal(tokenPlan.headers.Authorization, "Bearer token");
});

test("parses fragmented SSE audio while ignoring done and metadata events", () => {
  const audio = [];
  const parser = mimoTts.createSseAudioParser((chunk) => audio.push(chunk));
  parser.push('data: {"choices":[{"delta":{"audio":{"data":"AQ');
  parser.push('ID"}}}]}\n\ndata: {"choices":[]}\n\n');
  parser.push('data: {"choices":[{"delta":{"audio":{"data":"BAU="}}}]}\n\n');
  parser.push("data: [DONE]\n\n");
  parser.finish();

  assert.deepEqual(audio, ["AQID", "BAU="]);
  assert.equal(parser.getDecodedBytes(), 5);
});

test("rejects malformed events and audio larger than four MiB", () => {
  const malformed = mimoTts.createSseAudioParser(() => {});
  assert.throws(() => malformed.push("data: not-json\n\n"), /invalid SSE JSON/i);

  const oversized = mimoTts.createSseAudioParser(() => {}, 3);
  assert.throws(
    () => oversized.push('data: {"choices":[{"delta":{"audio":{"data":"AQIDBA=="}}}]}\n\n'),
    /4 MiB limit/i,
  );
});

function streamingResponse(chunks, { ok = true, status = 200 } = {}) {
  let index = 0;
  return {
    ok,
    status,
    body: {
      getReader() {
        return {
          async read() {
            if (index >= chunks.length) return { done: true };
            return { done: false, value: new TextEncoder().encode(chunks[index++]) };
          },
          async cancel() {},
        };
      },
    },
    async text() { return ""; },
  };
}

test("streams PCM chunks and retries only before any audio was emitted", async () => {
  let attempts = 0;
  const audio = [];
  const result = await mimoTts.streamTts({
    config: { apiKey: "key", retries: 1 },
    text: "中文",
    rate: 1,
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary network failure");
      return streamingResponse([
        'data: {"choices":[{"delta":{"audio":{"data":"AQI="}}}]}\n\n',
        "data: [DONE]\n\n",
      ]);
    },
    onAudio(chunk) { audio.push(chunk); },
  });

  assert.equal(attempts, 2);
  assert.equal(result.audioBytes, 2);
  assert.deepEqual(audio, ["AQI="]);
});

test("does not retry after partial audio has already been delivered", async () => {
  let attempts = 0;
  await assert.rejects(
    mimoTts.streamTts({
      config: { apiKey: "key", retries: 1 },
      text: "中文",
      fetchImpl: async () => {
        attempts += 1;
        return streamingResponse([
          'data: {"choices":[{"delta":{"audio":{"data":"AQI="}}}]}\n\n',
          "data: invalid\n\n",
        ]);
      },
      onAudio() {},
    }),
    /invalid SSE JSON/i,
  );
  assert.equal(attempts, 1);
});

test("reports authentication and rate-limit failures explicitly", async () => {
  for (const [status, pattern] of [[401, /authentication failed/i], [403, /authentication failed/i], [429, /rate limit/i]]) {
    let attempts = 0;
    await assert.rejects(
      mimoTts.streamTts({
        config: { apiKey: "key", retries: 1 },
        text: "中文",
        fetchImpl: async () => {
          attempts += 1;
          return streamingResponse([], { ok: false, status });
        },
        onAudio() {},
      }),
      pattern,
    );
    assert.equal(attempts, 1);
  }
});

test("an already-aborted signal cancels synthesis before any audio streams", async () => {
  const controller = new AbortController();
  controller.abort();
  let fetchCalls = 0;
  let audioChunks = 0;
  await assert.rejects(
    mimoTts.streamTts({
      config: { apiKey: "key", retries: 2 },
      text: "中文",
      fetchImpl: async (_url, options) => {
        fetchCalls += 1;
        // A pre-aborted internal signal must make the fetch reject instead of
        // synthesizing — the abort listener alone never fires for a signal
        // that aborted before streamAttempt attached it.
        if (options.signal?.aborted) throw new Error("The operation was aborted.");
        return streamingResponse([
          'data: {"choices":[{"delta":{"audio":{"data":"AQI="}}}]}\n\n',
          "data: [DONE]\n\n",
        ]);
      },
      signal: controller.signal,
      onAudio() { audioChunks += 1; },
    }),
    /cancelled/i,
  );
  assert.equal(fetchCalls, 1);
  assert.equal(audioChunks, 0);
});

test("port handler forwards audio, completion, cancellation, and cleanup", async () => {
  const messageListeners = [];
  const disconnectListeners = [];
  const posted = [];
  let aborted = false;
  let cleaned = 0;
  const port = {
    name: "ytd-tts-stream",
    onMessage: { addListener(listener) { messageListeners.push(listener); } },
    onDisconnect: { addListener(listener) { disconnectListeners.push(listener); } },
    postMessage(message) { posted.push(message); },
  };
  const attach = mimoTts.createPortHandler({
    async getConfig() { return { apiKey: "key" }; },
    async stream({ text, signal, onAudio }) {
      if (text === "保持") {
        return new Promise((resolve) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            resolve({ audioBytes: 0 });
          });
        });
      }
      onAudio("AQI=");
      return { audioBytes: 2 };
    },
    async cleanup() { cleaned += 1; },
  });
  attach(port);

  messageListeners[0]({
    type: "synthesize",
    requestId: "request-1",
    generation: 4,
    text: "中文",
    rate: 1.2,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(posted.map((message) => message.type), ["audio", "complete"]);
  assert.ok(posted.every((message) => message.generation === 4));

  messageListeners[0]({ type: "synthesize", requestId: "request-2", text: "保持" });
  await new Promise((resolve) => setImmediate(resolve));
  messageListeners[0]({ type: "cancel", requestId: "request-2" });
  disconnectListeners[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(aborted, true);
  assert.equal(cleaned, 1);
});
