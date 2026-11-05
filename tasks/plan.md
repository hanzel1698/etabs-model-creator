# Plan: Stair Design as a sub-program of ETABS Model Creator

## Context
Stair Design (`E:\Created Programs\Stair Design`) is a fork of ETABS Model Creator. Its `stair/` engine, `StairPanel.tsx` and `StairLayer.tsx` are new; everything else is a drifted copy. Because it is a separate app, you redraw stories, ref planes, grids, columns and beams for every stair.

The goal is to move the stair engine into ETABS Model Creator (EMC):
- You drag a rectangle on any plan and name it STAIR-01, STAIR-02, and so on.
- Opening a stair shows the main model's grids, columns, beams and ref planes inside that rectangle, read-only. The view runs from the base up to the highest story that has elements inside the box, and has no slabs.
- Inside a stair you draw flights, landings and spans and run the IS 456 design.
- Stair geometry (landings, flights, spans) is saved in the project but never reaches ETABS, the plan PDF or the model checks.
- The stair's dead and live beam reactions are the one thing that crosses over. You push them, with values you can edit or override for several beams at once, onto the main model's beams. They land on the exact full or part lengths and under the patterns you choose, and from there go to ETABS like any other beam load.

Your answers:
- **No stair-only beams.** Supports come only from main-model beams.
- **Start fresh.** No `.sd.json` importer; the old app stays as it is.

## Architecture decisions
1. **Stair data lives in the main `Model` as `stairs: StairRegion[]`.**
   - Shape: `{ id, name, x1, y1, x2, y2, flights, landings, spans, params: StairParams }`.
   - Default `[]` in `emptyModel()`. Older `.emc.json` files load through the existing shallow merge.
   - Undo/redo, autosave and Save/Open then work for stairs with no new code.
2. **ETABS export stays as it is.** `toPayload` in `etabs/mapping.ts` already reads only named arrays (columns, beams, slabs, …), and `sheets.ts` and `checks.ts` do the same, so stairs are left out by construction. A test locks this in.
3. **The ported engine runs on a derived view model.** `stairContext(model, region)` is a pure function in `stair/context.ts`. It returns a Model-shaped `StairModel = Model & { flights, landings, spans, stair }` that contains:
   - columns whose centre is inside the box (1 mm tolerance)
   - beams that cross the box, kept **whole**. Load positions are measured along the real beam, so a clipped beam would put pushed loads in the wrong place. The views clip beams to the box only when drawing them.
   - grids that cross the box, clipped to it
   - all ref planes up to the top level
   - the stories from the base up to the highest story with a column or beam in the box
   - `slabs: []`
   - the region's flights, landings and spans, with `stair: region.params`

   Because of this, `stair/stair.ts` and `drawings.ts` port almost word for word, and only their imports change.
4. **Stair mode is one store field, `activeStair: string | null`.** When it is set:
   - `visibleModel` / `planModel` return the stair context.
   - The story stepper only offers the region's stories.
   - Main drawing tools are disabled and the stair tools (flight, landing, span) are enabled.
   - Main beams can still be selected (plan, and 3D wireframe click / Ctrl+click), so you can assign stair loads to them. Every editing path (delete, move, copy, properties in RightPanel, the main tools) goes through one guard that lets only stair entities through, and that guard is what makes the main model read-only. Snapping to columns and beams still works.
   - A banner "Stair: STAIR-01 · Back to model" exits the mode.
5. **Stair edits go through `commitStair(fn)`**, which wraps the existing `commit()` and replaces the active region. The F/L/S renumbering from the Stair app's `commit` moves in here.
6. **Rendering is added to EMC's current views; the Stair app's views are not copied.** `StairLayer` goes into `PlanView`, `ElevStair` into `elevation.ts` and `ElevView`, and the flight/landing solids into `View3D`. All of it is drawn only in stair mode. EMC's views are newer (elevation drawing, ref-plane naming), so copying the forked views back would lose that work.
7. **Stair loads go to the main model as ordinary `FrameLoad`s, tagged with their stair.**
   - `FrameLoad` gets an optional `src?: string`, holding the stair region id.
   - A push first removes every load whose `src` is this stair, then adds the new ones. Pushing again therefore replaces the old loads instead of piling up, and Ctrl+Z undoes a push.
   - Each pushed load is a Gravity `dist` load with absolute distances, on the dead or live pattern you pick.
   - The engine's `BeamLoadRow.a/b` are measured from the beam's left (or bottom) end (`beamFlipped`). They are converted to `d1/d2` measured from the beam's `x1,y1`, so a load lands on exactly the part of the beam the stair calculated.
   - Once pushed they are normal main-model loads, so they go to ETABS with the next push, under the same patterns.
8. **Load overrides are stored on the region.**
   - Shape: `overrides: Record<beamId, { dl?: number; ll?: number }>` in kN/m.
   - You set them by multi-selecting beams (3D wireframe or plan) and choosing "Set stair loads…".
   - An override replaces the calculated value on that beam's calculated segments and keeps their extents. A selected beam that has no calculated segment is skipped, with a warning.
   - The push dialog also lets you edit each row's DL and LL before pushing, and those edits are saved as overrides.
9. **Dropped from the port:**
   - `template()` is not offered in the UI, because it creates beams, grids and columns and so conflicts with "main model only". It stays in `stair.ts` because the ported tests build their fixtures with it.
   - Beam `dz2` (cranked beams).
   - The Stair app's split elev+3d layout.
   - The Excel builder, which stays in the old repo.

## Task list
Tests: `npm test` (vitest) · build: `npm run build` · dev: `npm run dev` (5173). All run in `web/`.

### Phase 1: Foundation
- [ ] **T1: Types and engine port (M).**
  - Add `Flight`, `Landing`, `Span`, `StairParams`, `StairRegion` and `Model.stairs` to `model/types.ts`. Add `beamEndsZ` if it is missing.
  - Copy `stair/stair.ts`, `drawings.ts` and their tests, rewired to `StairModel`, without `template`.
  - Acceptance: the ported stair tests pass; an old `.emc.json` with no `stairs` loads as `[]`; `toPayload` output is unchanged by a model that has stairs (new test in `etabs/mapping.test.ts`).
  - Files: `model/types.ts`, `stair/*`, `etabs/mapping.test.ts`.
- [ ] **T2: `stairContext` (S).**
  - Write the pure clip, story-range and no-slab function in `stair/context.ts`, with tests: a column on the box edge, a beam crossing the box, a box with nothing above story 3, and slabs removed.
  - Files: `stair/context.ts`, `stair/context.test.ts`.

**Checkpoint A:** tests pass, build is clean, and the existing EMC behaviour is unchanged.

### Phase 2: Regions and stair mode
- [ ] **T3: Stair region tool (M).**
  - Add a `stairRegion` plan tool: drag a rectangle, then a name dialog that defaults to the next free `STAIR-NN`.
  - Draw regions as dashed labelled rectangles in the main plan.
  - Add a Stairs list in `LeftPanel` with open, rename and delete.
  - Files: `store.ts` (ToolName), `plan/tools.ts`, `plan/layers.tsx`, `ui/LeftPanel.tsx`, `ui/MenuBar.tsx`.
- [ ] **T4: Stair mode (M).**
  - Add `activeStair` with enter/exit, the banner, and routing of `visibleModel`/`planModel` through `stairContext`.
  - Limit the story stepper and the tool set, restrict hit-testing to stair entities, and fit to the box on entry.
  - Clear the selection on entering and leaving.
  - Files: `store.ts`, `App.tsx`, `plan/tools.ts`, `plan/PlanView.tsx`.

**Checkpoint B:** create STAIR-01 and STAIR-02 and open each one. Plan, elevation and 3D show only that box's grids, columns, beams and ref planes, with no slabs, up to the right story. Main elements cannot be selected or deleted. Back to model returns to normal.

### Phase 3: Drawing stairs
- [ ] **T5: Plan stair tools (M).**
  - Port the flight, landing and span tools, `StairLayer`, the grips (`flightGrips`, `reshapeFlight`, `reshapeLanding`, `spanGrips`) and the corner/midpoint snaps.
  - All of them write through `commitStair`.
  - Files: `plan/tools.ts`, `plan/StairLayer.tsx`, `plan/snap.ts`, `plan/PlanView.tsx`.
- [ ] **T6: Elevation (M).**
  - Port `ElevStair` into `elevation.ts`, render it in `ElevView`, and add the flight and landing elevation tools (`flightOnGrid`, `landingOnGrid`).
  - Only grids that cross the box are offered.
  - Files: `elev/elevation.ts`, `elev/ElevView.tsx`, `elev/elevation.test.ts`.
- [ ] **T7: 3D (S).**
  - Port the stepped flight solids, the landing slabs and the beam-load display into `View3D`, drawn only in stair mode.
  - Files: `view3d/View3D.tsx`.

**Checkpoint C:** a dog-leg stair can be drawn in STAIR-01 in plan and elevation and looks right in 3D. Undo works across stair edits. Save, reopen and autosave keep it.

### Phase 4: Design outputs
- [ ] **T8: Stair menu (M).**
  - Port `StairPanel.tsx`: Design parameters, Auto spans, Results (IS 456), print report, beam loads CSV, "apply default waist to all", and the suggested waist.
  - The menu is shown only in stair mode and is scoped to the active region.
  - Files: `ui/StairPanel.tsx`, `ui/MenuBar.tsx`, `ui/Dialogs.tsx`.

**Checkpoint D:** the results for a test stair match what the old Stair Design app gives for the same geometry. A push to ETABS sends no stair objects and the plan PDF has no landings.

### Phase 5: Pushing stair loads to the main model
- [ ] **T9: Load transfer engine (S).** This is pure logic in `stair/push.ts`.
  - `stairLoadRows(ctx, overrides)` returns `{ beamId, d1, d2, dl, ll, calc: {dl, ll} }[]`, measured from each beam's `x1,y1`.
  - `applyStairLoads(model, stairId, rows, dlPattern, llPattern)` removes the old loads with that `src` and adds the new ones. It never touches loads that have a different `src` or none.
  - Tests: a flipped beam, a part-length segment, re-pushing gives the same result, an override replaces the value but keeps the extent, other loads stay as they are, and `toPayload` sends the pushed loads without a `src` field.
  - Files: `stair/push.ts`, `stair/push.test.ts`, `model/types.ts` (`FrameLoad.src`), and `etabs/mapping.ts` if it copies load objects whole.
- [ ] **T10: Push dialog (M).**
  - Add "Stair › Push loads to model…", which shows one editable row per beam segment: beam, from–to (mm), DL, LL, and the calculated value next to each edit.
  - Add dead and live pattern pickers from `model.loadPatterns`, remembered on the region.
  - The Push button applies the loads in one commit and writes a log entry.
  - Deleting a stair asks whether to remove its pushed loads as well.
  - Files: `ui/StairPanel.tsx`, `ui/Dialogs.tsx`, `ui/MenuBar.tsx`, `ui/LeftPanel.tsx`.
- [ ] **T11: Multi-select overrides (S).**
  - In stair mode, selecting beams in 3D wireframe or plan enables "Set stair loads…": DL and LL fields, where blank means use the calculated value, plus Clear.
  - Overridden beams are marked in the 3D and plan load labels.
  - Files: `view3d/View3D.tsx`, `ui/StairPanel.tsx`, `ui/RightPanel.tsx`.

**Checkpoint E:**
- Push STAIR-01's loads, then leave stair mode: its support beams carry DL and LL loads on exactly the calculated segments, under the chosen patterns.
- Override one beam in 3D, push again: the loads are replaced, not doubled.
- STAIR-02's loads are untouched.
- The ETABS push payload includes these loads.

## Risks
| Risk | Impact | Mitigation |
|---|---|---|
| `ElevView` and `View3D` diverged heavily (300+ diff lines) | High | Port only the stair-specific pieces into EMC's current views, never whole files |
| A span support beam is clipped at the box edge | Med | Clip only for display, and keep beams that cross the box whole in `stairContext` if the T2 tests show the support search needs them |
| Hand-porting breaks the stair engine | Med | Bring its 137 tests across in T1 before touching any UI |
| Main tools act on the main model while in stair mode | Med | Gate tools centrally in `setTool`, and send every edit through one stair-entity guard |
| Pushed loads go stale after the stair geometry changes | Med | The push dialog marks rows whose calculated value differs from what was last pushed. There is no automatic re-push |
| Importing from ETABS reads beam loads back without their `src` tag, so a later re-push would double them | Med | In T10, match an untagged load that is identical to a stair row and treat it as that stair's load, or warn before pushing |
| A main beam is split or deleted after a push | Low | Loads stay with the beam id. Re-pushing clears them by `src` and recalculates |

## Verification
- `npm test` and `npm run build` pass at every checkpoint.
- Run `npm run dev` and check each checkpoint's scenario in the browser preview.
- Check the ETABS push with `toPayload` unit tests, not a live ETABS push.

## First step after approval
Write this plan to `tasks/plan.md` and the checklist to `tasks/todo.md` in the repo, then start T1. `store.ts` has uncommitted edits, which will be left alone.
