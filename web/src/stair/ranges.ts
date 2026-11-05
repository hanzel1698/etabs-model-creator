import { storyElevations, type Model, type StairRegion, type TypicalRange } from '../model/types';

/** Name of the level under the lowest story. */
export const BASE = 'Base';

/** Level names bottom → top: 'Base', then each story's top. */
export const levelNames = (m: Pick<Model, 'stories'>) => [BASE, ...m.stories.map((s) => s.name)];

/** The region's ranges; with none set, one "all stories same" range from the base to the top. */
export function rangesOf(m: Pick<Model, 'stories'>, r: Pick<StairRegion, 'typicals'>): TypicalRange[] {
  if (r.typicals?.length) return r.typicals;
  return m.stories.length ? [{ id: 'all', from: BASE, to: m.stories[m.stories.length - 1].name }] : [];
}

/**
 * Where a range sits: its first storey (the one designed), that storey's z band and how many storeys it repeats over.
 * Null when a level is unknown or `from` is not below `to`.
 */
export function rangeLevels(m: Model, rg: TypicalRange) {
  const L = levelNames(m),
    fi = L.indexOf(rg.from),
    ti = L.indexOf(rg.to);
  if (fi < 0 || ti <= fi) return null;
  const story = m.stories[fi].name,
    e = storyElevations(m)[story];
  return { fi, ti, story, z0: e.bottom, z1: e.top, repeats: ti - fi };
}

/** Problems with a set of ranges, one line each (empty when fine). */
export function validateRanges(m: Model, rgs: TypicalRange[]): string[] {
  const out: string[] = [];
  const ok = rgs.map((rg) => ({ rg, lv: rangeLevels(m, rg) }));
  for (const { rg, lv } of ok) if (!lv) out.push(`${rg.from} → ${rg.to}: "From" must be a level below "To"`);
  const good = ok.filter((x) => x.lv).sort((a, b) => a.lv!.fi - b.lv!.fi);
  for (let i = 1; i < good.length; i++)
    if (good[i].lv!.fi < good[i - 1].lv!.ti) out.push(`${good[i - 1].rg.from} → ${good[i - 1].rg.to} overlaps ${good[i].rg.from} → ${good[i].rg.to}`);
  return out;
}

/** The range being designed: `id` when it still exists, else the first. */
export const rangeFor = (m: Pick<Model, 'stories'>, r: Pick<StairRegion, 'typicals'>, id: string | null) => {
  const rgs = rangesOf(m, r);
  return rgs.find((x) => x.id === id) ?? rgs[0];
};
