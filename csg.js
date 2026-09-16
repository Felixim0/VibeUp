import { EPSILON, cross3, dot3, normalize3, subtract3 } from "./math.js";
import { createMeshEntity, meshIsClosed, meshWorldTriangleIterator } from "./geometry.js";

const MAX_CSG_TRIANGLES = 2_000;

const COPLANAR = 0;
const FRONT = 1;
const BACK = 2;
const SPANNING = 3;

class Vertex {
  constructor(position, normal = [0, 0, 0]) {
    this.position = Array.from(position);
    this.normal = Array.from(normal);
  }

  clone() {
    return new Vertex(this.position, this.normal);
  }

  flip() {
    this.normal = this.normal.map((value) => -value);
  }

  interpolate(other, amount) {
    return new Vertex(
      this.position.map((value, index) => value + (other.position[index] - value) * amount),
      this.normal.map((value, index) => value + (other.normal[index] - value) * amount)
    );
  }
}

class Plane {
  constructor(normal, distance) {
    this.normal = normalize3(normal);
    this.distance = distance;
  }

  clone() {
    return new Plane(this.normal, this.distance);
  }

  flip() {
    this.normal = this.normal.map((value) => -value);
    this.distance = -this.distance;
  }

  static fromPoints(a, b, c) {
    const normal = normalize3(cross3(subtract3(b, a), subtract3(c, a)));
    return new Plane(normal, dot3(normal, a));
  }

  splitPolygon(polygon, coplanarFront, coplanarBack, front, back) {
    const types = [];
    let polygonType = COPLANAR;
    for (const vertex of polygon.vertices) {
      const distance = dot3(this.normal, vertex.position) - this.distance;
      const type = distance < -EPSILON ? BACK : distance > EPSILON ? FRONT : COPLANAR;
      polygonType |= type;
      types.push(type);
    }

    if (polygonType === COPLANAR) {
      (dot3(this.normal, polygon.plane.normal) > 0 ? coplanarFront : coplanarBack).push(polygon);
      return;
    }
    if (polygonType === FRONT) {
      front.push(polygon);
      return;
    }
    if (polygonType === BACK) {
      back.push(polygon);
      return;
    }

    const frontVertices = [];
    const backVertices = [];
    for (let index = 0; index < polygon.vertices.length; index += 1) {
      const next = (index + 1) % polygon.vertices.length;
      const currentType = types[index];
      const nextType = types[next];
      const current = polygon.vertices[index];
      const following = polygon.vertices[next];
      if (currentType !== BACK) {
        frontVertices.push(current);
      }
      if (currentType !== FRONT) {
        backVertices.push(current.clone());
      }
      if ((currentType | nextType) === SPANNING) {
        const segment = subtract3(following.position, current.position);
        const amount = (this.distance - dot3(this.normal, current.position)) / dot3(this.normal, segment);
        const vertex = current.interpolate(following, amount);
        frontVertices.push(vertex);
        backVertices.push(vertex.clone());
      }
    }
    if (frontVertices.length >= 3) {
      front.push(new Polygon(frontVertices, polygon.shared));
    }
    if (backVertices.length >= 3) {
      back.push(new Polygon(backVertices, polygon.shared));
    }
  }
}

class Polygon {
  constructor(vertices, shared = null) {
    this.vertices = vertices;
    this.shared = shared;
    this.plane = Plane.fromPoints(vertices[0].position, vertices[1].position, vertices[2].position);
  }

  clone() {
    return new Polygon(this.vertices.map((vertex) => vertex.clone()), this.shared);
  }

  flip() {
    this.vertices.reverse().forEach((vertex) => vertex.flip());
    this.plane.flip();
  }
}

class Node {
  constructor(polygons = []) {
    this.plane = null;
    this.front = null;
    this.back = null;
    this.polygons = [];
    if (polygons.length > 0) {
      this.build(polygons);
    }
  }

  clone() {
    const node = new Node();
    node.plane = this.plane?.clone() ?? null;
    node.front = this.front?.clone() ?? null;
    node.back = this.back?.clone() ?? null;
    node.polygons = this.polygons.map((polygon) => polygon.clone());
    return node;
  }

  allPolygons() {
    return [
      ...this.polygons,
      ...(this.front ? this.front.allPolygons() : []),
      ...(this.back ? this.back.allPolygons() : [])
    ];
  }

  invert() {
    for (const polygon of this.polygons) {
      polygon.flip();
    }
    this.plane?.flip();
    this.front?.invert();
    this.back?.invert();
    const front = this.front;
    this.front = this.back;
    this.back = front;
  }

  clipPolygons(polygons) {
    if (!this.plane) {
      return polygons.slice();
    }
    let front = [];
    let back = [];
    for (const polygon of polygons) {
      this.plane.splitPolygon(polygon, front, back, front, back);
    }
    if (this.front) {
      front = this.front.clipPolygons(front);
    }
    if (this.back) {
      back = this.back.clipPolygons(back);
    } else {
      back = [];
    }
    return [...front, ...back];
  }

  clipTo(node) {
    this.polygons = node.clipPolygons(this.polygons);
    this.front?.clipTo(node);
    this.back?.clipTo(node);
  }

  build(polygons) {
    if (polygons.length === 0) {
      return;
    }
    if (!this.plane) {
      this.plane = polygons[0].plane.clone();
    }
    const front = [];
    const back = [];
    for (const polygon of polygons) {
      this.plane.splitPolygon(polygon, this.polygons, this.polygons, front, back);
    }
    if (front.length > 0) {
      if (!this.front) {
        this.front = new Node();
      }
      this.front.build(front);
    }
    if (back.length > 0) {
      if (!this.back) {
        this.back = new Node();
      }
      this.back.build(back);
    }
  }
}

const CsgSolid = class CsgSolid {
  constructor(polygons) {
    this.polygons = polygons;
  }

  subtract(other) {
    const target = new Node(this.polygons.map((polygon) => polygon.clone()));
    const cutter = new Node(other.polygons.map((polygon) => polygon.clone()));
    target.invert();
    target.clipTo(cutter);
    cutter.clipTo(target);
    cutter.invert();
    cutter.clipTo(target);
    cutter.invert();
    target.build(cutter.allPolygons());
    target.invert();
    return new CsgSolid(target.allPolygons());
  }
};

const polygonsFromEntity = (project, entity) => {
  const polygons = [];
  for (const [a, b, c] of meshWorldTriangleIterator(project, entity)) {
    const normal = normalize3(cross3(subtract3(b, a), subtract3(c, a)));
    if (Math.hypot(...normal) < EPSILON) {
      throw new Error(`${entity.name} contains a degenerate triangle.`);
    }
    polygons.push(new Polygon([new Vertex(a, normal), new Vertex(b, normal), new Vertex(c, normal)]));
  }
  if (polygons.length === 0) {
    throw new Error(`${entity.name} has no triangles.`);
  }
  return polygons;
};

const vertexKey = (point) => point.map((value) => Math.round(value * 1000000)).join(":");

const polygonsToEntity = (polygons, name, materialId) => {
  const vertices = [];
  const indices = [];
  const vertexIndices = new Map();
  const addVertex = (vertex) => {
    const key = vertexKey(vertex.position);
    const existing = vertexIndices.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const index = vertices.length / 3;
    vertexIndices.set(key, index);
    vertices.push(...vertex.position);
    return index;
  };
  for (const polygon of polygons) {
    for (let index = 1; index < polygon.vertices.length - 1; index += 1) {
      const triangle = [polygon.vertices[0], polygon.vertices[index], polygon.vertices[index + 1]];
      const normal = cross3(
        subtract3(triangle[1].position, triangle[0].position),
        subtract3(triangle[2].position, triangle[0].position)
      );
      if (Math.hypot(...normal) <= EPSILON) {
        continue;
      }
      for (const vertex of triangle) {
        indices.push(addVertex(vertex));
      }
    }
  }
  if (indices.length === 0) {
    throw new Error("Subtract produced an empty model.");
  }
  return createMeshEntity({
    name,
    vertices,
    indices,
    materialId,
    metadata: { primitive: "csg-subtract", solid: true, boolean: "subtract" }
  });
};

const entityIsAxisAlignedBox = (entity) => {
  if (entity.kind !== "mesh" || entity.metadata?.primitive !== "box" || !Array.isArray(entity.metadata.dimensions) || entity.metadata.dimensions.length !== 3) {
    return false;
  }
  const rotation = entity.transform?.rotation ?? [0, 0, 0];
  const scale = entity.transform?.scale ?? [1, 1, 1];
  return rotation.every((value) => Math.abs(value) <= EPSILON) && scale.every((value) => Math.abs(value - 1) <= EPSILON);
};

const axisAlignedBoxBounds = (project, entity) => {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let hasPoints = false;
  for (const triangle of meshWorldTriangleIterator(project, entity)) {
    for (const point of triangle) {
      hasPoints = true;
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], point[axis]);
        max[axis] = Math.max(max[axis], point[axis]);
      }
    }
  }
  if (!hasPoints) {
    return null;
  }
  return { min, max };
};

const addQuad = (vertices, indices, points) => {
  const start = vertices.length / 3;
  for (const point of points) {
    vertices.push(...point);
  }
  indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
};

const subtractNestedAxisAlignedBoxes = (project, target, cutter) => {
  const targetBounds = axisAlignedBoxBounds(project, target);
  const cutterBounds = axisAlignedBoxBounds(project, cutter);
  if (!targetBounds || !cutterBounds) {
    return null;
  }
  const [xmin, ymin, zmin] = targetBounds.min;
  const [xmax, ymax, zmax] = targetBounds.max;
  const [ix0, iy0, iz0] = cutterBounds.min;
  const [ix1, iy1, iz1] = cutterBounds.max;
  const inside = ix0 > xmin + EPSILON && iy0 > ymin + EPSILON && iz0 > zmin + EPSILON && ix1 < xmax - EPSILON && iy1 < ymax - EPSILON && iz1 < zmax - EPSILON;
  if (!inside) {
    return null;
  }
  const vertices = [];
  const indices = [];
  const outerFaces = [
    [[xmin, ymin, zmin], [xmax, ymin, zmin], [xmax, ymax, zmin], [xmin, ymax, zmin]],
    [[xmin, ymin, zmax], [xmin, ymax, zmax], [xmax, ymax, zmax], [xmax, ymin, zmax]],
    [[xmin, ymin, zmin], [xmin, ymin, zmax], [xmax, ymin, zmax], [xmax, ymin, zmin]],
    [[xmin, ymax, zmin], [xmax, ymax, zmin], [xmax, ymax, zmax], [xmin, ymax, zmax]],
    [[xmin, ymin, zmin], [xmin, ymax, zmin], [xmin, ymax, zmax], [xmin, ymin, zmax]],
    [[xmax, ymin, zmin], [xmax, ymin, zmax], [xmax, ymax, zmax], [xmax, ymax, zmin]]
  ];
  const innerFaces = [
    [[ix0, iy0, iz0], [ix0, iy1, iz0], [ix1, iy1, iz0], [ix1, iy0, iz0]],
    [[ix0, iy0, iz1], [ix1, iy0, iz1], [ix1, iy1, iz1], [ix0, iy1, iz1]],
    [[ix0, iy0, iz0], [ix1, iy0, iz0], [ix1, iy0, iz1], [ix0, iy0, iz1]],
    [[ix0, iy1, iz0], [ix0, iy1, iz1], [ix1, iy1, iz1], [ix1, iy1, iz0]],
    [[ix0, iy0, iz0], [ix0, iy0, iz1], [ix0, iy1, iz1], [ix0, iy1, iz0]],
    [[ix1, iy0, iz0], [ix1, iy1, iz0], [ix1, iy1, iz1], [ix1, iy0, iz1]]
  ];
  for (const face of outerFaces) {
    addQuad(vertices, indices, face);
  }
  for (const face of innerFaces) {
    addQuad(vertices, indices, face);
  }
  return createMeshEntity({
    name: `${target.name} minus ${cutter.name}`,
    vertices,
    indices,
    materialId: target.materialId,
    metadata: { primitive: "csg-subtract", solid: true, boolean: "subtract" }
  });
};

const signedMeshVolume = (project, entity) => {
  let volume = 0;
  for (const [a, b, c] of meshWorldTriangleIterator(project, entity)) {
    volume += (
      a[0] * (b[1] * c[2] - b[2] * c[1]) +
      a[1] * (b[2] * c[0] - b[0] * c[2]) +
      a[2] * (b[0] * c[1] - b[1] * c[0])
    ) / 6;
  }
  return volume;
};

const reverseMeshWinding = (entity) => {
  for (let index = 0; index < entity.indices.length; index += 3) {
    const second = entity.indices[index + 1];
    entity.indices[index + 1] = entity.indices[index + 2];
    entity.indices[index + 2] = second;
  }
};

export const validateSubtractInputs = (project, target, cutter) => {
  if (!target || !cutter || target.kind !== "mesh" || cutter.kind !== "mesh") {
    throw new Error("Subtract requires a target mesh and a cutter mesh.");
  }
  if (target.id === cutter.id) {
    throw new Error("Choose two different meshes for subtract.");
  }
  if (target.indices.length / 3 > MAX_CSG_TRIANGLES || cutter.indices.length / 3 > MAX_CSG_TRIANGLES) {
    throw new Error("Subtract supports meshes with up to 2,000 triangles each. Simplify the mesh first.");
  }
  if (!meshIsClosed(project, target) || !meshIsClosed(project, cutter)) {
    throw new Error("Subtract requires closed meshes with consistent face winding. Run Print Check and repair topology first.");
  }
};

export const subtractMeshes = (project, target, cutter) => {
  validateSubtractInputs(project, target, cutter);

  if (entityIsAxisAlignedBox(target) && entityIsAxisAlignedBox(cutter)) {
    const nestedBoxResult = subtractNestedAxisAlignedBoxes(project, target, cutter);
    if (nestedBoxResult) {
      const resultProject = { ...project, entities: [nestedBoxResult], roots: [nestedBoxResult.id] };
      if (signedMeshVolume(resultProject, nestedBoxResult) < 0) {
        reverseMeshWinding(nestedBoxResult);
      }
      return nestedBoxResult;
    }
  }

  const targetSolid = new CsgSolid(polygonsFromEntity(project, target));
  const cutterSolid = new CsgSolid(polygonsFromEntity(project, cutter));
  const result = polygonsToEntity(targetSolid.subtract(cutterSolid).polygons, `${target.name} minus ${cutter.name}`, target.materialId);
  const outputProject = { ...project, entities: [result], roots: [result.id] };
  if (!meshIsClosed(outputProject, result)) {
    throw new Error("Subtract could not produce a closed mesh. The original meshes were left unchanged.");
  }
  return result;
};
