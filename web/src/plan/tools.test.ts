import { describe, expect, it, vi } from 'vitest';
import { useApp } from '../model/store';
import { addBeams, setBeamEnd } from '../model/ops';
import { emptyModel, type FrameSection } from '../model/types';
import { commitBeams } from './tools';

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
