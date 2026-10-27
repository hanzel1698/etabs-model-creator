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

/** <option>s for a frame-section <select>, in optgroups, with the preferred group first. */
export function SectionOptions({ sections, prefer }: { sections: FrameSection[]; prefer?: SectionGroup }) {
  const g = groupSections(sections);
  const order: SectionGroup[] = prefer === 'Beams' ? ['Beams', 'Columns', 'Other'] : ['Columns', 'Beams', 'Other'];
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
