/**
 * Plan-space geometry shared by the renderer and the section cutter.
 * All of it is pure and works in model millimetres (+y up).
 */

import { beamWidth, type BeamEnds } from './grid';
import type { Column, ColumnType, PlanModel, Pt } from './types';

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function sub(a: Pt, b: Pt): Pt {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function len(p: Pt): number {
  return Math.hypot(p.x, p.y);
}

export function normalize(p: Pt): Pt {
  const l = len(p);
  return l === 0 ? { x: 0, y: 0 } : { x: p.x / l, y: p.y / l };
}

export function cross(a: Pt, b: Pt): number {
  return a.x * b.y - a.y * b.x;
}

export function dot(a: Pt, b: Pt): number {
  return a.x * b.x + a.y * b.y;
}

/**
 * The four corners of a beam in plan: its centreline swept by its breadth.
 * Returned counter-clockwise, starting at the start-left corner.
 */
export function beamPolygon(ends: BeamEnds, width: number): Pt[] {
  const dir = normalize(sub(ends.end, ends.start));
  const half = width / 2;
  // Left normal of the direction vector.
  const nx = -dir.y * half;
  const ny = dir.x * half;
  return [
    { x: ends.start.x + nx, y: ends.start.y + ny },
    { x: ends.start.x - nx, y: ends.start.y - ny },
    { x: ends.end.x - nx, y: ends.end.y - ny },
    { x: ends.end.x + nx, y: ends.end.y + ny },
  ];
}

/**
 * The corners of a t0-t1 sub-segment of a beam's own centreline, at the
 * beam's full width — an upstand nib, which always rides the same breadth as
 * the beam beneath it. `t0`/`t1` are fractions from `ends.start` to
 * `ends.end`, the same parametrisation the `onBeam` anchor uses, so an
 * upstand's footprint is measured against the beam's true resolved centreline
 * rather than however a T-junction happens to trim the drawing.
 */
export function beamSubPolygon(ends: BeamEnds, width: number, t0: number, t1: number): Pt[] {
  const at = (t: number): Pt => ({
    x: ends.start.x + (ends.end.x - ends.start.x) * t,
    y: ends.start.y + (ends.end.y - ends.start.y) * t,
  });
  return beamPolygon({ start: at(t0), end: at(t1) }, width);
}

/** A resolved beam and the breadth it occupies, for trimming other beams against. */
export interface BeamBand {
  ends: BeamEnds;
  width: number;
}

/**
 * Where a beam's rectangle should stop, given the beams around it.
 *
 * A beam landing on the side of another is anchored to that support's
 * centreline, because that is where its span is measured from. Drawn all the
 * way out to the centreline it covers half the support and reads as two members
 * crossing rather than one framing into the other, so each such end is pulled
 * back to the face of the support instead. Only the drawing changes: the span,
 * the panels either side and the section cut all keep the true centreline ends.
 *
 * Only a support the beam meets MID-span trims it. At a corner both beams end
 * at the same point, and pulling each back to the other's face would leave the
 * corner empty.
 */
export function trimBeamEnds(ends: BeamEnds, supports: BeamBand[]): BeamEnds {
  const span = sub(ends.end, ends.start);
  const length = len(span);
  if (length < 1e-6) return ends;
  const dir = normalize(span);
  const back = { x: -dir.x, y: -dir.y };

  const furthest = (at: Pt, inward: Pt) =>
    supports.reduce((most, support) => Math.max(most, faceOffset(at, inward, support)), 0);

  const fromStart = furthest(ends.start, dir);
  const fromEnd = furthest(ends.end, back);
  // A trim that would swallow the beam whole leaves nothing to read; the
  // untrimmed rectangle is the lesser of the two evils.
  if (fromStart + fromEnd >= length - 1e-6) return ends;

  return {
    start: { x: ends.start.x + dir.x * fromStart, y: ends.start.y + dir.y * fromStart },
    end: { x: ends.end.x + back.x * fromEnd, y: ends.end.y + back.y * fromEnd },
  };
}

/**
 * How far `at` has to travel along `inward` to clear `support`'s breadth, or 0
 * if that support does not trim this end at all.
 */
function faceOffset(at: Pt, inward: Pt, support: BeamBand): number {
  const along = sub(support.ends.end, support.ends.start);
  const supportLength = len(along);
  if (supportLength < 1e-6) return 0;
  const supportDir = normalize(along);

  // Parallel beams never cross, so there is no face to clip against.
  const rate = cross(supportDir, inward);
  if (Math.abs(rate) < 1e-9) return 0;

  const offset = sub(at, support.ends.start);
  const half = support.width / 2;
  // Signed distance off the support centreline: outside its breadth, this end
  // is not sitting on the support at all.
  const side = cross(supportDir, offset);
  if (Math.abs(side) > half) return 0;

  // And how far along the support we are — an end level with the support's own
  // end is a corner, not a landing.
  const t = dot(supportDir, offset);
  if (t <= 1e-6 || t >= supportLength - 1e-6) return 0;

  // Where the centreline leaves the band, going inward. One root is behind us
  // and one ahead; the far one is the face to stop at.
  return Math.max((half - side) / rate, (-half - side) / rate);
}

/**
 * The ends every resolved beam is DRAWN to, trimmed per `trimBeamEnds`.
 * Keyed by beam id, and omitting whatever `resolved` omitted.
 */
export function drawnBeamEnds(
  model: PlanModel,
  resolved: Map<string, BeamEnds>,
): Map<string, BeamEnds> {
  const bands = model.beams.flatMap((beam) => {
    const ends = resolved.get(beam.id);
    return ends ? [{ id: beam.id, ends, width: beamWidth(model, beam) }] : [];
  });

  const out = new Map<string, BeamEnds>();
  for (const band of bands) {
    out.set(band.id, trimBeamEnds(band.ends, bands.filter((other) => other.id !== band.id)));
  }
  return out;
}

export function columnSize(type: ColumnType, column: Column): { w: number; d: number } {
  return column.rotated ? { w: type.depth, d: type.width } : { w: type.width, d: type.depth };
}

/** The four corners of a column, centred on its grid intersection. */
export function columnPolygon(centre: Pt, type: ColumnType, column: Column): Pt[] {
  const { w, d } = columnSize(type, column);
  const hw = w / 2;
  const hd = d / 2;
  return [
    { x: centre.x - hw, y: centre.y - hd },
    { x: centre.x + hw, y: centre.y - hd },
    { x: centre.x + hw, y: centre.y + hd },
    { x: centre.x - hw, y: centre.y + hd },
  ];
}

export function polygonBounds(pts: Pt[]): Rect {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

export function unionRect(a: Rect, b: Rect): Rect {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/** Even-odd containment test, adequate for the simple faces we generate. */
export function pointInPolygon(pt: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    const straddles = a.y > pt.y !== b.y > pt.y;
    if (straddles && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Signed area, positive for a counter-clockwise ring.
 *
 * The sign carries meaning: face detection uses it to tell an enclosed panel
 * from the outer boundary of a component, and polygonCentroid divides by it.
 */
export function polygonArea(poly: Pt[]): number {
  let sum = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    sum += poly[j]!.x * poly[i]!.y - poly[i]!.x * poly[j]!.y;
  }
  return sum / 2;
}

export function polygonCentroid(poly: Pt[]): Pt {
  const area = polygonArea(poly);
  if (Math.abs(area) < 1e-9) {
    // Degenerate — fall back to the vertex average.
    const n = poly.length || 1;
    return {
      x: poly.reduce((s, p) => s + p.x, 0) / n,
      y: poly.reduce((s, p) => s + p.y, 0) / n,
    };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j]!;
    const b = poly[i]!;
    const f = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * f;
    cy += (a.y + b.y) * f;
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

/** Overall extent of everything placed on the plan, for fit-to-view. */
export function modelBounds(model: PlanModel, resolved: Map<string, BeamEnds>): Rect | null {
  let out: Rect | null = null;
  const add = (r: Rect) => {
    out = out ? unionRect(out, r) : r;
  };

  for (const beam of model.beams) {
    const ends = resolved.get(beam.id);
    if (!ends) continue;
    const width = model.beamTypes.find((t) => t.id === beam.typeId)?.width ?? 0;
    add(polygonBounds(beamPolygon(ends, width)));
  }
  return out;
}
