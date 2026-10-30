import { columnReaches, type Beam, type Column, type FrameSection, type Model, type Pt } from './types';
import { cross, dist, distToSeg, dot, norm, sub } from './geom';

// Auto beam sizing (beam tool "Auto" mode).
//  - primary   (an end on a column):         width >= 300, depth >= 450
//  - secondary (ends on primary beams):      width 250
//  - tertiary  (ends on secondary beams…):   width 200
//  - unsupported (nothing carries either end): the active section's width, no rank minimums
//  - depth = span/10 rounded up to 100, 800 max; 400 min, or 300 for spans up to 1.5 m (200x300 is for short beams only)
//  - ground floor (bottom story from the foundation inputs): periphery beams are at least the plinth height deep

const TOL = 1; // mm
const PAR = Math.sin((5 * Math.PI) / 180); // beams within 5° of each other are on the same line

export type BeamRank = 1 | 2 | 3;
/** A beam's size class: its rank, or 0 when nothing carries either end. */
export type SizeRank = BeamRank | 0;
export const RANK_NAME: Record<SizeRank, string> = { 0: 'unsupported', 1: 'primary', 2: 'secondary', 3: 'tertiary' };

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

/** `base` is the preferred width (the active beam section's); primaries are at least 300, secondaries 250, tertiaries 200, unsupported ones `base`. */
export function autoWidth(rank: SizeRank, base: number): number {
  return rank === 0 ? base : rank === 1 ? Math.max(base, 300) : rank === 2 ? 250 : 200;
}

const ends = (b: Beam): [Pt, Pt] => [
  { x: b.x1, y: b.y1 },
  { x: b.x2, y: b.y2 },
];
const dir = (b: Beam) => norm(sub({ x: b.x2, y: b.y2 }, { x: b.x1, y: b.y1 }));
const parallel = (a: Beam, b: Beam) => Math.abs(cross(dir(a), dir(b))) < PAR;
/** on the same story and level (beams on a reference plane only meet beams on that plane) */
const sameLevel = (a: Beam, b: Beam) => a.story === b.story && Math.abs((a.dz ?? 0) - (b.dz ?? 0)) < TOL;

function columnAt(m: Model, b: Beam, p: Pt): Column | undefined {
  const secs = new Map(m.frameSections.map((s) => [s.name, s]));
  return m.columns.find((c) => {
    if (!columnReaches(m, c, b)) return false;
    const s = secs.get(c.section);
    const r = s ? Math.max(s.t2, s.t3) / 2 : 200;
    return dist(c, p) <= r + TOL;
  });
}

/**
 * Beams that carry `b` at its end `p`: beams on another line that touch `p` — running through it, or
 * ending there (an L corner, e.g. `b` on the tip of a cantilever). Parallel beams never carry.
 */
function supportsAt(m: Model, b: Beam, p: Pt): Beam[] {
  return m.beams.filter((o) => o.id !== b.id && sameLevel(o, b) && !parallel(o, b) && distToSeg(p, ...ends(o)) < TOL);
}

const endsAt = (o: Beam, p: Pt) => ends(o).some((e) => dist(e, p) <= TOL);

/** The strongest beam carrying `b` at its end `p` (a line may be split into beams of different rank). */
function bestSupport(m: Model, b: Beam, p: Pt, seen: Set<string>): { rank: BeamRank; by: Beam } | undefined {
  let best: { rank: BeamRank; by: Beam } | undefined;
  for (const o of supportsAt(m, b, p))
    if (!seen.has(o.id)) {
      const r = beamRank(m, o, new Set(seen));
      if (!best || r < best.rank) best = { rank: r, by: o };
    }
  return best;
}

export function beamRank(m: Model, b: Beam, seen = new Set<string>()): BeamRank {
  const [a, c] = ends(b);
  if (columnAt(m, b, a) || columnAt(m, b, c)) return 1;
  seen.add(b.id);
  let worst = 0;
  for (const p of [a, c]) worst = Math.max(worst, bestSupport(m, b, p, seen)?.rank ?? 0);
  // no support found (floating): primary for what it carries; sizeRank sizes it as unsupported
  return Math.min(3, worst + 1) as BeamRank;
}

/** The rank `b` is sized by: 0 when no column and no beam carries either end. */
export function sizeRank(m: Model, b: Beam): SizeRank {
  const [a, c] = ends(b);
  if (columnAt(m, b, a) || columnAt(m, b, c)) return 1;
  const seen = new Set([b.id]);
  return [a, c].some((p) => bestSupport(m, b, p, seen)) ? beamRank(m, b) : 0;
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
    if (!columnReaches(m, col, b)) continue;
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
  rank: SizeRank;
  width: number;
  depth: number;
  periphery: boolean;
}

export function autoSize(m: Model, b: Beam, baseWidth: number): AutoSize {
  const rank = sizeRank(m, b);
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

const at = (p: Pt) => `(${Math.round(p.x)}, ${Math.round(p.y)})`;

const NEAR = 500; // mm: how far to look for what nearly carries a free end

/** What is near the free end `p` of `b` and why it does not carry it. */
function nearMiss(m: Model, b: Beam, p: Pt): string {
  const words: string[] = [];
  const beams = m.beams
    .filter((o) => o.id !== b.id && sameLevel(o, b))
    .map((o) => ({ o, d: distToSeg(p, ...ends(o)) }))
    .filter(({ d }) => d < NEAR)
    .sort((x, y) => x.d - y.d);
  const par = beams.find(({ o, d }) => d < TOL && parallel(o, b));
  if (par) words.push(`beam ${par.o.section} touches it but runs along the same line`);
  const off = beams.find(({ o, d }) => d >= TOL && !parallel(o, b));
  if (off) words.push(`beam ${off.o.section} is ${Math.round(off.d)} mm away (it must be within ${TOL} mm)`);
  const secs = new Map(m.frameSections.map((s) => [s.name, s]));
  const col = m.columns
    .filter((x) => columnReaches(m, x, b))
    .map((x) => {
      const s = secs.get(x.section);
      return { x, gap: dist(x, p) - (s ? Math.max(s.t2, s.t3) / 2 : 200) };
    })
    .filter(({ gap }) => gap < NEAR)
    .sort((u, v) => u.gap - v.gap)[0];
  if (col) words.push(`column ${col.x.section} at ${at(col.x)} is ${Math.round(col.gap)} mm short of it`);
  return words.length ? words.join('; ') : `nothing within ${NEAR} mm on ${b.story}`;
}

/** Why `b` is primary, secondary, tertiary or unsupported: the column or the strongest beam at each end. */
function rankReason(m: Model, b: Beam): string {
  const [a, c] = ends(b);
  for (const p of [a, c]) {
    const col = columnAt(m, b, p);
    if (col) return `primary: the end at ${at(p)} sits on column ${col.section} at ${at(col)}`;
  }
  const seen = new Set([b.id]);
  const sup = [a, c].map((p) => ({ p, s: bestSupport(m, b, p, seen) }));
  const words = sup.map(({ p, s }) =>
    s
      ? `at ${at(p)} by ${RANK_NAME[s.rank]} beam ${s.by.section}${endsAt(s.by, p) ? ' (ending there too)' : ''}`
      : `nothing at ${at(p)} (${nearMiss(m, b, p)})`
  );
  if (sup.every(({ s }) => !s)) return `unsupported: no column or beam carries either end — ${words.join(', ')}`;
  const rank = beamRank(m, b);
  const weakest = Math.max(...sup.map(({ s }) => s?.rank ?? 0)) as BeamRank;
  return (
    `${RANK_NAME[rank]}: no column at either end; carried ${words.join(', ')}; ` +
    `one level below the weaker support (${RANK_NAME[weakest]})${weakest === 3 ? ', tertiary at most' : ''}`
  );
}

/**
 * Every step behind the section the Auto rules give `b` with `base` as the active beam section: its rank and why,
 * the width and depth rules that applied, and how the listed section was picked.
 */
export function explainAutoSize(m: Model, b: Beam, base: string): string {
  const baseSec = m.frameSections.find((s) => s.name === base);
  const baseWidth = baseSec?.t2 ?? 300;
  const s = autoSize(m, b, baseWidth);
  const L = Math.round(dist(...ends(b)));
  const out = [`Rank ${rankReason(m, b)}.`];

  const pref = baseSec ? `the active section ${base} is ${baseWidth} wide` : `the active section ${base} is not listed, so 300 is assumed`;
  out.push(
    s.rank === 3
      ? `Width 200: tertiary beams are always 200 wide.`
      : s.rank === 2
      ? `Width 250: secondary beams are always 250 wide.`
      : s.rank === 0
      ? `Width ${s.width}: unsupported beams take the active section's width, and ${pref}.`
      : `Width ${s.width}: primary beams are at least 300 wide and ${pref}, so the larger of the two.`
  );

  const tenth = Math.ceil(L / 1000) * 100;
  const steps = [`span ${(L / 1000).toFixed(2)} m / 10 = ${Math.round(L / 10)}, rounded up to ${tenth}`];
  const raw = autoDepth(L);
  if (raw > tenth) steps.push(L <= SHORT_SPAN ? `raised to ${raw} (minimum for spans up to ${SHORT_SPAN / 1000} m)` : `raised to the ${raw} minimum (300 is only for spans up to ${SHORT_SPAN / 1000} m)`);
  if (raw < tenth) steps.push(`capped at the ${AUTO_MAX_DEPTH} maximum`);
  let d = raw;
  if (s.rank === 1 && d < PRIMARY_MIN_DEPTH) steps.push(`raised to ${(d = PRIMARY_MIN_DEPTH)} (primary minimum)`);
  if (s.periphery && s.depth > d) steps.push(`raised to ${s.depth} (ground-floor periphery beam: at least the plinth height)`);
  else if (s.periphery) steps.push(`already at least the plinth height (ground-floor periphery beam)`);
  out.push(`Depth ${s.depth}: ${steps.join(', ')}.`);

  const fits = m.frameSections
    .filter((x) => x.shape === 'Rectangle' && x.name.toUpperCase().startsWith('B') && x.t2 >= s.width && x.t3 >= s.depth)
    .sort((x, y) => x.t2 * x.t3 - y.t2 * y.t3 || x.t3 - y.t3 || x.t2 - y.t2);
  const hit = pickBeamSection(m.frameSections, s.width, s.depth);
  if (!hit) out.push(`Section ${base}: no listed beam section is at least ${s.width}×${s.depth}, so it keeps the active section.`);
  else {
    const exact = hit.t2 === s.width && hit.t3 === s.depth;
    const next = fits.filter((x) => x !== hit).slice(0, 3).map((x) => x.name);
    out.push(
      `Section ${hit.name} (${hit.t2}×${hit.t3}): ` +
        (exact ? `listed at exactly ${s.width}×${s.depth}.` : `no listed section is exactly ${s.width}×${s.depth}; this is the smallest listed one at least that big (least area).`) +
        (next.length ? ` Next that fit: ${next.join(', ')}.` : '')
    );
  }
  return out.join(' ');
}

/** Toast note for beams that got the active section because nothing listed was big enough. */
export function noFitNote(sizes: Map<string, AutoSize & { fits: boolean }>, base: string): string {
  const miss = [...sizes.values()].filter((s) => !s.fits);
  if (!miss.length) return '';
  const need = [...new Set(miss.map((s) => `${s.width}x${s.depth}`))].slice(0, 3).join(', ');
  return ` ${miss.length > 1 ? `${miss.length} beams need` : '1 beam needs'} a bigger section than any listed (${need}) and got ${base}.`;
}
