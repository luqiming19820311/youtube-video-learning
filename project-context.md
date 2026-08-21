# YouTube Digest 项目上下文

## 文档目的

这份文件用于新会话快速恢复项目背景、关键决策、已完成能力、重要文件关系和当前交付状态。不要在此写入 API Key、访问令牌或其他秘密。

## 项目定位

- 项目名称：YouTube Digest
- 类型：Chrome Manifest V3 扩展，不是独立桌面应用
- 本地工作区：`/Users/luqiming/Downloads/work/zcode/youtube-digest-main`
- 运行环境：Chrome 116+，标准 `https://www.youtube.com/watch?...` 视频页
- 当前发布版本：`1.8.0`
- 目标发布包：`dist/youtube-digest-v1.8.0.zip`（SHA-256：`ac77fb60898b13864062565b4955ba5a8ca9a70cca6da11e30092cc622bde8bd`）
- 用户指定的业务备注：`V1.8.0版本`
- 用户指定的本次变更备注：`新增：中文语音播报，播报如果慢于字幕2段，视频会暂停，等中文播报跟上后再开始，播报时原英文会被压低50%声音。`（实现实际把原声压低到 15% 音量，比文案更安静；文案按用户原话发布）

## 产品关键决策

1. 采用用户自带 API Key（BYOK）：Supadata 用于获取原生 YouTube 字幕，用户选择的 AI 服务商和模型用于概览、解释、翻译、笔记润色和屏幕字幕翻译；DeepSeek V4 Flash 是默认模型。
2. API Key、摘要、翻译缓存和笔记只保存在 Chrome 本地存储；密钥不进入源码、日志、提交记录、截图或发布包。
3. 字幕产品范围固定为三种模式：`Original`、`中文`、`双语`。双语模式为英文在上、中文在下。
4. 字幕获取强制使用 Supadata `mode=native`，没有原生字幕时不自动转为 AI 音频转写。
5. AI 概览按需加载：用户打开 Overview 才调用当前选择的 AI 服务，避免用户只阅读字幕时产生额外费用。
6. 屏幕字幕采用播放器内独立悬浮层，不依赖 YouTube 内部字幕 DOM。`CC` 默认关闭；打开后临时隐藏 YouTube 原生字幕，关闭或切换视频时恢复。
7. 屏幕字幕跟随侧边栏当前语言模式；中文翻译按当前播放位置预取当前段和后续最多 3 段，并复用现有语义段缓存。
8. 侧边栏的 `Transcript` 总开关默认关闭；只有开启后才请求或显示字幕。状态保存为 `ytd_transcript_tabs_enabled`。
9. **中文语音播报（Voice，V1.8.0 核心功能）**：
   - 播报单元 = 侧边栏语义分段（`segment-<index>-<startMs>`，与双语视图同 ID），直接共享 `transcriptParagraphCache` 翻译缓存——已翻好零请求秒播，未翻的由 Voice 翻译后回填视图。
   - 两种引擎：系统本地中文语音（默认）与小米 MiMo 流式 TTS（设置页测试通过才可启用）。
   - 追赶策略：播报落后视频 1 段提速到 1.35x，落后 2 段视频暂停（`pauseForVoiceCatchUp`，带 `pausedByVoice` 标记），追上后恢复；只有 Voice 造成的暂停才会被自动恢复。
   - 播报期间原视频音量压低到 15%（ducking），停止/暂停播报时精确恢复原音量与静音状态。
   - 自适应语速：以实测语音引擎基础语速（字/秒，EMA 校准）计算，跟随英文演讲者速度与视频倍速。
   - 开关与偏好持久化：`ytd_voice_enabled`（开关，面板重建自动恢复）、`ytd_voice_spoken_through`（已播进度，6 小时时效）、`ytd_transcript_mode`（语言模式）、`ytd_player_cc_enabled`（播放器 CC）。
10. **切走即静音**：切换标签页 / 其他浏览器窗口 / 其他应用 / 最小化，视频都会被暂停（多信号防线：面板 `tabs.onActivated` + `windows.onFocusChanged`（含 `WINDOW_ID_NONE`）+ 页面内 `visibilitychange`），切回保持暂停等用户按播放。
11. **切回续播规则**：落点句已听 ≥25% → 整句跳过、立即播下一句（不等其视频时间戳）；已听 <25% → 整句重播；主动向后拖进度条不受影响。
12. 为避免长句裁切，屏幕字幕使用播放器约 94% 可用宽度、`16px–26px` 自适应字号、自然换行和长词断行。
13. `CC` 放在播放器左上角，点击区域 `44×44px`，隔离 pointer/click 事件。

## 整体架构

```text
YouTube 页面
  ├─ player-captions.js：播放器字幕层、CC 开关（持久化经 service worker）、播放时间匹配、翻译预取、广告感知
  ├─ voice-playback.js：视频音量 ducking(0.15)、追赶暂停/恢复、visibilitychange 自暂停、隐藏页面禁自动播放
  └─ content.js：Digest/Note 按钮、视频信息、播放器跳转、pauseVideo、广告状态快照(adShowing)
          │ chrome.runtime messages
          ▼
  ai-providers.js：多厂商注册表、模型解析、请求适配和响应解析
          │ importScripts
          ▼
  background.js：服务 worker
  ├─ Supadata：获取带时间戳原生字幕（>20 分钟走异步 job 轮询）
  ├─ 多厂商 AI：DeepSeek、Groq、Qwen、火山、Gemini、智谱、MiMo、本地和自定义
  ├─ mimo-tts.js：MiMo 流式 TTS（SSE 音频解析、4MiB 上限、预中止 signal、45s 翻译超时）
  ├─ fetchProviderModels：远程模型列表与内置回退
  ├─ chrome.storage.local：设置、摘要缓存、翻译缓存、笔记（TRUSTED_CONTEXTS）
  ├─ 端口：ytd-tts-stream（音频流）、ytd-voice-lifecycle（面板关闭恢复视频）
  └─ 安全校验：JSON、时间戳、翻译段 ID、超时和响应体大小
          ▲
          │ chrome.runtime / chrome.tabs messages
          ▼
sidepanel.html + sidepanel.js + sidepanel.css
  ├─ transcript-toggle.js：Transcript 总开关（默认关、持久化、请求代次令牌）
  ├─ voice-sync.js：纯函数（自适应语速、追赶动作、中文检测、seek 判定、语速估算）
  ├─ voice-translation.js：分段批量翻译（≤6 段/批、超时保护）
  ├─ tts-stream-player.js：AudioWorklet 流式 PCM 播放（24kHz、base64 PCM16）
  ├─ voice-controller.js：Voice 状态机（启动重试、追赶、seek 去重、广告保持、
  │   切回跳句、看门狗防挂起、引擎卡死解锁、语速校准、进度心跳落盘）
  ├─ Transcript：语义分组、三种语言模式、按需翻译队列、稳定 ID 对齐
  ├─ Overview：章节和重点引用（按需）
  └─ Notes：保存、播放、复制、删除、按视频筛选

options.html + options.js + options.css
  ├─ Supadata Key 与多厂商独立 AI 配置（ai-providers.js）
  ├─ tts-settings.js / tts-options.js：系统语音与 MiMo TTS 配置（测试互斥、验证后启用）
  ├─ English / 简体中文设置页界面语言
  └─ 本地缓存、笔记和扩展数据清理
```

## 已完成部分（按能力）

### 多厂商 AI 模型中心（V1.7.0）

- `ai-providers.js` 注册本地 Fully Local、Groq、DeepSeek、Custom、Qwen、Volcengine、Gemini、Zhipu GLM、Xiaomi MiMo；每厂商独立 Key/Endpoint/模型列表；模型列表远程获取失败回退内置。

### 字幕与翻译（V1.7.0）

- `groupTranscriptEntries()` 将 Supadata caption 合并为语义段（含 `end` 时间，供 Voice 使用）；稳定 ID `segment-<index>-<startMs>`；翻译缓存键 `<videoId>:zh:semantic:<segmentId>`；按稳定 ID 对齐校验。

### Transcript 总开关（V1.7.0）

- 默认关闭；关闭时不请求/显示/翻译；代次令牌失效延迟响应；播放器 CC 受其控制。

### 中文语音播报 Voice（V1.8.0 核心）

- 播报单元与面板语义分段统一，翻译缓存双向共享（Voice 翻译结果即时回填双语视图并防抖持久化）。
- 系统语音看门狗：引擎空闲 1.2s / 暂停感知硬时限（估算×1.8+15s）防 Chrome 丢事件挂起；utterance 强引用。
- 引擎卡死解锁：macOS Chrome 长 pause 后 resume 静默失效 → 1.5s 复查仍 paused 即 `cancel()` 解锁，看门狗 idle 路径恢复下一句。
- 启动重试：内容脚本晚到/扩展重载后旧页面失联时，关键 relay 重试 3 次（间隔 1s），耗尽提示刷新页面。
- 同页单例守卫：`__YTD_VOICE_PANEL_BOOTED__` 防脚本双执行导致双控制器双朗读。
- seek 去重：段内跳变只更新基线继续播；广告期间（`adShowing`）暂停播报、跳过 seek 判定、结束首拍重置基线；pause/resume 只在期望状态变化时触碰引擎（防 Chrome 重播怪癖）。
- 切回续播：`ytd_voice_spoken_through` 记录已开始句与已听字符（每秒心跳落盘），按 25% 规则跳句/重播，`resumeSpeakImmediately` 立即开口无空窗。
- 语速跟随：自然播完后实测引擎字/秒（EMA、钳制 2.5–8），自适应语速 = 估算时长 ÷ 剩余窗口 × 视频倍速，落后 1/2 段分别 1.35x/1.8x。

### 切换页面体验（V1.8.0）

- 切走暂停：`windows.onFocusChanged`（其他窗口 + NONE）→ `pauseTrackedVideo`；`visibilitychange` 页面内自暂停兜底；`tabs.onActivated` 同窗口切标签。
- 防自动恢复：`resumeAfterCatchUp` 在 `document.hidden` 时跳过 play；面板清理广播不再把隐藏视频播出去。
- 切回：视频保持暂停；按播放后视频 ducked 恢复、TTS ≤1s 自动恢复朗读（GUI 级验证）。
- TTS 设置页测试互斥：`stopTestPlayback()` 保证系统/MiMo 试听不重叠。

### 安全与可靠性

- AI 请求：空闲 50s / 硬超时 120s / 响应体 2MiB；先判 `response.ok` 再解析（`readProviderErrorMessage` 容错空 body/HTML 错误页，保留 401/429 状态映射）。
- `chrome.storage.local` TRUSTED_CONTEXTS；内容脚本经消息由 service worker 读写（CC 偏好等）。
- 发布检查扫描凭据、缺失引用、危险路径和 JS 语法；白名单 34 文件。

## 重要文件修改记录

| 文件 | 作用 / 关键修改 |
| --- | --- |
| `manifest.json` | MV3；content_scripts 注入 player-captions/voice-playback/content；可选域名权限；版本 `1.8.0` |
| `voice-controller.js` | **V1.8.0 核心**：Voice 状态机；翻译缓存共享、追赶/暂停、seek 去重、广告保持、切回跳句、看门狗、引擎解锁、语速校准、启动重试、进度心跳 |
| `voice-playback.js` | ducking 0.15、追赶暂停/恢复、visibilitychange 自暂停、隐藏页禁自动播放 |
| `voice-sync.js` | 纯函数：`calculateAdaptiveRate(charactersPerSecond)`、`estimateSpeechSeconds`、`getCatchUpAction`、`isPlaybackSeek`、`isChineseTranscript` |
| `voice-translation.js` | 分批翻译（≤6 段）+ `sendMessageWithTimeout`（45s 默认） |
| `mimo-tts.js` | MiMo 流式 TTS、SSE 音频解析、4MiB 上限、已中止 signal 预检查、端口协议（synthesize/cancel/audio/complete/error） |
| `tts-stream-player.js` | AudioWorklet PCM 播放器（24kHz、base64 PCM16→Float32、请求队列与代次过滤） |
| `tts-audio-worklet.js` | PCM 播放处理器（push/end/reset/drained） |
| `tts-settings.js` / `tts-options.js` | Voice 设置规范化（MiMo 验证 `verifiedAt`）、设置页控制器（测试互斥、中文语音列表） |
| `sidepanel.js` | 语义分组含 `end`；`syncVoiceTranscript`/`handleVoiceTranslationsAdded`；语言模式与 CC 偏好持久化；`pauseTrackedVideo`（onActivated + onFocusChanged 含 NONE）；单例启动守卫 |
| `player-captions.js` | 播放器字幕层；CC 偏好经 `setPlayerCcEnabled` 持久化、新视频恢复记忆状态 |
| `content.js` | `pauseVideo`（含 `clearCatchUpPause`）、`getVoicePlaybackState` 含 `adShowing` |
| `background.js` | 多厂商 AI 路由、翻译校验、MiMo TTS 端口、`setPlayerCcEnabled`、`readProviderErrorMessage`、轮询路径 cleanText、笔记回退取行修正 |
| `sidepanel.html/options.html` | **修复历史 bug**：补 `ai-providers.js` script（Voice 曾整体瘫痪）、补 `#modelStatus`、Voice 开关与 TTS 设置 UI |
| `tests/`（17 个文件，132 用例） | 覆盖：翻译分段/缓存、Voice 全状态机（追赶/seek/广告/切回/看门狗/解锁/重试/持久化）、TTS（SSE/超时/互斥/播放器）、CC/切走暂停/焦点切换、发布约束 |

## 验证基线

V1.8.0 发布前全绿：

- `npm test`：132 项全部通过
- `npm run check`：发布检查通过（34 白名单文件）
- `npm run package`：生成 `dist/youtube-digest-v1.8.0.zip`，`unzip -t` 完整
- SHA-256：`ac77fb60898b13864062565b4955ba5a8ca9a70cca6da11e30092cc622bde8bd`
- 浏览器验证（Chrome for Testing 147 + `--load-extension`，含 OS 级真实焦点切换 AppleScript）：缓存秒播（0 翻译请求）、追赶暂停/恢复、切走即停（标签/窗口/应用）、切回 1s 内恢复朗读、段内 seek 不重播、压测暂停/恢复三轮不卡死；全程零异常
- 版本变更后必须重新运行上述三条命令

## 调试与运维提示

- **重载扩展后必须刷新 YouTube 页面**：旧页面内容脚本失联（"Could not establish connection"）；Voice 启动重试能熬过慢加载，真失联会显示 "Cannot reach the YouTube player. Refresh the page"。
- 测试环境：品牌 Chrome 137+ 不支持 `--load-extension`，用 `~/.cache/puppeteer/chrome/mac_arm-147.0.7727.57` 的 Chrome for Testing（加 `--disable-features=DisableLoadExtensionCommandLineSwitch --autoplay-policy=no-user-gesture-required`）。
- CDP 驱动：手写 WebSocket 客户端（内核无 fetch/WebSocket 全局）；页面脚本里带连字符的存储键不能做未加引号的对象字面量键。
- 语音朗读验证：monkeypatch `speechSynthesis.speak` 记录文本；音源状态以 `video.paused/volume` + `speechSynthesis.speaking/paused` 为准。
- macOS 语音引擎怪癖：长 pause 后 resume 可能静默失效（已自动解锁）；pause/resume 循环可能重播 utterance（已状态去重）。

## 2026-08-21 播报全局持续 + 双声根治（V1.8.1）

用户澄清"双声"是**两个中文播报叠加**（非视频原声），并要求：**播报窗口无关**——切到任何窗口/应用都不许中断播报（也不要暂停播报中的视频）。

设计：播报权（owner）互斥替代窗口焦点门控。

1. **播报窗口无关**（voice-playback.js / content.js）：`isDucking()`（ducking 激活 = 播报中）时，`visibilitychange` 自暂停与 `pauseVideo` 消息都跳过——播报中的视频跨窗口持续播放供播报跟随；Voice 未启用时切走仍暂停视频（既有行为）。
2. **全局播报权**（voice-controller.js）：`ytd_voice_owner`（{id, ts}，1s 心跳、5s 过期）。播报启动即 claim；**自动恢复/自动重启前检查**——他人心跳新鲜则不启动（提示 "Voice is narrating in another window"）；手动点击开关不检查（直接接管）。`storage.onChanged` 监听 owner 变化：他人接管时本面板立即让位停止。stop/释放时清除 owner。`setIntervalFn/clearIntervalFn` 注入续约定时器。
3. 移除上一版的 `setWindowFocus` 焦点门控（sidepanel.js 的 onFocusChanged 仅保留 pauseTrackedVideo，播报中会被内容脚本跳过）。

验证：OS 级真实切换——切到其他应用 6 秒：播报继续（spoken 1→3）、视频持续（ducked）；切到另一浏览器窗口（无面板）8 秒：播报 8/8 秒持续出声、视频持续播放；双面板场景 overlap=0（无双声，自动恢复被 owner 挡住）。134 项测试全过。版本 1.8.1，`dist/youtube-digest-v1.8.1.zip`（SHA-256：`d006034c722b8c8dd8d2f32fa863d66df2acfceb944a5945a52b2672ce63f182`）。V1.8.1 已发布：GitHub Release `v1.8.1`（标题 `V1.8.1版本`，Latest），附件 `youtube-digest-v1.8.1.zip`（144069 字节，与本地 SHA-256 一致），备注：`youtube-digest-v1.8.1；修复：中文播报改为全局持续——切换窗口或应用时播报不中断，播报中的视频不再被暂停；修复两个中文播报叠加的问题，任何时刻全局只有一个播报声音（手动点击开关可直接接管）。`

## 2026-08-22 回退 1.8.2 → 1.8.1

用户反馈 1.8.2（播报速度四档）效果不好，要求回退到 1.8.1（`1d95625`）。已执行 `git revert 3211817`（提交 `ebab1b2`），代码与设置页回到 1.8.1 状态：无"播报速度"选项，语速下限恢复 0.85，MiMo 恢复为不校准。134 项测试全过；重新打包的 `dist/youtube-digest-v1.8.1.zip` 与已发布 v1.8.1 Release 附件**内容逐文件一致**（zip 整体 SHA 差异仅为打包时间戳）。GitHub v1.8.1 Release 无需变更。速度调整需求保留待后续重新设计（可能需要更保守的默认值或更细的档位）。

## 当前 GitHub 交付状态

- 目标仓库：`luqiming19820311/youtube-video-learning`（Private，需保持）
- 分支：`feat/transcript-master-toggle`（工作分支，推送到 origin）
- 版本：`1.8.1`（Latest）；历史 `1.8.0`/`1.7.0`；发布包 `youtube-digest-v1.8.1.zip`
- GitHub Release：`v1.8.0`，标题 `V1.8.0版本`，备注：`youtube-digest-v1.8.0`；`新增：中文语音播报，播报如果慢于字幕2段，视频会暂停，等中文播报跟上后再开始，播报时原英文会被压低50%声音。`
- 历史版本：`v1.7.0`（Transcript 开关与多模型选择）及其 Release 附件为旧包
- 若 GitHub CLI 授权过期，使用 `gh auth login -h github.com` 重新授权后再推送

## 下一次会话建议入口

1. 先检查 `git status --short --branch`、`git remote -v` 和 `gh auth status`。
2. 确认 `luqiming19820311/youtube-video-learning` 仍为 Private。
3. 运行 `npm test && npm run check && npm run package` 确认基线（132 项测试）。
4. 检查 `dist/youtube-digest-v1.8.0.zip`，核对 SHA-256 与 GitHub Release 附件一致。
5. 常见后续任务入口：Voice 行为调优在 `voice-controller.js`（追赶阈值在 `voice-sync.js getCatchUpAction`、ducking 音量在 `start()` 的 factor 0.15、跳句阈值 25% 在 `start()`）；新增厂商在 `ai-providers.js`；播放器字幕在 `player-captions.js`。
