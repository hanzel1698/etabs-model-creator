import type { Beam, Column, Grid, Model, Pt, Slab } from './types';
import { uid } from './types';
import { alphaLabel, dist, lineIntersect, polyArea, pointInPoly, segIntersect, sub, cross } from './geom';

const TOL = 1; // mm, coincidence tolerance

// ---------- grids ----------

export interface GridGenSpec {
  xSpacing: number[];
  ySpacing: number[];
  x0: number;
  y0: number;
  xLabelStart: string; // 'A' or '1'
  yLabelStart: string;
  extend: number;
}

/** n consecutive labels from `start` ("A", "1", "AA", "G1", "a"...). */
function labelSeq(start: string, n: number): string[] {
  const p = parseGridLabel(start) ?? { prefix: '', kind: 'alpha' as const, value: 1, lower: false };
  return Array.from({ length: n }, (_, i) => formatLabel({ ...p, value: p.value + i }));
}

export function generateGrids(s: GridGenSpec): Grid[] {
  const xs = [s.x0];
  s.xSpacing.forEach((d) => xs.push(xs[xs.length - 1] + d));
  const ys = [s.y0];
  s.ySpacing.forEach((d) => ys.push(ys[ys.length - 1] + d));
  const minX = xs[0] - s.extend,
    maxX = xs[xs.length - 1] + s.extend;
  const minY = ys[0] - s.extend,
    maxY = ys[ys.length - 1] + s.extend;
  const xl = labelSeq(s.xLabelStart, xs.length);
  const yl = labelSeq(s.yLabelStart, ys.length);
  return [
    ...xs.map<Grid>((x, i) => ({ id: uid(), label: xl[i], dir: 'X', x1: x, y1: minY, x2: x, y2: maxY, bubble: 'both' })),
    ...ys.map<Grid>((y, i) => ({ id: uid(), label: yl[i], dir: 'Y', x1: minX, y1: y, x2: maxX, y2: y, bubble: 'both' })),
  ];
}

/** Classify a 2-point grid as X / Y / general. */
export function makeGrid(a: Pt, b: Pt, label: string): Grid {
  let dir: Grid['dir'] = 'G';
  if (Math.abs(a.x - b.x) < TOL) dir = 'X';
  else if (Math.abs(a.y - b.y) < TOL) dir = 'Y';
  return { id: uid(), label, dir, x1: a.x, y1: a.y, x2: b.x, y2: b.y, bubble: 'both' };
}

export function gridIntersections(grids: Grid[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < grids.length; i++)
    for (let j = i + 1; j < grids.length; j++) {
      const g = grids[i],
        h = grids[j];
      const r = segIntersect({ x: g.x1, y: g.y1 }, { x: g.x2, y: g.y2 }, { x: h.x1, y: h.y1 }, { x: h.x2, y: h.y2 });
      if (r) out.push(r.p);
    }
  return out;
}

/**
 * A grid label split into prefix + core + suffix, e.g. "1'" → core 1 + suffix "'",
 * "AA" → core 27 (alpha), "G3" → prefix "G" + core 3. Suffixes (primes, quotes) mark
 * intermediate grids and are ignored when continuing the sequence.
 */
export interface LabelParts {
  prefix: string;
  kind: 'num' | 'alpha';
  value: number;
  lower: boolean;
}

export function parseGridLabel(label: string): LabelParts | null {
  const m = label.trim().match(/^(.*?)(\d+|[A-Za-z]+)([^A-Za-z0-9]*)$/);
  if (!m) return null;
  const [, prefix, core] = m;
  if (/^\d+$/.test(core)) return { prefix, kind: 'num', value: parseInt(core, 10), lower: false };
  let v = 0;
  for (const ch of core.toUpperCase()) v = v * 26 + (ch.charCodeAt(0) - 64);
  return { prefix, kind: 'alpha', value: v, lower: core === core.toLowerCase() };
}

const formatLabel = (p: LabelParts) => {
  const core = p.kind === 'num' ? String(p.value) : alphaLabel(p.value - 1);
  return p.prefix + (p.lower ? core.toLowerCase() : core);
};

/**
 * Next label for a new grid in `dir`:
 * - continues the scheme of the most recently added grid in that direction ("1" → "2",
 *   "C" → "D", "1'" → "2", "G3" → "G4"), counting from the highest label of that scheme;
 * - with no grids in that direction yet, uses the opposite scheme of the other direction
 *   (letters there → numbers here, and vice versa); defaults are X = "A", Y = "1".
 */
export function nextGridLabel(grids: Grid[], dir: Grid['dir']): string {
  const same = grids.filter((g) => g.dir === dir);
  const used = new Set(same.map((g) => g.label));
  let scheme: LabelParts | null = null;
  for (let i = same.length - 1; i >= 0 && !scheme; i--) scheme = parseGridLabel(same[i].label);

  if (!scheme) {
    if (dir === 'G') scheme = { prefix: 'G', kind: 'num', value: 0, lower: false };
    else {
      const other = grids.filter((g) => g.dir === (dir === 'X' ? 'Y' : 'X'));
      let o: LabelParts | null = null;
      for (let i = other.length - 1; i >= 0 && !o; i--) o = parseGridLabel(other[i].label);
      const kind = o ? (o.kind === 'alpha' ? 'num' : 'alpha') : dir === 'X' ? 'alpha' : 'num';
      scheme = { prefix: '', kind, value: 0, lower: false };
    }
  } else {
    // continue from the highest label that follows the same scheme
    for (const g of same) {
      const p = parseGridLabel(g.label);
      if (p && p.kind === scheme.kind && p.prefix === scheme.prefix && p.value > scheme.value) scheme = { ...scheme, value: p.value };
    }
  }
  let next = { ...scheme, value: scheme.value + 1 };
  while (used.has(formatLabel(next))) next = { ...next, value: next.value + 1 };
  return formatLabel(next);
}

/** Opposite labelling scheme for the other direction: letters ↔ numbers. */
export function oppositeLabelStart(label: string): string {
  return parseGridLabel(label)?.kind === 'num' ? 'A' : '1';
}

// ---------- elements ----------

export function addColumns(m: Model, pts: Pt[], stories: string[], section: string, angle: number): Model {
  const cols = [...m.columns];
  for (const story of stories)
    for (const p of pts) {
      if (cols.some((c) => c.story === story && Math.abs(c.x - p.x) < TOL && Math.abs(c.y - p.y) < TOL)) continue;
      cols.push({ id: uid(), story, x: p.x, y: p.y, section, angle });
    }
  return cols.length === m.columns.length ? m : { ...m, columns: cols };
}

const sameBeam = (b: Beam, a: Pt, c: Pt) =>
  (dist({ x: b.x1, y: b.y1 }, a) < TOL && dist({ x: b.x2, y: b.y2 }, c) < TOL) ||
  (dist({ x: b.x1, y: b.y1 }, c) < TOL && dist({ x: b.x2, y: b.y2 }, a) < TOL);

export function addBeams(m: Model, segs: [Pt, Pt][], stories: string[], section: string): Model {
  const beams = [...m.beams];
  for (const story of stories)
    for (const [a, b] of segs) {
      if (dist(a, b) < TOL) continue;
      if (beams.some((x) => x.story === story && sameBeam(x, a, b))) continue;
      beams.push({ id: uid(), story, x1: a.x, y1: a.y, x2: b.x, y2: b.y, section });
    }
  return beams.length === m.beams.length ? m : { ...m, beams };
}

export function addSlab(m: Model, pts: Pt[], story: string, section: string): Model {
  if (pts.length < 3 || Math.abs(polyArea(pts)) < 1) return m;
  const ccw = polyArea(pts) < 0 ? [...pts].reverse() : pts;
  return { ...m, slabs: [...m.slabs, { id: uid(), story, pts: ccw, section }] };
}

/** Beams along grid lines between consecutive columns on the given story. */
export function autoBeamsOnGrids(m: Model, story: string, section: string): Model {
  const cols = m.columns.filter((c) => c.story === story);
  const segs: [Pt, Pt][] = [];
  for (const g of m.grids) {
    const a = { x: g.x1, y: g.y1 },
      b = { x: g.x2, y: g.y2 };
    const d = sub(b, a);
    const L = Math.hypot(d.x, d.y);
    const on = cols
      .filter((c) => Math.abs(cross(d, sub(c, a))) / L < TOL * 5)
      .map((c) => ({ p: { x: c.x, y: c.y }, t: ((c.x - a.x) * d.x + (c.y - a.y) * d.y) / L }))
      .sort((p, q) => p.t - q.t);
    for (let i = 0; i + 1 < on.length; i++) segs.push([on[i].p, on[i + 1].p]);
  }
  return addBeams(m, segs, [story], section);
}

export function deleteIds(m: Model, ids: string[]): Model {
  const s = new Set(ids);
  return {
    ...m,
    grids: m.grids.filter((x) => !s.has(x.id)),
    columns: m.columns.filter((x) => !s.has(x.id)),
    beams: m.beams.filter((x) => !s.has(x.id)),
    slabs: m.slabs.filter((x) => !s.has(x.id)),
  };
}

const mvCol = (c: Column, dx: number, dy: number): Column => ({ ...c, x: c.x + dx, y: c.y + dy });
const mvBeam = (b: Beam, dx: number, dy: number): Beam => ({ ...b, x1: b.x1 + dx, y1: b.y1 + dy, x2: b.x2 + dx, y2: b.y2 + dy });
const mvSlab = (s: Slab, dx: number, dy: number): Slab => ({ ...s, pts: s.pts.map((p) => ({ x: p.x + dx, y: p.y + dy })) });
const mvGrid = (g: Grid, dx: number, dy: number): Grid => ({ ...g, x1: g.x1 + dx, y1: g.y1 + dy, x2: g.x2 + dx, y2: g.y2 + dy });

export function moveIds(m: Model, ids: string[], dx: number, dy: number): Model {
  const s = new Set(ids);
  return {
    ...m,
    grids: m.grids.map((x) => (s.has(x.id) ? mvGrid(x, dx, dy) : x)),
    columns: m.columns.map((x) => (s.has(x.id) ? mvCol(x, dx, dy) : x)),
    beams: m.beams.map((x) => (s.has(x.id) ? mvBeam(x, dx, dy) : x)),
    slabs: m.slabs.map((x) => (s.has(x.id) ? mvSlab(x, dx, dy) : x)),
  };
}

/** Replicate linearly n times by (dx,dy), optionally also onto other stories. Duplicates are skipped. */
export function replicate(m: Model, ids: string[], opts: { dx: number; dy: number; n: number; stories: string[] | null }): { model: Model; created: string[] } {
  const s = new Set(ids);
  const created: string[] = [];
  let out = m;
  const cols = m.columns.filter((x) => s.has(x.id));
  const beams = m.beams.filter((x) => s.has(x.id));
  const slabs = m.slabs.filter((x) => s.has(x.id));
  const steps = opts.stories ? [0] : Array.from({ length: Math.max(1, opts.n) }, (_, i) => i + 1);
  const targets = (orig: string) => (opts.stories ? opts.stories.filter((st) => st !== orig || opts.dx || opts.dy) : [orig]);
  for (const k of steps) {
    const dx = opts.stories ? opts.dx : opts.dx * k,
      dy = opts.stories ? opts.dy : opts.dy * k;
    for (const c of cols)
      for (const st of targets(c.story)) {
        const before = out.columns.length;
        out = addColumns(out, [{ x: c.x + dx, y: c.y + dy }], [st], c.section, c.angle);
        if (out.columns.length > before) created.push(out.columns[out.columns.length - 1].id);
      }
    for (const b of beams)
      for (const st of targets(b.story)) {
        const before = out.beams.length;
        out = addBeams(out, [[{ x: b.x1 + dx, y: b.y1 + dy }, { x: b.x2 + dx, y: b.y2 + dy }]], [st], b.section);
        if (out.beams.length > before) created.push(out.beams[out.beams.length - 1].id);
      }
    for (const sl of slabs)
      for (const st of targets(sl.story)) {
        const pts = sl.pts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
        const dup = out.slabs.some((o) => o.story === st && o.pts.length === pts.length && o.pts.every((p, i) => dist(p, pts[i]) < TOL));
        if (dup) continue;
        out = { ...out, slabs: [...out.slabs, { id: uid(), story: st, pts, section: sl.section }] };
        created.push(out.slabs[out.slabs.length - 1].id);
      }
  }
  return { model: out, created };
}

export function patchIds(m: Model, ids: string[], patch: { section?: string; story?: string; angle?: number }): Model {
  const s = new Set(ids);
  const p = (o: any) => {
    if (!s.has(o.id)) return o;
    const n = { ...o };
    if (patch.story !== undefined) n.story = patch.story;
    if (patch.section !== undefined) n.section = patch.section;
    if (patch.angle !== undefined && 'angle' in o) n.angle = patch.angle;
    return n;
  };
  return { ...m, columns: m.columns.map(p), beams: m.beams.map(p), slabs: m.slabs.map(p) };
}

// ---------- bay detection for slabs ----------

/**
 * Find the smallest closed region bounded by the given segments that contains `p`.
 * Segments are split at every intersection and faces are traced on the resulting planar graph.
 */
export function findBay(segs: [Pt, Pt][], p: Pt): Pt[] | null {
  if (segs.length < 3) return null;
  // split segments at intersections
  const cuts: number[][] = segs.map(() => [0, 1]);
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++) {
      const r = segIntersect(segs[i][0], segs[i][1], segs[j][0], segs[j][1], 1e-4);
      if (r) {
        cuts[i].push(Math.min(1, Math.max(0, r.t)));
        cuts[j].push(Math.min(1, Math.max(0, r.u)));
      }
    }
  const key = (q: Pt) => `${Math.round(q.x)}|${Math.round(q.y)}`;
  const verts = new Map<string, Pt>();
  const adj = new Map<string, Set<string>>();
  const link = (a: Pt, b: Pt) => {
    const ka = key(a),
      kb = key(b);
    if (ka === kb) return;
    if (!verts.has(ka)) verts.set(ka, a);
    if (!verts.has(kb)) verts.set(kb, b);
    if (!adj.has(ka)) adj.set(ka, new Set());
    if (!adj.has(kb)) adj.set(kb, new Set());
    adj.get(ka)!.add(kb);
    adj.get(kb)!.add(ka);
  };
  segs.forEach(([a, b], i) => {
    const ts = [...new Set(cuts[i].map((t) => +t.toFixed(9)))].sort((x, y) => x - y);
    for (let k = 0; k + 1 < ts.length; k++) {
      const pa = { x: a.x + (b.x - a.x) * ts[k], y: a.y + (b.y - a.y) * ts[k] };
      const pb = { x: a.x + (b.x - a.x) * ts[k + 1], y: a.y + (b.y - a.y) * ts[k + 1] };
      link(pa, pb);
    }
  });
  // sorted outgoing edges (CCW)
  const sorted = new Map<string, string[]>();
  for (const [k, ns] of adj) {
    const v = verts.get(k)!;
    sorted.set(
      k,
      [...ns].sort((a, b) => {
        const pa = verts.get(a)!,
          pb = verts.get(b)!;
        return Math.atan2(pa.y - v.y, pa.x - v.x) - Math.atan2(pb.y - v.y, pb.x - v.x);
      }),
    );
  }
  const used = new Set<string>();
  let best: Pt[] | null = null,
    bestA = Infinity;
  for (const [u, ns] of adj)
    for (const v of ns) {
      if (used.has(u + '>' + v)) continue;
      const face: string[] = [];
      let a = u,
        b = v,
        guard = 0;
      while (!used.has(a + '>' + b) && guard++ < 10000) {
        used.add(a + '>' + b);
        face.push(a);
        const list = sorted.get(b)!;
        const i = list.indexOf(a);
        const c = list[(i - 1 + list.length) % list.length];
        a = b;
        b = c;
      }
      const pts = face.map((k) => verts.get(k)!);
      const A = polyArea(pts);
      if (A > 1 && A < bestA && pointInPoly(p, pts)) {
        best = pts;
        bestA = A;
      }
    }
  return best ? simplify(best) : null;
}

/** Drop collinear vertices. */
function simplify(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[(i - 1 + pts.length) % pts.length],
      b = pts[i],
      c = pts[(i + 1) % pts.length];
    if (Math.abs(cross(sub(b, a), sub(c, b))) > 1e-3 * dist(a, b) * dist(b, c)) out.push(b);
  }
  return out;
}

export function gridSegs(m: Model): [Pt, Pt][] {
  return m.grids.map((g) => [
    { x: g.x1, y: g.y1 },
    { x: g.x2, y: g.y2 },
  ]);
}

// ---------- grid dimensions ----------

export interface DimLine {
  a: Pt; // start of the dimension line
  b: Pt;
  value: number; // c/c distance, mm
  ticks: Pt[]; // tick positions along the line
  vertical: boolean; // dimension measured along Y (text runs vertically)
}

/**
 * Centre-to-centre dimension chains for orthogonal grids: X grids are dimensioned along a line
 * above them, Y grids along a line to their left, placed beyond the bubbles. A second, outer
 * line gives the overall distance when there are three or more grids.
 */
export function gridDimensions(grids: Grid[], bubbleD: number): DimLine[] {
  const out: DimLine[] = [];
  const uniq = (v: number[]) => [...new Set(v.map((x) => Math.round(x * 1000) / 1000))].sort((p, q) => p - q);
  const xg = grids.filter((g) => g.dir === 'X'),
    yg = grids.filter((g) => g.dir === 'Y');
  const off1 = bubbleD * 1.6,
    off2 = bubbleD * 2.4;

  const chain = (pos: number[], at: (v: number, off: number) => Pt, vertical: boolean) => {
    if (pos.length < 2) return;
    for (let i = 0; i + 1 < pos.length; i++)
      out.push({ a: at(pos[i], off1), b: at(pos[i + 1], off1), value: pos[i + 1] - pos[i], ticks: [at(pos[i], off1), at(pos[i + 1], off1)], vertical });
    if (pos.length > 2) {
      const a = at(pos[0], off2),
        b = at(pos[pos.length - 1], off2);
      out.push({ a, b, value: pos[pos.length - 1] - pos[0], ticks: [a, b], vertical });
    }
  };
  if (xg.length) {
    const top = Math.max(...xg.flatMap((g) => [g.y1, g.y2]));
    chain(uniq(xg.map((g) => g.x1)), (x, off) => ({ x, y: top + off }), false);
  }
  if (yg.length) {
    const left = Math.min(...yg.flatMap((g) => [g.x1, g.x2]));
    chain(uniq(yg.map((g) => g.y1)), (y, off) => ({ x: left - off, y }), true);
  }
  return out;
}

// ---------- select by properties ----------

export interface ElementFilter {
  kinds: { column: boolean; beam: boolean; slab: boolean };
  stories: string[] | null; // null = all stories
  sections: string[] | null; // null = any section
  shape: 'any' | 'Rectangle' | 'Circle' | 'Other'; // frame sections only
  material: string; // '' = any
  t3: [number | null, number | null]; // depth range (frame) / thickness range (slab), mm
  t2: [number | null, number | null]; // width range, frame only
}

export const anyFilter = (): ElementFilter => ({
  kinds: { column: true, beam: true, slab: true },
  stories: null,
  sections: null,
  shape: 'any',
  material: '',
  t3: [null, null],
  t2: [null, null],
});

const inRange = (v: number | undefined, [lo, hi]: [number | null, number | null]) =>
  (lo === null || (v !== undefined && v >= lo - 1e-6)) && (hi === null || (v !== undefined && v <= hi + 1e-6));

/** Ids of columns/beams/slabs whose story and section properties match the filter. */
export function matchElements(m: Model, f: ElementFilter): string[] {
  const fs = new Map(m.frameSections.map((s) => [s.name, s]));
  const ss = new Map(m.slabSections.map((s) => [s.name, s]));
  const story = (s: string) => !f.stories || f.stories.includes(s);
  const sect = (s: string) => !f.sections || f.sections.includes(s);
  const frameOk = (name: string) => {
    const s = fs.get(name);
    if (f.shape !== 'any' && s?.shape !== f.shape) return false;
    if (f.material && s?.material !== f.material) return false;
    return inRange(s?.t3, f.t3) && inRange(s?.t2, f.t2);
  };
  const slabOk = (name: string) => {
    const s = ss.get(name);
    if (f.shape !== 'any' || f.t2[0] !== null || f.t2[1] !== null) return false; // frame-only criteria exclude slabs
    if (f.material && s?.material !== f.material) return false;
    return inRange(s?.thickness, f.t3);
  };
  const ids: string[] = [];
  if (f.kinds.column) for (const c of m.columns) if (story(c.story) && sect(c.section) && frameOk(c.section)) ids.push(c.id);
  if (f.kinds.beam) for (const b of m.beams) if (story(b.story) && sect(b.section) && frameOk(b.section)) ids.push(b.id);
  if (f.kinds.slab) for (const s of m.slabs) if (story(s.story) && sect(s.section) && slabOk(s.section)) ids.push(s.id);
  return ids;
}

export { lineIntersect };
