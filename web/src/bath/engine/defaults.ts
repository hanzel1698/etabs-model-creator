/**
 * Starting models.
 *
 * `exampleModel` is what a fresh session (or Reset) actually shows: a plain
 * 3x3 grid, 3000mm bays both ways, labelled 1/2/3 and A/B/C -- the same
 * numbers shown in the grid-definition popup's own example, so opening it
 * for the first time matches what is already on screen.
 *
 * `realBathroomModel` is the original worked example this tool was built
 * around (grid 13/13'/14 by D/D'/E, matching a real bathroom section
 * drawing). It is kept for tests that need those specific real-world
 * dimensions to exercise particular geometry -- an oblique cut clearing a
 * column corner, a section running along a beam -- so that changing the
 * app's own default grid does not silently invalidate what those tests are
 * actually checking.
 */

import type { PlanModel } from './types';

/**
 * A fresh id.
 *
 * The counter alone is not enough, and the failure it caused was not cosmetic.
 * It is module state, so it restarts at zero on every page load, while the plan
 * it numbers comes BACK from localStorage or a .json file with its own ids
 * intact. Everything drawn after a reload was therefore handed ids the plan was
 * already using. Ids are how this model attaches things -- an `onBeam` anchor
 * names its host beam by id -- so a collision silently re-points a beam's end
 * at a different beam somewhere else in the plan, and the beam it collided with
 * disappears from every id-keyed map that resolves the drawing.
 *
 * The session token is what makes ids unique across loads. The counter is kept
 * because it keeps them readable and stably ordered within one session, which
 * matters when reading a saved file by hand.
 */
const session = Math.random().toString(36).slice(2, 8);
let counter = 0;
export function uid(prefix: string): string {
  counter += 1;
  return `${prefix}${session}-${counter}`;
}

export const emptyModel = (): PlanModel => ({
  grid: { x: [], y: [] },
  columnTypes: [],
  columns: [],
  beamTypes: [],
  beams: [],
  upstandTypes: [],
  upstands: [],
  slabTypes: [],
  panelAssignments: [],
  sectionLines: [],
  defaultSlabTypeId: '',
});

/** Shared column/beam/slab type schedules — plausible starting sizes, all editable. */
function baseSchedules() {
  return {
    columnTypes: [
      { id: 'ct-C1', label: 'C1', width: 400, depth: 400 },
      { id: 'ct-C2', label: 'C2', width: 400, depth: 500 },
    ],
    beamTypes: [
      { id: 'bt-300x600', label: 'B30X60', width: 300, depth: 600 },
      { id: 'bt-250x500', label: 'B25X50', width: 250, depth: 500 },
      { id: 'bt-250x450', label: 'B25X45', width: 250, depth: 450 },
      { id: 'bt-250x400', label: 'B25X40', width: 250, depth: 400 },
      { id: 'bt-250x300', label: 'B25X30', width: 250, depth: 300 },
    ],
    slabTypes: [
      { id: 'st-TS1', label: 'TS1', thickness: 150, sink: 0 },
      { id: 'st-TS2', label: 'TS2', thickness: 150, sink: 300 },
    ],
    upstandTypes: [{ id: 'ut-150', label: 'U1', depth: 150 }],
  };
}

export function exampleModel(): PlanModel {
  const primary = (a: string, b: string) => ({
    id: uid('bm'),
    typeId: 'bt-300x600',
    start: { kind: 'column' as const, columnId: a },
    end: { kind: 'column' as const, columnId: b },
    kind: 'primary' as const,
  });

  return {
    grid: {
      // Column grid lines, left to right.
      x: [
        { id: 'gx1', label: '1', spacingFromPrev: 0 },
        { id: 'gx2', label: '2', spacingFromPrev: 3000 },
        { id: 'gx3', label: '3', spacingFromPrev: 3000 },
      ],
      // Row grid lines, bottom to top: gy1 is the bottommost, so it carries
      // the label 'C' -- read top to bottom in the grid table that's A, B, C.
      y: [
        { id: 'gy1', label: 'C', spacingFromPrev: 0 },
        { id: 'gy2', label: 'B', spacingFromPrev: 3000 },
        { id: 'gy3', label: 'A', spacingFromPrev: 3000 },
      ],
    },

    ...baseSchedules(),

    columns: [
      { id: 'col-x1-y1', typeId: 'ct-C2', gx: 'gx1', gy: 'gy1' },
      { id: 'col-x2-y1', typeId: 'ct-C2', gx: 'gx2', gy: 'gy1' },
      { id: 'col-x3-y1', typeId: 'ct-C2', gx: 'gx3', gy: 'gy1' },
      { id: 'col-x1-y3', typeId: 'ct-C1', gx: 'gx1', gy: 'gy3' },
      { id: 'col-x2-y3', typeId: 'ct-C1', gx: 'gx2', gy: 'gy3' },
      { id: 'col-x3-y3', typeId: 'ct-C1', gx: 'gx3', gy: 'gy3' },
    ],

    beams: [
      primary('col-x1-y1', 'col-x2-y1'),
      primary('col-x2-y1', 'col-x3-y1'),
      primary('col-x1-y3', 'col-x2-y3'),
      primary('col-x2-y3', 'col-x3-y3'),
      primary('col-x1-y1', 'col-x1-y3'),
      primary('col-x2-y1', 'col-x2-y3'),
      primary('col-x3-y1', 'col-x3-y3'),
    ],

    upstands: [],
    panelAssignments: [],
    sectionLines: [],
    defaultSlabTypeId: 'st-TS1',
  };
}

/** The original real-world worked example — see the file doc comment. */
export function realBathroomModel(): PlanModel {
  const gx = ['13', "13'", '14'];
  const gy = ['D', "D'", 'E'];

  const primary = (a: string, b: string) => ({
    id: uid('bm'),
    typeId: 'bt-300x600',
    start: { kind: 'column' as const, columnId: `col-${a}` },
    end: { kind: 'column' as const, columnId: `col-${b}` },
    kind: 'primary' as const,
  });

  return {
    grid: {
      x: [
        { id: 'gx-13', label: gx[0]!, spacingFromPrev: 0 },
        { id: 'gx-13p', label: gx[1]!, spacingFromPrev: 3580 },
        { id: 'gx-14', label: gx[2]!, spacingFromPrev: 3250 },
      ],
      y: [
        { id: 'gy-D', label: gy[0]!, spacingFromPrev: 0 },
        { id: 'gy-Dp', label: gy[1]!, spacingFromPrev: 3410 },
        { id: 'gy-E', label: gy[2]!, spacingFromPrev: 3410 },
      ],
    },

    ...baseSchedules(),

    columns: [
      { id: 'col-13-D', typeId: 'ct-C2', gx: 'gx-13', gy: 'gy-D' },
      { id: 'col-13p-D', typeId: 'ct-C2', gx: 'gx-13p', gy: 'gy-D' },
      { id: 'col-14-D', typeId: 'ct-C2', gx: 'gx-14', gy: 'gy-D' },
      { id: 'col-13-E', typeId: 'ct-C1', gx: 'gx-13', gy: 'gy-E' },
      { id: 'col-13p-E', typeId: 'ct-C1', gx: 'gx-13p', gy: 'gy-E' },
      { id: 'col-14-E', typeId: 'ct-C1', gx: 'gx-14', gy: 'gy-E' },
    ],

    beams: [
      primary('13-D', '13p-D'),
      primary('13p-D', '14-D'),
      primary('13-E', '13p-E'),
      primary('13p-E', '14-E'),
      primary('13-D', '13-E'),
      primary('13p-D', '13p-E'),
      primary('14-D', '14-E'),
    ],

    upstands: [],
    panelAssignments: [],
    sectionLines: [],
    defaultSlabTypeId: 'st-TS1',
  };
}
