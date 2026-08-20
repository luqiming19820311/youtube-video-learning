class YtdPcmPlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunks = [];
    this.offset = 0;
    this.ended = false;
    this.drained = false;
    this.port.onmessage = (event) => this.handleMessage(event.data);
  }

  handleMessage(message) {
    if (message?.type === "push" && message.samples) {
      this.chunks.push(new Float32Array(message.samples));
      this.drained = false;
      return;
    }
    if (message?.type === "end") {
      this.ended = true;
      this.drained = false;
      return;
    }
    if (message?.type === "reset") {
      this.chunks = [];
      this.offset = 0;
      this.ended = false;
      this.drained = false;
    }
  }

  process(_inputs, outputs) {
    const output = outputs[0]?.[0];
    if (!output) return true;
    output.fill(0);
    let writeIndex = 0;
    while (writeIndex < output.length && this.chunks.length) {
      const chunk = this.chunks[0];
      const available = chunk.length - this.offset;
      const copyCount = Math.min(available, output.length - writeIndex);
      output.set(chunk.subarray(this.offset, this.offset + copyCount), writeIndex);
      writeIndex += copyCount;
      this.offset += copyCount;
      if (this.offset >= chunk.length) {
        this.chunks.shift();
        this.offset = 0;
      }
    }
    if (this.ended && !this.chunks.length && !this.drained) {
      this.ended = false;
      this.drained = true;
      this.port.postMessage({ type: "drained" });
    }
    return true;
  }
}

registerProcessor("ytd-pcm-player", YtdPcmPlayerProcessor);
