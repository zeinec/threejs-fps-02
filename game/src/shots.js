// Seventh fix pass: move Site B defenders off the plant camera sightline.
// Sixth fix pass: place plant capture actors inside Site B and lower the end view.
// Integration fix: arrange capture actors at visible world and camera heights.
// shots.js — deterministic scene arrangements for GLASSHOUSE captures.
import * as THREE from 'three';
import { PHASE, TEAM, mulberry32 } from './state.js';
import { openBuyMenu, closeBuyMenu, showBanner } from './hud.js';
import { addTracer, addImpact } from './combat.js';

let plantCanister = null;

const xyz = (v) => ({ x: Number(v?.x ?? 0), y: Number(v?.y ?? 0), z: Number(v?.z ?? 0) });
function setPos(actor, x, y, z) {
  if (!actor) return;
  if (actor.pos?.set) actor.pos.set(x, y, z);
  else actor.pos = { x, y, z };
  if (actor.mesh?.position?.set) actor.mesh.position.set(x, y, z);
  if (actor.vel?.set) actor.vel.set(0, 0, 0);
  else actor.vel = { x: 0, y: 0, z: 0 };
}
function face(actor, yaw) { if (actor) { actor.yaw = yaw; actor.pitch = 0; actor.crouch = false; if (actor.mesh) actor.mesh.rotation.y = yaw; } }
function actorsBy(state, team) { return state.actors.filter((a) => !a.isHuman && a.team === team); }
function setCamera(ctx, position, target) {
  if (!ctx.camera) return;
  ctx.camera.position?.set?.(position.x, position.y, position.z);
  ctx.camera.lookAt?.(target.x, target.y, target.z);
  ctx.camera.updateMatrixWorld?.(true);
}
function addCanister(ctx, position) {
  if (!ctx.scene) return;
  if (!plantCanister) {
    const geometry = new THREE.BoxGeometry(0.24, 0.38, 0.24);
    const material = new THREE.MeshStandardMaterial({ color: 0xe8a33d, emissive: 0x9b4c13, emissiveIntensity: 1.3, roughness: 0.38, metalness: 0.55 });
    plantCanister = new THREE.Mesh(geometry, material);
    plantCanister.name = 'capture-canister';
    plantCanister.castShadow = true;
    ctx.scene.add(plantCanister);
  }
  plantCanister.position.set(position.x, position.y + 0.2, position.z);
  plantCanister.visible = true;
}
function seededOffset(rng, radius = 0.3) { return (rng() * 2 - 1) * radius; }
function hideUnusedCanister() { if (plantCanister) plantCanister.visible = false; }

export function runShot(state, ctx, name, seed) {
  const rng = mulberry32(seed);
  const human = state.actors.find((actor) => actor.isHuman);
  if (!human) throw new Error(`Cannot arrange shot "${name}": state has no human actor.`);
  const pruners = actorsBy(state, TEAM?.PRUNERS ?? 'PRUNERS');
  const keepers = actorsBy(state, TEAM?.KEEPERS ?? 'KEEPERS');
  const yawNorth = 0;
  const actorY = 0.91;
  const eyeY = actorY + 1.62;
  hideUnusedCanister();

  if (name === 'start') {
    state.phase = PHASE?.FREEZE ?? 'FREEZE'; state.freezeTimer = 8; state.playerMoney = 800;
    human.weaponId = 'dibber'; human.magAmmo = human.magAmmo ?? 12; human.reserveAmmo = human.reserveAmmo ?? 48;
    setPos(human, 0, actorY, 12); face(human, yawNorth);
    pruners.slice(0, 2).forEach((bot, i) => { setPos(bot, seededOffset(rng, 0.7) + (i ? 1.3 : -1.3), actorY, 5 - i * 2); face(bot, yawNorth); });
    openBuyMenu(state);
    setCamera(ctx, { x: human.pos.x, y: eyeY, z: human.pos.z }, { x: human.pos.x, y: eyeY - 0.07, z: human.pos.z - 12 });
    return;
  }

  if (name === 'play') {
    state.phase = PHASE?.LIVE ?? 'LIVE'; state.roundTimer = 62; state.spike.status = 'carried'; state.spike.carrierId = human.id;
    human.weaponId = 'secateur'; human.magAmmo = 22; human.reserveAmmo = 66;
    closeBuyMenu(); setPos(human, 0, actorY, 0); face(human, yawNorth);
    const target = keepers[0];
    if (target) { setPos(target, seededOffset(rng, 0.35), actorY, -12); face(target, Math.PI); }
    const mate = pruners[0]; if (mate) { setPos(mate, -2.6 + seededOffset(rng, 0.2), actorY, -4); face(mate, yawNorth); }
    const flank = keepers[1]; if (flank) { setPos(flank, 2.8 + seededOffset(rng, 0.2), actorY, -8); face(flank, Math.PI); }
    const from = { x: human.pos.x, y: 1.45, z: human.pos.z - 0.4 };
    const to = target ? { x: target.pos.x, y: 1.25, z: target.pos.z } : { x: 0, y: 1.25, z: -12 };
    if (ctx.fx) { addTracer(ctx.fx, from, to); addImpact(ctx.fx, { x: to.x, y: to.y, z: to.z + 0.2 }); }
    state.events = (state.events ?? []).filter((event) => event.type !== 'hit');
    state.events.push({ type: 'hit', actorId: human.id, time: Number(state.time ?? 0) });
    setCamera(ctx, { x: human.pos.x, y: eyeY, z: human.pos.z }, { x: to.x, y: 1.35, z: to.z });
    return;
  }

  if (name === 'plant') {
    state.phase = PHASE?.LIVE ?? 'LIVE'; state.roundTimer = 40;
    state.spike.status = 'planted'; state.spike.site = 'B'; state.spike.fuse = 24; state.spike.carrierId = null;
    closeBuyMenu();
    const site = { x: 14, y: 0, z: -4 };
    setPos(human, 15.8, actorY, -5.8); face(human, Math.atan2(site.x - human.pos.x, -(site.z - human.pos.z)));
    addCanister(ctx, site);
    keepers.slice(0, 3).forEach((bot, i) => {
      const positions = [
        { x: 11.9, z: -8.0 },
        { x: 16.8, z: -7.4 },
        { x: 12.0, z: -2.9 },
      ];
      const x = positions[i].x + seededOffset(rng, 0.2);
      const z = positions[i].z + seededOffset(rng, 0.2);
      setPos(bot, x, actorY, z);
      face(bot, Math.atan2(human.pos.x - x, -(human.pos.z - z)));
    });
    setCamera(ctx, { x: human.pos.x, y: eyeY, z: human.pos.z }, { x: site.x, y: 0.35, z: site.z });
    return;
  }

  if (name === 'end') {
    closeBuyMenu();
    state.phase = PHASE?.ROUND_END ?? 'ROUND_END'; state.scores.pruners = 4; state.scores.keepers = 3;
    showBanner(state, 'PRUNERS WIN THE ROUND', 'Canister detonated — Site B');
    const overview = { x: 0, y: 6, z: 2 };
    setCamera(ctx, overview, { x: 0, y: 1.4, z: -12 });
    return;
  }

  throw new Error(`Unknown GLASSHOUSE screenshot shot "${name}". Expected start, play, plant, or end.`);
}
