// Right panel: which bathroom section lines are shown on the plan (and offered in the Section view).
import { useApp } from '../model/store';
import { setSectionsHidden, useBath } from './sections';

export function BathSectionsList() {
  const on = useApp((s) => s.show.bathSections);
  const cuts = useApp((s) => s.model.sectionLines) ?? []; // fallback outside the selector: a new [] each call would re-render forever
  const story = useApp((s) => s.activeStory);
  const active = useBath((s) => s.active);
  if (!on || !cuts.length) return null;
  const set = (ids: string[], hidden: boolean) => useApp.getState().commit((m) => setSectionsHidden(m, ids, hidden));
  const all = cuts.map((c) => c.id);
  const shown = cuts.filter((c) => !c.hidden).length;
  return (
    <div className="section bath-sections-list">
      <h4>
        <span>Bath sections</span>{' '}
        <button disabled={shown === cuts.length} onClick={() => set(all, false)} title="Show every section line">
          All
        </button>{' '}
        <button disabled={!shown} onClick={() => set(all, true)} title="Hide every section line">
          None
        </button>
      </h4>
      {cuts.map((c) => (
        <label key={c.id} className={'small' + (c.id === active ? ' on' : '')} title={c.story === story ? 'On this story' : `On ${c.story}; switch to that story to see it`}>
          <input type="checkbox" checked={!c.hidden} onChange={(e) => set([c.id], !e.target.checked)} /> {c.label} <span className={c.story === story ? '' : 'muted'}>· {c.story}</span>
        </label>
      ))}
      <div className="small muted">
        {shown} of {cuts.length} shown. Ticked sections are drawn on the plan and listed in the Section view.
      </div>
    </div>
  );
}
