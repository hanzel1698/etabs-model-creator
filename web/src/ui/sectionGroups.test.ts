import { describe, expect, it } from 'vitest';
import { bySize, groupSections } from './sectionGroups';
import type { FrameSection } from '../model/types';

const s = (name: string, t2: number, t3: number): FrameSection => ({ name, shape: 'Rectangle', t2, t3, material: 'M25', fromEtabs: false });

describe('section ordering', () => {
  it('sorts by width, then depth, within each group', () => {
    const list = [s('B300x450', 300, 450), s('C450x450', 450, 450), s('B230x600', 230, 600), s('C300x600', 300, 600), s('B230x450', 230, 450), s('C300x450', 300, 450)];
    const g = groupSections([...list].sort(bySize));
    expect(g.Beams.map((x) => x.name)).toEqual(['B230x450', 'B230x600', 'B300x450']);
    expect(g.Columns.map((x) => x.name)).toEqual(['C300x450', 'C300x600', 'C450x450']);
  });
});
