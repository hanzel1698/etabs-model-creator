import { toast, useApp } from '../model/store';
import { cachedStoryNodes, deleteIds, joinBeams, joinColumns, mergeSlabs, patchIds, setBeamEnd, type PlanNode } from '../model/ops';
import { columnOn, levelTag, type Beam } from '../model/types';
import { logAutoSizes } from '../log/sessionLog';
import { useEffect, useState } from 'react';
import { openDialog } from './dialogState';
import { SectionOptions } from './sectionGroups';
import { useUnderlay, saveUnderlayMeta, removeUnderlay } from '../underlay/store';
import { commitBeams, setTool } from '../plan/tools';
import { fitAll } from '../plan/PlanView';
import { dist, fmt } from '../model/geom';
import { autoSizeBeams, noFitNote } from '../model/autoBeam';
import { ChecksSection } from './Checks';
import { LoadsSection } from './LoadDialogs';
import { LoadFilterSection } from './LoadFilterSection';

export function RightPanel() {
  return (
    <div className="side right">
      <LoadFilterSection />
      <Properties />
      <LoadsSection />
      <ChecksSection />
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
  const nodes = cachedStoryNodes(model, st.activeStory).filter((x) => s.has(x.id));
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
        <div className="chips" style={{ marginTop: 8 }}>
          <button onClick={() => openDialog({ kind: 'selectBy' })} title="Select by section, story, size, shape or material; batch reassign">
            Select by…
          </button>
        </div>
      </div>
    );

  /** Same element kind and section as the current selection, on the active story (Shift: all stories). */
  const selectSimilar = (allStories: boolean) => {
    const story = useApp.getState().activeStory;
    const keys = new Set([...cols.map((c) => 'c|' + c.section), ...beams.map((b) => 'b|' + b.section), ...slabs.map((x) => 's|' + x.section)]);
    const on = (x: { story: string }) => allStories || x.story === story;
    const ids = [
      ...model.columns.filter((c) => (allStories || columnOn(model, c, story)) && keys.has('c|' + c.section)),
      ...model.beams.filter((b) => on(b) && keys.has('b|' + b.section)),
      ...model.slabs.filter((x) => on(x) && keys.has('s|' + x.section)),
    ].map((x) => x.id);
    st.setSelection(ids);
  };

  return (
    <div className="section">
      <h4>
        Selection <span className="muted">{sel.length}</span>
      </h4>
      <div className="small muted" style={{ marginBottom: 6 }}>
        {[cols.length && `${cols.length} col`, beams.length && `${beams.length} beam`, slabs.length && `${slabs.length} slab`, grids.length && `${grids.length} grid`, nodes.length && `${nodes.length} node`].filter(Boolean).join(' · ')}
      </div>
      {frames.length > 0 && (
        <div className="row">
          <span>Section</span>
          <select value={common(frames, (x) => x.section)} onChange={(e) => st.commit((m) => patchIds(m, frames.map((x) => x.id), { section: e.target.value }))}>
            <option value="" disabled>(mixed)</option>
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
            <option value="" disabled>(mixed)</option>
            {[...model.slabSections].sort((a, b) => a.thickness - b.thickness).map((x) => (
              <option key={x.name}>{x.name}</option>
            ))}
          </select>
        </div>
      )}
      {cols.length + beams.length + slabs.length > 0 && (
        <div className="row">
          <span>Story</span>
          <select value={common([...frames, ...slabs], (x) => x.story)} onChange={(e) => st.commit((m) => patchIds(m, sel, { story: e.target.value }))}>
            <option value="" disabled>(mixed)</option>
            {model.stories.map((x) => (
              <option key={x.name}>{x.name}</option>
            ))}
          </select>
        </div>
      )}
      {[...frames, ...slabs].some((x) => x.dz) && (
        <div className="small muted">
          Off the story level: {[...new Set([...frames, ...slabs].map((x) => levelTag(model, x) || `${x.story} level`))].join(', ')}. Changing the story puts it on that story's level.
        </div>
      )}
      {cols.length === 1 && cols[0].base && <div className="small muted">Joined column: {cols[0].base} – {cols[0].story}. Changing its story makes it a one-story column there.</div>}
      {beams.length === 1 && <BeamEnds b={beams[0]} />}
      {beams.length === 1 && <div className="small muted">Length {fmt(dist({ x: beams[0].x1, y: beams[0].y1 }, { x: beams[0].x2, y: beams[0].y2 }))} mm</div>}
      {nodes.length > 0 && <NodeCoords nodes={nodes} />}
      {grids.length === 1 && (
        <div className="row">
          <span>Label</span>
          <input type="text" value={grids[0].label} onChange={(e) => st.commit((m) => ({ ...m, grids: m.grids.map((g) => (g.id === grids[0].id ? { ...g, label: e.target.value } : g)) }))} />
        </div>
      )}
      {grids.length > 0 && (
        <div className="row">
          <span>Bubble</span>
          <select
            value={common(grids, (g) => g.bubble)}
            onChange={(e) => {
              const ids = new Set(grids.map((g) => g.id));
              st.commit((m) => ({ ...m, grids: m.grids.map((g) => (ids.has(g.id) ? { ...g, bubble: e.target.value as any } : g)) }));
            }}
          >
            <option value="" disabled>(mixed)</option>
            <option value="start">Start</option>
            <option value="end">End</option>
            <option value="both">Both</option>
          </select>
        </div>
      )}
      <div className="chips" style={{ marginTop: 6 }}>
        {cols.length + beams.length + slabs.length > 0 && (
          <button onClick={(e) => selectSimilar(e.shiftKey)} title="Select every element of the same kind and section on this story (Shift+click: all stories)">
            Select similar
          </button>
        )}
        <button onClick={() => openDialog({ kind: 'selectBy' })}>Select by…</button>
        {sel.length > nodes.length && (
          <>
            <button onClick={() => openDialog({ kind: 'replicate' })} title="E">Replicate…</button>
            <button onClick={() => openDialog({ kind: 'move' })}>Move…</button>
            {cols.length > 1 && (
              <button onClick={joinSelectedColumns} title="Join the selected columns stacked at one point on consecutive stories into one column spanning those stories">
                Join columns
              </button>
            )}
            {beams.length > 1 && (
              <button onClick={joinSelectedBeams} title="Join the selected beams that lie end to end on one line into one beam, auto-sized for its new length">
                Join beams
              </button>
            )}
            {slabs.length > 1 && (
              <button onClick={mergeSelectedSlabs} title="Join the selected slabs that share an edge into one slab">
                Merge slabs
              </button>
            )}
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
          </>
        )}
      </div>
    </div>
  );
}

export function joinSelectedBeams() {
  const s = useApp.getState();
  const sel = new Set(s.selection);
  const ids = s.model.beams.filter((x) => sel.has(x.id)).map((x) => x.id);
  if (ids.length < 2) return toast('Select two or more beams to join.');
  const r = joinBeams(s.model, ids);
  if (!r.joined) return toast('Nothing joined: the beams must lie on one line and touch end to end.');
  const sized = autoSizeBeams(r.model, r.ids, s.active.beam);
  s.commit(() => sized.model);
  s.setSelection(r.ids);
  const secs = [...new Set([...sized.sizes.values()].map((x) => x.section))].join(', ');
  const left = ids.length - r.from;
  toast(`${r.from} beams joined into ${r.joined} (auto-sized: ${secs}).` + (left ? ` ${left} left as they were.` : '') + mixedNote(r.mixedLoads, 'beam') + noFitNote(sized.sizes, s.active.beam));
  logAutoSizes(sized.model, r.ids, s.active.beam);
}

export function joinSelectedColumns() {
  const s = useApp.getState();
  const sel = new Set(s.selection);
  const ids = s.model.columns.filter((x) => sel.has(x.id)).map((x) => x.id);
  if (ids.length < 2) return toast('Select two or more columns to join (stacked on consecutive stories: pick them in 3D, or Shift+click Select similar).');
  const r = joinColumns(s.model, ids);
  if (!r.joined) return toast('Nothing joined: the columns must stand at the same point on consecutive stories.');
  s.commit(() => r.model);
  s.setSelection(r.ids);
  const left = ids.length - r.from;
  toast(
    `${r.from} columns joined into ${r.joined}.` +
      (r.mixed ? ` ${r.mixed} had pieces of different sections and took the lowest piece's.` : '') +
      (left ? ` ${left} left as they were.` : '') +
      mixedNote(r.mixedLoads, 'column'),
  );
}

export function mergeSelectedSlabs() {
  const s = useApp.getState();
  const sel = new Set(s.selection);
  const ids = s.model.slabs.filter((x) => sel.has(x.id)).map((x) => x.id);
  if (ids.length < 2) return toast('Select two or more slabs to merge.');
  const r = mergeSlabs(s.model, ids);
  if (!r.merged) return toast('Nothing merged: the slabs must share edges and form one outline without holes.');
  s.commit(() => r.model);
  s.setSelection(r.model.slabs.slice(-r.merged).map((x) => x.id));
  const left = ids.length - r.from;
  toast(`${r.from} slabs merged into ${r.merged}.` + (left ? ` ${left} left as they were.` : '') + mixedNote(r.mixedLoads, 'slab'));
}

/** Loads dropped by a join or merge whose pieces carried different (or partial) loads. */
const mixedNote = (n: number, what: string) => (n ? ` ⚠ ${n} joined ${what}${n > 1 ? 's' : ''} lost their loads (the pieces differed): assign them again.` : '');

/** Editable end coordinates of a single beam; a value applies on Enter or when the field loses focus. */
function BeamEnds({ b }: { b: Beam }) {
  const fields = [
    ['X1', 'x1', 1, 'x'],
    ['Y1', 'y1', 1, 'y'],
    ['X2', 'x2', 2, 'x'],
    ['Y2', 'y2', 2, 'y'],
  ] as const;
  return (
    <>
      {fields.map(([label, key, end, axis]) => (
        <CoordInput
          key={key}
          label={label}
          value={b[key]}
          onSet={(v) => {
            const p = end === 1 ? { x: b.x1, y: b.y1 } : { x: b.x2, y: b.y2 };
            commitBeams((m) => setBeamEnd(m, b.id, end, { ...p, [axis]: v }));
          }}
        />
      ))}
    </>
  );
}

function CoordInput({ label, value, onSet }: { label: string; value: number; onSet: (v: number) => void }) {
  const shown = fmt(value, 1);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const apply = () => {
    const v = parseFloat(text);
    if (isFinite(v) && fmt(v, 1) !== shown) onSet(v);
    setText(shown); // a rejected value (e.g. a zero-length beam) snaps back; an accepted one updates via `shown`
  };
  return (
    <div className="row">
      <span>{label}</span>
      <input type="text" value={text} onChange={(e) => setText(e.target.value)} onBlur={apply} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
    </div>
  );
}

const NODE_FROM = { grid: 'grid intersection', column: 'column centre', beam: 'beam intersection' } as const;

function NodeCoords({ nodes }: { nodes: PlanNode[] }) {
  if (nodes.length === 1) {
    const n = nodes[0];
    return (
      <>
        <div className="row">
          <span>X</span>
          <input type="text" readOnly value={fmt(n.x, 1)} />
        </div>
        <div className="row">
          <span>Y</span>
          <input type="text" readOnly value={fmt(n.y, 1)} />
        </div>
        <div className="small muted">{n.from.map((f) => NODE_FROM[f]).join(' · ')} (mm)</div>
      </>
    );
  }
  return (
    <div className="node-list small">
      <div className="muted">X, Y (mm)</div>
      {nodes.slice(0, 200).map((n) => (
        <div key={n.id}>
          {fmt(n.x, 1)}, {fmt(n.y, 1)}
        </div>
      ))}
      {nodes.length > 200 && <div className="muted">… {nodes.length - 200} more</div>}
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
