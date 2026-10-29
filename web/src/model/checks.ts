import type { Beam, Column, FrameSection, Model, Pt, Slab } from './types';
import { add, cross, dist, distToSeg, dot, fmt, len, mid, pointInPoly, polyArea, rot, segIntersect, sub } from './geom';

/** Points closer than this (mm) are the same point; overlaps thinner than this are touching, not overlapping. */
export const TOL = 1;
/** Slabs smaller than this (mm²) are treated as degenerate. */
const MIN_SLAB_AREA = 10_000;

export type IssueKind = 'duplicate' | 'overlap' | 'degenerate' | 'section' | 'story';
export interface Issue {
  kind: IssueKind;
  story: string; // '' when the issue spans stories
  ids: string[];
  text: string;
  at: Pt; // where to look
}

/** Stable identity of an issue, to tell new ones from ones already reported. */
export const issueKey = (i: Issue) => i.kind + '|' + [...i.ids].sort().join(',');

type Box = { minX: number; minY: number; maxX: number; maxY: number };
const boxOf = (pts: Pt[]): Box => ({
  minX: Math.min(...pts.map((p) => p.x)),
  minY: Math.min(...pts.map((p) => p.y)),
  maxX: Math.max(...pts.map((p) => p.x)),
  maxY: Math.max(...pts.map((p) => p.y)),
});

/** Calls fn for every pair whose boxes come within TOL of each other (sweep along X). */
function eachPair<T>(items: T[], box: (x: T) => Box, fn: (a: T, b: T) => void) {
  const xs = items.map((x) => ({ x, b: box(x) })).sort((p, q) => p.b.minX - q.b.minX);
  for (let i = 0; i < xs.length; i++) {
    const a = xs[i];
    for (let j = i + 1; j < xs.length && xs[j].b.minX <= a.b.maxX + TOL; j++) {
      const b = xs[j];
      if (b.b.minY > a.b.maxY + TOL || b.b.maxY < a.b.minY - TOL) continue;
      fn(a.x, b.x);
    }
  }
}

/** Joins pairs into clusters (three copies of a column make one issue, not three). */
function clusters(pairs: [string, string][]): string[][] {
  const up = new Map<string, string>();
  const find = (x: string): string => {
    const p = up.get(x) ?? x;
    if (p === x) return x;
    const r = find(p);
    up.set(x, r);
    return r;
  };
  for (const [a, b] of pairs) {
    const ra = find(a),
      rb = find(b);
    up.set(rb, rb);
    if (ra !== rb) up.set(ra, rb);
  }
  const out = new Map<string, string[]>();
  for (const id of up.keys()) {
    const r = find(id);
    out.set(r, [...(out.get(r) ?? []), id]);
  }
  return [...out.values()];
}

const xy = (p: Pt) => `X ${fmt(p.x)} Y ${fmt(p.y)}`;
const byStory = <T extends { story: string }>(arr: T[]) => {
  const out = new Map<string, T[]>();
  for (const x of arr) out.set(x.story, [...(out.get(x.story) ?? []), x]);
  return out;
};

// ---------------- columns ----------------

function columnOutline(c: Column, sec?: FrameSection): Pt[] {
  if (sec?.shape === 'Circle') {
    const r = (sec.t3 || 400) / 2;
    return Array.from({ length: 16 }, (_, i) => ({ x: c.x + r * Math.cos((i * Math.PI) / 8), y: c.y + r * Math.sin((i * Math.PI) / 8) }));
  }
  const d = sec?.t3 || 400,
    w = sec?.t2 || 400;
  return [
    { x: -d / 2, y: -w / 2 },
    { x: d / 2, y: -w / 2 },
    { x: d / 2, y: w / 2 },
    { x: -d / 2, y: w / 2 },
  ].map((p) => add(rot(p, c.angle), c));
}

/** Convex outlines overlap by more than TOL (faces that only touch don't count). */
function convexOverlap(a: Pt[], b: Pt[]) {
  for (const P of [a, b])
    for (let i = 0; i < P.length; i++) {
      const e = sub(P[(i + 1) % P.length], P[i]);
      const n = { x: -e.y / (len(e) || 1), y: e.x / (len(e) || 1) };
      const pa = a.map((p) => dot(p, n)),
        pb = b.map((p) => dot(p, n));
      if (Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb)) <= TOL) return false;
    }
  return true;
}

function checkColumns(m: Model, story: string, cols: Column[], out: Issue[]) {
  const secs = new Map(m.frameSections.map((s) => [s.name, s]));
  const outline = new Map(cols.map((c) => [c.id, columnOutline(c, secs.get(c.section))]));
  const byId = new Map(cols.map((c) => [c.id, c]));
  const same: [string, string][] = [];
  const lap: [Column, Column][] = [];
  eachPair(cols, (c) => boxOf(outline.get(c.id)!), (a, b) => {
    if (dist(a, b) <= TOL) same.push([a.id, b.id]);
    else if (convexOverlap(outline.get(a.id)!, outline.get(b.id)!)) lap.push([a, b]);
  });
  const dup = clusters(same);
  for (const ids of dup) {
    const c = byId.get(ids[0])!;
    out.push({ kind: 'duplicate', story, ids, at: c, text: `${ids.length} columns at the same point (${xy(c)})` });
  }
  // a pair already reported as copies of each other isn't also an overlap
  const dupOf = new Map(dup.flatMap((ids) => ids.map((id) => [id, ids[0]] as const)));
  const seen = new Set<string>();
  for (const [a, b] of lap) {
    const k = [dupOf.get(a.id) ?? a.id, dupOf.get(b.id) ?? b.id].sort().join();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ kind: 'overlap', story, ids: [a.id, b.id], at: mid(a, b), text: `Columns overlap: ${a.section} and ${b.section}, ${fmt(dist(a, b))} mm apart (${xy(mid(a, b))})` });
  }
}

// ---------------- beams ----------------

const ends = (b: Beam): [Pt, Pt] => [
  { x: b.x1, y: b.y1 },
  { x: b.x2, y: b.y2 },
];

/** Length two beams share along a common line, or 0 when they aren't collinear. */
function sharedLength(a: Beam, b: Beam): { L: number; at: Pt } {
  const [a1, a2] = ends(a),
    [b1, b2] = ends(b);
  const L = dist(a1, a2);
  if (L <= TOL) return { L: 0, at: a1 };
  const u = { x: (a2.x - a1.x) / L, y: (a2.y - a1.y) / L };
  if (Math.abs(cross(u, sub(b1, a1))) > TOL || Math.abs(cross(u, sub(b2, a1))) > TOL) return { L: 0, at: a1 };
  const t1 = dot(u, sub(b1, a1)),
    t2 = dot(u, sub(b2, a1));
  const lo = Math.max(0, Math.min(t1, t2)),
    hi = Math.min(L, Math.max(t1, t2));
  const t = (lo + hi) / 2;
  return { L: hi - lo, at: { x: a1.x + u.x * t, y: a1.y + u.y * t } };
}

function checkBeams(story: string, beams: Beam[], out: Issue[]) {
  const live: Beam[] = [];
  for (const b of beams) {
    const [p, q] = ends(b);
    if (dist(p, q) <= TOL) out.push({ kind: 'degenerate', story, ids: [b.id], at: p, text: `Zero-length beam ${b.section} (${xy(p)})` });
    else live.push(b);
  }
  const byId = new Map(live.map((b) => [b.id, b]));
  const same: [string, string][] = [];
  const lap: { a: Beam; b: Beam; L: number; at: Pt }[] = [];
  eachPair(live, (b) => boxOf(ends(b)), (a, b) => {
    const [a1, a2] = ends(a),
      [b1, b2] = ends(b);
    if ((dist(a1, b1) <= TOL && dist(a2, b2) <= TOL) || (dist(a1, b2) <= TOL && dist(a2, b1) <= TOL)) return void same.push([a.id, b.id]);
    const s = sharedLength(a, b);
    if (s.L > TOL) lap.push({ a, b, ...s });
  });
  const dup = clusters(same);
  for (const ids of dup) {
    const b = byId.get(ids[0])!;
    const [p, q] = ends(b);
    out.push({ kind: 'duplicate', story, ids, at: mid(p, q), text: `${ids.length} beams on top of each other, ${fmt(dist(p, q))} mm long (${xy(mid(p, q))})` });
  }
  const dupOf = new Map(dup.flatMap((ids) => ids.map((id) => [id, ids[0]] as const)));
  const seen = new Set<string>();
  for (const { a, b, L, at } of lap) {
    const k = [dupOf.get(a.id) ?? a.id, dupOf.get(b.id) ?? b.id].sort().join();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ kind: 'overlap', story, ids: [a.id, b.id], at, text: `Beams overlap for ${fmt(L)} mm (${xy(at)})` });
  }
}

// ---------------- slabs ----------------

const edges = (P: Pt[]) => P.map((p, i) => [p, P[(i + 1) % P.length]] as const);
const onBoundary = (p: Pt, P: Pt[]) => edges(P).some(([a, b]) => distToSeg(p, a, b) <= TOL);
const strictlyInside = (p: Pt, P: Pt[]) => pointInPoly(p, P) && !onBoundary(p, P);

/** A point inside the polygon: middle of the first span of a scanline that misses every vertex. */
export function interiorPoint(P: Pt[]): Pt | null {
  const ys = [...new Set(P.map((p) => p.y))].sort((a, b) => a - b);
  let y = NaN,
    gap = -1;
  for (let i = 1; i < ys.length; i++) if (ys[i] - ys[i - 1] > gap) (gap = ys[i] - ys[i - 1]), (y = (ys[i] + ys[i - 1]) / 2);
  if (!(gap > 0)) return null;
  const xs: number[] = [];
  for (const [a, b] of edges(P)) if (a.y > y !== b.y > y) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
  xs.sort((a, b) => a - b);
  return xs.length >= 2 ? { x: (xs[0] + xs[1]) / 2, y } : null;
}

const sameOutline = (A: Pt[], B: Pt[]) => A.every((p) => B.some((q) => dist(p, q) <= TOL)) && B.every((p) => A.some((q) => dist(p, q) <= TOL));

/** Interiors of two simple polygons share area. Returns a point in the shared area, or null. */
function slabOverlap(A: Pt[], B: Pt[]): Pt | null {
  // boundaries crossing away from any vertex
  for (const [a1, a2] of edges(A))
    for (const [b1, b2] of edges(B)) {
      const x = segIntersect(a1, a2, b1, b2);
      if (x && [a1, a2, b1, b2].every((v) => dist(v, x.p) > TOL)) return x.p;
    }
  // one outline (vertex, edge middle or an inside point) reaching into the other
  for (const [P, Q] of [
    [A, B],
    [B, A],
  ]) {
    const probes = [...P, ...edges(P).map(([a, b]) => mid(a, b))];
    const inner = interiorPoint(P);
    if (inner) probes.push(inner);
    const hit = probes.find((p) => strictlyInside(p, Q));
    if (hit) return hit;
  }
  return null;
}

function checkSlabs(story: string, slabs: Slab[], out: Issue[]) {
  const live: Slab[] = [];
  for (const s of slabs) {
    if (s.pts.length < 3 || Math.abs(polyArea(s.pts)) < MIN_SLAB_AREA) out.push({ kind: 'degenerate', story, ids: [s.id], at: s.pts[0] ?? { x: 0, y: 0 }, text: `Slab ${s.section} has no area (${s.pts.length} points)` });
    else live.push(s);
  }
  const byId = new Map(live.map((s) => [s.id, s]));
  const same: [string, string][] = [];
  const lap: { a: Slab; b: Slab; at: Pt }[] = [];
  eachPair(live, (s) => boxOf(s.pts), (a, b) => {
    if (sameOutline(a.pts, b.pts)) return void same.push([a.id, b.id]);
    const at = slabOverlap(a.pts, b.pts);
    if (at) lap.push({ a, b, at });
  });
  const dup = clusters(same);
  for (const ids of dup) {
    const s = byId.get(ids[0])!;
    const at = interiorPoint(s.pts) ?? s.pts[0];
    out.push({ kind: 'duplicate', story, ids, at, text: `${ids.length} slabs with the same outline, ${fmt(Math.abs(polyArea(s.pts)) / 1e6, 2)} m² (${xy(at)})` });
  }
  const dupOf = new Map(dup.flatMap((ids) => ids.map((id) => [id, ids[0]] as const)));
  const seen = new Set<string>();
  for (const { a, b, at } of lap) {
    const k = [dupOf.get(a.id) ?? a.id, dupOf.get(b.id) ?? b.id].sort().join();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ kind: 'overlap', story, ids: [a.id, b.id], at, text: `Slabs overlap: ${a.section} and ${b.section} (${xy(at)})` });
  }
}

// ---------------- whole model ----------------

/** Duplicates, overlaps, zero-size elements, undefined sections and missing stories, bottom story first. */
export function checkModel(m: Model): Issue[] {
  const out: Issue[] = [];
  const cols = byStory(m.columns),
    beams = byStory(m.beams),
    slabs = byStory(m.slabs);
  for (const st of m.stories) {
    checkColumns(m, st.name, cols.get(st.name) ?? [], out);
    checkBeams(st.name, beams.get(st.name) ?? [], out);
    checkSlabs(st.name, slabs.get(st.name) ?? [], out);
  }

  const stories = new Set(m.stories.map((s) => s.name));
  const lost = [...m.columns, ...m.beams, ...m.slabs].filter((x) => !stories.has(x.story));
  for (const [story, els] of byStory(lost)) {
    const first = els[0] as any;
    out.push({ kind: 'story', story: '', ids: els.map((x) => x.id), at: first.pts?.[0] ?? { x: first.x ?? first.x1, y: first.y ?? first.y1 }, text: `${els.length} elements on story “${story}”, which doesn't exist` });
  }

  const frames = new Set(m.frameSections.map((s) => s.name)),
    areas = new Set(m.slabSections.map((s) => s.name));
  const missing = new Map<string, { ids: string[]; at: Pt; story: string }>();
  const note = (sec: string, id: string, at: Pt, story: string) => {
    const e = missing.get(sec);
    if (e) e.ids.push(id);
    else missing.set(sec, { ids: [id], at, story });
  };
  for (const c of m.columns) if (!frames.has(c.section)) note(c.section, c.id, c, c.story);
  for (const b of m.beams) if (!frames.has(b.section)) note(b.section, b.id, { x: b.x1, y: b.y1 }, b.story);
  for (const s of m.slabs) if (!areas.has(s.section)) note(s.section, s.id, s.pts[0] ?? { x: 0, y: 0 }, s.story);
  for (const [sec, e] of missing) out.push({ kind: 'section', story: e.story, ids: e.ids, at: e.at, text: `Section “${sec}” is not defined (${e.ids.length} element${e.ids.length === 1 ? '' : 's'})` });

  return out;
}

let cache: { m: Model; issues: Issue[] } | null = null;
/** checkModel, kept while the model object doesn't change. */
export function modelIssues(m: Model): Issue[] {
  if (cache?.m !== m) cache = { m, issues: checkModel(m) };
  return cache.issues;
}
