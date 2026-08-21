# 播报速度可调 + 与英文时间线对齐（V1.8.2）

## 目标
1. TTS 设置页新增"播报速度"四档选择（舒缓 0.9x / 标准 1.0x / 偏快 1.15x / 快 1.3x），系统语音与 MiMo 都生效；**默认偏快 1.15x**
2. 永不慢于英文：自适应语速下限 0.85x → **1.0x**（时间宽裕也不故意放慢，节奏均匀）
3. **MiMo 补上实测语速校准**（目前只有系统语音校准，MiMo 用保守估算导致偏慢）

## 改动明细

### 1. voice-sync.js
- `MIN_RATE` 0.85 → 1.0；绝对上限 2.0（新常量 `ABS_MAX_RATE`）
- `calculateAdaptiveRate` 新增可选参数 `speedMultiplier = 1`：基础自适应值（含 lag 提升、[1.0,1.8] 钳制）× 倍率后再钳到 [1.0, 2.0]
- `describePace` 五档文案不变（>1.65 已是"尽可能快速"，覆盖 2.0）

### 2. tts-settings.js
- normalize 新增顶层字段 `speedMultiplier`：仅接受 0.9 / 1 / 1.15 / 1.3，非法回落 **1.15**（默认偏快）；settings.js 已原样透传 voice 结构，无需改动

### 3. options.html + tts-options.js
- TTS 设置区、两个引擎面板之外（通用位置）新增 `<select id="voiceSpeedPreference">` 四档，含中英文 i18n（options.js 词典补 key）
- captureInputs 读取、renderInputs 回填；change 绑 `captureInputs`（**不触发 MiMo 重新验证**——速度不是连接凭证）

### 4. voice-controller.js
- `segmentRate` 把 `settings.voice.speedMultiplier` 传入 `calculateAdaptiveRate`（settings 在 start 时已 normalize，自动携带）
- MiMo 分支补校准：`player.activate` 后记录开始时间，播放 promise 完成后用实际时长调 `calibrateVoiceSpeed`（与系统语音同一 EMA/钳制逻辑）

### 5. 测试更新与新增
- voice-sync.test：0.85 期望值改 1.0；新增 speedMultiplier 乘算与 2.0 钳制用例；describePace 断言适配
- voice-controller.test：rate 范围断言 [0.85,1.8] → [1.0,2.0]；新增"MiMo 播完后 calibratedCps 更新"用例
- tts-settings.test：speedMultiplier 默认 1.15 / 非法回落 / 合法保留
- tts-options.test：harness 补 `voiceSpeedPreference` 元素；新增"选择速度写入配置"用例

### 6. 验证与交付
- `npm test && npm run check && npm run package` 全绿
- E2E（Chrome for Testing）：设置页切到"快"→ 系统语音 utterance.rate 与 MiMo enqueue 的 rate 均 ≥1.3 基准；时间宽裕段落 rate 不再低于 1.0
- 版本 1.7→…→ 升至 **1.8.2** 并打包；project-context.md 记录；GitHub Release 待你确认文案后发布

## 影响面说明
- 时间宽裕段落的语速会比现在略快（从 0.85x 提到 ≥1.0x）——这正是"跟英文一致"的要求
- Chrome speechSynthesis 的 rate 上限 10，2.0 可懂；MiMo 高倍率走"尽可能快速"提示词档
