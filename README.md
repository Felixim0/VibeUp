# vibe-up

An offline-first, installable browser 3D editor for millimetre-based modelling and STL workflows. vibe-up is a static Progressive Web App with no runtime third-party dependencies.

[Try VibeUp For Free! :0 ](https://felixim0.github.io/VibeUp/).

## Workflow Upgrade

- GitHub Pages deployment uses Node 24-compatible, SHA-pinned actions: Checkout v7, Setup Node v7, Upload Pages Artifact v5, and Deploy Pages v5.
- `upload-pages-artifact` v5 uses `upload-artifact` v7, resolving GitHub Actions' Node 20 deprecation warning for `upload-artifact@v4`.
- The offline cache revision is updated with this release, so installed copies fetch the new application shell on their next refresh.

## Core workflow

- **Select is the default pointer tool.** Click a mesh face or visible mesh edge to select that component; drag a selected object directly in the viewport to move it on the clicked face plane.
- **Tool-aware mouse cursor.** The pointer visibly changes for Select, Move, Rotate, drawing, measuring, Paint, Eraser, Orbit, Pan, and Zoom. Dragging switches to a grab state so active manipulation is unambiguous.
- **Move mode is click-first.** A single click selects an object and a drag moves it, matching the direct Select workflow.
- **Home is the default ribbon.** It collects Select, Line, Rectangle, Circle, Box, Move, Rotate, Push/Pull, Tape, and Zoom Extents.
- **Detachable tools.** Use **Detach tools** to open a draggable floating palette with every tool, then attach it again from the palette's close control.
- The detachable palette is height-bounded to remain reachable on short browser windows.
- **SketchUp-style snapping.** The mouse snaps to endpoints, midpoints, and compatible edges. A visible point shows the pending click location.
- **Inference locking.** While drawing, hold `Control` when hovering an inferred edge or face axis to lock the point to that straight line. Release `Control` to unlock.
- **Protractor-based rotation.** Select a mesh, select Rotate, click a face or edge to place the protractor centre, click a second point to establish the reference ray, move to preview rotation, then click to apply. `Escape` cancels.
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
- Select individual mesh faces and visible mesh edges. A selected face is highlighted independently, and Push/Pull moves only that face.
- Push/Pull of a circular face through an axis-aligned Box produces a closed circular through-hole rather than an overlapping cylinder. Unsupported placements fail safely rather than creating an overlapping solid.
- Dimensioned box and cylinder creation.
- Push/Pull planar faces into solids.
- Offset planar faces and create a straight-vector Follow Me sweep.
- Move, protractor rotate, scale, erase, paint, and reverse faces.
- Experimental subtract for compatible closed meshes. Axis-aligned nested Box primitives produce a checked closed result; other meshes use a guarded BSP path.
- Exact measurement entry in `mm`, `cm`, `m`, and inches.

### View and presentation

- Orbit, pan, zoom, top/front/right/isometric views, and Zoom Extents.
- Perspective or parallel projection.
- Grid and mesh-edge toggles, with flat face colours by default. Face back-sides are shown in blue to make reversed winding visible.
- Wheel zoom slows proportionally as the camera approaches the model for fine positioning.
- Light theme by default plus a dark-theme option.
- Custom workspace, grid, edge, selection colours, and edge thickness.
- Yellow selection by default, configurable from Appearance.
- First-run Getting Started guide with a persistent opt-out and manual re-opening from Appearance.

## Shortcuts

| Shortcut | Tool or action |
| --- | --- |
| `Space` | Select |
| `L`, `R`, `C`, `A` | Line, Rectangle, Circle, Arc |
| `M`, `Q`, `S`, `P`, `F` | Move, Rotate, Scale, Push/Pull, Offset |
| `T`, `D`, `B`, `E` | Tape, Dimension, Paint, Eraser |
| `O`, `H`, `Z`, `Shift+Z` | Orbit, Pan, Zoom, Zoom Extents |
| `Control` while drawing | Lock straight-line inference |
| `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z` | Undo, Redo |
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
