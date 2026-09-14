# Cyberpunk Vehicle Redesign — What Changed

## Files touched
- **VehicleVisual.js** — full rewrite of the base body/interior/wheels.
- **VehicleEvolution.js** — full rewrite of the 5 armor stages + shared materials.
- **Vehicle.js** — small additive changes only (wires wheels into the evolution
  rig, exposes `currentEvolutionStage`, exposes the new console display).
- **ExhaustSystem.js** — additive only: turbo flame can now burn cyan-white at
  Elite/Ultimate stages. Turbo *gameplay* (TurboSystem.js) is untouched.
- Everything else (VehiclePhysics.js, VehicleDestruction.js, VehicleConfig.js,
  TurboSystem.js, ArcadeController.js, ManualController.js,
  ManualDrivetrain.js, VehicleFeedback.js, CollisionGroups.js) is **unchanged**.

## Base vehicle (Stage 0)
Wider, flared fender cladding; a skid-plated, angled front fascia; rugged
unpainted side cladding; a power-dome hood; a full-width rear light bar;
camera-pod mirrors; a roof sensor bump and roof rails; chunkier off-road
wheels with visible tread blocks. The cockpit got a hooded instrument
binnacle, a second small canvas-backed "status" display in the console,
physical button/switch greebles, and thin cyan ambient strips along the dash
and door tops — all inspired by, not copied from, your reference images.

## Evolution stages (VehicleEvolution.js)
Stages 1–2 are lightly retuned to match the wider stage-0 fenders. Stages
3–5 are the major rework:
- **Stage 3 (Heavy Combat):** exposed hydraulic struts bracing the plow,
  sensor pods on the side plating, a vented equipment collar on the roof.
- **Stage 4 (Elite):** this is where the cyan tech-emissive material family
  is introduced (`mat.techCyan` / `mat.warnRed`) as pinstripes and vent
  strips, plus a forward antenna pair with red status tips.
- **Stage 5 (Ultimate):** wide-body layered side armor with a full-length
  cyan energy strip, a full roof sensor/antenna array, a two-pillar rear
  wing with cyan underglow, an extended diffuser, a low cyan underbody rim
  strip, and a small additive-blended "holographic" flourish above the front
  sensor. Cyan/red materials gently pulse (wall-clock based, no per-instance
  state) once stage 4+ is reached.
- Stage 3+ also adds a spinning tech-accent ring to each wheel (tier 1,
  brighter + a hub cap, at stage 5), via an optional `wheels` argument now
  accepted by `VehicleEvolutionRig`.

## Integration status: DONE
Your `driveworld_vehicles.zip` upload included the three files this redesign
needed but didn't have access to before (`core/Game.js`,
`multiplayer/RemoteVehicle.js`, `camera/CameraManager.js` + friends). Both
integration points from the first pass are now wired up directly:

1. **RemoteVehicle.js** — `VehicleEvolutionRig` is now constructed with
   `this.wheels.map(w => w.tire)` (remote wheels are `{pivot, tire, front}`
   objects, not bare groups like the local vehicle's, so this maps to the
   actual wheel mesh group each accent ring attaches to). `pushState()` now
   also calls `this.exhaust.setEvolutionStage(evolutionStage)` and records
   `this.evolutionStage`, so remote turbo flames turn cyan-white on
   Elite/Ultimate cars exactly like the local player's.
2. **Game.js** — `this.exhaust.setEvolutionStage(...)` is now called
   alongside the existing `vehicle.setEvolutionStage(...)` /
   `turret.setEvolutionStage(...)` calls in both `onLevelUp` and the
   defensive re-apply in `onRespawn`.

I also checked `CameraManager.js` / `ThirdPersonCamera.js` /
`CameraObstacleAvoidance.js`: none of them hardcode body dimensions, they
only read `vehicle.driverEye` (position unchanged by this redesign) and
`vehicle.root`, so the wider fenders/rear wing/roof antenna at higher
evolution stages don't need any camera changes.

`gameplay/EvolutionConfig.js` and `turret/TurretMath.js` (imported by
VehicleEvolution.js/RemoteVehicle.js/Game.js) still weren't part of either
upload — they're evidently unrelated gameplay config/math modules elsewhere
in your repo, and nothing above needed to change them.

## Performance
No new THREE.Light objects, no per-frame geometry generation, no growth in
particle counts. All evolution-stage geometry still uses the same
shared-material-per-vehicle-instance pattern as before. The one new
per-frame cost is two material-property writes (`emissiveIntensity`) at
stage 4+, shared across every vehicle rather than per-instance.
