const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("header orders Transcript, Voice, then Settings", () => {
  const html = read("sidepanel.html");
  const actions = html.match(/<div class="header-actions">([\s\S]*?)<\/div>/)?.[1] || "";

  assert.ok(actions.indexOf('id="transcriptToggle"') >= 0);
  assert.ok(actions.indexOf('id="voiceToggle"') > actions.indexOf('id="transcriptToggle"'));
  assert.ok(actions.indexOf('id="settingsBtn"') > actions.indexOf('id="voiceToggle"'));
  assert.match(
    actions,
    /id="voiceToggle"[\s\S]*role="switch"[\s\S]*aria-checked="false"[\s\S]*disabled/,
  );
});

test("release pages load the Voice modules and expose TTS settings", () => {
  const sidepanel = read("sidepanel.html");
  const options = read("options.html");
  const manifest = JSON.parse(read("manifest.json"));

  assert.match(sidepanel, /<script src="tts-settings\.js"><\/script>/);
  assert.match(sidepanel, /<script src="voice-sync\.js"><\/script>/);
  assert.match(sidepanel, /<script src="voice-translation\.js"><\/script>/);
  assert.match(sidepanel, /<script src="tts-stream-player\.js"><\/script>/);
  assert.match(sidepanel, /<script src="voice-controller\.js"><\/script>/);
  // settings.js resolves its provider registry from YTD_AI_PROVIDERS (it has
  // no require fallback in the browser), so the panel must load the registry
  // first or every YTD_SETTINGS.normalize() call throws and Voice never wires up.
  assert.match(sidepanel, /<script src="ai-providers\.js"><\/script>/);
  assert.ok(
    sidepanel.indexOf('src="ai-providers.js"') < sidepanel.indexOf('src="settings.js"'),
  );
  assert.match(options, /id="ttsProviderList"/);
  assert.match(options, /id="systemVoice"/);
  assert.match(options, /id="mimoAccessMode"/);
  assert.match(options, /id="testTtsBtn"/);
  // options.js writes provider-switch and model-fetch status into #modelStatus
  // without a null guard; a missing element breaks both features on click.
  assert.match(options, /id="modelStatus"/);
  assert.match(options, /<script src="tts-stream-player\.js"><\/script>/);
  assert.match(read("tts-options.js"), /YTD_TTS_STREAM_PLAYER[\s\S]*createPlayer[\s\S]*enqueue/);
  assert.ok(
    manifest.optional_host_permissions.includes("https://api.xiaomimimo.com/*"),
  );
});

test("player CC preference persists and switching tabs pauses the tracked video", () => {
  const playerCaptions = read("player-captions.js");
  // CC is remembered across videos: the toggle reports to the service worker
  // and a new video restores the persisted preference.
  assert.match(playerCaptions, /setPlayerCcEnabled/);
  assert.match(playerCaptions, /state\.enabled = message\.ccEnabled === true/);
  assert.match(read("background.js"), /ytd_player_cc_enabled/);

  // Leaving the video tab pauses playback and keeps the pause user-owned.
  const sidepanel = read("sidepanel.js");
  assert.match(sidepanel, /function pauseTrackedVideo/);
  assert.match(sidepanel, /action: "pauseVideo"/);
  assert.match(sidepanel, /tabId !== youtubeTabId/);
  const content = read("content.js");
  assert.match(content, /message\.action === "pauseVideo"/);
  assert.match(content, /clearCatchUpPause/);
  assert.match(read("voice-playback.js"), /function clearCatchUpPause/);

  // Only one TTS engine may audition at a time on the settings page.
  assert.match(read("tts-options.js"), /function stopTestPlayback/);
});

test("side panel wires Voice to transcript and panel lifecycle", () => {
  const source = read("sidepanel.js");
  const html = read("sidepanel.html");

  assert.match(source, /YTD_VOICE_CONTROLLER\.createController/);
  assert.match(source, /voiceController\?\.setTranscript/);
  assert.match(source, /voiceController\?\.clearTranscript/);
  assert.match(source, /voiceController\?\.seekTo/);
  assert.match(source, /pagehide[\s\S]*voiceController\?\.stop/);
  assert.match(source, /runtime\.connect\(\{ name: "ytd-voice-lifecycle" \}\)/);
  assert.match(read("background.js"), /ytd-voice-lifecycle[\s\S]*restoreVoicePlaybackInYouTubeTabs/);
  assert.match(read("sidepanel.css"), /voice-toggle\[data-state="paused"\]/);
  assert.match(html, /id="voiceStatus"[\s\S]*role="status"[\s\S]*aria-live="polite"/);
});
