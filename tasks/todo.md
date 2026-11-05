# Todo: Stair Design sub-program

See `tasks/plan.md` for the design decisions behind each task.

All commands run in `web/`:
- tests: `npm test`
- build: `npm run build`
- dev server: `npm run dev`

## Phase 1: Foundation

### T1: Types and engine port (M)
Depends on: none.
- [x] Add `Flight`, `Landing`, `Span`, `StairParams`, `StairRegion` and `Model.stairs` (default `[]`) to `model/types.ts`
- [x] Port `stair/stair.ts`, `stair/drawings.ts` and their tests, rewired to `StairModel` and without `template`
- [x] An old `.emc.json` that has no `stairs` loads as `[]`
- [x] `toPayload` output is unchanged by a model with stairs (test)
- Verify: `npm test`, `npm run build`

### T2: `stairContext` (S)
Depends on: T1.
- [x] Columns inside the box (1 mm tolerance) are kept
- [x] Beams crossing the box are kept whole
- [x] Grids are clipped to the box
- [x] Stories run from the base up to the highest story with elements in the box
- [x] Ref planes up to the top level are kept and slabs are removed
- [x] Tests cover an edge column, a crossing beam, a box with nothing above story 3, and slabs removed

### Checkpoint A
- [x] All tests pass and the build is clean
- [x] Existing EMC behaviour is unchanged

## Phase 2: Regions and stair mode

### T3: Stair region tool (M)
Depends on: T1.
- [x] Drag a rectangle on the plan, then name it (defaults to the next `STAIR-NN`)
- [x] Regions show as dashed, labelled rectangles in the main plan
- [x] Left panel has a Stairs list with open, rename and delete

### T4: Stair mode (M)
Depends on: T2, T3.
- [x] `activeStair` routes `visibleModel` and `planModel` through `stairContext`
- [x] A banner shows the stair, with a "Back to model" button
- [x] The story stepper and the tool set are limited to the stair
- [x] One edit guard lets only stair entities be edited, so main beams can be selected but not changed
- [x] The view fits to the box on entry

### Checkpoint B
- [x] STAIR-01 and STAIR-02 each show only their box's grids, columns, beams and ref planes, with no slabs, up to the right story
- [x] The main model is read-only inside a stair
- [x] "Back to model" restores the normal view

## Phase 3: Drawing stairs

### T5: Plan stair tools (M)
Depends on: T4.
- [x] Flight, landing and span tools
- [x] `StairLayer`, grips and snaps
- [x] All edits go through `commitStair`

### T6: Elevation (M)
Depends on: T4.
- [x] `ElevStair` renders in elevation
- [x] Flight and landing elevation tools
- [x] Only grids that cross the box are offered

### T7: 3D (S)
Depends on: T4.
- [x] Flight and landing solids
- [ ] Beam-load display, shown only in stair mode (moved to Phase 5)

### Checkpoint C
- [x] A dog-leg stair can be drawn, and looks right in plan, elevation and 3D
- [x] Undo works across stair edits
- [x] Save, reopen and autosave keep the stair

## Phase 4: Design outputs

### T8: Stair menu (M)
Depends on: T5.
- [x] Restore the `resultsHtml` figure-count test in `stair/drawings.test.ts`
- [x] Design parameters, auto spans, results (IS 456), report, CSV, default waist and suggested waist, scoped to the active stair

### Checkpoint D
- [ ] Results match the old Stair Design app for the same geometry
- [x] The ETABS push contains no stair geometry
- [x] The plan PDF has no landings

## Phase 5: Pushing stair loads to the main model

### T9: Load transfer engine (S)
Depends on: T1, T2.
- [x] `stairLoadRows`, with `d1` and `d2` measured from the beam's `x1, y1`
- [x] `applyStairLoads` replaces the loads that carry this stair's `src` and leaves every other load alone
- [x] Tests cover a flipped beam, a part-length segment, re-push giving the same result, an override, other loads untouched, and `src` not reaching the ETABS payload

### T10: Push dialog (M)
Depends on: T8, T9.
- [x] Editable DL and LL value for each beam segment
- [x] Pattern pickers, remembered per stair
- [x] The push is one commit and is logged
- [x] Deleting a stair offers to remove its pushed loads

### T11: Multi-select overrides (S)
Depends on: T10.
- [x] "Set stair loads…" for beams selected in the 3D wireframe or the plan (selection set from the store in the browser check; a real 3D click is not tested)
- [x] Clearing an override returns the beam to its calculated value
- [x] Overridden beams are marked

### Checkpoint E
- [x] Pushed loads land on the exact segments, under the chosen patterns
- [x] Re-pushing replaces the loads instead of doubling them
- [x] Other stairs' loads are untouched
- [x] The ETABS payload includes the pushed loads
