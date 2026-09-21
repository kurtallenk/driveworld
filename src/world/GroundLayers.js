// ---------------------------------------------------------------------------
// GROUND DECAL LAYERING
// ---------------------------------------------------------------------------
// One shared convention for every flat thing painted onto the ground: road
// ribbons, POI aprons, the spawn pad, lane stripes, charging-zone markings.
//
// THE PROBLEM THIS SOLVES
//
// Each road route is its own ribbon mesh, and every ribbon used to sit at
// exactly terrain height + 0.035. Wherever two routes cross -- which is
// most junctions -- the two surfaces are perfectly coplanar, so the depth
// buffer cannot decide which is in front. The GPU picks differently per
// pixel and per frame, which is the shimmering, tearing "clipping" seen at
// every intersection. The same happens between a road and the terrain it
// hugs, and between a road and the apron/pad underneath it.
//
// THE FIX
//
// Two mechanisms, applied together:
//
//   1. Polygon offset. This is the purpose-built depth-buffer fix: it
//      biases a surface toward the camera in DEPTH units, so the bias
//      stays effective at any distance without moving the geometry. Later
//      layers get a stronger negative bias, so they always win.
//
//   2. A tiny physical lift (1.5mm per layer) as a deterministic
//      tie-break, plus an explicit renderOrder so draw order is stable.
//      Kept deliberately small -- large vertical stacking would make the
//      upper roads visibly float above the grass at their edges.
//
// Layer order matches the surface classifier in WorldGeometry.surfaceAt(),
// which resolves overlaps as "later-painted routes win". Keeping the two
// in the same order means the road you can SEE at a junction is the road
// the physics and the server think you are driving on.
// ---------------------------------------------------------------------------

// Height of the lowest decal above the terrain it is painted on.
export const GROUND_DECAL_BASE = 0.03;

// Physical separation between consecutive layers. Small on purpose: the
// depth fix is polygon offset, not this.
export const GROUND_LAYER_STEP = 0.0015;

// Fixed layers that sit UNDER the road network.
export const GROUND_LAYER = {
  poiApron: 0,
  spawnPad: 1,
  // Road routes occupy roadBase + routeIndex.
  roadBase: 2
};

// Head-room reserved for road routes. The road network currently has ~21
// routes; the reserve lets modules that do NOT own the route table (the
// charging station, POI overlays) pick a layer that is guaranteed to sit
// above every road without importing Roads.js.
export const ROUTE_LAYER_CAPACITY = 24;

// Road routes are appended after roadBase; anything that must sit on top of
// every road (lane markings, zone overlays) uses a layer above them all.
export function markingLayer(routeCount) {
  return GROUND_LAYER.roadBase + Math.min(routeCount, ROUTE_LAYER_CAPACITY) + 1;
}

// Fixed layer for overlays painted by other modules on top of everything.
export const GROUND_LAYER_OVERLAY =
  GROUND_LAYER.roadBase + ROUTE_LAYER_CAPACITY + 2;

export function groundLayerHeight(layer) {
  return GROUND_DECAL_BASE + Math.max(0, layer) * GROUND_LAYER_STEP;
}

// Applies the depth bias for a layer to a material. Returns the material so
// it can be used inline.
export function applyGroundDecalDepth(material, layer) {
  if (!material) return material;

  material.polygonOffset = true;

  // A slope-scaled component so the bias survives steep road ribbons (the
  // town ramp, the hillside routes) where a constant bias alone is weakest.
  material.polygonOffsetFactor = -1;

  // Constant component. More negative == nearer the camera == drawn on top.
  material.polygonOffsetUnits = -(Math.max(0, layer) + 1) * 2;

  return material;
}

// Convenience: position a mesh on its layer and bias its material.
export function placeGroundDecal(mesh, layer, { y = null } = {}) {
  if (!mesh) return mesh;

  applyGroundDecalDepth(mesh.material, layer);

  mesh.renderOrder = layer;
  mesh.position.y = y === null ? groundLayerHeight(layer) : y;

  return mesh;
}
