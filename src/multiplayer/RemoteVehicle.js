import * as THREE from "three";
import { ChatBubble } from "./ChatBubble.js";

const INTERPOLATION_DELAY = 120;

// A little clearance above the top edge of the nameplate sprite
// (label.position.y=2, label.scale.y=0.525) so the bubble tail never
// overlaps the player's name.
const BUBBLE_ANCHOR_Y = 2.35;

export class RemoteVehicle {
  constructor(scene, player) {
    this.scene = scene;
    this.id = player.id;
    this.name = typeof player.name === "string" && player.name.length > 0
      ? player.name
      : `Driver ${player.id.slice(0, 6)}`;

    this.root = new THREE.Group();
    scene.add(this.root);

    this.samples = [];
    this.lastState = player.state;

    this.paint = new THREE.MeshStandardMaterial({
      color: player.color,
      metalness: 0.4,
      roughness: 0.35
    });

    const dark = new THREE.MeshStandardMaterial({
      color: 0x17212b,
      roughness: 0.85
    });

    const glass = new THREE.MeshStandardMaterial({
      color: 0x294958,
      metalness: 0.25,
      roughness: 0.3
    });

    const trim = new THREE.MeshStandardMaterial({
      color: 0x778591,
      metalness: 0.5,
      roughness: 0.4
    });

    const box = (size, position, material) => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(...size),
        material
      );

      mesh.position.set(...position);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
      return mesh;
    };

    box([1.8, 0.45, 4], [0, 0.1, 0], this.paint);
    box([1.5, 0.6, 2], [0, 0.65, -0.15], glass);
    box([1.65, 0.1, 2.15], [0, 1, -0.15], this.paint);
    box([1.75, 0.2, 1], [0, 0.35, 1.4], this.paint);
    box([1.85, 0.15, 0.15], [0, 0, 2.02], dark);
    box([1.85, 0.15, 0.15], [0, 0, -2.02], dark);

    const headlights = new THREE.MeshStandardMaterial({
      color: 0xffefd1,
      emissive: 0xffd699,
      emissiveIntensity: 0.5
    });

    this.brakeMaterial = new THREE.MeshStandardMaterial({
      color: 0xb41424,
      emissive: 0xff1420,
      emissiveIntensity: 0.25
    });

    for (const x of [-0.63, 0.63]) {
      box([0.4, 0.14, 0.04], [x, 0.3, 1.94], headlights);
      box([0.4, 0.14, 0.04], [x, 0.3, -2.03], this.brakeMaterial);
    }

    const wheelGeometry = new THREE.CylinderGeometry(
      0.36, 0.36, 0.25, 16
    );
    wheelGeometry.rotateZ(Math.PI / 2);

    this.wheels = [];

    for (const [x, z, front] of [
      [-0.95, 1.35, true],
      [0.95, 1.35, true],
      [-0.95, -1.35, false],
      [0.95, -1.35, false]
    ]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, -0.32, z);

      const tire = new THREE.Mesh(wheelGeometry, dark);
      tire.castShadow = true;
      pivot.add(tire);

      const spoke = new THREE.Mesh(
        new THREE.BoxGeometry(0.27, 0.05, 0.4),
        trim
      );
      tire.add(spoke);

      this.root.add(pivot);
      this.wheels.push({ pivot, tire, front });
    }

    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 96;

    const context = canvas.getContext("2d");
    context.fillStyle = "#09131ed9";
    context.fillRect(0, 0, 512, 96);
    context.fillStyle = "#ffffff";
    context.textAlign = "center";

    // Shrink the font for longer names so it never overflows the label.
    let fontSize = 40;
    context.font = `bold ${fontSize}px sans-serif`;

    while (
      context.measureText(this.name).width > 460 &&
      fontSize > 18
    ) {
      fontSize -= 2;
      context.font = `bold ${fontSize}px sans-serif`;
    }

    context.fillText(this.name, 256, 62);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;

    this.label = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        depthWrite: false
      })
    );

    this.label.position.set(0, 2, 0);
    this.label.scale.set(2.8, 0.525, 1);
    this.root.add(this.label);

    this.chatBubble = new ChatBubble(this.root, BUBBLE_ANCHOR_Y);

    this.positionA = new THREE.Vector3();
    this.positionB = new THREE.Vector3();
    this.rotationA = new THREE.Quaternion();
    this.rotationB = new THREE.Quaternion();

    this.pushState(player.state, performance.now());
  }

  pushState(state, time) {
    if (!state) return;

    const previous = this.samples.at(-1)?.state;

    if (previous) {
      const distance = Math.hypot(
        state.position[0] - previous.position[0],
        state.position[1] - previous.position[1],
        state.position[2] - previous.position[2]
      );

      // Reset/teleport: do not interpolate a car across the entire map.
      if (distance > 12) {
        this.samples.length = 0;
      }
    }

    this.samples.push({ time, state });

    if (this.samples.length > 30) {
      this.samples.shift();
    }

    if (this.samples.length === 1) {
      this.root.position.fromArray(state.position);
      this.root.quaternion.fromArray(state.rotation);
    }

    this.lastState = state;
  }

  // Called by MultiplayerClient when a `chat` message arrives for this
  // player's id. Kept separate from network parsing so RemoteVehicle
  // knows nothing about the wire format.
  showMessage(text) {
    this.chatBubble.show(text);
  }

  update(now, dt) {
    this.chatBubble.update(now);

    if (!this.samples.length) return;

    const renderTime = now - INTERPOLATION_DELAY;

    while (
      this.samples.length > 2 &&
      this.samples[1].time <= renderTime
    ) {
      this.samples.shift();
    }

    const first = this.samples[0];
    const second = this.samples[1] ?? first;

    const duration = second.time - first.time;

    const alpha = duration > 0
      ? THREE.MathUtils.clamp(
          (renderTime - first.time) / duration,
          0,
          1
        )
      : 0;

    this.positionA.fromArray(first.state.position);
    this.positionB.fromArray(second.state.position);

    this.rotationA.fromArray(first.state.rotation);
    this.rotationB.fromArray(second.state.rotation);

    this.root.position.lerpVectors(
      this.positionA,
      this.positionB,
      alpha
    );

    this.root.quaternion.slerpQuaternions(
      this.rotationA,
      this.rotationB,
      alpha
    );

    const state = second.state;

    const speed = state.paused
      ? 0
      : Math.hypot(...state.velocity);

    for (const wheel of this.wheels) {
      wheel.pivot.rotation.y = wheel.front
        ? -state.steering * 0.48
        : 0;

      // Presentation estimate; not replicated wheel physics.
      wheel.tire.rotation.x +=
        speed / 0.36 * dt * (state.gear === -1 ? -1 : 1);
    }

    this.brakeMaterial.emissiveIntensity =
      state.brake > 0.1 ? 1.5 : 0.25;
  }

  dispose() {
    this.chatBubble.dispose();
    this.scene.remove(this.root);

    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();

    this.root.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);

      const objectMaterials = Array.isArray(object.material)
        ? object.material
        : object.material
          ? [object.material]
          : [];

      for (const material of objectMaterials) {
        materials.add(material);
        if (material.map) textures.add(material.map);
      }
    });

    for (const geometry of geometries) geometry.dispose();
    for (const texture of textures) texture.dispose();
    for (const material of materials) material.dispose();

    this.samples.length = 0;
  }
}