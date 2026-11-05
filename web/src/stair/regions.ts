import { toast, useApp } from '../model/store';
import { defaultStairParams, uid, type Model, type Pt, type StairModel } from '../model/types';
import { stairContext } from './context';
import { renumber, spanKey } from './stair';
import { applyStairLoads, hasStairLoads } from './push';

/** First free name STAIR-01, STAIR-02, … */
export function nextStairName(m: Model): string {
  for (let i = 1; ; i++) {
    const n = `STAIR-${String(i).padStart(2, '0')}`;
    if (!m.stairs.some((s) => s.name === n)) return n;
  }
}

const askName = (m: Model, initial: string, self?: string): string | null => {
  const n = prompt('Stair name', initial)?.trim();
  if (!n) return null;
  if (m.stairs.some((s) => s.name === n && s.id !== self)) return toast(`A stair named ${n} already exists.`), null;
  return n;
};

/** Box corners a, b → a new stair region, named by the user. */
export function addStair(a: Pt, b: Pt) {
  const st = useApp.getState();
  if (Math.abs(b.x - a.x) < 500 || Math.abs(b.y - a.y) < 500) return toast('A stair box needs to be at least 500 mm each way.');
  const name = askName(st.model, nextStairName(st.model));
  if (!name) return;
  const r = { id: uid(), name, x1: Math.min(a.x, b.x), y1: Math.min(a.y, b.y), x2: Math.max(a.x, b.x), y2: Math.max(a.y, b.y), flights: [], landings: [], spans: [], params: defaultStairParams() };
  st.commit((m) => ({ ...m, stairs: [...m.stairs, r] }));
  toast(`${name} added. Open it from Stairs in the left panel to design it.`);
}

export function renameStair(id: string) {
  const st = useApp.getState();
  const r = st.model.stairs.find((s) => s.id === id);
  const name = r && askName(st.model, r.name, id);
  if (name && name !== r.name) st.commit((m) => ({ ...m, stairs: m.stairs.map((s) => (s.id === id ? { ...s, name } : s)) }));
}

export function deleteStair(id: string) {
  const st = useApp.getState();
  const r = st.model.stairs.find((s) => s.id === id);
  if (!r || !confirm(`Delete ${r.name} and everything drawn in it?`)) return;
  const loads = hasStairLoads(st.model, id) && confirm(`${r.name} pushed loads onto the model's beams. Remove those loads too? (Cancel keeps them as ordinary loads.)`);
  if (st.activeStair === id) st.exitStair();
  st.commit((m) => {
    const out = { ...m, stairs: m.stairs.filter((s) => s.id !== id) };
    return loads ? applyStairLoads(out, id, [], '', '') : out;
  });
}

/**
 * Edit the open stair: `fn` gets the building cut to its box (beams clipped, as drawn) with the stair's flights,
 * landings, spans and parameters, and returns it changed; only those stair parts are kept. Flights, landings and
 * spans are renumbered bottom-up (F1, L1, S1 …) as in the stair program.
 */
export function commitStair(fn: (m: StairModel) => StairModel) {
  const id = useApp.getState().activeStair;
  if (!id) return;
  useApp.getState().commit((m) => {
    const r = m.stairs.find((x) => x.id === id);
    if (!r) return m;
    const prev = stairContext(m, r, true);
    let next = fn(prev);
    if (next.flights === prev.flights && next.landings === prev.landings && next.spans === prev.spans && next.stair === prev.stair) return m;
    if (next.landings !== prev.landings) next = { ...next, landings: renumber(next.landings, 'L', (l) => [l.z, l.x, l.y]) };
    if (next.flights !== prev.flights) next = { ...next, flights: renumber(next.flights, 'F', (f) => [f.z0, f.x, f.y]) };
    const n = next;
    next = { ...n, spans: renumber(n.spans, 'S', (sp) => spanKey(n, sp)) };
    const out = { ...r, flights: next.flights, landings: next.landings, spans: next.spans, params: next.stair };
    return { ...m, stairs: m.stairs.map((x) => (x.id === id ? out : x)) };
  });
}

/** Delete the selected flights, landings and spans of the open stair; building elements in `ids` are left alone (read-only here). */
export function deleteStairIds(ids: string[]) {
  const gone = new Set(ids);
  let hit = false;
  const keep = <T extends { id: string }>(xs: T[]) => {
    const out = xs.filter((x) => !gone.has(x.id));
    if (out.length !== xs.length) hit = true;
    return out.length === xs.length ? xs : out;
  };
  commitStair((m) => ({ ...m, flights: keep(m.flights), landings: keep(m.landings), spans: keep(m.spans) }));
  if (!hit) toast('Only flights, landings and spans can be deleted here; the building is read-only inside a stair.');
}
