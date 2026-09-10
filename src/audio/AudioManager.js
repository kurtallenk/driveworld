const clamp = (value, min, max) =>
  Math.min(max, Math.max(min, value));

export class AudioManager {
  constructor() {
    this.context = null;
    this.enabled = false;
    this.volume = 0.3;
    this.engineVolume = 1;
    this.environmentVolume = 1;
    this.effectsVolume = 1;
    this.lastImpactTime = -Infinity;
    this.previousGear = null;

    const muteWhenUnfocused = () => {
      if (!this.context) return;

      if (document.hidden || !document.hasFocus()) {
        this.master.gain.setTargetAtTime(
          0,
          this.context.currentTime,
          0.03
        );
      }
    };

    document.addEventListener("visibilitychange", muteWhenUnfocused);
    window.addEventListener("blur", muteWhenUnfocused);
  }

  async enable() {
    if (!this.context) this.initialize();

    // Called directly from the Enable Audio button's user gesture.
    await this.context.resume();

    this.enabled = this.context.state === "running";
    return this.enabled;
  }

  initialize() {
    const AudioContextClass =
      window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) {
      throw new Error("Web Audio is unavailable in this browser.");
    }

    this.context = new AudioContextClass();
    const ctx = this.context;

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    this.engineBus = ctx.createGain();
    this.environmentBus = ctx.createGain();
    this.effectsBus = ctx.createGain();

    this.engineBus.connect(this.master);
    this.environmentBus.connect(this.master);
    this.effectsBus.connect(this.master);

    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = "lowpass";
    this.engineFilter.frequency.value = 1800;
    this.engineFilter.connect(this.engineBus);

    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineGain.connect(this.engineFilter);

    this.engineOscillator = ctx.createOscillator();
    this.engineOscillator.type = "sawtooth";
    this.engineOscillator.frequency.value = 30;
    this.engineOscillator.connect(this.engineGain);
    this.engineOscillator.start();

    this.harmonicGain = ctx.createGain();
    this.harmonicGain.gain.value = 0;
    this.harmonicGain.connect(this.engineFilter);

    this.harmonic = ctx.createOscillator();
    this.harmonic.type = "triangle";
    this.harmonic.frequency.value = 60;
    this.harmonic.connect(this.harmonicGain);
    this.harmonic.start();

    const noiseBuffer = ctx.createBuffer(
      1,
      ctx.sampleRate * 2,
      ctx.sampleRate
    );

    const samples = noiseBuffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.random() * 2 - 1;
    }

    this.noiseBuffer = noiseBuffer;

    this.rolling = this.createNoiseLayer(
  "bandpass", 650, 0.7, this.effectsBus
);

this.wind = this.createNoiseLayer(
  "lowpass", 240, 0.7, this.environmentBus
);

this.skid = this.createNoiseLayer(
  "bandpass", 1500, 1.8, this.effectsBus
);
  }

  createNoiseLayer(type, frequency, q, destination) {
    const ctx = this.context;

    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;

    const gain = ctx.createGain();
    gain.gain.value = 0;

    source.connect(filter);
    filter.connect(gain);
    gain.connect(destination);
    source.start();

    return { source, filter, gain };
  }

  shiftClick() {
    const ctx = this.context;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1100;

    const gain = ctx.createGain();
    const now = ctx.currentTime;

    gain.gain.setValueAtTime(0.035, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.065);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.effectsBus);

    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    };

    source.start(now);
    source.stop(now + 0.08);
  }

  playImpact(impactSpeed) {
  if (
    !this.context ||
    !this.enabled ||
    this.context.state !== "running" ||
    document.hidden ||
    !document.hasFocus()
  ) {
    return;
  }

  if (!Number.isFinite(impactSpeed) || impactSpeed < 1.5) return;

  const ctx = this.context;
  const now = ctx.currentTime;

  // Collision contacts can generate several events for one impact.
  if (now - this.lastImpactTime < 0.15) return;
  this.lastImpactTime = now;

  const strength = clamp((impactSpeed - 1.5) / 12, 0, 1);

  const source = ctx.createBufferSource();
  source.buffer = this.noiseBuffer;

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 250 + strength * 650;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.03 + strength * 0.14, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(this.effectsBus);

  source.onended = () => {
    source.disconnect();
    filter.disconnect();
    gain.disconnect();
  };

  source.start(now);
  source.stop(now + 0.22);
}

playFeedback(events) {
  if (
    !this.context ||
    !this.enabled ||
    this.context.state !== "running" ||
    document.hidden ||
    !document.hasFocus()
  ) {
    return;
  }

  for (const event of events) {
    if (event.type === "engine-start") {
      // Brief synthetic starter/engine-catch cue.
      this.playToneEffect({
        startFrequency: 45,
        endFrequency: 95,
        duration: 0.28,
        volume: 0.035,
        type: "triangle",
        destination: this.engineBus
      });
    }

    if (event.type === "engine-stop") {
      this.playToneEffect({
        startFrequency: 60,
        endFrequency: 22,
        duration: 0.22,
        volume: 0.03,
        type: "triangle",
        destination: this.engineBus
      });
    }

    if (event.type === "suspension") {
      this.playToneEffect({
        startFrequency: 95,
        endFrequency: 38,
        duration: 0.09,
        volume: 0.008 + event.strength * 0.022,
        type: "sine",
        destination: this.effectsBus
      });
    }
  }
}

playToneEffect({
  startFrequency,
  endFrequency,
  duration,
  volume,
  type,
  destination
}) {
  const ctx = this.context;
  const now = ctx.currentTime;

  const oscillator = ctx.createOscillator();
  const envelope = ctx.createGain();

  oscillator.type = type;

  oscillator.frequency.setValueAtTime(startFrequency, now);
  oscillator.frequency.exponentialRampToValueAtTime(
    endFrequency,
    now + duration
  );

  envelope.gain.setValueAtTime(0.0001, now);
  envelope.gain.exponentialRampToValueAtTime(
    volume,
    now + 0.01
  );

  envelope.gain.exponentialRampToValueAtTime(
    0.0001,
    now + duration
  );

  oscillator.connect(envelope);
  envelope.connect(destination);

  oscillator.onended = () => {
    oscillator.disconnect();
    envelope.disconnect();
  };

  oscillator.start(now);
  oscillator.stop(now + duration + 0.02);
}

  update({
  rpm,
  throttle,
  speed,
  engineRunning,
  gear,
  surface,
  driverView,
  lugging,
  slip = 0
}) {
    if (!this.context || !this.enabled) return;

    const ctx = this.context;
    const now = ctx.currentTime;

    const audible =
      !document.hidden &&
      document.hasFocus() &&
      ctx.state === "running";

    const set = (parameter, value, smoothing = 0.06) => {
      parameter.setTargetAtTime(value, now, smoothing);
    };

    set(this.master.gain, audible ? this.volume : 0);

    set(this.engineBus.gain, this.engineVolume);
    set(this.environmentBus.gain, this.environmentVolume);
    set(this.effectsBus.gain, this.effectsVolume);

    // Four-cylinder-inspired firing frequency, not a recorded engine.
    const fundamental = clamp(rpm / 30, 15, 260);
    set(this.engineOscillator.frequency, fundamental);
    set(this.harmonic.frequency, fundamental * 2);

    const engineLevel = engineRunning
      ? 0.045 + throttle * 0.055 + lugging * 0.015
      : 0;

    set(this.engineGain.gain, engineLevel);
    set(this.harmonicGain.gain, engineLevel * 0.4);

    set(
      this.engineFilter.frequency,
      driverView ? 650 + throttle * 600 : 1400 + throttle * 1800
    );

    const roughness =
      surface === "asphalt" ? 0.5 : surface === "dirt" ? 1 : 0.8;

    const rollingLevel =
      clamp(speed / 25, 0, 1) * roughness *
      (driverView ? 0.035 : 0.065);

    set(this.rolling.gain.gain, rollingLevel);
    set(
      this.rolling.filter.frequency,
      surface === "asphalt" ? 650 : 350
    );

    const slipAmount = clamp(slip, 0, 1);
const slipSpeedFactor = clamp(speed / 5, 0, 1);

set(
  this.skid.gain.gain,
  slipAmount *
    slipSpeedFactor *
    (driverView ? 0.035 : 0.07)
);

set(
  this.skid.filter.frequency,
  surface === "asphalt" ? 1700 : 550
);

    // Quiet ambient wind remains audible at rest.
    set(
      this.wind.gain.gain,
      (0.006 + clamp(speed / 40, 0, 1) * 0.035) *
      (driverView ? 0.45 : 1)
    );

    if (
      audible &&
      this.previousGear !== null &&
      gear !== this.previousGear
    ) {
      this.shiftClick();
    }

    this.previousGear = gear;
  }
}