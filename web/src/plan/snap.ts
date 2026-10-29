import { columnOn, type Model, type Pt, type Grid, type FrameSection } from '../model/types';
import { dist, distToSeg, mid, projectOnSeg, projectOnLine, rot, segIntersect, sub, add } from '../model/geom';
import { gridIntersections } from '../model/ops';
import { underlayGeom } from '../underlay/store';

export type SnapKind = 'intersection' | 'column' | 'face' | 'end' | 'mid' | 'perp' | 'near' | 'ortho' | 'align' | 'none';
export interface Snap {
  p: Pt;
  kind: SnapKind;
}

const ixCache = new WeakMap<Grid[], Pt[]>();
export function cachedIntersections(grids: Grid[]) {
  let v = ixCache.get(grids);
  if (!v) ixCache.set(grids, (v = gridIntersections(grids)));
  return v;
}

export function columnOutline(c: { x: number; y: number; angle: number; section: string }, sec?: FrameSection): Pt[] {
  const d = sec?.t3 || 400,
    w = sec?.t2 || 400;
  return [
    { x: -d / 2, y: -w / 2 },
    { x: d / 2, y: -w / 2 },
    { x: d / 2, y: w / 2 },
    { x: -d / 2, y: w / 2 },
  ].map((p) => add(rot(p, c.angle), c));
}

export interface SnapOpts {
  story: string;
  from?: Pt | null;
  ortho?: boolean;
  underlay?: boolean;
  only?: SnapKind[]; // restrict
}

/** Find the best snap for a world point. `tol` is in world units (mm). */
export function snapPoint(m: Model, w: Pt, tol: number, o: SnapOpts): Snap {
  const allow = (k: SnapKind) => !o.only || o.only.includes(k);
  let best: Snap | null = null,
    bestD = tol;
  const tryPt = (p: Pt, kind: SnapKind, bias = 0) => {
    if (!allow(kind)) return;
    const d = dist(p, w) - bias;
    if (d < bestD) {
      bestD = d;
      best = { p, kind };
    }
  };

  // --- point snaps ---
  for (const p of cachedIntersections(m.grids)) tryPt(p, 'intersection', tol * 0.15);
  const secs = new Map(m.frameSections.map((s) => [s.name, s]));
  const cols = m.columns.filter((c) => columnOn(m, c, o.story));
  for (const c of cols) tryPt(c, 'column', tol * 0.2);
  const beams = m.beams.filter((b) => b.story === o.story);
  for (const b of beams) {
    const a = { x: b.x1, y: b.y1 },
      e = { x: b.x2, y: b.y2 };
    tryPt(a, 'end');
    tryPt(e, 'end');
    tryPt(mid(a, e), 'mid');
  }
  for (const s of m.slabs) if (s.story === o.story) for (const p of s.pts) tryPt(p, 'end');

  const ug = o.underlay !== false ? underlayGeom(o.story) : null;
  const near = ug ? ug.tree.search({ minX: w.x - tol, minY: w.y - tol, maxX: w.x + tol, maxY: w.y + tol }) : [];
  for (const s of near) {
    tryPt(s.a, 'end');
    tryPt(s.b, 'end');
  }
  if (ug && ug.pts.length < 20000) for (const p of ug.pts) if (Math.abs(p.x - w.x) < tol && Math.abs(p.y - w.y) < tol) tryPt(p, 'end');

  // crossings of any two lines passing near the cursor (beams, grids, column faces, slab edges, underlay)
  const close: [Pt, Pt][] = [];
  const consider = (a: Pt, b: Pt) => {
    if (close.length < 80 && distToSeg(w, a, b) < tol) close.push([a, b]);
  };
  for (const b of beams) consider({ x: b.x1, y: b.y1 }, { x: b.x2, y: b.y2 });
  for (const g of m.grids) consider({ x: g.x1, y: g.y1 }, { x: g.x2, y: g.y2 });
  for (const c of cols) {
    const ol = columnOutline(c, secs.get(c.section));
    for (let i = 0; i < 4; i++) consider(ol[i], ol[(i + 1) % 4]);
  }
  for (const s of m.slabs) if (s.story === o.story) s.pts.forEach((p, i) => consider(p, s.pts[(i + 1) % s.pts.length]));
  for (const s of near) consider(s.a, s.b);
  for (let i = 0; i < close.length; i++)
    for (let j = i + 1; j < close.length; j++) {
      const x = segIntersect(close[i][0], close[i][1], close[j][0], close[j][1], 1e-6);
      if (x) tryPt(x.p, 'intersection', tol * 0.15);
    }
  if (best) return best;

  // --- line snaps ---
  bestD = tol;
  const segs: [Pt, Pt, boolean][] = []; // a, b, isUnderlay
  for (const c of cols) {
    const ol = columnOutline(c, secs.get(c.section));
    for (let i = 0; i < 4; i++) {
      const pr = projectOnSeg(w, ol[i], ol[(i + 1) % 4]).p;
      tryPt(pr, 'face');
    }
  }
  if (best) return best;
  for (const b of beams) segs.push([{ x: b.x1, y: b.y1 }, { x: b.x2, y: b.y2 }, false]);
  for (const g of m.grids) segs.push([{ x: g.x1, y: g.y1 }, { x: g.x2, y: g.y2 }, false]);
  for (const s of near) segs.push([s.a, s.b, true]);

  if (o.from) {
    for (const [a, b] of segs) {
      const f = projectOnLine(o.from, a, b);
      const t = projectOnSeg(f, a, b);
      if (dist(t.p, f) < 1e-6) tryPt(f, 'perp', tol * 0.1);
    }
  }
  if (best) return best;
  // intersections of beam/grid segments with each other near the cursor
  for (const [a, b] of segs) tryPt(projectOnSeg(w, a, b).p, 'near');
  if (best) return best;

  if (o.ortho && o.from) {
    const d = sub(w, o.from);
    const p = Math.abs(d.x) > Math.abs(d.y) ? { x: w.x, y: o.from.y } : { x: o.from.x, y: w.y };
    return { p, kind: 'ortho' };
  }
  return { p: w, kind: 'none' };
}
