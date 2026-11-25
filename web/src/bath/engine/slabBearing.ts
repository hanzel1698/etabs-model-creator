/**
 * The slab half of the catch check, answered in plan.
 *
 * `checks.ts` asks the same question along a section line, and only about the
 * two beams that line happens to cut. A slab is caught on ALL of its sides or
 * it is not caught at all, and three of those four sides are routinely nowhere
 * near the section — so a bathroom sink can be perfectly detailed on A-A and
 * still be hanging off the beam behind it. This file asks the question of every
 * side of every panel, on the plan, where all four are visible.
 *
 * The panels are the faces of the beam network (`faces.ts`), so every side of a
 * panel already names the beam whose centreline bounds it. The verdict per side
 * is the same pair of faces `checks.ts` uses, in the same down-positive levels:
 *
 *     top     topMargin = slabTop    - beamTop      PASS when >= 0
 *     soffit  margin    = beamSoffit - slabSoffit   PASS when >= 0
 *
 * The top face is what the slab bears on: a beam cast lower than the slab beside
 * it leaves that slab with nothing under its edge. The soffit face is the beam
 * reaching at least as deep as the slab does, so the slab's full thickness lands
 * on concrete rather than oversailing the beam.
 *
 * Two things are done here that the section version has no need of:
 *
 *   - Consecutive stretches of one beam are COALESCED. Face detection splits
 *     every centreline at each intersection, so a beam something else T's into
 *     from the far side reaches us as two stretches of what an engineer reads as
 *     one side of the slab. Left alone they would draw two marks down one side.
 *
 *   - Each side is then PULLED BACK to the slab's own corners. A face boundary
 *     runs along beam CENTRELINES, so its corners are buried inside the beams
 *     framing them, and a side quoted corner to corner claims a stretch of slab
 *     that is really the beam beside it. The slab starts at the face of that
 *     beam, so each end of a side stops where its own face meets the
 *     neighbouring side's — which is the corner of the slab as cast.
 *
 *   - Each side is then SPLIT wherever an upstand starts or stops. A nib cast
 *     over part of a beam raises the top only there, which is exactly how a
 *     flush slab is caught locally beside a beam run down for a sink — so the
 *     stretch under the nib passes and the rest of the same side fails, and the
 *     drawing marks only the stretch actually at fault.
 *
 * Nothing here judges whether the BEAM is caught; that is `bearing.ts`.
 */

import { deepestUpstandAt, type Nib } from './bearing';
import { panelsForModel, type FaceEdge, type Panel } from './faces';
import { beamSoffitLevel, beamTopLevel, beamWidth, resolveBeams, type BeamEnds } from './grid';
import { cross, dot, len, normalize, sub } from './planGeom';
import type { Beam, PlanModel, Pt } from './types';

/** Millimetres. Face vertices come from the same resolved centrelines, so this only absorbs float noise. */
const EPS = 1e-6;

/** One stretch of a panel's boundary, and whether the beam under it catches the slab. */
export interface SlabSide {
  beamId: string;
  beamLabel: string;
  /**
   * The stretch, along the beam's centreline, in the panel's own ring order —
   * already pulled back at both ends to where the slab really starts, so it
   * never claims the beams framing into this side.
   */
  a: Pt;
  b: Pt;
  /** Midpoint of that stretch — where a callout points. */
  mid: Pt;
  /** Unit normal pointing INTO the panel, for placing a mark inside the slab. */
  inward: Pt;
  /**
   * Half the beam's breadth: how far inside the centreline the slab really
   * starts. The check does not use it — a drawing does, to put a mark on the
   * slab rather than down the middle of the beam.
   */
  inset: number;
  /** Effective top of the beam here, with any upstand over this stretch folded in. */
  beamTop: number;
  beamSoffit: number;
  /** slabTop - beamTop. Negative means the beam is cast past the slab it should carry. */
  topMargin: number;
  /** beamSoffit - slabSoffit. Negative means the beam stops short of the slab soffit. */
  margin: number;
  topPass: boolean;
  soffitPass: boolean;
  /** Both faces. */
  pass: boolean;
  /** Set when an upstand covers this stretch and raised the top used above. */
  upstandLabel?: string;
  /** Short phrase for the plan callout. Empty when the side passes. */
  note: string;
}

export interface SlabBearing {
  panelId: string;
  slabTypeId: string;
  label: string;
  slabTop: number;
  slabSoffit: number;
  centroid: Pt;
  /** Every stretch of the boundary, in ring order. */
  sides: SlabSide[];
  /** Caught on all four sides — or however many the panel has. */
  pass: boolean;
  /** Full sentences, one per failing side. */
  warnings: string[];
}

/**
 * `panels` is taken as an argument because the plan has already detected them
 * to draw them; recomputing here would run face detection twice per edit.
 */
export function checkSlabBearing(
  model: PlanModel,
  resolved: Map<string, BeamEnds> = resolveBeams(model),
  panels: Panel[] = panelsForModel(model, resolved),
): SlabBearing[] {
  return panels.flatMap((panel) => {
    // A duct is an opening, not a thin slab: there is no concrete to be caught,
    // so its sides are not judged at all rather than judged and passed.
    if (panel.slabTypeId === null) return [];
    // An assignment pointing at a slab type that has since been deleted leaves
    // nothing to check the sides against, so the panel is passed over rather
    // than reported as uncaught.
    const slab = model.slabTypes.find((s) => s.id === panel.slabTypeId);
    if (!slab) return [];

    const slabTop = slab.sink;
    const slabSoffit = slab.sink + slab.thickness;
    // Every side is pulled back against its two neighbours, so the whole ring
    // has to be laid out before any of it can be judged.
    const ring = boundaries(model, coalesce(panel.edges));
    const sides = ring.flatMap((side, i) =>
      sidesAlong(
        model,
        resolved,
        pullBackToSlab(
          side,
          ring[(i - 1 + ring.length) % ring.length]!,
          ring[(i + 1) % ring.length]!,
        ),
        slabTop,
        slabSoffit,
      ),
    );

    return [
      {
        panelId: panel.id,
        slabTypeId: panel.slabTypeId,
        label: slab.label,
        slabTop,
        slabSoffit,
        centroid: panel.centroid,
        sides,
        pass: sides.every((s) => s.pass),
        warnings: sides
          .filter((s) => !s.pass)
          .map((s) => sentence(slab.label, s, slabTop, slabSoffit)),
      },
    ];
  });
}

/**
 * Merge consecutive boundary stretches running along the same beam — see the
 * note at the top of the file. The ring wraps, so a run straddling the start of
 * the list is still one side.
 */
export function coalesce(edges: FaceEdge[]): FaceEdge[] {
  const out: FaceEdge[] = [];
  for (const edge of edges) {
    const last = out[out.length - 1];
    if (last && last.beamId === edge.beamId) out[out.length - 1] = { ...last, b: edge.b };
    else out.push({ ...edge });
  }
  // The last stretch ends where the first begins — that is what makes it a ring
  // — so a wrapped run is contiguous by construction and needs no further test.
  if (out.length > 1 && out[0]!.beamId === out[out.length - 1]!.beamId) {
    const wrapped = out.pop()!;
    out[0] = { ...out[0]!, a: wrapped.a };
  }
  return out;
}

/** One side of a panel, with the geometry the steps below need of it. */
interface Boundary {
  beam: Beam;
  /** Ends of the stretch of centreline it runs along, in the ring's own order. */
  a: Pt;
  b: Pt;
  /** Unit vector from `a` to `b`. */
  dir: Pt;
  /** Unit normal pointing into the panel. */
  inward: Pt;
  /** Half the beam's breadth — how far off the centreline the slab starts. */
  half: number;
}

/**
 * Lay a coalesced boundary out as sides. Stretches whose beam has gone or which
 * have no length are dropped: a face is built from resolved centrelines, so
 * neither should reach here, and a side with no direction has no slab edge to
 * pull anything back to.
 */
function boundaries(model: PlanModel, edges: FaceEdge[]): Boundary[] {
  return edges.flatMap((edge) => {
    const beam = model.beams.find((b) => b.id === edge.beamId);
    if (!beam) return [];
    const span = sub(edge.b, edge.a);
    if (len(span) < EPS) return [];
    const dir = normalize(span);
    return [
      {
        beam,
        a: edge.a,
        b: edge.b,
        dir,
        // Faces come out counter-clockwise, so the panel is to the LEFT of every
        // one of its edges taken in ring order.
        inward: { x: -dir.y, y: dir.x },
        half: beamWidth(model, beam) / 2,
      },
    ];
  });
}

/**
 * Pull a side back from the centreline corners it was detected at to the corners
 * of the slab itself.
 *
 * Each end stops where this side's own face crosses the neighbouring side's
 * face — the point the concrete of the two beams actually meets at, and where an
 * engineer would dimension the slab from. A beam framing in at a skew is
 * therefore cleared by more than half its breadth, which is right: the face it
 * presents to this side is longer than its breadth.
 */
function pullBackToSlab(side: Boundary, previous: Boundary, next: Boundary): Boundary {
  const length = len(sub(side.b, side.a));
  const from = faceCrossing(side, previous, side.a);
  const to = length + faceCrossing(side, next, side.b);

  // Wider framing than there is side to give up leaves nothing to mark; the
  // untrimmed stretch is the lesser of the two evils, as it is when a beam
  // rectangle is trimmed back to the faces it lands on.
  if (to - from < EPS) return side;

  return {
    ...side,
    a: { x: side.a.x + side.dir.x * from, y: side.a.y + side.dir.y * from },
    b: { x: side.a.x + side.dir.x * to, y: side.a.y + side.dir.y * to },
  };
}

/**
 * Where the neighbour's face crosses this side's face, as a distance along this
 * side's centreline from `corner` — negative when it lies back the way it came.
 *
 * Both faces are the centrelines offset inward by their own half breadths, so
 * the answer is one line-line intersection between them. Parallel sides never
 * cross, and give up nothing.
 */
function faceCrossing(side: Boundary, neighbour: Boundary, corner: Pt): number {
  const denom = cross(side.dir, neighbour.dir);
  if (Math.abs(denom) < 1e-9) return 0;
  const theirs = {
    x: corner.x + neighbour.inward.x * neighbour.half,
    y: corner.y + neighbour.inward.y * neighbour.half,
  };
  const ours = {
    x: corner.x + side.inward.x * side.half,
    y: corner.y + side.inward.y * side.half,
  };
  return cross(sub(theirs, ours), neighbour.dir) / denom;
}

/** The verdicts along one side of a panel: one per stretch of constant beam top. */
function sidesAlong(
  model: PlanModel,
  resolved: Map<string, BeamEnds>,
  side: Boundary,
  slabTop: number,
  slabSoffit: number,
): SlabSide[] {
  const beam = side.beam;
  const ends = resolved.get(beam.id);
  if (!ends) return [];

  const span = sub(side.b, side.a);
  const inward = side.inward;
  const inset = side.half;

  const beamLabel = model.beamTypes.find((t) => t.id === beam.typeId)?.label ?? beam.id;
  const top = beamTopLevel(beam);
  const beamSoffit = beamSoffitLevel(model, beam);

  return upstandStretches(model, ends, side).map(({ s0, s1, nib }) => {
    const a = { x: side.a.x + span.x * s0, y: side.a.y + span.y * s0 };
    const b = { x: side.a.x + span.x * s1, y: side.a.y + span.y * s1 };
    // A nib is material cast on the beam's top, so it is what the slab actually
    // lands on — the same substitution `checks.ts` makes at a section crossing.
    const beamTop = top - (nib?.depth ?? 0);
    const topMargin = slabTop - beamTop;
    const margin = beamSoffit - slabSoffit;
    const topPass = topMargin >= 0;
    const soffitPass = margin >= 0;

    return {
      beamId: beam.id,
      beamLabel,
      a,
      b,
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      inward,
      inset,
      beamTop,
      beamSoffit,
      topMargin,
      margin,
      topPass,
      soffitPass,
      pass: topPass && soffitPass,
      ...(nib ? { upstandLabel: nib.label } : {}),
      note: note(topMargin, margin),
    };
  });
}

/**
 * Break one side into stretches of constant beam top, at the fractions along it
 * where an upstand on that beam starts or stops.
 *
 * Fractions are of the SIDE, from its own `a` to its own `b`, so the caller can
 * interpolate without knowing which way round the beam beneath it runs.
 */
function upstandStretches(
  model: PlanModel,
  ends: BeamEnds,
  side: Boundary,
): { s0: number; s1: number; nib: Nib | null }[] {
  const whole = [{ s0: 0, s1: 1, nib: null }];

  const nibs = model.upstands.filter((u) => u.beamId === side.beam.id);
  if (nibs.length === 0) return whole;

  const along = sub(ends.end, ends.start);
  const beamLength = len(along);
  if (beamLength < EPS) return whole;
  const beamDir = normalize(along);
  const paramAt = (p: Pt) => dot(beamDir, sub(p, ends.start)) / beamLength;

  // A side is a piece of the beam's own centreline, so its two ends give the
  // stretch of that beam this panel is bounded by.
  const ta = paramAt(side.a);
  const tb = paramAt(side.b);
  if (Math.abs(tb - ta) < EPS) return whole;

  const cuts = new Set([0, 1]);
  for (const nib of nibs) {
    for (const t of [nib.t0, nib.t1]) {
      const s = (t - ta) / (tb - ta);
      if (s > EPS && s < 1 - EPS) cuts.add(s);
    }
  }

  const sorted = [...cuts].sort((p, q) => p - q);
  const out: { s0: number; s1: number; nib: Nib | null }[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const s0 = sorted[i]!;
    const s1 = sorted[i + 1]!;
    if (s1 - s0 < EPS) continue;
    // Sampled at the middle of the stretch, which by construction is either
    // wholly under a nib or wholly clear of one.
    const at = ta + (tb - ta) * ((s0 + s1) / 2);
    out.push({ s0, s1, nib: deepestUpstandAt(model, side.beam.id, at) });
  }
  return out.length ? out : whole;
}

function note(topMargin: number, margin: number): string {
  const faults: string[] = [];
  if (topMargin < 0) faults.push(`beam top ${Math.round(-topMargin)} too low`);
  if (margin < 0) faults.push(`soffit ${Math.round(-margin)} short`);
  return faults.join(', ');
}

function sentence(slabLabel: string, side: SlabSide, slabTop: number, slabSoffit: number): string {
  const on = side.upstandLabel ? `${side.beamLabel} + ${side.upstandLabel}` : side.beamLabel;
  const faults: string[] = [];
  if (!side.topPass) {
    faults.push(
      `its top (${side.beamTop}) is ${Math.round(-side.topMargin)} below the slab top (${slabTop}), ` +
        `so the slab has nothing to bear on`,
    );
  }
  if (!side.soffitPass) {
    faults.push(
      `its soffit (${side.beamSoffit}) stops ${Math.round(-side.margin)} above the slab soffit ` +
        `(${slabSoffit}), so the slab oversails it`,
    );
  }
  return `${slabLabel} is not caught along ${on}: ${faults.join(', and ')}.`;
}
