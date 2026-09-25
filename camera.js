import {
  add3,
  cross3,
  dot3,
  mat4LookAt,
  mat4Ortho,
  mat4Perspective,
  normalize3,
  scale3,
  subtract3
} from "./math.js";

const DEGREE = Math.PI / 180;
const POLE_EPSILON = 0.0001;
const clampPitch = (pitch) => Math.max(-Math.PI / 2 + POLE_EPSILON, Math.min(Math.PI / 2 - POLE_EPSILON, pitch));

export class OrbitCamera {
  constructor() {
    this.target = [0, 0, 25];
    this.yaw = -45 * DEGREE;
    this.pitch = 30 * DEGREE;
    this.distance = 400;
    this.projectionType = "perspective";
    this.rotateSensitivity = 1;
    this.moveSensitivity = 1;
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
    const view = mat4LookAt(this.getPosition(), this.target, this.getUp());
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
    this.yaw -= deltaX * 0.008 * this.rotateSensitivity;
    this.pitch = clampPitch(this.pitch - deltaY * 0.008 * this.rotateSensitivity);
    this.yaw = ((this.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  }

  orbitAroundDrag(deltaX, deltaY, pivot) {
    if (!Array.isArray(pivot) || pivot.length !== 3 || !pivot.every(Number.isFinite)) {
      this.orbit(deltaX, deltaY);
      return;
    }
    const yawDelta = -deltaX * 0.008 * this.rotateSensitivity;
    const pitchDelta = clampPitch(this.pitch - deltaY * 0.008 * this.rotateSensitivity) - this.pitch;
    const rotate = (vector, axis, angle) => add3(
      add3(scale3(vector, Math.cos(angle)), scale3(cross3(axis, vector), Math.sin(angle))),
      scale3(axis, dot3(axis, vector) * (1 - Math.cos(angle)))
    );
    const yawedEye = rotate(subtract3(this.getPosition(), pivot), [0, 0, 1], yawDelta);
    const yawedTarget = rotate(subtract3(this.target, pivot), [0, 0, 1], yawDelta);
    const right = [-Math.sin(this.yaw + yawDelta), Math.cos(this.yaw + yawDelta), 0];
    const newEye = add3(pivot, rotate(yawedEye, right, -pitchDelta));
    this.target = add3(pivot, rotate(yawedTarget, right, -pitchDelta));
    const offset = subtract3(newEye, this.target);
    this.yaw = ((Math.atan2(offset[1], offset[0]) + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    this.pitch = clampPitch(Math.asin(Math.max(-1, Math.min(1, offset[2] / this.distance))));
  }

  orbitAround(target) {
    if (!Array.isArray(target) || target.length !== 3 || !target.every(Number.isFinite)) {
      return;
    }
    const position = this.getPosition();
    const offset = subtract3(position, target);
    const distance = Math.hypot(...offset);
    if (distance < 0.000001) {
      return;
    }
    this.target = Array.from(target);
    this.distance = distance;
    this.yaw = Math.atan2(offset[1], offset[0]);
    this.pitch = clampPitch(Math.asin(Math.max(-1, Math.min(1, offset[2] / distance))));
  }

  getUp() {
    // Keep the viewport upright around the world Z axis, matching SketchUp's no-roll orbit.
    return [0, 0, 1];
  }

  pan(deltaX, deltaY, viewportHeight) {
    const direction = this.getDirection();
    let right = normalize3(cross3(direction, this.getUp()));
    if (Math.hypot(...right) < 0.000001) {
      right = [-Math.sin(this.yaw), Math.cos(this.yaw), 0];
    }
    const up = normalize3(cross3(right, direction));
    const distancePerPixel = (this.distance * 0.82 * this.moveSensitivity) / Math.max(viewportHeight, 1);
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
    this.rotateSensitivity = 1;
    this.moveSensitivity = 1;
  }

  serialize() {
    return {
      target: Array.from(this.target),
      yaw: this.yaw,
      pitch: this.pitch,
      distance: this.distance,
      projectionType: this.projectionType,
      rotateSensitivity: this.rotateSensitivity,
      moveSensitivity: this.moveSensitivity
    };
  }

  restore(data) {
    if (!data || !Array.isArray(data.target)) {
      return;
    }
    this.target = Array.from(data.target);
    this.yaw = Number.isFinite(data.yaw) ? data.yaw : this.yaw;
    this.pitch = Number.isFinite(data.pitch) ? data.pitch : this.pitch;
    this.pitch = clampPitch(this.pitch);
    this.distance = Number.isFinite(data.distance) ? data.distance : this.distance;
    this.projectionType = data.projectionType === "parallel" ? "parallel" : "perspective";
    this.rotateSensitivity = Number.isFinite(data.rotateSensitivity) ? Math.max(0.1, Math.min(4, data.rotateSensitivity)) : 1;
    this.moveSensitivity = Number.isFinite(data.moveSensitivity) ? Math.max(0.1, Math.min(4, data.moveSensitivity)) : 1;
  }
}
