import { LEVEL_TOL, columnStories, placeAt, storyElevations, type Beam, type FrameLoad, type Model, type StairModel, type StairRegion } from '../model/types';
import { clip, type Rect } from './stair';

/** Elements this close (mm) outside the box still count as inside. */
const TOL = 1;

/** The region's box, normalised and grown by TOL. */
export const regionRect = (r: Pick<StairRegion, 'x1' | 'y1' | 'x2' | 'y2'>): Rect => ({
  x0: Math.min(r.x1, r.x2) - TOL,
  y0: Math.min(r.y1, r.y2) - TOL,
  x1: Math.max(r.x1, r.x2) + TOL,
  y1: Math.max(r.y1, r.y2) + TOL,
});

/**
 * The main model as the stair program sees it: columns standing in the box, beams crossing it (kept whole, so load
 * positions stay true to the real beam), grids clipped to it, stories from the base up to the highest one with a
 * column, beam, flight or landing in the box (all stories when the box is empty), ref planes up to that level, no slabs.
 * `clipBeams` cuts beams to the box too (for drawing; their loads are moved onto the piece), keeping their ids.
 */
export function stairContext(m: Model, r: StairRegion, clipBeams = false): StairModel {
  const R = regionRect(r);
  const inside = (x: number, y: number) => x >= R.x0 && x <= R.x1 && y >= R.y0 && y <= R.y1;
  const columns = m.columns.filter((c) => inside(c.x, c.y));
  const beams = m.beams.flatMap((b) => {
    const t = clip(b.x1, b.y1, b.x2, b.y2, R);
    return !t ? [] : clipBeams ? [clipBeam(b, t)] : [b];
  });
  const grids = m.grids.flatMap((g) => {
    const t = clip(g.x1, g.y1, g.x2, g.y2, R);
    if (!t) return [];
    const at = (k: number) => ({ x: g.x1 + (g.x2 - g.x1) * k, y: g.y1 + (g.y2 - g.y1) * k });
    const [a, b] = [at(t[0]), at(t[1])];
    return [{ ...g, x1: a.x, y1: a.y, x2: b.x, y2: b.y }];
  });

  const names = m.stories.map((s) => s.name);
  const used = [
    ...columns.flatMap((c) => columnStories(m, c)),
    ...beams.map((b) => b.story),
    ...r.flights.map((f) => placeAt(m, f.z0 + f.n * f.R)?.story ?? ''),
    ...r.landings.map((l) => placeAt(m, l.z)?.story ?? ''),
  ].map((s) => names.indexOf(s));
  const top = used.length ? Math.max(...used) : names.length - 1;
  const stories = m.stories.slice(0, top + 1);
  const keep = new Set(stories.map((s) => s.name));
  const topZ = storyElevations(m)[names[top]]?.top ?? m.baseElevation;

  return {
    ...m,
    stories,
    grids,
    columns: columns.filter((c) => keep.has(c.story)),
    beams: beams.filter((b) => keep.has(b.story)),
    slabs: [],
    jointLoads: [],
    refPlanes: m.refPlanes.filter((p) => p.z <= topZ + LEVEL_TOL),
    flights: r.flights,
    landings: r.landings,
    spans: r.spans,
    stair: r.params,
  };
}

/** The part of `b` between t0 and t1 (0–1 along it), with its loads moved onto that part and the ones off it dropped. */
function clipBeam(b: Beam, [t0, t1]: [number, number]): Beam {
  if (t0 <= 1e-9 && t1 >= 1 - 1e-9) return b;
  const L = Math.hypot(b.x2 - b.x1, b.y2 - b.y1),
    s0 = t0 * L,
    Lc = (t1 - t0) * L;
  const at = (k: number) => ({ x: b.x1 + (b.x2 - b.x1) * k, y: b.y1 + (b.y2 - b.y1) * k });
  const [a, e] = [at(t0), at(t1)];
  const shift = (l: FrameLoad): FrameLoad[] => {
    const [d1, d2] = [l.rel ? l.d1 * L : l.d1, l.rel ? l.d2 * L : l.d2].map((d) => d - s0);
    if (l.kind === 'point') return d1 < -1e-6 || d1 > Lc + 1e-6 ? [] : [{ ...l, rel: false, d1, d2: d1 }];
    const [c1, c2] = [Math.max(0, d1), Math.min(Lc, d2)];
    // shortcut: a trapezoidal load cut at the box edge keeps its end values (view only), interpolate if that ever matters
    return c2 - c1 <= 1e-6 ? [] : [{ ...l, rel: false, d1: c1, d2: c2 }];
  };
  const loads = b.loads?.flatMap(shift);
  return { ...b, x1: a.x, y1: a.y, x2: e.x, y2: e.y, ...(b.loads ? { loads } : {}) };
}
