import { describe, expect, it, vi } from 'vitest';
import { useApp } from '../model/store';
import { addBeams, addColumns, setBeamEnd } from '../model/ops';
import { emptyModel, type FrameSection } from '../model/types';
import { commitBeams, finishFramePick, picking, startMovePick } from './tools';
import { viewport } from './viewport';

const rect = (name: string, t2: number, t3: number): FrameSection => ({ name, shape: 'Rectangle', t2, t3, material: '4000Psi', fromEtabs: false });

vi.stubGlobal('window', globalThis); // toast() uses window timers

describe('commitBeams', () => {
  it('re-sizes a beam in Auto mode when an end is moved, but not when only its section changes', () => {
    const m = { ...emptyModel(), frameSections: [rect('B300x450', 300, 450), rect('B300x600', 300, 600)] };
    useApp.getState().setModel(m);
    useApp.setState({ autoBeam: true, active: { ...useApp.getState().active, beam: 'B300x450' } });
    const story = m.stories[0].name;
    commitBeams((mm) => addBeams(mm, [[{ x: 0, y: 0 }, { x: 1000, y: 0 }]], [story], 'B300x450'));
    const id = useApp.getState().model.beams[0].id;
    expect(useApp.getState().model.beams[0].section).toBe('B300x450');
    commitBeams((mm) => setBeamEnd(mm, id, 2, { x: 6000, y: 0 }));
    expect(useApp.getState().model.beams[0].section).toBe('B300x600'); // 6 m span → 600 deep
    commitBeams((mm) => ({ ...mm, beams: mm.beams.map((b) => ({ ...b, section: 'B300x450' })) }));
    expect(useApp.getState().model.beams[0].section).toBe('B300x450'); // hand-picked section is kept
  });
});

describe('move pick', () => {
  it('fills dx/dy from a base point and a destination snapped in the plan, then leaves pick mode', () => {
    const m = emptyModel();
    useApp.getState().setModel(m);
    useApp.setState({ tool: 'select' });
    useApp.getState().commit((mm) => addColumns(mm, [{ x: 0, y: 0 }, { x: 6000, y: 4000 }], [mm.stories[0].name], 'C400x400', 0));
    let got: [number, number] | null = null;
    startMovePick((dx, dy) => (got = [dx, dy]));
    expect(picking()).toBe(true);
    finishFramePick(viewport.toScreen({ x: 3, y: -2 })); // snaps onto the column at (0,0)
    expect(got).toBe(null);
    finishFramePick(viewport.toScreen({ x: 6002, y: 4001 }));
    expect(got).toEqual([6000, 4000]);
    expect(picking()).toBe(false);
  });
});
