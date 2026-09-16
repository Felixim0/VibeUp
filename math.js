export const EPSILON = 0.000001;

export const vec3 = (x = 0, y = 0, z = 0) => [x, y, z];

export const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

export const subtract3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export const multiply3 = (a, b) => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];

export const scale3 = (a, scalar) => [a[0] * scalar, a[1] * scalar, a[2] * scalar];

export const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
];

export const length3 = (a) => Math.hypot(a[0], a[1], a[2]);

export const distance3 = (a, b) => length3(subtract3(a, b));

export const normalize3 = (a) => {
  const length = length3(a);
  return length > EPSILON ? scale3(a, 1 / length) : [0, 0, 0];
};

export const midpoint3 = (a, b) => scale3(add3(a, b), 0.5);

export const lerp3 = (a, b, amount) => [
  a[0] + (b[0] - a[0]) * amount,
  a[1] + (b[1] - a[1]) * amount,
  a[2] + (b[2] - a[2]) * amount
];

export const nearlyEqual = (a, b, epsilon = EPSILON) => Math.abs(a - b) <= epsilon;

export const mat4Identity = () => [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1
];

export const mat4Multiply = (a, b) => {
  const output = new Array(16).fill(0);

  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      output[column * 4 + row] =
        a[row] * b[column * 4] +
        a[4 + row] * b[column * 4 + 1] +
        a[8 + row] * b[column * 4 + 2] +
        a[12 + row] * b[column * 4 + 3];
    }
  }

  return output;
};

export const mat4Translation = (translation) => [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  translation[0], translation[1], translation[2], 1
];

export const mat4Scaling = (scale) => [
  scale[0], 0, 0, 0,
  0, scale[1], 0, 0,
  0, 0, scale[2], 0,
  0, 0, 0, 1
];

export const mat4RotationX = (angle) => {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [
    1, 0, 0, 0,
    0, cosine, sine, 0,
    0, -sine, cosine, 0,
    0, 0, 0, 1
  ];
};

export const mat4RotationY = (angle) => {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [
    cosine, 0, -sine, 0,
    0, 1, 0, 0,
    sine, 0, cosine, 0,
    0, 0, 0, 1
  ];
};

export const mat4RotationZ = (angle) => {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [
    cosine, sine, 0, 0,
    -sine, cosine, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  ];
};

export const mat4RotationAxis = (axis, angle) => {
  const [x, y, z] = normalize3(axis);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const inverseCosine = 1 - cosine;
  return [
    x * x * inverseCosine + cosine, y * x * inverseCosine + z * sine, z * x * inverseCosine - y * sine, 0,
    x * y * inverseCosine - z * sine, y * y * inverseCosine + cosine, z * y * inverseCosine + x * sine, 0,
    x * z * inverseCosine + y * sine, y * z * inverseCosine - x * sine, z * z * inverseCosine + cosine, 0,
    0, 0, 0, 1
  ];
};

export const mat4RotationAroundPoint = (axis, angle, point) => mat4Multiply(
  mat4Multiply(mat4Translation(point), mat4RotationAxis(axis, angle)),
  mat4Translation(scale3(point, -1))
);

export const mat4FromTransform = (transform = {}) => {
  const position = transform.position ?? [0, 0, 0];
  const rotation = transform.rotation ?? [0, 0, 0];
  const scale = transform.scale ?? [1, 1, 1];
  const rotationMatrix = mat4Multiply(
    mat4Multiply(mat4RotationZ(rotation[2]), mat4RotationY(rotation[1])),
    mat4RotationX(rotation[0])
  );
  return mat4Multiply(mat4Multiply(mat4Translation(position), rotationMatrix), mat4Scaling(scale));
};

export const mat4Perspective = (fieldOfView, aspect, near, far) => {
  const focalLength = 1 / Math.tan(fieldOfView / 2);
  const range = 1 / (near - far);
  return [
    focalLength / aspect, 0, 0, 0,
    0, focalLength, 0, 0,
    0, 0, (near + far) * range, -1,
    0, 0, 2 * near * far * range, 0
  ];
};

export const mat4Ortho = (left, right, bottom, top, near, far) => [
  2 / (right - left), 0, 0, 0,
  0, 2 / (top - bottom), 0, 0,
  0, 0, -2 / (far - near), 0,
  -(right + left) / (right - left),
  -(top + bottom) / (top - bottom),
  -(far + near) / (far - near),
  1
];

export const mat4LookAt = (eye, center, up) => {
  const forward = normalize3(subtract3(eye, center));
  const right = normalize3(cross3(up, forward));
  const cameraUp = cross3(forward, right);

  return [
    right[0], cameraUp[0], forward[0], 0,
    right[1], cameraUp[1], forward[1], 0,
    right[2], cameraUp[2], forward[2], 0,
    -dot3(right, eye), -dot3(cameraUp, eye), -dot3(forward, eye), 1
  ];
};

export const mat4Invert = (matrix) => {
  const augmented = Array.from({ length: 4 }, (_, row) => Array.from({ length: 8 }, (_, column) => (
    column < 4 ? matrix[column * 4 + row] : column - 4 === row ? 1 : 0
  )));

  for (let column = 0; column < 4; column += 1) {
    let pivotRow = column;
    for (let row = column + 1; row < 4; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivotRow][column])) {
        pivotRow = row;
      }
    }
    if (Math.abs(augmented[pivotRow][column]) < EPSILON) {
      return null;
    }
    [augmented[column], augmented[pivotRow]] = [augmented[pivotRow], augmented[column]];
    const pivot = augmented[column][column];
    for (let index = 0; index < 8; index += 1) {
      augmented[column][index] /= pivot;
    }
    for (let row = 0; row < 4; row += 1) {
      if (row === column) {
        continue;
      }
      const factor = augmented[row][column];
      for (let index = 0; index < 8; index += 1) {
        augmented[row][index] -= factor * augmented[column][index];
      }
    }
  }

  const inverse = new Array(16);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      inverse[column * 4 + row] = augmented[row][column + 4];
    }
  }
  return inverse;
};

/* obsolete
  // Removed cofactor implementation retained only in this comment.
  const obsoleteA00 = matrix[0];
  const oldA01 = matrix[1];
  const oldA02 = matrix[2];
  const oldA03 = matrix[3];
  const oldA10 = matrix[4];
  const oldA11 = matrix[5];
  const oldA12 = matrix[6];
  const oldA13 = matrix[7];
  const oldA20 = matrix[8];
  const oldA21 = matrix[9];
  const oldA22 = matrix[10];
  const oldA23 = matrix[11];
  const oldA30 = matrix[12];
  const oldA31 = matrix[13];
  const oldA32 = matrix[14];
  const oldA33 = matrix[15];
  const b00 = oldA00 * oldA11 - oldA01 * oldA10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  const determinant = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;

  if (Math.abs(determinant) < EPSILON) {
    return null;
  }

  const inverseDeterminant = 1 / determinant;
  output[0] = (a11 * b11 - a12 * b10 + a13 * b09) * inverseDeterminant;
  output[1] = (a02 * b10 - a01 * b11 - a03 * b09) * inverseDeterminant;
  output[2] = (a31 * b05 - a32 * b04 + a33 * b03) * inverseDeterminant;
  output[3] = (a22 * b04 - a21 * b05 - a23 * b03) * inverseDeterminant;
  output[4] = (a12 * b08 - a10 * b11 - a13 * b07) * inverseDeterminant;
  output[5] = (a00 * b11 - a02 * b08 + a03 * b07) * inverseDeterminant;
  output[6] = (a32 * b02 - a30 * b05 - a33 * b01) * inverseDeterminant;
  output[7] = (a20 * b05 - a22 * b02 + a23 * b01) * inverseDeterminant;
  output[8] = (a10 * b10 - a11 * b08 + a13 * b06) * inverseDeterminant;
  output[9] = (a01 * b08 - a00 * b10 - a03 * b06) * inverseDeterminant;
  output[10] = (a30 * b04 - a31 * b02 + a33 * b00) * inverseDeterminant;
  output[11] = (a21 * b02 - a20 * b04 - a23 * b00) * inverseDeterminant;
  output[12] = (a11 * b07 - a10 * b09 - a12 * b06) * inverseDeterminant;
  output[13] = (a00 * b07 - a01 * b09 - a02 * b06) * inverseDeterminant;
  output[14] = (a31 * b01 - a30 * b03 - a32 * b00) * inverseDeterminant;
  output[15] = (a21 * b03 - a20 * b01 + a22 * b00) * inverseDeterminant;
  return output;
};
*/

export const transformPoint = (matrix, point) => {
  const x = point[0];
  const y = point[1];
  const z = point[2];
  const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  const divisor = Math.abs(w) > EPSILON ? w : 1;
  return [
    (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / divisor,
    (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / divisor,
    (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / divisor
  ];
};

export const transformDirection = (matrix, direction) => normalize3([
  matrix[0] * direction[0] + matrix[4] * direction[1] + matrix[8] * direction[2],
  matrix[1] * direction[0] + matrix[5] * direction[1] + matrix[9] * direction[2],
  matrix[2] * direction[0] + matrix[6] * direction[1] + matrix[10] * direction[2]
]);

export const rayFromScreen = (x, y, width, height, projection, view) => {
  const normalizedX = (2 * x) / width - 1;
  const normalizedY = 1 - (2 * y) / height;
  const inverse = mat4Invert(mat4Multiply(projection, view));

  if (!inverse) {
    return null;
  }

  const near = transformPoint(inverse, [normalizedX, normalizedY, -1]);
  const far = transformPoint(inverse, [normalizedX, normalizedY, 1]);
  return { origin: near, direction: normalize3(subtract3(far, near)) };
};

export const projectPoint = (point, width, height, projection, view) => {
  const combined = mat4Multiply(projection, view);
  const x = point[0];
  const y = point[1];
  const z = point[2];
  const w = combined[3] * x + combined[7] * y + combined[11] * z + combined[15];

  if (Math.abs(w) < EPSILON) {
    return null;
  }

  const clipX = (combined[0] * x + combined[4] * y + combined[8] * z + combined[12]) / w;
  const clipY = (combined[1] * x + combined[5] * y + combined[9] * z + combined[13]) / w;
  const clipZ = (combined[2] * x + combined[6] * y + combined[10] * z + combined[14]) / w;
  return [(clipX + 1) * 0.5 * width, (1 - clipY) * 0.5 * height, clipZ];
};

export const intersectRayPlane = (ray, planePoint, planeNormal) => {
  const denominator = dot3(planeNormal, ray.direction);

  if (Math.abs(denominator) < EPSILON) {
    return null;
  }

  const distance = dot3(subtract3(planePoint, ray.origin), planeNormal) / denominator;
  return distance >= 0 ? add3(ray.origin, scale3(ray.direction, distance)) : null;
};

export const intersectRayTriangle = (ray, a, b, c) => {
  const edgeOne = subtract3(b, a);
  const edgeTwo = subtract3(c, a);
  const p = cross3(ray.direction, edgeTwo);
  const determinant = dot3(edgeOne, p);

  if (Math.abs(determinant) < EPSILON) {
    return null;
  }

  const inverseDeterminant = 1 / determinant;
  const t = subtract3(ray.origin, a);
  const u = dot3(t, p) * inverseDeterminant;

  if (u < 0 || u > 1) {
    return null;
  }

  const q = cross3(t, edgeOne);
  const v = dot3(ray.direction, q) * inverseDeterminant;

  if (v < 0 || u + v > 1) {
    return null;
  }

  const distance = dot3(edgeTwo, q) * inverseDeterminant;
  return distance > EPSILON ? { distance, point: add3(ray.origin, scale3(ray.direction, distance)), normal: normalize3(cross3(edgeOne, edgeTwo)) } : null;
};

export const signedAngleAroundAxis = (from, to, axis) => {
  const normalizedFrom = normalize3(from);
  const normalizedTo = normalize3(to);
  const sine = dot3(axis, cross3(normalizedFrom, normalizedTo));
  const cosine = dot3(normalizedFrom, normalizedTo);
  return Math.atan2(sine, cosine);
};
