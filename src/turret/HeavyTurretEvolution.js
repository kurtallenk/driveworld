import * as THREE from "three";

// ---------------------------------------------------------------------------
// Heavy Vehicle turret evolution builders (stages 1-5; stage 0 is the
// Breacher Cannon built by HeavyTurretModel.js). Same builder contract as
// TurretEvolution.js's light builders: each returns
//   { group, muzzles: Object3D[], spinners: Object3D[], pods?, glow? }
// and is mounted on `parts.barrelGroup` so it inherits recoil + aim.
// Weapon stats live in EvolutionConfig.js HEAVY_TURRET_EVOLUTION_CONFIG.
// ---------------------------------------------------------------------------

function mesh(parent, geometry, material, position, rotation) {
  const m = new THREE.Mesh(geometry, material);
  if (position) m.position.set(...position);
  if (rotation) m.rotation.set(...rotation);
  m.castShadow = true;
  parent.add(m);
  return m;
}

function tube(radiusFront, radiusBack, length, segments = 14) {
  const geo = new THREE.CylinderGeometry(radiusFront, radiusBack, length, segments);
  geo.rotateX(Math.PI / 2);
  geo.translate(0, 0, length / 2);
  return geo;
}

// A cannon: thick barrel, bore evacuator, muzzle brake, muzzle point.
function cannon(mat, { length, radius, x = 0, brake = true, jacketRings = 0 }) {
  const g = new THREE.Group();
  g.position.x = x;
  mesh(g, tube(radius, radius * 1.18, length), mat.barrel);
  mesh(g, tube(radius * 1.45, radius * 1.45, 0.12), mat.gunmetal, [0, 0, length * 0.42]);
  for (let i = 0; i < jacketRings; i++) {
    mesh(g, tube(radius * 1.3, radius * 1.3, 0.025, 10), mat.dark, [0, 0, length * (0.12 + i * 0.07)]);
  }
  if (brake) {
    mesh(g, new THREE.BoxGeometry(radius * 3, radius * 1.9, 0.11), mat.gunmetal, [0, 0, length + 0.04]);
  }
  const muzzle = new THREE.Group();
  muzzle.position.z = length + (brake ? 0.12 : 0.02);
  g.add(muzzle);
  return { group: g, muzzle };
}

function ammoDrum(mat, x) {
  const g = new THREE.Group();
  mesh(g, new THREE.CylinderGeometry(0.09, 0.09, 0.1, 14), mat.gunmetal, [x, -0.02, 0.06], [0, 0, Math.PI / 2]);
  mesh(g, new THREE.BoxGeometry(0.05, 0.04, 0.14), mat.dark, [x * 0.55, -0.02, 0.08]);
  return g;
}

function buildStage1_TwinBreacher(mat) {
  const group = new THREE.Group();
  const a = cannon(mat, { length: 0.66, radius: 0.052, x: -0.12 });
  const b = cannon(mat, { length: 0.66, radius: 0.052, x: 0.12 });
  group.add(a.group, b.group);
  mesh(group, new THREE.BoxGeometry(0.36, 0.1, 0.16), mat.gunmetal, [0, 0, 0.06]);
  return { group, muzzles: [a.muzzle, b.muzzle], spinners: [] };
}

function buildStage2_SiegeAutocannon(mat) {
  const group = new THREE.Group();
  const c = cannon(mat, { length: 0.86, radius: 0.048, jacketRings: 5 });
  group.add(c.group);
  group.add(ammoDrum(mat, 0.17));
  return { group, muzzles: [c.muzzle], spinners: [] };
}

function buildStage3_TwinSiege(mat) {
  const group = new THREE.Group();
  const a = cannon(mat, { length: 0.82, radius: 0.045, x: -0.13, jacketRings: 4 });
  const b = cannon(mat, { length: 0.82, radius: 0.045, x: 0.13, jacketRings: 4 });
  group.add(a.group, b.group);
  group.add(ammoDrum(mat, -0.26), ammoDrum(mat, 0.26));
  mesh(group, new THREE.BoxGeometry(0.4, 0.1, 0.18), mat.gunmetal, [0, 0, 0.06]);
  return { group, muzzles: [a.muzzle, b.muzzle], spinners: [] };
}

function buildStage4_MortarBattery(mat) {
  const group = new THREE.Group();
  // Launch rack on the mount.
  mesh(group, new THREE.BoxGeometry(0.46, 0.12, 0.3), mat.gunmetal, [0, 0.02, 0.1]);
  mesh(group, new THREE.BoxGeometry(0.48, 0.02, 0.32), mat.warn, [0, 0.085, 0.1]);
  const muzzles = [];
  const pods = [];
  for (const side of [-1, 1]) {
    const tubeGroup = new THREE.Group();
    tubeGroup.position.set(side * 0.13, 0.08, 0.08);
    tubeGroup.rotation.x = -0.32; // tilted up for lobbed shells
    mesh(tubeGroup, tube(0.085, 0.095, 0.5, 14), mat.barrel);
    mesh(tubeGroup, tube(0.105, 0.105, 0.06, 14), mat.gunmetal, [0, 0, 0.44]);
    mesh(tubeGroup, tube(0.1, 0.1, 0.05, 14), mat.dark, [0, 0, 0.05]);
    const muzzle = new THREE.Group();
    muzzle.position.z = 0.52;
    tubeGroup.add(muzzle);
    group.add(tubeGroup);
    muzzles.push(muzzle);
    pods.push(tubeGroup);
  }
  return { group, muzzles, spinners: [], pods };
}

function buildStage5_TitanRail(mat) {
  const group = new THREE.Group();
  // Per-instance glow material so a firing pulse only lights this turret.
  const glow = new THREE.MeshStandardMaterial({
    color: 0x7fe9ff, emissive: 0x38c8ff, emissiveIntensity: 0.8,
    metalness: 0.3, roughness: 0.4
  });
  glow.userData.ownedByRig = true;
  const length = 1.0;
  for (const side of [-1, 1]) {
    mesh(group, new THREE.BoxGeometry(0.05, 0.1, length), mat.gunmetal, [side * 0.075, 0, length / 2]);
    mesh(group, new THREE.BoxGeometry(0.012, 0.06, length * 0.9), glow, [side * 0.048, 0, length / 2 + 0.03]);
  }
  for (let i = 0; i < 6; i++) {
    mesh(group, new THREE.BoxGeometry(0.22, 0.14, 0.03), i % 2 ? mat.dark : glow, [0, 0, 0.2 + i * 0.14]);
  }
  // Capacitor bank behind the rails.
  mesh(group, new THREE.BoxGeometry(0.34, 0.16, 0.22), mat.gunmetal, [0, 0, 0.02]);
  for (const side of [-1, 1]) {
    mesh(group, new THREE.CylinderGeometry(0.04, 0.04, 0.2, 10), glow, [side * 0.13, 0.1, 0.02], [Math.PI / 2, 0, 0]);
  }
  const muzzle = new THREE.Group();
  muzzle.position.z = length + 0.05;
  group.add(muzzle);
  return { group, muzzles: [muzzle], spinners: [], glow };
}

export const HEAVY_STAGE_BUILDERS = [
  null, // stage 0 = Breacher Cannon from HeavyTurretModel.js
  buildStage1_TwinBreacher,
  buildStage2_SiegeAutocannon,
  buildStage3_TwinSiege,
  buildStage4_MortarBattery,
  buildStage5_TitanRail
];
