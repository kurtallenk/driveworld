import * as THREE from "three";
import * as CANNON from "cannon-es";
import { ChatBubble } from "./ChatBubble.js";
import { RemoteTurret } from "../turret/RemoteTurret.js";
import { ExhaustSystem } from "../vehicle/ExhaustSystem.js";
import { HealthBar } from "../gameplay/HealthBar.js";
import { VehicleDestruction } from "../vehicle/VehicleDestruction.js";
import { VehicleEvolutionRig } from "../vehicle/VehicleEvolution.js";
import { getEvolutionStage } from "../gameplay/EvolutionConfig.js";
import {
  COLLISION_GROUPS,
  REMOTE_VEHICLE_CANNON_MATERIAL
} from "../vehicle/CollisionGroups.js";
import {
  buildVehicleBody,
  buildWheelGeometries,
  createWheel
} from "../vehicle/VehicleVisual.js";

const COLLIDER_HALF_EXTENTS = new CANNON.Vec3(0.9, 0.3, 2);
const COLLIDER_OFFSET = new CANNON.Vec3(0, 0.15, 0);
const INTERPOLATION_DELAY = 120;
const BUBBLE_ANCHOR_Y = 2.35;

  constructor(scene, player, physics = null) {
    this.scene = scene;
    this.id = player.id;
    this.name = typeof player.name === "string" && player.name.length > 0
      ? player.name
      : `Driver ${player.id.slice(0, 6)}`;

    this.root = new THREE.Group();
    scene.add(this.root);

    this.samples = [];
    this.lastState = player.state;
    this.physics = physics;
    this.body = null;

    if (physics) {
      this.body = new CANNON.Body({
        mass: 0,
        type: CANNON.Body.KINEMATIC,
        material: REMOTE_VEHICLE_CANNON_MATERIAL,
        collisionFilterGroup: COLLISION_GROUPS.REMOTE,
        collisionFilterMask: COLLISION_GROUPS.VEHICLE
      });

      this.body.addShape(new CANNON.Box(COLLIDER_HALF_EXTENTS), COLLIDER_OFFSET);

      if (player.state?.position) this.body.position.set(...player.state.position);
      if (player.state?.rotation) this.body.quaternion.set(...player.state.rotation);

      physics.addBody(this.body);
    }

    // IMPORTANT: this is the exact same geometry/material construction as the
    // local Vehicle.js. Only transform ownership differs: the remote root is
    // network-driven, while the local root is physics-driven.
    const visual = buildVehicleBody(this.root, player.color);
    this.paint = visual.mat.paint;
    this.brakeMaterial = visual.mat.tailLamp;
    this.exhaustPoints = visual.exhaustPoints;
    this.driverEye = visual.driverEye;
    this.steeringWheel = visual.steeringWheel;
    this.dashboardCanvas = visual.dashboardCanvas;
    this.dashboardContext = visual.dashboardContext;
    this.dashboardTexture = visual.dashboardTexture;

    const wheelGeo = buildWheelGeometries();
    this.wheels = [];

    // Remote wheels use the same wheel geometry as Vehicle.js. Their corner
    // pivots approximate the same chassis mounting points because no remote
    // Cannon.RaycastVehicle exists on this client.
    for (const [x, z, front] of [
      [-0.95, 1.35, true],
      [0.95, 1.35, true],
      [-0.95, -1.35, false],
      [0.95, -1.35, false]
    ]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, -0.32, z);
      const tire = createWheel(wheelGeo, visual.mat, this.wheels.length % 2 === 0 ? 1 : -1);
      pivot.add(tire);
      this.root.add(pivot);
      this.wheels.push({ pivot, tire, front });
    }

    // Remote-only presentation.
    const canvas = document.createElement("canvas");
    canvas.width = 300;
    canvas.height = 80;
    const context = canvas.getContext("2d");
    context.fillStyle = "#09131ed9";
    context.fillRect(0, 0, 300, 80);
    context.fillStyle = "#ffffff";
    context.textAlign = "center";

    let fontSize = 50;
    context.font = `bold ${fontSize}px sans-serif`;
    while (context.measureText(this.name).width > 460 && fontSize > 18) {
      fontSize -= 2;
      context.font = `bold ${fontSize}px sans-serif`;
    }
    context.fillText(this.name, 150, 50);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.label = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texture,
      depthWrite: false
    }));
    this.label.position.set(0.1, 2.4, 0);
    this.label.scale.set(1.25, 0.3, 1);
    this.root.add(this.label);

    this.chatBubble = new ChatBubble(this.root, BUBBLE_ANCHOR_Y);
    this.turret = new RemoteTurret(this.root, this.scene, player.color);

    // Remote evolution: initial state is applied instantly; later stage changes
    // animate exactly once, allowing every client to see another player's
    // transformation.
    this.evolution = new VehicleEvolutionRig(this.root);
    this.evolutionStage = null;

    this.exhaust = new ExhaustSystem(scene, this.root, this.exhaustPoints);

    this.healthBar = new HealthBar(scene, {
      width: 1.6, height: 0.16, yOffset: 2.65
    });

    this.destruction = new VehicleDestruction(scene, this.root);
    this.wasDead = false;

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

    // Turret is state/event-driven, not interpolated like position -- this
    // also covers late joiners, since `state` here is the player's full
    // current state (including turret) whether it arrived via "welcome",
    // "join", or a regular "snapshot".
    this.turret.setNetworkState(state.turret);

    // Vehicle/turret evolution stage is derived from the player's reported
    // level using the exact same mapping as the local player and the
    // server (see EvolutionConfig.js) -- never trusted as an independent
    // field, so there is nowhere for a remote player's visuals to disagree
    // with their actual level. The very first sample (covers a late
    // joiner's spawn, or this client's own reconnect) applies the current
    // stage instantly with no transformation replay; every stage change
    // after that plays the full animated sequence, same as the local
    // player, so other clients see it happen live (requirement: remote
    // evolution must animate too).
    // Level is the authoritative progression value replicated by the player.
    // Derive the visual stage from it on every snapshot. Only a real stage
    // transition triggers the transformation animation; normal movement
    // snapshots must never restart the animation.
    const rawLevel = Number.isFinite(state.level) ? state.level : 0;
    const evolutionStage = getEvolutionStage(rawLevel);
    const stageChanged = this.evolutionStage !== evolutionStage;
    const animate = this.evolutionStage !== null && stageChanged;

    if (stageChanged) {
      this.evolution.setStage(evolutionStage, { animate });
      this.turret.setEvolutionStage(evolutionStage, { animate });
      this.evolutionStage = evolutionStage;
    }

    // HP bar. Health is reported by each client for itself (see
    // MultiplayerClient.sendState) the same way position/steering/turret
    // state already are -- this game has no PvP damage between players, so
    // there is no separate server-authoritative combat value to defer to
    // here. Missing/invalid numbers simply leave the bar in its last known
    // (or initially hidden) state rather than drawing a wrong one.
    if (
      Number.isFinite(state.health) &&
      Number.isFinite(state.maxHealth) &&
      state.maxHealth > 0
    ) {
      this.healthBar.setRatio(state.health / state.maxHealth);
    }

    // Destroyed/wreck visuals -- mirrors the local player's
    // playerHealth.onDeath/onRespawn (see Game.js), driven here by the
    // networked `dead` flag instead of a local PlayerHealth instance.
    const isDead = state.dead === true;
    if (isDead && !this.wasDead) {
      this.destruction.activate();
    } else if (!isDead && this.wasDead) {
      this.destruction.deactivate();
    }
    this.wasDead = isDead;
  }

  // Called by MultiplayerClient when a `chat` message arrives for this
  // player's id. Kept separate from network parsing so RemoteVehicle
  // knows nothing about the wire format.
  showMessage(text) {
    this.chatBubble.show(text);
  }

  // Called once per physics tick by Game (via MultiplayerClient), just
  // before physics.step(). Copies the already-interpolated visual
  // transform (computed in update() below, on the render loop) onto the
  // kinematic collider. A frame of lag between the two loops is
  // imperceptible and far simpler than merging them.
  syncPhysics() {
    if (!this.body) return;

    this.body.position.set(
      this.root.position.x,
      this.root.position.y,
      this.root.position.z
    );

    this.body.quaternion.set(
      this.root.quaternion.x,
      this.root.quaternion.y,
      this.root.quaternion.z,
      this.root.quaternion.w
    );

    this.body.velocity.setZero();
    this.body.angularVelocity.setZero();
    this.body.aabbNeedsUpdate = true;
  }

  // camera is optional (billboards the HP bar and exhaust puffs toward it);
  // callers that don't pass one just skip that per-frame orientation update.
  update(now, dt, camera = null) {
    this.chatBubble.update(now);

    if (!this.samples.length) {
      // No network samples yet (e.g. the very first frame): still animate
      // the turret in place so it isn't stuck on a stale pose.
      this.turret.update(dt);
      this.evolution.update(dt);
      this.destruction.update(dt, camera);
      return;
    }

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

    // Runs after this.root's position/quaternion are updated above so the
    // turret's own world-matrix math (muzzle position for fire effects)
    // reflects this frame's vehicle transform.
    this.turret.update(dt);

    // this.root.matrixWorld must reflect the position set above; Three
    // only refreshes it during rendering, so ExhaustSystem.emit() (which
    // reads matrixWorld) works off a one-frame-stale transform. That lag
    // is imperceptible for a trailing exhaust puff.
    this.root.updateMatrixWorld();

    this.exhaust.update(dt, camera, {
      running: state.engineRunning === true,
      boosting: state.turbo === true
    });

    this.destruction.update(dt, camera);

    if (camera) {
      this.healthBar.updateTransform(this.root.position, camera);
    }
  }

  dispose() {
    this.chatBubble.dispose();
    this.turret.dispose();
    this.exhaust.dispose();
    this.destruction.dispose();
    this.healthBar.dispose();
    this.scene.remove(this.root);

    if (this.body) {
      this.physics?.removeBody(this.body);
      this.body = null;
    }

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
