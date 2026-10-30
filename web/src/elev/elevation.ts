import { columnSpan, levelZ, storyElevations, type Grid, type Model, type Pt } from '../model/types';
import { cross, dot, len, sub } from '../model/geom';
import { columnOutline } from '../plan/snap';

// Elevation coordinates: s = station along the grid (mm from its start point), z = elevation (mm).

export interface ElevLevel { name: string; z: number }
export interface ElevGridMark { id: string; label: string; s: number }
export interface ElevColumn { id: string; section: string; s0: number; s1: number; z0: number; z1: number }
/** a beam running along the grid, drawn as its side face */
export interface ElevBeam { id: string; section: string; s0: number; s1: number; z: number; depth: number }
/** a beam crossing the grid, drawn as its cut cross-section */
export interface ElevCut { id: string; section: string; s0: number; s1: number; z: number; depth: number }
export interface ElevSlab { id: string; section: string; s0: number; s1: number; z: number; t: number }

export interface Elevation {
  levels: ElevLevel[]; // bottom → top, the base first
  refPlanes: ElevLevel[]; // bottom → top
  grids: ElevGridMark[];
  columns: ElevColumn[];
  beams: ElevBeam[];
  cuts: ElevCut[];
  slabs: ElevSlab[];
}

/** Everything within `tol` mm of the grid line, seen square-on to it. */
export function elevationAt(m: Model, g: Grid, tol: number): Elevation {
  const o: Pt = { x: g.x1, y: g.y1 };
  const L = len(sub({ x: g.x2, y: g.y2 }, o)) || 1;
  const u: Pt = { x: (g.x2 - g.x1) / L, y: (g.y2 - g.y1) / L };
  const n: Pt = { x: -u.y, y: u.x };
  const st = (p: Pt) => dot(sub(p, o), u);
  const off = (p: Pt) => dot(sub(p, o), n);
  const el = storyElevations(m);
  const frame = new Map(m.frameSections.map((s) => [s.name, s]));
  const slabT = new Map(m.slabSections.map((s) => [s.name, s.thickness]));

  const levels: ElevLevel[] = [{ name: 'Base', z: m.baseElevation }, ...m.stories.map((s) => ({ name: s.name, z: el[s.name].top }))];

  const refPlanes: ElevLevel[] = [...(m.refPlanes ?? [])].sort((a, b) => a.z - b.z).map((r) => ({ name: r.name, z: r.z }));

  const grids: ElevGridMark[] = [];
  for (const h of m.grids) {
    if (h.id === g.id) continue;
    const a: Pt = { x: h.x1, y: h.y1 },
      b: Pt = { x: h.x2, y: h.y2 };
    const da = off(a),
      db = off(b);
    if (Math.abs(da - db) < 1e-6) continue; // parallel
    const t = da / (da - db);
    if (t < -1e-6 || t > 1 + 1e-6) continue; // stops short of this grid
    const s = st({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    if (s >= -tol && s <= L + tol) grids.push({ id: h.id, label: h.label, s });
  }
  grids.sort((a, b) => a.s - b.s);

  const columns: ElevColumn[] = [];
  for (const c of m.columns) {
    if (Math.abs(off(c)) > tol) continue;
    const span = columnSpan(el, c);
    if (!span) continue;
    const sec = frame.get(c.section);
    let s0: number, s1: number;
    if (sec?.shape === 'Circle') [s0, s1] = [st(c) - sec.t3 / 2, st(c) + sec.t3 / 2];
    else {
      const ss = columnOutline(c, sec).map(st);
      [s0, s1] = [Math.min(...ss), Math.max(...ss)];
    }
    columns.push({ id: c.id, section: c.section, s0, s1, z0: span.bottom, z1: span.top });
  }

  const beams: ElevBeam[] = [];
  const cuts: ElevCut[] = [];
  for (const b of m.beams) {
    const z = levelZ(el, b);
    if (z === null) continue;
    const p1: Pt = { x: b.x1, y: b.y1 },
      p2: Pt = { x: b.x2, y: b.y2 };
    const sec = frame.get(b.section);
    const depth = sec?.t3 || 500;
    const d1 = off(p1),
      d2 = off(p2);
    if (Math.abs(d1) <= tol && Math.abs(d2) <= tol) {
      const [s0, s1] = [st(p1), st(p2)].sort((a, b) => a - b);
      if (s1 - s0 > 1) beams.push({ id: b.id, section: b.section, s0, s1, z, depth });
    } else if ((d1 < -tol && d2 > tol) || (d1 > tol && d2 < -tol)) {
      const t = d1 / (d1 - d2);
      const s = st({ x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t });
      // a skewed beam cuts a wider section
      const sin = Math.abs(cross(u, sub(p2, p1))) / (len(sub(p2, p1)) || 1);
      const w = Math.min((sec?.t2 || 300) / Math.max(sin, 0.2), 5 * (sec?.t2 || 300));
      cuts.push({ id: b.id, section: b.section, s0: s - w / 2, s1: s + w / 2, z, depth });
    }
  }

  const slabs: ElevSlab[] = [];
  for (const sl of m.slabs) {
    const z = levelZ(el, sl);
    if (z === null || sl.pts.length < 3) continue;
    // the grid often runs along a slab edge, so cut just either side of it and merge
    const spans = mergeSpans([...chord(sl.pts, off, st, 1), ...chord(sl.pts, off, st, -1)]);
    const t = slabT.get(sl.section) || 150;
    for (const [s0, s1] of spans) slabs.push({ id: sl.id, section: sl.section, s0, s1, z, t });
  }

  return { levels, refPlanes, grids, columns, beams, cuts, slabs };
}

/** Stretches of the line at offset `at` that lie inside the polygon, as [s0, s1] stations. */
function chord(pts: Pt[], off: (p: Pt) => number, st: (p: Pt) => number, at: number): [number, number][] {
  const xs: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i],
      b = pts[(i + 1) % pts.length];
    const da = off(a) - at,
      db = off(b) - at;
    if ((da < 0) === (db < 0)) continue;
    const t = da / (da - db);
    xs.push(st({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }));
  }
  xs.sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > 1) out.push([xs[i], xs[i + 1]]);
  return out;
}

function mergeSpans(sp: [number, number][]): [number, number][] {
  sp.sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [a, b] of sp) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}
