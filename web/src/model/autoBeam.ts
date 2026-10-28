import type { Beam, FrameSection, Model, Pt } from './types';
import { cross, dist, distToSeg, dot, norm, sub } from './geom';

// Auto beam sizing (beam tool "Auto" mode).
//  - primary   (an end on a column):         width >= 300, depth >= 450
//  - secondary (ends on primary beams):      width <= 250
//  - tertiary  (ends on secondary beams…):   width <= 200
//  - depth = span/10 rounded up to 100, 300 min, 800 max
//  - ground floor (bottom story from the foundation inputs): periphery beams are at least the plinth height deep

const TOL = 1; // mm
const PAR = Math.sin((5 * Math.PI) / 180); // beams within 5° of each other are on the same line

export type BeamRank = 1 | 2 | 3;
export const RANK_NAME: Record<BeamRank, string> = { 1: 'primary', 2: 'secondary', 3: 'tertiary' };

export const AUTO_MIN_DEPTH = 300;
export const PRIMARY_MIN_DEPTH = 450;
export const AUTO_MAX_DEPTH = 800;

/** span/10 in whole 100 mm steps: ≤3 m → 300, 3–4 m → 400, … 6–7 m → 700, above 7 m → 800. */
export function autoDepth(span: number): number {
  const d = Math.ceil(Math.round(span) / 1000) * 100;
  return Math.min(AUTO_MAX_DEPTH, Math.max(AUTO_MIN_DEPTH, d));
}

/** `base` is the preferred width (the active beam section's); the rank sets its lower or upper bound. */
export function autoWidth(rank: BeamRank, base: number): number {
  return rank === 1 ? Math.max(base, 300) : Math.min(base, rank === 2 ? 250 : 200);
}

const ends = (b: Beam): [Pt, Pt] => [
  { x: b.x1, y: b.y1 },
  { x: b.x2, y: b.y2 },
];
const dir = (b: Beam) => norm(sub({ x: b.x2, y: b.y2 }, { x: b.x1, y: b.y1 }));
const parallel = (a: Beam, b: Beam) => Math.abs(cross(dir(a), dir(b))) < PAR;

function onColumn(m: Model, story: string, p: Pt): boolean {
  const secs = new Map(m.frameSections.map((s) => [s.name, s]));
  return m.columns.some((c) => {
    if (c.story !== story) return false;
    const s = secs.get(c.section);
    const r = s ? Math.max(s.t2, s.t3) / 2 : 200;
    return dist(c, p) <= r + TOL;
  });
}

/**
 * Beams that carry `b` at its end `p`: beams on another line that run through `p` — either `p` is
 * inside one of them, or the line continues on both sides of `p` (a girder split at the junction).
 * A lone beam ending at `p` (an L corner) is not a support. Grouped per line.
 */
function supportsAt(m: Model, b: Beam, p: Pt): Beam[][] {
  const touching = m.beams.filter((o) => o.id !== b.id && o.story === b.story && !parallel(o, b) && distToSeg(p, ...ends(o)) < TOL);
  const lines: Beam[][] = [];
  for (const o of touching) {
    const line = lines.find((l) => parallel(l[0], o) && distToSeg(p, ...ends(l[0])) < TOL);
    line ? line.push(o) : lines.push([o]);
  }
  return lines.filter((line) => {
    if (line.some((o) => ends(o).every((e) => dist(e, p) > TOL))) return true;
    const d = dir(line[0]);
    const sides = new Set(line.map((o) => Math.sign(dot(sub(ends(o)[0], p), d) + dot(sub(ends(o)[1], p), d))));
    return sides.has(1) && sides.has(-1);
  });
}

export function beamRank(m: Model, b: Beam, seen = new Set<string>()): BeamRank {
  const [a, c] = ends(b);
  if (onColumn(m, b.story, a) || onColumn(m, b.story, c)) return 1;
  seen.add(b.id);
  let worst = 0;
  for (const p of [a, c]) {
    // strongest support at this end (a line may be split into beams of different rank)
    let best = Infinity;
    for (const line of supportsAt(m, b, p))
      for (const o of line) if (!seen.has(o.id)) best = Math.min(best, beamRank(m, o, new Set(seen)));
    if (best < Infinity) worst = Math.max(worst, best);
  }
  // no support found (floating, or only L corners): treat as primary
  return Math.min(3, worst + 1) as BeamRank;
}

/**
 * Is `b` on the outside of its story's plan? True when one side of it has nothing over its span:
 * no other beam overlapping it there and no column strictly within it.
 */
export function isPeriphery(m: Model, b: Beam): boolean {
  const [a, c] = ends(b);
  const L = dist(a, c);
  if (L < TOL) return false;
  const t = (p: Pt) => dot(sub(p, a), sub(c, a)) / (L * L); // position along the beam, 0..1 within it
  const eps = TOL / L;
  const has: Record<number, boolean> = { 1: false, [-1]: false };
  const sideOf = (p: Pt) => {
    const s = cross(sub(c, a), sub(p, a)) / L;
    return Math.abs(s) < TOL ? 0 : Math.sign(s);
  };
  for (const o of m.beams) {
    if (o.id === b.id || o.story !== b.story) continue;
    const [p, q] = ends(o);
    const sp = sideOf(p),
      sq = sideOf(q);
    // must reach inside the span; touching only at an end (an L corner, the next bay) does not count
    if (Math.max(t(p), t(q)) <= eps || Math.min(t(p), t(q)) >= 1 - eps) continue;
    if (sp) has[sp] = true;
    if (sq) has[sq] = true;
  }
  for (const col of m.columns) {
    if (col.story !== b.story) continue;
    const tc = t(col);
    const s = sideOf(col);
    if (s && tc > eps && tc < 1 - eps) has[s] = true;
  }
  return !has[1] || !has[-1];
}

/** The ground-floor story (from the foundation inputs) and its plinth height, if any. */
function plinthFor(m: Model, story: string): number {
  return m.foundation && m.stories[0]?.name === story && m.foundation.plinthHeight > 0 ? m.foundation.plinthHeight : 0;
}

export interface AutoSize {
  rank: BeamRank;
  width: number;
  depth: number;
  periphery: boolean;
}

export function autoSize(m: Model, b: Beam, baseWidth: number): AutoSize {
  const rank = beamRank(m, b);
  let depth = autoDepth(dist(...ends(b)));
  if (rank === 1) depth = Math.max(depth, PRIMARY_MIN_DEPTH);
  const plinth = plinthFor(m, b.story);
  const periphery = plinth > 0 && isPeriphery(m, b);
  if (periphery) depth = Math.max(depth, Math.ceil(plinth));
  return { rank, width: autoWidth(rank, baseWidth), depth, periphery };
}

/** Name of a rectangular section with these dimensions, creating `B{w}x{d}` when there is none. */
export function ensureBeamSection(m: Model, width: number, depth: number, material: string): { model: Model; name: string } {
  const hit = m.frameSections.find((s) => s.shape === 'Rectangle' && s.t2 === width && s.t3 === depth && s.name.toUpperCase().startsWith('B'));
  if (hit) return { model: m, name: hit.name };
  let name = `B${width}x${depth}`;
  for (let n = 2; m.frameSections.some((s) => s.name === name); n++) name = `B${width}x${depth}_${n}`;
  const sec: FrameSection = { name, shape: 'Rectangle', t2: width, t3: depth, material, fromEtabs: false };
  return { model: { ...m, frameSections: [...m.frameSections, sec] }, name };
}

/**
 * Give the beams `ids` auto sections. `base` is the active beam section: its width is the preferred
 * width and its material is used for new sections. Returns the sizes it picked (by beam id).
 */
export function autoSizeBeams(m: Model, ids: string[], base: string): { model: Model; sizes: Map<string, AutoSize & { section: string }> } {
  const bs = m.frameSections.find((s) => s.name === base);
  const baseWidth = bs?.t2 ?? 300;
  const material = bs?.material ?? m.frameSections.find((s) => s.name.toUpperCase().startsWith('B'))?.material ?? m.materials[0]?.name ?? '';
  // classify everything against the geometry as it is, then rename
  const want = new Set(ids);
  const sizes = new Map<string, AutoSize & { section: string }>();
  for (const b of m.beams) if (want.has(b.id)) sizes.set(b.id, { ...autoSize(m, b, baseWidth), section: '' });
  let out = m;
  for (const s of sizes.values()) {
    const r = ensureBeamSection(out, s.width, s.depth, material);
    out = r.model;
    s.section = r.name;
  }
  if (!sizes.size) return { model: m, sizes };
  const beams = out.beams.map((b) => {
    const s = sizes.get(b.id);
    return s && s.section !== b.section ? { ...b, section: s.section } : b;
  });
  return { model: { ...out, beams }, sizes };
}
