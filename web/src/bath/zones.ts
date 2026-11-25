// Bathroom zones: a bathroom outline, and wash/urinal and toilet areas that need a minimum sink. App-only.
import { uid, type BathZone, type Model, type Pt } from '../model/types';
import { distToSeg, pointInPoly } from '../model/geom';

/** Minimum sink (mm, down-positive) of the beams and slabs a zone contains. */
export const MIN_SINK: Record<BathZone['kind'], number> = { room: 0, wash: 150, wc: 300 };
export const ZONE_LABEL: Record<BathZone['kind'], string> = { room: 'BATH', wash: 'WASH/URINAL', wc: 'WC' };
export const ZONE_COLOR: Record<BathZone['kind'], string> = { room: '#3fa7d6', wash: '#2bb59a', wc: '#b06ad9' };
export const ZONE_KINDS: BathZone['kind'][] = ['room', 'wash', 'wc'];

const TOL = 1; // mm: an element on the zone's edge is inside it

export function addZone(m: Model, story: string, kind: BathZone['kind'], pts: Pt[]): Model {
  return { ...m, bathZones: [...(m.bathZones ?? []), { id: uid(), story, kind, pts: pts.map((p) => ({ ...p })) }] };
}
export const removeZone = (m: Model, id: string): Model => ({ ...m, bathZones: (m.bathZones ?? []).filter((z) => z.id !== id) });

/** Zones on `story` (skips any without a polygon, e.g. a box zone saved by the first version of this tool). */
export const zonesOn = (m: Model, story: string): BathZone[] => (m.bathZones ?? []).filter((z) => z.story === story && z.pts?.length >= 3);

/** Top-left corner of a zone, where its name goes. */
export const labelAt = (z: BathZone): Pt => z.pts.reduce((a, p) => (p.y - p.x > a.y - a.x ? p : a));

const inside = (z: BathZone, p: Pt) => pointInPoly(p, z.pts) || z.pts.some((a, i) => distToSeg(p, a, z.pts[(i + 1) % z.pts.length]) <= TOL);

/**
 * Ids of beams and slabs on `story` lying wholly inside a wash or toilet zone yet sunk less than it needs, with the sink they need. Ducts are exempt.
 * shortcut: "wholly inside" tests the element's corners (and a beam's midpoint), so a slab edge cutting across a notch of an L-shaped zone still counts; test edge crossings if that bites.
 */
export function underSunk(m: Model, story: string): Map<string, number> {
  const out = new Map<string, number>();
  const zones = zonesOn(m, story).filter((z) => MIN_SINK[z.kind] > 0);
  const check = (id: string, pts: Pt[], sink = 0) => {
    const need = Math.max(0, ...zones.filter((z) => pts.every((p) => inside(z, p))).map((z) => MIN_SINK[z.kind]));
    if (sink < need) out.set(id, need);
  };
  if (!zones.length) return out;
  for (const b of m.beams)
    if (b.story === story) check(b.id, [{ x: b.x1, y: b.y1 }, { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 }, { x: b.x2, y: b.y2 }], b.sink);
  for (const s of m.slabs) if (s.story === story && !s.duct) check(s.id, s.pts, s.sink);
  return out;
}
