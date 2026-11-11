# 内容管理（后台）与狂野模式配置 — 设计稿

状态：设计已定；P1（文档 schema + 读写接口）、P2（合成器 + 保存即校验）与面板（P4，含 §9 皮肤管理）已落地，
注册表条目（P3）未实现（2026-11-11）。
关联：[FUSION-CREDITS.md](FUSION-CREDITS.md) 的「狂野模式策划案」、《DESIGN §35.23 官方版本》、
`shared/versions.js`、`server/versions.js`、`server/data.js`、`server/playerAdmin.js`。

---

## 1. 定位

后台的「内容管理」是**构建期的编辑器**，不是运行期的规则引擎：

```
后台保存 → 写 runtime/*.json → 提示「已保存，重启后生效」
重启    → 读 runtime 覆盖 → 合成 data/versions/wild/ → 照常算 cs、起 host
```

因此不存在「运行时切换版本 / 热替换狂野数据」：版本禁用后不再下发、不再起 host、大厅不再出现；
狂野的选择结果在下次启动时合成成一份普通版本数据，之后与其它版本走完全相同的链路。

这样做的理由：

- 任何数据变化都会改 `cs` 哈希；运行期热切换会让进行中的房间、已加载页面与新数据对不上。
- 合并逻辑留在构建/启动路径，`host` 进程只读成品，golden 可复现。
- 实现量最小：不需要可变 holder、host 池热重建、静态白名单动态更新。

---

## 2. 落盘位置

**不进 `data/`**（`data/*.json` 是生成物，禁止手改）。配置放仓库根的 `runtime/`，随部署卷持久化。

### 2.1 `runtime/versions.json`

```json
{
  "schemaVersion": 1,
  "revision": 3,
  "lastFingerprint": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "enabled": ["act2autochess", "act2autochess@V2_1", "act1autochess", "act1autochess@V1_1"]
}
```

- 缺文件 = 默认全部启用，与现在「不设 `SP_VERSIONS`」完全等价。
- `enabled` 的取值是 `shared/versions.js` 的注册表 id；写入前按注册表过滤未知 id。
- 启用的版本必须包含 `SP_VERSION_DEFAULT`（默认版本不能关）。
- 只在启动时读一次（`server/index.js` 的 `contentAdminOptions`），所以面板写完后要重启才生效；文件无效时记一条 warn 并回落到默认，不拒绝启动。
- `SP_VERSIONS` 优先于本文件：环境变量存在时面板的启用卡片只读。
- `lastFingerprint` 沿用 `server/roomConfig.js` 的 `payloadFingerprint`，GET 视图不返回它。

### 2.2 `runtime/wild.json`

只存**覆盖**，默认状态一律 `auto`，所以文件随赛季增长基本不变，新赛季不需要改文件。

```json
{
  "schemaVersion": 1,
  "revision": 12,
  "lastFingerprint": "0f1a…",
  "sources": ["act2autochess", "act2autochess@V2_1", "act1autochess", "act1autochess@V1_1"],
  "picks": {
    "bonds": { "bond_xxx": "act1autochess", "bond_yyy": "off" },
    "bands": { "band_zzz": "auto" },
    "items": { "item_base": "act2autochess@V2_1" }
  },
  "operators": { "char_1013_chen2": { "off": ["act1autochess@V1_1:bond_aaa"] } }
}
```

- `sources` 按注册表顺序（最新在前），`auto` 取第一个提供该行的来源，也就是最新的那个。
- `picks` 按表分组，行身份是 `(类型, id)`；只存被改过的行。
- `pick` 三态：`"auto"`（默认，取最新）| `"off"`（不收录）| 版本 id（钉住）。钉住的版本必须是 `sources` 之一且确实提供该行。
- `operators[*].off`：稀疏记录被取消的「版本 × 盟约」格子；不在表里 = 全部勾选。
- 写盘沿用 `server/roomConfig.js` 的 `revision` + CAS + 原子写范式（并发修改时拒绝对不上 revision 的请求），`lastFingerprint` 提供重放保护。

---

## 3. 版本管理卡片

一行一个注册表版本：`label`、`id`、`dir`、数据是否存在、启用开关。

- 默认全部启用。
- 关闭 = 重启后：静态 `/data/versions/<dir>/**` 404、不为其起 match host、大厅版本 chip 不出现。
- 当前部署若用 `SP_VERSIONS` 收窄过，则以环境变量为准，后台只读展示（避免两处配置打架），并在卡片上标注来源。

---

## 4. 狂野模式卡片

### 4.1 四张表

| 表 | 行身份 | 展开内容 | 可编辑项 |
| --- | --- | --- | --- |
| 盟约 | `bondId` | 各版本的名称 / 描述 / 层数 | 每个出现该 id 的版本一个单选项 |
| 策略 | `bandId` | 各版本的名称 / 描述 / 等级 | 每个出现该 id 的版本一个单选项 |
| 装备 | **装备组**（基础件 + `goldenId` 进阶） | 两态的图标 / 效果 / 售价 | 每组一个单选项 |
| 干员 | `charId` | 盟约网格（版本 × 盟约 复选框）+ 只读的模组/费用/职业摘要 | 勾选矩阵 |

### 4.2 行形态

- 折叠时一行摘要：名称、出现版本数、当前生效来源（`自动（最新）` 或钉住的版本）。
- 每个分类的标题就是折叠控件：点击标题收起该分类下的表单内容，方便直接跳到后面的分类。
- 点击整行展开：无冲突 → 铺细则，**没有单选框**；有冲突 → 每个版本一个子行，**右侧一个单选框**。
  展开的条目按「标题加粗独占一行、正文不加粗换行」排版，不再用 ` — ` 连成一串。
- 同名但效果完全相同的条目**仍然分行、各自一个单选项**。行身份只由 `(类型, id)` 决定，
  绝不能按「内容哈希相同」合并行——否则「摘掉某版本」会连带删掉其它版本里未变动的同一条目。
  `cs` 哈希只用于数据寻址，与行身份无关。
- 干员的复选框单元是 `(版本, 盟约)`，不是盟约：同一盟约可能被两个版本同时提供，只按盟约勾选无法表达「取消哪一个」。
  标签只显示盟约的中文名（目录按来源解析 `bonds[bondId].name`），原始 id 只作为存储键出现在文档里；名称检索同时匹配中文名与 id。

### 4.3 操作栏

- `仅显示冲突`（默认勾选）：只保留真正需要决定的行——`出现版本数 ≥ 2` 且各来源的内容与效果并不完全相同。
  唯一来源、以及多来源但实现完全相同的行（目录上标记 `identical`）都被隐藏：它们不是需要选择的东西，
  批量预设对它们也无事可做。分组标题仍显示这类行的数量。
- 名称检索：按 `label`（中文名）与 id 同时匹配。
- 按版本筛选：选某版本后，显示该版本参与的全部行——冲突与非冲突都在，方便按赛季核对。
- 底部两个批量预设，作用于当前筛选出的行，执行前显示「将影响 N 行」并要求二次确认：
  1. **以 X 为准**：冲突行的 `pick` 钉到 X；X 不存在的行不动。
  2. **摘出去**：X 独有的条目写 `off`（删除），X 与别的版本共有的条目改为 `auto`（取其它版本中的最新）。
     即「让 X 完全不贡献内容」。
- 「清除全部覆盖」回到全 `auto`。

两个预设只写 override，不改数据，随时可撤销。

### 4.4 干员规则

干员的费用、职业、技能、站位、模组在版本间不构成「同名不同义」的编辑对象（异格是独立干员 id），因此：

- 干员主记录（含模组）**始终取最新、取最全**，不开放选择，展开只读。
- 只有 `bonds` 数组走矩阵；生效 = 勾选格子的并集。

### 4.5 装备规则

基础件与进阶件是同一映射的两个状态，选择键是基础件 id，一次选择决定整组来源；
生成器校验组内 `goldenId` 同源，禁止「基础取 V1、进阶取 V2」。

---

## 5. 合成规则（启动时执行）

输入：`sources` 里每个版本的 `data/versions/<dir>/`（默认版本读 `data/*.json`）。
输出：`data/versions/wild/`（`VERSION_DATA_FILES`，不含 `assets`，资产复用默认）。

| 文件 | 规则 |
| --- | --- |
| `bonds` / `bands` / `items` / `effects` / `garrisons` / `enemies` / `bosses` / `factions` / `waves` / `stages` / `choices` | 按 id 并集；同 id 按 `pick`（默认取 `sources` 中最新的出现版本），`off` 的行不进并集 |
| `chess` | 按 `charId` 并集；主记录取最新；`bonds` = 矩阵勾选结果的并集 |
| `tokens` / `backups.tokens` | 按 id 并集；每个 id 只有一个归属表，由最新的出现来源决定（见下） |
| `backups.units` | 按 `charId` 并集；`forms` / `moduleNames` 按 status key 并集（各版本对同一 `charId` 定义的 form 不同） |
| `backups.diy`（自建嵌合体） | 取最新 |
| `config` | 取最新版本，再打上 `version: { id: 'wild', family: 'covenant', rules: {} }` |
| `assets` | 不合成，沿用默认资产 |

硬约束：

- **归属（provenance）**：被「已选定行」引用的记录必须来自该行的来源版本，而不是「恰好也有这个 id 的最新版本」。
  判定按 `validateReferences` 检查的字段，即 `server/contentMerge.js` 的 `EDGES`。
- **召唤物归属表**：同一 token id 在单个来源里只能出现在 `tokens.json` 或 `backups.json` 的 tokens 之一
  （`validateReferences` 的既有规则），所以归属表按 id 固定，不能两处都放。跨来源归属不同的 id 是两个不同的游戏对象
  （第一期的干员授予召唤物 vs 第二期的补位 token），按 id 报一次冲突，而不是每个解析不到的引用各报一次。
- **补位**：`shared/standIn.js` 用 `chess.backup.charId` 查 `backups.units`，再取 `forms[statusKey(chess.status)]`，
  所以手工干员记录必须与 chess 记录同源。
- `config.season` 只能一个值，**取最新的 `act2autochess`**，与「盟约取尽可能新」一致。
  代价：第一期专属分支（`isFirstPeriod`、`miraShip`）在狂野不生效，需在策划案中保留说明。
- 输出必须通过 `shared/plugins/validate.js` 的 `validateReferences`；解析不到的引用显式丢弃并计数写入日志，
  不允许悬空引用进入对局（例如只在第一期存在的 `band_zumama`）。不可丢弃的引用（`required`）报错而不是静默留洞。
- `hiddenCore` 等阈值取最新版本。
- 合成失败（源版本缺文件、引用全断）时**拒绝启动**并打印明确错误，不能带着半份数据起服。

落地（P2）：`server/contentMerge.js`。`mergeWild()` 是纯规则（数据进、数据出），`writeWild()` 是唯一的 IO，
`synthesizeWild()` 是启动接线 —— 读 `runtime/wild.json`（没有文件 = 没有狂野集），合成后写 `data/versions/wild/`，
失败时 `server/index.js` 抛错拒绝启动。测试在 `test/content-merge.test.js`。

---

## 6. 保存与重启

- **保存即校验**：`POST /admin/api/content/wild` 在写盘前先在内存里按 §5 跑一遍合成（`mergeWild`），校验不通过就
  拒绝保存并把错误回给面板，`runtime/wild.json` 保持原样。这样坏配置不会落盘，也就不会「保存成功 → 启动卡死 →
  重新部署」。启动时的合成检查保留为兜底（面板写入后仍可能在启动时失败，例如数据文件缺失）。
- 保存只写 `runtime/*.json`，界面提示「已保存，重启后生效」，并在卡片上标一个待生效标记。
- 重启入口是玩家列表页维护按钮旁边的红色「重启」（已实现）：
  `GET /admin/api/restart` 上报 `{ enabled, supervised, activeMatches }`，
  `POST /admin/api/restart` 排空 → 审计行 `action: 'restart'` → `close()` → `process.exit(0)`。
- 守护检测：`process.pid === 1`（本仓镜像的 CMD 让 node 直接是 PID 1）或 `SP_SUPERVISED=1`。
  检测不到时非 `force` 一律 409，界面明确提示「重启后不会自动拉起」。
- 有进行中的对局时同样要 `force`；没有 `SP_REDIS_URL` 检查点时，这些对局在重启后丢失。

---

## 7. 接口草案

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/admin/api/content/versions` | 注册表 + 当前来源（env / runtime）+ 各版本数据是否存在 |
| POST | `/admin/api/content/versions` | 写 `runtime/versions.json`（`{ enabled, revision }`） |
| GET | `/admin/api/content/wild` | `sources`、各表行数据（含每行的版本归属与当前生效来源）、`revision` |
| POST | `/admin/api/content/wild` | 写覆盖项 / 执行预设（`{ revision, patch, preset? }`）；写前按 §5 合成校验，不通过拒绝写入 |
| GET | `/admin/api/restart` | 重启前置条件（已实现） |
| POST | `/admin/api/restart` | 执行重启（已实现） |

所有写接口沿用现有的会话 + CSRF + 审计行模式；预设执行也是一条审计行，记录 `preset`、目标版本、影响行数。

已落地（P1）：`server/contentConfig.js`（schema、校验、纯变更 + 两个预设）、`server/contentCatalog.js`（按 `(类型, id)` 的行目录、筛选、`auto` 解析）、上面两条路由与 `server/index.js` 的启动读取。测试在 `test/content-config.test.js` 与 `test/player-admin-ops.test.js`。

已落地（P2）：`server/contentMerge.js` 的合成规则；`POST /admin/api/content/wild` 在 `atomicJson` 之前调用 `mergeWild` 做保存即校验，不通过返回 400 且不写盘（沿用同一条 CAS 与审计路径）。

---

## 8. 未决

1. **上线形态**：狂野作为特殊版本，还是作为娱乐模式的一个玩法（房间规则继承主线两种都成立，取舍在入口与大厅展示）。
2. **冲突值对比**：单选项旁是否需要并排 diff（例如 17 个同名盟约 `descRaw` 不同），还是只显示名称 + 描述全文。
3. **golden 基线**：狂野的战斗结果与任何单版本都不同，需要自己的一份 `test/golden/<slug>/`；在生成器落地后决定是生成还是豁免。
4. **核心盟约膨胀与 BAN 配额**：并集后核心盟约数量上升，BAN 配额是否按难度扩容，需用 `tools/audit-opening-pool.mjs` 评估。
5. **`test/data-versions.test.js` 豁免**：该测试把 `VERSIONS` 当官方版本全集（profile 存在性、label 精确表、与官方 `activity_table` 对账），
   合成版本需要打标记或加白名单。
6. **跨表召唤物冲突**：已定 (a) —— 按现行规则，合不成即不能保存，遇到具体问题再考虑放宽。四个版本全默认时，
   `token_10029_slent2_protrb`、`token_10032_jesca2_jckshd`、`token_10043_necras_skeltn` 在第一期属于 `tokens.json`
   （干员授予的召唤物）、在第二期属于 `backups.json`（DIY 干员的补位 token），`validateReferences` 只允许一个归属表，
   所以当前无法产出可启动的狂野数据（其余引用全部解析通过，任意两个同活动期的来源单独合成都干净）。
   因为保存即校验（§6），这四个来源一起时**任何狂野修改都会被拒绝**，面板必须先收窄 `sources`，并在 GET 视图里直接看到
   合成状态（`synthesis`），而不是靠试保存才发现。
   数据事实：跨活动期共有 11 个 token id 归属表不同，同一活动期内两个版本始终一致。其中 8 个只有一个消费方（第一期的
   DIY 记录被「整份取最新」规则排除），所以不报错；只有两侧同时活着的 3 个报错。后续若真要放宽，方向是 (b) 把 `chess`
   纳入 `PICK_TYPES` 让后台能关掉某一侧的行，或 (c) 把两种 keying（`chessId` 与 `charId@statusKey`）的 variants 并到同一条记录。

---

## 9. 皮肤管理（资源管理页）

「资源包」页签改名「资源管理」，页内新增皮肤管理卡片：按干员分组，每个干员下列出它录入的全部皮肤，每个皮肤是一张图块，
取消高亮即不再给玩家使用。保存同样提示「已保存，重启后生效」。

### 9.1 图块与不可取消项

每个干员的图块按来源排序：`default`（精一、精二两个独立图块）→ `official`（官方表 `data/skins.json`）→ `pack`（插件 overlay）。

- 图块就是皮肤本身：图 + 名称，沿用干员调配页的样式。高亮 = 提供中，点击取消高亮即不再提供，再点一次恢复；
  图块上没有任何状态文字，高亮本身就是状态。
- 精一 / 精二是两个独立图块，永远高亮且不可取消（`fixed`）；点击它们只提示「初始立绘不可移除」，状态不变。
  它们同时是玩家被重置时的落点（数据里没有独立的「精一皮肤」条目，只有默认外观与 `e1` look）。
  图块取 `data/assets.json` 的 `chars[charId].portrait` / `portraitE2`，官方皮肤取 manifest 的 `portrait`，
  补充包取 overlay 自己的 `portrait`。
- 保存按钮只在页面的选择与服务端记录不一致时可用；`重置` 把页面的选择恢复成全部提供（只改页面，不自动保存）。
- `pack` 行的 id 是 `<pluginId>/<skinKey>`，与 `shared/skins.js` 的 registry key 一致；插件包被移除后这一行自然消失，
  停用表里残留的条目不会报错（文档只按形状校验，不校验成员）。

### 9.2 文档只存停用表

```json
{
  "schemaVersion": 1,
  "revision": 1,
  "lastFingerprint": "…",
  "disabled": { "char_103_angel": ["char_103_angel_wild_1"] }
}
```

- 缺文件 = 空表 = 全部启用，与「没有皮肤管理」完全等价。
- 只存被取消提供的皮肤，所以文件随赛季增长基本不变。
- 沿用 `server/roomConfig.js` 的 `revision` + CAS + 原子写 + 审计行范式。

### 9.3 id 空间（易错点）

gate 的 key 是 `shared/skin-catalogue.js` 的 **manifest id**（例如 `char_498_inside_kitchen_2`）——这是客户端
`sp.pref.skins` 实际存的值，也是 `skinDenied` 检查的值；而 `data/skins.json` 发布的是 **officialId**
（`char_498_inside@kitchen#2`）。两套 id 空间，面板的图块必须发前者，否则保存的行永远匹配不上客户端存的值，gate 形同不存在。
`server/skinGate.js` 的 `skinGroups()` 在生成行时把 officialId 解析成 manifest id。

### 9.4 一个判定覆盖四个消费面

被停用的皮肤在客户端**直接隐藏**（不画禁用态）。四处消费面共用 `shared/skins.js` 的 `skinDenied`：

| 消费面 | 位置 |
| --- | --- |
| 外观网格 / 服装行 | `public/js/ui/skins.js` `availableSkins`、`public/js/ui/skinPicker.js` `SkinSection` / `outfitRows` |
| 名片外观与头像 | `public/js/ui/seatArt.js` `lookOptions`（`randomCardPick` 的随机池同源） |
| 名片底图 | `public/js/ui/namecards.js` 底图列表 |
| 服务端校验 | `shared/playerCard.js` `cleanPlayerCard`（`cardSkinDenied`），`shared/skins.js` `cleanSkinChoices` |

只接 `availableSkins` 不够：实际 UI 走的是 `skinPicker.js`，两处必须用同一判定。

### 9.5 生效与重置

- **重启后生效**：gate 在启动时读一次（`server/index.js` 安装 `createSkinGate`），改文件必须重启进程。
- **启动清理**：启动时遍历在线玩家，把被停用的选择恢复成该干员的默认外观，其它参数（`bgShift`、`avatarLook` 等）保持不变。
- **登录后提示**：客户端 boot 时 `GET /api/skins/gate`（公开、无鉴权、`no-store`）→ `setSkinGate()` → 回写自己的
  localStorage（真源在客户端）→ 有被重置的项时 toast「部分皮肤已停止提供，已为你恢复默认外观」。
  card 字段只更新 store 不写 pref，所以 gate 必须显式 `savePref`（`sp.pref.room.card` / `avatar` / `card.look` /
  `card.avatarLook` / `room.namecard` / `sp.pref.skins`）。

### 9.6 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/admin/api/content/skins` | `revision`、按干员分组的行（`id`、`name`、`group`、`source`、`fixed`、`enabled`）、`stats`、`catalog` |
| POST | `/admin/api/content/skins` | `{ disabled: { [charId]: [skinId] }, expectedRevision }` → `{ ok, changed, revision, restartRequired: true }` |
| GET | `/api/skins/gate` | 公开读取当前 gate（客户端 boot 时读，用于回写本地与提示） |

落地：`server/contentConfig.js`（schema + 校验 + 纯变更）、`server/skinGate.js`（行目录、gate 判定、启动清理、公开读接口）、
`public/js/ui/skinGate.js`（客户端应用与回写）。测试在 `test/skin-gate.test.js`。
