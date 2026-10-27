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
3. **Columns** (C): click a point (snaps to intersections), or drag a window to fill every intersection inside it.
4. **Beams** (B): chained drawing that snaps to columns, faces, ends, midpoints, perpendiculars and underlay vertices. Type `dx,dy`, `@dist<angle` or a length, relative to the last point (or the last snap point you hovered). **Offset beam** (O): pick a grid or beam, then type a distance or click a side. **Beams on grids** places beams between consecutive columns along every grid.
5. **Slabs**: **Slab (bay)** (S) fills the closed bay you click. **Draw slab** (P) lets you draw a polygon.
6. **Measure**: distance (M, chainable), angle (A), area (R).
7. **Select** (V): a left-to-right window selects what's fully inside; right-to-left selects anything crossing. **Replicate** (E) copies linearly by dx/dy or onto other stories (tick boxes or a range such as `3-10`). **Move…** and Del are also available.
8. Ticking stories in the left panel draws on all of them at once.
9. The view controls rotate the plan (the model itself is unchanged), show the story below as a ghost, toggle section labels, colour by section, and set text size. **Split** or **3D** opens the three.js view.
10. **ETABS…**:
    - **Import** reads stories, grids, materials, frame sections and slab sections.
    - **Push** sends sections, grids, stories (optional) and elements.
    - **Verify** reads everything back and compares it with the app.

## How the app maps to ETABS

- Units: the app works in mm. The bridge switches ETABS to kN-mm-C while it works and then restores your units.
- A column on story S runs from the elevation of the story below up to S. Beams and slabs sit at S's elevation. A column's angle becomes its local axis rotation.
- Each element keeps a GUID that is written to the ETABS object (`SetGUID`). Pushing again does the following:
  - an unchanged object is left alone;
  - a changed section or angle is updated in place;
  - changed geometry means the object is deleted and re-added;
  - an element deleted in the app is deleted in ETABS.
- Objects you drew directly in ETABS are never touched.
- Supports: the push option (Fixed / Pinned / None) restrains the bottom joint of every column at the base elevation on each push; None leaves joint restraints untouched.
- Sections created in the app are created in ETABS (rectangular, circular and slab). Sections imported from ETABS are left as they are.
- ETABS only allows story replacement (`SetStories_2`) on a model with no objects. Otherwise, import the stories from ETABS first.

The project autosaves in the browser (IndexedDB). **Save** downloads a `.emc.json` file.

## Deploy

`.github/workflows/pages.yml` runs the tests and builds `web/` on every push to `main`. In the repository settings, set Pages → Source to "GitHub Actions".
