<div align="center">

<img src="extension/icons/icon128.png" width="100" alt="DSH Browser Control">

# DSH Browser Control

**让 AI 用你自己的浏览器干活——已登录的账号、看得见的操作、本机的文件。**

[![简体中文](https://img.shields.io/badge/lang-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-red.svg)](README.md) [![English](https://img.shields.io/badge/lang-English-blue.svg)](README.en.md)

[![npm version](https://img.shields.io/npm/v/@angelky7/dsh-browser-control?style=flat&label=version&color=2EA44F)](https://www.npmjs.com/package/@angelky7/dsh-browser-control)
[![downloads](https://img.shields.io/npm/dm/@angelky7/dsh-browser-control?style=flat&label=downloads&color=2EA44F)](https://www.npmjs.com/package/@angelky7/dsh-browser-control)
[![GitHub downloads](https://img.shields.io/github/downloads/angelky7/dsh-browser-control/total?style=flat&label=release%20downloads&color=2EA44F)](https://github.com/angelky7/dsh-browser-control/releases)
[![CI](https://github.com/angelky7/dsh-browser-control/actions/workflows/ci.yml/badge.svg)](https://github.com/angelky7/dsh-browser-control/actions/workflows/ci.yml)
[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)
[![license](https://img.shields.io/badge/license-AGPL--3.0-2EA44F?style=flat)](LICENSE)

<img src="assets/banner.png" width="520" alt="DSH Browser Control — a whale searching Google with a mouse">

</div>

## 这是什么

一个 dsh 插件 + 一个 Chrome 扩展：扩展通过本机 loopback（默认 `127.0.0.1:9777`）连到 dsh，模型就能在**你日常用的浏览器**里导航、读页面、点击、输入、拖拽、上传、截图、导出 PDF/MHTML、读写 cookie、看性能指标。

不用起 headless，不用把登录态搬来搬去，也不需要 MCP——它驱动的就是你屏幕上那个已登录的 Chrome。

- 30 个 `browser_*` 工具，agent 说人话就能用
- 操作可见：agent 开的标签自动进 `DSH` 分组；扩展弹窗一键只读（只拦 agent）
- 右侧栏「实时浏览器」面板：直接看、直接操作扩展接管的标签页（v1.9.0）
- 本机闸门：只读 / 禁脚本 / 上传白名单
- 有账可查：操作审计 + 跨重启 journal
- 扩展一次装好：常规功能更新只更插件（扩展侧安全/平台修复除外）

## 安装

### 1. Chrome 扩展

下载 [DSH-Browser-Control-v1.7.5.zip](https://github.com/angelky7/dsh-browser-control/releases/download/v1.7.14/DSH-Browser-Control-v1.7.5.zip)，解压到固定文件夹（别删），打开 `chrome://extensions` → 开发者模式 → 「加载已解压的扩展程序」→ 选那个文件夹。需要 Chrome 116+；图标绿点 = 已连接。

> 装过 v1.7.2 的不用重装：v1.7.3–v1.7.10 的功能更新都不需要动扩展。
>
> v1.9.1 插件配套的扩展是 **1.7.7**（v1.9.0 起弹窗「只读」开关只拦模型、不拦你在面板里的操作；1.7.7 起空闲时自动解除调试器，Chrome 的调试信息栏不再常驻，图标用颜色区分「操作中 / 空闲」）。它还没打包发布，先从仓库的 `extension/` 目录「加载已解压的扩展程序」；已经在用旧版的话，在 `chrome://extensions` 里对它点一次「重新加载」并确认版本号变成 1.7.7。旧扩展照样能连新插件，只是弹窗开关还是「全部冻结」的老行为、调试信息栏也一直挂着。

### 2. dsh 插件

```bash
dsh plugin --profile web add @angelky7/dsh-browser-control
```

或从 GitHub tag：

```bash
dsh plugin --profile web add "github:angelky7/dsh-browser-control#v1.8.0"
```

离线包：[dsh-browser-control-plugin-v1.8.0.zip](https://github.com/angelky7/dsh-browser-control/releases/download/v1.8.0/dsh-browser-control-plugin-v1.8.0.zip)，解压后对含 `package.json` 的那一层执行 `dsh plugin --profile web add file:<那一层>`。

装完重启 dsh。桥默认开启，状态页 <http://127.0.0.1:9777/>。刚发布的版本装不上（镜像延迟 / 24 小时包龄闸门）见 [安装排障](docs/INSTALL.md)。

## 快速开始

装好后直接对 agent 说：

> 用 browser_snapshot 看看当前页，再按 ref 点登录按钮。

常用入口：`browser_snapshot` 先看页面，`browser_read` 读正文，`browser_click` / `browser_type` 按 ref 操作，`browser_screenshot` 截图。完整说明见 [工具清单](docs/TOOLS.md) 与 [行为契约](docs/BEHAVIOR.md)。

## 实时浏览器面板（右侧栏）

v1.9.0 起，Web 端右侧栏的向导里多一张 **实时浏览器** 卡片。打开后显示扩展接管的那个真实标签页的画面（JPEG 帧，默认每 1.5 秒自动刷新），用的是你自己的登录态：

- 标签页下拉：跟随当前标签页，或固定看某一个（选中即把它切到前台）
- 地址栏：回车打开；裸域名补 `https`，不像地址的词进搜索；「新标签页」在新标签页打开
- 后退 / 前进 / 刷新页面 / 刷新画面 / 自动刷新；「在浏览器中打开」跳到系统浏览器
- 在画面上点击 = 点击页面，滚轮 = 滚动页面；底部输入框把文字送进页面（Enter 发送并回车，Shift+Enter 只发送），旁边是 Esc / ⌫ / Tab

面板和 `browser_*` 工具走同一条桥（Typert 远程 `browser-live`），操作同样进审计账本。**只读档只拦 agent 的工具**：你在面板里的操作不受它限制，所以打开只读档就等于「只许看、不许 agent 动我的浏览器」。扩展弹窗里的「只读」开关是同一个意思（扩展 1.7.6 起）：开了之后模型仍能读页面，但点击、输入、导航、滚动都会被拒；你在面板里的操作照常。画面是定时截图，不是视频流；扩展未连接时面板会直接说明。

## Chrome 的调试信息栏与图标颜色（扩展 1.7.7）

扩展靠 Chrome 的调试器协议操作页面；调试器挂在哪个标签页上，Chrome 就在那一页顶上显示它自己的「“DSH Browser Control”已开始调试此浏览器」信息栏。那是浏览器的安全提示，扩展改不了它的样子，也藏不掉它。所以 1.7.7 起**不再一直挂着**：最后一条命令之后 20 秒内没有新命令，就解除调试器（信息栏随之消失），下一条命令来了再挂上。工具栏图标替它说话，弹窗里也有同一行说明：

| 图标 | 含义 |
|---|---|
| 蓝色 `RUN` | 已连接，正在操作某个标签页——Chrome 此时显示它的调试信息栏 |
| 绿色 `ON` | 已连接，空闲：没有挂着调试器，没有信息栏 |
| 红色 `RO` | 弹窗里的「只读」开着（压过上面两种：「已连接但只读」不能看起来像正常） |
| 黄色 `…` / 灰色 `OFF` | 连接中 / 未连接 |

空闲解除只收调试器，别的东西都记着：控制台与网络日志、设备视口与网络 / CPU 节流，下一条命令重新挂上时原样恢复（`device:"reset"` 之后自然不再恢复）。两个代价要知道：

- 两条命令相隔超过 20 秒时，页面在这段空闲里打的日志、发的请求**不会被捕获**（之前捕获的仍在）；
- `alert` / `confirm` 这类原生对话框在空闲期间弹出时**不会被自动应答**，会等你来点（命令执行期间照旧自动应答）。

想改回一直挂着，或换一个空闲时长：在 `chrome://extensions` 里点该扩展的「Service Worker」打开控制台，执行 `chrome.storage.local.set({ idleDetachMs: 0 })`（`0` = 不自动解除；其它非负数 = 毫秒数），即时生效。

## 安全开关

在 profile 覆盖层（`$DSH_HOME/profiles/<名字>/cordis.patch.yml`）里给 `browser-bridge` 配：

```yaml
config:
  readOnly: true          # 只读：拒绝一切改页面/浏览器状态的命令
  allowScript: false      # 关掉 browser_evaluate 的任意 JS
  allowUpload: true       # 默认关；开启后必须配 uploadDir
  uploadDir: C:\Users\me\uploads
```

被拦的命令**不会发给浏览器**（零副作用），错误码 `blocked_by_policy`。`browser_upload` 是唯一能把本机文件交给页面的工具：默认关闭，只允许 `uploadDir` 内的文件（符号链接按真实路径判断）。写法与宿主版本差异见 [dsh-config/README.md](dsh-config/README.md)。

## 工具清单（30 个）

按用途分组；每个工具的入参、回执与边界见 [完整工具清单](docs/TOOLS.md)。

- 页面：`browser_navigate` `browser_read` `browser_snapshot` `browser_find` `browser_click` `browser_type` `browser_press` `browser_scroll` `browser_wait` `browser_evaluate` `browser_drag` `browser_upload`
- 标签与窗口：`browser_tabs` `browser_windows` `browser_sessions`
- 浏览器状态：`browser_cookies` `browser_dialog` `browser_hold` `browser_emulate` `browser_metrics` `browser_console_log` `browser_network_log` `browser_network_clear`
- 文件：`browser_screenshot` `browser_pdf` `browser_archive` `browser_cleanup`
- 账本：`browser_audit` `browser_journal`
- 身份：`browser_info`


## 更多文档

| 文档 | 内容 |
|---|---|
| [工具清单](docs/TOOLS.md) | 30 个工具的入参、回执与边界 |
| [行为契约](docs/BEHAVIOR.md) | 导航到达、快照、锁、浮层、拖拽、上传等细节 |
| [安装排障](docs/INSTALL.md) | 镜像延迟、24 小时包龄、离线包、本地调试 |
| [安全模型](SECURITY.md) | token、权限与威胁边界 |
| [验证台](verify/README.md) | 各台子覆盖与断言清单 |
| [更新日志](CHANGELOG.md) | 版本历史 |

## 兼容性

**宿主要求**：dsh `>=0.2.2-rc.5`（peer 声明 `>=0.2.2-rc.5 <0.3.0-0`；dsh 自 0.2.1 起要求 Node.js 24.9+）。v1.8.0 起按 0.2.2-rc.5 适配：移除随宿主一并删除的 `@deepseek-ai/dsh-invariants` 伴生模块（`./invariant` 子路径），cordis `~4.1.0`、schemastery `~3.19.0`；更早的宿主不再声称支持。

命令面只增不改：**插件 x + 扩展 x-n 不倒退**（`verify_compat_matrix` 用真实历史扩展逐格跑）。扩展 v1.7.2 配合最新插件仍然工作；多实例路由在后续版本。

## 许可

**AGPL-3.0**。个人 / 学术 / 非商业用途免费；企业闭源嵌入或做 SaaS 而不愿开源衍生代码的，需要单独商业许可。商业许可：GitHub Issues 或 caob2333@outlook.com。完整条款见 [LICENSE](LICENSE)。
