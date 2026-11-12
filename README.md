# Flux

**AI 自媒体工作台** — 面向抖音创作者的桌面端选题、赛道、内容雷达与样本拆解工具。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-45-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Release](https://img.shields.io/github/v/release/JasonItem/flux?include_prereleases&sort=semver)](https://github.com/JasonItem/flux/releases)

<p align="center">
  <img src="resources/icon.png" alt="Flux" width="120" />
</p>

Flux 帮助你把「账号理解 → 赛道判断 → 内容监听 → 选题沉淀 → 样本拆解 → 账号画像」串成一条可落地的创作链路。数据默认落在本机 SQLite，大模型与 TikHub 密钥只保存在本地。

---

## 功能一览

| 模块 | 能力 |
| --- | --- |
| **工作台** | 汇总选题、自测、拆解进度与高分近作，快速进入下一步 |
| **赛道自测** | 分析账号成分，推荐细分赛道，并沉淀可选选题 |
| **内容雷达** | 监听对标账号与平台热榜，按高表现 / 新作筛选信号，一键拆解 |
| **样本拆解** | 按选题筛选同方向样本；本地下载播放，Whisper 转写，大模型做结构/文案总结 |
| **创作工坊** | 保存与编辑 AI 复刻口播脚本 |
| **账号分析** | 推断观众/粉丝画像、作品归类与选题方案 |
| **任务队列** | 查看拆解 / 下载 / 复刻等后台任务进度 |
| **系统设置** | 账号、大模型、TikHub、数据备份、本地清理、API 用量 |

技术要点：

- Electron + React + TypeScript + LobeUI
- 本地 `better-sqlite3`，主进程隔离，preload `contextBridge`
- 自定义无边框窗口，明/暗主题
- Windows NSIS / macOS DMG（Intel + Apple Silicon）一键打包

---

## 软件截图

### 内容雷达

监听对标账号与平台热榜，按「全部 / 高表现 / 新作 / 平台热榜」筛选，并可直接拆解。

![内容雷达](docs/screenshots/radar.png)

监听规则可配置高表现阈值、新作窗口、热榜关键词与自动同步。

![监听规则](docs/screenshots/radar-rules.png)

### 赛道自测

结合账号成分与抖音搜索样本，推荐细分赛道并一键添加选题。

![赛道自测](docs/screenshots/track.png)

### 样本拆解

按选题筛选样本，下载到本地播放；转写原文后由大模型拆结构、剪辑与文案。

![样本拆解详情](docs/screenshots/dissect.png)

![样本播放与转写](docs/screenshots/dissect-player.png)

---

## 下载安装

正式安装包见 [GitHub Releases](https://github.com/JasonItem/flux/releases)：

| 平台 | 产物 |
| --- | --- |
| Windows | `Flux Setup x.y.z.exe`（可选安装路径） |
| macOS Intel | `Flux-x.y.z.dmg` |
| macOS Apple Silicon | `Flux-x.y.z-arm64.dmg` |

> macOS 未公证时，首次打开可能需在「系统设置 → 隐私与安全性」中允许，或执行：
>
> ```bash
> sudo xattr -rd com.apple.quarantine /Applications/Flux.app
> ```

---

## 环境要求

- **Node.js** ≥ 22.12
- **npm** ≥ 10
- Windows 打包需可用的 MSVC 构建环境（`better-sqlite3`）
- macOS 打包需在 macOS 上执行（或使用本仓库的 GitHub Actions）

---

## 快速开始

```bash
git clone https://github.com/JasonItem/flux.git
cd flux
npm install
npm run dev
```

首次启动会在 Electron `userData` 目录创建 `studio.sqlite`（Windows 一般为 `%APPDATA%\Flux\`）。

### 配置

1. **系统设置 → TikHub配置**：填入 [TikHub](https://tikhub.io/) API Key，用于拉取抖音资料与作品
2. **系统设置 → 大模型配置**：添加 OpenAI 兼容渠道与模型，用于赛道 / 拆解 / 画像等 LLM 能力
3. **系统设置 → 账号管理**：绑定要分析的国内抖音账号

### 本地播放与真实拆解

- 打开样本详情或列表内播放时，主进程会把 CDN 视频按需下载到 `userData/media/`，通过 `flux-media://` 本地播放（优先 H.264）。
- 首次**真实拆解**会：下载视频 → 用打包的 `ffmpeg-static` 抽音 → 调用 **whisper.cpp**（默认 `ggml-small`）得到带时间戳原文 → 再交给已配置的大模型做结构 / 剪辑 / 文案总结。
- Windows 会在首次转写时自动下载 Whisper 引擎；macOS 可先安装 `whisper-cpp`（`brew install whisper-cpp`）。
- **系统设置 → 本地数据清理**可删除 `media/` 视频缓存；模型文件可手动删 `models/whisper/`。

---

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 开发模式（Vite + Electron） |
| `npm run typecheck` | 主进程 / 渲染进程类型检查 |
| `npm run build` | 产出 `out/` 生产包 |
| `npm run preview` | 用 Electron 预览生产包 |
| `npm run rebuild:native` | 重建 `better-sqlite3` |
| `npm run dist:win` | 打 Windows NSIS 安装包 → `release/` |
| `npm run dist:mac` | 打 macOS DMG → `release/`（需 macOS） |
| `npm run dist` | 按当前平台打包 |

### Windows 安装包说明

- 向导式安装，**可选择安装目录**
- 卸载时可勾选 **清除用户数据**（数据库 / 配置 / 缓存）

### macOS 安装包说明

当前 Release 的 DMG **未做 Apple 开发者签名 / 公证**。从浏览器下载后，系统会打上隔离标记，打开时可能提示「应用已损坏」——这是 Gatekeeper 拦截，不是安装包损坏。

安装后在终端执行一次即可打开：

```bash
sudo xattr -rd com.apple.quarantine /Applications/Flux.app
```

若 App 不在 `/Applications`，把路径换成实际位置。之后可正常启动。

要彻底去掉该提示，需加入 [Apple Developer Program](https://developer.apple.com/)，配置 Developer ID 证书并公证。

---

## GitHub Actions（云端打包）

仓库已包含 `.github/workflows/release.yml`：

- **手动触发**：Actions → *Release* → *Run workflow*，勾选 `macos` / `windows`
- **打 Tag 触发**：`git tag v0.2.2 && git push origin v0.2.2`

产物会上传到该次 workflow 的 Artifacts；若由 tag 触发，还会挂到 GitHub Release。

---

## 项目结构

```
src/main        Electron 主进程、SQLite、TikHub / LLM / 业务服务
src/preload     contextBridge API（contextIsolation，无 nodeIntegration）
src/shared      IPC 通道与共享类型
src/renderer    React UI（工作台 / 赛道 / 雷达 / 样本 / 账号 / 设置）
docs/screenshots  README 软件截图
build/          NSIS 自定义脚本等打包资源
resources/      应用图标
```

渲染进程不直接访问 Node 或数据库，一律通过 `window.studio.*` IPC。

---

## 隐私说明

- 业务数据默认只存本机 SQLite
- API Key、模型配置保存在本地，不会上传到本项目服务器（本项目无云端后端）
- 调用 TikHub / 大模型时，请求会发往你配置的第三方服务

---

## 技术栈

- [Electron](https://www.electronjs.org/) + [electron-vite](https://electron-vite.org/)
- [React 19](https://react.dev/) + [TypeScript](https://typescriptlang.org/)
- [LobeUI](https://github.com/lobehub/lobe-ui)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- [electron-builder](https://www.electron.build/)

---

## 参与贡献

Issue 与 PR 欢迎。提交前建议：

```bash
npm run typecheck
npm run build
```

---

## License

[MIT](LICENSE) © Flux contributors