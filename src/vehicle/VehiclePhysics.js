import * as CANNON from "cannon-es";
import {
  COLLISION_GROUPS,
  VEHICLE_CANNON_MATERIAL,
  VEHICLE_VEHICLE_CONTACT
} from "./CollisionGroups.js";

export class VehiclePhysics {
  constructor(world) {
    this.body = new CANNON.Body({
      mass: 1050,
      linearDamping: 0.025,
      angularDamping: 0.35,
      material: VEHICLE_CANNON_MATERIAL
    });

    // The collider sits above the center of mass for prototype stability.
    this.body.addShape(
      new CANNON.Box(new CANNON.Vec3(0.9, 0.3, 2)),
      new CANNON.Vec3(0, 0.15, 0)
    );

    // Collide with the static world (terrain/buildings/trees/etc, all left
    // at cannon-es's default group) and with other players' remote proxy
    // bodies. See CollisionGroups.js for why this needs its own group
    // rather than the default "collide with everything" mask.
    this.body.collisionFilterGroup = COLLISION_GROUPS.VEHICLE;
    this.body.collisionFilterMask =
      COLLISION_GROUPS.WORLD | COLLISION_GROUPS.REMOTE;

    this.vehicle = new CANNON.RaycastVehicle({
      chassisBody: this.body,
      indexRightAxis: 0,
      indexUpAxis: 1,
      indexForwardAxis: 2
    });

    for (const [x, z, isFrontWheel] of [
      [-0.95, 1.35, true],
      [0.95, 1.35, true],
      [-0.95, -1.35, false],
      [0.95, -1.35, false]
    ]) {
      this.vehicle.addWheel({
        radius: 0.36,
        directionLocal: new CANNON.Vec3(0, -1, 0),
        axleLocal: new CANNON.Vec3(-1, 0, 0),
        chassisConnectionPointLocal: new CANNON.Vec3(x, 0, z),
        suspensionRestLength: 0.35,
        suspensionStiffness: 35,
        dampingRelaxation: 2.3,
        dampingCompression: 4.4,
        maxSuspensionForce: 50000,
        maxSuspensionTravel: 0.25,
        frictionSlip: 3.2,
        rollInfluence: 0.06,
        customSlidingRotationalSpeed: -30,
        useCustomSlidingRotationalSpeed: true,
        isFrontWheel
      });
    }

    this.vehicle.addToWorld(world);

    // Only one local vehicle ever exists, but guard anyway in case a
    // future scene reload constructs a second one against the same world.
    if (!world.contactmaterials.includes(VEHICLE_VEHICLE_CONTACT)) {
      world.addContactMaterial(VEHICLE_VEHICLE_CONTACT);
    }

    this.forward = new CANNON.Vec3();
    this.reset();
  }

  get signedSpeed() {
    this.body.vectorToWorldFrame(new CANNON.Vec3(0, 0, 1), this.forward);
    return this.body.velocity.dot(this.forward);
  }

  applyControls(control) {
  // Arcade supplies normalized drive.
  // Manual supplies an actual per-driven-wheel force in newtons.
  const driveForcePerWheel =
    Number.isFinite(control.driveForcePerWheel)
      ? control.driveForcePerWheel
      : control.drive * 1800;

  for (let i = 0; i < 4; i++) {
    const wheel = this.vehicle.wheelInfos[i];
    const contactBody = wheel.raycastResult.body;

const surface = contactBody?.surfaceAt
  ? contactBody.surfaceAt(wheel.raycastResult.hitPointWorld)
  : contactBody?.surface ?? "grass";

    wheel.frictionSlip =
      surface === "asphalt"
        ? 3.2
        : surface === "dirt"
          ? 1.8
          : 1.35;

    // Keep the sign conversion verified in your previous tests.
    this.vehicle.setSteeringValue(
      i < 2 ? -control.steeringAngle : 0,
      i
    );

    this.vehicle.applyEngineForce(
      i >= 2 ? -driveForcePerWheel : 0,
      i
    );

    this.vehicle.setBrake(
      control.brake * 35 +
        (i >= 2 ? control.handbrake * 65 : 0),
      i
    );
  }
}

  reset() {
    this.body.position.set(-3, 1.2, -65);
    this.body.quaternion.set(0, 0, 0, 1);
    this.body.velocity.setZero();
    this.body.angularVelocity.setZero();
    this.body.force.setZero();
    this.body.torque.setZero();
    this.body.aabbNeedsUpdate = true;
    this.body.wakeUp();

    for (const wheel of this.vehicle.wheelInfos) {
      wheel.rotation = 0;
      wheel.deltaRotation = 0;
      wheel.engineForce = 0;
      wheel.brake = 0;
      wheel.steering = 0;
      wheel.raycastResult.reset();
    }
  }

  snapshot() {
    const b = this.body;
    return {
      position: [b.position.x, b.position.y, b.position.z],
      rotation: [
        b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w
      ],
      velocity: [b.velocity.x, b.velocity.y, b.velocity.z],
      angularVelocity: [
        b.angularVelocity.x, b.angularVelocity.y, b.angularVelocity.z
      ]
    };
  }
}