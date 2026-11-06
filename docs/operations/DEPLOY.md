# 部署指南

这是本分支部署与更新的总入口。所有命令默认从项目根目录执行，Node.js 要求 22 或更高；线上运行一个常驻 Node 进程，并将站点部署在域名根路径。

| 场景 | 看这里 |
|---|---|
| Linux 生产站点 | 本文的安装、systemd、反向代理和更新步骤 |
| Docker | 本文的容器步骤 |
| Windows / 家用小主机 / 整合包升级 | [HOME_SERVER.md](HOME_SERVER.md) |
| 游戏内公告接入管理面板 | [ANNOUNCEMENTS.md](ANNOUNCEMENTS.md) |
| 素材 R2 发布、预载和清理缓存 | [CDN.md](CDN.md) |
| 对局检查点与备份恢复 | [PERSISTENCE.md](PERSISTENCE.md) |
| 监控探针与管理面板的分工 | [MONITORING.md](MONITORING.md) |
| 制作发行包 / Windows 便携包 | [PACKAGING.md](PACKAGING.md) / [WINDOWS.md](WINDOWS.md) |

## 安装

```bash
git clone https://github.com/Misyra/Stronghold-Protocol.git /opt/Stronghold-Protocol
cd /opt/Stronghold-Protocol
npm ci --omit=dev
```

### 生产前端构建

源码模式仍可直接运行。生产推荐在独立构建目录安装开发依赖并生成 Vite 产物：

```bash
npm ci --include=dev
npm run build
```

构建输出为 `public/build/`，不会复制整套美术资源。服务启动时检测到 `public/build/index.html` 就使用构建入口；缺少构建时自动使用源码入口。`npm run dev` 或 `node server/index.js --source-client` 始终使用源码入口。

以下源码更新命令不会自动刷新已有构建。启用构建模式的站点，每次更新代码时都必须同步同一版本的新 `public/build/`；不能只拉代码并重启。发行 ZIP 仍按原流程使用源码入口，不会自动收录本机未跟踪的构建目录。

发布时先上传新哈希资源，再原子替换构建入口，并按正常维护流程重启业务服务以刷新版本信息；不要在运行目录边构建边覆盖入口。构建默认保留旧 chunk，发布同步也不得使用删除旧 chunk 的规则，否则旧标签页后续加载会失败。清理期限需要覆盖允许的旧页面及对局存活期。

这只保留构建 JS/CSS 等内容哈希资源；现有 `/_v/` 数据、资源清单和服务端协议仍有独立兼容边界，不能据此承诺跨不兼容版本不停服。开发依赖只用于构建，运行机器可以只安装生产依赖；同时运行一次 `node tools/vendor.mjs`，保留源码回退和可选加载所需的库。Docker 构建阶段已包含 Vite，最终镜像仍仅含生产依赖。

素材来源选择一种：

- 本机提供素材：运行 `node tools/setup.mjs`，下载失败可重跑续传；缺失明细和环境诊断用 `node tools/doctor.mjs`。
- 使用已发布的本站 CDN：配置 `SP_ASSETS_CDN=https://assets.misyra.com`，保留随代码发布的 `.assets-manifest.json`，无需在服务器下载整套素材。新建自己的 CDN 先按 [CDN.md](CDN.md) 配置和发布。

本分支跟踪的 `public/assets/local/` 随 Git 下载；资源来源、客户端提取和清单见[素材说明](../development/ASSETS.md)。源码部署不要混用上游发行包中的程序文件。

## 配置

推荐把线上配置放在 `/etc/stronghold/game.env`，由服务管理器加载。`npm start` 不会自动读取根目录 `.env`。

```dotenv
PORT=3000
HOST=127.0.0.1
SP_STATE_FILE=/var/lib/stronghold/game
SP_ASSETS_CDN=https://assets.misyra.com
SP_ANNOUNCEMENT_SOURCE=agent
SP_MODERATION_KEY_FILE=/etc/stronghold/moderation.key
```

公告默认读取探针管理文件。在面板配置好本站探针和管理密钥即可发布，无需绑定游戏站点 ID。已有 feed 部署升级时显式改为 agent 并重启；无探针站点可保留 feed。完整步骤见[公告接入](ANNOUNCEMENTS.md)。

联机断线保留席位 10 分钟；单人对局可在断线后 24 小时内恢复。

默认开启服务端检查点；保留状态目录可恢复最近的安全阶段，作战进行中重启可能重打该回合。状态目录包含私有重连身份，必须随配置一起备份。具体恢复边界见 [PERSISTENCE.md](PERSISTENCE.md)。

<a id="4-macos--linux-常驻"></a>

## 开服流量（0.2.6）

开服的电脑主要在两处出流量：素材（图片 / Spine 模型 / 音频）和对局期间的 WebSocket 消息。0.2.6 起：

- **WebSocket 消息压缩**：1 KB 以上的消息走 permessage-deflate（`SP_WS_COMPRESSION`，默认 `on`），一局单人对局的服务器消息实测从 173 KB 降到 60 KB。客户端声明 `server_max_window_bits` 比服务器小时，握手不再被拒，而是回落到不压缩。
- **素材地址版本化长期缓存**：本机模式下发 `/_v/<tag>/…`（`server/assetVersion.js`，整棵素材树的内容哈希，字节没变 tag 就不变）；CDN 模式按文件哈希发 `<base>/assets/…?v=<hash>`（见 [CDN.md](CDN.md)）。重新解压、重建容器只要字节没变，玩家就不重下。
- **brotli**：脚本、样式、数据和 `.skel`/`.atlas` 在浏览器声明 brotli 时用 brotli（质量 5），否则 gzip；图片和音频原样发送。浏览器只在 https 页面（和 `localhost`）上声明 brotli，所以隧道 / 域名访问用 brotli，局域网 `http://192.168.x.x:3000` 用 gzip。代理不需要再开压缩。
- **静音不下载背景音乐**：静音或背景音乐音量 0 时不下载 BGM，恢复可听后再取当前该放的那首。
- **教程图 WebP**：本地提取的 19 页玩法说明每页另存 WebP（有损，质量 90，19 页由约 25.6 MB 降到约 4.2 MB），看说明时只预载下一页。重新提取用 `python3 tools/local-extract/extract.py --webp`。
- **看主机的出流量**：本机或局域网打开 `http://localhost:3000/healthz?traffic=1`，`traffic.http` 是按类别（assets / audio / code / data）发出的字节与请求数，`traffic.ws` 是 WebSocket 的线上字节与压缩前的消息字节。数字只在内存里，重启清零；只有本机 / 局域网访问能看到。玩家那边：设置 →「问题反馈」的诊断里有一行 `traffic:`，是本页打开以来的下载量（`cached` 是浏览器缓存直接给的）。

**固定访问地址能省很多流量**：浏览器的缓存、设置、本机统计和断线令牌都按地址（域名或 IP + 端口）分开保存。地址一换，对玩家来说就是一个新网站：素材要重新下载一遍（第一局约 20–50 MB），设置和统计也看不到了。临时隧道每次重启都换域名，长期开服建议用命名隧道、Tailscale 或固定的公网 / 局域网 IP，让大家一直用同一个地址。

**HTTP/2**：客户端由数百个小脚本模块组成，隔着公网时建议让代理以 HTTP/2 提供页面（所有模块走同一条连接，首次进入对局明显更快）。Caddy 默认就是 HTTP/2；Nginx 见上面的 `http2`。服务器本身只说 HTTP/1.1，局域网或本机游玩不受影响。

**Cloudflare 缓存**（命名隧道或自己的域名经过 Cloudflare 时）：Cloudflare 默认只缓存常见扩展名，`.skel`、`.atlas` 和无扩展名的 `/media/…` 都不在其中。在「缓存规则」里加一条：主机名是游戏域名、路径以 `/assets/`、`/fonts/` 或 `/media/` 开头时「符合缓存条件」，边缘 TTL 选「使用源站的 Cache-Control」。`/data/`、页面和脚本不要加（它们要随服务器更新）。注意边缘公开缓存官方素材会增加被投诉的风险。

## Linux 常驻

先创建运行账号和可写状态目录（已有账号不必重复创建）：

```bash
sudo useradd --system --home-dir /opt/Stronghold-Protocol --shell /usr/sbin/nologin stronghold
sudo install -d -o stronghold -g stronghold /var/lib/stronghold
sudo install -d -m 750 /etc/stronghold
sudo chmod 600 /etc/stronghold/game.env
```

保存 `/etc/systemd/system/stronghold.service`：

```ini
[Unit]
Description=Stronghold Protocol game server
After=network-online.target
Wants=network-online.target

[Service]
User=stronghold
WorkingDirectory=/opt/Stronghold-Protocol
EnvironmentFile=/etc/stronghold/game.env
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
UMask=0077

[Install]
WantedBy=multi-user.target
```

代码和依赖须对 `stronghold` 可读，状态目录须可写。按 `command -v node` 修正 Node 路径，然后启动：

发布沿用现有停止保存、重启恢复和客户端自动重连流程，无需等待对局结束。先确认部署启用了存档目录且新旧进程使用同一目录；停止须留足最终存档时间，避免强制杀死。

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now stronghold
journalctl -u stronghold -f
```

macOS 临时运行可用 `scripts/start.sh`；Windows 自启见 [HOME_SERVER.md](HOME_SERVER.md#14-开机自动在后台运行)。

启动时会流式读取可公开资源的全部内容，计算跨机器一致的版本哈希；约 500 MB 素材需要读取同等规模的数据，耗时取决于磁盘速度和系统缓存。部署时记录从启动到 `/healthz` 首次成功的耗时，并给健康检查预留相应启动时间；不要用 mtime 代替内容哈希。

<a id="24-反向代理与-https有域名时"></a>

## 反向代理

游戏必须在域名根路径运行；转发 WebSocket `/ws`，其余请求交给同一个 Node 实例。完整 nginx 配置使用 [scripts/nginx.conf.example](../../scripts/nginx.conf.example)，替换域名、证书及 Node 端口。`worker_processes auto;` 放在主配置顶层；`map` 放在 `http` 中。

首次采用或升级到该 nginx 示例时，必须先将 [nginx-log-format.conf.example](../../scripts/nginx-log-format.conf.example) 安装为 `/etc/nginx/conf.d/sp-log-format.conf`，并确保只在 `http` 级加载一次（已有 `conf.d/*.conf` 通配 include 时不要重复 include）。缺少此文件会导致 `nginx -t` 和启动失败；安装及检查命令见下节迁移步骤。

Caddy 的最小配置：

```caddy
game.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

nginx 修改后先 `sudo nginx -t`，通过后再 reload。Node 只监听本机时不必对公网开放 3000；公网入口使用 HTTPS。不要让多个 Node 实例共享一个状态目录。

`/api/announcement` 转发到游戏 Node；面板公开 feed `/api/announce/v1/<siteId>` 由 sp-portal 提供，两者是不同接口。公告 API 共享缓存设为 30 秒；普通 API 不缓存。资源预载的 `/resource-sw.js`、`/js/resources/`、`/data/resource-manifest.json` 必须指向当前 Node，不能套用素材一年缓存规则。清单共享缓存的例外见下节，Worker 和普通 JS/CSS 继续遵循源站复验规则。

### 清单性能修复与 nginx 一次性更新

代码修复将资源清单的缓存判断提前到 JSON 读取、解析、URL 改写和遍历之前，未变化时直接复用结果；素材哈希清单每个进程只序列化一次。首次生成和源文件变化后仍需重建。热路径上只有缺失（ENOENT/ENOTDIR）才算依赖不存在，其他 stat 错误按失败拒绝而不是悄悄丢掉依赖；测试重置缓存时，进行中的旧构建仍会回答自己的调用方，但不会覆盖重置后新构建的缓存。没有新增环境变量，不需要重传 R2 素材，也不需要清理玩家浏览器资源包。

线上使用 [nginx-game-cache.conf.example](../../scripts/nginx-game-cache.conf.example) 的缓存与直出配置，Node 同时提供安装清单缓存：

| 路径 | 策略 |
|---|---|
| `/data/resource-manifest.json?v=<页面发布版本>` | nginx 缓存 12 小时，查询参数参与 key；Node 校验版本，错误版本返回不缓存的 404 |
| 不带版本的 `/data/resource-manifest.json` | 兼容旧客户端和 Worker 后备读取，仅缓存 15 秒 |
| `/assets-manifest.json?v=<素材版本>` | nginx 缓存 30 天；浏览器保留源站不可变缓存头；只缓存 200 |
| `/api/announcement` | 缓存 30 秒，源站失败不继续返回过期公告 |
| `/icons/` | nginx 直接读取图标，缓存 1 小时；未配置直出时 Node 同样缓存 1 小时；文件名无版本，更新图标最多延迟 1 小时 |
| `/manifest.json` | Node 提供，浏览器缓存 1 小时，过期后通过 ETag 复验 |

新页面自动带资源清单版本，发布版本随代码、数据、素材及预载元数据变化。浏览器仍复验；12 小时是 nginx 的共享缓存期限，由 Node 的 `X-Accel-Expires: 43200` 控制；普通地址是 `15`。不要忽略 `X-Accel-Expires`，不要从缓存键去掉查询串，也不要关闭上游 `Vary` 处理。资源清单和公告都禁止过期回退。长期缓存只用于有版本的清单；上线后资源或数据再次改变，须重启 Node 生成新页面版本，不能仅热覆盖文件。

已有 nginx 站点不用整份替换主配置，按以下步骤合入：

1. 保留现有域名、证书、WebSocket、`/_v/`、普通 JS/CSS 和 ping 路由。在 `http {}` 中确认已有 `sp_assets` 缓存区（完整定义见 [nginx.conf.example](../../scripts/nginx.conf.example)），无需新建 `sp_status`。将 [nginx-log-format.conf.example](../../scripts/nginx-log-format.conf.example) 安装为 `/etc/nginx/conf.d/sp-log-format.conf`，只在 http 级 include 一次；目标站点 access_log 改用 `sp_game`，保留已有日志路径和轮转权限。完整主示例已接入该格式。
2. 安装片段，修改片段里所有 Node 端口及图标 `root`。本站独立静态目录可为 `/opt/sp-public`；普通源码部署可为 `/opt/Stronghold-Protocol/public`；须确认 nginx 能读取 `root/icons/app.svg`。Docker 若宿主机无图标目录，可先删除图标块，继续由 Node 提供。
3. 将原有上述同路径 location **替换或删除**，然后在游戏站点 `server {}` 加一行 `include /etc/nginx/snippets/stronghold-game-cache.conf;`。不要重复定义。片段的 `add_header` 在旧版 nginx 会覆盖继承的 `add_header`；站点原有必需响应头需一并保留。

```bash
cd /opt/Stronghold-Protocol
git pull --ff-only
npm ci --omit=dev
sudo install -d /etc/nginx/snippets
sudo install -m 644 scripts/nginx-game-cache.conf.example /etc/nginx/snippets/stronghold-game-cache.conf
sudo install -d /etc/nginx/conf.d
sudo install -m 644 scripts/nginx-log-format.conf.example /etc/nginx/conf.d/sp-log-format.conf
# 编辑片段的端口、图标 root，并合入上面的 server include 后：
sudo nginx -t
# 检查通过再依次执行；重启会短暂断连，恢复边界见 PERSISTENCE.md。
sudo systemctl restart stronghold
sudo systemctl reload nginx
```

资源清单使用新的缓存键前缀，不需删除整个 nginx 缓存。不要修改状态目录、公告目录或审核密钥。重启同时会关闭本次临时开启的 inspector；若启动参数本身包含 `--inspect`/`NODE_OPTIONS=--inspect`，需先去掉该选项。

公告缓存 30 秒，浏览器也每 30 秒轮询，发布或撤销后还需等待缓存过期与下次轮询。缓存响应中的 `serverTime` 也会延迟，因此客户端到期显示最多存在约 30 秒偏差；这是本部署接受的取舍，不缓存错误响应，也不在源站失败时继续使用过期缓存。

验证时使用游戏首页注入的 `__spAssetVersion` 拼出 `/data/resource-manifest.json?v=<版本>`，连续请求应从 `X-Resource-Cache: MISS` 变成 `HIT`；带原 ETag 请求应返回 304。素材清单看 `X-Asset-Manifest-Cache`，公告看 `X-Announcement-Cache`。`/api/ping` 不应有共享缓存，普通 JS/CSS 不应被新增长 TTL。nginx 缓存减少 Node 回源和处理开销，不减少同样响应向玩家发送的字节；首次填充较大清单时仍可能产生正常的缓存文件写入。

完整示例中的 `/healthz` 已禁用共享缓存：探针读取实时样本，玩家使用 `/healthz?build=1` 读取小型版本响应。进程性能数据在 `/metrics`（只对本机回环 / 私网应答），它走通用 `location /`（同样 `proxy_cache off`），不需要单独的 location。合入时删除旧的 healthz `proxy_ignore_headers Cache-Control` 与 5 秒共享缓存配置。缓存 location 显式 `proxy_buffering on`，避免继承 WebSocket 的关闭缓冲配置导致缓存不生效；不要全站覆盖 `X-Accel-Buffering: no`。`/_v/` 缓存键使用新命名空间并隔离 Host、端口、上游与完整 URI，只缓存 200，保留 Vary。Range 可由缓存完整响应切片，不能据此把 206 单独长期缓存。

<a id="3-docker"></a>

## Docker

从本分支源码构建，默认镜像不下载整套素材；以下使用已发布 CDN，并挂载持久化状态：

```bash
docker build -t stronghold-protocol .
docker run -d --name stronghold --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  --env-file /etc/stronghold/game.env \
  -e HOST=0.0.0.0 -e SP_STATE_FILE=/app/.state/server.state.json \
  -e SP_MODERATION_KEY_FILE=/run/secrets/moderation.key \
  -v /etc/stronghold/moderation.key:/run/secrets/moderation.key:ro \
  -v stronghold-state:/app/.state stronghold-protocol
```

容器内部需要监听 `0.0.0.0`，覆盖宿主机环境文件里的 `127.0.0.1`；状态路径同样覆盖为容器持久卷。不用 CDN 时，以 `--build-arg FETCH_ASSETS=1` 构建并移除 `SP_ASSETS_CDN`，或挂载宿主机已准备好的整个 `public/assets`（包括 `local/`）。默认 `.dockerignore` 排除 `public/assets`，素材不进镜像；要把素材打进镜像，用 `--build-arg FETCH_ASSETS=1` 构建，或在已下载素材后以 `public/assets` 为构建上下文追加一层素材层。

示例中的密钥挂载与 `SP_MODERATION_KEY_FILE` 只在启用昵称审查时需要；默认未启用审核时可以省略（见[昵称审查](#昵称审查可选模块默认未启用)一节）。

Compose 示例：

```yaml
services:
  stronghold:
    build: .
    ports: ["127.0.0.1:3000:3000"]
    env_file: /etc/stronghold/game.env
    environment:
      HOST: "0.0.0.0"
      SP_STATE_FILE: /app/.state/server.state.json
      SP_MODERATION_KEY_FILE: /run/secrets/moderation.key
    volumes:
      - "stronghold-state:/app/.state"
      - "/etc/stronghold/moderation.key:/run/secrets/moderation.key:ro"
      - "/var/lib/stronghold-announcement:/var/lib/stronghold-announcement:ro"
    restart: unless-stopped
    stop_grace_period: 30s
volumes:
  stronghold-state:
```

先运行探针安装脚本创建宿主机公告目录，再启动容器；公告目录整体只读挂载以支持原子替换。更新镜像后复用同一个持久卷。容器备份与恢复见 [PERSISTENCE.md](PERSISTENCE.md#docker)。

<a id="镜像保留"></a>

### 镜像规范（本地与服务器一致）

- 运行时镜像只有一个标签 `stronghold-protocol:latest`，回滚镜像只有一个标签 `stronghold-protocol:rollback`；除此之外不保留任何卫戍协议镜像。版本号标签（如服务器上的 `stronghold-protocol-full:0.3.3-c7c5a7e0`）不作为镜像保留，版本信息只写在 tar 文件名与部署记录里。
- 容器只有一个（服务器 `stronghold`、本地 `stronghold-local`，都走 3000），状态卷只有一个 `stronghold-state`；每次部署前先备份状态。不要再另开预览副本——不同端口上的同名部署会各自累积镜像与状态卷。
- 打包产物固定拷贝到服务器的 `/opt/stronghold-protocol/stronghold-protocol-latest.tar`（同名覆盖，不另建目录），回滚包为同目录的 `stronghold-protocol-rollback.tar`；tar 同样只留这两个文件。本项目的服务器文件全部集中在 `/opt/stronghold-protocol/`：tar、`config/`、`site.json`、`announcements/`、`last-run.txt`（上一次启动参数，重建容器时照抄）。
- 公告只放在 `/opt/stronghold-protocol/announcements/`（挂载到 `/app/announcements`），不进仓库也不进镜像：`schedule.json`（滚动与弹窗排期，格式 `{"announcements":[…]}`，管理台写它）与 `board.json`（大厅公告板，格式 `[{"title","date","paragraphs"}]`）。两者缺失即「无公告」；镜像里的 `data/announcements.json` 已为空，不再提供任何预设内容。要「只在初始化时注入一份」，把初始文件放到 `announcements/seed/` 并传 `SP_ANNOUNCEMENT_SEED_DIR=/app/announcements/seed`——它只在目标文件不存在时复制一次，之后把公告删成空数组也不会重新注入（删掉整个目录才会再注入）。服务器上没有 env 文件，也不需要：昵称审查默认未启用（路由未注册，运行时不会读 `words.enc` 与密钥，见[昵称审查](#昵称审查可选模块默认未启用)），对局检查点走 Redis（`SP_REDIS_URL`，未配置则不持久化），站点与管理配置走下面两个只读挂载，公告存储路径用命令行 `-e` 传（见固定命令块），其余变量都是 Dockerfile 的 `ENV` 默认值。上面的 `/etc/stronghold/game.env` 只适用于源码/systemd 部署。`/app/.state` 里只应有 `feedback.sqlite`（状态卷里的 `server.state.json` 是站点状态锁，不是存档）。
- 其他项目的镜像与容器（mysql、qq-bot-console、upms-server、kiko-website 等）一律不动；禁止 `docker system prune -a` 或 `docker image prune -a`，它们会连带删除其他项目的容器和镜像。
- 打回滚标签前先比对 ID：`docker inspect stronghold --format '{{.Image}}'` 与 `docker inspect stronghold-protocol:latest --format '{{.Id}}'` 相同，说明容器已经在跑本次包（上一次 load + 重启已完成），跳过第 2) 步；两者不同才给运行镜像打 `rollback`。否则 `rollback` 会与 `latest` 指向同一镜像、唯一可用的旧镜像被摘成悬空，等于失去回滚能力（本次部署就发生了这种情况，旧版需用 `docker tag <悬空镜像ID> stronghold-protocol:rollback` 找回）。
- `build` 只用于同一台机器上的新旧对比，不能跨机器比。`data/site.json` 由宿主机只读挂载进容器，而它属于 buildTag 输入的 `data/` 目录，挂载文件的 size+mtime 参与哈希，所以同一镜像在两台机器上的 `build` 天然不同。跨机器判断「本次包是否上线」要查镜像内文件：`docker exec stronghold sh -c 'grep -rl "<本次新增的标记>" /app/public/build | head -3'`。

每次部署按固定顺序照抄同一段（先给正在运行的那个镜像打回滚标签，再 load 本次包，load 之后 `:latest` 才是新镜像）。服务器上的实际约定：`-p 3000:3000`（走 nginx 反代时可改 `127.0.0.1:3000:3000`，但必须与现有配置一致），四个挂载（状态卷 `stronghold-state`、`config/`、`site.json`、`announcements/`），不带 `--env-file`，只额外用 `-e` 传三个公告存储路径；`HOST` / `SP_STATE_FILE` / `SP_CLIENT` 是镜像内默认值，不用再传：

```bash
# 1) 记下当前容器的启动参数（env / 卷 / 端口以实际值为准，重建时照抄）
docker inspect stronghold --format '{{json .Config.Env}} {{json .Mounts}} {{json .HostConfig.PortBindings}}' > /opt/stronghold-protocol/last-run.txt

# 2) 把正在运行的镜像留作唯一回滚（按实际运行镜像取，不假定它叫 latest；首次部署无旧镜像时跳过）
docker tag "$(docker inspect -f '{{.Image}}' stronghold)" stronghold-protocol:rollback

# 3) 载入本次包：load 后 stronghold-protocol:latest 即本次版本
docker load -i /opt/stronghold-protocol/stronghold-protocol-latest.tar

# 4) 覆盖部署：同名容器、同端口、同挂载
docker stop stronghold; docker rm stronghold
docker run -d --name stronghold --restart unless-stopped \
  -p 3000:3000 \
  -v stronghold-state:/app/.state \
  -v /opt/stronghold-protocol/config:/app/config \
  -v /opt/stronghold-protocol/site.json:/app/data/site.json:ro \
  -v /opt/stronghold-protocol/announcements:/app/announcements \
  -e SP_ANNOUNCEMENTS_FILE=/app/announcements/schedule.json \
  -e SP_ANNOUNCEMENTS_BOARD_FILE=/app/announcements/board.json \
  --stop-timeout 30 --health-start-period 30s \
  stronghold-protocol:latest

# 5) 验收通过后才清理：只留 latest / rollback
curl -s http://127.0.0.1:3000/healthz
docker images --format '{{.Repository}}:{{.Tag}}' \
  | grep '^stronghold-protocol' | grep -Ev ':(latest|rollback)$' \
  | xargs -r docker rmi
```

需要「初始化注入一次」时，把初始的 `schedule.json` / `board.json` 放进 `announcements/seed/`，并在上面的 `docker run` 里再加一行 `-e SP_ANNOUNCEMENT_SEED_DIR=/app/announcements/seed`；目标文件已存在时不会复制。宿主机目录必须与容器用户一致（镜像内是 uid 1000），否则管理台写不进排期：`mkdir -p /opt/stronghold-protocol/announcements && chown 1000:1000 /opt/stronghold-protocol/announcements`。

首次对齐（服务器现跑 `stronghold-protocol-full:0.3.3-c7c5a7e0`，把它归入规范）：

```bash
docker tag stronghold-protocol-full:0.3.3-c7c5a7e0 stronghold-protocol:rollback
# 之后按上面 2)–4) 走；验收通过后那个版本号标签会被删掉，规范即生效
```

回滚时以 `stronghold-protocol:rollback` 启动容器，并恢复对应版本的状态备份（不能假定旧代码能读新版存档）。

<a id="15-更新"></a>

## 更新与验收

先正常停止游戏并备份状态目录和 `/etc/stronghold/game.env`，再更新程序；首次从不支持持久化的旧版升级时，等旧进程的对局结束。

构建模式须先在独立目录准备本次版本的 Vite 产物；在下面启动服务之前，按「生产前端构建」的顺序同步新资源及入口。源码模式无需此步骤。

```bash
sudo systemctl stop stronghold
# 此时备份 /var/lib/stronghold 和 /etc/stronghold/game.env 到你的私有备份位置
cd /opt/Stronghold-Protocol
git status --short
git pull --ff-only
npm ci --omit=dev
# 本机素材模式才需 node tools/setup.mjs；CDN 模式随代码更新发布清单即可。
# 构建模式：此时同步同版本的新 public/build/，保留旧哈希资源。
sudo systemctl start stronghold
```

若本机 setup 修改了 `data/assets.json`，先核对差异并备份，再恢复该生成文件后拉取；不要用整树重置覆盖配置和其他修改。回滚同时恢复对应版本的状态备份，不能假定旧代码能读取新版存档。

验收：

1. `curl -s http://127.0.0.1:3000/healthz`：版本、`assetsCdn`、`assetsManifest` 与在线统计符合部署配置；`curl -s http://127.0.0.1:3000/metrics`：`persist`、`workers`、`memory` 等进程诊断正常（该接口只对本机回环 / 私网应答）。
2. `curl -s http://127.0.0.1:3000/api/announcement`：`source.mode` 为 `agent`（无探针 feed 站点为 `panel`）；在面板发布后确认正文生效。
3. 浏览器打开游戏，创建并加入房间；确认 WebSocket 正常连接，刷新后可重连。
4. CDN 模式检查图片和音频请求带 `?v=`；预载窗口可导入资源包并显示结果。

## 排错与调优

| 现象 | 检查 |
|---|---|
| 端口占用 | 是否重复启动了 systemd、计划任务或手动进程；先停止重复进程 |
| 画面或声音缺失 | `node tools/doctor.mjs`；CDN 模式核对清单和资源 URL，本机模式补跑 setup |
| 面板已发布，游戏无公告 | 核对 `/api/announcement.source`、探针推送状态、文件路径和日志 `[announcement]`；见[公告排错](ANNOUNCEMENTS.md#排错) |
| 重启后无法恢复 | `/metrics.persist`（本机回环）和状态目录权限；是否挂载原持久卷；见[持久化说明](PERSISTENCE.md) |
| 游戏能访问，面板监控无数据 | 探针、令牌及 nginx 管理路由；见[监控接入](MONITORING.md) |
| CPU / 内存过高 | Worker 数量、队列与校验模式，见[性能说明](../development/PERFORMANCE.md) |
| 想知道开服电脑上传了多少流量 | 本机 / 局域网打开 `/healthz?traffic=1`，按类别看 `traffic.http` 与 `traffic.ws`；公网访问者只会拿到普通报告 |
| 素材地址里出现 `/_v/<tag>/` 前缀 | 这是本仓库的版本化地址（`server/assetVersion.js`）：素材字节没变前缀就不变、浏览器长期缓存，属正常现象；怀疑素材没更新时先确认服务器上真的换了文件 |

`SP_WS_COMPRESSION` 默认 `on`，可设 `off`；`SP_WORKERS` 控制模拟线程数，0 关闭，默认可用逻辑核心减 2、至少 1、最多 8。资源占用与真实并发有关，用 `/metrics` 观察 CPU、内存、队列与网络状况后调整，变量修改需重启。

`SP_ROOM_WORKERS`（默认 0，可选 1 到 SP_WORKERS，不得超过 SP_WORKERS，否则拒绝启动）启用按房间分组的模拟泳道：每个房间的模拟任务固定排进同一泳道的独立队列，不同房间的任务互不插队；对局本身仍留在主线程。开启后 `/metrics` 的 `workers.kind` 变为 `room-lanes`，并逐泳道给出房间数与任务明细。它只改变排队方式（队列隔离），不承诺任何性能收益；是否开启请结合 `/metrics` 的实测数据决定，变量修改需重启。

<!-- 保留旧文档锚点，外部链接继续到达对应说明。 -->
<a id="16-维护公告"></a>
公告完整流程移至 [ANNOUNCEMENTS.md](ANNOUNCEMENTS.md)。
<a id="17-素材-cdnr2可选"></a>
素材发布与缓存移至 [CDN.md](CDN.md)。
<a id="1-windows-小主机一步步"></a>
Windows 开服步骤移至 [HOME_SERVER.md](HOME_SERVER.md)。
<a id="2-让不在同一网络的朋友加入"></a>
家用网络接入移至 [HOME_SERVER.md](HOME_SERVER.md#2-家用网络接入)。
<a id="6-本地客户端素材可选"></a>
本地客户端素材见 [ASSETS.md](../development/ASSETS.md)。0.2.5 的官方战场场景同样不随 Git 仓库提供（提取结果是官方文件，`public/assets/local/scene/` 不提交）：需要时在有客户端的机器上运行 `node tools/setup.mjs --scenes`（或先 `python3 tools/local-extract/fetch_scenes.py` 再用提取环境的 Python 运行 `tools/local-extract/extract.py --only scene`）；没有场景时 3D 棋盘用程序生成的金属地块。
<a id="7-打包发布维护者"></a>
发行包制作移至 [PACKAGING.md](PACKAGING.md)。

## 昵称审查（可选模块，默认未启用）

**当前接线状态**：词表、密钥口径和校验实现完整保留，但运行时没有调用路径 —— `server/http/nickname.js`（`POST /api/nickname/validate`）未在 `server/http/routes.js` 注册，`server/http/nameModeration.js` 的路由工厂没有调用者，`server/moderation/chat.js` 的 `moderateChat` 只有测试引用，客户端也没有对昵称校验端点的请求。因此默认不启用敏感词审核，`words.enc` 与密钥在运行时不会被读取，不挂载密钥也不影响部署。

启用需要三件事：① 在 routes 注册校验路由；② 客户端在保存昵称前调用该端点；③ 按下节提供密钥。三者缺一，审核都不会生效。

启用后的行为：点击“开始”后，浏览器先向同源 `POST /api/nickname/validate` 提交 `{"name":"博士代号"}`，服务器通过才保存昵称并进入游戏。拒绝只回固定错误码，客户端显示“代号包含不适宜内容，请更换昵称”，并提示“如果你认为昵称没有问题，可以前往 GitHub 反馈”，提供本站仓库的 Bug 反馈链接；网络失败停留标题页，可重试。WebSocket `hello` 在创建会话、重连接管和改名前再次检查，不能靠跳过 HTTP 预检绕过。

词库来自 [konsheng/Sensitive-lexicon](https://github.com/konsheng/Sensitive-lexicon)，固定版本 `d967c30b053fa40b06c5a0dddf0be493f2dfae46` 的 17 份 `Vocabulary/*.txt` 与本站补充规则，已在部署前归一化、筛选、排序并去重，整合为唯一有效词表。42,812 条词先 gzip 压缩，再使用 AES-256-GCM 加密为 `server/moderation/lexicon/words.enc`；文件包含版本、随机 nonce、认证标签和密文，密钥独立保管。服务端在首次校验时只在内存中解密一次（懒初始化，不在启动时加载），再编译原有字典树及片段集合；每次昵称和聊天审核不进行解密，也不请求外部服务。空词、单字、超过昵称长度的词和已确认误伤的普通称呼、食物、游戏用语等词条在整合时排除（按完整词条删除，违规长词仍独立保留）；筛选记录、上游原始文件摘要及合并文件摘要见同目录 `SOURCE.json`，完整 MIT 许可证见 `LICENSE`。英文及纯数字按完整片段匹配，全角、零宽、大小写及插入符号在比较时归一化。词表仍可能误伤，按实际反馈维护规则。

**密钥部署（启用审核前必须完成，默认未启用时可省略）**：本次迁移生成的随机密钥只保存在开发机 `.state/moderation.key`，不随 Git、发行包或镜像分发。把同一份密钥通过私有渠道复制到每台服务器，例如 `/etc/stronghold/moderation.key`，赋予游戏运行账号只读权限（如 `root:stronghold`、`0640`），并在环境文件中设置 `SP_MODERATION_KEY_FILE=/etc/stronghold/moderation.key`。也可将 64 位十六进制值配置到 `SP_MODERATION_KEY`，该变量优先于密钥文件；默认读取项目根目录 `.state/moderation.key`。不要在服务器重新生成密钥：随机新密钥无法解开现有词表，除非同时用同一密钥重新加密词表（`node tools/encrypt-lexicon.mjs`，会改写 `words.enc` 并需要同步 `SOURCE.json` 的摘要记录）。缺少密钥、密钥错误或词表损坏不会阻止启动：词表在首次校验时才解密，缺密钥或密钥错误会在该次校验抛错（不会降级为不审核），容器仍显示健康。默认未启用审核时缺密钥没有任何影响。密钥需纳入私有备份；不要提交、输出到日志或放入公开静态目录。启用审核时 Docker 需要只读挂载密钥文件，并设置容器内的 `SP_MODERATION_KEY_FILE`。

**仅服务端持有词库**：不放入 `shared/`、`data/`、`public/`、`server/sim/`、浏览器资源包或 CDN，不开放下载、列举或命中详情接口。维护规则时在仓库外编辑 UTF-8 文本（每行一个字面词，不支持正则，`#` 开头为注释），在已配置密钥的环境中运行 `node tools/encrypt-lexicon.mjs /私有路径/words.txt server/moderation/lexicon/words.enc`。同步 `SOURCE.json` 的词数、密文 SHA-256 与 `decodedSha256`，保留许可证并重启服务；只提交密文，不提交密钥和源明文。公开 CI 使用显式测试预加载器 `node --import ./test/helpers/moderation-fixture.js --test`，在未配置真实密钥时创建独立的小型测试词表，不需要生产密钥；正常启动不加载测试词表。HTTP 预检按网络限流，与房间状态接口预算分离。

加密保护的是当前文件，无法收回之前已公开的明文或 Base64 版本。旧 Git 历史、远程平台缓存及已有克隆需分别处理；密钥泄漏后应重新加密并更换部署密钥。公开上游词库本身仍可独立获取。

**反向代理**（仅在启用审核后生效）：`/api/nickname/validate` 必须转发到游戏 Node，并关闭缓存。在同机 `/api/` 已转发给 sp-portal 的部署中，增加 `location = /api/nickname/validate` 精确规则（参照 `scripts/nginx.conf.example`），避免被面板路由接走。不要用仓库根目录作为静态站点根目录。

标题页提交后显示校验结果；服务端在首次 hello、重复 hello 改名和令牌重连时最终检查，拒绝发生在创建或接管会话之前。旧保存昵称命中词表时回到标题页修改。新增规则不会主动踢出正在游戏中的玩家；其下次登录或重连按新规则校验。

### 局内聊天

局内文字聊天已整分支移出，相关环境变量（`SP_CHAT_ENABLED`、`SP_CHAT_LOG_*`）与 `/metrics.chatLog` 不再提供；「交流」只保留独立的表情面板。

## 同盟房间收录到联机站

可选的一键提交入口与两端鉴权、限流配置见 [PORTAL_ROOMS.md](PORTAL_ROOMS.md)。未配置时不启用。