import type { Pt } from './types';

export const EPS = 1e-6;

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
export const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
export const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;
export const len = (a: Pt) => Math.hypot(a.x, a.y);
export const norm = (a: Pt): Pt => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
};
export const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const rot = (p: Pt, deg: number): Pt => {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r),
    s = Math.sin(r);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
};

/** Infinite line intersection; returns null when parallel. */
export function lineIntersect(a1: Pt, a2: Pt, b1: Pt, b2: Pt): Pt | null {
  const d1 = sub(a2, a1),
    d2 = sub(b2, b1);
  const den = cross(d1, d2);
  if (Math.abs(den) < EPS) return null;
  const t = cross(sub(b1, a1), d2) / den;
  return add(a1, mul(d1, t));
}

/** Segment intersection with parameters; null if they do not touch. */
export function segIntersect(a1: Pt, a2: Pt, b1: Pt, b2: Pt, tol = 1e-6): { p: Pt; t: number; u: number } | null {
  const d1 = sub(a2, a1),
    d2 = sub(b2, b1);
  const den = cross(d1, d2);
  if (Math.abs(den) < EPS) return null;
  const w = sub(b1, a1);
  const t = cross(w, d2) / den;
  const u = cross(w, d1) / den;
  if (t < -tol || t > 1 + tol || u < -tol || u > 1 + tol) return null;
  return { p: add(a1, mul(d1, t)), t, u };
}

export function projectOnSeg(p: Pt, a: Pt, b: Pt): { p: Pt; t: number } {
  const d = sub(b, a);
  const L2 = dot(d, d) || 1;
  const t = Math.max(0, Math.min(1, dot(sub(p, a), d) / L2));
  return { p: add(a, mul(d, t)), t };
}

export function projectOnLine(p: Pt, a: Pt, b: Pt): Pt {
  const d = sub(b, a);
  const L2 = dot(d, d) || 1;
  const t = dot(sub(p, a), d) / L2;
  return add(a, mul(d, t));
}

export function distToSeg(p: Pt, a: Pt, b: Pt) {
  return dist(p, projectOnSeg(p, a, b).p);
}

export function polyArea(pts: Pt[]) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i],
      b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function pointInPoly(p: Pt, pts: Pt[]) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i],
      b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Signed side of p relative to directed line a→b (positive = left). */
export const side = (p: Pt, a: Pt, b: Pt) => cross(sub(b, a), sub(p, a));

/** Offset a segment by distance d to the left (d>0) or right (d<0). */
export function offsetSeg(a: Pt, b: Pt, d: number): [Pt, Pt] {
  const n = norm({ x: -(b.y - a.y), y: b.x - a.x });
  return [add(a, mul(n, d)), add(b, mul(n, d))];
}

export const angleDeg = (a: Pt, b: Pt) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;

export const fmt = (v: number, dp = 0) => (Math.abs(v) < 1e-9 ? 0 : v).toFixed(dp);

/** Parse relative input: "dx,dy" | "@dist<angle" | "dist" (along current direction). */
export function parseRelative(text: string, dirDeg: number | null): Pt | null {
  const t = text.trim().replace(/\s+/g, '');
  if (!t) return null;
  let m = t.match(/^@?(-?[\d.]+)<(-?[\d.]+)$/);
  if (m) {
    const d = +m[1],
      a = (+m[2] * Math.PI) / 180;
    return { x: d * Math.cos(a), y: d * Math.sin(a) };
  }
  m = t.match(/^@?(-?[\d.]+)[,;](-?[\d.]+)$/);
  if (m) return { x: +m[1], y: +m[2] };
  m = t.match(/^(-?[\d.]+)$/);
  if (m && dirDeg != null) {
    const a = (dirDeg * Math.PI) / 180;
    return { x: +m[1] * Math.cos(a), y: +m[1] * Math.sin(a) };
  }
  return null;
}

/** Expand "3@6000, 4500, 2x3000" into a list of spacings. */
export function parseSpacing(text: string): number[] {
  const out: number[] = [];
  for (const raw of text.split(/[,\s]+/)) {
    if (!raw) continue;
    const m = raw.match(/^(\d+)[@x*](-?[\d.]+)$/i);
    if (m) for (let i = 0; i < +m[1]; i++) out.push(+m[2]);
    else if (!isNaN(+raw)) out.push(+raw);
  }
  return out;
}

/** Spreadsheet-like labels: A..Z, AA, AB ... */
export function alphaLabel(i: number) {
  let s = '';
  i += 1;
  while (i > 0) {
    const r = (i - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}
