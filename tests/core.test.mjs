import assert from "node:assert/strict";
import test from "node:test";

import { createZip, decodeJson, encodeJson, readZip } from "../archive.js";
import { OrbitCamera } from "../camera.js";
import { subtractMeshes, validateSubtractInputs } from "../csg.js";
import {
  addEntity,
  closedLineFace,
  createBoxEntity,
  createEdgeEntity,
  cutCircularHoleThroughBox,
  createCircleEntity,
  createDemoProject,
  createEmptyProject,
  createRectangleEntity,
  createSweepGeometry,
  entityBounds,
  extrudeMeshFaceWithProfileHoles,
  extrudeProfile,
  faceProfileHoles,
  getEntity,
  getMeshFaceRegion,
  indentMeshFaceWithProfile,
  explodeGroup,
  makeGroup,
  meshOpeningAtPoint,
  fillMeshOpeningWithSplit,
  moveMeshFace,
  meshReport,
  meshEdgeFaceTriangleIndices,
  meshWorldVertices,
  nestedProfileHoles,
  projectBounds,
  profileHostFace,
  reverseMeshFaces,
  removeMeshEdgeFaces,
  removeMeshFaces,
  rotateEntityAroundAxis,
  splitMeshFaceByLine
} from "../geometry.js";
import { add3, dot3, mat4FromTransform, mat4Identity, mat4Invert, mat4Multiply, mat4RotationAroundPoint, normalize3, scale3, subtract3, transformPoint } from "../math.js";
import { createBinaryStl, parseStl } from "../stl.js";

test("ZIP archive round-trips project JSON", async () => {
  const original = { application: "vibe-up", formatVersion: 1, name: "Archive test", entities: [{ id: "test" }] };
  const archive = createZip([{ name: "document.json", data: encodeJson(original) }]);
  const entries = await readZip(archive.buffer);
  assert.deepEqual(decodeJson(entries.get("document.json")), original);
});

test("matrix inversion returns an identity product", () => {
  const matrix = mat4FromTransform({ position: [25, -14, 38], rotation: [0.2, -0.4, 1.1], scale: [1.5, 0.75, 2] });
  const inverse = mat4Invert(matrix);
  assert.ok(inverse);
  const product = mat4Multiply(matrix, inverse);
  const identity = mat4Identity();
  for (let index = 0; index < 16; index += 1) {
    assert.ok(Math.abs(product[index] - identity[index]) < 0.00001);
  }
});

test("axis rotation keeps the protractor pivot fixed", () => {
  const pivot = [10, 5, -3];
  const rotation = mat4RotationAroundPoint([0, 0, 1], Math.PI / 2, pivot);
  const rotatedPivot = transformPoint(rotation, pivot);
  assert.ok(rotatedPivot.every((value, index) => Math.abs(value - pivot[index]) < 0.000001));
  const rotatedPoint = transformPoint(rotation, [20, 5, -3]);
  assert.ok(Math.abs(rotatedPoint[0] - 10) < 0.000001);
  assert.ok(Math.abs(rotatedPoint[1] - 15) < 0.000001);
  assert.ok(Math.abs(rotatedPoint[2] + 3) < 0.000001);
});

test("world-space rotation preserves an entity's existing transform", () => {
  const project = createEmptyProject();
  const box = addEntity(project, createBoxEntity(10, 10, 10));
  box.transform.position = [20, 0, 0];
  rotateEntityAroundAxis(project, box, [0, 0, 0], [0, 0, 1], Math.PI / 2);
  const bounds = entityBounds(project, box);
  assert.ok(Math.abs(bounds.center[0]) < 0.000001);
  assert.ok(Math.abs(bounds.center[1] - 20) < 0.000001);
});

test("line inference projects points onto a locked direction", () => {
  const origin = [4, -2, 7];
  const direction = normalize3([2, 1, 0]);
  const candidate = [21, 18, 7];
  const inferred = add3(origin, scale3(direction, dot3(subtract3(candidate, origin), direction)));
  const remainder = subtract3(subtract3(inferred, origin), scale3(direction, dot3(subtract3(inferred, origin), direction)));
  assert.ok(Math.hypot(...remainder) < 0.000001);
});

test("ZIP reader rejects corrupt archive entries", async () => {
  const archive = createZip([{ name: "document.json", data: encodeJson({ hello: "world" }) }]);
  const corrupt = archive.slice();
  corrupt[archive.length - 22] ^= 0xff;
  await assert.rejects(readZip(corrupt.buffer));
});

test("ZIP reader rejects empty archives", async () => {
  const empty = new Uint8Array(22);
  const view = new DataView(empty.buffer);
  view.setUint32(0, 0x06054b50, true);
  await assert.rejects(readZip(empty.buffer), /unsupported layout/);
});

test("STL parser rejects binary files beyond the safety limit", () => {
  const header = new ArrayBuffer(84);
  new DataView(header).setUint32(80, 100_001, true);
  assert.throws(() => parseStl(header, "large.stl"), /100,000 triangle safety limit/);
});

test("binary STL export and import retain triangle count", async () => {
  const project = createDemoProject();
  const original = project.entities[0];
  const blob = createBinaryStl(project, [original]);
  const imported = parseStl(await blob.arrayBuffer(), "roundtrip.stl");
  assert.equal(imported.indices.length / 3, original.indices.length / 3);
  assert.equal(imported.vertices.length, original.indices.length * 3);
});

test("ASCII STL parses facets", () => {
  const source = `solid triangle
facet normal 0 0 1
 outer loop
  vertex 0 0 0
  vertex 10 0 0
  vertex 0 10 0
 endloop
endfacet
endsolid triangle`;
  const imported = parseStl(new TextEncoder().encode(source).buffer, "triangle.stl");
  assert.equal(imported.indices.length / 3, 1);
  assert.deepEqual(imported.vertices, [0, 0, 0, 10, 0, 0, 0, 10, 0]);
});

test("rectangle profile push-pull creates a closed twelve-triangle prism", () => {
  const rectangle = createRectangleEntity([0, 0, 0], [20, 10, 0]);
  extrudeProfile(rectangle, 15);
  assert.equal(rectangle.indices.length / 3, 12);
  assert.equal(rectangle.metadata.solid, true);
  assert.equal(rectangle.vertices.length / 3, 8);
});

test("profile drawings can be created on a vertical object face", () => {
  const rectangle = createRectangleEntity([10, 0, 0], [10, 20, 15], [1, 0, 0]);
  assert.equal(rectangle.metadata.profileNormal[0], 1);
  assert.ok(rectangle.vertices.every((value, index) => index % 3 !== 0 || value === 10));
  extrudeProfile(rectangle, 12);
  assert.equal(rectangle.metadata.solid, true);
  assert.equal(rectangle.vertices.length / 3, 8);
});

test("nested coplanar circles become watertight Push/Pull holes", () => {
  const project = createEmptyProject();
  const rectangle = addEntity(project, createRectangleEntity([-50, -50, 0], [50, 50, 0]));
  const firstCircle = addEntity(project, createCircleEntity([-20, 0, 0], 10, 12));
  const secondCircle = addEntity(project, createCircleEntity([20, 0, 0], 12, 16));
  const holes = nestedProfileHoles(project, rectangle);
  assert.deepEqual(new Set(holes.map((hole) => hole.entityId)), new Set([firstCircle.id, secondCircle.id]));
  extrudeProfile(rectangle, 25, holes.map((hole) => hole.points));
  const report = meshReport(project, [rectangle]);
  assert.equal(rectangle.metadata.holeCount, 2);
  assert.equal(report.degenerateCount, 0);
  assert.equal(report.boundaryEdgeCount, 0);
  assert.equal(report.nonManifoldEdgeCount, 0);
});

test("nested profiles make watertight holes on vertical negative Push/Pull", () => {
  const project = createEmptyProject();
  const rectangle = addEntity(project, createRectangleEntity([0, -50, 0], [0, 50, 100], [1, 0, 0]));
  addEntity(project, createCircleEntity([0, 0, 50], 20, 18, "Circle", [1, 0, 0]));
  const holes = nestedProfileHoles(project, rectangle);
  assert.equal(holes.length, 1);
  extrudeProfile(rectangle, -30, holes.map((hole) => hole.points));
  const report = meshReport(project, [rectangle]);
  assert.equal(report.degenerateCount, 0);
  assert.equal(report.boundaryEdgeCount, 0);
  assert.equal(report.nonManifoldEdgeCount, 0);
  assert.deepEqual(entityBounds(project, rectangle).min, [-30, -50, 0]);
});

test("profiles outside the outer face or on another plane do not make holes", () => {
  const project = createEmptyProject();
  const rectangle = addEntity(project, createRectangleEntity([0, 0, 0], [100, 100, 0]));
  const nested = addEntity(project, createCircleEntity([50, 50, 0], 15, 12));
  addEntity(project, createCircleEntity([150, 50, 0], 10, 12));
  addEntity(project, createCircleEntity([25, 25, 1], 5, 12));
  const holes = nestedProfileHoles(project, rectangle);
  assert.equal(holes.length, 1);
  assert.equal(holes[0].entityId, nested.id);
});

test("circle profiles honour their supplied surface normal", () => {
  const circle = createCircleEntity([10, 0, 0], 5, 8, "Face circle", [1, 0, 0]);
  assert.ok(circle.vertices.every((value, index) => index % 3 !== 0 || value === 10));
});

test("circle stores its requested segment count", () => {
  const circle = createCircleEntity([0, 0, 0], 10, 18);
  assert.equal(circle.metadata.segments, 18);
  assert.equal(circle.vertices.length / 3, 18);
});

test("a circle pushed through a box creates a closed manifold hole", () => {
  const project = createEmptyProject();
  const box = addEntity(project, createBoxEntity(100, 100, 60));
  const circle = createCircleEntity([0, 0, 60], 20, 24, "Circle", [0, 0, 1]);
  const hole = cutCircularHoleThroughBox(project, box, {
    points: circle.metadata.profilePoints,
    normal: circle.metadata.profileNormal
  });
  assert.ok(hole);
  const holeProject = createEmptyProject();
  addEntity(holeProject, hole);
  const report = meshReport(holeProject, [hole]);
  assert.equal(report.degenerateCount, 0);
  assert.equal(report.boundaryEdgeCount, 0);
  assert.equal(report.nonManifoldEdgeCount, 0);
});

test("an oversized circle cannot replace a box with an invalid hole", () => {
  const project = createEmptyProject();
  const box = addEntity(project, createBoxEntity(100, 100, 60));
  const circle = createCircleEntity([0, 0, 60], 51, 24, "Oversized circle", [0, 0, 1]);
  const hole = cutCircularHoleThroughBox(project, box, {
    points: circle.metadata.profilePoints,
    normal: circle.metadata.profileNormal
  });
  assert.equal(hole, null);
  assert.equal(project.entities.length, 1);
});

test("circle through-hole works from every axis-aligned box face", () => {
  const faces = [
    [[0, 0, 60], [0, 0, 1]],
    [[0, 0, 0], [0, 0, -1]],
    [[50, 0, 30], [1, 0, 0]],
    [[-50, 0, 30], [-1, 0, 0]],
    [[0, 40, 30], [0, 1, 0]],
    [[0, -40, 30], [0, -1, 0]]
  ];
  for (const [center, normal] of faces) {
    const project = createEmptyProject();
    const box = addEntity(project, createBoxEntity(100, 80, 60));
    const circle = createCircleEntity(center, 10, 18, "Circle", normal);
    const hole = cutCircularHoleThroughBox(project, box, {
      points: circle.metadata.profilePoints,
      normal: circle.metadata.profileNormal
    });
    assert.ok(hole);
    const holeProject = createEmptyProject();
    addEntity(holeProject, hole);
    const report = meshReport(holeProject, [hole]);
    assert.equal(report.boundaryEdgeCount, 0);
    assert.equal(report.nonManifoldEdgeCount, 0);
  }
});

test("selected box face moves independently with Push/Pull", () => {
  const project = createEmptyProject();
  const box = addEntity(project, createBoxEntity(20, 20, 20));
  const topFace = getMeshFaceRegion(project, box, 2);
  assert.ok(topFace);
  moveMeshFace(project, box, topFace, 10);
  const bounds = entityBounds(project, box);
  assert.equal(bounds.max[2], 30);
  assert.equal(bounds.min[2], 0);
});

test("Push/Pull keeps a nested profile as an indented box-face opening", () => {
  const project = createEmptyProject();
  const box = addEntity(project, createBoxEntity(100, 100, 40));
  const topFace = getMeshFaceRegion(project, box, 2);
  assert.ok(topFace);
  const circle = addEntity(project, createCircleEntity([0, 0, 40], 20, 18, "Circle", [0, 0, 1]));
  const holes = faceProfileHoles(project, box, topFace);
  assert.equal(holes.length, 1);
  assert.equal(holes[0].entityId, circle.id);
  extrudeMeshFaceWithProfileHoles(project, box, topFace, holes, 20);
  const report = meshReport(project, [box]);
  assert.equal(report.degenerateCount, 0);
  assert.equal(report.boundaryEdgeCount, 0);
  assert.equal(report.nonManifoldEdgeCount, 0);
  assert.equal(entityBounds(project, box).max[2], 60);
});

test("a boundary-to-boundary line splits a box face into independently selectable and extrudable regions", () => {
  const project = createEmptyProject();
  const box = addEntity(project, createBoxEntity(100, 100, 40));
  const face = getMeshFaceRegion(project, box, 2);
  assert.equal(splitMeshFaceByLine(project, box, face, [0, -50, 40], [0, 50, 40]), true);
  assert.equal(meshReport(project, [box]).boundaryEdgeCount, 0);
  const halves = [];
  for (let index = 0; index < box.indices.length / 3; index += 1) {
    const region = getMeshFaceRegion(project, box, index);
    if (region.normal[2] > 0.9 && !halves.some((existing) => existing.triangleIndices[0] === region.triangleIndices[0])) halves.push(region);
  }
  assert.equal(halves.length, 2);
  extrudeMeshFaceWithProfileHoles(project, box, halves[0], [], 12);
  assert.equal(entityBounds(project, box).max[2], 52);
});

test("a nested drawn face can indent its host without moving the outer face", () => {
  const project = createEmptyProject();
  const box = addEntity(project, createBoxEntity(100, 100, 40));
  const profile = addEntity(project, createCircleEntity([0, 0, 40], 15, 18, "Cut", [0, 0, 1]));
  const face = getMeshFaceRegion(project, box, 2);
  indentMeshFaceWithProfile(project, box, face, faceProfileHoles(project, box, face)[0], -10);
  assert.equal(entityBounds(project, box).max[2], 40);
  assert.equal(meshReport(project, [box]).boundaryEdgeCount, 0);
  assert.ok(profile);
});

test("closing coplanar line segments creates a selectable planar face", () => {
  const project = createEmptyProject();
  addEntity(project, createEdgeEntity({ points: [0, 0, 0, 20, 0, 0] }));
  addEntity(project, createEdgeEntity({ points: [20, 0, 0, 20, 20, 0] }));
  addEntity(project, createEdgeEntity({ points: [20, 20, 0, 0, 20, 0] }));
  const face = closedLineFace(project, [0, 20, 0], [0, 0, 0]);
  assert.equal(face?.metadata.planar, true);
  assert.equal(face?.indices.length, 6);
  assert.equal(closedLineFace(project, [0, 20, 5], [0, 0, 5]), null);
});

test("closed profile on an existing face can indent its host", () => {
  const project = createEmptyProject();
  const box = addEntity(project, createBoxEntity(100, 100, 40));
  const profile = addEntity(project, createCircleEntity([0, 0, 40], 15, 18, "Cut", [0, 0, 1]));
  const match = profileHostFace(project, profile);
  assert.equal(match?.host.id, box.id);
  indentMeshFaceWithProfile(project, box, match.face, match.cut, -12);
  assert.equal(meshReport(project, [box]).boundaryEdgeCount, 0);
});

test("a closed line-drawn face on a box can recess into the host", () => {
  const project = createEmptyProject();
  const box = addEntity(project, createBoxEntity(100, 100, 40));
  const points = [[-10, -10, 40], [10, -10, 40], [10, 10, 40], [-10, 10, 40]];
  for (let index = 0; index < 3; index += 1) {
    addEntity(project, createEdgeEntity({ points: [...points[index], ...points[index + 1]] }));
  }
  const face = addEntity(project, closedLineFace(project, points[3], points[0]));
  const host = profileHostFace(project, face);
  assert.equal(host?.host.id, box.id);
  indentMeshFaceWithProfile(project, box, host.face, host.cut, -8);
  assert.equal(meshReport(project, [box]).boundaryEdgeCount, 0);
});

test("pushing a drawn face through a box opens and preserves the opposite face", () => {
  const project = createEmptyProject();
  const box = addEntity(project, createBoxEntity(100, 100, 40));
  const profile = addEntity(project, createCircleEntity([0, 0, 40], 12, 18, "Through", [0, 0, 1]));
  const { face, cut } = profileHostFace(project, profile);
  indentMeshFaceWithProfile(project, box, face, cut, -55);
  const report = meshReport(project, [box]);
  assert.equal(report.boundaryEdgeCount, 0);
  assert.equal(report.nonManifoldEdgeCount, 0);
  const exit = getMeshFaceRegion(project, box, box.indices.length / 3 - 1);
  assert.ok(exit);
  const bottom = Array.from({ length: box.indices.length / 3 }, (_, index) => getMeshFaceRegion(project, box, index))
    .filter((region) => region.normal[2] < -0.9 && Math.abs(region.point[2]) < 0.001);
  assert.ok(bottom.length > 0, "the exit-side surface remains selectable");
  assert.equal(entityBounds(project, box).min[2], 0);
});

test("camera rotation and pan sensitivity survive serialization", () => {
  const camera = new OrbitCamera();
  camera.rotateSensitivity = 2;
  camera.moveSensitivity = 0.5;
  const restored = new OrbitCamera();
  restored.restore(camera.serialize());
  const baseline = new OrbitCamera();
  restored.orbit(10, 0);
  baseline.orbit(10, 0);
  assert.ok(Math.abs(restored.yaw - baseline.yaw) > 0.01);
  assert.equal(restored.moveSensitivity, 0.5);
});

test("grab-point orbit does not jump when the drag starts", () => {
  const camera = new OrbitCamera();
  const before = camera.getPosition();
  camera.orbitAroundDrag(0, 0, [60, 20, 0]);
  assert.deepEqual(camera.getPosition().map((value) => Math.round(value * 1000000)), before.map((value) => Math.round(value * 1000000)));
  assert.deepEqual(camera.target.map((value) => Math.round(value * 1000000)), [0, 0, 25000000]);
  camera.orbitAroundDrag(1, 0, [60, 20, 0]);
  assert.ok(Math.hypot(...subtract3(camera.getPosition(), before)) < 5);
});

test("vertical orbit direction defaults to normal and can be inverted and restored", () => {
  for (const pivot of [null, [60, 20, 0]]) {
    const camera = new OrbitCamera();
    const initial = camera.pitch;
    if (pivot) camera.orbitAroundDrag(0, 10, pivot);
    else camera.orbit(0, 10);
    assert.ok(camera.pitch > initial, "downward dragging should raise pitch by default");
    camera.invertVerticalOrbit = true;
    const restored = new OrbitCamera();
    restored.restore(camera.serialize());
    const beforeInversion = restored.pitch;
    if (pivot) restored.orbitAroundDrag(0, 10, pivot);
    else restored.orbit(0, 10);
    assert.ok(restored.pitch < beforeInversion, "inverted downward dragging should lower pitch");
    assert.equal(restored.invertVerticalOrbit, true);
    restored.reset();
    assert.equal(restored.invertVerticalOrbit, false);
  }
});

test("deleting a selected mesh face preserves the remaining faces", () => {
  const project = createEmptyProject();
  const box = addEntity(project, createBoxEntity(20, 20, 20));
  const topFace = getMeshFaceRegion(project, box, 2);
  assert.ok(topFace);
  const result = removeMeshFaces(box, topFace.triangleIndices);
  assert.equal(result.removed, 2);
  assert.equal(result.remaining, 10);
  assert.equal(box.indices.length / 3, 10);
  assert.equal(box.vertices.length / 3, 8);
  assert.equal(box.metadata.solid, false);
});

test("a line through the interior of a deleted face recreates two independent faces", () => {
  const project = createEmptyProject();
  const box = addEntity(project, createBoxEntity(100, 100, 40));
  removeMeshFaces(box, getMeshFaceRegion(project, box, 2).triangleIndices);
  const opening = meshOpeningAtPoint(project, box, [0, 0, 40], [0, 0, 1]);
  assert.equal(opening?.length, 4);
  assert.equal(fillMeshOpeningWithSplit(project, box, opening, [0, -15, 40], [0, 15, 40], [0, 0, 1]), true);
  const topRegions = new Set();
  for (let index = 0; index < box.indices.length / 3; index += 1) {
    const face = getMeshFaceRegion(project, box, index);
    if (face?.normal[2] > 0.9 && Math.abs(face.point[2] - 40) < 0.001) topRegions.add(face.triangleIndices.join(","));
  }
  assert.equal(topRegions.size, 2);
});

test("an interior line splits an intact rectangular face from arbitrary points", () => {
  const project = createEmptyProject();
  const box = addEntity(project, createBoxEntity(100, 100, 40));
  const top = getMeshFaceRegion(project, box, 2);
  assert.equal(splitMeshFaceByLine(project, box, top, [0, -15, 40], [0, 15, 40]), true);
  const regions = new Map();
  for (let index = 0; index < box.indices.length / 3; index += 1) {
    const face = getMeshFaceRegion(project, box, index);
    if (face?.normal[2] > 0.9 && Math.abs(face.point[2] - 40) < 0.001) regions.set(face.triangleIndices.join(","), face);
  }
  assert.equal(regions.size, 2);
  assert.equal(meshReport(project, [box]).boundaryEdgeCount, 0);
});

test("deleting a selected mesh edge removes every face incident to it", () => {
  const project = createEmptyProject();
  const box = addEntity(project, createBoxEntity(20, 20, 20));
  const start = [-10, -10, 0];
  const end = [10, -10, 0];
  const result = removeMeshEdgeFaces(project, box, start, end);
  assert.equal(result.removed, 4);
  assert.equal(result.remaining, 8);
  assert.equal(box.indices.length / 3, 8);
  assert.equal(box.metadata.solid, false);
});

test("mesh edge face lookup reports the same cascaded face region", () => {
  const project = createEmptyProject();
  const box = addEntity(project, createBoxEntity(20, 20, 20));
  const triangles = meshEdgeFaceTriangleIndices(project, box, [-10, -10, 0], [10, -10, 0]);
  assert.equal(triangles.length, 4);
});

test("zoom becomes less sensitive near the model", () => {
  const distant = new OrbitCamera();
  distant.distance = 1000;
  distant.zoom(120);
  const distantStep = Math.abs(1000 - distant.distance);
  const close = new OrbitCamera();
  close.distance = 10;
  close.zoom(120);
  const closeStep = Math.abs(10 - close.distance);
  assert.ok(closeStep / 10 < distantStep / 1000);
  assert.ok(close.distance > 0);
});

test("zoom and near-object slowdown are adjustable and survive camera serialization", () => {
  const base = new OrbitCamera();
  const fast = new OrbitCamera();
  fast.zoomSensitivity = 2;
  base.zoom(100);
  fast.zoom(100);
  assert.ok(fast.distance > base.distance);
  const close = new OrbitCamera();
  close.distance = 10;
  const unthrottled = new OrbitCamera();
  unthrottled.distance = 10;
  unthrottled.closeZoomSensitivity = 0;
  close.zoom(100);
  unthrottled.zoom(100);
  assert.ok(unthrottled.distance - 10 > close.distance - 10);
  const restored = new OrbitCamera();
  restored.restore({ ...unthrottled.serialize(), zoomSensitivity: 2.5 });
  assert.equal(restored.zoomSensitivity, 2.5);
  assert.equal(restored.closeZoomSensitivity, 0);
});

test("orbit clamps at the top pole to keep the camera upright", () => {
  const camera = new OrbitCamera();
  camera.pitch = Math.PI / 2 - 0.01;
  camera.orbit(0, 10);
  assert.ok(camera.pitch < Math.PI / 2);
  assert.ok(camera.pitch > Math.PI / 2 - 0.001);
  const position = camera.getPosition();
  const up = camera.getUp();
  assert.ok(position.every(Number.isFinite));
  assert.deepEqual(up, [0, 0, 1]);
});

test("orbit clamps at the bottom pole to keep the camera upright", () => {
  const camera = new OrbitCamera();
  camera.pitch = -Math.PI / 2 + 0.01;
  camera.orbit(0, -10);
  assert.ok(camera.pitch > -Math.PI / 2);
  assert.ok(camera.pitch < -Math.PI / 2 + 0.001);
  const { projection, view } = camera.getMatrices(1.5);
  assert.ok(projection.every(Number.isFinite));
  assert.ok(view.every(Number.isFinite));
});

test("camera pan remains usable at both poles", () => {
  const camera = new OrbitCamera();
  for (const pitch of [Math.PI / 2, -Math.PI / 2]) {
    camera.pitch = pitch;
    const originalTarget = Array.from(camera.target);
    camera.pan(20, -15, 800);
    assert.notDeepEqual(camera.target, originalTarget);
    assert.ok(camera.target.every(Number.isFinite));
  }
});

test("orbit can retarget to the grabbed model point without moving the eye", () => {
  const camera = new OrbitCamera();
  const position = camera.getPosition();
  const pivot = [25, -30, 15];
  camera.orbitAround(pivot);
  assert.ok(camera.getPosition().every((value, index) => Math.abs(value - position[index]) < 0.000001));
  assert.deepEqual(camera.target, pivot);
  camera.orbit(20, -10);
  assert.ok(camera.getPosition().every(Number.isFinite));
});

test("a vertical-face rectangle remains on its plane after an exact extrusion", () => {
  const rectangle = createRectangleEntity([10, 0, 0], [10, 20, 15], [1, 0, 0]);
  extrudeProfile(rectangle, 8);
  const xCoordinates = rectangle.vertices.filter((_, index) => index % 3 === 0);
  assert.deepEqual([...new Set(xCoordinates)].sort((first, second) => first - second), [10, 18]);
});

test("circle and sweep geometry produce usable solids", () => {
  const circle = createCircleEntity([0, 0, 0], 10, 12);
  const geometry = createSweepGeometry(circle.metadata.profilePoints, [0, 0, 20]);
  assert.equal(geometry.vertices.length / 3, 24);
  assert.ok(geometry.indices.length / 3 > 0);
});

test("concave profile extrusion triangulates without a fan crossing the notch", () => {
  const profile = [
    0, 0, 0,
    30, 0, 0,
    30, 30, 0,
    15, 15, 0,
    0, 30, 0
  ];
  const geometry = createSweepGeometry(profile, [0, 0, 10]);
  assert.equal(geometry.indices.length / 3, 16);
  assert.ok(geometry.indices.every((index) => index >= 0 && index < 10));
});

test("self-intersecting profiles are rejected", () => {
  const bowTie = [
    0, 0, 0,
    20, 20, 0,
    0, 20, 0,
    20, 0, 0
  ];
  assert.throws(() => createSweepGeometry(bowTie, [0, 0, 10]), /no area|cannot be triangulated/);
});

test("group preserves children and basic entity lookup", () => {
  const project = createEmptyProject();
  const first = addEntity(project, createBoxEntity(10, 10, 10, "First"));
  const second = addEntity(project, createBoxEntity(10, 10, 10, "Second"));
  const group = makeGroup(project, [first.id, second.id]);
  assert.ok(group);
  assert.equal(group.children.length, 2);
  assert.equal(getEntity(project, first.id).parentId, group.id);
  assert.equal(project.roots.length, 1);
});

test("a group exposes its direct members for context selection", () => {
  const project = createEmptyProject();
  const first = addEntity(project, createBoxEntity(10, 10, 10, "First"));
  const second = addEntity(project, createBoxEntity(10, 10, 10, "Second"));
  const group = makeGroup(project, [first.id, second.id]);
  assert.ok(group);
  assert.deepEqual(group.children, [first.id, second.id]);
});

test("explode group preserves child world transform", () => {
  const project = createEmptyProject();
  const box = addEntity(project, createBoxEntity(10, 10, 10, "Box"));
  box.transform.position = [5, 7, 9];
  const group = makeGroup(project, [box.id]);
  group.transform.position = [20, 30, 40];
  const [exploded] = explodeGroup(project, group);
  assert.deepEqual(exploded.transform.position, [0, 0, 0]);
  assert.equal(exploded.parentId, null);
  assert.deepEqual(entityBounds(project, exploded).min, [20, 32, 49]);
  assert.deepEqual(entityBounds(project, exploded).max, [30, 42, 59]);
});

test("reverse faces changes triangle winding", () => {
  const mesh = createBoxEntity(10, 10, 10);
  const original = mesh.indices.slice(0, 3);
  assert.equal(reverseMeshFaces(mesh), true);
  assert.deepEqual(mesh.indices.slice(0, 3), [original[0], original[2], original[1]]);
});

test("experimental subtraction produces a closed mesh for overlapping boxes", () => {
  const project = createEmptyProject();
  const target = addEntity(project, createBoxEntity(40, 40, 40, "Target"));
  const cutter = addEntity(project, createBoxEntity(20, 20, 20, "Cutter"));
  cutter.transform.position = [0, 0, 10];
  const result = subtractMeshes(project, target, cutter);
  const reportProject = createEmptyProject();
  addEntity(reportProject, result);
  const report = meshReport(reportProject, [result]);
  assert.equal(report.degenerateCount, 0);
  assert.equal(report.boundaryEdgeCount, 0);
  assert.equal(report.nonManifoldEdgeCount, 0);
});

test("reversing a closed mesh still meets basic topology validation", () => {
  const project = createEmptyProject();
  const target = addEntity(project, createBoxEntity(40, 40, 40, "Target"));
  const cutter = addEntity(project, createBoxEntity(20, 20, 20, "Cutter"));
  reverseMeshFaces(cutter);
  assert.doesNotThrow(() => validateSubtractInputs(project, target, cutter));
});

test("experimental subtraction preserves two closed shells for a nested box cutter", () => {
  const project = createEmptyProject();
  const target = addEntity(project, createBoxEntity(40, 40, 40, "Target"));
  const cutter = addEntity(project, createBoxEntity(20, 20, 20, "Cutter"));
  cutter.transform.position = [0, 0, 10];
  const result = subtractMeshes(project, target, cutter);
  const resultProject = createEmptyProject();
  addEntity(resultProject, result);
  const report = meshReport(resultProject, [result]);
  assert.equal(report.degenerateCount, 0);
  assert.equal(report.boundaryEdgeCount, 0);
  assert.equal(report.nonManifoldEdgeCount, 0);
  const vertices = meshWorldVertices(resultProject, result);
  let signedVolume = 0;
  for (let index = 0; index < result.indices.length; index += 3) {
    const first = result.indices[index] * 3;
    const second = result.indices[index + 1] * 3;
    const third = result.indices[index + 2] * 3;
    const a = [vertices[first], vertices[first + 1], vertices[first + 2]];
    const b = [vertices[second], vertices[second + 1], vertices[second + 2]];
    const c = [vertices[third], vertices[third + 1], vertices[third + 2]];
    signedVolume += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  assert.ok(signedVolume > 0);
});

test("project bounds include transformed entity positions", () => {
  const project = createEmptyProject();
  const box = addEntity(project, createBoxEntity(10, 10, 10));
  box.transform.position = [100, 50, 5];
  const bounds = projectBounds(project);
  assert.deepEqual(bounds.min, [95, 45, 5]);
  assert.deepEqual(bounds.max, [105, 55, 15]);
});

test("mesh print reports do not cross-weld separate meshes", () => {
  const project = createEmptyProject();
  const first = addEntity(project, createBoxEntity(10, 10, 10));
  const second = addEntity(project, createBoxEntity(10, 10, 10));
  second.transform.position = [1000, 0, 0];
  const report = meshReport(project, [first, second]);
  assert.equal(report.boundaryEdgeCount, 0);
  assert.equal(report.nonManifoldEdgeCount, 0);
});

test("ASCII STL rejects non-finite coordinates", () => {
  const source = `solid broken
facet normal 0 0 1
 outer loop
  vertex 1e999 0 0
  vertex 10 0 0
  vertex 0 10 0
 endloop
endfacet
endsolid broken`;
  assert.throws(() => parseStl(new TextEncoder().encode(source).buffer, "broken.stl"), /invalid coordinates/);
});
