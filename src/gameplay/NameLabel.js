import * as THREE from "three";

// ---------------------------------------------------------------------------
// A lightweight, camera-facing name tag rendered as a single textured
// plane -- companion to HealthBar.js (reused as-is, not duplicated). Text
// textures are rendered to an offscreen <canvas> ONCE per unique string and
// cached module-wide, so spawning many enemies that share a name (e.g. ten
// "MECHANICAL SENTINEL"s) costs one canvas render total, not one per
// instance -- see brief's PERFORMANCE section.
// ---------------------------------------------------------------------------

const textureCache = new Map();

function getTextureForName(text) {
  if (textureCache.has(text)) return textureCache.get(text);

  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = "bold 52px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Dark outline for readability over any background, then the fill.
  ctx.lineWidth = 8;
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
  ctx.fillStyle = "#ff5a3c";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  textureCache.set(text, texture);
  return texture;
}

let sharedGeometry = null;
function getSharedGeometry() {
  if (!sharedGeometry) sharedGeometry = new THREE.PlaneGeometry(1, 1);
  return sharedGeometry;
}

export class NameLabel {
  constructor(scene, text, { width = 2.2, yOffset = 1.6 } = {}) {
    this.scene = scene;
    this.disposed = false;
    this.yOffset = yOffset;

    const texture = getTextureForName(text);
    const aspect = texture.image.width / texture.image.height;
    const height = width / aspect;

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false
    });

    this.mesh = new THREE.Mesh(getSharedGeometry(), material);
    this.mesh.scale.set(width, height, 1);
    this.mesh.renderOrder = 15;
    this.mesh.visible = true;
    scene.add(this.mesh);
  }

  updateTransform(anchorWorldPos, camera) {
    if (this.disposed) return;
    this.mesh.position.set(anchorWorldPos.x, anchorWorldPos.y + this.yOffset, anchorWorldPos.z);
    if (camera) this.mesh.quaternion.copy(camera.quaternion);
  }

  setVisible(visible) {
    this.mesh.visible = visible;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.mesh);
    this.mesh.material.dispose();
  }
}