const test = require("node:test");
const assert = require("node:assert/strict");

const voicePlayback = require("../voice-playback.js");

function createVideo() {
  return {
    currentTime: 12.5,
    playbackRate: 1.25,
    volume: 0.8,
    muted: false,
    paused: false,
    pauseCalls: 0,
    playCalls: 0,
    pause() {
      this.paused = true;
      this.pauseCalls += 1;
    },
    async play() {
      this.paused = false;
      this.playCalls += 1;
    },
  };
}

test("ducks video audio to fifteen percent and restores the exact state", async () => {
  const video = createVideo();
  const controller = voicePlayback.createController(() => video);

  assert.equal(controller.enableDucking(0.15), true);
  assert.equal(video.volume, 0.12);
  assert.equal(video.muted, false);

  await controller.restore();
  assert.equal(video.volume, 0.8);
  assert.equal(video.muted, false);
});

test("only resumes video pauses created by Voice catch-up", async () => {
  const video = createVideo();
  const controller = voicePlayback.createController(() => video);
  controller.enableDucking(0.15);

  assert.equal(controller.pauseForCatchUp(), true);
  assert.equal(video.paused, true);
  assert.equal(controller.snapshot().pausedByVoice, true);
  assert.equal(await controller.resumeAfterCatchUp(), true);
  assert.equal(video.paused, false);

  video.paused = true;
  assert.equal(await controller.resumeAfterCatchUp(), false);
  assert.equal(video.paused, true);
});

test("snapshot exposes precise timing and playback rate", () => {
  const video = createVideo();
  const controller = voicePlayback.createController(() => video);

  assert.deepEqual(controller.snapshot(), {
    currentTime: 12.5,
    playbackRate: 1.25,
    paused: false,
    pausedByVoice: false,
  });
});

test("hidden page pauses its own video without relying on the panel", () => {
  const video = createVideo();
  const controller = voicePlayback.createController(() => video);

  assert.equal(controller.pauseForHiddenPage(), true);
  assert.equal(video.paused, true);
  assert.equal(video.pauseCalls, 1);
  assert.equal(controller.snapshot().pausedByVoice, false);

  // Idempotent: an already paused video is left alone.
  assert.equal(controller.pauseForHiddenPage(), false);
});

test("narrating (ducked) videos keep playing when the tab hides", () => {
  const video = createVideo();
  const controller = voicePlayback.createController(() => video);

  // Voice narration is running: the video timeline must keep advancing so
  // narration can follow it across window switches.
  controller.enableDucking(0.15);
  assert.equal(controller.isDucking(), true);
  assert.equal(controller.pauseForHiddenPage(), false);
  assert.equal(video.paused, false);
  assert.equal(video.pauseCalls, 0);

  // Narration ends: hiding pauses as usual again.
  controller.restore();
  assert.equal(controller.isDucking(), false);
  assert.equal(controller.pauseForHiddenPage(), true);
  assert.equal(video.paused, true);
});

test("teardown cleanup never auto-plays a hidden page", async () => {
  const originalDocument = globalThis.document;
  const video = createVideo();
  const controller = voicePlayback.createController(() => video);
  controller.enableDucking(0.15);
  globalThis.document = { visibilityState: "hidden" };

  try {
    // Voice catch-up pause, then the user switches tabs (page hidden).
    assert.equal(controller.pauseForCatchUp(), true);
    // Panel teardown broadcast arrives while the page is hidden: the volume
    // is restored but the video must NOT be auto-resumed.
    await controller.restore();
    assert.equal(video.volume, 0.8);
    assert.equal(video.paused, true);
    assert.equal(video.playCalls, 0);

    // Visible again: a genuine catch-up resume plays as before.
    globalThis.document = { visibilityState: "visible" };
    await video.play();
    assert.equal(controller.pauseForCatchUp(), true);
    assert.equal(await controller.resumeAfterCatchUp(), true);
    assert.equal(video.paused, false);
  } finally {
    globalThis.document = originalDocument;
  }
});
