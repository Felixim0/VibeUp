import assert from "node:assert/strict";
import test from "node:test";

import { createZip, decodeJson, encodeJson, readZip } from "../archive.js";
import { OrbitCamera } from "../camera.js";
import { subtractMeshes, validateSubtractInputs } from "../csg.js";
import {
  addEntity,
  createBoxEntity,
  cutCircularHoleThroughBox,
  createCircleEntity,
  createDemoProject,
  createEmptyProject,
  createRectangleEntity,
  createSweepGeometry,
  entityBounds,
  extrudeProfile,
  getEntity,
  getMeshFaceRegion,
  explodeGroup,
  makeGroup,
  moveMeshFace,
  meshReport,
  meshWorldVertices,
  projectBounds,
  reverseMeshFaces,
  rotateEntityAroundAxis
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

test("orbit moves continuously through the top pole", () => {
  const camera = new OrbitCamera();
  camera.pitch = Math.PI / 2 - 0.01;
  camera.orbit(0, -10);
  assert.ok(camera.pitch > Math.PI / 2);
  const position = camera.getPosition();
  const up = camera.getUp();
  assert.ok(position.every(Number.isFinite));
  assert.ok(up.every(Number.isFinite));
  assert.ok(Math.hypot(...up) > 0.99);
  camera.orbit(0, 30);
  assert.ok(camera.pitch < Math.PI / 2);
});

test("orbit moves continuously through the bottom pole", () => {
  const camera = new OrbitCamera();
  camera.pitch = -Math.PI / 2 + 0.01;
  camera.orbit(0, 10);
  assert.ok(camera.pitch < -Math.PI / 2);
  const { projection, view } = camera.getMatrices(1.5);
  assert.ok(projection.every(Number.isFinite));
  assert.ok(view.every(Number.isFinite));
  camera.orbit(0, -30);
  assert.ok(camera.pitch > -Math.PI / 2);
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
