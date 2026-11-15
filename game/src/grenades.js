// grenades.js: grenade projectiles, flash bursts, and temporary smoke zones.
import * as THREE from 'three';
import { losBlocked } from './map.js';

const _forward = new THREE.Vector3();
const _to = new THREE.Vector3();
const _old = new THREE.Vector3();

function eyeHeight(actor) {
  return actor.crouch ? 1.0 : 1.55;
}

function collidersOf(ctx) {
  return ctx.map?.colliders || ctx.colliders || [];
}

function insideCollider(pos, collider) {
  const min = collider.min || collider.bounds?.min;
  const max = collider.max || collider.bounds?.max;
  if (min && max) return pos.x >= min.x && pos.x <= max.x && pos.y >= min.y && pos.y <= max.y && pos.z >= min.z && pos.z <= max.z;
  const p = collider.pos || collider.position || collider.center;
  const h = collider.half || collider.halfExtents || collider.size;
  if (!p || !h) return false;
  const hx = h.x !== undefined ? h.x : h.width / 2;
  const hy = h.y !== undefined ? h.y : h.height / 2;
  const hz = h.z !== undefined ? h.z : h.depth / 2;
  return Math.abs(pos.x - p.x) <= hx && Math.abs(pos.y - p.y) <= hy && Math.abs(pos.z - p.z) <= hz;
}

export function throwGrenade(state, actor, kind, ctx) {
  if (!actor?.alive || !['flash', 'smoke'].includes(kind) || !actor.grenades || actor.grenades[kind] <= 0) return false;
  actor.grenades[kind] -= 1;
  const pos = new THREE.Vector3(actor.pos.x, actor.pos.y + eyeHeight(actor), actor.pos.z);
  _forward.set(-Math.sin(actor.yaw) * Math.cos(actor.pitch), Math.sin(actor.pitch), -Math.cos(actor.yaw) * Math.cos(actor.pitch));
  const vel = _forward.multiplyScalar(14).add(new THREE.Vector3(0, 4.5, 0));
  state.grenadeProjectiles = state.grenadeProjectiles || [];
  state.grenadeProjectiles.push({ kind, pos, vel: vel.clone(), fuse: 1.6, age: 0, ownerId: actor.id });
  if (ctx.audio) ctx.audio.play(`grenade-throw-${kind}`);
  return true;
}

function popFlash(state, projectile, ctx) {
  const point = projectile.pos;
  const colliders = collidersOf(ctx);
  for (const actor of state.actors) {
    if (!actor.alive) continue;
    _to.set(actor.pos.x, actor.pos.y + eyeHeight(actor), actor.pos.z).sub(point);
    const distance = _to.length();
    if (distance > 30) continue;
    _to.normalize();
    const facing = new THREE.Vector3(-Math.sin(actor.yaw) * Math.cos(actor.pitch), Math.sin(actor.pitch), -Math.cos(actor.yaw) * Math.cos(actor.pitch));
    const visible = !losBlocked(point, { x: actor.pos.x, y: actor.pos.y + eyeHeight(actor), z: actor.pos.z }, colliders);
    if (!visible || (distance >= 3 && facing.dot(_to.clone().negate()) <= 0.2)) continue;
    const blindness = Math.max(0.3, Math.min(2.2, 2.2 - distance * 0.05));
    actor.flashUntil = ctx.now + blindness;
    actor.flash = Math.max(actor.flash || 0, 1);
    if (actor.isHuman && ctx.audio) ctx.audio.play('flash-ring', { duration: blindness });
  }
}

function popSmoke(state, projectile, ctx) {
  const geometry = new THREE.SphereGeometry(4, 12, 8);
  const material = new THREE.MeshBasicMaterial({ color: 0x657366, transparent: true, opacity: 0.48, depthWrite: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(projectile.pos);
  if (ctx.scene) ctx.scene.add(mesh);
  state.smokeZones = state.smokeZones || [];
  state.smokeZones.push({ pos: { x: projectile.pos.x, y: projectile.pos.y, z: projectile.pos.z }, radius: 4, expires: ctx.now + 12, mesh });
}

export function updateGrenades(state, ctx, dt) {
  const colliders = collidersOf(ctx);
  const live = [];
  for (const projectile of state.grenadeProjectiles || []) {
    projectile.age += dt;
    projectile.fuse -= dt;
    _old.copy(projectile.pos);
    projectile.vel.y -= 12 * dt;
    projectile.pos.addScaledVector(projectile.vel, dt);
    let hardImpact = false;
    for (const collider of colliders) {
      if (!insideCollider(projectile.pos, collider)) continue;
      projectile.pos.copy(_old);
      projectile.vel.multiplyScalar(0.45);
      projectile.vel.y = Math.abs(projectile.vel.y);
      hardImpact = true;
      break;
    }
    if (projectile.vel.length() < 1) projectile.vel.set(0, 0, 0);
    const pop = projectile.fuse <= 0 || (hardImpact && projectile.age >= 0.4);
    if (!pop) {
      live.push(projectile);
      continue;
    }
    if (projectile.kind === 'flash') popFlash(state, projectile, ctx);
    else popSmoke(state, projectile, ctx);
    if (ctx.audio) ctx.audio.play('grenade-pop');
  }
  state.grenadeProjectiles = live;
  updateSmokeMeshes(state, ctx, dt);
}

export function inSmoke(state, pos) {
  for (const zone of state.smokeZones || []) {
    if (zone.expires <= state.time) continue;
    const dx = pos.x - zone.pos.x;
    const dy = pos.y - zone.pos.y;
    const dz = pos.z - zone.pos.z;
    if (dx * dx + dy * dy + dz * dz <= zone.radius * zone.radius) return true;
  }
  return false;
}

export function updateSmokeMeshes(state, ctx, dt) {
  const zones = state.smokeZones || [];
  for (let i = zones.length - 1; i >= 0; i -= 1) {
    const zone = zones[i];
    if (zone.expires > ctx.now) continue;
    if (zone.mesh) {
      ctx.scene?.remove(zone.mesh);
      zone.mesh.geometry.dispose();
      zone.mesh.material.dispose();
    }
    zones.splice(i, 1);
  }
}
