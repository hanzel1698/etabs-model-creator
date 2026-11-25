// Right panel: which bathroom section lines are shown on the plan (and offered in the Section view).
import { useApp } from '../model/store';
import { setSectionsHidden, useBath } from './sections';
import { MIN_SINK, ZONE_KINDS, removeZone, underSunk, zoneArea, zoneName, zonesOn } from './zones';
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

/** Bath zones of the selected slab panels, each removable; says how many beams/slabs in them are sunk less than they need. */
export function BathZoneProps() {
  const story = useApp((s) => s.activeStory);
  const model = useApp((s) => s.model);
  const sel = useApp((s) => s.selection);
  const zs = zonesOn(model, story)
    .filter((z) => z.slabIds!.some((id) => sel.includes(id)))
    .sort((a, b) => ZONE_KINDS.indexOf(a.kind) - ZONE_KINDS.indexOf(b.kind) || zoneName(a).localeCompare(zoneName(b)));
  if (!zs.length) return null;
  const low = zs.some((z) => MIN_SINK[z.kind]) ? underSunk(model, story, new Set(zs.map((z) => z.id))).size : -1;
  return (
    <div className="section bath-zones-list">
      <h4>
        <span>Bath zone</span>
      </h4>
      {zs.map((z) => (
        <div key={z.id} className="small" style={z.kind === 'room' ? { fontWeight: 600 } : undefined}>
          {zoneName(z)}
          {MIN_SINK[z.kind] ? ` ≥${MIN_SINK[z.kind]}` : ''} <span className="muted">· {z.polys.length} panel{z.polys.length > 1 ? 's' : ''} · {fmt(zoneArea(z) / 1e6, 2)} m²</span>{' '}
          <button title={z.kind === 'room' ? 'Remove this bathroom (its WC and wash areas stay)' : 'Remove this area'} onClick={() => useApp.getState().commit((m) => removeZone(m, z.id))}>
            ✕
          </button>
        </div>
      ))}
      {low >= 0 && (
        <div className={'small' + (low ? '' : ' muted')} style={low ? { color: 'var(--danger)' } : undefined}>
          {low ? `${low} beam/slab${low > 1 ? 's' : ''} below the min sink (View by Sink level shows them).` : 'All beams and slabs in these areas meet the min sink.'}
        </div>
      )}
    </div>
  );
}
