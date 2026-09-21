import * as THREE from "three";
import * as CANNON from "cannon-es";

import {
  groundLayerHeight,
  placeGroundDecal,
  GROUND_LAYER
} from "./GroundLayers.js";
import {
  POI_SITES,
  TOWN_CENTER,
  TOWN_ENTRANCE,
  TOWN_PLATEAU_RADIUS
} from "./WorldGeometry.js";

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
  rest: { primary: 0x66705f, accent: 0x7fa05a },
  // Hilltop community: warmer, more "lived in" than the derelict sites.
  town: { primary: 0x7a7266, accent: 0xc98a3c }
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
    mesh.position.set(site.x, 0, site.z);

    // The lowest ground decal: roads and their markings are drawn over the
    // apron instead of z-fighting with it (see GroundLayers.js).
    placeGroundDecal(mesh, GROUND_LAYER.poiApron, {
      y: terrain.heightAt(site.x, site.z) +
        groundLayerHeight(GROUND_LAYER.poiApron)
    });

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

      case "town": {
        // ---------------------------------------------------------------
        // RIDGEVIEW MOTOR TOWN
        //
        // The environmental FOUNDATION of a car community, not a finished
        // service hub: an enclosed lot with one readable entrance, a
        // bulletin board, an internal street (drawn by Roads.js from the
        // shared route table) and marked-out, deliberately empty plots for
        // the service/shop/meeting buildings those systems will need when
        // they exist.
        //
        // Every prop is placed against terrain.heightAt(), so it sits on
        // the plateau rather than at world zero, and the perimeter is
        // walked as an arc with a gap at the entrance -- the gap is never
        // filled, so the single way in can never be blocked by scenery.
        // ---------------------------------------------------------------
        const radius = TOWN_PLATEAU_RADIUS - 2;

        // Entrance bearing, measured from the plateau centre.
        const entranceAngle = Math.atan2(
          TOWN_ENTRANCE.z - TOWN_CENTER.z,
          TOWN_ENTRANCE.x - TOWN_CENTER.x
        );

        // +1 when the town extends toward +z from the gate, -1 otherwise.
        // Every offset below is expressed as "distance inward from the
        // gate", so the layout follows the entrance instead of hardcoding
        // a compass direction.
        const inward = Math.sign(TOWN_CENTER.z - TOWN_ENTRANCE.z) || 1;

        // Half-width of the gap left in the perimeter, in radians.
        const gateGap = 0.34;

        const heightOn = (x, z) => terrain.heightAt(x, z);
        const at = (dx, dz) => [site.x + dx, site.z + dz * inward];

        // --- PERIMETER ------------------------------------------------
        // Fence posts + panels all the way round except the gate opening.
        const segments = 56;

        for (let i = 0; i < segments; i++) {
          const angle = (i / segments) * Math.PI * 2;

          let offset = angle - entranceAngle;
          offset = Math.atan2(Math.sin(offset), Math.cos(offset));

          if (Math.abs(offset) < gateGap) continue;

          const px = site.x + Math.cos(angle) * radius;
          const pz = site.z + Math.sin(angle) * radius;
          const base = heightOn(px, pz);

          // Low wall on the approach side, open fence elsewhere: the solid
          // stretch faces the ramp so the town reads as enclosed as you
          // drive up to it.
          const solidWall = Math.abs(offset) < 1.1;

          prop(
            solidWall ? [3.2, 2.2, 0.5] : [3.2, 1.5, 0.35],
            [px, base + (solidWall ? 1.1 : 0.75), pz],
            solidWall ? style.primary : 0x6a6257,
            { rotation: angle + Math.PI / 2 }
          );
        }

        // --- GATE -----------------------------------------------------
        // Two pillars and a sign beam across the top: unmistakable, and
        // set wider than the carriageway so nothing narrows the opening.
        const gateX = TOWN_ENTRANCE.x;
        const gateZ = TOWN_ENTRANCE.z;
        const gateBase = heightOn(gateX, gateZ);

        for (const dx of [-7.5, 7.5]) {
          prop([1.6, 6, 1.6], [gateX + dx, gateBase + 3, gateZ], style.primary);
        }

        prop([17, 1.6, 0.8], [gateX, gateBase + 6.6, gateZ], style.accent);

        // --- BULLETIN BOARD -------------------------------------------
        // Just inside the gate and off the carriageway, where a driver
        // actually stops.
        const [boardX, boardZ] = [gateX + 11, gateZ + 7 * inward];
        const boardBase = heightOn(boardX, boardZ);

        for (const dx of [-1.7, 1.7]) {
          prop([0.35, 2.4, 0.35], [boardX + dx, boardBase + 1.2, boardZ], 0x6a6257);
        }

        prop([4.4, 2.6, 0.3], [boardX, boardBase + 3.1, boardZ], style.accent);
        prop([4.8, 0.4, 1.1], [boardX, boardBase + 4.5, boardZ], style.primary);

        // --- FUTURE PLOTS ---------------------------------------------
        // Marked-out, deliberately low foundations either side of the
        // internal street. These are the spaces the service bay, the shop
        // and the community meeting area will occupy once those systems
        // exist -- pads and a name post, not buildings, so nothing has to
        // be torn down later. All of them (kerbs and posts included) are
        // inside the fence ring by construction.
        const plots = [
          { dx: -15, dz: 2, w: 13, d: 12, label: 0x4bb98a }, // service/repair
          { dx: 15, dz: 2, w: 13, d: 12, label: 0xc2a23f },  // shop
          { dx: 0, dz: 16, w: 18, d: 10, label: 0x8fb4d8 }   // car-community meet
        ];

        for (const plot of plots) {
          const [px, pz] = at(plot.dx, plot.dz);
          const base = heightOn(px, pz);

          // Flat pad the car can drive straight onto. This one IS solid:
          // it is a raised concrete foundation, so it needs a collision
          // body or the car sinks through it and drives at terrain height
          // with its wheels buried in the slab. Kept low (12cm) so the
          // step up reads as a kerb-height lip rather than a wall. prop()
          // gives solid bodies the "asphalt" surface, so the tyre model
          // behaves the same as it does on the rest of the town.
          prop([plot.w, 0.12, plot.d], [px, base + 0.06, pz], 0x585449);

          // Kerb stubs marking the plot corners without enclosing it.
          const kerbZ = pz - (plot.d / 2 - 0.7) * inward;

          for (const sx of [-1, 1]) {
            prop(
              [1.4, 0.5, 1.4],
              [px + sx * (plot.w / 2 - 0.7), base + 0.25, kerbZ],
              0x6a6257
            );
          }

          // Name post on the street side, so the empty plot reads as
          // reserved rather than forgotten.
          const postZ = pz - (plot.d / 2 + 1.4) * inward;

          prop([0.3, 2.2, 0.3], [px, heightOn(px, postZ) + 1.1, postZ], 0x6a6257);
          prop([2.4, 0.9, 0.2], [px, heightOn(px, postZ) + 2.4, postZ], plot.label);
        }

        // --- PARKING ----------------------------------------------------
        // Bay markings along the cross street, painted on (non-solid) so
        // they never stop a car.
        for (let i = 0; i < 6; i++) {
          const [px, pz] = at(-13 + i * 5.2, 12);

          // Painted on, so they sit flush with the surface rather than
          // floating a few centimetres above it where the car visibly
          // passes through them.
          prop([0.25, 0.04, 5], [px, heightOn(px, pz) + 0.02, pz], 0xd8d2c4, {
            solid: false
          });
        }

        // --- STREET FURNITURE -------------------------------------------
        // Lamp posts and benches, so the lot feels inhabited rather than
        // like an empty platform.
        for (const [dx, dz] of [[-12, -14], [12, -14], [-17, 13], [17, 13]]) {
          const [px, pz] = at(dx, dz);
          const base = heightOn(px, pz);

          prop([0.3, 4.2, 0.3], [px, base + 2.1, pz], 0x6a6257);
          prop([1.2, 0.35, 1.2], [px, base + 4.3, pz], style.accent);
        }

        for (const dx of [-11, 11]) {
          const [px, pz] = at(dx, 9);
          const base = heightOn(px, pz);

          prop([2.6, 0.35, 0.8], [px, base + 0.55, pz], 0x7a6a4f);
          prop([2.6, 0.9, 0.2], [px, base + 1.05, pz - 0.3 * inward], 0x7a6a4f);
        }

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
