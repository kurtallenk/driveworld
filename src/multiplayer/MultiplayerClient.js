import * as THREE from "three";
import { RemoteVehicle } from "./RemoteVehicle.js";

export class MultiplayerClient {
  constructor(game) {
    this.game = game;

    this.socket = null;
    this.selfId = null;
    this.sequence = 0;
    this.remotes = new Map();

    this.running = true;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;

    this.lastRenderTime = performance.now();
    this.animationId = null;

    this.createStatusPanel();
    this.collectPaintMaterials();

    this.connect();

    // Networking is deliberately much slower than rendering.
    this.sendTimer = setInterval(() => this.sendState(), 50);

    this.animate = this.animate.bind(this);
    this.animationId = requestAnimationFrame(this.animate);
  }

  createStatusPanel() {
    this.panel = document.createElement("section");

    Object.assign(this.panel.style, {
      position: "fixed",
      left: "1rem",
      top: "5rem",
      zIndex: "4",
      maxWidth: "280px",
      padding: "0.75rem",
      borderRadius: "0.6rem",
      border: "1px solid #ffffff24",
      background: "#0c1623df",
      fontSize: "0.8rem",
      lineHeight: "1.5"
    });

    this.status = document.createElement("div");
    this.count = document.createElement("div");
    this.details = document.createElement("small");
    this.details.textContent = "Remote cars are non-colliding.";

    this.button = document.createElement("button");
    this.button.textContent = "Disconnect multiplayer";
    this.button.style.marginTop = "0.5rem";
    this.button.style.padding = "0.4rem 0.65rem";
    this.button.style.fontSize = "0.75rem";

    this.button.addEventListener("click", () => {
      if (this.running) {
        this.running = false;
        clearTimeout(this.reconnectTimer);

        this.socket?.close(1000, "Player disconnected");
        this.selfId = null;
        this.clearRemotes();

        this.status.textContent = "Offline — local driving available";
        this.button.textContent = "Connect multiplayer";
      } else {
        this.running = true;
        this.reconnectAttempts = 0;
        this.button.textContent = "Disconnect multiplayer";
        this.connect();
      }
    });

    this.panel.append(
      this.status,
      this.count,
      this.details,
      this.button
    );

    document.body.append(this.panel);
    this.updateCount();
  }

  collectPaintMaterials() {
    const originalColor = new THREE.Color(
      this.game.player.vehicleColor
    ).getHex();

    this.paintMaterials = new Set();

    this.game.vehicle.root.traverse(object => {
      const materials = Array.isArray(object.material)
        ? object.material
        : object.material
          ? [object.material]
          : [];

      for (const material of materials) {
        if (material.color?.getHex() === originalColor) {
          this.paintMaterials.add(material);
        }
      }
    });
  }

  connect() {
    if (!this.running) return;

    if (
      this.socket &&
      (
        this.socket.readyState === WebSocket.CONNECTING ||
        this.socket.readyState === WebSocket.OPEN
      )
    ) {
      return;
    }

    const url = new URL("/multiplayer", window.location.href);
    url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";

    this.status.textContent = "Connecting to multiplayer…";

    const socket = new WebSocket(url);
    this.socket = socket;

    socket.addEventListener("message", event => {
      if (this.socket !== socket || !this.running) return;

      let message;

      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      this.handleMessage(message);
    });

    socket.addEventListener("error", () => {
      if (this.running) {
        this.status.textContent =
          "Connection unavailable. Is the multiplayer server running?";
      }
    });

    socket.addEventListener("close", event => {
      if (this.socket !== socket) return;

      this.selfId = null;
      this.clearRemotes();

      if (!this.running) return;

      if (event.code === 4001) {
        this.running = false;
        this.status.textContent = "Session full — try connecting later";
        this.button.textContent = "Connect multiplayer";
        return;
      }

      this.scheduleReconnect();
    });
  }

  scheduleReconnect() {
    clearTimeout(this.reconnectTimer);

    const delay = Math.min(
      10000,
      1000 * 2 ** this.reconnectAttempts
    );

    this.reconnectAttempts++;

    this.status.textContent =
      `Disconnected. Retrying in ${Math.round(delay / 1000)}s…`;

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  handleMessage(message) {
    if (message.type === "welcome") {
      if (message.protocol !== 1) {
        this.running = false;
        this.socket.close(1000, "Protocol mismatch");
        this.status.textContent = "Client/server version mismatch";
        this.button.textContent = "Connect multiplayer";
        return;
      }

      this.clearRemotes();
      this.selfId = message.self.id;
      this.sequence = 0;
      this.reconnectAttempts = 0;

      this.applyAssignment(message.self);

      for (const player of message.players) {
        this.addPlayer(player);
      }

      this.status.textContent =
        `ONLINE · Driver ${this.selfId.slice(0, 6)}`;

      this.updateCount();
      return;
    }

    if (message.type === "join") {
      this.addPlayer(message.player);
      return;
    }

    if (message.type === "leave") {
      const remote = this.remotes.get(message.id);

      if (remote) {
        remote.dispose();
        this.remotes.delete(message.id);
      }

      this.updateCount();
      return;
    }

    if (message.type === "snapshot") {
      const now = performance.now();

      for (const player of message.players) {
        this.remotes.get(player.id)?.pushState(player.state, now);
      }

      return;
    }

    if (message.type === "error") {
      this.status.textContent = message.message;
    }
  }

  applyAssignment(player) {
    const game = this.game;

    game.player.playerId = player.id;
    game.player.vehicleId = `vehicle-${player.id}`;
    game.player.vehicleColor = player.color;

    for (const material of this.paintMaterials) {
      material.color.set(player.color);
    }

    // A new network connection creates a fresh spawn.
    // Reconnection does not yet restore an earlier session position.
    game.vehiclePhysics.reset();

    game.vehiclePhysics.body.position.set(...player.spawn.position);
    game.vehiclePhysics.body.quaternion.set(...player.spawn.rotation);
    game.vehiclePhysics.body.aabbNeedsUpdate = true;
    game.vehiclePhysics.body.wakeUp();

    game.controller.reset();
    game.manualController.reset();
    game.vehicleFeedback?.reset();

    game.engineStartRequested = false;
    game.accumulator = 0;

    game.input.keys.clear();
    game.input.resetRequested = false;
    game.input.disarm();

    game.cameraRig.reset();
    game.vehicle.sync();
  }

  addPlayer(player) {
    if (
      !player ||
      player.id === this.selfId ||
      this.remotes.has(player.id)
    ) {
      return;
    }

    this.remotes.set(
      player.id,
      new RemoteVehicle(this.game.scene, player)
    );

    this.updateCount();
  }

  sendState() {
    if (
      !this.running ||
      !this.selfId ||
      this.socket?.readyState !== WebSocket.OPEN ||
      this.socket.bufferedAmount > 64 * 1024
    ) {
      return;
    }

    const game = this.game;
    const snapshot = game.vehiclePhysics.snapshot();

    const paused =
      game.menu?.isOpen === true ||
      document.hidden;

    // Reading input here is safe: commands are still applied only by Game.
    // Avoid input sampling while the game is paused.
    const input = paused
      ? {
          steering: 0,
          throttle: 0,
          brake: 0,
          clutch: 0
        }
      : game.input.sample();

    const manual = game.drivingMode === "manual";
    const drivetrain = game.manualController.drivetrain;

    this.socket.send(JSON.stringify({
      type: "state",
      sequence: this.sequence++,
      state: {
        position: snapshot.position,
        rotation: snapshot.rotation,
        velocity: paused ? [0, 0, 0] : snapshot.velocity,

        steering: input.steering,
        throttle: input.throttle,
        brake: input.brake,
        clutch: input.clutch,

        gear: manual
          ? drivetrain.engagedGear
          : game.controller.direction,

        rpm: manual ? drivetrain.rpm : 0,
        engineRunning: manual ? drivetrain.engineRunning : true,
        mode: game.drivingMode,
        paused
      }
    }));
  }

  animate(now) {
    const dt = Math.min(
      Math.max((now - this.lastRenderTime) / 1000, 0),
      0.1
    );

    this.lastRenderTime = now;

    for (const remote of this.remotes.values()) {
      remote.update(now, dt);
    }

    this.animationId = requestAnimationFrame(this.animate);
  }

  updateCount() {
    this.count.textContent =
      `Players: ${this.remotes.size + (this.selfId ? 1 : 0)} / 8`;
  }

  clearRemotes() {
    for (const remote of this.remotes.values()) {
      remote.dispose();
    }

    this.remotes.clear();
    this.updateCount();
  }

  dispose() {
    this.running = false;

    clearTimeout(this.reconnectTimer);
    clearInterval(this.sendTimer);
    cancelAnimationFrame(this.animationId);

    this.socket?.close(1000, "Game closed");
    this.clearRemotes();
    this.panel.remove();
  }
}