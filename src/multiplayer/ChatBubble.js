import * as THREE from "three";

// Keeps bubbles legible without letting a long message balloon into a
// screen-filling shape. The server already caps messages at 200 chars;
// this is a tighter, presentation-only limit.
const MAX_CHARS = 140;
const MAX_LINES = 4;

const FONT_PX = 34;
const LINE_HEIGHT_PX = 40;
const PAD_X_PX = 26;
const PAD_TOP_PX = 22;
const PAD_BOTTOM_PX = 22;
const TAIL_PX = 16;
const MIN_TEXT_WIDTH_PX = 60;
const MAX_TEXT_WIDTH_PX = 420;

// Matches the pixel-to-world-unit density already used for the remote
// player nameplate sprite (512x96 canvas at a 2.8 x 0.525 world scale),
// so bubbles and name tags read at a consistent size.
const PX_PER_UNIT = 512 / 2.8;

const HOLD_MS = 5000;
const FADE_MS = 220;

function wrapAll(context, text, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";

  const pushHardBreak = word => {
    let broken = "";

    for (const char of word) {
      const attempt = broken + char;

      if (broken && context.measureText(attempt).width > maxWidth) {
        lines.push(broken);
        broken = char;
      } else {
        broken = attempt;
      }
    }

    return broken;
  };

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;

    if (context.measureText(candidate).width <= maxWidth) {
      line = candidate;
      continue;
    }

    if (!line) {
      line = pushHardBreak(word);
      continue;
    }

    lines.push(line);
    line = context.measureText(word).width <= maxWidth
      ? word
      : pushHardBreak(word);
  }

  if (line) lines.push(line);

  return lines;
}

function truncate(context, lines, maxLines, maxWidth) {
  if (lines.length <= maxLines) return lines;

  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];

  while (last.length > 0 && context.measureText(`${last}…`).width > maxWidth) {
    last = last.slice(0, -1);
  }

  kept[maxLines - 1] = `${last.trimEnd()}…`;
  return kept;
}

function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

// A single billboard speech bubble attached to a vehicle's local origin.
// Reused across messages (the canvas is redrawn, not recreated) so a busy
// chat never allocates a new texture per line.
export class ChatBubble {
  constructor(parent, anchorY) {
    this.parent = parent;
    this.anchorY = anchorY;

    this.canvas = document.createElement("canvas");
    this.canvas.width = 2;
    this.canvas.height = 2;
    this.context = this.canvas.getContext("2d");

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;

    // The canvas is resized on every message (see draw()). Mipmapping a
    // texture that keeps changing size/aspect ratio is what caused every
    // message after the first to render garbled — the GPU was reusing
    // stale mip levels from the previous bubble's dimensions. This is a
    // flat billboard sprite, so mipmaps buy nothing anyway; turn them off.
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    this.material = new THREE.SpriteMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
      opacity: 0
    });

    this.sprite = new THREE.Sprite(this.material);
    this.sprite.visible = false;
    this.sprite.renderOrder = 10;
    parent.add(this.sprite);

    this.state = "hidden";
    this.fadeInStart = 0;
    this.hideAt = 0;
    this.disposed = false;
  }

  show(rawText) {
    if (this.disposed) return;

    const text = String(rawText ?? "").trim().slice(0, MAX_CHARS);
    if (!text) return;

    this.draw(text);

    const now = performance.now();
    this.fadeInStart = now;
    this.hideAt = now + HOLD_MS;
    this.state = "visible";
    this.sprite.visible = true;
  }

  draw(text) {
    const context = this.context;
    context.font = `600 ${FONT_PX}px system-ui, -apple-system, sans-serif`;

    const rawLines = wrapAll(context, text, MAX_TEXT_WIDTH_PX);
    const lines = truncate(context, rawLines, MAX_LINES, MAX_TEXT_WIDTH_PX);

    let textWidth = MIN_TEXT_WIDTH_PX;
    for (const line of lines) {
      textWidth = Math.max(textWidth, context.measureText(line).width);
    }
    textWidth = Math.min(textWidth, MAX_TEXT_WIDTH_PX);

    const bubbleWidth = Math.ceil(textWidth + PAD_X_PX * 2);
    const textBlockHeight = lines.length * LINE_HEIGHT_PX;
    const bubbleHeight = Math.ceil(
      PAD_TOP_PX + textBlockHeight + PAD_BOTTOM_PX
    );

    this.canvas.width = bubbleWidth;
    this.canvas.height = bubbleHeight + TAIL_PX;

    // Resizing the canvas clears it and resets the font, so re-apply.
    context.font = `600 ${FONT_PX}px system-ui, -apple-system, sans-serif`;
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);

    context.fillStyle = "rgba(9, 17, 27, 0.82)";
    context.strokeStyle = "rgba(255, 255, 255, 0.22)";
    context.lineWidth = 2;

    roundedRect(context, 1, 1, bubbleWidth - 2, bubbleHeight - 2, 18);
    context.fill();
    context.stroke();

    // Speech-bubble pointer toward the vehicle below.
    context.beginPath();
    context.moveTo(bubbleWidth / 2 - 12, bubbleHeight - 2);
    context.lineTo(bubbleWidth / 2 + 12, bubbleHeight - 2);
    context.lineTo(bubbleWidth / 2, bubbleHeight - 2 + TAIL_PX);
    context.closePath();
    context.fillStyle = "rgba(9, 17, 27, 0.82)";
    context.fill();

    context.fillStyle = "#f2f8ff";
    context.textAlign = "center";
    context.textBaseline = "alphabetic";

    lines.forEach((line, index) => {
      const y = PAD_TOP_PX + (index + 1) * LINE_HEIGHT_PX - 10;
      context.fillText(line, bubbleWidth / 2, y);
    });

    this.texture.needsUpdate = true;

    const worldWidth = this.canvas.width / PX_PER_UNIT;
    const worldHeight = this.canvas.height / PX_PER_UNIT;

    this.sprite.scale.set(worldWidth, worldHeight, 1);

    // Anchor the sprite at the tip of the speech-bubble tail (the very
    // bottom row of the canvas) rather than its geometric center, so the
    // tail always points at `anchorY` regardless of how tall the bubble
    // grows with longer, wrapped messages.
    this.sprite.center.set(0.5, 0);
    this.sprite.position.set(0, this.anchorY, 0);
  }

  update(now) {
    if (this.state === "hidden" || this.disposed) return;

    const fadeInElapsed = now - this.fadeInStart;

    if (fadeInElapsed < FADE_MS) {
      this.material.opacity = Math.max(0, Math.min(1, fadeInElapsed / FADE_MS));
      return;
    }

    if (now < this.hideAt) {
      this.material.opacity = 1;
      return;
    }

    const fadeOutElapsed = now - this.hideAt;

    if (fadeOutElapsed >= FADE_MS) {
      this.material.opacity = 0;
      this.sprite.visible = false;
      this.state = "hidden";
      return;
    }

    this.material.opacity = 1 - fadeOutElapsed / FADE_MS;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;

    this.parent.remove(this.sprite);
    this.texture.dispose();
    this.material.dispose();
  }
}
