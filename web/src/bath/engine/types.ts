/**
 * Core data model for the Bathroom Section Designer.
 *
 * Two coordinate spaces, kept strictly separate:
 *
 *  - PLAN space: millimetres, +x to the right, +y UP (drawing convention).
 *    Only the renderer flips y for SVG.
 *  - LEVEL space: millimetres, DOWN-POSITIVE, datum 0.000 = general floor slab
 *    structural concrete top. A sink of 300 is +300. Finishes are not modelled.
 *
 * Everything is anchored by id, never by coordinate, so editing a grid spacing
 * moves the columns, beams and panels that depend on it.
 */

export interface Pt {
  x: number;
  y: number;
}

// ---------------------------------------------------------------- grid

export interface GridLine {
  id: string;
  /** Displayed in the grid bubble: '1', '2', '3' / 'A', 'B', 'C'. */
  label: string;
  /** Centre-to-centre distance from the previous line in the array. Ignored on the first. */
  spacingFromPrev: number;
}

export interface Grid {
  /** Vertical grid lines, ordered left to right. */
  x: GridLine[];
  /**
   * Horizontal grid lines, ordered bottom to top (+y is up) — this is the
   * native storage order every other module assumes (offsets, rendering,
   * face detection, cutting). The grid-definition table reads Y top to
   * bottom instead, which is the reverse of this; that translation is
   * confined to `plan/gridRows.ts` and does not leak out here.
   */
  y: GridLine[];
}

// ---------------------------------------------------------------- columns

export interface ColumnType {
  id: string;
  label: string;
  /** Size along X when unrotated. */
  width: number;
  /** Size along Y when unrotated. */
  depth: number;
}

export interface Column {
  id: string;
  typeId: string;
  /** Grid line ids of the intersection this column sits on. */
  gx: string;
  gy: string;
  /** Swaps width and depth. */
  rotated?: boolean;
}

// ---------------------------------------------------------------- beams

/**
 * A beam section: breadth and depth only.
 *
 * Sink is deliberately NOT part of the type. The same section is routinely cast
 * flush in one place and sunken in another, and putting the sink here forced a
 * duplicate type per level. It lives on the beam instead — see `Beam.topLevel`.
 */
export interface BeamType {
  id: string;
  /** 'B-300x600' */
  label: string;
  /** Breadth in plan. */
  width: number;
  /** Overall depth, measured down from the beam's own top. */
  depth: number;
}

export type Anchor =
  | { kind: 'column'; columnId: string }
  | { kind: 'grid'; gx: string; gy: string }
  /** A parametric point along another beam; t in [0,1] from its start to its end. */
  | { kind: 'onBeam'; beamId: string; t: number }
  | { kind: 'point'; x: number; y: number };

export interface Beam {
  id: string;
  typeId: string;
  start: Anchor;
  end: Anchor;
  kind: 'primary' | 'secondary';
  /**
   * This beam's own sink: the level of its top, down-positive. Absent means
   * flush with the datum, and negative is an upstand. Set per beam, from the
   * plan or the section, because the same section is cast at whatever level
   * the panel beside it needs.
   */
  topLevel?: number;
  /** Overrides the type's depth for this beam only. */
  depthOverride?: number;
}

// ---------------------------------------------------------------- upstands

/**
 * An upstand section: depth only. Width is never stored here — it is always
 * the width of whichever beam the upstand is drawn on, so it cannot drift out
 * of step with the beam beneath it.
 */
export interface UpstandType {
  id: string;
  /** 'U1' */
  label: string;
  /** Height of the nib, measured up from the beam's own top. */
  depth: number;
}

/**
 * A raised nib cast on top of a beam, over part or all of its length. Several
 * can sit on the same beam — a short upstand catching a flush slab locally
 * while the rest of the beam runs plain against a sunken one beside it.
 *
 * `t0`/`t1` use the same parametrisation as the `onBeam` anchor: fractions
 * from the beam's own start to its own end, against its full resolved
 * centreline rather than whatever a T-junction trims the drawing back to, so
 * the upstand stays put if trimming elsewhere changes.
 */
export interface Upstand {
  id: string;
  typeId: string;
  beamId: string;
  t0: number;
  t1: number;
}

// ---------------------------------------------------------------- slabs

export interface SlabType {
  id: string;
  /** 'TS1', 'TS2' */
  label: string;
  thickness: number;
  /** Depth of sink below the datum. 0 for the general floor. */
  sink: number;
}

/**
 * Panels are detected automatically from the beam network, so they have no stable
 * identity across edits. A tag is therefore stored as a seed point: after the faces
 * are recomputed, each face claims the assignment whose seed falls inside it.
 */
export interface PanelAssignment {
  id: string;
  seed: Pt;
  /**
   * Null marks the panel as a DUCT: an opening in the slab rather than a slab of
   * some other type. There is no concrete in it at all, so nothing downstream
   * gives it a thickness, a sink, or a bearing — the cut emits no slab there and
   * the beams around it have no slab on that side to catch.
   */
  slabTypeId: string | null;
}

// ---------------------------------------------------------------- section

export interface SectionLine {
  id: string;
  /** 'A-A' */
  label: string;
  a: Pt;
  b: Pt;
  /**
   * Flips which way the section is viewed. The cut itself always runs a to b;
   * this only mirrors the generated section left-to-right, matching the arrows
   * drawn on the plan so the drawing agrees with what they show.
   */
  reversed?: boolean;
}

export interface PlanModel {
  grid: Grid;
  columnTypes: ColumnType[];
  columns: Column[];
  beamTypes: BeamType[];
  beams: Beam[];
  upstandTypes: UpstandType[];
  upstands: Upstand[];
  slabTypes: SlabType[];
  panelAssignments: PanelAssignment[];
  sectionLines: SectionLine[];
  /** Slab type used for panels the user has not tagged. */
  defaultSlabTypeId: string;
}

// ---------------------------------------------------------------- derived run

/** One slab stretch along the section line. */
export interface RunSlab {
  kind: 'slab';
  d0: number;
  d1: number;
  slabTypeId: string;
  panelId: string | null;
  /** d0 is not the panel's true edge — it was cut mid-span, by the run's own end or by another member. */
  d0Cut?: boolean;
  /** d1 is not the panel's true edge — it was cut mid-span, by the run's own end or by another member. */
  d1Cut?: boolean;
}

/** One beam cut by the section line, across it or along it. */
export interface RunBeam {
  kind: 'beam';
  d0: number;
  d1: number;
  beamId: string;
  /** The beam's actual breadth. */
  trueWidth: number;
  /**
   * What the section shows: trueWidth / sin(skew) for a cut across the beam,
   * equal to trueWidth at 90 degrees. For a longitudinal cut it is instead the
   * length of beam the section runs down, which has nothing to do with breadth.
   */
  cutWidth: number;
  /** Angle between the section line and the beam centreline, in degrees [0, 90]. */
  skew: number;
  /**
   * The section runs along this beam rather than across it, so the drawing shows
   * a length of it in long section instead of a cross-section. The catch check
   * does not apply: a longitudinal cut has no slab either side of it to catch.
   */
  longitudinal?: boolean;
  /** d0 is not the beam's true edge — it was cut mid-span, by the run's own end. */
  d0Cut?: boolean;
  /** d1 is not the beam's true edge — it was cut mid-span, by the run's own end. */
  d1Cut?: boolean;
  /**
   * Set when an upstand covers this exact crossing, raising the effective top
   * the catch check uses by this much. The soffit is untouched — an upstand
   * only adds height above the beam's own top, never below it.
   */
  upstandDepth?: number;
}

export interface RunColumn {
  kind: 'column';
  d0: number;
  d1: number;
  columnId: string;
}

/** An upstand nib, cut wherever the section crosses the stretch of beam it sits on. */
export interface RunUpstand {
  kind: 'upstand';
  d0: number;
  d1: number;
  upstandId: string;
  beamId: string;
  /** The underlying beam's breadth — an upstand is never wider than the beam it rides on. */
  trueWidth: number;
  cutWidth: number;
  skew: number;
  /** The section runs along the beam this upstand sits on, rather than across it. */
  longitudinal?: boolean;
  /** d0 is not the upstand's true edge — it was cut mid-span, by the run's own end or by the piece it belongs to. */
  d0Cut?: boolean;
  /** d1 is not the upstand's true edge — it was cut mid-span, by the run's own end or by the piece it belongs to. */
  d1Cut?: boolean;
}

export type RunItem = RunSlab | RunBeam | RunColumn | RunUpstand;

/** Where the section line crosses a grid line, for labelling the section. */
export interface GridCrossing {
  axis: 'x' | 'y';
  lineId: string;
  label: string;
  /** Distance along the section line, from its canonical (not necessarily a) end. */
  d: number;
}

export interface SectionRun {
  /** Total length of the section line. */
  length: number;
  /** Ordered by d0. Gaps between items are genuine voids or outside the framing. */
  items: RunItem[];
  /** Ordered by d. Grid lines running parallel to the section are never crossed. */
  gridCrossings: GridCrossing[];
  warnings: string[];
}
