// Sixth fix pass: wire the first-person viewmodel into play and capture rendering.
// Fifth fix pass: correct capture overlays and scene brightness.
// Second integration fix pass: wire live player, shop, and combat inputs.
// Integration fix: initialize capture actors and use current pointer-lock state.
// game/src/main.js: renderer boot, deterministic capture, and fixed-step match loop.
import * as THREE from 'three';
import { createState, PHASE, mulberry32 } from './state.js';
import { PALETTE, hexToNumber } from './palette.js';
import { buildMap } from './map.js';
import { createPlayerActor, updatePlayer } from './player.js';
import { updateReload, startReload, createViewModel, updateViewModel } from './weapons.js';
import { createEffects, updateEffects } from './combat.js';
import { updateGrenades, throwGrenade } from './grenades.js';
import { createBots, updateBots } from './bots.js';
import { startMatch, updateRounds, plantTick } from './rounds.js';
import { SHOP, buyItem } from './economy.js';
import { createHud, updateHud, openBuyMenu, closeBuyMenu } from './hud.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { runShot } from './shots.js';

const host = document.querySelector('#game');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(hexToNumber(PALETTE.canvas));
scene.fog = new THREE.FogExp2(hexToNumber(PALETTE.canvas), 0.018);
const skyGeometry = new THREE.SphereGeometry(180, 48, 24);
const skyMaterial = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  uniforms: { horizon: { value: new THREE.Color('#253a32') }, zenith: { value: new THREE.Color('#08110f') } },
  vertexShader: 'varying vec3 vPosition; void main(){vPosition=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader: 'uniform vec3 horizon;uniform vec3 zenith;varying vec3 vPosition;void main(){float h=normalize(vPosition).y;float f=smoothstep(-0.15,0.72,h);gl_FragColor=vec4(mix(horizon,zenith,f),1.0);}'
});
scene.add(new THREE.Mesh(skyGeometry, skyMaterial));
scene.add(new THREE.HemisphereLight(0x9fc4bd, 0x111813, 0.72));
const moon = new THREE.DirectionalLight(0xc0d5cb, 1.15);
moon.position.set(-18, 30, 8);
moon.castShadow = true;
scene.add(moon);

const camera = new THREE.PerspectiveCamera(75, 1, 0.08, 220);
const viewModel = createViewModel(scene, camera);
const map = buildMap(scene);
const state = createState();
const audio = createAudio();
const input = createInput(renderer.domElement);
const fx = createEffects(scene);
const ctx = { THREE, scene, camera, renderer, map, audio, input, fx, now: 0, dt: 0, state, buyOpen: false };
const hud = createHud({
  onBuy(itemId) { if (player) buyItem(state, player, itemId); },
  onCloseBuy() { closeBuyMenu(); }
});
let player = null;
let previousTime = 0;
let accumulator = 0;
const STEP = 1 / 60;
const MAX_STEPS = 5;
let pausedForLockLoss = false;

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(1, height);
  camera.updateProjectionMatrix();
}
function toggleShop() {
  const menu = document.querySelector('#buy-menu');
  if (menu.classList.contains('hidden')) openBuyMenu(state);
  else closeBuyMenu();
}
function beginMatch() {
  document.querySelector('#overlay-start').classList.add('hidden');
  pausedForLockLoss = false;
  input.requestLock();
  if (!player) {
    player = createPlayerActor(state, map.spawns.pruners[0]);
    if (!state.actors.includes(player)) state.actors.push(player);
  }
  startMatch(state, ctx);
  createBots(state, ctx);
  openBuyMenu(state);
}
function handleInputs() {
  if (input.isDown('KeyB')) { input.keys.delete('KeyB'); toggleShop(); }
  if (input.isDown('Escape') && !document.querySelector('#buy-menu').classList.contains('hidden')) closeBuyMenu();
  const menuOpen = !document.querySelector('#buy-menu').classList.contains('hidden');
  ctx.buyOpen = menuOpen;
  if (menuOpen) {
    for (let index = 1; index <= SHOP.length; index += 1) {
      const key = `Digit${index}`;
      if (!input.isDown(key)) continue;
      input.keys.delete(key);
      if (player) buyItem(state, player, SHOP[index - 1].id);
    }
  }
  for (const [key, kind] of [['KeyR', 'reload'], ['KeyG', 'flash'], ['KeyH', 'smoke']]) {
    if (!input.isDown(key)) continue;
    input.keys.delete(key);
    if (!player) continue;
    if (kind === 'reload') startReload(state, player, state.time);
    else throwGrenade(state, player, kind, ctx);
  }
}
function fixedUpdate(dt) {
  state.time += dt;
  ctx.now = state.time;
  ctx.dt = dt;
  handleInputs();
  if (state.phase === PHASE.FREEZE || state.phase === PHASE.LIVE) {
    if (player && player.alive) updatePlayer(state, player, ctx, dt);
    updateBots(state, ctx, dt);
    updateGrenades(state, ctx, dt);
    plantTick(state, ctx, dt);
    updateRounds(state, ctx, dt);
    for (const actor of state.actors) updateReload(state, actor, state.time);
  }
  updateEffects(fx, dt);
}
function renderFrame(time) {
  if (!previousTime) previousTime = time;
  const elapsed = Math.min((time - previousTime) / 1000, STEP * MAX_STEPS);
  previousTime = time;
  if (state.phase !== PHASE.MENU && state.phase !== PHASE.MATCH_END && !pausedForLockLoss) {
    accumulator += elapsed;
    let steps = 0;
    while (accumulator >= STEP && steps < MAX_STEPS) {
      fixedUpdate(STEP);
      accumulator -= STEP;
      steps += 1;
    }
  }
  if (player) camera.position.copy(player.cameraPosition || new THREE.Vector3(player.pos.x, player.pos.y + 1.62, player.pos.z));
  const captureFirstPerson = paramsShot === 'start' || paramsShot === 'play' || paramsShot === 'plant';
  const viewModelAllowed = Boolean(player && (state.phase === PHASE.FREEZE || state.phase === PHASE.LIVE) && (!paramsShot || captureFirstPerson));
  if (viewModelAllowed) updateViewModel(viewModel, player, ctx, elapsed);
  else viewModel.root.visible = false;
  updateHud(state, ctx);
  renderer.render(scene, camera);
}
function onLockChange() {
  if (document.pointerLockElement !== renderer.domElement && state.phase !== PHASE.MENU && state.phase !== PHASE.MATCH_END) {
    pausedForLockLoss = true;
    document.querySelector('#overlay-start').classList.remove('hidden');
    document.querySelector('#play').textContent = 'Resume match';
    document.querySelector('.subtitle').textContent = 'Pointer lock released. Click to resume your match.';
  }
}
window.addEventListener('resize', resize);
document.addEventListener('pointerlockchange', onLockChange);
document.querySelector('#play').addEventListener('click', () => {
  audio.play('click');
  if (pausedForLockLoss) {
    pausedForLockLoss = false;
    document.querySelector('#overlay-start').classList.add('hidden');
    input.requestLock();
    return;
  }
  beginMatch();
});
document.querySelector('#rematch').addEventListener('click', () => window.location.reload());
input.attach();
resize();

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const paramsShot = shot;
const seed = Number(params.get('seed') || 1) >>> 0;
if (['start', 'play', 'plant', 'end'].includes(shot)) {
  document.querySelector('#overlay-start').classList.add('hidden');
  document.querySelector('#overlay-match').classList.add('hidden');
  state.seed = seed;
  Math.random = mulberry32(seed);
  player = createPlayerActor(state, map.spawns.pruners[0]);
  state.actors.push(player);
  createBots(state, ctx);
  startMatch(state, ctx);
  runShot(state, ctx, shot, seed);
  ctx.buyOpen = !document.querySelector('#buy-menu').classList.contains('hidden');
  if (shot === 'start' || shot === 'play' || shot === 'plant') {
    updateViewModel(viewModel, player, ctx, 0);
  } else viewModel.root.visible = false;
  updateHud(state, ctx);
  renderer.render(scene, camera);
  renderer.render(scene, camera);
  window.__shotReady = true;
} else {
  renderer.setAnimationLoop(renderFrame);
}
