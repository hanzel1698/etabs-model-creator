import { describe, expect, it } from 'vitest';
import { cleanText, lineDy, parseDxf } from './dxf';

const dxf = (...ents: (string | number)[][]) =>
  ['0', 'SECTION', '2', 'ENTITIES', ...ents.flatMap((e) => e.map(String)), '0', 'ENDSEC', '0', 'EOF'].join('\n');

describe('DXF text placement', () => {
  it('strips MTEXT codes and keeps paragraph breaks', () => {
    expect(cleanText('\\pxqc;{\\fArial|b0|i0|c0|p0;BAR ASSOCIATION}\\PHALL\\P\\H1.2x;797x750')).toBe('BAR ASSOCIATION\nHALL\n797x750');
    expect(cleanText('\\LRAMP\\l UP')).toBe('RAMP UP');
  });

  it('anchors MTEXT by its attachment point and centred paragraph box', () => {
    // top-right attachment at (1000, 500), box 300 wide, centred paragraph → centre of the box, 150 left of the point
    const d = parseDxf(dxf(['0', 'MTEXT', '8', 'A', '10', 1000, '20', 500, '30', 0, '40', 10, '41', 300, '71', 3, '1', '\\pxqc;TOILET\\P210x307']), 1);
    expect(d.texts[0]).toMatchObject({ x: 850, y: 500, ha: 0.5, va: 0, text: 'TOILET\n210x307' });
    // top anchored: first baseline one text height below, next line 5/3 h further
    expect(lineDy(d.texts[0], 2, 0)).toBeCloseTo(10);
    expect(lineDy(d.texts[0], 2, 1)).toBeCloseTo(10 + 50 / 3);
  });

  it('places justified TEXT at its second alignment point', () => {
    const d = parseDxf(dxf(['0', 'TEXT', '8', 'A', '10', 0, '20', 0, '30', 0, '40', 5, '1', '98.5', '72', 1, '11', 40, '21', 20, '31', 0, '73', 2]), 1);
    expect(d.texts[0]).toMatchObject({ x: 40, y: 20, ha: 0.5, va: 0.5 });
  });
});
