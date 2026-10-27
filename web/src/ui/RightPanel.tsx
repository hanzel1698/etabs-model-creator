import { useApp } from '../model/store';
import { deleteIds, patchIds } from '../model/ops';
import { openDialog } from './dialogState';
import { SectionOptions } from './sectionGroups';
import { useUnderlay, saveUnderlayMeta, removeUnderlay } from '../underlay/store';
import { setTool } from '../plan/tools';
import { fitAll } from '../plan/PlanView';
import { dist, fmt } from '../model/geom';

export function RightPanel() {
  return (
    <div className="side right">
      <Properties />
      <UnderlayPanel />
    </div>
  );
}

function Properties() {
  const model = useApp((s) => s.model);
  const sel = useApp((s) => s.selection);
  const st = useApp.getState();
  const s = new Set(sel);
  const cols = model.columns.filter((x) => s.has(x.id));
  const beams = model.beams.filter((x) => s.has(x.id));
  const slabs = model.slabs.filter((x) => s.has(x.id));
  const grids = model.grids.filter((x) => s.has(x.id));
  const frames = [...cols, ...beams];
  const common = <T,>(arr: T[], f: (x: T) => string | number) => (arr.length && arr.every((x) => f(x) === f(arr[0])) ? String(f(arr[0])) : '');

  if (!sel.length)
    return (
      <div className="section">
        <h4>Properties</h4>
        <div className="muted small">Nothing selected. Use Select (V): click, or drag a window. L→R selects fully inside, R→L selects crossing.</div>
        <div className="muted small" style={{ marginTop: 8 }}>
          {model.columns.length} columns · {model.beams.length} beams · {model.slabs.length} slabs · {model.grids.length} grids
        </div>
      </div>
    );

  return (
    <div className="section">
      <h4>
        Selection <span className="muted">{sel.length}</span>
      </h4>
      <div className="small muted" style={{ marginBottom: 6 }}>
        {[cols.length && `${cols.length} col`, beams.length && `${beams.length} beam`, slabs.length && `${slabs.length} slab`, grids.length && `${grids.length} grid`].filter(Boolean).join(' · ')}
      </div>
      {frames.length > 0 && (
        <div className="row">
          <span>Section</span>
          <select value={common(frames, (x) => x.section)} onChange={(e) => st.commit((m) => patchIds(m, frames.map((x) => x.id), { section: e.target.value }))}>
            <option value="">(mixed)</option>
            <SectionOptions sections={model.frameSections} prefer={cols.length && !beams.length ? 'Columns' : beams.length && !cols.length ? 'Beams' : undefined} />
          </select>
        </div>
      )}
      {cols.length > 0 && (
        <div className="row">
          <span>Angle°</span>
          <input type="number" value={common(cols, (x) => x.angle)} placeholder="mixed" step={15} onChange={(e) => st.commit((m) => patchIds(m, cols.map((x) => x.id), { angle: +e.target.value || 0 }))} />
        </div>
      )}
      {slabs.length > 0 && (
        <div className="row">
          <span>Slab</span>
          <select value={common(slabs, (x) => x.section)} onChange={(e) => st.commit((m) => patchIds(m, slabs.map((x) => x.id), { section: e.target.value }))}>
            <option value="">(mixed)</option>
            {model.slabSections.map((x) => (
              <option key={x.name}>{x.name}</option>
            ))}
          </select>
        </div>
      )}
      {cols.length + beams.length + slabs.length > 0 && (
        <div className="row">
          <span>Story</span>
          <select value={common([...frames, ...slabs], (x) => x.story)} onChange={(e) => st.commit((m) => patchIds(m, sel, { story: e.target.value }))}>
            <option value="">(mixed)</option>
            {model.stories.map((x) => (
              <option key={x.name}>{x.name}</option>
            ))}
          </select>
        </div>
      )}
      {beams.length === 1 && <div className="small muted">Length {fmt(dist({ x: beams[0].x1, y: beams[0].y1 }, { x: beams[0].x2, y: beams[0].y2 }))} mm</div>}
      {grids.length === 1 && (
        <>
          <div className="row">
            <span>Label</span>
            <input type="text" value={grids[0].label} onChange={(e) => st.commit((m) => ({ ...m, grids: m.grids.map((g) => (g.id === grids[0].id ? { ...g, label: e.target.value } : g)) }))} />
          </div>
          <div className="row">
            <span>Bubble</span>
            <select value={grids[0].bubble} onChange={(e) => st.commit((m) => ({ ...m, grids: m.grids.map((g) => (g.id === grids[0].id ? { ...g, bubble: e.target.value as any } : g)) }))}>
              <option value="start">Start</option>
              <option value="end">End</option>
              <option value="both">Both</option>
            </select>
          </div>
        </>
      )}
      <div className="chips" style={{ marginTop: 6 }}>
        <button onClick={() => openDialog({ kind: 'replicate' })} title="E">Replicate…</button>
        <button onClick={() => openDialog({ kind: 'move' })}>Move…</button>
        <button
          className="danger"
          onClick={() => {
            st.commit((m) => deleteIds(m, sel));
            st.setSelection([]);
          }}
          title="Del"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function UnderlayPanel() {
  const u = useUnderlay();
  const story = useApp((s) => s.activeStory);
  const invert = useApp((s) => s.invertPdf);
  if (u.kind === 'none')
    return (
      <div className="section">
        <h4>Underlay</h4>
        <div className="muted small">
          No underlay loaded. Use <b>Underlay…</b> to load a DXF (recommended: vector, real units, snapping) or a PDF (one page per story).
        </div>
      </div>
    );
  const reg = u.regions.find((r) => r.stories.includes(story));
  const sheet = u.sheets.find((s) => s.story === story);
  return (
    <div className="section">
      <h4>
        Underlay <button onClick={() => openDialog({ kind: 'underlay' })}>Setup</button>
      </h4>
      <div className="small" style={{ marginBottom: 6, wordBreak: 'break-all' }}>
        {u.kind.toUpperCase()} · {u.fileName}
      </div>
      <div className="row">
        <span>Opacity</span>
        <input type="range" min={0.05} max={1} step={0.05} value={u.opacity} onChange={(e) => (u.set({ opacity: +e.target.value }), saveUnderlayMeta())} />
      </div>
      {u.kind === 'dxf' && (
        <>
          <label className="small">
            <input type="checkbox" checked={u.setupMode} onChange={() => (u.set({ setupMode: !u.setupMode }), requestAnimationFrame(() => fitAll()))} /> Show whole DXF (setup)
          </label>
          <label className="small">
            <input type="checkbox" checked={u.showText} onChange={() => (u.set({ showText: !u.showText }), saveUnderlayMeta())} /> Show DXF text
          </label>
          <div className="small muted" style={{ margin: '4px 0' }}>
            {story}: {reg ? 'region assigned' : u.regions.length ? 'no region assigned' : 'whole drawing (no regions)'}
          </div>
          <div className="chips">
            <button onClick={() => setTool('calibrate')} title="Click two ends of a known line, then type its real length in mm">
              Calibrate scale
            </button>
            <button onClick={() => setTool('region')}>Define story region</button>
          </div>
        </>
      )}
      {u.kind === 'pdf' && (
        <>
          <div className="small muted" style={{ margin: '4px 0' }}>
            {story}: {sheet ? `page ${sheet.page}, ${fmt(sheet.s, 3)} mm/pt` : 'no page assigned'}
          </div>
          <label className="small">
            <input type="checkbox" checked={invert} onChange={useApp.getState().toggleInvertPdf} /> Dark (invert) PDF
          </label>
          <div className="chips">
            <button onClick={() => setTool('calibrate')}>Calibrate + origin</button>
          </div>
        </>
      )}
      <div className="chips" style={{ marginTop: 6 }}>
        <button className="danger" onClick={() => confirm('Remove the underlay?') && removeUnderlay()}>
          Remove
        </button>
      </div>
    </div>
  );
}
