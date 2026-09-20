import { readZip, createZip, decodeJson, encodeJson } from "./archive.js";
import { OrbitCamera } from "./camera.js";
import { subtractMeshes, validateSubtractInputs } from "./csg.js";
import {
  DEFAULT_MATERIALS,
  DEFAULT_APPEARANCE,
  addEntity,
  allRenderableEntities,
  annotationWorldPoints,
  cloneEntityTree,
  createAnnotationEntity,
  createBoxEntity,
  createCircleEntity,
  cutCircularHoleThroughBox,
  edgeIndicesForMesh,
  getMeshFaceRegion,
  hideMeshEdge,
  createCylinderEntity,
  createDemoProject,
  createEdgeEntity,
  createEmptyProject,
  createPolygonEntity,
  createRectangleEntity,
  entityBounds,
  explodeGroup,
  extrudeProfile,
  getEntity,
  getMaterial,
  isEntityVisible,
  lineWorldPoints,
  makeGroup,
  moveMeshFace,
  meshReport,
  meshWorldVertices,
  newId,
  offsetProfile,
  planeBasis,
  projectBounds,
  removeEntity,
  removeMeshFaces,
  reverseMeshFaces,
  rotateEntityAroundAxis,
  sweepProfile
} from "./geometry.js";
import {
  add3,
  cross3,
  dot3,
  distance3,
  intersectRayPlane,
  intersectRayTriangle,
  midpoint3,
  normalize3,
  projectPoint,
  rayFromScreen,
  scale3,
  signedAngleAroundAxis,
  subtract3
} from "./math.js";
import { clearRecovery, loadRecovery, loadWorkspace, migrateWorkspace, saveRecovery, saveWorkspace } from "./persistence.js";
import { Renderer } from "./renderer.js";
import { createBinaryStl, parseStl, stlTriangleCount } from "./stl.js";

const MAX_HISTORY = 30;
const LARGE_PICK_TRIANGLE_COUNT = 120000;
const MAX_SNAP_MESH_TRIANGLES = 20000;
const TOOL_CURSORS = {
  select: "url('./icons/cursor-select.svg') 5 3, default",
  move: "url('./icons/cursor-move.svg') 23 0, move",
  rotate: "url('./icons/cursor-rotate.svg') 23 0, crosshair",
  line: "url('./icons/cursor-draw.svg') 23 0, crosshair",
  rectangle: "url('./icons/cursor-draw.svg') 23 0, crosshair",
  circle: "url('./icons/cursor-draw.svg') 23 0, crosshair",
  polygon: "url('./icons/cursor-draw.svg') 23 0, crosshair",
  arc: "url('./icons/cursor-draw.svg') 23 0, crosshair",
  freehand: "url('./icons/cursor-draw.svg') 23 0, crosshair",
  pushpull: "url('./icons/cursor-pushpull.svg') 23 0, crosshair",
  offset: "url('./icons/cursor-draw.svg') 23 0, crosshair",
  followme: "url('./icons/cursor-draw.svg') 23 0, crosshair",
  tape: "url('./icons/cursor-measure.svg') 23 0, crosshair",
  protractor: "url('./icons/cursor-measure.svg') 23 0, crosshair",
  dimension: "url('./icons/cursor-measure.svg') 23 0, crosshair",
  text: "text",
  axes: "crosshair",
  section: "crosshair",
  eraser: "url('./icons/cursor-erase.svg') 23 0, crosshair",
  paint: "url('./icons/cursor-paint.svg') 23 0, crosshair",
  orbit: "url('./icons/cursor-orbit.svg') 23 0, grab",
  pan: "url('./icons/cursor-pan.svg') 23 0, grab",
  zoom: "url('./icons/cursor-zoom.svg') 23 0, zoom-in",
  scale: "nwse-resize"
};
const TOOL_HINTS = {
  select: "Click a face, edge, or entity to select it. Delete removes the selected component; Shift-click adds or removes entities from the selection.",
  line: "Click a start point, then click an end point. Type a length in Measurements for an exact line.",
  rectangle: "Click two opposite corners. Type width, depth in Measurements for exact dimensions.",
  circle: "Click the centre, then the circumference. Set segments from the circle button menu or type radius, segments in Measurements.",
  polygon: "Click the centre, then the radius. Measurements accepts radius, sides.",
  arc: "Click centre, start, then end to draw an arc.",
  freehand: "Drag across the workspace to draw a freehand edge path.",
  eraser: "Click an entity to erase it.",
  paint: "Choose a material in the Materials tray, then click a mesh to paint it.",
  move: "Select entities, then drag on the ground plane. Measurements accepts X, Y, Z translation.",
  rotate: "Select an object, then click a face or edge to place a protractor. Move the pointer to set its rotation angle; click to apply.",
  scale: "Select entities, then drag left or right to scale uniformly. Measurements accepts one factor or X, Y, Z.",
  pushpull: "Click a planar face, move to preview the extrusion, then click again to apply. Measurements accepts an exact height.",
  offset: "Select a planar face, then drag or enter an exact offset distance in Measurements.",
  followme: "Select a planar face, then drag a path or enter an X, Y, Z sweep vector in Measurements.",
  tape: "Click two points to create a tape-measure annotation in millimetres.",
  protractor: "Click centre, first ray, then second ray to record an angle.",
  dimension: "Click two points to create a dimension annotation.",
  text: "Click a point to place a text label.",
  axes: "Click a point to place an axes-origin marker.",
  section: "Click the drawing plane to place a horizontal section cut.",
  orbit: "Drag to orbit. Hold Control while orbiting to pan in the view plane. Middle mouse pans; Alt-drag also orbits from any tool.",
  pan: "Drag to pan. Middle mouse also pans from any tool.",
  zoom: "Drag vertically or use the mouse wheel to zoom."
};

const elements = {
  appShell: document.querySelector("#app-shell"),
  canvas: document.querySelector("#viewport"),
  annotationLayer: document.querySelector("#annotation-layer"),
  viewportHint: document.querySelector("#viewport-hint"),
  statusMessage: document.querySelector("#status-message"),
  selectionStatus: document.querySelector("#selection-status"),
  measurements: document.querySelector("#measurements-input"),
  documentTitle: document.querySelector("#document-title"),
  workArea: document.querySelector(".work-area"),
  sidebar: document.querySelector("#sidebar"),
  entityInfo: document.querySelector("#entity-info"),
  tagsList: document.querySelector("#tags-list"),
  materialsList: document.querySelector("#materials-list"),
  scenesList: document.querySelector("#scenes-list"),
  outlinerList: document.querySelector("#outliner-list"),
  projectInput: document.querySelector("#project-input"),
  stlInput: document.querySelector("#stl-input"),
  dropOverlay: document.querySelector("#drop-overlay"),
  modal: document.querySelector("#modal-dialog"),
  modalTitle: document.querySelector("#modal-title"),
  modalContent: document.querySelector("#modal-content"),
  modalActions: document.querySelector("#modal-actions"),
  install: document.querySelector("#install-button"),
  viewCube: document.querySelector("#view-cube"),
  ribbon: document.querySelector("#ribbon"),
  detachRibbon: document.querySelector("#detach-ribbon-button"),
  attachRibbon: document.querySelector("#attach-ribbon-button"),
  floatingPalette: document.querySelector("#floating-palette"),
  floatingPaletteTitle: document.querySelector("#floating-palette-title"),
  floatingPaletteTools: document.querySelector("#floating-palette-tools"),
  snapIndicator: document.querySelector("#snap-indicator")
};

const app = {
  project: createDemoProject(),
  camera: new OrbitCamera(),
  renderer: null,
  selection: new Set(),
  selectionOrder: [],
  activeTool: "select",
  activeMaterialId: "material-default",
  interaction: null,
  pending: null,
  componentSelection: null,
  hoverPoint: null,
  renderMatrices: null,
  history: [],
  future: [],
  dirty: false,
  autosaveTimer: null,
  renderScheduled: false,
  fileHandle: null,
  openAlreadyConfirmed: false,
  installPrompt: null,
  activeRibbon: "home",
  paletteDetached: false,
  paletteOffset: { x: 26, y: 148 },
  snap: null,
  inference: null,
  preferences: {
    onboardingDismissed: false
  }
};

const PREFERENCE_KEY = "vibe-up-preferences";

const colorPattern = /^#[0-9a-f]{6}$/i;

const normalizeAppearance = (raw) => {
  const appearance = raw && typeof raw === "object" ? raw : {};
  const rawSelectionColor = typeof appearance.selectionColor === "string" ? appearance.selectionColor : "";
  const selectionColor = rawSelectionColor.toLowerCase() === "#f2bf2f"
    ? DEFAULT_APPEARANCE.selectionColor
    : rawSelectionColor;
  return {
    theme: appearance.theme === "dark" ? "dark" : "light",
    canvasColor: colorPattern.test(appearance.canvasColor ?? "") ? appearance.canvasColor : DEFAULT_APPEARANCE.canvasColor,
    gridColor: colorPattern.test(appearance.gridColor ?? "") ? appearance.gridColor : DEFAULT_APPEARANCE.gridColor,
    edgeColor: colorPattern.test(appearance.edgeColor ?? "") ? appearance.edgeColor : DEFAULT_APPEARANCE.edgeColor,
    selectionColor: colorPattern.test(selectionColor ?? "") ? selectionColor : DEFAULT_APPEARANCE.selectionColor,
    edgeWidth: Number.isFinite(appearance.edgeWidth) ? Math.max(1, Math.min(4, appearance.edgeWidth)) : DEFAULT_APPEARANCE.edgeWidth
  };
};

const applyAppearance = () => {
  app.project.settings.appearance = normalizeAppearance(app.project.settings.appearance);
  document.body.classList.toggle("theme-dark", app.project.settings.appearance.theme === "dark");
  document.body.classList.toggle("theme-light", app.project.settings.appearance.theme !== "dark");
  requestRender();
};

const loadPreferences = () => {
  try {
    const preferences = JSON.parse(localStorage.getItem(PREFERENCE_KEY) ?? "{}");
    app.preferences.onboardingDismissed = preferences.onboardingDismissed === true;
    app.preferences.paletteDetached = preferences.paletteDetached === true;
    if (Number.isFinite(preferences.paletteX) && Number.isFinite(preferences.paletteY)) {
      app.paletteOffset = { x: preferences.paletteX, y: preferences.paletteY };
    }
  } catch {
    app.preferences.onboardingDismissed = false;
    app.preferences.paletteDetached = false;
  }
};

const savePreferences = () => {
  try {
    localStorage.setItem(PREFERENCE_KEY, JSON.stringify(app.preferences));
  } catch {
    // Local preferences are a convenience and do not block editing.
  }
};

const element = (tag, options = {}) => {
  const node = document.createElement(tag);
  if (options.className) {
    node.className = options.className;
  }
  if (options.text !== undefined) {
    node.textContent = options.text;
  }
  if (options.type) {
    node.type = options.type;
  }
  if (options.value !== undefined) {
    node.value = options.value;
  }
  if (options.title) {
    node.title = options.title;
  }
  if (options.disabled) {
    node.disabled = true;
  }
  if (options.checked !== undefined) {
    node.checked = options.checked;
  }
  if (options.placeholder) {
    node.placeholder = options.placeholder;
  }
  if (options.min !== undefined) {
    node.min = options.min;
  }
  if (options.max !== undefined) {
    node.max = options.max;
  }
  if (options.step !== undefined) {
    node.step = options.step;
  }
  return node;
};

const append = (parent, ...children) => {
  for (const child of children.flat()) {
    if (child) {
      parent.append(child);
    }
  }
  return parent;
};

const setStatus = (message, tone = "normal") => {
  elements.statusMessage.textContent = message;
  elements.statusMessage.dataset.tone = tone;
};

const formatNumber = (value, decimals = 3) => {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return Number.parseFloat(value.toFixed(decimals)).toString();
};

const formatLength = (value) => `${formatNumber(value)} mm`;

const formatAngle = (radians) => `${formatNumber((radians * 180) / Math.PI, 2)} deg`;

const sanitizeFileName = (name) => {
  const cleaned = String(name || "untitled-model")
    .trim()
    .replace(/[^a-z0-9._ -]+/gi, "-")
    .replace(/[. ]+$/g, "")
    .slice(0, 96);
  return cleaned || "untitled-model";
};

const setDirty = (value = true) => {
  app.dirty = value;
  updateDocumentTitle();
  if (value) {
    scheduleAutosave();
  }
};

const updateDocumentTitle = () => {
  const name = app.project.name || "Untitled model";
  const marker = app.dirty ? " *" : "";
  elements.documentTitle.textContent = `${name}${marker}`;
  document.title = `${name}${marker} | vibe-up`;
};

const scheduleAutosave = () => {
  window.clearTimeout(app.autosaveTimer);
  app.autosaveTimer = window.setTimeout(async () => {
    try {
      await persistWorkspaceNow();
    } catch (error) {
      setStatus(`Local autosave could not run: ${error.message}`, "warning");
    }
  }, 650);
};

const workspacePayload = () => ({
  formatVersion: 1,
  project: app.project,
  camera: app.camera.serialize(),
  savedAt: new Date().toISOString()
});

const persistWorkspaceNow = () => saveWorkspace(workspacePayload());

const preserveRecovery = () => app.dirty ? saveRecovery(workspacePayload()) : Promise.resolve();

const scheduleCameraAutosave = () => {
  window.clearTimeout(app.autosaveTimer);
  app.autosaveTimer = window.setTimeout(async () => {
    try {
      await persistWorkspaceNow();
    } catch {
      // Camera persistence is opportunistic and must not interrupt editing.
    }
  }, 800);
};

const snapshot = () => ({
  project: structuredClone(app.project),
  camera: app.camera.serialize(),
  selection: Array.from(app.selection),
  selectionOrder: Array.from(app.selectionOrder),
  componentSelection: structuredClone(app.componentSelection)
});

const resetTransientToolState = () => {
  app.pending = null;
  app.interaction = null;
  app.hoverPoint = null;
  elements.measurements.value = "";
};

const setViewportCursor = (cursor = TOOL_CURSORS[app.activeTool] ?? "default") => {
  elements.canvas.style.cursor = cursor;
};

const refreshToolPresentation = () => {
  const tool = app.activeTool;
  document.querySelectorAll(".tool-select").forEach((button) => button.classList.toggle("active", button.dataset.tool === tool));
  elements.canvas.dataset.tool = tool;
  setViewportCursor();
  elements.viewportHint.textContent = TOOL_HINTS[tool] ?? "Choose a point in the workspace.";
};

const snapshotDiffers = (before) => JSON.stringify(before.project) !== JSON.stringify(app.project) || JSON.stringify(before.camera) !== JSON.stringify(app.camera.serialize());

const commitSnapshot = (label, before) => {
  if (!snapshotDiffers(before)) {
    return false;
  }
  app.history.push({ ...before, label });
  if (app.history.length > MAX_HISTORY) {
    app.history.shift();
  }
  app.future = [];
  setDirty();
  updatePanels();
  requestRender();
  return true;
};

const mutate = (label, action) => {
  const before = snapshot();
  try {
    const result = action();
    commitSnapshot(label, before);
    return result;
  } catch (error) {
    app.project = before.project;
    app.camera.restore(before.camera);
    app.selection = new Set(before.selection);
    app.selectionOrder = before.selectionOrder;
    app.componentSelection = before.componentSelection;
    app.renderer?.invalidate();
    updatePanels();
    setStatus(error.message || "That edit could not be completed.", "error");
    requestRender();
    return null;
  }
};

const restoreSnapshot = (state) => {
  app.project = structuredClone(state.project);
  app.camera.restore(state.camera);
  app.selection = new Set(state.selection.filter((id) => getEntity(app.project, id)));
  app.selectionOrder = state.selectionOrder.filter((id) => app.selection.has(id));
  app.componentSelection = state.componentSelection ?? null;
  app.renderer.invalidate();
  applyAppearance();
  updatePanels();
  requestRender();
};

const undo = () => {
  const previous = app.history.pop();
  if (!previous) {
    setStatus("Nothing to undo.");
    return;
  }
  const liveCamera = app.camera.serialize();
  app.future.push({ ...snapshot(), label: previous.label });
  restoreSnapshot({ ...previous, camera: liveCamera });
  setDirty();
  setStatus(`Undid ${previous.label}.`);
};

const redo = () => {
  const following = app.future.pop();
  if (!following) {
    setStatus("Nothing to redo.");
    return;
  }
  const liveCamera = app.camera.serialize();
  app.history.push({ ...snapshot(), label: following.label });
  restoreSnapshot({ ...following, camera: liveCamera });
  setDirty();
  setStatus(`Redid ${following.label}.`);
};

const currentSelection = () => app.selectionOrder
  .map((id) => getEntity(app.project, id))
  .filter(Boolean);

const selectedMeshes = () => currentSelection().filter((entity) => entity.kind === "mesh");

const setSelection = (ids, mode = "replace") => {
  const validIds = ids.filter((id) => getEntity(app.project, id));
  if (mode === "toggle") {
    for (const id of validIds) {
      if (app.selection.has(id)) {
        app.selection.delete(id);
        app.selectionOrder = app.selectionOrder.filter((candidate) => candidate !== id);
      } else {
        app.selection.add(id);
        app.selectionOrder.push(id);
      }
    }
  } else if (mode === "add") {
    for (const id of validIds) {
      if (!app.selection.has(id)) {
        app.selection.add(id);
        app.selectionOrder.push(id);
      }
    }
  } else {
    app.selection = new Set(validIds);
    app.selectionOrder = Array.from(validIds);
  }
  app.componentSelection = null;
  updatePanels();
  requestRender();
};

const clearSelection = () => setSelection([]);

const getPointer = (event) => {
  const bounds = elements.canvas.getBoundingClientRect();
  return {
    x: (event.clientX - bounds.left) * app.renderer.pixelRatio,
    y: (event.clientY - bounds.top) * app.renderer.pixelRatio,
    cssX: event.clientX - bounds.left,
    cssY: event.clientY - bounds.top
  };
};

const getRay = (event) => {
  app.renderer.resize();
  const pointer = getPointer(event);
  const matrices = app.camera.getMatrices(app.renderer.width / app.renderer.height);
  return rayFromScreen(pointer.x, pointer.y, app.renderer.width, app.renderer.height, matrices.projection, matrices.view);
};

const snapPoint = (point) => {
  const increment = Math.max(0.001, Number(app.project.settings.snapIncrement) || 1);
  return point.map((value) => Math.round(value / increment) * increment);
};

const snapPointOnSurface = (point, surface) => {
  const snapped = snapPoint(point);
  const offset = subtract3(snapped, surface.point);
  const distance = dot3(offset, surface.normal);
  return subtract3(snapped, scale3(surface.normal, distance));
};

const pointOnPlane = (event, planePoint, planeNormal) => {
  const ray = getRay(event);
  if (!ray) {
    return null;
  }
  const point = intersectRayPlane(ray, planePoint, planeNormal);
  return point ? snapPointOnSurface(point, { point: planePoint, normal: planeNormal }) : null;
};

const snapTolerance = () => Math.max(1, app.camera.distance * 0.018);

const nearestPointOnSegment = (point, start, end) => {
  const segment = subtract3(end, start);
  const lengthSquared = dot3(segment, segment);
  if (lengthSquared < 0.000001) {
    return { point: start, amount: 0 };
  }
  const amount = Math.max(0, Math.min(1, dot3(subtract3(point, start), segment) / lengthSquared));
  return { point: add3(start, scale3(segment, amount)), amount };
};

const surfaceForPoint = (point, fallback = drawingSurface()) => ({ point: Array.from(point), normal: Array.from(fallback.normal) });

const pointOnInfiniteLine = (point, origin, direction) => add3(origin, scale3(direction, dot3(subtract3(point, origin), direction)));

const lockInference = () => {
  if (!app.snap || !drawingTools.has(app.activeTool)) {
    return;
  }
  if (app.snap.line) {
    const direction = normalize3(subtract3(app.snap.line.end, app.snap.line.start));
    if (distance3(direction, [0, 0, 0]) > 0.000001) {
      app.inference = {
        kind: "line",
        point: Array.from(app.snap.point),
        direction,
        surface: app.snap.surface,
        label: "locked on line"
      };
      setStatus("Inference locked to line. Release Control to unlock.");
      return;
    }
  }
  const origin = app.pending?.points?.[0];
  if (app.snap.kind === "face" && app.snap.surface) {
    const { tangent, bitangent } = planeBasis(app.snap.surface.normal);
    app.inference = {
      kind: "line",
      point: Array.from(app.snap.point),
      direction: Math.abs(dot3(app.camera.getDirection(), tangent)) > Math.abs(dot3(app.camera.getDirection(), bitangent)) ? tangent : bitangent,
      surface: app.snap.surface,
      label: "locked face axis"
    };
    setStatus("Inference locked on the face axis. Release Control to unlock.");
    return;
  }
  if (origin && distance3(origin, app.snap.point) > 0.000001) {
    app.inference = {
      kind: "line",
      point: Array.from(origin),
      direction: normalize3(subtract3(app.snap.point, origin)),
      surface: app.pending.surface,
      label: "locked direction"
    };
    setStatus("Inference direction locked. Release Control to unlock.");
  }
};

const unlockInference = () => {
  if (app.inference) {
    app.inference = null;
    setStatus("Inference unlocked.");
  }
};

const closestSnap = (rawPoint, surface, options = {}) => {
  const tolerance = options.tolerance ?? snapTolerance();
  let best = null;
  const consider = (point, kind, label, distance = distance3(rawPoint, point), line = null) => {
    if (Math.abs(dot3(subtract3(point, surface.point), surface.normal)) > tolerance * 0.05) {
      return;
    }
    if (distance <= tolerance && (!best || distance < best.distance)) {
      best = { point, kind, label, distance, line, surface: surfaceForPoint(point, surface) };
    }
  };

  for (const entity of allRenderableEntities(app.project)) {
    if (entity.kind === "mesh") {
      if (entity.indices.length / 3 > MAX_SNAP_MESH_TRIANGLES) {
        continue;
      }
      const vertices = meshWorldVertices(app.project, entity);
      for (let index = 0; index < vertices.length; index += 3) {
        consider([vertices[index], vertices[index + 1], vertices[index + 2]], "vertex", "endpoint");
      }
      for (let index = 0; index < entity.indices.length; index += 3) {
        const triangle = [entity.indices[index], entity.indices[index + 1], entity.indices[index + 2]];
        for (let edge = 0; edge < 3; edge += 1) {
          const firstIndex = triangle[edge] * 3;
          const secondIndex = triangle[(edge + 1) % 3] * 3;
          const start = [vertices[firstIndex], vertices[firstIndex + 1], vertices[firstIndex + 2]];
          const end = [vertices[secondIndex], vertices[secondIndex + 1], vertices[secondIndex + 2]];
          const nearest = nearestPointOnSegment(rawPoint, start, end);
          consider(nearest.point, "edge", "on edge", undefined, { start, end });
          consider(midpoint3(start, end), "midpoint", "midpoint");
        }
      }
    } else if (entity.kind === "edge" || entity.kind === "annotation") {
      const points = lineWorldPoints(app.project, entity);
      for (let index = 0; index < points.length - 3; index += 3) {
        const start = [points[index], points[index + 1], points[index + 2]];
        const end = [points[index + 3], points[index + 4], points[index + 5]];
        consider(start, "endpoint", "endpoint");
        consider(end, "endpoint", "endpoint");
        const nearest = nearestPointOnSegment(rawPoint, start, end);
        consider(nearest.point, "edge", "on edge", undefined, { start, end });
        consider(midpoint3(start, end), "midpoint", "midpoint");
      }
    }
  }
  return best;
};

const resolvedSnapPoint = (event, rawPoint, surface, options = {}) => {
  if (event.ctrlKey && app.inference?.kind === "line") {
    return {
      point: pointOnInfiniteLine(rawPoint, app.inference.point, app.inference.direction),
      kind: "inference",
      label: app.inference.label,
      surface: app.inference.surface
    };
  }
  return closestSnap(rawPoint, surface, options) ?? { point: rawPoint, kind: "grid", label: "grid", surface };
};

const updateSnapIndicator = () => {
  const snap = app.snap;
  if (!snap || !app.renderMatrices) {
    elements.snapIndicator.hidden = true;
    return;
  }
  const viewport = app.renderer.getViewport();
  const projected = projectPoint(snap.point, viewport.width, viewport.height, app.renderMatrices.projection, app.renderMatrices.view);
  if (!projected || projected[2] < -1 || projected[2] > 1) {
    elements.snapIndicator.hidden = true;
    return;
  }
  elements.snapIndicator.hidden = false;
  elements.snapIndicator.classList.toggle("inferred", snap.kind === "inference");
  elements.snapIndicator.style.left = `${projected[0] / app.renderer.pixelRatio}px`;
  elements.snapIndicator.style.top = `${projected[1] / app.renderer.pixelRatio}px`;
  elements.snapIndicator.title = snap.label;
};

const drawingSurface = () => {
  if (app.pending?.surface) {
    return app.pending.surface;
  }
  return { point: [0, 0, 0], normal: [0, 0, 1] };
};

const pointOnDrawingPlane = (event) => {
  const surface = drawingSurface();
  return pointOnPlane(event, surface.point, surface.normal);
};

const rayBoxDistance = (ray, min, max) => {
  let near = -Infinity;
  let far = Infinity;
  for (let axis = 0; axis < 3; axis += 1) {
    const direction = ray.direction[axis];
    const origin = ray.origin[axis];
    if (Math.abs(direction) < 0.0000001) {
      if (origin < min[axis] || origin > max[axis]) {
        return null;
      }
      continue;
    }
    let first = (min[axis] - origin) / direction;
    let second = (max[axis] - origin) / direction;
    if (first > second) {
      [first, second] = [second, first];
    }
    near = Math.max(near, first);
    far = Math.min(far, second);
    if (near > far) {
      return null;
    }
  }
  return far < 0 ? null : Math.max(0, near);
};

const pointSegmentDistance = (point, start, end) => {
  const deltaX = end[0] - start[0];
  const deltaY = end[1] - start[1];
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared === 0) {
    return Math.hypot(point[0] - start[0], point[1] - start[1]);
  }
  const amount = Math.max(0, Math.min(1, ((point[0] - start[0]) * deltaX + (point[1] - start[1]) * deltaY) / lengthSquared));
  return Math.hypot(point[0] - (start[0] + deltaX * amount), point[1] - (start[1] + deltaY * amount));
};

const pickEdge = (event) => {
  if (!app.renderMatrices) {
    return null;
  }
  const pointer = getPointer(event);
  const viewport = app.renderer.getViewport();
  const threshold = 8;
  let closest = null;
  for (const entity of allRenderableEntities(app.project)) {
    if (entity.kind !== "edge" && entity.kind !== "annotation") {
      continue;
    }
    const points = lineWorldPoints(app.project, entity);
    for (let index = 0; index < points.length - 3; index += 3) {
      const start = projectPoint([points[index], points[index + 1], points[index + 2]], viewport.width, viewport.height, app.renderMatrices.projection, app.renderMatrices.view);
      const end = projectPoint([points[index + 3], points[index + 4], points[index + 5]], viewport.width, viewport.height, app.renderMatrices.projection, app.renderMatrices.view);
      if (!start || !end || start[2] < -1 || start[2] > 1 || end[2] < -1 || end[2] > 1) {
        continue;
      }
      const distance = pointSegmentDistance([pointer.x, pointer.y], start, end);
      if (distance <= threshold * app.renderer.pixelRatio && (!closest || distance < closest.distance)) {
        closest = { entity, distance, point: midpoint3([points[index], points[index + 1], points[index + 2]], [points[index + 3], points[index + 4], points[index + 5]]) };
      }
    }
  }
  return closest;
};

const pickEntity = (event) => {
  const ray = getRay(event);
  if (!ray) {
    return null;
  }
  let closest = null;
  for (const entity of allRenderableEntities(app.project)) {
    if (entity.kind !== "mesh" || entity.locked) {
      continue;
    }
    const bounds = entityBounds(app.project, entity);
    if (!bounds) {
      continue;
    }
    const boxDistance = rayBoxDistance(ray, bounds.min, bounds.max);
    if (boxDistance === null || (closest && boxDistance > closest.distance)) {
      continue;
    }
    if (entity.indices.length / 3 > LARGE_PICK_TRIANGLE_COUNT) {
      closest = { entity, distance: boxDistance, point: add3(ray.origin, scale3(ray.direction, boxDistance)), coarse: true };
      continue;
    }
    const vertices = meshWorldVertices(app.project, entity);
    for (let index = 0; index < entity.indices.length; index += 3) {
      const a = entity.indices[index] * 3;
      const b = entity.indices[index + 1] * 3;
      const c = entity.indices[index + 2] * 3;
      const hit = intersectRayTriangle(
        ray,
        [vertices[a], vertices[a + 1], vertices[a + 2]],
        [vertices[b], vertices[b + 1], vertices[b + 2]],
        [vertices[c], vertices[c + 1], vertices[c + 2]]
      );
      if (hit && (!closest || hit.distance <= closest.distance + 0.00001)) {
        closest = { entity, ...hit, triangleIndex: index / 3, coarse: false };
      }
    }
  }
  return pickEdge(event) ?? closest;
};

const pickMeshEdge = (event, meshHit) => {
  if (!meshHit?.entity || meshHit.entity.kind !== "mesh" || meshHit.coarse) {
    return null;
  }
  const pointer = getPointer(event);
  const viewport = app.renderer.getViewport();
  const vertices = meshWorldVertices(app.project, meshHit.entity);
  const threshold = 8 * app.renderer.pixelRatio;
  let closest = null;
  const visibleEdges = edgeIndicesForMesh(meshHit.entity.vertices, meshHit.entity.indices);
  for (let index = 0; index < visibleEdges.length; index += 2) {
    const startIndex = visibleEdges[index] * 3;
    const endIndex = visibleEdges[index + 1] * 3;
    const start3 = [vertices[startIndex], vertices[startIndex + 1], vertices[startIndex + 2]];
    const end3 = [vertices[endIndex], vertices[endIndex + 1], vertices[endIndex + 2]];
    const start = projectPoint(start3, viewport.width, viewport.height, app.renderMatrices.projection, app.renderMatrices.view);
    const end = projectPoint(end3, viewport.width, viewport.height, app.renderMatrices.projection, app.renderMatrices.view);
    if (!start || !end) {
      continue;
    }
    const distance = pointSegmentDistance([pointer.x, pointer.y], start, end);
    if (distance <= threshold && (!closest || distance < closest.distance)) {
      closest = { entity: meshHit.entity, start: start3, end: end3, distance };
    }
  }
  return closest;
};

const setComponentSelection = (selection) => {
  app.componentSelection = selection;
  if (selection?.entityId) {
    app.selection = new Set([selection.entityId]);
    app.selectionOrder = [selection.entityId];
  }
  updatePanels();
  requestRender();
};

const selectMeshComponent = (event, hit) => {
  if (hit.entity.kind !== "mesh" || hit.coarse) {
    setSelection([hit.entity.id], event.shiftKey ? "toggle" : "replace");
    return;
  }
  const edge = pickMeshEdge(event, hit);
  if (edge) {
    setComponentSelection({ type: "edge", entityId: hit.entity.id, start: edge.start, end: edge.end });
    setStatus("Edge selected.");
    return;
  }
  const face = getMeshFaceRegion(app.project, hit.entity, hit.triangleIndex);
  if (face) {
    setComponentSelection({ type: "face", entityId: hit.entity.id, ...face, point: hit.point });
    setStatus("Face selected. Choose Push/Pull, then click to start a live preview.");
  } else {
    setSelection([hit.entity.id], event.shiftKey ? "toggle" : "replace");
  }
};

const previewCircle = (center, edge, sides = 32) => {
  const surface = drawingSurface();
  const { tangent, bitangent } = planeBasis(surface.normal);
  const radius = distance3(edge, center);
  if (radius === 0) {
    return [];
  }
  const points = [];
  for (let index = 0; index <= sides; index += 1) {
    const angle = (index / sides) * Math.PI * 2;
    points.push(...add3(center, add3(scale3(tangent, Math.cos(angle) * radius), scale3(bitangent, Math.sin(angle) * radius))));
  }
  return points;
};

const previewArc = (center, start, end) => {
  const surface = drawingSurface();
  const { tangent, bitangent } = planeBasis(surface.normal);
  const startVector = subtract3(start, center);
  const endVector = subtract3(end, center);
  const startAngle = Math.atan2(dot3(startVector, bitangent), dot3(startVector, tangent));
  let endAngle = Math.atan2(dot3(endVector, bitangent), dot3(endVector, tangent));
  while (endAngle <= startAngle) {
    endAngle += Math.PI * 2;
  }
  const radius = distance3(center, start);
  const points = [];
  for (let index = 0; index <= 24; index += 1) {
    const angle = startAngle + ((endAngle - startAngle) * index) / 24;
    points.push(...add3(center, add3(scale3(tangent, radius * Math.cos(angle)), scale3(bitangent, radius * Math.sin(angle)))));
  }
  return points;
};

const currentPreview = () => {
  if (app.interaction?.kind === "freehand") {
    return { points: app.interaction.points, color: [0.95, 0.83, 0.37, 0.95] };
  }
  if (app.pending?.tool === "rotate") {
    const guide = app.pending;
    const radius = Math.max(20, app.camera.distance * 0.13);
    const { tangent, bitangent } = planeBasis(guide.axis);
    const points = [];
    for (let index = 0; index <= 40; index += 1) {
      const angle = (index / 40) * Math.PI * 2;
      points.push(...add3(guide.pivot, add3(scale3(tangent, Math.cos(angle) * radius), scale3(bitangent, Math.sin(angle) * radius))));
    }
    return { points, color: [0.92, 0.47, 0.08, 0.76], pointsMode: true };
  }
  if (app.interaction?.kind === "rotate-guide") {
    const guide = app.interaction;
    const radius = Math.max(20, app.camera.distance * 0.13);
    const { tangent, bitangent } = planeBasis(guide.axis);
    const points = [];
    for (let index = 0; index <= 40; index += 1) {
      const angle = (index / 40) * Math.PI * 2;
      points.push(...add3(guide.pivot, add3(scale3(tangent, Math.cos(angle) * radius), scale3(bitangent, Math.sin(angle) * radius))));
    }
    const referenceEnd = add3(guide.pivot, scale3(guide.reference, radius));
    const currentDirection = guide.angle === 0
      ? guide.reference
      : add3(scale3(guide.reference, Math.cos(guide.angle)), scale3(cross3(guide.axis, guide.reference), Math.sin(guide.angle)));
    const currentEnd = add3(guide.pivot, scale3(currentDirection, radius));
    return {
      points: [...points, ...guide.pivot, ...referenceEnd, ...guide.pivot, ...currentEnd],
      color: [0.92, 0.47, 0.08, 0.96],
      pointsMode: true
    };
  }
  if (!app.pending || !app.hoverPoint) {
    return null;
  }
  const { tool, points } = app.pending;
  const hover = app.hoverPoint;
  if (tool === "line" || tool === "tape" || tool === "dimension" || tool === "followme") {
    return { points: [...points[0], ...hover] };
  }
  if (tool === "rectangle") {
    const start = points[0];
    const normal = app.pending.surface?.normal ?? [0, 0, 1];
    const { tangent, bitangent } = planeBasis(normal);
    const delta = subtract3(hover, start);
    const widthPoint = add3(start, scale3(tangent, dot3(delta, tangent)));
    const corner = add3(widthPoint, scale3(bitangent, dot3(delta, bitangent)));
    const depthPoint = add3(start, scale3(bitangent, dot3(delta, bitangent)));
    return {
      points: [
        ...start,
        ...widthPoint,
        ...corner,
        ...depthPoint,
        ...start
      ]
    };
  }
  if (tool === "circle" || tool === "polygon") {
    return { points: previewCircle(points[0], hover, tool === "polygon" ? 6 : 32) };
  }
  if (tool === "arc" && points.length === 1) {
    return { points: [...points[0], ...hover] };
  }
  if (tool === "arc" && points.length === 2) {
    return { points: previewArc(points[0], points[1], hover) };
  }
  if (tool === "protractor" && points.length === 1) {
    return { points: [...points[0], ...hover] };
  }
  if (tool === "protractor" && points.length === 2) {
    return { points: [...points[0], ...points[1], ...points[0], ...hover] };
  }
  return null;
};

const snapHoverPoint = (event) => {
  if (app.activeTool === "select") {
    const hit = pickEntity(event);
    if (hit?.point) {
      app.snap = { point: hit.point, kind: "face", label: "select object", surface: drawingSurfaceFromHit(hit) };
    } else {
      app.snap = null;
    }
    return;
  }
  if (app.activeTool === "move") {
    const hit = pickEntity(event);
    if (hit?.point) {
      app.snap = { point: hit.point, kind: "face", label: "move object", surface: drawingSurfaceFromHit(hit) };
    } else {
      app.snap = null;
    }
    return;
  }
  if (drawingTools.has(app.activeTool)) {
    const drawing = drawingPointForEvent(event);
    app.hoverPoint = drawing?.point ?? null;
  }
};

const requestRender = () => {
  if (app.renderScheduled) {
    return;
  }
  app.renderScheduled = true;
  window.requestAnimationFrame(() => {
    app.renderScheduled = false;
    const preview = currentPreview();
    app.renderMatrices = app.renderer.render(app.project, app.camera, app.selection, app.componentSelection, preview);
    renderAnnotations();
    updateSnapIndicator();
  });
};

const renderAnnotations = () => {
  const fragment = document.createDocumentFragment();
  const viewport = app.renderer.getViewport();
  for (const entity of app.project.entities) {
    if (entity.kind !== "annotation" || !isEntityVisible(app.project, entity) || !entity.text) {
      continue;
    }
    const points = annotationWorldPoints(app.project, entity);
    if (points.length < 3) {
      continue;
    }
    const first = [points[0], points[1], points[2]];
    const lastOffset = Math.max(0, points.length - 3);
    const last = [points[lastOffset], points[lastOffset + 1], points[lastOffset + 2]];
    const anchor = entity.annotationType === "text" || entity.annotationType === "axes" ? first : midpoint3(first, last);
    const projected = projectPoint(anchor, viewport.width, viewport.height, app.renderMatrices.projection, app.renderMatrices.view);
    if (!projected || projected[2] < -1 || projected[2] > 1) {
      continue;
    }
    const label = element("div", { className: "annotation-label", text: entity.text });
    label.style.left = `${projected[0] / app.renderer.pixelRatio}px`;
    label.style.top = `${projected[1] / app.renderer.pixelRatio}px`;
    fragment.append(label);
  }
  elements.annotationLayer.replaceChildren(fragment);
};

const selectRibbon = (name) => {
  app.activeRibbon = name;
  document.querySelectorAll(".menu-button").forEach((button) => button.classList.toggle("active", button.dataset.menu === name));
  document.querySelectorAll(".ribbon-group").forEach((group) => group.classList.toggle("hidden", group.dataset.ribbon !== name));
};

const positionFloatingPalette = () => {
  const margin = 10;
  const maximumX = Math.max(margin, window.innerWidth - 326);
  const paletteHeight = elements.floatingPalette.offsetHeight || Math.min(467, window.innerHeight - margin * 2);
  const maximumY = Math.max(margin, window.innerHeight - paletteHeight - margin);
  app.paletteOffset.x = Math.min(Math.max(margin, app.paletteOffset.x), maximumX);
  app.paletteOffset.y = Math.min(Math.max(margin, app.paletteOffset.y), maximumY);
  elements.floatingPalette.style.left = `${app.paletteOffset.x}px`;
  elements.floatingPalette.style.top = `${app.paletteOffset.y}px`;
};

const populateFloatingPalette = () => {
  const fragment = document.createDocumentFragment();
  const seen = new Set();
  for (const source of elements.ribbon.querySelectorAll(".tool-button")) {
    const key = source.dataset.tool ? `tool:${source.dataset.tool}` : `action:${source.dataset.action}`;
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    const button = source.cloneNode(true);
    button.removeAttribute("id");
    button.addEventListener("click", () => {
      if (button.dataset.tool) {
        setTool(button.dataset.tool);
      } else if (button.dataset.action) {
        executeAction(button.dataset.action);
      }
    });
    fragment.append(button);
  }
  elements.floatingPaletteTools.replaceChildren(fragment);
};

const setPaletteDetached = (detached) => {
  app.paletteDetached = detached;
  elements.appShell.classList.toggle("palette-detached", detached);
  elements.ribbon.classList.toggle("detached", detached);
  elements.floatingPalette.hidden = !detached;
  elements.detachRibbon.textContent = detached ? "Attach tools" : "Detach tools";
  elements.detachRibbon.title = detached ? "Attach tools to the ribbon" : "Detach tools into a floating palette";
  if (detached) {
    populateFloatingPalette();
    positionFloatingPalette();
  } else {
    elements.floatingPaletteTools.replaceChildren();
  }
  app.preferences.paletteDetached = detached;
  app.preferences.paletteX = app.paletteOffset.x;
  app.preferences.paletteY = app.paletteOffset.y;
  savePreferences();
  refreshToolPresentation();
};

const togglePaletteDetached = () => setPaletteDetached(!app.paletteDetached);

const bindFloatingPalette = () => {
  let drag = null;
  elements.detachRibbon.addEventListener("click", togglePaletteDetached);
  elements.attachRibbon.addEventListener("click", () => setPaletteDetached(false));
  elements.floatingPaletteTitle.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) {
      return;
    }
    drag = {
      pointerId: event.pointerId,
      offsetX: event.clientX - app.paletteOffset.x,
      offsetY: event.clientY - app.paletteOffset.y
    };
    elements.floatingPaletteTitle.setPointerCapture(event.pointerId);
  });
  elements.floatingPaletteTitle.addEventListener("pointermove", (event) => {
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    app.paletteOffset = { x: event.clientX - drag.offsetX, y: event.clientY - drag.offsetY };
    positionFloatingPalette();
  });
  const finishDrag = (event) => {
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    drag = null;
    app.preferences.paletteX = app.paletteOffset.x;
    app.preferences.paletteY = app.paletteOffset.y;
    savePreferences();
  };
  elements.floatingPaletteTitle.addEventListener("pointerup", finishDrag);
  elements.floatingPaletteTitle.addEventListener("pointercancel", finishDrag);
};

const activateSidePanel = (panelId) => {
  document.querySelectorAll(".side-tab").forEach((button) => button.classList.toggle("active", button.dataset.panel === panelId));
  document.querySelectorAll(".side-panel").forEach((panel) => panel.classList.toggle("active", panel.id === panelId));
};

const setTool = (tool) => {
  cancelPushPullPreview();
  if (app.interaction?.kind === "rotate-guide") {
    restoreSnapshot(app.interaction.before);
  }
  app.activeTool = tool;
  const selectedComponent = app.componentSelection;
  app.inference = null;
  app.snap = null;
  resetTransientToolState();
  app.componentSelection = selectedComponent;
  refreshToolPresentation();
  setStatus(`${tool[0].toUpperCase()}${tool.slice(1)} tool active.`);
  requestRender();
};

const inputValue = (input, fallback = 0) => {
  const number = Number.parseFloat(input.value);
  return Number.isFinite(number) ? number : fallback;
};

const addInfoField = (container, labelText, value, onChange, options = {}) => {
  const row = element("div", { className: "info-row" });
  const label = element("label", { text: labelText });
  const input = element("input", { type: options.type ?? "text", value: String(value), step: options.step });
  if (options.type === "checkbox") {
    input.checked = Boolean(value);
  }
  input.addEventListener("change", () => onChange(options.type === "checkbox" ? input.checked : input.value));
  append(row, label, input);
  container.append(row);
  return input;
};

const addInfoSelect = (container, labelText, current, entries, onChange) => {
  const row = element("div", { className: "info-row" });
  const label = element("label", { text: labelText });
  const select = element("select");
  for (const entry of entries) {
    const option = element("option", { text: entry.name, value: entry.id });
    option.selected = entry.id === current;
    select.append(option);
  }
  select.addEventListener("change", () => onChange(select.value));
  append(row, label, select);
  container.append(row);
};

const updateEntityPanel = () => {
  const entities = currentSelection();
  elements.entityInfo.replaceChildren();
  if (entities.length === 0) {
    elements.entityInfo.className = "panel-body empty-state";
    elements.entityInfo.textContent = "Nothing selected";
    return;
  }
  elements.entityInfo.className = "panel-body";
  if (entities.length > 1) {
    const summary = element("div", { className: "empty-state", text: `${entities.length} entities selected` });
    const deleteButton = element("button", { className: "small-button", text: "Delete selected", type: "button" });
    deleteButton.addEventListener("click", deleteSelection);
    append(elements.entityInfo, summary, deleteButton);
    return;
  }

  const entity = entities[0];
  const information = element("div", { className: "info-list" });
  if (app.componentSelection?.entityId === entity.id) {
    const component = element("div", { className: "info-row" });
    const label = app.componentSelection.type === "face" ? `Face (${app.componentSelection.triangleIndices.length} triangles)` : "Edge";
    append(component, element("label", { text: "Selection" }), element("span", { text: label }));
    information.append(component);
  }
  addInfoField(information, "Name", entity.name, (value) => mutate("Rename entity", () => {
    entity.name = String(value).trim() || entity.name;
  }));
  const kind = element("div", { className: "info-row" });
  append(kind, element("label", { text: "Type" }), element("span", { text: entity.kind }));
  information.append(kind);
  addInfoField(information, "Position X", formatNumber(entity.transform.position[0]), (value) => mutate("Move entity", () => {
    entity.transform.position[0] = inputValue({ value }, entity.transform.position[0]);
  }), { type: "number", step: "0.1" });
  addInfoField(information, "Position Y", formatNumber(entity.transform.position[1]), (value) => mutate("Move entity", () => {
    entity.transform.position[1] = inputValue({ value }, entity.transform.position[1]);
  }), { type: "number", step: "0.1" });
  addInfoField(information, "Position Z", formatNumber(entity.transform.position[2]), (value) => mutate("Move entity", () => {
    entity.transform.position[2] = inputValue({ value }, entity.transform.position[2]);
  }), { type: "number", step: "0.1" });
  addInfoField(information, "Rotate Z", formatNumber((entity.transform.rotation[2] * 180) / Math.PI), (value) => mutate("Rotate entity", () => {
    entity.transform.rotation[2] = (inputValue({ value }) * Math.PI) / 180;
  }), { type: "number", step: "1" });
  addInfoField(information, "Scale", formatNumber(entity.transform.scale[0]), (value) => mutate("Scale entity", () => {
    const scale = Math.max(0.0001, inputValue({ value }, 1));
    entity.transform.scale = [scale, scale, scale];
  }), { type: "number", step: "0.01" });
  addInfoField(information, "Visible", entity.visible, (value) => mutate("Set visibility", () => {
    entity.visible = value;
  }), { type: "checkbox" });
  addInfoField(information, "Locked", entity.locked, (value) => mutate("Set lock", () => {
    entity.locked = value;
  }), { type: "checkbox" });
  addInfoSelect(information, "Tag", entity.tagId, app.project.tags, (value) => mutate("Assign tag", () => {
    entity.tagId = value;
  }));
  if (entity.kind !== "group" && entity.kind !== "section") {
    addInfoSelect(information, "Material", entity.materialId, app.project.materials, (value) => mutate("Assign material", () => {
      entity.materialId = value;
    }));
  }
  const bounds = entityBounds(app.project, entity);
  if (bounds) {
    const size = element("div", { className: "info-row" });
    append(size, element("label", { text: "Bounds" }), element("span", { text: `${formatLength(bounds.size[0])} x ${formatLength(bounds.size[1])} x ${formatLength(bounds.size[2])}` }));
    information.append(size);
  }
  elements.entityInfo.append(information);
};

const updateTagsPanel = () => {
  const fragment = document.createDocumentFragment();
  for (const tag of app.project.tags) {
    const row = element("div", { className: "tag-row" });
    const visibility = element("input", { type: "checkbox", checked: tag.visible });
    visibility.title = `Toggle ${tag.name}`;
    visibility.addEventListener("change", () => mutate("Toggle tag visibility", () => {
      tag.visible = visibility.checked;
    }));
    const swatch = element("span", { className: "tag-swatch" });
    swatch.style.background = tag.color;
    const name = element("span", { className: "row-name", text: tag.name });
    const count = app.project.entities.filter((entity) => entity.tagId === tag.id).length;
    const countNode = element("span", { text: String(count) });
    append(row, visibility, swatch, name, element("span", { className: "row-spacer" }), countNode);
    fragment.append(row);
  }
  elements.tagsList.replaceChildren(fragment);
};

const updateMaterialsPanel = () => {
  const fragment = document.createDocumentFragment();
  for (const material of app.project.materials) {
    const card = element("button", { className: `material-card${material.id === app.activeMaterialId ? " active" : ""}`, type: "button", title: `Use ${material.name} with the Paint tool` });
    const swatch = element("span", { className: "material-swatch" });
    swatch.style.background = material.color;
    append(card, swatch, element("span", { text: material.name }));
    card.addEventListener("click", () => {
      app.activeMaterialId = material.id;
      updateMaterialsPanel();
      setStatus(`${material.name} is the active paint material.`);
    });
    fragment.append(card);
  }
  elements.materialsList.replaceChildren(fragment);
};

const updateScenesPanel = () => {
  const fragment = document.createDocumentFragment();
  if (app.project.scenes.length === 0) {
    fragment.append(element("div", { className: "empty-state", text: "No scenes saved" }));
  }
  for (const scene of app.project.scenes) {
    const row = element("div", { className: "scene-row" });
    const open = element("button", { className: "row-button", text: scene.name, type: "button", title: "Restore scene" });
    open.addEventListener("click", () => {
      app.camera.restore(scene.camera);
      if (scene.settings) {
        app.project.settings = structuredClone(scene.settings);
      }
      requestRender();
      scheduleCameraAutosave();
      setStatus(`Restored scene ${scene.name}.`);
    });
    const remove = element("button", { className: "row-button", text: "x", type: "button", title: "Delete scene" });
    remove.addEventListener("click", () => mutate("Delete scene", () => {
      app.project.scenes = app.project.scenes.filter((candidate) => candidate.id !== scene.id);
    }));
    append(row, open, element("span", { className: "row-spacer" }), remove);
    fragment.append(row);
  }
  elements.scenesList.replaceChildren(fragment);
};

const appendOutlinerRows = (fragment, ids, depth = 0) => {
  for (const id of ids) {
    const entity = getEntity(app.project, id);
    if (!entity) {
      continue;
    }
    const row = element("div", { className: `outliner-row${app.selection.has(id) ? " selected" : ""}` });
    row.style.paddingLeft = `${6 + depth * 14}px`;
    const visible = element("button", { className: "row-button", text: entity.visible ? "o" : "-", type: "button", title: "Toggle visibility" });
    visible.addEventListener("click", (event) => {
      event.stopPropagation();
      mutate("Set visibility", () => {
        entity.visible = !entity.visible;
      });
    });
    const kind = element("span", { className: "outliner-kind", text: entity.kind === "mesh" ? "M" : entity.kind === "group" ? "G" : entity.kind === "edge" ? "E" : "A" });
    const name = element("span", { className: "row-name", text: entity.name });
    append(row, visible, kind, name);
    row.addEventListener("click", (event) => setSelection([entity.id], event.shiftKey ? "toggle" : "replace"));
    fragment.append(row);
    if (entity.kind === "group") {
      appendOutlinerRows(fragment, entity.children, depth + 1);
    }
  }
};

const updateOutlinerPanel = () => {
  const fragment = document.createDocumentFragment();
  appendOutlinerRows(fragment, app.project.roots);
  if (app.project.roots.length === 0) {
    fragment.append(element("div", { className: "empty-state", text: "No entities" }));
  }
  elements.outlinerList.replaceChildren(fragment);
};

const updateSelectionStatus = () => {
  const entities = currentSelection();
  const component = app.componentSelection;
  const suffix = component?.type === "face" ? " face selected" : component?.type === "edge" ? " edge selected" : " selected";
  elements.selectionStatus.textContent = entities.length === 0 ? "No selection" : entities.length === 1 ? `${entities[0].name}${suffix}` : `${entities.length} selected`;
};

const updatePanels = () => {
  updateEntityPanel();
  updateTagsPanel();
  updateMaterialsPanel();
  updateScenesPanel();
  updateOutlinerPanel();
  updateSelectionStatus();
  updateDocumentTitle();
};

const showOnboarding = () => {
  const content = element("div", { className: "onboarding" });
  append(
    content,
    element("p", { className: "onboarding-kicker", text: "WELCOME TO VIBE-UP" }),
    element("h3", { text: "Your first printable shape" }),
    element("p", { text: "The editor is intentionally direct: make a shape, click it, and drag it. The ribbon remains available when you need a specific tool." })
  );
  const steps = element("ol", { className: "onboarding-steps" });
  for (const [title, description] of [
    ["Create", "Open Draw and choose Box, or choose Rectangle and draw two corners."],
    ["Select and move", "Click an object once. It turns yellow. Drag the selected object to move it along the face you clicked."],
    ["Draw on a surface", "Choose Line, Rectangle, Circle, or Freehand, then click directly on any model face. The new drawing locks to that face."],
    ["Build volume", "Select a drawn planar face, choose Push/Pull, then drag or type an exact millimetre height."],
    ["Save or print", "Use File to save a .vibeup archive, import STL, run Print Check, or export STL." ]
  ]) {
    const item = element("li");
    append(item, element("strong", { text: title }), document.createTextNode(` ${description}`));
    steps.append(item);
  }
  content.append(steps);
  const optOut = element("label", { className: "onboarding-optout" });
  const checkbox = element("input", { type: "checkbox", checked: app.preferences.onboardingDismissed });
  append(optOut, checkbox, document.createTextNode("Do not show this guide at startup"));
  content.append(optOut);
  const persistOptOut = () => {
    app.preferences.onboardingDismissed = checkbox.checked;
    savePreferences();
  };
  checkbox.addEventListener("change", persistOptOut);
  elements.modal.addEventListener("close", persistOptOut, { once: true });
  showModal("Getting started", content, [
    {
      label: "Start modeling",
      className: "primary-button",
      onClick: () => {
        persistOptOut();
        return true;
      }
    }
  ]);
};

const openAppearance = () => {
  const appearance = normalizeAppearance(app.project.settings.appearance);
  showInputModal({
    title: "Appearance",
    fields: [
      { name: "canvasColor", label: "Workspace background", type: "color", value: appearance.canvasColor },
      { name: "gridColor", label: "Grid colour", type: "color", value: appearance.gridColor },
      { name: "edgeColor", label: "Model edge colour", type: "color", value: appearance.edgeColor },
      { name: "selectionColor", label: "Selection colour", type: "color", value: appearance.selectionColor },
      { name: "edgeWidth", label: "Model edge thickness (1-4)", type: "number", min: "1", max: "4", step: "0.5", value: String(appearance.edgeWidth) }
    ],
    submitLabel: "Apply appearance",
    onSubmit: (values) => {
      mutate("Update appearance", () => {
        app.project.settings.appearance = normalizeAppearance({
          ...appearance,
          canvasColor: values.canvasColor,
          gridColor: values.gridColor,
          edgeColor: values.edgeColor,
          selectionColor: values.selectionColor,
          edgeWidth: Number.parseFloat(values.edgeWidth)
        });
      });
      applyAppearance();
      setStatus("Updated appearance settings.");
    }
  });
};

const toggleTheme = () => {
  mutate("Toggle theme", () => {
    app.project.settings.appearance.theme = app.project.settings.appearance.theme === "dark" ? "light" : "dark";
  });
  applyAppearance();
  setStatus(`${app.project.settings.appearance.theme === "dark" ? "Dark" : "Light"} theme active.`);
};

const resetAppearance = () => {
  mutate("Reset appearance", () => {
    app.project.settings.appearance = structuredClone(DEFAULT_APPEARANCE);
  });
  applyAppearance();
  setStatus("Reset appearance settings.");
};

const closeModal = () => {
  if (elements.modal.open) {
    elements.modal.close();
  }
};

const showModal = (title, content, actions = []) => {
  elements.modalTitle.textContent = title;
  elements.modalContent.replaceChildren();
  if (typeof content === "string") {
    elements.modalContent.textContent = content;
  } else if (content) {
    elements.modalContent.append(content);
  }
  elements.modalActions.replaceChildren();
  for (const action of actions) {
    const button = element("button", { className: action.className, text: action.label, type: "button" });
    button.addEventListener("click", async () => {
      try {
        const shouldClose = await action.onClick?.();
        if (shouldClose !== false) {
          closeModal();
        }
      } catch (error) {
        setStatus(error.message || "The requested action could not be completed.", "error");
      }
    });
    elements.modalActions.append(button);
  }
  if (!elements.modal.open) {
    elements.modal.showModal();
  }
};

const showInputModal = ({ title, fields, submitLabel, onSubmit }) => {
  const content = element("div");
  const inputs = new Map();
  for (const field of fields) {
    const label = element("label", { text: field.label });
    const input = element("input", {
      type: field.type ?? "text",
      value: field.value ?? "",
      placeholder: field.placeholder,
      min: field.min,
      max: field.max,
      step: field.step
    });
    if (field.type === "color") {
      input.value = field.value ?? "#50cdb8";
    }
    append(label, input);
    content.append(label);
    inputs.set(field.name, input);
  }
  showModal(title, content, [
    { label: "Cancel", onClick: () => true },
    {
      label: submitLabel,
      className: "primary-button",
      onClick: () => onSubmit(Object.fromEntries(Array.from(inputs.entries(), ([name, input]) => [name, input.value])))
    }
  ]);
  const first = inputs.values().next().value;
  window.setTimeout(() => first?.focus(), 0);
};

const addBoxDialog = () => {
  showInputModal({
    title: "Add Box",
    fields: [
      { name: "width", label: "Width (mm)", value: "100", type: "number", min: "0.001", step: "0.1" },
      { name: "depth", label: "Depth (mm)", value: "100", type: "number", min: "0.001", step: "0.1" },
      { name: "height", label: "Height (mm)", value: "100", type: "number", min: "0.001", step: "0.1" },
      { name: "name", label: "Name", value: "Box" }
    ],
    submitLabel: "Add Box",
    onSubmit: (values) => {
      const width = Number.parseFloat(values.width);
      const depth = Number.parseFloat(values.depth);
      const height = Number.parseFloat(values.height);
      if (![width, depth, height].every((value) => Number.isFinite(value) && value > 0)) {
        throw new Error("Box dimensions must be positive millimetre values.");
      }
      const box = mutate("Add box", () => addEntity(app.project, createBoxEntity(width, depth, height, values.name.trim() || "Box")));
      if (box) {
        setSelection([box.id]);
        setStatus(`Added ${box.name}: ${formatLength(width)} x ${formatLength(depth)} x ${formatLength(height)}.`);
      }
    }
  });
};

const addCylinderDialog = () => {
  showInputModal({
    title: "Add Cylinder",
    fields: [
      { name: "radius", label: "Radius (mm)", value: "50", type: "number", min: "0.001", step: "0.1" },
      { name: "height", label: "Height (mm)", value: "100", type: "number", min: "0.001", step: "0.1" },
      { name: "segments", label: "Segments", value: "32", type: "number", min: "3", max: "256", step: "1" },
      { name: "name", label: "Name", value: "Cylinder" }
    ],
    submitLabel: "Add Cylinder",
    onSubmit: (values) => {
      const radius = Number.parseFloat(values.radius);
      const height = Number.parseFloat(values.height);
      const segments = Math.round(Number.parseFloat(values.segments));
      if (!Number.isFinite(radius) || radius <= 0 || !Number.isFinite(height) || height <= 0 || !Number.isFinite(segments) || segments < 3 || segments > 256) {
        throw new Error("Cylinder dimensions and segment count are invalid.");
      }
      const cylinder = mutate("Add cylinder", () => addEntity(app.project, createCylinderEntity(radius, height, segments, values.name.trim() || "Cylinder")));
      if (cylinder) {
        setSelection([cylinder.id]);
      }
    }
  });
};

const setCircleSegmentsDialog = () => {
  showInputModal({
    title: "Circle Segments",
    fields: [{ name: "segments", label: "Segments (3-96)", value: String(app.project.settings.circleSegments), type: "number", min: "3", max: "96", step: "1" }],
    submitLabel: "Set Segments",
    onSubmit: (values) => {
      const segments = Math.round(Number.parseFloat(values.segments));
      if (!Number.isFinite(segments) || segments < 3 || segments > 96) {
        throw new Error("Circle segments must be a whole number from 3 to 96.");
      }
      mutate("Set circle segments", () => {
        app.project.settings.circleSegments = segments;
      });
      setStatus(`Circle segments set to ${segments}.`);
    }
  });
};

const addTagDialog = () => {
  showInputModal({
    title: "Add Tag",
    fields: [
      { name: "name", label: "Tag name", value: "New Tag" },
      { name: "color", label: "Colour", type: "color", value: "#50cdb8" }
    ],
    submitLabel: "Add Tag",
    onSubmit: (values) => {
      const name = values.name.trim();
      if (!name) {
        throw new Error("A tag needs a name.");
      }
      mutate("Add tag", () => {
        app.project.tags.push({ id: newId(), name, color: values.color, visible: true });
      });
    }
  });
};

const addMaterialDialog = () => {
  showInputModal({
    title: "Add Material",
    fields: [
      { name: "name", label: "Material name", value: "New Material" },
      { name: "color", label: "Colour", type: "color", value: "#50cdb8" }
    ],
    submitLabel: "Add Material",
    onSubmit: (values) => {
      const name = values.name.trim();
      if (!name) {
        throw new Error("A material needs a name.");
      }
      mutate("Add material", () => {
        const material = { id: newId(), name, color: values.color, metallic: 0, roughness: 0.6 };
        app.project.materials.push(material);
        app.activeMaterialId = material.id;
      });
    }
  });
};

const addSceneDialog = () => {
  showInputModal({
    title: "Add Scene",
    fields: [{ name: "name", label: "Scene name", value: `Scene ${app.project.scenes.length + 1}` }],
    submitLabel: "Save Scene",
    onSubmit: (values) => {
      const name = values.name.trim();
      if (!name) {
        throw new Error("A scene needs a name.");
      }
      mutate("Add scene", () => {
        app.project.scenes.push({
          id: newId(),
          name,
          camera: app.camera.serialize(),
          settings: structuredClone(app.project.settings)
        });
      });
    }
  });
};

const showHelp = () => {
  const content = element("div");
  append(
    content,
    element("p", { text: "vibe-up works fully locally. Choose tools from the ribbon, then use the Measurements field for exact millimetre values." }),
    element("p", { text: "Core shortcuts" })
  );
  const list = element("ul");
  for (const text of [
    "Space Select, L Line, R Rectangle, C Circle, P Push/Pull, M Move, Q Rotate, S Scale, F Offset",
    "T Tape Measure, D Dimension, B Paint, E Eraser, O Orbit, H Pan, Z Zoom",
    "Ctrl+Z Undo, Ctrl+Shift+Z Redo, Ctrl+S Save, Ctrl+O Open, Delete Erase selection",
    "Middle mouse pans; Alt-drag or right mouse orbits; mouse wheel zooms; Shift+Z fits the model"
  ]) {
    list.append(element("li", { text }));
  }
  content.append(list);
  showModal("vibe-up help", content, [{ label: "Close", onClick: () => true }]);
};

const validateNumericArray = (value, lengthMultiple, label) => {
  if (!Array.isArray(value) || value.length % lengthMultiple !== 0 || !value.every(Number.isFinite)) {
    throw new Error(`${label} contains invalid numeric data.`);
  }
  return Array.from(value);
};

const validateVector3 = (value, label) => {
  const vector = validateNumericArray(value, 3, label);
  if (vector.length !== 3) {
    throw new Error(`${label} must contain exactly three numbers.`);
  }
  return vector;
};

const normalizeCamera = (raw, label = "Camera") => {
  if (!raw || typeof raw !== "object") {
    throw new Error(`${label} is missing.`);
  }
  const target = validateVector3(raw.target, `${label} target`);
  if (![raw.yaw, raw.pitch, raw.distance].every(Number.isFinite) || raw.distance <= 0) {
    throw new Error(`${label} has invalid view values.`);
  }
  return {
    target,
    yaw: raw.yaw,
    pitch: raw.pitch,
    distance: raw.distance,
    projectionType: raw.projectionType === "parallel" ? "parallel" : "perspective"
  };
};

const normalizeSettings = (raw) => {
  const settings = raw && typeof raw === "object" ? raw : {};
  const normalized = {
    gridVisible: settings.gridVisible !== false,
    edgesVisible: settings.edgesVisible !== false,
    shadowsVisible: settings.shadowsVisible === true,
    projection: settings.projection === "parallel" ? "parallel" : "perspective",
    snapIncrement: Number.isFinite(settings.snapIncrement) && settings.snapIncrement > 0 ? settings.snapIncrement : 1,
    circleSegments: Number.isInteger(settings.circleSegments) ? Math.max(3, Math.min(96, settings.circleSegments)) : 24,
    section: null,
    appearance: normalizeAppearance(settings.appearance)
  };
  if (settings.section?.enabled) {
    const normal = validateVector3(settings.section.normal, "Section normal");
    if (Math.hypot(...normal) < 0.000001) {
      throw new Error("Section normal must have length.");
    }
    normalized.section = {
      enabled: true,
      point: validateVector3(settings.section.point, "Section point"),
      normal
    };
  }
  return normalized;
};

const validateTransform = (transform) => {
  const fallback = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
  if (!transform || typeof transform !== "object") {
    return fallback;
  }
  for (const key of ["position", "rotation", "scale"]) {
    if (!Array.isArray(transform[key]) || transform[key].length !== 3 || !transform[key].every(Number.isFinite)) {
      throw new Error("An entity transform is invalid.");
    }
  }
  return {
    position: Array.from(transform.position),
    rotation: Array.from(transform.rotation),
    scale: Array.from(transform.scale)
  };
};

const normalizeProject = (source) => {
  if (!source || typeof source !== "object" || source.formatVersion !== 1) {
    throw new Error("This is not a compatible Vibe Up version 1 project.");
  }
  if (!Array.isArray(source.entities) || !Array.isArray(source.roots) || !Array.isArray(source.materials) || !Array.isArray(source.tags) || !Array.isArray(source.scenes)) {
    throw new Error("The project document is incomplete.");
  }
  if (source.entities.length > 10000 || source.roots.length > 10000 || source.materials.length > 1000 || source.tags.length > 1000) {
    throw new Error("The project exceeds Vibe Up safety limits.");
  }
  const project = createEmptyProject();
  project.name = typeof source.name === "string" && source.name.trim() ? source.name.trim().slice(0, 160) : "Untitled model";
  project.units = "mm";
  project.materials = source.materials.map((material) => {
    if (!material || typeof material.id !== "string" || typeof material.name !== "string" || !/^#[0-9a-f]{6}$/i.test(material.color ?? "")) {
      throw new Error("A material is invalid.");
    }
    return {
      id: material.id,
      name: material.name.slice(0, 160),
      color: material.color,
      metallic: Number.isFinite(material.metallic) ? material.metallic : 0,
      roughness: Number.isFinite(material.roughness) ? material.roughness : 0.6
    };
  });
  if (project.materials.length === 0) {
    project.materials = structuredClone(DEFAULT_MATERIALS);
  }
  project.tags = source.tags.map((tag) => {
    if (!tag || typeof tag.id !== "string" || typeof tag.name !== "string" || !/^#[0-9a-f]{6}$/i.test(tag.color ?? "")) {
      throw new Error("A tag is invalid.");
    }
    return { id: tag.id, name: tag.name.slice(0, 160), color: tag.color, visible: tag.visible !== false };
  });
  if (project.tags.length === 0) {
    project.tags = [{ id: "tag-untagged", name: "Untagged", color: "#a8bac0", visible: true }];
  }
  const materialIds = new Set(project.materials.map((material) => material.id));
  const tagIds = new Set(project.tags.map((tag) => tag.id));
  const entityIds = new Set();
  const entitiesById = new Map();
  project.entities = source.entities.map((raw) => {
    if (!raw || typeof raw.id !== "string" || entityIds.has(raw.id) || typeof raw.kind !== "string") {
      throw new Error("An entity identifier is invalid or duplicated.");
    }
    entityIds.add(raw.id);
    if (!["mesh", "edge", "annotation", "group", "section"].includes(raw.kind)) {
      throw new Error("The project contains an unsupported entity type.");
    }
    const entity = {
      id: raw.id,
      kind: raw.kind,
      name: typeof raw.name === "string" ? raw.name.slice(0, 160) : raw.kind,
      visible: raw.visible !== false,
      locked: raw.locked === true,
      tagId: tagIds.has(raw.tagId) ? raw.tagId : project.tags[0].id,
      materialId: materialIds.has(raw.materialId) ? raw.materialId : project.materials[0].id,
      transform: validateTransform(raw.transform),
      parentId: typeof raw.parentId === "string" ? raw.parentId : null,
      metadata: raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata) ? structuredClone(raw.metadata) : {}
    };
    if (raw.kind === "mesh") {
      entity.vertices = validateNumericArray(raw.vertices, 3, "Mesh vertices");
      entity.indices = validateNumericArray(raw.indices, 3, "Mesh indices");
      if (!entity.indices.every((index) => Number.isInteger(index) && index >= 0 && index < entity.vertices.length / 3)) {
        throw new Error("Mesh indices are out of range.");
      }
      if (entity.vertices.length > 900000 || entity.indices.length > 300000) {
        throw new Error("A mesh exceeds the 100,000-triangle project safety limit.");
      }
      if (entity.metadata.profilePoints !== undefined) {
        entity.metadata.profilePoints = validateNumericArray(entity.metadata.profilePoints, 3, "Profile points");
      }
      if (entity.metadata.hiddenEdges !== undefined) {
        if (!Array.isArray(entity.metadata.hiddenEdges) || entity.metadata.hiddenEdges.length > 300000 || !entity.metadata.hiddenEdges.every((edge) => typeof edge === "string" && edge.length <= 256)) {
          throw new Error("Mesh hidden-edge data is invalid.");
        }
        entity.metadata.hiddenEdges = Array.from(entity.metadata.hiddenEdges);
      }
      if (entity.metadata.sweepVector !== undefined) {
        entity.metadata.sweepVector = validateVector3(entity.metadata.sweepVector, "Sweep vector");
      }
    }
    if (raw.kind === "edge" || raw.kind === "annotation") {
      entity.points = validateNumericArray(raw.points, 3, "Line points");
      entity.closed = raw.closed === true;
    }
    if (raw.kind === "annotation") {
      entity.annotationType = typeof raw.annotationType === "string" ? raw.annotationType.slice(0, 40) : "annotation";
      entity.text = typeof raw.text === "string" ? raw.text.slice(0, 500) : "";
    }
    if (raw.kind === "group") {
      if (!Array.isArray(raw.children) || !raw.children.every((id) => typeof id === "string")) {
        throw new Error("A group has invalid children.");
      }
      entity.children = Array.from(raw.children);
      entity.materialId = null;
    }
    if (raw.kind === "section") {
      entity.point = validateNumericArray(raw.point, 3, "Section point");
      entity.normal = validateNumericArray(raw.normal, 3, "Section normal");
      entity.materialId = null;
    }
    entitiesById.set(entity.id, entity);
    return entity;
  });
  for (const entity of project.entities) {
    if (entity.parentId && !entityIds.has(entity.parentId)) {
      throw new Error("An entity references a missing group.");
    }
    if (entity.parentId && entitiesById.get(entity.parentId)?.kind !== "group") {
      throw new Error("An entity parent must be a group.");
    }
    if (entity.kind === "group" && !entity.children.every((id) => entityIds.has(id))) {
      throw new Error("A group references a missing child.");
    }
    if (entity.kind === "group" && entity.children.includes(entity.id)) {
      throw new Error("A group cannot contain itself.");
    }
  }
  for (const group of project.entities.filter((entity) => entity.kind === "group")) {
    if (new Set(group.children).size !== group.children.length) {
      throw new Error("A group contains duplicate children.");
    }
    for (const childId of group.children) {
      if (entitiesById.get(childId)?.parentId !== group.id) {
        throw new Error("A group child does not reference its listed parent.");
      }
    }
  }
  project.roots = source.roots.filter((id) => typeof id === "string" && entityIds.has(id));
  if (new Set(project.roots).size !== project.roots.length) {
    throw new Error("The project has duplicate root entities.");
  }
  for (const entity of project.entities) {
    const expectedParent = entity.parentId;
    const parent = expectedParent ? entitiesById.get(expectedParent) : null;
    if (parent && !parent.children.includes(entity.id)) {
      throw new Error("A group hierarchy is inconsistent.");
    }
    if (!parent && !project.roots.includes(entity.id)) {
      throw new Error("A root entity is missing from the project hierarchy.");
    }
  }
  for (const rootId of project.roots) {
    if (entitiesById.get(rootId)?.parentId) {
      throw new Error("A root entity cannot also belong to a group.");
    }
  }
  for (const entity of project.entities) {
    const visited = new Set([entity.id]);
    let parentId = entity.parentId;
    let depth = 0;
    while (parentId) {
      if (depth >= 100) {
        throw new Error("The project group hierarchy is deeper than 100 levels.");
      }
      if (visited.has(parentId)) {
        throw new Error("The project contains a cyclic group hierarchy.");
      }
      visited.add(parentId);
      parentId = entitiesById.get(parentId)?.parentId ?? null;
      depth += 1;
    }
  }
  project.settings = normalizeSettings(source.settings);
  project.scenes = source.scenes.slice(0, 1000).map((scene) => {
    if (!scene || typeof scene.id !== "string" || typeof scene.name !== "string" || !scene.camera) {
      throw new Error("A saved scene is invalid.");
    }
    return {
      id: scene.id,
      name: scene.name.slice(0, 160),
      camera: normalizeCamera(scene.camera, "Scene camera"),
      settings: normalizeSettings(scene.settings)
    };
  });
  return project;
};

const downloadBlob = (blob, name) => {
  const anchor = document.createElement("a");
  const url = URL.createObjectURL(blob);
  anchor.href = url;
  anchor.download = name;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const projectArchiveBlob = () => {
  const documentData = {
    application: "vibe-up",
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    project: app.project,
    camera: app.camera.serialize()
  };
  const archive = createZip([{ name: "document.json", data: encodeJson(documentData) }]);
  return new Blob([archive], { type: "application/zip" });
};

const saveProject = async () => {
  const blob = projectArchiveBlob();
  const suggestedName = `${sanitizeFileName(app.project.name)}.vibeup`;
  if (app.fileHandle) {
    try {
      const writable = await app.fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      setDirty(false);
      clearRecovery().catch(() => {});
      scheduleAutosave();
      setStatus(`Saved ${suggestedName}.`);
      return;
    } catch (error) {
      if (error.name !== "NotAllowedError") {
        setStatus(`Could not write the selected file: ${error.message}`, "warning");
      }
      app.fileHandle = null;
    }
  }
  if ("showSaveFilePicker" in window) {
    try {
      app.fileHandle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: "Vibe Up project", accept: { "application/zip": [".vibeup"] } }]
      });
      const writable = await app.fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      setDirty(false);
      clearRecovery().catch(() => {});
      scheduleAutosave();
      setStatus(`Saved ${suggestedName}.`);
      return;
    } catch (error) {
      if (error.name === "AbortError") {
        return;
      }
      app.fileHandle = null;
      setStatus(`Could not save through the browser file picker: ${error.message}`, "warning");
    }
  }
  downloadBlob(blob, suggestedName);
  setDirty(false);
  clearRecovery().catch(() => {});
  scheduleAutosave();
  setStatus(`Downloaded ${suggestedName}.`);
};

const loadProjectFile = async (file, fileHandle = null) => {
  const buffer = await file.arrayBuffer();
  const entries = await readZip(buffer);
  const documentBytes = entries.get("document.json");
  if (!documentBytes) {
    throw new Error("This .vibeup archive has no document.json file.");
  }
  const documentData = decodeJson(documentBytes);
  if (!documentData || documentData.application !== "vibe-up" || documentData.formatVersion !== 1) {
    throw new Error("This archive is not a compatible Vibe Up project.");
  }
  const project = normalizeProject(documentData.project);
  const camera = normalizeCamera(documentData.camera);
  window.clearTimeout(app.autosaveTimer);
  resetTransientToolState();
  app.project = project;
  app.camera.restore(camera);
  app.camera.projectionType = project.settings.projection;
  app.selection = new Set();
  app.selectionOrder = [];
  app.history = [];
  app.future = [];
  app.fileHandle = fileHandle;
  app.activeMaterialId = project.materials[0]?.id ?? "material-default";
  app.renderer.invalidate();
  setDirty(false);
  clearRecovery().catch(() => {});
  updatePanels();
  requestRender();
  scheduleAutosave();
  setStatus(`Opened ${file.name}.`);
};

const confirmDiscardForOpen = async (open) => {
  if (!app.dirty) {
    return open();
  }
  const content = element("div");
  content.append(element("p", { text: "Open another project? Current unsaved changes remain in local recovery storage, but will no longer be in the editor." }));
  return new Promise((resolve) => {
    showModal("Open Project", content, [
      { label: "Cancel", onClick: () => {
        resolve(false);
        return true;
      } },
      { label: "Open Project", className: "danger-button", onClick: async () => {
        await open();
        resolve(true);
        return true;
      } }
    ]);
  });
};

const openProjectInput = () => {
  app.openAlreadyConfirmed = true;
  elements.projectInput.click();
};

const openProject = async () => {
  if (app.dirty) {
    return confirmDiscardForOpen(openProject);
  }
  if ("showOpenFilePicker" in window) {
    try {
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        types: [{ description: "Vibe Up project", accept: { "application/zip": [".vibeup"] } }]
      });
      if (!handle) {
        return;
      }
      await loadProjectFile(await handle.getFile(), handle);
      return;
    } catch (error) {
      if (error.name === "AbortError") {
        return;
      }
      setStatus(`Could not open through the browser file picker: ${error.message}`, "warning");
    }
  }
  openProjectInput();
  return undefined;
};

const importStl = () => elements.stlInput.click();

const loadStlFile = async (file) => {
  const entity = parseStl(await file.arrayBuffer(), file.name);
  const added = mutate("Import STL", () => addEntity(app.project, entity));
  if (!added) {
    return;
  }
  setSelection([added.id]);
  app.camera.fit(projectBounds(app.project));
  scheduleCameraAutosave();
  setStatus(`Imported ${file.name}: ${formatNumber(entity.indices.length / 3, 0)} triangles.`);
};

const exportStlNow = () => {
  const candidates = selectedMeshes();
  const entities = candidates.length > 0 ? candidates : app.project.entities.filter((entity) => entity.kind === "mesh" && isEntityVisible(app.project, entity));
  const blob = createBinaryStl(app.project, entities);
  downloadBlob(blob, `${sanitizeFileName(app.project.name)}.stl`);
  setStatus(`Exported ${formatNumber(stlTriangleCount(app.project, entities), 0)} STL triangles in millimetres.`);
};

const printCheckWarning = (report) => `${report.degenerateCount} degenerate triangles, ${report.boundaryEdgeCount} boundary edges, ${report.nonManifoldEdgeCount} non-manifold or inconsistent edges.`;

const exportStl = () => {
  const candidates = selectedMeshes();
  const entities = candidates.length > 0 ? candidates : app.project.entities.filter((entity) => entity.kind === "mesh" && isEntityVisible(app.project, entity));
  if (entities.length === 0) {
    setStatus("There are no mesh faces to export.", "warning");
    return;
  }
  const reports = entities.map((entity) => ({ entity, report: meshReport(app.project, [entity]) }));
  const warningReports = reports.filter(({ report }) => report.degenerateCount > 0 || report.boundaryEdgeCount > 0 || report.nonManifoldEdgeCount > 0);
  if (warningReports.length === 0) {
    exportStlNow();
    return;
  }
  const content = element("div");
  const details = element("div", { className: "report-list" });
  for (const { entity, report } of warningReports) {
    details.append(element("div", { className: "report-warning", text: `${entity.name}: ${printCheckWarning(report)}` }));
  }
  append(
    content,
    element("p", { text: "The binary STL can be written, but the print check found geometry that may need repair in a mesh-repair tool." }),
    details
  );
  showModal("Export STL with warnings?", content, [
    { label: "Cancel", onClick: () => true },
    { label: "Export anyway", className: "primary-button", onClick: () => exportStlNow() }
  ]);
};

const deleteSelection = () => {
  const component = app.componentSelection;
  if (component) {
    const entity = getEntity(app.project, component.entityId);
    if (!entity || entity.locked) {
      setStatus("Select an unlocked face or edge to delete.", "warning");
      return;
    }
    if (component.type === "face") {
      const result = mutate("Delete face", () => {
        const deletion = removeMeshFaces(entity, component.triangleIndices);
        if (deletion.remaining === 0) {
          removeEntity(app.project, entity.id);
        } else {
          app.renderer.invalidate(entity.id);
        }
        return deletion;
      });
      if (result) {
        clearSelection();
        setStatus(`Deleted ${result.removed === 1 ? "face triangle" : "face"}.`);
      }
      return;
    }
    if (component.type === "edge") {
      const changed = mutate("Delete edge", () => {
        const deleted = hideMeshEdge(app.project, entity, component.start, component.end);
        app.renderer.invalidate(entity.id);
        return deleted;
      });
      if (changed) {
        clearSelection();
        setStatus("Deleted edge.");
      }
      return;
    }
  }
  const entities = currentSelection().filter((entity) => !entity.locked);
  if (entities.length === 0) {
    setStatus("Select unlocked entities to delete.", "warning");
    return;
  }
  mutate("Delete selection", () => {
    for (const entity of entities) {
      if (getEntity(app.project, entity.id)) {
        removeEntity(app.project, entity.id);
      }
    }
    clearSelection();
    app.renderer.invalidate();
  });
  setStatus(`Deleted ${entities.length} ${entities.length === 1 ? "entity" : "entities"}.`);
};

const duplicateSelection = () => {
  const entities = currentSelection();
  if (entities.length === 0) {
    setStatus("Select entities to duplicate.", "warning");
    return;
  }
  const copies = mutate("Duplicate selection", () => {
    const output = [];
    for (const entity of entities) {
      const copy = cloneEntityTree(app.project, entity, entity.parentId, [10, 10, 0]);
      output.push(copy);
    }
    return output;
  });
  if (copies) {
    setSelection(copies.map((entity) => entity.id));
  }
};

const groupSelection = () => {
  const entities = currentSelection();
  if (entities.length === 0) {
    setStatus("Select one or more unlocked entities to make a group.", "warning");
    return;
  }
  const group = mutate("Make group", () => makeGroup(app.project, entities.map((entity) => entity.id)));
  if (group) {
    setSelection([group.id]);
    setStatus("Created group.");
  }
};

const explodeSelectedGroup = () => {
  const group = currentSelection().find((entity) => entity.kind === "group");
  if (!group) {
    setStatus("Select a group to explode.", "warning");
    return;
  }
  const children = mutate("Explode group", () => explodeGroup(app.project, group));
  if (children) {
    setSelection(children.map((entity) => entity.id));
    app.renderer.invalidate();
    setStatus("Exploded group.");
  }
};

const makeSubtract = () => {
  const meshes = selectedMeshes();
  if (meshes.length !== 2) {
    setStatus("Select exactly two meshes: target first, then cutter second.", "warning");
    return;
  }
  try {
    validateSubtractInputs(app.project, meshes[0], meshes[1]);
  } catch (error) {
    setStatus(error.message, "warning");
    return;
  }
  let result = null;
  const changed = mutate("Subtract solids", () => {
    result = subtractMeshes(app.project, meshes[0], meshes[1]);
    removeEntity(app.project, meshes[0].id);
    removeEntity(app.project, meshes[1].id);
    addEntity(app.project, result);
    app.renderer.invalidate();
  });
  if (changed !== null && result) {
    setSelection([result.id]);
    setStatus("Subtracted the second selected solid from the first.");
  }
};

const reverseSelectedFaces = () => {
  const meshes = selectedMeshes();
  if (meshes.length === 0) {
    setStatus("Select one or more meshes to reverse faces.", "warning");
    return;
  }
  mutate("Reverse faces", () => {
    for (const mesh of meshes) {
      reverseMeshFaces(mesh);
      app.renderer.invalidate(mesh.id);
    }
  });
  setStatus(`Reversed ${meshes.length} mesh face sets.`);
};

const showPrintCheck = () => {
  const selected = selectedMeshes();
  const meshes = selected.length > 0 ? selected : app.project.entities.filter((entity) => entity.kind === "mesh" && isEntityVisible(app.project, entity));
  const content = element("div");
  const list = element("div", { className: "report-list" });
  if (meshes.length === 0) {
    list.append(element("div", { className: "report-warning", text: "No meshes are available to check." }));
  } else {
    for (const mesh of meshes) {
      const report = meshReport(app.project, [mesh]);
      const clean = report.degenerateCount === 0 && report.boundaryEdgeCount === 0 && report.nonManifoldEdgeCount === 0;
      list.append(element("div", { className: clean ? "report-ok" : "report-warning", text: `${mesh.name}: ${clean ? "No basic topology faults found." : printCheckWarning(report)}` }));
      list.append(element("div", { text: `Triangles: ${formatNumber(report.triangleCount, 0)} | Bounds: ${formatLength(report.max[0] - report.min[0])} x ${formatLength(report.max[1] - report.min[1])} x ${formatLength(report.max[2] - report.min[2])}` }));
    }
  }
  append(content, element("p", { text: "Checks are local and inspect triangle area plus welded edge usage. Passing this report does not replace slicer or printer-specific checks." }), list);
  showModal("Print Check", content, [{ label: "Close", onClick: () => true }]);
};

const fitModel = () => {
  app.camera.fit(projectBounds(app.project));
  requestRender();
  scheduleCameraAutosave();
  setStatus("Zoomed to model extents.");
};

const toggleProjectSetting = (key) => {
  mutate(`Toggle ${key}`, () => {
    app.project.settings[key] = !app.project.settings[key];
  });
};

const toggleProjection = () => {
  mutate("Toggle projection", () => {
    app.project.settings.projection = app.project.settings.projection === "perspective" ? "parallel" : "perspective";
    app.camera.projectionType = app.project.settings.projection;
  });
  setStatus(`${app.project.settings.projection === "parallel" ? "Parallel" : "Perspective"} projection active.`);
};

const clearSection = () => {
  if (!app.project.settings.section?.enabled) {
    setStatus("No section cut is active.");
    return;
  }
  mutate("Clear section", () => {
    app.project.settings.section = null;
  });
  setStatus("Cleared the viewport section cut.");
};

const setView = (view) => {
  app.camera.setView(view);
  requestRender();
  scheduleCameraAutosave();
  setStatus(`${view[0].toUpperCase()}${view.slice(1)} view.`);
};

const resetView = () => setView("iso");

const parseMeasurements = (source) => {
  const tokens = source
    .trim()
    .replace(/x/gi, ",")
    .split(/[;,]/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    throw new Error("Enter a measurement such as 120 mm or 120, 80 mm.");
  }
  return tokens.map((token) => {
    const match = /^([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)\s*(mm|cm|m|in|inch|inches|\")?$/i.exec(token);
    if (!match) {
      throw new Error(`Could not read “${token}”. Use millimetres, cm, m, or inches.`);
    }
    const number = Number.parseFloat(match[1]);
    if (!Number.isFinite(number)) {
      throw new Error("Measurement values must be finite numbers.");
    }
    const unit = (match[2] ?? "mm").toLowerCase();
    if (unit === "cm") {
      return number * 10;
    }
    if (unit === "m") {
      return number * 1000;
    }
    if (unit === "in" || unit === "inch" || unit === "inches" || unit === "\"") {
      return number * 25.4;
    }
    return number;
  });
};

const createLine = (start, end) => {
  if (distance3(start, end) < 0.0001) {
    throw new Error("A line needs non-zero length.");
  }
  return mutate("Draw line", () => addEntity(app.project, createEdgeEntity({ name: "Line", points: [...start, ...end] })));
};

const currentCircleSegments = () => Math.max(3, Math.min(96, Math.round(app.project.settings.circleSegments)));

const createRectangle = (start, end, surface = drawingSurface()) => {
  const normal = surface.normal;
  const { tangent, bitangent } = planeBasis(normal);
  const delta = subtract3(end, start);
  if (Math.abs(dot3(delta, tangent)) < 0.0001 || Math.abs(dot3(delta, bitangent)) < 0.0001) {
    throw new Error("A rectangle needs non-zero width and depth.");
  }
  return mutate("Draw rectangle", () => addEntity(app.project, createRectangleEntity(start, end, surface.normal)));
};

const createCircle = (center, edge, segments = currentCircleSegments(), name = "Circle", surface = drawingSurface()) => {
  const radius = distance3(edge, center);
  if (radius < 0.0001) {
    throw new Error("A circle needs a non-zero radius.");
  }
  return mutate("Draw circle", () => addEntity(app.project, createCircleEntity(center, radius, segments, name, surface.normal)));
};

const createPolygon = (center, edge, sides = 6, surface = drawingSurface()) => {
  const radius = distance3(edge, center);
  if (radius < 0.0001) {
    throw new Error("A polygon needs a non-zero radius.");
  }
  return mutate("Draw polygon", () => addEntity(app.project, createPolygonEntity(center, radius, sides, surface.normal)));
};

const createArc = (center, start, end) => {
  const radius = distance3(center, start);
  if (radius < 0.0001) {
    throw new Error("An arc needs a non-zero radius.");
  }
  return mutate("Draw arc", () => {
    const points = previewArc(center, start, end);
    return addEntity(app.project, createEdgeEntity({ name: "Arc", points, metadata: { primitive: "arc", center, radius, surface: drawingSurface() } }));
  });
};

const createMeasurement = (type, start, end, text = null) => {
  const label = text ?? formatLength(distance3(start, end));
  return mutate(`Create ${type}`, () => addEntity(app.project, createAnnotationEntity({
    name: type === "dimension" ? "Dimension" : "Tape Measure",
    annotationType: type,
    points: [...start, ...end],
    text: label
  })));
};

const createTextAnnotation = (point) => {
  showInputModal({
    title: "Add Text",
    fields: [{ name: "text", label: "Label", value: "Text" }],
    submitLabel: "Place Text",
    onSubmit: (values) => {
      const text = values.text.trim();
      if (!text) {
        throw new Error("Text labels cannot be empty.");
      }
      mutate("Add text", () => addEntity(app.project, createAnnotationEntity({
        name: "Text",
        annotationType: "text",
        points: [...point],
        text
      })));
    }
  });
};

const createAxesAnnotation = (point) => mutate("Place axes", () => addEntity(app.project, createAnnotationEntity({
  name: "Axes",
  annotationType: "axes",
  points: [...point],
  text: `Axes origin: ${formatNumber(point[0])}, ${formatNumber(point[1])}, ${formatNumber(point[2])} mm`
})));

const applyPushPull = (height) => {
  if (Math.abs(height) < 0.0001) {
    throw new Error("Push/Pull height must not be zero.");
  }
  const component = app.componentSelection;
  if (component?.type === "face") {
    const entity = getEntity(app.project, component.entityId);
    if (!entity || entity.locked) {
      throw new Error("Select an unlocked face before using Push/Pull.");
    }
    if (entity.metadata?.planar && entity.metadata?.radius && entity.metadata?.profilePoints && entity.metadata?.profileNormal) {
      return applyCirclePushPull(entity, height);
    }
    if (entity.metadata?.planar) {
      return mutate("Push/Pull profile", () => {
        extrudeProfile(entity, height);
        app.renderer.invalidate(entity.id);
      });
    }
    return mutate("Push/Pull face", () => {
      moveMeshFace(app.project, entity, component, height);
      app.renderer.invalidate(entity.id);
    });
  }
  const face = currentSelection().find((entity) => entity.kind === "mesh" && entity.metadata?.planar && !entity.locked);
  if (!face) {
    throw new Error("Select an unlocked planar face before using Push/Pull.");
  }
  return mutate("Push/Pull", () => {
    extrudeProfile(face, height);
    app.renderer.invalidate(face.id);
  });
};

const pushPullHeightForPointer = (interaction, pointer) => (
  (interaction.startPointer.y - pointer.y) * (app.camera.distance / Math.max(app.renderer.height, 1))
);

const restorePushPullPreview = (interaction) => {
  if (interaction.specialCircle) {
    const liveCamera = app.camera.serialize();
    restoreSnapshot({ ...interaction.before, camera: liveCamera });
    return;
  }
  const entityIndex = app.project.entities.findIndex((entity) => entity.id === interaction.entityId);
  if (entityIndex >= 0) {
    app.project.entities[entityIndex] = structuredClone(interaction.baseEntity);
  }
  app.selection = new Set(interaction.before.selection);
  app.selectionOrder = Array.from(interaction.before.selectionOrder);
  app.componentSelection = structuredClone(interaction.before.componentSelection);
  app.renderer.invalidate(interaction.entityId);
};

const previewCirclePushPull = (circle, component) => {
  const profile = {
    points: meshWorldVertices(app.project, circle),
    normal: component.normal ?? circle.metadata.profileNormal
  };
  for (const candidate of app.project.entities) {
    if (candidate.id === circle.id || candidate.kind !== "mesh" || candidate.metadata?.primitive !== "box" || candidate.locked) {
      continue;
    }
    const hole = cutCircularHoleThroughBox(app.project, candidate, profile);
    if (!hole) {
      continue;
    }
    removeEntity(app.project, candidate.id);
    removeEntity(app.project, circle.id);
    addEntity(app.project, hole);
    app.selection = new Set([hole.id]);
    app.selectionOrder = [hole.id];
    app.componentSelection = null;
    app.renderer.invalidate();
    return hole;
  }
  throw new Error("This circular face must lie fully on an unlocked axis-aligned Box face to create a through-hole.");
};

const updatePushPullPreview = (interaction, height) => {
  restorePushPullPreview(interaction);
  interaction.height = height;
  if (Math.abs(height) < 0.0001) {
    setStatus("Push/Pull: 0 mm. Move the pointer, then click to apply.");
    requestRender();
    return;
  }
  try {
    const entity = getEntity(app.project, interaction.entityId);
    if (!entity) {
      throw new Error("The selected face is no longer available.");
    }
    if (interaction.specialCircle) {
      previewCirclePushPull(entity, interaction.component);
    } else if (entity.metadata?.planar) {
      extrudeProfile(entity, height);
      app.renderer.invalidate(entity.id);
      const face = getMeshFaceRegion(app.project, entity, 1);
      app.componentSelection = face ? { type: "face", entityId: entity.id, ...face, point: face.point } : null;
    } else {
      moveMeshFace(app.project, entity, interaction.component, height);
      app.renderer.invalidate(entity.id);
      const face = getMeshFaceRegion(app.project, entity, interaction.component.triangleIndices[0]);
      app.componentSelection = face ? { type: "face", entityId: entity.id, ...face, point: face.point } : null;
    }
    setStatus(`Push/Pull: ${formatLength(height)}. Click to apply or press Escape to cancel.`);
  } catch (error) {
    interaction.height = 0;
    restorePushPullPreview(interaction);
    setStatus(error.message || "Push/Pull preview could not be created.", "error");
  }
  requestRender();
};

const beginPushPullPreview = (event) => {
  const hit = pickEntity(event);
  if (hit?.entity.kind === "mesh" && !hit.coarse && Number.isInteger(hit.triangleIndex)) {
    const face = getMeshFaceRegion(app.project, hit.entity, hit.triangleIndex);
    if (face) {
      setComponentSelection({ type: "face", entityId: hit.entity.id, ...face, point: hit.point });
    }
  }
  let component = app.componentSelection;
  let entity = component?.type === "face" ? getEntity(app.project, component.entityId) : null;
  if (!entity) {
    entity = currentSelection().find((candidate) => candidate.kind === "mesh" && candidate.metadata?.planar && !candidate.locked) ?? null;
    const face = entity ? getMeshFaceRegion(app.project, entity, 0) : null;
    if (entity && face) {
      component = { type: "face", entityId: entity.id, ...face, point: face.point };
      setComponentSelection(component);
    }
  }
  if (!entity || !component || entity.locked) {
    setStatus("Click an unlocked planar face before using Push/Pull.", "warning");
    return;
  }
  const before = snapshot();
  app.interaction = {
    kind: "pushpull-preview",
    pointerId: event.pointerId,
    startPointer: getPointer(event),
    before,
    baseEntity: structuredClone(entity),
    entityId: entity.id,
    component: structuredClone(component),
    specialCircle: Boolean(entity.metadata?.planar && entity.metadata?.radius && entity.metadata?.profilePoints && entity.metadata?.profileNormal),
    height: 0
  };
  setStatus("Push/Pull preview started. Move the pointer, then click to apply.");
  requestRender();
};

const commitPushPullPreview = () => {
  const interaction = app.interaction;
  if (interaction?.kind !== "pushpull-preview") {
    return;
  }
  if (Math.abs(interaction.height) < 0.0001) {
    restorePushPullPreview(interaction);
    app.interaction = null;
    updatePanels();
    setStatus("Push/Pull cancelled.");
    requestRender();
    return;
  }
  app.interaction = null;
  const entity = getEntity(app.project, interaction.entityId);
  if (entity && !interaction.specialCircle) {
    const triangleIndex = entity.metadata?.primitive === "extrusion" ? 1 : interaction.component.triangleIndices[0];
    const face = getMeshFaceRegion(app.project, entity, triangleIndex);
    app.componentSelection = face ? { type: "face", entityId: entity.id, ...face, point: face.point } : null;
  }
  if (commitSnapshot("Push/Pull face", interaction.before)) {
    setStatus(`Applied Push/Pull: ${formatLength(interaction.height)}.`);
  }
  updatePanels();
  requestRender();
};

const cancelPushPullPreview = () => {
  const interaction = app.interaction;
  if (interaction?.kind !== "pushpull-preview") {
    return false;
  }
  restorePushPullPreview(interaction);
  app.interaction = null;
  updatePanels();
  requestRender();
  return true;
};

const applyCirclePushPull = (circle, height) => {
  const component = app.componentSelection?.entityId === circle.id ? app.componentSelection : null;
  const profile = {
    points: meshWorldVertices(app.project, circle),
    normal: component?.normal ?? circle.metadata.profileNormal
  };
  let host = null;
  let hole = null;
  for (const candidate of app.project.entities) {
    if (candidate.id === circle.id || candidate.kind !== "mesh" || candidate.metadata?.primitive !== "box" || candidate.locked) {
      continue;
    }
    const candidateHole = cutCircularHoleThroughBox(app.project, candidate, profile);
    if (candidateHole) {
      host = candidate;
      hole = candidateHole;
      break;
    }
  }
  if (hole) {
    mutate("Cut circular through-hole", () => {
      removeEntity(app.project, host.id);
      removeEntity(app.project, circle.id);
      addEntity(app.project, hole);
      app.renderer.invalidate();
    });
    setSelection([hole.id]);
    setStatus("Cut circular through-hole through the box.");
    return hole;
  }
  throw new Error("This circular face must lie fully on an unlocked axis-aligned Box face to create a through-hole.");
};

const applyOffset = (distance) => {
  const face = currentSelection().find((entity) => entity.kind === "mesh" && entity.metadata?.planar && !entity.locked);
  if (!face) {
    throw new Error("Select an unlocked planar face before using Offset.");
  }
  if (Math.abs(distance) < 0.0001) {
    throw new Error("Offset distance must not be zero.");
  }
  const result = mutate("Offset face", () => addEntity(app.project, offsetProfile(face, distance)));
  if (result) {
    setSelection([result.id]);
  }
  return result;
};

const applyFollowMe = (vector) => {
  const face = currentSelection().find((entity) => entity.kind === "mesh" && entity.metadata?.planar && !entity.locked);
  if (!face) {
    throw new Error("Select an unlocked planar face before using Follow Me.");
  }
  if (Math.hypot(...vector) < 0.0001) {
    throw new Error("Follow Me needs a non-zero path.");
  }
  return mutate("Follow Me", () => {
    sweepProfile(face, vector);
    app.renderer.invalidate(face.id);
  });
};

const applyMove = (delta) => {
  const entities = currentSelection().filter((entity) => !entity.locked);
  if (entities.length === 0) {
    throw new Error("Select unlocked entities to move.");
  }
  return mutate("Move selection", () => {
    for (const entity of entities) {
      entity.transform.position = add3(entity.transform.position, delta);
    }
  });
};

const applyRotate = (angle) => {
  const entities = currentSelection().filter((entity) => !entity.locked);
  if (entities.length === 0) {
    throw new Error("Select unlocked entities to rotate.");
  }
  return mutate("Rotate selection", () => {
    for (const entity of entities) {
      entity.transform.rotation[2] += angle;
    }
  });
};

const applyScale = (scale) => {
  const entities = currentSelection().filter((entity) => !entity.locked);
  if (entities.length === 0) {
    throw new Error("Select unlocked entities to scale.");
  }
  if (scale.some((value) => !Number.isFinite(value) || Math.abs(value) < 0.0001)) {
    throw new Error("Scale values must be finite and non-zero.");
  }
  return mutate("Scale selection", () => {
    for (const entity of entities) {
      entity.transform.scale = entity.transform.scale.map((value, index) => value * scale[index]);
    }
  });
};

const applyMeasurements = () => {
  const raw = elements.measurements.value;
  try {
    const values = parseMeasurements(raw);
    const pending = app.pending;
    if (app.activeTool === "line" && pending?.tool === "line") {
      const start = pending.points[0];
      const surface = pending.surface ?? { point: [0, 0, 0], normal: [0, 0, 1] };
      const { tangent, bitangent } = planeBasis(surface.normal);
      const end = app.hoverPoint ?? add3(start, scale3(tangent, values[0]));
      const direction = subtract3(end, start);
      const planarLength = Math.hypot(dot3(direction, tangent), dot3(direction, bitangent));
      const output = planarLength > 0.0001
        ? add3(start, add3(scale3(tangent, (dot3(direction, tangent) / planarLength) * values[0]), scale3(bitangent, (dot3(direction, bitangent) / planarLength) * values[0])))
        : add3(start, scale3(tangent, values[0]));
      const entity = createLine(start, output);
      if (entity) {
        setSelection([entity.id]);
        app.pending = null;
      }
    } else if (app.activeTool === "rectangle" && pending?.tool === "rectangle") {
      const start = pending.points[0];
      const normal = pending.surface?.normal ?? [0, 0, 1];
      const { tangent, bitangent } = planeBasis(normal);
      const hoverDelta = app.hoverPoint ? subtract3(app.hoverPoint, start) : [values[0], values[1] ?? values[0], 0];
      const width = (Math.sign(dot3(hoverDelta, tangent)) || 1) * values[0];
      const depth = (Math.sign(dot3(hoverDelta, bitangent)) || 1) * (values[1] ?? values[0]);
      const end = add3(start, add3(scale3(tangent, width), scale3(bitangent, depth)));
      const entity = createRectangle(start, end, pending.surface);
      if (entity) {
        setSelection([entity.id]);
        app.pending = null;
      }
    } else if ((app.activeTool === "circle" || app.activeTool === "polygon") && pending?.points?.length === 1) {
      const centre = pending.points[0];
      const surface = pending.surface ?? { point: [0, 0, 0], normal: [0, 0, 1] };
      const { tangent } = planeBasis(surface.normal);
      const edge = add3(centre, scale3(tangent, values[0]));
      const segments = Math.max(3, Math.min(96, Math.round(values[1] ?? app.project.settings.circleSegments)));
      const entity = app.activeTool === "circle" ? createCircle(centre, edge, segments, "Circle", surface) : createPolygon(centre, edge, segments, surface);
      if (entity) {
        setSelection([entity.id]);
        app.pending = null;
      }
    } else if (app.activeTool === "pushpull") {
      if (app.interaction?.kind === "pushpull-preview") {
        updatePushPullPreview(app.interaction, values[0]);
        commitPushPullPreview();
      } else {
        applyPushPull(values[0]);
      }
    } else if (app.activeTool === "offset") {
      applyOffset(values[0]);
    } else if (app.activeTool === "followme") {
      applyFollowMe(values.length >= 3 ? [values[0], values[1], values[2]] : [0, 0, values[0]]);
    } else if (app.activeTool === "move") {
      applyMove([values[0], values[1] ?? 0, values[2] ?? 0]);
    } else if (app.activeTool === "rotate") {
      applyRotate((values[0] * Math.PI) / 180);
    } else if (app.activeTool === "scale") {
      applyScale(values.length >= 3 ? [values[0], values[1], values[2]] : [values[0], values[0], values[0]]);
    } else {
      throw new Error("Choose a drawing or transformation tool before entering a measurement.");
    }
    elements.measurements.value = "";
    requestRender();
  } catch (error) {
    setStatus(error.message || "The measurement could not be applied.", "error");
  }
};

const drawingTools = new Set(["line", "rectangle", "circle", "polygon", "arc", "freehand", "tape", "dimension", "protractor", "text", "axes", "section"]);

const drawingSurfaceFromHit = (hit) => ({
  point: Array.from(hit.point),
  normal: Array.from(hit.normal ?? [0, 0, 1])
});

const drawingPointForEvent = (event) => {
  if (app.pending?.surface) {
    const rawPoint = pointOnPlane(event, app.pending.surface.point, app.pending.surface.normal);
    if (!rawPoint) {
      return null;
    }
    const snap = resolvedSnapPoint(event, rawPoint, app.pending.surface);
    app.snap = snap;
    return { point: snap.point, surface: app.pending.surface };
  }
  const hit = pickEntity(event);
  if (hit?.entity.kind === "mesh" && hit.point && hit.normal) {
    const surface = drawingSurfaceFromHit(hit);
    const snap = resolvedSnapPoint(event, snapPointOnSurface(hit.point, surface), surface);
    app.snap = snap;
    return { point: snap.point, surface };
  }
  const surface = { point: [0, 0, 0], normal: [0, 0, 1] };
  const rawPoint = pointOnPlane(event, surface.point, surface.normal);
  if (!rawPoint) {
    return null;
  }
  const snap = resolvedSnapPoint(event, rawPoint, surface);
  app.snap = snap;
  return { point: snap.point, surface };
};

const setInferenceFromPoint = (point, surface) => {
  app.inference = { point: Array.from(point), surface: { point: Array.from(surface.point), normal: Array.from(surface.normal) } };
};

const handleDrawingClick = (event, point, surface = null) => {
  const tool = app.activeTool;
  if (tool === "line" || tool === "rectangle" || tool === "circle" || tool === "polygon" || tool === "tape" || tool === "dimension" || tool === "protractor" || tool === "arc") {
    if (!app.pending) {
      app.pending = { tool, points: [point], surface };
      setInferenceFromPoint(point, surface);
      setStatus("First point set. Choose the next point or type an exact measurement.");
      requestRender();
      return;
    }
    if (app.pending.tool !== tool) {
      app.pending = { tool, points: [point], surface };
      setInferenceFromPoint(point, surface);
      requestRender();
      return;
    }
    const points = app.pending.points;
    const activeSurface = app.pending.surface ?? surface;
    if (tool === "line") {
      const entity = createLine(points[0], point);
      if (entity) {
        setSelection([entity.id]);
        setStatus("Drew line on the active surface.");
      }
      app.pending = null;
      app.inference = null;
    } else if (tool === "rectangle") {
      const entity = createRectangle(points[0], point, activeSurface);
      if (entity) {
        setSelection([entity.id]);
        setStatus("Drew rectangle on the active surface.");
      }
      app.pending = null;
      app.inference = null;
    } else if (tool === "circle") {
      const entity = createCircle(points[0], point, currentCircleSegments(), "Circle", activeSurface);
      if (entity) {
        setSelection([entity.id]);
        setStatus("Drew circle on the active surface.");
      }
      app.pending = null;
      app.inference = null;
    } else if (tool === "polygon") {
      const entity = createPolygon(points[0], point, 6, activeSurface);
      if (entity) {
        setSelection([entity.id]);
        setStatus("Drew polygon on the active surface.");
      }
      app.pending = null;
      app.inference = null;
    } else if (tool === "tape" || tool === "dimension") {
      const entity = createMeasurement(tool, points[0], point);
      if (entity) {
        setSelection([entity.id]);
      }
      app.pending = null;
    } else if (tool === "arc") {
      if (points.length === 1) {
        points.push(point);
      } else {
        const entity = createArc(points[0], points[1], point);
        if (entity) {
          setSelection([entity.id]);
        }
        app.pending = null;
      }
    } else if (tool === "protractor") {
      if (points.length === 1) {
        points.push(point);
      } else {
        const first = subtract3(points[1], points[0]);
        const second = subtract3(point, points[0]);
        const angle = signedAngleAroundAxis(first, second, app.pending.surface?.normal ?? [0, 0, 1]);
        const entity = mutate("Create protractor", () => addEntity(app.project, createAnnotationEntity({
          name: "Protractor",
          annotationType: "protractor",
          points: [...points[0], ...points[1], ...points[0], ...point],
          text: formatAngle(angle)
        })));
        if (entity) {
          setSelection([entity.id]);
        }
        app.pending = null;
      }
    }
    requestRender();
  } else if (tool === "text") {
    createTextAnnotation(point);
  } else if (tool === "axes") {
    const entity = createAxesAnnotation(point);
    if (entity) {
      setSelection([entity.id]);
    }
  } else if (tool === "section") {
    mutate("Place section", () => {
      app.project.settings.section = { enabled: true, point, normal: surface?.normal ?? [0, 0, 1] };
    });
    setStatus("Placed section cut. It clips the viewport only, not the STL export.");
  }
};

const handleSelectClick = (event) => {
  const hit = pickEntity(event);
  if (!hit) {
    if (!event.shiftKey) {
      clearSelection();
    }
    return;
  }
  selectMeshComponent(event, hit);
  if (hit.entity.kind !== "mesh" || hit.coarse) {
    setStatus(`${hit.entity.name} selected${hit.coarse ? " (large mesh bounds pick)" : ""}.`);
  }
};

const beginTransform = (kind, event) => {
  const entities = currentSelection().filter((entity) => !entity.locked);
  if (entities.length === 0) {
    setStatus("Select unlocked entities before transforming.", "warning");
    return false;
  }
  const pointer = getPointer(event);
  const planePoint = pointOnDrawingPlane(event);
  const transforms = new Map(entities.map((entity) => [entity.id, structuredClone(entity.transform)]));
  app.interaction = {
    kind,
    pointerId: event.pointerId,
    startPointer: pointer,
    lastPointer: pointer,
    startPoint: planePoint,
    transforms,
    before: snapshot(),
    entities: entities.map((entity) => entity.id)
  };
  elements.canvas.setPointerCapture(event.pointerId);
  return true;
};

const beginDirectMove = (event, hit) => {
  if (hit.entity.locked) {
    setStatus("That entity is locked.", "warning");
    return false;
  }
  if (!app.selection.has(hit.entity.id)) {
    setSelection([hit.entity.id], event.shiftKey ? "add" : "replace");
  }
  const entities = currentSelection().filter((entity) => !entity.locked);
  const pointer = getPointer(event);
  const surface = { point: Array.from(hit.point), normal: Array.from(hit.normal ?? [0, 0, 1]) };
  const startPoint = pointOnPlane(event, surface.point, surface.normal);
  const transforms = new Map(entities.map((entity) => [entity.id, structuredClone(entity.transform)]));
  app.interaction = {
    kind: "direct-move",
    pointerId: event.pointerId,
    startPointer: pointer,
    lastPointer: pointer,
    startPoint,
    surface,
    transforms,
    before: snapshot(),
    entities: entities.map((entity) => entity.id),
    moved: false
  };
  app.snap = { point: startPoint ?? hit.point, kind: "face", label: "move plane", surface };
  elements.canvas.setPointerCapture(event.pointerId);
  setViewportCursor("grabbing");
  return true;
};

const startRotateProtractor = (event) => {
  let entity = currentSelection().find((candidate) => candidate.kind === "mesh" && !candidate.locked);
  const hit = pickEntity(event);
  if (!entity && hit?.entity.kind === "mesh" && !hit.entity.locked) {
    entity = hit.entity;
    setSelection([entity.id], event.shiftKey ? "add" : "replace");
  }
  if (!entity) {
    setStatus("Select an unlocked mesh before placing a rotate protractor.", "warning");
    return false;
  }
  if (!hit?.point) {
    setStatus("Click a model face or edge to place the rotate protractor centre.", "warning");
    return false;
  }
  const axis = normalize3(hit.normal ?? [0, 0, 1]);
  const pivot = Array.from(hit.point);
  app.pending = {
    tool: "rotate",
    entityId: entity.id,
    pivot,
    axis,
    surface: { point: pivot, normal: axis }
  };
  app.snap = { point: pivot, kind: "inference", label: "protractor centre", surface: app.pending.surface };
  setStatus("Protractor centre placed. Click a second point to set the rotate reference.");
  requestRender();
  return true;
};

const setRotateReference = (event) => {
  if (!app.pending || app.pending.tool !== "rotate") {
    return false;
  }
  const rawPoint = pointOnPlane(event, app.pending.pivot, app.pending.axis);
  const snap = rawPoint ? resolvedSnapPoint(event, rawPoint, app.pending.surface) : null;
  const point = snap?.point ?? rawPoint;
  if (!point || distance3(point, app.pending.pivot) < 0.001) {
    setStatus("Choose a point away from the protractor centre to set the rotate reference.", "warning");
    return false;
  }
  const reference = normalize3(subtract3(point, app.pending.pivot));
  app.interaction = {
    kind: "rotate-guide",
    entityId: app.pending.entityId,
    pivot: app.pending.pivot,
    axis: app.pending.axis,
    reference,
    angle: 0,
    before: snapshot()
  };
  app.pending = null;
  app.snap = { point, kind: snap?.kind ?? "inference", label: snap?.label ?? "rotate reference", surface: { point: app.interaction.pivot, normal: app.interaction.axis } };
  setStatus("Rotate protractor ready. Move the pointer to preview rotation, then click to apply.");
  requestRender();
  return true;
};

const pointerMovement = (current, start) => Math.hypot(current.x - start.x, current.y - start.y);

const handlePointerDown = (event) => {
  elements.canvas.focus({ preventScroll: true });
  if (event.button === 2 || event.altKey) {
    cancelPushPullPreview();
    if (app.interaction?.kind === "rotate-guide") {
      restoreSnapshot(app.interaction.before);
      app.interaction = null;
      app.snap = null;
    }
    const pointer = getPointer(event);
    app.interaction = { kind: "orbit", pointerId: event.pointerId, lastPointer: pointer };
    elements.canvas.setPointerCapture(event.pointerId);
    setViewportCursor("grabbing");
    return;
  }
  if (event.button === 0 && app.activeTool === "pushpull" && app.interaction?.kind === "pushpull-preview") {
    commitPushPullPreview();
    return;
  }
  if (event.button === 1) {
    cancelPushPullPreview();
    if (app.interaction?.kind === "rotate-guide") {
      restoreSnapshot(app.interaction.before);
      app.interaction = null;
      app.snap = null;
    }
    const pointer = getPointer(event);
    app.interaction = { kind: "pan", pointerId: event.pointerId, lastPointer: pointer };
    elements.canvas.setPointerCapture(event.pointerId);
    setViewportCursor("grabbing");
    return;
  }
  if (event.button !== 0) {
    return;
  }
  if (app.interaction?.kind === "rotate-guide" && app.activeTool !== "rotate") {
    restoreSnapshot(app.interaction.before);
    app.interaction = null;
  }
  if (app.activeTool === "rotate" && app.interaction?.kind === "rotate-guide") {
    const rotating = app.interaction;
    if (Math.abs(rotating.angle) < 0.0001) {
      setStatus("Move the pointer away from the rotate reference before applying.", "warning");
      return;
    }
    if (commitSnapshot("Rotate selection", rotating.before)) {
      setStatus(`Applied rotation of ${formatAngle(rotating.angle)}.`);
    }
    app.interaction = null;
    app.snap = null;
    requestRender();
    return;
  }
  if (app.activeTool === "rotate" && app.pending?.tool === "rotate") {
    setRotateReference(event);
    return;
  }
  const tool = app.activeTool;
  if (tool === "orbit" || tool === "pan" || tool === "zoom") {
    const pointer = getPointer(event);
    app.interaction = { kind: tool, pointerId: event.pointerId, lastPointer: pointer };
    elements.canvas.setPointerCapture(event.pointerId);
    setViewportCursor("grabbing");
    return;
  }
  if (tool === "freehand") {
    const drawing = drawingPointForEvent(event);
    if (!drawing) {
      return;
    }
    app.pending = { tool, points: [drawing.point], surface: drawing.surface };
    setInferenceFromPoint(drawing.point, drawing.surface);
    app.interaction = { kind: "freehand", pointerId: event.pointerId, points: [...drawing.point], before: snapshot(), surface: drawing.surface };
    elements.canvas.setPointerCapture(event.pointerId);
    requestRender();
    return;
  }
  if (tool === "move" || tool === "rotate" || tool === "scale") {
    if (tool === "rotate") {
      startRotateProtractor(event);
      return;
    }
    if (tool === "move") {
      const hit = pickEntity(event);
      if (!hit) {
        if (!event.shiftKey) {
          clearSelection();
        }
        return;
      }
      beginDirectMove(event, hit);
      return;
    }
    beginTransform(tool, event);
    return;
  }
  if (tool === "pushpull" || tool === "offset" || tool === "followme") {
    if (tool === "pushpull") {
      beginPushPullPreview(event);
      return;
    }
    const component = app.componentSelection;
    const componentEntity = component?.type === "face" ? getEntity(app.project, component.entityId) : null;
    const required = componentEntity ?? currentSelection().find((entity) => entity.kind === "mesh" && entity.metadata?.planar && !entity.locked);
    if (!required) {
      const hit = pickEntity(event);
      if (hit?.entity.kind === "mesh") {
        selectMeshComponent(event, hit);
      }
      if (!app.componentSelection) {
        setStatus(`${tool === "offset" ? "Offset" : "Follow Me"} requires a selected face.`, "warning");
        return;
      }
    }
    const pointer = getPointer(event);
    app.interaction = {
      kind: tool,
      pointerId: event.pointerId,
      startPointer: pointer,
      startPoint: component?.point ?? pointOnDrawingPlane(event),
      faceId: required.id
    };
    elements.canvas.setPointerCapture(event.pointerId);
    return;
  }
  if (tool === "eraser" || tool === "paint") {
    const hit = pickEntity(event);
    if (!hit) {
      setStatus("No entity was found at that point.");
      return;
    }
    if (hit.entity.locked) {
      setStatus("That entity is locked.", "warning");
      return;
    }
    if (tool === "eraser") {
      mutate("Erase entity", () => {
        removeEntity(app.project, hit.entity.id);
        clearSelection();
        app.renderer.invalidate();
      });
      setStatus(`Erased ${hit.entity.name}.`);
    } else if (hit.entity.kind === "mesh") {
      mutate("Paint entity", () => {
        hit.entity.materialId = app.activeMaterialId;
      });
      setSelection([hit.entity.id]);
      setStatus(`Painted ${hit.entity.name} with ${getMaterial(app.project, app.activeMaterialId).name}.`);
    } else {
      setStatus("Paint applies to mesh faces.", "warning");
    }
    return;
  }
  if (tool === "select") {
    const hit = pickEntity(event);
    if (!hit) {
      if (!event.shiftKey) {
        clearSelection();
      }
      return;
    }
    beginDirectMove(event, hit);
    return;
  }
  if (drawingTools.has(tool)) {
    const drawing = drawingPointForEvent(event);
    if (drawing) {
      handleDrawingClick(event, drawing.point, drawing.surface);
    }
  }
};

const handlePointerMove = (event) => {
  const pointer = getPointer(event);
  const interaction = app.interaction;
  if (!interaction) {
    snapHoverPoint(event);
    requestRender();
    return;
  }
  if (interaction.pointerId !== undefined && interaction.pointerId !== event.pointerId) {
    return;
  }
  if (interaction.kind === "rotate-guide") {
    const point = pointOnPlane(event, interaction.pivot, interaction.axis);
    if (!point) {
      return;
    }
    const direction = subtract3(point, interaction.pivot);
    if (distance3(direction, [0, 0, 0]) < 0.001) {
      return;
    }
    const angle = signedAngleAroundAxis(interaction.reference, direction, interaction.axis);
    interaction.angle = angle;
    app.snap = { point, kind: "inference", label: "rotate reference", surface: { point: interaction.pivot, normal: interaction.axis } };
    app.project = structuredClone(interaction.before.project);
    app.camera.restore(interaction.before.camera);
    const rotatingEntity = getEntity(app.project, interaction.entityId);
    if (rotatingEntity) {
      rotateEntityAroundAxis(app.project, rotatingEntity, interaction.pivot, interaction.axis, angle);
      app.renderer.invalidate();
    }
    setStatus(`Rotate: ${formatAngle(angle)}. Click to apply, Escape to cancel.`);
    requestRender();
    return;
  }
  if (interaction.kind === "orbit") {
    const deltaX = pointer.x - interaction.lastPointer.x;
    const deltaY = pointer.y - interaction.lastPointer.y;
    if (event.ctrlKey) {
      app.camera.pan(deltaX, deltaY, app.renderer.height);
    } else {
      app.camera.orbit(deltaX, deltaY);
    }
    interaction.lastPointer = pointer;
    requestRender();
    return;
  }
  if (interaction.kind === "pan") {
    app.camera.pan(pointer.x - interaction.lastPointer.x, pointer.y - interaction.lastPointer.y, app.renderer.height);
    interaction.lastPointer = pointer;
    requestRender();
    return;
  }
  if (interaction.kind === "zoom") {
    app.camera.zoom(pointer.y - interaction.lastPointer.y);
    interaction.lastPointer = pointer;
    requestRender();
    return;
  }
  if (interaction.kind === "freehand") {
    const point = pointOnPlane(event, interaction.surface.point, interaction.surface.normal);
    const previous = interaction.points.slice(-3);
    if (point && (previous.length === 0 || distance3(previous, point) >= Math.max(0.5, app.project.settings.snapIncrement))) {
      interaction.points.push(...point);
      requestRender();
    }
    return;
  }
  if (interaction.kind === "move") {
    const current = pointOnDrawingPlane(event);
    if (!current || !interaction.startPoint) {
      return;
    }
    const delta = subtract3(current, interaction.startPoint);
    for (const id of interaction.entities) {
      const entity = getEntity(app.project, id);
      const initial = interaction.transforms.get(id);
      if (entity && initial) {
        entity.transform.position = add3(initial.position, delta);
      }
    }
    setStatus(`Move: ${formatLength(delta[0])}, ${formatLength(delta[1])}, ${formatLength(delta[2])}`);
    requestRender();
    return;
  }
  if (interaction.kind === "direct-move") {
    const current = pointOnPlane(event, interaction.surface.point, interaction.surface.normal);
    if (!current || !interaction.startPoint) {
      return;
    }
    const delta = subtract3(current, interaction.startPoint);
    app.snap = { point: current, kind: "inference", label: "move plane", surface: interaction.surface };
    interaction.moved = interaction.moved || pointerMovement(pointer, interaction.startPointer) > 3 * app.renderer.pixelRatio;
    for (const id of interaction.entities) {
      const entity = getEntity(app.project, id);
      const initial = interaction.transforms.get(id);
      if (entity && initial) {
        entity.transform.position = add3(initial.position, delta);
      }
    }
    setStatus(`Move: ${formatLength(delta[0])}, ${formatLength(delta[1])}, ${formatLength(delta[2])}`);
    requestRender();
    return;
  }
  if (interaction.kind === "scale") {
    const factor = Math.max(0.01, Math.exp((pointer.x - interaction.startPointer.x) * 0.01));
    for (const id of interaction.entities) {
      const entity = getEntity(app.project, id);
      const initial = interaction.transforms.get(id);
      if (entity && initial) {
        entity.transform.scale = initial.scale.map((value) => value * factor);
      }
    }
    setStatus(`Scale: ${formatNumber(factor)}x`);
    requestRender();
    return;
  }
  if (interaction.kind === "pushpull-preview") {
    updatePushPullPreview(interaction, pushPullHeightForPointer(interaction, pointer));
    return;
  }
  if (interaction.kind === "offset") {
    const distance = (pointer.x - interaction.startPointer.x) * (app.camera.distance / Math.max(app.renderer.height, 1));
    setStatus(`Offset: ${formatLength(distance)}. Release to apply or type an exact distance.`);
    return;
  }
  if (interaction.kind === "followme") {
    const current = pointOnDrawingPlane(event);
    if (current && interaction.startPoint) {
      const vector = subtract3(current, interaction.startPoint);
      setStatus(`Follow Me vector: ${formatLength(vector[0])}, ${formatLength(vector[1])}, ${formatLength(vector[2])}`);
    }
  }
};

const handlePointerUp = (event) => {
  const interaction = app.interaction;
  if (!interaction || (interaction.pointerId !== undefined && interaction.pointerId !== event.pointerId)) {
    return;
  }
  if (elements.canvas.hasPointerCapture(event.pointerId)) {
    elements.canvas.releasePointerCapture(event.pointerId);
  }
  if (interaction.kind === "pushpull-preview") {
    setViewportCursor();
    return;
  }
  if (interaction.kind !== "rotate-guide") {
    app.interaction = null;
  }
  setViewportCursor();
  if (interaction.kind === "orbit" || interaction.kind === "pan" || interaction.kind === "zoom") {
    scheduleCameraAutosave();
    requestRender();
    return;
  }
  if (interaction.kind === "rotate-guide") {
    return;
  }
  if (interaction.kind === "direct-move") {
    if (snapshotDiffers(interaction.before) && commitSnapshot("Move selection", interaction.before)) {
      setStatus("Moved selected entity.");
    } else {
      const hit = pickEntity(event);
      if (hit?.entity.kind === "mesh" && !event.shiftKey) {
        selectMeshComponent(event, hit);
      }
      requestRender();
    }
    app.snap = null;
    return;
  }
  if (interaction.kind === "move" || interaction.kind === "rotate" || interaction.kind === "scale") {
    if (commitSnapshot(`${interaction.kind[0].toUpperCase()}${interaction.kind.slice(1)} selection`, interaction.before)) {
      setStatus(`${interaction.kind[0].toUpperCase()}${interaction.kind.slice(1)} applied.`);
    }
    return;
  }
  if (interaction.kind === "freehand") {
    if (interaction.points.length >= 6) {
      const entity = mutate("Draw freehand", () => addEntity(app.project, createEdgeEntity({ name: "Freehand", points: interaction.points })));
      if (entity) {
        setSelection([entity.id]);
      }
    }
    app.pending = null;
    app.inference = null;
    app.snap = null;
    requestRender();
    return;
  }
  const pointer = getPointer(event);
  if (interaction.kind === "offset") {
    const distance = (pointer.x - interaction.startPointer.x) * (app.camera.distance / Math.max(app.renderer.height, 1));
    if (Math.abs(distance) >= 0.1) {
      try {
        applyOffset(distance);
      } catch (error) {
        setStatus(error.message, "error");
      }
    }
    return;
  }
  if (interaction.kind === "followme") {
    const point = pointOnDrawingPlane(event);
    if (point && interaction.startPoint) {
      const vector = subtract3(point, interaction.startPoint);
      if (Math.hypot(...vector) >= 0.1) {
        try {
          applyFollowMe(vector);
        } catch (error) {
          setStatus(error.message, "error");
        }
      }
    }
  }
};

const cancelActiveOperation = () => {
  if (cancelPushPullPreview()) {
    setTool("select");
    setStatus("Operation cancelled.");
    return;
  }
  if (app.interaction?.before && ["move", "rotate", "scale", "direct-move", "rotate-guide"].includes(app.interaction.kind)) {
    restoreSnapshot(app.interaction.before);
  }
  app.interaction = null;
  app.pending = null;
  app.hoverPoint = null;
  app.inference = null;
  app.snap = null;
  setTool("select");
  setStatus("Operation cancelled.");
};

const newProject = () => {
  const replace = async () => {
    window.clearTimeout(app.autosaveTimer);
    try {
      await preserveRecovery();
    } catch (error) {
      setStatus(`Local recovery could not be preserved: ${error.message}`, "warning");
    }
    resetTransientToolState();
    app.activeTool = "select";
    refreshToolPresentation();
    app.project = createEmptyProject();
    app.camera.reset();
    app.selection = new Set();
    app.selectionOrder = [];
    app.history = [];
    app.future = [];
    app.fileHandle = null;
    app.activeMaterialId = "material-default";
    app.renderer.invalidate();
    applyAppearance();
    setDirty(false);
    updatePanels();
    requestRender();
    scheduleAutosave();
    setStatus("Created a new empty project.");
  };
  if (!app.dirty) {
    void replace();
    return;
  }
  const content = element("div");
  content.append(element("p", { text: "Create a new project? Unsaved file changes will remain in local recovery storage but will no longer be in the current editor." }));
  showModal("New Project", content, [
    { label: "Cancel", onClick: () => true },
    { label: "Create New", className: "danger-button", onClick: () => replace() }
  ]);
};

const actionHandlers = {
  "new-project": newProject,
  "open-project": openProject,
  "save-project": saveProject,
  "import-stl": importStl,
  "export-stl": exportStl,
  undo,
  redo,
  "delete-selection": deleteSelection,
  "duplicate-selection": duplicateSelection,
  "make-group": groupSelection,
  "explode-group": explodeSelectedGroup,
  "toggle-sidebar": () => {
    elements.sidebar.classList.toggle("hidden");
    elements.workArea.classList.toggle("sidebar-hidden", elements.sidebar.classList.contains("hidden"));
    requestRender();
  },
  "toggle-grid": () => toggleProjectSetting("gridVisible"),
  "toggle-edges": () => toggleProjectSetting("edgesVisible"),
  "toggle-shadows": () => toggleProjectSetting("shadowsVisible"),
  "toggle-projection": toggleProjection,
  "clear-section": clearSection,
  "zoom-extents": fitModel,
  "view-top": () => setView("top"),
  "view-front": () => setView("front"),
  "view-right": () => setView("right"),
  "view-iso": () => setView("iso"),
  "add-box": addBoxDialog,
  "add-cylinder": addCylinderDialog,
  "set-circle-segments": setCircleSegmentsDialog,
  "solid-subtract": makeSubtract,
  "reverse-faces": reverseSelectedFaces,
  "print-check": showPrintCheck,
  "show-entity-panel": () => activateSidePanel("entity-panel"),
  "show-tags-panel": () => activateSidePanel("tags-panel"),
  "show-materials-panel": () => activateSidePanel("materials-panel"),
  "show-scenes-panel": () => activateSidePanel("scenes-panel"),
  "show-outliner-panel": () => activateSidePanel("outliner-panel"),
  "open-appearance": openAppearance,
  "toggle-theme": toggleTheme,
  "reset-appearance": resetAppearance,
  "show-onboarding": showOnboarding
};

const executeAction = (action) => {
  const handler = actionHandlers[action];
  if (handler) {
    Promise.resolve(handler()).catch((error) => setStatus(error.message || "The requested action failed.", "error"));
  }
};

const bindInterface = () => {
  document.querySelectorAll(".menu-button").forEach((button) => button.addEventListener("click", () => selectRibbon(button.dataset.menu)));
  document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => executeAction(button.dataset.action)));
  document.querySelectorAll("[data-tool]").forEach((button) => button.addEventListener("click", () => setTool(button.dataset.tool)));
  document.querySelectorAll(".side-tab").forEach((button) => button.addEventListener("click", () => activateSidePanel(button.dataset.panel)));
  document.querySelector("#add-tag-button").addEventListener("click", addTagDialog);
  document.querySelector("#add-material-button").addEventListener("click", addMaterialDialog);
  document.querySelector("#add-scene-button").addEventListener("click", addSceneDialog);
  document.querySelector("#help-button").addEventListener("click", showHelp);
  elements.viewCube.addEventListener("click", resetView);
  bindFloatingPalette();
  elements.measurements.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      applyMeasurements();
    }
  });
  elements.canvas.addEventListener("pointerdown", handlePointerDown);
  elements.canvas.addEventListener("pointermove", handlePointerMove);
  elements.canvas.addEventListener("pointerup", handlePointerUp);
  elements.canvas.addEventListener("pointercancel", cancelActiveOperation);
  elements.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  elements.canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    app.camera.zoom(event.deltaY);
    requestRender();
    scheduleCameraAutosave();
  }, { passive: false });
  elements.projectInput.addEventListener("change", async () => {
    const [file] = Array.from(elements.projectInput.files ?? []);
    elements.projectInput.value = "";
    if (!file) {
      app.openAlreadyConfirmed = false;
      return;
    }
    try {
      if (app.openAlreadyConfirmed) {
        app.openAlreadyConfirmed = false;
        await loadProjectFile(file);
      } else {
        await confirmDiscardForOpen(() => loadProjectFile(file));
      }
    } catch (error) {
      setStatus(`Could not open project: ${error.message}`, "error");
    }
  });
  elements.stlInput.addEventListener("change", async () => {
    const [file] = Array.from(elements.stlInput.files ?? []);
    elements.stlInput.value = "";
    if (!file) {
      return;
    }
    try {
      await loadStlFile(file);
    } catch (error) {
      setStatus(`Could not import STL: ${error.message}`, "error");
    }
  });
  window.addEventListener("resize", () => {
    if (app.paletteDetached) {
      positionFloatingPalette();
    }
    requestRender();
  });
  window.addEventListener("keydown", handleKeyboard);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Control") {
      lockInference();
    }
  });
  window.addEventListener("keyup", (event) => {
    if (event.key === "Control") {
      unlockInference();
    }
  });
  window.addEventListener("beforeunload", () => {
    if (app.dirty) {
      persistWorkspaceNow().catch(() => {});
      preserveRecovery().catch(() => {});
    }
  });
  bindDropTarget();
  bindInstall();
};

const bindDropTarget = () => {
  let dragDepth = 0;
  const acceptsFileDrop = (event) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
  const showDrop = () => {
    elements.dropOverlay.hidden = false;
    elements.dropOverlay.classList.add("visible");
  };
  const hideDrop = () => {
    elements.dropOverlay.hidden = true;
    elements.dropOverlay.classList.remove("visible");
  };
  document.addEventListener("dragenter", (event) => {
    if (!acceptsFileDrop(event)) {
      return;
    }
    event.preventDefault();
    dragDepth += 1;
    showDrop();
  });
  document.addEventListener("dragover", (event) => {
    if (acceptsFileDrop(event)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }
  });
  document.addEventListener("dragleave", (event) => {
    if (!acceptsFileDrop(event)) {
      return;
    }
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      hideDrop();
    }
  });
  document.addEventListener("drop", async (event) => {
    if (!acceptsFileDrop(event)) {
      return;
    }
    event.preventDefault();
    dragDepth = 0;
    hideDrop();
    const [file] = Array.from(event.dataTransfer.files ?? []);
    if (!file) {
      return;
    }
    try {
      if (/\.vibeup$/i.test(file.name)) {
        await confirmDiscardForOpen(() => loadProjectFile(file));
      } else if (/\.stl$/i.test(file.name)) {
        await loadStlFile(file);
      } else {
        throw new Error("Drop a .vibeup project or .stl mesh file.");
      }
    } catch (error) {
      setStatus(`Could not open dropped file: ${error.message}`, "error");
    }
  });
};

const bindInstall = () => {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    app.installPrompt = event;
    elements.install.hidden = false;
  });
  elements.install.addEventListener("click", async () => {
    if (!app.installPrompt) {
      return;
    }
    app.installPrompt.prompt();
    await app.installPrompt.userChoice;
    app.installPrompt = null;
    elements.install.hidden = true;
  });
  window.addEventListener("appinstalled", () => {
    app.installPrompt = null;
    elements.install.hidden = true;
    setStatus("vibe-up is installed and ready for offline use.");
  });
};

const handleKeyboard = (event) => {
  if (elements.modal.open) {
    return;
  }
  const target = event.target;
  const editingText = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
  const key = event.key.toLowerCase();
  if (event.metaKey || event.ctrlKey) {
    if (key === "z") {
      event.preventDefault();
      if (event.shiftKey) {
        redo();
      } else {
        undo();
      }
      return;
    }
    if (key === "y") {
      event.preventDefault();
      redo();
      return;
    }
    if (key === "s") {
      event.preventDefault();
      saveProject();
      return;
    }
    if (key === "o") {
      event.preventDefault();
      openProject();
      return;
    }
    if (key === "n") {
      event.preventDefault();
      newProject();
      return;
    }
    if (key === "d") {
      event.preventDefault();
      duplicateSelection();
    }
    return;
  }
  if (editingText) {
    if (event.key === "Escape") {
      target.blur();
    }
    return;
  }
  if (event.key === "Control") {
    lockInference();
  }
  if (event.key === "Escape") {
    event.preventDefault();
    cancelActiveOperation();
    return;
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    deleteSelection();
    return;
  }
  if (event.shiftKey && key === "z") {
    event.preventDefault();
    fitModel();
    return;
  }
  const shortcutTools = {
    " ": "select",
    l: "line",
    r: "rectangle",
    c: "circle",
    a: "arc",
    e: "eraser",
    b: "paint",
    m: "move",
    q: "rotate",
    s: "scale",
    p: "pushpull",
    f: "offset",
    t: "tape",
    d: "dimension",
    h: "pan",
    z: "zoom",
    o: "orbit"
  };
  if (shortcutTools[key]) {
    event.preventDefault();
    setTool(shortcutTools[key]);
  }
};

const restoreAutosave = async () => {
  try {
    const saved = (await loadRecovery()) ?? (await loadWorkspace());
    if (!saved?.project) {
      return;
    }
    app.project = normalizeProject(saved.project);
    app.camera.restore(normalizeCamera(saved.camera));
    app.camera.projectionType = app.project.settings.projection;
    app.activeMaterialId = app.project.materials[0]?.id ?? "material-default";
    app.dirty = false;
    setStatus("Recovered the local workspace.");
  } catch (error) {
    setStatus(`Local recovery was skipped: ${error.message}`, "warning");
  }
};

const init = async () => {
  try {
    app.renderer = new Renderer(elements.canvas);
  } catch (error) {
    document.body.replaceChildren(element("main", { className: "fatal-error", text: error.message }));
    return;
  }
  await migrateWorkspace();
  await restoreAutosave();
  loadPreferences();
  bindInterface();
  selectRibbon("home");
  setPaletteDetached(app.preferences.paletteDetached);
  setTool("select");
  applyAppearance();
  updatePanels();
  requestRender();
  window.setTimeout(() => {
    if (!app.preferences.onboardingDismissed) {
      showOnboarding();
    }
  }, 350);
  if ("serviceWorker" in navigator) {
    let reloadingForUpdate = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (navigator.serviceWorker.controller && !reloadingForUpdate) {
        if (app.dirty) {
          persistWorkspaceNow()
            .catch(() => {})
            .finally(() => {
              reloadingForUpdate = true;
              window.location.reload();
            });
        } else {
          reloadingForUpdate = true;
          window.location.reload();
        }
      }
    });
    navigator.serviceWorker.register("./sw.js")
      .then((registration) => registration.update())
      .catch((error) => setStatus(`Offline cache registration failed: ${error.message}`, "warning"));
  }
};

init();
