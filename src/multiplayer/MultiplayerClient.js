import * as THREE from "three";
import { RemoteVehicle } from "./RemoteVehicle.js";
import { ChatBubble } from "./ChatBubble.js";

// Clearance above the local car's roofline. The local vehicle has no
// nameplate sprite (the driver doesn't need to read their own name), so
// this sits directly above the bodywork instead of above a label.
const LOCAL_BUBBLE_ANCHOR_Y = 1.85;

export class MultiplayerClient {
  constructor(game, playerName = "") {
    this.game = game;
    this.playerName = playerName;
    this.chatPanel = null;

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

    this.localBubble = new ChatBubble(
      this.game.vehicle.root,
      LOCAL_BUBBLE_ANCHOR_Y
    );

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
    this.details.textContent = "Remote cars are solid but simulated locally.";

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

    this.leaderboardHeading = document.createElement("strong");
    this.leaderboardHeading.textContent = "Delivery leaderboard";
    this.leaderboardHeading.style.display = "block";
    this.leaderboardHeading.style.marginTop = "0.6rem";

    this.leaderboardList = document.createElement("ol");
    Object.assign(this.leaderboardList.style, {
      margin: "0.3rem 0 0",
      paddingLeft: "1.1rem"
    });

    this.leaderboardEmpty = document.createElement("small");
    this.leaderboardEmpty.textContent = "No deliveries yet this session.";

    this.panel.append(
      this.status,
      this.count,
      this.details,
      this.button,
      this.leaderboardHeading,
      this.leaderboardList,
      this.leaderboardEmpty
    );

    document.body.append(this.panel);
    this.updateCount();
    this.updateLeaderboard([]);
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

    if (this.playerName) {
      url.searchParams.set("name", this.playerName);
    }

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
        `ONLINE · ${message.self.name}`;

      this.updateCount();
      this.updateLeaderboard(message.leaderboard ?? []);
      this.chatPanel?.addSystemMessage(`You joined as ${message.self.name}.`);
      return;
    }

    if (message.type === "join") {
      this.addPlayer(message.player);
      this.chatPanel?.addSystemMessage(`${message.player.name} joined the game.`);
      return;
    }

    if (message.type === "leave") {
      const remote = this.remotes.get(message.id);

      if (remote) {
        this.chatPanel?.addSystemMessage(`${remote.name} left the game.`);
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

    if (message.type === "leaderboard") {
      this.updateLeaderboard(message.entries ?? []);
      return;
    }

    if (message.type === "chat") {
      const isLocal = message.playerId === this.selfId;

      this.chatPanel?.addChatMessage(message, isLocal);

      if (isLocal) {
        this.localBubble.show(message.message);
      } else {
        this.remotes.get(message.playerId)?.showMessage(message.message);
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
      new RemoteVehicle(this.game.scene, player, this.game.physics)
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

  reportDelivery() {
    if (
      !this.running ||
      !this.selfId ||
      this.socket?.readyState !== WebSocket.OPEN
    ) {
      return;
    }

    this.socket.send(JSON.stringify({ type: "delivery" }));
  }

  updateLeaderboard(entries) {
    this.leaderboardList.innerHTML = "";

    for (const entry of entries) {
      const item = document.createElement("li");
      item.textContent = `${entry.name} — ${entry.deliveries} deliveries`;
      this.leaderboardList.append(item);
    }

    const hasEntries = entries.length > 0;
    this.leaderboardList.hidden = !hasEntries;
    this.leaderboardEmpty.hidden = hasEntries;
  }

  sendChat(text) {
    if (
      !this.running ||
      !this.selfId ||
      this.socket?.readyState !== WebSocket.OPEN
    ) {
      return false;
    }

    const trimmed = typeof text === "string" ? text.trim() : "";

    if (!trimmed) return false;

    this.socket.send(JSON.stringify({
      type: "chat",
      message: trimmed.slice(0, 200)
    }));

    return true;
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

    this.localBubble.update(now);

    this.animationId = requestAnimationFrame(this.animate);
  }

  // Called by Game once per physics tick, right before physics.step(), so
  // every remote's collider sits where it's currently being drawn.
  syncPhysics() {
    for (const remote of this.remotes.values()) {
      remote.syncPhysics();
    }
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
    this.localBubble.dispose();
    this.panel.remove();
  }
}