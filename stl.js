import { cross3, normalize3, subtract3 } from "./math.js";
import { createMeshEntity, meshWorldTriangleIterator } from "./geometry.js";

const decoder = new TextDecoder();
const encoder = new TextEncoder();
const MAX_TRIANGLES = 100_000;
const likelyAscii = (bytes) => /^\s*solid\b/i.test(decoder.decode(bytes.slice(0, Math.min(bytes.length, 80))));

const baseName = (fileName) => fileName.replace(/\.stl$/i, "") || "Imported STL";

const numberPattern = "[-+]?(?:\\d*\\.\\d+|\\d+\\.?)(?:[eE][-+]?\\d+)?";
const vertexPattern = new RegExp(`vertex\\s+(${numberPattern})\\s+(${numberPattern})\\s+(${numberPattern})`, "gi");

const parseAsciiStl = (bytes, name) => {
  const text = decoder.decode(bytes);
  const vertices = [];
  let match = vertexPattern.exec(text);
  while (match) {
    const coordinates = [Number.parseFloat(match[1]), Number.parseFloat(match[2]), Number.parseFloat(match[3])];
    if (!coordinates.every(Number.isFinite)) {
      throw new Error("The ASCII STL contains invalid coordinates.");
    }
    vertices.push(...coordinates);
    if (vertices.length / 9 > MAX_TRIANGLES) {
      throw new Error("This STL exceeds the 100,000 triangle safety limit.");
    }
    match = vertexPattern.exec(text);
  }
  if (vertices.length === 0 || vertices.length % 9 !== 0) {
    throw new Error("The ASCII STL does not contain complete triangular facets.");
  }
  const triangleCount = vertices.length / 9;
  if (triangleCount > MAX_TRIANGLES) {
    throw new Error("This STL exceeds the 100,000 triangle safety limit.");
  }
  return createMeshEntity({
    name: baseName(name),
    vertices,
    indices: Array.from({ length: vertices.length / 3 }, (_, index) => index),
    metadata: { imported: "stl", solid: false, source: name }
  });
};

const parseBinaryStl = (bytes, name) => {
  if (bytes.byteLength < 84) {
    throw new Error("The binary STL header is incomplete.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triangleCount = view.getUint32(80, true);
  if (triangleCount > MAX_TRIANGLES) {
    throw new Error("This STL exceeds the 100,000 triangle safety limit.");
  }
  const expectedLength = 84 + triangleCount * 50;
  if (bytes.byteLength !== expectedLength) {
    throw new Error("The binary STL has an invalid length.");
  }
  const vertices = new Array(triangleCount * 9);
  let vertexOffset = 0;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const offset = 84 + triangle * 50 + 12;
    for (let coordinate = 0; coordinate < 9; coordinate += 1) {
      const value = view.getFloat32(offset + coordinate * 4, true);
      if (!Number.isFinite(value)) {
        throw new Error("The binary STL contains invalid coordinates.");
      }
      vertices[vertexOffset] = value;
      vertexOffset += 1;
    }
  }
  return createMeshEntity({
    name: baseName(name),
    vertices,
    indices: Array.from({ length: vertices.length / 3 }, (_, index) => index),
    metadata: { imported: "stl", solid: false, source: name }
  });
};

export const parseStl = (buffer, name = "Imported STL") => {
  const bytes = new Uint8Array(buffer);
  if (bytes.length === 0) {
    throw new Error("The STL file is empty.");
  }
  const declaredTriangles = bytes.length >= 84 ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true) : 0;
  if (declaredTriangles > MAX_TRIANGLES && !likelyAscii(bytes)) {
    throw new Error("This STL exceeds the 100,000 triangle safety limit.");
  }
  const binaryLength = bytes.length >= 84 ? 84 + declaredTriangles * 50 : -1;
  if (binaryLength === bytes.length) {
    return parseBinaryStl(bytes, name);
  }
  try {
    return parseAsciiStl(bytes, name);
  } catch (asciiError) {
    if (bytes.length >= 84) {
      throw new Error(`The STL is neither a valid ASCII STL nor a valid binary STL: ${asciiError.message}`);
    }
    throw asciiError;
  }
};

const triangleNormal = (a, b, c) => normalize3(cross3(subtract3(b, a), subtract3(c, a)));

export const createBinaryStl = (project, entities) => {
  const meshes = entities.filter((entity) => entity.kind === "mesh");
  let triangleCount = 0;
  for (const entity of meshes) {
    triangleCount += entity.indices.length / 3;
  }
  if (triangleCount === 0) {
    throw new Error("There are no mesh faces available for STL export.");
  }
  if (triangleCount > MAX_TRIANGLES) {
    throw new Error("The export exceeds the 100,000 triangle safety limit.");
  }

  const output = new ArrayBuffer(84 + triangleCount * 50);
  const bytes = new Uint8Array(output);
  const header = encoder.encode("vibe-up binary STL | millimetres");
  bytes.set(header.slice(0, 80));
  const view = new DataView(output);
  view.setUint32(80, triangleCount, true);
  let offset = 84;

  for (const entity of meshes) {
    for (const [a, b, c] of meshWorldTriangleIterator(project, entity)) {
      const normal = triangleNormal(a, b, c);
      for (let coordinate = 0; coordinate < 3; coordinate += 1) {
        view.setFloat32(offset + coordinate * 4, normal[coordinate], true);
      }
      offset += 12;
      for (const point of [a, b, c]) {
        for (let coordinate = 0; coordinate < 3; coordinate += 1) {
          view.setFloat32(offset + coordinate * 4, point[coordinate], true);
        }
        offset += 12;
      }
      view.setUint16(offset, 0, true);
      offset += 2;
    }
  }
  return new Blob([output], { type: "model/stl" });
};

export const stlTriangleCount = (project, entities) => entities
  .filter((entity) => entity.kind === "mesh")
  .reduce((count, entity) => count + entity.indices.length / 3, 0);
