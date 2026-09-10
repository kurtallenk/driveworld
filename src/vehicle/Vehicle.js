import * as THREE from "three";

export class Vehicle {
  constructor(scene, physics, color) {
    this.physics = physics;
    this.root = new THREE.Group();
    scene.add(this.root);

    const paint = new THREE.MeshStandardMaterial({
      color,
      metalness: 0.45,
      roughness: 0.32
    });

    const dark = new THREE.MeshStandardMaterial({
      color: 0x171d25,
      roughness: 0.85
    });

    const trim = new THREE.MeshStandardMaterial({
      color: 0x333e49,
      metalness: 0.35,
      roughness: 0.5
    });

    const seatMaterial = new THREE.MeshStandardMaterial({
      color: 0x343b45,
      roughness: 1
    });

    const glass = new THREE.MeshStandardMaterial({
      color: 0xb1dbed,
      transparent: true,
      opacity: 0.12,
      roughness: 0.1,
      metalness: 0,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    const lamp = new THREE.MeshStandardMaterial({
      color: 0xfff5d3,
      emissive: 0xffe8b0,
      emissiveIntensity: 0.6
    });

    const tailLamp = new THREE.MeshStandardMaterial({
      color: 0xb61925,
      emissive: 0xff1420,
      emissiveIntensity: 0.3
    });

    const box = (size, position, material, parent = this.root) => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(...size),
        material
      );

      mesh.position.set(...position);
      mesh.castShadow = !material.transparent;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };

    // +Z = front, +Y = up. Chassis origin remains unchanged.
    box([1.8, 0.38, 4], [0, 0.05, 0], paint);
    box([1.7, 0.12, 2.1], [0, 0.3, -0.1], dark);

    // Hood, trunk, bumpers and grille.
    box([1.76, 0.22, 1.12], [0, 0.34, 1.36], paint);
    box([1.76, 0.22, 0.65], [0, 0.34, -1.62], paint);
    box([1.86, 0.18, 0.16], [0, -0.04, 2.02], trim);
    box([1.86, 0.18, 0.16], [0, -0.04, -2.02], trim);
    box([0.78, 0.18, 0.03], [0, 0.14, 2.09], dark);

    for (const x of [-0.63, 0.63]) {
      box([0.4, 0.15, 0.045], [x, 0.29, 1.94], lamp);
      box([0.4, 0.15, 0.045], [x, 0.29, -1.96], tailLamp);
    }

    // Doors, sills and interior panels.
    for (const side of [-1, 1]) {
      box([0.1, 0.38, 2.05], [side * 0.86, 0.43, -0.15], paint);
      box([0.055, 0.28, 1.85], [side * 0.795, 0.45, -0.15], dark);
      box([0.12, 0.1, 2.2], [side * 0.9, 0.04, -0.12], trim);
      box([0.04, 0.04, 0.2], [side * 0.925, 0.57, -0.35], trim);

      // Roof pillars. The gaps between them remain windows.
      box([0.07, 0.7, 0.08], [side * 0.77, 0.93, 0.83], paint);
      box([0.07, 0.7, 0.08], [side * 0.77, 0.93, -0.3], paint);
      box([0.07, 0.7, 0.08], [side * 0.77, 0.93, -1.15], paint);

      // Side mirror housings with non-reflecting placeholder faces.
      box([0.2, 0.12, 0.24], [side * 1.0, 0.74, 0.7], paint);
      box([0.16, 0.085, 0.015], [side * 1.0, 0.74, 0.575], trim);
    }

    box([1.66, 0.1, 2.16], [0, 1.3, -0.16], paint);
    box([1.45, 0.59, 0.015], [0, 0.96, 0.87], glass);
    box([1.45, 0.59, 0.015], [0, 0.96, -1.2], glass);

    // Front seats.
    for (const x of [-0.43, 0.43]) {
      box([0.57, 0.15, 0.57], [x, 0.43, -0.28], seatMaterial);
      box([0.57, 0.56, 0.14], [x, 0.72, -0.55], seatMaterial);
      box([0.29, 0.19, 0.13], [x, 1.07, -0.55], seatMaterial);
    }

    box([1.37, 0.17, 0.45], [0, 0.45, -0.94], seatMaterial);

    // Dashboard and center console.
    box([1.48, 0.18, 0.32], [0, 0.68, 0.74], dark);
    box([0.2, 0.25, 0.72], [0, 0.4, -0.03], trim);
    box([0.025, 0.2, 0.025], [0, 0.62, 0.04], trim);

    const knob = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 12, 8),
      dark
    );
    knob.position.set(0, 0.74, 0.04);
    this.root.add(knob);

    // Driver anchor belongs to the vehicle, so a GLB can replace it later.
    this.driverEye = new THREE.Object3D();
    // Vehicle-local +X is the driver's left when looking along +Z.
this.driverEye.position.set(0.43, 1.04, -0.08);
    this.root.add(this.driverEye);

    // Steering wheel faces toward the driver, who looks along +Z.
    this.steeringWheel = new THREE.Group();
    this.steeringWheel.position.set(0.43, 0.78, 0.47);
    this.root.add(this.steeringWheel);

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.19, 0.022, 8, 32),
      dark
    );
    this.steeringWheel.add(rim);

    box([0.34, 0.035, 0.025], [0, 0, 0], trim, this.steeringWheel);
    box([0.035, 0.16, 0.025], [0, -0.08, 0], trim, this.steeringWheel);
    box([0.085, 0.065, 0.04], [0, 0, -0.01], dark, this.steeringWheel);

    // Canvas-backed dashboard display.
    this.dashboardCanvas = document.createElement("canvas");
    this.dashboardCanvas.width = 512;
    this.dashboardCanvas.height = 192;
    this.dashboardContext = this.dashboardCanvas.getContext("2d");
    this.dashboardTexture = new THREE.CanvasTexture(this.dashboardCanvas);
    this.dashboardTexture.colorSpace = THREE.SRGBColorSpace;

    const display = new THREE.Mesh(
      new THREE.PlaneGeometry(0.45, 0.17),
      new THREE.MeshBasicMaterial({
        map: this.dashboardTexture,
        side: THREE.DoubleSide
      })
    );

    display.position.set(0.43, 0.82, 0.65);
    display.rotation.y = Math.PI;
    this.root.add(display);

    this.lastDashboardUpdate = -Infinity;

    // Visible wheels continue to follow the existing physics transforms.
    const wheelGeometry = new THREE.CylinderGeometry(
      0.36, 0.36, 0.25, 20
    );
    wheelGeometry.rotateZ(Math.PI / 2);

    const hubGeometry = new THREE.CylinderGeometry(
      0.21, 0.21, 0.265, 12
    );
    hubGeometry.rotateZ(Math.PI / 2);

    this.wheels = Array.from({ length: 4 }, () => {
      const wheel = new THREE.Mesh(wheelGeometry, dark);
      wheel.castShadow = true;

      const hub = new THREE.Mesh(hubGeometry, trim);
      wheel.add(hub);

      const marker = new THREE.Mesh(
        new THREE.BoxGeometry(0.275, 0.035, 0.09),
        lamp
      );
      marker.position.y = 0.2;
      wheel.add(marker);

      scene.add(wheel);
      return wheel;
    });

    this.sync();
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