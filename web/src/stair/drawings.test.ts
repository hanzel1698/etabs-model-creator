import { describe, expect, it } from 'vitest';
import { emptyStairModel as emptyModel } from '../model/types';
import { autoSpans, template } from './stair';
import { bearingSvg, planSvg, unitWeightsHtml } from './drawings';
import { resultsHtml } from '../ui/StairPanel';

describe('report drawings', () => {
  it('every stair template gets plan, elevations, unit-weight, section and loading figures', () => {
    for (const k of ['straight', 'L', 'dog', 'open'] as const) {
      const m = template(emptyModel(), k, 'Story1', 'B300x500', 'C400x400');
      const h = resultsHtml(m);
      const figs = h.match(/<svg /g)?.length ?? 0;
      // plan + one elevation per flight + step details + landing blocks + section & loading per span + beams
      expect(figs).toBeGreaterThanOrEqual(1 + m.flights.length + 1 + 2 * m.spans.length);
      expect(h).not.toMatch(/NaN|undefined/);
    }
  });
  it('a landing stacked over a lower flight gets its own plan; an unstacked stair keeps one', () => {
    const t = template(emptyModel(), 'dog', 'Story1', 'B300x500', 'C400x400');
    expect(planSvg(t).match(/<svg /g)?.length).toBe(1);
    const l = t.landings[0],
      m = { ...t, stories: [...t.stories, { name: 'Up', height: 3000, isMaster: false, similarTo: '' }] };
    m.landings = [...m.landings, { ...l, id: 'up', name: 'Lup', z: m.stories.reduce((a, s) => a + s.height, m.baseElevation) }];
    const h = planSvg(m);
    expect(h.match(/<svg /g)?.length).toBe(2);
    expect(h).toContain('Fig. 1b');
  });
  it('a span carrying another gets a bearing plan; a span on beams only does not', () => {
    const t = template(emptyModel(), 'L', 'Story1', 'B300x500', 'C400x400');
    const m = autoSpans({ ...t, beams: t.beams.filter((b) => !(b.x1 === b.x2 && b.x1 > 0)) });
    const [s1, s2] = m.spans,
      h = bearingSvg(m, s2, 9);
    expect(h).toContain(`R(${s1.name})`);
    expect(h).not.toMatch(/NaN|undefined/);
    expect(bearingSvg(m, s1, 9)).toBe('');
  });
});

describe('unit weights table', () => {
  it('lists landings and flights in walking order, bottom up', () => {
    const m = template(emptyModel(), 'open', 'Story1', 'B300x500', 'C400x400');
    const s = { ...m, flights: [...m.flights].reverse(), landings: [...m.landings].reverse() };
    const rows = [...unitWeightsHtml(s, { n: 1 }).matchAll(/<tr><td>(\w+) \((flight|landing)\)/g)].map((r) => r[1]);
    const z = (n: string) => s.flights.find((f) => f.name === n)?.z0 ?? s.landings.find((l) => l.name === n)!.z;
    expect(rows.map(z)).toEqual(rows.map(z).sort((a, b) => a - b));
    expect(rows.length).toBe(m.flights.length + m.landings.length);
  });
});
