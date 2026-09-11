import * as THREE from "three";

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------
// All materials are created once per vehicle instance and shared across every
// mesh that needs them, so adding visual detail does not multiply material
// (shader program) count.

function createMaterials(color) {
  return {
    // Clear-coated body paint. MeshPhysicalMaterial's clearcoat gives the
    // subtle two-layer reflection of real automotive paint without pushing
    // metalness/roughness into "chrome" territory.
    paint: new THREE.MeshPhysicalMaterial({
      color,
      metalness: 0.55,
      roughness: 0.32,
      clearcoat: 1,
      clearcoatRoughness: 0.12
    }),

    // Lower bumpers / skirts / diffuser: same paint tone but flatter, as on
    // a real bumper cover.
    paintLower: new THREE.MeshStandardMaterial({
      color,
      metalness: 0.25,
      roughness: 0.55
    }),

    // Matte black plastic (grille backing, vents, interior trim, tires' hub
    // surroundings).
    dark: new THREE.MeshStandardMaterial({
      color: 0x14181d,
      roughness: 0.88,
      metalness: 0.05
    }),

    // Dark gloss trim (window surrounds, pillars, badges backing).
    trim: new THREE.MeshStandardMaterial({
      color: 0x2b333c,
      metalness: 0.4,
      roughness: 0.42
    }),

    // Bright chrome accents (grille frame, exhaust tips, badge ring).
    chrome: new THREE.MeshStandardMaterial({
      color: 0xe4e8ec,
      metalness: 1,
      roughness: 0.12
    }),

    // Brushed aluminium look (rims, brake discs).
    brushedMetal: new THREE.MeshStandardMaterial({
      color: 0x9aa0a6,
      metalness: 0.85,
      roughness: 0.32
    }),

    // Tire rubber.
    rubber: new THREE.MeshStandardMaterial({
      color: 0x101214,
      roughness: 0.95,
      metalness: 0
    }),

    // Wheel alloy face.
    alloy: new THREE.MeshStandardMaterial({
      color: 0xcdd2d6,
      metalness: 0.85,
      roughness: 0.22
    }),

    brakeDisc: new THREE.MeshStandardMaterial({
      color: 0x8a8d90,
      metalness: 0.75,
      roughness: 0.4
    }),

    brakeCaliper: new THREE.MeshStandardMaterial({
      color: 0xa8121f,
      metalness: 0.25,
      roughness: 0.5
    }),

    // Window glass: kept as a translucent, non-shadow-casting surface like
    // the original, with a faint tint and slight reflectivity.
    glass: new THREE.MeshPhysicalMaterial({
      color: 0xcfe7f2,
      transparent: true,
      opacity: 0.16,
      roughness: 0.08,
      metalness: 0,
      clearcoat: 0.6,
      clearcoatRoughness: 0.2,
      depthWrite: false,
      side: THREE.DoubleSide
    }),

    headlightLens: new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.35,
      roughness: 0.08,
      metalness: 0,
      depthWrite: false
    }),

    tailLightLens: new THREE.MeshPhysicalMaterial({
      color: 0x8a1015,
      transparent: true,
      opacity: 0.45,
      roughness: 0.1,
      metalness: 0,
      depthWrite: false
    }),

    lampWarm: new THREE.MeshStandardMaterial({
      color: 0xfff6da,
      emissive: 0xffdf9e,
      emissiveIntensity: 0.55
    }),

    drl: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xdfeeff,
      emissiveIntensity: 0.9
    }),

    tailLamp: new THREE.MeshStandardMaterial({
      color: 0xb61925,
      emissive: 0xff1420,
      emissiveIntensity: 0.35
    }),

    reverseLamp: new THREE.MeshStandardMaterial({
      color: 0xf2f2e8,
      emissive: 0xffffff,
      emissiveIntensity: 0.3
    }),

    indicator: new THREE.MeshStandardMaterial({
      color: 0xff9d2e,
      emissive: 0xff8c00,
      emissiveIntensity: 0.4
    }),

    seat: new THREE.MeshStandardMaterial({
      color: 0x2c313a,
      roughness: 0.78,
      metalness: 0
    }),

    seatTrim: new THREE.MeshStandardMaterial({
      color: 0x454c56,
      roughness: 0.6,
      metalness: 0
    }),

    interiorTrim: new THREE.MeshStandardMaterial({
      color: 0x1c2128,
      roughness: 0.7,
      metalness: 0.1
    })
  };
}

// ---------------------------------------------------------------------------
// Small geometry helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Exterior detail builders
// ---------------------------------------------------------------------------

function createGrille(mat, parent, z) {
  const g = group(parent, [0, 0.1, z]);

  // Recessed backing so the slats read as having real depth.
  addBox(g, [0.86, 0.24, 0.05], [0, 0, -0.03], mat.dark);

  // Chrome frame around the opening.
  addBox(g, [0.9, 0.03, 0.03], [0, 0.115, 0], mat.chrome);
  addBox(g, [0.9, 0.03, 0.03], [0, -0.115, 0], mat.chrome);
  addBox(g, [0.03, 0.25, 0.03], [-0.435, 0, 0], mat.chrome);
  addBox(g, [0.03, 0.25, 0.03], [0.435, 0, 0], mat.chrome);

  // Horizontal slats.
  const slatCount = 5;
  for (let i = 0; i < slatCount; i++) {
    const t = i / (slatCount - 1) - 0.5;
    addBox(g, [0.82, 0.025, 0.05], [0, t * 0.2, 0.01], mat.trim);
  }

  // Center badge boss.
  addMesh(
    g,
    new THREE.CylinderGeometry(0.06, 0.06, 0.02, 16),
    mat.chrome,
    [0, 0, 0.04],
    [Math.PI / 2, 0, 0]
  );

  return g;
}

function createHeadlightAssembly(mat, side, parent) {
  const g = group(parent, [side * 0.66, 0.31, 1.93]);

  // Housing recess.
  addBox(g, [0.42, 0.17, 0.05], [0, 0, -0.02], mat.dark);

  // Main projector lamp.
  addMesh(
    g,
    new THREE.CylinderGeometry(0.055, 0.055, 0.06, 16),
    mat.lampWarm,
    [-0.1 * side, -0.02, 0.02],
    [Math.PI / 2, 0, 0]
  );

  // Secondary small lamp element.
  addMesh(
    g,
    new THREE.CylinderGeometry(0.03, 0.03, 0.05, 12),
    mat.lampWarm,
    [0.08 * side, -0.02, 0.02],
    [Math.PI / 2, 0, 0]
  );

  // L-shaped DRL strip.
  addBox(g, [0.3, 0.02, 0.02], [0.02 * side, 0.055, 0.025], mat.drl);
  addBox(g, [0.02, 0.06, 0.02], [-0.13 * side, 0.02, 0.025], mat.drl);

  // Clear lens cover over the whole assembly, for depth/gloss.
  addBox(g, [0.42, 0.17, 0.015], [0, 0, 0.045], mat.headlightLens);

  return g;
}

function createTaillightAssembly(mat, side, parent) {
  const g = group(parent, [side * 0.66, 0.32, -1.95]);

  addBox(g, [0.4, 0.18, 0.05], [0, 0, 0.02], mat.dark);

  // Segmented LED strip (three short bars read as a continuous light bar
  // from a normal viewing distance, without needing extra shader work).
  for (const t of [-0.14, 0, 0.14]) {
    addBox(g, [0.11, 0.05, 0.02], [t * side, 0.02, 0.04], mat.tailLamp);
  }

  // Small reverse-light insert.
  addBox(g, [0.09, 0.035, 0.02], [0.15 * side, -0.055, 0.04], mat.reverseLamp);

  // Translucent red lens over the assembly.
  addBox(g, [0.4, 0.18, 0.015], [0, 0, 0.055], mat.tailLightLens);

  return g;
}

function createMirror(mat, side, parent) {
  const g = group(parent, [side * 1.0, 0.74, 0.7]);

  addBox(g, [0.05, 0.03, 0.16], [-side * 0.06, -0.01, 0], mat.paint); // stalk
  addBox(g, [0.2, 0.12, 0.22], [0, 0, 0], mat.paint); // housing
  addBox(g, [0.15, 0.085, 0.012], [0, 0, -0.11 * side * 0 - 0.11], mat.trim); // glass surround
  addMesh(
    g,
    new THREE.PlaneGeometry(0.13, 0.07),
    mat.chrome,
    [0, 0, -0.112],
    [0, Math.PI, 0]
  );
  addBox(g, [0.03, 0.02, 0.02], [side * 0.11, 0.04, -0.03], mat.indicator);

  return g;
}

function createDoorHandle(mat, side, z, parent) {
  addBox(
    parent,
    [0.03, 0.03, 0.14],
    [side * 0.905, 0.55, z],
    mat.chrome
  );
}

function createSeat(mat, x, parent, isFront) {
  const g = group(parent, [x, 0, 0]);
  const depth = isFront ? -0.28 : -0.9;

  // Cushion.
  addBox(g, [0.55, 0.15, 0.55], [0, 0.43, depth], mat.seat);
  // Backrest.
  addBox(g, [0.55, 0.56, 0.14], [0, 0.72, depth - 0.27], mat.seat);
  // Side bolsters.
  addBox(g, [0.05, 0.5, 0.16], [-0.27, 0.73, depth - 0.27], mat.seatTrim);
  addBox(g, [0.05, 0.5, 0.16], [0.27, 0.73, depth - 0.27], mat.seatTrim);
  // Headrest.
  addBox(g, [0.28, 0.2, 0.13], [0, 1.07, depth - 0.27], mat.seat);
  addMesh(
    g,
    new THREE.CylinderGeometry(0.012, 0.012, 0.1, 8),
    mat.dark,
    [-0.08, 0.96, depth - 0.31]
  );
  addMesh(
    g,
    new THREE.CylinderGeometry(0.012, 0.012, 0.1, 8),
    mat.dark,
    [0.08, 0.96, depth - 0.31]
  );
  // Center seam stitching line (subtle, thin trim strip rather than a
  // heavy black gap).
  addBox(g, [0.02, 0.5, 0.13], [0, 0.73, depth - 0.26], mat.seatTrim);

  return g;
}

function enhanceSteeringWheel(steeringWheel, mat) {
  addMesh(
    steeringWheel,
    new THREE.TorusGeometry(0.19, 0.022, 10, 36),
    mat.dark
  );

  // Center hub / airbag cover.
  addMesh(
    steeringWheel,
    new THREE.CylinderGeometry(0.085, 0.085, 0.045, 16),
    mat.dark,
    [0, 0, -0.005],
    [Math.PI / 2, 0, 0]
  );
  addMesh(
    steeringWheel,
    new THREE.CylinderGeometry(0.045, 0.045, 0.05, 12),
    mat.trim,
    [0, 0, -0.01],
    [Math.PI / 2, 0, 0]
  );

  // Three spokes instead of the original single crossbar.
  for (let i = 0; i < 3; i++) {
    const angle = (Math.PI * 2 * i) / 3 + Math.PI / 2;
    const spoke = group(steeringWheel, [0, 0, 0], [0, 0, angle]);
    addBox(spoke, [0.028, 0.145, 0.025], [0, -0.13, 0], mat.trim);
    // Small button on the right-hand spoke.
    if (i === 1) {
      addBox(spoke, [0.03, 0.02, 0.012], [0, -0.09, 0.014], mat.chrome);
    }
  }

  return steeringWheel;
}

// ---------------------------------------------------------------------------
// Wheel assembly
// ---------------------------------------------------------------------------
// Geometries are created once and reused for all four wheels; only their
// containing groups differ per corner. Overall tire radius/width match the
// original placeholder so nothing changes for the physics wheel transforms
// that drive this.wheels[i].position / .quaternion.

function buildWheelGeometries() {
  const tire = new THREE.CylinderGeometry(0.36, 0.36, 0.25, 24);
  tire.rotateZ(Math.PI / 2);

  const sidewall = new THREE.CylinderGeometry(0.34, 0.34, 0.252, 24, 1, true);
  sidewall.rotateZ(Math.PI / 2);

  const rimOuter = new THREE.CylinderGeometry(0.27, 0.27, 0.23, 24);
  rimOuter.rotateZ(Math.PI / 2);

  const rimFace = new THREE.CylinderGeometry(0.27, 0.27, 0.02, 24);
  rimFace.rotateZ(Math.PI / 2);

  const hub = new THREE.CylinderGeometry(0.075, 0.075, 0.24, 16);
  hub.rotateZ(Math.PI / 2);

  const spoke = new THREE.BoxGeometry(0.05, 0.22, 0.02);

  const lugNut = new THREE.CylinderGeometry(0.014, 0.014, 0.02, 8);
  lugNut.rotateZ(Math.PI / 2);

  const disc = new THREE.CylinderGeometry(0.22, 0.22, 0.02, 20);
  disc.rotateZ(Math.PI / 2);

  const caliper = new THREE.BoxGeometry(0.09, 0.13, 0.16);

  return { tire, sidewall, rimOuter, rimFace, hub, spoke, lugNut, disc, caliper };
}

function createWheel(geo, mat, inboardSign) {
  const wheel = new THREE.Group();

  const tireMesh = new THREE.Mesh(geo.tire, mat.rubber);
  tireMesh.castShadow = true;
  tireMesh.receiveShadow = true;
  wheel.add(tireMesh);

  const sidewallMesh = new THREE.Mesh(geo.sidewall, mat.rubber);
  wheel.add(sidewallMesh);

  // Alloy rim face + outer lip.
  const rimOuterMesh = new THREE.Mesh(geo.rimOuter, mat.alloy);
  rimOuterMesh.castShadow = true;
  wheel.add(rimOuterMesh);

  const rimFaceMesh = new THREE.Mesh(geo.rimFace, mat.alloy);
  rimFaceMesh.position.x = 0.11 * inboardSign * -1;
  wheel.add(rimFaceMesh);

  // Five spokes fanned around the hub.
  for (let i = 0; i < 5; i++) {
    const angle = (Math.PI * 2 * i) / 5;
    const spokeMesh = new THREE.Mesh(geo.spoke, mat.alloy);
    spokeMesh.position.set(0.1 * inboardSign * -1, 0, 0);
    spokeMesh.rotation.x = angle;
    wheel.add(spokeMesh);
  }

  const hubMesh = new THREE.Mesh(geo.hub, mat.trim);
  wheel.add(hubMesh);

  // Lug nuts around the hub.
  for (let i = 0; i < 5; i++) {
    const angle = (Math.PI * 2 * i) / 5;
    const lug = new THREE.Mesh(geo.lugNut, mat.brushedMetal);
    lug.position.set(0.13 * inboardSign * -1, Math.cos(angle) * 0.1, Math.sin(angle) * 0.1);
    wheel.add(lug);
  }

  // Brake disc + caliper, sitting inboard of the rim, visible through the
  // spokes as on a real alloy wheel.
  const discMesh = new THREE.Mesh(geo.disc, mat.brakeDisc);
  discMesh.position.x = 0.09 * inboardSign;
  wheel.add(discMesh);

  const caliperMesh = new THREE.Mesh(geo.caliper, mat.brakeCaliper);
  caliperMesh.position.set(0.09 * inboardSign, 0.19, 0.03);
  caliperMesh.castShadow = true;
  wheel.add(caliperMesh);

  return wheel;
}

// ---------------------------------------------------------------------------
// Vehicle
// ---------------------------------------------------------------------------

export class Vehicle {
  constructor(scene, physics, color) {
    this.physics = physics;
    this.root = new THREE.Group();
    scene.add(this.root);

    const mat = createMaterials(color);

    // +Z = front, +Y = up. Chassis origin remains unchanged.

    // ---- Lower body / floor pan -----------------------------------------
    addBox(this.root, [1.78, 0.34, 3.98], [0, 0.05, 0], mat.paint);

    // Rocker panels / side skirts, sitting just below the doors.
    for (const side of [-1, 1]) {
      addBox(this.root, [0.08, 0.1, 2.5], [side * 0.9, -0.08, -0.1], mat.paintLower);
    }

    // Front and rear lower lips.
    addBox(this.root, [1.7, 0.08, 0.1], [0, -0.1, 2.1], mat.paintLower);
    addBox(this.root, [1.66, 0.08, 0.14], [0, -0.1, -2.15], mat.paintLower);

    // ---- Cabin belt / greenhouse base ------------------------------------
    addBox(this.root, [1.7, 0.12, 2.1], [0, 0.3, -0.1], mat.dark);

    // ---- Hood: two layers so the center reads as slightly raised --------
    addBox(this.root, [1.72, 0.2, 1.1], [0, 0.34, 1.36], mat.paint);
    addBox(this.root, [0.9, 0.05, 1.02], [0, 0.45, 1.36], mat.paint);

    // Trunk lid.
    addBox(this.root, [1.72, 0.2, 0.62], [0, 0.34, -1.62], mat.paint);
    // Subtle trunk lip / spoiler.
    addBox(this.root, [1.6, 0.03, 0.1], [0, 0.46, -1.92], mat.trim);

    // ---- Front fenders + wheel arch trim ---------------------------------
    for (const side of [-1, 1]) {
      addBox(this.root, [0.14, 0.34, 0.9], [side * 0.93, 0.26, 1.15], mat.paint);
      addBox(this.root, [0.14, 0.34, 0.9], [side * 0.93, 0.26, -1.15], mat.paint);
      addMesh(
        this.root,
        new THREE.TorusGeometry(0.42, 0.035, 8, 16, Math.PI),
        mat.trim,
        [side * 0.95, 0.26, 1.15],
        [0, side > 0 ? Math.PI / 2 : -Math.PI / 2, Math.PI / 2]
      );
      addMesh(
        this.root,
        new THREE.TorusGeometry(0.42, 0.035, 8, 16, Math.PI),
        mat.trim,
        [side * 0.95, 0.26, -1.15],
        [0, side > 0 ? Math.PI / 2 : -Math.PI / 2, Math.PI / 2]
      );
    }

    // ---- Front bumper & fascia -------------------------------------------
    addBox(this.root, [1.86, 0.2, 0.16], [0, -0.02, 2.03], mat.paintLower);
    addBox(this.root, [1.5, 0.1, 0.06], [0, -0.14, 2.09], mat.dark); // lower splitter
    createGrille(mat, this.root, 2.06);

    // Lower side intakes.
    for (const side of [-1, 1]) {
      addBox(this.root, [0.3, 0.1, 0.05], [side * 0.62, -0.06, 2.08], mat.dark);
      addBox(this.root, [0.24, 0.06, 0.02], [side * 0.62, -0.06, 2.1], mat.trim);
    }

    // Tow hook detail, centered low on the splitter.
    addMesh(
      this.root,
      new THREE.TorusGeometry(0.03, 0.008, 6, 10),
      mat.brushedMetal,
      [0, -0.13, 2.12],
      [Math.PI / 2, 0, 0]
    );

    // ---- Rear bumper & diffuser -------------------------------------------
    addBox(this.root, [1.86, 0.2, 0.16], [0, -0.02, -2.03], mat.paintLower);
    addBox(this.root, [1.5, 0.09, 0.1], [0, -0.15, -2.08], mat.dark); // diffuser body
    for (let i = -3; i <= 3; i++) {
      addBox(this.root, [0.03, 0.06, 0.1], [i * 0.2, -0.15, -2.12], mat.trim);
    }
    // Exhaust outlets.
    for (const side of [-1, 1]) {
      addMesh(
        this.root,
        new THREE.CylinderGeometry(0.05, 0.05, 0.08, 14),
        mat.chrome,
        [side * 0.55, -0.16, -2.12],
        [Math.PI / 2, 0, 0]
      );
    }
    // Rear badge.
    addBox(this.root, [0.32, 0.04, 0.01], [0, 0.16, -1.93], mat.chrome);
    // Rear reflectors.
    for (const side of [-1, 1]) {
      addBox(this.root, [0.09, 0.03, 0.02], [side * 0.85, -0.06, -2.09], mat.indicator);
    }

    // ---- Headlights & taillights ------------------------------------------
    for (const side of [-1, 1]) {
      createHeadlightAssembly(mat, side, this.root);
      createTaillightAssembly(mat, side, this.root);
    }

    // ---- Doors, sills, mirrors, handles, pillars --------------------------
    for (const side of [-1, 1]) {
      // Door skin.
      addBox(this.root, [0.1, 0.38, 2.02], [side * 0.86, 0.43, -0.15], mat.paint);
      // Subtle seam rather than a heavy black gap.
      addBox(this.root, [0.012, 0.36, 2.02], [side * 0.91, 0.43, -0.15], mat.trim);
      // Lower door / rocker trim.
      addBox(this.root, [0.055, 0.28, 1.85], [side * 0.795, 0.45, -0.15], mat.dark);
      addBox(this.root, [0.12, 0.06, 2.2], [side * 0.9, 0.02, -0.12], mat.trim);

      // Character line.
      addBox(this.root, [0.02, 0.03, 2.4], [side * 0.905, 0.55, -0.1], mat.trim);

      // Door handles (front + rear doors).
      createDoorHandle(mat, side, 0.55, this.root);
      createDoorHandle(mat, side, -0.75, this.root);

      // Roof pillars: A, B, C. Gaps between them remain the window
      // openings.
      addBox(this.root, [0.07, 0.7, 0.1], [side * 0.77, 0.93, 0.83], mat.paint);
      addBox(this.root, [0.06, 0.7, 0.07], [side * 0.79, 0.93, -0.3], mat.paint);
      addBox(this.root, [0.07, 0.7, 0.1], [side * 0.77, 0.93, -1.15], mat.paint);

      // Window trim strip along the beltline.
      addBox(this.root, [0.02, 0.02, 2.2], [side * 0.79, 0.62, -0.15], mat.trim);

      createMirror(mat, side, this.root);
    }

    // ---- Roof + panoramic glass panel -------------------------------------
    addBox(this.root, [1.64, 0.09, 2.14], [0, 1.3, -0.16], mat.paint);
    addBox(this.root, [1.02, 0.012, 1.3], [0, 1.35, -0.2], mat.trim); // sunroof surround
    addBox(this.root, [0.94, 0.01, 1.2], [0, 1.352, -0.2], mat.glass);

    // ---- Windows: individual panels instead of two giant slabs -----------
    // Windshield (angled).
    addMesh(
      this.root,
      new THREE.PlaneGeometry(1.4, 0.66),
      mat.glass,
      [0, 0.95, 0.87],
      [-0.18, 0, 0]
    );

    // Rear windshield.
    addMesh(
      this.root,
      new THREE.PlaneGeometry(1.4, 0.55),
      mat.glass,
      [0, 0.97, -1.2],
      [0.22, 0, 0]
    );

    // Front + rear side windows, separated by the B-pillar gap.
    for (const side of [-1, 1]) {
      const rotY = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      addMesh(
        this.root,
        new THREE.PlaneGeometry(1.0, 0.42),
        mat.glass,
        [side * 0.795, 0.62, 0.28],
        [0, rotY, 0]
      );
      addMesh(
        this.root,
        new THREE.PlaneGeometry(0.75, 0.42),
        mat.glass,
        [side * 0.795, 0.62, -0.75],
        [0, rotY, 0]
      );
    }

    // ---- Interior ----------------------------------------------------------
    createSeat(mat, -0.43, this.root, true);
    createSeat(mat, 0.43, this.root, true);
    // Simple rear bench.
    addBox(this.root, [1.37, 0.16, 0.5], [0, 0.44, -0.95], mat.seat);
    addBox(this.root, [1.37, 0.5, 0.14], [0, 0.72, -1.22], mat.seat);
    addBox(this.root, [1.37, 0.16, 0.13], [0, 0.98, -1.22], mat.seat);

    // Dashboard body + instrument hood.
    addBox(this.root, [1.5, 0.18, 0.34], [0, 0.68, 0.74], mat.dark);
    addBox(this.root, [0.5, 0.08, 0.1], [0.43, 0.78, 0.86], mat.dark); // instrument hood
    addBox(this.root, [1.46, 0.02, 0.02], [0, 0.6, 0.58], mat.trim); // dash trim strip

    // Center console.
    addBox(this.root, [0.2, 0.25, 0.72], [0, 0.4, -0.03], mat.interiorTrim);
    addBox(this.root, [0.025, 0.2, 0.025], [0, 0.62, 0.04], mat.trim); // gear selector stem
    addMesh(this.root, new THREE.SphereGeometry(0.045, 12, 8), mat.dark, [0, 0.74, 0.04]);
    // Cupholder detail.
    addMesh(
      this.root,
      new THREE.TorusGeometry(0.035, 0.006, 6, 14),
      mat.trim,
      [0.12, 0.535, 0.05],
      [Math.PI / 2, 0, 0]
    );

    // Door interior panels + armrests.
    for (const side of [-1, 1]) {
      addBox(this.root, [0.06, 0.3, 1.7], [side * 0.78, 0.45, -0.2], mat.interiorTrim);
      addBox(this.root, [0.08, 0.06, 0.4], [side * 0.78, 0.55, 0.1], mat.seatTrim);
    }

    // Driver anchor belongs to the vehicle, so a GLB can replace it later.
    this.driverEye = new THREE.Object3D();
    // Vehicle-local +X is the driver's left when looking along +Z.
    this.driverEye.position.set(0.43, 1.04, -0.08);
    this.root.add(this.driverEye);

    // Steering wheel faces toward the driver, who looks along +Z.
    this.steeringWheel = new THREE.Group();
    this.steeringWheel.position.set(0.43, 0.78, 0.47);
    this.root.add(this.steeringWheel);
    enhanceSteeringWheel(this.steeringWheel, mat);

    // ---- Canvas-backed dashboard display (unchanged logic) ----------------
    this.dashboardCanvas = document.createElement("canvas");
    this.dashboardCanvas.width = 512;
    this.dashboardCanvas.height = 192;
    this.dashboardContext = this.dashboardCanvas.getContext("2d");
    this.dashboardTexture = new THREE.CanvasTexture(this.dashboardCanvas);
    this.dashboardTexture.colorSpace = THREE.SRGBColorSpace;

    const display = new THREE.Mesh(
      new THREE.PlaneGeometry(0.45, 0.17),
      new THREE.MeshBasicMaterial({
        map: this.dashboardTexture,
        side: THREE.DoubleSide
      })
    );

    display.position.set(0.43, 0.82, 0.65);
    display.rotation.y = Math.PI;
    this.root.add(display);

    // Thin bezel around the display so it reads as a mounted instrument
    // cluster rather than a floating plane.
    addBox(this.root, [0.47, 0.02, 0.012], [0.43, 0.907, 0.655], mat.dark);
    addBox(this.root, [0.47, 0.02, 0.012], [0.43, 0.733, 0.655], mat.dark);

    this.lastDashboardUpdate = -Infinity;

    // ---- Wheels -------------------------------------------------------------
    // Visible wheels continue to follow the existing physics transforms;
    // only the visual construction below changed.
    const wheelGeo = buildWheelGeometries();

    this.wheels = Array.from({ length: 4 }, (_, index) => {
      const inboardSign = index % 2 === 0 ? 1 : -1;
      const wheel = createWheel(wheelGeo, mat, inboardSign);
      scene.add(wheel);
      return wheel;
    });

    this.sync();
  }

  sync() {
    const { body, vehicle } = this.physics;

    this.root.position.copy(body.position);
    this.root.quaternion.copy(body.quaternion);

    this.wheels.forEach((mesh, index) => {
      vehicle.updateWheelTransform(index);
      const transform = vehicle.wheelInfos[index].worldTransform;
      mesh.position.copy(transform.position);
      mesh.quaternion.copy(transform.quaternion);
    });
  }

  updatePresentation({ steering, speedKmh, rpm, gear, manual }, timeMs) {
    // Viewed from the driver's seat looking along +Z:
    // negative steering turns the visible wheel left.
    this.steeringWheel.rotation.z = steering * Math.PI * 1.25;

    // Avoid repainting a canvas texture every render frame.
    if (timeMs - this.lastDashboardUpdate < 100) return;
    this.lastDashboardUpdate = timeMs;

    const ctx = this.dashboardContext;

    ctx.fillStyle = "#07121a";
    ctx.fillRect(0, 0, 512, 192);

    ctx.fillStyle = "#87f4cc";
    ctx.font = "bold 72px monospace";
    ctx.fillText(String(Math.round(speedKmh)).padStart(3, "0"), 22, 83);

    ctx.font = "24px monospace";
    ctx.fillText("km/h", 170, 83);

    ctx.fillStyle = "#edf6ff";
    ctx.font = "bold 70px monospace";
    ctx.fillText(String(gear), 380, 83);

    ctx.font = "25px monospace";
    ctx.fillText(
      manual ? `${Math.round(rpm)} RPM` : "ARCADE",
      24,
      135
    );

    ctx.fillStyle = "#253744";
    ctx.fillRect(24, 153, 464, 15);

    ctx.fillStyle = rpm > 5800 ? "#ff6c65" : "#87f4cc";
    ctx.fillRect(24, 153, 464 * Math.min(rpm / 6500, 1), 15);

    this.dashboardTexture.needsUpdate = true;
  }
}
