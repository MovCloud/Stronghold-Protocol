# 融合来源与鸣谢登记（FUSION-CREDITS）

更新：2026-10-26。基线：上游 [sganggs/Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol) v0.3.1
（`b3deebd`）+ 15 个下游 fork。本地仓库：单分支 `main`、单标签 `v0.3.1`、HEAD `8fcc319`（2026-10-26 固定快照）、**未配置 git 远端**；本轮整理在暂存区推进，尚未提交。

本表回答两个问题：这些 fork 的功能现在还在不在代码里；以及 `deferred-tests/` 里被搁置的内容该恢复还是正式放弃。
判定依据是**运行时接线**（协议、大厅、路由、UI 入口），不是常量或文档残留。

## 一、上游与本作

- 游戏本体、规则、服务端、客户端：sganggs/Stronghold-Protocol（GPL-3.0-or-later）。
- 游戏数据：Kengxxiao/ArknightsGameData。
- 素材：yuanyan3060/ArknightsGameResource、fexli/ArknightsResource、isHarryh/Ark-Models、ArknightsAssets/ArknightsAssets2。
- 字体：TimWangZi/The-font-of-Arknights、Google Fonts（Noto Sans SC）。规则核对：PRTS 明日方舟中文 Wiki。
- 库：PixiJS、pixi-spine、three.js、Preact/htm、ws。
- 游戏素材权利归 Hypergryph / Yostar，仅限非商业使用（NOTICE.md）。

## 二、下游 fork 登记

| # | Fork / 分支 | 招牌功能 | 当前状态 | 关键证据 | 缺口 |
|---|---|---|---|---|---|
| 1 | Stardust-minus/master | 部署反馈板 / 状态页 / 素材签名 CDN | 部分 | `server/index.js` 挂载 `mountFeedbackBoard`；`data/site.json` 的 `feedbackBoard` | 反馈板按模块内嵌，**不从本体拆分**；状态页**正式不采纳**（贡献仍追溯）；素材签名 CDN 走 `SP_ASSETS_CDN` |
| 2 | Misyra/master | 皮肤系统 + 规则维护线 | 部分 | 内置目录 `shared/skin-catalogue.js`（276 款 / 174 干员）、`public/js/ui/skinPicker.js`、`skinsModel.js`；`docs/SKINS.md` | 内置皮肤选择/显示已接线；`skinFor()` 只认目录内 ID，**二创/联动皮肤当前不显示**；**插件时装 overlay（`room.skins { skins }`）未接线**（仅剩 Studio/Forge 导入工具）；旧 skin 工具契约测试仍在 `deferred-tests/` |
| 3 | LongQianChen/perf/compact-wire-bandwidth | 紧凑协议带宽优化 | 已接入 | `shared/wireCodec.js` | 默认开关与线上收益待测 |
| 4 | xinhai-ai/master | R2/CDN + 持久化性能 + 在线准入 | 部分 | `server/resources.js` 使用 `SP_ASSETS_CDN` | 无 `SP_MAX_ONLINE`、无 R2/COS 专属实现 |
| 5 | YinqiMargatroid/master | 六人合作模式 | **正式移出**（并入 20 人容量体系） | `shared/playerCapacity.js` 的 `poolGroupSizes(6)=[3,3]`；`server/match/beaconSupply.js`、`choices.js` 的 `>=5` 规则保留并通用 | 6 人不再单列档位：玩家开 **8 人房、6 人开局**即可（`validCapacity()` 允许空座，`startMatch` 走 `seats.filter(Boolean)`），自动触发 3+3 分组池与信标规则；`ROOM_CAPACITIES` 仍为 `[4,8,12,16,20]`。信标只在第 10 回合发放（`FIXED_BEACON_ROUNDS = new Set([10])`），12/14 回合已失效；纯六人 overlay 文档 `docs/MULTIPLAYER.md`、`docs/LOCAL-SIX-PLAYER.md` 已删除，`docs/design/match.md`、`docs/design/overview.md`、`docs/development/BALANCE.md` 按代码事实改写。代码侧仍有 `sixPlayerBeacon` 命名与 R14 死分支（`views.js:47`、`builtinMeta.js:202` 判 `sixPlayerBeaconRound === 14`，永不触发）及 4 条孤儿 i18n 条目，待确认后才处理 |
| 6 | YUYUYUYUYUYUYUTOUA/codex/rhine-upstream-021 | 莱茵科研版 | **正式移出**（下游同人扩展） | 原 `docs/RHINE.md` 自述“独立同人扩展”（文档已随分支删除）；核验时 `data/` 与 `data/vanilla/` 一致（266/266 干员，`bonds.json` 无 `rhineShip`，莱茵专属干员未入池） | 已删除莱茵专用模块、科研装置/界面、工具链、测试与启动器；官方「莱茵生命」干员/天赋仍保留。不再作为可选支线包 |
| 7 | Paper-Yuan/0.2.6 | 开服流量优化 + 安卓客户端 | 部分 | 缓存/CDN 相关代码 | 安卓客户端整条线已按根项目为准移除（见第 12 行） |
| 8 | kanomahoro1224/merge/pr-643-ui | 头像 P2P + 全新 UI | 部分 | `public/js/ui/peerAvatars.js` | 活动版大厅 UI 未融合，当前仍是 0.3.1 旧大厅 |
| 9 | ccyl/fusion-20p | 作战统计面板 + 安卓交付 | 已接入 | `public/js/ui/stats.js` | 安卓交付物不在仓库 |
| 10 | Gyeongdeock-Seo/master | 韩语本地化 | 已接入 | `public/i18n/ko.json` | — |
| 11 | YuriRestia/dev-0.2 | 英文翻译 | 已接入 | `public/i18n/en.json`、`FORK-CHANGELOG.md` | — |
| 12 | jingjiangze/rel2025 | APK / 热更新线 | **已整条移除** | 登记曾写“仅文档”，实际是完整运行时（`android/`、`tools/apk/`、`capacitor.config.ts`、`apk*.yml`、`hotupdate.yml`） | 上游无该线 → 按根项目为准整条移除：1,201 个跟踪文件（`android/` 939、`tools/apk/` 251、6 个 workflow、`docs/ANDROID.md`、`docs/APK.md`、7 个 `scripts/*android*`、1 个归档测试） |
| 13 | Rosmontis220/master | 安卓/桌面 + 联机增强 | 部分 | `server/playerAdmin.js`（旧 `/api/admin/*` 已被其 session+CSRF 方案取代） | 安卓/桌面交付物不在仓库 |
| 14 | NekoTC/master | COS / 离线模式 | **正式移出** | `docs/COS_DEPLOYMENT.md`：离线模式 = COS + Service Worker 预缓存，服务器离线时已缓存用户可进单人 | 整分支不再维护；本轮已删除 COS 上传/调试工具与配置，`public/sw.js`、`asset-cache-sw.js` 等通用缓存保留；COS 文档留作追溯 |
| 15 | T1113047/master | 狩猎模拟（**2V2 对抗 + 同盟狩猎**两个玩法） | 仅残留（待恢复） | `shared/constants.js` 的 versus/COOP_HUNT 常量、`server/match/match/confront.js`、`event.js` | `room.create` 只接受 solo/coop；`phases.js` 无 EVENT/CONFRONT；`COOP_HUNT` 无引用；`generateVersusDrafts` 缺失 → **两者均不可玩**，已列入恢复待办 |

> `docs/from-forks/` 只归档“文档冲突时被主线覆盖”的下游文档，**不代表该 fork 的代码未融合**。

## 三、搁置内容（`deferred-tests/`，473 个 fork 测试）

`deferred-tests/` 的测试**不在 `npm test` 范围**（glob 只扫 `test/**/*.test.js`），所以其中的特性目前没有回归守护。

> 2026-10-26：本节「建议正式放弃」项的归档测试已删除，共 30 个文件（`fork-added` 在档 489 → 476）。逐行原因标注在 `deferred-tests/fork-added/MANIFEST.txt`，分组清单与判据见 `deferred-tests/README.md` 第十七批。同日盟约预选的 3 个测试接回 `test/`（`fork-added` 476 → 473，`test/` 861 → 864），接回记录见 `deferred-tests/README.md` 第四批。

**建议恢复（小到中）**

- `boot-choice.test.js`（启动页**资源获取方式**二选一：预下载全部 / 跳过边玩边下载；依赖 Service Worker，本裸 IP/HTTP 部署不可用）。
- `bond-plan.test.js`（**盟约预选**：8 个阵营核心盟约的建设计划，纯展示、无规则效果）——**功能已完整接入正式版本**（`g.bondPlan` → `intents.js planBond` → `ui/bondPlan.js`/`bondStrip.js`/`teamPanel.js`，入口在选秀顺序列表下方「预选盟约」，窗口 `INFO_CHECK` 至第 1 回合首战）。2026-10-26 已把可运行的三个测试接回 `test/` 并实测通过（`test/match/bond-plan.test.js` 10/10、`test/ui/bond-plan-ui.test.js` 3/3、`test/cluster-bond-plan.test.js` 1/1）。根级 `deferred-tests/bond-plan.test.js` 保持归档：它测的是 fork 的 lobby 层（`room.bondPlan`、`lobby.bondPlan`、`humanSeat` 的 `bondPlan`、`PlayerState.setBondPlan`），现有代码只有 `g.bondPlan` 协议与 `PlayerState.bondPlan` 字段，lobby 层无对应实现。另发现 `server/match/match/platform.js:144` 的 `setBondPlan()` 无 live 调用者、且内部调用 `PlayerState` 上不存在的方法（真被调用会抛错）→ 死代码，待确认后才处理。
- `skins-portrait*.test.js`、`skins-diy.test.js`（头像/立绘工具契约）——皮肤系统已在主线，补齐导出即可。
- `ui/peer-avatars.test.js`（`RTC_LIMITS`）——`peerAvatars.js` 已在主线，补常量导出。

> 六人档**不再恢复**：已确认以 20 人房间为准，6 人开 8 人房、6 人开局；`poolGroupSizes(6)=[3,3]` 与 `>=5` 规则已通用，无需新增 6 档白名单。对应归档测试与 `test/e2e/sixWarmupObserver.mjs` 已于 2026-10-26 删除。纯六人 overlay 文档 `docs/MULTIPLAYER.md`、`docs/LOCAL-SIX-PLAYER.md` 已删除；存活的 ≥5 规则文档按代码事实改写（信标仅第 10 回合）。

**建议恢复（大，需专项）**

- T1113047 的 2V2 + 同盟狩猎：需按上游 v0.3.2/v0.3.3 重接 `room.create`、大厅/UI、队伍分池、`generateVersusDrafts`、EVENT/CONFRONT 阶段；现有测试可作规格参考。**顺序约束：先做 rebase/上游合并，再恢复狩猎。**

**建议正式放弃**

- 六人独立档位（已确认以 20 人房为准，8 人房 6 人开局）。
- 离线模式 / COS 部署线（NekoTC，整分支移出；裸 IP/HTTP 无 Service Worker）。
- 文字聊天整分支（`room.chat` / `SP_CHAT_ENABLED` / 审核链）——非备案服务器不适合、备案后也擦边；**表情包是独立链路，移除时不得触碰**。
- 莱茵科研版（YUYUYUYUYUYUYUTOUA，下游同人扩展）——2026-10-26 决定整分支移出：代码、科研装置/界面、工具链、测试一并删除；官方「莱茵生命」干员与天赋保留。
- 旧版 `/api/admin/*` + Bearer（已被 playerAdmin 取代）。
- fork `/_v/` 版本化 CDN（`parseAssetCdn`/`rewriteAssetPaths` 未采纳）。
- 资源准入六路由 / strict 模式（用户已拍板不并入；由资源包管理器取代）。
- `chatLog` 类契约（主线是 `createChatLog()` 工厂）。
- fork 公告 CLI / HTTP 写链（主线是 admin 写入）。
- bot population / bot policy（上游 v0.3.2 已有机器人排练池与版本隔离，冲突面更大）。

上述各项的归档测试已于 2026-10-26 全部删除（30 个文件）。其中实现侧仍有代码存活的三项**未删**、待确认：`server/geoip.js`（无 live 接线）、`scripts/announce.mjs` + `tools/announcements.mjs`（fork CLI）、`server/botPopulation.js`（被 `persist.js`、`matchRestore.js`、`roomAdmin.js` 接线，与 AGENTS.md「本仓库特色功能必须保留」冲突）。

「无 live 接线」指：模块文件仍在仓库里、有导出、有测试，但**没有任何运行时路径真正调用它**。`server/geoip.js` 的三个导出（`parseGeoipMode`、`countryLookupFromReader`、`openCountryLookup`）全仓唯一消费者是归档测试 `deferred-tests/fork-added/geoip.test.js`；`countryLookup` 只是可注入参数（`server/foreignSessions.js`、`server/botPopulation.js`、`server/roomAdmin.js` 读 `lobby.botPopulation.countryLookup`），而 `ForeignSessions` 在 server 代码中从未实例化、`BotPopulation` 只在归档测试里被实例化（`tools/healthbench.mjs` 是 stub）；全仓没有任何代码读取 `SP_GEOLITE_COUNTRY_DB` / `SP_GEOIP_MODE` / `geoLiteCountryFile` / `geoipMode`，归档测试还调用 `startServer({ geoipMode, geoLiteCountryFile })` 这类不存在的选项。文档却按「已配置」描述（`docs/operations/ROOM_PROTECTION.md`、`docs/development/CUSTOM_API.md`、`docs/development/FORK_MAINTENANCE.md`）→ 代码与文档不一致。`deploy/stardust/geo/*` 是另一条独立的 nginx 大陆白名单线，与 `server/geoip.js` 无关。

**已决定移出（不再重估）**

- `chat-moderation-lifecycle.test.js`：文字聊天**正式移出**（非备案服务器不适合、备案后也擦边），后续移除整个 chat 分支；表情包是独立链路（`g.emote` → `m.emote`，与 `room.chat`/`SP_CHAT_ENABLED` 无关），移除 chat 时不得触碰表情页与插件表情。

**待重估**

- 六人档相关归档测试（`six-player-local.test.js` 等）随六人档移出一并归档，不再恢复；2026-10-26 已随本轮删除，不再列待重估。
- `ui/fork-redesign.test.js`、`ui/protocol-page.test.js`、`ui/room-management.test.js`：契约对应的组件已被主线 UI 取代；等上游 v0.3.2 活动版 UI 合并后更无恢复价值。

## 四、维护约定

1. 新增一个融合来源时，在本表登记 owner、功能、运行时证据、测试位置。
2. 特性一旦落地，测试必须从 `deferred-tests/` 移回 `test/`，否则 `npm test` 不会守护（投票移出就是现成例子：实现已上线，测试却还躺在归档里）。
3. 只有文档归档、没有代码接线的 fork，在表里必须写“仅文档/仅残留”，避免下一轮误判。

## 五、待办（BACKLOG，2026-10-26）

| 阶段 | 事项 | 现状 | 下一步 |
|---|---|---|---|
| **一、移除最先** | 文字聊天整分支移除 | **已移除**：服务端/UI/审核链已删，emote 与插件表情独立保留 | 跑表情发送回归 |
| **一、移除最先** | 离线模式 / COS 分支移除 | **已移除接线**：COS 上传/调试工具与配置已删；`public/sw.js`、`asset-cache-sw.js` 等通用缓存保留 | `docs/COS_DEPLOYMENT.md` 留作追溯 |
| **一、移除最先** | 热更新 / 安卓交付线 | **已整条移除**（按根项目为准，上游无该线）：`android/`、`tools/apk/`、`capacitor.config.ts`、6 个 workflow、`docs/ANDROID.md`、`docs/APK.md`、7 个 `scripts/*android*`、`deferred-tests/android-blackscreen.test.js` | 移动端适配（`--sp-ui-unit`、`utility-mobile.css`、Android UA 测试）与 npm 可选平台绑定保留，不属该交付线 |
| **一、移除最先** | 莱茵科研版整分支移除 | **已移除**：专用代码、科研装置/界面、工具链、测试与美术登记已删；官方「莱茵生命」干员/天赋保留。2026-10-31 补删残留：`data/` 逐值比对与上游完全一致（属官方 canon，不删），自创部分仅 `public/i18n/*` 的 4×18 key（4 语言包同步删除，保留有 live 引用的「莱茵生命」阵营名与官方装置/盟约 key）与 `data/assets.json` 的 3 个空 token 条目（hash 重算 `ddfe5d9c31fe`），另清理 3 处来源注释 | 跑 `npm test` 与 rem 构建回归 |
| **二、已有修复** | 投票移出测试回归（P0） | 实现已上线 | **已完成**：2 个测试于 2026-10-31 `git mv` 回 `test/match/`、`test/ui/` 并纳入 `npm test`，实测 8 passed / 0 failed（`test/` 864 → 866，归档 473 → 471） |
| **二、已有修复** | 盟约预选测试回归 | 功能已完整接入（`g.bondPlan` → `intents.js planBond` → `ui/bondPlan.js`）；入口在选秀列表下方，与左侧边栏展开**无布局冲突**（`.draft-order__rows` 独立滚动、按钮 `flex:none` 在底部） | **已完成**：3 个测试接回 `test/`，14 passed / 0 failed（2026-10-26 实测） |
| **二、已有修复** | 莱茵移出回归 | 代码/工具/测试与 i18n 自创 key 已删除；rem 共用的 `compileChess`、i18n 刷新已迁至中性文件 | 跑 `npm test`，确认官方「莱茵生命」干员与 rem 构建不受影响 |
| **二、已有修复** | 皮肤资源包架构 | 内置 276 款可用；插件 overlay 未接线；二创/联动皮肤因 `skinFor()` 只认目录 ID 而不显示 | 按推荐：资源包按需懒加载 + 缺包回退默认 + 本地导入；不自动抓取，不改战斗渲染契约 |
| **三、最后 rebase** | 上游 v0.3.2 / v0.3.3 合并专项 | 本地仓库与上游**无共同祖先**（`git merge-base main upstream-v0.3.3` 失败），不能直接 merge。实际图形：上游线 2232 个提交（标签 `v0.1.0`–`v0.3.3`，其中 `v0.3.1` 指向本仓库的聚合基线）；本仓库线 = `bc32d383`「v0.3.1 aggregated baseline」孤儿快照 + 10 个提交（15 个 fork 的贡献在基线快照处已压平，无逐提交历史可重放） | **统一做**：独立分支/worktree，以 v0.3.3 为基线；先产出冲突清单，再逐组移植。交付形态见「六、Git 交付与接轨方案」 |
| **三、最后 rebase** | 2V2 + 同盟狩猎恢复（T1113047） | 只有常量与废模块，两个玩法都不可玩 | **在 rebase 之后**，以归档测试为规格，按 v0.3.3 重接 `room.create`、大厅/UI、队伍分池、EVENT/CONFRONT |
| **三、最后 rebase** | 拉特兰支线收归 | 决定先不收归；等上游新版本正式上线后应有更新 | **rebase 后**再评估从上游取回，作为可选支线包，不删主线数据 |
| **三、最后 rebase** | 内容包 / 赛季化 / 狂野模式落地 | 底座已有：`roomSets.js` + `contentSets.js`（`maxSets` 默认 4、依赖/冲突）；上游 `SP_VERSIONS` 是版本切换底座。**狂野模式定位为版本包**：与主线可选版本并列，可选版本是单个版本包，狂野是所有模式合并的形式 | rebase 后确定主线包 + 可选版本包 + 狂野版本的组合规则；需解决核心盟约数量膨胀、BAN 配额、多版本同名干员并集与阈值缩放（见下） |
| — | 六人档 | **已移出**：以 20 人房为准，6 人开 8 人房 6 人开局 | 不新增 6 档白名单；保留 `poolGroupSizes(6)=[3,3]` 与 `>=5` 通用规则；overlay 文档已删除，存活规则按代码事实改写 |
| **一、移除最先** | 卡兹戴尔（Kazdel）内容 | 上游 `upstream-v0.3.3` **完全没有** kazdel 文件（按路径共 45 个跟踪文件全为 fork 新增：`shared/kazdel.js`、`server/sim/content/kazdel*`、`public/js/ui/kazdelHud.js`、`public/art/kazdel/`、`tools/*kazdel*`），`data/bonds.json` 无 `kazdelShip`（官方盟约 20 个中不含该 ID），`docs/KAZDEL.md` L3 自述「不是《明日方舟》官方卫戍协议内容」→ 属 fork 自创玩法而非官方设定 | **已执行（2026-10-31 拍板，与莱茵科研版同口径）**：整条移除——代码、界面、工具链、测试与美术登记一并删除。逐文件判定：**47 个整文件删除**（根启动脚本 3、工具链 5、代码 9、界面/资源 12、文档 4、归档测试 14）+ **43 个混合文件逐段摘除**（含 `data/assets.json` 6 条目、4 语言包、`nativeIdentity.js` 的 `kazdelSoul` 判定、`shared/plugins/validate.js` 的 PRESET_SHARED_TOKENS 条目、`test/ui/text-scale.test.js` 的 `NOT_SCALED` 正则、`test/render/fxpop.test.js` 的非方形比例测试）；保留 canon（`serviceTelemetry.js` 的「卡兹戴尔→巴别塔」官方阵营命名映射、`docs/PLUGINS.md`、`docs/PLUGIN-GUIDE.md`、`docs/history/0.3.1.md`/`0.3.2.md`、REM 线全部、`fork-modified-tests/` 11 副本）。14 个归档测试随分支移除（在档 471 → **457**），`test/` 内仅剩官方 canon（维什戴尔「魂灵之影」「凋敝魂灵」） |
| — | 代码与文档不一致项（本轮核实，未擅自改动） | `server/geoip.js` 无 live 接线但文档按已配置描述；`docs/PLAYER_CAPACITY.md` 写 4/8/**10**/16/20 与代码 `[4,8,12,16,20]` 冲突；`platform.js:144` `setBondPlan` 死代码；`views.js:47`/`builtinMeta.js:202` 的 R14 死分支；4 条孤儿 i18n 条目；`tools/assets/rem-plan.mjs:4` 的 `REM_LOGO_URL` 仍指向莱茵 fork 仓库（REM = 雷姆必拓，改动会破坏资产抓取，建议仅标记）；`public/js/cdnSpine.js` 全仓库无 live 调用者（仅 `docs/development/FORK_MAINTENANCE.md` L16 提及），属 fork 自创的按文件 CDN atlas 适配器，无测试覆盖 | 逐项待用户拍板后再处理（`shared/openingBans.js:30`、`server/match/pool.js:26`、`server/sim/simdata.js:585` 的莱茵来源注释已于 2026-10-31 改为中性表述） |

**狂野模式设计边界（认可，作为特色点；落地时需定）**

1. **同名干员只保留一份记录**，多版本内容以“盟约/特质字段并集”合并，不复制多张卡；否则卡池、商店概率与 20 人分组池会被重复项污染。
2. **核心盟约数量会膨胀**（每版本 8 个），开局 BAN 与选秀权重必须单独配额度：按版本分段抽取、或限制每人可见核心盟约数，否则轮换 BAN 失去意义。
3. **阈值会更容易达成**：盟约按在场成员计数，跨版本并集后同一批干员可能同时满足多个盟约 → 狂野模式需要阈值缩放或分层上限，避免单一套路碾压。
4. **依赖与冲突**：沿用 `PLUGIN_CONFLICT` / `resolvePluginOrder`，狂野模式=全部内容包的有序并集；冲突包必须显式拒绝而不是静默覆盖。

已定决策：反馈板内嵌本体、不拆分；状态页不采纳但追溯贡献；离线模式整分支移出（文档留追溯）；文字聊天整分支移出（保留 emote）；六人档移出（20 人房为准）；素材签名 CDN 随 `SP_ASSETS_CDN` 保留；**莱茵为下游同人扩展，整分支移出，官方「莱茵生命」内容保留**；拉特兰支线暂不收归、rebase 后再议；盟约预选采纳；皮肤走资源包按需加载；内容包拆分认可；**狂野模式定位为版本包，与主线可选版本并列，可选版本为单个版本包，狂野是所有模式合并的形式**；热更新/安卓交付线按根项目为准整条移除（上游无该线，移动端适配保留）；薄壳桌面启动器（`启动器/`，fork 新增）整份移除——本项目以服务器部署为主，不保留客户端外壳；该线的客户端自检半（`tools/update.mjs`、`tools/make-update.mjs`、`server/updateSet.js`、`server/http/update.js`、`docs/UPDATE.md`、`docs/LAUNCHER-COMPAT.md`）同为 fork 新增、上游无对应实现，一并移除，上游的更新包机制（`server/update.js`、`tools/package-update.mjs` 及其测试）保留。

## 六、Git 交付与接轨方案（2026-10-31 分析，待拍板）

**图形事实**（`git merge-base main upstream-v0.3.3` 失败 → 无共同祖先）：

- 上游线：2232 个提交，标签 `v0.1.0`–`v0.3.3` 全在这条线上（`v0.3.1` 例外，指向本仓库的聚合基线）。
- 本仓库线：`bc32d383`「v0.3.1 aggregated baseline」是**孤儿快照**（15 个 fork 的贡献在这一处已压平）+ 10 个提交；`6657c5a0` 是这条线上的**单亲提交**（父为 `7447e8fc`），subject 写「merge:」但**不是真 merge**。
- 无 remote；`upstream-v0.3.3` 是本地分支；当前处于 detached HEAD。

**三方案对比**

| 方案 | 做法 | 结论 |
|---|---|---|
| **A 账本 + 交付快照**（推荐） | 本地仓库只做审计账本（逐文件判定、冲突原文、决策依据），不作为交付历史；本轮完成后从上游 v0.3.3 重新 fork，把最终树按三阶段落成 3 个可独立验证的提交 | 与「重新拉 fork 再接轨」的计划一致：新 fork 与上游有**真共同祖先**，未来上游更新可正常 merge/compare/PR。判定是跨提交的**文件级/段落级**（如 `nativeIdentity.js` 一行、`validate.js` 一个 token 条目），本就无法映射到某个上游提交，快照提交正是它的真实形态 |
| **B `--allow-unrelated-histories`** | 造一个双亲 merge 把两条历史接起来 | 语义错误：这个 merge 的两个父不代表两条真实开发线，人工判定全部归到 merge 节点，blame/bisect 责任失真；GitHub 上无共同祖先 → compare 显示全文件增删，无意义。且该伪造节点会留在交付历史里，成为此后每次上游 merge 的祖先。**只可用于账本仓库内部单图浏览，不可用于交付** |
| **C 逐提交 rebase / cherry-pick** | 把 fork 侧提交逐条重放到 v0.3.3 上 | blame 粒度最准，但本仓库线只有 10 个提交、15 个 fork 的贡献已在 `bc32d383` 压平 → **没有可重放的逐提交历史**；且重放会让已判定整条移除的内容（莱茵、卡兹戴尔、文字聊天、安卓、六人档）先出现再删除，与「移除最先 → 已有修复 → 最后 rebase」的顺序直接冲突；中间提交无法通过测试（测试基线是 rebase 后的 1033） |

**A 的落地细节**

1. 账本仓库保留、不推送。给当前工作建分支（如 `fusion/resolve-v0.3.3`）使 `6657c5a0` 可达，本轮改动提交在该分支上；遵循「历史记录不重写」，不改写 `6657c5a0` 的 subject，口径差异在新提交或本节说明。
2. 交付仓库从上游 v0.3.3 新建 fork，落成 3 个提交：① 移除（聊天/COS/安卓/莱茵/卡兹戴尔/启动器/六人档）② 已有修复（测试接回、断链、UI 口径）③ rebase 结果（逐文件判定并入）。每个提交独立跑对应测试可验证。取树用 `git checkout --from` / `git read-tree`，不靠复制粘贴。
3. 贡献归属用 commit trailer（`Credits:` / `Co-authored-by:`）+ 本表登记，**不伪造 merge**。
4. 标签不随账本仓库带走：`v0.1.0`–`v0.3.3` 属上游线，新 fork 自然继承。
5. 若确需保留 fork 贡献的 blame：只对「本仓库特色功能必须保留」的少数线做精选 cherry-pick（网络/`wireCodec`、投票移出、离线席位、`playerCapacity`），作为 A 的增强而非替代。
