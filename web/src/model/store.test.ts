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
