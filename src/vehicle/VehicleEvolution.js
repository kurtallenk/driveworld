import * as THREE from "three";
import { easeOutBack, easeOutCubic, clamp01 } from "../turret/TurretMath.js";
import { MAX_EVOLUTION_STAGE } from "../gameplay/EvolutionConfig.js";

// ---------------------------------------------------------------------------
// Vehicle armor evolution.
//
// Each milestone stage is its own small THREE.Group of angled plates /
// brackets / vents built from primitives (same modeling approach as
// Vehicle.js/RemoteVehicle.js -- boxes, cylinders, shared materials created
// once). Stages are ADDITIVE and never rebuilt: reaching stage 3 means
// stages 1, 2 and 3's groups are all attached and visible at once, which is
// both cheaper (nothing is ever thrown away and reconstructed) and matches
// "the car keeps the armor it already earned" (requirement #14).
//
// Used identically by the local Vehicle and every RemoteVehicle -- pass in
// whatever THREE.Group the vehicle body is parented to (`root`) and this
// attaches armor directly to it in the same local space the body panels
// already use.
// ---------------------------------------------------------------------------

let sharedMaterials = null;
function getArmorMaterials() {
  if (sharedMaterials) return sharedMaterials;
  sharedMaterials = {
    plate: new THREE.MeshStandardMaterial({
      color: 0x3a4048, metalness: 0.75, roughness: 0.4
    }),
    plateDark: new THREE.MeshStandardMaterial({
      color: 0x1d2126, metalness: 0.6, roughness: 0.55
    }),
    hazard: new THREE.MeshStandardMaterial({
      color: 0x2b2f34, metalness: 0.3, roughness: 0.7
    }),
    bolt: new THREE.MeshStandardMaterial({
      color: 0x9aa0a6, metalness: 0.9, roughness: 0.3
    }),
    vent: new THREE.MeshStandardMaterial({
      color: 0x111417, metalness: 0.2, roughness: 0.9
    }),
    glow: new THREE.MeshStandardMaterial({
      color: 0xff8a3d, emissive: 0xff5c1a, emissiveIntensity: 0.9,
      metalness: 0.2, roughness: 0.4
    })
  };
  return sharedMaterials;
}

function box(parent, size, position, material, rotation) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // Flags this mesh as using a module-level material shared across every
  // vehicle instance (see getArmorMaterials() above) -- VehicleDestruction.js
  // checks this before darkening anything, so it clones a private copy for
  // the wreck effect instead of mutating the singleton every vehicle points
  // at (see VehicleDestruction._darkenMaterials()).
  mesh.userData.sharedEvolutionMaterial = true;
  parent.add(mesh);
  return mesh;
}

function cyl(parent, radiusTop, radiusBottom, height, segments, position, material, rotation) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments),
    material
  );
  mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.userData.sharedEvolutionMaterial = true;
  parent.add(mesh);
  return mesh;
}

// One angled plate bolted onto the body at `side` (-1/1/0 for centered).
function angledPlate(parent, mat, { size, position, tilt = 0.18, side = 0 }) {
  const g = new THREE.Group();
  g.position.set(...position);
  g.rotation.z = tilt * side;
  box(g, size, [0, 0, 0], mat.plate);
  for (const bx of [-size[0] / 2 + 0.03, size[0] / 2 - 0.03]) {
    cyl(g, 0.014, 0.014, size[2] * 0.9, 6, [bx, size[1] / 2 + 0.006, 0], mat.bolt, [Math.PI / 2, 0, 0]);
  }
  parent.add(g);
  return g;
}

// ---- Stage builders --------------------------------------------------------
// Each returns a fresh THREE.Group of *only that stage's new pieces*.
// Positions are tuned to Vehicle.js/RemoteVehicle.js's shared body
// footprint (~1.78 wide, ~3.98 long, wheel arches around z=+-1.15).

function buildStage1_Reinforced(mat) {
  const g = new THREE.Group();
  // Front bumper armor bar.
  box(g, [1.9, 0.14, 0.14], [0, -0.02, 2.16], mat.plate);
  // Reinforced grille frame.
  box(g, [1.0, 0.32, 0.05], [0, 0.18, 2.14], mat.plateDark);
  // Small side skirt plates.
  for (const side of [-1, 1]) {
    box(g, [0.06, 0.14, 3.1], [side * 0.96, -0.1, 0], mat.plate);
  }
  // Rear reinforcement bar.
  box(g, [1.7, 0.14, 0.1], [0, -0.02, -2.2], mat.plate);
  // Subtle wheel-arch guards.
  for (const side of [-1, 1]) {
    for (const zf of [1.15, -1.15]) {
      box(g, [0.05, 0.08, 0.4], [side * 0.99, 0.14, zf], mat.plateDark);
    }
  }
  return g;
}

function buildStage2_Armored(mat) {
  const g = new THREE.Group();
  // Larger front ram / bull bar.
  box(g, [1.7, 0.2, 0.16], [0, 0.14, 2.3], mat.plate);
  for (const side of [-1, 1]) {
    box(g, [0.12, 0.28, 0.16], [side * 0.7, 0.02, 2.3], mat.plateDark);
  }
  // Side armor panels over the doors.
  for (const side of [-1, 1]) {
    angledPlate(g, mat, {
      size: [0.07, 0.5, 1.9], position: [side * 1.0, 0.42, -0.1],
      side, tilt: 0.05
    });
  }
  // Wheel arch protection, heavier this time.
  for (const side of [-1, 1]) {
    for (const zf of [1.15, -1.15]) {
      cyl(g, 0.5, 0.5, 0.08, 16, [side * 1.0, 0.1, zf], mat.plateDark,
        [Math.PI / 2, 0, 0]);
    }
  }
  // Rear armor plate.
  box(g, [1.86, 0.24, 0.12], [0, 0.05, -2.25], mat.plate);
  return g;
}

function buildStage3_HeavyCombat(mat) {
  const g = new THREE.Group();
  // Heavy angled front plow.
  const plow = new THREE.Group();
  plow.position.set(0, 0.02, 2.42);
  box(plow, [1.6, 0.4, 0.1], [0, 0, 0], mat.plate, [-0.35, 0, 0]);
  box(plow, [1.6, 0.06, 0.1], [0, 0.22, -0.08], mat.plateDark, [-0.35, 0, 0]);
  g.add(plow);

  // Large side plating running the full length.
  for (const side of [-1, 1]) {
    box(g, [0.1, 0.62, 2.6], [side * 1.03, 0.4, -0.1], mat.plate);
    for (let i = -1; i <= 1; i++) {
      cyl(g, 0.02, 0.02, 0.65, 6, [side * (1.03 + 0.055), 0.4 + i * 0.22, -0.1],
        mat.bolt, [0, 0, Math.PI / 2]);
    }
  }
  // Mechanical support struts under the sides.
  for (const side of [-1, 1]) {
    for (const zf of [0.9, -0.9]) {
      box(g, [0.05, 0.18, 0.05], [side * 1.02, 0.06, zf], mat.hazard);
    }
  }
  // Armor collar around the turret mounting area (roof).
  cyl(g, 0.62, 0.62, 0.05, 16, [0, 1.4, -0.5], mat.plateDark, [Math.PI / 2, 0, 0]);
  return g;
}

function buildStage4_Elite(mat) {
  const g = new THREE.Group();
  // Layered front plates (stacked, staggered).
  for (let i = 0; i < 3; i++) {
    box(g, [1.75 - i * 0.18, 0.06, 0.08], [0, 0.5 + i * 0.11, 2.35 - i * 0.05], mat.plate);
  }
  // Reinforced roof plate + brackets.
  box(g, [1.3, 0.05, 1.6], [0, 1.44, -0.3], mat.plateDark);
  for (const side of [-1, 1]) {
    box(g, [0.05, 0.1, 0.2], [side * 0.6, 1.42, 0.35], mat.bolt);
  }
  // Vents.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      box(g, [0.03, 0.06, 0.16], [side * 1.06, 0.55, 0.4 - i * 0.22], mat.vent);
    }
  }
  // Additional rear armor + wheel guards.
  box(g, [1.9, 0.3, 0.1], [0, 0.18, -2.32], mat.plate);
  for (const side of [-1, 1]) {
    for (const zf of [1.15, -1.15]) {
      cyl(g, 0.58, 0.58, 0.07, 16, [side * 1.02, 0.1, zf], mat.plate,
        [Math.PI / 2, 0, 0]);
    }
  }
  return g;
}

function buildStage5_Ultimate(mat) {
  const g = new THREE.Group();
  // Aggressive V-wedge front ram.
  for (const side of [-1, 1]) {
    box(g, [0.9, 0.42, 0.14], [side * 0.42, 0.16, 2.5], mat.plate, [0, side * 0.32, 0]);
  }
  box(g, [0.4, 0.44, 0.12], [0, 0.16, 2.62], mat.plateDark);
  // Heavy multi-layer side armor with visible rivets/hazard glow strip.
  for (const side of [-1, 1]) {
    box(g, [0.14, 0.7, 3.0], [side * 1.08, 0.45, -0.1], mat.plate);
    box(g, [0.02, 0.05, 2.8], [side * 1.16, 0.45, -0.1], mat.glow);
  }
  // Reinforced roof with a low antenna/spike cluster.
  box(g, [1.4, 0.06, 1.9], [0, 1.48, -0.3], mat.plateDark);
  for (const side of [-1, 1]) {
    cyl(g, 0.015, 0.02, 0.3, 6, [side * 0.5, 1.66, -0.9], mat.bolt);
  }
  // Large wheel armor discs, rear armor slab, exposed mechanical struts.
  for (const side of [-1, 1]) {
    for (const zf of [1.15, -1.15]) {
      cyl(g, 0.64, 0.64, 0.09, 20, [side * 1.05, 0.1, zf], mat.plateDark,
        [Math.PI / 2, 0, 0]);
    }
    box(g, [0.06, 0.22, 0.06], [side * 1.0, -0.05, 0], mat.hazard);
  }
  box(g, [1.95, 0.36, 0.14], [0, 0.2, -2.38], mat.plate);
  return g;
}

const STAGE_BUILDERS = [
  null, // stage 0 = default vehicle, nothing added
  buildStage1_Reinforced,
  buildStage2_Armored,
  buildStage3_HeavyCombat,
  buildStage4_Elite,
  buildStage5_Ultimate
];

// ---------------------------------------------------------------------------
// Rig: owns the per-vehicle instance state (which stage groups have been
// built/attached so far, and the current reveal animation, if any).
// ---------------------------------------------------------------------------
export class VehicleEvolutionRig {
  constructor(root) {
    this.root = root;
    this.mat = getArmorMaterials();
    this.stageGroups = new Array(STAGE_BUILDERS.length).fill(null);
    this.currentStage = 0;

    // Reveal animation for the most-recently-added stage group only --
    // everything below it is already fully settled and untouched.
    this.animGroup = null;
    this.animElapsed = 0;
    this.animDuration = 1;
    this.animTargetPos = new THREE.Vector3();
    this.animStartPos = new THREE.Vector3();
  }

  // Ensures stage groups 1..stage exist and are visible; animates the newly
  // revealed one(s) in. Safe to call repeatedly with the same stage (no-op)
  // -- see requirement "evolution does not happen again every frame".
  setStage(stage, { animate = true } = {}) {
    const target = Math.max(0, Math.min(STAGE_BUILDERS.length - 1, stage));
    if (target === this.currentStage && this.stageGroups[target] !== undefined) {
      // Still make sure everything up to target is actually built (covers
      // late-joining remote vehicles that need to materialize several
      // stages at once with no animation).
    }

    for (let s = 1; s <= target; s++) {
      if (!this.stageGroups[s]) {
        const group = STAGE_BUILDERS[s](this.mat);
        this.root.add(group);
        this.stageGroups[s] = group;

        const isNewlyReached = s === target && s > this.currentStage;
        if (animate && isNewlyReached) {
          this.beginReveal(group);
        }
      }
    }

    this.currentStage = target;
  }

  beginReveal(group) {
    // Small mechanical "pop": scale up from near-zero with an overshoot
    // ease, while also rising slightly from below into position, over
    // roughly 1.5-2.5s depending on how much geometry the stage has.
    group.scale.setScalar(0.05);
    this.animStartPos.set(0, -0.4, 0);
    this.animTargetPos.set(0, 0, 0);
    group.position.copy(this.animStartPos);

    this.animGroup = group;
    this.animElapsed = 0;
    this.animDuration = 1.6 + Math.min(1, this.currentStage * 0.15);
  }

  update(dt) {
    if (!this.animGroup) return;

    this.animElapsed += dt;
    const t = clamp01(this.animElapsed / this.animDuration);
    const eased = easeOutBack(t);

    this.animGroup.scale.setScalar(Math.max(0.05, eased));
    this.animGroup.position.lerpVectors(
      this.animStartPos, this.animTargetPos, easeOutCubic(t)
    );

    if (t >= 1) {
      this.animGroup.scale.setScalar(1);
      this.animGroup.position.copy(this.animTargetPos);
      this.animGroup = null;
    }
  }

  dispose() {
    for (const group of this.stageGroups) {
      if (!group) continue;
      group.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
      });
      group.parent?.remove(group);
    }
  }
}

export { MAX_EVOLUTION_STAGE };
