const test = require("node:test");
const assert = require("node:assert/strict");

const streamPlayer = require("../tts-stream-player.js");

test("decodes little-endian PCM16 Base64 into normalized floats", () => {
  const bytes = Buffer.alloc(6);
  bytes.writeInt16LE(-32768, 0);
  bytes.writeInt16LE(0, 2);
  bytes.writeInt16LE(32767, 4);

  const samples = streamPlayer.decodePcm16Base64(bytes.toString("base64"));

  assert.equal(samples.length, 3);
  assert.equal(samples[0], -1);
  assert.equal(samples[1], 0);
  assert.ok(samples[2] > 0.999 && samples[2] < 1);
});

test("rejects empty, odd-length, and non-base64 PCM chunks", () => {
  assert.throws(() => streamPlayer.decodePcm16Base64(""), /empty/i);
  assert.throws(
    () => streamPlayer.decodePcm16Base64(Buffer.from([1]).toString("base64")),
    /even number/i,
  );
  assert.throws(() => streamPlayer.decodePcm16Base64("%%%"), /base64/i);
});

test("queues concurrent streams and only feeds the active segment to the worklet", async () => {
  const runtimeListeners = [];
  const sentToBackground = [];
  const backgroundPort = {
    onMessage: { addListener(listener) { runtimeListeners.push(listener); } },
    onDisconnect: { addListener() {} },
    postMessage(message) { sentToBackground.push(message); },
    disconnect() {},
  };
  const workletMessages = [];
  let workletNode;
  class FakeAudioContext {
    constructor() {
      this.audioWorklet = { async addModule() {} };
      this.destination = {};
      this.state = "running";
    }
    async resume() {}
    async suspend() {}
    async close() {}
  }
  class FakeWorkletNode {
    constructor() {
      this.port = {
        onmessage: null,
        postMessage(message) { workletMessages.push(message); },
      };
      workletNode = this;
    }
    connect() {}
    disconnect() {}
  }
  const player = streamPlayer.createPlayer({
    runtime: { connect() { return backgroundPort; }, getURL: () => "worklet.js" },
    AudioContextCtor: FakeAudioContext,
    AudioWorkletNodeCtor: FakeWorkletNode,
  });

  const first = player.enqueue({ requestId: "a", generation: 1, text: "甲", rate: 1 });
  const second = player.enqueue({ requestId: "b", generation: 1, text: "乙", rate: 1.2 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(sentToBackground.map((message) => message.requestId), ["a", "b"]);

  const pcm = Buffer.from([0, 0]).toString("base64");
  runtimeListeners[0]({ type: "audio", requestId: "b", data: pcm });
  assert.equal(workletMessages.length, 0);
  runtimeListeners[0]({ type: "audio", requestId: "a", data: pcm });
  assert.equal(workletMessages.length, 0);
  await player.activate("a");
  runtimeListeners[0]({ type: "complete", requestId: "a" });
  assert.deepEqual(workletMessages.map((message) => message.type), ["push", "end"]);

  workletNode.port.onmessage({ data: { type: "drained" } });
  await first;
  assert.deepEqual(workletMessages.map((message) => message.type), ["push", "end"]);
  await player.activate("b");
  assert.deepEqual(workletMessages.map((message) => message.type), ["push", "end", "push"]);
  runtimeListeners[0]({ type: "complete", requestId: "b" });
  workletNode.port.onmessage({ data: { type: "drained" } });
  await second;
});
