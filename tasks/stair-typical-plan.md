# Plan: Typical story ranges in stair design

## Overview
A stair box (STAIR-01) gets a list of **typical ranges**, e.g. Ground→First, First→Third, Third→Terrace. You design each range once, on its first storey only (From level to the next level). The DXF underlay is the From level's plan. Results and beam numbers are per range, with numbering starting at B1 each time. Pushing loads copies the range's beam loads onto the matching beam on every storey the range repeats over.

## Architecture decisions
1. **Data:** `StairRegion.typicals?: { id, from, to }[]`, where `from` and `to` are level names (story names, plus `'Base'`). Missing or empty means **All stories same**, one range from the base to the top. Older `.emc.json` files load unchanged.
   - Flights, landings and spans stay where they are (absolute z, in the region). A range's design takes the elements whose story is its first storey. Nothing gets copied per range.
2. **Active range:** the store gets `activeRange: string | null`. Entering a stair selects the first range. Selecting a range sets `activeStory` to the storey above `from`.
3. **Context per range:** `stairContext(m, r, range)` keeps only the beams between z(from) and z(from+1). Columns, grids and elevations stay as they are now. `beamName` ranks `m.beams` of that context, so B1… restarts per range with no change to `beamName` itself.
4. **Underlay:** in stair mode, the underlay story is the story at the range's `from` level, and the lowest storey keeps its own. This replaces the `underlayBelow` toggle; see the open question about removing it.
5. **Push:** rows from the range's context are copied to each repeated storey k = 1…n−1. Each copy goes onto the beam on story+k with the same plan coordinates (±TOL). A missing match goes in a warning list and that copy is skipped. Loads carry `src: "<stairId>#<rangeId>"`, so pushing one range never wipes another. `hasStairLoads` and stair deletion match on the `<stairId>` prefix.
6. **Results modal:** a range dropdown, defaulting to the active range. The report, CSV and print cover the selected range.

## Tasks

### Task 1: Range data and helpers (S)
- `types.ts`: add `typicals?` to `StairRegion`.
- New `stair/ranges.ts`: `rangesOf(m, r)` returns the default range when `typicals` is empty; `rangeLevels(m, range)` gives the first storey, its z band and the repeat count; `validateRanges` flags from ≥ to and overlaps.
- **Accept:** the default range covers base→top, overlap is flagged, and a test sits in `stair/ranges.test.ts`.
- **Verify:** `npm test`.

### Task 2: Left panel range editor (M) — depends on 1
- `StairSide.tsx`: an **All stories same** radio, or **Typical ranges** with **+ Add**. Each row has From and To story selects and ✕. Clicking a row selects it as the range to design.
- `store.ts`: `activeRange`, `setActiveRange`, and range edits through the normal model setter so undo works.
- **Accept:** ranges persist across save/load, and selecting one jumps to its first storey.

### Task 3: Per-range context and numbering (S) — depends on 1, 2
- `context.ts`: `stairContext` takes the range and filters beams to the z band. Flights and landings are filtered to the first storey.
- `viewModel` passes `activeRange`.
- **Accept:** for First→Third, only beams at the First and Second levels (and mid-landing beams) show up, and numbering starts at B1. A test goes in `context.test.ts`.

### Checkpoint A: design one range end-to-end; tests and build pass.

### Task 4: Underlay follows the range (S) — depends on 2
- `underlay/store.ts`: `underlayStory` gives the range's `from` story in stair mode, and the active story otherwise.
- Keep the **Underlay below** toggle for the main model (drawing beams/slabs between levels); hide it inside a stair, where the underlay is always the From level.
- **Accept:** First→Third shows the First floor DXF, and Ground→First shows the Ground DXF.

### Task 5: Push copies over repeated storeys (M) — depends on 3
- `push.ts`: `repeatRows(m, rows, range)` maps each row onto the beam at the same plan position on story+k, and collects the misses.
- `applyStairLoads` takes `src` with the range id. `hasStairLoads` and `deleteStair` match on the prefix.
- `StairPanel` push dialog: the push button shows "× n storeys", and the misses are listed.
- **Accept:** pushing First→Third puts the same loads on the First and Second storey beams. A test goes in `push.test.ts`.

  - Shared floor beams: copy k puts the design storey's **bottom-level rows** on level from+k and its **top-level rows** on level from+k+1. An intermediate floor beam therefore gets the arriving flight (from copy k−1) and the departing flight (from copy k) as separate FrameLoads that add up. At a range boundary, the two ranges' loads sit side by side under different `src` tags.
  - **Accept (test):** for G→First and First→Third, the First-level beam carries the arriving-flight load from G→First plus the departing-flight load from First→Third. Second carries arrival + departure from the same range. Third carries only the arrival. Nothing is counted twice.
- Floor-level landings (z exactly on a level) belong to the storey whose **top** they are (as the app already places them), so a range's copies own levels from+1…to and the level `from` landing comes from the range below — each counted once. (Implemented in Task 3.)

### Task 6: Results modal range dropdown (S) — depends on 3
- `StairResultsDialog`: a range `<select>`. `resultsHtml`, CSV and print use the selected range's context.
- Beams at floor levels shared between storeys get a **Combined at level** table. It sums the rows of this range's bottom-level and top-level beams at the same plan position, plus the neighbouring range's rows at a range boundary, and notes "+ departing flight of First→Third (STAIR-01)".
- **Accept:** switching the range swaps the report, and each report starts at B1. A shared beam's combined DL/LL equals the sum of what gets pushed onto it.

### Checkpoint B: all tests pass and the build is clean. Run a manual check with 3 ranges on a sample model, push, then verify the beam loads in the main model.

## Risks
| Risk | Impact | Mitigation |
|---|---|---|
| Existing stairs drawn on every storey: under "All same", only the first storey is designed | Med | A warning lists flights outside every range's first storey |
| Beams on repeated storeys not at identical coordinates | Med | Plan-position match with TOL; misses are listed in the push dialog |
| Old pushed loads with `src = stairId` (no range) | Low | Prefix match clears them on the next push |

## Open questions
1. Remove **Underlay below** entirely? Its tooltip also mentions drawing reference planes in the main model. It is uncommitted, so it has never shipped either way.
2. Results selection: is a dropdown in the modal, defaulting to the range you are designing, enough? Or do you also want the "All" tick in the left panel?
3. Should a range's To level be inclusive, so First→Third repeats 2 storeys (First→Second, Second→Third)?
