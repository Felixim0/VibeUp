import {
  add3,
  cross3,
  mat4LookAt,
  mat4Ortho,
  mat4Perspective,
  normalize3,
  scale3,
  subtract3
} from "./math.js";

const DEGREE = Math.PI / 180;

export class OrbitCamera {
  constructor() {
    this.target = [0, 0, 25];
    this.yaw = -45 * DEGREE;
    this.pitch = 30 * DEGREE;
    this.distance = 400;
    this.projectionType = "perspective";
  }

  getPosition() {
    const horizontal = Math.cos(this.pitch) * this.distance;
    return [
      this.target[0] + Math.cos(this.yaw) * horizontal,
      this.target[1] + Math.sin(this.yaw) * horizontal,
      this.target[2] + Math.sin(this.pitch) * this.distance
    ];
  }

  getDirection() {
    return normalize3(subtract3(this.target, this.getPosition()));
  }

  getMatrices(aspect) {
    const far = Math.max(10000, this.distance * 40);
    const near = Math.max(0.01, this.distance / 10000);
    const view = mat4LookAt(this.getPosition(), this.target, [0, 0, 1]);
    let projection;

    if (this.projectionType === "parallel") {
      const verticalSpan = Math.max(0.1, this.distance * 0.82);
      projection = mat4Ortho(
        (-verticalSpan * aspect) / 2,
        (verticalSpan * aspect) / 2,
        -verticalSpan / 2,
        verticalSpan / 2,
        -far,
        far
      );
    } else {
      projection = mat4Perspective(45 * DEGREE, Math.max(aspect, 0.01), near, far);
    }

    return { projection, view };
  }

  orbit(deltaX, deltaY) {
    this.yaw -= deltaX * 0.008;
    this.pitch = Math.max(-88 * DEGREE, Math.min(88 * DEGREE, this.pitch - deltaY * 0.008));
  }

  pan(deltaX, deltaY, viewportHeight) {
    const direction = this.getDirection();
    const right = normalize3(cross3(direction, [0, 0, 1]));
    const up = normalize3(cross3(right, direction));
    const distancePerPixel = (this.distance * 0.82) / Math.max(viewportHeight, 1);
    this.target = add3(
      this.target,
      add3(scale3(right, -deltaX * distancePerPixel), scale3(up, deltaY * distancePerPixel))
    );
  }

  zoom(delta) {
    const precision = Math.max(0.0001, Math.min(0.0015, this.distance / 300000));
    this.distance = Math.max(0.01, Math.min(1000000, this.distance * Math.exp(delta * precision)));
  }

  fit(bounds) {
    if (!bounds) {
      return;
    }
    const largestDimension = Math.max(bounds.size[0], bounds.size[1], bounds.size[2], 10);
    this.target = Array.from(bounds.center);
    this.distance = Math.max(80, largestDimension * 2.4);
  }

  setView(view) {
    if (view === "top") {
      this.yaw = -90 * DEGREE;
      this.pitch = 88 * DEGREE;
    } else if (view === "front") {
      this.yaw = -90 * DEGREE;
      this.pitch = 0;
    } else if (view === "right") {
      this.yaw = 0;
      this.pitch = 0;
    } else {
      this.yaw = -45 * DEGREE;
      this.pitch = 30 * DEGREE;
    }
  }

  reset() {
    this.target = [0, 0, 25];
    this.yaw = -45 * DEGREE;
    this.pitch = 30 * DEGREE;
    this.distance = 400;
    this.projectionType = "perspective";
  }

  serialize() {
    return {
      target: Array.from(this.target),
      yaw: this.yaw,
      pitch: this.pitch,
      distance: this.distance,
      projectionType: this.projectionType
    };
  }

  restore(data) {
    if (!data || !Array.isArray(data.target)) {
      return;
    }
    this.target = Array.from(data.target);
    this.yaw = Number.isFinite(data.yaw) ? data.yaw : this.yaw;
    this.pitch = Number.isFinite(data.pitch) ? data.pitch : this.pitch;
    this.distance = Number.isFinite(data.distance) ? data.distance : this.distance;
    this.projectionType = data.projectionType === "parallel" ? "parallel" : "perspective";
  }
}
