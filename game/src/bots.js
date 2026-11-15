// Sixth fix pass: correct bot aim, movement, and freeze-time behavior.
// Fifth fix pass: reduce floating bot name tag size.
// bots.js — bot actors, perception, team plans, movement, and combat decisions.
import * as THREE from 'three';
import { TEAM, PHASE } from './state.js';
import { resolveCollision, losBlocked, findPath, nearestWaypoint } from './map.js';
import { fireWeapon } from './weapons.js';
import { eyePos } from './player.js';

export const BOT_DIFFICULTY = {
  reactionMin: 0.25,
  reactionMax: 0.6,
  accuracy: 1.0,
};

const BOT_NAMES = {
  pruners: ['Fern', 'Moss', 'Bramble', 'Thistle'],
  keepers: ['Root', 'Stem', 'Petal', 'Thorn', 'Warden'],
};
const WAYPOINT_HALF = new THREE.Vector3(0.36, 0.9, 0.36);

function spawnFor(ctx, team, index) {
  const spawns = ctx.map.spawns;
  const candidates = Array.isArray(spawns)
    ? spawns.filter((spawn) => !spawn.team || spawn.team === team)
    : spawns[team] || [];
  const spawn = candidates[index % Math.max(1, candidates.length)] || { x: 0, y: 0, z: 0 };
  const pos = spawn.pos || spawn;
  return new THREE.Vector3(pos.x, pos.y ?? 0, pos.z);
}

function makeNameSprite(name) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  context.fillStyle = 'rgba(7, 15, 17, 0.78)';
  context.fillRect(4, 5, 248, 54);
  context.font = 'bold 28px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#f3f4e9';
  context.fillText(name, 128, 32);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  sprite.scale.set(0.78, 0.2, 1);
  sprite.position.y = 2.28;
  return sprite;
}

function makeBotMesh(team, name) {
  const group = new THREE.Group();
  const color = team === TEAM.PRUNERS ? '#e2543e' : '#3fa796';
  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.34, 0.75, 4, 8),
    new THREE.MeshStandardMaterial({ color, roughness: 0.72 }),
  );
  torso.position.y = 0.83;
  group.add(torso);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.23, 12, 10),
    new THREE.MeshStandardMaterial({ color: team === TEAM.KEEPERS ? '#c6c6a9' : '#d3a17f' }),
  );
  head.position.y = 1.52;
  group.add(head);
  const gun = new THREE.Mesh(
    new THREE.BoxGeometry(0.13, 0.13, 0.72),
    new THREE.MeshStandardMaterial({ color: '#283235', metalness: 0.45, roughness: 0.52 }),
  );
  gun.position.set(0.27, 1.02, -0.43);
  group.add(gun);
  group.add(makeNameSprite(name));
  return { group, head };
}

function getWeaponAmmo(weaponId) {
  const defaults = { dibber: [12, 48], aphid: [30, 90], secateur: [24, 72] };
  return defaults[weaponId] || [20, 60];
}

export function createBots(state, ctx) {
  const actors = [];
  const prunerWeapons = ['secateur', 'secateur', 'aphid', 'aphid'];
  const keeperWeapons = ['secateur', 'secateur', 'secateur', 'aphid', 'aphid'];
  for (const [team, names, weapons] of [
    [TEAM.PRUNERS, BOT_NAMES.pruners, prunerWeapons],
    [TEAM.KEEPERS, BOT_NAMES.keepers, keeperWeapons],
  ]) {
    names.forEach((name, index) => {
      const id = `bot-${name.toLowerCase()}`;
      const pos = spawnFor(ctx, team, index);
      const center = ctx.map.center || new THREE.Vector3();
      const { group, head } = makeBotMesh(team, name);
      group.position.copy(pos);
      const weaponId = weapons[index];
      const [magAmmo, reserveAmmo] = getWeaponAmmo(weaponId);
      const skill = THREE.MathUtils.clamp(0.45 + (index - 2) * 0.075, 0.05, 0.75);
      const actor = {
        id, name, team, isHuman: false, alive: true, hp: 100, maxHp: 100,
        armor: team === TEAM.KEEPERS && index < 2 ? 50 : 0,
        pos, yaw: Math.atan2(pos.x - center.x, pos.z - center.z), pitch: 0,
        crouch: false, onGround: true, vel: new THREE.Vector3(), weaponId,
        magAmmo, reserveAmmo, reloading: false, reloadEnd: 0, flash: 0,
        grenades: { flash: 1, smoke: 1 }, hasKit: team === TEAM.KEEPERS && index < 2,
        fsm: 'advance', targetId: null, lastKnown: null, reactionAt: 0,
        path: [], pathIndex: 0, nextThink: 0, burstLeft: 0, nextShotAt: 0,
        speed: 4.6 + skill * 0.8, skill, mesh: group, headMesh: head,
        blackboard: { targetId: null, lastKnown: null, canSee: false, heardAt: null },
        stateSince: 0, nextDecision: 0, nextBurstAt: 0, holdPoint: null,
        lastProgressPos: pos.clone(), stalledFor: 0, failedRepaths: 0,
        assignedSite: null, lane: index % 2, peekUntil: 0,
      };
      state.actors.push(actor);
      actors.push(actor);
      if (ctx.scene) ctx.scene.add(group);
    });
  }
  return actors;
}

function distSq(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

function segmentHitsSphere(start, end, center, radius) {
  const segment = new THREE.Vector3().subVectors(end, start);
  const lengthSq = segment.lengthSq();
  if (lengthSq === 0) return distSq(start, center) <= radius * radius;
  const offset = new THREE.Vector3().subVectors(center, start);
  const t = THREE.MathUtils.clamp(offset.dot(segment) / lengthSq, 0, 1);
  const closest = start.clone().addScaledVector(segment, t);
  return distSq(closest, center) <= radius * radius;
}

function smokeBlocks(state, from, to) {
  return (state.smokeZones || []).some((zone) => {
    const center = zone.pos || zone.center || zone;
    const radius = zone.radius ?? zone.r ?? 5;
    return distSq(to, center) <= radius * radius || segmentHitsSphere(from, to, center, radius);
  });
}

function viewCone(actor, target) {
  const dx = target.pos.x - actor.pos.x;
  const dz = target.pos.z - actor.pos.z;
  const distance = Math.hypot(dx, dz) || 1;
  const forwardX = -Math.sin(actor.yaw);
  const forwardZ = -Math.cos(actor.yaw);
  return (forwardX * dx + forwardZ * dz) / distance > Math.cos(50 * Math.PI / 180);
}

function perceive(state, bot, ctx, now) {
  const board = bot.blackboard;
  board.canSee = false;
  const origin = eyePos(bot);
  const candidates = state.actors.filter((other) => other.alive && other.team !== bot.team);
  candidates.sort((a, b) => distSq(bot.pos, a.pos) - distSq(bot.pos, b.pos));
  for (const target of candidates) {
    if (distSq(bot.pos, target.pos) > 55 * 55) continue;
    if (!viewCone(bot, target)) continue;
    const targetEye = eyePos(target);
    if (losBlocked(origin, targetEye, ctx.map.colliders || [])) continue;
    if (smokeBlocks(state, origin, targetEye)) continue;
    board.targetId = target.id;
    board.lastKnown = target.pos.clone();
    board.canSee = true;
    bot.targetId = target.id;
    bot.lastKnown = target.pos.clone();
    if (!bot.reactionAt || bot._reactTarget !== target.id) {
      const delay = THREE.MathUtils.lerp(BOT_DIFFICULTY.reactionMax, BOT_DIFFICULTY.reactionMin, bot.skill);
      bot.reactionAt = now + delay;
      bot._reactTarget = target.id;
    }
    return;
  }
  if (board.heardAt && now - board.heardTime < 2.5) {
    board.lastKnown = board.heardAt.clone();
    bot.lastKnown = board.lastKnown.clone();
  }
}

function waypointPosition(point) {
  return point?.pos || point?.position || point;
}

function sitePosition(ctx, site) {
  const value = ctx.map.sites?.[site] || ctx.map.sites?.find?.((entry) => entry.id === site);
  return value?.plantPos || value?.pos || value?.center || value || ctx.map.center || new THREE.Vector3();
}

function setPath(bot, ctx, destination) {
  const waypoints = ctx.map.waypoints || [];
  const from = nearestWaypoint(waypoints, bot.pos);
  const to = nearestWaypoint(waypoints, destination);
  const pathIds = findPath(waypoints, from?.id ?? from, to?.id ?? to);
  bot.path = Array.isArray(pathIds)
    ? pathIds.map((entry) => typeof entry === 'object' ? waypointPosition(entry) : waypointPosition(waypoints.find((point) => point.id === entry))).filter(Boolean)
    : [];
  bot.pathIndex = 0;
  if (!bot.path.length) bot.path = [destination.clone ? destination.clone() : new THREE.Vector3(destination.x, destination.y || 0, destination.z)];
}

function transition(bot, next, now) {
  if (bot.fsm === next) return;
  bot.fsm = next;
  bot.stateSince = now;
  bot.stalledFor = 0;
  bot.failedRepaths = 0;
}

function decide(state, bot, ctx, now) {
  if (bot.flash > 0) return;
  const board = bot.blackboard;
  if (board.canSee && bot.fsm !== 'hold' && bot.fsm !== 'peek') {
    if (bot.fsm !== 'hunt') transition(bot, 'hunt', now);
  } else if (bot.team === TEAM.KEEPERS && state.spike.status === 'planted') {
    transition(bot, 'defuse', now);
  } else if (bot.team === TEAM.PRUNERS && state.spike.status === 'carried' && state.spike.carrierId === bot.id) {
    transition(bot, 'plant', now);
  } else if (bot.lastKnown && !board.canSee) {
    transition(bot, 'hunt', now);
  } else if (bot.hp < 34 && bot.fsm !== 'retreat') {
    transition(bot, 'retreat', now);
  } else if (bot.fsm === 'advance' && now >= bot.nextDecision) {
    transition(bot, bot.skill < 0.28 ? 'hold' : 'advance', now);
    bot.nextDecision = now + 2.5 + bot.skill * 2;
  }
}

function destinationFor(state, bot, ctx) {
  if (bot.fsm === 'hunt' && bot.lastKnown) return bot.lastKnown;
  if (bot.fsm === 'defuse' && state.spike.site) return sitePosition(ctx, state.spike.site);
  if (bot.fsm === 'plant') return sitePosition(ctx, bot.assignedSite || state.plan?.site || 'A');
  if (bot.fsm === 'retreat') return sitePosition(ctx, bot.assignedSite || state.plan?.site || 'A');
  if (bot.fsm === 'peek' && bot.lastKnown) return bot.lastKnown;
  const site = bot.assignedSite || state.plan?.site || 'A';
  const sitePos = sitePosition(ctx, site);
  const holds = ctx.map.holdPoints || ctx.map.waypoints || [];
  if (bot.fsm === 'hold' && holds.length) {
    const point = holds[(bot.lane + bot.id.length) % holds.length];
    return waypointPosition(point);
  }
  return sitePos;
}

function followPath(bot, ctx, destination, dt, speedScale = 1) {
  const current = bot.path?.[bot.pathIndex];
  if (!current || bot._pathGoal?.distanceTo?.(destination) > 1.5) {
    setPath(bot, ctx, destination);
    bot._pathGoal = new THREE.Vector3(destination.x, destination.y || 0, destination.z);
  }
  const target = bot.path[bot.pathIndex];
  if (!target) return false;
  const dx = target.x - bot.pos.x;
  const dz = target.z - bot.pos.z;
  const distance = Math.hypot(dx, dz);
  if (distance <= Math.max(0.6, bot.speed * speedScale * dt)) {
    bot.pathIndex += 1;
    if (bot.pathIndex >= bot.path.length) return false;
  }
  const next = bot.path[bot.pathIndex];
  const ndx = next.x - bot.pos.x;
  const ndz = next.z - bot.pos.z;
  const length = Math.hypot(ndx, ndz) || 1;
  const desired = new THREE.Vector3(bot.pos.x + ndx / length * bot.speed * speedScale * dt, bot.pos.y, bot.pos.z + ndz / length * bot.speed * speedScale * dt);
  const resolved = resolveCollision(desired, WAYPOINT_HALF, ctx.map.colliders || []);
  bot.pos.copy(resolved);
  bot.yaw = Math.atan2(-ndx, -ndz);
  if (bot.mesh) bot.mesh.position.copy(bot.pos);
  return true;
}

function aimAt(bot, point, dt) {
  const dx = point.x - bot.pos.x;
  const dz = point.z - bot.pos.z;
  const desired = Math.atan2(-dx, -dz);
  let delta = ((desired - bot.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  bot.yaw += delta * Math.min(1, dt * 8);
  if (bot.mesh) bot.mesh.rotation.y = bot.yaw;
}

function steer(state, bot, ctx, dt, now) {
  if (bot.flash > 0) {
    bot.flash = Math.max(0, bot.flash - dt);
    bot.yaw += dt * 1.2;
    return;
  }
  const board = bot.blackboard;
  if (board.canSee && bot.targetId && now >= bot.reactionAt) {
    const target = state.actors.find((actor) => actor.id === bot.targetId && actor.alive);
    if (target) {
      aimAt(bot, target.pos, dt);
      if (now >= bot.nextShotAt && bot.magAmmo > 0) {
        if (bot.burstLeft <= 0) {
          bot.burstLeft = 3 + Math.floor(bot.skill * 4);
          bot.nextBurstAt = now + 0.4 + (1 - bot.skill) * 0.5;
        }
        const first = bot.burstLeft === 3 + Math.floor(bot.skill * 4);
        if (first && Math.random() < 0.3) bot._missOffset = 0.09 + Math.random() * 0.1;
        else bot._missOffset = 0;
        fireWeapon(state, bot, { ...ctx, botSpreadMultiplier: (1.6 - bot.skill) * BOT_DIFFICULTY.accuracy, botMissOffset: bot._missOffset });
        bot.burstLeft -= 1;
        bot.nextShotAt = now + Math.max(0.08, 0.16 - bot.skill * 0.07);
        if (bot.burstLeft === 0) bot.nextShotAt = Math.max(bot.nextShotAt, bot.nextBurstAt);
      }
      if (distSq(bot.pos, target.pos) > 12 * 12) {
        // Keep pressure on distant visible enemies while moving at half speed.
        followPath(bot, ctx, bot.lastKnown || target.pos, dt, 0.5);
      }
      return;
    }
  }
  const destination = destinationFor(state, bot, ctx);
  if (bot.fsm === 'defuse' && state.spike.status === 'planted' && distSq(bot.pos, destination) < 4) return;
  if (bot.fsm === 'plant' && distSq(bot.pos, destination) < 4) return;
  const wasMoving = followPath(bot, ctx, destination, dt);
  const progress = bot.lastProgressPos.distanceTo(bot.pos);
  if (progress < 0.02 && wasMoving) bot.stalledFor += dt;
  else {
    bot.stalledFor = 0;
    bot.lastProgressPos.copy(bot.pos);
  }
  if (bot.stalledFor > 2) {
    bot.failedRepaths += 1;
    bot.stalledFor = 0;
    if (bot.failedRepaths >= 2) transition(bot, 'hold', now);
    else setPath(bot, ctx, destination);
  }
}

function animate(bot, dt) {
  if (!bot.mesh) return;
  bot.mesh.position.copy(bot.pos);
  const label = bot.mesh.children[bot.mesh.children.length - 1];
  if (label) label.visible = true;
  const range = bot._viewer ? distSq(bot.pos, bot._viewer.pos) : 100;
  if (label && range > 24 * 24) label.visible = false;
  bot.mesh.traverse((child) => {
    if (child.isMesh) child.rotation.x = 0;
  });
}

export function updateBots(state, ctx, dt) {
  // Bots remain fully idle during freeze, matching the human firing restriction.
  if (state.phase === PHASE.FREEZE) return;
  const now = ctx.now ?? state.time ?? 0;
  for (const bot of state.actors) {
    if (bot.isHuman || !bot.alive) continue;
    if (now >= bot.nextThink) {
      perceive(state, bot, ctx, now);
      decide(state, bot, ctx, now);
      bot.nextThink = now + 0.12 + (1 - bot.skill) * 0.04;
    }
    steer(state, bot, ctx, dt, now);
    animate(bot, dt);
  }
}

export function assignPlan(state, site) {
  const chosenSite = site || 'A';
  const defenders = state.actors.filter((actor) => !actor.isHuman && actor.team === TEAM.KEEPERS && actor.alive);
  const rush = state.mode === 'shot' && state.rng ? state.rng() < 0.2 : false;
  state.plan = {
    site: chosenSite,
    defendersA: [],
    defendersB: [],
  };
  defenders.forEach((bot, index) => {
    const siteForBot = rush ? (index < 4 ? chosenSite : chosenSite === 'A' ? 'B' : 'A') : index < 3 ? 'A' : 'B';
    bot.assignedSite = siteForBot;
    state.plan[siteForBot === 'A' ? 'defendersA' : 'defendersB'].push(bot.id);
    bot.fsm = 'advance';
    bot.stateSince = state.time || 0;
  });
  for (const bot of state.actors.filter((actor) => !actor.isHuman && actor.team === TEAM.PRUNERS)) {
    bot.assignedSite = chosenSite;
    bot.fsm = 'advance';
  }
  return state.plan;
}

export function onPlant(state, site) {
  const position = state.map?.sites?.[site];
  for (const bot of state.actors.filter((actor) => !actor.isHuman && actor.alive && actor.team === TEAM.KEEPERS)) {
    bot.assignedSite = site;
    bot.fsm = 'rotate';
    bot.lastKnown = position?.pos || position?.center || null;
    bot.path = [];
  }
}

export function onDeath(state, victimId) {
  const victim = state.actors.find((actor) => actor.id === victimId);
  if (!victim) return;
  const teammate = state.actors
    .filter((actor) => !actor.isHuman && actor.alive && actor.team === victim.team && actor.id !== victimId)
    .sort((a, b) => distSq(a.pos, victim.pos) - distSq(b.pos, victim.pos))[0];
  if (!teammate) return;
  teammate.lastKnown = victim.pos.clone();
  teammate.blackboard.lastKnown = teammate.lastKnown.clone();
  teammate.fsm = 'peek';
  teammate.stateSince = state.time || 0;
  teammate.peekUntil = (state.time || 0) + 2.5;
  teammate.path = [];
}

export function noteGunshot(state, pos) {
  for (const bot of state.actors) {
    if (bot.isHuman || !bot.alive || distSq(bot.pos, pos) > 25 * 25) continue;
    bot.blackboard.heardAt = new THREE.Vector3(pos.x, pos.y, pos.z);
    bot.blackboard.heardTime = state.time || 0;
  }
}
