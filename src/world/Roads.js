import * as THREE from "three";

export function createRoads(scene, terrain) {
  const routes = [];

  function addRoute(points, width, surface, color) {
    const route = { points, width, surface };
    routes.push(route);

    const vertices = [];
    const indices = [];

    points.forEach((point, index) => {
      const previous = points[Math.max(0, index - 1)];
      const next = points[Math.min(points.length - 1, index + 1)];

      const dx = next.x - previous.x;
      const dz = next.z - previous.z;
      const length = Math.hypot(dx, dz) || 1;

      const nx = -dz / length;
      const nz = dx / length;

      for (const side of [-1, 1]) {
        const x = point.x + nx * width * 0.5 * side;
        const z = point.z + nz * width * 0.5 * side;

        vertices.push(x, terrain.heightAt(x, z) + 0.035, z);
      }

      if (index < points.length - 1) {
        const a = index * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(vertices, 3)
    );
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color,
        roughness: 1,
        side: THREE.DoubleSide
      })
    );

    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  const straight = [];
  for (let z = -90; z <= 90; z += 2) {
    straight.push({ x: 0, z });
  }

  addRoute(straight, 12, "asphalt", 0x353d44);

  const loop = [];
  for (let i = 0; i <= 160; i++) {
    const angle = i / 160 * Math.PI * 2;

    loop.push({
      x: Math.sin(angle) * 36,
      z: Math.cos(angle) * 70
    });
  }

  addRoute(loop, 8, "asphalt", 0x394148);

  const dirt = [];
  for (let i = 0; i <= 100; i++) {
    const t = i / 100;

    dirt.push({
      x: 35 + Math.sin(t * Math.PI) * 40,
      z: -65 + t * 130
    });
  }

  addRoute(dirt, 6, "dirt", 0xa5875c);

  // Flat test pad covering the existing spawn location.
  const pad = new THREE.Mesh(
    new THREE.PlaneGeometry(44, 34),
    new THREE.MeshStandardMaterial({
      color: 0x353d44,
      roughness: 1
    })
  );

  pad.rotation.x = -Math.PI / 2;
  pad.position.set(0, 0.04, -65);
  pad.receiveShadow = true;
  scene.add(pad);

  for (let z = -85; z <= 85; z += 10) {
    const stripe = new THREE.Mesh(
      new THREE.PlaneGeometry(0.15, 4),
      new THREE.MeshStandardMaterial({ color: 0xf0ead2 })
    );

    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(0, 0.06, z);
    scene.add(stripe);
  }

  function distanceToSegment(x, z, a, b) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lengthSquared = dx * dx + dz * dz;

    const t = lengthSquared === 0 ? 0 : THREE.MathUtils.clamp(
      ((x - a.x) * dx + (z - a.z) * dz) / lengthSquared,
      0,
      1
    );

    return Math.hypot(
      x - (a.x + t * dx),
      z - (a.z + t * dz)
    );
  }

  function surfaceAt(x, z) {
    if (Math.abs(x) <= 22 && Math.abs(z + 65) <= 17) {
      return "asphalt";
    }

    // Later-painted routes win where surface ribbons overlap.
    for (let r = routes.length - 1; r >= 0; r--) {
      const route = routes[r];

      for (let i = 0; i < route.points.length - 1; i++) {
        if (
          distanceToSegment(
            x, z, route.points[i], route.points[i + 1]
          ) <= route.width / 2
        ) {
          return route.surface;
        }
      }
    }

    return "grass";
  }

  terrain.body.surfaceAt = point => surfaceAt(point.x, point.z);

  return { surfaceAt };
}