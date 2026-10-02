// QA: headless cannon-es comparison of Light vs Heavy handling.
// Run: node tools/qa/handling-sim.mjs
import * as CANNON from "cannon-es";
import { VehiclePhysics } from "../../src/vehicle/VehiclePhysics.js";
import { ArcadeController } from "../../src/vehicle/ArcadeController.js";
import { VEHICLE_CLASSES } from "../../src/vehicle/VehicleConfig.js";

const DT = 1 / 60;
function setup(cls) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.solver.iterations = 10;
  const ground = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(2000, 1, 2000)) });
  ground.position.set(0, -1, 0);
  ground.surface = "asphalt";
  world.addBody(ground);
  const vp = new VehiclePhysics(world, cls.handling);
  vp.setVehicleTransform?.(0, 1.5, 0, 0);
  const ctl = new ArcadeController(cls.handling);
  for (let i = 0; i < 90; i++) world.step(DT);
  return { world, vp, ctl };
}
const speed = vp => vp.body.velocity.length() * 3.6;
function run(id) {
  const cls = VEHICLE_CLASSES[id];
  let { world, vp, ctl } = setup(cls);
  const step = input => { const c = ctl.update(input, vp.body.velocity.dot?.(vp.body.quaternion.vmult(new CANNON.Vec3(0,0,1))) ?? 0, DT); vp.applyControls(c); world.step(DT); };
  let t = 0, t60 = null;
  const full = { throttle: 1, brake: 0, steering: 0, handbrake: 0 };
  while (t < 10) { step(full); t += DT; if (t60 === null && speed(vp) >= 60) t60 = t; }
  const top = speed(vp);
  // braking from 80 km/h to 5 km/h
  ({ world, vp, ctl } = setup(cls));
  t = 0; while (speed(vp) < 80 && t < 30) { step(full); t += DT; }
  const p0 = vp.body.position.clone(); let bt = 0;
  while (speed(vp) > 5 && bt < 20) { step({ throttle: 0, brake: 1, steering: 0, handbrake: 0 }); bt += DT; }
  const brakeDist = vp.body.position.distanceTo(p0);
  // turning circle at ~40 km/h
  ({ world, vp, ctl } = setup(cls));
  t = 0; while (speed(vp) < 40 && t < 20) { step(full); t += DT; }
  const xs = [], zs = [];
  for (let i = 0; i < 60 * 8; i++) { step({ throttle: 0.35, brake: 0, steering: 1, handbrake: 0 }); xs.push(vp.body.position.x); zs.push(vp.body.position.z); }
  const diam = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
  return { id, t0to60: t60?.toFixed(2), kmhAt10s: top.toFixed(1), brakeTime: bt.toFixed(2), brakeDist: brakeDist.toFixed(1), turnDiameter: diam.toFixed(1) };
}
console.table([run("light"), run("heavy")]);
