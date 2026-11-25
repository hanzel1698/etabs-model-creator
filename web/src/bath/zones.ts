// Bathroom zones: a bathroom (drawn polygon), and wash/urinal and toilet areas (groups of slab panels) that need a minimum sink. App-only.
import { uid, type BathZone, type Model, type Pt } from '../model/types';
import { distToSeg, pointInPoly, polyArea, segIntersect } from '../model/geom';

/** Minimum sink (mm, down-positive) of the beams and slabs a zone contains. */
export const MIN_SINK: Record<BathZone['kind'], number> = { room: 0, wash: 150, wc: 300 };
export const ZONE_LABEL: Record<BathZone['kind'], string> = { room: 'BATH', wash: 'WASH/URINAL', wc: 'WC' };
export const ZONE_COLOR: Record<BathZone['kind'], string> = { room: '#3fa7d6', wash: '#2bb59a', wc: '#b06ad9' };
export const ZONE_KINDS: BathZone['kind'][] = ['room', 'wash', 'wc'];
const PREFIX: Record<BathZone['kind'], string> = { room: 'BATH', wash: 'WASH', wc: 'WC' };

const TOL = 1; // mm: a point on a bathroom's edge is inside it
const SIDE = 5; // mm: how far either side of a beam is probed for the area's panels

/** A zone with its plan shape: a bathroom's polygon, or the outlines of an area's panels. */
export type Zone = BathZone & { polys: Pt[][] };

/** First free name of a kind: BATH-01, WC-01, WASH-01 … */
export function nextZoneName(m: Model, kind: BathZone['kind']): string {
  for (let i = 1; ; i++) {
    const n = `${PREFIX[kind]}-${String(i).padStart(2, '0')}`;
    if (!(m.bathZones ?? []).some((z) => z.name === n)) return n;
  }
}

/** Add a bathroom drawn as a polygon. */
export function addZone(m: Model, story: string, kind: 'room', pts: Pt[]): Model {
  const z: BathZone = { id: uid(), story, kind, pts: pts.map((p) => ({ ...p })), name: nextZoneName(m, kind) };
  return { ...m, bathZones: [...(m.bathZones ?? []), z] };
}

/**
 * Group the slabs `ids` on `story` into one new wash/urinal or toilet area (WC-01 …). A panel belongs to one area:
 * it leaves any area it was in, and an area left with no panels goes.
 */
export function addArea(m: Model, story: string, kind: 'wash' | 'wc', ids: string[]): Model {
  const mine = m.slabs.filter((s) => s.story === story && ids.includes(s.id)).map((s) => s.id);
  if (!mine.length) return m;
  const rest = (m.bathZones ?? [])
    .map((z) => (z.slabIds ? { ...z, slabIds: z.slabIds.filter((id) => !mine.includes(id)) } : z))
    .filter((z) => !z.slabIds || z.slabIds.length);
  const name = nextZoneName({ ...m, bathZones: rest }, kind);
  return { ...m, bathZones: [...rest, { id: uid(), story, kind, slabIds: mine, name }] };
}

export const removeZone = (m: Model, id: string): Model => ({ ...m, bathZones: (m.bathZones ?? []).filter((z) => z.id !== id) });

/** `m` with every unnamed bathroom (saved before bathrooms were numbered) given the next free number; `m` itself when none lacks one. */
export function nameBaths(m: Model): Model {
  if (!(m.bathZones ?? []).some((z) => z.kind === 'room' && !z.name)) return m;
  let out = m;
  for (const z of m.bathZones!) if (z.kind === 'room' && !z.name) out = { ...out, bathZones: out.bathZones!.map((x) => (x.id === z.id ? { ...x, name: nextZoneName(out, 'room') } : x)) };
  return out;
}

export const zoneName = (z: BathZone): string => z.name ?? ZONE_LABEL[z.kind];

/**
 * Zones on `story` with their shapes. Skips what has no shape: a bathroom without a polygon, an area whose panels were all
 * deleted, and wash/WC areas drawn as polygons by an earlier version of this tool (they are now made from panels).
 */
export function zonesOn(m: Model, story: string): Zone[] {
  const slabs = new Map(m.slabs.filter((s) => s.story === story).map((s) => [s.id, s.pts]));
  const out: Zone[] = [];
  for (const z of m.bathZones ?? []) {
    if (z.story !== story) continue;
    const polys = z.kind === 'room' ? (z.pts && z.pts.length >= 3 ? [z.pts] : []) : (z.slabIds ?? []).flatMap((id) => (slabs.has(id) ? [slabs.get(id)!] : []));
    if (polys.length) out.push({ ...z, polys });
  }
  return out;
}

export const zoneArea = (z: Zone): number => z.polys.reduce((a, p) => a + Math.abs(polyArea(p)), 0);

/** Top-left corner of a zone, where its name goes. */
export const labelAt = (z: Zone): Pt => z.polys.flat().reduce((a, p) => (p.y - p.x > a.y - a.x ? p : a));

const inPoly = (pts: Pt[], p: Pt) => pointInPoly(p, pts) || pts.some((a, i) => distToSeg(p, a, pts[(i + 1) % pts.length]) <= TOL);

/** Bathrooms on `story`, each with the wash/WC areas lying inside it, plus those inside no bathroom (`room` null). */
export function zoneGroups(m: Model, story: string): { room: Zone | null; parts: Zone[] }[] {
  const zs = zonesOn(m, story);
  const groups = zs.filter((z) => z.kind === 'room').map((room) => ({ room: room as Zone | null, parts: [] as Zone[] }));
  const loose: Zone[] = [];
  // a part inside several bathrooms (one drawn inside another) belongs to the smallest
  for (const z of zs)
    if (z.kind !== 'room') (groups.filter((g) => z.polys.flat().every((p) => inPoly(g.room!.polys[0], p))).sort((a, b) => zoneArea(a.room!) - zoneArea(b.room!))[0]?.parts ?? loose).push(z);
  groups.sort((a, b) => zoneName(a.room!).localeCompare(zoneName(b.room!)));
  return loose.length ? [...groups, { room: null, parts: loose }] : groups;
}

/** The segment a→b runs through the inside of the area made by `polys`: its panels on both sides of it (between two panels, or across one), not just along its outer edge. */
function cutsAcross(polys: Pt[][], a: Pt, b: Pt): boolean {
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  if (!L) return false;
  const n = { x: (-(b.y - a.y) / L) * SIDE, y: ((b.x - a.x) / L) * SIDE };
  const ts = [0, 1, ...polys.flatMap((pts) => pts.flatMap((p, i) => segIntersect(a, b, p, pts[(i + 1) % pts.length])?.t ?? []))].sort((x, y) => x - y);
  const inAny = (p: Pt) => polys.some((pts) => pointInPoly(p, pts));
  for (let i = 1; i < ts.length; i++) {
    if (ts[i] - ts[i - 1] < 1e-9) continue;
    const t = (ts[i] + ts[i - 1]) / 2,
      mid = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    if (inAny({ x: mid.x + n.x, y: mid.y + n.y }) && inAny({ x: mid.x - n.x, y: mid.y - n.y })) return true;
  }
  return false;
}

/**
 * Ids of beams and slabs on `story` short of a wash or toilet area's sink, with the sink they need:
 * a panel of the area sunk less than it needs, and a beam with no sink running through the area's inside;
 * beams along its outer edge are its supports and stay flush. Ducts are exempt.
 */
export function underSunk(m: Model, story: string): Map<string, number> {
  const out = new Map<string, number>();
  const need = (id: string, v: number) => out.set(id, Math.max(v, out.get(id) ?? 0));
  const areas = zonesOn(m, story).filter((z) => MIN_SINK[z.kind] > 0);
  if (!areas.length) return out;
  const slabs = new Map(m.slabs.map((s) => [s.id, s]));
  for (const z of areas) {
    const min = MIN_SINK[z.kind];
    for (const id of z.slabIds ?? []) {
      const s = slabs.get(id);
      if (s && !s.duct && (s.sink ?? 0) < min) need(id, min);
    }
    for (const b of m.beams) if (b.story === story && (b.sink ?? 0) <= 0 && cutsAcross(z.polys, { x: b.x1, y: b.y1 }, { x: b.x2, y: b.y2 })) need(b.id, min);
  }
  return out;
}
