// Bathroom zones: a bathroom outline, and wash/urinal and toilet areas that need a minimum sink. App-only.
import { uid, type BathZone, type Model, type Pt } from '../model/types';

/** Minimum sink (mm, down-positive) of the beams and slabs a zone contains. */
export const MIN_SINK: Record<BathZone['kind'], number> = { room: 0, wash: 150, wc: 300 };
export const ZONE_LABEL: Record<BathZone['kind'], string> = { room: 'BATH', wash: 'WASH/URINAL', wc: 'WC' };

const TOL = 1; // mm: an element on the zone's edge is inside it

export function addZone(m: Model, story: string, kind: BathZone['kind'], a: Pt, b: Pt): Model {
  const z: BathZone = { id: uid(), story, kind, x1: Math.min(a.x, b.x), y1: Math.min(a.y, b.y), x2: Math.max(a.x, b.x), y2: Math.max(a.y, b.y) };
  return { ...m, bathZones: [...(m.bathZones ?? []), z] };
}
export const removeZone = (m: Model, id: string): Model => ({ ...m, bathZones: (m.bathZones ?? []).filter((z) => z.id !== id) });

const inside = (z: BathZone, p: Pt) => p.x >= z.x1 - TOL && p.x <= z.x2 + TOL && p.y >= z.y1 - TOL && p.y <= z.y2 + TOL;

/** Ids of beams and slabs on `story` lying wholly inside a wash or toilet zone yet sunk less than it needs, with the sink they need. Ducts are exempt. */
export function underSunk(m: Model, story: string): Map<string, number> {
  const out = new Map<string, number>();
  const zones = (m.bathZones ?? []).filter((z) => z.story === story && MIN_SINK[z.kind] > 0);
  const check = (id: string, pts: Pt[], sink = 0) => {
    const need = Math.max(0, ...zones.filter((z) => pts.every((p) => inside(z, p))).map((z) => MIN_SINK[z.kind]));
    if (sink < need) out.set(id, need);
  };
  if (!zones.length) return out;
  for (const b of m.beams) if (b.story === story) check(b.id, [{ x: b.x1, y: b.y1 }, { x: b.x2, y: b.y2 }], b.sink);
  for (const s of m.slabs) if (s.story === story && !s.duct) check(s.id, s.pts, s.sink);
  return out;
}
