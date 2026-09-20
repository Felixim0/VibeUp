import {
  EPSILON,
  add3,
  cross3,
  distance3,
  dot3,
  mat4FromTransform,
  mat4Identity,
  mat4Invert,
  mat4Multiply,
  mat4RotationAroundPoint,
  midpoint3,
  normalize3,
  scale3,
  subtract3,
  transformDirection,
  transformPoint
} from "./math.js";

const idPrefix = "vu";
let nextId = 1;

export const newId = () => {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  const id = `${idPrefix}-${Date.now().toString(36)}-${nextId.toString(36)}`;
  nextId += 1;
  return id;
};

export const defaultTransform = () => ({
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1]
});

export const DEFAULT_MATERIALS = [
  { id: "material-default", name: "Warm White", color: "#d8ddd4", metallic: 0, roughness: 0.72 },
  { id: "material-clay", name: "Clay", color: "#cf8064", metallic: 0, roughness: 0.8 },
  { id: "material-graphite", name: "Graphite", color: "#3e5056", metallic: 0.15, roughness: 0.38 },
  { id: "material-mint", name: "Mint", color: "#50cdb8", metallic: 0, roughness: 0.48 },
  { id: "material-sun", name: "Signal Yellow", color: "#efb649", metallic: 0, roughness: 0.6 },
  { id: "material-cobalt", name: "Cobalt", color: "#4e78c7", metallic: 0.05, roughness: 0.46 }
];

export const DEFAULT_TAGS = [
  { id: "tag-untagged", name: "Untagged", color: "#a8bac0", visible: true }
];

export const DEFAULT_APPEARANCE = {
  theme: "light",
  canvasColor: "#eef3f5",
  gridColor: "#aebfc7",
  edgeColor: "#334550",
  selectionColor: "#c5a255",
  edgeWidth: 2
};

export const createEmptyProject = () => ({
  formatVersion: 1,
  name: "Untitled model",
  units: "mm",
  entities: [],
  roots: [],
  materials: structuredClone(DEFAULT_MATERIALS),
  tags: structuredClone(DEFAULT_TAGS),
  scenes: [],
  settings: {
    gridVisible: true,
    edgesVisible: true,
    shadowsVisible: false,
    projection: "perspective",
    snapIncrement: 1,
    circleSegments: 24,
    section: null,
    appearance: structuredClone(DEFAULT_APPEARANCE)
  }
});

const entityBase = (kind, name) => ({
  id: newId(),
  kind,
  name,
  visible: true,
  locked: false,
  tagId: "tag-untagged",
  materialId: "material-default",
  transform: defaultTransform(),
  parentId: null,
  metadata: {}
});

export const createMeshEntity = ({ name = "Mesh", vertices, indices, metadata = {}, materialId = "material-default" }) => ({
  ...entityBase("mesh", name),
  vertices: Array.from(vertices),
  indices: Array.from(indices),
  materialId,
  metadata
});

export const createEdgeEntity = ({ name = "Line", points, closed = false, metadata = {} }) => ({
  ...entityBase("edge", name),
  points: Array.from(points),
  closed,
  metadata
});

export const createAnnotationEntity = ({ name = "Annotation", annotationType, points, text = "" }) => ({
  ...entityBase("annotation", name),
  annotationType,
  points: Array.from(points),
  text,
  metadata: { annotationType }
});

export const createGroupEntity = (name = "Group") => ({
  ...entityBase("group", name),
  children: [],
  materialId: null,
  metadata: { container: true }
});

export const addEntity = (project, entity, parentId = null) => {
  entity.parentId = parentId;
  project.entities.push(entity);

  if (parentId) {
    const parent = getEntity(project, parentId);
    if (!parent || parent.kind !== "group") {
      throw new Error("The requested parent group does not exist.");
    }
    parent.children.push(entity.id);
  } else {
    project.roots.push(entity.id);
  }

  return entity;
};

export const getEntity = (project, id) => project.entities.find((entity) => entity.id === id) ?? null;

export const getMaterial = (project, id) => project.materials.find((material) => material.id === id) ?? project.materials[0];

export const getTag = (project, id) => project.tags.find((tag) => tag.id === id) ?? project.tags[0];

export const isEntityVisible = (project, entity) => {
  if (!entity.visible || !getTag(project, entity.tagId).visible) {
    return false;
  }

  let parent = entity.parentId ? getEntity(project, entity.parentId) : null;
  const visited = new Set([entity.id]);
  while (parent) {
    if (visited.has(parent.id)) {
      return false;
    }
    visited.add(parent.id);
    if (!parent.visible || !getTag(project, parent.tagId).visible) {
      return false;
    }
    parent = parent.parentId ? getEntity(project, parent.parentId) : null;
  }

  return true;
};

export const removeEntity = (project, id) => {
  const entity = getEntity(project, id);
  if (!entity) {
    return [];
  }

  const descendants = entity.kind === "group" ? entity.children.flatMap((childId) => removeEntity(project, childId)) : [];
  const parent = entity.parentId ? getEntity(project, entity.parentId) : null;

  if (parent?.kind === "group") {
    parent.children = parent.children.filter((childId) => childId !== id);
  }

  project.roots = project.roots.filter((rootId) => rootId !== id);
  project.entities = project.entities.filter((candidate) => candidate.id !== id);
  return [entity, ...descendants];
};

export const setParent = (project, entity, parentId) => {
  const oldParent = entity.parentId ? getEntity(project, entity.parentId) : null;
  if (oldParent?.kind === "group") {
    oldParent.children = oldParent.children.filter((childId) => childId !== entity.id);
  } else {
    project.roots = project.roots.filter((rootId) => rootId !== entity.id);
  }

  entity.parentId = parentId;
  if (parentId) {
    const newParent = getEntity(project, parentId);
    if (!newParent || newParent.kind !== "group") {
      throw new Error("The requested parent group does not exist.");
    }
    newParent.children.push(entity.id);
  } else {
    project.roots.push(entity.id);
  }
};

export const makeGroup = (project, entityIds, name = "Group") => {
  const requested = new Set(entityIds);
  const selected = entityIds.map((id) => getEntity(project, id)).filter(Boolean)
    .filter((entity) => !entity.locked)
    .filter((entity) => {
      let parent = entity.parentId ? getEntity(project, entity.parentId) : null;
      while (parent) {
        if (requested.has(parent.id)) {
          return false;
        }
        parent = parent.parentId ? getEntity(project, parent.parentId) : null;
      }
      return true;
    });
  if (selected.length === 0) {
    return null;
  }

  if (!selected.every((entity) => entity.parentId === selected[0].parentId)) {
    throw new Error("Entities must share the same group before they can be grouped together.");
  }

  const sharedParent = selected[0].parentId;
  const group = createGroupEntity(name);
  addEntity(project, group, sharedParent);

  for (const entity of selected) {
    setParent(project, entity, group.id);
  }

  return group;
};

export const explodeGroup = (project, group) => {
  if (!group || group.kind !== "group") {
    return [];
  }

  const childIds = [...group.children];
  const parentId = group.parentId;

  for (const childId of childIds) {
    const child = getEntity(project, childId);
    if (!child) {
      continue;
    }

    // Children leave the group's coordinate space, so bake the group's local
    // transform through each nested child before reparenting it.
    bakeHierarchyTransform(project, child, mat4FromTransform(group.transform));
    setParent(project, child, parentId);
  }

  removeEntity(project, group.id);
  return childIds.map((id) => getEntity(project, id)).filter(Boolean);
};

export const boxGeometry = (width = 100, depth = 100, height = 100) => {
  const x = width / 2;
  const y = depth / 2;
  return {
    vertices: [
      -x, -y, 0,
      x, -y, 0,
      x, y, 0,
      -x, y, 0,
      -x, -y, height,
      x, -y, height,
      x, y, height,
      -x, y, height
    ],
    indices: [
      0, 2, 1, 0, 3, 2,
      4, 5, 6, 4, 6, 7,
      0, 1, 5, 0, 5, 4,
      1, 2, 6, 1, 6, 5,
      2, 3, 7, 2, 7, 6,
      3, 0, 4, 3, 4, 7
    ]
  };
};

export const createBoxEntity = (width = 100, depth = 100, height = 100, name = "Box") => {
  const geometry = boxGeometry(width, depth, height);
  return createMeshEntity({
    name,
    ...geometry,
    metadata: { primitive: "box", dimensions: [width, depth, height], solid: true }
  });
};

const PROFILE_INDEX_EPSILON = 0.000001;

const profileNormal = (points, suppliedNormal = null) => {
  if (suppliedNormal && Math.hypot(...suppliedNormal) > EPSILON) {
    return normalize3(suppliedNormal);
  }
  for (let index = 3; index < points.length - 3; index += 3) {
    const first = [points[0], points[1], points[2]];
    const second = [points[index], points[index + 1], points[index + 2]];
    const third = [points[index + 3], points[index + 4], points[index + 5]];
    const normal = normalize3(cross3(subtract3(second, first), subtract3(third, first)));
    if (Math.hypot(...normal) > EPSILON) {
      return normal;
    }
  }
  throw new Error("The profile has no usable plane.");
};

const profileCoordinates = (points, normal) => {
  const dropAxis = Math.abs(normal[0]) >= Math.abs(normal[1]) && Math.abs(normal[0]) >= Math.abs(normal[2]) ? 0 : Math.abs(normal[1]) >= Math.abs(normal[2]) ? 1 : 2;
  const coordinates = [];
  for (let index = 0; index < points.length; index += 3) {
    if (dropAxis === 0) {
      coordinates.push([points[index + 1], points[index + 2]]);
    } else if (dropAxis === 1) {
      coordinates.push([points[index], points[index + 2]]);
    } else {
      coordinates.push([points[index], points[index + 1]]);
    }
  }
  return coordinates;
};

const signedProfileArea = (coordinates) => {
  let area = 0;
  const count = coordinates.length;
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    area += coordinates[index][0] * coordinates[next][1] - coordinates[next][0] * coordinates[index][1];
  }
  return area / 2;
};

const pointInTriangle2d = (point, a, b, c) => {
  const cross = (first, second, third) => (
    (second[0] - first[0]) * (third[1] - first[1]) - (second[1] - first[1]) * (third[0] - first[0])
  );
  const first = cross(a, b, point);
  const second = cross(b, c, point);
  const third = cross(c, a, point);
  const hasNegative = first < -PROFILE_INDEX_EPSILON || second < -PROFILE_INDEX_EPSILON || third < -PROFILE_INDEX_EPSILON;
  const hasPositive = first > PROFILE_INDEX_EPSILON || second > PROFILE_INDEX_EPSILON || third > PROFILE_INDEX_EPSILON;
  return !(hasNegative && hasPositive);
};

const triangulateProfile = (points, suppliedNormal = null) => {
  const count = points.length / 3;
  if (count < 3) {
    throw new Error("A profile needs at least three points.");
  }
  const normal = profileNormal(points, suppliedNormal);
  const positions = profileCoordinates(points, normal);
  const winding = signedProfileArea(positions);
  if (Math.abs(winding) <= PROFILE_INDEX_EPSILON) {
    throw new Error("The profile has no area.");
  }
  const remaining = Array.from({ length: count }, (_, index) => index);
  const indices = [];
  const isConvex = (previous, current, next) => {
    const cross = (positions[current][0] - positions[previous][0]) * (positions[next][1] - positions[current][1]) - (positions[current][1] - positions[previous][1]) * (positions[next][0] - positions[current][0]);
    return winding > 0 ? cross > PROFILE_INDEX_EPSILON : cross < -PROFILE_INDEX_EPSILON;
  };
  while (remaining.length > 3) {
    let earFound = false;
    for (let index = 0; index < remaining.length; index += 1) {
      const previous = remaining[(index - 1 + remaining.length) % remaining.length];
      const current = remaining[index];
      const next = remaining[(index + 1) % remaining.length];
      if (!isConvex(previous, current, next)) {
        continue;
      }
      const containsPoint = remaining.some((candidate) => candidate !== previous && candidate !== current && candidate !== next && pointInTriangle2d(positions[candidate], positions[previous], positions[current], positions[next]));
      if (containsPoint) {
        continue;
      }
      indices.push(previous, current, next);
      remaining.splice(index, 1);
      earFound = true;
      break;
    }
    if (!earFound) {
      throw new Error("The profile is self-intersecting or cannot be triangulated.");
    }
  }
  indices.push(remaining[0], remaining[1], remaining[2]);
  return indices;
};

const profilePlaneCoordinates = (points, normal) => {
  const { tangent, bitangent } = planeBasis(normal);
  const coordinates = [];
  for (let index = 0; index < points.length; index += 3) {
    const point = [points[index], points[index + 1], points[index + 2]];
    coordinates.push([dot3(point, tangent), dot3(point, bitangent)]);
  }
  return coordinates;
};

const ringVertex = (points, index) => [points[index * 3], points[index * 3 + 1], points[index * 3 + 2]];

const appendOrientedTriangle = (indices, vertices, first, second, third, normal) => {
  const a = ringVertex(vertices, first);
  const b = ringVertex(vertices, second);
  const c = ringVertex(vertices, third);
  const winding = dot3(cross3(subtract3(b, a), subtract3(c, a)), normal);
  if (winding >= 0) {
    indices.push(first, second, third);
  } else {
    indices.push(first, third, second);
  }
};

const earNode = (index, x, y) => ({ index, x, y, prev: null, next: null, steiner: false });

const insertEarNode = (index, x, y, last) => {
  const node = earNode(index, x, y);
  if (!last) {
    node.prev = node;
    node.next = node;
  } else {
    node.next = last.next;
    node.prev = last;
    last.next.prev = node;
    last.next = node;
  }
  return node;
};

const removeEarNode = (node) => {
  node.next.prev = node.prev;
  node.prev.next = node.next;
};

const earArea = (first, second, third) => (
  (second.y - first.y) * (third.x - second.x) - (second.x - first.x) * (third.y - second.y)
);

const earEquals = (first, second) => first.x === second.x && first.y === second.y;

const earLinkedList = (data, start, end, clockwise) => {
  let last = null;
  if (clockwise === (earSignedArea(data, start, end) > 0)) {
    for (let index = start; index < end; index += 1) {
      last = insertEarNode(index, data[index][0], data[index][1], last);
    }
  } else {
    for (let index = end - 1; index >= start; index -= 1) {
      last = insertEarNode(index, data[index][0], data[index][1], last);
    }
  }
  if (last && earEquals(last, last.next)) {
    removeEarNode(last);
    last = last.next;
  }
  return last;
};

const earSignedArea = (data, start, end) => {
  let area = 0;
  for (let index = start, previous = end - 1; index < end; previous = index, index += 1) {
    area += (data[previous][0] - data[index][0]) * (data[index][1] + data[previous][1]);
  }
  return area;
};

const filterEarPoints = (start, end = null) => {
  if (!start) {
    return start;
  }
  let point = start;
  let boundary = end ?? start;
  let changed = false;
  do {
    changed = false;
    if (!point.steiner && (earEquals(point, point.next) || Math.abs(earArea(point.prev, point, point.next)) < PROFILE_INDEX_EPSILON)) {
      removeEarNode(point);
      point = boundary = point.prev;
      if (point === point.next) {
        break;
      }
      changed = true;
    } else {
      point = point.next;
    }
  } while (changed || point !== boundary);
  return boundary;
};

const pointInEarTriangle = (ax, ay, bx, by, cx, cy, px, py) => (
  (cx - px) * (ay - py) >= (ax - px) * (cy - py) &&
  (ax - px) * (by - py) >= (bx - px) * (ay - py) &&
  (bx - px) * (cy - py) >= (cx - px) * (by - py)
);

const isEar = (ear) => {
  const previous = ear.prev;
  const next = ear.next;
  if (earArea(previous, ear, next) >= -PROFILE_INDEX_EPSILON) {
    return false;
  }
  let point = ear.next.next;
  while (point !== ear.prev) {
    if (
      pointInEarTriangle(previous.x, previous.y, ear.x, ear.y, next.x, next.y, point.x, point.y) &&
      earArea(point.prev, point, point.next) >= -PROFILE_INDEX_EPSILON
    ) {
      return false;
    }
    point = point.next;
  }
  return true;
};

const earLocallyInside = (first, second) => (
  earArea(first.prev, first, first.next) < 0
    ? earArea(first, second, first.next) >= 0 && earArea(first, first.prev, second) >= 0
    : earArea(first, second, first.prev) < 0 || earArea(first, first.next, second) < 0
);

const earSectorContainsSector = (first, second) => (
  earArea(first.prev, first, second.prev) < 0 && earArea(second.next, first, first.next) < 0
);

const splitEarPolygon = (first, second) => {
  const firstCopy = earNode(first.index, first.x, first.y);
  const secondCopy = earNode(second.index, second.x, second.y);
  const firstNext = first.next;
  const secondPrevious = second.prev;
  first.next = second;
  second.prev = first;
  firstCopy.next = firstNext;
  firstNext.prev = firstCopy;
  secondCopy.next = firstCopy;
  firstCopy.prev = secondCopy;
  secondPrevious.next = secondCopy;
  secondCopy.prev = secondPrevious;
  return secondCopy;
};

const earLeftmost = (start) => {
  let point = start;
  let leftmost = start;
  do {
    if (point.x < leftmost.x || (point.x === leftmost.x && point.y < leftmost.y)) {
      leftmost = point;
    }
    point = point.next;
  } while (point !== start);
  return leftmost;
};

const findEarHoleBridge = (hole, outer) => {
  const holeX = hole.x;
  const holeY = hole.y;
  let point = outer;
  let bridgeX = -Infinity;
  let bridge = null;
  do {
    if (holeY <= point.y && holeY >= point.next.y && point.next.y !== point.y) {
      const deltaY = point.next.y - point.y;
      const x = point.x + ((holeY - point.y) * (point.next.x - point.x)) / deltaY;
      if (x <= holeX && x > bridgeX) {
        bridgeX = x;
        bridge = point.x < point.next.x ? point : point.next;
        if (Math.abs(x - holeX) < PROFILE_INDEX_EPSILON) {
          return bridge;
        }
      }
    }
    point = point.next;
  } while (point !== outer);
  if (!bridge) {
    return null;
  }
  const stop = bridge;
  const bridgeXPosition = bridge.x;
  const bridgeYPosition = bridge.y;
  let minimumTangent = Infinity;
  point = bridge;
  do {
    const inTriangle = pointInEarTriangle(
      holeY < bridgeYPosition ? holeX : bridgeX,
      holeY,
      bridgeXPosition,
      bridgeYPosition,
      bridgeX,
      holeY,
      point.x,
      point.y
    );
    if (holeX >= point.x && point.x >= bridgeXPosition && Math.abs(holeX - point.x) > PROFILE_INDEX_EPSILON && inTriangle) {
      const tangent = Math.abs(holeY - point.y) / (holeX - point.x);
      if (earLocallyInside(point, hole) && (
        tangent < minimumTangent ||
        (Math.abs(tangent - minimumTangent) < PROFILE_INDEX_EPSILON && (point.x > bridge.x || (Math.abs(point.x - bridge.x) < PROFILE_INDEX_EPSILON && earSectorContainsSector(bridge, point))))
      )) {
        bridge = point;
        minimumTangent = tangent;
      }
    }
    point = point.next;
  } while (point !== stop);
  return bridge;
};

const eliminateEarHoles = (data, holes, outer) => {
  const queue = holes.map(({ start, end }) => earLinkedList(data, start, end, false)).filter(Boolean).map(earLeftmost).sort((first, second) => first.x - second.x);
  let result = outer;
  for (const hole of queue) {
    const bridge = findEarHoleBridge(hole, result);
    if (!bridge) {
      throw new Error("The profile hole cannot be connected to its outer boundary.");
    }
    const bridgeCopy = splitEarPolygon(bridge, hole);
    filterEarPoints(bridgeCopy, bridgeCopy.next);
    result = filterEarPoints(bridge, bridge.next);
  }
  return result;
};

const earOnSegment = (first, point, second) => (
  point.x <= Math.max(first.x, second.x) && point.x >= Math.min(first.x, second.x) &&
  point.y <= Math.max(first.y, second.y) && point.y >= Math.min(first.y, second.y)
);

const earSign = (value) => value > PROFILE_INDEX_EPSILON ? 1 : value < -PROFILE_INDEX_EPSILON ? -1 : 0;

const earIntersects = (firstStart, firstEnd, secondStart, secondEnd) => {
  const first = earSign(earArea(firstStart, firstEnd, secondStart));
  const second = earSign(earArea(firstStart, firstEnd, secondEnd));
  const third = earSign(earArea(secondStart, secondEnd, firstStart));
  const fourth = earSign(earArea(secondStart, secondEnd, firstEnd));
  if (first !== second && third !== fourth) {
    return true;
  }
  return (first === 0 && earOnSegment(firstStart, secondStart, firstEnd)) ||
    (second === 0 && earOnSegment(firstStart, secondEnd, firstEnd)) ||
    (third === 0 && earOnSegment(secondStart, firstStart, secondEnd)) ||
    (fourth === 0 && earOnSegment(secondStart, firstEnd, secondEnd));
};

const earIntersectsPolygon = (first, second) => {
  let point = first;
  do {
    if (point.index !== first.index && point.next.index !== first.index && point.index !== second.index && point.next.index !== second.index && earIntersects(point, point.next, first, second)) {
      return true;
    }
    point = point.next;
  } while (point !== first);
  return false;
};

const earMiddleInside = (first, second) => {
  let point = first;
  let inside = false;
  const x = (first.x + second.x) / 2;
  const y = (first.y + second.y) / 2;
  do {
    if ((point.y > y) !== (point.next.y > y) && x < ((point.next.x - point.x) * (y - point.y)) / (point.next.y - point.y) + point.x) {
      inside = !inside;
    }
    point = point.next;
  } while (point !== first);
  return inside;
};

const earIsValidDiagonal = (first, second) => (
  first.next.index !== second.index && first.prev.index !== second.index &&
  !earIntersectsPolygon(first, second) &&
  ((earLocallyInside(first, second) && earLocallyInside(second, first) && earMiddleInside(first, second) &&
    (Math.abs(earArea(first.prev, first, second.prev)) > PROFILE_INDEX_EPSILON || Math.abs(earArea(first, second.prev, second)) > PROFILE_INDEX_EPSILON)) ||
    (earEquals(first, second) && earArea(first.prev, first, first.next) > PROFILE_INDEX_EPSILON && earArea(second.prev, second, second.next) > PROFILE_INDEX_EPSILON))
);

const cureEarLocalIntersections = (start, triangles) => {
  let point = start;
  do {
    const first = point.prev;
    const second = point.next.next;
    if (!earEquals(first, second) && earIntersects(first, point, point.next, second) && earLocallyInside(first, second) && earLocallyInside(second, first)) {
      triangles.push(first.index, point.index, second.index);
      removeEarNode(point);
      removeEarNode(point.next);
      point = start = second;
    }
    point = point.next;
  } while (point !== start);
  return filterEarPoints(point);
};

const splitEarcut = (start, triangles) => {
  let first = start;
  do {
    let second = first.next.next;
    while (second !== first.prev) {
      if (first.index !== second.index && earIsValidDiagonal(first, second)) {
        const split = splitEarPolygon(first, second);
        const firstRing = filterEarPoints(first, first.next);
        const secondRing = filterEarPoints(split, split.next);
        earcutLinked(firstRing, triangles, 0);
        earcutLinked(secondRing, triangles, 0);
        return;
      }
      second = second.next;
    }
    first = first.next;
  } while (first !== start);
};

const earcutLinked = (ear, triangles, pass) => {
  if (!ear) {
    return;
  }
  let stop = ear;
  while (ear.prev !== ear.next) {
    const previous = ear.prev;
    const next = ear.next;
    if (isEar(ear)) {
      triangles.push(previous.index, ear.index, next.index);
      removeEarNode(ear);
      ear = next.next;
      stop = next.next;
      continue;
    }
    ear = next;
    if (ear === stop) {
      if (pass === 0) {
        earcutLinked(filterEarPoints(ear), triangles, 1);
      } else if (pass === 1) {
        earcutLinked(cureEarLocalIntersections(filterEarPoints(ear), triangles), triangles, 2);
      } else if (pass === 2) {
        splitEarcut(ear, triangles);
      }
      return;
    }
  }
};

const earcutProfile = (coordinates, holes) => {
  const outerEnd = holes.length > 0 ? holes[0].start : coordinates.length;
  let ear = earLinkedList(coordinates, 0, outerEnd, true);
  if (!ear || ear.next === ear.prev) {
    throw new Error("The profile cannot be triangulated.");
  }
  if (holes.length > 0) {
    ear = eliminateEarHoles(coordinates, holes, ear);
  }
  const triangles = [];
  earcutLinked(ear, triangles, 0);
  if (triangles.length === 0) {
    throw new Error("The profile holes cannot be triangulated.");
  }
  return triangles;
};

const triangulateProfileWithHoles = (points, holes, normal) => {
  const coordinates = [];
  const ranges = [];
  const rings = [points, ...holes];
  let offset = 0;
  for (const ring of rings) {
    const ringCoordinates = profilePlaneCoordinates(ring, normal);
    if (ringCoordinates.length < 3 || Math.abs(signedProfileArea(ringCoordinates)) <= PROFILE_INDEX_EPSILON) {
      throw new Error("A profile hole has no usable area.");
    }
    coordinates.push(...ringCoordinates);
    ranges.push({ start: offset, end: offset + ringCoordinates.length });
    offset += ringCoordinates.length;
  }
  return earcutProfile(coordinates, ranges.slice(1));
};

export const createProfileEntity = (points, name = "Face", normal = null) => {
  if (points.length < 9) {
    throw new Error("A face needs at least three points.");
  }

  const resolvedNormal = profileNormal(points, normal);
  const geometry = { vertices: Array.from(points), indices: triangulateProfile(points, resolvedNormal) };
  return createMeshEntity({
    name,
    ...geometry,
    metadata: { primitive: "profile", profilePoints: Array.from(points), profileNormal: resolvedNormal, planar: true, solid: false }
  });
};

export const planeBasis = (normal) => {
  const resolvedNormal = normalize3(normal);
  const reference = Math.abs(resolvedNormal[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const tangent = normalize3(cross3(reference, resolvedNormal));
  return { tangent, bitangent: normalize3(cross3(resolvedNormal, tangent)) };
};

export const createRectangleEntity = (start, end, normal = [0, 0, 1]) => {
  const { tangent, bitangent } = planeBasis(normal);
  const delta = subtract3(end, start);
  const width = dot3(delta, tangent);
  const depth = dot3(delta, bitangent);
  const widthPoint = add3(start, scale3(tangent, width));
  const corner = add3(widthPoint, scale3(bitangent, depth));
  const depthPoint = add3(start, scale3(bitangent, depth));
  return createProfileEntity([
    ...start,
    ...widthPoint,
    ...corner,
    ...depthPoint
  ], "Rectangle", normal);
};

export const createCircleEntity = (center, radius, segments = 32, name = "Circle", normal = [0, 0, 1]) => {
  const points = [];
  const count = Math.max(3, Math.round(segments));
  const { tangent, bitangent } = planeBasis(normal);

  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    const point = add3(center, add3(scale3(tangent, Math.cos(angle) * radius), scale3(bitangent, Math.sin(angle) * radius)));
    points.push(...point);
  }

  const entity = createProfileEntity(points, name, normal);
  entity.metadata.segments = count;
  entity.metadata.radius = radius;
  entity.metadata.center = Array.from(center);
  return entity;
};

export const createPolygonEntity = (center, radius, sides = 6, normal = [0, 0, 1]) => createCircleEntity(center, radius, Math.max(3, sides), `${Math.max(3, sides)}-sided Polygon`, normal);

export const createArcEntity = (center, start, end, segments = 16, normal = [0, 0, 1]) => {
  const { tangent, bitangent } = planeBasis(normal);
  const startVector = subtract3(start, center);
  const endVector = subtract3(end, center);
  const radius = distance3(center, start);
  const startAngle = Math.atan2(dot3(startVector, bitangent), dot3(startVector, tangent));
  let endAngle = Math.atan2(dot3(endVector, bitangent), dot3(endVector, tangent));

  while (endAngle <= startAngle) {
    endAngle += Math.PI * 2;
  }

  const points = [];
  for (let index = 0; index <= segments; index += 1) {
    const angle = startAngle + ((endAngle - startAngle) * index) / segments;
    points.push(...add3(center, add3(scale3(tangent, Math.cos(angle) * radius), scale3(bitangent, Math.sin(angle) * radius))));
  }
  return createEdgeEntity({ name: "Arc", points, metadata: { primitive: "arc", center, radius } });
};

export const createPrismGeometry = (points, height, normal = [0, 0, 1], holes = []) => {
  const count = points.length / 3;
  if (count < 3) {
    throw new Error("A profile needs at least three points to extrude.");
  }

  const direction = normalize3(normal);
  const validHoles = holes.filter((hole) => Array.isArray(hole) && hole.length >= 9);
  if (validHoles.length > 0) {
    const rings = [points, ...validHoles];
    const bottom = rings.flatMap((ring) => Array.from(ring));
    const vertexCount = bottom.length / 3;
    const vertices = Array.from(bottom);
    for (let index = 0; index < vertexCount; index += 1) {
      vertices.push(
        bottom[index * 3] + direction[0] * height,
        bottom[index * 3 + 1] + direction[1] * height,
        bottom[index * 3 + 2] + direction[2] * height
      );
    }
    const indices = [];
    const capIndices = triangulateProfileWithHoles(points, validHoles, direction);
    const heightDirection = height >= 0 ? direction : scale3(direction, -1);
    for (let index = 0; index < capIndices.length; index += 3) {
      appendOrientedTriangle(indices, vertices, capIndices[index], capIndices[index + 1], capIndices[index + 2], scale3(heightDirection, -1));
      appendOrientedTriangle(indices, vertices, vertexCount + capIndices[index], vertexCount + capIndices[index + 1], vertexCount + capIndices[index + 2], heightDirection);
    }
    let ringOffset = 0;
    for (let ringIndex = 0; ringIndex < rings.length; ringIndex += 1) {
      const ring = rings[ringIndex];
      const ringCount = ring.length / 3;
      const winding = Math.sign(signedProfileArea(profilePlaneCoordinates(ring, direction))) || 1;
      for (let index = 0; index < ringCount; index += 1) {
        const next = (index + 1) % ringCount;
        const first = ringOffset + index;
        const second = ringOffset + next;
        const edge = subtract3(ringVertex(vertices, second), ringVertex(vertices, first));
        const sideNormal = scale3(cross3(edge, direction), winding * (ringIndex === 0 ? 1 : -1));
        appendOrientedTriangle(indices, vertices, first, second, vertexCount + second, sideNormal);
        appendOrientedTriangle(indices, vertices, first, vertexCount + second, vertexCount + first, sideNormal);
      }
      ringOffset += ringCount;
    }
    return { vertices, indices };
  }
  const vertices = Array.from(points);
  for (let index = 0; index < count; index += 1) {
    vertices.push(
      points[index * 3] + direction[0] * height,
      points[index * 3 + 1] + direction[1] * height,
      points[index * 3 + 2] + direction[2] * height
    );
  }

  const profileIndices = triangulateProfile(points, direction);
  const indices = [];
  for (let index = 0; index < profileIndices.length; index += 3) {
    indices.push(profileIndices[index], profileIndices[index + 2], profileIndices[index + 1]);
    indices.push(count + profileIndices[index], count + profileIndices[index + 1], count + profileIndices[index + 2]);
  }

  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    indices.push(index, next, count + next);
    indices.push(index, count + next, count + index);
  }

  return { vertices, indices };
};

export const createSweepGeometry = (points, vector) => {
  const count = points.length / 3;
  if (count < 3) {
    throw new Error("A profile needs at least three points to sweep.");
  }
  if (Math.hypot(vector[0], vector[1], vector[2]) < EPSILON) {
    throw new Error("The Follow Me path must have length.");
  }

  const vertices = Array.from(points);
  for (let index = 0; index < count; index += 1) {
    vertices.push(
      points[index * 3] + vector[0],
      points[index * 3 + 1] + vector[1],
      points[index * 3 + 2] + vector[2]
    );
  }

  const profileIndices = triangulateProfile(points);
  const indices = [];
  for (let index = 0; index < profileIndices.length; index += 3) {
    indices.push(profileIndices[index], profileIndices[index + 2], profileIndices[index + 1]);
    indices.push(count + profileIndices[index], count + profileIndices[index + 1], count + profileIndices[index + 2]);
  }
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    indices.push(index, next, count + next);
    indices.push(index, count + next, count + index);
  }
  return { vertices, indices };
};

export const extrudeProfile = (entity, height, holes = []) => {
  if (entity.kind !== "mesh" || !entity.metadata?.profilePoints) {
    throw new Error("Push/Pull needs a planar face created with a drawing tool.");
  }

  const geometry = createPrismGeometry(entity.metadata.profilePoints, height, entity.metadata.profileNormal ?? [0, 0, 1], holes);
  entity.vertices = geometry.vertices;
  entity.indices = geometry.indices;
  entity.name = entity.name.replace(/^(Extruded )?/, "Extruded ");
  entity.metadata = {
    ...entity.metadata,
    primitive: "extrusion",
    extrusionHeight: height,
    holeCount: holes.length,
    solid: true,
    planar: false
  };
  return entity;
};

export const sweepProfile = (entity, vector) => {
  if (entity.kind !== "mesh" || !entity.metadata?.profilePoints) {
    throw new Error("Follow Me needs a planar face created with a drawing tool.");
  }
  const geometry = createSweepGeometry(entity.metadata.profilePoints, vector);
  entity.vertices = geometry.vertices;
  entity.indices = geometry.indices;
  entity.name = `Follow Me ${entity.name.replace(/^Follow Me /, "")}`;
  entity.metadata = {
    ...entity.metadata,
    primitive: "follow-me",
    sweepVector: Array.from(vector),
    solid: true,
    planar: false
  };
  return entity;
};

export const offsetProfile = (entity, distance) => {
  if (entity.kind !== "mesh" || !entity.metadata?.profilePoints) {
    throw new Error("Offset needs a planar face created with a drawing tool.");
  }

  const points = entity.metadata.profilePoints;
  const count = points.length / 3;
  const center = [0, 0, 0];
  for (let index = 0; index < count; index += 1) {
    center[0] += points[index * 3];
    center[1] += points[index * 3 + 1];
    center[2] += points[index * 3 + 2];
  }
  center[0] /= count;
  center[1] /= count;
  center[2] /= count;

  const offsetPoints = [];
  for (let index = 0; index < count; index += 1) {
    const point = [points[index * 3], points[index * 3 + 1], points[index * 3 + 2]];
    const direction = normalize3(subtract3(point, center));
    offsetPoints.push(...add3(point, scale3(direction, distance)));
  }
  return createProfileEntity(offsetPoints, `Offset ${entity.name}`);
};

export const cylinderGeometry = (radius = 50, height = 100, segments = 32) => {
  const points = [];
  const count = Math.max(3, Math.round(segments));
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    points.push(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
  }
  return createPrismGeometry(points, height);
};

export const createCylinderEntity = (radius = 50, height = 100, segments = 32, name = "Cylinder") => createMeshEntity({
  name,
  ...cylinderGeometry(radius, height, segments),
  metadata: { primitive: "cylinder", radius, height, segments, solid: true }
});

export const createGrid = (extent = 1000, increment = 50) => {
  const points = [];
  for (let coordinate = -extent; coordinate <= extent; coordinate += increment) {
    points.push(-extent, coordinate, 0, extent, coordinate, 0);
    points.push(coordinate, -extent, 0, coordinate, extent, 0);
  }
  return points;
};

export const entityWorldMatrix = (project, entity) => {
  let matrix = mat4FromTransform(entity.transform);
  let parent = entity.parentId ? getEntity(project, entity.parentId) : null;
  const visited = new Set([entity.id]);
  while (parent) {
    if (visited.has(parent.id)) {
      throw new Error("The project contains a cyclic group hierarchy.");
    }
    visited.add(parent.id);
    matrix = mat4Multiply(mat4FromTransform(parent.transform), matrix);
    parent = parent.parentId ? getEntity(project, parent.parentId) : null;
  }
  return matrix;
};

const pointOnProfileSegment = (point, start, end) => {
  const cross = (end[0] - start[0]) * (point[1] - start[1]) - (end[1] - start[1]) * (point[0] - start[0]);
  if (Math.abs(cross) > PROFILE_INDEX_EPSILON) {
    return false;
  }
  return point[0] >= Math.min(start[0], end[0]) - PROFILE_INDEX_EPSILON &&
    point[0] <= Math.max(start[0], end[0]) + PROFILE_INDEX_EPSILON &&
    point[1] >= Math.min(start[1], end[1]) - PROFILE_INDEX_EPSILON &&
    point[1] <= Math.max(start[1], end[1]) + PROFILE_INDEX_EPSILON;
};

const pointInsideProfile = (point, profile) => {
  let inside = false;
  for (let index = 0, previous = profile.length - 1; index < profile.length; previous = index, index += 1) {
    const start = profile[previous];
    const end = profile[index];
    if (pointOnProfileSegment(point, start, end)) {
      return false;
    }
    const crosses = (start[1] > point[1]) !== (end[1] > point[1]);
    if (crosses && point[0] < ((end[0] - start[0]) * (point[1] - start[1])) / (end[1] - start[1]) + start[0]) {
      inside = !inside;
    }
  }
  return inside;
};

const profileSegmentsIntersect = (firstStart, firstEnd, secondStart, secondEnd) => {
  const orientation = (first, second, third) => (
    (second[0] - first[0]) * (third[1] - first[1]) - (second[1] - first[1]) * (third[0] - first[0])
  );
  const first = orientation(firstStart, firstEnd, secondStart);
  const second = orientation(firstStart, firstEnd, secondEnd);
  const third = orientation(secondStart, secondEnd, firstStart);
  const fourth = orientation(secondStart, secondEnd, firstEnd);
  if (((first > PROFILE_INDEX_EPSILON && second < -PROFILE_INDEX_EPSILON) || (first < -PROFILE_INDEX_EPSILON && second > PROFILE_INDEX_EPSILON)) &&
    ((third > PROFILE_INDEX_EPSILON && fourth < -PROFILE_INDEX_EPSILON) || (third < -PROFILE_INDEX_EPSILON && fourth > PROFILE_INDEX_EPSILON))) {
    return true;
  }
  return pointOnProfileSegment(firstStart, secondStart, secondEnd) ||
    pointOnProfileSegment(firstEnd, secondStart, secondEnd) ||
    pointOnProfileSegment(secondStart, firstStart, firstEnd) ||
    pointOnProfileSegment(secondEnd, firstStart, firstEnd);
};

const profilesIntersect = (first, second) => {
  for (let firstIndex = 0; firstIndex < first.length; firstIndex += 1) {
    const firstNext = (firstIndex + 1) % first.length;
    for (let secondIndex = 0; secondIndex < second.length; secondIndex += 1) {
      const secondNext = (secondIndex + 1) % second.length;
      if (profileSegmentsIntersect(first[firstIndex], first[firstNext], second[secondIndex], second[secondNext])) {
        return true;
      }
    }
  }
  return false;
};

const transformedProfilePoints = (project, entity) => {
  const matrix = entityWorldMatrix(project, entity);
  const points = [];
  for (let index = 0; index < entity.metadata.profilePoints.length; index += 3) {
    points.push(...transformPoint(matrix, [
      entity.metadata.profilePoints[index],
      entity.metadata.profilePoints[index + 1],
      entity.metadata.profilePoints[index + 2]
    ]));
  }
  return points;
};

export const nestedProfileHoles = (project, outer) => {
  if (outer.kind !== "mesh" || !outer.metadata?.planar || !Array.isArray(outer.metadata.profilePoints) || !Array.isArray(outer.metadata.profileNormal)) {
    return [];
  }
  const outerMatrix = entityWorldMatrix(project, outer);
  const inverseOuterMatrix = mat4Invert(outerMatrix);
  if (!inverseOuterMatrix) {
    return [];
  }
  const outerNormal = normalize3(transformDirection(outerMatrix, outer.metadata.profileNormal));
  const outerOrigin = transformPoint(outerMatrix, [
    outer.metadata.profilePoints[0],
    outer.metadata.profilePoints[1],
    outer.metadata.profilePoints[2]
  ]);
  const outerCoordinates = profilePlaneCoordinates(outer.metadata.profilePoints, outer.metadata.profileNormal);
  const accepted = [];

  for (const candidate of project.entities) {
    if (candidate.id === outer.id || candidate.kind !== "mesh" || !candidate.metadata?.planar || !Array.isArray(candidate.metadata.profilePoints) || !Array.isArray(candidate.metadata.profileNormal) || !isEntityVisible(project, candidate)) {
      continue;
    }
    const candidateMatrix = entityWorldMatrix(project, candidate);
    const candidateNormal = normalize3(transformDirection(candidateMatrix, candidate.metadata.profileNormal));
    if (Math.abs(dot3(outerNormal, candidateNormal)) < 0.9999) {
      continue;
    }
    const worldPoints = transformedProfilePoints(project, candidate);
    if (worldPoints.some((_, index) => index % 3 === 0 && Math.abs(dot3(outerNormal, subtract3([worldPoints[index], worldPoints[index + 1], worldPoints[index + 2]], outerOrigin))) > 0.001)) {
      continue;
    }
    const localPoints = [];
    for (let index = 0; index < worldPoints.length; index += 3) {
      localPoints.push(...transformPoint(inverseOuterMatrix, [worldPoints[index], worldPoints[index + 1], worldPoints[index + 2]]));
    }
    const coordinates = profilePlaneCoordinates(localPoints, outer.metadata.profileNormal);
    if (!coordinates.every((point) => pointInsideProfile(point, outerCoordinates)) || profilesIntersect(coordinates, outerCoordinates) || accepted.some((hole) => profilesIntersect(coordinates, hole.coordinates) || pointInsideProfile(coordinates[0], hole.coordinates) || pointInsideProfile(hole.coordinates[0], coordinates))) {
      continue;
    }
    accepted.push({ entityId: candidate.id, points: localPoints, coordinates });
  }

  return accepted.map(({ entityId, points }) => ({ entityId, points }));
};

export const localPointAt = (points, index) => [points[index * 3], points[index * 3 + 1], points[index * 3 + 2]];

export const meshWorldVertices = (project, entity) => {
  const matrix = entityWorldMatrix(project, entity);
  const vertices = [];
  for (let index = 0; index < entity.vertices.length; index += 3) {
    vertices.push(...transformPoint(matrix, [entity.vertices[index], entity.vertices[index + 1], entity.vertices[index + 2]]));
  }
  return vertices;
};

export const meshWorldTriangleIterator = function* (project, entity) {
  if (entity.kind !== "mesh") {
    return;
  }
  const matrix = entityWorldMatrix(project, entity);
  const pointAt = (vertexIndex) => {
    const offset = vertexIndex * 3;
    return transformPoint(matrix, [entity.vertices[offset], entity.vertices[offset + 1], entity.vertices[offset + 2]]);
  };
  for (let index = 0; index < entity.indices.length; index += 3) {
    yield [pointAt(entity.indices[index]), pointAt(entity.indices[index + 1]), pointAt(entity.indices[index + 2])];
  }
};

export const lineWorldPoints = (project, entity) => {
  const matrix = entityWorldMatrix(project, entity);
  const points = [];
  for (let index = 0; index < entity.points.length; index += 3) {
    points.push(...transformPoint(matrix, [entity.points[index], entity.points[index + 1], entity.points[index + 2]]));
  }
  return points;
};

export const annotationWorldPoints = lineWorldPoints;

export const allRenderableEntities = (project) => project.entities.filter((entity) => (
  (entity.kind === "mesh" || entity.kind === "edge" || entity.kind === "annotation" || entity.kind === "section") &&
  isEntityVisible(project, entity)
));

const meshPointKey = (point) => point.map((value) => Math.round(value * 1000000)).join(":");

export const meshEdgeKey = (start, end) => {
  const first = meshPointKey(start);
  const second = meshPointKey(end);
  return first < second ? `${first}|${second}` : `${second}|${first}`;
};

export const edgeIndicesForMesh = (vertices, indices) => {
  const edges = new Map();
  for (let offset = 0; offset < indices.length; offset += 3) {
    const triangle = [indices[offset], indices[offset + 1], indices[offset + 2]];
    const points = triangle.map((vertexIndex) => localPointAt(vertices, vertexIndex));
    const normal = normalize3(cross3(subtract3(points[1], points[0]), subtract3(points[2], points[0])));
    for (let edge = 0; edge < 3; edge += 1) {
      const first = triangle[edge];
      const second = triangle[(edge + 1) % 3];
      const key = meshEdgeKey(points[edge], points[(edge + 1) % 3]);
      const record = edges.get(key) ?? { indices: [first, second], normals: [] };
      record.normals.push(normal);
      edges.set(key, record);
    }
  }

  return Array.from(edges.values())
    .filter((edge) => edge.normals.length === 1 || edge.normals.some((normal) => dot3(normal, edge.normals[0]) < 0.9999))
    .flatMap((edge) => edge.indices);
};

export const getMeshFaceRegion = (project, entity, triangleIndex) => {
  if (entity.kind !== "mesh" || !Number.isInteger(triangleIndex) || triangleIndex < 0 || triangleIndex >= entity.indices.length / 3) {
    return null;
  }
  const triangleCount = entity.indices.length / 3;
  const worldVertices = meshWorldVertices(project, entity);
  const trianglePoints = (index) => {
    const offset = index * 3;
    return [
      localPointAt(worldVertices, entity.indices[offset]),
      localPointAt(worldVertices, entity.indices[offset + 1]),
      localPointAt(worldVertices, entity.indices[offset + 2])
    ];
  };
  const [seedA, seedB, seedC] = trianglePoints(triangleIndex);
  const seedNormal = normalize3(cross3(subtract3(seedB, seedA), subtract3(seedC, seedA)));
  if (Math.hypot(...seedNormal) < EPSILON) {
    return null;
  }
  const vertexKey = (vertexIndex) => {
    const point = localPointAt(worldVertices, vertexIndex);
    return point.map((value) => Math.round(value * 1000000)).join(":");
  };
  const edgeKey = (first, second) => {
    const firstKey = vertexKey(first);
    const secondKey = vertexKey(second);
    return firstKey < secondKey ? `${firstKey}|${secondKey}` : `${secondKey}|${firstKey}`;
  };
  const edges = new Map();
  for (let index = 0; index < triangleCount; index += 1) {
    const offset = index * 3;
    const triangle = [entity.indices[offset], entity.indices[offset + 1], entity.indices[offset + 2]];
    for (let edge = 0; edge < 3; edge += 1) {
      const key = edgeKey(triangle[edge], triangle[(edge + 1) % 3]);
      const connected = edges.get(key) ?? [];
      connected.push(index);
      edges.set(key, connected);
    }
  }
  const isCoplanar = (index) => {
    const [a, b, c] = trianglePoints(index);
    const normal = normalize3(cross3(subtract3(b, a), subtract3(c, a)));
    return dot3(seedNormal, normal) > 0.9999 && Math.abs(dot3(seedNormal, subtract3(a, seedA))) < 0.0001;
  };
  const region = new Set([triangleIndex]);
  const queue = [triangleIndex];
  while (queue.length > 0) {
    const current = queue.shift();
    const offset = current * 3;
    const triangle = [entity.indices[offset], entity.indices[offset + 1], entity.indices[offset + 2]];
    for (let edge = 0; edge < 3; edge += 1) {
      const key = edgeKey(triangle[edge], triangle[(edge + 1) % 3]);
      for (const neighbour of edges.get(key) ?? []) {
        if (!region.has(neighbour) && isCoplanar(neighbour)) {
          region.add(neighbour);
          queue.push(neighbour);
        }
      }
    }
  }
  const triangleIndices = Array.from(region).sort((first, second) => first - second);
  const vertexIndices = Array.from(new Set(triangleIndices.flatMap((index) => entity.indices.slice(index * 3, index * 3 + 3))));
  return { triangleIndices, vertexIndices, normal: seedNormal, point: seedA };
};

export const removeMeshFaces = (entity, triangleIndices) => {
  if (entity.kind !== "mesh") {
    throw new Error("Only mesh faces can be deleted.");
  }
  const removed = new Set((triangleIndices ?? []).filter((triangleIndex) => (
    Number.isInteger(triangleIndex) && triangleIndex >= 0 && triangleIndex < entity.indices.length / 3
  )));
  if (removed.size === 0) {
    return { removed: 0, remaining: entity.indices.length / 3 };
  }

  const retainedIndices = [];
  for (let triangleIndex = 0; triangleIndex < entity.indices.length / 3; triangleIndex += 1) {
    if (!removed.has(triangleIndex)) {
      retainedIndices.push(...entity.indices.slice(triangleIndex * 3, triangleIndex * 3 + 3));
    }
  }

  const remappedVertices = [];
  const remap = new Map();
  const remappedIndices = retainedIndices.map((vertexIndex) => {
    if (!remap.has(vertexIndex)) {
      const nextIndex = remap.size;
      remap.set(vertexIndex, nextIndex);
      remappedVertices.push(...localPointAt(entity.vertices, vertexIndex));
    }
    return remap.get(vertexIndex);
  });
  const metadata = { ...(entity.metadata ?? {}) };
  delete metadata.dimensions;
  delete metadata.profilePoints;
  delete metadata.profileNormal;
  delete metadata.radius;
  delete metadata.center;
  delete metadata.extrusionHeight;
  entity.vertices = remappedVertices;
  entity.indices = remappedIndices;
  entity.metadata = { ...metadata, primitive: "edited-mesh", planar: false, solid: false };
  return { removed: removed.size, remaining: remappedIndices.length / 3 };
};

export const removeMeshEdgeFaces = (project, entity, start, end) => {
  if (entity.kind !== "mesh" || !Array.isArray(start) || !Array.isArray(end)) {
    throw new Error("A valid mesh edge is required for deletion.");
  }
  const startKey = meshPointKey(start);
  const endKey = meshPointKey(end);
  const matchesSelectedEdge = (first, second) => (
    (meshPointKey(first) === startKey && meshPointKey(second) === endKey) ||
    (meshPointKey(first) === endKey && meshPointKey(second) === startKey)
  );
  const worldVertices = meshWorldVertices(project, entity);
  const faceTriangles = new Set();
  for (let triangleIndex = 0; triangleIndex < entity.indices.length / 3; triangleIndex += 1) {
    const offset = triangleIndex * 3;
    const triangle = [
      localPointAt(worldVertices, entity.indices[offset]),
      localPointAt(worldVertices, entity.indices[offset + 1]),
      localPointAt(worldVertices, entity.indices[offset + 2])
    ];
    if (!triangle.some((point, index) => matchesSelectedEdge(point, triangle[(index + 1) % 3]))) {
      continue;
    }
    const face = getMeshFaceRegion(project, entity, triangleIndex);
    for (const faceTriangle of face?.triangleIndices ?? []) {
      faceTriangles.add(faceTriangle);
    }
  }
  return removeMeshFaces(entity, Array.from(faceTriangles));
};

export const moveMeshFace = (project, entity, faceRegion, distance) => {
  if (entity.kind !== "mesh" || !faceRegion || !Number.isFinite(distance)) {
    throw new Error("A valid mesh face and distance are required for Push/Pull.");
  }
  const localPoints = entity.vertices;
  const inverseWorldTransform = mat4Invert(entityWorldMatrix(project, entity));
  if (!inverseWorldTransform) {
    throw new Error("The face world transform cannot be inverted.");
  }
  const targetWorldPoint = add3(faceRegion.point, scale3(faceRegion.normal, distance));
  const targetLocalPoint = transformPoint(inverseWorldTransform, targetWorldPoint);
  const sourceLocalPoint = transformPoint(inverseWorldTransform, faceRegion.point);
  const localDelta = subtract3(targetLocalPoint, sourceLocalPoint);
  const selectedKeys = new Set(faceRegion.vertexIndices.map((vertexIndex) => localPointAt(localPoints, vertexIndex).map((value) => Math.round(value * 1000000)).join(":")));
  for (let vertexIndex = 0; vertexIndex < localPoints.length / 3; vertexIndex += 1) {
    const offset = vertexIndex * 3;
    const key = `${Math.round(localPoints[offset] * 1000000)}:${Math.round(localPoints[offset + 1] * 1000000)}:${Math.round(localPoints[offset + 2] * 1000000)}`;
    if (!selectedKeys.has(key)) {
      continue;
    }
    localPoints[offset] += localDelta[0];
    localPoints[offset + 1] += localDelta[1];
    localPoints[offset + 2] += localDelta[2];
  }
  entity.vertices = Array.from(localPoints);
  entity.metadata = { ...entity.metadata, primitive: "edited-mesh", planar: false, solid: entity.metadata?.solid === true };
  delete entity.metadata.dimensions;
  return entity;
};

const profileCenter = (points) => {
  const center = [0, 0, 0];
  const count = points.length / 3;
  for (let index = 0; index < count; index += 1) {
    center[0] += points[index * 3];
    center[1] += points[index * 3 + 1];
    center[2] += points[index * 3 + 2];
  }
  return scale3(center, 1 / count);
};

const faceCornerPoints = (bounds, normal) => {
  const [minX, minY, minZ] = bounds.min;
  const [maxX, maxY, maxZ] = bounds.max;
  if (Math.abs(normal[0]) > 0.9) {
    const x = normal[0] > 0 ? maxX : minX;
    return [[x, minY, minZ], [x, maxY, minZ], [x, maxY, maxZ], [x, minY, maxZ]];
  }
  if (Math.abs(normal[1]) > 0.9) {
    const y = normal[1] > 0 ? maxY : minY;
    return [[minX, y, minZ], [maxX, y, minZ], [maxX, y, maxZ], [minX, y, maxZ]];
  }
  const z = normal[2] > 0 ? maxZ : minZ;
  return [[minX, minY, z], [maxX, minY, z], [maxX, maxY, z], [minX, maxY, z]];
};

const boxFaceCornersForAxis = (bounds, axis, coordinate) => {
  const first = (axis + 1) % 3;
  const second = (axis + 2) % 3;
  const corners = [];
  for (const firstValue of [bounds.min[first], bounds.max[first]]) {
    for (const secondValue of [bounds.min[second], bounds.max[second]]) {
      const point = [0, 0, 0];
      point[axis] = coordinate;
      point[first] = firstValue;
      point[second] = secondValue;
      corners.push(point);
    }
  }
  return corners;
};

const boxFaceCornersByAxis = (bounds, axis, coordinate) => {
  const first = (axis + 1) % 3;
  const second = (axis + 2) % 3;
  const corner = (firstValue, secondValue) => {
    const point = [0, 0, 0];
    point[axis] = coordinate;
    point[first] = firstValue;
    point[second] = secondValue;
    return point;
  };
  return [
    corner(bounds.min[first], bounds.min[second]),
    corner(bounds.max[first], bounds.min[second]),
    corner(bounds.max[first], bounds.max[second]),
    corner(bounds.min[first], bounds.max[second])
  ];
};

const isAxisNormal = (normal) => Math.max(Math.abs(normal[0]), Math.abs(normal[1]), Math.abs(normal[2])) > 0.9999;

const addOrientedTriangle = (vertices, indices, first, second, third, normal) => {
  const cross = cross3(subtract3(second, first), subtract3(third, first));
  const triangle = dot3(cross, normal) >= 0 ? [first, second, third] : [first, third, second];
  const start = vertices.length / 3;
  for (const point of triangle) {
    vertices.push(...point);
  }
  indices.push(start, start + 1, start + 2);
};

const addOrientedQuad = (vertices, indices, first, second, third, fourth, normal) => {
  addOrientedTriangle(vertices, indices, first, second, third, normal);
  addOrientedTriangle(vertices, indices, first, third, fourth, normal);
};

const outerPointForCircleRay = (center, direction, bounds, axis) => {
  const distances = [];
  for (let coordinate = 0; coordinate < 3; coordinate += 1) {
    if (coordinate === axis || Math.abs(direction[coordinate]) < EPSILON) {
      continue;
    }
    distances.push(direction[coordinate] > 0
      ? (bounds.max[coordinate] - center[coordinate]) / direction[coordinate]
      : (bounds.min[coordinate] - center[coordinate]) / direction[coordinate]);
  }
  const distance = Math.min(...distances.filter((value) => value > EPSILON));
  return Number.isFinite(distance) ? add3(center, scale3(direction, distance)) : null;
};

export const cutCircularHoleThroughBox = (project, target, profile) => {
  if (target.kind !== "mesh" || target.metadata?.primitive !== "box" || target.parentId || !profile?.points || profile.points.length < 9) {
    return null;
  }
  const rotation = target.transform?.rotation ?? [0, 0, 0];
  const scale = target.transform?.scale ?? [1, 1, 1];
  if (rotation.some((value) => Math.abs(value) > EPSILON) || scale.some((value) => Math.abs(value - 1) > EPSILON)) {
    return null;
  }
  const normal = normalize3(profile.normal);
  if (!isAxisNormal(normal)) {
    return null;
  }
  const bounds = entityBounds(project, target);
  if (!bounds) {
    return null;
  }
  const axis = Math.abs(normal[0]) > 0.9 ? 0 : Math.abs(normal[1]) > 0.9 ? 1 : 2;
  const center = profileCenter(profile.points);
  const { tangent, bitangent } = planeBasis(normal);
  const radius = distance3(center, [profile.points[0], profile.points[1], profile.points[2]]);
  const otherAxes = [0, 1, 2].filter((coordinate) => coordinate !== axis);
  if (
    radius <= EPSILON ||
    center[otherAxes[0]] - radius <= bounds.min[otherAxes[0]] + EPSILON ||
    center[otherAxes[0]] + radius >= bounds.max[otherAxes[0]] - EPSILON ||
    center[otherAxes[1]] - radius <= bounds.min[otherAxes[1]] + EPSILON ||
    center[otherAxes[1]] + radius >= bounds.max[otherAxes[1]] - EPSILON
  ) {
    return null;
  }
  const entryCoordinate = Math.abs(center[axis] - bounds.min[axis]) < Math.abs(center[axis] - bounds.max[axis]) ? bounds.min[axis] : bounds.max[axis];
  const exitCoordinate = entryCoordinate === bounds.min[axis] ? bounds.max[axis] : bounds.min[axis];
  const entryNormal = [0, 0, 0];
  entryNormal[axis] = entryCoordinate === bounds.max[axis] ? 1 : -1;
  if (Math.abs(center[axis] - entryCoordinate) > 0.01) {
    return null;
  }
  const entryCenter = [...center];
  const exitCenter = [...center];
  entryCenter[axis] = entryCoordinate;
  exitCenter[axis] = exitCoordinate;
  const entryRing = [];
  const outerEntryRing = [];
  for (let offset = 0; offset < profile.points.length; offset += 3) {
    const entryPoint = [profile.points[offset], profile.points[offset + 1], profile.points[offset + 2]];
    entryPoint[axis] = entryCoordinate;
    const radial = subtract3(entryPoint, entryCenter);
    const outer = outerPointForCircleRay(entryCenter, radial, bounds, axis);
    if (!outer || distance3(entryCenter, radial) <= EPSILON) {
      return null;
    }
    entryRing.push(entryPoint);
    outerEntryRing.push(outer);
  }
  const boundaryAngles = new Set();
  for (const outer of outerEntryRing) {
    const radial = subtract3(outer, entryCenter);
    const angle = Math.atan2(dot3(radial, bitangent), dot3(radial, tangent));
    boundaryAngles.add(Math.round((angle < 0 ? angle + Math.PI * 2 : angle) * 1000000) / 1000000);
  }
  for (const corner of boxFaceCornersForAxis(bounds, axis, entryCoordinate)) {
    const radial = subtract3(corner, entryCenter);
    const angle = Math.atan2(dot3(radial, bitangent), dot3(radial, tangent));
    boundaryAngles.add(Math.round((angle < 0 ? angle + Math.PI * 2 : angle) * 1000000) / 1000000);
  }
  for (const corner of boxFaceCornersByAxis(bounds, axis, entryCoordinate)) {
    const radial = subtract3(corner, entryCenter);
    const angle = Math.atan2(dot3(radial, bitangent), dot3(radial, tangent));
    boundaryAngles.add(Math.round((angle < 0 ? angle + Math.PI * 2 : angle) * 1000000) / 1000000);
  }
  const samples = Array.from(boundaryAngles).sort((first, second) => first - second).map((angle) => {
    const radial = add3(scale3(tangent, Math.cos(angle)), scale3(bitangent, Math.sin(angle)));
    const inner = add3(entryCenter, scale3(radial, distance3(entryCenter, entryRing[0])));
    inner[axis] = entryCoordinate;
    const outer = outerPointForCircleRay(entryCenter, radial, bounds, axis);
    if (!outer) {
      return null;
    }
    outer[axis] = entryCoordinate;
    const innerExit = [...inner];
    const outerExit = [...outer];
    innerExit[axis] = exitCoordinate;
    outerExit[axis] = exitCoordinate;
    return { inner, outer, innerExit, outerExit, radial };
  });
  if (samples.some((sample) => sample === null)) {
    return null;
  }
  const vertices = [];
  const indices = [];
  const segments = samples.length;
  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % segments;
    const current = samples[index];
    const following = samples[next];
    addOrientedQuad(vertices, indices, current.outer, following.outer, following.inner, current.inner, entryNormal);
    addOrientedQuad(vertices, indices, current.outerExit, current.innerExit, following.innerExit, following.outerExit, scale3(entryNormal, -1));
    addOrientedQuad(vertices, indices, current.inner, following.inner, following.innerExit, current.innerExit, scale3(normalize3(add3(current.radial, following.radial)), -1));
    const midpoint = midpoint3(current.outer, following.outer);
    const sideNormal = Math.abs(midpoint[0] - bounds.max[0]) < 0.001 ? [1, 0, 0]
      : Math.abs(midpoint[0] - bounds.min[0]) < 0.001 ? [-1, 0, 0]
        : Math.abs(midpoint[1] - bounds.max[1]) < 0.001 ? [0, 1, 0]
          : Math.abs(midpoint[1] - bounds.min[1]) < 0.001 ? [0, -1, 0]
            : null;
    if (!sideNormal) {
      return null;
    }
    addOrientedQuad(vertices, indices, current.outer, current.outerExit, following.outerExit, following.outer, sideNormal);
  }
  const result = createMeshEntity({
    name: `${target.name} with circular cut`,
    vertices,
    indices,
    materialId: target.materialId,
    metadata: { primitive: "circular-through-hole", solid: true, source: target.id, segments }
  });
  result.tagId = target.tagId;
  result.visible = target.visible;
  result.locked = target.locked;
  if (!meshIsClosed({ ...project, entities: [result], roots: [result.id] }, result)) {
    return null;
  }
  return result;
};

export const computeNormals = (vertices, indices) => {
  const normals = new Array(vertices.length).fill(0);
  for (let index = 0; index < indices.length; index += 3) {
    const aIndex = indices[index] * 3;
    const bIndex = indices[index + 1] * 3;
    const cIndex = indices[index + 2] * 3;
    const a = [vertices[aIndex], vertices[aIndex + 1], vertices[aIndex + 2]];
    const b = [vertices[bIndex], vertices[bIndex + 1], vertices[bIndex + 2]];
    const c = [vertices[cIndex], vertices[cIndex + 1], vertices[cIndex + 2]];
    const normal = cross3(subtract3(b, a), subtract3(c, a));
    for (const vertexIndex of [aIndex, bIndex, cIndex]) {
      normals[vertexIndex] += normal[0];
      normals[vertexIndex + 1] += normal[1];
      normals[vertexIndex + 2] += normal[2];
    }
  }

  for (let index = 0; index < normals.length; index += 3) {
    const normal = normalize3([normals[index], normals[index + 1], normals[index + 2]]);
    normals[index] = normal[0];
    normals[index + 1] = normal[1];
    normals[index + 2] = normal[2];
  }
  return normals;
};

export const entityBounds = (project, entity) => {
  let source = [];
  if (entity.kind === "mesh") {
    source = meshWorldVertices(project, entity);
  } else if (entity.kind === "edge" || entity.kind === "annotation") {
    source = lineWorldPoints(project, entity);
  }
  if (source.length === 0) {
    return null;
  }

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < source.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], source[index + axis]);
      max[axis] = Math.max(max[axis], source[index + axis]);
    }
  }
  return { min, max, center: midpoint3(min, max), size: subtract3(max, min) };
};

export const projectBounds = (project, entities = project.entities) => {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let hasBounds = false;

  for (const entity of entities) {
    const bounds = entityBounds(project, entity);
    if (!bounds) {
      continue;
    }
    hasBounds = true;
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], bounds.min[axis]);
      max[axis] = Math.max(max[axis], bounds.max[axis]);
    }
  }
  return hasBounds ? { min, max, center: midpoint3(min, max), size: subtract3(max, min) } : null;
};

export const bakeMatrixIntoEntity = (entity, matrix) => {
  if (entity.kind === "mesh") {
    const transformed = [];
    for (let index = 0; index < entity.vertices.length; index += 3) {
      transformed.push(...transformPoint(matrix, [entity.vertices[index], entity.vertices[index + 1], entity.vertices[index + 2]]));
    }
    entity.vertices = transformed;
  }

  if (entity.kind === "edge" || entity.kind === "annotation") {
    const transformed = [];
    for (let index = 0; index < entity.points.length; index += 3) {
      transformed.push(...transformPoint(matrix, [entity.points[index], entity.points[index + 1], entity.points[index + 2]]));
    }
    entity.points = transformed;
  }

  if (entity.kind === "section") {
    entity.point = transformPoint(matrix, entity.point);
    entity.normal = transformDirection(matrix, entity.normal);
  }

  entity.transform = defaultTransform();
};

const bakeHierarchyTransform = (project, entity, parentMatrix) => {
  const effectiveMatrix = mat4Multiply(parentMatrix, mat4FromTransform(entity.transform));
  if (entity.kind === "group") {
    for (const childId of entity.children) {
      const child = getEntity(project, childId);
      if (child) {
        bakeHierarchyTransform(project, child, effectiveMatrix);
      }
    }
    entity.transform = defaultTransform();
    return;
  }
  bakeMatrixIntoEntity(entity, effectiveMatrix);
};

export const bakeEntityTransform = (entity) => bakeMatrixIntoEntity(entity, mat4FromTransform(entity.transform));

export const cloneEntity = (entity, offset = [0, 0, 0]) => {
  const clone = structuredClone(entity);
  clone.id = newId();
  clone.name = `${entity.name} copy`;
  clone.parentId = null;
  clone.transform.position = add3(clone.transform.position, offset);
  if (clone.kind === "group") {
    clone.children = [];
  }
  return clone;
};

export const cloneEntityTree = (project, entity, parentId = entity.parentId, offset = [0, 0, 0]) => {
  const clone = cloneEntity(entity, offset);
  addEntity(project, clone, parentId);
  if (entity.kind === "group") {
    for (const childId of entity.children) {
      const child = getEntity(project, childId);
      if (child) {
        cloneEntityTree(project, child, clone.id, [0, 0, 0]);
      }
    }
  }
  return clone;
};

export const reverseMeshFaces = (entity) => {
  if (entity.kind !== "mesh") {
    return false;
  }
  for (let index = 0; index < entity.indices.length; index += 3) {
    const second = entity.indices[index + 1];
    entity.indices[index + 1] = entity.indices[index + 2];
    entity.indices[index + 2] = second;
  }
  return true;
};

export const rotateEntityAroundAxis = (project, entity, pivot, axis, angle) => {
  if (entity.kind !== "mesh" && entity.kind !== "edge" && entity.kind !== "annotation") {
    throw new Error("Rotate supports mesh and drawing entities.");
  }
  const parent = entity.parentId ? getEntity(project, entity.parentId) : null;
  const parentWorldMatrix = parent ? entityWorldMatrix(project, parent) : mat4Identity();
  const inverseParentMatrix = mat4Invert(parentWorldMatrix);
  if (!inverseParentMatrix) {
    throw new Error("The parent transform cannot be inverted for rotation.");
  }
  const worldRotation = mat4RotationAroundPoint(axis, angle, pivot);
  const entityWorldTransform = entityWorldMatrix(project, entity);
  const localRotation = mat4Multiply(inverseParentMatrix, mat4Multiply(worldRotation, entityWorldTransform));
  bakeMatrixIntoEntity(entity, localRotation);
  if (entity.kind === "mesh") {
    entity.metadata = {
      ...entity.metadata,
      primitive: "rotated-mesh",
      planar: false,
      solid: entity.metadata?.solid === true
    };
    delete entity.metadata.profilePoints;
    delete entity.metadata.profileNormal;
    delete entity.metadata.dimensions;
    delete entity.metadata.sweepVector;
  }
  return entity;
};

export const meshReport = (project, entities) => {
  const meshEntities = entities.filter((entity) => entity.kind === "mesh");
  const report = {
    meshCount: meshEntities.length,
    triangleCount: 0,
    degenerateCount: 0,
    boundaryEdgeCount: 0,
    nonManifoldEdgeCount: 0,
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity]
  };
  const edgeCounts = new Map();
  const edgeOrientation = new Map();

  for (const entity of meshEntities) {
    const bounds = entityBounds(project, entity);
    const weldTolerance = bounds ? Math.max(0.000001, Math.max(...bounds.size) * 0.000001) : 0.000001;
    const coordinateKey = (point) => point.map((value) => Math.round(value / weldTolerance)).join(":");
    report.triangleCount += entity.indices.length / 3;
    for (const [a, b, c] of meshWorldTriangleIterator(project, entity)) {
      const twiceArea = Math.hypot(...cross3(subtract3(b, a), subtract3(c, a)));
      if (twiceArea < EPSILON) {
        report.degenerateCount += 1;
      }
      for (const point of [a, b, c]) {
        for (let axis = 0; axis < 3; axis += 1) {
          report.min[axis] = Math.min(report.min[axis], point[axis]);
          report.max[axis] = Math.max(report.max[axis], point[axis]);
        }
      }
      for (let edge = 0; edge < 3; edge += 1) {
        const points = [a, b, c];
        const first = points[edge];
        const second = points[(edge + 1) % 3];
        const firstKey = coordinateKey(first);
        const secondKey = coordinateKey(second);
        const key = firstKey < secondKey ? `${entity.id}|${firstKey}|${secondKey}` : `${entity.id}|${secondKey}|${firstKey}`;
        edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
        const direction = firstKey < secondKey ? 1 : -1;
        edgeOrientation.set(key, (edgeOrientation.get(key) ?? 0) + direction);
      }
    }
  }
  for (const count of edgeCounts.values()) {
    if (count === 1) {
      report.boundaryEdgeCount += 1;
    } else if (count > 2) {
      report.nonManifoldEdgeCount += 1;
    }
  }
  for (const [key, orientation] of edgeOrientation) {
    if (edgeCounts.get(key) === 2 && orientation !== 0) {
      report.nonManifoldEdgeCount += 1;
    }
  }
  return report;
};

export const meshIsClosed = (project, entity) => {
  if (entity.kind !== "mesh" || entity.indices.length === 0) {
    return false;
  }
  const report = meshReport(project, [entity]);
  return report.degenerateCount === 0 && report.boundaryEdgeCount === 0 && report.nonManifoldEdgeCount === 0;
};

export const createDemoProject = () => {
  const project = createEmptyProject();
  project.name = "Untitled model";
  const box = createBoxEntity(100, 100, 60, "Starter block");
  box.transform.position = [0, 0, 0];
  box.materialId = "material-clay";
  addEntity(project, box);
  return project;
};
