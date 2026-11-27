# Implementation Plan: Checking mode (drawing check tracker)

## Overview
You check the draftsman's drawings by hand. While you do, a **Checking** mode in the app lets you click a column, beam or slab to mark it checked. A checked element shows a tick and a green tint. Turn the mode off and the normal UI comes back with no marks. The checked state lives in the model, so autosave keeps it and Save writes it to the `.emc.json` file.

## Architecture Decisions
- **Stored in the model as `checked?: string[]`** (element ids) in `web/src/model/types.ts`. Optional, so older files load without changes. Autosave (`persist.ts`, which saves on `dirty`) and the project JSON (`projectBlob` writes `model`) then pick it up with no new persistence code.
- **Element ids are per story and stable** (each Column/Beam/Slab has its own `id` and `story`), so an id set is enough. Ids of deleted elements stay in the list without harm. Counts filter against the elements that still exist.
- **One intercept point: `setSelection` in `store.ts`.** When `checking` is on, `setSelection(ids)` doesn't select anything. It commits a toggle into `model.checked`: if every id is already checked they are unchecked, otherwise they are all checked. Plan, elevation and 3D picks already go through `setSelection`, so a click toggles one element and a box-drag marks a whole group, with no changes in the view code.
- **Edits are safe in checking mode by construction.** The selection stays empty, so grips, move and Delete have nothing to act on. Turning the mode on also sets `tool: 'select'`.
- **Undo works.** Checks go through `commit`, so Ctrl+Z undoes a mis-click.
- **Marks render only when `checking` is on.** Each view reads `checked` plus the flag and draws a tick or tint. The normal colours are untouched when the mode is off.

## Task List

### Phase 1: Foundation (data + toggle)
#### ✅ Task 1: `checked` field, `checking` flag, setSelection intercept
**Description:** Add `checked?: string[]` to `Model`. Add `checking: boolean` and `toggleChecking()` to the store; turning it on clears the selection and sets the select tool. In `setSelection`, when `checking` is on, commit the toggle rule above instead of selecting. Block the toggle inside stair mode, where `commit` already refuses.
**Acceptance criteria:**
- [ ] With checking on, `setSelection(['c1'])` adds `c1` to `model.checked` and leaves `selection` empty. Calling it again removes `c1`.
- [ ] `setSelection(['c1','c2'])` with only `c1` checked ends with both checked.
- [ ] Undo restores the previous `checked`.
**Verification:** a new case in `model/store.test.ts`; `npm test`; `npm run build`.
**Dependencies:** None. **Files:** `model/types.ts`, `model/store.ts`, `model/store.test.ts`. **Scope:** S

#### ✅ Task 2: Menu toggle + shortcut
**Description:** Add a "Checking mode" checked item to the View menu in `MenuBar.tsx`, the same way "Lock grids" is done, plus a shortcut key (K) wherever App handles keys. Show a banner such as "CHECKING: click to mark" in the plan story banner while it is on.
**Acceptance criteria:**
- [ ] The menu item and shortcut flip the mode, and the item shows its checked state.
- [ ] A banner is visible while the mode is on.
**Verification:** manual check in the browser preview. **Dependencies:** 1. **Files:** `ui/MenuBar.tsx`, `App.tsx`, `plan/PlanView.tsx`. **Scope:** S

### Checkpoint A
- [ ] Tests and build pass. A checked id survives a reload (autosave) and appears in a saved `.emc.json`.

### Phase 2: Show the marks (one view per task)
#### ✅ Task 3: Plan view marks
**Description:** Add a `CheckedLayer` in `plan/layers.tsx`, rendered only while checking is on. It draws a green tint and a ✓ at each checked column's centre, beam's midpoint and slab's centroid on the active story.
**Acceptance criteria:**
- [ ] Clicking an element in plan adds or removes its mark straight away.
- [ ] With the mode off, the plan looks exactly as it does today.
**Verification:** a preview screenshot with the mode on and off. **Dependencies:** 1, 2. **Files:** `plan/layers.tsx`, `plan/PlanView.tsx`. **Scope:** S

#### ✅ Task 4: Elevation view marks
**Description:** In `ElevView.tsx` the colour helper (`sel.has(id) ? 'var(--sel)'`) gets a third case: checked and in checking mode gives a `--checked` colour. Add the `--checked` token to `styles.css`.
**Acceptance criteria:** [ ] Columns and beams clicked in elevation toggle and show the checked colour, and only while the mode is on.
**Verification:** preview. **Dependencies:** 1. **Files:** `elev/ElevView.tsx`, `styles.css`. **Scope:** S

#### ~~Task 5: 3D view marks~~ — dropped (plan + elevation are enough)
**Description:** Where `sel.has(id) ? selMat : …` appears in `View3D.tsx`, add a `checkedMat` branch for the checking mode.
**Acceptance criteria:** [ ] Checked elements show green in 3D, and only while the mode is on.
**Verification:** preview. **Dependencies:** 1. **Files:** `view3d/View3D.tsx`. **Scope:** S

### Checkpoint B
- [ ] Marks show in every view you use. Turning the mode off gives back the normal UI in all of them.

### Phase 3: Tracking
#### ✅ Task 6: Progress counts + Clear
**Description:** While checking is on, the right panel shows "Columns 12/40 · Beams 30/96 · Slabs 4/18" for the active story and for the whole model. Counts only include elements that still exist. A "Clear checks…" button (with a confirm) empties `checked`, for when a revised drawing set comes in.
**Acceptance criteria:**
- [ ] The counts update on every click and ignore ids of deleted elements.
- [ ] Clear asks first, then empties the list, and can be undone.
**Verification:** a unit test for the count helper; manual check of Clear. **Dependencies:** 1. **Files:** `ui/RightPanel.tsx`, a small helper in `model/`. **Scope:** S

### Checkpoint: Complete
- [ ] All acceptance criteria met. Round trip works: check some elements, Save, reload, Open, and the marks are still there.

## Risks and Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| A pick path bypasses `setSelection`, for example a direct `set({selection})` | Med | Grep `selection:` writes in Task 1 and route the click paths through the intercept |
| `sessionLog` diffs the model and may log every check, or choke on the new field | Low | Check `log/sessionLog.ts` in Task 1; add one short "checked X" line or skip the field |
| Each click is a commit, so checks fill the undo history (HISTORY cap) | Low | This is acceptable because undoing a mis-click is useful. Revisit only if it gets annoying |
| "Similar" stories copy elements with new ids, so checking Story2 doesn't check Story3 | Low | This matches the per-story drawings. Noted as an open question |

## Decisions (answered 2026-11-27)
- An edited checked element (anything but its loads) or a deleted one loses its check. This is done in `dropEditedChecks`, called from `commit` (Phase 1).
- No marks in 3D. Task 5 is dropped.
- No marks in the exported plan PDF.
- Picking a drawing tool or entering a stair turns Checking mode off.

## Status
- Phase 3 is done: a Checking section in the right panel (this story / all stories) and Clear checks… (confirm, undoable). All phases are complete.
- Phase 2 is done: plan tint and ✓, and the elevation checked colour (`--checked`, blue, so it can't be mistaken for the green selection). Checked in the preview, including mode off.
- Phase 1 is done. Tests, build and Checkpoint A pass (autosave and reload were checked in the preview).
