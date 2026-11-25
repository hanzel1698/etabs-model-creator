/**
 * Grid resolution and anchor resolution.
 *
 * Grid spacings are the source of truth; absolute offsets are always derived.
 * Everything else in the model points at grid lines by id, so editing one
 * spacing correctly drags every dependent column, beam and panel with it.
 */

import type { Anchor, Beam, Grid, GridLine, PlanModel, Pt } from './types';

/** Cumulative centre-to-centre offsets. The first line sits at 0. */
export function lineOffsets(lines: GridLine[]): Map<string, number> {
  const out = new Map<string, number>();
  let acc = 0;
  lines.forEach((line, i) => {
    if (i > 0) acc += line.spacingFromPrev;
    out.set(line.id, acc);
  });
  return out;
}

export interface GridOffsets {
  x: Map<string, number>;
  y: Map<string, number>;
}

export function gridOffsets(grid: Grid): GridOffsets {
  return { x: lineOffsets(grid.x), y: lineOffsets(grid.y) };
}

export function gridPoint(grid: Grid, gx: string, gy: string): Pt | null {
  const off = gridOffsets(grid);
  const x = off.x.get(gx);
  const y = off.y.get(gy);
  if (x === undefined || y === undefined) return null;
  return { x, y };
}

/** Bounding box of the grid itself, before any member sizes are considered. */
export function gridExtent(grid: Grid): { minX: number; maxX: number; minY: number; maxY: number } {
  const off = gridOffsets(grid);
  const xs = [...off.x.values()];
  const ys = [...off.y.values()];
  return {
    minX: xs.length ? Math.min(...xs) : 0,
    maxX: xs.length ? Math.max(...xs) : 0,
    minY: ys.length ? Math.min(...ys) : 0,
    maxY: ys.length ? Math.max(...ys) : 0,
  };
}

/**
 * Resolve an anchor to a plan point.
 *
 * `onBeam` anchors recurse into another beam, so `seen` guards against a cycle
 * (beam A hung off beam B hung off beam A). A cycle resolves to null rather
 * than blowing the stack.
 */
export function resolveAnchor(model: PlanModel, anchor: Anchor, seen: Set<string> = new Set()): Pt | null {
  switch (anchor.kind) {
    case 'point':
      return { x: anchor.x, y: anchor.y };

    case 'grid':
      return gridPoint(model.grid, anchor.gx, anchor.gy);

    case 'column': {
      const col = model.columns.find((c) => c.id === anchor.columnId);
      if (!col) return null;
      return gridPoint(model.grid, col.gx, col.gy);
    }

    case 'onBeam': {
      if (seen.has(anchor.beamId)) return null;
      const beam = model.beams.find((b) => b.id === anchor.beamId);
      if (!beam) return null;
      const ends = beamEnds(model, beam, new Set(seen).add(anchor.beamId));
      if (!ends) return null;
      const t = Math.min(1, Math.max(0, anchor.t));
      return {
        x: ends.start.x + (ends.end.x - ends.start.x) * t,
        y: ends.start.y + (ends.end.y - ends.start.y) * t,
      };
    }
  }
}

export interface BeamEnds {
  start: Pt;
  end: Pt;
}

export function beamEnds(model: PlanModel, beam: Beam, seen: Set<string> = new Set()): BeamEnds | null {
  const guard = new Set(seen).add(beam.id);
  const start = resolveAnchor(model, beam.start, guard);
  const end = resolveAnchor(model, beam.end, guard);
  if (!start || !end) return null;
  return { start, end };
}

/**
 * Resolve every beam once. Consumers (face detection, section cutting) should
 * use this rather than resolving anchors ad hoc.
 *
 * Beams that fail to resolve — a dangling anchor, a deleted column, an anchor
 * cycle — are omitted, so downstream code never sees a half-built beam.
 */
export function resolveBeams(model: PlanModel): Map<string, BeamEnds> {
  const out = new Map<string, BeamEnds>();
  for (const beam of model.beams) {
    const ends = beamEnds(model, beam);
    if (ends) out.set(beam.id, ends);
  }
  return out;
}

/** Zero-length beams are degenerate for face detection and cutting alike. */
export function isDegenerate(ends: BeamEnds, eps = 1e-6): boolean {
  return Math.hypot(ends.end.x - ends.start.x, ends.end.y - ends.start.y) < eps;
}

export function beamWidth(model: PlanModel, beam: Beam): number {
  return model.beamTypes.find((t) => t.id === beam.typeId)?.width ?? 0;
}

export function beamDepth(model: PlanModel, beam: Beam): number {
  if (beam.depthOverride !== undefined) return beam.depthOverride;
  return model.beamTypes.find((t) => t.id === beam.typeId)?.depth ?? 0;
}

/**
 * Beam top level, down-positive — the beam's own sink.
 *
 * Set per beam, never per type: an unsunk beam is simply one that has never
 * been given a level, so it sits on the datum. It therefore needs no model to
 * resolve, unlike the width and depth beside it.
 */
export function beamTopLevel(beam: Beam): number {
  return beam.topLevel ?? 0;
}

/**
 * Beam soffit level, down-positive.
 *
 * The depth always hangs off the beam's own top, so sinking a beam moves the
 * whole section down: a 'B-300x600' dropped 300 is still 600 deep, with its top
 * at +300 and its soffit at +900. Measuring the depth from the datum instead
 * would keep the soffit at +600 and quietly turn it into a 300 deep beam —
 * which is not what casting a beam lower means.
 */
export function beamSoffitLevel(model: PlanModel, beam: Beam): number {
  return beamTopLevel(beam) + beamDepth(model, beam);
}
