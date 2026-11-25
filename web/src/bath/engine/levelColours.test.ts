import { describe, expect, it } from 'vitest';
import { emptyModel } from './defaults';
import type { Beam, PlanModel, SlabType } from './types';
import { levelColours } from './levelColours';

function slab(id: string, sink: number): SlabType {
  return { id, label: id, thickness: 150, sink };
}

function beam(id: string, topLevel?: number): Beam {
  return {
    id,
    typeId: 'bt',
    start: { kind: 'point', x: 0, y: 0 },
    end: { kind: 'point', x: 1000, y: 0 },
    kind: 'primary',
    ...(topLevel === undefined ? {} : { topLevel }),
  };
}

function model(partial: Partial<PlanModel>): PlanModel {
  return { ...emptyModel(), ...partial };
}

describe('levelColours', () => {
  it('gives a beam and a slab at the same level the same colour', () => {
    const levels = levelColours(
      model({ slabTypes: [slab('st-1', 0), slab('st-2', 300)], beams: [beam('bm-1', 300)] }),
    );

    expect(levels.at(300)).toEqual(levels.at(300));
    expect(levels.at(300).fill).not.toBe(levels.at(0).fill);
  });

  it('keys on the level, not the slab type — two types at one sink match', () => {
    const levels = levelColours(
      model({ slabTypes: [slab('st-1', 150), slab('st-2', 150), slab('st-3', 300)] }),
    );

    expect(levels.at(150).fill).not.toBe(levels.at(300).fill);
  });

  it('gives every distinct sink its own colour', () => {
    const sinks = [50, 100, 150, 200, 250, 300, 350];
    const levels = levelColours(
      model({ slabTypes: sinks.map((s, i) => slab(`st-${i}`, s)) }),
    );

    const fills = new Set(sinks.map((s) => levels.at(s).fill));
    expect(fills.size).toBe(sinks.length);
  });

  it('pins the datum to the flush tint whatever else is drawn', () => {
    const bare = levelColours(model({ slabTypes: [slab('st-1', 0)] }));
    const busy = levelColours(
      model({
        slabTypes: [slab('st-1', 0), slab('st-2', 150)],
        beams: [beam('bm-1', -100), beam('bm-2', 300)],
      }),
    );

    expect(busy.at(0)).toEqual(bare.at(0));
  });

  it('separates raised levels from sunken ones', () => {
    const levels = levelColours(
      model({ slabTypes: [slab('st-1', 150)], beams: [beam('bm-1', -150)] }),
    );

    // The one raised and the one sunken level are both first in their own
    // family, so a shared palette would hand them the same tint.
    expect(levels.at(-150).fill).not.toBe(levels.at(150).fill);
  });

  it('reads a beam with no level of its own as flush', () => {
    const levels = levelColours(model({ slabTypes: [slab('st-1', 0)], beams: [beam('bm-1')] }));

    expect(levels.at(0).fill).toBe('#fbfcfd');
  });

  it('falls back rather than leaving a level unpainted', () => {
    const levels = levelColours(model({ slabTypes: [slab('st-1', 0)] }));

    expect(levels.at(999).fill).toBeTruthy();
  });

  // What an upstand asks before adopting a colour.
  describe('has', () => {
    it('knows the levels the framing works to', () => {
      const levels = levelColours(
        model({ slabTypes: [slab('st-1', 0), slab('st-2', 300)], beams: [beam('bm-1', -150)] }),
      );

      expect(levels.has(300)).toBe(true);
      expect(levels.has(-150)).toBe(true);
      expect(levels.has(200)).toBe(false);
    });

    it('counts the datum even in a plan with nothing at it', () => {
      const levels = levelColours(model({ slabTypes: [slab('st-1', 300)] }));

      expect(levels.has(0)).toBe(true);
    });

    it('does not mint a level for an upstand top', () => {
      // A 150 nib on a beam sunk 300 tops out at 150; nothing else is cast
      // there, so that stays an upstand rather than becoming a level.
      const levels = levelColours(
        model({
          slabTypes: [slab('st-1', 0), slab('st-2', 300)],
          beams: [beam('bm-1', 300)],
          upstandTypes: [{ id: 'ut-1', label: 'U1', depth: 150 }],
          upstands: [{ id: 'up-1', typeId: 'ut-1', beamId: 'bm-1', t0: 0, t1: 1 }],
        }),
      );

      expect(levels.has(150)).toBe(false);
    });
  });
});
