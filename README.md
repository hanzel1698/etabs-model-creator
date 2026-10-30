# ETABS Model Creator

Draw grids, columns, beams and slabs over an architectural underlay (DXF or PDF), then push the model into a running ETABS 22.

```
web app (static, GitHub Pages)  ⇄  bridge/bridge.py on http://127.0.0.1:8765  ⇄  ETABS 22 (COM API)
```

## Run

```bash
pip install -r bridge/requirements.txt
python bridge/bridge.py          # with ETABS 22 open
npm --prefix web install
npm --prefix web run dev         # http://localhost:5173
```

The hosted Pages build works the same way: it calls the bridge on `127.0.0.1:8765` from your PC. The URL can be changed in the ETABS dialog.

`python bridge/selftest.py` starts a **new** blank ETABS instance and runs push, re-push, edit and verify against it, then closes it.

> ETABS 20 and 22 share the same COM type-library id. If comtypes has a cached wrapper built from ETABS 20, the bridge regenerates it from the ETABS 22 `ETABSv1.tlb` on start. Without this, calls hit the wrong methods and ETABS crashes.

## Workflow

1. **Underlay…** loads a DXF or a PDF.
   - **DXF** (recommended): vector, real units, snapping. All plans can sit in one model space. Use **Define story region**: box a plan, click its reference point (e.g. grid A/1), then tick the stories it applies to. The reference point maps to the model origin, so every story lines up.
   - **PDF**: one page per story. In **Setup**, assign the pages to stories. Then on each story use **Calibrate + origin**: click two points, type their real distance, then click the reference point.
2. **Grids** (G): draw them, or use **Generate grids…** with spacings like `3@6000, 4500`.
   **Reference planes…** (Draw menu) adds horizontal planes at any elevation, such as a landing or a mezzanine. Type the elevation, or add one at a story level plus an offset. They show in the Elevation view.
3. **Columns** (C): click a point (snaps to intersections), or drag a window to fill every intersection inside it.
4. **Beams** (B): chained drawing that snaps to columns, faces, ends, midpoints, perpendiculars and underlay vertices. Type `dx,dy`, `@dist<angle` or a length, relative to the last point (or the last snap point you hovered). **Offset beam** (O): pick a grid or beam, then type a distance or click a side. **Beams on grids** places beams between consecutive columns along every grid.
5. **Slabs**: **Slab (bay)** (S) fills the closed bay you click. **Draw slab** (P) lets you draw a polygon.
6. **Measure**: distance (M, chainable), angle (A), area (R).
7. **Select** (V): a left-to-right window selects what's fully inside; right-to-left selects anything crossing. **Replicate** (E) copies linearly by dx/dy or onto other stories (tick boxes or a range such as `3-10`). **Move…** and Del are also available.
8. Ticking stories in the left panel draws on all of them at once.
9. The view controls rotate the plan (the model itself is unchanged), show the story below as a ghost, toggle section labels, colour by section, and set text size. **Split** or **3D** opens the three.js view.
10. **Loads** (top bar):
    - **Load patterns…** defines patterns: name, type and self-weight multiplier. The defaults are Dead (×1), SDL and Live.
    - The **pattern dropdown** sets the active pattern. The assign dialogs start with it, and **Loads (active pattern)** in the view toggles shows its values on the plan.
    - **Frame load…** applies to the selected beams and columns. It takes uniform, trapezoidal (up to 4 stations) or point loads, as a force or a moment, in any direction. Distances are relative or in metres.
    - **Shell load…** applies a uniform kN/m² load to the selected slabs.
    - **Joint load…** applies Fx…Mz to the selected nodes (Alt+drag selects nodes), on one or more stories.
    - Each dialog can **Add**, **Replace** or **Delete** the loads in its pattern, as ETABS does. The right panel lists the loads on the selection, and × removes one.
    - Loads follow Replicate, Move, Split slabs and Undo. Joining or merging keeps a load only when every piece carried the same one; if the pieces differ, the toast says the loads were dropped.
    - **Select by…** can pick elements that carry a load in a given pattern, or no loads at all.
11. **ETABS…**:
    - **Import** reads stories, grids, reference planes, materials, frame sections, slab sections and load patterns. With **Columns, beams, slabs** ticked it also brings in the frame and area objects on the story levels, with their frame and uniform slab loads in the app's patterns. Braces, walls, openings and objects between story levels are skipped. Elements the app already has (same GUID, or same place on the same story) are left as they are.
    - **Push** sends sections, grids, reference planes and stories (each optional), elements, and (with **Loads** ticked) load patterns and loads.
    - **Verify** reads everything back and compares it with the app, loads included.

## How the app maps to ETABS

- Units: the app works in mm. The bridge switches ETABS to kN-mm-C while it works and then restores your units.
- A column on story S runs from the elevation of the story below up to S. Beams and slabs sit at S's elevation. A column's angle becomes its local axis rotation.
- Each element keeps a GUID that is written to the ETABS object (`SetGUID`). Pushing again does the following:
  - an unchanged object is left alone;
  - a changed section or angle is updated in place;
  - changed geometry means the object is deleted and re-added;
  - an element deleted in the app is deleted in ETABS.
- Objects you drew directly in ETABS are never touched, unless you import them. An imported element keeps its ETABS GUID as its id, so the app owns it from then on: pushes update it and deleting it in the app deletes it in ETABS. Importing gives an ETABS object a new GUID if it has none.
- Reference planes: ETABS has no API object for them, so the bridge edits the **Grid Definitions - Reference Planes** table (`DatabaseTables`), as it does for grids. **Replace reference planes** replaces the planes of the main grid system and leaves other grid systems' planes alone. With it ticked, **Verify** also compares them.
- Supports: the push option (Fixed / Pinned / None) restrains the bottom joint of every column at the base elevation on each push; None leaves joint restraints untouched.
- Sections created in the app are created in ETABS (rectangular, circular and slab). Sections imported from ETABS are left as they are.
- ETABS only allows story replacement (`SetStories_2`) on a model with no objects. Otherwise, import the stories from ETABS first.
- Loads:
  - **Patterns.** Each app pattern is created with `LoadPatterns.Add`, which also creates its linear static case. Its type and self-weight are kept up to date. Patterns are never deleted in ETABS.
  - **Frame loads** use `FrameObj.SetLoadDistributed` / `SetLoadPoint`.
  - **Slab loads** use `AreaObj.SetLoadUniform`.
  - **Joint loads** use `PointObj.SetLoadForce` on the ETABS joint at the node's position (story level).
  - **Units.** The app works in kN, kN/m, kN/m² and kN·m. They are sent in kN‑mm, so 10 kN/m arrives as 0.01 kN/mm.
  - **Re-pushing.** The bridge reads every load in the app's patterns with the `"All"` group and rewrites only the objects whose loads differ. Loads in patterns the app doesn't define, and loads on objects it doesn't own, are left alone. A joint load removed in the app is cleared at its joint on the next push.
  - **Distributing slab loads to beams.** ETABS 22 does not support one-way or two-way distribution to beams as a load (`AreaObj.SetLoadUniformToFrame` returns -100). Slabs pass loads to their beams through their section's modelling, e.g. a membrane slab.

The project autosaves in the browser (IndexedDB). **Save** downloads a `.emc.json` file.

## Deploy

`.github/workflows/pages.yml` runs the tests and builds `web/` on every push to `main`. In the repository settings, set Pages → Source to "GitHub Actions".
