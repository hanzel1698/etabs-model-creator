/**
 * Cutting the plan along a section line.
 *
 * This is the hinge of the whole program: it turns the 2D framing plan into the
 * ordered 1D run of beams and slabs that the section drawing and the catch
 * check both work from. Nothing downstream of here knows about the plan.
 *
 * Precedence along the line is beams, then columns, then slabs. Beams are never
 * split — a beam interrupted by a column would break the "slab on each side of
 * this beam" reasoning the catch check depends on. Columns are never split by a
 * beam either: a column runs the full height of the section wherever the line
 * crosses its footprint, beam or no beam, so it still occupies `occupied` for
 * the slabs that come after it, but nothing subtracts from the column itself.
 *
 * A beam the line runs *along* rather than across is cut too, as a length of
 * beam in long section. It is marked `longitudinal` because that piece answers a
 * different question from a cross-section: it shows the beam's own extent and
 * level, and it has no slab either side of it for the catch check to work from.
 */

import { resolveBeams, type BeamEnds } from './grid';
import { panelsForModel, type Panel } from './faces';
import { beamPolygon, columnPolygon, dot, normalize, pointInPolygon, sub } from './planGeom';
import { gridOffsets } from './grid';
import type { GridCrossing, PlanModel, Pt, RunBeam, RunItem, SectionLine, SectionRun } from './types';

/**
 * `SectionRun` is generic over its item shape only in spirit — RunItem is a
 * discriminated union, and mapping over it with an inline object spread would
 * widen each member to the union rather than preserving which member it is.
 * This helper keeps the switch explicit so each branch stays its own type.
 */
function mirrorItem(item: RunItem, length: number): RunItem {
  const d0 = length - item.d1;
  const d1 = length - item.d0;
  switch (item.kind) {
    case 'slab':
      return { ...item, d0, d1, d0Cut: item.d1Cut, d1Cut: item.d0Cut };
    case 'beam':
      return { ...item, d0, d1, d0Cut: item.d1Cut, d1Cut: item.d0Cut };
    case 'upstand':
      return { ...item, d0, d1, d0Cut: item.d1Cut, d1Cut: item.d0Cut };
    case 'column':
      return { ...item, d0, d1 };
  }
}

/** Below this skew a section is running along a beam rather than across it. */
const MIN_SKEW_SIN = Math.sin((5 * Math.PI) / 180);
/** Cut pieces shorter than this (mm) are slivers from touching geometry. */
const MIN_PIECE = 0.5;
/** Tolerance for comparing distances along the section line. */
const CUT_EPS = 1e-6;

type Interval = [number, number];

/** True where `edge` sits at an end of the whole run rather than a natural member edge. */
function touchesRunEnd(edge: number, length: number): boolean {
  return edge <= CUT_EPS || edge >= length - CUT_EPS;
}

/** True where `value` lands on one of the bounds of some interval in the list. */
function touchesIntervalEdge(value: number, intervals: Interval[]): boolean {
  return intervals.some(([lo, hi]) => Math.abs(value - lo) < CUT_EPS || Math.abs(value - hi) < CUT_EPS);
}

/** Merge overlapping and touching intervals into a sorted disjoint set. */
export function unionIntervals(list: Interval[]): Interval[] {
  const sorted = [...list].sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  for (const [lo, hi] of sorted) {
    const last = out[out.length - 1];
    if (last && lo <= last[1] + 1e-9) last[1] = Math.max(last[1], hi);
    else out.push([lo, hi]);
  }
  return out;
}

/** What remains of `base` once every interval in `cuts` is removed. */
export function subtractIntervals(base: Interval, cuts: Interval[]): Interval[] {
  let pieces: Interval[] = [base];
  for (const [clo, chi] of unionIntervals(cuts)) {
    const next: Interval[] = [];
    for (const [lo, hi] of pieces) {
      if (chi <= lo || clo >= hi) {
        next.push([lo, hi]);
        continue;
      }
      if (clo > lo) next.push([lo, clo]);
      if (chi < hi) next.push([chi, hi]);
    }
    pieces = next;
  }
  return pieces.filter(([lo, hi]) => hi - lo > MIN_PIECE);
}

interface CutPiece {
  d0: number;
  d1: number;
  /** True where this bound is not `base`'s own edge — it was trimmed by another member or by the run's end. */
  d0Cut: boolean;
  d1Cut: boolean;
}

/**
 * Subtracts `occupied` from `base`, same as `subtractIntervals`, but also
 * reports which bound of each surviving piece is a genuine edge of `base`
 * (a real slab edge) versus one imposed by a beam sharing the same ground,
 * or by the section line simply ending there. Those imposed bounds are
 * where a break line belongs, to show the slab keeps going rather than
 * stopping dead.
 *
 * A bound trimmed by a *column* is deliberately left unmarked: a column is
 * full-depth, so the slab genuinely ends at its face — that edge is real,
 * not an interruption, even though it was also `occupied` for the purposes
 * of deciding where to stop drawing.
 */
function subtractWithCutFlags(
  base: Interval,
  occupied: Interval[],
  beamOccupied: Interval[],
  length: number,
): CutPiece[] {
  const [lo, hi] = base;
  return subtractIntervals(base, occupied).map(([d0, d1]) => ({
    d0,
    d1,
    d0Cut: touchesRunEnd(d0, length) || (d0 > lo + CUT_EPS && touchesIntervalEdge(d0, beamOccupied)),
    d1Cut: touchesRunEnd(d1, length) || (d1 < hi - CUT_EPS && touchesIntervalEdge(d1, beamOccupied)),
  }));
}

/**
 * Where the section line lies inside a polygon, as distances along the line.
 *
 * Works for concave faces and returns several intervals when the line leaves and
 * re-enters, so it does not assume panels are convex.
 */
export function clipToPolygon(origin: Pt, dir: Pt, length: number, poly: Pt[]): Interval[] {
  const cuts: number[] = [0, length];

  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const p = poly[j]!;
    const q = poly[i]!;
    const ex = q.x - p.x;
    const ey = q.y - p.y;
    const denom = dir.x * ey - dir.y * ex;
    if (Math.abs(denom) < 1e-12) continue;
    const t = ((p.x - origin.x) * ey - (p.y - origin.y) * ex) / denom;
    const u = ((p.x - origin.x) * dir.y - (p.y - origin.y) * dir.x) / denom;
    if (u >= -1e-9 && u <= 1 + 1e-9 && t > 0 && t < length) cuts.push(t);
  }

  const stops = [...new Set(cuts.map((t) => Math.round(t * 1e6) / 1e6))].sort((a, b) => a - b);
  const out: Interval[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const lo = stops[i]!;
    const hi = stops[i + 1]!;
    const mid = (lo + hi) / 2;
    const at = { x: origin.x + dir.x * mid, y: origin.y + dir.y * mid };
    if (pointInPolygon(at, poly)) out.push([lo, hi]);
  }
  return unionIntervals(out).filter(([lo, hi]) => hi - lo > MIN_PIECE);
}

export interface CutContext {
  resolved: Map<string, BeamEnds>;
  panels: Panel[];
}

/**
 * Grid lines the section line actually crosses. A grid line running parallel
 * to the section (dir.x ~ 0 for an x-line, dir.y ~ 0 for a y-line) is never
 * crossed transversally, so it is left out rather than reported at infinity.
 */
function sectionGridCrossings(model: PlanModel, origin: Pt, dir: Pt, length: number): GridCrossing[] {
  const offsets = gridOffsets(model.grid);
  const out: GridCrossing[] = [];

  if (Math.abs(dir.x) > 1e-9) {
    for (const line of model.grid.x) {
      const x = offsets.x.get(line.id);
      if (x === undefined) continue;
      const d = (x - origin.x) / dir.x;
      if (d >= -1e-6 && d <= length + 1e-6) {
        out.push({ axis: 'x', lineId: line.id, label: line.label, d: Math.min(Math.max(d, 0), length) });
      }
    }
  }

  if (Math.abs(dir.y) > 1e-9) {
    for (const line of model.grid.y) {
      const y = offsets.y.get(line.id);
      if (y === undefined) continue;
      const d = (y - origin.y) / dir.y;
      if (d >= -1e-6 && d <= length + 1e-6) {
        out.push({ axis: 'y', lineId: line.id, label: line.label, d: Math.min(Math.max(d, 0), length) });
      }
    }
  }

  return out.sort((a, b) => a.d - b.d);
}

/**
 * Whether a→b already runs in the cut's canonical direction (right to left
 * when horizontal, top to bottom when vertical, clockwise when skewed).
 */
export function isClickOrderCanonical(a: Pt, b: Pt): boolean {
  const dy = b.y - a.y;
  const dx = b.x - a.x;
  return Math.abs(dy) > 1e-6 ? dy < 0 : dx < 0;
}

/**
 * Which endpoint the cut should walk from, independent of which one was
 * clicked first. A section always reads right to left when horizontal, top
 * to bottom when vertical, and clockwise (lower half-plane, y decreasing)
 * when skewed — so d0 = 0 lands on the same physical end no matter which
 * way the line was drawn.
 */
export function canonicalEnds(a: Pt, b: Pt): [Pt, Pt] {
  return isClickOrderCanonical(a, b) ? [a, b] : [b, a];
}

/**
 * Whether the displayed run should be mirrored so the section reads in the
 * order the line was actually drawn (first-clicked end at screen-left),
 * XORed with the user's manual "Flip view" toggle.
 */
export function shouldMirrorForDisplay(line: Pick<SectionLine, 'a' | 'b' | 'reversed'>): boolean {
  return isClickOrderCanonical(line.a, line.b) === !!line.reversed;
}

export function cutSection(model: PlanModel, line: SectionLine, ctx?: Partial<CutContext>): SectionRun {
  const resolved = ctx?.resolved ?? resolveBeams(model);
  const panels = ctx?.panels ?? panelsForModel(model, resolved);

  const [origin, target] = canonicalEnds(line.a, line.b);
  const delta = sub(target, origin);
  const length = Math.hypot(delta.x, delta.y);
  const warnings: string[] = [];

  if (length < 1) {
    return { length: 0, items: [], gridCrossings: [], warnings: ['Section line has no length.'] };
  }
  const dir = normalize(delta);
  const gridCrossings = sectionGridCrossings(model, origin, dir, length);

  // ---- beams -------------------------------------------------------------
  const beamItems: RunBeam[] = [];
  const beamOccupied: Interval[] = [];
  /**
   * Beams the line runs along. Kept apart from `beamOccupied` because these two
   * lists mean different things to a slab: a beam cut across interrupts the slab
   * mid-span (break line), whereas a beam cut along it is simply the slab's own
   * edge — the slab starts at that beam's face and genuinely ends there.
   */
  const alongOccupied: Interval[] = [];

  for (const beam of model.beams) {
    const ends = resolved.get(beam.id);
    if (!ends) continue;
    const type = model.beamTypes.find((t) => t.id === beam.typeId);
    if (!type) continue;

    const beamDir = normalize(sub(ends.end, ends.start));
    const sinSkew = Math.abs(dir.x * beamDir.y - dir.y * beamDir.x);

    const pieces = clipToPolygon(origin, dir, length, beamPolygon(ends, type.width));
    if (pieces.length === 0) continue;

    if (sinSkew < MIN_SKEW_SIN) {
      // Running along the beam. The plane still passes through it, exposing a
      // length of beam in long section, so the piece is drawn rather than
      // dropped — leaving it out loses the very member the line was drawn down.
      //
      // Where that length stops matters: a bound at one of the beam's own ends
      // is a real end face, while a bound anywhere else is the section line
      // wandering off the side of the beam, which is a break. `dot(dir, beamDir)`
      // is at least cos(MIN_SKEW) here, so solving for where the line meets each
      // end face is well conditioned.
      const cosSkew = dot(dir, beamDir);
      const endDistances = [ends.start, ends.end].map((p) => dot(sub(p, origin), beamDir) / cosSkew);
      const atBeamEnd = (d: number) => endDistances.some((e) => Math.abs(d - e) <= MIN_PIECE);

      for (const [d0, d1] of pieces) {
        beamItems.push({
          kind: 'beam',
          d0,
          d1,
          beamId: beam.id,
          trueWidth: type.width,
          cutWidth: d1 - d0,
          skew: (Math.asin(Math.min(1, sinSkew)) * 180) / Math.PI,
          longitudinal: true,
          d0Cut: !atBeamEnd(d0),
          d1Cut: !atBeamEnd(d1),
        });
        alongOccupied.push([d0, d1]);
      }

      warnings.push(
        `Section runs along ${type.label} rather than across it — that beam is shown in long section, and the catch check does not apply to it.`,
      );
      continue;
    }

    for (const [d0, d1] of pieces) {
      beamItems.push({
        kind: 'beam',
        d0,
        d1,
        beamId: beam.id,
        trueWidth: type.width,
        cutWidth: d1 - d0,
        skew: (Math.asin(Math.min(1, sinSkew)) * 180) / Math.PI,
        d0Cut: touchesRunEnd(d0, length),
        d1Cut: touchesRunEnd(d1, length),
      });
      beamOccupied.push([d0, d1]);
    }
  }

  // ---- upstands, over whatever stretch of their beam the section crosses --
  // A beam's own crossing is found again here (rather than threaded through
  // from the loop above) because most beams carry no upstand at all, so this
  // whole block is skipped for them at the first check.
  const upstandItems: RunItem[] = [];

  for (const beam of model.beams) {
    const beamUpstands = model.upstands.filter((u) => u.beamId === beam.id);
    if (beamUpstands.length === 0) continue;

    const ends = resolved.get(beam.id);
    if (!ends) continue;
    const type = model.beamTypes.find((t) => t.id === beam.typeId);
    if (!type) continue;

    const beamLength = Math.hypot(ends.end.x - ends.start.x, ends.end.y - ends.start.y);
    if (beamLength < 1e-6) continue;
    const beamDir = normalize(sub(ends.end, ends.start));
    const sinSkew = Math.abs(dir.x * beamDir.y - dir.y * beamDir.x);

    const pieces = clipToPolygon(origin, dir, length, beamPolygon(ends, type.width));
    if (pieces.length === 0) continue;

    if (sinSkew < MIN_SKEW_SIN) {
      // Longitudinal: a piece is a stretch of the beam's own length, so its
      // bounds convert straight to the t fractions the upstands are stored
      // against, the same way the beam's own long-section piece does above.
      const cosSkew = dot(dir, beamDir);
      const endDistances = [ends.start, ends.end].map((p) => dot(sub(p, origin), beamDir) / cosSkew);
      const d0e = endDistances[0]!;
      const d1e = endDistances[1]!;
      const dToT = (d: number) => (d - d0e) / (d1e - d0e);
      const tToD = (t: number) => d0e + t * (d1e - d0e);

      for (const [pd0, pd1] of pieces) {
        const pt0 = Math.min(dToT(pd0), dToT(pd1));
        const pt1 = Math.max(dToT(pd0), dToT(pd1));

        for (const up of beamUpstands) {
          const upType = model.upstandTypes.find((t) => t.id === up.typeId);
          if (!upType) continue;
          const uLo = Math.min(up.t0, up.t1);
          const uHi = Math.max(up.t0, up.t1);
          const lo = Math.max(pt0, uLo);
          const hi = Math.min(pt1, uHi);
          if (hi - lo <= 1e-9) continue;

          const ud0 = Math.min(tToD(lo), tToD(hi));
          const ud1 = Math.max(tToD(lo), tToD(hi));
          // Whether ud0/ud1 is a true edge of the upstand, not one imposed by
          // where this piece happens to stop — checked against the SET of the
          // upstand's own two true ends in d-space, the same way the beam's own
          // `atBeamEnd` does, because tToD reverses ud0/ud1 relative to lo/hi
          // whenever the beam runs opposite the section's own positive-d sense.
          const trueEnds = [tToD(uLo), tToD(uHi)];
          const atUpstandEnd = (d: number) => trueEnds.some((e) => Math.abs(d - e) <= MIN_PIECE);
          upstandItems.push({
            kind: 'upstand',
            d0: ud0,
            d1: ud1,
            upstandId: up.id,
            beamId: beam.id,
            trueWidth: type.width,
            cutWidth: ud1 - ud0,
            skew: (Math.asin(Math.min(1, sinSkew)) * 180) / Math.PI,
            longitudinal: true,
            d0Cut: !atUpstandEnd(ud0),
            d1Cut: !atUpstandEnd(ud1),
          });
        }
      }
      continue;
    }

    // Transversal: one crossing point per piece — find where along the beam
    // it lands, and whether an upstand covers that stretch.
    for (const [pd0, pd1] of pieces) {
      const mid = (pd0 + pd1) / 2;
      const at = { x: origin.x + dir.x * mid, y: origin.y + dir.y * mid };
      const rawT = dot(sub(at, ends.start), beamDir) / beamLength;
      const t = Math.min(1, Math.max(0, rawT));

      const hit = beamUpstands.find(
        (u) => t >= Math.min(u.t0, u.t1) - 1e-6 && t <= Math.max(u.t0, u.t1) + 1e-6,
      );
      if (!hit) continue;
      const upType = model.upstandTypes.find((t2) => t2.id === hit.typeId);
      if (!upType) continue;

      upstandItems.push({
        kind: 'upstand',
        d0: pd0,
        d1: pd1,
        upstandId: hit.id,
        beamId: beam.id,
        trueWidth: type.width,
        cutWidth: pd1 - pd0,
        skew: (Math.asin(Math.min(1, sinSkew)) * 180) / Math.PI,
        d0Cut: touchesRunEnd(pd0, length),
        d1Cut: touchesRunEnd(pd1, length),
      });

      // Feed the depth back into this exact crossing's own RunBeam item, so
      // the catch check sees an effectively raised top there.
      const beamItem = beamItems.find(
        (b) => b.beamId === beam.id && Math.abs(b.d0 - pd0) < CUT_EPS && Math.abs(b.d1 - pd1) < CUT_EPS,
      );
      if (beamItem) beamItem.upstandDepth = upType.depth;
    }
  }

  // ---- columns, wherever the section crosses the column's footprint -------
  // Shown in full regardless of any beam sharing the same ground: a beam
  // running over a column does not hide it, the column just continues past it.
  const offsets = gridOffsets(model.grid);
  const columnItems: RunItem[] = [];
  const columnOccupied: Interval[] = [];

  for (const column of model.columns) {
    const type = model.columnTypes.find((t) => t.id === column.typeId);
    const x = offsets.x.get(column.gx);
    const y = offsets.y.get(column.gy);
    if (!type || x === undefined || y === undefined) continue;

    const pieces = clipToPolygon(origin, dir, length, columnPolygon({ x, y }, type, column));
    for (const [d0, d1] of pieces) {
      columnItems.push({ kind: 'column', d0, d1, columnId: column.id });
      columnOccupied.push([d0, d1]);
    }
  }

  // ---- slabs fill whatever is left --------------------------------------
  // A beam run along takes its stretch of the line with it: inside that beam's
  // breadth the plane is cutting beam, not slab, so the panel polygons that reach
  // to its centreline must not paint slab over the top of it.
  //
  // A duct panel (slabTypeId null) is an opening, so it contributes nothing: the
  // section shows the same gap it shows over any other void, and the beams framing
  // it have no slab on that side for the catch check to reach.
  const occupied = [...beamOccupied, ...alongOccupied, ...columnOccupied];
  const slabItems: RunItem[] = [];
  for (const panel of panels) {
    const { slabTypeId } = panel;
    if (slabTypeId === null) continue;
    for (const piece of clipToPolygon(origin, dir, length, panel.polygon)) {
      for (const cut of subtractWithCutFlags(piece, occupied, beamOccupied, length)) {
        slabItems.push({
          kind: 'slab',
          d0: cut.d0,
          d1: cut.d1,
          slabTypeId,
          panelId: panel.id,
          d0Cut: cut.d0Cut,
          d1Cut: cut.d1Cut,
        });
      }
    }
  }

  const items = [...beamItems, ...upstandItems, ...columnItems, ...slabItems].sort(
    (a, b) => a.d0 - b.d0,
  );
  if (items.length === 0) warnings.push('Section line does not cross any framing.');

  return { length, items, gridCrossings, warnings: [...new Set(warnings)] };
}

/**
 * Mirrors a run left-to-right, for a section line whose view direction has
 * been flipped. The cut itself always walks its canonical direction (right
 * to left, top to bottom, or clockwise when skewed); flipping only changes
 * how the result is presented, so this remaps d0/d1 about the run's length
 * rather than re-cutting anything.
 */
export function mirrorRun(run: SectionRun): SectionRun {
  const items = run.items
    .map((item) => mirrorItem(item, run.length))
    .sort((a, b) => a.d0 - b.d0);
  const gridCrossings = run.gridCrossings
    .map((c) => ({ ...c, d: run.length - c.d }))
    .sort((a, b) => a.d - b.d);
  return { ...run, items, gridCrossings };
}
