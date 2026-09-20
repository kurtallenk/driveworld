import { buildRoadRoutes, POI_SITES, WORLD_HALF } from "../world/WorldGeometry.js";

// ---------------------------------------------------------------------------
// MINIMAP
// ---------------------------------------------------------------------------
// Canvas minimap driven from the SAME road/POI data the world is built
// from (WorldGeometry.js), so it can never drift out of sync with the map
// the player is actually driving on.
//
// Performance notes -- this runs alongside a three.js render loop:
//   * The road network is rasterised ONCE into an offscreen canvas at
//     construction, then blitted per redraw. No per-frame path building.
//   * Redraws are throttled by Game.js's existing 100ms HUD tick, not the
//     animation frame.
//   * No DOM nodes are created after construction; everything is canvas.
// ---------------------------------------------------------------------------

const WORLD_SPAN = WORLD_HALF * 2;

// How much of the world is visible around the player, in world metres.
const VIEW_RADIUS = 110;
const EXPANDED_PADDING = 8;

const COLORS = {
  bg: "#0a0d10",
  grass: "#161b17",
  asphalt: "#3a424a",
  dirt: "#6f5b3f",
  player: "#48d5ff",
  enemy: "#ff5a54",
  poi: "#d8d2c4",
  poiHostile: "#ffb04a",
  charge: "#4be3a0",
  item: "#c07aff"
};

export class Minimap {
  constructor(panelElement) {
    this.panel = panelElement;
    this.canvas = panelElement?.querySelector("canvas") ?? null;
    this.ctx = this.canvas?.getContext("2d") ?? null;

    this.expanded = false;
    this.enabled = Boolean(this.ctx);

    // Sources the minimap reads from. Assigned by Game.js so this class
    // never reaches into game systems itself.
    this.chargingStation = null;
    this.getEnemies = null;
    this.getWorldItems = null;
    this.pois = POI_SITES;

    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.sized = false;

    if (this.enabled) {
      this.buildRoadLayer();
      this.resize();

      window.addEventListener("resize", () => this.resize());

      // The panel is hidden at construction and revealed by Game.js, and it
      // also changes size when the map expands or the device rotates. A
      // ResizeObserver catches all of those without polling.
      if (typeof ResizeObserver !== "undefined") {
        this.observer = new ResizeObserver(() => this.resize());
        this.observer.observe(this.canvas);
      }
    }
  }

  // -------------------------------------------------------------------
  // STATIC ROAD LAYER
  // Rasterised once at world scale; every redraw just transforms and
  // blits it, which keeps per-tick cost to a single drawImage.
  // -------------------------------------------------------------------
  buildRoadLayer() {
    const size = 512;

    const layer = document.createElement("canvas");
    layer.width = size;
    layer.height = size;

    const ctx = layer.getContext("2d");
    const scale = size / WORLD_SPAN;

    ctx.fillStyle = COLORS.grass;
    ctx.fillRect(0, 0, size, size);

    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const route of buildRoadRoutes()) {
      ctx.strokeStyle =
        route.surface === "dirt" ? COLORS.dirt : COLORS.asphalt;

      // Road width is drawn to scale, so the hierarchy (12m spine vs 5m
      // access spur) is visually readable on the map too.
      ctx.lineWidth = Math.max(1.2, route.width * scale);

      ctx.beginPath();

      route.points.forEach((point, index) => {
        const x = (point.x + WORLD_HALF) * scale;
        const y = (point.z + WORLD_HALF) * scale;

        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });

      ctx.stroke();
    }

    this.roadLayer = layer;
    this.roadScale = scale;
  }

  // Measures the canvas against its CSS box and resizes the backing store.
  // Returns false when the element has no layout yet (panel still hidden,
  // display:none, or measured before first paint) -- in that case the old
  // backing store is LEFT ALONE. Sizing it to 1x1 there was the original
  // bug: the map then rendered as a single stretched pixel.
  resize() {
    if (!this.canvas) return false;

    const rect = this.canvas.getBoundingClientRect();

    if (rect.width < 2 || rect.height < 2) return false;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const width = Math.max(2, Math.round(rect.width * dpr));
    const height = Math.max(2, Math.round(rect.height * dpr));

    this.dpr = dpr;

    // Writing width/height clears the canvas, so only do it on a real change.
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    this.sized = true;

    return true;
  }

  toggleExpanded() {
    this.expanded = !this.expanded;
    this.panel?.classList.toggle("minimap--expanded", this.expanded);

    // Layout changed, so the backing store has to be re-measured.
    requestAnimationFrame(() => this.resize());

    return this.expanded;
  }

  setVisible(visible) {
    if (!this.panel) return;

    this.panel.hidden = !visible;

    // A hidden element has no layout box, so the canvas can only be sized
    // correctly once it is actually on screen.
    if (visible) this.resize();
  }

  // -------------------------------------------------------------------
  // DRAW
  // Called from Game.js's throttled HUD tick.
  // -------------------------------------------------------------------
  // playerHeading: compass angle in radians, 0 = facing world -Z (up on
  // the map), increasing clockwise. Game.js derives it with
  // Math.atan2(forward.x, -forward.z).
  draw(playerPosition, playerHeading = 0) {
    if (!this.enabled || !playerPosition || this.panel?.hidden) return;

    // If the panel was hidden when we last measured, the backing store is
    // still stale. Re-measure now that it is definitely laid out; skip the
    // frame if it somehow still has no size.
    if (!this.sized && !this.resize()) return;

    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.save();
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, h);

    // Expanded view zooms out to the whole world; the compact view follows
    // the player at a fixed radius.
    const viewRadius = this.expanded
      ? WORLD_HALF + EXPANDED_PADDING
      : VIEW_RADIUS;

    const centerX = this.expanded ? 0 : playerPosition.x;
    const centerZ = this.expanded ? 0 : playerPosition.z;

    // pixels per world metre in the visible viewport
    const px = Math.min(w, h) / (viewRadius * 2);

    const project = (wx, wz) => [
      w / 2 + (wx - centerX) * px,
      h / 2 + (wz - centerZ) * px
    ];

    // --- roads -------------------------------------------------------
    const layerScale = px / this.roadScale;

    ctx.save();
    ctx.translate(
      w / 2 - (centerX + WORLD_HALF) * this.roadScale * layerScale,
      h / 2 - (centerZ + WORLD_HALF) * this.roadScale * layerScale
    );
    ctx.scale(layerScale, layerScale);
    ctx.drawImage(this.roadLayer, 0, 0);
    ctx.restore();

    // --- charging station --------------------------------------------
    if (this.chargingStation?.position) {
      const [cx, cy] = project(
        this.chargingStation.position.x,
        this.chargingStation.position.z
      );

      ctx.fillStyle = COLORS.charge;
      ctx.beginPath();
      ctx.arc(cx, cy, 4 * this.dpr, 0, Math.PI * 2);
      ctx.fill();
    }

    // --- POIs ---------------------------------------------------------
    // Only discovered sites are labelled, so the map stays readable and
    // exploration still has a point.
    for (const site of this.pois) {
      const [sx, sy] = project(site.x, site.z);

      if (sx < -40 || sy < -40 || sx > w + 40 || sy > h + 40) continue;

      const hostile = site.hostile;

      ctx.strokeStyle = hostile ? COLORS.poiHostile : COLORS.poi;
      ctx.lineWidth = 1.5 * this.dpr;

      const r = 4.5 * this.dpr;

      ctx.beginPath();
      ctx.rect(sx - r, sy - r, r * 2, r * 2);
      ctx.stroke();

      if (this.expanded) {
        ctx.fillStyle = hostile ? COLORS.poiHostile : COLORS.poi;
        ctx.font = `${9 * this.dpr}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(site.name, sx, sy - r - 3 * this.dpr);
      }
    }

    // --- world items (loot) -------------------------------------------
    const items = this.getWorldItems?.() ?? [];

    for (const item of items) {
      const [ix, iy] = project(item.position.x, item.position.z);

      ctx.fillStyle = item.color ?? "#c07aff";
      ctx.beginPath();
      ctx.arc(ix, iy, 2.5 * this.dpr, 0, Math.PI * 2);
      ctx.fill();
    }

    // --- enemies -------------------------------------------------------
    // Shown only when reasonably close, so the map is a tactical aid
    // rather than a full wallhack of the world.
    const enemies = this.getEnemies?.() ?? [];

    for (const enemy of enemies) {
      const distance = Math.hypot(
        enemy.position.x - playerPosition.x,
        enemy.position.z - playerPosition.z
      );

      if (!this.expanded && distance > VIEW_RADIUS) continue;
      if (this.expanded && distance > 160) continue;

      const [ex, ey] = project(enemy.position.x, enemy.position.z);
      const boss = enemy.kind === "boss";

      ctx.fillStyle = COLORS.enemy;
      ctx.beginPath();
      ctx.arc(ex, ey, (boss ? 4.5 : 2.6) * this.dpr, 0, Math.PI * 2);
      ctx.fill();
    }

    // --- player ---------------------------------------------------------
    const [pxc, pyc] = project(playerPosition.x, playerPosition.z);

    ctx.save();
    ctx.translate(pxc, pyc);
    // playerHeading is a compass angle (0 = up/-Z, clockwise-positive).
    // Canvas rotation is also clockwise-positive because +Y points down,
    // and the marker below is authored pointing up, so the angle is
    // applied directly -- negating it here would point the marker at the
    // car's rear.
    ctx.rotate(playerHeading);

    ctx.fillStyle = COLORS.player;
    ctx.beginPath();
    ctx.moveTo(0, -6 * this.dpr);
    ctx.lineTo(4.2 * this.dpr, 5 * this.dpr);
    ctx.lineTo(0, 2.6 * this.dpr);
    ctx.lineTo(-4.2 * this.dpr, 5 * this.dpr);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
    ctx.restore();
  }
}
