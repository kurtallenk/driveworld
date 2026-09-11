import * as THREE from "three";
import { ChatBubble } from "./ChatBubble.js";

const INTERPOLATION_DELAY = 120;

// A little clearance above the top edge of the nameplate sprite
// (label.position.y=2, label.scale.y=0.525) so the bubble tail never
// overlaps the player's name.
const BUBBLE_ANCHOR_Y = 2.35;

// ---------------------------------------------------------------------------
// Geometry / material helpers
// ---------------------------------------------------------------------------
// Kept deliberately lighter than the local player's Vehicle.js: up to 8 of
// these can exist on screen at once, so detail favors cheap, reusable
// pieces over exhaustive modeling. Every geometry/material used below is
// created fresh inside this constructor call (nothing is shared across
// RemoteVehicle instances), so the existing traverse-based dispose() logic
// keeps working unmodified.

function addBox(parent, size, position, material, rotation) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  mesh.castShadow = !material.transparent;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addMesh(parent, geometry, material, position, rotation) {
  const mesh = new THREE.Mesh(geometry, material);
  if (position) mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  mesh.castShadow = !material.transparent;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function group(parent, position, rotation) {
  const g = new THREE.Group();
  if (position) g.position.set(...position);
  if (rotation) g.rotation.set(...rotation);
  parent.add(g);
  return g;
}

function createMaterials(color) {
  return {
    paint: new THREE.MeshStandardMaterial({
      color,
      metalness: 0.45,
      roughness: 0.35
    }),

    paintLower: new THREE.MeshStandardMaterial({
      color,
      metalness: 0.2,
      roughness: 0.55
    }),

    dark: new THREE.MeshStandardMaterial({
      color: 0x17212b,
      roughness: 0.85
    }),

    trim: new THREE.MeshStandardMaterial({
      color: 0x2c343d,
      metalness: 0.4,
      roughness: 0.45
    }),

    chrome: new THREE.MeshStandardMaterial({
      color: 0xd7dce0,
      metalness: 0.95,
      roughness: 0.18
    }),

    alloy: new THREE.MeshStandardMaterial({
      color: 0xc3c8cd,
      metalness: 0.8,
      roughness: 0.28
    }),

    rubber: new THREE.MeshStandardMaterial({
      color: 0x121416,
      roughness: 0.95
    }),

    brakeDisc: new THREE.MeshStandardMaterial({
      color: 0x8a8d90,
      metalness: 0.7,
      roughness: 0.45
    }),

    glass: new THREE.MeshStandardMaterial({
      color: 0x294958,
      metalness: 0.25,
      roughness: 0.3,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false
    }),

    headlight: new THREE.MeshStandardMaterial({
      color: 0xffefd1,
      emissive: 0xffd699,
      emissiveIntensity: 0.5
    }),

    drl: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xdfeeff,
      emissiveIntensity: 0.8
    }),

    // Owned by this instance; assigned to this.brakeMaterial so update()
    // can toggle its emissiveIntensity per-vehicle.
    tailLamp: new THREE.MeshStandardMaterial({
      color: 0xb41424,
      emissive: 0xff1420,
      emissiveIntensity: 0.25
    }),

    indicator: new THREE.MeshStandardMaterial({
      color: 0xff9d2e,
      emissive: 0xff8c00,
      emissiveIntensity: 0.4
    })
  };
}

function createGrille(mat, parent, z) {
  const g = group(parent, [0, 0.05, z]);
  addBox(g, [0.72, 0.2, 0.04], [0, 0, -0.02], mat.dark);
  addBox(g, [0.76, 0.025, 0.025], [0, 0.1, 0], mat.chrome);
  addBox(g, [0.76, 0.025, 0.025], [0, -0.1, 0], mat.chrome);
  for (const t of [-0.055, 0, 0.055]) {
    addBox(g, [0.68, 0.02, 0.04], [0, t, 0.01], mat.trim);
  }
  return g;
}

function createHeadlight(mat, side, parent) {
  const g = group(parent, [side * 0.63, 0.3, 1.93]);
  addBox(g, [0.36, 0.15, 0.04], [0, 0, -0.02], mat.dark);
  addMesh(
    g,
    new THREE.CylinderGeometry(0.05, 0.05, 0.05, 14),
    mat.headlight,
    [-0.06 * side, 0, 0.02],
    [Math.PI / 2, 0, 0]
  );
  addBox(g, [0.26, 0.02, 0.02], [0.03 * side, 0.045, 0.03], mat.drl);
  addBox(g, [0.36, 0.15, 0.012], [0, 0, 0.035], mat.chrome);
  return g;
}

function createTaillight(mat, side, parent) {
  const g = group(parent, [side * 0.63, 0.3, -2.03]);
  addBox(g, [0.36, 0.16, 0.04], [0, 0, 0.015], mat.dark);
  const segment = addBox(g, [0.28, 0.09, 0.02], [0, 0, 0.035], mat.tailLamp);
  return { group: g, lamp: segment };
}

function createMirror(mat, side, parent) {
  const g = group(parent, [side * 0.98, 0.68, 0.7]);
  addBox(g, [0.16, 0.1, 0.18], [0, 0, 0], mat.paint);
  addMesh(
    g,
    new THREE.PlaneGeometry(0.11, 0.06),
    mat.chrome,
    [0, 0, -0.091],
    [0, Math.PI, 0]
  );
  return g;
}

function createWheelGeometries() {
  const tire = new THREE.CylinderGeometry(0.36, 0.36, 0.25, 18);
  tire.rotateZ(Math.PI / 2);

  const rim = new THREE.CylinderGeometry(0.26, 0.26, 0.255, 18);
  rim.rotateZ(Math.PI / 2);

  const hub = new THREE.CylinderGeometry(0.08, 0.08, 0.26, 12);
  hub.rotateZ(Math.PI / 2);

  const spoke = new THREE.BoxGeometry(0.05, 0.2, 0.02);

  const disc = new THREE.CylinderGeometry(0.2, 0.2, 0.02, 16);
  disc.rotateZ(Math.PI / 2);

  return { tire, rim, hub, spoke, disc };
}

function createWheelVisual(geo, mat) {
  const wheelGroup = new THREE.Group();

  const tireMesh = new THREE.Mesh(geo.tire, mat.rubber);
  tireMesh.castShadow = true;
  wheelGroup.add(tireMesh);

  const rimMesh = new THREE.Mesh(geo.rim, mat.alloy);
  wheelGroup.add(rimMesh);

  for (let i = 0; i < 3; i++) {
    const spokeMesh = new THREE.Mesh(geo.spoke, mat.alloy);
    spokeMesh.rotation.x = (Math.PI * 2 * i) / 3;
    wheelGroup.add(spokeMesh);
  }

  const hubMesh = new THREE.Mesh(geo.hub, mat.trim);
  wheelGroup.add(hubMesh);

  const discMesh = new THREE.Mesh(geo.disc, mat.brakeDisc);
  wheelGroup.add(discMesh);

  return wheelGroup;
}

// ---------------------------------------------------------------------------
// RemoteVehicle
// ---------------------------------------------------------------------------

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

    const mat = createMaterials(player.color);
    this.paint = mat.paint;

    // ---- Lower body / floor pan ------------------------------------------
    addBox(this.root, [1.78, 0.4, 3.98], [0, 0.1, 0], mat.paint);
    for (const side of [-1, 1]) {
      addBox(this.root, [0.06, 0.08, 2.4], [side * 0.9, -0.08, -0.1], mat.paintLower);
    }
    addBox(this.root, [1.7, 0.06, 0.1], [0, -0.06, 2.06], mat.paintLower);
    addBox(this.root, [1.66, 0.06, 0.12], [0, -0.06, -2.08], mat.paintLower);

    // ---- Cabin belt + roof --------------------------------------------------
    addBox(this.root, [1.5, 0.55, 2], [0, 0.65, -0.15], mat.glass);
    addBox(this.root, [1.65, 0.1, 2.15], [0, 1, -0.15], mat.paint);

    // ---- Hood + trunk ---------------------------------------------------------
    addBox(this.root, [1.75, 0.2, 1], [0, 0.35, 1.4], mat.paint);
    addBox(this.root, [0.85, 0.045, 0.9], [0, 0.45, 1.4], mat.paint);
    addBox(this.root, [1.75, 0.18, 0.55], [0, 0.34, -1.6], mat.paint);

    // ---- Fenders ----------------------------------------------------------
    for (const side of [-1, 1]) {
      addBox(this.root, [0.1, 0.3, 0.85], [side * 0.92, 0.25, 1.15], mat.paint);
      addBox(this.root, [0.1, 0.3, 0.85], [side * 0.92, 0.25, -1.15], mat.paint);
    }

    // ---- Bumpers + grille ---------------------------------------------------
    addBox(this.root, [1.85, 0.15, 0.15], [0, 0, 2.02], mat.dark);
    addBox(this.root, [1.85, 0.15, 0.15], [0, 0, -2.02], mat.dark);
    createGrille(mat, this.root, 2.05);

    // ---- Headlights / taillights --------------------------------------------
    for (const side of [-1, 1]) {
      createHeadlight(mat, side, this.root);
    }

    this.brakeMaterial = mat.tailLamp;
    for (const side of [-1, 1]) {
      createTaillight(mat, side, this.root);
    }

    // ---- Doors, mirrors, handles --------------------------------------------
    for (const side of [-1, 1]) {
      addBox(this.root, [0.02, 0.3, 1.9], [side * 0.905, 0.4, -0.15], mat.trim); // door seam
      addBox(this.root, [0.03, 0.03, 0.14], [side * 0.905, 0.5, 0.4], mat.chrome); // handle
      addBox(this.root, [0.015, 0.02, 2.1], [side * 0.9, 0.5, -0.1], mat.trim); // character line
      createMirror(mat, side, this.root);
    }

    // ---- Windows: separate panels instead of one big glass box -----------
    // (Belt/roof glass box above already gives the silhouette from a
    // distance; these thin panels add believable panel seams up close.)
    for (const side of [-1, 1]) {
      addBox(this.root, [0.02, 0.02, 1.9], [side * 0.75, 0.92, -0.15], mat.trim);
    }

    // ---- Wheels -------------------------------------------------------------
    const wheelGeo = createWheelGeometries();

    this.wheels = [];

    for (const [x, z, front] of [
      [-0.95, 1.35, true],
      [0.95, 1.35, true],
      [-0.95, -1.35, false],
      [0.95, -1.35, false]
    ]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, -0.32, z);

      const tire = createWheelVisual(wheelGeo, mat);
      pivot.add(tire);

      this.root.add(pivot);
      this.wheels.push({ pivot, tire, front });
    }

    // ---- Nameplate ------------------------------------------------------------
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
