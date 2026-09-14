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
// Visual arc across the six stages (0 = base vehicle from VehicleVisual.js):
//   0 Base          -- rugged, functional, minimal tech (see VehicleVisual.js)
//   1 Reinforced     -- first obvious bolt-on armor, restrained
//   2 Armored        -- combat-ready silhouette begins
//   3 Heavy Combat   -- major jump: plow, full-length side plating, roof rig
//   4 Elite Cyberpunk -- cyan energy tech becomes a visible design language
//   5 Ultimate        -- full transformation: wide-body armor, rear wing,
//                        roof sensor array, underbody glow, wheel tech rings
//
// Used identically by the local Vehicle and every RemoteVehicle -- pass in
// whatever THREE.Group the vehicle body is parented to (`root`) and this
// attaches armor directly to it in the same local space the body panels
// already use. Optionally also pass the vehicle's wheel meshes (`wheels`)
// so stage 3+ can add a wheel-mounted tech accent that spins naturally with
// the wheel's own per-frame physics transform -- purely additive, safe to
// omit (existing callers that only pass `root` keep working unchanged).
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
    // Warm orange glow -- reserved for lower/mid stages (hazard striping,
    // mechanical heat) so the cool cyan tech palette below reads as a clear
    // step up when stage 4 introduces it.
    glow: new THREE.MeshStandardMaterial({
      color: 0xff8a3d, emissive: 0xff5c1a, emissiveIntensity: 0.9,
      metalness: 0.2, roughness: 0.4
    }),
    // Cool cyan energy tech -- introduced at stage 4 (Elite) and used
    // heavily at stage 5 (Ultimate). Its emissiveIntensity is animated
    // (see pulseIntensity() below) so the highest stages visibly "power
    // on" rather than just being a static bright color.
    techCyan: new THREE.MeshStandardMaterial({
      color: 0x8fe9e0, emissive: 0x2fd6c6, emissiveIntensity: 0.9,
      metalness: 0.3, roughness: 0.3
    }),
    // Small red warning accents on the highest stages (sensor status,
    // hazard tips) -- used sparingly against the cyan so it still reads as
    // a signal color, not decoration.
    warnRed: new THREE.MeshStandardMaterial({
      color: 0xff4a44, emissive: 0xff2018, emissiveIntensity: 0.85,
      metalness: 0.2, roughness: 0.4
    }),
    // Dark glossy lens for sensor/camera pods introduced from stage 3 on.
    lens: new THREE.MeshPhysicalMaterial({
      color: 0x0c1114, metalness: 0.2, roughness: 0.12,
      clearcoat: 1, clearcoatRoughness: 0.05
    })
  };
  return sharedMaterials;
}

// Wall-clock based pulse, deliberately stateless (no per-instance
// accumulator): every vehicle's tech-cyan/warn-red accents breathe in sync
// with each other, which reads as one consistent "power system" across the
// whole match rather than looking like a bug where cars drift out of phase.
function pulseIntensity(base, amplitude, speed = 2.6) {
  return base + Math.sin(performance.now() * 0.001 * speed) * amplitude;
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

// A small camera/sensor pod: dark lens + gunmetal-ish housing, used from
// stage 3 onward to build up the "this car is watching" tech read.
function sensorPod(parent, mat, position, radius = 0.045) {
  const g = new THREE.Group();
  g.position.set(...position);
  cyl(g, radius, radius, radius * 0.7, 10, [0, 0, 0], mat.plateDark, [Math.PI / 2, 0, 0]);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.6, radius * 0.6, 0.01, 10), mat.lens);
  lens.rotation.x = Math.PI / 2;
  lens.position.z = radius * 0.4;
  g.add(lens);
  parent.add(g);
  return g;
}

// A thin emissive strip -- the basic building block for the cyan tech
// accents that define stages 4-5. Kept as its own helper so those stages
// read as one consistent material language rather than one-off boxes.
function glowStrip(parent, mat, size, position, rotation, warn = false) {
  return box(parent, size, position, warn ? mat.warnRed : mat.techCyan, rotation);
}

// ---- Stage builders --------------------------------------------------------
// Each returns a fresh THREE.Group of *only that stage's new pieces*.
// Positions are tuned to VehicleVisual.js's shared body footprint (~1.78
// wide, ~3.98 long, wheel arches around z=+-1.15, fender flares out to
// about x=+-1.08).

function buildStage1_Reinforced(mat) {
  const g = new THREE.Group();
  // Front bumper armor bar.
  box(g, [1.9, 0.14, 0.14], [0, -0.02, 2.16], mat.plate);
  // Reinforced grille frame.
  box(g, [1.0, 0.32, 0.05], [0, 0.18, 2.14], mat.plateDark);
  // Small side skirt plates.
  for (const side of [-1, 1]) {
    box(g, [0.06, 0.14, 3.1], [side * 0.98, -0.1, 0], mat.plate);
  }
  // Rear reinforcement bar.
  box(g, [1.7, 0.14, 0.1], [0, -0.02, -2.2], mat.plate);
  // Subtle wheel-arch guards, resting just outside VehicleVisual.js's fender
  // flares.
  for (const side of [-1, 1]) {
    for (const zf of [1.15, -1.15]) {
      box(g, [0.05, 0.08, 0.4], [side * 1.1, 0.14, zf], mat.plateDark);
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
      size: [0.07, 0.5, 1.9], position: [side * 1.02, 0.42, -0.1],
      side, tilt: 0.05
    });
  }
  // Wheel arch protection, heavier this time.
  for (const side of [-1, 1]) {
    for (const zf of [1.15, -1.15]) {
      cyl(g, 0.5, 0.5, 0.08, 16, [side * 1.1, 0.1, zf], mat.plateDark,
        [Math.PI / 2, 0, 0]);
    }
  }
  // Rear armor plate.
  box(g, [1.86, 0.24, 0.12], [0, 0.05, -2.25], mat.plate);
  // Small roof-mounted sensor duo -- the first hint of onboard tech, still
  // restrained at this stage.
  for (const side of [-1, 1]) {
    sensorPod(g, mat, [side * 0.5, 1.4, 0.5], 0.035);
  }
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
  // Exposed hydraulic struts bracing the plow back to the bumper -- fills
  // the gap that used to read as "armor floating in front of the car".
  for (const side of [-1, 1]) {
    cyl(g, 0.025, 0.025, 0.45, 6, [side * 0.65, 0.12, 2.28], mat.hazard, [0.9, 0, 0]);
  }

  // Large side plating running the full length.
  for (const side of [-1, 1]) {
    box(g, [0.1, 0.62, 2.6], [side * 1.08, 0.4, -0.1], mat.plate);
    for (let i = -1; i <= 1; i++) {
      cyl(g, 0.02, 0.02, 0.65, 6, [side * (1.08 + 0.055), 0.4 + i * 0.22, -0.1],
        mat.bolt, [0, 0, Math.PI / 2]);
    }
    // Roof-line sensor pod at the leading edge of the side plate.
    sensorPod(g, mat, [side * 1.02, 0.78, 1.1], 0.05);
  }
  // Mechanical support struts under the sides.
  for (const side of [-1, 1]) {
    for (const zf of [0.9, -0.9]) {
      box(g, [0.05, 0.18, 0.05], [side * 1.07, 0.06, zf], mat.hazard);
    }
  }
  // Armor collar around the turret mounting area (roof), now doubling as an
  // equipment ring with small vents around its rim.
  cyl(g, 0.62, 0.62, 0.05, 16, [0, 1.4, -0.5], mat.plateDark, [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI * 2 * i) / 6;
    box(g, [0.05, 0.03, 0.09], [Math.cos(a) * 0.58, 1.4, -0.5 + Math.sin(a) * 0.58], mat.vent, [0, a, 0]);
  }
  return g;
}

function buildStage4_Elite(mat) {
  const g = new THREE.Group();
  // Layered front plates (stacked, staggered), edged with a thin cyan
  // pinstripe -- the first place the cool tech palette appears on the
  // exterior.
  for (let i = 0; i < 3; i++) {
    box(g, [1.75 - i * 0.18, 0.06, 0.08], [0, 0.5 + i * 0.11, 2.35 - i * 0.05], mat.plate);
  }
  glowStrip(g, mat, [1.4, 0.012, 0.012], [0, 0.61, 2.31]);

  // Reinforced roof plate + brackets, now carrying a small forward antenna
  // array instead of bare brackets.
  box(g, [1.3, 0.05, 1.6], [0, 1.44, -0.3], mat.plateDark);
  for (const side of [-1, 1]) {
    box(g, [0.05, 0.1, 0.2], [side * 0.6, 1.42, 0.35], mat.bolt);
    cyl(g, 0.012, 0.016, 0.22, 6, [side * 0.45, 1.6, -0.85], mat.plateDark);
    box(g, [0.02, 0.02, 0.02], [side * 0.45, 1.71, -0.85], mat.warnRed);
  }

  // Vents, now with a cyan strip running between them (an "intake fed by
  // the same energy system" read rather than plain black slots).
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      box(g, [0.03, 0.06, 0.16], [side * 1.1, 0.55, 0.4 - i * 0.22], mat.vent);
    }
    glowStrip(g, mat, [0.02, 0.05, 0.62], [side * 1.13, 0.55, 0.18]);
  }

  // Additional rear armor + wheel guards.
  box(g, [1.9, 0.3, 0.1], [0, 0.18, -2.32], mat.plate);
  glowStrip(g, mat, [1.7, 0.02, 0.012], [0, 0.32, -2.36]);
  for (const side of [-1, 1]) {
    for (const zf of [1.15, -1.15]) {
      cyl(g, 0.58, 0.58, 0.07, 16, [side * 1.12, 0.1, zf], mat.plate,
        [Math.PI / 2, 0, 0]);
    }
  }

  // Side sensor cluster replacing the single stage-3 pod with a pair,
  // reinforcing "elite" as a clear step up.
  for (const side of [-1, 1]) {
    sensorPod(g, mat, [side * 1.05, 0.85, 0.6], 0.045);
    sensorPod(g, mat, [side * 1.05, 0.85, -0.6], 0.045);
  }
  return g;
}

function buildStage5_Ultimate(mat) {
  const g = new THREE.Group();

  // Aggressive V-wedge front ram, edged in cyan.
  for (const side of [-1, 1]) {
    box(g, [0.9, 0.42, 0.14], [side * 0.42, 0.16, 2.5], mat.plate, [0, side * 0.32, 0]);
  }
  box(g, [0.4, 0.44, 0.12], [0, 0.16, 2.62], mat.plateDark);
  glowStrip(g, mat, [1.3, 0.02, 0.015], [0, 0.36, 2.58]);

  // Heavy multi-layer side armor with a full-length cyan energy strip
  // running between the two plate layers -- the vehicle's clearest single
  // "this is the max stage" signature.
  for (const side of [-1, 1]) {
    box(g, [0.14, 0.7, 3.0], [side * 1.14, 0.45, -0.1], mat.plate);
    box(g, [0.06, 0.66, 2.9], [side * 1.19, 0.45, -0.1], mat.plateDark);
    glowStrip(g, mat, [0.02, 0.05, 2.75], [side * 1.225, 0.45, -0.1]);
  }

  // Reinforced roof with a full sensor/antenna array (three rods with red
  // status tips, plus a wide dome sensor at the leading edge) instead of
  // the single-antenna hint at stage 4.
  box(g, [1.4, 0.06, 1.9], [0, 1.48, -0.3], mat.plateDark);
  for (const side of [-1, 1]) {
    cyl(g, 0.015, 0.02, 0.32, 6, [side * 0.5, 1.68, -0.9], mat.bolt);
    box(g, [0.025, 0.025, 0.025], [side * 0.5, 1.85, -0.9], mat.warnRed);
  }
  sensorPod(g, mat, [0, 1.53, 0.55], 0.07);
  glowStrip(g, mat, [0.5, 0.015, 0.015], [0, 1.515, 0.62]);

  // Large wheel armor discs, rear armor slab, exposed mechanical struts,
  // now with a cyan rim light on the wheel discs.
  for (const side of [-1, 1]) {
    for (const zf of [1.15, -1.15]) {
      cyl(g, 0.64, 0.64, 0.09, 20, [side * 1.16, 0.1, zf], mat.plateDark,
        [Math.PI / 2, 0, 0]);
      cyl(g, 0.66, 0.66, 0.012, 20, [side * 1.205, 0.1, zf], mat.techCyan,
        [Math.PI / 2, 0, 0]);
    }
    box(g, [0.06, 0.22, 0.06], [side * 1.1, -0.05, 0], mat.hazard);
  }
  box(g, [1.95, 0.36, 0.14], [0, 0.2, -2.38], mat.plate);

  // Rear aero: a wide two-pillar spoiler with a cyan underglow, plus an
  // extended diffuser with more, wider fins -- the "especially impressive
  // rear" requirement.
  for (const side of [-1, 1]) {
    box(g, [0.06, 0.32, 0.06], [side * 0.55, 0.62, -2.35], mat.plateDark);
  }
  box(g, [1.5, 0.05, 0.4], [0, 0.94, -2.4], mat.plate);
  box(g, [1.5, 0.05, 0.4], [0, 0.9, -2.4], mat.plateDark, [0.1, 0, 0]);
  glowStrip(g, mat, [1.3, 0.012, 0.012], [0, 0.905, -2.58]);
  for (let i = -4; i <= 4; i++) {
    box(g, [0.03, 0.08, 0.16], [i * 0.2, -0.16, -2.2], mat.plateDark);
  }

  // A subtle underbody rim strip along each rocker -- an "underglow" that
  // stays low-key (thin, dim relative to the exterior strips) rather than
  // the neon-everywhere look the brief explicitly warns against.
  for (const side of [-1, 1]) {
    box(g, [0.02, 0.012, 3.2], [side * 0.98, -0.19, -0.1], mat.techCyan);
  }

  // Small holographic-style projector flourish above the front sensor pod
  // -- a flat additive-blended fin standing in for a projected marker,
  // cheap (one extra plane, no shader) but reads as "holographic tech".
  const holo = new THREE.Mesh(
    new THREE.PlaneGeometry(0.16, 0.1),
    new THREE.MeshBasicMaterial({
      color: 0x8ff2e6,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  );
  holo.position.set(0, 1.68, 0.55);
  holo.rotation.x = -Math.PI / 2.3;
  holo.userData.evolutionHolo = true;
  g.add(holo);

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

// Adds a small wheel-mounted tech accent as a child of an existing wheel
// group. It inherits the wheel's own per-frame physics transform (position
// + full spin quaternion) automatically since it's just another child mesh
// -- no extra per-frame code needed anywhere. `tier` 0 = stage 3-ish accent
// (thin ring), `tier` 1 = stage 5 accent (brighter ring + hub cap).
function addWheelAccent(wheelGroup, mat, tier) {
  if (!wheelGroup || wheelGroup.userData.evolutionAccentTier >= tier) return;
  wheelGroup.userData.evolutionAccentTier = tier;

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.245, tier === 1 ? 0.014 : 0.008, 8, 24),
    mat.techCyan
  );
  ring.rotation.y = Math.PI / 2;
  ring.userData.sharedEvolutionMaterial = true;
  wheelGroup.add(ring);

  if (tier === 1) {
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.02, 16),
      mat.techCyan
    );
    cap.rotation.z = Math.PI / 2;
    cap.userData.sharedEvolutionMaterial = true;
    wheelGroup.add(cap);
  }
}

// ---------------------------------------------------------------------------
// Rig: owns the per-vehicle instance state (which stage groups have been
// built/attached so far, and the current reveal animation, if any).
// ---------------------------------------------------------------------------
export class VehicleEvolutionRig {
  // `wheels`: optional array of the vehicle's 4 wheel THREE.Groups (from
  // Vehicle.js/RemoteVehicle.js). Purely additive -- existing callers that
  // only pass `root` keep working exactly as before, just without the
  // stage 3/5 wheel accent rings.
  constructor(root, wheels = []) {
    this.root = root;
    this.wheels = wheels;
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

    for (let s = 1; s <= target; s++) {
      if (!this.stageGroups[s]) {
        const stageGroup = STAGE_BUILDERS[s](this.mat);
        this.root.add(stageGroup);
        this.stageGroups[s] = stageGroup;

        const isNewlyReached = s === target && s > this.currentStage;
        if (animate && isNewlyReached) {
          this.beginReveal(stageGroup);
        }
      }
    }

    // Wheel tech accents track the same cumulative-stage rule as the body
    // armor: once earned, they stay. Tier 0 at stage 3 (heavy combat wheel
    // guards imply reinforced hubs), tier 1 (brighter, plus a hub cap) at
    // stage 5.
    if (this.wheels && this.wheels.length) {
      const tier = target >= 5 ? 1 : target >= 3 ? 0 : -1;
      if (tier >= 0) {
        for (const wheel of this.wheels) addWheelAccent(wheel, this.mat, tier);
      }
    }

    this.currentStage = target;
  }

  beginReveal(stageGroup) {
    // Small mechanical "pop": scale up from near-zero with an overshoot
    // ease, while also rising slightly from below into position, over
    // roughly 1.5-2.5s depending on how much geometry the stage has.
    stageGroup.scale.setScalar(0.05);
    this.animStartPos.set(0, -0.4, 0);
    this.animTargetPos.set(0, 0, 0);
    stageGroup.position.copy(this.animStartPos);

    this.animGroup = stageGroup;
    this.animElapsed = 0;
    this.animDuration = 1.6 + Math.min(1, this.currentStage * 0.15);
  }

  update(dt) {
    // Cyan/red tech accents breathe gently from stage 4 onward -- cheap
    // (two shared-material writes, not per-mesh) and only touches the
    // materials at all once the vehicle has actually reached elite tech,
    // so lower stages keep their static, "not powered up yet" read.
    if (this.currentStage >= 4) {
      this.mat.techCyan.emissiveIntensity = pulseIntensity(0.85, 0.35, 2.6);
    }
    if (this.currentStage >= 5) {
      this.mat.warnRed.emissiveIntensity = pulseIntensity(0.7, 0.3, 1.4);
    }

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
    for (const stageGroup of this.stageGroups) {
      if (!stageGroup) continue;
      stageGroup.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
      });
      stageGroup.parent?.remove(stageGroup);
    }
  }
}

export { MAX_EVOLUTION_STAGE };
