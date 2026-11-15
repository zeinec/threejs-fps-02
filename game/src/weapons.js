// weapons.js: weapon tuning, firing, reloads, and camera gun view models.
import * as THREE from 'three';
import { raycastHit, applyDamage, addTracer, addImpact, muzzleFlash } from './combat.js';

export const WEAPONS = {
  dibber: { name: 'Dibber', kind: 'pistol', damage: 34, headMult: 2, limbMult: 0.7, range: 25, falloff: 0.6, fireInterval: 0.16, mag: 12, reserve: 48, reloadTime: 1.1, spread: 0.012, moveSpread: 0.03, recoil: 0.35, auto: false, price: 0 },
  aphid: { name: 'Aphid', kind: 'smg', damage: 22, headMult: 2, limbMult: 0.7, range: 18, falloff: 0.55, fireInterval: 0.075, mag: 32, reserve: 96, reloadTime: 1.6, spread: 0.02, moveSpread: 0.055, recoil: 0.5, auto: true, price: 1500 },
  secateur: { name: 'Secateur', kind: 'rifle', damage: 34, headMult: 4, limbMult: 0.7, range: 40, falloff: 0.7, fireInterval: 0.11, mag: 30, reserve: 90, reloadTime: 2.2, spread: 0.008, moveSpread: 0.045, recoil: 0.8, auto: true, price: 2700 }
};

const _dir = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _from = new THREE.Vector3();
const _muzzle = new THREE.Vector3();

export function weaponFor(actor) {
  return WEAPONS[actor.weaponId] || WEAPONS.dibber;
}

export function fireWeapon(state, actor, ctx) {
  if (!actor || !actor.alive) return false;
  const weapon = weaponFor(actor);
  const now = ctx.now;
  if (actor.magAmmo <= 0) {
    if (ctx.audio) ctx.audio.play('dryfire');
    return false;
  }
  if (actor.reloading || now < actor.nextShotAt) return false;

  actor.magAmmo -= 1;
  actor.nextShotAt = now + weapon.fireInterval;
  const speed = Math.hypot(actor.vel?.x || 0, actor.vel?.z || 0);
  const walkSpeed = Math.max(1, actor.speed || 5);
  const crouchScale = actor.crouch ? 0.7 : 1;
  const radius = Math.min(0.2, (weapon.spread + weapon.moveSpread * Math.min(1.5, speed / walkSpeed) + (actor.bloom || 0)) * crouchScale);
  const sampleR = Math.sqrt(Math.random()) * radius;
  const sampleA = Math.random() * Math.PI * 2;
  const spreadX = Math.cos(sampleA) * sampleR;
  const spreadY = Math.sin(sampleA) * sampleR;

  const cp = ctx.camera.position;
  _dir.set(-Math.sin(actor.yaw) * Math.cos(actor.pitch), Math.sin(actor.pitch), -Math.cos(actor.yaw) * Math.cos(actor.pitch));
  _aim.copy(cp).addScaledVector(_dir, weapon.range);
  const rightX = Math.cos(actor.yaw);
  const rightZ = -Math.sin(actor.yaw);
  _aim.x += rightX * spreadX;
  _aim.y += spreadY;
  _aim.z += rightZ * spreadX;
  _dir.copy(_aim).sub(cp).normalize();
  _muzzle.set(cp.x + rightX * 0.2, cp.y - 0.13, cp.z + rightZ * 0.2);
  const hit = raycastHit(state, _muzzle, _dir, weapon.range, actor.id, { shooterId: actor.id, map: ctx.map });
  const end = hit ? new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z) : _muzzle.clone().addScaledVector(_dir, weapon.range);
  if (hit && hit.actor) {
    const falloffStart = weapon.range * 0.45;
    const scale = hit.dist <= falloffStart ? 1 : 1 - weapon.falloff * ((hit.dist - falloffStart) / (weapon.range - falloffStart));
    const mult = hit.part === 'head' ? weapon.headMult : hit.part === 'limbs' ? weapon.limbMult : 1;
    applyDamage(state, hit.actor, Math.max(1, weapon.damage * mult * Math.max(0.2, scale)), hit.part, actor.id, ctx);
  }
  addTracer(ctx.fx, _muzzle, end);
  if (hit) addImpact(ctx.fx, hit.point);
  if (ctx.audio) ctx.audio.play(`shot-${actor.weaponId}`);
  if (ctx.fx) muzzleFlash(ctx.fx, _muzzle);
  actor.bloom = Math.min(0.06, (actor.bloom || 0) + 0.008);
  actor.recoilPitch = (actor.recoilPitch || 0) + weapon.recoil * (0.9 + Math.random() * 0.2);
  actor.recoilYaw = (actor.recoilYaw || 0) + (Math.random() - 0.5) * weapon.recoil * 0.4;
  actor.recoilPitch = Math.max(0, actor.recoilPitch - weapon.recoil * 0.08);
  return true;
}

export function startReload(state, actor, now) {
  const weapon = weaponFor(actor);
  if (!actor.alive || actor.reloading || actor.reserveAmmo <= 0 || actor.magAmmo >= weapon.mag) return false;
  actor.reloading = true;
  actor.reloadEnd = now + weapon.reloadTime;
  if (state.audio) state.audio.play('reload');
  return true;
}

export function updateReload(state, actor, now) {
  if (!actor.reloading || now < actor.reloadEnd) return;
  const amount = Math.min(weaponFor(actor).mag - actor.magAmmo, actor.reserveAmmo);
  actor.magAmmo += amount;
  actor.reserveAmmo -= amount;
  actor.reloading = false;
}

export function createViewModel(scene, camera) {
  const root = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x20282a, roughness: 0.55, metalness: 0.75 });
  const amber = new THREE.MeshStandardMaterial({ color: 0xe7a847, roughness: 0.45, metalness: 0.4 });
  const addBox = (size, position, material = metal) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...position);
    root.add(mesh);
  };
  addBox([0.18, 0.16, 0.42], [0.28, -0.22, -0.58]);
  addBox([0.19, 0.035, 0.26], [0.28, -0.125, -0.57], amber);
  addBox([0.11, 0.18, 0.13], [0.28, -0.34, -0.48]);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.28, 8), metal);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0.28, -0.2, -0.88);
  root.add(barrel);
  addBox([0.06, 0.03, 0.42], [0.28, -0.11, -0.77], amber);
  root.visible = true;
  camera.add(root);
  scene.add(camera);
  return { root, kind: null, baseX: 0.28, baseY: -0.22, baseZ: -0.58, time: 0 };
}

export function updateViewModel(vm, actor, ctx, dt) {
  if (!vm) return;
  vm.time += dt;
  const moving = Math.hypot(actor.vel?.x || 0, actor.vel?.z || 0) > 0.3;
  vm.root.visible = !(ctx.buyOpen || ctx.state?.buyOpen);
  const weapon = weaponFor(actor);
  if (vm.kind !== weapon.kind) {
    vm.kind = weapon.kind;
    const scale = weapon.kind === 'rifle' ? 1.55 : weapon.kind === 'smg' ? 1.2 : 0.85;
    vm.root.scale.setScalar(scale);
  }
  const kick = Math.min(0.12, Math.max(0, actor.recoilPitch || 0) * 0.04);
  const reloadDip = actor.reloading ? 0.22 : 0;
  vm.root.position.set(Math.sin(vm.time * 8) * (moving ? 0.012 : 0), -reloadDip + (moving ? Math.abs(Math.sin(vm.time * 8)) * 0.015 : 0), kick);
  vm.root.rotation.x = reloadDip * 1.4 - kick * 1.5;
}
// Fourth integration fix pass.
