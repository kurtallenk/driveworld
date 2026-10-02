export class ArcadeController {
  // maxSteerAngle / steerResponse come from the vehicle-class handling
  // profile; the defaults are the original values (0.48 rad, 9/s).
  constructor({ maxSteerAngle = 0.48, steerResponse = 9 } = {}) {
    this.maxSteerAngle = maxSteerAngle;
    this.steerResponse = steerResponse;
    this.steering = 0;
    this.direction = 1;
  }

  reset() {
    this.steering = 0;
    this.direction = 1;
  }

  update(input, signedSpeed, dt) {
    let drive = 0;
    let brake = input.brake;

    if (input.throttle > 0) {
      if (signedSpeed < -0.5) {
        brake = Math.max(brake, input.throttle);
      } else {
        this.direction = 1;
        drive = input.throttle;
      }
    } else if (input.brake > 0) {
      if (signedSpeed > 0.5) {
        brake = input.brake;
      } else {
        this.direction = -1;
        drive = -input.brake;
        brake = 0;
      }
    }

    const smoothing = 1 - Math.exp(-this.steerResponse * dt);
    this.steering += (input.steering - this.steering) * smoothing;

    const speedFactor = 1 / (1 + Math.abs(signedSpeed) * 0.035);

    return {
      steeringAngle: this.steering * this.maxSteerAngle * speedFactor,
      drive,
      brake,
      handbrake: input.handbrake
    };
  }
}