import { beamEndsZ, LEVEL_TOL, placeAt, storyElevations, uid, type Beam, type Flight, type FlightDir, type Landing, type StairModel as Model, type Pt, type Span } from '../model/types';
import { addColumns, gridIntersections, makeGrid } from '../model/ops';

// Plan geometry in mm, like the rest of the model. Loads in kN, kN/m, kN/m²; statics in metres.

export type Rect = { x0: number; y0: number; x1: number; y1: number };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Flight local frame: rect = O + s·u + q·v, s in [0, L] (going, uphill), q in [0, w]. H = total rise. */
export function frame(f: Flight) {
  const L = (f.n - 1) * f.T,
    w = f.width,
    ax = f.dir[1] === 'x',
    neg = f.dir[0] === '-';
  const r: Rect = ax ? { x0: f.x, y0: f.y, x1: f.x + L, y1: f.y + w } : { x0: f.x, y0: f.y, x1: f.x + w, y1: f.y + L };
  const u: [number, number] = ax ? [neg ? -1 : 1, 0] : [0, neg ? -1 : 1];
  const v: [number, number] = ax ? [0, 1] : [1, 0];
  const O: [number, number] = ax ? [neg ? r.x1 : r.x0, r.y0] : [r.x0, neg ? r.y1 : r.y0];
  return { L, w, r, u, v, O, H: f.n * f.R };
}

/** A flight grip: b0 bottom end, b1 top end, a0 / a1 the two long sides. */
export type FlightEdge = 'b0' | 'b1' | 'a0' | 'a1';
export const OPPOSITE: Record<FlightEdge, FlightEdge> = { b0: 'b1', b1: 'b0', a0: 'a1', a1: 'a0' };

/** Grip points of a flight: the midpoints of its ends and long sides. */
export function flightGrips(f: Flight): Record<FlightEdge, Pt> {
  const { L, w, u, v, O } = frame(f);
  const at = (s: number, q: number) => ({ x: O[0] + u[0] * s + v[0] * q, y: O[1] + u[1] * s + v[1] * q });
  return { b0: at(0, w / 2), b1: at(L, w / 2), a0: at(L / 2, 0), a1: at(L / 2, w) };
}

/** Flight with one grip dragged to `p`, the opposite edge staying put: an end changes the riser count in whole treads (dragging the bottom keeps the top level), a side the width (≥ 300 mm). */
export function reshapeFlight(f: Flight, edge: FlightEdge, p: Pt): Flight {
  const { L, w, u, v, O } = frame(f);
  const s = (p.x - O[0]) * u[0] + (p.y - O[1]) * u[1],
    q = (p.x - O[0]) * v[0] + (p.y - O[1]) * v[1];
  let b0 = 0,
    b1 = L,
    a0 = 0,
    a1 = w;
  if (edge === 'b1') b1 = Math.max(f.T, Math.round(s / f.T) * f.T);
  else if (edge === 'b0') b0 = L - Math.max(f.T, Math.round((L - s) / f.T) * f.T);
  else if (edge === 'a1') a1 = Math.max(300, Math.round(q));
  else a0 = Math.min(w - 300, Math.round(q));
  const n = Math.round((b1 - b0) / f.T) + 1;
  const xs = [b0, b1].flatMap((b) => [a0, a1].map((a) => O[0] + u[0] * b + v[0] * a)),
    ys = [b0, b1].flatMap((b) => [a0, a1].map((a) => O[1] + u[1] * b + v[1] * a));
  return { ...f, n, width: a1 - a0, z0: edge === 'b0' ? f.z0 - (n - f.n) * f.R : f.z0, x: Math.min(...xs), y: Math.min(...ys) };
}

export const landingRect = (l: Landing): Rect => ({ x0: l.x, y0: l.y, x1: l.x + l.w, y1: l.y + l.h });
export const rectPts = (r: Rect): Pt[] => [
  { x: r.x0, y: r.y0 },
  { x: r.x1, y: r.y0 },
  { x: r.x1, y: r.y1 },
  { x: r.x0, y: r.y1 },
];

/** Midpoints of a landing's sides; side i runs from rectPts[i] to rectPts[i + 1] (0 y0, 1 x1, 2 y1, 3 x0). */
export const landingSides = (l: Landing): Pt[] => rectPts(landingRect(l)).map((p, i, a) => ({ x: (p.x + a[(i + 1) % 4].x) / 2, y: (p.y + a[(i + 1) % 4].y) / 2 }));

/** Landing with one side moved to `p` (whole mm), the opposite side staying put. */
export function reshapeLanding(l: Landing, side: number, p: Pt): Landing {
  const r = landingRect(l);
  if (side === 0) r.y0 = Math.round(p.y);
  else if (side === 1) r.x1 = Math.round(p.x);
  else if (side === 2) r.y1 = Math.round(p.y);
  else r.x0 = Math.round(p.x);
  return { ...l, x: Math.min(r.x0, r.x1), y: Math.min(r.y0, r.y1), w: Math.abs(r.x1 - r.x0), h: Math.abs(r.y1 - r.y0) };
}

/** Stepped side profile [s, z] of a flight (mm, from its bottom nosing line), waist soffit included. */
export function profile(f: Flight): [number, number][] {
  const { T, R, n } = f,
    ts = (f.t * Math.hypot(R, T)) / T,
    pts: [number, number][] = [
      [0, -ts],
      [0, R],
    ];
  for (let i = 1; i < n; i++) pts.push([i * T, i * R], [i * T, (i + 1) * R]);
  pts.push([(n - 1) * T, (n - 1) * R - ts]);
  return pts;
}

/** Story a stair element is drawn on: the story its mid-height lies in, as ETABS assigns levels. */
export const flightStory = (m: Model, f: Flight) => placeAt(m, f.z0 + (f.n * f.R) / 2)?.story ?? '';
export const landingStory = (m: Model, l: Landing) => placeAt(m, l.z)?.story ?? '';

export function flightLevel(f: Flight, x: number, y: number) {
  const F = frame(f);
  const s = (x - F.O[0]) * F.u[0] + (y - F.O[1]) * F.u[1];
  return f.z0 + clamp(s / F.L, 0, 1) * F.H;
}

export function distSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax,
    dy = by - ay,
    l2 = dx * dx + dy * dy;
  const t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/** Liang-Barsky clip of segment a→b against rect: [t0, t1] or null. */
export function clip(ax: number, ay: number, bx: number, by: number, r: Rect): [number, number] | null {
  let t0 = 0,
    t1 = 1;
  const dx = bx - ax,
    dy = by - ay;
  for (const [p, q] of [
    [-dx, ax - r.x0],
    [dx, r.x1 - ax],
    [-dy, ay - r.y0],
    [dy, r.y1 - ay],
  ]) {
    if (Math.abs(p) < 1e-12) {
      if (q < -1e-9) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return null;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return null;
      if (t < t1) t1 = t;
    }
  }
  return t1 - t0 > 1e-6 ? [t0, t1] : null;
}

/** Level of the stair at a plan point: a landing it is on, or a flight end it is at (within tol mm). */
export function levelGuess(m: Model, x: number, y: number, tol: number): number | null {
  for (const l of m.landings) {
    const r = landingRect(l);
    if (x >= r.x0 - tol && x <= r.x1 + tol && y >= r.y0 - tol && y <= r.y1 + tol) return l.z;
  }
  for (const f of m.flights) {
    const F = frame(f);
    for (const [s, z] of [
      [F.L, f.z0 + F.H],
      [0, f.z0],
    ]) {
      const ex = F.O[0] + F.u[0] * s,
        ey = F.O[1] + F.u[1] * s;
      if (distSeg(x, y, ex, ey, ex + F.v[0] * F.w, ey + F.v[1] * F.w) <= tol) return z;
    }
  }
  return null;
}

// ---------- beams as supports (a cranked beam is a chain of level and sloped beams) ----------

const beamWidth = (m: Model, b: Beam) => m.frameSections.find((s) => s.name === b.section)?.t2 || 300;
const beamLen = (b: Beam) => Math.hypot(b.x2 - b.x1, b.y2 - b.y1) || 1;
/** Top of beam `b` at distance s (mm) from its start. */
function beamZ(el: ReturnType<typeof storyElevations>, b: Beam, s: number) {
  const z = beamEndsZ(el, b);
  if (!z) return 0;
  return z[0] + ((z[1] - z[0]) * clamp(s / beamLen(b), 0, 1));
}

const beamRanks = new WeakMap<Beam[], Map<Beam, number>>();
/** B1, B2, … from the lowest beam up (then by x, y), like flights and landings. */
export function beamName(m: Model, b: Beam) {
  let r = beamRanks.get(m.beams);
  if (!r) {
    const el = storyElevations(m),
      z = (x: Beam) => Math.min(...(beamEndsZ(el, x) ?? [0]));
    const xs = [...m.beams].sort((a, c) => z(a) - z(c) || Math.min(a.x1, a.x2) - Math.min(c.x1, c.x2) || Math.min(a.y1, a.y2) - Math.min(c.y1, c.y2));
    beamRanks.set(m.beams, (r = new Map(xs.map((x, i) => [x, i + 1]))));
  }
  return `B${r.get(b) ?? m.beams.indexOf(b) + 1}`;
}

/** "grid 2 (A – B)" for a beam on a grid line. */
export function gridRef(m: Model, b: Beam) {
  const on = (dir: 'X' | 'Y', v: number) => m.grids.find((g) => g.dir === dir && Math.abs((dir === 'X' ? g.x1 : g.y1) - v) < 10);
  const btw = (dir: 'X' | 'Y', a: number, c: number) => {
    const G = m.grids.filter((g) => g.dir === dir).map((g) => ({ n: g.label, v: dir === 'X' ? g.x1 : g.y1 }));
    if (!G.length) return '';
    const lab = (v: number) => {
      const g = G.reduce((p, q) => (Math.abs(q.v - v) < Math.abs(p.v - v) ? q : p)),
        o = v - g.v;
      return Math.abs(o) < 10 ? g.n : `${g.n}${o > 0 ? '+' : '−'}${Math.round(Math.abs(o))}`;
    };
    return `${lab(Math.min(a, c))} – ${lab(Math.max(a, c))}`;
  };
  if (Math.abs(b.x1 - b.x2) < 1) {
    const g = on('X', b.x1);
    return g ? `grid ${g.label} (${btw('Y', b.y1, b.y2)})` : '';
  }
  if (Math.abs(b.y1 - b.y2) < 1) {
    const g = on('Y', b.y1);
    return g ? `grid ${g.label} (${btw('X', b.x1, b.x2)})` : '';
  }
  return '';
}

// ---------- loads & analysis ----------

export function slabLoads(m: Model, it: Flight | Landing) {
  const p = m.stair;
  if ('n' in it) {
    const sec = Math.hypot(it.R, it.T) / it.T,
      ws = (p.gc * it.t) / 1000 * sec,
      st = (p.gc * it.R) / 2000;
    return { ws, st, ff: p.ff, dl: ws + st + p.ff, ll: p.ll };
  }
  const ws = (p.gc * it.t) / 1000;
  return { ws, st: 0, ff: p.ff, dl: ws + p.ff, ll: p.ll };
}

const spanU = (sp: Span): [number, number] => {
  const L = Math.hypot(sp.x2 - sp.x1, sp.y2 - sp.y1) || 1;
  return [(sp.x2 - sp.x1) / L, (sp.y2 - sp.y1) / L];
};
const rectOfStair = (it: Flight | Landing) => ('n' in it ? frame(it).r : landingRect(it));
/** Where the span line cuts the member in plan, for members within the span's story only (stacked flights overlap in plan). */
const crosses = (m: Model, sp: Span, it: Flight | Landing) => {
  const e = storyElevations(m)[sp.story],
    [lo, hi] = 'n' in it ? [it.z0, it.z0 + it.n * it.R] : [it.z, it.z];
  if (e && (lo < e.bottom - LEVEL_TOL || hi > e.top + LEVEL_TOL)) return null;
  return clip(sp.x1, sp.y1, sp.x2, sp.y2, rectOfStair(it));
};

/** Simply supported beam (m, kN/m), piecewise UDL segments {a, b, w}. */
export function ssBeam(segs: { a: number; b: number; w: number }[], L: number) {
  let W = 0,
    Mo = 0;
  for (const s of segs) {
    const F = s.w * (s.b - s.a);
    W += F;
    Mo += (F * (s.a + s.b)) / 2;
  }
  const RB = Mo / L,
    RA = W - RB;
  let M = 0,
    xm = 0;
  for (let i = 0; i <= 500; i++) {
    const x = (L * i) / 500;
    let mm = RA * x;
    for (const s of segs) {
      const e = Math.min(x, s.b);
      if (e > s.a) mm -= s.w * (e - s.a) * (x - (s.a + e) / 2);
    }
    if (mm > M) (M = mm), (xm = x);
  }
  return { RA, RB, W, M, x: xm };
}

export interface Seg {
  it: Flight | Landing;
  a: number; // m from span start
  b: number;
  k: number;
  ld: ReturnType<typeof slabLoads>;
  dl: number;
  ll: number;
}
export interface Support {
  beam: Beam | null;
  zs: number | null; // slab level at the support, mm
  s?: number; // mm along the beam from its start
  bl?: number;
  bz?: number;
  mismatch?: boolean;
  /** no beam here: this end rests on the slab of another span, `at` m along it */
  span?: Span;
  at?: number;
}

/** Reaction of a span resting on this one, as a UDL across the bearing (per m width, unfactored). */
export interface Transfer {
  from: Span;
  end: 0 | 1;
  a: number;
  b: number;
  dl: number;
  ll: number;
}

/** Slab level (mm) of span `o` at plan point P, or null when P is not on one of its flights / landings. */
function levelOn(m: Model, o: Span, P: number[]) {
  for (const it of [...m.flights, ...m.landings]) {
    const r = rectOfStair(it);
    if (P[0] < r.x0 - 1 || P[0] > r.x1 + 1 || P[1] < r.y0 - 1 || P[1] > r.y1 + 1 || !crosses(m, o, it)) continue;
    return 'n' in it ? flightLevel(it, P[0], P[1]) : it.z;
  }
  return null;
}

/** Another span whose strip holds P at slab level zs (within 300 mm). */
function spanUnder(m: Model, sp: Span, P: number[], zs: number | null): { span: Span; at: number } | null {
  for (const o of m.spans) {
    if (o === sp) continue;
    const v = spanU(o),
      Lo = Math.hypot(o.x2 - o.x1, o.y2 - o.y1),
      along = (P[0] - o.x1) * v[0] + (P[1] - o.y1) * v[1],
      lat = Math.abs((P[0] - o.x1) * v[1] - (P[1] - o.y1) * v[0]);
    if (along < 0 || along > Lo || lat > o.width / 2 + 100) continue;
    const z = levelOn(m, o, P);
    if (z == null || (zs != null && Math.abs(z - zs) > 300)) continue;
    return { span: o, at: along / 1000 };
  }
  return null;
}

function findSupport(m: Model, sp: Span, end: 0 | 1, segs: Seg[], u: [number, number]): Support {
  const el = storyElevations(m);
  const P = end ? [sp.x2, sp.y2] : [sp.x1, sp.y1];
  let zs: number | null = null;
  if (segs.length) {
    const g = end ? segs.reduce((a, b) => (b.b > a.b ? b : a)) : segs[0];
    const d = (end ? g.b : g.a) * 1000;
    zs = 'n' in g.it ? flightLevel(g.it, sp.x1 + u[0] * d, sp.y1 + u[1] * d) : g.it.z;
  }
  let best: Beam | null = null,
    bs = 1e12,
    s = 0,
    bl = 0;
  for (const b of m.beams) {
    const dd = distSeg(P[0], P[1], b.x1, b.y1, b.x2, b.y2);
    if (dd > beamWidth(m, b) / 2 + 100) continue;
    const l = beamLen(b),
      q = ((P[0] - b.x1) * (b.x2 - b.x1) + (P[1] - b.y1) * (b.y2 - b.y1)) / l;
    // level match counts ten times the plan distance
    const sc = (zs == null ? 0 : Math.abs(beamZ(el, b, q) - zs)) * 10 + dd;
    if (sc < bs) (bs = sc), (best = b), (s = q), (bl = l);
  }
  const bz = best ? beamZ(el, best, s) : 0,
    mismatch = !!best && zs != null && Math.abs(bz - zs) > 300;
  // a beam at the right level wins; otherwise the end may bear on another span's slab
  if (!best || mismatch) {
    const on = spanUnder(m, sp, P, zs);
    if (on) return { beam: null, zs, ...on };
  }
  if (!best) return { beam: null, zs };
  return { beam: best, zs, s, bl, bz, mismatch };
}

/** Slab pieces along the span and what each end rests on (no loads from other spans). */
function spanGeom(m: Model, sp: Span) {
  const L = Math.hypot(sp.x2 - sp.x1, sp.y2 - sp.y1) / 1000;
  if (L < 0.1) return null;
  const u = spanU(sp),
    segs: Seg[] = [];
  for (const it of [...m.flights, ...m.landings]) {
    const c = crosses(m, sp, it);
    if (!c) continue;
    // IS 456 cl 33.2: area common to two spans at right angles carries half the load each way
    let k = 1;
    if (
      !('n' in it) &&
      m.spans.some((o) => {
        if (o === sp) return false;
        const v = spanU(o);
        return Math.abs(u[0] * v[0] + u[1] * v[1]) < 0.5 && crosses(m, o, it);
      })
    )
      k = 0.5;
    const ld = slabLoads(m, it);
    segs.push({ it, a: c[0] * L, b: c[1] * L, k, ld, dl: ld.dl * k, ll: ld.ll * k });
  }
  segs.sort((a, b) => a.a - b.a);
  return { L, u, segs, sup: [findSupport(m, sp, 0, segs, u), findSupport(m, sp, 1, segs, u)] };
}

/** `seen`: spans already up the chain, so spans resting on each other can't recurse forever. */
export function analyze(m: Model, sp: Span, seen: Set<string> = new Set()): ReturnType<typeof finish> | null {
  const G = spanGeom(m, sp);
  if (!G) return null;
  const { L, u, segs } = G,
    tr: Transfer[] = [],
    inner = new Set(seen).add(sp.id);
  for (const o of m.spans) {
    if (inner.has(o.id)) continue;
    const og = spanGeom(m, o);
    og?.sup.forEach((s, e) => {
      if (s.span !== sp) return;
      const A = analyze(m, o, inner);
      if (!A) return;
      const R = e ? 'RB' : 'RA',
        uo = og.u,
        // the bearing edge of `o` (its width, square to its span) laid on this span's axis
        // shortcut: a bearing parallel to this span's axis is spread over 50 mm, not a true point load
        len = Math.max(0.05, (o.width / 1000) * Math.abs(uo[0] * u[1] - uo[1] * u[0])),
        a = clamp(s.at! - len / 2, 0, L - len),
        f = o.width / sp.width / len; // reaction × width of `o`, spread over this strip's width and `len`
      tr.push({ from: o, end: e as 0 | 1, a, b: a + len, dl: A.D[R] * f, ll: A.LL[R] * f });
    });
  }
  return finish(m, sp, G, tr);
}

function finish(m: Model, sp: Span, G: NonNullable<ReturnType<typeof spanGeom>>, tr: Transfer[]) {
  const { L, segs } = G;
  const loads = [...segs, ...tr];
  const run = (f: (s: { dl: number; ll: number }) => number) => ssBeam(loads.map((s) => ({ a: s.a, b: s.b, w: f(s) })), L);
  const D = run((s) => s.dl),
    LL = run((s) => s.ll),
    U = run((s) => m.stair.gf * (s.dl + s.ll));
  const fl = segs.filter((s) => 'n' in s.it);
  const t = fl.length ? Math.min(...fl.map((s) => s.it.t)) : segs.length ? Math.min(...segs.map((s) => s.it.t)) : 150;
  return { ...G, tr, D, LL, U, t, des: design(m, U, t, L) };
}

/** One slab thickness throughout the stair: every flight waist, every landing and both defaults set to `t`. */
export function withWaist(m: Model, t: number): Model {
  const set = <T extends { t: number }>(xs: T[]) => xs.map((x) => ({ ...x, t }));
  return { ...m, flights: set(m.flights), landings: set(m.landings), stair: { ...m.stair, t, tl: t } };
}

/** Least uniform slab thickness (10 mm steps, from 100) that passes every check on every span, with its own self weight; `thumb` = L/20 of the longest span, for reference. */
export function suggestWaist(m: Model) {
  const Ls = m.spans.map((sp) => analyze(m, sp)?.L).filter((L) => L !== undefined);
  if (!Ls.length) return null;
  const thumb = Math.ceil(Math.max(...Ls) * 5) * 10;
  const ok = (t: number) => {
    const mm = withWaist(m, t);
    return mm.spans.every((sp) => {
      const d = analyze(mm, sp)?.des;
      return !d || (d.flex && d.shear && d.shearMax && d.defl);
    });
  };
  let t = 100;
  while (t < 600 && !ok(t)) t += 10;
  return { thumb, t };
}

// ---------- IS 456 design ----------

const TC_PT = [0.15, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3];
const TC: Record<number, number[]> = {
  15: [0.28, 0.35, 0.46, 0.54, 0.6, 0.64, 0.68, 0.71, 0.71, 0.71, 0.71, 0.71, 0.71],
  20: [0.28, 0.36, 0.48, 0.56, 0.62, 0.67, 0.72, 0.75, 0.79, 0.81, 0.82, 0.82, 0.82],
  25: [0.29, 0.36, 0.49, 0.57, 0.64, 0.7, 0.74, 0.78, 0.82, 0.85, 0.88, 0.9, 0.92],
  30: [0.29, 0.37, 0.5, 0.59, 0.66, 0.71, 0.76, 0.8, 0.84, 0.88, 0.91, 0.94, 0.96],
  35: [0.29, 0.37, 0.5, 0.59, 0.67, 0.73, 0.78, 0.82, 0.86, 0.9, 0.93, 0.96, 0.99],
  40: [0.3, 0.38, 0.51, 0.6, 0.68, 0.74, 0.79, 0.84, 0.88, 0.92, 0.95, 0.98, 1.01],
};
const TCMAX: Record<number, number> = { 15: 2.5, 20: 2.8, 25: 3.1, 30: 3.5, 35: 3.7, 40: 4.0 };
const grade = (fck: number) => [15, 20, 25, 30, 35, 40].filter((g) => g <= fck).pop() || 15;
export function tauC(pt: number, fck: number) {
  const row = TC[grade(fck)],
    p = clamp(pt, 0.15, 3);
  let i = 0;
  while (i < TC_PT.length - 2 && p > TC_PT[i + 1]) i++;
  return row[i] + ((row[i + 1] - row[i]) * (p - TC_PT[i])) / (TC_PT[i + 1] - TC_PT[i]);
}
export const kSlab = (D: number) => clamp(1.3 - ((D - 150) / 150) * 0.3, 1, 1.3); // cl 40.2.1.1

function design(m: Model, U: { M: number; RA: number; RB: number }, D: number, L: number) {
  const p = m.stair,
    b = 1000,
    d = D - p.cover - p.bar / 2,
    Mu = U.M * 1e6,
    Vu = Math.max(U.RA, U.RB) * 1e3;
  const xr = 0.0035 / (0.0055 + (0.87 * p.fy) / 2e5),
    Q = 0.36 * p.fck * xr * (1 - 0.42 * xr),
    Mlim = Q * b * d * d;
  const disc = 1 - (4.6 * Mu) / (p.fck * b * d * d);
  const Ast = disc > 0 ? ((0.5 * p.fck) / p.fy) * (1 - Math.sqrt(disc)) * b * d : NaN;
  const Amin = (p.fy > 250 ? 0.0012 : 0.0015) * b * D,
    Areq = Math.max(Ast, Amin);
  const ab = (Math.PI * p.bar ** 2) / 4,
    sMax = Math.min(3 * d, 300);
  const s = Math.max(50, Math.floor(Math.min((1000 * ab) / Areq, sMax) / 10) * 10),
    Aprov = (1000 * ab) / s;
  const abd = (Math.PI * p.dbar ** 2) / 4,
    sdMax = Math.min(5 * d, 450),
    sd = Math.floor(Math.min((1000 * abd) / Amin, sdMax) / 10) * 10,
    Adprov = (1000 * abd) / sd;
  const pt = (100 * Aprov) / (b * d),
    tc = tauC(pt, p.fck),
    k = kSlab(D),
    tv = Vu / (b * d),
    tcmax = TCMAX[grade(p.fck)];
  const fs = (0.58 * p.fy * Areq) / Aprov,
    kt = Math.min(2, 1 / (0.225 + 0.00322 * fs + 0.625 * Math.log10(pt)));
  const ld = (L * 1000) / d,
    ldAllow = 20 * kt;
  return { b, D, d, Mu: U.M, Vu: Vu / 1e3, xr, Q, Mlim: Mlim / 1e6, flex: Mu <= Mlim && disc > 0, dReq: Math.sqrt(Mu / (Q * b)), Ast, Amin, Areq, s, sMax, Aprov, sd, sdMax, Adprov, pt, tc, k, tv, tcmax, shear: tv <= k * tc, shearMax: tv <= 0.5 * tcmax, fs, kt, ld, ldAllow, defl: ld <= ldAllow };
}

// ---------- line loads on beams (unfactored, kN/m) ----------

export interface BeamLoadRow {
  sp: Span;
  e: 0 | 1; // which end of the span bears here
  a: number; // mm from the beam start
  b: number;
  dl: number;
  ll: number;
  fu: number;
}

/** Beam loads run from the beam's left end (bottom end if vertical), whichever way it was drawn. */
export const beamFlipped = (b: Beam) => (Math.abs(b.x2 - b.x1) < 1 ? b.y2 < b.y1 : b.x2 < b.x1);
/** The beam's report start point, mm. */
export const beamStart = (b: Beam) => (beamFlipped(b) ? { x: b.x2, y: b.y2 } : { x: b.x1, y: b.y1 });

export function beamLoads(m: Model) {
  const byName = [...m.beams].sort((a, b) => +beamName(m, a).slice(1) - +beamName(m, b).slice(1));
  const out = new Map<Beam, BeamLoadRow[]>(byName.map((b) => [b, []])),
    warn: string[] = [];
  for (const sp of m.spans) {
    const A = analyze(m, sp);
    if (!A) continue;
    A.sup.forEach((s, e) => {
      const R = e ? 'RB' : 'RA';
      if (s.span) return; // carried by that span, which takes it to its own beams
      if (!s.beam) {
        warn.push(`${sp.name}: ${e ? 'end' : 'start'} has no beam — reaction ${A.D[R].toFixed(2)} (DL) + ${A.LL[R].toFixed(2)} (LL) kN/m not assigned to any beam (wall?)`);
        return;
      }
      if (s.mismatch) warn.push(`${sp.name}: ${e ? 'end' : 'start'} slab level ${s.zs!.toFixed(0)} vs beam ${beamName(m, s.beam)} level ${s.bz!.toFixed(0)} mm — check`);
      const at = beamFlipped(s.beam) ? s.bl! - s.s! : s.s!,
        a = clamp(at - sp.width / 2, 0, s.bl!),
        b = clamp(at + sp.width / 2, 0, s.bl!);
      out.get(s.beam)!.push({ sp, e: e as 0 | 1, a, b, dl: A.D[R], ll: A.LL[R], fu: A.U[R] });
    });
  }
  for (const f of m.flights) if (!m.spans.some((sp) => crosses(m, sp, f))) warn.push(`${f.name}: not covered by any span — its load is not reaching any beam`);
  return { out, warn };
}

// ---------- auto spans: one per flight, through contiguous landings, ending on the beam whose level matches ----------

export function autoSpans(m: Model): Model {
  const el = storyElevations(m);
  const spans = m.spans.filter((s) => !s.auto);
  const cross = (a: number[], b: number[]) => a[0] * b[1] - a[1] * b[0];
  const nm = nextNames(spans.map((s) => s.name), 'S');
  for (const f of m.flights) {
    const F = frame(f),
      u = F.u,
      c = [F.O[0] + (u[0] * F.L) / 2 + (F.v[0] * F.w) / 2, F.O[1] + (u[1] * F.L) / 2 + (F.v[1] * F.w) / 2],
      pt = (t: number) => [c[0] + u[0] * t, c[1] + u[1] * t];
    const end = (sg: number) => {
      let t = (sg * F.L) / 2,
        z = sg > 0 ? f.z0 + F.H : f.z0;
      for (let k = 0; k < 6; k++) {
        const q = pt(t + sg * 20);
        const l = m.landings.find((l) => {
          const r = landingRect(l);
          return q[0] > r.x0 && q[0] < r.x1 && q[1] > r.y0 && q[1] < r.y1;
        });
        if (!l) break;
        const far = pt(t + sg * 1e5),
          cc = clip(q[0], q[1], far[0], far[1], landingRect(l))!;
        t = t + sg * (20 + cc[1] * 1e5);
        z = l.z;
      }
      let best: number | null = null,
        bs = 1e12,
        dz = 0;
      for (const b of m.beams) {
        const d = [b.x2 - b.x1, b.y2 - b.y1],
          den = cross(u, d);
        if (Math.abs(den) < 1e-9) continue;
        const ac = [b.x1 - c[0], b.y1 - c[1]],
          tb = cross(ac, d) / den,
          s = cross(ac, u) / den,
          tol = beamWidth(m, b) / 2 / Math.hypot(d[0], d[1]);
        if (s < -tol || s > 1 + tol || sg * (tb - (sg * F.L) / 2) < -300 || sg * (tb - t) > 400) continue;
        const bz = Math.abs(beamZ(el, b, clamp(s, 0, 1) * Math.hypot(d[0], d[1])) - z),
          sc = bz * 10 + Math.abs(tb - t);
        if (sc < bs) (bs = sc), (best = tb), (dz = bz);
      }
      // IS 456 cl 33.1(b): no beam at the landing's level ahead, so the flight bears on the landing slab
      // spanning across it; take the span half the landing width (or 1 m, if less) past the flight end
      const edge = (sg * F.L) / 2,
        deep = sg * (t - edge);
      if (deep > 0 && (best == null || dz > 300)) return edge + sg * Math.min(deep / 2, 1000);
      return best ?? t;
    };
    const a = pt(end(-1)),
      b = pt(end(1));
    spans.push({ id: uid(), name: nm(), story: flightStory(m, f), auto: true, x1: Math.round(a[0]), y1: Math.round(a[1]), x2: Math.round(b[0]), y2: Math.round(b[1]), width: F.w });
  }
  return { ...m, spans };
}

/** Name generator continuing after the highest `P<n>` in `taken`. */
export function nextNames(taken: string[], P: string) {
  let i = Math.max(0, ...taken.map((n) => (n.startsWith(P) ? +n.slice(P.length) || 0 : 0)));
  return () => `${P}${++i}`;
}

/** Auto-named items (P<n>) renumbered P1, P2, … by `key` ascending ([z, x, y]); names the user typed stay. Returns `ls` itself when nothing changed. */
export function renumber<T extends { id: string; name: string }>(ls: T[], P: string, key: (t: T) => number[]): T[] {
  const re = new RegExp(`^${P}\\d+$`);
  const k = new Map(ls.map((l) => [l.id, key(l)]));
  const auto = ls.filter((l) => re.test(l.name)).sort((a, b) => k.get(a.id)!.reduce((d, v, i) => d || v - k.get(b.id)![i], 0));
  const name = new Map(auto.map((l, i) => [l.id, `${P}${i + 1}`]));
  return ls.some((l) => name.has(l.id) && name.get(l.id) !== l.name) ? ls.map((l) => (name.has(l.id) ? { ...l, name: name.get(l.id)! } : l)) : ls;
}

/** Sort key for span numbering: the lowest flight it covers (else landing, else its story), then plan position — so S<n> follows F<n>. */
export function spanKey(m: Model, sp: Span): number[] {
  const z = (its: (Flight | Landing)[]) => Math.min(...its.filter((it) => crosses(m, sp, it)).map((it) => ('n' in it ? it.z0 : it.z)));
  const f = z(m.flights),
    l = z(m.landings);
  return [isFinite(f) ? f : isFinite(l) ? l : storyElevations(m)[sp.story]?.bottom ?? 0, Math.min(sp.x1, sp.x2), Math.min(sp.y1, sp.y2)];
}

/** New flight from the bottom of the going at `a` towards `b` (the drag also sets the width when it goes sideways ≥ 300 mm). */
export function flightFrom(m: Model, a: Pt, b: Pt, z0: number): Flight | null {
  const p = m.stair,
    dx = b.x - a.x,
    dy = b.y - a.y;
  const ax = Math.abs(dx) >= Math.abs(dy),
    len = Math.abs(ax ? dx : dy),
    lat = Math.abs(ax ? dy : dx);
  if (len < p.T) return null;
  const n = Math.max(2, Math.round(len / p.T) + 1),
    L = (n - 1) * p.T,
    w = lat >= 300 ? Math.round(lat) : p.width,
    sg = Math.sign(ax ? dx : dy),
    ls = (ax ? dy : dx) < 0 && lat >= 300;
  const dir = ((sg > 0 ? '+' : '-') + (ax ? 'x' : 'y')) as FlightDir;
  const name = nextNames(m.flights.map((f) => f.name), 'F')();
  const o = { id: uid(), name, dir, n, T: p.T, R: p.R, t: p.t, width: w, z0, x: 0, y: 0 };
  if (ax) (o.x = sg > 0 ? a.x : a.x - L), (o.y = ls ? a.y - w : a.y);
  else (o.y = sg > 0 ? a.y : a.y - L), (o.x = ls ? a.x - w : a.x);
  return o;
}

// ---------- templates (start at the bottom of `story`, plan origin at 0,0) ----------

export type TemplateKind = 'straight' | 'L' | 'dog' | 'open';
export const TEMPLATES: [TemplateKind, string][] = [
  ['straight', 'Straight flight'],
  ['L', 'L / quarter-turn'],
  ['dog', 'Dog-legged'],
  ['open', 'Open-well (C / U)'],
];

export function template(m: Model, kind: TemplateKind, story: string, beamSection: string, columnSection: string): Model {
  const p = m.stair,
    { T, R } = p,
    w = p.width,
    g = 150,
    ld = Math.max(1200, w),
    zb = storyElevations(m)[story]?.bottom ?? m.baseElevation;
  const fl: Flight[] = [],
    la: Landing[] = [],
    bm: [number, number, number, number, number][] = []; // x1 y1 x2 y2 z
  const fn = nextNames(m.flights.map((f) => f.name), 'F'),
    lnm = nextNames(m.landings.map((l) => l.name), 'L');
  const F = (o: { x: number; y: number; dir: FlightDir; n: number; z0: number }) => fl.push({ id: uid(), name: fn(), T, R, t: p.t, width: w, ...o, z0: zb + o.z0 });
  const Ld = (o: { x: number; y: number; w: number; h: number; z: number }) => la.push({ id: uid(), name: lnm(), t: p.tl, ...o, z: zb + o.z });
  const B = (x1: number, y1: number, x2: number, y2: number, z: number) => bm.push([x1, y1, x2, y2, zb + z]);
  const Lg = (n: number) => (n - 1) * T;
  if (kind === 'straight') {
    const n = 20,
      L = Lg(n);
    F({ x: 0, y: 0, dir: '+x', n, z0: 0 });
    B(0, 0, 0, w, 0);
    B(L, 0, L, w, n * R);
  }
  if (kind === 'dog') {
    const n = 10,
      L = Lg(n),
      W = 2 * w + g;
    F({ x: 0, y: 0, dir: '+x', n, z0: 0 });
    Ld({ x: L, y: 0, w: ld, h: W, z: n * R });
    F({ x: 0, y: w + g, dir: '-x', n, z0: n * R });
    B(0, 0, 0, w, 0);
    B(0, w + g, 0, W, 2 * n * R);
    B(L + ld, 0, L + ld, W, n * R);
  }
  if (kind === 'L') {
    const n = 10,
      L = Lg(n);
    F({ x: 0, y: 0, dir: '+x', n, z0: 0 });
    Ld({ x: L, y: 0, w, h: w, z: n * R });
    F({ x: L, y: w, dir: '+y', n, z0: n * R });
    B(0, 0, 0, w, 0);
    B(L + w, 0, L + w, w, n * R);
    B(L, 0, L + w, 0, n * R);
    B(L, w + L, L + w, w + L, 2 * n * R);
  }
  if (kind === 'open') {
    const n1 = 8,
      n2 = 4,
      L1 = Lg(n1),
      L2 = Lg(n2),
      z1 = n1 * R,
      z2 = (n1 + n2) * R,
      Y = 2 * w + L2,
      X = L1 + w;
    F({ x: 0, y: 0, dir: '+x', n: n1, z0: 0 });
    Ld({ x: L1, y: 0, w, h: w, z: z1 });
    F({ x: L1, y: w, dir: '+y', n: n2, z0: z1 });
    Ld({ x: L1, y: w + L2, w, h: w, z: z2 });
    F({ x: 0, y: w + L2, dir: '-x', n: n1, z0: z2 });
    B(0, 0, 0, w, 0);
    B(0, w + L2, 0, Y, (2 * n1 + n2) * R);
    B(X, 0, X, w, z1);
    B(X, w + L2, X, Y, z2);
    B(L1, 0, X, 0, z1);
    B(L1, Y, X, Y, z2);
  }
  const beams: Beam[] = bm.flatMap(([x1, y1, x2, y2, z]) => {
    const at = placeAt(m, z);
    return at ? [{ id: uid(), story: at.story, ...(at.dz ? { dz: at.dz } : {}), x1, y1, x2, y2, section: beamSection }] : [];
  });
  let out: Model = { ...m, flights: [...m.flights, ...fl], landings: [...m.landings, ...la], beams: [...m.beams, ...beams] };
  // grids on the outer beam / slab lines, and columns at their intersections, only for a model without grids
  if (!m.grids.length) {
    const xs = beams.flatMap((b) => [b.x1, b.x2]),
      ys = [...beams.flatMap((b) => [b.y1, b.y2]), ...fl.flatMap((f) => [frame(f).r.y0, frame(f).r.y1]), ...la.flatMap((l) => [l.y, l.y + l.h])];
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)],
      e = 1500;
    const grids = [makeGrid({ x: x0, y: y0 - e }, { x: x0, y: y1 + e }, '1'), makeGrid({ x: x1, y: y0 - e }, { x: x1, y: y1 + e }, '2'), makeGrid({ x: x0 - e, y: y0 }, { x: x1 + e, y: y0 }, 'A'), makeGrid({ x: x0 - e, y: y1 }, { x: x1 + e, y: y1 }, 'B')];
    out = { ...out, grids };
    const top = placeAt(m, Math.max(...fl.map((f) => f.z0 + f.n * f.R)))?.story ?? story;
    const names = m.stories.map((s) => s.name);
    const sts = names.slice(names.indexOf(story), names.indexOf(top) + 1);
    out = { ...out, columns: addColumns(out, gridIntersections(grids), sts.length ? sts : [story], columnSection, 0).columns };
  }
  return autoSpans(out);
}
