import * as THREE from "three";

// ---------------------------------------------------------------------------
// A lightweight, camera-facing HP bar rendered as two plane meshes (dark
// backing + colored fill) directly in the Three.js scene -- no DOM, no
// per-instance canvas/texture allocation, no per-frame Vector3 churn.
//
// Geometry is created once at module scope and shared by every bar
// (enemies, boss, player); only each bar's own material clones (for
// independent color/opacity) and its Group transform are per-instance,
// matching the pattern already used by Target.js / TurretEffects.js.
// ---------------------------------------------------------------------------

let sharedAssets = null;

function getSharedAssets() {
  if (sharedAssets) return sharedAssets;

  const bgGeometry = new THREE.PlaneGeometry(1, 1);

  // Fill plane's local origin sits at its own left edge (rather than
  // center) so scaling it on X shrinks the bar from the right instead of
  // from both sides at once, like a real health bar.
  const fillGeometry = new THREE.PlaneGeometry(1, 1);
  fillGeometry.translate(0.5, 0, 0);

  const bgMaterial = new THREE.MeshBasicMaterial({
    color: 0x0c1420,
    transparent: true,
    opacity: 0.85,
    depthWrite: false
  });

  const fillMaterial = new THREE.MeshBasicMaterial({
    color: 0x3ddc84,
    transparent: true,
    depthWrite: false
  });

  sharedAssets = { bgGeometry, fillGeometry, bgMaterial, fillMaterial };
  return sharedAssets;
}

export class HealthBar {
  constructor(scene, { width = 1.5, height = 0.16, yOffset = 1.25 } = {}) {
    const assets = getSharedAssets();

    this.scene = scene;
    this.width = width;
    this.yOffset = yOffset;
    this.disposed = false;

    this.group = new THREE.Group();
    this.group.renderOrder = 15;
    this.group.visible = false; // hidden until the first setRatio() call

    this.bg = new THREE.Mesh(assets.bgGeometry, assets.bgMaterial.clone());
    this.bg.renderOrder = 15;
    this.bg.scale.set(width + 0.05, height + 0.05, 1);
    this.bg.position.x = 0;

    this.fill = new THREE.Mesh(assets.fillGeometry, assets.fillMaterial.clone());
    this.fill.renderOrder = 16;
    this.fill.scale.set(width, height, 1);
    this.fill.position.x = -width / 2;

    this.group.add(this.bg, this.fill);
    scene.add(this.group);
  }

  // ratio in [0, 1]. Green -> yellow -> red as the bar drains.
  setRatio(ratio) {
    const r = Math.max(0, Math.min(1, ratio));
    this.fill.scale.x = Math.max(0.0001, this.width * r);
    this.fill.material.color.setHSL(r * 0.33, 0.85, 0.5);
    this.group.visible = r > 0;
  }

  // anchorWorldPos: THREE.Vector3 in world space (e.g. an enemy's or the
  // vehicle's current position). camera: the active render camera, so the
  // bar can billboard toward it every frame without its own lookAt math.
  updateTransform(anchorWorldPos, camera) {
    this.group.position.set(
      anchorWorldPos.x,
      anchorWorldPos.y + this.yOffset,
      anchorWorldPos.z
    );
    this.group.quaternion.copy(camera.quaternion);
  }

  setVisible(visible) {
    this.group.visible = visible && this.fill.scale.x > 0.0001;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.group);
    this.bg.material.dispose();
    this.fill.material.dispose();
  }
}
