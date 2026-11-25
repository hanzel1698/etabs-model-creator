// Bathroom zones: bathrooms, and the wash/urinal and toilet areas in them, each a group of slab panels; an area needs a minimum sink. App-only.
import { uid, type BathZone, type Model, type Pt } from '../model/types';
import { distToSeg, pointInPoly, polyArea, segIntersect } from '../model/geom';

/** Minimum sink (mm, down-positive) of the beams and slabs a zone contains. */
export const MIN_SINK: Record<BathZone['kind'], number> = { room: 0, wash: 150, wc: 300 };
export const ZONE_LABEL: Record<BathZone['kind'], string> = { room: 'BATH', wash: 'WASH/URINAL', wc: 'WC' };
export const ZONE_COLOR: Record<BathZone['kind'], string> = { room: '#3fa7d6', wash: '#2bb59a', wc: '#b06ad9' };
export const ZONE_KINDS: BathZone['kind'][] = ['room', 'wash', 'wc'];
const PREFIX: Record<BathZone['kind'], string> = { room: 'BATH', wash: 'WASH', wc: 'WC' };
const NOUN: Record<BathZone['kind'], string> = { room: 'bathrooms', wash: 'wash/urinal areas', wc: 'WC areas' };

const TOL = 1; // mm: a point on an outline's edge is inside it
const SIDE = 5; // mm: how far either side of a beam is probed for the area's panels

/** A zone with its plan shape: the outlines of its panels. */
export type Zone = BathZone & { polys: Pt[][] };

/** First free name of a kind: BATH-01, WC-01, WASH-01 … */
export function nextZoneName(m: Model, kind: BathZone['kind']): string {
  for (let i = 1; ; i++) {
    const n = `${PREFIX[kind]}-${String(i).padStart(2, '0')}`;
    if (!(m.bathZones ?? []).some((z) => z.name === n)) return n;
  }
}

export const zoneName = (z: BathZone): string => z.name ?? ZONE_LABEL[z.kind];

const panelsOn = (m: Model, story: string, ids: string[]) => m.slabs.filter((s) => s.story === story && ids.includes(s.id)).map((s) => s.id);

/**
 * Assign the slabs `ids` on `story`: a bathroom takes them all as one new bathroom (BATH-01 …); a toilet or wash/urinal
 * kind makes each panel an area of its own (WC-01, WC-02 …), to be merged with `mergeZones`. A panel is in at most one
 * bathroom and one area: it leaves the one of the same layer it was in, and a zone left with no panels goes.
 */
export function assignZone(m: Model, story: string, kind: BathZone['kind'], ids: string[]): Model {
  const mine = panelsOn(m, story, ids);
  if (!mine.length) return m;
  const room = kind === 'room';
  let out: Model = {
    ...m,
    bathZones: (m.bathZones ?? [])
      .map((z) => ((z.kind === 'room') === room && z.slabIds ? { ...z, slabIds: z.slabIds.filter((id) => !mine.includes(id)) } : z))
      .filter((z) => !z.slabIds || z.slabIds.length),
  };
  for (const group of room ? [mine] : mine.map((id) => [id])) out = { ...out, bathZones: [...out.bathZones!, { id: uid(), story, kind, slabIds: group, name: nextZoneName(out, kind) }] };
  return out;
}

/** Zones on `story` holding any of the slabs `ids`. */
export const zonesOf = (m: Model, story: string, ids: string[]): BathZone[] => (m.bathZones ?? []).filter((z) => z.story === story && !!z.slabIds?.some((id) => ids.includes(id)));

/** The zones of `kind` holding any of the slabs `ids` on `story` combined into one, keeping the first name; `m` itself when fewer than two. */
export function mergeZones(m: Model, story: string, kind: BathZone['kind'], ids: string[]): Model {
  const zs = zonesOf(m, story, ids)
    .filter((z) => z.kind === kind)
    .sort((a, b) => zoneName(a).localeCompare(zoneName(b)));
  if (zs.length < 2) return m;
  const gone = new Set(zs.slice(1).map((z) => z.id));
  const slabIds = zs.flatMap((z) => z.slabIds!);
  return { ...m, bathZones: m.bathZones!.filter((z) => !gone.has(z.id)).map((z) => (z.id === zs[0].id ? { ...z, slabIds } : z)) };
}

export const removeZone = (m: Model, id: string): Model => ({ ...m, bathZones: (m.bathZones ?? []).filter((z) => z.id !== id) });

/** Menu entries for the selected slabs `ids` on `story`: assign each kind, and merge the zones of a kind they span. */
export function zoneActions(m: Model, story: string, ids: string[]): { label: string; run: (m: Model) => Model }[] {
  const mine = panelsOn(m, story, ids);
  if (!mine.length) return [];
  const n = `${mine.length} panel${mine.length > 1 ? 's' : ''}`;
  const held = zonesOf(m, story, mine);
  return [
    { label: `Assign bath zone (${n})`, run: (x) => assignZone(x, story, 'room', mine) },
    { label: `Assign WC ≥${MIN_SINK.wc} (${n})`, run: (x) => assignZone(x, story, 'wc', mine) },
    { label: `Assign wash / urinal ≥${MIN_SINK.wash} (${n})`, run: (x) => assignZone(x, story, 'wash', mine) },
    ...ZONE_KINDS.flatMap((k) => {
      const c = held.filter((z) => z.kind === k).length;
      return c >= 2 ? [{ label: `Merge ${c} ${NOUN[k]}`, run: (x: Model) => mergeZones(x, story, k, mine) }] : [];
    }),
  ];
}

const inPoly = (pts: Pt[], p: Pt) => pointInPoly(p, pts) || pts.some((a, i) => distToSeg(p, a, pts[(i + 1) % pts.length]) <= TOL);

/**
 * `m` with zones saved by earlier versions brought up to date: a bathroom drawn as a polygon becomes the story's panels
 * lying inside it (a zone with none goes), and an unnamed zone gets the next free number; `m` itself when none needs it.
 * A WC or wash area drawn as a polygon (the first version) goes: it was never shown or checked, and was redone from panels.
 */
export function upgradeZones(m: Model): Model {
  if (!(m.bathZones ?? []).some((z) => !z.slabIds || !z.name)) return m;
  let out = m;
  for (const z of m.bathZones!) {
    if (z.slabIds && z.name) continue;
    const outline = z.kind === 'room' && z.pts && z.pts.length >= 3 ? z.pts : null;
    const slabIds = z.slabIds ?? (outline ? m.slabs.filter((s) => s.story === z.story && s.pts.every((p) => inPoly(outline, p))).map((s) => s.id) : []);
    const up: BathZone = { id: z.id, story: z.story, kind: z.kind, slabIds, name: z.name ?? nextZoneName(out, z.kind) };
    out = { ...out, bathZones: out.bathZones!.map((x) => (x.id === z.id ? up : x)) };
  }
  return { ...out, bathZones: out.bathZones!.filter((z) => z.slabIds!.length) };
}

/** Zones on `story` with their shapes; skips a zone whose panels were all deleted. */
export function zonesOn(m: Model, story: string): Zone[] {
  const slabs = new Map(m.slabs.filter((s) => s.story === story).map((s) => [s.id, s.pts]));
  const out: Zone[] = [];
  for (const z of m.bathZones ?? []) {
    if (z.story !== story) continue;
    const polys = (z.slabIds ?? []).flatMap((id) => (slabs.has(id) ? [slabs.get(id)!] : []));
    if (polys.length) out.push({ ...z, polys });
  }
  return out;
}

export const zoneArea = (z: Zone): number => z.polys.reduce((a, p) => a + Math.abs(polyArea(p)), 0);

/** Top-left corner of a zone, where its name goes. */
export const labelAt = (z: Zone): Pt => z.polys.flat().reduce((a, p) => (p.y - p.x > a.y - a.x ? p : a));

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
 * a panel of the area sunk less than it needs, and a beam sunk less than it needs running through the area's inside;
 * beams along its outer edge are its supports and stay flush. Ducts are exempt. `only`: just the zones with these ids.
 */
export function underSunk(m: Model, story: string, only?: Set<string>): Map<string, number> {
  const out = new Map<string, number>();
  const need = (id: string, v: number) => out.set(id, Math.max(v, out.get(id) ?? 0));
  const areas = zonesOn(m, story).filter((z) => MIN_SINK[z.kind] > 0 && (!only || only.has(z.id)));
  if (!areas.length) return out;
  const slabs = new Map(m.slabs.map((s) => [s.id, s]));
  for (const z of areas) {
    const min = MIN_SINK[z.kind];
    for (const id of z.slabIds ?? []) {
      const s = slabs.get(id);
      if (s && !s.duct && (s.sink ?? 0) < min) need(id, min);
    }
    for (const b of m.beams) if (b.story === story && (b.sink ?? 0) < min && cutsAcross(z.polys, { x: b.x1, y: b.y1 }, { x: b.x2, y: b.y2 })) need(b.id, min);
  }
  return out;
}
