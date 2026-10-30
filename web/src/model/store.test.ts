import { describe, expect, it } from 'vitest';
import { useApp } from './store';
import { emptyModel, type FrameSection } from './types';

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
