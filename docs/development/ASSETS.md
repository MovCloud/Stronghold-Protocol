# 素材

本文说明本项目所用素材的来源、清单与目录结构，以及唯一需要本机客户端才能拿到的「本地客户端素材」。素材的版权归原权利人所有，**不适用**本项目的 GPL-3.0 许可证，详见根目录 [NOTICE.md](../../NOTICE.md)。

## 清单与目录

- 下载：`node tools/fetch-assets.mjs`（`npm run assets` = `tools/vendor.mjs` + 该脚本）从公开镜像下载美术与音频，写入 `public/assets/`，并把文件清单写进 `data/assets.json`（首次约 720 MB，可中断、可续传、失败自动换源）。
- 目录（均在 `public/assets/` 下）：`char/`（干员头像与立绘）、`skill/`（技能图标）、`module/`（模组类型图标）、`enemy/`（敌人图标）、`token/`（召唤物头像）、`bond/`（盟约图标）、`item/`（道具图标）、`prof/`（职业与战斗卡图标）、`ui/`（界面图标、战斗表情、教程图）、`spine/`（干员 / 召唤物 / 敌人的 Spine 模型）、`fonts/`（字体与 `fonts.css`）。
- 幂等：已存在且校验通过的文件不会被重复下载；一次运行只补缺失项，重跑约 1 秒完成。

## Local client art

官方 3D 棋盘贴图、部分官方界面图标、灼热 / 炽焰源石虫模型、**自选召唤物**模型和官方战斗特效这几样只存在于《明日方舟》PC 客户端（Windows 原生客户端、macOS 的 CrossOver 或 PlayCover）里，公开镜像和仓库源码都不带它们，需要从本机客户端提取。提取工具是 `tools/local-extract/extract.py`：产物写入 `public/assets/local/`，并把分组清单写进 `data/local-assets.json`；服务器读取 `data/local-assets.json` 决定用本地图还是替代样式。

在一台装了客户端的机器上运行 `node tools/setup.mjs --local` 即可提取全部内容；只需要新版**召唤物**模型时，可以单独运行提取器的 `--only spine/token` 任务，再把 `public/assets/local/spine/token/` 与更新后的 `data/local-assets.json` 一起复制到服务器。一份**同一版本**的整合包（上游完整包）已经带好 `public/assets/local/` 和 `data/local-assets.json`：没有客户端的服务器（例如 Linux VPS）可以直接从同一版本的整合包复制这两条路径，不必自己提取。

没有本地客户端素材时游戏照常运行，只把这几样换成替代样式：3D 棋盘退回 2D（金属地块），部分官方界面图标用样式相近的图标，灼热 / 炽焰**源石虫**用染色的普通源石虫模型，多数自选**召唤物**显示头像而不用模型。战斗**表情**（交流面板的主题图标）和游戏内「**玩法说明**」的教程图不在这一组里：它们会随上面的素材一起从公开镜像下载，不需要客户端；缺失时分别用通用图案和文字要点兜底。
