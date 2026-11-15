// rounds.js — match flow, planting, defusing, and round outcome checks.
import { PHASE, TEAM, ROUND_TIME, FREEZE_TIME, FUSE_TIME, PLANT_TIME, DEFUSE_TIME, DEFUSE_KIT_TIME, WIN_ROUNDS, START_MONEY } from './state.js';
import { awardRound } from './economy.js';
import { updateGrenades } from './grenades.js';
import { assignPlan, onPlant } from './bots.js';
import { openBuyMenu, showBanner, showMatchEnd, closeBuyMenu } from './hud.js';

function spawnPosition(ctx, team, index) {
  const spawns = ctx.map.spawns;
  const entries = Array.isArray(spawns) ? spawns.filter((entry) => !entry.team || entry.team === team) : spawns[team] || [];
  const spawn = entries[index % Math.max(1, entries.length)] || { x: 0, y: 0, z: 0 };
  const pos = spawn.pos || spawn;
  return { x: pos.x, y: pos.y ?? 0, z: pos.z };
}

function humanActor(state) {
  return state.actors.find((actor) => actor.isHuman || actor.id === 'human');
}

function playAudio(ctx, name) {
  ctx.audio?.play?.(name);
}

function reasonText(reason) {
  return reason === 'time expired' ? 'TIME EXPIRED' : reason.toUpperCase();
}

function setSpikePlanted(state, ctx, site) {
  state.spike.status = 'planted';
  state.spike.site = site;
  state.spike.fuse = FUSE_TIME;
  state.spike.plantProgress = 1;
  state.spike.defuseProgress = 0;
  state.spike.defuserId = null;
  state.spike.plantedAt = state.time;
  state.killfeed.unshift({ text: `CANISTER PLANTED AT SITE ${site}`, time: state.time });
  onPlant(state, site);
  playAudio(ctx, 'plant');
}

export function startMatch(state, ctx) {
  state.scores = { pruners: 0, keepers: 0 };
  state.round = 1;
  state.playerMoney = START_MONEY;
  state.lossStreak = 0;
  state.winner = null;
  state.winReason = null;
  state.matchOver = false;
  state.events = [];
  startRound(state, ctx);
}

export function startRound(state, ctx) {
  state.phase = PHASE.FREEZE;
  state.freezeTimer = FREEZE_TIME;
  state.roundTimer = ROUND_TIME;
  state.roundEndTimer = 0;
  state.killfeed = state.killfeed || [];
  state.killfeed.length = 0;
  state.smokeZones = [];
  state.grenadeProjectiles = [];
  state.spike = {
    status: 'carried', site: null,
    carrierId: humanActor(state)?.alive ? 'human' : null,
    fuse: 0, plantProgress: 0, defuseProgress: 0, defuserId: null,
  };
  state.actors.forEach((actor, index) => {
    const pos = spawnPosition(ctx, actor.team, index);
    actor.pos.set ? actor.pos.set(pos.x, pos.y, pos.z) : actor.pos = pos;
    actor.alive = true;
    actor.hp = 100;
    actor.armor = 0;
    actor.vel?.set?.(0, 0, 0);
    actor.flash = 0;
    actor.path = [];
    actor.pathIndex = 0;
    actor.reloading = false;
    actor.grenades = { flash: 1, smoke: 1 };
    if (actor.isHuman) {
      actor.weaponId = actor.ownedWeaponId || actor.weaponId || 'dibber';
    }
    if (!actor.isHuman && actor._assignedWeaponId) actor.weaponId = actor._assignedWeaponId;
  });
  const human = humanActor(state);
  state.spike.carrierId = human?.alive ? human.id : state.actors.find((actor) => !actor.isHuman && actor.team === TEAM.PRUNERS)?.id || null;
  const plannedSite = state.mode === 'shot' && state.rng
    ? (state.rng() < 0.5 ? 'A' : 'B')
    : state.round % 2 === 1 ? 'A' : 'B';
  assignPlan(state, plannedSite);
  openBuyMenu(state);
  playAudio(ctx, 'round-start');
}

export function endRound(state, ctx, winnerTeam, reason) {
  if (state.phase === PHASE.ROUND_END || state.phase === PHASE.MATCH_END) return;
  state.phase = PHASE.ROUND_END;
  state.roundEndTimer = 4;
  state.scores[winnerTeam] += 1;
  state.winner = winnerTeam;
  state.winReason = reason;
  awardRound(state, winnerTeam);
  const title = `${winnerTeam.toUpperCase()} WIN THE ROUND`;
  showBanner(state, title, reasonText(reason));
  playAudio(ctx, winnerTeam === TEAM.PRUNERS ? 'win' : 'lose');
  closeBuyMenu();
  if (state.scores[winnerTeam] >= WIN_ROUNDS) {
    state.phase = PHASE.MATCH_END;
    state.matchOver = true;
    showMatchEnd(state, winnerTeam);
  }
}

function allDead(state, team) {
  return !state.actors.some((actor) => actor.team === team && actor.alive);
}

function siteAtActor(ctx, actor) {
  const sites = ctx.map.sites || {};
  for (const [site, value] of Object.entries(sites)) {
    const center = value.plantPos || value.pos || value.center || value;
    const dx = actor.pos.x - center.x;
    const dz = actor.pos.z - center.z;
    if (dx * dx + dz * dz <= (value.radius || 2.5) ** 2) return site;
  }
  return null;
}

function actorHoldingPlant(state, actor, ctx) {
  if (!actor.alive || state.spike.carrierId !== actor.id) return null;
  if (actor.isHuman) return ctx.input?.isDown?.('KeyE') ? siteAtActor(ctx, actor) : null;
  return actor.fsm === 'plant' ? siteAtActor(ctx, actor) || actor.assignedSite : null;
}

function actorHoldingDefuse(state, actor, ctx) {
  if (!actor.alive || actor.team !== TEAM.KEEPERS) return false;
  if (actor.isHuman) return ctx.input?.isDown?.('KeyE') || false;
  return actor.fsm === 'defuse';
}

function distanceSq(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

function updatePickup(state, dt) {
  if (state.spike.status !== 'dropped' || !state.spike.dropPos) return;
  const picker = state.actors.find((actor) => actor.alive && actor.team === TEAM.PRUNERS && distanceSq(actor.pos, state.spike.dropPos) <= 1.5 * 1.5);
  if (!picker) {
    state.spike.pickupProgress = 0;
    return;
  }
  state.spike.pickupProgress = (state.spike.pickupProgress || 0) + dt;
  if (state.spike.pickupProgress >= 1) {
    state.spike.status = 'carried';
    state.spike.carrierId = picker.id;
    state.spike.dropPos = null;
    state.spike.pickupProgress = 0;
    state.killfeed.unshift({ text: `${picker.name} RECOVERED THE CANISTER`, time: state.time });
  }
}

export function plantTick(state, ctx, dt) {
  if (state.phase !== PHASE.LIVE) return;
  updatePickup(state, dt);
  if (state.spike.status === 'carried') {
    const carrier = state.actors.find((actor) => actor.id === state.spike.carrierId);
    const site = carrier && actorHoldingPlant(state, carrier, ctx);
    if (!site) {
      state.spike.plantProgress = 0;
      return;
    }
    state.spike.plantSite = site;
    state.spike.plantProgress += dt / PLANT_TIME;
    if (state.spike.plantProgress >= 1) setSpikePlanted(state, ctx, site);
    return;
  }
  if (state.spike.status !== 'planted') return;
  const siteValue = ctx.map.sites?.[state.spike.site];
  const spikePos = siteValue?.plantPos || siteValue?.pos || siteValue?.center || siteValue;
  const defuser = state.actors.find((actor) => actorHoldingDefuse(state, actor, ctx)
    && spikePos && distanceSq(actor.pos, spikePos) <= (actor.isHuman ? 2.0 : 2.0) ** 2);
  if (!defuser) {
    state.spike.defuseProgress = 0;
    state.spike.defuserId = null;
    return;
  }
  state.spike.defuserId = defuser.id;
  const duration = defuser.hasKit ? DEFUSE_KIT_TIME : DEFUSE_TIME;
  state.spike.defuseProgress += dt / duration;
  if (state.spike.defuseProgress >= 1) {
    state.spike.status = 'defused';
    state.spike.defuseProgress = 1;
    endRound(state, ctx, TEAM.KEEPERS, 'canister defused');
  }
}

export function updateRounds(state, ctx, dt) {
  if (state.phase === PHASE.FREEZE) {
    state.freezeTimer = Math.max(0, state.freezeTimer - dt);
    if (state.freezeTimer === 0) {
      state.phase = PHASE.LIVE;
      closeBuyMenu();
    }
  } else if (state.phase === PHASE.LIVE) {
    state.roundTimer = Math.max(0, state.roundTimer - dt);
    if (state.spike.status === 'planted') state.spike.fuse = Math.max(0, state.spike.fuse - dt);
    plantTick(state, ctx, dt);
    updateGrenades(state, ctx, dt);
    if (state.phase !== PHASE.LIVE) return;
    if (allDead(state, TEAM.KEEPERS)) endRound(state, ctx, TEAM.PRUNERS, 'elimination');
    else if (allDead(state, TEAM.PRUNERS)) endRound(state, ctx, TEAM.KEEPERS, 'elimination');
    else if (state.spike.status === 'planted' && state.spike.fuse <= 0) endRound(state, ctx, TEAM.PRUNERS, 'canister detonated');
    else if (state.spike.status === 'defused') endRound(state, ctx, TEAM.KEEPERS, 'canister defused');
    else if (state.roundTimer <= 0 && state.spike.status !== 'planted') endRound(state, ctx, TEAM.KEEPERS, 'time expired');
  } else if (state.phase === PHASE.ROUND_END && !state.matchOver) {
    state.roundEndTimer -= dt;
    if (state.roundEndTimer <= 0) {
      state.round += 1;
      startRound(state, ctx);
    }
  }
}
