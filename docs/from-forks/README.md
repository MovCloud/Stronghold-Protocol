# 下游 fork 文档差异归档（`docs/from-forks/`）

本目录用于**附加保留**各下游 fork 与主线（`program/v0.3.1/`）发生文档冲突、且被主线版本覆盖的内容。

- 背景：多个下游 fork 已整合进主线，整合策略为「冲突时保留主线版本」，因此下游对同一份文档的分歧内容被主线覆盖。
- 本目录**不改动任何原有文件**，仅归档下游 fork 侧的分歧版本，供对照与追溯。
- 每份文件按来源 fork 的 owner 分目录存放，**保留其原始相对路径**。例如某 fork 的 `docs/DESIGN.md` 归档为 `docs/from-forks/<owner>/docs/DESIGN.md`；根目录的 `README.md` 归档为 `docs/from-forks/<owner>/README.md`。
- 内容取自各 fork 对应提交（tip）的 `git show <tip>:<路径>`，与主线 `program/v0.3.1/<路径>` 完全相同的文件已跳过（本次无此情况）。

## 归档清单（按来源 fork 分组）

### Stardust-minus/master — 部署反馈板/状态页+素材签名CDN+E2E
- `docs/from-forks/Stardust-minus/docs/DESIGN.md` ← 原始路径 `docs/DESIGN.md`

### Misyra/master — 皮肤系统+规则维护线
- `docs/from-forks/Misyra/CONTRIBUTING.md` ← `CONTRIBUTING.md`
- `docs/from-forks/Misyra/README.md` ← `README.md`
- `docs/from-forks/Misyra/THIRD-PARTY-NOTICES.md` ← `THIRD-PARTY-NOTICES.md`
- `docs/from-forks/Misyra/docs/SKINS.md` ← `docs/SKINS.md`
- `docs/from-forks/Misyra/docs/design/client.md` ← `docs/design/client.md`
- `docs/from-forks/Misyra/docs/development/ARCHITECTURE.md` ← `docs/development/ARCHITECTURE.md`
- `docs/from-forks/Misyra/docs/development/ASSETS.md` ← `docs/development/ASSETS.md`
- `docs/from-forks/Misyra/docs/development/DESIGN.md` ← `docs/development/DESIGN.md`
- `docs/from-forks/Misyra/docs/development/I18N.md` ← `docs/development/I18N.md`
- `docs/from-forks/Misyra/docs/guides/PACKS.md` ← `docs/guides/PACKS.md`
- `docs/from-forks/Misyra/docs/guides/PLAYING.md` ← `docs/guides/PLAYING.md`

### LongQianChen/perf/compact-wire-bandwidth — 紧凑协议带宽优化
- `docs/from-forks/LongQianChen/docs/ARCHITECTURE.md` ← `docs/ARCHITECTURE.md`
- `docs/from-forks/LongQianChen/docs/DEPLOY.md` ← `docs/DEPLOY.md`
- `docs/from-forks/LongQianChen/docs/DESIGN.md` ← `docs/DESIGN.md`
- `docs/from-forks/LongQianChen/docs/design/network.md` ← `docs/design/network.md`

### xinhai-ai/master — R2/CDN+持久化性能+在线准入
- `docs/from-forks/xinhai-ai/README.md` ← `README.md`
- `docs/from-forks/xinhai-ai/docs/ASSETS.md` ← `docs/ASSETS.md`
- `docs/from-forks/xinhai-ai/docs/DATA.md` ← `docs/DATA.md`
- `docs/from-forks/xinhai-ai/docs/DEPLOY.md` ← `docs/DEPLOY.md`
- `docs/from-forks/xinhai-ai/docs/DESIGN.md` ← `docs/DESIGN.md`
- `docs/from-forks/xinhai-ai/docs/META.md` ← `docs/META.md`
- `docs/from-forks/xinhai-ai/docs/PLAYING.md` ← `docs/PLAYING.md`
- `docs/from-forks/xinhai-ai/docs/SKINS.md` ← `docs/SKINS.md`
- `docs/from-forks/xinhai-ai/docs/design/client.md` ← `docs/design/client.md`
- `docs/from-forks/xinhai-ai/docs/design/network.md` ← `docs/design/network.md`

### YinqiMargatroid/master — 六人合作模式移植
- `docs/from-forks/YinqiMargatroid/docs/DEPLOY.md` ← `docs/DEPLOY.md`
- `docs/from-forks/YinqiMargatroid/docs/DESIGN.md` ← `docs/DESIGN.md`
- `docs/from-forks/YinqiMargatroid/docs/design/client.md` ← `docs/design/client.md`
- `docs/from-forks/YinqiMargatroid/docs/design/network.md` ← `docs/design/network.md`

### YUYUYUYUYUYUYUTOUA/codex/rhine-upstream-021 — 莱茵科研版
- `docs/from-forks/YUYUYUYUYUYUYUTOUA/README.md` ← `README.md`
- `docs/from-forks/YUYUYUYUYUYUYUTOUA/docs/META.md` ← `docs/META.md`
- `docs/from-forks/YUYUYUYUYUYUYUTOUA/docs/SIM.md` ← `docs/SIM.md`
- `docs/from-forks/YUYUYUYUYUYUYUTOUA/docs/design/match.md` ← `docs/design/match.md`
- `docs/from-forks/YUYUYUYUYUYUYUTOUA/docs/design/network.md` ← `docs/design/network.md`

### Paper-Yuan/0.2.6 — 开服流量优化+安卓客户端
- `docs/from-forks/Paper-Yuan/NOTICE.md` ← `NOTICE.md`
- `docs/from-forks/Paper-Yuan/THIRD-PARTY-NOTICES.md` ← `THIRD-PARTY-NOTICES.md`
- `docs/from-forks/Paper-Yuan/docs/SKINS.md` ← `docs/SKINS.md`
- `docs/from-forks/Paper-Yuan/docs/research/04-items.md` ← `docs/research/04-items.md`

### kanomahoro1224/merge/pr-643-ui — 头像P2P+全新UI集成
- `docs/from-forks/kanomahoro1224/README.md` ← `README.md`
- `docs/from-forks/kanomahoro1224/docs/ARCHITECTURE.md` ← `docs/ARCHITECTURE.md`
- `docs/from-forks/kanomahoro1224/docs/ASSETS.md` ← `docs/ASSETS.md`
- `docs/from-forks/kanomahoro1224/docs/DEPLOY.md` ← `docs/DEPLOY.md`
- `docs/from-forks/kanomahoro1224/docs/PLAYING.md` ← `docs/PLAYING.md`
- `docs/from-forks/kanomahoro1224/docs/SKINS.md` ← `docs/SKINS.md`
- `docs/from-forks/kanomahoro1224/docs/design/client.md` ← `docs/design/client.md`

### ccyl/fusion-20p — 作战统计面板+安卓交付
- `docs/from-forks/ccyl/CHANGELOG.md` ← `CHANGELOG.md`
- `docs/from-forks/ccyl/README.md` ← `README.md`
- `docs/from-forks/ccyl/THIRD-PARTY-NOTICES.md` ← `THIRD-PARTY-NOTICES.md`
- `docs/from-forks/ccyl/docs/DEPLOY.md` ← `docs/DEPLOY.md`
- `docs/from-forks/ccyl/docs/DESIGN.md` ← `docs/DESIGN.md`
- `docs/from-forks/ccyl/docs/PLAYING.md` ← `docs/PLAYING.md`
- `docs/from-forks/ccyl/docs/SKINS.md` ← `docs/SKINS.md`
- `docs/from-forks/ccyl/docs/design/client.md` ← `docs/design/client.md`

### Gyeongdeock-Seo/master — 韩语本地化
- `docs/from-forks/Gyeongdeock-Seo/README.md` ← `README.md`

### YuriRestia/dev-0.2 — 英文翻译
- `docs/from-forks/YuriRestia/docs/DATA.md` ← `docs/DATA.md`
- `docs/from-forks/YuriRestia/docs/I18N.md` ← `docs/I18N.md`
- `docs/from-forks/YuriRestia/docs/design/client.md` ← `docs/design/client.md`
- `docs/from-forks/YuriRestia/docs/design/network.md` ← `docs/design/network.md`

### jingjiangze/rel2025 — APK/热更新线
- `docs/from-forks/jingjiangze/CHANGELOG.md` ← `CHANGELOG.md`
- `docs/from-forks/jingjiangze/README.md` ← `README.md`
- `docs/from-forks/jingjiangze/docs/ARCHITECTURE.md` ← `docs/ARCHITECTURE.md`
- `docs/from-forks/jingjiangze/docs/ASSETS.md` ← `docs/ASSETS.md`
- `docs/from-forks/jingjiangze/docs/DEPLOY.md` ← `docs/DEPLOY.md`
- `docs/from-forks/jingjiangze/docs/DESIGN.md` ← `docs/DESIGN.md`
- `docs/from-forks/jingjiangze/docs/META.md` ← `docs/META.md`
- `docs/from-forks/jingjiangze/docs/PLAYING.md` ← `docs/PLAYING.md`
- `docs/from-forks/jingjiangze/docs/SIM.md` ← `docs/SIM.md`
- `docs/from-forks/jingjiangze/docs/PLUGIN-API.md` ← `docs/PLUGIN-API.md`
- `docs/from-forks/jingjiangze/docs/PLUGIN-DSL.md` ← `docs/PLUGIN-DSL.md`
- `docs/from-forks/jingjiangze/docs/PLUGIN-GUIDE.md` ← `docs/PLUGIN-GUIDE.md`
- `docs/from-forks/jingjiangze/docs/PLUGINS.md` ← `docs/PLUGINS.md`
- `docs/from-forks/jingjiangze/docs/design/client.md` ← `docs/design/client.md`
- `docs/from-forks/jingjiangze/docs/design/match.md` ← `docs/design/match.md`
- `docs/from-forks/jingjiangze/docs/design/network.md` ← `docs/design/network.md`
- `docs/from-forks/jingjiangze/docs/design/vfx-format.md` ← `docs/design/vfx-format.md`

### Rosmontis220/master — 安卓/桌面+联机增强
- `docs/from-forks/Rosmontis220/README.md` ← `README.md`
- `docs/from-forks/Rosmontis220/docs/ARCHITECTURE.md` ← `docs/ARCHITECTURE.md`
- `docs/from-forks/Rosmontis220/docs/ASSETS.md` ← `docs/ASSETS.md`
- `docs/from-forks/Rosmontis220/docs/DEPLOY.md` ← `docs/DEPLOY.md`
- `docs/from-forks/Rosmontis220/docs/PACKS.md` ← `docs/PACKS.md`
- `docs/from-forks/Rosmontis220/docs/PLAYING.md` ← `docs/PLAYING.md`
- `docs/from-forks/Rosmontis220/docs/SKINS.md` ← `docs/SKINS.md`
- `docs/from-forks/Rosmontis220/docs/design/network.md` ← `docs/design/network.md`

### NekoTC/master — COS/离线模式
- `docs/from-forks/NekoTC/docs/DESIGN.md` ← `docs/DESIGN.md`

### T1113047/master — 狩猎模拟玩法
- `docs/from-forks/T1113047/docs/DESIGN.md` ← `docs/DESIGN.md`

## 未归档 / 跳过说明

- **取不到（下游已删除该文件，tip 中不存在）**：
  - `Misyra` ← `AGENTS.md`
  - `Paper-Yuan` ← `AGENTS.md`
  - `Rosmontis220` ← `docs/I18N.md`
- **与主线完全相同而跳过**：无。
- **因二进制/超大/扩展名不符而跳过**：无（本次文档类冲突项均为 `.md`）。

## 统计

- 处理文档类冲突路径：**89** 条
- 实际归档文件：**86** 个
- 跳过：**3** 个（均为下游 tip 中已删除、取不到）
- 涉及 fork：**15** 个
