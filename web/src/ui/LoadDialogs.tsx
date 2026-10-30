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
  frameLoadUnit,
  partialUniform,
  patternUse,
  removeLoad,
  renamePattern,
  shellLoadKey,
  updatePattern,
  usedLoadValues,
  type AssignMode,
} from '../model/loads';
import { PATTERN_TYPES, type Beam, type FrameLoad, type LoadDir, type LoadPattern, type Model, type Pt, type Vec6 } from '../model/types';
import { dist, fmt } from '../model/geom';
import { recentValues, rememberValues } from './recentValues';

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

function Num({ label, value, onChange, unit, step, extra, recent, used }: { label: string; value: number; onChange: (v: number) => void; unit?: string; step?: number; extra?: ReactNode; recent?: number[]; used?: number[] }) {
  const num = (v: number) => `${+v.toFixed(3)}`;
  return (
    <>
      <div className="row">
        <span>{label}</span>
        <input type="number" value={value} step={step ?? 0.5} onChange={(e) => onChange(+e.target.value || 0)} />
        {unit && <span className="small muted" style={{ width: 'auto' }}>{unit}</span>}
        {extra}
      </div>
      {recent && <Recent items={recent} label={num} current={value} onPick={onChange} />}
      {used && <Recent title="In model" items={notIn(used, recent ?? [])} label={num} current={value} onPick={onChange} />}
    </>
  );
}

const notIn = <T,>(vs: T[], shown: T[]) => vs.filter((v) => !shown.some((x) => JSON.stringify(x) === JSON.stringify(v)));

/** Recently applied (or already assigned) values as one-click chips under a field. */
function Recent<T>({ title = 'Recent', items, label, current, onPick }: { title?: string; items: T[]; label: (v: T) => string; current?: T; onPick: (v: T) => void }) {
  if (!items.length) return null;
  const cur = JSON.stringify(current);
  return (
    <div className="chips recent">
      <span className="small muted">{title}</span>
      {items.map((v) => (
        <button key={JSON.stringify(v)} className={JSON.stringify(v) === cur ? 'primary' : ''} onClick={() => onPick(v)} title={title === 'Recent' ? 'Use this recently applied value' : 'Use this value, already assigned in the model'}>
          {label(v)}
        </button>
      ))}
    </div>
  );
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

// ---------- frame ----------

const FRAME_DIRS: LoadDir[] = ['Gravity', 'X', 'Y', 'Z', '1', '2', '3', 'PX', 'PY', 'PZ', 'PGravity'];

// wall load calculator inputs, kept between openings of the dialog (mm, kN/m³)
const WALL_PRESETS = [200, 100];
const wallCalc = { t: 200, beamDepth: 450, gamma: 21 };

/** Line load of a wall on the beams: thickness × height × unit weight. The height starts at the
 *  story above the beams' floor less a beam depth (the top story, a parapet, uses its own height). */
function WallCalculator({ story, onUse }: { story: string; onUse: (v: number) => void }) {
  const stories = useApp((s) => s.model.stories);
  const i = stories.findIndex((s) => s.name === story);
  const above = stories[i + 1] ?? stories[i];
  const clear = above?.height ?? 3000;
  const [t, setT] = useState(wallCalc.t);
  const [beamDepth, setBeamDepth] = useState(wallCalc.beamDepth);
  const [h, setH] = useState(Math.max(0, clear - wallCalc.beamDepth));
  const [gamma, setGamma] = useState(wallCalc.gamma);
  useEffect(() => void Object.assign(wallCalc, { t, beamDepth, gamma }), [t, beamDepth, gamma]);
  const load = +((t / 1000) * (h / 1000) * gamma).toFixed(3);
  const changeDepth = (d: number) => {
    setBeamDepth(d);
    setH(Math.max(0, clear - d));
  };
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 4, padding: '6px 8px', marginBottom: 5 }}>
      <div className="row">
        <span>Thickness</span>
        <input type="number" step={25} value={t} onChange={(e) => setT(+e.target.value || 0)} />
        <span className="small muted" style={{ width: 'auto' }}>mm</span>
      </div>
      <div className="chips" style={{ marginBottom: 5 }}>
        {WALL_PRESETS.map((p) => (
          <button key={p} className={t === p ? 'primary' : ''} onClick={() => setT(p)}>{p} mm</button>
        ))}
      </div>
      <Num label="Beam" value={beamDepth} onChange={changeDepth} unit="mm" step={25} />
      <Num label="Height" value={h} onChange={setH} unit="mm" step={50} extra={<button title={`Reset to ${above?.name ?? 'story'} height ${clear} mm less the beam depth`} onClick={() => setH(Math.max(0, clear - beamDepth))}>↺</button>} />
      <div className="small muted" style={{ marginBottom: 5 }}>
        {above ? `${above.name} height ${clear} mm − beam ${beamDepth} mm` : 'No story height found'}
      </div>
      <Num label="Unit wt" value={gamma} onChange={setGamma} unit="kN/m³" step={0.5} />
      <div className="row">
        <span>Load</span>
        <b>{fmt(load, 2)} kN/m</b>
        <span className="small muted" style={{ width: 'auto' }}>= {t / 1000} × {h / 1000} × {gamma}</span>
        <button className="primary" style={{ marginLeft: 'auto' }} onClick={() => onUse(load)}>Use</button>
      </div>
    </div>
  );
}

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
  // uniform over part of the length (e.g. a wall that stops short of the beam ends): from a to b
  const [part, setPart] = useState(false);
  const [span, setSpan] = useState({ a: 0.25, b: 0.75 });
  const [mode, setMode] = useState<AssignMode>('add');
  const [calc, setCalc] = useState(false);
  const activeStory = useApp((s) => s.activeStory);
  const unit = frameLoadUnit({ kind: kind === 'point' ? 'point' : 'dist', force });
  const dUnit = rel ? '(0–1)' : 'm';
  // recent values are kept per unit, so a line load never offers a point load's kN
  const recentKey = `frame:${unit}`;
  const [recent] = useState(() => ({ 'kN/m': recentValues<number>('frame:kN/m'), 'kN·m/m': recentValues<number>('frame:kN·m/m'), kN: recentValues<number>('frame:kN'), 'kN·m': recentValues<number>('frame:kN·m') }));
  const recentHere = recent[unit];
  const [used] = useState(() => usedLoadValues(useApp.getState().model));
  const usedHere = used.frame[unit] ?? [];
  const toMm = (d: number) => (rel ? d : d * 1000);
  const hidden = useFramePick((s) => !!s.done);
  const canPick = frames.some((f) => 'x1' in f);
  // closing the dialog some other way while picking must not leave the plan in pick mode
  useEffect(() => () => void (picking() && endFramePick()), []);
  // pick a distance along a selected beam in the plan; it comes back in the dialog's current units
  const fromPick = (t: number, len: number) => +(rel ? t : (t * len) / 1000).toFixed(3);
  const pickBtn = (set: (d: number) => void) => (
    <button
      disabled={!canPick}
      title={canPick ? 'Pick on plan: click a point along a selected beam; its distance from the beam start fills this field' : 'Picking needs a selected beam (a column has no length in plan)'}
      onClick={() => startFramePick((t, len) => set(fromPick(t, len)))}
    >
      ⌖ Pick
    </button>
  );
  // the start and then the end of the loaded length, in two clicks on the plan
  const pickSpan = () =>
    startFramePick(
      (t, len) => {
        const a = fromPick(t, len);
        setSpan((s) => ({ ...s, a }));
        startFramePick((t2, len2) => setSpan({ a, b: fromPick(t2, len2) }), 'End of the load: click where it stops along the beam.');
      },
      'Start of the load: click where it begins along a selected beam.',
    );
  // the shortest selected beam, for absolute distances that run past a beam's end
  const shortest = Math.min(...frames.filter((f): f is Beam => 'x1' in f).map((b) => dist({ x: b.x1, y: b.y1 }, { x: b.x2, y: b.y2 })));

  const loads = (): FrameLoad[] => {
    const base = { pattern, force, dir, rel };
    if (kind === 'uniform' && part) return span.a === span.b ? [] : [partialUniform(base, toMm(span.a), toMm(span.b), value)];
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
    if (mode !== 'delete' && !rel && ls.some((l) => l.d1 < 0 || l.d2 > shortest + 1)) return toast(`Distances must lie on the beam: the shortest selected beam is ${fmt(shortest / 1000, 3)} m long.`);
    const ids = frames.map((f) => f.id);
    // a trapezoid is several segments: the first one applies the mode, the rest are added to it
    const del = { pattern } as FrameLoad;
    if (mode !== 'delete') rememberValues(recentKey, kind === 'uniform' ? [value] : kind === 'point' ? [pt.v] : trap.map((r) => r.v));
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
          {kind === 'uniform' && (
            <Num
              label="Load"
              value={value}
              onChange={setValue}
              unit={unit}
              recent={recentHere}
              used={usedHere}
              extra={force === 'F' && <button className={calc ? 'primary' : ''} onClick={() => setCalc(!calc)} title="Wall load calculator: thickness × height × unit weight">🧮 Calculator</button>}
            />
          )}
          {kind === 'uniform' && force === 'F' && calc && (
            <WallCalculator
              story={frames.find((f): f is Beam => 'x1' in f)?.story ?? frames[0]?.story ?? activeStory}
              onUse={(v) => {
                setValue(v);
                setCalc(false);
              }}
            />
          )}
          {kind === 'uniform' && (
            <div className="chips">
              <label className="small"><input type="radio" checked={!part} onChange={() => setPart(false)} /> Full length</label>
              <label className="small" title="A uniform load from one distance to another, e.g. a wall that covers only part of the beam">
                <input type="radio" checked={part} onChange={() => setPart(true)} /> Part of the length
              </label>
            </div>
          )}
          {(kind !== 'uniform' || part) && (
            <label className="small"><input type="checkbox" checked={rel} onChange={() => setRel(!rel)} /> Relative distances (0 = start, 1 = end); off: metres from the start</label>
          )}
          {kind === 'uniform' && part && (
            <>
              <Num label={`From ${dUnit}`} value={span.a} onChange={(a) => setSpan({ ...span, a })} step={rel ? 0.05 : 0.25} extra={pickBtn((a) => setSpan((s) => ({ ...s, a })))} />
              <Num label={`To ${dUnit}`} value={span.b} onChange={(b) => setSpan({ ...span, b })} step={rel ? 0.05 : 0.25} extra={pickBtn((b) => setSpan((s) => ({ ...s, b })))} />
              <div className="chips">
                <button disabled={!canPick} onClick={pickSpan} title={canPick ? 'Click the start and then the end of the loaded length along a selected beam' : 'Picking needs a selected beam (a column has no length in plan)'}>
                  ⌖ Pick start → end
                </button>
              </div>
              <div className="small muted">
                {+value.toFixed(3)} {unit} {span.a === span.b ? 'over no length' : `over ${+Math.abs(span.b - span.a).toFixed(3)} ${rel ? 'of the length' : 'm'}`}. ETABS' Uniform tab only covers the whole frame,
                so this goes to ETABS as a trapezoidal segment with the same load at both ends (as entered in its Trapezoidal tab).
              </div>
            </>
          )}
          {kind === 'point' && (
            <>
              <Num label={`Distance ${dUnit}`} value={pt.d} onChange={(d) => setPt({ ...pt, d })} step={rel ? 0.05 : 0.25} extra={pickBtn((d) => setPt((p) => ({ ...p, d })))} />
              <Num label="Load" value={pt.v} onChange={(v) => setPt({ ...pt, v })} unit={unit} recent={recentHere} used={usedHere} />
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
                    <td><input type="number" step={0.5} list="recent-frame-values" value={r.v} onChange={(e) => setTrap(trap.map((x, j) => (j === i ? { ...x, v: +e.target.value || 0 } : x)))} /></td>
                    <td>{trap.length > 2 && <button className="danger" onClick={() => setTrap(trap.filter((_, j) => j !== i))}>✕</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {kind === 'trap' && (
            <datalist id="recent-frame-values">
              {[...recentHere, ...notIn(usedHere, recentHere)].map((v) => <option key={v} value={v} />)}
            </datalist>
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
  const [recent] = useState(() => recentValues<number>('shell'));
  const [used] = useState(() => usedLoadValues(useApp.getState().model).shell);
  const apply = () => {
    if (!slabs.length) return toast('Select slabs first.');
    if (!pattern) return toast('Define a load pattern first.');
    const ids = slabs.map((s) => s.id);
    if (mode !== 'delete') rememberValues('shell', [value]);
    useApp.getState().commit((m) => assignShellLoad(m, ids, { pattern, dir, value }, mode));
    toast(`${mode === 'delete' ? 'Deleted' : 'Assigned'} ${pattern} shell load${mode === 'delete' ? 's' : ''} on ${plural(slabs.length, 'slab')}.`);
    closeDialog();
  };
  return (
    <Modal title={`Shell load · ${plural(slabs.length, 'slab')}`} footer={<><button onClick={closeDialog}>Cancel</button><button className="primary" onClick={apply}>Apply</button></>}>
      <PatternSelect value={pattern} onChange={setPattern} />
      {mode !== 'delete' && (
        <>
          <Num label="Load" value={value} onChange={setValue} unit="kN/m²" step={0.25} recent={recent} used={used} />
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
  const [recent] = useState(() => recentValues<Vec6>('joint'));
  const [used] = useState(() => usedLoadValues(useApp.getState().model).joint);
  const apply = () => {
    if (!nodes.length) return toast('Select nodes first (Alt+drag a window, or turn on Nodes and click them).');
    if (!pattern || !stories.length) return toast('Pick a pattern and at least one story.');
    if (mode !== 'delete') rememberValues('joint', [f], (v) => v.every((x) => !x));
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
          <Recent items={recent} label={describeJointLoad} current={f} onPick={(v) => setF([...v] as Vec6)} />
          <Recent title="In model" items={notIn(used, recent)} label={describeJointLoad} current={f} onPick={(v) => setF([...v] as Vec6)} />
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
