// Right panel: which bathroom section lines are shown on the plan (and offered in the Section view).
import { useApp } from '../model/store';
import { setSectionsHidden, useBath } from './sections';
import { MIN_SINK, removeZone, underSunk, zoneArea, zoneGroups, zoneName, type Zone } from './zones';
import { fmt } from '../model/geom';

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

/** Bathroom zones on the story in view, each removable; says how many beams/slabs there are sunk less than their zone needs. */
export function BathZonesList() {
  const story = useApp((s) => s.activeStory);
  const model = useApp((s) => s.model);
  const groups = zoneGroups(model, story);
  if (!groups.length) return null;
  const row = (z: Zone, sub: boolean) => (
    <div key={z.id} className="small" style={sub ? { paddingLeft: 16 } : { fontWeight: 600 }}>
      {zoneName(z)}
      {MIN_SINK[z.kind] ? ` ≥${MIN_SINK[z.kind]}` : ''} <span className="muted">· {z.slabIds ? `${z.slabIds.length} panel${z.slabIds.length > 1 ? 's' : ''} · ` : ''}{fmt(zoneArea(z) / 1e6, 2)} m²</span>{' '}
      <button title={z.kind === 'room' ? 'Remove this bathroom (its WC and wash areas stay)' : 'Remove this zone'} onClick={() => useApp.getState().commit((m) => removeZone(m, z.id))}>
        ✕
      </button>
    </div>
  );
  const low = underSunk(model, story).size;
  return (
    <div className="section bath-zones-list">
      <h4>
        <span>Bath zones · {story}</span>
      </h4>
      {groups.map((g) => (
        <div key={g.room?.id ?? 'loose'}>
          {g.room ? row(g.room, false) : <div className="small muted">Not in a bathroom</div>}
          {g.parts.map((z) => row(z, true))}
        </div>
      ))}
      <div className={'small' + (low ? '' : ' muted')} style={low ? { color: 'var(--danger)' } : undefined}>
        {low ? `${low} beam/slab${low > 1 ? 's' : ''} below the min sink (View by Sink level shows them).` : 'All beams and slabs in the zones meet the min sink.'}
      </div>
    </div>
  );
}
