// Integration fix: publish HUD combat events and structured killfeed entries.
// combat.js: actor hit tests, damage, and pooled combat visuals.
import * as THREE from 'three';
import { losBlocked } from './map.js';
import { awardKill } from './economy.js';

const _v = new THREE.Vector3();
const _point = new THREE.Vector3();
const _center = new THREE.Vector3();
const _boxMin = new THREE.Vector3();
const _boxMax = new THREE.Vector3();

function raySphere(origin, dir, center, radius, maxDist) {
  _v.copy(origin).sub(center);
  const b = _v.dot(dir);
  const c = _v.lengthSq() - radius * radius;
  const h = b * b - c;
  if (h < 0) return Infinity;
  const near = -b - Math.sqrt(h);
  const far = -b + Math.sqrt(h);
  const t = near >= 0 ? near : far;
  return t >= 0 && t <= maxDist ? t : Infinity;
}

function rayBox(origin, dir, center, half, maxDist) {
  let lo = 0;
  let hi = maxDist;
  const ox = origin.x - center.x;
  const oy = origin.y - center.y;
  const oz = origin.z - center.z;
  for (const [o, d, h] of [[ox, dir.x, half.x], [oy, dir.y, half.y], [oz, dir.z, half.z]]) {
    if (Math.abs(d) < 1e-8) {
      if (o < -h || o > h) return Infinity;
      continue;
    }
    let a = (-h - o) / d;
    let b = (h - o) / d;
    if (a > b) [a, b] = [b, a];
    lo = Math.max(lo, a);
    hi = Math.min(hi, b);
    if (lo > hi) return Infinity;
  }
  return lo <= maxDist ? lo : Infinity;
}

function colliderBounds(collider) {
  if (!collider) return null;
  const min = collider.min || collider.bounds?.min;
  const max = collider.max || collider.bounds?.max;
  if (min && max) return { min, max };
  const p = collider.pos || collider.position || collider.center;
  const h = collider.half || collider.halfExtents || collider.size;
  if (!p || !h) return null;
  const hx = h.x !== undefined ? h.x : h.width / 2;
  const hy = h.y !== undefined ? h.y : h.height / 2;
  const hz = h.z !== undefined ? h.z : h.depth / 2;
  return { min: { x: p.x - hx, y: p.y - hy, z: p.z - hz }, max: { x: p.x + hx, y: p.y + hy, z: p.z + hz } };
}

export function createEffects(scene) {
  const fx = { scene, tracers: [], impacts: [], muzzle: null, maxTracers: 24, maxImpacts: 16 };
  const tracerMaterial = new THREE.LineBasicMaterial({ color: 0xffc56b, transparent: true, opacity: 0.9 });
  for (let i = 0; i < fx.maxTracers; i += 1) {
    const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(geometry, tracerMaterial.clone());
    line.visible = false;
    line.userData.life = 0;
    scene.add(line);
    fx.tracers.push(line);
  }
  for (let i = 0; i < fx.maxImpacts; i += 1) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffa84c, transparent: true }));
    mesh.visible = false;
    mesh.userData.life = 0;
    scene.add(mesh);
    fx.impacts.push(mesh);
  }
  fx.muzzle = new THREE.PointLight(0xffb24a, 0, 3, 2);
  fx.muzzle.userData.life = 0;
  scene.add(fx.muzzle);
  return fx;
}

export function raycastHit(state, origin, dir, maxDist, ignoreId, ctx = {}) {
  let nearest = maxDist;
  let result = null;
  const shooter = state.actors.find((a) => a.id === (ctx.shooterId ?? ignoreId));
  for (const actor of state.actors) {
    if (!actor.alive || actor.id === ignoreId || (shooter && actor.team === shooter.team)) continue;
    const p = actor.pos;
    const crouched = !!actor.crouch;
    _center.set(p.x, p.y + (crouched ? 1.0 : 1.55), p.z);
    let d = raySphere(origin, dir, _center, 0.22, nearest);
    if (d < nearest) {
      nearest = d;
      result = { actor, part: 'head', dist: d };
    }
    _center.set(p.x, p.y + (crouched ? 0.66 : 0.95), p.z);
    d = rayBox(origin, dir, _center, { x: 0.35, y: 0.5, z: 0.2 }, nearest);
    if (d < nearest) {
      nearest = d;
      result = { actor, part: 'torso', dist: d };
    }
    _center.set(p.x, p.y + 0.35, p.z);
    d = rayBox(origin, dir, _center, { x: 0.3, y: 0.35, z: 0.18 }, nearest);
    if (d < nearest) {
      nearest = d;
      result = { actor, part: 'limbs', dist: d };
    }
  }

  const colliders = ctx.map?.colliders || ctx.colliders || [];
  for (const collider of colliders) {
    const bounds = colliderBounds(collider);
    if (!bounds) continue;
    _boxMin.set(bounds.min.x, bounds.min.y, bounds.min.z);
    _boxMax.set(bounds.max.x, bounds.max.y, bounds.max.z);
    _center.set((_boxMin.x + _boxMax.x) / 2, (_boxMin.y + _boxMax.y) / 2, (_boxMin.z + _boxMax.z) / 2);
    const half = { x: (_boxMax.x - _boxMin.x) / 2, y: (_boxMax.y - _boxMin.y) / 2, z: (_boxMax.z - _boxMin.z) / 2 };
    const d = rayBox(origin, dir, _center, half, nearest);
    if (d < nearest) {
      nearest = d;
      result = { blocked: true, dist: d };
    }
  }
  if (!result) return null;
  _point.copy(origin).addScaledVector(dir, nearest);
  result.point = { x: _point.x, y: _point.y, z: _point.z };
  if (result.blocked) return result;
  result.blocked = false;
  return result;
}

export function applyDamage(state, victim, dmg, part, attackerId, ctx = {}) {
  if (!victim.alive) return;
  let remaining = dmg;
  if (victim.armor > 0) {
    const absorbed = Math.min(victim.armor, remaining * 0.5);
    victim.armor -= absorbed;
    remaining -= absorbed;
  }
  victim.hp = Math.max(0, victim.hp - remaining);
  const attacker = state.actors.find((a) => a.id === attackerId);
  if (victim.hp > 0) {
    if (attacker) state.events.push({ type: 'hit', actorId: attacker.id, targetId: victim.id, time: state.time });
    const direction = attacker ? Math.atan2(attacker.pos.x - victim.pos.x, attacker.pos.z - victim.pos.z) * 180 / Math.PI : 0;
    state.events.push({ type: 'damaged', actorId: victim.id, victimId: victim.id, direction, time: state.time });
    return;
  }
  victim.alive = false;
  victim.hp = 0;
  const attackerName = attacker?.name || 'Unknown';
  state.killfeed.push({ text: `${attackerName} eliminated ${victim.name}${part === 'head' ? ' (headshot)' : ''}`, killerName: attackerName, victimName: victim.name, weapon: attacker?.weaponId ?? '', time: state.time });
  if (attacker?.isHuman) awardKill(state, attackerId);
  if (state.spike?.carrierId === victim.id) {
    state.spike.status = 'dropped';
    state.spike.dropPos = { x: victim.pos.x, y: victim.pos.y, z: victim.pos.z };
    state.spike.carrierId = null;
  }
  state.events.push({ kind: 'death', victimId: victim.id });
  if (ctx.audio) ctx.audio.play('hit-kill');
}

export function addTracer(fx, from, to) {
  if (!fx || !fx.tracers?.length) return;
  const line = fx.tracers.find((item) => !item.visible) || fx.tracers[0];
  const a = line.geometry.attributes.position;
  a.setXYZ(0, from.x, from.y, from.z);
  a.setXYZ(1, to.x, to.y, to.z);
  a.needsUpdate = true;
  line.geometry.computeBoundingSphere();
  line.visible = true;
  line.material.opacity = 0.9;
  line.userData.life = 0.09;
}

export function addImpact(fx, point) {
  if (!fx || !fx.impacts?.length) return;
  const puff = fx.impacts.find((item) => !item.visible) || fx.impacts[0];
  puff.position.set(point.x, point.y, point.z);
  puff.scale.setScalar(1);
  puff.visible = true;
  puff.material.opacity = 0.95;
  puff.userData.life = 0.18;
}

export function muzzleFlash(fx, pos) {
  if (!fx?.muzzle) return;
  fx.muzzle.position.set(pos.x, pos.y, pos.z);
  fx.muzzle.intensity = 5;
  fx.muzzle.userData.life = 0.045;
}

export function updateEffects(fx, dt) {
  for (const line of fx.tracers) {
    if (!line.visible) continue;
    line.userData.life -= dt;
    line.material.opacity = Math.max(0, line.userData.life / 0.09);
    if (line.userData.life <= 0) line.visible = false;
  }
  for (const puff of fx.impacts) {
    if (!puff.visible) continue;
    puff.userData.life -= dt;
    puff.material.opacity = Math.max(0, puff.userData.life / 0.18);
    puff.scale.multiplyScalar(1 + dt * 3);
    if (puff.userData.life <= 0) puff.visible = false;
  }
  if (fx.muzzle?.userData.life > 0) {
    fx.muzzle.userData.life -= dt;
    fx.muzzle.intensity = Math.max(0, 5 * fx.muzzle.userData.life / 0.045);
  }
}
