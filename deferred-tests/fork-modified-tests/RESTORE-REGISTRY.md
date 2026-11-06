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
| `test/local-token-models.test.js` | 多处合并（自定义） | 0 |  |
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
