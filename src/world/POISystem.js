import * as THREE from "three";
import * as CANNON from "cannon-es";

import { POI_SITES } from "./WorldGeometry.js";

// ---------------------------------------------------------------------------
// POINT OF INTEREST SYSTEM
// ---------------------------------------------------------------------------
// Builds the physical/visual side of the POI table declared in
// WorldGeometry.js, and tracks which sites the player has discovered.
//
// Deliberate split:
//   WorldGeometry.POI_SITES  -> pure data (shared with the Node server)
//   POISystem (this file)    -> three.js props + cannon bodies + discovery
//
// This system owns NO enemy logic. TargetSystem stays the single authority
// on spawning; it just asks this table where the hostile sites are (see
// getEnemyAnchors) so encounters cluster at places instead of being
// sprinkled across empty grass.
// ---------------------------------------------------------------------------

const DISCOVERY_PADDING = 12;

// Per-kind palette. Kept muted and industrial so POIs read as worn roadside
// infrastructure rather than brightly coloured gameplay markers.
const KIND_STYLE = {
  depot: { primary: 0x6d6a60, accent: 0x8a6a3a },
  station: { primary: 0x7c7368, accent: 0xb44b3a },
  warehouse: { primary: 0x5f6672, accent: 0x49525c },
  repair: { primary: 0x5b6b62, accent: 0x4bb98a },
  checkpoint: { primary: 0x6b6357, accent: 0xc2a23f },
  industrial: { primary: 0x656b74, accent: 0x9a5a34 },
  rest: { primary: 0x66705f, accent: 0x7fa05a }
};

export function createPOIs(scene, physics, terrain) {
  const group = new THREE.Group();
  group.name = "poi-props";
  scene.add(group);

  // Deterministic prop jitter -- same seed strategy the rest of the world
  // generation uses, so a refresh never reshuffles the scenery.
  let seed = 774411;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const disposables = [];

  function material(color, roughness = 0.95) {
    const mat = new THREE.MeshStandardMaterial({ color, roughness });
    disposables.push(mat);
    return mat;
  }

  // Static collidable prop. Mirrors World.js's solidBox so POI structures
  // behave exactly like the rest of the world's fixed geometry.
  function prop(size, position, color, opts = {}) {
    const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
    disposables.push(geometry);

    const mesh = new THREE.Mesh(geometry, material(color));
    mesh.position.set(position[0], position[1], position[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    if (opts.rotation) mesh.rotation.y = opts.rotation;

    group.add(mesh);

    // `solid: false` is used for thin signage/markings that the car should
    // be able to drive over without a jarring stop.
    if (opts.solid !== false) {
      const body = new CANNON.Body({ mass: 0 });

      body.addShape(
        new CANNON.Box(
          new CANNON.Vec3(size[0] / 2, size[1] / 2, size[2] / 2)
        )
      );

      body.position.set(position[0], position[1], position[2]);

      if (opts.rotation) {
        body.quaternion.setFromEuler(0, opts.rotation, 0);
      }

      body.surface = "asphalt";
      physics.addBody(body);
    }

    return mesh;
  }

  // A flat worn apron so each site reads as a built-up lot rather than
  // props dropped onto grass.
  function apron(site) {
    const geometry = new THREE.CircleGeometry(site.radius, 24);
    disposables.push(geometry);

    const mesh = new THREE.Mesh(geometry, material(0x4a4740, 1));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(site.x, terrain.heightAt(site.x, site.z) + 0.03, site.z);
    mesh.receiveShadow = true;

    group.add(mesh);
  }

  function buildSite(site) {
    const style = KIND_STYLE[site.kind] ?? KIND_STYLE.depot;
    const ground = terrain.heightAt(site.x, site.z);

    apron(site);

    switch (site.kind) {
      case "station": {
        // Forecourt canopy on pillars + pump islands.
        prop([16, 0.6, 10], [site.x, ground + 5.2, site.z], style.primary);

        for (const dx of [-7, 7]) {
          for (const dz of [-4, 4]) {
            prop([0.7, 5, 0.7], [site.x + dx, ground + 2.5, site.z + dz], style.primary);
          }
        }

        for (const dx of [-3, 3]) {
          prop([1.2, 1.8, 3], [site.x + dx, ground + 0.9, site.z], style.accent);
        }

        prop([6, 2.6, 0.5], [site.x, ground + 6.8, site.z], style.accent);
        break;
      }

      case "warehouse": {
        // Large shed with a loading dock and scattered crates.
        prop([26, 9, 16], [site.x, ground + 4.5, site.z], style.primary);
        prop([26, 1.2, 3], [site.x, ground + 9.4, site.z], style.accent);
        prop([8, 0.8, 4], [site.x, ground + 0.4, site.z + 10], style.accent);

        for (let i = 0; i < 6; i++) {
          prop(
            [2, 2, 2],
            [
              site.x - 14 + random() * 4,
              ground + 1,
              site.z - 8 + i * 3.2
            ],
            style.accent
          );
        }
        break;
      }

      case "industrial": {
        // The largest, highest-level site: silos, a long shed and stacks.
        prop([20, 11, 12], [site.x - 6, ground + 5.5, site.z], style.primary);

        for (const dx of [10, 15]) {
          const silo = new THREE.Mesh(
            new THREE.CylinderGeometry(3, 3, 14, 12),
            material(style.primary)
          );
          silo.position.set(site.x + dx, ground + 7, site.z + 6);
          silo.castShadow = true;
          group.add(silo);

          const body = new CANNON.Body({ mass: 0 });
          body.addShape(new CANNON.Cylinder(3, 3, 14, 12));
          body.position.set(site.x + dx, ground + 7, site.z + 6);
          body.surface = "asphalt";
          physics.addBody(body);
        }

        for (let i = 0; i < 8; i++) {
          prop(
            [2.4, 2.4, 2.4],
            [site.x + 4 + (i % 4) * 3, ground + 1.2 + Math.floor(i / 4) * 2.4, site.z - 9],
            style.accent
          );
        }
        break;
      }

      case "checkpoint": {
        // Blocked carriageway: barriers, a booth and a boom gate.
        prop([3, 3, 3], [site.x, ground + 1.5, site.z], style.primary);
        prop([0.4, 3, 0.4], [site.x - 4, ground + 1.5, site.z], style.accent);
        prop([8, 0.4, 0.4], [site.x - 8, ground + 2.4, site.z], style.accent);

        for (let i = 0; i < 4; i++) {
          prop(
            [3, 1.1, 0.8],
            [site.x - 9 + i * 4, ground + 0.55, site.z + 7],
            style.accent,
            { rotation: 0.2 }
          );
        }
        break;
      }

      case "repair": {
        // Neutral service stop: open bay, tool racks, a lift.
        prop([14, 6, 10], [site.x, ground + 3, site.z], style.primary);
        prop([14, 0.8, 2], [site.x, ground + 6.4, site.z - 4], style.accent);
        prop([4, 0.6, 4], [site.x, ground + 0.3, site.z + 7], style.accent, { solid: false });
        prop([0.6, 2.4, 0.6], [site.x + 5, ground + 1.2, site.z + 7], style.accent);
        break;
      }

      case "rest": {
        // Small pull-in: shelter, benches, a sign.
        prop([8, 0.5, 6], [site.x, ground + 3.2, site.z], style.primary);

        for (const dx of [-3.4, 3.4]) {
          prop([0.5, 3.2, 0.5], [site.x + dx, ground + 1.6, site.z], style.primary);
        }

        prop([3, 0.4, 1], [site.x, ground + 0.9, site.z], style.accent);
        prop([0.4, 3, 0.4], [site.x + 8, ground + 1.5, site.z - 4], style.accent);
        break;
      }

      default: {
        // Depot: container rows, a shed and a fuel tank.
        prop([12, 6, 9], [site.x - 4, ground + 3, site.z], style.primary);

        for (let i = 0; i < 4; i++) {
          prop(
            [6, 2.6, 2.6],
            [site.x + 7, ground + 1.3 + (i % 2) * 2.6, site.z - 6 + Math.floor(i / 2) * 4],
            style.accent
          );
        }

        const tank = new THREE.Mesh(
          new THREE.CylinderGeometry(2, 2, 7, 12),
          material(style.primary)
        );
        tank.rotation.z = Math.PI / 2;
        tank.position.set(site.x - 2, ground + 2, site.z + 9);
        tank.castShadow = true;
        group.add(tank);
        break;
      }
    }
  }

  for (const site of POI_SITES) {
    buildSite(site);
  }

  // -------------------------------------------------------------------------
  // DISCOVERY
  // -------------------------------------------------------------------------
  // Purely client-side and cosmetic (a notification + a minimap label), so
  // it needs no network synchronisation: each player discovers sites at
  // their own pace without affecting anyone else's session.
  // -------------------------------------------------------------------------

  const discovered = new Set();

  const api = {
    group,
    sites: POI_SITES,

    onDiscovered: null,

    isDiscovered(id) {
      return discovered.has(id);
    },

    // Hostile sites double as enemy anchors for TargetSystem.
    getEnemyAnchors() {
      return POI_SITES.filter(site => site.hostile);
    },

    // Returns the site the player is currently standing in, or null.
    siteAt(x, z) {
      for (const site of POI_SITES) {
        if (Math.hypot(x - site.x, z - site.z) <= site.radius) {
          return site;
        }
      }

      return null;
    },

    // Called from Game.js's throttled HUD tick, not every frame -- this is
    // a handful of cheap distance checks with no allocation.
    update(playerPosition) {
      if (!playerPosition) return null;

      for (const site of POI_SITES) {
        if (discovered.has(site.id)) continue;

        const distance = Math.hypot(
          playerPosition.x - site.x,
          playerPosition.z - site.z
        );

        if (distance <= site.radius + DISCOVERY_PADDING) {
          discovered.add(site.id);
          api.onDiscovered?.(site);
          return site;
        }
      }

      return null;
    },

    dispose() {
      for (const item of disposables) item.dispose?.();
      scene.remove(group);
    }
  };

  return api;
}
