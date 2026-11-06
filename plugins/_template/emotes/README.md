# 表情包模板（轮盘的一页）· Emote page template

复制此目录到 `plugins/ciallo/`（文件夹名就是插件的 id：2–32 个小写字母、数字和 `-`）。`emotes.json` 里的 id 按 `emote_<插件 id>_<slug>` 写成 `ciallo`，改名时一起改。以 `_` 开头的目录（比如这个）永远不会被加载。

一个文件 = 轮盘的一页（3×2 共 6 格），文件名必须是 `emotes.json`，一个插件最多声明 1 个文件。轮盘本身在核心里（`public/js/ui/emotes.js`）——插件没有界面插槽（`shared/plugins/manifest.js` UI_SLOT_IDS），所以插件只能贡献一页数据，不能画轮盘。

图片必须由插件自己的 `assets` 部件提供，写在 `ui` 容器下、本页的分组里（`emoticon/<插件 id>/<picId>`）：

```json
"permissions": ["assets.add"],
"assets": {
  "ui": { "emoticon/ciallo/pic_ciallo_murasame_battle": "media/murasame.png" }
}
```

客户端从 visual set 的文件表（`overlays[].files`）读到本页的文件，按 hash 取；图片没有列出时不会请求，轮盘显示本页的标题（`name`）。`label` 是页文件里的字符串：cosmetic 插件不能携带语言包（`i18n` 部件不属于它）。

生成同样的骨架：`node tools/plugin.mjs new emotes <id>`；检查：`node tools/plugin.mjs check <your-id>`。

**不要把官方游戏的图片放进插件。** 自己画，或引用本安装已有的素材。

格式和错误：`docs/PLUGINS.md` §10c（一页一页的轮盘、命名空间 id、文件表、缺图时的回退）。
