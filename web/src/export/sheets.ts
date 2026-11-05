import { columnOn, terminatingColumns, type Beam, type Column, type Model, type Pt, type Slab } from '../model/types';
import { frameLoadUnit, shortFrameLoad } from '../model/loads';
import { dist, distToSeg, pointInPoly, polyArea } from '../model/geom';
import { columnOutline } from '../plan/snap';
import type { DxfData } from '../underlay/dxf';
import type { Region } from '../underlay/store';

// Plan sheets for the A2 PDF export: one drawing per story region (and kind), laid out on A3 frames,
// two A3 frames per A2 page. Drawing primitives are in model mm; sizes marked "paper" are mm on the sheet.

export type Box = { minX: number; minY: number; maxX: number; maxY: number };
export type Prim =
  | { t: 'line'; a: Pt; b: Pt; color: string; w: number; dash?: boolean } // w: paper mm
  | { t: 'poly'; pts: Pt[]; fill: string; op?: number; stroke?: string }
  /** centred text (lines split on \n); size in paper mm, or model mm when `model`; off = paper mm, y up */
  /** fit: placed inside these polygons (model mm) clear of underlay text, on a white mask */
  /** beam: a beam label (model mm ends); placed last on a white mask by placeBeamLabels, with a leader if crowded */
  | { t: 'text'; p: Pt; s: string; size: number; color: string; rot?: number; bold?: boolean; off?: Pt; left?: boolean; model?: boolean; anchor?: { ha: number; va: number }; fit?: Pt[][]; beam?: { a: Pt; b: Pt } }
  | { t: 'bubble'; p: Pt; u: Pt; s: string }; // grid bubble beyond end p, along unit u

export interface LegendRow { kind: 'line' | 'fill' | 'rect'; color: string; label: string[]; sub?: string }
export interface LegendGroup { title: string; rows: LegendRow[] }
export interface Drawing { title: string; region: string; stories: string[]; underlay: Prim[]; prims: Prim[]; box: Box; legend: LegendGroup[] }
export type Orient = 'L' | 'P'; // A3 landscape / portrait

export interface UnderlayIn { dxf: DxfData | null; regions: Region[]; showText: boolean }

// ---------- colours ----------
function hsl(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
const hue = (i: number) => (i * 137.508 + 215) % 360; // golden angle: neighbours stay far apart
export const strong = (i: number) => hsl(hue(i), 72, 38);
export const light = (i: number) => hsl(hue(i), 80, 78);
const AR = '#000000', INK = '#1f2429', COL = '#3a3f45', COL_END = '#22c55e'; // matches --colEnd in the app

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
const keysOf = (xs: string[]) => [...new Set(xs)].sort(natural);
const r0 = Math.round;
const fmt = (v: number) => String(Math.round(v * 1000) / 1000);

// ---------- story regions ----------
export interface Unit { stories: string[]; region: Region | null; underlay: boolean }

const onStory = (m: Model, s: string) => ({
  beams: m.beams.filter((b) => b.story === s),
  slabs: m.slabs.filter((x) => x.story === s),
  cols: m.columns.filter((c) => columnOn(m, c, s)),
});

/** What a story's plans show; equal signatures draw the same, so those stories share one drawing. */
function storySig(m: Model, s: string): string {
  const { beams, slabs, cols } = onStory(m, s);
  const ends = terminatingColumns(m);
  const sorted = (xs: unknown[]) => xs.map((x) => JSON.stringify(x)).sort();
  return JSON.stringify([
    sorted(beams.map((b) => [r0(b.x1), r0(b.y1), r0(b.x2), r0(b.y2), b.dz ?? 0, b.section, b.loads ?? []])),
    sorted(slabs.map((x) => [x.pts.map((p) => [r0(p.x), r0(p.y)]), x.dz ?? 0, x.section, x.loads ?? []])),
    sorted(cols.map((c) => [r0(c.x), r0(c.y), c.angle, c.story === s && ends.has(c.id)])),
  ]);
}

/** Consecutive stories (bottom → top) in the same DXF region that would draw the same, one unit each; empty stories skipped. */
export function storyUnits(m: Model, u: UnderlayIn): Unit[] {
  const out: (Unit & { sig: string })[] = [];
  for (const st of m.stories) {
    const { beams, slabs } = onStory(m, st.name);
    if (!beams.length && !slabs.length) continue;
    const region = u.regions.find((r) => r.stories.includes(st.name)) ?? null;
    const sig = storySig(m, st.name);
    const last = out[out.length - 1];
    if (last && last.sig === sig && last.region === region) last.stories.push(st.name);
    else out.push({ stories: [st.name], region, underlay: !!u.dxf && (!u.regions.length || !!region), sig });
  }
  return out.map(({ sig, ...x }) => x);
}
const regionLabel = (stories: string[]) => (stories.length > 1 ? `${stories[0]} – ${stories[stories.length - 1]}` : stories[0]);

// ---------- underlay ----------
/** Segments of the visible DXF layers (raw DXF coords). */
export function dxfSegs(dxf: DxfData): [Pt, Pt][] {
  const out: [Pt, Pt][] = [];
  for (const l of dxf.layers) {
    if (!l.visible) continue;
    let prev: Pt | null = null;
    for (const tok of l.d.split(/(?=[ML])/)) {
      const [x, y] = tok.slice(1).trim().split(/\s+/).map(Number);
      const p = { x, y };
      if (tok[0] === 'L' && prev) out.push([prev, p]);
      prev = p;
    }
  }
  return out;
}

/** Liang–Barsky: the part of a→b inside `c`, or null. */
export function clipSeg(a: Pt, b: Pt, c: Box): [Pt, Pt] | null {
  let t0 = 0,
    t1 = 1;
  const dx = b.x - a.x,
    dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - c.minX], [dx, c.maxX - a.x], [-dy, a.y - c.minY], [dy, c.maxY - a.y]]) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return null;
  }
  return [{ x: a.x + t0 * dx, y: a.y + t0 * dy }, { x: a.x + t1 * dx, y: a.y + t1 * dy }];
}

function underlayPrims(u: UnderlayIn, segs: [Pt, Pt][], reg: Region | null, box: Box): Prim[] {
  if (!u.dxf) return [];
  const off = reg ? reg.ref : { x: 0, y: 0 };
  const m = 1500; // show a little of the architecture around the structure
  let c: Box = { minX: box.minX - m, minY: box.minY - m, maxX: box.maxX + m, maxY: box.maxY + m };
  if (reg) c = { minX: Math.max(c.minX, reg.rect.minX - off.x), minY: Math.max(c.minY, reg.rect.minY - off.y), maxX: Math.min(c.maxX, reg.rect.maxX - off.x), maxY: Math.min(c.maxY, reg.rect.maxY - off.y) };
  const out: Prim[] = [];
  for (const [a, b] of segs) {
    const s = clipSeg({ x: a.x - off.x, y: a.y - off.y }, { x: b.x - off.x, y: b.y - off.y }, c);
    if (s) out.push({ t: 'line', a: s[0], b: s[1], color: AR, w: 0.1 });
  }
  if (u.showText) {
    const hidden = new Set(u.dxf.layers.filter((l) => !l.visible).map((l) => l.name));
    for (const t of u.dxf.texts) {
      const p = { x: t.x - off.x, y: t.y - off.y };
      if (hidden.has(t.layer) || p.x < c.minX || p.x > c.maxX || p.y < c.minY || p.y > c.maxY) continue;
      out.push({ t: 'text', p, s: t.text, size: t.h, model: true, anchor: t, rot: t.rot, color: AR });
    }
  }
  return out;
}

// ---------- element primitives ----------
function gridPrims(m: Model): Prim[] {
  const out: Prim[] = [];
  for (const g of m.grids) {
    const a = { x: g.x1, y: g.y1 },
      b = { x: g.x2, y: g.y2 },
      L = Math.hypot(b.x - a.x, b.y - a.y) || 1,
      u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
    out.push({ t: 'line', a, b, color: '#7b828c', w: 0.13, dash: true });
    if (g.bubble !== 'start') out.push({ t: 'bubble', p: b, u, s: g.label });
    if (g.bubble !== 'end') out.push({ t: 'bubble', p: a, u: { x: -u.x, y: -u.y }, s: g.label });
  }
  return out;
}

/** Text along a beam, readable left-to-right or bottom-to-top, just off its line. */
function beamText(b: Beam, s: string, color: string): Prim {
  let ang = (Math.atan2(b.y2 - b.y1, b.x2 - b.x1) * 180) / Math.PI;
  if (ang > 90.01) ang -= 180;
  if (ang <= -89.99) ang += 180;
  const r = (ang * Math.PI) / 180;
  return { t: 'text', p: { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 }, s, size: 2.8, color, rot: ang, bold: true, off: { x: -Math.sin(r) * 1.9, y: Math.cos(r) * 1.9 }, beam: { a: { x: b.x1, y: b.y1 }, b: { x: b.x2, y: b.y2 } } };
}
const beamLine = (b: Beam, color: string, w: number): Prim => ({ t: 'line', a: { x: b.x1, y: b.y1 }, b: { x: b.x2, y: b.y2 }, color, w });

// shortcut: centroid (vertex average when it falls outside an L/U-shaped slab); a pole-of-inaccessibility search would place labels better
function labelPoint(pts: Pt[]): Pt {
  let a = 0,
    x = 0,
    y = 0;
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length],
      c = p.x * q.y - q.x * p.y;
    a += c;
    x += (p.x + q.x) * c;
    y += (p.y + q.y) * c;
  });
  const g = a ? { x: x / (3 * a), y: y / (3 * a) } : pts[0];
  return pointInPoly(g, pts) ? g : { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
}

function colPoly(m: Model, c: Column, fill: string): Prim {
  const sec = m.frameSections.find((s) => s.name === c.section);
  const pts =
    sec?.shape === 'Circle'
      ? Array.from({ length: 24 }, (_, i) => ({ x: c.x + (sec.t3 / 2) * Math.cos((i * Math.PI) / 12), y: c.y + (sec.t3 / 2) * Math.sin((i * Math.PI) / 12) }))
      : columnOutline(c, sec);
  return { t: 'poly', pts, fill, stroke: INK };
}

/** 45° hatch lines clipped to a convex outline, `step` model mm apart. */
export function hatch(pts: Pt[], step: number, color: string): Prim[] {
  const d = { x: Math.SQRT1_2, y: Math.SQRT1_2 },
    n = { x: -Math.SQRT1_2, y: Math.SQRT1_2 };
  const dot = (u: Pt, p: Pt) => u.x * p.x + u.y * p.y;
  const ks = pts.map((p) => dot(n, p));
  const out: Prim[] = [];
  for (let k = Math.ceil(Math.min(...ks) / step) * step; k < Math.max(...ks); k += step) {
    const hits: Pt[] = [];
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length],
        na = ks[i] - k,
        nb = ks[(i + 1) % pts.length] - k;
      if (na * nb <= 0 && na !== nb) hits.push({ x: a.x + (b.x - a.x) * (na / (na - nb)), y: a.y + (b.y - a.y) * (na / (na - nb)) });
    });
    if (hits.length < 2) continue;
    hits.sort((p, q) => dot(d, p) - dot(d, q));
    out.push({ t: 'line', a: hits[0], b: hits[hits.length - 1], color, w: 0.13 });
  }
  return out;
}

function boxOf(prims: Prim[]): Box {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const add = (p: Pt) => ((b.minX = Math.min(b.minX, p.x)), (b.minY = Math.min(b.minY, p.y)), (b.maxX = Math.max(b.maxX, p.x)), (b.maxY = Math.max(b.maxY, p.y)));
  for (const p of prims) p.t === 'line' ? (add(p.a), add(p.b)) : p.t === 'poly' ? p.pts.forEach(add) : p.t === 'bubble' && add(p.p);
  return isFinite(b.minX) ? b : { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
}

const beamLen = (b: Beam) => Math.hypot(b.x2 - b.x1, b.y2 - b.y1) / 1000;
const lineLoadKey = (b: Beam, p: string) => (b.loads ?? []).filter((l) => l.pattern === p).map((l) => `${shortFrameLoad(l)} ${frameLoadUnit(l)}`).join(', ');
const lineLoadText = (b: Beam, p: string) => (b.loads ?? []).filter((l) => l.pattern === p).map(shortFrameLoad).join(', ');
// shortcut: short names for this project's finishes/live patterns are fixed here; make them editable per pattern if other projects name them differently
export const SHORT: Record<string, string> = { 'FIN+PAR+FIL': 'FIN', 'LIVE[<3]': 'LL', 'LIVE[>3]': 'LL', 'LIVE[ROOF]': 'LL(ROOF)' };
const short = (p: string) => SHORT[p] ?? p;

/** A slab's shell loads, one "PATTERN value" line each (short pattern names), in load pattern order. */
function shellLines(m: Model, s: Slab): string[] {
  return sortedLoads(m, s).map((l) => `${short(l.pattern)} ${l.value.toFixed(2)}${l.dir === 'Gravity' ? '' : ` (${l.dir})`}`);
}
/** The same loads as one compact on-plan label, e.g. "1.5/3". */
const shellShort = (m: Model, s: Slab) => sortedLoads(m, s).map((l) => `${fmt(l.value)}${l.dir === 'Gravity' ? '' : `(${l.dir})`}`).join('/');
function sortedLoads(m: Model, s: Slab) {
  const order = m.loadPatterns.map((p) => p.name);
  return [...(s.loads ?? [])].sort((a, b) => order.indexOf(a.pattern) - order.indexOf(b.pattern));
}

/** Slabs sharing an edge (two distinct boundary contacts within tol mm); a corner-only touch doesn't count. */
function touching(a: Pt[], b: Pt[], tol = 50): boolean {
  const on = (p: Pt, poly: Pt[]) => poly.some((q, i) => distToSeg(p, q, poly[(i + 1) % poly.length]) <= tol);
  const hits = [...a.filter((p) => on(p, b)), ...b.filter((p) => on(p, a))];
  return hits.some((p) => hits.some((q) => dist(p, q) > tol));
}

/** Groups of edge-connected polygons. */
export function clusters(polys: Pt[][]): Pt[][][] {
  const seen = new Set<number>(),
    out: Pt[][][] = [];
  polys.forEach((_, i) => {
    if (seen.has(i)) return;
    const group = [i];
    seen.add(i);
    for (let k = 0; k < group.length; k++)
      polys.forEach((q, j) => !seen.has(j) && touching(polys[group[k]], q) && (seen.add(j), group.push(j)));
    out.push(group.map((j) => polys[j]));
  });
  return out;
}

/** Area-weighted centre of a group of slabs, or the nearest slab's label point if that falls outside them all. */
function groupPoint(polys: Pt[][]): Pt {
  const a = polys.map((p) => Math.abs(polyArea(p))),
    lp = polys.map(labelPoint),
    A = a.reduce((s, x) => s + x, 0) || 1;
  const g = { x: lp.reduce((s, p, i) => s + p.x * a[i], 0) / A, y: lp.reduce((s, p, i) => s + p.y * a[i], 0) / A };
  return polys.some((p) => pointInPoly(g, p)) ? g : lp.reduce((b, p) => (dist(p, g) < dist(b, g) ? p : b));
}

/** Centre for a w×h label inside the polygons overlapping no obstacle, nearest `start`; `start` if none (paper mm). */
export function freeSpot(polys: Pt[][], w: number, h: number, start: Pt, obstacles: Box[]): Pt {
  const xs = polys.flat().map((p) => p.x),
    ys = polys.flat().map((p) => p.y);
  const pb = { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  const near = obstacles.filter((o) => o.maxX > pb.minX && o.minX < pb.maxX && o.maxY > pb.minY && o.minY < pb.maxY);
  const step = Math.max(h / 2, 0.5);
  const cands: Pt[] = [];
  for (let x = pb.minX + w / 2; x <= pb.maxX - w / 2; x += step) for (let y = pb.minY + h / 2; y <= pb.maxY - h / 2; y += step) cands.push({ x, y });
  cands.sort((a, b) => Math.hypot(a.x - start.x, a.y - start.y) - Math.hypot(b.x - start.x, b.y - start.y));
  const ok = (c: Pt) => {
    const b = { minX: c.x - w / 2, minY: c.y - h / 2, maxX: c.x + w / 2, maxY: c.y + h / 2 };
    const corners = [{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.minY }, { x: b.maxX, y: b.maxY }, { x: b.minX, y: b.maxY }];
    return [c, ...corners].every((q) => polys.some((poly) => pointInPoly(q, poly))) && !near.some((o) => o.maxX > b.minX && o.minX < b.maxX && o.maxY > b.minY && o.minY < b.maxY);
  };
  return [start, ...cands].find(ok) ?? start;
}

export interface BeamLabelIn { a: Pt; b: Pt; w: number; h: number; rot: number }
export interface BeamLabelOut { p: Pt; rot: number; box: Box; leader?: [Pt, Pt] }
const overlaps = (a: Box, b: Box) => a.maxX > b.minX && a.minX < b.maxX && a.maxY > b.minY && a.minY < b.maxY;
const inBox = (p: Pt, b: Box) => p.x > b.minX && p.x < b.maxX && p.y > b.minY && p.y < b.maxY;
const grow = (b: Box, m: number): Box => ({ minX: b.minX - m, minY: b.minY - m, maxX: b.maxX + m, maxY: b.maxY + m });
/** Proper crossing of segments pq and rs (touching ends don't count). */
export function crosses(p: Pt, q: Pt, r: Pt, s: Pt): boolean {
  const o = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return o(r, s, p) * o(r, s, q) < 0 && o(p, q, r) * o(p, q, s) < 0;
}
/** Bounding box of a w×h label centred at c, turned rot° counter-clockwise (paper, y down). */
function labelBox(c: Pt, w: number, h: number, rot: number): Box {
  const r = (rot * Math.PI) / 180,
    ex = Math.abs((w / 2) * Math.cos(r)) + Math.abs((h / 2) * Math.sin(r)),
    ey = Math.abs((w / 2) * Math.sin(r)) + Math.abs((h / 2) * Math.cos(r));
  return { minX: c.x - ex, minY: c.y - ey, maxX: c.x + ex, maxY: c.y + ey };
}

/**
 * Beam label spots (paper mm, y down), longest beam first: beside its beam at midspan, flipped or slid along it;
 * else a horizontal label nearby with a leader to the beam. A spot must miss `boxes`, every other label, leader and
 * beam line, and stay in `area`; a leader crosses no other leader or label. If nothing fits, the midspan spot.
 */
// shortcut: skewed (rotated) labels are tested by their bounding box; fine for orthogonal framing, use oriented boxes if skewed plans crowd
export function placeBeamLabels(labels: BeamLabelIn[], boxes: Box[], area: Box): BeamLabelOut[] {
  const out: BeamLabelOut[] = new Array(labels.length),
    placed: Box[] = [],
    leaders: [Pt, Pt][] = [];
  const segs = labels.map((l): [Pt, Pt] => [l.a, l.b]);
  const free = (b: Box, skip: number) =>
    b.minX >= area.minX && b.maxX <= area.maxX && b.minY >= area.minY && b.maxY <= area.maxY &&
    ![...boxes, ...placed].some((o) => overlaps(o, b)) && !leaders.some((l) => clipSeg(l[0], l[1], b)) && !segs.some((s, k) => k !== skip && clipSeg(s[0], s[1], b));
  const len = (l: BeamLabelIn) => Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y);
  const order = labels.map((_, i) => i).sort((i, k) => len(labels[k]) - len(labels[i]));
  for (const i of order) {
    const L = labels[i],
      r = (L.rot * Math.PI) / 180,
      n = { x: -Math.sin(r), y: -Math.cos(r) }; // towards the label's usual side
    const on = (t: number): Pt => ({ x: L.a.x + (L.b.x - L.a.x) * t, y: L.a.y + (L.b.y - L.a.y) * t });
    const beside = (t: number, side: number): Pt => ({ x: on(t).x + n.x * 1.9 * side, y: on(t).y + n.y * 1.9 * side });
    let done: BeamLabelOut | undefined;
    for (const t of [0.5, 0.35, 0.65, 0.25, 0.75]) {
      for (const side of [1, -1]) {
        const p = beside(t, side),
          box = labelBox(p, L.w, L.h, L.rot);
        if (!done && free(grow(box, 0.2), i)) done = { p, rot: L.rot, box };
      }
      if (done) break;
    }
    if (!done) {
      let cost = Infinity;
      for (const t of [0.5, 0.35, 0.65, 0.2, 0.8]) {
        const m = on(t);
        if ([...boxes, ...placed].some((o) => inBox(m, o))) continue;
        for (const R of [6, 9, 13, 18, 24, 30, 38])
          for (let k = 0; k < 24; k++) {
            const th = (k / 12) * Math.PI,
              p = { x: m.x + R * Math.cos(th), y: m.y + R * Math.sin(th) },
              box = labelBox(p, L.w, L.h, 0);
            if (!free(grow(box, 0.4), -1)) continue;
            const e = { x: Math.min(Math.max(m.x, box.minX), box.maxX), y: Math.min(Math.max(m.y, box.minY), box.maxY) };
            if (Math.hypot(e.x - m.x, e.y - m.y) < 3) continue;
            if (leaders.some((l) => crosses(l[0], l[1], m, e)) || [...boxes, ...placed].some((o) => clipSeg(m, e, o))) continue;
            const c = R + 3 * segs.filter((s, q) => q !== i && crosses(s[0], s[1], m, e)).length + 10 * Math.abs(t - 0.5);
            if (c < cost) (cost = c), (done = { p, rot: 0, box, leader: [m, e] });
          }
      }
    }
    if (!done) {
      const p = beside(0.5, 1);
      done = { p, rot: L.rot, box: labelBox(p, L.w, L.h, L.rot) };
    }
    out[i] = done;
    placed.push(done.box);
    if (done.leader) leaders.push(done.leader);
  }
  return out;
}

// ---------- drawings ----------
/** Every plan drawing for the model, in PDF order: framing, column layout, a line-load plan per pattern, shell loads. */
export function buildDrawings(m: Model, u: UnderlayIn): Drawing[] {
  const units = storyUnits(m, u);
  const segs = u.dxf ? dxfSegs(u.dxf) : [];
  const grids = gridPrims(m);
  const make = (unit: Unit, title: string, prims: Prim[], legend: LegendGroup[], region = regionLabel(unit.stories), stories = unit.stories): Drawing => {
    const all = [...grids, ...prims];
    const box = boxOf(all);
    return { title, region, stories, underlay: unit.underlay ? underlayPrims(u, segs, unit.region, box) : [], prims: all, box, legend };
  };
  const out: Drawing[] = [];
  const stops = terminatingColumns(m);
  // columns that stop at this floor draw green with a hatch (only where the column ends, not where a joined one passes)
  const ends = (unit: Unit, c: Column) => c.story === unit.stories[0] && stops.has(c.id);
  const endCol = (c: Column): Prim[] => {
    const p = colPoly(m, c, COL_END) as Extract<Prim, { t: 'poly' }>;
    return [p, ...hatch(p.pts, 60, INK)];
  };
  const endsLegend = (n: number): LegendGroup[] => (n ? [{ title: 'TERMINATING', rows: [{ kind: 'rect', color: COL_END, label: ['Column ends at this floor', '(hatched)'], sub: `${n} nos` }] }] : []);

  // framing
  for (const unit of units) {
    const { beams, slabs, cols } = onStory(m, unit.stories[0]);
    const bk = keysOf(beams.map((b) => b.section)),
      sk = keysOf(slabs.map((s) => s.section));
    const prims: Prim[] = [
      ...slabs.map((s): Prim => ({ t: 'poly', pts: s.pts, fill: light(sk.indexOf(s.section) + 7), op: 0.55 })),
      ...beams.map((b) => beamLine(b, strong(bk.indexOf(b.section)), 0.8)),
      // one section label per group of adjoining same-section slabs, as on the shell loads plan; after the beams so it draws over them
      ...sk.flatMap((k): Prim[] =>
        clusters(slabs.filter((s) => s.section === k).map((s) => s.pts)).map((polys) => ({ t: 'text', p: groupPoint(polys), s: k, size: polys.length > 1 ? 4.2 : 3.4, color: strong(sk.indexOf(k) + 7), bold: true, fit: polys })),
      ),
      ...beams.map((b) => beamText(b, b.section, strong(bk.indexOf(b.section)))),
      ...cols.flatMap((c) => (ends(unit, c) ? endCol(c) : [colPoly(m, c, COL)])),
    ];
    const n = (xs: string[], k: string) => xs.filter((x) => x === k).length;
    out.push(make(unit, 'FRAMING PLAN', prims, [
      { title: 'BEAMS', rows: bk.map((k, i) => ({ kind: 'line' as const, color: strong(i), label: [k], sub: `${n(beams.map((b) => b.section), k)} nos` })) },
      { title: 'SLABS', rows: sk.map((k, i) => ({ kind: 'fill' as const, color: light(i + 7), label: [k], sub: `${n(slabs.map((s) => s.section), k)} nos` })) },
      ...(cols.length ? [{ title: 'COLUMNS', rows: [{ kind: 'rect' as const, color: COL, label: ['See column layout'] }] }] : []),
      ...endsLegend(cols.filter((c) => ends(unit, c)).length),
    ].filter((g) => g.rows.length)));
  }

  // column layout per story region; marks C1, C2… are numbered over the whole building so a mark means the same section on every sheet
  const ck = keysOf(m.stories.flatMap((st) => m.columns.filter((c) => columnOn(m, c, st.name)).map((c) => c.section)));
  const mark = (s: string) => `C${ck.indexOf(s) + 1}`;
  for (const unit of units) {
    const { beams, cols } = onStory(m, unit.stories[0]);
    if (!cols.length) continue;
    const prims: Prim[] = [
      ...beams.map((b) => beamLine(b, '#b5bac1', 0.25)),
      ...cols.flatMap((c) => (ends(unit, c) ? endCol(c) : [colPoly(m, c, strong(ck.indexOf(c.section)))])),
      ...cols.flatMap((c): Prim[] => [
        { t: 'text', p: { x: c.x, y: c.y }, s: mark(c.section), size: 2.8, color: strong(ck.indexOf(c.section)), bold: true, off: { x: 4.5, y: 3.5 } },
      ]),
    ];
    const used = keysOf(cols.map((c) => c.section));
    out.push(make(unit, 'COLUMN LAYOUT', prims, [
      { title: 'COLUMN SECTIONS', rows: used.map((s) => ({ kind: 'rect', color: strong(ck.indexOf(s)), label: [`${mark(s)}  ${s}`], sub: `${cols.filter((c) => c.section === s).length} nos` })) },
      ...endsLegend(cols.filter((c) => ends(unit, c)).length),
    ]));
  }

  // beam line loads, one plan per pattern (stair loads get none)
  for (const p of m.loadPatterns.map((x) => x.name).filter((n) => !/^STAIR\b/i.test(n))) {
    for (const unit of units) {
      const { beams, cols } = onStory(m, unit.stories[0]);
      const loaded = beams.filter((b) => lineLoadKey(b, p));
      if (!loaded.length) continue;
      const lead = (k: string) => parseFloat(k.replace(/^P/, '')) || 0;
      const keys = keysOf(loaded.map((b) => lineLoadKey(b, p))).sort((a, b) => lead(b) - lead(a));
      const col = (b: Beam) => strong(keys.indexOf(lineLoadKey(b, p)));
      const prims: Prim[] = [
        ...beams.filter((b) => !lineLoadKey(b, p)).map((b) => beamLine(b, '#c4c8ce', 0.25)),
        ...loaded.map((b) => beamLine(b, col(b), 0.8)),
        ...loaded.map((b) => beamText(b, lineLoadText(b, p), col(b))),
        ...cols.map((c) => colPoly(m, c, COL)),
      ];
      const rows: LegendRow[] = keys.map((k, i) => {
        const bs = loaded.filter((b) => lineLoadKey(b, p) === k);
        return { kind: 'line', color: strong(i), label: [k], sub: `${bs.length} beams · ${bs.reduce((s, b) => s + beamLen(b), 0).toFixed(1)} m` };
      });
      out.push(make(unit, `${p} PLAN`, prims, [{ title: p, rows }, { title: 'OTHER', rows: [{ kind: 'line', color: '#c4c8ce', label: [`Beam without ${p}`] }] }]));
    }
  }

  // shell loads: slabs with the same set of loads share a colour; one value label per group of adjoining same-load slabs
  for (const unit of units) {
    const { beams, slabs, cols } = onStory(m, unit.stories[0]);
    const loaded = slabs.filter((s) => s.loads?.length);
    if (!loaded.length) continue;
    const key = (s: Slab) => shellLines(m, s).join('\n');
    const keys: string[] = [];
    loaded.forEach((s) => !keys.includes(key(s)) && keys.push(key(s)));
    const labels = keys.flatMap((k): Prim[] => {
      const group = loaded.filter((s) => key(s) === k);
      return clusters(group.map((s) => s.pts)).map((polys) => ({ t: 'text', p: groupPoint(polys), s: shellShort(m, group[0]), size: polys.length > 1 ? 4.2 : 2.8, color: INK, bold: true, fit: polys }));
    });
    const prims: Prim[] = [
      ...slabs.map((s): Prim => (s.loads?.length ? { t: 'poly', pts: s.pts, fill: light(keys.indexOf(key(s))), op: 0.8 } : { t: 'poly', pts: s.pts, fill: '#ffffff', op: 0, stroke: '#c4c8ce' })),
      ...beams.map((b) => beamLine(b, '#6b727b', 0.25)),
      ...cols.map((c) => colPoly(m, c, COL)),
      ...labels,
    ];
    const rows: LegendRow[] = keys.map((k, i) => ({ kind: 'fill', color: light(i), label: k.split('\n'), sub: shellShort(m, loaded.find((s) => key(s) === k)!) }));
    if (loaded.length < slabs.length) rows.push({ kind: 'fill', color: '#ffffff', label: ['No shell load'] });
    const used = keysOf(loaded.flatMap((s) => (s.loads ?? []).map((l) => l.pattern)).filter((p) => SHORT[p]));
    const abbr: LegendGroup[] = used.length ? [{ title: 'ABBREVIATIONS', rows: [{ kind: 'line', color: '#ffffff', label: used.map((p) => `${SHORT[p]} = ${p}`) }] }] : [];
    out.push(make(unit, 'SHELL LOADS PLAN', prims, [{ title: 'SHELL LOADS (kN/m²)', rows }, ...abbr]));
  }
  return out;
}

// ---------- layout on an A3 frame ----------
/** Inside size of an A3 frame (10 mm margins), paper mm. */
export const FRAME: Record<Orient, [number, number]> = { L: [400, 277], P: [277, 400] };
export const SCALES = [20, 25, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500];
// shortcut: text widths estimated at 0.6 em per char (no font metrics here); measure with jsPDF if columns clip
const textW = (s: string, size: number) => s.length * size * 0.6;
const LABEL_X = 9; // label start right of the swatch, paper mm
/** Legend column width and where the sub column starts, sized to the drawing's legend text (paper mm). */
export function legendCols(d: Drawing): { w: number; subX: number } {
  const rows = d.legend.flatMap((g) => g.rows);
  const subX = LABEL_X + Math.max(0, ...rows.flatMap((r) => r.label.map((l) => textW(l, 2)))) + 2;
  const subW = Math.max(0, ...rows.map((r) => (r.sub ? textW(r.sub, 1.8) : 0)));
  return { w: Math.max(subW ? subX + subW : subX, textW('LEGEND', 2.6), ...d.legend.map((g) => textW(g.title, 2.2))), subX };
}
export const rowH = (r: LegendRow) => Math.max(4.6, r.label.length * 2.7 + 1.6);
const groupH = (g: LegendGroup) => 3 + g.rows.reduce((s, r) => s + rowH(r), 0) + 4;
const BUB = 7, // grid bubble beyond a grid end, paper mm
  TITLE = 16; // title and scale lines under the plan

export interface Layout { S: number; ox: number; oy: number; legend: { x: number; y: number; side: 'right' | 'bottom' }; title: { x: number; y: number } }

/** The largest standard scale that fits, with the legend on the right or along the bottom, whichever lets the plan be bigger. Frame-local paper mm. */
export function layout(d: Drawing, o: Orient): Layout {
  const [W, H] = FRAME[o];
  const mw = d.box.maxX - d.box.minX || 1,
    mh = d.box.maxY - d.box.minY || 1,
    ex = 2 * BUB,
    ey = 2 * BUB + TITLE;
  const fit = (aw: number, ah: number) => SCALES.find((s) => mw / s + ex <= aw && mh / s + ey <= ah) ?? Math.ceil(Math.max(mw / Math.max(aw - ex, 1), mh / Math.max(ah - ey, 1)) / 50) * 50;
  const rightW = legendCols(d).w + 8,
    bottomH = 10 + Math.max(0, ...d.legend.map(groupH));
  const right = { S: fit(W - rightW - 4, H - 4), aw: W - rightW - 4, ah: H - 4, side: 'right' as const };
  const bottom = { S: fit(W - 4, H - bottomH - 4), aw: W - 4, ah: H - bottomH - 4, side: 'bottom' as const };
  const p = right.S <= bottom.S ? right : bottom;
  const S = p.S,
    bw = mw / S + ex,
    bh = mh / S + ey;
  const ox = 2 + (p.aw - bw) / 2 + BUB - d.box.minX / S,
    oy = 2 + (p.ah - bh) / 2 + BUB + d.box.maxY / S;
  return {
    S,
    ox,
    oy,
    legend: p.side === 'right' ? { x: W - rightW + 4, y: 8, side: 'right' } : { x: 6, y: H - bottomH + 6, side: 'bottom' },
    title: { x: ox + (d.box.minX + d.box.maxX) / 2 / S, y: oy - d.box.minY / S + BUB + 6 },
  };
}

/** Orientation that gives the larger drawing; landscape on a tie. */
export const suggestOrient = (d: Drawing): Orient => (layout(d, 'L').S <= layout(d, 'P').S ? 'L' : 'P');

/** Two A3 drawings of the same orientation per A2 page, in drawing order. */
export function paginate<T>(items: { item: T; o: Orient }[]): { o: Orient; slots: T[] }[] {
  const pages: { o: Orient; slots: T[] }[] = [];
  for (const { item, o } of items) {
    const open = pages.find((p) => p.o === o && p.slots.length < 2);
    if (open) open.slots.push(item);
    else pages.push({ o, slots: [item] });
  }
  return pages;
}
