// Third integration fix pass: give the human actor a vector position.
// Second integration fix pass: connect human fire input to live weapon combat.
// Integration fix: retain the computed camera eye position on the actor.
// player.js — handles human movement, collision, view control and recoil.
import * as THREE from 'three';
import { PHASE } from './state.js';
import { resolveCollision } from './map.js';
import { fireWeapon } from './weapons.js';

const STAND_HALF = { x: 0.35, y: 0.9, z: 0.35 };
const CROUCH_HALF = { x: 0.35, y: 0.55, z: 0.35 };
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.0;
const GRAVITY = 20;

export function createPlayerActor(state, spawn) {
  return {
    id: 'human',
    name: 'You',
    team: 'pruners',
    isHuman: true,
    alive: true,
    hp: 100,
    maxHp: 100,
    armor: 0,
    pos: new THREE.Vector3(spawn.x, spawn.y, spawn.z),
    yaw: 0,
    pitch: 0,
    recoilPitch: 0,
    recoilYaw: 0,
    crouch: false,
    onGround: true,
    vel: { x: 0, y: 0, z: 0 },
    weaponId: 'dibber',
    magAmmo: 12,
    reserveAmmo: 48,
    reloading: false,
    reloadEnd: 0,
    flash: 0,
    grenades: { flash: 1, smoke: 1 },
    hasKit: false,
    fsm: 'advance',
    targetId: null,
    lastKnown: null,
    reactionAt: 0,
    path: null,
    pathIndex: 0,
    nextThink: 0,
    burstLeft: 0,
    nextShotAt: 0,
    speed: 5.2,
    skill: 0.5,
    footstepAt: 0,
    groundedPrevious: true,
    statePhase: state?.phase ?? PHASE?.FREEZE ?? 'freeze',
  };
}

function approach(current, target, amount) {
  if (current < target) return Math.min(current + amount, target);
  return Math.max(current - amount, target);
}

function updateRecoil(actor, dt, firing) {
  if (firing) return;
  const recovery = dt / 0.4;
  actor.recoilPitch = approach(actor.recoilPitch, 0, Math.abs(actor.recoilPitch) * recovery + dt * 0.02);
  actor.recoilYaw = approach(actor.recoilYaw, 0, Math.abs(actor.recoilYaw) * recovery + dt * 0.02);
}

function stepAxis(actor, axis, amount, half, colliders) {
  if (amount === 0) return false;
  actor.pos[axis] += amount;
  const before = actor.pos[axis];
  resolveCollision(actor.pos, half, colliders);
  return actor.pos[axis] !== before;
}

function movementVector(input, yaw) {
  const forward = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
  const strafe = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
  const length = Math.hypot(forward, strafe);
  if (!length) return { x: 0, z: 0 };
  const f = forward / length;
  const s = strafe / length;
  return {
    x: Math.sin(yaw) * f + Math.cos(yaw) * s,
    z: -Math.cos(yaw) * f + Math.sin(yaw) * s,
  };
}

export function updatePlayer(state, actor, ctx, dt) {
  const { camera, map, audio, input, now } = ctx;
  if (!actor.alive) return;
  if (state.phase === PHASE.LIVE && input.firing) fireWeapon(state, actor, ctx);
  const look = input.consumeLook();
  actor.yaw -= look.dx * 0.0022;
  actor.pitch = THREE.MathUtils.clamp(actor.pitch - look.dy * 0.0022, -Math.PI * 89 / 180, Math.PI * 89 / 180);
  updateRecoil(actor, dt, input.firing);

  actor.crouch = input.isDown('ControlLeft') || input.isDown('ControlRight') || input.isDown('KeyC');
  const half = actor.crouch ? CROUCH_HALF : STAND_HALF;
  const wish = movementVector(input, actor.yaw);
  const wishSpeed = actor.crouch ? 2.4 : actor.speed;
  const wishX = wish.x * wishSpeed;
  const wishZ = wish.z * wishSpeed;

  const horizontalSpeed = Math.hypot(actor.vel.x, actor.vel.z);
  if (wish.x === 0 && wish.z === 0 && actor.onGround) {
    const drop = horizontalSpeed * 10 * dt;
    const scale = horizontalSpeed > 0 ? Math.max(0, horizontalSpeed - drop) / horizontalSpeed : 0;
    actor.vel.x *= scale;
    actor.vel.z *= scale;
  } else if (wish.x === 0 && wish.z === 0 && !actor.onGround) {
    actor.vel.x = approach(actor.vel.x, 0, 0.5 * dt);
    actor.vel.z = approach(actor.vel.z, 0, 0.5 * dt);
  }

  const accel = actor.onGround ? 40 : 12;
  const alongX = actor.vel.x * wish.x + actor.vel.z * wish.z;
  const addSpeed = wishSpeed - alongX;
  if (addSpeed > 0 && (wish.x !== 0 || wish.z !== 0)) {
    const amount = Math.min(accel * dt * wishSpeed, addSpeed);
    actor.vel.x += amount * wish.x;
    actor.vel.z += amount * wish.z;
  }

  if ((input.isDown('Space') || input.isDown('Spacebar')) && actor.onGround) {
    actor.vel.y = 7;
    actor.onGround = false;
  }
  actor.vel.y -= GRAVITY * dt;

  const oldY = actor.pos.y;
  const hitX = stepAxis(actor, 'x', actor.vel.x * dt, half, map.colliders);
  if (hitX) actor.vel.x = 0;
  const hitZ = stepAxis(actor, 'z', actor.vel.z * dt, half, map.colliders);
  if (hitZ) actor.vel.z = 0;
  const hitY = stepAxis(actor, 'y', actor.vel.y * dt, half, map.colliders);
  if (hitY) {
    if (actor.vel.y < 0) actor.onGround = true;
    actor.vel.y = 0;
  } else {
    actor.onGround = false;
  }
  if (actor.pos.y < oldY && actor.pos.y <= half.y + 0.02) actor.onGround = true;

  const horizontalMovement = Math.hypot(actor.vel.x, actor.vel.z);
  if (actor.onGround && horizontalMovement > 0.7 && now >= actor.footstepAt) {
    audio.play('footstep');
    actor.footstepAt = now + (actor.crouch ? 0.5 : 0.35);
  }

  const eye = eyePos(actor);
  actor.cameraPosition = new THREE.Vector3(eye.x, eye.y, eye.z);
  camera.position.set(eye.x, eye.y, eye.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.set(actor.pitch + actor.recoilPitch, actor.yaw + actor.recoilYaw, 0, 'YXZ');
}

export function eyePos(actor) {
  return { x: actor.pos.x, y: actor.pos.y + (actor.crouch ? CROUCH_EYE : STAND_EYE), z: actor.pos.z };
}

export function actorSpeed(actor) {
  return Math.hypot(actor.vel.x, actor.vel.z);
}
// Fourth integration fix pass.
