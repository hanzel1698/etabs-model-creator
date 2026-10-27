import DxfParser from 'dxf-parser';
import type { Pt } from '../model/types';

export interface DxfLayer {
  name: string;
  d: string; // SVG path data in scaled drawing coordinates (mm)
  visible: boolean;
}

export interface DxfText {
  x: number;
  y: number;
  h: number;
  rot: number;
  text: string;
  layer: string;
}

export interface DxfData {
  layers: DxfLayer[];
  texts: DxfText[];
  segs: [Pt, Pt][]; // for snapping/measuring
  points: Pt[]; // endpoints, centres
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  insUnits: number;
}

// $INSUNITS → mm
const UNIT_MM: Record<number, number> = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 0: 1 };
export const unitScaleFromInsunits = (u: number) => UNIT_MM[u] ?? 1;

type M = [number, number, number, number, number, number]; // a b c d e f  (x' = a x + c y + e)
const I: M = [1, 0, 0, 1, 0, 0];
const mulM = (p: M, q: M): M => [
  p[0] * q[0] + p[2] * q[1],
  p[1] * q[0] + p[3] * q[1],
  p[0] * q[2] + p[2] * q[3],
  p[1] * q[2] + p[3] * q[3],
  p[0] * q[4] + p[2] * q[5] + p[4],
  p[1] * q[4] + p[3] * q[5] + p[5],
];
const ap = (m: M, x: number, y: number): Pt => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

function arcPts(cx: number, cy: number, r: number, a0: number, a1: number): { x: number; y: number }[] {
  while (a1 <= a0) a1 += Math.PI * 2;
  const n = Math.max(4, Math.ceil(((a1 - a0) / (Math.PI * 2)) * 48));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return out;
}

/** Points of a polyline with bulges, arcs expanded. */
function bulgePts(vs: any[], closed: boolean): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const n = vs.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = vs[i],
      b = vs[(i + 1) % n];
    out.push({ x: a.x, y: a.y });
    const bulge = a.bulge || 0;
    if (Math.abs(bulge) > 1e-9) {
      const theta = 4 * Math.atan(bulge);
      const c = Math.hypot(b.x - a.x, b.y - a.y);
      const r = c / (2 * Math.sin(theta / 2));
      const mx = (a.x + b.x) / 2,
        my = (a.y + b.y) / 2;
      const h = r * Math.cos(theta / 2);
      const nx = -(b.y - a.y) / c,
        ny = (b.x - a.x) / c;
      const cx = mx + nx * h,
        cy = my + ny * h;
      const a0 = Math.atan2(a.y - cy, a.x - cx);
      const steps = Math.max(2, Math.ceil((Math.abs(theta) / (Math.PI * 2)) * 48));
      for (let k = 1; k < steps; k++) {
        const t = a0 + (theta * k) / steps;
        out.push({ x: cx + Math.abs(r) * Math.cos(t), y: cy + Math.abs(r) * Math.sin(t) });
      }
    }
  }
  if (!closed && n) out.push({ x: vs[n - 1].x, y: vs[n - 1].y });
  else if (closed && n) out.push({ x: vs[0].x, y: vs[0].y });
  return out;
}

export function parseDxf(text: string, scale: number): DxfData {
  const parser = new DxfParser();
  const dxf: any = parser.parseSync(text);
  const insUnits = dxf?.header?.$INSUNITS ?? 0;
  const byLayer = new Map<string, string[]>();
  const texts: DxfText[] = [];
  const segs: [Pt, Pt][] = [];
  const points: Pt[] = [];
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const S: M = [scale, 0, 0, scale, 0, 0];

  const emitPoly = (layer: string, m: M, pts: { x: number; y: number }[], closed = false, snapVerts = true) => {
    if (pts.length < 2) return;
    const w = pts.map((p) => ap(m, p.x, p.y));
    if (closed) w.push(w[0]);
    let d = `M${w[0].x.toFixed(1)} ${w[0].y.toFixed(1)}`;
    for (let i = 1; i < w.length; i++) {
      d += `L${w[i].x.toFixed(1)} ${w[i].y.toFixed(1)}`;
      segs.push([w[i - 1], w[i]]);
    }
    for (const p of w) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    if (snapVerts) points.push(...w);
    else points.push(w[0], w[w.length - 1]);
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer)!.push(d);
  };

  const walk = (ents: any[], m: M, depth: number, parentLayer?: string) => {
    if (!ents || depth > 8) return;
    for (const e of ents) {
      const layer = e.layer === '0' && parentLayer ? parentLayer : e.layer || '0';
      try {
        switch (e.type) {
          case 'LINE':
            emitPoly(layer, m, e.vertices);
            break;
          case 'LWPOLYLINE':
          case 'POLYLINE': {
            const closed = !!e.shape || !!e.closed;
            const hasBulge = e.vertices?.some((v: any) => v.bulge);
            if (hasBulge) emitPoly(layer, m, bulgePts(e.vertices, closed), false, false);
            else emitPoly(layer, m, e.vertices, closed);
            break;
          }
          case 'CIRCLE': {
            emitPoly(layer, m, arcPts(e.center.x, e.center.y, e.radius, 0, Math.PI * 2), false, false);
            points.push(ap(m, e.center.x, e.center.y));
            break;
          }
          case 'ARC':
            emitPoly(layer, m, arcPts(e.center.x, e.center.y, e.radius, e.startAngle, e.endAngle), false, false);
            points.push(ap(m, e.center.x, e.center.y));
            break;
          case 'TEXT':
          case 'MTEXT': {
            const p = e.startPoint || e.position;
            if (!p || !e.text) break;
            const w = ap(m, p.x, p.y);
            const sc = Math.hypot(m[0], m[1]);
            const raw = String(e.text)
              .replace(/\\P/g, ' ')
              .replace(/\\[A-Za-z][^;]*;/g, '')
              .replace(/[{}]/g, '');
            texts.push({ x: w.x, y: w.y, h: (e.textHeight || e.height || 2.5) * sc, rot: (e.rotation || 0) + (Math.atan2(m[1], m[0]) * 180) / Math.PI, text: raw, layer });
            break;
          }
          case 'INSERT': {
            const blk = dxf.blocks?.[e.name];
            if (!blk) break;
            const r = ((e.rotation || 0) * Math.PI) / 180;
            const sx = e.xScale ?? 1,
              sy = e.yScale ?? 1;
            const bp = blk.position || { x: 0, y: 0 };
            const cols = Math.max(1, e.columnCount || 1),
              rows = Math.max(1, e.rowCount || 1);
            for (let ci = 0; ci < cols; ci++)
              for (let ri = 0; ri < rows; ri++) {
                const ox = ci * (e.columnSpacing || 0),
                  oy = ri * (e.rowSpacing || 0);
                // T(pos) * R * S * T(-base)
                const T: M = [1, 0, 0, 1, e.position.x, e.position.y];
                const R: M = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
                const Sc: M = [sx, 0, 0, sy, 0, 0];
                const B: M = [1, 0, 0, 1, -bp.x + ox / sx, -bp.y + oy / sy];
                walk(blk.entities, mulM(m, mulM(T, mulM(R, mulM(Sc, B)))), depth + 1, layer);
              }
            break;
          }
        }
      } catch {
        /* skip malformed entity */
      }
    }
  };
  walk(dxf.entities, S, 0);

  const layers: DxfLayer[] = [...byLayer.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, ds]) => ({ name, d: ds.join(''), visible: true }));
  if (!isFinite(minX)) (minX = 0), (minY = 0), (maxX = 1000), (maxY = 1000);
  return { layers, texts, segs, points, bbox: { minX, minY, maxX, maxY }, insUnits };
}

export { I };
