# vibe-up

An offline-first, installable browser 3D editor for millimetre-based modelling and STL workflows. vibe-up is a static Progressive Web App with no runtime third-party dependencies.

[Try VibeUp For Free! :0 ](https://felixim0.github.io/VibeUp/).

## Workflow Upgrade

- GitHub Pages deployment uses Node 24-compatible, SHA-pinned actions: Checkout v7, Setup Node v7, Upload Pages Artifact v5, and Deploy Pages v5.
- `upload-pages-artifact` v5 uses `upload-artifact` v7, resolving GitHub Actions' Node 20 deprecation warning for `upload-artifact@v4`.
- The offline cache revision is updated with this release, so installed copies fetch the new application shell on their next refresh.

## Core workflow

- **Select is component-aware.** Click once to select a face, edge, or line; double-click a face to include its boundary edges; triple-click to select the entire visible model. Dragging a selected object moves it on the clicked face plane.
- **Directional box selection.** Drag left-to-right to select only fully enclosed lines and faces whose boundary lines are enclosed. Drag right-to-left for a dotted box that selects crossing lines and intersecting face regions. Hidden components are selectable through faces in X-ray only. `Ctrl/Cmd+A` selects all visible model items or items in the current group.
- **Tool-aware mouse cursor.** The pointer visibly changes for Select, Move, Rotate, drawing, measuring, Paint, Eraser, Orbit, Pan, and Zoom. Non-Select cursor art sits down-left of the exact snap point so it never hides the inference marker.
- Push/Pull uses its own extrusion cursor rather than the drawing-pencil cursor.
- **Move mode is click-first.** A single click selects an object and a drag moves it, matching the direct Select workflow.
- Locked objects remain selectable so they can be unlocked from Entity Info; all edit operations remain blocked until unlocked.
- **Home is the default ribbon.** It collects Select, Line, Rectangle, Circle, Box, Move, Rotate, Push/Pull, Tape, and Zoom Extents.
- **Detachable tools.** Use **Detach tools** to open a draggable, resizable floating palette. Its tool groups have the same names as the ribbon menus and are separated by section rules. It can be narrowed substantially or positioned partly offscreen, while the main ribbon disappears to preserve workspace height.
- Reattach from the top bar or palette close button. Drag any non-tool area of the palette to move it; detaching again resets its position.
- The detachable palette can remain partly offscreen when deliberately positioned there.
- **SketchUp-style snapping.** The mouse snaps to endpoints, midpoints, and compatible edges. A visible point shows the pending click location.
- Endpoint and midpoint snaps have larger red markers. Hold `Shift` while drawing a line to keep it on its starting plane; the live line turns green.
- **Camera sensitivity.** Adjust Rotate and Move sliders on the Camera ribbon; preferences persist with the workspace and saved project.
- `Ctrl/Cmd+C` and `Ctrl/Cmd+V` copy and paste the selected model entities, face, or edge with an offset.
- **Inference locking.** While drawing, hold `Control` when hovering an inferred edge or face axis to lock the point to that straight line. Release `Control` to unlock.
- **Grab-point orbit and rotation.** Orbit pivots around the model point where orbit begins. Rotate uses the exact grabbed face or edge point as its rotation pivot, then uses a second point as the reference ray. `Escape` cancels.
- Rotation preserves existing object placement and uses the selected world-space protractor centre.

## Features

### Project files

- Save as `.vibeup`, a standards-compatible ZIP archive containing `document.json`.
- Open or drag-and-drop `.vibeup` projects.
- Validate archive paths, checksums, project data, and hierarchy before opening.
- Use Chromium's native save/open picker when available, with a download fallback.
- Autosave and recovery storage are local IndexedDB only.

### STL and printing

- Import ASCII and binary STL up to 100,000 triangles.
- Edit imported mesh entities through direct movement, rotation, scaling, painting, grouping, duplication, face reversal, and deletion.
- Export selected meshes, or all visible meshes, as binary STL in millimetres.
- Run local topology checks for degenerate triangles, boundaries, non-manifold edges, triangle counts, and bounds.

### Drawing and modelling

- Line, rectangle, circle, polygon, three-point arc, and freehand tools.
- Draw on the ground plane or click a model face to draw directly on that face plane.
- Circle segment count is configurable from **Segments** on Home or Draw, and can be entered as `radius, segments` in Measurements.
- Circular faces render as one plain face; their triangles are retained internally only for robust geometry and STL export.
- Select individual mesh faces and visible mesh edges. A selected component receives a subtle local highlight rather than recolouring the whole mesh. Delete removes a selected face, removes a standalone line, and removes all planar faces joined by a selected mesh edge.
- Push/Pull of a circular face through an axis-aligned Box produces a closed circular through-hole rather than an overlapping cylinder. Unsupported placements fail safely rather than creating an overlapping solid.
- An outer planar profile consumes enclosed coplanar profiles as holes during Push/Pull, so a circle drawn inside a square becomes a real circular opening in the resulting solid. The same behavior indents nested profiles drawn on an existing mesh face.
- Draw a line from one boundary edge of a face to another to split the face into two separately selectable, extrudable regions. Push a drawn closed profile into an existing host face to create a recessed cut.
- Dimensioned box and cylinder creation.
- Push/Pull is click-move-click: click a face, inspect the live shape preview as the pointer moves, then click again to commit. Escape cancels the preview.
- Middle-drag pans and right/Alt-drag orbits during the Push/Pull preview without cancelling it; wheel zoom remains available.
- Clicking another face or line during a live Push/Pull matches its height along the selected face normal.
- Offset planar faces and create a straight-vector Follow Me sweep.
- Move, protractor rotate, scale, erase, paint, and reverse faces.
- Experimental subtract for compatible closed meshes. Axis-aligned nested Box primitives produce a checked closed result; other meshes use a guarded BSP path.
- Exact measurement entry in `mm`, `cm`, `m`, and inches.

### View and presentation

- Orbit, pan, zoom, top/front/right/isometric views, and Zoom Extents.
- View ribbon offers **Shaded** (the default faces and edges), **X-ray** (transparent faces and selectable hidden lines), and **Solid** (unshaded faces without edges).
- Perspective or parallel projection.
- Grid and mesh-edge toggles, with thicker red, green, and blue world axes, restrained depth-tested committed lines, and high-visibility live drawing previews. Face back-sides are shown in blue to make reversed winding visible.
- Wheel zoom slows proportionally as the camera approaches the model for fine positioning.
- Orbit keeps the world Z axis upright and stops just short of top and bottom poles, preventing disorienting camera roll.
- Light theme by default plus a dark-theme option.
- Custom workspace, grid, edge, selection colours, and edge thickness.
- A muted gold selection accent by default, configurable from Appearance.
- First-run Getting Started guide with a persistent opt-out and manual re-opening from Appearance.

## Shortcuts

| Shortcut | Tool or action |
| --- | --- |
| `Space` | Select |
| `L`, `R`, `C`, `A` | Line, Rectangle, Circle, Arc |
| `M`, `Q`, `S`, `P`, `F` | Move, Rotate, Scale, Push/Pull, Offset |
| `T`, `D`, `B`, `E` | Tape, Dimension, Paint, Eraser |
| `O`, `H`, `Z`, `Shift+Z` | Orbit, Pan, Zoom, Zoom Extents |
| `Control` + Orbit drag | Pan the camera in the view plane |
| `Ctrl/Cmd+A` | Select all visible items in the current model or group |
| `Control` while drawing | Lock straight-line inference |
| `Shift` while drawing a line | Lock its starting plane and show a green preview |
| `Ctrl/Cmd+C`, `Ctrl/Cmd+V` | Copy and paste selected model, face, or edge |
| `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z` | Undo/redo model changes without moving the current camera |
| `Ctrl/Cmd+S`, `Ctrl/Cmd+O` | Save, Open |
| `Delete`, `Escape` | Delete selection, Cancel operation |

## GitHub Pages

`.github/workflows/deploy-pages.yml` deploys the static PWA from `main` and can run manually. It uses immutable SHA-pinned GitHub Actions that run on Node 24:

- `actions/checkout` v7.0.1
- `actions/setup-node` v7.0.0
- `actions/upload-pages-artifact` v5.0.0, which uses `upload-artifact` v7
- `actions/deploy-pages` v5.0.1

This removes the GitHub Actions Node 20 deprecation warning for `upload-artifact@v4`.

To deploy, push to `main`, open repository **Settings** → **Pages**, and select **GitHub Actions** as the source. The install URL will be:

```text
https://OWNER.github.io/REPOSITORY/
```

The HTML, web manifest, and service worker use relative asset paths, so GitHub Pages project URLs and custom-domain roots both work. GitHub Pages serves `github.io` sites using HTTPS, which allows Chromium to install the PWA.

Deploy updates activate a new service worker and refresh the application shell automatically. Saved `.vibeup` files and local autosave data are retained, so manual `localStorage.clear()` is no longer required after deployment.

## Development

The isolated Conda environment is `vibeupOpenCode`.

```sh
/opt/miniconda3/bin/conda run --name vibeupOpenCode npm start
/opt/miniconda3/bin/conda run --name vibeupOpenCode npm run check
/opt/miniconda3/bin/conda run --name vibeupOpenCode npm run test:browser
/opt/miniconda3/bin/conda run --name vibeupOpenCode npm run build:pages
```

`npm run check` validates all source and Pages workflow configuration. `npm run test:browser` runs a Chromium smoke test. `npm run build:pages` assembles and validates the deployable `site/` artifact. No production npm dependencies or CDN resources are used.
