# 本仓库：派生说明与并入清单

本仓库（GitHub：`MovCloud/Stronghold-Protocol`）是上游 [sganggs/Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol) 的派生仓库，**基线 v0.3.3**（上游提交 `f07b8965`），自 0.3.3 起向下分支维护。`master` 跟随上游（只做 fast-forward），`fork/main` 承载本仓库的改动与并入内容。

> 本文不是上游原文，由本仓库维护。上游 README 保持原样，只在上游正文之外追加派生说明；正文里的 `git clone`、Releases 与 `npm run setup` 属于上游发布方式，本仓库的获取、构建与部署见本文「运行与部署」。

## 产物构成

- **基线**：上游 `sganggs/Stronghold-Protocol` v0.3.3（`f07b8965`）；此后以本仓库分支向下维护，不再跟随上游的目录布局。
- **逐分支档案**：并入的 18 个分支中，15 个保留档案在 [docs/from-forks/](docs/from-forks/)；`SiderLock`、`TempesTKF`、`xiaomasama` 三个的并入内容见下表，未另建档案。
- **合并范围**：共参考 25 个克隆（含上游基线本身）。合并范围内 19 个目标分支并入 18 个，1 个因与主线无共同祖先未并入；另有 5 个仓库仅作参考，未见并入记录。
- **已移出**：`YinqiMargatroid` 的六人合作模式、`jingjiangze` 的 APK/热更新交付线、`YUYUYUYUYUYUYUTOUA` 的莱茵生命扩展已正式移出（最后一项 2026-10-26 整分支移出），移出理由与时点见 [FORK-CHANGELOG.md](FORK-CHANGELOG.md)。
- **默认行为**：与上游主线一致；超出主线的玩法/协议扩展默认不启用，统一列为插件化待办。
- **仓库本身**：本仓库是独立 Git 仓库，`origin` 为 `MovCloud/Stronghold-Protocol`，`upstream` 为 `sganggs/Stronghold-Protocol`；发布以 Git 标签 + 目录包或 Docker 镜像为准。

## 从下游分支并入的内容

| 来源分支 | 并入内容 | 状态 / 说明 |
| --- | --- | --- |
| [Stardust-minus](https://github.com/Stardust-minus/Stronghold-Protocol) | 机变 concurrent、revival、部署/认证/监控子栈（`deploy/stardust/`） | 并入，有档案；主站默认走本仓库自带服务 |
| [SiderLock](https://github.com/SiderLock/Stronghold-Protocol) | 固定座位表拆池、多波联防（可选）、transferHost、emergency 闸门、asset-cache 路由、match-chat、wire 层 | 并入，无独立档案；容量/协议扩展默认不启用 |
| [xiaomasama](https://github.com/xiaomasama/Stronghold-Protocol_cf_worker) | `cloudflare/` Workers 适配层 | 并入，无独立档案；可选部署路径 |
| [TempesTKF](https://github.com/TempesTKF/Stronghold-Protocol) | 罗素 AI、大厅匹配、断线保留房间 | 并入，无独立档案 |
| [Misyra](https://github.com/Misyra/Stronghold-Protocol) | 皮肤系统、规则维护线、运维公告链与自研 Markdown 渲染 | 并入，有档案；皮肤工坊为本分支扩展 |
| [LongQianChen](https://github.com/LongQianChen/Stronghold-Protocol) | wire 带宽压缩 | 并入，有档案；经 SiderLock 历史一并并入 |
| [xinhai-ai](https://github.com/xinhai-ai/Stronghold-Protocol) | R2/CDN、持久化性能、公共 API 与公告弹窗、`net.js` presence/fanout/RTT | 并入，有档案；资产缓存准入未接线 |
| [YinqiMargatroid](https://github.com/YinqiMargatroid/Stronghold-Protocol-Six-Player) | 六人合作模式 | **已移出**（以 20 人房为准）；`poolGroupSizes(6)=[3,3]` 与 ≥5 人通用规则保留 |
| [YUYUYUYUYUYUYUTOUA](https://github.com/YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine) | 莱茵生命科研内容 | **已移出**（2026-10-26 整分支移出），档案保留 |
| [Paper-Yuan](https://github.com/Paper-Yuan/Stronghold-Protocol) | 开服流量优化、安卓客户端 | 并入，有档案 |
| [kanomahoro1224](https://github.com/kanomahoro1224/Stronghold-Protocol) | 头像 P2P、PR#643 界面重做 | 并入，有档案 |
| [ccyl](https://github.com/ccyl/Stronghold-Protocol) | 作战统计面板、安卓交付 | 并入，有档案 |
| [Gyeongdeock-Seo](https://github.com/Gyeongdeock-Seo/Stronghold-Protocol_Ko) | 韩语本地化（`public/i18n/ko.json`） | 并入，有档案 |
| [YuriRestia](https://github.com/YuriRestia/Stronghold-Protocol-EN-translation) | 英文翻译（`public/i18n/en.json`）、PreloadStore/预载 API | 并入，有档案 |
| [jingjiangze](https://github.com/jingjiangze/Stronghold-Protocol) | APK/热更新线 | **已移出**（与主线冲突文件最多，按根项目为准整条移除）；档案保留 |
| [Rosmontis220](https://github.com/Rosmontis220/Stronghold-Protocol-Modded) | 安卓/桌面、联机增强、spDraft/bandDraft 组机器、playerAdmin 管理仪表盘 | 并入，有档案 |
| [NekoTC](https://github.com/NekoTC/Stronghold-Protocol) | COS、离线模式 | 并入，有档案 |
| [T1113047](https://github.com/T1113047/Stronghold-Protocol-Hunt-Simulation) | 狩猎模拟 | 并入，有档案；solo/coop/versus 均已可用，2V2 由「娱乐模式」页进入并经 `SP_VERSUS` 开关隔离；同盟狩猎（`COOP_HUNT`）是娱乐模式的独立卡片，只在 `room.create` 带 `hunt: true` 的房间生效，普通「创建同盟」保持上游规则 |
| [Fuhua-code](https://github.com/Fuhua-code/Stronghold-Protocol) | — | **未并入**：与主线无共同祖先 |

以下 5 个仓库只作为参考克隆保留，未在本仓库文档或代码中留下并入记录：

`BBleae/Stronghold-Protocol`、`bmryggdrasil/Stronghold-Protocol`、`qwertyuiop612/Stronghold-Protocol-Rhine_DLC`、`sakurahello1/Stronghold-Protocol`、`Slapq/Stronghold-Protocol`。

## 本分支新增与二次开发的模块

其中部分模块以并入分支的实现为基础二次开发，来源见上表；下列列出的是本仓库当前保留的形态。

- **娱乐模式（2V2 狩猎模拟 / 同盟狩猎）**：[public/js/screens/arcade.js](public/js/screens/arcade.js) 是大厅第四张卡片进入的独立玩法目录页（未来玩法如危机合约按卡片加入，与主线规则隔离）。卡片生命周期（2026-11-07 起）：开发中 / 修改中的玩法是黄字「敬请期待」且不可点；已完成的玩法由 admin 逐个开关（`/admin/api/arcade`，存 `state.json`，重启后生效）——开放时绿字「开放中」可进入，停用时红字「暂未开放」并拒绝该玩法的新房间与新对局，进行中的对局自然打完（与主线维护相同的排空思路，维护会关闭全部模式）。其中 2V2 卡片按 `welcome.versus` 与 `welcome.arcade.hunt2v2` 决定状态，同盟狩猎是另一张独立卡片（点卡即以 `room.create hunt: true` 建 coop 房，受 `welcome.arcade.alliancehunt` 控制），状态随 `presence.state.arcade` 实时更新。规则层在主线：`server/match/match/` 的 `event.js`（EVENT 机变）、`confront.js`（CONFRONT 狩猎）、`merchant.js`，`server/match/choices.js` 的 versus 机变取牌，`Match.js` / `PlayerState.js` / `phases.js` 的 versus / coop-hunt 分支；房间层是 `room.create mode 'versus'`（固定 4 座两队、开局自动补 AI）与 `room.create hunt: true`（coop 房的可选狩猎期，`Match.coopHuntOn` 只在 `opts.coopHunt === true` 时打开；普通「创建同盟」与快速匹配保持上游规则，主线 golden 不变），大厅/房间/对局界面分别由 `room.js` 的 `seats--versus`、`ui/eventOverlay.js`、`ui/confrontOverlay.js` 承载。构建级开关：环境变量 `SP_VERSUS=0` 关闭 2V2（服务端构造选项 `versus` 亦可，供测试/嵌入使用）——关闭时服务端拒绝建房并在 `welcome` 中省略 `versus`，2V2 卡片同样锁定；`COOP_HUNT.enabled === false` 关闭同盟狩猎。规格与回归测试见 `test/match/versus.test.js`、`test/match/coop-hunt.test.js`、`test/lobby-versus.test.js`、`test/player-admin-ops.test.js`（房间层与 admin 开关：建房、补 AI、换位、`hunt` 只允许 coop、逐模式排空、状态持久化）。
- **资源包管理器**：[public/js/resourcePacks.js](public/js/resourcePacks.js) 是唯一状态表，[public/js/materialFallback.js](public/js/materialFallback.js) 保留兼容导出，[public/js/ui/materialImage.js](public/js/ui/materialImage.js) 对缺失资源根直接占位（首次失败静默校验后再标记，避免瞬时故障误标）。
- **皮肤插件注册器与皮肤工坊**：[public/js/skinRegistry.js](public/js/skinRegistry.js)、[public/js/ui/skinWorkshop.js](public/js/ui/skinWorkshop.js)。本地皮肤持久化在 Cache Storage `/p/local/<hash8>/`；`kind: 'spine'` 的动态立绘（Spine，早前误称 L2D）经窄接口接入，降级顺序为静态槽 → 官方原画。工坊表单（归属干员下拉、皮肤 ID / 名称、浏览按钮）在 `.set-workshop` 内统一为 `.36rem` 同高、等宽三列，窄屏折行（`screens/game.css`）。
- **显示方向与屏幕适配**：设置 →「显示方向」三档 `auto` / `portrait` / `landscape`（默认 `portrait`，即锁定竖屏），持久化在 `sp.pref.settings` 的 `orientation`。界面始终按一张 19.2:10.8 的横屏舞台设计；`public/js/ui/orientation.js` 把「是否整体旋转 90°」写到 `<html data-rotate="1|0">`（设置值仍写 `data-orient`）：自动适应在窗口高大于宽时旋转（手机竖持即网页横屏游玩），锁定竖屏永不旋转，锁定横屏始终旋转，resize / orientationchange 时重算（锁定档结果恒定）。[public/css/orientation.css](public/css/orientation.css) 用一次 `.app-root` 的 `translateX(100vw) rotate(90deg)` 把整页（所有全屏、弹窗、浮层都在其中）连同固定定位一起旋转并铺满视口，按交换后的盒子重算根字号与异形屏内边距，并在物理视口仍是竖屏时恢复大厅弹窗（`.proto-body` / `.ally-body` / `.proto-setup`）、房间座位（`.rs-seats` / `.rseat`）与扫荡面板（`.sw-*`）的横屏排版。`ui/device.js` 不再调用 `screen.orientation.lock`（OS 锁会造成二次旋转），`--sp-vh` 改用旋转后的可见高度；`render/app.js` 的 `canvasPoint` / `pieceScreenRect` / `tileScreen` 与 `ui/turnedLayout.js`（工具提示、术语弹窗、`ui/fieldHost.js` 的 HUD 边带）把指针与盒子坐标换算回旋转后的布局空间。旧的旋转提示遮罩随之退役（`theme.css` 不再显示 `.rotate-hint`）。战棋棋盘始终按 19.2:10.8 适配。大厅顶栏「版本」与「在线」胶囊共用 `--hub-pill-h` 与统一的 coarse / 短屏下限（`screens/lobby.css`），测试见 `test/ui/orientation.test.js`（含 `ui-size` 的尺寸下限守卫）。
- **运维公告与 admin**：[server/playerAdmin.js](server/playerAdmin.js) 提供公告发布/删除、维护开关、重启（`/admin/api/restart`：排空后走与 SIGTERM 相同的优雅关闭再退出，由 Docker / systemd 拉起；未检测到守护进程时要二次确认强制，保存的内容配置在重启后生效）、娱乐模式逐项开关（`/admin/api/arcade`，见上）、运行时可改设置与 `registerAdminRoute`；[server/identity.js](server/identity.js) 预留匿名/admin/OAuth 身份；反馈群、公告源、素材源均为显式三态配置。
- **运行参数热加载**：`maxRooms` 等房间限制走配置层并可在 admin 修改（未配置时不限制）。
- **文档重组**：`docs/` 拆为 `guides/`、`operations/`、`development/`、`design/`，映射见下。

## 自有内容（相对上游）

- **队友概览**：观战 / 查看阵地时显示该干员的生命、等级、上场。
- **跳过**：房间的播放速度规则（`1×` / `2×`，独立模拟可在「单人默认设置」里选默认速度），以及作战中的「暂停 / 继续」「快进（`2×` 切换）」「跳过（一次性 `60×` 播放）」三个控制。独立模拟直接生效；同盟模拟由全房真实玩家投票，「跳过」与修改倍速只在本回合有效，下一回合需重新投票。取值见 `shared/constants.js` 的 `PLAYBACK`，实现在 `server/match/match/matchControl.js`、`public/js/ui/matchControl.js` 与 `public/js/ui/hud.js`。上游的作战速度固定，只有 studio 试算页带播放速度选择。

## 上游文档路径映射

| 上游 | 本仓库 |
| --- | --- |
| `docs/PLAYING.md` | 保持根路径 `docs/PLAYING.md`（玩家包按此路径收录） |
| `docs/DEPLOY.md` | [docs/operations/DEPLOY.md](docs/operations/DEPLOY.md) |
| `docs/WINDOWS.md` | [docs/operations/WINDOWS.md](docs/operations/WINDOWS.md) |
| `docs/DESIGN.md`、`docs/ARCHITECTURE.md` | [docs/design/overview.md](docs/design/overview.md) |
| `docs/SIM.md` | [docs/development/SIM.md](docs/development/SIM.md) |
| `docs/DATA.md` | [docs/development/DATA.md](docs/development/DATA.md) |
| `docs/ASSETS.md` | [docs/development/ASSETS.md](docs/development/ASSETS.md) |
| `docs/BALANCE.md` | [docs/development/BALANCE.md](docs/development/BALANCE.md) |
| `docs/META.md` | [docs/design/match.md](docs/design/match.md) |
| `docs/I18N.md` | [public/i18n/](public/i18n/) |
| `docs/PACKS.md` | 未随产物保留，原文归档在 [docs/from-forks/Misyra/docs/guides/PACKS.md](docs/from-forks/Misyra/docs/guides/PACKS.md) |

## 测试与打包口径

- `npm test` 只跑主线测试：`test/**/*.test.js`、`test/e2e/coop.e2e.mjs`、`plugins/_template/**/*.test.js`、`deploy/stardust/feedback/**/*.test.mjs`，共 **865** 个测试文件（`test/` 内 864 个 `.test.js` + 1 个 e2e）+ 模板 1 个 + feedback 1 个。
- 从下游带进来、但对应特性未并入或契约已漂移的测试归档在 [deferred-tests/](deferred-tests/)（当前 **622** 个测试文件，含 `fork-added/MANIFEST.txt` 清单），**不在** `npm test` 范围内；对应特性插件化落地时再按现状重写规格移回。整分支移出的部分已按判定删除，清单中逐行标注原因。
- `tools/package.mjs` 的打包流程依赖 Git 跟踪清单与 release tag；本仓库以 Git 标签标记发布，产物仍以目录包或 Docker 镜像分发。

## 运行与部署

- 直接运行：`npm ci && npm start`（素材按正文说明准备，或复用已有 `public/assets`）。
- Docker：仓库自带 [Dockerfile](Dockerfile)（`node:24-alpine`、非 root、`/healthz` 健康检查，镜像内执行前端构建）。素材可用 `--build-arg FETCH_ASSETS=1` 内置、`SP_ASSETS_CDN=` 指向 CDN，或挂载 `public/assets:ro`；持久化 `/app/.state`。
- 反向代理：Caddy 或 Nginx，保留 WebSocket `Upgrade`，并设置 `TRUST_PROXY=1`。
- Windows 家机：见 [docs/operations/WINDOWS.md](docs/operations/WINDOWS.md) 与 [docs/operations/HOME_SERVER.md](docs/operations/HOME_SERVER.md)。
- **私有运维状态不入库**：真实主机清单（`.cache/deploy/targets.json`）、部署回执（`deploy/stardust/releases/*.json`）、`deploy/stardust/**/{tls,secrets,auth-secrets}/`、`*.pem` / `*.key` 均由 `.gitignore` 排除。`deploy/stardust/` 内的生产域名与地址是上游 Stardust-minus 已公开发布的部署模块原文，按原样保留。
