import {
  cross3,
  mat4Identity,
  normalize3,
  scale3,
  subtract3
} from "./math.js";
import {
  allRenderableEntities,
  computeNormals,
  edgeIndicesForMesh,
  entityWorldMatrix
} from "./geometry.js";

const meshVertexSource = `#version 300 es
in vec3 aPosition;
in vec3 aNormal;
uniform mat4 uModel;
uniform mat4 uViewProjection;
out vec3 vWorldPosition;
out vec3 vNormal;
void main() {
  vec4 worldPosition = uModel * vec4(aPosition, 1.0);
  vWorldPosition = worldPosition.xyz;
  vNormal = normalize(mat3(uModel) * aNormal);
  gl_Position = uViewProjection * worldPosition;
}`;

const meshFragmentSource = `#version 300 es
precision highp float;
in vec3 vWorldPosition;
in vec3 vNormal;
uniform vec3 uColor;
uniform vec3 uLightDirection;
uniform bool uShadows;
uniform vec3 uBackfaceColor;
uniform float uOpacity;
uniform bool uSectionEnabled;
uniform vec3 uSectionPoint;
uniform vec3 uSectionNormal;
out vec4 outputColor;
void main() {
  if (uSectionEnabled && dot(vWorldPosition - uSectionPoint, uSectionNormal) < 0.0) {
    discard;
  }
  float light = uShadows ? max(dot(normalize(vNormal), normalize(uLightDirection)), 0.0) : 1.0;
  vec3 color = uShadows ? uColor * (0.88 + light * 0.12) : uColor;
  if (!gl_FrontFacing) {
    color = uBackfaceColor;
  }
  outputColor = vec4(color, uOpacity);
}`;

const lineVertexSource = `#version 300 es
in vec3 aPosition;
uniform mat4 uModel;
uniform mat4 uViewProjection;
uniform float uPointSize;
void main() {
  gl_Position = uViewProjection * uModel * vec4(aPosition, 1.0);
  gl_PointSize = uPointSize;
}`;

const lineFragmentSource = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 outputColor;
void main() {
  outputColor = uColor;
}`;

const edgeFragmentSource = `#version 300 es
precision highp float;
uniform vec4 uColor;
flat in int vVisible;
out vec4 outputColor;
void main() {
  if (vVisible == 0) {
    discard;
  }
  outputColor = uColor;
}`;

const edgeVertexSource = `#version 300 es
in vec3 aStart;
in vec3 aEnd;
uniform mat4 uModel;
uniform mat4 uViewProjection;
uniform vec2 uViewport;
uniform float uThickness;
flat out int vVisible;
void main() {
  vec4 startClip = uViewProjection * uModel * vec4(aStart, 1.0);
  vec4 endClip = uViewProjection * uModel * vec4(aEnd, 1.0);
  vec2 startNdc = startClip.xy / startClip.w;
  vec2 endNdc = endClip.xy / endClip.w;
  vec2 segment = endNdc - startNdc;
  float segmentLength = length(segment);
  if (segmentLength < 0.00001) {
    gl_Position = startClip;
    vVisible = 0;
    return;
  }
  vec2 perpendicular = vec2(-segment.y, segment.x) / segmentLength;
  int vertex = gl_VertexID % 6;
  bool endPoint = vertex == 1 || vertex == 2 || vertex == 4;
  bool leftSide = vertex == 0 || vertex == 1 || vertex == 3;
  vec4 clip = endPoint ? endClip : startClip;
  float side = leftSide ? -1.0 : 1.0;
  clip.xy += perpendicular * side * uThickness * clip.w / uViewport;
  gl_Position = clip;
  vVisible = 1;
}`;

const hexToRgb = (hex) => {
  const valid = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!valid) {
    return [0.85, 0.88, 0.84];
  }
  const value = Number.parseInt(valid[1], 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
};

const colorWithAlpha = (hex, alpha) => [...hexToRgb(hex), alpha];

const createProgram = (gl, vertexSource, fragmentSource) => {
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    if (!shader) {
      throw new Error("WebGL could not allocate a shader.");
    }
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const details = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`WebGL shader compilation failed: ${details}`);
    }
    return shader;
  };

  const vertexShader = compile(gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compile(gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) {
    throw new Error("WebGL could not allocate a shader program.");
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const details = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`WebGL shader program linking failed: ${details}`);
  }
  return program;
};

const getUniforms = (gl, program, names) => Object.fromEntries(names.map((name) => [name, gl.getUniformLocation(program, name)]));

const getAttributes = (gl, program, names) => Object.fromEntries(names.map((name) => [name, gl.getAttribLocation(program, name)]));

const makeBuffer = (gl, target, data, usage = gl.STATIC_DRAW) => {
  const buffer = gl.createBuffer();
  if (!buffer) {
    throw new Error("WebGL could not allocate a vertex buffer.");
  }
  gl.bindBuffer(target, buffer);
  gl.bufferData(target, data, usage);
  return buffer;
};

const segmentData = (points, paired = false) => {
  const starts = [];
  const ends = [];
  const step = paired ? 6 : 3;
  for (let offset = 0; offset + 5 < points.length; offset += step) {
    starts.push(points[offset], points[offset + 1], points[offset + 2]);
    ends.push(points[offset + 3], points[offset + 4], points[offset + 5]);
  }
  return { starts: new Float32Array(starts), ends: new Float32Array(ends), count: starts.length / 3 };
};

const makeSegmentBuffers = (gl, points, paired = false, usage = gl.STATIC_DRAW) => {
  const data = segmentData(points, paired);
  return {
    start: makeBuffer(gl, gl.ARRAY_BUFFER, data.starts, usage),
    end: makeBuffer(gl, gl.ARRAY_BUFFER, data.ends, usage),
    count: data.count
  };
};

const deleteSegmentBuffers = (gl, segments) => {
  if (!segments) {
    return;
  }
  gl.deleteBuffer(segments.start);
  gl.deleteBuffer(segments.end);
};

const deleteBuffers = (gl, record) => {
  for (const key of ["position", "normal", "indices", "edgeStart", "edgeEnd", "segmentStart", "segmentEnd"]) {
    if (record[key]) {
      gl.deleteBuffer(record[key]);
    }
  }
};

const sectionFrame = (section) => {
  const normal = normalize3(section.normal ?? [0, 0, 1]);
  const candidate = Math.abs(normal[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const tangent = normalize3(cross3(candidate, normal));
  const bitangent = normalize3(cross3(normal, tangent));
  const size = 500;
  const point = section.point;
  return [
    ...subtract3(subtract3(point, scale3(tangent, size)), scale3(bitangent, size)),
    ...addPoint(subtract3(point, scale3(bitangent, size)), tangent, size),
    ...addPoint(addPoint(point, tangent, size), bitangent, size),
    ...addPoint(subtract3(point, scale3(tangent, size)), bitangent, size),
    ...subtract3(subtract3(point, scale3(tangent, size)), scale3(bitangent, size))
  ];
};

const addPoint = (point, direction, distance) => [
  point[0] + direction[0] * distance,
  point[1] + direction[1] * distance,
  point[2] + direction[2] * distance
];

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: true,
      depth: true,
      preserveDrawingBuffer: false
    });
    if (!this.gl) {
      throw new Error("vibe-up needs WebGL 2. Enable hardware acceleration or use a current Chromium browser.");
    }

    this.meshCache = new Map();
    this.lineCache = new Map();
    this.previewBuffer = null;
    this.previewSegments = null;
    this.gridSegments = null;
    this.axisSegments = [];
    this.width = 1;
    this.height = 1;
    this.pixelRatio = 1;
    this.lastMatrices = null;
    this.maxVertexAttributes = this.gl.getParameter(this.gl.MAX_VERTEX_ATTRIBS);
    this.configure();
    this.createPrograms();
    this.createStaticBuffers();
  }

  configure() {
    const { gl } = this;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    // Imported STL files do not consistently use a single face winding order.
    gl.disable(gl.CULL_FACE);
  }

  createPrograms() {
    const { gl } = this;
    const mesh = createProgram(gl, meshVertexSource, meshFragmentSource);
    this.meshProgram = {
      program: mesh,
      attributes: getAttributes(gl, mesh, ["aPosition", "aNormal"]),
      uniforms: getUniforms(gl, mesh, [
        "uModel",
        "uViewProjection",
        "uColor",
        "uLightDirection",
        "uShadows",
        "uBackfaceColor",
        "uOpacity",
        "uSectionEnabled",
        "uSectionPoint",
        "uSectionNormal"
      ])
    };
    const line = createProgram(gl, lineVertexSource, lineFragmentSource);
    this.lineProgram = {
      program: line,
      attributes: getAttributes(gl, line, ["aPosition"]),
      uniforms: getUniforms(gl, line, ["uModel", "uViewProjection", "uColor", "uPointSize"])
    };
    const edge = createProgram(gl, edgeVertexSource, edgeFragmentSource);
    this.edgeProgram = {
      program: edge,
      attributes: getAttributes(gl, edge, ["aStart", "aEnd"]),
      uniforms: getUniforms(gl, edge, ["uModel", "uViewProjection", "uColor", "uViewport", "uThickness"])
    };
  }

  createStaticBuffers() {
    const gridPoints = [];
    const extent = 1000;
    const increment = 50;
    for (let coordinate = -extent; coordinate <= extent; coordinate += increment) {
      gridPoints.push(-extent, coordinate, 0, extent, coordinate, 0);
      gridPoints.push(coordinate, -extent, 0, coordinate, extent, 0);
    }
    this.gridSegments = makeSegmentBuffers(this.gl, gridPoints, true);
    this.axisSegments = [
      makeSegmentBuffers(this.gl, [-1000, 0, 0, 1000, 0, 0], true),
      makeSegmentBuffers(this.gl, [0, -1000, 0, 0, 1000, 0], true),
      makeSegmentBuffers(this.gl, [0, 0, -1000, 0, 0, 1000], true)
    ];
  }

  resize() {
    const nextRatio = Math.min(globalThis.devicePixelRatio || 1, 2);
    const nextWidth = Math.max(1, Math.round(this.canvas.clientWidth * nextRatio));
    const nextHeight = Math.max(1, Math.round(this.canvas.clientHeight * nextRatio));
    if (this.canvas.width !== nextWidth || this.canvas.height !== nextHeight) {
      this.canvas.width = nextWidth;
      this.canvas.height = nextHeight;
    }
    this.width = nextWidth;
    this.height = nextHeight;
    this.pixelRatio = nextRatio;
  }

  getViewport() {
    return {
      width: this.width,
      height: this.height,
      cssWidth: this.width / this.pixelRatio,
      cssHeight: this.height / this.pixelRatio
    };
  }

  getMatrices(camera) {
    const matrices = camera.getMatrices(this.width / this.height);
    this.lastMatrices = matrices;
    return matrices;
  }

  invalidate(id = null) {
    if (id) {
      const mesh = this.meshCache.get(id);
      if (mesh) {
        deleteBuffers(this.gl, mesh);
        this.meshCache.delete(id);
      }
      const line = this.lineCache.get(id);
      if (line) {
        deleteBuffers(this.gl, line);
        this.lineCache.delete(id);
      }
      return;
    }
    for (const record of this.meshCache.values()) {
      deleteBuffers(this.gl, record);
    }
    for (const record of this.lineCache.values()) {
      deleteBuffers(this.gl, record);
    }
    this.meshCache.clear();
    this.lineCache.clear();
  }

  ensureMesh(entity) {
    const existing = this.meshCache.get(entity.id);
    if (existing && existing.vertices === entity.vertices && existing.indicesSource === entity.indices) {
      return existing;
    }
    if (existing) {
      deleteBuffers(this.gl, existing);
    }
    const { gl } = this;
    const vertexData = new Float32Array(entity.vertices);
    const indexData = vertexData.length / 3 > 65535 ? new Uint32Array(entity.indices) : new Uint16Array(entity.indices);
    const edgeSource = edgeIndicesForMesh(entity.vertices, entity.indices, entity.metadata?.seams);
    const edgeStartData = new Float32Array((edgeSource.length / 2) * 3);
    const edgeEndData = new Float32Array((edgeSource.length / 2) * 3);
    for (let index = 0; index < edgeSource.length; index += 2) {
      const edgeIndex = (index / 2) * 3;
      const startIndex = edgeSource[index] * 3;
      const endIndex = edgeSource[index + 1] * 3;
      edgeStartData.set(vertexData.slice(startIndex, startIndex + 3), edgeIndex);
      edgeEndData.set(vertexData.slice(endIndex, endIndex + 3), edgeIndex);
    }
    const record = {
      vertices: entity.vertices,
      indicesSource: entity.indices,
      position: makeBuffer(gl, gl.ARRAY_BUFFER, vertexData),
      normal: makeBuffer(gl, gl.ARRAY_BUFFER, new Float32Array(computeNormals(entity.vertices, entity.indices))),
      indices: makeBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, indexData),
      edgeStart: makeBuffer(gl, gl.ARRAY_BUFFER, edgeStartData),
      edgeEnd: makeBuffer(gl, gl.ARRAY_BUFFER, edgeEndData),
      indexType: indexData instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
      indexCount: indexData.length,
      edgeCount: edgeSource.length / 2
    };
    this.meshCache.set(entity.id, record);
    return record;
  }

  ensureLine(entity) {
    const existing = this.lineCache.get(entity.id);
    const source = entity.points ?? [];
    if (existing && existing.source === source && existing.closed === entity.closed) {
      return existing;
    }
    if (existing) {
      deleteBuffers(this.gl, existing);
    }
    const points = Array.from(source);
    if (entity.closed && points.length >= 3) {
      points.push(points[0], points[1], points[2]);
    }
    const record = {
      source,
      closed: entity.closed,
      position: makeBuffer(this.gl, this.gl.ARRAY_BUFFER, new Float32Array(points)),
      count: points.length / 3,
      segmentStart: null,
      segmentEnd: null,
      segmentCount: 0
    };
    const segments = segmentData(points);
    record.segmentStart = makeBuffer(this.gl, this.gl.ARRAY_BUFFER, segments.starts);
    record.segmentEnd = makeBuffer(this.gl, this.gl.ARRAY_BUFFER, segments.ends);
    record.segmentCount = segments.count;
    this.lineCache.set(entity.id, record);
    return record;
  }

  useLineProgram(viewProjection, pointSize = 5) {
    const { gl, lineProgram } = this;
    gl.useProgram(lineProgram.program);
    gl.uniformMatrix4fv(lineProgram.uniforms.uViewProjection, false, viewProjection);
    gl.uniform1f(lineProgram.uniforms.uPointSize, pointSize * this.pixelRatio);
  }

  resetVertexAttributes() {
    const { gl } = this;
    for (let index = 0; index < this.maxVertexAttributes; index += 1) {
      gl.disableVertexAttribArray(index);
      gl.vertexAttribDivisor(index, 0);
    }
  }

  drawLines(buffer, count, model, color, mode = null) {
    const { gl, lineProgram } = this;
    this.resetVertexAttributes();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(lineProgram.attributes.aPosition);
    gl.vertexAttribPointer(lineProgram.attributes.aPosition, 3, gl.FLOAT, false, 0, 0);
    gl.uniformMatrix4fv(lineProgram.uniforms.uModel, false, model);
    gl.uniform4fv(lineProgram.uniforms.uColor, color);
    gl.drawArrays(mode ?? gl.LINE_STRIP, 0, count);
  }

  drawThickSegments(segments, model, viewProjection, color, thickness) {
    if (!segments?.count) {
      return;
    }
    const { gl, edgeProgram } = this;
    gl.useProgram(edgeProgram.program);
    this.resetVertexAttributes();
    gl.bindBuffer(gl.ARRAY_BUFFER, segments.start);
    gl.enableVertexAttribArray(edgeProgram.attributes.aStart);
    gl.vertexAttribPointer(edgeProgram.attributes.aStart, 3, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(edgeProgram.attributes.aStart, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, segments.end);
    gl.enableVertexAttribArray(edgeProgram.attributes.aEnd);
    gl.vertexAttribPointer(edgeProgram.attributes.aEnd, 3, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(edgeProgram.attributes.aEnd, 1);
    gl.uniformMatrix4fv(edgeProgram.uniforms.uModel, false, model);
    gl.uniformMatrix4fv(edgeProgram.uniforms.uViewProjection, false, viewProjection);
    gl.uniform4fv(edgeProgram.uniforms.uColor, color);
    gl.uniform2f(edgeProgram.uniforms.uViewport, this.width, this.height);
    gl.uniform1f(edgeProgram.uniforms.uThickness, thickness * this.pixelRatio);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, segments.count);
    this.resetVertexAttributes();
  }

  drawGrid(viewProjection, visible, appearance) {
    if (!visible) {
      return;
    }
    const { gl } = this;
    gl.disable(gl.DEPTH_TEST);
    this.drawThickSegments(this.gridSegments, mat4Identity(), viewProjection, colorWithAlpha(appearance.gridColor, 0.45), 0.7);
    this.drawThickSegments(this.axisSegments[0], mat4Identity(), viewProjection, [0.86, 0.25, 0.28, 0.9], 1.65);
    this.drawThickSegments(this.axisSegments[1], mat4Identity(), viewProjection, [0.3, 0.88, 0.48, 0.84], 1.65);
    this.drawThickSegments(this.axisSegments[2], mat4Identity(), viewProjection, [0.32, 0.62, 1, 0.84], 1.65);
    gl.enable(gl.DEPTH_TEST);
  }

  drawMesh(entity, material, model, viewProjection, settings, selected, componentSelections, section) {
    const { gl, meshProgram } = this;
    const record = this.ensureMesh(entity);
    gl.useProgram(meshProgram.program);
    this.resetVertexAttributes();
    gl.bindBuffer(gl.ARRAY_BUFFER, record.position);
    gl.enableVertexAttribArray(meshProgram.attributes.aPosition);
    gl.vertexAttribPointer(meshProgram.attributes.aPosition, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, record.normal);
    gl.enableVertexAttribArray(meshProgram.attributes.aNormal);
    gl.vertexAttribPointer(meshProgram.attributes.aNormal, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, record.indices);
    const color = hexToRgb(material?.color);
    const objectSelected = selected && componentSelections.length === 0;
    gl.uniformMatrix4fv(meshProgram.uniforms.uModel, false, model);
    gl.uniformMatrix4fv(meshProgram.uniforms.uViewProjection, false, viewProjection);
    gl.uniform3fv(meshProgram.uniforms.uColor, color);
    gl.uniform3fv(meshProgram.uniforms.uLightDirection, normalize3([-0.4, -0.55, 0.73]));
    gl.uniform1i(meshProgram.uniforms.uShadows, settings.shadowsVisible ? 1 : 0);
    gl.uniform3fv(meshProgram.uniforms.uBackfaceColor, [0.62, 0.72, 0.95]);
    gl.uniform1f(meshProgram.uniforms.uOpacity, 1);
    gl.uniform1i(meshProgram.uniforms.uSectionEnabled, section ? 1 : 0);
    gl.uniform3fv(meshProgram.uniforms.uSectionPoint, section?.point ?? [0, 0, 0]);
    gl.uniform3fv(meshProgram.uniforms.uSectionNormal, section?.normal ?? [0, 0, 1]);
    gl.drawElements(gl.TRIANGLES, record.indexCount, record.indexType, 0);

    if (settings.edgesVisible || objectSelected) {
      const { edgeProgram } = this;
      gl.useProgram(edgeProgram.program);
      this.resetVertexAttributes();
      gl.bindBuffer(gl.ARRAY_BUFFER, record.edgeStart);
      gl.enableVertexAttribArray(edgeProgram.attributes.aStart);
      gl.vertexAttribPointer(edgeProgram.attributes.aStart, 3, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(edgeProgram.attributes.aStart, 1);
      gl.bindBuffer(gl.ARRAY_BUFFER, record.edgeEnd);
      gl.enableVertexAttribArray(edgeProgram.attributes.aEnd);
      gl.vertexAttribPointer(edgeProgram.attributes.aEnd, 3, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(edgeProgram.attributes.aEnd, 1);
      gl.uniformMatrix4fv(edgeProgram.uniforms.uModel, false, model);
      gl.uniformMatrix4fv(edgeProgram.uniforms.uViewProjection, false, viewProjection);
      gl.uniform4fv(edgeProgram.uniforms.uColor, objectSelected ? colorWithAlpha(settings.appearance.selectionColor, 0.82) : colorWithAlpha(settings.appearance.edgeColor, 0.92));
      gl.uniform2f(edgeProgram.uniforms.uViewport, this.width, this.height);
      gl.uniform1f(edgeProgram.uniforms.uThickness, Math.max(objectSelected ? 1.3 : 0.7, settings.appearance.edgeWidth * 0.62) * this.pixelRatio);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, record.edgeCount);
      this.resetVertexAttributes();
    }

    for (const componentSelection of componentSelections.filter((component) => component.type === "face")) {
      const faceIndices = componentSelection.triangleIndices.flatMap((triangleIndex) => entity.indices.slice(triangleIndex * 3, triangleIndex * 3 + 3));
      if (faceIndices.length === 0) {
        continue;
      }
      const indexData = record.indexType === gl.UNSIGNED_INT ? new Uint32Array(faceIndices) : new Uint16Array(faceIndices);
      const faceBuffer = makeBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, indexData, gl.DYNAMIC_DRAW);
      gl.useProgram(meshProgram.program);
      this.resetVertexAttributes();
      gl.bindBuffer(gl.ARRAY_BUFFER, record.position);
      gl.enableVertexAttribArray(meshProgram.attributes.aPosition);
      gl.vertexAttribPointer(meshProgram.attributes.aPosition, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, record.normal);
      gl.enableVertexAttribArray(meshProgram.attributes.aNormal);
      gl.vertexAttribPointer(meshProgram.attributes.aNormal, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, faceBuffer);
      gl.uniformMatrix4fv(meshProgram.uniforms.uModel, false, model);
      gl.uniformMatrix4fv(meshProgram.uniforms.uViewProjection, false, viewProjection);
      gl.uniform3fv(meshProgram.uniforms.uColor, hexToRgb(settings.appearance.selectionColor));
      gl.uniform3fv(meshProgram.uniforms.uLightDirection, [0, 0, 1]);
      gl.uniform1i(meshProgram.uniforms.uShadows, 0);
      gl.uniform3fv(meshProgram.uniforms.uBackfaceColor, hexToRgb(settings.appearance.selectionColor));
      gl.uniform1f(meshProgram.uniforms.uOpacity, 0.26);
      gl.uniform1i(meshProgram.uniforms.uSectionEnabled, section ? 1 : 0);
      gl.uniform3fv(meshProgram.uniforms.uSectionPoint, section?.point ?? [0, 0, 0]);
      gl.uniform3fv(meshProgram.uniforms.uSectionNormal, section?.normal ?? [0, 0, 1]);
      gl.drawElements(gl.TRIANGLES, indexData.length, record.indexType, 0);
      gl.deleteBuffer(faceBuffer);
      for (const edge of componentSelection.edges ?? []) {
        const edgeBuffer = makeSegmentBuffers(gl, [...edge.start, ...edge.end], true, gl.DYNAMIC_DRAW);
        this.drawThickSegments(edgeBuffer, mat4Identity(), viewProjection, colorWithAlpha(settings.appearance.selectionColor, 0.9), Math.max(1.3, settings.appearance.edgeWidth * 0.65));
        deleteSegmentBuffers(gl, edgeBuffer);
      }
    }

    for (const componentSelection of componentSelections.filter((component) => component.type === "edge")) {
      const endpoints = new Float32Array([...componentSelection.start, ...componentSelection.end]);
      const edgeBuffer = makeBuffer(gl, gl.ARRAY_BUFFER, endpoints, gl.DYNAMIC_DRAW);
      this.useLineProgram(viewProjection, Math.max(3, settings.appearance.edgeWidth * 1.25));
      this.drawLines(edgeBuffer, 2, mat4Identity(), colorWithAlpha(settings.appearance.selectionColor, 0.88), gl.LINES);
      gl.deleteBuffer(edgeBuffer);
    }
  }

  drawEntityLine(entity, model, viewProjection, selected, appearance) {
    const record = this.ensureLine(entity);
    this.drawThickSegments(
      { start: record.segmentStart, end: record.segmentEnd, count: record.segmentCount },
      model,
      viewProjection,
      selected ? colorWithAlpha(appearance.selectionColor, 0.82) : colorWithAlpha(appearance.edgeColor, 1),
      Math.max(selected ? 1.35 : 0.85, appearance.edgeWidth * 0.55)
    );
  }

  drawSection(section, viewProjection) {
    if (!section) {
      return;
    }
    const points = sectionFrame(section);
    this.drawPreview(points, viewProjection, [0.97, 0.57, 0.28, 0.88]);
  }

  drawPreview(points, viewProjection, color = [0.41, 0.96, 0.83, 0.95], pointsMode = false, pointSize = 5) {
    if (!points || points.length < 3) {
      return;
    }
    const { gl } = this;
    if (!this.previewBuffer) {
      this.previewBuffer = gl.createBuffer();
    }
    if (!this.previewSegments) {
      this.previewSegments = {
        start: gl.createBuffer(),
        end: gl.createBuffer(),
        count: 0
      };
    }
    if (!this.previewSegments.start || !this.previewSegments.end) {
      throw new Error("WebGL could not allocate preview buffers.");
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.previewBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(points), gl.DYNAMIC_DRAW);
    const segments = segmentData(points);
    this.previewSegments.count = segments.count;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.previewSegments.start);
    gl.bufferData(gl.ARRAY_BUFFER, segments.starts, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.previewSegments.end);
    gl.bufferData(gl.ARRAY_BUFFER, segments.ends, gl.DYNAMIC_DRAW);
    gl.disable(gl.DEPTH_TEST);
    this.drawThickSegments(this.previewSegments, mat4Identity(), viewProjection, color, Math.max(1.75, pointSize * 0.35));
    if (pointsMode) {
      this.useLineProgram(viewProjection, pointSize);
      this.drawLines(this.previewBuffer, points.length / 3, mat4Identity(), color, gl.POINTS);
    }
    gl.enable(gl.DEPTH_TEST);
  }

  render(project, camera, selection = new Set(), componentSelection = null, preview = null) {
    this.resize();
    const { gl } = this;
    const { projection, view } = this.getMatrices(camera);
    const product = multiplyMatrices(projection, view);
    gl.viewport(0, 0, this.width, this.height);
    const appearance = project.settings.appearance;
    const canvasColor = hexToRgb(appearance.canvasColor);
    gl.clearColor(canvasColor[0], canvasColor[1], canvasColor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.drawGrid(product, project.settings.gridVisible, appearance);

    const section = project.settings.section?.enabled ? project.settings.section : null;
    for (const entity of allRenderableEntities(project)) {
      const model = entityWorldMatrix(project, entity);
      if (entity.kind === "mesh") {
        const material = project.materials.find((candidate) => candidate.id === entity.materialId) ?? project.materials[0];
        const entityComponentSelections = componentSelection?.type === "multi"
          ? componentSelection.components.filter((component) => component.entityId === entity.id)
          : componentSelection?.entityId === entity.id ? [componentSelection] : [];
        this.drawMesh(entity, material, model, product, project.settings, selection.has(entity.id), entityComponentSelections, section);
      } else if (entity.kind === "edge" || entity.kind === "annotation") {
        this.drawEntityLine(entity, model, product, selection.has(entity.id), appearance);
      }
    }
    this.drawSection(section, product);
    if (preview?.points?.length) {
      this.drawPreview(preview.points, product, preview.color, preview.pointsMode, Math.max(8, appearance.edgeWidth * 3));
    }
    return { projection, view, viewProjection: product };
  }

  destroy() {
    this.invalidate();
    const { gl } = this;
    if (this.previewBuffer) {
      gl.deleteBuffer(this.previewBuffer);
    }
    deleteSegmentBuffers(gl, this.previewSegments);
    deleteSegmentBuffers(gl, this.gridSegments);
    for (const segments of this.axisSegments) {
      deleteSegmentBuffers(gl, segments);
    }
    gl.deleteProgram(this.meshProgram.program);
    gl.deleteProgram(this.lineProgram.program);
    gl.deleteProgram(this.edgeProgram.program);
  }
}

const multiplyMatrices = (a, b) => {
  const output = new Float32Array(16);
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
