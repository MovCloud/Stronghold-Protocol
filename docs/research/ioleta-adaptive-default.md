# Ioleta experimental procurement and adaptive formation

This upstream proposal ports the accepted combination from YuliCao/Stronghold-Protocol#3 onto TempesTKF master at 61c6e614. It excludes fork-specific lobby, matchmaking, room-retention and asset-import changes. The default switch is proposed for upstream review, not an already accepted upstream policy.

## Runtime behavior

- Ioleta AI and human AI takeover default to experimental procurement and adaptive formation. Other strategies retain upstream procurement and use the learned formation candidate. Explicit botIoletaPolicy: 'legacy' preserves upstream procurement weights; botFormationMode: 'legacy' or botFormationEnabled: false bypasses taught candidates.
- Procurement targets three deputy / three steadfast / two precision first, or two deputy / three steadfast / three precision. Disabled bonds remove their target bonuses; arcane and swift are alternatives. Core merges, affordable upgrades and bounded searches are evaluated by stage, with an affordable L1 exit from R7. No game data or combat rules change.
- Ordinary R1–13 demonstrated maps receive role/terrain, healing and contact-support candidates. Adaptive orders the old default first, then learned/contact/refined plans and parameter variants, de-duplicated by tile AND direction. The first three candidates are evaluated before a completed zero-leak result can stop expansion. Total deterministic tick budget is 12 times the per-candidate cap, checked after each started candidate finishes. Ties retain the earlier candidate.
- Boss, hidden and unknown maps do not use learned profiles. Existing fork improvements to incoming-facing preferences and preview failure rejection are included; this is not a claim of byte-identical layout behavior to upstream for all modes.
- Server, host-browser and Worker rehearsals share limits; delegation failure uses the same inputs and limits on the server. Optional guards/medics repair switches remain off by default. No pool/trio modes or production switch to skip unite are added.

## Sources and assumptions

Procurement follows the contributor's community-strategy reference “精助坚 4.0” (凌溯／眠屿) and subsequent priorities. Formation profiles derive from 42 contributor-confirmed layouts: five examples per map train role frequencies; the sixth is held out. See [layout evidence](layout-demonstrations.json). Run node tools/layout-lab/learn.mjs to regenerate profiles and node tools/layout-lab/evaluate.mjs for held-out geometry checks.

[ASSUMED] All purchase scores, phase thresholds, role weights, contact preferences and rehearsal stopping limits are AI heuristics, not official rules or proven optima. Game mechanics continue to use generated records and the existing simulation. Zero-leak early stopping does not maximize kills or future rounds.

## Historical comparison, not a rerun of this rebased branch

[Statistics](ioleta-upstream030-quick-2026-10-16.json) compare unmodified upstream 0.3.0 bot.js at c24e17ee against experimental + adaptive in a common engine, with upstream teammates in both groups. Forty runs total: two difficulties × two variants × ten paired seeds (2001–2010). Unite is skipped; only Ioleta is scored, up to R11.

| Difficulty | Baseline leaks | New leaks | Reduction | Paired exposure |
|---|---:|---:|---:|---|
| HARD | 159 | 30 | 81.1% | 10 pairs at each of R1–11 |
| ABYSS | 386 | 144 | 62.7% | R1–8: 10 pairs; R9: 9; R10: 7; R11: 4 |

The chart label “40局测试” means 40 total runs across BOTH difficulties, not 40 per difficulty. ABYSS totals sum round-by-round common exposure; restricting to the four pairs that both finished R11 gives 127→79 leaks (37.8%). Neither percentage measures full-match win rate. Preparation costs increase: full-R11 paired samples average 134→227 ms per prep in HARD and 148→296 ms in ABYSS on the original machine. Hardware, sample size, survival filtering and disabled unite limit generalization.

Separate historical fixed-procurement comparisons favored adaptive in HARD but showed an ABYSS R11 regression (96→118 leaks versus combined across 17 complete pairs). The full-match and late-wave tradeoffs need upstream playtesting. This Draft proposes a reviewable implementation; the maintainer can choose whether to enable it by default.
