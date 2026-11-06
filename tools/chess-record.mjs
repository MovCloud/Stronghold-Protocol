// Shared compile helpers for fixed roster overlays (rem-data / other extensions).
import { buildSkill, statsFrom, interpolateAttrs, baseTalentList, traitRecord, rangeGrid, immunitiesOf,
  unlocked, bestCandidate, moduleAttr, moduleTalentChanges, splitModuleParts, OPERATOR_POTENTIAL, withPotential } from './build-data.mjs';
import { composeStats, composeTalents } from '../shared/loadoutRecord.js';

const clone = x => structuredClone(x);

// Ordinary-battle modules only: mode-restricted parts never enter the live blackboards.
function ordinaryModulePhase(ctx, id, equipLevel) {
  const raw = ctx.battleEquipTable?.[id]?.phases.find(p => p.equipLevel === equipLevel);
  return raw ? { ...raw, parts: raw.parts.filter(p => !p.validInGameTag && !p.validInMapTag) } : null;
}
function moduleChoices(ctx, char, status, label, spec) {
  if (!status.equipLevel) return [];
  const { phase, level, equipLevel } = status;
  return (ctx.uniequipTable?.charEquip[char.charId] || []).flatMap(id => {
    const meta = ctx.uniequipTable.equipDict[id], ph = ordinaryModulePhase(ctx, id, equipLevel);
    if (meta.type === 'INITIAL' || !ph || spec.excludedModuleIds?.includes(id)) return [];
    const { op } = splitModuleParts(ph);
    const hasTrait = op.some(p => bestCandidate(p.overrideTraitDataBundle?.candidates, phase, level, (ctx.potRank ?? OPERATOR_POTENTIAL)));
    return [{ uniEquipId: id, name: meta.uniEquipName,
      typeName: `${meta.typeName1}-${({ A: 'α', D: 'Δ' })[meta.typeName2] || meta.typeName2}`,
      typeIcon: meta.typeIcon, icon: meta.uniEquipIcon || id, isDefault: id === spec.defaultModuleId, level: equipLevel,
      attr: moduleAttr(ph),
      traitOverride: hasTrait ? traitRecord(ctx, char, phase, level, op, label, (ctx.potRank ?? OPERATOR_POTENTIAL)).trait : null,
      talentChanges: moduleTalentChanges(ctx, op, phase, level, label, (ctx.potRank ?? OPERATOR_POTENTIAL)) }];
  });
}

export function compileChess(ctx, config, spec, gold, index) {
  const prefix = spec.prefix;
  if (!prefix) throw new Error('compileChess requires spec.prefix');
  if (!spec.garrison) throw new Error('compileChess requires spec.garrison');
  const c = ctx.charTable[spec.charId], baseId = `chess_${prefix}_${spec.key}_a`, goldenId = `chess_${prefix}_${spec.key}_b`;
  const chessId = gold ? goldenId : baseId;
  const st = config.economy.chessStatus[spec.tier][gold ? 'golden' : 'normal'];
  const status = { phase: st.phase, level: st.level, skillLevel: st.skillLevel, equipLevel: st.equipLevel };
  const attrs = withPotential(c, interpolateAttrs(c, status.phase, status.level), (ctx.potRank ?? OPERATOR_POTENTIAL), chessId);
  const { trait, classify } = traitRecord(ctx, c, status.phase, status.level, [], chessId, (ctx.potRank ?? OPERATOR_POTENTIAL));
  const skills = c.skills.flatMap((s, skillIndex) => {
    if (!unlocked(s.unlockCond, status.phase, status.level)) return [];
    const skill = buildSkill(ctx, s.skillId, status.skillLevel, null, chessId);
    skill.index = skillIndex; skill.overrideTokenKey = s.overrideTokenKey || null;
    return [{ ...skill, isDefault: s.skillId === spec.skillId }];
  });
  const skill = clone(skills.find(s => s.isDefault)); delete skill.isDefault;
  const g = spec.garrison;
  const statsBase = statsFrom(attrs), talentsBase = baseTalentList(ctx, c, status.phase, status.level, chessId, (ctx.potRank ?? OPERATOR_POTENTIAL));
  const modules = gold ? moduleChoices(ctx, { ...c, charId: spec.charId }, status, chessId, spec) : [];
  const mod = modules.find(m => m.isDefault);
  return { chessId, baseId, goldenId, isGolden: gold, tier: spec.tier, identifier: 200 + index,
    isHidden: false, isDiy: false, visible: true, chessType: 'PRESET', shopSortId: 200 + index,
    backup: { charId: spec.charId, tmplId: null, skillIndex: skill.index, uniEquipId: spec.defaultModuleId, potRank: (ctx.potRank ?? OPERATOR_POTENTIAL) },
    charId: spec.charId, name: c.name, appellation: c.appellation, rarity: Number(c.rarity.replace('TIER_', '')),
    profession: c.profession, subProfessionId: c.subProfessionId, subProfessionName: spec.subName, position: c.position,
    nationId: c.nationId, bonds: [...spec.bonds], garrisonIds: [g.garrisonId],
    price: config.economy.chessPrice[spec.tier][gold ? 'golden' : 'normal'], sellPrice: 1,
    upgradeNum: gold ? 0 : 3, upgradeChessId: gold ? null : goldenId, status,
    stats: mod ? composeStats(statsBase, mod.attr) : statsBase, immunities: immunitiesOf(attrs), rangeId: c.phases[status.phase].rangeId,
    rangeGrid: rangeGrid(ctx, c.phases[status.phase].rangeId), ...classify, trait: mod?.traitOverride || trait, skill,
    skills, talents: mod ? composeTalents(talentsBase, mod.talentChanges) : talentsBase,
    tokens: spec.tokens ?? [], module: mod ? { id: mod.uniEquipId, name: mod.name, type: mod.typeName, level: mod.level, active: true } : null,
    assets: { avatar: gold ? `${spec.charId}_2` : spec.charId, portrait: `${spec.charId}_${gold ? 2 : 1}`, spine: spec.charId, skillIcon: skill.iconId, subProfIcon: `sub_${c.subProfessionId}_icon` },
    ...(gold ? { statsBase, traitBase: clone(trait), talentsBase, modules } : {}),
    extension: { id: spec.extensionId ?? 'roster-overlay', sourceRevision: ctx.source.revision, supportedSkills: skills.map(s => s.skillId) } };
}
