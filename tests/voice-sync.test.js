const test = require("node:test");
const assert = require("node:assert/strict");

const voiceSync = require("../voice-sync.js");

test("calculates adaptive speed and pauses after two segments of lag", () => {
  assert.equal(
    voiceSync.calculateAdaptiveRate({
      text: "这是自然速度的中文播报内容。",
      availableSeconds: 8,
      playbackRate: 1,
      lagSegments: 0,
    }),
    1,
  );

  assert.equal(
    voiceSync.calculateAdaptiveRate({
      text: "这是一段需要追赶视频时间线的中文播报内容。",
      availableSeconds: 3,
      playbackRate: 1.5,
      lagSegments: 1,
    }),
    1.8,
  );

  assert.deepEqual(voiceSync.getCatchUpAction(1), {
    pauseVideo: false,
    resumeVideo: false,
  });
  assert.deepEqual(voiceSync.getCatchUpAction(2), {
    pauseVideo: true,
    resumeVideo: false,
  });
  assert.deepEqual(voiceSync.getCatchUpAction(0, true), {
    pauseVideo: false,
    resumeVideo: true,
  });
});

test("speech estimates follow the measured voice speed", () => {
  // Ten CJK characters at six characters/second ≈ 1.67s; at 4.2 ≈ 2.38s.
  const text = "一二三四五六七八九十";
  assert.equal(voiceSync.estimateSpeechSeconds(text), 10 / 4.2);
  assert.equal(voiceSync.estimateSpeechSeconds(text, 6), 10 / 6);

  // A faster calibrated voice yields a lower adaptive rate for the same
  // text and window, letting the dub track the speaker's actual pace.
  const dense = "一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十";
  const slow = voiceSync.calculateAdaptiveRate({
    text: dense, availableSeconds: 5, playbackRate: 1, charactersPerSecond: 3,
  });
  const fast = voiceSync.calculateAdaptiveRate({
    text: dense, availableSeconds: 5, playbackRate: 1, charactersPerSecond: 6,
  });
  assert.ok(slow === 1.8, `slow clamped to max: ${slow}`);
  assert.ok(fast === 1, `fast fits the window: ${fast}`);
  assert.ok(fast < slow);
  assert.equal(voiceSync.DEFAULT_ZH_CHARS_PER_SECOND, 4.2);
});

test("narration never slows below the video timeline and pace scales", () => {
  // Time-rich window: base rate would be ~0.4 — it must be lifted to the
  // timeline minimum (1.0), never below ("keep up with the English").
  const short = "一句短话。";
  assert.equal(
    voiceSync.calculateAdaptiveRate({
      text: short, availableSeconds: 12, playbackRate: 1,
    }),
    1,
  );

  // The user's pace preference multiplies the base, clamped at ABS_MAX 2.0.
  assert.equal(
    voiceSync.calculateAdaptiveRate({
      text: short, availableSeconds: 12, playbackRate: 1, speedMultiplier: 1.3,
    }),
    1.3,
  );
  const dense = "一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十";
  assert.equal(
    voiceSync.calculateAdaptiveRate({
      text: dense, availableSeconds: 5, playbackRate: 1,
      charactersPerSecond: 3, speedMultiplier: 1.3,
    }),
    2,
  );
  assert.equal(voiceSync.MIN_RATE, 1);
  assert.equal(voiceSync.ABS_MAX_RATE, 2);
});

test("detects Chinese transcripts and builds MiMo pace instructions", () => {
  assert.equal(voiceSync.isChineseTranscript("zh-CN", "Hello"), true);
  assert.equal(voiceSync.isChineseTranscript("en", "这是中文内容。"), true);
  assert.equal(voiceSync.isChineseTranscript("en", "English transcript"), false);
  assert.match(voiceSync.describePace(1.8), /快速/);
  assert.match(voiceSync.describePace(1), /自然/);
});

test("distinguishes a user seek from ordinary playback progress", () => {
  assert.equal(voiceSync.isPlaybackSeek(10, 10.25, 250, 1), false);
  assert.equal(voiceSync.isPlaybackSeek(10, 10.5, 250, 2), false);
  assert.equal(voiceSync.isPlaybackSeek(10, 18, 250, 1), true);
  assert.equal(voiceSync.isPlaybackSeek(10, 4, 250, 1), true);
});
