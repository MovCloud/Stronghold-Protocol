// server/match/uniteWavesHook.js — the neutral registration point for the OPTIONAL multi-wave 联防 module
// (server/match/uniteWaves.js, the SiderLock fork). Mainline two-round relay planning (server/match/unite.js) is the
// default: every hook below stays null unless that module has been imported, and nothing in server/ imports it — only
// an opt-in entry point (a server build or a test importing uniteWaves.js) activates it. Keeping the hooks in their
// own module lets the mainline files consult the optional planner WITHOUT importing it, so a default build never
// even loads the optional module and its import cannot have side effects on ordinary rooms.

/** @type {{
 *   planUnites: null | ((m: any, results: Map<string, object>) => object[]),
 *   nextUnitePlan: null | ((plan: object, result: object) => object | null),
 *   uniteBattleOpts: null | ((m: any, plan: object, timeLimit: number) => { wave: object, players: object[] }),
 *   uniteReserveHelpers: null | ((plan: object) => object[]),
 *   plannedUniteSurvivors: null | ((plan: object) => Map<string, number>),
 * }} */
export const uniteWavesHook = { planUnites: null, nextUnitePlan: null, uniteBattleOpts: null, uniteReserveHelpers: null, plannedUniteSurvivors: null };

/** Called by server/match/uniteWaves.js at import time: registering the planners is the module's opt-in. */
export function registerUniteWaves(api) {
  uniteWavesHook.planUnites = api.planUnites;
  uniteWavesHook.nextUnitePlan = api.nextUnitePlan;
  uniteWavesHook.uniteBattleOpts = api.uniteBattleOpts;
  uniteWavesHook.uniteReserveHelpers = api.uniteReserveHelpers;
  uniteWavesHook.plannedUniteSurvivors = api.plannedUniteSurvivors;
}
