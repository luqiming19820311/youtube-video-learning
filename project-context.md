# YouTube Digest 项目上下文

## 文档目的

这份文件用于新会话快速恢复项目背景、关键决策、已完成能力、重要文件关系和当前交付状态。不要在此写入 API Key、访问令牌或其他秘密。

## 项目定位

- 项目名称：YouTube Digest
- 类型：Chrome Manifest V3 扩展，不是独立桌面应用
- 本地工作区：`/Users/luqiming/Downloads/work/codex/youtube-digest-main`
- 运行环境：Chrome 116+，标准 `https://www.youtube.com/watch?...` 视频页
- 当前发布版本：`1.1.6`
- 目标发布包：`dist/youtube-digest-v1.1.6.zip`
- 用户指定的业务备注：`V1.1.6版本`
- 用户指定的本次变更备注：`新增：屏幕字幕显示`

## 产品关键决策

1. 采用用户自带 API Key（BYOK）：Supadata 用于获取原生 YouTube 字幕，DeepSeek V4 Flash 用于概览、解释、翻译和笔记润色。
2. API Key、摘要、翻译缓存和笔记只保存在 Chrome 本地存储；密钥不进入源码、日志、提交记录、截图或发布包。
3. 字幕产品范围固定为三种模式：`Original`、`中文`、`双语`。双语模式为英文在上、中文在下。
4. 字幕获取强制使用 Supadata `mode=native`，没有原生字幕时不自动转为 AI 音频转写。
5. AI 概览按需加载：用户打开 Overview 才调用 DeepSeek，避免用户只阅读字幕时产生额外费用。
6. 屏幕字幕采用播放器内独立悬浮层，不依赖 YouTube 内部字幕 DOM。`CC` 默认关闭；打开后临时隐藏 YouTube 原生字幕，关闭或切换视频时恢复。
7. 屏幕字幕跟随侧边栏当前语言模式；中文翻译按当前播放位置预取当前段和后续最多 3 段，并复用现有语义段缓存。
8. 为避免长句裁切，屏幕字幕使用播放器约 94% 可用宽度、`16px–26px` 自适应字号、自然换行和长词断行。
9. 为避免 YouTube 控制条与侧边栏边界抢占点击，`CC` 放在播放器左上角，点击区域为 `44×44px`，并隔离 pointer/click 事件。

## 整体架构

```text
YouTube 页面
  ├─ player-captions.js：播放器字幕层、CC 开关、播放时间匹配、翻译预取
  └─ content.js：Digest/Note 按钮、视频信息、播放器跳转、笔记反馈
          │ chrome.runtime messages
          ▼
background.js：服务 worker
  ├─ Supadata：获取带时间戳原生字幕
  ├─ DeepSeek：概览、解释、翻译、笔记润色
  ├─ chrome.storage.local：设置、摘要缓存、翻译缓存、笔记
  └─ 安全校验：JSON、时间戳、翻译段 ID、超时和响应体大小
          ▲
          │ chrome.runtime / chrome.tabs messages
          ▼
sidepanel.html + sidepanel.js + sidepanel.css
  ├─ Transcript：字幕分组、复制、导出、自动跟随播放
  ├─ Overview：章节和重点引用
  ├─ Translation：Original / 中文 / 双语、按需队列、稳定 ID 对齐
  └─ Notes：保存、播放、复制、删除、按视频筛选

options.html + options.js + options.css
  ├─ Supadata / DeepSeek Key 设置
  ├─ English / 简体中文设置页界面语言
  └─ 本地缓存、笔记和扩展数据清理
```

## 已完成部分

### 屏幕字幕

- 新增 `player-captions.js` 并在 `manifest.json` 中于 `content.js` 之前注入。
- 通过 Shadow DOM 创建字幕层，按视频时间选择当前语义字幕段。
- 支持原文、中文和双语三种显示模式。
- 支持 CC 开关；打开时隐藏 YouTube 原生字幕，清理时恢复。
- 翻译请求使用 `translatePlayerCaptionBatch`，复用后台现有翻译校验和缓存。
- 长文本使用宽区域、自适应字号、换行和长词断行，避免右侧被截断。
- CC 已移到左上角并增加点击命中区，避免与右下角控制条或侧边栏边界冲突。

### 字幕与翻译

- `sidepanel.js` 的 `groupTranscriptEntries()` 将 Supadata caption 合并为语义段。
- 稳定段 ID 格式为 `segment-<index>-<startMilliseconds>`。
- 翻译缓存键为 `<videoId>:zh:semantic:<segmentId>`，写入 `digest_<videoId>.paragraphCache`。
- 翻译返回按稳定 ID 对齐，未知、重复、缺失或非中文结果不会被错误映射。

### 安全与可靠性

- `background.js` 限制 DeepSeek 请求空闲超时 50 秒、硬超时 120 秒、响应体 2 MiB。
- AI 响应支持宽松 JSON 解析，同时重建允许的输出结构。
- 时间戳会依据视频时长和字幕最后时间校验。
- `chrome.storage.local` 设置为 `TRUSTED_CONTEXTS`，避免内容脚本读取密钥。
- 发布检查扫描凭据、缺失引用、危险路径和 JavaScript 语法。

## 重要文件修改记录

| 文件 | 作用 / 已完成修改 |
| --- | --- |
| `manifest.json` | Manifest V3；注册 `player-captions.js`；当前版本 `1.1.6` |
| `package.json` | npm scripts：`test`、`check`、`package`；当前版本 `1.1.6` |
| `player-captions.js` | 新增播放器字幕层、CC 控制、播放匹配、翻译预取、长文本布局和点击隔离 |
| `content.js` | YouTube 页面 Digest/Note 注入、视频信息读取、跳转和笔记保存入口 |
| `background.js` | Supadata、DeepSeek、消息路由、翻译校验、播放器字幕翻译缓存 |
| `sidepanel.js` | 字幕分组、语言模式、翻译队列、缓存同步、概览、笔记和自动滚动 |
| `sidepanel.html/css` | 侧边栏 Transcript / Overview / Notes 界面与样式 |
| `options.js/html/css` | API Key、界面语言、本地数据管理和安全改造提示词 |
| `settings.js` | 默认 DeepSeek V4 Flash 配置、设置规范化、YouTube URL 校验 |
| `scripts/check-release.sh` | 发布白名单、安全扫描、引用检查、语法检查和测试入口 |
| `scripts/package-extension.sh` | 根据 `manifest.json` 版本生成 `dist/youtube-digest-v<version>.zip` |
| `tests/player-captions.test.js` | 播放匹配、模式渲染、翻译预取、长文本布局、CC 点击区域回归测试 |
| `tests/translation.test.js` | 翻译分段校验、缓存合并、侧边栏到播放器状态同步测试 |
| `tests/release.test.js` | Manifest、版本、发布文案和白名单约束测试 |

## 验证基线

最近一次功能验证在字幕 CC 修复后通过：

- `npm test`：49 项测试全部通过
- `npm run check`：发布检查通过，23 个白名单文件
- `npm run package`：生成并校验扩展包
- ZIP 完整性：`unzip -t` 通过
- 当前版本升级后应重新运行上述三条命令，目标包为 `dist/youtube-digest-v1.1.6.zip`

## 当前 GitHub 交付状态

- 用户目标仓库：`luqiming19820311/youtube-video-learning`
- 目标仓库状态：Private
- 期望业务备注：`V1.1.6版本`
- 期望发布包备注：`youtube-digest-v1.1.6`；`新增：屏幕字幕显示`
- 当前工作区没有 `.git`，因此不存在可识别的当前分支、远程 `origin` 或本地提交历史。
- 本机 `gh` 已安装，但账号 `luqiming19820311` 的登录令牌已失效，需要重新 `gh auth login -h github.com`。
- GitHub 连接器访问目标仓库返回 404，可能是仓库尚未创建，也可能是当前连接器账号没有访问权限。
- 重新进入交付会话时，先确认仓库已创建为 Private、GitHub 账号已授权，然后初始化/绑定 Git 远程，提交 `V1.1.6` 发布备注并推送当前版本。

## 下一次会话建议入口

1. 先检查 `git status --short --branch`、`git remote -v` 和 `gh auth status`。
2. 确认 `luqiming19820311/youtube-video-learning` 可访问且为 Private。
3. 运行 `npm test && npm run check && npm run package`。
4. 检查 `dist/youtube-digest-v1.1.6.zip`，提交消息建议：`release: 发布 V1.1.6，新增屏幕字幕显示`。
5. 推送后在 GitHub Release/PR 中记录：`V1.1.6版本`、包名 `youtube-digest-v1.1.6`、备注 `新增：屏幕字幕显示`。
