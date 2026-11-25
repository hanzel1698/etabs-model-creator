/**
 * The end-bearing half of the catch check.
 *
 * `checks.ts` asks whether a beam catches the slabs BESIDE it. This file asks
 * the other question: is the beam itself caught at its two ENDS, over its whole
 * depth, by whatever it lands on.
 *
 * Same down-positive level space as everywhere else. A beam occupies the depth
 * range [topLevel, soffitLevel], and each end has to have material spanning that
 * whole range:
 *
 *   - A COLUMN catches everything. It runs floor to floor, so whatever depth the
 *     beam has and wherever it is cast, the column is there — it is modelled as
 *     an unbounded range rather than being special-cased downstream.
 *
 *   - A BEAM catches only its own [topLevel, soffitLevel]. A 600 deep beam
 *     landing on the side of a 400 deep one has 200 of its depth hanging past
 *     the support's soffit with nothing under it, and a beam landing on one cast
 *     300 lower has its top 300 above where the support's material starts.
 *
 *   - An UPSTAND over a beam raises that beam's top where it sits, exactly as it
 *     does in `checks.ts`, so a nib is what lets a shallow beam catch a deeper
 *     one framing into it. Only the stretch of nib actually under the incoming
 *     beam's end counts, which is why the upstand's t-range is tested against
 *     that end point rather than merely against the beam it belongs to.
 *
 * Several supports at one end are UNIONED rather than judged one at a time: a
 * beam landing where two others cross is caught if between them they cover its
 * depth, and quoting each separately would report a failure against each even
 * though nothing is actually left hanging. What comes out is the list of level
 * ranges nothing reaches — usually one, at the top or at the soffit.
 *
 * Supports are found from the beam's CENTRELINE end point. That is deliberate:
 * the question here is depth, not breadth, and the centreline is the line the
 * span is measured along and the point every anchor already resolves to. A beam
 * clipping the corner of its support in plan is a different (breadth) problem
 * that this check does not claim to answer.
 */

import {
  beamSoffitLevel,
  beamTopLevel,
  beamWidth,
  gridPoint,
  isDegenerate,
  resolveBeams,
  type BeamEnds,
} from './grid';
import { columnSize, cross, dot, len, normalize, sub } from './planGeom';
import type { Beam, PlanModel, Pt } from './types';

/** Millimetres. Ends land on resolved anchors, so this only absorbs float noise. */
const EPS = 1e-6;

export type SupportKind = 'column' | 'beam';

/** One thing found under a beam end, and the depth range it can catch. */
export interface Support {
  kind: SupportKind;
  id: string;
  label: string;
  /** Top of the material here, down-positive. -Infinity for a column. */
  top: number;
  /** Soffit of the material here, down-positive. +Infinity for a column. */
  soffit: number;
  /** Set when an upstand raises this support's top at this exact point. */
  upstandLabel?: string;
}

/** A stretch of the checked beam's depth that nothing at this end reaches. */
export interface Gap {
  /** Down-positive level the gap starts at. */
  from: number;
  /** Down-positive level it ends at. */
  to: number;
}

export type EndName = 'start' | 'end';

export interface EndBearing {
  which: EndName;
  /** The beam's centreline end point, in plan. */
  at: Pt;
  /** Unit vector from `at` back along the beam — where a leader should point. */
  inward: Pt;
  supports: Support[];
  gaps: Gap[];
  pass: boolean;
  /** Short phrase for the plan callout. Empty when the end passes. */
  note: string;
}

export interface BeamBearing {
  beamId: string;
  label: string;
  topLevel: number;
  soffitLevel: number;
  /** Always two, in start-then-end order. */
  ends: EndBearing[];
  pass: boolean;
  /** Full sentences, for the results panel. */
  warnings: string[];
}

/** A resolved beam with the breadth its band occupies. */
interface Band {
  beam: Beam;
  ends: BeamEnds;
  width: number;
}

export function checkBearing(
  model: PlanModel,
  resolved: Map<string, BeamEnds> = resolveBeams(model),
): BeamBearing[] {
  // Degenerate beams have no direction and so no two ends to speak of; they are
  // dropped as supports too, since a zero-length band catches nothing.
  const bands: Band[] = model.beams.flatMap((beam) => {
    const ends = resolved.get(beam.id);
    if (!ends || isDegenerate(ends)) return [];
    return [{ beam, ends, width: beamWidth(model, beam) }];
  });

  return bands.map((band) => {
    const topLevel = beamTopLevel(band.beam);
    const soffitLevel = beamSoffitLevel(model, band.beam);
    const label = beamLabel(model, band.beam);
    const dir = normalize(sub(band.ends.end, band.ends.start));

    const ends: EndBearing[] = [
      endBearing(model, bands, band, 'start', band.ends.start, dir, topLevel, soffitLevel),
      endBearing(
        model,
        bands,
        band,
        'end',
        band.ends.end,
        { x: -dir.x, y: -dir.y },
        topLevel,
        soffitLevel,
      ),
    ];

    return {
      beamId: band.beam.id,
      label,
      topLevel,
      soffitLevel,
      ends,
      pass: ends.every((e) => e.pass),
      warnings: ends.filter((e) => !e.pass).map((e) => sentence(label, e)),
    };
  });
}

function endBearing(
  model: PlanModel,
  bands: Band[],
  self: Band,
  which: EndName,
  at: Pt,
  inward: Pt,
  topLevel: number,
  soffitLevel: number,
): EndBearing {
  const supports = supportsAt(model, bands, self.beam.id, at);
  const gaps = uncovered(
    topLevel,
    soffitLevel,
    supports.map((s) => [s.top, s.soffit] as [number, number]),
  );
  const pass = gaps.length === 0;

  const note = pass
    ? ''
    : supports.length === 0
      ? 'nothing catches this end'
      : gaps.map((gap) => describeGap(gap, topLevel, soffitLevel)).join(', ');

  return { which, at, inward, supports, gaps, pass, note };
}

/** Everything whose plan footprint covers `at`, other than the beam itself. */
function supportsAt(model: PlanModel, bands: Band[], selfId: string, at: Pt): Support[] {
  const out: Support[] = [];

  for (const column of model.columns) {
    const type = model.columnTypes.find((t) => t.id === column.typeId);
    if (!type) continue;
    const centre = gridPoint(model.grid, column.gx, column.gy);
    if (!centre) continue;
    const { w, d } = columnSize(type, column);
    if (Math.abs(at.x - centre.x) > w / 2 + EPS) continue;
    if (Math.abs(at.y - centre.y) > d / 2 + EPS) continue;
    out.push({
      kind: 'column',
      id: column.id,
      label: type.label,
      top: -Infinity,
      soffit: Infinity,
    });
  }

  for (const band of bands) {
    if (band.beam.id === selfId) continue;
    if (!withinBand(band, at)) continue;
    const nib = upstandAt(model, band, at);
    out.push({
      kind: 'beam',
      id: band.beam.id,
      label: beamLabel(model, band.beam),
      // The nib is material sitting on this support's top, so it is what the
      // incoming beam actually lands on — exactly the substitution checks.ts
      // makes for the slab beside a beam.
      top: beamTopLevel(band.beam) - (nib?.depth ?? 0),
      soffit: beamSoffitLevel(model, band.beam),
      ...(nib ? { upstandLabel: nib.label } : {}),
    });
  }

  return out;
}

/** Is `at` inside this beam's rectangle in plan — along it and across its breadth? */
function withinBand(band: Band, at: Pt): boolean {
  const along = sub(band.ends.end, band.ends.start);
  const length = len(along);
  if (length < EPS) return false;
  const dir = normalize(along);
  const offset = sub(at, band.ends.start);
  const t = dot(dir, offset);
  if (t < -EPS || t > length + EPS) return false;
  return Math.abs(cross(dir, offset)) <= band.width / 2 + EPS;
}

/** The deepest upstand on this beam covering `at`, if any. */
function upstandAt(model: PlanModel, band: Band, at: Pt): Nib | null {
  const along = sub(band.ends.end, band.ends.start);
  const length = len(along);
  if (length < EPS) return null;
  const t = dot(normalize(along), sub(at, band.ends.start)) / length;
  return deepestUpstandAt(model, band.beam.id, t);
}

/** A raised nib, reduced to what a catch check needs of it. */
export interface Nib {
  label: string;
  depth: number;
}

/**
 * The deepest upstand on `beamId` covering the parameter `t`, if any.
 *
 * `t` is measured against the beam's own resolved centreline, the same
 * parametrisation `Upstand.t0`/`t1` and the `onBeam` anchor use, so a beam hung
 * off a point on this one is tested against the nib at exactly the fraction it
 * was anchored at. Deepest wins where nibs overlap: they are cast together, so
 * what the incoming member lands on is the top of the tallest.
 *
 * Shared with the slab-side check, which asks the same question of a stretch of
 * beam rather than of a single point.
 */
export function deepestUpstandAt(model: PlanModel, beamId: string, t: number): Nib | null {
  let best: Nib | null = null;
  for (const upstand of model.upstands) {
    if (upstand.beamId !== beamId) continue;
    const t0 = Math.min(upstand.t0, upstand.t1);
    const t1 = Math.max(upstand.t0, upstand.t1);
    if (t < t0 - EPS || t > t1 + EPS) continue;
    const type = model.upstandTypes.find((u) => u.id === upstand.typeId);
    if (!type) continue;
    if (!best || type.depth > best.depth) best = { label: type.label, depth: type.depth };
  }
  return best;
}

/**
 * The parts of [from, to] no interval covers. Intervals are clamped to the range
 * and merged, so overlapping supports and unbounded columns both fall out of the
 * same sweep.
 */
export function uncovered(from: number, to: number, intervals: [number, number][]): Gap[] {
  const clamped = intervals
    .map(([a, b]) => [Math.max(a, from), Math.min(b, to)] as [number, number])
    .filter(([a, b]) => b - a > EPS)
    .sort((p, q) => p[0] - q[0]);

  const gaps: Gap[] = [];
  let cursor = from;
  for (const [a, b] of clamped) {
    if (a > cursor + EPS) gaps.push({ from: cursor, to: a });
    cursor = Math.max(cursor, b);
    if (cursor >= to - EPS) break;
  }
  if (cursor < to - EPS) gaps.push({ from: cursor, to });
  return gaps;
}

function describeGap(gap: Gap, topLevel: number, soffitLevel: number): string {
  const size = Math.round(gap.to - gap.from);
  if (gap.from <= topLevel + EPS) return `top ${size} uncaught`;
  if (gap.to >= soffitLevel - EPS) return `soffit ${size} uncaught`;
  return `${size} uncaught`;
}

function sentence(label: string, end: EndBearing): string {
  const where = end.which === 'start' ? 'first end' : 'far end';
  if (end.supports.length === 0) {
    return `${label} has nothing under its ${where} — no column or beam catches it there.`;
  }
  const by = end.supports
    .map((s) => (s.upstandLabel ? `${s.label} + ${s.upstandLabel}` : s.label))
    .join(' and ');
  return `${label} is not fully caught at its ${where}: ${end.note}, against ${by}.`;
}

function beamLabel(model: PlanModel, beam: Beam): string {
  return model.beamTypes.find((t) => t.id === beam.typeId)?.label ?? beam.id;
}

/** Convenience for the panel headers. */
export function summariseBearing(bearing: BeamBearing[]): { total: number; failing: number } {
  return { total: bearing.length, failing: bearing.filter((b) => !b.pass).length };
}
