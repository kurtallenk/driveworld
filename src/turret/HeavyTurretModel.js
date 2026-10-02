import * as THREE from "three";
import { createTurretAssembly } from "./TurretModel.js";

// ---------------------------------------------------------------------------
// Heavy Vehicle turret: "Breacher" cannon housing.
//
// Built on top of createTurretAssembly so it returns the exact same `parts`
// contract (frame, panels, liftColumn, turretYaw, bodyShell, gunMountPivot,
// barrelGroup, barrelMesh, muzzleTip, muzzleFlash) and therefore reuses the
// existing deploy animation (TurretPose.js), armour rig and evolution rig
// unchanged. What differs is the silhouette: a 1.3x larger hatch, a wide,
// low, slab-armoured housing with a rear bustle and commander cupola, a big
// mantlet, and a thick cannon barrel with a bore evacuator and muzzle brake
// -- clearly distinct from the light vehicle's slim cylindrical gun pod.
// ---------------------------------------------------------------------------

export const HEAVY_TURRET_SCALE = 1.3;
export const HEAVY_BARREL_LENGTH = 0.72;

function addMesh(parent, geometry, material, position, rotation) {
  const mesh = new THREE.Mesh(geometry, material);
  if (position) mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function createHeavyTurretAssembly(paintColor) {
  const assembly = createTurretAssembly(paintColor);
  const { parts, materials: mat } = assembly;

  assembly.root.scale.setScalar(HEAVY_TURRET_SCALE);
  assembly.root.userData.turretKind = "heavy";

  // ---- Housing: replace the light cylinder pod -------------------------
  for (const child of parts.bodyShell.children) child.visible = false;
  const shell = parts.bodyShell;
  addMesh(shell, new THREE.BoxGeometry(0.6, 0.2, 0.52), mat.paint, [0, 0.1, -0.02]);
  // Sloped front glacis.
  addMesh(shell, new THREE.BoxGeometry(0.58, 0.1, 0.2), mat.paint, [0, 0.17, 0.22], [0.45, 0, 0]);
  // Side armour skirts.
  for (const side of [-1, 1]) {
    addMesh(shell, new THREE.BoxGeometry(0.04, 0.16, 0.5), mat.gunmetal, [side * 0.32, 0.08, -0.02]);
  }
  // Rear bustle (ammo store).
  addMesh(shell, new THREE.BoxGeometry(0.5, 0.15, 0.18), mat.gunmetal, [0, 0.12, -0.34]);
  addMesh(shell, new THREE.BoxGeometry(0.52, 0.02, 0.2), mat.darkTrim, [0, 0.2, -0.34]);
  // Commander cupola + periscope.
  addMesh(shell, new THREE.CylinderGeometry(0.08, 0.09, 0.07, 10), mat.gunmetal, [-0.16, 0.235, -0.12]);
  addMesh(shell, new THREE.BoxGeometry(0.06, 0.04, 0.03), mat.darkTrim, [-0.16, 0.27, -0.06]);

  // ---- Mantlet on the pitch pivot -------------------------------------
  addMesh(parts.gunMountPivot, new THREE.BoxGeometry(0.3, 0.2, 0.14), mat.gunmetal, [0, 0, 0.1]);
  addMesh(parts.gunMountPivot, new THREE.BoxGeometry(0.32, 0.04, 0.16), mat.darkTrim, [0, 0.1, 0.1]);

  // ---- Thick cannon barrel (keeps the telescoping deploy) ------------
  const length = HEAVY_BARREL_LENGTH;
  const barrelGeometry = new THREE.CylinderGeometry(0.06, 0.072, length, 14);
  barrelGeometry.rotateX(Math.PI / 2);
  barrelGeometry.translate(0, 0, length / 2);
  parts.barrelMesh.geometry.dispose();
  parts.barrelMesh.geometry = barrelGeometry;

  // Children of barrelMesh ride its scale.z telescoping.
  addMesh(
    parts.barrelMesh,
    new THREE.CylinderGeometry(0.085, 0.085, 0.14, 14),
    mat.gunmetal,
    [0, 0, length * 0.45],
    [Math.PI / 2, 0, 0]
  );
  const brake = new THREE.Group();
  brake.position.z = length;
  parts.barrelMesh.add(brake);
  addMesh(brake, new THREE.BoxGeometry(0.2, 0.12, 0.12), mat.gunmetal, [0, 0, 0.04]);
  for (const side of [-1, 1]) {
    addMesh(brake, new THREE.BoxGeometry(0.03, 0.1, 0.035), mat.darkTrim, [side * 0.1, 0, 0.04]);
  }

  parts.muzzleTip.position.z = length + 0.12;
  parts.muzzleFlash.scale.setScalar(1.4);

  assembly.barrelLength = length;
  return assembly;
}

export function createTurretAssemblyForPath(path, paintColor) {
  return path === "heavy"
    ? createHeavyTurretAssembly(paintColor)
    : createTurretAssembly(paintColor);
}
