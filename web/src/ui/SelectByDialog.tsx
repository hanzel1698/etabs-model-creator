import { useState } from 'react';
import { useApp, toast } from '../model/store';
import { anyFilter, matchElements, patchIds, type ElementFilter } from '../model/ops';
import { closeDialog } from './dialogState';
import { Modal, StoryChecks } from './Dialogs';
import { groupSections, SectionOptions } from './sectionGroups';

/** Select columns/beams/slabs by story and section properties, then optionally reassign their section. */
export function SelectByDialog() {
  const model = useApp((s) => s.model);
  const active = useApp((s) => s.activeStory);
  const [f, setF] = useState<ElementFilter>(anyFilter());
  const [storyMode, setStoryMode] = useState<'active' | 'all' | 'pick'>('active');
  const [picked, setPicked] = useState<string[]>([active]);
  const [newFrame, setNewFrame] = useState('');
  const [newSlab, setNewSlab] = useState('');

  const filter: ElementFilter = { ...f, stories: storyMode === 'all' ? null : storyMode === 'active' ? [active] : picked };
  const ids = matchElements(model, filter);
  const idSet = new Set(ids);
  const all = [...model.columns, ...model.beams, ...model.slabs];
  const nCols = model.columns.filter((x) => idSet.has(x.id)).length;
  const nBeams = model.beams.filter((x) => idSet.has(x.id)).length;
  const nSlabs = model.slabs.filter((x) => idSet.has(x.id)).length;
  const onActive = all.filter((x) => idSet.has(x.id) && x.story === active).length;

  // sections in use by the chosen element kinds, with counts
  const used = new Map<string, number>();
  const bump = (n: string) => used.set(n, (used.get(n) ?? 0) + 1);
  if (f.kinds.column) model.columns.forEach((c) => bump(c.section));
  if (f.kinds.beam) model.beams.forEach((b) => bump(b.section));
  const usedFrame = groupSections([...used.keys()].map((name) => ({ name })));
  const usedSlab = new Map<string, number>();
  if (f.kinds.slab) model.slabs.forEach((s) => usedSlab.set(s.section, (usedSlab.get(s.section) ?? 0) + 1));

  const toggleSec = (n: string) => {
    const cur = f.sections ?? [];
    const next = cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n];
    setF({ ...f, sections: next.length ? next : null });
  };
  const num = (v: string) => (v.trim() === '' ? null : +v);
  const mats = [...new Set([...model.frameSections, ...model.slabSections].map((s) => s.material))];

  const select = (addTo: boolean) => {
    const st = useApp.getState();
    // nothing on the active story: jump to the first story that has matches so the selection is visible
    if (ids.length && !onActive) {
      const first = all.find((x) => idSet.has(x.id));
      if (first) st.setActiveStory(first.story);
    }
    st.setSelection(addTo ? [...new Set([...st.selection, ...ids])] : ids);
    toast(`Selected ${ids.length}: ${nCols} columns, ${nBeams} beams, ${nSlabs} slabs` + (ids.length > onActive && onActive ? ` (${onActive} on ${active}; the rest on other stories).` : '.'));
    closeDialog();
  };

  const reassign = () => {
    const frameIds = [...model.columns, ...model.beams].filter((x) => idSet.has(x.id)).map((x) => x.id);
    const slabIds = model.slabs.filter((x) => idSet.has(x.id)).map((x) => x.id);
    useApp.getState().commit((m) => {
      let out = m;
      if (newFrame && frameIds.length) out = patchIds(out, frameIds, { section: newFrame });
      if (newSlab && slabIds.length) out = patchIds(out, slabIds, { section: newSlab });
      return out;
    });
    toast(`Reassigned ${(newFrame ? frameIds.length : 0) + (newSlab ? slabIds.length : 0)} elements. Undo (Ctrl+Z) reverts it.`);
    closeDialog();
  };

  const range = (label: string, key: 't3' | 't2') => (
    <div className="row small">
      <span style={{ width: 130 }}>{label}</span>
      <input type="number" placeholder="min" value={f[key][0] ?? ''} onChange={(e) => setF({ ...f, [key]: [num(e.target.value), f[key][1]] })} />
      <span className="muted" style={{ width: 'auto' }}>to</span>
      <input type="number" placeholder="max" value={f[key][1] ?? ''} onChange={(e) => setF({ ...f, [key]: [f[key][0], num(e.target.value)] })} />
      <span className="muted" style={{ width: 'auto' }}>mm</span>
    </div>
  );
  const secCheck = (n: string, count: number) => (
    <label key={n} className="small">
      <input type="checkbox" checked={!!f.sections?.includes(n)} onChange={() => toggleSec(n)} /> {n} <span className="muted">({count})</span>
    </label>
  );

  return (
    <Modal
      wide
      title="Select by properties"
      footer={
        <>
          <button onClick={closeDialog}>Cancel</button>
          <button onClick={() => select(true)} disabled={!ids.length}>
            Add to selection
          </button>
          <button className="primary" onClick={() => select(false)} disabled={!ids.length}>
            Select {ids.length}
          </button>
        </>
      }
    >
      <div className="chips">
        <b className="small" style={{ width: 70 }}>Elements</b>
        {(['column', 'beam', 'slab'] as const).map((k) => (
          <label key={k} className="small">
            <input type="checkbox" checked={f.kinds[k]} onChange={() => setF({ ...f, kinds: { ...f.kinds, [k]: !f.kinds[k] } })} /> {k[0].toUpperCase() + k.slice(1)}s
          </label>
        ))}
      </div>
      <div className="chips">
        <b className="small" style={{ width: 70 }}>Stories</b>
        {(['active', 'all', 'pick'] as const).map((k) => (
          <label key={k} className="small">
            <input type="radio" checked={storyMode === k} onChange={() => setStoryMode(k)} /> {k === 'active' ? `Active (${active})` : k === 'all' ? 'All stories' : 'Choose…'}
          </label>
        ))}
      </div>
      {storyMode === 'pick' && <StoryChecks value={picked} onChange={setPicked} />}

      <div className="small">
        <b>Sections</b> <span className="muted">(tick to limit to these; none ticked means any)</span>
      </div>
      <div className="storycheck">
        {(['Columns', 'Beams', 'Other'] as const).flatMap((g) => usedFrame[g].map((s) => secCheck(s.name, used.get(s.name)!)))}
        {[...usedSlab].map(([n, c]) => secCheck(n, c))}
        {!used.size && !usedSlab.size && <span className="muted small">No elements of the chosen kinds yet.</span>}
      </div>

      <div className="small">
        <b>Section properties</b>
      </div>
      <div className="row small">
        <span style={{ width: 130 }}>Shape</span>
        <select value={f.shape} onChange={(e) => setF({ ...f, shape: e.target.value as ElementFilter['shape'] })}>
          <option value="any">Any</option>
          <option>Rectangle</option>
          <option>Circle</option>
          <option>Other</option>
        </select>
        <span style={{ width: 'auto' }}>Material</span>
        <select value={f.material} onChange={(e) => setF({ ...f, material: e.target.value })}>
          <option value="">Any</option>
          {mats.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </div>
      {range('Depth t3 / slab thk.', 't3')}
      {range('Width t2', 't2')}
      <div className="small" style={{ color: 'var(--accent2)' }}>
        {ids.length} match: {nCols} columns, {nBeams} beams, {nSlabs} slabs
        {ids.length !== onActive ? ` (${onActive} on ${active})` : ''}
      </div>

      <div className="section" style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
        <h4>Batch reassign the matched elements</h4>
        <div className="row small">
          <span style={{ width: 130 }}>Columns + beams →</span>
          <select value={newFrame} onChange={(e) => setNewFrame(e.target.value)} disabled={!nCols && !nBeams}>
            <option value="">(keep)</option>
            <SectionOptions sections={model.frameSections} prefer={nBeams && !nCols ? 'Beams' : 'Columns'} />
          </select>
        </div>
        <div className="row small">
          <span style={{ width: 130 }}>Slabs →</span>
          <select value={newSlab} onChange={(e) => setNewSlab(e.target.value)} disabled={!nSlabs}>
            <option value="">(keep)</option>
            {[...model.slabSections].sort((a, b) => a.thickness - b.thickness).map((s) => (
              <option key={s.name}>{s.name}</option>
            ))}
          </select>
          <button className="primary" disabled={!ids.length || (!newFrame && !newSlab)} onClick={reassign}>
            Reassign
          </button>
        </div>
      </div>
    </Modal>
  );
}
