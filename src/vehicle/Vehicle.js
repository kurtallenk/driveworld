import * as THREE from "three";
import { VehicleEvolutionRig } from "./VehicleEvolution.js";
import {
  buildVehicleBody,
  buildWheelGeometries,
  createWheel
} from "./VehicleVisual.js";
import { DEFAULT_VEHICLE_TYPE } from "./VehicleConfig.js";

// ---------------------------------------------------------------------------
// Vehicle
// ---------------------------------------------------------------------------
// Local player: driving physics/control/state. All body/interior/wheel
// geometry and materials come from the shared VehicleVisual.js so the local
// vehicle and every RemoteVehicle.js render identically -- see that file for
// the actual construction code.

export class Vehicle {
  constructor(scene, physics, color, vehicleType = DEFAULT_VEHICLE_TYPE) {
    this.physics = physics;
    this.root = new THREE.Group();
    scene.add(this.root);

    const {
      mat,
      exhaustPoints,
      driverEye,
      steeringWheel,
      dashboardCanvas,
      dashboardContext,
      dashboardTexture
    } = buildVehicleBody(this.root, color, vehicleType);

    this.exhaustPoints = exhaustPoints;
    this.driverEye = driverEye;
    this.steeringWheel = steeringWheel;
    this.dashboardCanvas = dashboardCanvas;
    this.dashboardContext = dashboardContext;
    this.dashboardTexture = dashboardTexture;
    this.lastDashboardUpdate = -Infinity;

    // ---- Wheels -------------------------------------------------------------
    // Visible wheels continue to follow the existing physics transforms;
    // only the visual construction (now in VehicleVisual.js) changed.
    const wheelGeo = buildWheelGeometries();

    this.wheels = Array.from({ length: 4 }, (_, index) => {
      const inboardSign = index % 2 === 0 ? 1 : -1;
      const wheel = createWheel(wheelGeo, mat, inboardSign);
      scene.add(wheel);
      return wheel;
    });

    // ---- Armor evolution (level-based visual progression) -----------------
    this.evolution = new VehicleEvolutionRig(this.root);

    this.sync();
  }

  // Called by Game.js's levelSystem.onLevelUp handler (via
  // getVehicleEvolutionStage). `animate: false` restores a previously
  // reached stage instantly (e.g. right after respawn) instead of replaying
  // the transformation.
  setEvolutionStage(stage, { animate = true } = {}) {
    this.evolution.setStage(stage, { animate });
  }

  update(dt) {
    this.evolution.update(dt);
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
