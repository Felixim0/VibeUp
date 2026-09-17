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
  selectionColor: "#f2bf2f",
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

export const createPrismGeometry = (points, height, normal = [0, 0, 1]) => {
  const count = points.length / 3;
  if (count < 3) {
    throw new Error("A profile needs at least three points to extrude.");
  }

  const direction = normalize3(normal);
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

export const extrudeProfile = (entity, height) => {
  if (entity.kind !== "mesh" || !entity.metadata?.profilePoints) {
    throw new Error("Push/Pull needs a planar face created with a drawing tool.");
  }

  const geometry = createPrismGeometry(entity.metadata.profilePoints, height, entity.metadata.profileNormal ?? [0, 0, 1]);
  entity.vertices = geometry.vertices;
  entity.indices = geometry.indices;
  entity.name = entity.name.replace(/^(Extruded )?/, "Extruded ");
  entity.metadata = {
    ...entity.metadata,
    primitive: "extrusion",
    extrusionHeight: height,
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

export const edgeIndicesForMesh = (vertices, indices) => {
  const edges = new Map();
  const keyForVertex = (vertexIndex) => localPointAt(vertices, vertexIndex).map((value) => Math.round(value * 1000000)).join(":");
  for (let offset = 0; offset < indices.length; offset += 3) {
    const triangle = [indices[offset], indices[offset + 1], indices[offset + 2]];
    const points = triangle.map((vertexIndex) => localPointAt(vertices, vertexIndex));
    const normal = normalize3(cross3(subtract3(points[1], points[0]), subtract3(points[2], points[0])));
    for (let edge = 0; edge < 3; edge += 1) {
      const first = triangle[edge];
      const second = triangle[(edge + 1) % 3];
      const firstKey = keyForVertex(first);
      const secondKey = keyForVertex(second);
      const key = firstKey < secondKey ? `${firstKey}|${secondKey}` : `${secondKey}|${firstKey}`;
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
