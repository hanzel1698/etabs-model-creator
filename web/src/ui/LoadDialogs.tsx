import { useEffect, useState, type ReactNode } from 'react';
import { closeDialog, openDialog, useFramePick } from './dialogState';
import { endFramePick, picking, startFramePick } from '../plan/tools';
import { Modal, StoryChecks } from './Dialogs';
import { toast, useApp } from '../model/store';
import { cachedStoryNodes, isNodeId } from '../model/ops';
import {
  addPattern,
  assignFrameLoad,
  assignJointLoad,
  assignShellLoad,
  deletePattern,
  describeFrameLoad,
  describeJointLoad,
  describeShellLoad,
  DIR_LABEL,
  frameLoadKey,
  patternUse,
  removeLoad,
  renamePattern,
  shellLoadKey,
  updatePattern,
  type AssignMode,
} from '../model/loads';
import { PATTERN_TYPES, type FrameLoad, type LoadDir, type LoadPattern, type Model, type Pt, type Vec6 } from '../model/types';
import { dist, fmt } from '../model/geom';

/** The active load pattern, or the first one if it was renamed or deleted. */
export function activePattern(s: { loadPattern: string; model: Model }): string {
  return s.model.loadPatterns.some((p) => p.name === s.loadPattern) ? s.loadPattern : s.model.loadPatterns[0]?.name ?? '';
}

const PATTERN_LABEL: Record<string, string> = { SuperDead: 'Superimposed dead', ReduceLive: 'Reducible live', Rooflive: 'Roof live', Quake: 'Seismic' };

/** What the selection can take loads on: frames (beams, columns), slabs, and joints (selected nodes and column tops). */
export function loadTargets() {
  const s = useApp.getState();
  const sel = new Set(s.selection);
  const frames = [...s.model.columns, ...s.model.beams].filter((x) => sel.has(x.id));
  const slabs = s.model.slabs.filter((x) => sel.has(x.id));
  const nodes = cachedStoryNodes(s.model, s.activeStory).filter((n) => sel.has(n.id));
  return { frames, slabs, nodes };
}

// ---------- top bar ----------

/** Which load dialogs the current selection can use. */
export function useLoadTargets() {
  const model = useApp((s) => s.model);
  const sel = useApp((s) => s.selection);
  const set = new Set(sel);
  return {
    frames: model.columns.some((x) => set.has(x.id)) || model.beams.some((x) => set.has(x.id)),
    slabs: model.slabs.some((x) => set.has(x.id)),
    joints: sel.some(isNodeId),
  };
}

export function PatternPicker() {
  const patterns = useApp((s) => s.model.loadPatterns);
  const pat = useApp((s) => activePattern(s));
  return (
    <select className="pattern" value={pat} onChange={(e) => useApp.getState().setLoadPattern(e.target.value)} title="Active load pattern: the default in the load dialogs, and the one the plan shows">
      {patterns.map((p) => <option key={p.name}>{p.name}</option>)}
    </select>
  );
}

// ---------- patterns ----------

type Row = LoadPattern & { orig: string };

export function LoadPatternsDialog() {
  const model = useApp((s) => s.model);
  const [rows, setRows] = useState<Row[]>(() => model.loadPatterns.map((p) => ({ ...p, orig: p.name })));
  const up = (i: number, p: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const gone = model.loadPatterns.filter((p) => !rows.some((r) => r.orig === p.name));
  const lost = gone.reduce((s, p) => s + patternUse(model, p.name), 0);
  const save = () => {
    const names = rows.map((r) => r.name.trim().toLowerCase());
    if (new Set(names).size !== names.length || names.some((n) => !n)) return toast('Pattern names must be unique and not empty.');
    if (lost && !confirm(`Deleting ${gone.map((p) => p.name).join(', ')} also deletes the ${lost} load${lost === 1 ? '' : 's'} assigned in ${gone.length === 1 ? 'it' : 'them'}. Continue?`)) return;
    useApp.getState().commit((m) => {
      let out = m;
      for (const p of gone) out = deletePattern(out, p.name);
      // rename through temporary names so swaps (A↔B) work
      const tmp = rows.map((r, i) => ({ r, t: `__tmp${i}` }));
      for (const { r, t } of tmp) if (out.loadPatterns.some((p) => p.name === r.orig)) out = renamePattern(out, r.orig, t);
      for (const { r, t } of tmp) {
        const name = r.name.trim();
        if (out.loadPatterns.some((p) => p.name === t)) out = renamePattern(out, t, name);
        else out = addPattern(out, { name, type: r.type, selfWeight: r.selfWeight });
        out = updatePattern(out, name, { type: r.type, selfWeight: r.selfWeight });
      }
      const order = rows.map((r) => r.name.trim());
      return { ...out, loadPatterns: [...out.loadPatterns].sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name)) };
    });
    closeDialog();
  };
  const add = () => {
    let k = rows.length + 1;
    while (rows.some((r) => r.name === `Pattern${k}`)) k++;
    setRows([...rows, { name: `Pattern${k}`, type: 'Other', selfWeight: 0, orig: `__new${k}${Date.now()}` }]);
  };
  return (
    <Modal title="Load patterns" footer={<><button onClick={closeDialog}>Cancel</button><button className="primary" onClick={save}>Save</button></>}>
      <div className="small muted">Pushing creates each pattern in ETABS with a linear static load case of the same name. Usually only Dead carries self-weight (multiplier 1).</div>
      <table className="grid">
        <thead>
          <tr><th>Name</th><th>Type</th><th>Self-weight ×</th><th>Loads</th><th></th></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.orig}>
              <td><input type="text" value={r.name} onChange={(e) => up(i, { name: e.target.value })} /></td>
              <td>
                <select value={r.type} disabled={r.fromEtabs} onChange={(e) => up(i, { type: e.target.value as LoadPattern['type'] })}>
                  {PATTERN_TYPES.map((t) => <option key={t} value={t}>{PATTERN_LABEL[t] ?? t}</option>)}
                </select>
              </td>
              <td><input type="number" step={0.1} value={r.selfWeight} disabled={r.fromEtabs} onChange={(e) => up(i, { selfWeight: +e.target.value || 0 })} /></td>
              <td className="small muted">{model.loadPatterns.some((p) => p.name === r.orig) ? patternUse(model, r.orig) : 0}{r.fromEtabs ? ' · ETABS' : ''}</td>
              <td><button className="danger" onClick={() => setRows(rows.filter((_, j) => j !== i))} title="Delete the pattern and its loads">✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="chips"><button onClick={add}>+ Pattern</button></div>
      {lost > 0 && <div className="small" style={{ color: 'var(--danger)' }}>Saving deletes {lost} assigned load{lost === 1 ? '' : 's'}.</div>}
    </Modal>
  );
}

// ---------- shared ----------

function PatternSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const pats = useApp((s) => s.model.loadPatterns);
  return (
    <div className="row">
      <span>Pattern</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {pats.map((p) => <option key={p.name}>{p.name}</option>)}
      </select>
    </div>
  );
}

function ModeChoice({ value, onChange }: { value: AssignMode; onChange: (v: AssignMode) => void }) {
  const opts: [AssignMode, string, string][] = [
    ['add', 'Add to existing', 'Keep the loads already in this pattern and add this one'],
    ['replace', 'Replace existing', 'Remove the loads already in this pattern, then add this one'],
    ['delete', 'Delete existing', "Remove the selection's loads in this pattern"],
  ];
  return (
    <div className="chips">
      {opts.map(([k, label, title]) => (
        <label key={k} className="small" title={title}>
          <input type="radio" checked={value === k} onChange={() => onChange(k)} /> {label}
        </label>
      ))}
    </div>
  );
}

function DirSelect({ value, onChange, dirs }: { value: LoadDir; onChange: (d: LoadDir) => void; dirs: readonly LoadDir[] }) {
  return (
    <div className="row">
      <span>Direction</span>
      <select value={value} onChange={(e) => onChange(e.target.value as LoadDir)}>
        {dirs.map((d) => <option key={d} value={d}>{DIR_LABEL[d]}</option>)}
      </select>
    </div>
  );
}

function Num({ label, value, onChange, unit, step, extra }: { label: string; value: number; onChange: (v: number) => void; unit?: string; step?: number; extra?: ReactNode }) {
  return (
    <div className="row">
      <span>{label}</span>
      <input type="number" value={value} step={step ?? 0.5} onChange={(e) => onChange(+e.target.value || 0)} />
      {unit && <span className="small muted" style={{ width: 'auto' }}>{unit}</span>}
      {extra}
    </div>
  );
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

// ---------- frame ----------

const FRAME_DIRS: LoadDir[] = ['Gravity', 'X', 'Y', 'Z', '1', '2', '3', 'PX', 'PY', 'PZ', 'PGravity'];

export function FrameLoadDialog() {
  const pat0 = useApp((s) => activePattern(s));
  const { frames } = loadTargets();
  const [pattern, setPattern] = useState(pat0);
  const [kind, setKind] = useState<'uniform' | 'trap' | 'point'>('uniform');
  const [force, setForce] = useState<'F' | 'M'>('F');
  const [dir, setDir] = useState<LoadDir>('Gravity');
  const [value, setValue] = useState(10);
  const [rel, setRel] = useState(true);
  // trapezoidal: up to 4 stations (distance, value), each pair of neighbours is one segment
  const [trap, setTrap] = useState<{ d: number; v: number }[]>([
    { d: 0, v: 0 },
    { d: 0.5, v: 10 },
    { d: 1, v: 0 },
  ]);
  const [pt, setPt] = useState({ d: 0.5, v: 20 });
  const [mode, setMode] = useState<AssignMode>('add');
  const unit = kind === 'point' ? (force === 'F' ? 'kN' : 'kN·m') : force === 'F' ? 'kN/m' : 'kN·m/m';
  const dUnit = rel ? '(0–1)' : 'm';
  const toMm = (d: number) => (rel ? d : d * 1000);
  const hidden = useFramePick((s) => !!s.done);
  const canPick = frames.some((f) => 'x1' in f);
  // closing the dialog some other way while picking must not leave the plan in pick mode
  useEffect(() => () => void (picking() && endFramePick()), []);
  // pick a distance along a selected beam in the plan; it comes back in the dialog's current units
  const pickBtn = (set: (d: number) => void) => (
    <button
      disabled={!canPick}
      title={canPick ? 'Pick on plan: click a point along a selected beam; its distance from the beam start fills this field' : 'Picking needs a selected beam (a column has no length in plan)'}
      onClick={() => startFramePick((t, len) => set(+(rel ? t : (t * len) / 1000).toFixed(3)))}
    >
      ⌖ Pick
    </button>
  );

  const loads = (): FrameLoad[] => {
    const base = { pattern, force, dir, rel };
    if (kind === 'uniform') return [{ ...base, kind: 'dist', rel: true, d1: 0, d2: 1, v1: value, v2: value }];
    if (kind === 'point') return [{ ...base, kind: 'point', d1: toMm(pt.d), d2: toMm(pt.d), v1: pt.v, v2: pt.v }];
    return trap.slice(1).map((b, i) => ({ ...base, kind: 'dist' as const, d1: toMm(trap[i].d), d2: toMm(b.d), v1: trap[i].v, v2: b.v })).filter((l) => l.d2 > l.d1);
  };
  const apply = () => {
    if (!frames.length) return toast('Select beams or columns first.');
    if (!pattern) return toast('Define a load pattern first.');
    const ls = loads();
    if (mode !== 'delete' && !ls.length) return toast('The distances must increase from one row to the next.');
    if (mode !== 'delete' && rel && ls.some((l) => l.d1 < 0 || l.d2 > 1)) return toast('Relative distances run from 0 to 1.');
    const ids = frames.map((f) => f.id);
    // a trapezoid is several segments: the first one applies the mode, the rest are added to it
    const del = { pattern } as FrameLoad;
    useApp.getState().commit((m) => (mode === 'delete' ? assignFrameLoad(m, ids, del, 'delete') : ls.reduce((acc, l, i) => assignFrameLoad(acc, ids, l, i === 0 ? mode : 'add'), m)));
    toast(`${mode === 'delete' ? 'Deleted' : 'Assigned'} ${pattern} frame load${mode === 'delete' ? 's' : ''} on ${plural(frames.length, 'frame')}.`);
    closeDialog();
  };
  return (
    <Modal hidden={hidden} title={`Frame load · ${plural(frames.length, 'frame')}`} footer={<><button onClick={closeDialog}>Cancel</button><button className="primary" onClick={apply}>Apply</button></>}>
      <PatternSelect value={pattern} onChange={setPattern} />
      {mode !== 'delete' && (
        <>
          <div className="chips">
            {([['uniform', 'Uniform'], ['trap', 'Trapezoidal'], ['point', 'Point']] as const).map(([k, l]) => (
              <label key={k} className="small"><input type="radio" checked={kind === k} onChange={() => setKind(k)} /> {l}</label>
            ))}
            <span className="sep" />
            <label className="small"><input type="radio" checked={force === 'F'} onChange={() => setForce('F')} /> Force</label>
            <label className="small"><input type="radio" checked={force === 'M'} onChange={() => setForce('M')} /> Moment</label>
          </div>
          <DirSelect value={dir} onChange={setDir} dirs={FRAME_DIRS} />
          {kind === 'uniform' && <Num label="Load" value={value} onChange={setValue} unit={unit} />}
          {kind !== 'uniform' && (
            <label className="small"><input type="checkbox" checked={rel} onChange={() => setRel(!rel)} /> Relative distances (0 = start, 1 = end); off: metres from the start</label>
          )}
          {kind === 'point' && (
            <>
              <Num label={`Distance ${dUnit}`} value={pt.d} onChange={(d) => setPt({ ...pt, d })} step={rel ? 0.05 : 0.25} extra={pickBtn((d) => setPt((p) => ({ ...p, d })))} />
              <Num label="Load" value={pt.v} onChange={(v) => setPt({ ...pt, v })} unit={unit} />
            </>
          )}
          {kind === 'trap' && (
            <table className="grid">
              <thead><tr><th>Distance {dUnit}</th><th>Load {unit}</th><th></th></tr></thead>
              <tbody>
                {trap.map((r, i) => (
                  <tr key={i}>
                    <td style={{ display: 'flex', gap: 4 }}>
                      <input type="number" step={rel ? 0.05 : 0.25} value={r.d} onChange={(e) => setTrap(trap.map((x, j) => (j === i ? { ...x, d: +e.target.value || 0 } : x)))} />
                      {pickBtn((d) => setTrap((rows) => rows.map((x, j) => (j === i ? { ...x, d } : x))))}
                    </td>
                    <td><input type="number" step={0.5} value={r.v} onChange={(e) => setTrap(trap.map((x, j) => (j === i ? { ...x, v: +e.target.value || 0 } : x)))} /></td>
                    <td>{trap.length > 2 && <button className="danger" onClick={() => setTrap(trap.filter((_, j) => j !== i))}>✕</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {kind === 'trap' && trap.length < 4 && <div className="chips"><button onClick={() => setTrap([...trap, { d: rel ? 1 : trap[trap.length - 1].d + 1, v: 0 }])}>+ Row</button></div>}
          <div className="small muted">Gravity: a positive value acts downward. Local 2 is the frame's strong-axis direction.</div>
        </>
      )}
      <ModeChoice value={mode} onChange={setMode} />
    </Modal>
  );
}

// ---------- shell ----------

const SHELL_DIRS: LoadDir[] = ['Gravity', 'Z', '3', 'PGravity', 'X', 'Y'];

export function ShellLoadDialog() {
  const pat0 = useApp((s) => activePattern(s));
  const { slabs } = loadTargets();
  const [pattern, setPattern] = useState(pat0);
  const [value, setValue] = useState(1.5);
  const [dir, setDir] = useState<LoadDir>('Gravity');
  const [mode, setMode] = useState<AssignMode>('replace');
  const apply = () => {
    if (!slabs.length) return toast('Select slabs first.');
    if (!pattern) return toast('Define a load pattern first.');
    const ids = slabs.map((s) => s.id);
    useApp.getState().commit((m) => assignShellLoad(m, ids, { pattern, dir, value }, mode));
    toast(`${mode === 'delete' ? 'Deleted' : 'Assigned'} ${pattern} shell load${mode === 'delete' ? 's' : ''} on ${plural(slabs.length, 'slab')}.`);
    closeDialog();
  };
  return (
    <Modal title={`Shell load · ${plural(slabs.length, 'slab')}`} footer={<><button onClick={closeDialog}>Cancel</button><button className="primary" onClick={apply}>Apply</button></>}>
      <PatternSelect value={pattern} onChange={setPattern} />
      {mode !== 'delete' && (
        <>
          <Num label="Load" value={value} onChange={setValue} unit="kN/m²" step={0.25} />
          <DirSelect value={dir} onChange={setDir} dirs={SHELL_DIRS} />
          <div className="small muted">Uniform over the slab. ETABS passes it on to the beams according to the slab section's modelling (a membrane slab spreads it to its supporting beams).</div>
        </>
      )}
      <ModeChoice value={mode} onChange={setMode} />
    </Modal>
  );
}

// ---------- joint ----------

export function JointLoadDialog() {
  const pat0 = useApp((s) => activePattern(s));
  const story = useApp((s) => s.activeStory);
  const { nodes } = loadTargets();
  const [pattern, setPattern] = useState(pat0);
  const [f, setF] = useState<Vec6>([0, 0, -50, 0, 0, 0]);
  const [stories, setStories] = useState<string[]>([story]);
  const [mode, setMode] = useState<AssignMode>('add');
  const labels = ['Fx', 'Fy', 'Fz', 'Mx', 'My', 'Mz'];
  const apply = () => {
    if (!nodes.length) return toast('Select nodes first (Alt+drag a window, or turn on Nodes and click them).');
    if (!pattern || !stories.length) return toast('Pick a pattern and at least one story.');
    useApp.getState().commit((m) => assignJointLoad(m, stories, nodes, { pattern, f }, mode));
    toast(`${mode === 'delete' ? 'Deleted' : 'Assigned'} ${pattern} joint load${mode === 'delete' ? 's' : ''} at ${plural(nodes.length, 'node')} on ${plural(stories.length, 'story')}.`);
    closeDialog();
  };
  return (
    <Modal title={`Joint load · ${plural(nodes.length, 'node')}`} footer={<><button onClick={closeDialog}>Cancel</button><button className="primary" onClick={apply}>Apply</button></>}>
      <PatternSelect value={pattern} onChange={setPattern} />
      {mode !== 'delete' && (
        <>
          {labels.map((l, i) => (
            <Num key={l} label={l} value={f[i]} onChange={(v) => setF(f.map((x, j) => (j === i ? v : x)) as Vec6)} unit={i < 3 ? 'kN' : 'kN·m'} step={i < 3 ? 5 : 1} />
          ))}
          <div className="small muted">Global axes. Fz below 0 acts downward. Added on top, a load sums with the joint's load in the same pattern.</div>
        </>
      )}
      <div className="small" style={{ marginTop: 6 }}>On stories</div>
      <StoryChecks value={stories} onChange={setStories} />
      <ModeChoice value={mode} onChange={setMode} />
    </Modal>
  );
}

// ---------- right panel ----------

/** Loads on the selection, one row per distinct load, with how many selected elements carry it. */
export function LoadsSection() {
  const model = useApp((s) => s.model);
  const sel = useApp((s) => s.selection);
  const story = useApp((s) => s.activeStory);
  const set = new Set(sel);
  const frames = [...model.columns, ...model.beams].filter((x) => set.has(x.id));
  const slabs = model.slabs.filter((x) => set.has(x.id));
  const nodes = cachedStoryNodes(model, story).filter((n) => set.has(n.id));
  const near = (p: Pt) => (q: Pt) => dist(p, q) < 1;
  const joints = model.jointLoads.filter((j) => j.story === story && nodes.some(near(j)));
  if (!frames.length && !slabs.length && !nodes.length) return null;

  const rows = new Map<string, { text: string; pattern: string; ids: string[] }>();
  const addRow = (key: string, pattern: string, text: string, id: string) => {
    const r = rows.get(key) ?? { text, pattern, ids: [] };
    r.ids.push(id);
    rows.set(key, r);
  };
  frames.forEach((x) => x.loads?.forEach((l) => addRow('f' + frameLoadKey(l), l.pattern, describeFrameLoad(l), x.id)));
  slabs.forEach((x) => x.loads?.forEach((l) => addRow('s' + shellLoadKey(l), l.pattern, describeShellLoad(l), x.id)));
  joints.forEach((j) => addRow('j' + j.id, j.pattern, `joint ${describeJointLoad(j.f)} at (${fmt(j.x)}, ${fmt(j.y)})`, j.id));
  // a frame load is counted against the selected frames, a slab load against the selected slabs
  const of = (key: string) => (key[0] === 'f' ? frames.length : key[0] === 's' ? slabs.length : 0);
  const list = [...rows.entries()].sort((a, b) => a[1].pattern.localeCompare(b[1].pattern));

  return (
    <div className="section">
      <h4>Loads</h4>
      {!list.length && <div className="small muted">No loads on the selection.</div>}
      {list.map(([key, r]) => (
        <div key={key} className="load-row small">
          <span>
            <b>{r.pattern}</b> {r.text}
            {r.ids.length < of(key) && <span className="muted"> · {r.ids.length} of {of(key)}</span>}
          </span>
          <button className="danger" title="Remove this load from the selection" onClick={() => useApp.getState().commit((m) => removeLoad(m, r.ids, key.slice(1)))}>✕</button>
        </div>
      ))}
      <div className="chips" style={{ marginTop: 6 }}>
        {frames.length > 0 && <button onClick={() => openDialog({ kind: 'frameLoad' })}>Frame load…</button>}
        {slabs.length > 0 && <button onClick={() => openDialog({ kind: 'shellLoad' })}>Shell load…</button>}
        {nodes.length > 0 && <button onClick={() => openDialog({ kind: 'jointLoad' })}>Joint load…</button>}
      </div>
    </div>
  );
}
