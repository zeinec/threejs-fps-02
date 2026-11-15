// Waypoint-link fix: remove navigation edges that cross solid corridor walls.
// map.js — builds GLASSHOUSE geometry, lighting, navigation and collision data.
import * as THREE from 'three';
import { PALETTE, hexToNumber } from './palette.js';

const FLOOR_Y = 0;
const HALF_X = 23;
const HALF_Z = 17;

function box(min, max) {
  return { min: { ...min }, max: { ...max } };
}

function pushBox(colliders, x, y, z, sx, sy, sz) {
  colliders.push(box(
    { x: x - sx / 2, y: y - sy / 2, z: z - sz / 2 },
    { x: x + sx / 2, y: y + sy / 2, z: z + sz / 2 },
  ));
}

function material(color, roughness = 0.82, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.08, ...extra });
}

function addBox(scene, colliders, spec) {
  const { x, y, z, sx, sy, sz, color, mat, roughness, emissive, emission = 0, collider = true } = spec;
  const meshMat = mat || material(color, roughness, emissive ? { emissive, emissiveIntensity: emission } : {});
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), meshMat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  if (collider) pushBox(colliders, x, y, z, sx, sy, sz);
  return mesh;
}

function addCylinder(scene, colliders, spec) {
  const { x, y, z, radiusTop, radiusBottom, height, color, sides = 12, collider = true, roughness = 0.72 } = spec;
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, sides),
    material(color, roughness),
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  if (collider) pushBox(colliders, x, y, z, Math.max(radiusTop, radiusBottom) * 2, height, Math.max(radiusTop, radiusBottom) * 2);
  return mesh;
}

function addPipe(scene, start, end, radius, color) {
  const a = new THREE.Vector3(...start);
  const b = new THREE.Vector3(...end);
  const direction = new THREE.Vector3().subVectors(b, a);
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, direction.length(), 8),
    material(color, 0.48, { metalness: 0.62 }),
  );
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  mesh.castShadow = true;
  scene.add(mesh);
}

function makeSky(scene) {
  const geometry = new THREE.SphereGeometry(110, 32, 20);
  const positions = geometry.attributes.position;
  const colors = [];
  const horizon = new THREE.Color(hexToNumber(PALETTE.canvas));
  const zenith = new THREE.Color(0x030706);
  for (let i = 0; i < positions.count; i += 1) {
    const t = THREE.MathUtils.clamp((positions.getY(i) / 110 + 0.03) / 0.72, 0, 1);
    const color = horizon.clone().lerp(zenith, t * t);
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const sky = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false }));
  sky.renderOrder = -10;
  scene.add(sky);
}

function addWalkway(scene, colliders) {
  const walkway = { x: -11.2, y: 2.45, z: -0.3, sx: 4.2, sy: 0.38, sz: 10.4, color: 0x36473a };
  addBox(scene, colliders, walkway);
  // Box steps make both ends of the raised irrigation path traversable.
  for (let step = 0; step < 4; step += 1) {
    const height = 0.48 + step * 0.48;
    addBox(scene, colliders, {
      x: -11.2, y: height / 2, z: 6.1 + step * 0.82,
      sx: 2.8, sy: height, sz: 1.15, color: 0x405344,
    });
  }
  for (const side of [-1, 1]) {
    addBox(scene, colliders, {
      x: -11.2 + side * 2.0, y: 2.95, z: -0.3,
      sx: 0.12, sy: 0.8, sz: 9.7, color: 0x788578,
    });
  }
}

function addGrowLights(scene) {
  const amber = hexToNumber(PALETTE.amber);
  for (const z of [-9, -3, 3, 9]) {
    addBox(scene, [], { x: -11.5, y: 6.8, z, sx: 8.8, sy: 0.12, sz: 0.18, color: 0x55472f, collider: false });
    addBox(scene, [], { x: -11.5, y: 6.68, z, sx: 7.2, sy: 0.09, sz: 0.12, color: amber, collider: false, emissive: amber, emission: 2.1 });
  }
  const warm = [
    [-14, 5.8, -8], [-8, 5.8, -2], [-14, 5.8, 4], [-8, 5.8, 9],
  ];
  for (const [x, y, z] of warm) {
    const light = new THREE.PointLight(amber, 46, 13, 2);
    light.position.set(x, y, z);
    scene.add(light);
  }
}

function addRoof(scene) {
  const glass = new THREE.MeshStandardMaterial({
    color: 0x9bb4a5,
    roughness: 0.18,
    metalness: 0.12,
    transparent: true,
    opacity: 0.17,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  for (const x of [-15.5, -8.0, -0.5, 7.0, 14.5]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(7.35, 0.08, 30), glass);
    panel.position.set(x, 8.6, 0);
    panel.receiveShadow = false;
    scene.add(panel);
  }
  for (const x of [-19, -12, -5, 2, 9, 16, 20]) {
    addBox(scene, [], { x, y: 8.45, z: 0, sx: 0.16, sy: 0.2, sz: 31, color: 0x54645b, collider: false });
  }
}

function addWaypoints() {
  const rows = [
    ['p_south', 0, 0, 14, ['p_entry']],
    ['p_entry', 0, 0, 10, ['p_south', 'fern_south']],
    ['a_lane_entry', -9, 0, 10, ['a_corner']],
    ['a_corner', -15, 0, 6, ['a_lane_entry', 'a_hold', 'a_short_mid']],
    ['a_hold', -18, 0, 0, ['a_corner', 'a_plant', 'a_walkway_top']],
    ['a_plant', -14, 0, -4, ['a_hold', 'a_short_mid']],
    ['a_walkway_top', -11, 2.82, -1, ['a_hold', 'a_plant']],
    ['a_short_mid', -10, 0, 3, ['a_corner', 'a_plant', 'fern_west']],
    ['fern_south', 0, 0, 7, ['p_entry', 'fountain_south', 'fern_west', 'fern_east']],
    ['fountain_south', 0, 0, 3, ['fern_south', 'pallet_base', 'fountain_north']],
    ['pallet_base', 5, 0, 1, ['fountain_south', 'pallet_top', 'fern_east']],
    ['pallet_top', 5, 1.25, 1, ['pallet_base', 'b_long_mid']],
    ['fountain_north', 0, 0, -2, ['fountain_south', 'fern_north', 'b_long_mid']],
    ['fern_west', -6, 0, 5, ['fern_south', 'a_short_mid', 'fern_north']],
    ['fern_east', 7, 0, 5, ['fern_south', 'pallet_base', 'b_long_mid']],
    ['fern_north', 0, 0, -6, ['fountain_north', 'b_lane_entry', 'b_long_mid']],
    ['b_lane_entry', 9, 0, 10, ['b_corner']],
    ['b_corner', 15, 0, 6, ['b_lane_entry', 'b_hold', 'b_long_mid']],
    ['b_hold', 18, 0, 0, ['b_corner', 'b_plant']],
    ['b_plant', 14, 0, -4, ['b_hold', 'b_long_mid']],
    ['b_long_mid', 10, 0, 1, ['b_corner', 'b_plant', 'fern_north', 'pallet_top', 'pump_entry']],
    ['pump_entry', 10, 0, -9, ['b_long_mid', 'pump_corner']],
    ['pump_corner', 16, 0, -12, ['pump_entry', 'pump_hold']],
    ['pump_hold', 19, 0, -14, ['pump_corner']],
    ['k_entry', 0, 0, -13, ['k_north']],
    ['k_north', 0, 0, -15, ['k_entry']],
  ];
  return rows.map(([id, x, y, z, links]) => ({ id, pos: { x, y, z }, links }));
}

export function buildMap(scene) {
  const colliders = [];
  makeSky(scene);
  scene.fog = new THREE.Fog(hexToNumber(PALETTE.canvas), 25, 70);

  const ground = new THREE.Mesh(
    new THREE.BoxGeometry(46, 0.5, 34),
    new THREE.MeshStandardMaterial({ color: 0x18211f, roughness: 0.26, metalness: 0.18 }),
  );
  ground.position.set(0, -0.25, 0);
  ground.receiveShadow = true;
  scene.add(ground);
  pushBox(colliders, 0, -0.25, 0, 46, 0.5, 34);

  const walls = [
    { x: 0, y: 2.2, z: -16.7, sx: 46, sy: 4.4, sz: 0.6 },
    { x: 0, y: 2.2, z: 16.7, sx: 46, sy: 4.4, sz: 0.6 },
    { x: -22.7, y: 2.2, z: 0, sx: 0.6, sy: 4.4, sz: 34 },
    { x: 22.7, y: 2.2, z: 0, sx: 0.6, sy: 4.4, sz: 34 },
    // Broken interior dividers define three routes without sealing rotations.
    { x: -4.2, y: 1.8, z: -10.7, sx: 0.55, sy: 3.6, sz: 10.5 },
    { x: -4.2, y: 1.8, z: 10.7, sx: 0.55, sy: 3.6, sz: 10.5 },
    { x: 4.2, y: 1.8, z: -10.7, sx: 0.55, sy: 3.6, sz: 10.5 },
    { x: 4.2, y: 1.8, z: 10.7, sx: 0.55, sy: 3.6, sz: 10.5 },
    // Pump House enclosure leaves the south and east service entries open.
    { x: 11.8, y: 2.0, z: -8.0, sx: 0.5, sy: 4, sz: 10 },
    { x: 18.7, y: 2.0, z: -8.0, sx: 0.5, sy: 4, sz: 10 },
    { x: 15.25, y: 2.0, z: -13.2, sx: 7.4, sy: 4, sz: 0.5 },
    { x: 15.25, y: 2.0, z: -2.8, sx: 7.4, sy: 4, sz: 0.5 },
  ];
  for (const wall of walls) addBox(scene, colliders, { ...wall, color: 0x26332d });

  const planterSpecs = [
    { x: -17, z: -9 }, { x: -12, z: -9 }, { x: -7, z: -9 },
    { x: -17, z: -2 }, { x: -12, z: -2 }, { x: -7, z: -2 },
    { x: -17, z: 5 }, { x: -12, z: 5 }, { x: -7, z: 5 },
  ];
  for (const planter of planterSpecs) {
    addBox(scene, colliders, { ...planter, y: 0.62, sx: 3.5, sy: 1.24, sz: 2.1, color: 0x34483a });
    addBox(scene, [], { x: planter.x, y: 1.27, z: planter.z, sx: 3.25, sy: 0.12, sz: 1.85, color: 0x253a29, collider: false });
    for (let sprout = -1; sprout <= 1; sprout += 1) {
      addBox(scene, [], { x: planter.x + sprout * 0.82, y: 1.62, z: planter.z, sx: 0.18, sy: 0.72, sz: 0.18, color: 0x4d7a52, collider: false });
    }
  }

  addWalkway(scene, colliders);
  addGrowLights(scene);
  addRoof(scene);

  const tankSpecs = [
    { x: 14.0, z: -10.5 }, { x: 16.1, z: -10.5 }, { x: 18.0, z: -7.4 },
  ];
  for (const tank of tankSpecs) {
    addCylinder(scene, colliders, { ...tank, y: 1.75, radiusTop: 1.05, radiusBottom: 1.18, height: 3.5, color: 0x53645d, sides: 16 });
    addBox(scene, [], { x: tank.x, y: 3.56, z: tank.z, sx: 2.2, sy: 0.14, sz: 2.2, color: 0x84918a, collider: false });
  }
  const pipeColor = 0x82918a;
  addPipe(scene, [12.2, 3.4, -12.4], [18.2, 3.4, -12.4], 0.12, pipeColor);
  addPipe(scene, [12.2, 3.4, -12.4], [12.2, 3.4, -4.0], 0.1, pipeColor);
  addPipe(scene, [12.2, 3.4, -4.0], [18.5, 3.4, -4.0], 0.1, pipeColor);
  addPipe(scene, [18.2, 3.4, -12.4], [18.2, 3.4, -4.0], 0.1, pipeColor);
  addPipe(scene, [12.2, 4.5, -11], [18.2, 4.5, -11], 0.07, 0x63776c);

  const crates = [
    { x: 11.1, z: -6.2, y: 0.65 }, { x: 11.1, z: -4.9, y: 0.65 },
    { x: 11.1, z: -4.9, y: 1.95 }, { x: 19.9, z: -9.0, y: 0.65 },
    { x: 19.9, z: -10.3, y: 0.65 }, { x: 19.9, z: -10.3, y: 1.95 },
  ];
  for (const crate of crates) addBox(scene, colliders, { ...crate, sx: 1.2, sy: 1.3, sz: 1.2, color: 0x655942 });

  addCylinder(scene, colliders, { x: 0, y: 0.38, z: 0, radiusTop: 2.4, radiusBottom: 2.8, height: 0.76, color: 0x5c6961, sides: 24 });
  addCylinder(scene, colliders, { x: 0, y: 1.28, z: 0, radiusTop: 0.65, radiusBottom: 0.82, height: 1.8, color: 0x3d4d45, sides: 16 });
  // Dark basin inset reads as drained concrete rather than standing water.
  addCylinder(scene, [], { x: 0, y: 0.79, z: 0, radiusTop: 1.55, radiusBottom: 1.55, height: 0.04, color: 0x17201d, sides: 24, collider: false, roughness: 0.4 });

  const palletColors = [0x66563e, 0x736247, 0x5c4c37];
  for (let level = 0; level < 3; level += 1) {
    const height = 0.72 + level * 1.38;
    addBox(scene, colliders, { x: 5.0, y: height, z: 0.8, sx: 2.5, sy: 1.28, sz: 2.1, color: palletColors[level] });
    for (let slat = -1; slat <= 1; slat += 1) {
      addBox(scene, [], { x: 5 + slat * 0.72, y: height - 0.57, z: 0.8, sx: 0.18, sy: 0.16, sz: 2.08, color: 0x9b825c, collider: false });
    }
  }

  const sandbags = [
    { x: -2.4, z: 6.2, sx: 3.8, sz: 0.75 }, { x: 2.7, z: -6.2, sx: 3.8, sz: 0.75 },
    { x: -18.8, z: -5.2, sx: 2.4, sz: 0.75 }, { x: 19.2, z: 4.0, sx: 2.5, sz: 0.75 },
  ];
  for (const line of sandbags) {
    addBox(scene, colliders, { ...line, y: 0.43, sy: 0.86, color: 0x827861 });
    addBox(scene, colliders, { ...line, y: 1.18, sy: 0.62, color: 0x766d59 });
  }

  const moon = new THREE.DirectionalLight(0xa8c2d0, 1.45);
  moon.position.set(-18, 34, -22);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.camera.left = -25;
  moon.shadow.camera.right = 25;
  moon.shadow.camera.top = 19;
  moon.shadow.camera.bottom = -19;
  moon.shadow.camera.near = 1;
  moon.shadow.camera.far = 70;
  moon.shadow.bias = -0.00035;
  moon.shadow.normalBias = 0.025;
  scene.add(moon);
  scene.add(moon.target);

  const fill = new THREE.HemisphereLight(0x8fa89a, 0x101612, 0.8);
  scene.add(fill);

  const waypoints = addWaypoints();
  return {
    colliders,
    spawns: {
      pruners: [
        { x: -2.5, y: 0.91, z: 14.0 }, { x: -1.25, y: 0.91, z: 14.2 },
        { x: 0, y: 0.91, z: 14.4 }, { x: 1.25, y: 0.91, z: 14.2 },
        { x: 2.5, y: 0.91, z: 14.0 },
      ],
      keepers: [
        { x: -2.5, y: 0.91, z: -14.0 }, { x: -1.25, y: 0.91, z: -14.2 },
        { x: 0, y: 0.91, z: -14.4 }, { x: 1.25, y: 0.91, z: -14.2 },
        { x: 2.5, y: 0.91, z: -14.0 },
      ],
    },
    sites: {
      A: { center: { x: -14, y: 0, z: -4 }, radius: 3 },
      B: { center: { x: 14, y: 0, z: -4 }, radius: 3 },
    },
    buyZones: {
      pruners: { min: { x: -5, y: -0.1, z: 11.2 }, max: { x: 5, y: 2.5, z: 16 } },
      keepers: { min: { x: -5, y: -0.1, z: -16 }, max: { x: 5, y: 2.5, z: -11 } },
    },
    waypoints,
    bounds: { minX: -23, maxX: 23, minZ: -17, maxZ: 17 },
  };
}

export function resolveCollision(p, half, colliders) {
  for (const collider of colliders) {
    const overlaps = ['x', 'y', 'z'].map((axis) => ({
      axis,
      depth: Math.min(p[axis] + half[axis], collider.max[axis]) - Math.max(p[axis] - half[axis], collider.min[axis]),
    }));
    if (overlaps.some(({ depth }) => depth <= 0)) continue;
    const { axis } = overlaps.reduce((shallowest, overlap) =>
      overlap.depth < shallowest.depth ? overlap : shallowest);
    const center = (collider.min[axis] + collider.max[axis]) / 2;
    if (p[axis] >= center) {
      p[axis] = collider.max[axis] + half[axis];
    } else {
      p[axis] = collider.min[axis] - half[axis];
    }
  }
  return p;
}

function segmentHitsBox(a, b, collider) {
  let tMin = 0;
  let tMax = 1;
  for (const axis of ['x', 'y', 'z']) {
    const delta = b[axis] - a[axis];
    if (Math.abs(delta) < 1e-9) {
      if (a[axis] < collider.min[axis] || a[axis] > collider.max[axis]) return false;
      continue;
    }
    let t1 = (collider.min[axis] - a[axis]) / delta;
    let t2 = (collider.max[axis] - a[axis]) / delta;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return false;
  }
  return tMax >= 0 && tMin <= 1;
}

export function losBlocked(a, b, colliders) {
  return colliders.some((collider) => segmentHitsBox(a, b, collider));
}

export function findPath(waypoints, fromId, toId) {
  const byId = new Map(waypoints.map((waypoint) => [waypoint.id, waypoint]));
  if (!byId.has(fromId) || !byId.has(toId)) return [];
  const distances = new Map([[fromId, 0]]);
  const previous = new Map();
  const remaining = new Set(byId.keys());
  while (remaining.size > 0) {
    let current = null;
    let best = Infinity;
    for (const id of remaining) {
      const distance = distances.get(id) ?? Infinity;
      if (distance < best) {
        best = distance;
        current = id;
      }
    }
    if (current === null || best === Infinity) break;
    if (current === toId) break;
    remaining.delete(current);
    const node = byId.get(current);
    for (const neighbourId of node.links) {
      if (!remaining.has(neighbourId) || !byId.has(neighbourId)) continue;
      const neighbour = byId.get(neighbourId);
      const dx = node.pos.x - neighbour.pos.x;
      const dy = node.pos.y - neighbour.pos.y;
      const dz = node.pos.z - neighbour.pos.z;
      const candidate = best + Math.hypot(dx, dy, dz);
      if (candidate < (distances.get(neighbourId) ?? Infinity)) {
        distances.set(neighbourId, candidate);
        previous.set(neighbourId, current);
      }
    }
    remaining.delete(current);
  }
  if (fromId !== toId && !previous.has(toId)) return [];
  const path = [toId];
  while (path[0] !== fromId) {
    const prior = previous.get(path[0]);
    if (prior === undefined) return [];
    path.unshift(prior);
  }
  return path;
}

export function nearestWaypoint(waypoints, pos) {
  let closest = null;
  let best = Infinity;
  for (const waypoint of waypoints) {
    const dx = waypoint.pos.x - pos.x;
    const dz = waypoint.pos.z - pos.z;
    const distance = dx * dx + dz * dz;
    if (distance < best) {
      best = distance;
      closest = waypoint.id;
    }
  }
  return closest;
}
// Fourth integration fix pass.
// Fifth fix pass: lift greenhouse fill lighting for clear captures.
