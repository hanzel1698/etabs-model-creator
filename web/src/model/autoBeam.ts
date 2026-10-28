import type { Beam, FrameSection, Model, Pt } from './types';
import { cross, dist, distToSeg, dot, norm, sub } from './geom';

// Auto beam sizing (beam tool "Auto" mode).
//  - primary   (an end on a column):         width >= 300, depth >= 450
//  - secondary (ends on primary beams):      width >= 250
//  - tertiary  (ends on secondary beams…):   width 200
//  - depth = span/10 rounded up to 100, 800 max; 400 min, or 300 for spans up to 1.5 m (200x300 is for short beams only)
//  - ground floor (bottom story from the foundation inputs): periphery beams are at least the plinth height deep

const TOL = 1; // mm
const PAR = Math.sin((5 * Math.PI) / 180); // beams within 5° of each other are on the same line

export type BeamRank = 1 | 2 | 3;
export const RANK_NAME: Record<BeamRank, string> = { 1: 'primary', 2: 'secondary', 3: 'tertiary' };

export const AUTO_MIN_DEPTH = 400;
export const SHORT_SPAN = 1500; // beams up to this long may be AUTO_SHORT_DEPTH deep
export const AUTO_SHORT_DEPTH = 300;
export const PRIMARY_MIN_DEPTH = 450;
export const AUTO_MAX_DEPTH = 800;

/** span/10 in whole 100 mm steps: ≤1.5 m → 300, ≤4 m → 400, 4–5 m → 500, … 6–7 m → 700, above 7 m → 800. */
export function autoDepth(span: number): number {
  const s = Math.round(span);
  const d = Math.ceil(s / 1000) * 100;
  return Math.min(AUTO_MAX_DEPTH, Math.max(s <= SHORT_SPAN ? AUTO_SHORT_DEPTH : AUTO_MIN_DEPTH, d));
}

/** `base` is the preferred width (the active beam section's); the rank sets its lower bound, tertiary beams are 200. */
export function autoWidth(rank: BeamRank, base: number): number {
  return rank === 1 ? Math.max(base, 300) : rank === 2 ? Math.max(base, 250) : 200;
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

/**
 * The smallest listed beam section (B…, rectangular) at least `width` wide and `depth` deep: least area,
 * then shallowest, then narrowest. Undefined when none is big enough. Sections are never created.
 */
export function pickBeamSection(sections: FrameSection[], width: number, depth: number): FrameSection | undefined {
  const fits = sections.filter((s) => s.shape === 'Rectangle' && s.name.toUpperCase().startsWith('B') && s.t2 >= width && s.t3 >= depth);
  return fits.sort((a, b) => a.t2 * a.t3 - b.t2 * b.t3 || a.t3 - b.t3 || a.t2 - b.t2 || a.name.localeCompare(b.name, undefined, { numeric: true }))[0];
}

/**
 * Give the beams `ids` sections from the list for their auto sizes. `base` is the active beam section:
 * its width is the preferred width, and beams with no listed section big enough get it (`fits` false).
 * Returns the sizes it picked (by beam id).
 */
export function autoSizeBeams(m: Model, ids: string[], base: string): { model: Model; sizes: Map<string, AutoSize & { section: string; fits: boolean }> } {
  const baseWidth = m.frameSections.find((s) => s.name === base)?.t2 ?? 300;
  // classify everything against the geometry as it is, then rename
  const want = new Set(ids);
  const sizes = new Map<string, AutoSize & { section: string; fits: boolean }>();
  for (const b of m.beams)
    if (want.has(b.id)) {
      const s = autoSize(m, b, baseWidth);
      const hit = pickBeamSection(m.frameSections, s.width, s.depth);
      sizes.set(b.id, { ...s, section: hit?.name ?? base, fits: !!hit });
    }
  if (!sizes.size) return { model: m, sizes };
  const beams = m.beams.map((b) => {
    const s = sizes.get(b.id);
    return s && s.section !== b.section ? { ...b, section: s.section } : b;
  });
  return { model: { ...m, beams }, sizes };
}

/** Toast note for beams that got the active section because nothing listed was big enough. */
export function noFitNote(sizes: Map<string, AutoSize & { fits: boolean }>, base: string): string {
  const miss = [...sizes.values()].filter((s) => !s.fits);
  if (!miss.length) return '';
  const need = [...new Set(miss.map((s) => `${s.width}x${s.depth}`))].slice(0, 3).join(', ');
  return ` ${miss.length > 1 ? `${miss.length} beams need` : '1 beam needs'} a bigger section than any listed (${need}) and got ${base}.`;
}
