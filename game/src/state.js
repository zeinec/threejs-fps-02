// game/src/state.js: canonical match constants, state factory, and seeded RNG.
export const PHASE = { MENU: 'menu', FREEZE: 'freeze', LIVE: 'live', ROUND_END: 'roundEnd', MATCH_END: 'matchEnd' };
export const TEAM = { PRUNERS: 'pruners', KEEPERS: 'keepers' };
export const ROUND_TIME = 100;
export const FREEZE_TIME = 15;
export const FUSE_TIME = 35;
export const PLANT_TIME = 3;
export const DEFUSE_TIME = 5;
export const DEFUSE_KIT_TIME = 2.5;
export const WIN_ROUNDS = 7;
export const START_MONEY = 800;

export function createState() {
  return {
    phase: 'menu', round: 1, roundTimer: 100, freezeTimer: 15,
    scores: { pruners: 0, keepers: 0 }, lossStreak: 0, playerMoney: 800,
    actors: [], spike: { status: 'carried', site: null, carrierId: null, fuse: 0, plantProgress: 0, defuseProgress: 0, defuserId: null },
    smokeZones: [], killfeed: [], events: [], winner: null, winReason: '',
    time: 0, matchOver: false, seed: 1
  };
}

export function mulberry32(seed) {
  let value = seed >>> 0;
  return function random() {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
