import * as THREE from "three";

import { getItem } from "./ItemDatabase.js";

// ---------------------------------------------------------------------------
// ITEM WORLD MODELS
// ---------------------------------------------------------------------------
// Every lootable item's physical appearance in the world, in one place.
//
// Why this module exists:
//   LootSystem used to render EVERY drop as the same untextured
//   icosahedron tinted by rarity colour, so a battery, a medkit and a data
//   core were visually identical. The item you were about to pick up was
//   only identifiable from the interaction prompt.
//
// Approach:
//   Procedural primitive meshes + MeshStandardMaterial, exactly the style
//   already used by world/ChargingStation.js and enemies/RobotParts.js.
//   No new asset pipeline, no loaders, no external dependencies, and
//   nothing that changes how pickups are networked or collected.
//
// Performance:
//   Geometries and materials are built ONCE per factory and shared by
//   every instance of that item, so a world full of drops costs a handful
//   of GPU resources rather than one set per pickup. Instances are plain
//   THREE.Group clones of shared meshes, so removing a drop never needs to
//   dispose anything -- dispose() on the factory releases everything.
//
// Which builder an item uses is data-driven: ItemDatabase's `model` field.
// Adding an item means adding a row there and (optionally) a builder here.
// ---------------------------------------------------------------------------

// Overall world scale of a drop, tuned so items read clearly from the
// third-person gameplay camera without being larger than the old blob.
const ITEM_SCALE = 1.0;

export class ItemModelFactory {
  constructor() {
    this.geometries = new Map();
    this.materials = new Map();
  }

  // ---- shared resource helpers ------------------------------------------

  geometry(key, build) {
    let geometry = this.geometries.get(key);

    if (!geometry) {
      geometry = build();
      this.geometries.set(key, geometry);
    }

    return geometry;
  }

  material(key, build) {
    let material = this.materials.get(key);

    if (!material) {
      material = build();
      this.materials.set(key, material);
    }

    return material;
  }

  standard(key, options) {
    return this.material(key, () => new THREE.MeshStandardMaterial(options));
  }

  mesh(geometry, material) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    return mesh;
  }

  // -------------------------------------------------------------------------
  // PUBLIC ENTRY POINT
  // -------------------------------------------------------------------------
  // Returns a THREE.Group centred on the drop's hover position. Falls back
  // to the generic shard for an unknown item or model, so an item added
  // without a builder still renders instead of throwing.
  // -------------------------------------------------------------------------
  create(itemId, color) {
    const item = getItem(itemId);
    const kind = item?.model ?? "shard";

    let group;

    switch (kind) {
      case "battery":
        group = this.buildBattery(color);
        break;
      case "medkit":
        group = this.buildMedkit();
        break;
      case "core":
        group = this.buildCore(color);
        break;
      case "arachnid-eye":
        group = this.buildArachnidEye();
        break;
      default:
        group = this.buildShard(color);
        break;
    }

    group.scale.setScalar(ITEM_SCALE);

    return group;
  }

  // -------------------------------------------------------------------------
  // PORTABLE BATTERY
  // -------------------------------------------------------------------------
  // A recognisable real-world cell: dark casing, bright emissive label
  // band in the item's rarity colour, brushed metal end caps and a raised
  // positive terminal. The emissive band is what makes it readable at
  // gameplay distance, the terminal nub is what makes the silhouette read
  // as a battery rather than a can.
  // -------------------------------------------------------------------------
  buildBattery(color) {
    const group = new THREE.Group();

    const casing = this.standard("battery:casing", {
      color: 0x1b2430,
      metalness: 0.55,
      roughness: 0.45
    });

    // Driveworld's scene has no environment map (see world/World.js: a
    // hemisphere light plus a directional sun), and a fully metallic
    // PBR material with nothing to reflect renders almost black. Metalness
    // is therefore kept moderate with a bright base colour so the caps and
    // terminal actually read as brushed metal in-game.
    const metal = this.standard("battery:metal", {
      color: 0xcfd6de,
      metalness: 0.45,
      roughness: 0.35
    });

    const label = this.standard(`battery:label:${color}`, {
      color,
      emissive: color,
      emissiveIntensity: 0.75,
      metalness: 0.2,
      roughness: 0.4
    });

    // Main casing.
    const body = this.mesh(
      this.geometry("battery:body", () =>
        new THREE.CylinderGeometry(0.3, 0.3, 0.88, 18)
      ),
      casing
    );
    group.add(body);

    // Emissive wrap label -- the long-range read.
    const band = this.mesh(
      this.geometry("battery:band", () =>
        new THREE.CylinderGeometry(0.315, 0.315, 0.4, 18)
      ),
      label
    );
    band.position.y = -0.04;
    group.add(band);

    // Brushed end caps.
    const capGeometry = this.geometry("battery:cap", () =>
      new THREE.CylinderGeometry(0.305, 0.305, 0.08, 18)
    );

    const topCap = this.mesh(capGeometry, metal);
    topCap.position.y = 0.46;
    group.add(topCap);

    const bottomCap = this.mesh(capGeometry, metal);
    bottomCap.position.y = -0.46;
    group.add(bottomCap);

    // Positive terminal.
    const terminal = this.mesh(
      this.geometry("battery:terminal", () =>
        new THREE.CylinderGeometry(0.11, 0.11, 0.13, 12)
      ),
      metal
    );
    terminal.position.y = 0.55;
    group.add(terminal);

    // Tilted slightly off vertical so the terminal stays visible while the
    // drop spins, instead of being hidden by the top cap edge-on.
    group.rotation.z = 0.18;

    return group;
  }

  // -------------------------------------------------------------------------
  // FIELD MEDKIT
  // -------------------------------------------------------------------------
  // A hard-shell first-aid case: off-white body, dark lid seam and latch,
  // a carry handle, and an emissive red medical cross on BOTH the front
  // face and the lid. The lid cross matters because Driveworld's
  // third-person camera looks down at the world -- a front-only cross
  // would be invisible from the car.
  // -------------------------------------------------------------------------
  buildMedkit() {
    const group = new THREE.Group();

    const shell = this.standard("medkit:shell", {
      color: 0xeef2f6,
      metalness: 0.15,
      roughness: 0.55
    });

    const trim = this.standard("medkit:trim", {
      color: 0x28313d,
      metalness: 0.5,
      roughness: 0.45
    });

    const cross = this.standard("medkit:cross", {
      color: 0xff4136,
      emissive: 0xd81c12,
      emissiveIntensity: 0.85,
      metalness: 0.1,
      roughness: 0.4
    });

    // Case body.
    const body = this.mesh(
      this.geometry("medkit:body", () =>
        new THREE.BoxGeometry(0.92, 0.62, 0.6)
      ),
      shell
    );
    group.add(body);

    // Lid seam.
    const seam = this.mesh(
      this.geometry("medkit:seam", () =>
        new THREE.BoxGeometry(0.94, 0.09, 0.62)
      ),
      trim
    );
    seam.position.y = 0.06;
    group.add(seam);

    // Latch.
    const latch = this.mesh(
      this.geometry("medkit:latch", () =>
        new THREE.BoxGeometry(0.16, 0.16, 0.06)
      ),
      trim
    );
    latch.position.set(0, 0.06, 0.31);
    group.add(latch);

    // Carry handle.
    // Sits toward the front of the lid so it never covers the lid cross
    // when the camera looks down at the drop.
    const handle = this.mesh(
      this.geometry("medkit:handle", () =>
        new THREE.TorusGeometry(0.15, 0.032, 8, 16, Math.PI)
      ),
      trim
    );
    handle.position.set(0, 0.31, 0.17);
    group.add(handle);

    // Medical cross -- lid (seen from the gameplay camera).
    const lidBarH = this.geometry("medkit:lidBarH", () =>
      new THREE.BoxGeometry(0.36, 0.03, 0.12)
    );
    const lidBarV = this.geometry("medkit:lidBarV", () =>
      new THREE.BoxGeometry(0.12, 0.03, 0.36)
    );

    const lidCrossH = this.mesh(lidBarH, cross);
    lidCrossH.position.set(0, 0.32, -0.13);
    group.add(lidCrossH);

    const lidCrossV = this.mesh(lidBarV, cross);
    lidCrossV.position.set(0, 0.32, -0.13);
    group.add(lidCrossV);

    // Medical cross -- front face (seen at ground level / while orbiting).
    const faceBarH = this.geometry("medkit:faceBarH", () =>
      new THREE.BoxGeometry(0.34, 0.11, 0.03)
    );
    const faceBarV = this.geometry("medkit:faceBarV", () =>
      new THREE.BoxGeometry(0.11, 0.34, 0.03)
    );

    const faceCrossH = this.mesh(faceBarH, cross);
    faceCrossH.position.set(0, -0.12, 0.31);
    group.add(faceCrossH);

    const faceCrossV = this.mesh(faceBarV, cross);
    faceCrossV.position.set(0, -0.12, 0.31);
    group.add(faceCrossV);

    return group;
  }

  // -------------------------------------------------------------------------
  // SALVAGED DATA CORE -- unchanged in spirit from the original drop look,
  // kept deliberately abstract so it stays distinct from the two redesigned
  // physical items.
  // -------------------------------------------------------------------------
  buildCore(color) {
    const group = new THREE.Group();

    const shell = this.standard(`core:shell:${color}`, {
      color,
      emissive: color,
      emissiveIntensity: 0.6,
      metalness: 0.3,
      roughness: 0.35
    });

    const cage = this.standard("core:cage", {
      color: 0x28313d,
      metalness: 0.8,
      roughness: 0.3
    });

    const centre = this.mesh(
      this.geometry("core:centre", () =>
        new THREE.IcosahedronGeometry(0.42, 0)
      ),
      shell
    );
    group.add(centre);

    const ring = this.mesh(
      this.geometry("core:ring", () =>
        new THREE.TorusGeometry(0.52, 0.055, 8, 20)
      ),
      cage
    );
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    return group;
  }

  // -------------------------------------------------------------------------
  // GOLDEN ARACHNID EYE -- the rare boss collectible.
  // -------------------------------------------------------------------------
  // A gilded orb with a real eye in it: warm gold shell, a ring of chitin
  // spines around the equator for the arachnid read, a dark amber iris and
  // a glossy black pupil with a bright catchlight. It must be
  // unmistakable next to a battery or a medkit at a glance.
  //
  // Kept to primitive geometry and a restrained emissive on the iris only.
  // No particle systems, no extra lights, no per-frame allocation -- the
  // "glow" the player sees is the iris emissive plus the ground ring
  // LootSystem already draws for every drop.
  // -------------------------------------------------------------------------
  buildArachnidEye() {
    const group = new THREE.Group();

    const gold = this.standard("eye:gold", {
      color: 0xffc44a,
      emissive: 0x6a4405,
      emissiveIntensity: 0.55,
      metalness: 0.62,
      roughness: 0.26
    });

    const goldDark = this.standard("eye:goldDark", {
      color: 0xb8801f,
      metalness: 0.7,
      roughness: 0.36
    });

    const iris = this.standard("eye:iris", {
      color: 0xffa617,
      emissive: 0xff7a00,
      emissiveIntensity: 1.25,
      metalness: 0.15,
      roughness: 0.25
    });

    const pupil = this.standard("eye:pupil", {
      color: 0x120c04,
      metalness: 0.35,
      roughness: 0.12
    });

    const catchlight = this.standard("eye:catchlight", {
      color: 0xfff3d0,
      emissive: 0xfff0c0,
      emissiveIntensity: 0.9,
      metalness: 0.0,
      roughness: 0.4
    });

    // Gilded orb.
    const orb = this.mesh(
      this.geometry("eye:orb", () => new THREE.SphereGeometry(0.5, 20, 16)),
      gold
    );
    group.add(orb);

    // Chitin spines around the equator -- the arachnid cue. Eight short
    // tapered legs, cheap cones rather than articulated geometry.
    const spineGeometry = this.geometry("eye:spine", () =>
      new THREE.ConeGeometry(0.075, 0.42, 6)
    );

    const spineCount = 8;
    for (let i = 0; i < spineCount; i++) {
      const angle = (i / spineCount) * Math.PI * 2;
      const spine = this.mesh(spineGeometry, goldDark);

      spine.position.set(
        Math.cos(angle) * 0.52,
        -0.12,
        Math.sin(angle) * 0.52
      );

      // Splay outward and slightly down, like folded legs.
      spine.rotation.z = Math.PI / 2 - 0.35;
      spine.rotation.y = -angle;

      group.add(spine);
    }

    // The eye itself lives in a sub-group tilted upward, so the iris is
    // still visible from Driveworld's third-person camera looking down at
    // the ground rather than only from a low side angle.
    const face = new THREE.Group();
    face.rotation.x = -0.42;
    group.add(face);

    // Brow ring around the eye socket.
    const socket = this.mesh(
      this.geometry("eye:socket", () =>
        new THREE.TorusGeometry(0.33, 0.06, 8, 20)
      ),
      goldDark
    );
    socket.position.z = 0.33;
    face.add(socket);

    // Iris.
    const irisMesh = this.mesh(
      this.geometry("eye:iris", () =>
        new THREE.SphereGeometry(0.33, 18, 14)
      ),
      iris
    );
    irisMesh.position.z = 0.3;
    irisMesh.scale.z = 0.62;
    face.add(irisMesh);

    // Pupil.
    const pupilMesh = this.mesh(
      this.geometry("eye:pupil", () =>
        new THREE.SphereGeometry(0.17, 14, 12)
      ),
      pupil
    );
    pupilMesh.position.z = 0.47;
    pupilMesh.scale.z = 0.5;
    face.add(pupilMesh);

    // Catchlight, so the eye reads as wet/alive rather than painted on.
    const glint = this.mesh(
      this.geometry("eye:glint", () =>
        new THREE.SphereGeometry(0.058, 10, 8)
      ),
      catchlight
    );
    glint.position.set(0.085, 0.1, 0.52);
    face.add(glint);

    return group;
  }

  // Generic fallback for an item with no dedicated builder.
  buildShard(color) {
    const group = new THREE.Group();

    const material = this.standard(`shard:${color}`, {
      color,
      emissive: color,
      emissiveIntensity: 0.6,
      roughness: 0.35
    });

    group.add(
      this.mesh(
        this.geometry("shard:body", () =>
          new THREE.IcosahedronGeometry(0.55, 0)
        ),
        material
      )
    );

    return group;
  }

  // Releases every shared geometry and material. Called from
  // LootSystem.dispose(); individual drops never dispose anything because
  // they only ever reference these shared resources.
  dispose() {
    for (const geometry of this.geometries.values()) geometry.dispose();
    for (const material of this.materials.values()) material.dispose();

    this.geometries.clear();
    this.materials.clear();
  }
}
