import { describe, expect, it, vi } from 'vitest';
import { useApp, colorKey, colorGroups, visibleModel } from './store';
import { defaultStairParams, emptyModel, type FrameSection } from './types';
import { commitStair, deleteStairIds } from '../stair/regions';

const rect = (name: string, t2: number, t3: number): FrameSection => ({ name, shape: 'Rectangle', t2, t3, material: '4000Psi', fromEtabs: false });

describe('active sections', () => {
  it('fall back to the first dropdown item when the model no longer has them', () => {
    useApp.setState({ active: { column: 'C400x400', beam: 'B300x500', slab: 'S150' } });
    const m = { ...emptyModel(), frameSections: [rect('C300x300', 300, 300), rect('B20X30', 200, 300), rect('B200x400', 200, 400)], slabSections: [{ ...emptyModel().slabSections[0], name: 'S120', thickness: 120 }] };
    useApp.getState().setModel(m);
    expect(useApp.getState().active).toEqual({ column: 'C300x300', beam: 'B20X30', slab: 'S120' });
  });

  it('are kept when they still exist, and fixed again after deleting one', () => {
    useApp.getState().setModel(emptyModel());
    useApp.setState({ active: { column: 'C400x400', beam: 'B300x500', slab: 'S150' } });
    useApp.getState().commit((m) => ({ ...m, frameSections: [...m.frameSections, rect('B230x450', 230, 450)] }));
    expect(useApp.getState().active.beam).toBe('B300x500');
    useApp.getState().commit((m) => ({ ...m, frameSections: m.frameSections.filter((s) => s.name !== 'B300x500') }));
    expect(useApp.getState().active.beam).toBe('B230x450');
  });
});

describe('undo and redo', () => {
  it('keep the record of what was pushed to ETABS', () => {
    useApp.getState().setModel(emptyModel());
    useApp.getState().commit((m) => ({ ...m, baseElevation: 100 }));
    useApp.getState().commit((m) => ({ ...m, pushedIds: ['a', 'b'] }));
    useApp.getState().undo();
    useApp.getState().undo();
    expect(useApp.getState().model.baseElevation).toBe(0);
    expect(useApp.getState().model.pushedIds).toEqual(['a', 'b']);
    useApp.getState().redo();
    expect(useApp.getState().model.baseElevation).toBe(100);
    expect(useApp.getState().model.pushedIds).toEqual(['a', 'b']);
  });
});

describe('previous selection', () => {
  it('comes back after a click replaces or clears it, and swaps on a second restore', () => {
    useApp.setState({ selection: [], prevSelection: [], hidden: [] });
    const st = useApp.getState;
    st().setSelection(['a', 'b', 'c']);
    st().setSelection(['d']); // accidental click
    st().setSelection([]); // click on empty space
    expect(st().prevSelection).toEqual(['d']);
    st().setSelection(['a', 'b', 'c']);
    st().setSelection(['x']);
    st().restoreSelection();
    expect(st().selection).toEqual(['a', 'b', 'c']);
    st().restoreSelection();
    expect(st().selection).toEqual(['x']);
  });

  it('skips elements hidden since', () => {
    useApp.setState({ selection: ['a', 'b'], prevSelection: [], hidden: [] });
    useApp.getState().setSelection([]);
    useApp.setState({ hidden: ['b'] });
    useApp.getState().restoreSelection();
    expect(useApp.getState().selection).toEqual(['a']);
  });
});

describe('colorKey', () => {
  const fl = (pattern: string, v: number) => ({ pattern, kind: 'dist' as const, force: 'F' as const, dir: 'Gravity' as const, rel: true, d1: 0, d2: 1, v1: v, v2: v });
  const beam = { section: 'B300x600', loads: [fl('SDL', 5), fl('Live', 3)] };
  it('keys by section, pattern set or active-pattern value', () => {
    expect(colorKey(beam, 'section', ['Live'])).toBe('B300x600');
    expect(colorKey(beam, 'pattern', ['Live'])).toBe('Live + SDL');
    expect(colorKey(beam, 'value', ['Live'])).toBe('3 kN/m');
    expect(colorKey({ section: 'S150', loads: [{ pattern: 'Live', dir: 'Gravity', value: 2.5 }] }, 'value', ['Live'])).toBe('2.5 kN/m²');
    expect(colorKey(beam, 'value', ['Dead'])).toBeNull();
    expect(colorKey({ section: 'C1' }, 'pattern', ['Live'])).toBeNull();
    expect(colorKey(beam, 'none', ['Live'])).toBeNull();
    expect(colorKey(beam, 'value', ['Live', 'SDL'])).toBe('SDL 5 kN/m, Live 3 kN/m');
  });
});

describe('colorGroups', () => {
  it('groups elements by colour key, uncoloured last', () => {
    const fl = { pattern: 'Live', kind: 'dist' as const, force: 'F' as const, dir: 'Gravity' as const, rel: true, d1: 0, d2: 1, v1: 3, v2: 3 };
    const m = { ...emptyModel(), beams: [
      { id: 'b1', story: 'S1', x1: 0, y1: 0, x2: 1, y2: 0, section: 'B', loads: [fl] },
      { id: 'b2', story: 'S1', x1: 0, y1: 1, x2: 1, y2: 1, section: 'B' },
      { id: 'b3', story: 'S2', x1: 0, y1: 0, x2: 1, y2: 0, section: 'B', loads: [fl] },
    ] };
    expect(colorGroups(m, 'pattern', ['Live'])).toEqual([{ key: 'Live', ids: ['b1', 'b3'] }, { key: null, ids: ['b2'] }]);
  });
  it('unhideIds brings back only those ids', () => {
    useApp.setState({ hidden: ['a', 'b', 'c'] });
    useApp.getState().unhideIds(['a', 'c']);
    expect(useApp.getState().hidden).toEqual(['b']);
  });
});

describe('stair mode', () => {
  const beam = { id: 'b', story: 'Story1', x1: 0, y1: 500, x2: 9000, y2: 500, section: 'B300x500' };
  const stair = { id: 'st', name: 'STAIR-01', x1: 0, y1: 0, x2: 3000, y2: 3000, flights: [], landings: [], spans: [], params: defaultStairParams() };
  const start = () => {
    useApp.getState().setModel({ ...emptyModel(), beams: [beam], slabs: [{ id: 's', story: 'Story1', pts: [], section: 'S150' }], stairs: [stair] });
    useApp.getState().enterStair('st');
  };
  it('keeps the building read-only but lets stair data change', () => {
    vi.stubGlobal('window', globalThis); // the refusal shows a toast
    start();
    const st = useApp.getState();
    st.commit((m) => ({ ...m, beams: [] }));
    expect(useApp.getState().model.beams).toHaveLength(1);
    st.commit((m) => ({ ...m, stairs: [{ ...stair, name: 'STAIR-A' }] }));
    expect(useApp.getState().model.stairs[0].name).toBe('STAIR-A');
    st.commit((m) => ({ ...m, beams: [] }), { main: true });
    expect(useApp.getState().model.beams).toHaveLength(0);
  });
  it('shows the building cut to the box, without slabs, and all of it again after leaving', () => {
    start();
    const v = visibleModel(useApp.getState());
    expect(v.slabs).toHaveLength(0);
    expect(v.beams[0]).toMatchObject({ x1: 0, x2: 3001 });
    useApp.getState().exitStair();
    expect(visibleModel(useApp.getState()).beams[0].x2).toBe(9000);
  });
  it('stair edits land in the open stair only, renumbered bottom-up, and can be deleted', () => {
    start();
    const f = (id: string, z0: number) => ({ id, name: 'F9', x: 500, y: 500, dir: '+x' as const, n: 8, T: 250, R: 150, t: 150, width: 1000, z0 });
    commitStair((m) => ({ ...m, flights: [...m.flights, f('up', 1200), f('low', 0)] }));
    const r = useApp.getState().model.stairs[0];
    expect(r.flights.map((x) => [x.id, x.name])).toEqual([['up', 'F2'], ['low', 'F1']]);
    expect(useApp.getState().model.beams).toHaveLength(1);
    deleteStairIds(['up', 'b']); // the building beam is read-only here
    expect(useApp.getState().model.stairs[0].flights.map((x) => x.id)).toEqual(['low']);
    expect(useApp.getState().model.beams).toHaveLength(1);
  });
});
