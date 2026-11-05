import type { Beam, FrameLoad, LoadPattern, Model, StairModel, StairRegion, TypicalRange } from '../model/types';
import { rangeLevels, rangesOf } from './ranges';
import { stairContext } from './context';
import { beamFlipped, beamLoads, beamName } from './stair';

/** One stretch of beam a stair span bears on: its DL and LL (kN/m, override or calculated) over d1–d2 mm from the beam's (x1, y1). */
export interface PushRow {
  key: string;
  beam: Beam;
  name: string;
  span: string;
  d1: number;
  d2: number;
  dl: number;
  ll: number;
  calc: { dl: number; ll: number };
}

/** Rows of the stair's design model (beams whole), with the region's overrides applied. */
export function stairLoadRows(m: StairModel, ov: StairRegion['overrides'] = {}): PushRow[] {
  const rows: PushRow[] = [];
  for (const [b, rs] of beamLoads(m).out) {
    const L = Math.hypot(b.x2 - b.x1, b.y2 - b.y1),
      f = beamFlipped(b);
    for (const r of rs) {
      const key = `${b.id}|${r.sp.id}|${r.e}`,
        o = ov[key] ?? {};
      // engine rows run from the beam's left (bottom) end; frame loads from (x1, y1)
      rows.push({ key, beam: b, name: beamName(m, b), span: r.sp.name, d1: f ? L - r.b : r.a, d2: f ? L - r.a : r.b, dl: o.dl ?? r.dl, ll: o.ll ?? r.ll, calc: { dl: r.dl, ll: r.ll } });
    }
  }
  return rows;
}

/** `src` tag of the loads one typical range of a stair pushes. */
export const rangeSrc = (stairId: string, rangeId: string) => `${stairId}#${rangeId}`;

/**
 * Whether a load tagged `l` is replaced by a push tagged `src`: the same tag; with a bare stair id, every range of it;
 * with a range tag, also the stair's untagged loads from before ranges existed.
 */
const owns = (l: string | undefined, src: string) => !!l && (l === src || l.startsWith(src + '#') || l === src.split('#')[0]);

/**
 * The rows of a range's design storey copied up every storey it repeats over: copy k goes onto the beam k stories up
 * at the same plan position and offset. A floor beam between two copies gets the arriving flight of one and the
 * departing flight of the next, as separate loads. `misses` names copies with no such beam (skipped).
 */
export function repeatRows<R extends Pick<PushRow, 'beam' | 'd1' | 'd2' | 'name'>>(m: Model, rows: R[], rg: TypicalRange) {
  const lv = rangeLevels(m, rg),
    names = m.stories.map((s) => s.name),
    out: R[] = [],
    misses: string[] = [];
  const same = (a: number, b: number) => Math.abs(a - b) < 10;
  for (const r of rows) {
    const b = r.beam,
      i = names.indexOf(b.story),
      L = Math.hypot(b.x2 - b.x1, b.y2 - b.y1);
    for (let k = 0; k < (lv?.repeats ?? 1); k++) {
      if (!k) {
        out.push(r);
        continue;
      }
      const st = names[i + k];
      const c = m.beams.find((x) => x.story === st && same(x.dz ?? 0, b.dz ?? 0) && ((same(x.x1, b.x1) && same(x.y1, b.y1) && same(x.x2, b.x2) && same(x.y2, b.y2)) || (same(x.x1, b.x2) && same(x.y1, b.y2) && same(x.x2, b.x1) && same(x.y2, b.y1))));
      if (!c) {
        misses.push(`${r.name} on ${st ?? `story ${i + k + 1}`}`);
        continue;
      }
      const flip = !same(c.x1, b.x1) || !same(c.y1, b.y1); // drawn the other way: distances run from the other end
      out.push({ ...r, beam: c, d1: flip ? L - r.d2 : r.d1, d2: flip ? L - r.d1 : r.d2 });
    }
  }
  return { rows: out, misses: [...new Set(misses)] };
}

/** Replaces every load pushed before under `src` (see `owns`) with these rows, tagged `src`, on the given patterns; other loads stay. */
export function applyStairLoads<M extends Model>(m: M, src: string, rows: (Pick<PushRow, 'beam' | 'd1' | 'd2' | 'dl' | 'll'> & { calc?: PushRow['calc'] })[], dlPattern: string, llPattern: string): M {
  const add = new Map<string, FrameLoad[]>();
  const load = (pattern: string, r: (typeof rows)[number], k: 'dl' | 'll'): FrameLoad => ({ pattern, kind: 'dist', force: 'F', dir: 'Gravity', rel: false, d1: r.d1, d2: r.d2, v1: r[k], v2: r[k], src, ...(r.calc && Math.abs(r[k] - r.calc[k]) > 1e-6 ? { set: true as const } : {}) });
  for (const r of rows) {
    const ls = [...(r.dl ? [load(dlPattern, r, 'dl')] : []), ...(r.ll ? [load(llPattern, r, 'll')] : [])];
    if (ls.length) add.set(r.beam.id, [...(add.get(r.beam.id) ?? []), ...ls]);
  }
  let changed = false;
  const beams = m.beams.map((b) => {
    const old = b.loads ?? [],
      keep = old.filter((l) => !owns(l.src, src)),
      extra = add.get(b.id) ?? [];
    if (keep.length === old.length && !extra.length) return b;
    changed = true;
    const loads = [...keep, ...extra];
    return { ...b, loads: loads.length ? loads : undefined };
  });
  return changed ? { ...m, beams } : m;
}

/** Whether any beam carries loads pushed under `src` (a stair id: any of its ranges). */
export const hasStairLoads = (m: Model, src: string) => m.beams.some((b) => b.loads?.some((l) => owns(l.src, src)));

/** Pattern a push defaults to: the one remembered on the stair, else one named "Stair Dead/Live", else the first of the type. */
export function defaultPattern(ps: LoadPattern[], kind: 'dl' | 'll', remembered?: string) {
  if (remembered && ps.some((p) => p.name === remembered)) return remembered;
  const re = kind === 'dl' ? /stair.*dead/i : /stair.*live/i,
    types = kind === 'dl' ? ['SuperDead', 'Dead'] : ['Live', 'ReduceLive'];
  return (ps.find((p) => re.test(p.name)) ?? types.map((t) => ps.find((p) => p.type === t)).find(Boolean) ?? ps[0])?.name ?? '';
}

/** Every load a push of each of the stair's ranges would put on the model, by beam id, with the range and span it comes from. */
export function allRangeLoads(m: Model, r: StairRegion) {
  const by = new Map<string, { range: TypicalRange; span: string; story: string; d1: number; d2: number; dl: number; ll: number }[]>();
  for (const rg of rangesOf(m, r))
    for (const x of repeatRows(m, stairLoadRows(stairContext(m, r, false, rg), r.overrides), rg).rows)
      by.set(x.beam.id, [...(by.get(x.beam.id) ?? []), { range: rg, span: x.span, story: x.beam.story, d1: x.d1, d2: x.d2, dl: x.dl, ll: x.ll }]);
  return by;
}
