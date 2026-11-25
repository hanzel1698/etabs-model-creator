/**
 * Slab panels, detected automatically from the beam network.
 *
 * Panels are never drawn by hand. Beam centrelines form a planar graph and the
 * enclosed faces of that graph are the panels — which is exactly how the plan
 * reads to an engineer: the beams frame the slab, so the beams define it.
 *
 * The pipeline is the textbook one:
 *   1. split every centreline at its intersections with the others
 *   2. snap coincident endpoints into shared vertices
 *   3. sort the half-edges radially around each vertex
 *   4. walk faces by always taking the most clockwise turn
 *
 * The outer boundary of each connected component falls out of step 4 with a
 * negative signed area, so discarding negative-area cycles drops it without
 * needing a special case. A beam with a free end is traversed in both
 * directions inside the same cycle and contributes zero net area, so it
 * correctly produces no panel of its own.
 */

import { resolveBeams, type BeamEnds } from './grid';
import { polygonArea, polygonCentroid, pointInPolygon } from './planGeom';
import type { PlanModel, Pt } from './types';

/** Vertices closer than this (mm) are the same point. Well below drafting precision. */
const SNAP = 0.01;
/** Cycles smaller than this (mm^2) are float noise, not panels. */
const MIN_AREA = 1;

interface Segment {
  a: Pt;
  b: Pt;
  beamId: string;
}

/**
 * One stretch of a face's boundary, and the beam whose centreline it runs
 * along. Stretches are in ring order, each starting where the last ended, so
 * `edges[i]` runs from `polygon[i]` to `polygon[i + 1]`.
 *
 * Split points are intersections, not sides: a beam that another one T's into
 * from the far side arrives here as two consecutive stretches of what reads as
 * one side of the panel. Callers that want sides rather than stretches have to
 * coalesce runs sharing a `beamId` themselves.
 */
export interface FaceEdge {
  a: Pt;
  b: Pt;
  beamId: string;
}

export interface Face {
  id: string;
  polygon: Pt[];
  /** The boundary, in the same order as `polygon`. */
  edges: FaceEdge[];
  /** Beams whose centrelines bound this face. */
  beamIds: string[];
  area: number;
  centroid: Pt;
}

export interface Panel extends Face {
  /** Null where the panel has been tagged as a duct — an opening, with no slab in it. */
  slabTypeId: string | null;
  /** The assignment this panel picked up, if the user has tagged it. */
  assignmentId: string | null;
}

function key(p: Pt): string {
  return `${Math.round(p.x / SNAP)},${Math.round(p.y / SNAP)}`;
}

function cross2(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

/**
 * Parameters along each segment where it meets another, covering proper
 * crossings and T-junctions. Collinear beams that merely touch end-to-end need
 * no split because they already share a vertex.
 */
function splitParameters(segments: Segment[]): number[][] {
  const params: number[][] = segments.map(() => [0, 1]);

  const addParam = (i: number, t: number) => {
    if (t > 1e-9 && t < 1 - 1e-9) params[i]!.push(t);
  };

  for (let i = 0; i < segments.length; i++) {
    const s1 = segments[i]!;
    const d1x = s1.b.x - s1.a.x;
    const d1y = s1.b.y - s1.a.y;

    for (let j = i + 1; j < segments.length; j++) {
      const s2 = segments[j]!;
      const d2x = s2.b.x - s2.a.x;
      const d2y = s2.b.y - s2.a.y;

      const denom = cross2(d1x, d1y, d2x, d2y);
      const rx = s2.a.x - s1.a.x;
      const ry = s2.a.y - s1.a.y;

      if (Math.abs(denom) > 1e-9) {
        const t = cross2(rx, ry, d2x, d2y) / denom;
        const u = cross2(rx, ry, d1x, d1y) / denom;
        if (t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) {
          addParam(i, t);
          addParam(j, u);
        }
        continue;
      }

      // Parallel. Only collinear pairs can interact, and then only by one
      // segment's endpoint landing inside the other.
      if (Math.abs(cross2(rx, ry, d1x, d1y)) > 1e-6) continue;

      const len1Sq = d1x * d1x + d1y * d1y;
      const len2Sq = d2x * d2x + d2y * d2y;
      if (len1Sq > 1e-12) {
        addParam(i, (rx * d1x + ry * d1y) / len1Sq);
        addParam(i, ((s2.b.x - s1.a.x) * d1x + (s2.b.y - s1.a.y) * d1y) / len1Sq);
      }
      if (len2Sq > 1e-12) {
        addParam(j, ((s1.a.x - s2.a.x) * d2x + (s1.a.y - s2.a.y) * d2y) / len2Sq);
        addParam(j, ((s1.b.x - s2.a.x) * d2x + (s1.b.y - s2.a.y) * d2y) / len2Sq);
      }
    }
  }

  return params;
}

interface HalfEdge {
  from: string;
  to: string;
  angle: number;
  beamId: string;
  twin: number;
}

/** Detect the enclosed faces of a set of centrelines. */
export function facesFromSegments(input: Segment[]): Face[] {
  const segments = input.filter((s) => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) > SNAP);
  if (segments.length === 0) return [];

  // 1 + 2: split at intersections and snap into shared vertices.
  const params = splitParameters(segments);
  const points = new Map<string, Pt>();
  const halfEdges: HalfEdge[] = [];

  const vertex = (p: Pt): string => {
    const k = key(p);
    if (!points.has(k)) points.set(k, p);
    return k;
  };

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const ts = [...new Set(params[i]!.map((t) => Math.min(1, Math.max(0, t))))].sort((a, b) => a - b);

    for (let k = 0; k < ts.length - 1; k++) {
      const t0 = ts[k]!;
      const t1 = ts[k + 1]!;
      const p0 = { x: seg.a.x + (seg.b.x - seg.a.x) * t0, y: seg.a.y + (seg.b.y - seg.a.y) * t0 };
      const p1 = { x: seg.a.x + (seg.b.x - seg.a.x) * t1, y: seg.a.y + (seg.b.y - seg.a.y) * t1 };
      if (Math.hypot(p1.x - p0.x, p1.y - p0.y) < SNAP) continue;

      const v0 = vertex(p0);
      const v1 = vertex(p1);
      if (v0 === v1) continue;

      const idx = halfEdges.length;
      halfEdges.push({
        from: v0,
        to: v1,
        angle: Math.atan2(p1.y - p0.y, p1.x - p0.x),
        beamId: seg.beamId,
        twin: idx + 1,
      });
      halfEdges.push({
        from: v1,
        to: v0,
        angle: Math.atan2(p0.y - p1.y, p0.x - p1.x),
        beamId: seg.beamId,
        twin: idx,
      });
    }
  }

  if (halfEdges.length === 0) return [];

  // 3: radial order around each vertex, counter-clockwise.
  const around = new Map<string, number[]>();
  halfEdges.forEach((he, idx) => {
    const list = around.get(he.from);
    if (list) list.push(idx);
    else around.set(he.from, [idx]);
  });
  for (const list of around.values()) {
    list.sort((a, b) => halfEdges[a]!.angle - halfEdges[b]!.angle);
  }

  const positionInFan = new Map<number, number>();
  for (const list of around.values()) {
    list.forEach((idx, at) => positionInFan.set(idx, at));
  }

  // 4: walk faces, always taking the most clockwise turn. From the half-edge
  // that reverses the one we arrived on, step back one place in the CCW fan.
  const visited = new Array<boolean>(halfEdges.length).fill(false);
  const faces: Face[] = [];

  for (let start = 0; start < halfEdges.length; start++) {
    if (visited[start]) continue;

    const cycle: number[] = [];
    let current = start;
    while (!visited[current]) {
      visited[current] = true;
      cycle.push(current);

      const twin = halfEdges[current]!.twin;
      const fan = around.get(halfEdges[twin]!.from)!;
      const at = positionInFan.get(twin)!;
      current = fan[(at - 1 + fan.length) % fan.length]!;
    }
    if (cycle.length < 3) continue;

    const polygon = cycle.map((idx) => points.get(halfEdges[idx]!.from)!);
    const area = polygonArea(polygon);
    // The outer boundary of every connected component comes out clockwise.
    if (area <= MIN_AREA) continue;

    // Each half-edge in the cycle starts where the last one ended, so the walk
    // itself pairs polygon vertex i with the beam behind the edge leaving it.
    const edges: FaceEdge[] = cycle.map((idx, i) => ({
      a: polygon[i]!,
      b: polygon[(i + 1) % polygon.length]!,
      beamId: halfEdges[idx]!.beamId,
    }));
    const beamIds = [...new Set(cycle.map((idx) => halfEdges[idx]!.beamId))];
    faces.push({
      id: faceId(cycle.map((idx) => halfEdges[idx]!.from)),
      polygon,
      edges,
      beamIds,
      area,
      centroid: polygonCentroid(polygon),
    });
  }

  return faces;
}

/** Order-independent id, so a face keeps its React key as the walk start varies. */
function faceId(vertexKeys: string[]): string {
  const joined = [...vertexKeys].sort().join('|');
  let hash = 5381;
  for (let i = 0; i < joined.length; i++) {
    hash = ((hash << 5) + hash + joined.charCodeAt(i)) >>> 0;
  }
  return `f${hash.toString(36)}`;
}

export function facesForModel(model: PlanModel, resolved?: Map<string, BeamEnds>): Face[] {
  const ends = resolved ?? resolveBeams(model);
  const segments: Segment[] = [];
  for (const beam of model.beams) {
    const e = ends.get(beam.id);
    if (e) segments.push({ a: e.start, b: e.end, beamId: beam.id });
  }
  return facesFromSegments(segments);
}

/**
 * Attach slab types to the detected faces.
 *
 * Tags are stored as seed points rather than face ids: faces are recomputed from
 * scratch on every edit and have no identity that survives moving a grid line,
 * whereas a point inside a panel stays inside it. Where several seeds land in
 * one face the most recent wins, which is what re-tagging a panel should do.
 *
 * A claimed assignment's `slabTypeId` is used as it stands, null included: null
 * is the duct tag, and defaulting it would quietly fill the opening back in.
 * Only an UNCLAIMED face falls back to the default slab type.
 */
export function panelsForModel(model: PlanModel, resolved?: Map<string, BeamEnds>): Panel[] {
  const faces = facesForModel(model, resolved);
  return faces.map((face) => {
    let claimed: PlanModel['panelAssignments'][number] | null = null;
    for (const assignment of model.panelAssignments) {
      if (pointInPolygon(assignment.seed, face.polygon)) claimed = assignment;
    }
    return {
      ...face,
      slabTypeId: claimed ? claimed.slabTypeId : model.defaultSlabTypeId,
      assignmentId: claimed?.id ?? null,
    };
  });
}

/** The panel under a plan-space point, if any. Smallest wins for nested faces. */
export function panelAt(panels: Panel[], pt: Pt): Panel | null {
  let best: Panel | null = null;
  for (const panel of panels) {
    if (pointInPolygon(pt, panel.polygon) && (!best || panel.area < best.area)) best = panel;
  }
  return best;
}
