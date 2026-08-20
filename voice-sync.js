/** Pure Voice pacing and playback synchronization helpers. */
(() => {
  const MIN_RATE = 0.85;
  const MAX_RATE = 1.8;
  // Default Chinese speech density at rate 1.0; the controller replaces it
  // with a measured value from the installed voice.
  const DEFAULT_ZH_CHARS_PER_SECOND = 4.2;

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function estimateSpeechSeconds(text, charactersPerSecond = DEFAULT_ZH_CHARS_PER_SECOND) {
    const value = cleanText(text);
    const cjk = (value.match(/[\u3400-\u9fff]/g) || []).length;
    const latinWords = (value.match(/[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*/g) || []).length;
    const strongPauses = (value.match(/[。！？.!?]/g) || []).length;
    const lightPauses = (value.match(/[，、；：,;:]/g) || []).length;
    return cjk / Math.max(1, charactersPerSecond) + latinWords / 2.8 + strongPauses * 0.18 + lightPauses * 0.08;
  }

  function calculateAdaptiveRate({
    text,
    availableSeconds,
    playbackRate = 1,
    lagSegments = 0,
    charactersPerSecond = DEFAULT_ZH_CHARS_PER_SECOND,
  }) {
    const windowSeconds = Math.max(0.8, Number(availableSeconds) || 0.8);
    const videoRate = Math.max(0.25, Number(playbackRate) || 1);
    let rate = estimateSpeechSeconds(text, charactersPerSecond) / (windowSeconds / videoRate);
    if (lagSegments >= 1) rate = Math.max(rate, 1.35);
    if (lagSegments >= 2) rate = MAX_RATE;
    return Math.round(Math.min(MAX_RATE, Math.max(MIN_RATE, rate)) * 100) / 100;
  }

  function getCatchUpAction(lagSegments, pausedByVoice = false) {
    if (Number(lagSegments) >= 2) {
      return { pauseVideo: true, resumeVideo: false };
    }
    return {
      pauseVideo: false,
      resumeVideo: pausedByVoice && Number(lagSegments) <= 0,
    };
  }

  function isChineseTranscript(language, text) {
    if (/^zh(?:-|$)/i.test(String(language || ""))) return true;
    const value = cleanText(text);
    if (!value) return false;
    const cjk = (value.match(/[\u3400-\u9fff]/g) || []).length;
    const letters = (value.match(/[A-Za-z\u3400-\u9fff]/g) || []).length;
    return letters > 0 && cjk / letters >= 0.6;
  }

  function isPlaybackSeek(previousTime, currentTime, elapsedMs, playbackRate = 1) {
    const elapsedSeconds = Math.max(0, Number(elapsedMs) || 0) / 1000;
    const parsedRate = Number(playbackRate);
    const expectedChange = elapsedSeconds * (Number.isFinite(parsedRate) ? Math.max(0, parsedRate) : 1);
    const actualChange = Number(currentTime) - Number(previousTime);
    return actualChange < -0.75 || Math.abs(actualChange - expectedChange) > 1.5;
  }

  function describePace(rate) {
    const value = Number(rate) || 1;
    if (value <= 0.95) return "舒缓略慢、清晰自然";
    if (value <= 1.15) return "自然清晰";
    if (value <= 1.4) return "稍快但保持清晰";
    if (value <= 1.65) return "快速、紧凑且清晰";
    return "尽可能快速但仍保持清晰";
  }

  const api = {
    MIN_RATE,
    MAX_RATE,
    DEFAULT_ZH_CHARS_PER_SECOND,
    calculateAdaptiveRate,
    describePace,
    estimateSpeechSeconds,
    getCatchUpAction,
    isChineseTranscript,
    isPlaybackSeek,
  };
  globalThis.YTD_VOICE_SYNC = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
