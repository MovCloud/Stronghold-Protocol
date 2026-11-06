# deferred-tests — 插件化待办测试归档

这些测试文件来自下游 fork，其被测特性在聚合时**未并入主线**（互斥冲突按"保留主线版本"处理，或已被主线等价实现取代）。文件移出 `test/` 以脱离 `npm test` 范围（glob `test/**/*.test.js` 不再命中），实现若在后续插件化迭代中落地，应将对应文件移回 `test/` 并修复规格。

归档时间：2026-10-20（P7a 收尾全量回归）

| 文件 | 来源特性 | 归档原因 |
| --- | --- | --- |
| admin.test.js | 旧版管理端 API（`/api/admin/*` + `adminSecret` Bearer） | 已被 Rosmontis220 playerAdmin（`/admin/api/*`，session+CSRF）取代，旧 API 服务端实现不存在；【追溯】建议正式放弃（2026-10-26），归档文件已删除 |
| announce.test.js | xinhai 公告 CLI 链 | 公告主链已收敛到 Misyra 主线实现 + admin 发布/删除/种子；【追溯】建议正式放弃（2026-10-26），归档文件已删除 |
| announcement-assets-http.test.js | fork 公告图片资产 API（`srv.announcements.publish` + 自定义资产目录） | 与主线公告链形态不匹配；【追溯】建议正式放弃（2026-10-26），归档文件已删除 |
| announcement-notices-live.test.js | fork notices 直播链 | 同上；【追溯】建议正式放弃（2026-10-26），归档文件已删除 |
| announcements-http.test.js | fork 公告 HTTP API（写接口） | 主线公告链只读 + admin 写入；【追溯】建议正式放弃（2026-10-26），归档文件已删除 |
| asset-cache-admission.test.js | fork 资源准入六路由/strict 模式 | 用户已拍板暂不并入；P5 资源包管理器（resourcePacks.js）取代；【追溯】建议正式放弃（2026-10-26），归档文件已删除 |
| asset-cache-admission.browser.test.js | 同上（浏览器 Net readiness） | 同上；【追溯】建议正式放弃（2026-10-26），归档文件已删除 |
| asset-cache-http.test.js | fork 资产缓存 HTTP（catalog/预缓存/emergency/带宽限制） | 同上（P3/P4 待办见 .trae/documents/resource-pack-manager-p1-p2.md）；【追溯】建议正式放弃（2026-10-26），归档文件已删除 |
| asset-cdn.test.js | fork `/_v/<tag>/` 发布版本化 CDN | 未采纳；含 120s 挂死用例（unload releases resolver atlas metadata）；【追溯】建议正式放弃（2026-10-26），归档文件已删除 |
| cdn.test.js | 同一 CDN 特性的静态处理器契约（`parseAssetCdn`/`rewriteAssetPaths`/`SP_ASSETS_CDN_VERSION`） | 同上；`server/index.js` 未导出 `parseAssetCdn`/`rewriteAssetPaths`；【追溯】建议正式放弃（2026-10-26），归档文件已删除 |
| chat-log.test.js | fork 的 `ChatLog` 类 API（`../server/chatLog.js`） | 【追溯】文字聊天已整分支移出（2026-10-26），归档文件已删除；`server/chatLog.js` 与 `server/chatlog.js` 均不存在 |
| chat-moderation-lifecycle.test.js | fork 的 `lobby.chatReviews` 审核生命周期（迟到审批丢弃、按人限流） | 【追溯】文字聊天已整分支移出（2026-10-26），归档文件已删除；`server/matchChat.js` 不存在，`shared/chat.js` 已随整分支删除（无保留文件），昵称校验只位于 `server/moderation/nickname.js` |
| asset-version.test.js | fork `/_v/` 版本化模块 | 同上；【追溯】建议正式放弃（2026-10-26），归档文件已删除 |
| backend-performance.test.js | fork 后端性能套件 | 特性未并入 |
| bond-plan.test.js | fork 羁绊策划案（lobby 层） | 特性未并入（插件化待办）；【追溯】2026-10-26 按现有代码事实复核：本文件断言 `room.bondPlan`、`lobby.bondPlan`、`humanSeat` 的 `bondPlan` 与 `PlayerState.setBondPlan`，现有实现只有 `g.bondPlan` 协议与 `PlayerState.bondPlan` 字段，lobby 层无对应实现，保持归档；已并入主线的部分见下方接回记录 |
| boot-choice.test.js | fork 开局模式选择面板 | 特性未并入（插件化待办） |
| bot-policy.test.js | fork bot 策略运行时配置 | 特性未并入；【追溯】建议正式放弃（2026-10-26），归档文件已删除 |
| bot-population.test.js | fork bot 人口管理 | 特性未并入；【追溯】建议正式放弃（2026-10-26），归档文件已删除；实现侧 `server/botPopulation.js` 仍存活并被 `persist.js`、`matchRestore.js`、`roomAdmin.js` 接线，与 AGENTS.md「本仓库特色功能必须保留」冲突，待用户确认后才处理 |

## 注意

- 主线回归修复记录（同日）：`server/http/files.js` 恢复主线 `?v=` 缓存规则；`server/http/media.js` 恢复主线版本（fork `/_v/` 签名与 static.js 不匹配）；`tools/assets/anim-roles.mjs` 恢复主线（PR #275 特性被 fork 旧版覆盖）；`test/asset-paths.test.js`、`test/asset-network.test.js`、`test/assets.test.js` 恢复主线并做合并适配（emote 42/61、部分素材树门控 skipArt）；`data/assets.json` 补 6 个 ciallo 表情条目并重算 hash、修正 stats 计数；`data/backups.json` 与 `data/vanilla/backups.json` 合并 char_4182_oblvns（丰川祥子，YuriRestia 2026-10-15 拍板的 owned pick，含 units/diy.operators/ownedPool/excluded 联动修正）。

## 第二批：静态契约梳理归档（2026-10-21）

不再"先跑全量再逐个打补丁"，改为先静态比对：对 585 个 fork 新增测试文件提取 `import` 的相对模块路径与命名导出，与产物实际文件/导出比对，凡引用了不存在的模块或符号者即为**必然无法加载**的测试。共 47 个命中（42 个导入即失败，5 个修正导入路径后行为仍不匹配）。

| 文件 | 缺失的模块/符号 | 归档原因 |
| --- | --- | --- |
| `fork-boundaries.test.js` | missing module: ../net.js | 契约不匹配（导入符号不存在或模块缺失） |
| `healthz-cache.test.js` | createHealthBody | 契约不匹配（导入符号不存在或模块缺失） |
| `lobby-chat.test.js` | CHAT_MAX | 【追溯】文字聊天已整分支移出（2026-10-26），归档文件已删除 |
| `lobby-rtc-signal.test.js` | RTC_LIMITS | 契约不匹配（导入符号不存在或模块缺失） |
| `match/bot-refinements.test.js` | createRehearsalSteps | 契约不匹配（导入符号不存在或模块缺失） |
| `match/versus.test.js` | generateVersusDrafts | 契约不匹配（导入符号不存在或模块缺失） |
| `matchmaking.test.js` | MATCH_WAIT_MS | 契约不匹配（导入符号不存在或模块缺失） |
| `name-moderation.test.js` | checkNameBeforeHello | 契约不匹配（导入符号不存在或模块缺失） |
| `name-policy.test.js` | missing module: ./name-filter-node.mjs, missing module: ./node | 契约不匹配（导入符号不存在或模块缺失） |
| `outfits.test.js` | outfitRec, outfitArtUrl | 契约不匹配（导入符号不存在或模块缺失） |
| `persist-recovery-lifecycle.test.js` | missing module: ./server/http/boot.js | 契约不匹配（导入符号不存在或模块缺失） |
| `persist-version-stress.test.js` | TRANSIENT_MATCH_FIELDS | 契约不匹配（导入符号不存在或模块缺失） |
| `portal-room-config.test.js` | localAgentUrlFrom, portalRoomOptionsFrom | 契约不匹配（导入符号不存在或模块缺失） |
| `render/pixi-extensions.test.js` | restorePixiExtensions | 契约不匹配（导入符号不存在或模块缺失） |
| `resources/pack-routes.test.js` | validateResourcePacks | 契约不匹配（导入符号不存在或模块缺失） |
| `resources/resource-packs.test.js` | validateResourcePacks, resourcePackPercent | 契约不匹配（导入符号不存在或模块缺失） |
| `rhine-update-boot.test.js` | missing module: ./http/boot.js | 【追溯】归档文件已删除（当前归档目录中不存在该文件） |
| `room-protection.test.js` | roomAdminTokenFrom | 契约不匹配（导入符号不存在或模块缺失） |
| `server-capacity.test.js` | CAPACITY_RECONNECT_MS | 契约不匹配（导入符号不存在或模块缺失） |
| `skin-portrait-tools.test.js` | installSkinPortraits | 契约不匹配（导入符号不存在或模块缺失） |
| `skins-diy.test.js` | setPortraits, syncDiySkins, cleanSkinsMap | 契约不匹配（导入符号不存在或模块缺失） |
| `skins-portrait.test.js` | setPortrait, clearPortrait, portraitFor, setPortraits, equippedSkinKeys, PORTRAITS_PREF | 契约不匹配（导入符号不存在或模块缺失） |
| `test-workflow.test.js` | missing module: ./server/index.js | 契约不匹配（导入符号不存在或模块缺失） |
| `ui/achievements-local.test.js` | AchievementView, AchievementEntryView, AchievementMark | 契约不匹配（导入符号不存在或模块缺失） |
| `ui/avatar-skins.test.js` | AvatarPickerView, AvatarVariantsView, OperatorPickerView, cardAvatarSkins, installCardSync | 契约不匹配（导入符号不存在或模块缺失） |
| `ui/boardmode.test.js` | BOARD_FORCES, UNIT_FORCES, flatFieldPreferred | 契约不匹配（导入符号不存在或模块缺失） |
| `ui/data-profile.test.js` | createProfiledDataStore, CORE_DATA_FILES, PROFILE_CHANGE, RhineToggle, roomProfileReady, loadoutPreferenceKey | 契约不匹配（导入符号不存在或模块缺失）；【追溯】莱茵生命同人扩展整分支移出（2026-10-26，按根项目为准），归档文件已删除 |
| `ui/fork-redesign.test.js` | ProtocolSelect, SeatCardView | 契约不匹配（导入符号不存在或模块缺失） |
| `ui/glass-theme.test.js` | UI_THEMES | 契约不匹配（导入符号不存在或模块缺失） |
| `ui/group-draft-views.test.js` | otherBandGroups, hasManualTeammateAfter, choicePage, defaultChoiceGroup | 契约不匹配（导入符号不存在或模块缺失） |
| `ui/overview.test.js` | watchedOverview | 契约不匹配（导入符号不存在或模块缺失） |
| `ui/peer-avatars.test.js` | RTC_LIMITS | 契约不匹配（导入符号不存在或模块缺失） |
| `ui/player-card.test.js` | installCardSync, filterCardOperators, OperatorPickerView, SeatCardView | 契约不匹配（导入符号不存在或模块缺失） |
| `ui/preload-voice.test.js` | normalizePreloadVoiceLang, resourceSelection, selectedResourceGroup | 契约不匹配（导入符号不存在或模块缺失） |
| `ui/profile-plugins.test.js` | createProfiledDataStore | 契约不匹配（导入符号不存在或模块缺失）；【追溯】莱茵生命同人扩展整分支移出（2026-10-26，按根项目为准），归档文件已删除（第三个用例的 `room.rhineEnabled` 即 rhine/original 内容档对照契约） |
| `ui/protocol-page.test.js` | ProtocolSelect, protocolEscapeAction | 契约不匹配（导入符号不存在或模块缺失） |
| `ui/room-management.test.js` | SeatCard, MatchmakingControl | 契约不匹配（导入符号不存在或模块缺失） |
| `ui/room-mobile.test.js` | RoomTools | 契约不匹配（导入符号不存在或模块缺失） |
| `ui/skin-portraits.test.js` | cardPortraitSkins, AvatarPickerView, AvatarVariantsView, SeatCardView, installCardSync | 契约不匹配（导入符号不存在或模块缺失） |
| `ui/unit-models.test.js` | UNIT_FORCES | 契约不匹配（导入符号不存在或模块缺失） |
| `ui/unite-vote.test.js` | UniteSkipVote | 契约不匹配（导入符号不存在或模块缺失） |
| `wire-frames.test.js` | wireStats, wireStatsSnapshot, publicWireFrame, publicStateJson | 契约不匹配（导入符号不存在或模块缺失） |
| `resources.test.js` | `PreloadStore` 改从 `public/js/resources/preloadStore.js` 导入后仍 10/18 失败（worker 以 CJS 加载 ESM、`files is not iterable`） | 特性在主线由 P1/P2 资源包管理器实现，fork 测试的 worker 夹具与新架构不兼容 |
| `ui/deployment-zoom.test.js` | `deployFoldsShop` 改从 `public/js/ui/gameLogic/camera.js` 导入后 0/4 失败 | 部署缩放实现已迁至 camera 模块且行为不同，fork 断言不适用 |
| `ui/online-presence.test.js` | `OnlinePill` 改从 `public/js/ui/presence.js` 导入后 0/1 失败 | 在线状态组件实现位置与渲染结构均已不同 |
| `ui/skin-picker-state.test.js` | `SkinSection` 改从 `public/js/ui/pluginSkinPicker.js` 导入后 0/5 失败 | 皮肤面板已并入插件皮肤系统（P6），fork 状态断言不适用 |
| `ui/skins.test.js` | `installSkinsSync` 改从 `public/js/ui/loadoutSync.js` 导入后 0/6 失败 | 主线皮肤接口统一后行为契约不同；主线自带皮肤测试已覆盖 |

### 判定口径

- **主线文件**（与 `git-clone/sganggs` 同名同路径）一律保留，出现失败按主线回归修复，不归档。
- **fork 新增文件**：符号在产物中完全不存在 → 特性未并入，归档；符号存在于其他模块 → 先改导入路径实测，仍失败才归档。
- 归档文件在对应插件化特性落地时，应移回 `test/` 并按主线契约重写规格。

## 第三批：主线文档测试（不适用于聚合产物，2026-10-21）

| 文件 | 归档原因 |
| --- | --- |
| `docs-paths.test.js` | 依赖 `git ls-files`（聚合产物不是 Git 仓库，`tools/package.mjs` 会直接抛错）与 `docs/DESIGN.md` 单索引布局；本产物文档已重组为 `design/ development/ guides/ operations/`，没有该索引 |
| `docs-consistency.test.js` | 对文档正文做逐字断言；多 fork 的设计正文已合并进 `docs/design/`，旧短语（如 "150 real s"）不再出现。恢复文档定稿后应按现状重写规格 |

归档位置：`deferred-tests/incompatible-docs/`。这两项与主线代码无关，不影响 `npm test` 的其余用例。

## 第四批：fork 新增测试整体归档（2026-10-21，用户拍板）

前三批是逐个文件判定；本批改为**结构性判据**：以 `git-clone/sganggs__Stronghold-Protocol/test` 为上游基线，

- 与上游**同名同路径**的文件 = 主线测试，一律留在 `test/`，失败按主线回归修复；
- 上游**不存在**的文件 = fork 新增测试，其被测特性要么未并入、要么契约已漂移，整体移出（登记时共 **539** 个，按相对路径保留子目录，清单见 `fork-added/MANIFEST.txt`），待对应特性插件化落地时再按现状重写规格移回。其中 **63** 个已随整分支移除判定删除（清单中逐行标注原因），另有 **3** 个盟约预选测试于 2026-10-26 接回 `test/`（清单中逐行标注），**2** 个投票移出测试于 2026-10-31 接回（见下方接回记录），另有 **14** 个卡兹戴尔测试于 2026-10-31 随整分支移除判定删除（见下方第十八批），当前在档 **457** 个。

例外（保留在 `test/`，因为这四项特性本次确已并入主线）：

| 保留文件 | 对应已并入特性 |
| --- | --- |
| `identity.test.js` | P7a-A6 `server/identity.js` 身份预留与 `/auth/*` 501 |
| `player-admin-ops.test.js` | P7a-A3/A5 运维开关、admin 路由注册 |
| `public-api.test.js` | xinhai 公共 API（`/api/ping`、房间状态、公告投影） |
| `ui/announcement.test.js` | Misyra 公告弹窗渲染与关闭契约 |

归档后 `test/` 剩 **861** 个 `.test.js`（2026-10-26 实测复核，原登记 851；另含 `test/e2e/coop.e2e.mjs` 与 `plugins/_template/**`），`npm test` 只跑这 861 个。接回盟约预选的 3 个测试后为 **864** 个，接回投票移出的 2 个测试后为 **866** 个。

> **口径变化（2026-10-31）**：上述 861/864/866 是**合并前**基线（`7447e8fc`）的计数。上游 v0.3.3 合并后，`test/` 实测为 **1033** 个 `.test.js`（上游基线 `upstream-v0.3.3` 为 1021，合并前本仓库为 864，两者按判定优先级逐文件取并集后为 1033）。`npm test` 的守护范围以 1033 为准，卡兹戴尔移除后归档在档 **457** 个；接回资源包与皮肤注册表的 2 个测试后（见下方接回记录）实测 `test/` = **1035**、`deferred-tests/fork-added` = **455**、`deferred-tests` 全目录 = **604**。

### 接回记录（2026-10-26，盟约预选 bondPlan）

按用户指示，被测主体已并入主线的盟约预选测试接回 `test/` 并实测（`node --test`，14 passed / 0 failed）：

| 接回文件 | 原归档位置 | 判定依据 | 实测 |
| --- | --- | --- | --- |
| `test/match/bond-plan.test.js` | `deferred-tests/fork-added/match/bond-plan.test.js` | 被测主体已并入主线：`shared/protocol.js` 的 `g.bondPlan`、`server/match/match/intents.js` 的 `planBond`/`bondPlanOpen`、`PlayerState.bondPlan` 字段、`match/views.js` 的 `bondPlan` 投影 | 10 passed / 0 failed |
| `test/ui/bond-plan-ui.test.js` | `deferred-tests/fork-added/ui/bond-plan-ui.test.js` | `public/js/ui/bondPlan.js` 的 `plannableBonds`/`bondPlanOpen`/`bondPlanHolders` 与 `public/js/screens/bandDraft.js` 的 `reservedBands` 均存在 | 3 passed / 0 failed |
| `test/cluster-bond-plan.test.js` | `deferred-tests/fork-added/cluster-bond-plan.test.js` | `server/cluster/ingress.js`、`game-node.js`、`platform.js` 存活，`g.bondPlan` 跨 ingress → game node → GameHost → Match 的链路可运行 | 1 passed / 0 failed |

根级 `deferred-tests/bond-plan.test.js`（fork lobby 层）保持归档，原因见第一批第 23 行。

### 接回记录（2026-10-31，投票移出 kickVote）

按用户指示接回并实测（`node --test`，共 8 passed / 0 failed）：

| 接回文件 | 原归档位置 | 判定依据 | 实测 |
| --- | --- | --- | --- |
| `test/match/kick-vote.test.js` | `deferred-tests/fork-added/match/kick-vote.test.js` | 被测主体已并入主线：`server/match/match/kickVote.js` 存活（`g.kickVote` / `g.kickBallot` 协议、`kickNeed = floor(n/2) + 1`、`KICK_VOTE_MS = 30_000`），通过后的移除与 leave 走同一结算（`m.removed` 的 kicked 标记、共享池归还、配对与首领份额） | 6 passed / 0 failed |
| `test/ui/kick-vote.test.js` | `deferred-tests/fork-added/ui/kick-vote.test.js` | UI 侧发起条件已实现：仅 AI 接管下的离线席位、仅 SP_DRAFT / PREP，观战者、机器人、自己、其他阶段、已开放的投票、离线的提案人均不可发起 | 2 passed / 0 failed |

两个测试的相对 import 假定文件位于 `test/`（`../../shared/...`、`./harness.js`），因此必须 `git mv` 回 `test/` 才能运行。

> 门槛口径澄清：投票移出用**严格多数** `floor(n/2) + 1`；用户拍板的 **¾ 投票**门槛属「重刷本局投票」（`setupVote`），两者各自保留，不合并。

### 接回记录（2026-10-31，资源包状态表与皮肤注册表）

按用户拍板「资源包架构推进实现」接回并实测（`node --test`，7 suites / 93 passed / 0 failed）：

| 接回文件 | 原归档位置 | 判定依据 | 实测 |
| --- | --- | --- | --- |
| `test/render/resourcePacks.test.js` | `deferred-tests/fork-added/render/resourcePacks.test.js` | 被测主体 `public/js/resourcePacks.js` 已并入主线（P1 状态表 / P2 缺包判定落地），本窗口按拍板补 P4 卸包语义 `markPackRemoved` 后接回 | 8 passed / 0 failed |
| `test/render/skinRegistry.test.js` | `deferred-tests/fork-added/render/skinRegistry.test.js` | 被测主体 `public/js/skinRegistry.js`（P6 皮肤注册表）已并入主线；本窗口按拍板放宽 `shared/protocol.js` 的 `isSkinId` 字符类（允许一个 `/`），使插件皮肤的全局 key 能过 `room.skins` | 27 passed / 0 failed |

补写的断言（接回时一并加入，非原归档内容）：

- `resourcePacks.test.js`：`markPackRemoved` 只改变「已学到状态」的 root、把 one-warning 一并清掉（否则 `markPackMissing` 的早退分支会让该 root 永远无法再次被判缺失）、与 `onPackInstalled` 的监听闭环对称；re-export 等价断言增加 `markPackRemoved`。
- `skinRegistry.test.js`：组合 key `pluginId/skinId` 必须落在协议 `SKIN_LIMITS.idLen = 64` 内（`pluginId ≤32` + `/` + `skinId ≤64` 最坏 97 > 64），`validateSkins` 的 `WIRE_KEY_MAX` 校验与 `isSkinId` 的接受性必须一致。
- `test/ui/asset-import.test.js`（主线测试，非接回）：prune 与清除只告知**实际删除成功**的 root（listed-but-absent 只出索引、不计删除、不通知）；`/media/` 音频别名无 pack root，`/fonts` 的 root 是 `/fonts` 整段。

> 语义澄清（本窗口确认）：`resolve()` 对 `IMPORTED_PREFIX` 的 URL 直接短路返回 `state:'ok', source:'imported'`，不看状态表——因为 SW 与 Cache Storage 以 URL 为键。所以对导入路径，状态表的作用只在于**通知监听者清失败缓存**；被 `markPackMissing` 标记的普通 root（如 `/assets/spine`）在导入后仍保持 `missing`，直到 `markPackRemoved` 或重新安装。

## 第五批：fork 改写的主线测试恢复（2026-10-21）

依据用户拍板：失败的 fork 改写测试先登记差异，再恢复为 sganggs 上游版本；若恢复后仍失败，才改产品代码或按现状重写规格。下表为本次恢复的文件，fork 原版本完整副本保存在 `deferred-tests/fork-modified-tests/<相对路径>`，可随时取回对照。

| 文件 | 改写来源 fork | 恢复前失败用例数 | 失败用例示例 |
| --- | --- | --- | --- |
| `test/content/choices.test.js` | 多处合并（自定义） | 0 |  |
| `test/content/garrisons_battle.test.js` | 多处合并（自定义） | 0 |  |
| `test/content/garrisons_meta.test.js` | 多处合并（自定义） | 0 |  |
| `test/content/tokens_summons.test.js` | 多处合并（自定义） | 0 |  |
| `test/data.test.js` | 多处合并（自定义） | 0 |  |
| `test/diy.test.js` | 多处合并（自定义） | 0 |  |
| `test/feedback1d-models.test.js` | 多处合并（自定义） | 0 |  |
| `test/feedback7-voices.test.js` | 多处合并（自定义） | 0 |  |
| `test/golden.test.js` | 多处合并（自定义） | 0 |  |
| `test/i18n-data.test.js` | 多处合并（自定义） | 0 |  |
| `test/i18n-packs.test.js` | 多处合并（自定义） | 0 |  |
| `test/i18n-server.test.js` | 多处合并（自定义） | 0 |  |
| `test/i18n.test.js` | 多处合并（自定义） | 0 |  |
| `test/lobby-ai-last.test.js` | 多处合并（自定义） | 0 |  |
| `test/lobby-diy.test.js` | 多处合并（自定义） | 0 |  |
| `test/lobby-kick.test.js` | 多处合并（自定义） | 0 |  |
| `test/lobby.test.js` | 多处合并（自定义） | 0 |  |
| `test/local-token-models.test.js` | 多处合并（自定义） | 0 | 【追溯】莱茵生命同人扩展整分支移出（2026-10-26，按根项目为准），归档副本已删除：与上游的唯一差异是 `RHINE_WEB_FALLBACKS`（`token_10025_doroth_recttp`），该断言要求该 token 有 web 模型，而已提交的 `data/assets.json` 只有 `spineLocal` 无 `spine`（莱茵生成数据层从未提交）→ 死断言 |
| `test/match/ai-picks-last.test.js` | 多处合并（自定义） | 0 |  |
| `test/match/balance.test.js` | 多处合并（自定义） | 0 |  |
| `test/match/boss-hp-scaling.test.js` | 多处合并（自定义） | 0 |  |
| `test/match/bot-smarter.test.js` | 多处合并（自定义） | 0 |  |
| `test/match/bot.test.js` | 多处合并（自定义） | 0 |  |
| `test/match/clientCombat.test.js` | 多处合并（自定义） | 0 |  |
| `test/match/community-round30.test.js` | 多处合并（自定义） | 0 |  |
| `test/match/connection.test.js` | 多处合并（自定义） | 0 |  |
| `test/match/feedback1-bounty.test.js` | 多处合并（自定义） | 0 |  |
| `test/match/feedback1-gaps.test.js` | 多处合并（自定义） | 0 |  |
| `test/match/feedback1-placement.test.js` | 多处合并（自定义） | 0 |  |
| `test/match/feedback5-we2-diy-grants.test.js` | 多处合并（自定义） | 0 |  |
| `test/match/feedback5-we2-placement.test.js` | 多处合并（自定义） | 0 |  |
| `test/match/finalAssault.test.js` | 多处合并（自定义） | 0 |  |
| `test/match/funnel-redeploy.test.js` | 多处合并（自定义） | 0 |  |
| `test/match/leftovers.test.js` | 多处合并（自定义） | 0 |  |
| `test/match/loadout.test.js` | 多处合并（自定义） | 0 |  |
| `test/match/lobby-integration.test.js` | 多处合并（自定义） | 0 |  |
| `test/match/meta.test.js` | 多处合并（自定义） | 0 |  |
| `test/match/morph-bonds.test.js` | 多处合并（自定义） | 0 |  |
| `test/match/observe.test.js` | 多处合并（自定义） | 0 |  |
| `test/match/playtest6_summons.test.js` | 多处合并（自定义） | 0 |  |
| `test/match/plugin-host.test.js` | 多处合并（自定义） | 0 |  |
| `test/match/pool.test.js` | 多处合并（自定义） | 0 |  |
| `test/match/results.test.js` | 多处合并（自定义） | 0 |  |
| `test/match/runner-pending.test.js` | 多处合并（自定义） | 0 |  |
| `test/match/runner.test.js` | 多处合并（自定义） | 0 |  |
| `test/match/setup-reroll-ws.test.js` | 多处合并（自定义） | 0 |  |
| `test/match/shared-stock.test.js` | 多处合并（自定义） | 0 |  |
| `test/match/unitedown.test.js` | 多处合并（自定义） | 0 |  |
| `test/match/watch-bonds.test.js` | 多处合并（自定义） | 0 |  |
| `test/package.test.js` | 多处合并（自定义） | 0 |  |
| `test/plugin-package.test.js` | 多处合并（自定义） | 0 |  |
| `test/render/board3d-extract.test.js` | 多处合并（自定义） | 0 |  |
| `test/render/board3d.test.js` | 多处合并（自定义） | 0 |  |
| `test/render/boardart.test.js` | 多处合并（自定义） | 0 |  |
| `test/render/cosmetic-refresh.test.js` | 多处合并（自定义） | 0 |  |
| `test/render/feedback2-enemy-attack-clip.test.js` | 多处合并（自定义） | 0 |  |
| `test/render/held-pose.test.js` | 多处合并（自定义） | 0 |  |
| `test/render/impostor-bounds.test.js` | 多处合并（自定义） | 0 |  |
| `test/render/unitview.test.js` | 多处合并（自定义） | 0 |  |
| `test/sim/feedback1-tank-triggers.test.js` | 多处合并（自定义） | 0 |  |
| `test/sim/feedback3-ulpia-move.test.js` | 多处合并（自定义） | 0 |  |
| `test/sim/loadout.test.js` | 多处合并（自定义） | 0 |  |
| `test/sim/playtest6_bosspool.test.js` | 多处合并（自定义） | 0 |  |
| `test/sim/playtest6_limits.test.js` | 多处合并（自定义） | 0 |  |
| `test/ui/assetUrls.test.js` | 多处合并（自定义） | 0 |  |
| `test/ui/audio.test.js` | 多处合并（自定义） | 0 |  |
| `test/ui/bandDraft.test.js` | 多处合并（自定义） | 0 |  |
| `test/ui/buildGuard.test.js` | 多处合并（自定义） | 0 |  |
| `test/ui/diy-ui.test.js` | 多处合并（自定义） | 0 |  |
| `test/ui/emotes.test.js` | 多处合并（自定义） | 0 |  |
| `test/ui/feedback6-diy-bond-members.test.js` | 多处合并（自定义） | 0 |  |
| `test/ui/gameLogic.test.js` | 多处合并（自定义） | 0 |  |
| `test/ui/inspect-range.test.js` | 多处合并（自定义） | 0 |  |
| `test/ui/issue5-fold-camera.test.js` | 多处合并（自定义） | 0 |  |
| `test/ui/loadout-rows.test.js` | 多处合并（自定义） | 0 |  |
| `test/ui/loadout-stats.test.js` | 多处合并（自定义） | 0 |  |
| `test/ui/loadout.test.js` | 多处合并（自定义） | 0 |  |
| `test/ui/morph-bonds.test.js` | 多处合并（自定义） | 0 |  |
| `test/ui/playtest3.test.js` | 多处合并（自定义） | 0 |  |
| `test/ui/playtest6-ui.test.js` | 多处合并（自定义） | 0 |  |
| `test/ui/playtest6-unite.test.js` | 多处合并（自定义） | 0 |  |
| `test/ui/plugin-offers.test.js` | 多处合并（自定义） | 0 |  |
| `test/ui/plugins-content.e2e.test.js` | 多处合并（自定义） | 0 |  |
| `test/ui/plugins-sandbox.e2e.test.js` | 多处合并（自定义） | 0 |  |
| `test/ui/prep-dblclick.test.js` | 多处合并（自定义） | 0 |  |
| `test/ui/pwa-install-023.test.js` | 多处合并（自定义） | 0 |  |
| `test/ui/standin-ui.test.js` | 多处合并（自定义） | 0 |  |
| `test/ui/stats.test.js` | 多处合并（自定义） | 0 |  |
| `test/ui/text-scale.test.js` | 多处合并（自定义） | 0 |  |
| `test/ui/uiFixes.test.js` | 多处合并（自定义） | 0 |  |
| `test/ui/uiRepair3.test.js` | 多处合并（自定义） | 0 |  |
| `test/ui/watch-bonds.test.js` | 多处合并（自定义） | 0 |  |
| `test/update-package.test.js` | 多处合并（自定义） | 0 |  |
| `test/ws-compression.test.js` | 多处合并（自定义） | 0 |  |

共恢复 **94** 个文件。另有 **17** 个失败文件与上游逐字节相同，属于主线回归，不做恢复：

- `test/ci.test.js`
- `test/feedback5-operator-sfx.test.js`
- `test/fetch-assets-shrink.test.js`
- `test/golden-diy.test.js`
- `test/ipv6-bind.test.js`
- `test/local-extract-operators.test.js`
- `test/match/bond-light-up.test.js`
- `test/match/catherine-cell.test.js`
- `test/match/playtest6-matchflow.test.js`
- `test/match/r40a-scroll-morph.test.js`
- `test/match/verification-slices.test.js`
- `test/package-player.test.js`
- `test/test-mode.test.js`
- `test/ui/feedback5-hotkeys.test.js`
- `test/ui/settle.test.js`
- `test/ui/skin-picker.test.js`
- `test/version.test.js`

已恢复但未保留 fork 副本的早期批次：`test/content/items.test.js`、`test/content/kits_alt_t1..t6.test.js`、`test/content/kits_layout.test.js`、`test/content/kits_t4.test.js`、`test/content/kits_t5.test.js`、`test/match/followups.test.js`、`test/diag.test.js`，以及按 restore-candidates 恢复的 `fieldHost-lifecycle`、`local-extract-operators`、`package-player`、`ci`、`echo-counter-023`、`golden-diy`、`ai-picks-last`、`fetch-assets-shrink`、`golden-standins`、`local-extract-fx`、`local-extract`、`scene-assets`、`sim/feedback5-counters-any-damage`、`version`（其中 fieldHost-lifecycle 因产品新增 `outfitModelOf` 接口保留了最小适配）。

## 第六批：聚合产物适配记录（2026-10-21）

恢复上游测试后，剩余失败按「主线行为优先」修产品代码或文档，只有确因聚合产物结构不同才改测试规格。以下为已落地改动。

**产品代码/脚本恢复上游**

| 项目 | 原因 |
| --- | --- |
| `scripts/run-server.cmd` | fork 版本丢失 `set "HOST=::"`，IPv6 绑定断言失败 |
| `scripts/install-service-windows.ps1` | fork 版本默认 `0.0.0.0` 并删除 IPv6 提示，恢复主线 `$BindHost = '::'` |
| `tools/doctor.mjs` | fork 版本把默认 host 改成 IPv4，恢复主线 IPv6 诊断 |
| `tools/package.mjs` | `GITHUB_REPO` 指回 sganggs；`releaseTag` 恢复 `v<version>`（删除 six-player 特例，仓库已改指上游）；随附 `tools/install-skins.mjs`（`server/skinInstall.js` 的运行时导入）与 `docs/research/08-skins.json`；`PLAYER_DOCS` 使用主线扁平路径 `docs/PLAYING.md`（第十三批定案，见下） |
| `tools/vendor.mjs` | `@zip.js` 四个条目改为可选（lite 离线暂存无 node_modules，vendor 不应中断；`public/vendor` 自带产物） |

**文档恢复/归位**

- 从上游恢复 `docs/ARCHITECTURE.md → docs/development/ARCHITECTURE.md`、`docs/DESIGN.md → docs/development/DESIGN.md`、`docs/PACKS.md`、`docs/WINDOWS.md`、`docs/ASSETS.md`、`docs/research/00-INDEX.md`（CHANGELOG/DEPLOY 的链接目标）。
- 玩法指南保持主线扁平路径 `docs/PLAYING.md`（第十三批定案，见下）。fork 的 `docs/guides/PLAYING.md` 与主线版逐字节相同，已删除重复文件，原文留档在 `docs/from-forks/Misyra/docs/guides/PLAYING.md`。

**测试最小适配（上游文件，因产物结构不同）**

| 文件 | 适配 |
| --- | --- |
| `test/version.test.js` | 客户端已无标题页（fork 的 hub 设计），版本/DEV 标记断言改读 `public/js/screens/lobby.js` 与 `hub-dev` |
| `test/fetch-assets-shrink.test.js` | 表情清单并入 ciallo 后 drop 计数 36+19 → 42+19 |
| `test/local-extract-operators.test.js` | Windows 无 `python3`（Store 别名 exit 9009），改用 `python3`/`python` 回退并支持跳过 |
| `test/package.test.js` | PLAYING 路径保持主线扁平 `docs/PLAYING.md`（第十三批定案）；`RUNTIME_RESEARCH` 含 08-skins 后 keep 计数 37；fixture 相对链接按 depth-1 路径同步（`../README.md#操作`） |
| `test/package-player.test.js` | `PLAYER_MARKDOWN` 断言同步 PLAYING 路径（扁平 `docs/PLAYING.md`） |

**数据/基线**

- `tools/build-data.mjs` 新增 `reattachPreservedPicks()`：从 `data/vanilla/backups.json` 追加 zh_CN 缓存已不提供的自选干员（`char_4182_oblvns` 丰川祥子，房主 2026-10-15 拍板），并从 `diy.excluded` 移除，保证可重复生成且不丢内容。
- `data/` 已按 `npm run build-data` 重建；`test/golden/*.json` 已按 `npm run golden:update` 重算（合并后的平衡/逻辑基线）。
- fork 新增的 `test/nginx-cache.integration.test.mjs` 归档到 `deferred-tests/fork-added/test/`，`package.json` 的 test glob 恢复主线（不再匹配 mjs）。

## 第七批：源码侧 fork 差异的留档口径（2026-10-21，用户拍板 C4）

`deferred-tests/fork-modified-tests/` 只存放测试，没有源码留档目录；源码的 fork 版本靠 baseline commit `bc32d38` 保真（`git show bc32d38:<相对路径>` 取回）。本批登记已按主线回归落盘的源码。

| 文件 | 处理 | 留档 |
| --- | --- | --- |
| `public/js/screens/settle.js` | 整页换回主线版（milestones 等级 + 每日防卫目标 + `result.tab` 插槽 + `SettleTestMark`/`UnofficialMark`）。fork 的固定经验模型（`LV_EXP=300`/`LV_MAX=60`）、seed 雷达 `SettleMap`、名片/奖杯卡、`>4` 玩家横向滚动行等整套 UI 包不并入 | baseline commit `bc32d38`（539 行）；`settle.css` 与主线逐字节相同，未动 |
| `public/js/ui/achievements.js` | fork 独有文件（上游无此文件），无测试覆盖。恢复主线两参 `levelOf(total, milestones)` 后，第 217、299 行的单参调用会静默退化为 LV 0，已补传 milestones（`data.getRaw('config')` / `gd.config`）。`achievementStats.exp` 的语义与主线一致（累计 `self.reward`），但不含每日目标 bonus，与结算 LV 存在细微差异 | 原单参写法见 `bc32d38` |
| `test/ui/issue602-deploy-fold.e2e.test.js` | 按第五批口径恢复上游版本（断言部署时折叠商店 + 相机变焦，与 A2 拍板的"核心默认主线（折叠开）"一致）。fork 版断言"#602 折叠已被房主移除"，与 A2 冲突 | `deferred-tests/fork-modified-tests/test/ui/`（另含 fork 的 `waitUntil: 'load'` 写法，上游为 `networkidle0`） |

**已知不兼容（不跑，仅登记）**

- `deferred-tests/ui/fork-redesign.test.js:157` 断言 `settle.js` 不得出现 `LevelStrip|levelProgress|accountApi|fetch\(|net\.request` —— 与 C4 恢复的主线版直接冲突，该测试属 fork-added，`npm test` 不跑；对应特性插件化落地后需按现状重写规格。
- `deferred-tests/ui/achievements-local.test.js` 导入 `AchievementView, AchievementEntryView, AchievementMark`，与当前 `achievements.js` 的导出名（`AchievementEntry`、`AchievementPanel`）不符，属陈旧测试。
- `public/css/screens/result.css:438` 的 `is-wide` 规则是 fork settle UI 包残留，恢复主线版后无对应 DOM，无害但可清理。

## 第八批：B2 表情插件化（2026-10-21，用户拍板）

B2 口径：一个表情包 = 一页（与方舟本体 3×2 一致），插件只能贡献"一页数据"（`UI_SLOT_IDS` 没有轮盘插槽，轮盘留在核心）；客户端通过 visual set 的 file table（`overlays[].files`，path → SHA-256）发现页文件并按 hash-pinned URL 读取；收到消息没有对应资源时回退显示表情包页标题；插件表情 id 命名空间化为 `emote_<namespace(pluginId)>_<slug>`；scope 允许 room 与 personal；分页器保留 fork 的数字计数（分母 = 核心页 + 插件页）。落点为 `plugins/_template/emotes/`（`plugins/*` 被 git-ignored，只有 `_template/` 可提交，PNG 无法提交）。

**测试侧改动（恢复上游 + 按 B2 口径调整）**

| 文件 | 处理 | fork 副本 |
| --- | --- | --- |
| `test/assets.test.js` | 计数回上游 36 / 55（fork 曾为 42 / 61，即 ciallo 并入核心清单）；保留 fork 的素材树门控 `skipArt`（本环境无 `public/assets/spine`，6 个用例 skip） | `deferred-tests/fork-modified-tests/test/assets.test.js` |
| `test/fetch-assets-shrink.test.js` | 第六批登记的 `36+19 → 42+19` 回退为上游 `36 + 19`（ciallo 不再进核心素材清单） | `deferred-tests/fork-modified-tests/test/fetch-assets-shrink.test.js` |
| `test/ui/localArt.test.js` | 4 处 `EMOTE_CATALOG.filter(e => !e.custom)` 恢复上游写法 `EMOTES` | `deferred-tests/fork-modified-tests/test/ui/localArt.test.js` |
| `test/ui/emotes.test.js` | 恢复上游版本；protocol 用例按 B2 口径重写（官方 36 + `emote_<namespace>_<slug>`，`emote_ciallo` 无 slug 仍不合法）；clock 用例按"保留 fork"口径保留 fork 独有的核心数据独立超时（上游 `data.js` 无 `CORE_DATA_TIMEOUT_MS`，断言为 `arms` 为空），本产物保留 30000 并只调整断言文案 | `deferred-tests/fork-modified-tests/test/ui/emotes.test.js` |
| `test/ui/emotes.e2e.test.js` | `CUSTOM_EMOTE_THEME` import 与 Ciallo 用例段删除（表情包改由插件页提供）；分页器断言按"保留 fork 数字计数"改写为 `.ewheel__count` + `.ewheel__nav.is-next`（上游为 `.ewheel__dot`）；`waitUntil: 'load'` 保留 fork（上游 `networkidle0`） | `deferred-tests/fork-modified-tests/test/ui/emotes.e2e.test.js` |
| `test/ui/devices.e2e.test.js` | 不可整文件恢复上游（lobby-first、公告板、数字分页器均已并入），仅 `ALL_EMOTE_THEMES` → `EMOTE_THEMES` | `deferred-tests/fork-modified-tests/test/ui/devices.e2e.test.js` |

**本轮按 B2 规格新写的测试**（fork-added 归档之外，属新增规格）

| 文件 | 用例数 | 锁定的口径 |
| --- | --- | --- |
| `test/plugins/emotes.test.js` | 9 | `PARTS.emotes`（cosmetic/content、`maxFiles: 1`、`name: 'emotes.json'`、`needs: []`）、API 2 gate、schema 分支、页文件进入 visual set file table 并被 served、页解析与坏格跳过、命名空间 id |
| `test/ui/emotePages.test.js` | 7 | URL 形态与 `shared/plugins/visual.js` 常量等式（`FILE_URL_DIGITS`、`PLUGIN_FILES_URL`）、无 layer 时不列不请求（呼应 `test/ui/plugins.e2e.test.js`）、file table 通道、每个 URL 只请求一次、坏页保留标题、轮盘分页器与回退分支（读源文本断言） |

**不动项与已知偏差**

- `.assets-manifest.json`（根目录、tracked）：fork 的 CDN 发布记录，仍含 ciallo 的 6 个条目，无测试校验 → 保持不动，属部署数据。
- `data/assets.json`：已删除 6 个 ciallo `ui` key（645 → 639）并同步 `stats.ui`，但文件 hash `89f4ad9f91ea` 未重算；需 `npm run assets` 重算后 hash 才与内容一致。
- `docs/from-forks/jingjiangze/docs/PLUGINS.md`、`docs/PLUGIN-GUIDE.md`：fork 存档（含 ciallo 表情段），历史记录不改。
- ciallo 的 7 个语言键暂留核心语言包：`PARTS.i18n` 的 classes 为 `['content','script','trusted']`，不含 `cosmetic`，cosmetic 表情包插件无法携带语言包 → 待 i18n 部件扩展后迁移。
- `plugins/_template/emotes/plugin.json` 声明 `"id": "ciallo"`：与 `test/plugins/tool.test.js:119` 对 cosmetic 模板"不写 id"的约定存在偏差（照 `plugins/_template/content/` 先例），模板 README 已说明复制后的文件夹名必须等于清单里的 id。
- 新增源文件必须 `git add`（`tools/package.mjs` 的 `importProblems` 走 `git ls-files`）：`shared/plugins/emoteCatalog.js`、`public/js/ui/emotePages.js`、`server/studio/templates/emotes.js`、`plugins/_template/emotes/` 与本轮两个测试文件已入索引。

**复跑计数**：`test/plugins/emotes.test.js` 9/9、`test/ui/emotePages.test.js` 7/7；相关套件（client-static、plugins/surface、plugins/errors、plugins/schema、plugins/tool、plugins/registry、plugin-package、studio/gameplay、studio/presentation、assets、fetch-assets-shrink、ui/localArt、ui/cosmetics-lazy、ui/emotes、ci）合计 **1176 tests / 1170 pass / 0 fail / 6 skipped**，6 个 skip 均为 `public/assets/spine` 缺失的门控。

## 第九批：B1 per-clip extents（2026-10-21，用户拍板：保留 fork 特性，登记为仅测试侧消费者）

B1 口径：per-clip extents 是 fork 独有特性，主线已由运行时测量取代。本产物**保留 fork 的工具与数据**（不剥离），运行时代码无消费者，但**测试侧有消费者**（`test/feedback1d-models.test.js:107`）——按拍板"测试跟随实现"，数据侧补齐后 hash 已重算。

**事实基线**

| 项目 | 结论 |
| --- | --- |
| 上游 | 全仓无 per-clip extents（`extents` 仅出现在两个测试里的同名相机辅助函数 `extents(cam, rows)`）；`tools/assets/skel.mjs` 无 `CLIP_EXTENTS_VERSION` / `clipExtents` |
| 主线等价实现 | `public/js/render/spine.js` 的 `clipBounds` / `requestClipBounds` / `stepClipBounds` + `public/js/render/units.js` 的 `impostorBox`；`test/render/impostor-bounds.test.js`（主线版，477 行）完全不读 manifest extents |
| 产物保留的 fork 工具 | `tools/assets/skel.mjs`（`EXTENT_STEP = 1/20`、`EXTENT_MAX = 48`、`CLIP_EXTENTS_VERSION = 2`、`clipExtents(bytes, atlasText)`）、`tools/assets/spine.mjs`（写入 `extents`，缓存键校验 `clipExtentsVersion === CLIP_EXTENTS_VERSION`）、`tools/assets/local-enemy-spines.json`（缓存含 extents）。相对 baseline commit `bc32d38` 无 diff |
| 数据实况 | `data/assets.json` 含 606 个 extents（`chars` 2、`outfits` 604），`generator` 为 `tools/merge-generated-release.mjs`（fork 独有工具，上游无） |
| 消费者 | 运行时代码无消费者（`public/js/` 无读取 `entry.extents`，`spine.js`、`units.js` 均无）；测试侧消费者 = `test/feedback1d-models.test.js:107` |
| 测试校验 | `test/assets.test.js` 的 shape 用例只断言 `version === 1`、`typeof manifest.hash === 'string'` 与 12 个组，不校验 hash 值、generator 或 extents |

**不可跑的归档测试（仅登记）**

- `deferred-tests/fork-added/render/impostor-extents.test.js`：依赖 `SpineActor.extents()` 契约，`public/js/render/spine.js` 无此方法 → 用例即失败。其中数据断言部分：Gummy 画架（`outfits.chars['char_196_sunbr@summer#1'].spine.front.extents.Idle[0] <= -195`，实测 `Idle = [-201, -379, 193, 16]`）可通过；Ashlock（`chars.char_431_ashlok.spine.front.extents`）必失败——该 entry 无 extents，keys 为 skel / atlas / textures / pma / anims / animations / events / hits / bounds。
- `deferred-tests/fork-added/render/impostor-fork-models.test.js`：同样读 `entry.extents` 与 `widenByExtents`（`units.js` 无 `widenByExtents`）→ 同样不可跑。
- 若后续要让 extents 有消费者（在 `impostorBox` 增加"无法测量时回退到 manifest extents"），这两个文件应移回 `test/` 并按实现重写规格。

**悬空引用与历史记录（不改）**

- `public/dev/sandbox.js:5` 头注释引用 `docs/ASSETS.md` 的 `extents`，而恢复的上游 `docs/ASSETS.md` 已无该字段 → 属 fork dev 页的悬空引用，本次不改。
- `FORK-CHANGELOG.md:202-205`、`252` 描述该特性（"15 个模型仍有姿势超出盒子；上游盒子单独 28、extents 盒子单独 28"）与"manifest 现在携带每个 clip 的 extents"，属 fork 历史记录，不改。
- hash 由 `contentHash(JSON.stringify(body))`（`tools/assets/manifest.mjs:174-176`）计算，包含 extents。若日后改按主线回归，需脚本手术剥离 606 个 extents 并重算 hash——本环境无 `public/assets/spine`，无法用 `npm run assets` 重算。
- **本轮数据补齐（按拍板 (a) 测试跟随实现）**：`data/assets.json` 的 `enemies.enemy_1305_mhslim.spineLocal` 与 `enemies.enemy_1305_mhslim_2.spineLocal` 补 `extents`（值取自 committed metadata `tools/assets/local-enemy-spines.json`，置于该 entry 末尾），`stats` 不变（`countStats` 按 key/对象计数，不按叶子，增加对象不改变任何计数），hash 重算 `89f4ad9f91ea` → **`7145a46f25d8`**。改后 `test/feedback1d-models.test.js:107` 的目标用例 ✔（该文件仍报 1 fail，属 line 123 用例读取 `public/assets/local` 时的沙箱崩溃，环境类）。

## 第十批：C5 导出字段与插件（2026-10-21，用户拍板：字段恒在（null / 空对象）、不给插件扩展点、文档补写 skins / portraits）

C5 口径三条：

1. **形态**：插件相关字段**恒在信封/记录里**，无插件时为 `null` 或空对象——不采用"仅在启用时出现（空则省略字段）"。
2. **扩展点**：不给插件写入导出信封的扩展点，核心导出结构固定，插件数据不进导出。
3. **文档**：实现是既成事实（导入端忽略未知字段），文档向实现靠拢，补写 `skins` / `portraits`。

**检索结论**：设计文档里没有 C5 的规则原文。最接近的三处都不是导出规则——上游 `docs/PLUGINS.md` §11（508-511）是本地战绩记录规则（记录带 `vs`，"null without cosmetic plugins"）；`docs/design/network.md:164` 的「add `rules` only when declared」针对协议消息字段；`docs/DATA.md:440`、`678` 的「present only when」是数据文件字段惯例。

**事实基线**

| 项目 | 结论 |
| --- | --- |
| 记录侧（已实现） | `public/js/ui/stats.js` header 29-35 + `vsOf`(81-82) + `contentOf`(84-94) + `FULL_KEEP`(358)：每条记录带 `vs`（无插件 null）与 `content`（玩法 content set，原版 null）；个人插件不记录 → C5 口径在记录侧已成立，无需改动 |
| 导出侧（无扩展点） | 四个信封（loadout / diy / ownership / local-stats）均为核心固定结构；`exportStats`(743-751) 信封 5 键；`shared/plugins/recordsSchema.js` 的 `RECORD_SCHEMA` 无插件条件字段 → 插件无法添加字段 |
| loadout 信封差异 | 上游 `exportPayload` 6 键（`git-clone/.../public/js/ui/loadoutModel.js:175-188`）；产物 8 键（fork 加 `skins` / `portraits`，无条件出现） |

**本轮改动**

- `docs/design/match.md` 导出段：信封补写 `skins` / `portraits`（说明恒在、空对象、旧版本读取忽略），并新增一段"导出信封是核心固定结构，插件无扩展点；唯一的插件相关字段是核心定义的记录字段 `vs` / `content`"。
- `test/ui/loadout.test.js:46`：按现状重写规格——断言 8 键（含 `portraits` / `skins`）并补两个空对象断言。改前该文件 21/22（1 fail），改后 **22/22**。

**归档副本与覆盖缺口（仅登记，不改）**

- `deferred-tests/fork-modified-tests/test/ui/loadout.test.js`：8 键断言，与本轮改后的 `test/ui/loadout.test.js` 一致（该副本是本轮口径的来源）。
- `deferred-tests/fork-modified-tests/test/ui/stats.test.js`（186-209）：fork 独有 describe「the room's cosmetic plugins（DESIGN §32 P1a review round 2）」只覆盖 `vs`，无 `content` 段 → 属 0.3.0 之前的陈旧版本；且从归档位置不可运行（import `../../public/js/ui/stats.js` 解析到 `fork-modified-tests` 内），仅登记。
- **覆盖缺口**：`test/ui/stats.test.js`（179-198）只覆盖 `vs` 规则，`content`（玩法插件 content set）规则已文档化 + 已实现但无测试 → 待补。

## 全量复跑计数（2026-10-21，C5 改后）

口径：`npm test -- --test-force-exit --test-timeout=120000`（Node 24.19，spec reporter）。

**9019 tests / 618 suites / 8914 pass / 56 fail / 49 skipped / 0 cancelled**（耗时 716.6 s）。

本轮改动已计入：`test/ui/loadout.test.js` 不在失败清单（22/22）。49 个 skip 含浏览器 E2E 与素材树门控（本环境无 `public/assets/spine` / `public/assets/local`）。

**56 个失败按性质分类**

| 性质 | 数量 | 说明 |
| --- | --- | --- |
| 断言与实现不符（规格差异，需逐条判定"测试跟随实现"还是"实现回归主线"） | 51 | 含 C2 文字缩放 5 条（`test/ui/text-scale.test.js` 164/179/204/222/241）、C6 替补卡 2 条（`test/ui/standin-ui.test.js` 238/366）、B1 extents 1 条（见下） |
| 文档 / 打包类 | 2 | `test/package.test.js:83`（PLAYING 路径）、`test/package.test.js:319`（doc 链接 `../../README.md#操作`） |
| 环境类 | 3 | `test/plugins/script-sandbox-integration.test.js:90`（沙箱拒读 AppInstaller DiagOutputDir 日志，script setup 超 5000 ms）、`test/render/board3d-extract.test.js` 188 / 217（缺 `public/assets/local` 素材与 WebP） |

无 puppeteer / 真实网络类失败。

**B1 口径冲突（已拍板：(a) 测试跟随实现）**

第九批曾称 extents"无消费者"，但 `test/feedback1d-models.test.js:107`（"data/assets.json never depends on the local extraction"）把 committed metadata 与不含 `extents` 的期望基线逐 entry 比对 → 因 606 个 extents 失败（首个命中 `enemy_1305_mhslim`）。即该测试是 extents 的**测试侧消费者**。两个方向：

- (a) 把 `extents` 补进该测试的期望基线（测试跟随实现，B1 口径不变）；
- (b) 按主线剥离 606 个 extents 并重算 hash（B1 口径改为回归主线，本环境无法用 `npm run assets` 重算）。

**选定 (a)**。该测试的期望基线本就来自 committed metadata（`tools/assets/local-enemy-spines.json` 两个 slug model 均含 extents），所以真正的修复在数据侧：manifest 的 `spineLocal` 与 committed metadata 不一致 → 补齐数据（见上），测试与工具均不改。`tools/assets/local-token-spines.json`（40 tokens）无 extents，与 manifest 的 `tokens` 一致，无冲突。

## 第十一批：C6 替补卡职业显示（2026-10-21，用户拍板：恢复主线职业名 + 补 TOKEN + 恢复 t()）

C6 三层，逐条口径：

| 层 | 现象 | 拍板 | 本轮处理 |
| --- | --- | --- | --- |
| shopBar 职业行 | fork 把 `scard__class` 的第二段改为"剩余{n}张"（含按 tier 的默认张数表 1:30 / 2:25 / 3:18 / 4:12 / 5:10 / 6:7），主线为 `c?.subProfessionName` | 恢复主线职业名 | `public/js/ui/shopBar.js:133` 恢复 `${c?.subProfessionName \|\| ''}`；"剩余{n}张"作为 fork UI 特性从核心移除 |
| `PROF_NAME` 缺 TOKEN | `public/js/ui/loadoutModel.js:27` 只有 8 项（无 TOKEN），而 `public/js/ui/detailPanel.js:56` 有 9 项含 `TOKEN: N_('召唤物')`（上游同文件同样含）；替补卡可能显示空职业 | 补 TOKEN | `loadoutModel.js` 的 `PROF_NAME` 补 `TOKEN: N_('召唤物')`；`PROF_ORDER` 不加（插件 profession enum 仍不含 TOKEN） |
| `t()` 丢失 | `public/js/screens/ownership.js` 整文件丢 `t()` 包裹且无 i18n import（上游 line 34/37/42/50/53/68/70/73/74/78 均用 `t()`/`tParts()`）→ `test/i18n.test.js:135` 报 14 条 not wrapped | 恢复 t() | 补 `import { t, tParts } from '../../../shared/i18n.js'`，按上游恢复 10 处包裹（label / title / 两处 PROF_NAME / 持有状态 / lead / toggle / aria-label / tParts / 空态）；fork 独有的 `data.locale?.() \|\| 'zh'`（line 25）保留 |

**语言包**：涉及的 msgid 全部已在 `public/i18n/en.json`（`召唤物` 649、`{tier}阶` 1069、`阶` 1070、lead 段 1079、`未持有` 1163、`{name}：持有` 1194、`{name}：未持有，由 {standIn} 上场` 1195、`替补干员` 1196、`点击标记为未持有…` 1197、`点击恢复为持有` 1198、`无替补数据` 1199、`持有` 1200、`仅看未持有` 1201、`全部持有…` 1202、`没有可下掉的干员` 1203）→ 无需新增键。`剩余{n}张`（en.json 4881）移除后变未使用键：strict 模式不报未使用键（`tools/i18n.mjs:721` 仅 `--stale` 报），仅登记。

**测试侧（按拍板"测试跟随实现"）**

- `test/ui/standin-ui.test.js:251`（原失败点 238）：断言 `scard__class` 含 `subProfessionName`（无畏者）——实现恢复主线后应转绿，测试不改。
- `test/ui/standin-ui.test.js:375`：原为主线正则 `chessAvatarUrl(mm, ownSi(chess) || ownDiy(chess) || chess)`，实现含 fork 皮肤特性 `ownAppearance(..., st.priv)` → 按拍板改测试跟随实现（采纳 fork 留档版正则与消息）。改后 `test/` 与上游在该行不同，留档副本 `deferred-tests/fork-modified-tests/test/ui/standin-ui.test.js:378` 与 `test/` 一致。
- `test/ui/standin-ui.test.js:371`（同一用例的另一条断言，也是该用例失败的首个命中点）：主线版要求 `const sig = \`…|${info.spine || ''}\``，实现为 `… + (info.skin ? `|${info.skin}` : '')`（`render/app.js:905`）；fork 留档版要求模板串内含 `info.skinId`，与当前实现也不一致（留档版对应更早的 fork 实现）→ 按拍板改测试跟随实现，断言改为匹配 `+ (info.skin ? … : '')` 形态并补消息。该用例其余断言（`const si = chess && standInList…`、`doesNotMatch`、`standInList = Array.isArray`、`info.js` 的 `standInFor`、`(ownSi || ownDiy || chess)?.name`）与实现一致。

**验证状态**

- `test/ui/standin-ui.test.js` **15/15 全绿**（含此前失败的 238/371/375 三条；251 的 `subProfessionName` 断言随 shopBar 恢复主线转绿）。
- 引用 `shopBar` / `PROF_NAME` 的另外 9 个测试文件 **81/81 全绿**（`loadout`、`feedback1-offers`、`feedback1b-bonds`、`playtest5-ui`、`playtest6-elite`、`playtest6-ui`、`moduleIcons`、`refresh-tap`、`feedback7-orchid-freeze`）。
- `test/i18n.test.js`：`public/js/screens/ownership.js` 的 14 条 not wrapped **已消失**；该文件仍失败，剩余未包裹项全部来自其他 fork 新文件（`battle/aiDanmakuEvents.js`、`battle/observe.js`、`battle/damageStats.js`、`resources/*.js`、`ui/ownershipModel.js` 的导入错误文案等），属合并残留的独立批次，不在 C6 范围。
- `test/i18n-server.test.js:131` 仍失败，与 C6 无关（既有失败项）。
- **全量交叉验证（`--no-opt`，9016 tests / 8786 pass / 178 fail）**：`test/ui/standin-ui.test.js` 与 `test/feedback1d-models.test.js` **均不在失败清单**（两者的失败已随 C6、B1 修复消失）；旧 56 失败清单中其余条目全部复现。新增的 ~120 条集中在 `test/studio/**`（62）、`test/plugins/**`（约 30）、`test/package.test.js`（9）、`test/update-package.test.js`（4）、`test/lobby-plugins.test.js`（4）、`test/match/plugin-host.test.js`（4）——全部是 SES 脚本沙箱 / 打包构建类，属禁用 JIT 的副作用，与 C6 无关（C6 只改 3 个 UI 文件 + 1 个测试断言）。

**环境问题（影响所有测试复跑，与代码无关）**：本机默认 JIT 下 `node --test` 随机崩溃（`0xC0000005` / `0xC0000409`，崩溃点每次不同，连纯 `import()` 也会命中）。此前"沙箱拦截"的判断被推翻：崩溃与文件权限无关，是 V8 JIT 侧的环境故障。可用的两种降级口径及其代价：

| 口径 | 结果 | 副作用 |
| --- | --- | --- |
| `node --no-opt --test …` | 9016 / 8786 / 178，约 9 分钟 | SES 脚本沙箱与 studio/打包类误报（约 120 条） |
| `node --jitless --test …` | 9008 / 8731 / 223，约 25 分钟 | 同上，且更慢、误报更多 |

两者都能跑通真实业务测试；对"某条失败是否真实"的判定，取两口径的交集（或与默认 JIT 的历史基线 `9019/8914/56` 比对）。

## 第十二批：C2 对局内 UI 缩放（2026-10-21，用户拍板：保留 fork 缩放，测试跟随实现）

> 2026-10-27 用户改拍：fork 的 `--ui` 命名空间与「对局界面缩放」设置项取消，统一为上游的 `--sp-ui`（70–120% 并入上游
> 75–100% 档位，落点 `ui/screenFit.js` 的 `ui` / `sp.pref.screenFit`）。本节是当时的记录，保留不改；`fork-added/ui/ui-scale.test.js`
> 与 `ui-scale.e2e.test.js` 标注为退役，现由 `test/ui/ui-size.test.js` 与 `test/ui/screen-fit.test.js` 覆盖。

**fork 特性**（保留，不回归主线）：

| 变量 | 定义（`public/css/theme.css`） | 作用 |
| --- | --- | --- |
| `--ui` | `137` 起：`:root { --ui: 1 }`，`sp-in-match[data-ui="auto"]` = .8，`70/80/90/110/120` = .7/.8/.9/1.1/1.2 | 对局内 UI 缩放档（设置 → 对局界面缩放），所有 px 基准写成 `calc(Npx * var(--ui))` |
| `--t` | `176-179`：`1rem` / `max(1rem, calc(64px * var(--ui)))` / `… calc(76px…)` / `… calc(88px…)` | 文字大小四档的 px 下限随 `--ui` 缩放（主线为固定 `64/76/88px`） |
| `--utility-text` | 如 `screens/guide.css:97`：`calc(.18 * var(--utility-text, var(--t)))` | 辅助文本可单独覆盖文字缩放，缺省回落到 `--t` |

**`test/ui/text-scale.test.js` 按现状重写（5 条断言 + 排除表）**：

1. `语音语言` 的 flex 表达式：`calc(25% - 1px)` / `calc(50% - 1px)` → `calc(25% - calc(1px * var(--ui)))` / 同理（`screens/game.css:829`）。
2. `theme.css` 四档 `--t`：`max(1rem, 64px)` 等 → `max(1rem, calc(64px * var(--ui)))`（lg/xl 同理）。
3. `可读文本读 --t` 的 guide.css 抽样：`.guide__tips li` 改为匹配 `var(--utility-text, var(--t))`。
4. `HUD / 棋盘钉住文本保持原样`：`.sitag` 的 `max(.12rem, 9px)` → `max(.12rem, calc(9px * var(--ui)))`。
5. `每一处 plain rem 都是文档化排除项`：新增 106 条 fork 新增排版的排除前缀（`NOT_SCALED`）——结算页 `result.css` 的 `.s(op|logo|mode|self|plate|bonds?|lv|ettle|team|btn)` / `.t(card|chip)`（47 条）、大厅成就页 `.(hub-)?ach[-_]`（46 条）、`rhine-*`（9）、`kazdel-*`（2）、`online-pill`（2）。这些页面自成卡片排版，文字缩放留待后续批次，与既有的 `NOT_SCALED_FILES`（`game-shop.css` / `loadout.css` / `stats.css`）同一口径。

**结果**：`test/ui/text-scale.test.js` **12/12 全绿**（`859` 条已读 `--t` 的声明保持不变，`scaled >= 250` 的守护仍有效）。README 第五批「多处合并（自定义）」中登记的该文件现为"测试跟随 fork 实现"。

## 第十三批：i18n 收尾与剩余真实失败清零（2026-10-22）

### i18n（用户拍板：UI 译英文，台词保留原文）

- `public/i18n/en.json` 补齐 189 条缺失 msgid，其中 77 条为角色台词/剧情文本，按口径保留原文（identity 条目）。
- `tools/i18n.mjs check --strict`：**4080 msgids used, 4080 translated (100 %), 0 missing, 0 errors**。
- 四个 i18n 测试文件（`test/i18n.test.js`、`test/i18n-server.test.js`、`test/i18n-packs.test.js`、`test/i18n-data.test.js`）**40/40 全绿**。测试侧同时允许 identity 条目（原文即译文的条目不算未翻译）。

### golden（用户拍板：恢复主线 seed 5 + 重新生成）

- `tools/golden.mjs` 的 coverage-diy 场景从 fork 的 seed 3 改回主线 **seed 5**：合并后的 AI 在 seed 3 从不购买 自选 棋子，shop → deployment → battle 路径不再被覆盖。`FAST_MATCHES` 同步为 `coop2-NORMAL-5-coverage-diy`。coverage-standins 的 seed 4 不变。
- `test/golden-diy.test.js` 按 D028 改断言（测试跟随实现）：co-op 下只有共享池吃倍数，私有 自选 stock 保持单人基准（tier5 = 8、tier6 = 5），不再断言 `stock > 8`。
- `npm run golden:update` 重写 `test/golden/*.json`（roster 49 / bonds 46 / fields 22 / matches 21 / standins 10 / diy 141）。复跑 `test/golden.test.js` + `test/golden-diy.test.js` = **10/10 全绿**。

### package 落点（用户拍板：改回方案 B，保留主线内容）

- 玩法指南保持主线扁平路径 `docs/PLAYING.md`；fork 的 `docs/guides/PLAYING.md` 与主线版逐字节相同 → 删除重复文件，原文留档 `docs/from-forks/Misyra/docs/guides/PLAYING.md`。
- 只修 fixture 链接层数：`test/package.test.js:325` 的 fixture 与 `:339` 的断言按 depth-1 路径同步（`../README.md#操作`）。
- 路径引用同步：`test/ui/playtest6_summons.test.js:66`（实际读取路径，上一轮只改了头注释）、`test/content/playtest6_summons.test.js:14`、`test/static-local-art.test.js:114`、`test/package-player.test.js`、`docs/README.md`、`docs/operations/PACKAGING.md`、`docs/development/SIM.md:163`、`docs/development/DATA.md:644` 与 `:648`、`shared/constants.js:481`、`public/js/ui/gameLogic/terrain.js:18`、`deferred-tests/incompatible-docs/docs-consistency.test.js:73`。`docs/history/*` 与 `docs/from-forks/*` 属历史记录，不改。
- 复跑 `test/package.test.js` + `test/package-player.test.js` + `test/static-local-art.test.js` = **25/25 全绿**。

### presence 口径（测试跟随实现）

- presence 是 fork 独有特性（主线全仓无 `presence.state`）：`PRESENCE_SLICE = 200`、`PRESENCE_IN_MATCH_MS = 10_000`，`publishPresence()` 广播给**所有在线 session**，含被房主踢出房间但仍连接的观战者。
- `test/match/lobby-integration.test.js:256` 按口径采纳 fork 留档断言：过滤 `['pong', 'presence.state']`，消息为"no room, match or battle frame reaches the removed spectator; public presence remains available"。与 `deferred-tests/fork-modified-tests/test/match/lobby-integration.test.js:263` 一致（该留档版即口径来源）。

### 调试残留清理

`test/helpers/__dbg/`（全仓 grep `__dbg` 无引用）删除 7 个文件：`chararts/char_9001_test.ab`、`spritepack/char_portrait_0.ab`、`spritepack/ui_char_avatar_0.ab`，以及 `out/char/{avatar,portrait}/char_9001_test/` 下的 4 个 PNG。

### 全量复跑计数（2026-10-22，`--no-opt`）

口径：`node --no-opt --test --test-force-exit --test-timeout=120000 "test/**/*.test.js" "test/e2e/coop.e2e.mjs" "plugins/_template/**/*.test.js"`（Node 24.19，spec reporter，557.556 s）。

**9016 tests / 618 suites / 8961 pass / 3 fail / 3 cancelled / 49 skipped**。

剩余 3 个 fail 全部为环境类，无真实断言冲突：

| 文件 | 现象 | 判定 |
| --- | --- | --- |
| `test/local-extract-operators.test.js:144` | `4 !== 12` | Windows `\` 路径分隔符（第六批已加 `python3`/`python` 回退），环境误报 |
| `test/render/board3d-extract.test.js:188` | `AssertionError: D file` | 本环境无 `public/assets/local` 素材 |
| `test/render/board3d-extract.test.js:217` | WebP 清单文件不在磁盘 | 同上，缺 WebP/PNG 素材 |

3 个 cancelled 全部来自 `test/ui/morph-bonds.test.js`（146/147/161/176）：`--test-force-exit` 在顶层 `await import()` 尚未 settle 时退出进程。去掉 `--test-force-exit` 单跑该文件 **8/8 全绿** → 属 runner 副作用，非产品问题。

49 个 skip 为浏览器 E2E 与素材树门控（本环境无 `public/assets/spine` / `public/assets/local`）。

**结论：本轮之后没有"测试与实现不符"的真实失败，剩余项全部为环境/runner 类。**

---

## 第十四批：本机 Docker 部署 + 内置浏览器玩家流程回归（2026-10-22）

### 部署环境

镜像 `stronghold-protocol-local`（多阶段：deps → build → client → runtime `node:24-alpine`，`USER node`，`EXPOSE 3000`，HEALTHCHECK `/healthz`）。容器 `stronghold-local` 状态 `Up (healthy)`，`http://localhost:3000`。

启动时注入 `SP_MODERATION_KEY_FILE`、`SP_MODERATION_LEXICON_FILE`（挂载只读），素材目录 `public/assets` 只读挂载，状态目录用 named volume `stronghold-state`。`/healthz` 返回 `combat.backend = inline`、`trial.status = disabled`。

### 本轮落盘的三处修复

| 文件 | 问题 | 修复 |
| --- | --- | --- |
| `package-lock.json` | `npm ci` 报 EUSAGE：lockfile 缺 `@zip.js/zip.js` | `npm install --package-lock-only` 同步（line 887，`zip.js-2.23.0`） |
| `Dockerfile:52` | `.dockerignore` 排除 `public/vendor`，且 `--ignore-scripts` 使 postinstall 不执行 → 镜像内 vendor 为空 | build 阶段显式 `RUN node tools/vendor.mjs`；构建后镜像内 13 个 vendor 文件齐全，`/vendor/three.module.js` 200（662772 B） |
| `public/css/components.css:1250` | JS 风格 `//` 注释 → lightningcss "Invalid empty selector" | 改为 `/* ... */` |

### 控制台报错

回归全程控制台**没有应用自身的 JS 运行时错误**。全部报错为素材缺失类：BGM/SFX/语音/webp 的 `net::ERR_ABORTED`、`[audio] ... unavailable`、`[assets] /assets/local pack is missing`（本环境无 `public/assets/local`，与全量复跑的环境类 fail 同源）。缺失时每个 pack root 只警告一次并跳过请求，视图回退占位素材（棋子以"头像在稀有度菱形内"渲染）。

非素材类 error 全部是测试探针自身产物（语法错误 / 探针 throw 被应用全局错误处理器捕获 / null dispatchEvent），不计入产品问题。

### 玩家流程回归结果（按预期）

大厅 → `SOLO 独立模拟` → 协议选择（AC-1，9 回合，战场#01）→ BRIEFING → `1/2 确认本局信息` → `2/2 选择策略` → `阿米娅` → 对局。逐格拖拽（rows 9–12, cols 0–10）20 次 `pieceDrop`，落点与 `deployTiles.normal.melee` 完全一致；`changedByDevices` 的 (10,5)(10,6)(11,5) 被正确判为 illegal。回合 1–4 战斗正常，泄漏扣血 25→15→9→0。商店购买/刷新/冻结/升级/出售/撤退全部通过（商店卡与升级卡均为 arm → confirm 两次点击，onClick 挂在 `button.scard`）。六个信息面板核对通过。合成 `PointerEvent` 拖拽 + 朝向轮盘（`ArrowRight` + `Enter` 提交）成功。LP 归零 → `phase = RESULT`，`reason = eliminated`，`roundsPassed 3`、`eliminatedRound 4`、`trophies 0`、`reward 38`、`title comment_6`、`bonds` 四条各 layers 2 / active false、`stats` dmgDealt 18768 / kills 19 / leaks 26 / gold 7 / refreshes 1 / perfectRounds 1。结算页 → `数据详情` → 对局记录写入正确（`2026-10-22 19:16 / 标准模拟 / 单人 / 阿米娅 / 负 / 3`）→ 点行可回看 → `返回同盟` 回到 solo 房间。

### 点击后不符合预期（真实缺陷，本轮未改代码，仅登记）

| # | 现象 | 根因 |
| --- | --- | --- |
| 1 | 结算页「对局记录」按钮点击无反应 | `openStats()` 不接收参数（`public/js/screens/stats.js:48`）；`StatsScreen` 的 `inMatch` 守卫（`:508`）在 RESULT 阶段立即 `closeStats()` —— `selectRoute` 对非 LOBBY 阶段仍返回 `game`（`public/js/store.js:126-132`）。对照实验：从房间页点 `stats-entry` 可正常打开面板 |
| 2 | `openStats('history')` 的参数被忽略，永远落在「总览」 | `openStats` 签名无参数，内部硬编码 `tab: 'overview'`（`stats.js:48-54`） |
| 3 | 回看结算显示 `通过回合 3 /14`，应为 `/9` | `m.result` payload 不含 `lastRound`（`server/match/results.js:173-192`）→ `public/js/ui/stats.js:234` 存成 `null`（localStorage `sp.pref.stats` 实测 `lastRound: null`）→ 回看时 `public/js/ui/gameLogic/result.js:46` 回退默认 14 |
| 4 | 结算页对被淘汰玩家显示 10 张 NO INFO 空卡，数据详情却显示「阵容已撤离」，口径不一致 | `eliminate()` 清空 board（`server/match/player/round.js:70`）→ `results.js:133` 的 lineup 为空 |
| 5 | 数据详情「敌方领袖」只有 label，领袖名仅存在于 `title` 属性（实测 `阿利斯泰尔，帝国余晖`），无可见文本；素材缺失时图标为空 | `public/js/screens/result.js:153-155` |
| 6 | `rotate-hint` 容器 `display:none`，但按钮与文案仍在无障碍树 | CSS 隐藏未同步 `aria-hidden` / 未移除节点 |
| 7 | client-combat 模式下 `输出统计` 面板永远为空，而 `private.stats` 有数据 | `server/match/match/extensions.js:76` 把 damage 置空 —— 设计行为，但构成可用性缺口 |
| 8 | Enter 无法激活对话框内已聚焦按钮 | `public/js/ui/components.js:541-543`：`Enter` 且 target 非 BUTTON 时直接 closeDialog |

### 已撤销的误判

Space 快捷键、"整备区已满"、"计时器冻结"、`pieceDragMove` 不转发、Escape 无法关闭统计面板 —— 复核后均不成立（前四项为测试脚本时序/选择器问题，Escape 第一次 600 ms 未生效属时序，第二次 1200 ms 生效）。

---

## 第十五批：第十四批 8 项问题的复核与落盘（2026-10-22）

### 已落盘的修复（3 项，均为真实缺陷）

| # | 落点 | 改动 |
| --- | --- | --- |
| 1 | `public/js/screens/stats.js:45-56` | `TABS` 上移到 `openStats` 之前；`openStats(tab)` 接收可选 tab，非 tab id（调用点 `onClick=${openStats}` 传入的 MouseEvent）回退 `overview`。调用点不改写法，`deferred-tests/fork-added/ui/mobile-fixes-20261011.test.js:20` 的断言仍成立 |
| 2 | `public/js/screens/stats.js:498`、`:510-512` | `inMatch` 守卫改为 `selectRoute(s) === 'game' && phase !== PHASE.RESULT`（import 补 `PHASE`），并加 `useEffect` 只在真正进入对局时关闭面板；RESULT 阶段豁免 —— 结算页的「对局记录」入口需要从那里打开面板并回看 |
| 3 | `public/js/ui/stats.js:479`、`:667-668` + `public/js/main.js`（`net.on('m.result')`） | `buildRecord` 的 `lastRound` 改为 `num(r.lastRound ?? ctx.lastRound)`，`main.js` 传入 `store.get().match.public?.lastRound ?? null`；`recordResult`/`buildRecord` 的 JSDoc 补 `lastRound` 说明 |

**项 3 的方案修正**：原计划给 `m.result` payload 补 `lastRound`（`server/match/results.js`），被 wire v1 契约否决 —— `shared/wireSchema.js` 第 14 号消息 `m.result` 的 key 列表是固定契约，`deferred-tests/fork-added/wire-codec.test.js:34-41` 用 sha256 指纹 `ea41ddd2…71de` 钉死，测试原文禁止编辑指纹、只能新增版本。服务端改动已回退，改为客户端 ctx 回退。

### 撤销的 5 项（不改代码）

| # | 判定 | 理由 |
| --- | --- | --- |
| 4 | 撤销 | 与主线逐字一致：lineup 从 board 取、被淘汰后 board 清空 → 结算渲染 10 张 NO INFO 卡是主线既有行为；且改动会波及 `test/golden/matches.json` 的 4 个含 `eliminatedRound` 场景（golden 口径已定为"恢复主线 seed 5 + 重新生成"） |
| 5 | 撤销 | medal 结构与主线逐字一致，领袖名只放在 `title`；无可见文本是主线设计 |
| 6 | 撤销 | 工具假象：真实 AT 不暴露 `display:none` 的内容（实测 `getComputedStyle(rotate-hint).display === "none"`），snapshot 把隐藏节点计入是内置浏览器快照的行为差异 |
| 7 | 撤销 | 设计行为：`extensions.js:76`「Browser-authoritative results are not a trusted operator meter」；`damageBoard.js:188` 已有空态文案 |
| 8 | 撤销 | 工具假象：`browser_press_key` 派发的事件 `isTrusted === false`，不触发 native activation；无 handler 阻止 Enter 默认动作 |

### 实机验证（重新构建镜像 + 重建容器后，内置浏览器走完整玩家流程）

大厅 → `SOLO 独立模拟` → AC-1（9 回合，战场#01）→ BRIEFING → 选择策略 `阿米娅`（初始生命值 25）→ 对局；不部署干员，逐回合泄漏扣血 25→20→12→2→0，`phase = RESULT`、`round = 4`、`lastRound = 9`、`reason = eliminated`。

- **修复 1**：房间页头部「统计数据」（`onClick=${openStats}` 传入事件对象）→ 面板打开并落在 `STATISTICS // OVERVIEW`，tab「总览」selected。
- **修复 2**：结算页「对局记录」→ 面板打开且不被自动关闭，tab「对局记录」selected。
- **修复 3**：新记录 `sp.pref.stats` 实测 `lastRound: 9`（`roundsPassed: 3`）→ 回看显示 `通过回合 3 / 9`；对照旧记录（`lastRound: null`，无法追溯）仍显示 `3 / 14` 默认分母。
- 控制台无应用自身 JS 错误（仅素材缺失类 warn；一条 `ReferenceError: type is not defined` 是探针脚本自身笔误）。

`npm test` 口径全量复跑两次：第一次 9012/618/8958 pass/5 fail/49 skipped，第二次 9019/618/8967 pass/3 fail/49 skipped —— 多出的 2 项（`test/lobby-loadout.test.js:147` rate-limit 超时、`test/match/fullmatch.test.js` 文件级 fail）为负载导致的偶发失败；稳定的 3 项为既有环境类 fail（`local-extract-operators.test.js:144`、`board3d-extract.test.js:192`、`:221`）。stats 相关测试全部通过。

---

## 第十七批：建议正式放弃项的测试清理（2026-10-26）

判据基准：快照提交 `8fcc319`（提交时工作区干净）。本轮范围 = `docs/FUSION-CREDITS.md`「建议正式放弃」10 项对应的测试，以及"被测主体已被本项目移除但测试残留"的死断言。

### 本轮删除（30 项）

| 组 | 数量 | 文件 |
| --- | --- | --- |
| 第一批根级（建议正式放弃 10 项） | 13 | admin、announce、announcement-assets-http、announcement-notices-live、announcements-http、asset-cache-admission、asset-cache-admission.browser、asset-cache-http、asset-cdn、asset-version、bot-policy、bot-population、cdn |
| 第二批根级 `ui/` | 2 | `ui/data-profile.test.js`、`ui/profile-plugins.test.js` |
| fork-added（六人合作） | 9 | `match/six-player`、`match/six-player-boss-hp`、`match/six-player-local`、`match/six-player-real`、`match/six-player-round-beacons`、`ui/six-player`、`ui/six-player-balance.e2e`、`ui/six-player-beacon`、`ui/six-player-layout.e2e` |
| fork-added（莱茵内容档对照契约） | 4 | `match/original-profile-host`、`match/runner-profile`、`plugins/profile-content-sets`、`ui/data-profile.browser` |
| fork-modified-tests | 1 | `test/local-token-models.test.js` |
| `test/` 本体 | 1 | `test/e2e/sixWarmupObserver.mjs` |

`fork-added/MANIFEST.txt` 按惯例保留行并追加 ` # 已删除：<原因>`，不删行；已标注行由 50 增至 **63**。

### 第十八批：卡兹戴尔整分支移除（2026-10-31）

卡兹戴尔（Kazdel）经核实为**玩家自创扩展、非官方设定**（上游 `upstream-v0.3.3` 无任何 kazdel 文件，仅 4 个 docs 文件含 9 处引用，属官方 canon 保留）。用户拍板：按与莱茵科研版相同口径整条移除（代码、界面、工具链、测试、美术登记一并删除），对应「建议正式放弃」判据中的「被测主体已被本项目移除」= 死测试。本轮删除 `fork-added/` 的 **14** 个测试（13 个 kazdel + `extension-potential.test.js`，其断言全部针对 `chess_kazdel_*`），MANIFEST 按用户指示**删行**（不再沿用保留行加标注的惯例），在档计数 471 → **457**。`content/rem.test.js` 保留，仅摘除 2 条 kazdel 断言（REM 线不动）。`fork-modified-tests/` 副本一律保留不动，其中 `test/ui/assetUrls.test.js` 仍 import 已删除的 `tools/assets/kazdel-plan.mjs`——归档测试不被 `npm test` 执行，按「路径断链不构成死测试判据」保留。

### 判据口径补充

- 路径型扫描（对照 `8fcc319` 的 1434 行删除清单）命中 0 → 残留只存在于**符号型引用**。
- 归档副本保留 `test/` 相对路径（如 `../helpers/wsClient.js`）是为"移回 `test/` 时可直接运行"，**路径断链不构成死测试判据**。
- `npm test` 只扫 `test/**/*.test.js`，不含 `deferred-tests/` → 归档测试无回归守护，本轮删除不会改变 `npm test` 结果。
- 两类必须区分：「特性从未并入主线」= 合法归档保留；「被测主体已被本项目移除」= 死测试，清理。

### 混合副本的处理（23 个）

- 副本差异全部为莱茵 → 整文件删；莱茵段与存活线（Kazdel/Rem）混在同一文件 → 只删莱茵断言段；fork 用莱茵内容**替换**了上游内容 → 回退为上游原文（含测试标题）；fork 计数含莱茵+Kazdel → 按剩余量改数字并只保留存活线。
- 存活线归属逐个核实：`机械水獭` = `token_10004_otter_motter`（莱茵麦尔水獭）→ 死；`龙腾.A/F/L` = `token_10005_mgllan_drone1/2/3`（莱茵麦哲伦）→ 死；`沙地兽` = `token_10034_ray_sndbst`（Rem 莱伊）→ 存活；`chess_kazdel_odd_a`/`chess_kazdel_wisdel_b` → Kazdel 存活线；`chess_rem_thumpy_a`/`chess_rem_asbest_a` → Rem 存活线；`char_416_zumama` 在 `diy.test.js` 中与上游逐字一致 → 上游官方内容，保留。

### 数字口径

已提交的 `data/` 与上游逐字节一致（`data/chess.json` 完全相同；`data/bonds.json` 仅 1 行差异；`8fcc319` 对 `data` 只有 `data/assets.json` 1 增 1 删）→ fork 的莱茵/Kazdel/Rem 数据层从未提交，靠 `tools/kazdel-data.mjs` 等生成器本机生成，因此凡依赖生成器的聚合计数在当前提交状态下均不可成立。

- 可从 fork 生成器常量推导 → 已改：items 123→119、EQUIP 60→58、bonds 26→25、isCore 11→10、garrisons 67→61、placeable token 名单 11→7。
- 不可推导 → 不编造数字，在文件内标注并在此登记，须重新生成数据后重算：`data.test.js` 的 chess 308 / visible 134 / perTier；`match/pool.test.js` 的 pool 134 / 132 / tierShares。

### 保留但标注（不删）

- `render/rem-movement.browser.test.js:17` 用 `git show v0.2.4-rhine.5:server/sim/content/rem.js`，本地只有 `refs/heads/main` 与 `refs/tags/v0.3.1`，该标签不存在 → 断链，保留文件。
- `tools/rem-asset-plan.test.js:20` 的 `REM_LOGO_URL` 指向 `Stronghold-Protocol-Rhine` 仓库的 `bond/rem.png`，与实现侧 `tools/assets/rem-plan.mjs:4` 逐字一致 → 属素材来源出处（provenance），非死断言。

### 归属判定（本轮核实后保留）

- `match/snapshot.test.js`、`match/snapshot-rate.test.js`：被测主体 `server/match/snapshot.js` 仍在（断点续玩）→ 合法归档，保留。
- `match/five-player.test.js`、`match/five-player-real.test.js`、`ui/five-player.test.js`：五人局在 `playerCapacity` ≥ 8 的房间内仍成立；fork 的 `assert.ok(ids.length <= MAX_SEATS)` 在当前 `shared/constants.js`（`MAX_SEATS = 4`）下失败 → 属"契约已漂移"的归档口径，保留。

### 待用户确认后才处理的实现侧

`server/geoip.js`（无 live 接线）、`scripts/announce.mjs` + `tools/announcements.mjs`（fork CLI）、`server/botPopulation.js`（被 `persist.js:36`、`matchRestore.js:14,111`、`roomAdmin.js:12,146` 接线，与 AGENTS.md「本仓库特色功能必须保留」冲突）。

### 计数复核（2026-10-26 实测）

- `deferred-tests/fork-added` = **476**（539 − 63）；`deferred-tests` 全目录 = **625**；`test/` = **861**。
- `deferred-tests` 各子目录 `.test.js`：fork-added 476、fork-modified-tests 101、incompatible-docs 2、ui 20、match 2、render 1、resources 2、根级 21。

## 第十九批：逐文件通过性判定的归档与文档改写（2026-11-04，用户拍板）

判定四分类口径：① 设计如此（归档）② 测试与最新代码事实不符（改测试）③ 代码缺陷（改实现）④ 环境限制/项目错配。

### 归档

| 文件 | 判定 | 依据 |
| --- | --- | --- |
| `test/shutdown-timeout.test.js` → `deferred-tests/shutdown-timeout.test.js` | ① 设计如此 | 上游 v0.3.3 文件（`main` 无）。它钉的是上游的 5 秒固定关闭窗口与可注入的 `shutdownHandler`；本仓库窗口为 `SP_SHUTDOWN_TIMEOUT_MS`（默认 60 s、边界 1–300 s），关闭逻辑内联在 `server/http/boot.js` `runMain`，无 `shutdownHandler` 导出，文件在 import 阶段即失败。按合并优先级（后端/部署以本仓库为准）保留实现，测试按现状不可成立，待按现状重写规格后移回 |

移动后计数：`test/` **1034**、`deferred-tests` 全目录 **605**（根级 22）。

### 文档措辞按现有实现改写

- `program/v0.3.1/AGENTS.md` 第 9 条：原写「默认 2000」「`SERVER_FULL` 后以 4003 主动关闭」「停止本页重连、刷新才重试」「升级阶段最多 256 条未认证连接」，均来自 xinhai-ai 分支且本仓库未实现。现按事实改写：在线容量来自 `server/onlineLimit.js` 限额文件（`SP_MAX_CONNECTIONS` 是并发连接数上限、默认 0 不限），hello 只拒绝新增身份、不主动关闭，前端按 `SERVER_FULL_RETRY_MS = 20_000`（±25% 抖动）自动重连。
- `docs/design/network.md` §35.89：原写「仅 `m.public`、私人流保持原有编码」，与 §8 及 `shared/stateDelta.js` `isStateKind`（`m.public` + `m.private`）不符。§8 为准，§35.89 已按 §8 改写。

### 本轮补充判定（2026-11-04，按代码事实修复）

**② 测试与最新代码事实不符（已改测试，逐文件复跑转绿）**

| 文件 | 原断言 | 代码事实 | 处理 |
| --- | --- | --- | --- |
| `test/match/external-llm-continuity.test.js` | 从 PREP 直接 `settle(null, null)` 后读 `feedbackFor().lastBattle` | `server/match/match/settle.js` 有相位守卫（仅 COMBAT / UNITE 执行），从 PREP 调用是空操作 | 按仓库既有写法（`test/match/touch-retained.test.js:35`）先置 `phase = PHASE.COMBAT`；11/11 转绿 |
| `test/match/feedback1-gaps.test.js` | `designText('match')` 的 §8.2 / §8.3 切片 | `test/helpers/designDocs.js` 对重复编号抛错；fork 独有历史章节 `docs/history/0.0.1.md` 自称 §35，与上游 §35（`docs/history/0.3.2.md`）冲突 | 只改编号不改内容：fork 章节改记 **§37**，同步 `docs/更新汇总-0.3.1.md` 与 `docs/development/DESIGN.md` 索引；12/12 转绿 |
| `test/ui/combat-metrics-mobile.test.js` | `.combat-metrics {` 后逐行匹配 | fork 的 `public/css/screens/game.css` 把该规则写成单行 | 改为块内匹配 `[^}]*`；转绿 |
| `test/ui/playtest3.test.js` | `max(.3rem, calc(16px * var(--sp-ui, 1)))`、`@keyframes btn-busy` 单行 | `test/helpers/uiSize.js` `unscaled()` 把 `calc(Npx * var(--sp-ui,1))` 还原为设计 px 并丢弃地板值 → 实际文本是 `max(.3rem, 16px)`；`@keyframes btn-busy` 在 fork 的 `components.css` 是多行 | 按 helper 的实际输出改写；转绿 |
| `test/ui/bond-timers.test.js` | `value=${s.bondTimers}` 必须早于 `value=${s.combatMetrics}` | 本 fork 不提供「作战统计」开关（`public/js/ui/settings.js` L2 记录该决定：PR #618 的开关已并入 `ui/damageBoard.js` 的 伤害 / 治疗）→ 断言引用不存在的代码（空悬） | 删除该条排序断言，保留 `ammoEnergyCount < bondTimers`；转绿 |

**② 文档按代码事实改写（只改「当前有效」层，历史层留作决策记录）**

- 分层口径（`docs/README.md`）：`docs/design/*` = 当前有效文档，须按代码事实；`docs/history/*` = 按版本的修订记录（历史决策留档，不改内容）；`docs/from-forks/*` = 上游 / 分支持有者的文档，不改。
- `docs/design/client.md` §Combat metrics：原写「设置 →「作战统计」」，本 fork 的设置面板没有该开关（`combatMetrics` 只能来自持久化值或测试）→ 按实现改写；原决策保留在 `docs/from-forks/YuriRestia/docs/design/client.md`。
- `docs/development/DESIGN.md` 索引补 §35 / §36 / §37 三行（原止于 §34）。

**④ 环境限制（不改实现、不改测试，登记）**

- 本机的符号链接 / junction 不可解析：`fs.symlinkSync(target, dest, 'junction')` 不报错，但 `readdirSync(dest)` 报 `ENOENT`。因此 `test/helpers/links.js` 建的夹具 `data` 链接读不到内容，`server/plugins/identity.js` `gameplayDataFiles()` 返回空 → `data.config.economy` 缺失 → `PLUGIN_RECORD_TYPE chess needs tier 1–6 and bonds`：`test/plugins/script-integration.test.js:84`、`test/studio/gameplay.test.js:85`。`test/plugins/install.test.js` 的 2 个 symlink 用例（「symlink id 不被跟随」「候选拒绝隐藏链接」）同样只在能建链的机器上成立。
- `data/assets.json` 是陈旧产物：本仓库提交版缺 `PREFAB_SPINE_ROLES` 的 role-fix 输出（上游提交版有 `skills`），`tools/fetch-assets.mjs --offline` 因 225 项素材缺失拒绝重写 → `test/render/enemy-strike-clip.test.js`（5 项）、`test/render/enemy-turn-clip.test.js`（1 项）按当前 manifest 不可成立，须重新生成数据后复跑。
- 全量并发下的时序抖动（单文件复跑转绿，不改代码）：`test/studio/trial.test.js:37`、`test/studio/gameplay-templates.test.js:82`、`test/studio/gameplay-review.test.js:161`、`test/studio/review.test.js:178`、`test/studio/presentationRework.test.js:87`、`test/studio/presentationThirdReview.test.js:115`、`test/plugins/script-review.test.js:113`、`test/match/external-transports.test.js:113`。

**本轮全量复跑（`node tools/test-run.mjs`，`SP_E2E=0`）：8250 用例 / 8208 pass / 42 fail / 25 skipped（上一轮 8176 / 49）。42 项全部为 ④，无 ③ 遗留：**

- ④ 符号链接不可用 11 项：`test/assets/asset-index.test.js:48`、`test/tools/package-llm-gate.test.js:88`（EPERM）、`test/tools/windows-bundle.test.js:52`、`test/plugins/forgeImport.test.js:369`、`test/plugins/install.test.js:193`、`test/plugins/script-integration.test.js:84`、`test/studio/gameplay.test.js:85`、`test/studio/presentationRework.test.js:140`、`test/studio/remove.test.js:98` / `175`、`test/studio/studio.test.js:445`。
- ④ 素材缺失 / `data/assets.json` 陈旧 23 项：`test/assets/assets.test.js:152` / `767` / `849`、`test/assets/audio-pools-data.test.js:37`、`test/content/boss-quintus-attack-slot.test.js:260`、`test/content/enemy-skill-clips.test.js:50` / `68`、`test/content/feedback1d-models.test.js:110` / `131` / `138` / `246`、`test/content/local-token-models.test.js:110` / `160`、`test/render/enemy-strike-clip.test.js`（5）、`test/render/enemy-turn-clip.test.js`（1）、`test/ui/version-icon-lookups.test.js:18`、`test/version-assets.test.js:15` / `21` / `36`。
- ④ 全量并发时序抖动 8 项（隔离复跑全绿）：见上。

另有一处代码注释的空悬文档引用（不参与测试）：`server/http/portalRoom.js:27` 原写「§37.4」，实际全链路预算记在 `docs/design/portal-agent-wss.md` §115.4，已按代码事实改为 §115.4。

