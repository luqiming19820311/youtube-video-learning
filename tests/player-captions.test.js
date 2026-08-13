const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function loadPlayerCaptions() {
  const source = fs.readFileSync(
    path.join(root, "player-captions.js"),
    "utf8",
  );
  const listeners = { addListener() {} };
  const sandbox = {
    console,
    document: { addEventListener() {} },
    window: { location: { pathname: "/watch" } },
    chrome: { runtime: { onMessage: listeners } },
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox);
  return sandbox.__YTD_PLAYER_CAPTIONS_TESTING__;
}

test("selects the caption segment containing the playback time", () => {
  const { findActiveSegment } = loadPlayerCaptions();
  const segments = [
    { id: "segment-0-0", start: 0, text: "First sentence." },
    { id: "segment-1-5000", start: 5, text: "Second sentence." },
    { id: "segment-2-12000", start: 12, text: "Third sentence." },
  ];

  assert.equal(findActiveSegment(segments, 0).id, "segment-0-0");
  assert.equal(findActiveSegment(segments, 11).id, "segment-1-5000");
  assert.equal(findActiveSegment(segments, 12).id, "segment-2-12000");
  assert.equal(findActiveSegment(segments, -1), null);
});

test("renders original, Chinese, and bilingual caption lines in the chosen order", () => {
  const { buildCaptionLines } = loadPlayerCaptions();
  const segment = { id: "segment-0-0", text: "Original English sentence." };

  assert.deepEqual(
    JSON.parse(JSON.stringify(buildCaptionLines(segment, "original", "中文译文。"))),
    [{ text: "Original English sentence.", kind: "original" }],
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(buildCaptionLines(segment, "zh", "中文译文。"))),
    [{ text: "中文译文。", kind: "translation" }],
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(buildCaptionLines(segment, "bilingual", "中文译文。"))),
    [
      { text: "Original English sentence.", kind: "original" },
      { text: "中文译文。", kind: "translation" },
    ],
  );
});

test("preloads the active Chinese caption and the next three untranslated segments", () => {
  const { getTranslationBatch } = loadPlayerCaptions();
  const segments = Array.from({ length: 6 }, (_, index) => ({
    id: `segment-${index}-${index * 5000}`,
    start: index * 5,
    text: `Sentence ${index}.`,
  }));
  const translations = new Map([["segment-1-5000", "已缓存。"]]);

  assert.deepEqual(
    JSON.parse(JSON.stringify(getTranslationBatch(segments, 1, translations, new Set()))),
    ["segment-2-10000", "segment-3-15000", "segment-4-20000"],
  );
});

test("caption layout preserves long bilingual text by using nearly the full player width and wrapping", () => {
  const source = fs.readFileSync(path.join(root, "player-captions.js"), "utf8");

  assert.match(source, /left:3%;\s*right:3%;\s*bottom:11%/);
  assert.match(source, /font-size:clamp\(16px,1\.55vw,26px\)/);
  assert.match(source, /width:fit-content;\s*max-width:100%/);
  assert.match(source, /white-space:normal/);
  assert.match(source, /overflow-wrap:anywhere/);
  assert.match(source, /word-break:break-word/);
  assert.doesNotMatch(source, /\.caption\s*\{\s*width:max-content/);
});

test("CC control stays in the player safe area and isolates its pointer events", () => {
  const source = fs.readFileSync(path.join(root, "player-captions.js"), "utf8");

  assert.match(source, /button \{ position:absolute; top:16px; left:16px; bottom:auto;/);
  assert.match(source, /min-width:44px;\s*height:44px/);
  assert.match(source, /touch-action:manipulation/);
  assert.match(source, /state\.toggle\.addEventListener\("pointerdown", \(event\) => \{\s+event\.stopPropagation\(\);/);
  assert.match(source, /state\.toggle\.addEventListener\("click", \(event\) => \{\s+event\.preventDefault\(\);\s+event\.stopPropagation\(\);/);
  assert.doesNotMatch(source, /button \{ position:absolute; right:14px; bottom:14px/);
});

test("same-video YouTube navigation preserves CC state while a new video clears it", () => {
  const { shouldClearOnNavigation } = loadPlayerCaptions();

  assert.equal(
    shouldClearOnNavigation(
      "https://www.youtube.com/watch?v=current123",
      "current123",
    ),
    false,
  );
  assert.equal(
    shouldClearOnNavigation(
      "https://www.youtube.com/watch?v=next456",
      "current123",
    ),
    true,
  );
});

test("caption state retries mounting until the YouTube player is ready", () => {
  const source = fs.readFileSync(path.join(root, "player-captions.js"), "utf8");

  assert.match(source, /const MAX_ATTACH_ATTEMPTS = 20;/);
  assert.match(source, /function scheduleAttach\(videoId, generation, attempt = 0\)/);
  assert.match(source, /if \(attachToPlayer\(\)\) \{\s*render\(\);\s*return;/);
  assert.match(source, /scheduleAttach\(videoId, generation, attempt \+ 1\)/);
});
