import type { FrameSection } from '../model/types';

export type SectionGroup = 'Columns' | 'Beams' | 'Other';

/** Frame sections are grouped by name prefix: C… = columns, B… = beams, anything else = other. */
export function sectionGroup(name: string): SectionGroup {
  const c = name.trim().charAt(0).toUpperCase();
  return c === 'C' ? 'Columns' : c === 'B' ? 'Beams' : 'Other';
}

export function groupSections<T extends { name: string }>(list: T[]): Record<SectionGroup, T[]> {
  const out: Record<SectionGroup, T[]> = { Columns: [], Beams: [], Other: [] };
  for (const s of list) out[sectionGroup(s.name)].push(s);
  return out;
}

/** Smaller sections first: by width t2, then depth t3, then name (so B230x450 < B230x600 < B300x450). */
export const bySize = (a: FrameSection, b: FrameSection) => a.t2 - b.t2 || a.t3 - b.t3 || a.name.localeCompare(b.name, undefined, { numeric: true });

const groupOrder = (prefer?: SectionGroup): SectionGroup[] => (prefer === 'Beams' ? ['Beams', 'Columns', 'Other'] : ['Columns', 'Beams', 'Other']);

/** The section a <SectionOptions> list shows first, or '' when there are none. */
export function firstSection(sections: FrameSection[], prefer?: SectionGroup): string {
  const g = groupSections([...sections].sort(bySize));
  for (const k of groupOrder(prefer)) if (g[k].length) return g[k][0].name;
  return '';
}

/** <option>s for a frame-section <select>, in optgroups (sorted by size), with the preferred group first. */
export function SectionOptions({ sections, prefer }: { sections: FrameSection[]; prefer?: SectionGroup }) {
  const g = groupSections([...sections].sort(bySize));
  const order = groupOrder(prefer);
  return (
    <>
      {order.map((k) =>
        g[k].length ? (
          <optgroup key={k} label={k}>
            {g[k].map((s) => (
              <option key={s.name}>{s.name}</option>
            ))}
          </optgroup>
        ) : null,
      )}
    </>
  );
}
