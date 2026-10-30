import { useEffect, useState, type ReactNode } from 'react';
import { useDialog, openDialog, closeDialog, useMovePick, type Dialog } from './dialogState';
import { bySize, sectionGroup } from './sectionGroups';
import { SelectByDialog } from './SelectByDialog';
import { FrameLoadDialog, JointLoadDialog, LoadPatternsDialog, ShellLoadDialog } from './LoadDialogs';
import { useApp, toast } from '../model/store';
import { generateGrids, lift, moveIds, oppositeLabelStart, replicate } from '../model/ops';
import { parseSpacing, fmt } from '../model/geom';
import { columnStories, levelZ, uid, storyElevations, type Column, type FrameSection, type Model, type RefPlane, type SlabSection, type Story } from '../model/types';
import { useUnderlay, saveUnderlayMeta, rescaleDxf, rectOf, withStories } from '../underlay/store';
import type { DxfLayer } from '../underlay/dxf';
import { setTool, redrawRegion, startMovePick, endMovePick, movePicking } from '../plan/tools';
import { bridge, bridgeUrl, DEFAULT_BRIDGE, type BridgeStatus, type Supports, type Unowned } from '../etabs/bridgeClient';
import { toPayload, applyImport, importElements, jointKeys } from '../etabs/mapping';
import { fitAll } from '../plan/PlanView';
import { log as sessionLog } from '../log/sessionLog';
import { modelIssues } from '../model/checks';

export function Modal({ title, children, footer, wide, hidden }: { title: string; children: ReactNode; footer?: ReactNode; wide?: boolean; hidden?: boolean }) {
  // hidden keeps the dialog (and its state) mounted while the plan is used to pick a value for it
  return (
    <div className="modal-bg" style={hidden ? { display: 'none' } : undefined} onPointerDown={(e) => e.target === e.currentTarget && closeDialog()}>
      <div className={'modal' + (wide ? ' wide' : '')} onKeyDown={(e) => e.stopPropagation()}>
        <header>
          {title}
          <button onClick={closeDialog}>✕</button>
        </header>
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

export function Dialogs() {
  const d = useDialog((s) => s.d);
  if (!d) return null;
  switch (d.kind) {
    case 'region':
      return <RegionDialog d={d} />;
    case 'regionStories':
      return <RegionStoriesDialog id={d.regionId} />;
    case 'grids':
      return <GridsDialog />;
    case 'replicate':
      return <ReplicateDialog />;
    case 'selectBy':
      return <SelectByDialog />;
    case 'move':
      return <MoveDialog />;
    case 'sections':
      return <SectionsDialog />;
    case 'stories':
      return <StoriesDialog />;
    case 'refPlanes':
      return <RefPlanesDialog />;
    case 'underlay':
      return <UnderlayDialog />;
    case 'etabs':
      return <EtabsDialog />;
    case 'loadPatterns':
      return <LoadPatternsDialog />;
    case 'frameLoad':
      return <FrameLoadDialog />;
    case 'shellLoad':
      return <ShellLoadDialog />;
    case 'jointLoad':
      return <JointLoadDialog />;
    default:
      return null;
  }
}

export function StoryChecks({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const stories = useApp((s) => s.model.stories);
  const [range, setRange] = useState('');
  return (
    <>
      <div className="storycheck">
        {[...stories].reverse().map((s) => (
          <label key={s.name} className="small">
            <input type="checkbox" checked={value.includes(s.name)} onChange={(e) => onChange(e.target.checked ? [...value, s.name] : value.filter((x) => x !== s.name))} />
            {s.name}
          </label>
        ))}
      </div>
      <div className="row">
        <button onClick={() => onChange(stories.map((s) => s.name))}>All</button>
        <button onClick={() => onChange([])}>None</button>
        <input type="text" placeholder="Range e.g. 3-10 (story numbers, bottom = 1)" value={range} onChange={(e) => setRange(e.target.value)} />
        <button
          onClick={() => {
            const m = range.match(/^\s*(\d+)\s*[-–to]+\s*(\d+)\s*$/);
            if (!m) return;
            const a = Math.min(+m[1], +m[2]),
              b = Math.max(+m[1], +m[2]);
            onChange([...new Set([...value, ...stories.slice(a - 1, b).map((s) => s.name)])]);
          }}
        >
          Add range
        </button>
      </div>
    </>
  );
}

// ---------------- DXF region ----------------

function RegionDialog({ d }: { d: Extract<Dialog, { kind: 'region' }> }) {
  const active = useApp((s) => s.activeStory);
  const [stories, setStories] = useState<string[]>([active]);
  const save = () => {
    const u = useUnderlay.getState();
    // a story can belong to one region only
    u.set({ regions: withStories(u.regions, stories, { id: uid(), stories, rect: rectOf(d.rect.a, d.rect.b), ref: d.ref }), setupMode: false });
    saveUnderlayMeta();
    closeDialog();
    setTool('select');
    requestAnimationFrame(() => fitAll());
    toast(`Region assigned to ${stories.join(', ')}. Its reference point is now the model origin (0,0). Tick “Show whole DXF” to define more regions.`);
  };
  return (
    <Modal title="Assign region to stories" footer={<><button onClick={closeDialog}>Cancel</button><button className="primary" disabled={!stories.length} onClick={save}>Assign</button></>}>
      <div className="small muted">The boxed plan will be shown on these stories, with the picked reference point placed at the model origin (0,0). Tick all typical floors that share this plan.</div>
      <StoryChecks value={stories} onChange={setStories} />
    </Modal>
  );
}

/** Change which stories an existing region is shown on, keeping its box and reference point. */
function RegionStoriesDialog({ id }: { id: string }) {
  const reg = useUnderlay((u) => u.regions.find((r) => r.id === id));
  const [stories, setStories] = useState<string[]>(reg?.stories ?? []);
  if (!reg) return null;
  const taken = useUnderlay.getState().regions.filter((r) => r.id !== id).flatMap((r) => r.stories.filter((s) => stories.includes(s)));
  const save = () => {
    const u = useUnderlay.getState();
    u.set({ regions: withStories(u.regions, stories, reg) });
    saveUnderlayMeta();
    closeDialog();
    toast(`Region now shown on ${stories.join(', ')}.`);
  };
  return (
    <Modal title="Region stories" footer={<><button onClick={closeDialog}>Cancel</button><button className="primary" disabled={!stories.length} onClick={save}>Save</button></>}>
      <div className="small muted">The region keeps its box and reference point. A story can be in one region only, so ticking a story here takes it out of its current region.</div>
      <StoryChecks value={stories} onChange={setStories} />
      {taken.length > 0 && <div className="small muted">Moves from another region: {taken.join(', ')}</div>}
    </Modal>
  );
}

// ---------------- grids ----------------

function GridsDialog() {
  const [xs, setXs] = useState('4@6000');
  const [ys, setYs] = useState('3@5000');
  const [xl, setXl] = useState('A');
  const [yl, setYl] = useState('1');
  const [ylTouched, setYlTouched] = useState(false);
  const [ext, setExt] = useState(1500);
  const [replace, setReplace] = useState(true);
  const gen = () => {
    const g = generateGrids({ xSpacing: parseSpacing(xs), ySpacing: parseSpacing(ys), x0: 0, y0: 0, xLabelStart: xl, yLabelStart: yl, extend: ext });
    useApp.getState().commit((m) => ({ ...m, grids: replace ? g : [...m.grids, ...g] }));
    closeDialog();
    requestAnimationFrame(() => fitAll());
  };
  return (
    <Modal title="Generate grids" footer={<><button onClick={closeDialog}>Cancel</button><button className="primary" onClick={gen}>Create</button></>}>
      <div className="small muted">Spacings in mm, separated by commas. Use n@s for repeats, e.g. “3@6000, 4500”. Grid lines start at the origin.</div>
      <div className="row"><span>X spacing</span><input type="text" value={xs} onChange={(e) => setXs(e.target.value)} /></div>
      <div className="row"><span>X labels</span><input type="text" value={xl} onChange={(e) => (setXl(e.target.value), !ylTouched && e.target.value.trim() && setYl(oppositeLabelStart(e.target.value)))} /></div>
      <div className="row"><span>Y spacing</span><input type="text" value={ys} onChange={(e) => setYs(e.target.value)} /></div>
      <div className="row"><span>Y labels</span><input type="text" value={yl} onChange={(e) => (setYl(e.target.value), setYlTouched(true))} /></div>
      <div className="row"><span>Overhang</span><input type="number" value={ext} onChange={(e) => setExt(+e.target.value)} /></div>
      <label className="small"><input type="checkbox" checked={replace} onChange={() => setReplace(!replace)} /> Replace existing grids</label>
      <div className="small muted">X: {parseSpacing(xs).length + 1} lines, total {fmt(parseSpacing(xs).reduce((a, b) => a + b, 0))} · Y: {parseSpacing(ys).length + 1} lines, total {fmt(parseSpacing(ys).reduce((a, b) => a + b, 0))}</div>
    </Modal>
  );
}

// ---------------- replicate / move ----------------

function ReplicateDialog() {
  const sel = useApp((s) => s.selection);
  const active = useApp((s) => s.activeStory);
  const [mode, setMode] = useState<'linear' | 'stories'>('stories');
  const [dx, setDx] = useState(0);
  const [dy, setDy] = useState(0);
  const [n, setN] = useState(1);
  const [stories, setStories] = useState<string[]>([]);
  const [planes, setPlanes] = useState<string[]>([]);
  const refPlanes = useApp((s) => s.model.refPlanes);
  const run = () => {
    const st = useApp.getState();
    const ids = sel.filter((id) => !st.model.grids.some((g) => g.id === id));
    const zs = st.model.refPlanes.filter((r) => planes.includes(r.id)).map((r) => r.z);
    let created: string[] = [];
    st.commit((m) => {
      const r = replicate(m, ids, mode === 'linear' ? { dx, dy, n, stories: null } : { dx, dy, n: 1, stories, planes: zs });
      created = r.created;
      return r.model;
    });
    toast(`Created ${created.length} elements.`);
    closeDialog();
  };
  return (
    <Modal title={`Replicate ${sel.length} selected`} footer={<><button onClick={closeDialog}>Cancel</button><button className="primary" onClick={run} disabled={mode === 'stories' && !stories.length && !planes.length}>Replicate</button></>}>
      <div className="chips">
        <button className={mode === 'stories' ? 'on' : ''} onClick={() => setMode('stories')}>To levels (Z)</button>
        <button className={mode === 'linear' ? 'on' : ''} onClick={() => setMode('linear')}>Linear (X / Y)</button>
      </div>
      <div className="row"><span>dx (mm)</span><input type="number" value={dx} onChange={(e) => setDx(+e.target.value)} /></div>
      <div className="row"><span>dy (mm)</span><input type="number" value={dy} onChange={(e) => setDy(+e.target.value)} /></div>
      {mode === 'linear' ? (
        <div className="row"><span>Copies</span><input type="number" min={1} value={n} onChange={(e) => setN(Math.max(1, +e.target.value))} /></div>
      ) : (
        <>
          <div className="small muted">Copies the selection (from {active}) onto the ticked stories and reference planes, shifted by dx/dy (usually 0). Elements that already exist are skipped.</div>
          <StoryChecks value={stories} onChange={setStories} />
          {refPlanes.length > 0 && (
            <>
              <div className="small muted">Reference planes: copies sit off the story they lie in; a column runs from the story level below up to the plane.</div>
              <div className="storycheck">
                {[...refPlanes].sort((a, b) => b.z - a.z).map((r) => (
                  <label key={r.id} className="small">
                    <input type="checkbox" checked={planes.includes(r.id)} onChange={(e) => setPlanes(e.target.checked ? [...planes, r.id] : planes.filter((x) => x !== r.id))} />
                    {r.name} ({fmt(r.z)})
                  </label>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}

function MoveDialog() {
  const sel = useApp((s) => s.selection);
  const [dx, setDx] = useState(0);
  const [dy, setDy] = useState(0);
  const [to, setTo] = useState('');
  const model = useApp((s) => s.model);
  const el = storyElevations(model);
  const ids = new Set(sel);
  // the selection's levels (a column's top), low → high: the lowest goes to the chosen level, the others keep their height above it
  const zs = [...new Set([...model.columns, ...model.beams, ...model.slabs].flatMap((x) => (ids.has(x.id) ? levelZ(el, x) ?? [] : [])))].sort((a, b) => a - b);
  const levels = [
    ...model.stories.map((s) => ({ key: 's:' + s.name, name: s.name, z: el[s.name].top, plane: false })),
    ...model.refPlanes.map((r) => ({ key: 'p:' + r.id, name: r.name, z: r.z, plane: true })),
  ].sort((a, b) => b.z - a.z);
  const nameAt = (z: number) => levels.find((l) => Math.abs(l.z - z) <= 1)?.name ?? `${fmt(z)} mm`;
  const target = levels.find((l) => l.key === to);
  const dz = target && zs.length ? target.z - zs[0] : 0;
  const choices = levels.filter((l) => !zs.length || Math.abs(l.z - zs[0]) > 1);
  const run = () => {
    const st = useApp.getState();
    if (dz) {
      const cols = new Set(st.model.columns.map((c) => c.id));
      const stuck = [...st.model.columns, ...st.model.beams, ...st.model.slabs].filter((x) => ids.has(x.id) && !lift(st.model, x, dz, cols.has(x.id)));
      if (stuck.length)
        return toast(`${stuck.length} of the selection cannot go to ${target!.name} (from ${[...new Set(stuck.map((x) => x.story))].join(', ')}): a column top needs a story under it, and a joined column moves only between story levels.`);
    }
    st.commit((m) => moveIds(m, sel, dx, dy, dz));
    closeDialog();
  };
  const hidden = useMovePick((s) => !!s.done);
  // closing the dialog some other way while picking must not leave the plan in pick mode
  useEffect(() => () => void (movePicking() && endMovePick()), []);
  // pick a base point and a destination in the plan; the vector between them fills dx and dy
  const pick = () => {
    const panel = useApp.getState().panel;
    if (panel !== 'plan' && panel !== 'split') return toast('Switch to the plan view to pick the move.');
    startMovePick((x, y) => (setDx(+x.toFixed(3)), setDy(+y.toFixed(3))));
  };
  return (
    <Modal hidden={hidden} title={`Move ${sel.length} selected`} footer={<><button onClick={closeDialog}>Cancel</button><button className="primary" onClick={run}>Move</button></>}>
      <div className="row"><span>dx (mm)</span><input type="number" value={dx} onChange={(e) => setDx(+e.target.value)} /></div>
      <div className="row"><span>dy (mm)</span><input type="number" value={dy} onChange={(e) => setDy(+e.target.value)} /></div>
      <div className="row"><button onClick={pick} title="Click a base point, then its destination; dx and dy fill from the two points (snaps to grids, columns, beam ends...)">⌖ Pick dx, dy on plan</button></div>
      {zs.length > 0 && (
        <>
          <div className="row">
            <span>To level</span>
            <select value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">{zs.length > 1 ? 'Same levels' : `${nameAt(zs[0])} (stay)`}</option>
              <optgroup label="Stories">
                {choices.filter((l) => !l.plane).map((l) => <option key={l.key} value={l.key}>{l.name}</option>)}
              </optgroup>
              {choices.some((l) => l.plane) && (
                <optgroup label="Reference planes">
                  {choices.filter((l) => l.plane).map((l) => <option key={l.key} value={l.key}>{l.name} ({fmt(l.z)})</option>)}
                </optgroup>
              )}
            </select>
          </div>
          <div className="small muted">
            {zs.length > 1 ? `The selection spans ${nameAt(zs[0])} to ${nameAt(zs[zs.length - 1])}: ${nameAt(zs[0])} moves to the chosen level and the rest keep their height above it. ` : ''}
            {dz ? `That is ${dz > 0 ? 'up' : 'down'} ${fmt(Math.abs(dz))} mm. ` : ''}
            {target?.plane ? 'On a reference plane, elements sit off the story they lie in; a column runs from the story level below up to the plane. ' : ''}
            Grids stay in place vertically.
          </div>
        </>
      )}
    </Modal>
  );
}

// ---------------- sections ----------------

function SectionsDialog() {
  const model = useApp((s) => s.model);
  const [f, setF] = useState<FrameSection[]>(() => [...model.frameSections].sort(bySize));
  const [sl, setSl] = useState<SlabSection[]>(model.slabSections);
  const mats = model.materials.map((m) => m.name);
  const save = () => {
    const names = new Set(f.map((x) => x.name));
    if (names.size !== f.length) return toast('Frame section names must be unique.');
    useApp.getState().commit((m) => ({ ...m, frameSections: [...f].sort(bySize), slabSections: [...sl].sort((a, b) => a.thickness - b.thickness) }));
    closeDialog();
  };
  const upF = (i: number, p: Partial<FrameSection>) => setF(f.map((x, j) => (j === i ? { ...x, ...p } : x)));
  /** New section named by its group prefix and size, e.g. C400x400, B300x500, C500 (circle). */
  const addF = (prefix: 'C' | 'B', shape: FrameSection['shape'], t3: number, t2: number) => {
    const base = shape === 'Circle' ? `${prefix}${t3}` : `${prefix}${t2}x${t3}`;
    let name = base;
    for (let k = 2; f.some((x) => x.name === name); k++) name = `${base}-${k}`;
    setF([...f, { name, shape, t3, t2, material: mats[0] ?? '4000Psi', fromEtabs: false }]);
  };
  const upS = (i: number, p: Partial<SlabSection>) => setSl(sl.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <Modal wide title="Sections" footer={<><button onClick={closeDialog}>Cancel</button><button className="primary" onClick={save}>Save</button></>}>
      <div className="small muted">Sections imported from ETABS are read-only here. Sections you add are created in ETABS when you push. Depth t3 / width t2 in mm.</div>
      <table className="grid">
        <thead>
          <tr><th>Frame section</th><th>Shape</th><th>t3 depth</th><th>t2 width</th><th>Material</th><th></th></tr>
        </thead>
        <tbody>
          {(['Columns', 'Beams', 'Other'] as const).flatMap((grp) => {
            const rows = f.map((s, i) => ({ s, i })).filter(({ s }) => sectionGroup(s.name) === grp);
            if (grp === 'Other' && !rows.length) return [];
            return [
              <tr key={'h-' + grp} className="group-row">
                <td colSpan={6}>
                  {grp} <span className="muted">({rows.length}{grp === 'Columns' ? ', names starting with C' : grp === 'Beams' ? ', names starting with B' : ''})</span>
                </td>
              </tr>,
              ...rows.map(({ s, i }) => (
            <tr key={i}>
              <td><input type="text" value={s.name} disabled={s.fromEtabs} onChange={(e) => upF(i, { name: e.target.value })} /></td>
              <td>
                <select value={s.shape} disabled={s.fromEtabs} onChange={(e) => upF(i, { shape: e.target.value as any })}>
                  <option>Rectangle</option><option>Circle</option>{s.shape === 'Other' && <option>Other</option>}
                </select>
              </td>
              <td><input type="number" value={s.t3} disabled={s.fromEtabs} onChange={(e) => upF(i, { t3: +e.target.value })} /></td>
              <td><input type="number" value={s.t2} disabled={s.fromEtabs || s.shape === 'Circle'} onChange={(e) => upF(i, { t2: +e.target.value })} /></td>
              <td>
                <select value={s.material} disabled={s.fromEtabs} onChange={(e) => upF(i, { material: e.target.value })}>
                  {!mats.includes(s.material) && <option>{s.material}</option>}
                  {mats.map((m) => <option key={m}>{m}</option>)}
                </select>
              </td>
              <td>{s.fromEtabs ? <span className="muted small">ETABS</span> : <button className="danger" onClick={() => setF(f.filter((_, j) => j !== i))}>✕</button>}</td>
            </tr>
              )),
            ];
          })}
        </tbody>
      </table>
      <div className="chips">
        <button onClick={() => addF('C', 'Rectangle', 400, 400)}>+ Column</button>
        <button onClick={() => addF('C', 'Circle', 500, 500)}>+ Circular column</button>
        <button onClick={() => addF('B', 'Rectangle', 500, 300)}>+ Beam</button>
      </div>
      <table className="grid">
        <thead>
          <tr><th>Slab section</th><th>Thickness</th><th>Material</th><th></th></tr>
        </thead>
        <tbody>
          {sl.map((s, i) => (
            <tr key={i}>
              <td><input type="text" value={s.name} disabled={s.fromEtabs} onChange={(e) => upS(i, { name: e.target.value })} /></td>
              <td><input type="number" value={s.thickness} disabled={s.fromEtabs} onChange={(e) => upS(i, { thickness: +e.target.value })} /></td>
              <td>
                <select value={s.material} disabled={s.fromEtabs} onChange={(e) => upS(i, { material: e.target.value })}>
                  {!mats.includes(s.material) && <option>{s.material}</option>}
                  {mats.map((m) => <option key={m}>{m}</option>)}
                </select>
              </td>
              <td>{s.fromEtabs ? <span className="muted small">ETABS</span> : <button className="danger" onClick={() => setSl(sl.filter((_, j) => j !== i))}>✕</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="chips">
        <button onClick={() => setSl([...sl, { name: `S${sl.length + 1}`, thickness: 150, material: mats[0] ?? '4000Psi', fromEtabs: false }])}>+ Slab</button>
      </div>
      <div className="small muted">Materials: {mats.join(', ') || '—'}</div>
    </Modal>
  );
}

// ---------------- stories ----------------

function StoriesDialog() {
  const model = useApp((s) => s.model);
  const [base, setBase] = useState(model.baseElevation);
  // kept as strings so the fields can be blank until the user fills them
  const [fnd, setFnd] = useState({
    foundingDepth: model.foundation ? String(model.foundation.foundingDepth) : '',
    footingThickness: String(model.foundation?.footingThickness ?? 600),
    plinthHeight: model.foundation ? String(model.foundation.plinthHeight) : '',
  });
  const fndNums = () => {
    const n = { foundingDepth: parseFloat(fnd.foundingDepth), footingThickness: parseFloat(fnd.footingThickness), plinthHeight: parseFloat(fnd.plinthHeight) };
    return [n.foundingDepth, n.footingThickness, n.plinthHeight].every(isFinite) ? n : null;
  };
  const [rows, setRows] = useState<(Story & { orig: string })[]>(model.stories.map((s) => ({ ...s, orig: s.name })));
  // founding depth - footing thickness + plinth height is the ground floor level, so it gets its own
  // bottom story (footing top → GF level) under the floor-to-floor stories; a saved foundation means
  // the bottom story is that one
  const [fndRow, setFndRow] = useState<string | null>(model.foundation ? model.stories[0]?.name ?? null : null);
  const setFoundation = (p: Partial<typeof fnd>) => {
    const next = { ...fnd, ...p };
    setFnd(next);
    const fd = parseFloat(next.foundingDepth),
      ft = parseFloat(next.footingThickness),
      ph = parseFloat(next.plinthHeight);
    const h = fd - ft + ph - base;
    if (![fd, ft, ph].every(isFinite) || h <= 0) return;
    if (fndRow && rows[0]?.orig === fndRow) return setRows([{ ...rows[0], height: h }, ...rows.slice(1)]);
    let name = 'GF';
    for (let n = 2; rows.some((x) => x.name === name); n++) name = `GF${n}`;
    const orig = `__new${uid()}`;
    setFndRow(orig);
    setRows([{ name, orig, height: h, isMaster: false, similarTo: '' }, ...rows]);
  };
  const [addN, setAddN] = useState(1);
  const [addH, setAddH] = useState(3000);
  const up = (i: number, p: Partial<Story>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const save = () => {
    const names = rows.map((r) => r.name.trim());
    if (new Set(names).size !== names.length || names.some((n) => !n)) return toast('Story names must be unique and not empty.');
    const rename = new Map(rows.map((r) => [r.orig, r.name.trim()]));
    const keep = new Set(rows.map((r) => r.orig));
    useApp.getState().commit((m): Model => {
      const fix = <T extends { story: string }>(arr: T[]) => arr.filter((x) => keep.has(x.story)).map((x) => ({ ...x, story: rename.get(x.story)! }));
      // a joined column keeps the stories of its span that are left (still by their old names; fix renames the top)
      const span = (c: Column): Column => {
        if (!c.base) return c;
        const left = columnStories(m, c).filter((n) => keep.has(n));
        const { base, ...one } = c;
        if (!left.length) return one;
        const top = left[left.length - 1];
        return left.length > 1 ? { ...c, story: top, base: rename.get(left[0])! } : { ...one, story: top };
      };
      return {
        ...m,
        baseElevation: base,
        foundation: fndNums() ?? m.foundation,
        stories: rows.map(({ orig, ...s }) => ({ ...s, name: s.name.trim(), similarTo: s.similarTo ? rename.get(s.similarTo) ?? '' : '' })),
        columns: fix(m.columns.map(span)),
        beams: fix(m.beams),
        slabs: fix(m.slabs),
        jointLoads: fix(m.jointLoads),
      };
    });
    const st = useApp.getState();
    if (!st.model.stories.some((s) => s.name === st.activeStory)) st.setActiveStory(st.model.stories[0]?.name ?? '');
    closeDialog();
  };
  const el = storyElevations({ ...model, baseElevation: base, stories: rows });
  const gf = fndNums();
  const display = rows.map((r, i) => ({ r, i })).reverse();
  /** Insert a new story at `index` (rows are bottom → top), with the given height. Stories above move up. */
  const insertAt = (index: number, height: number) => {
    let n = rows.length + 1;
    while (rows.some((x) => x.name === `Story${n}`)) n++;
    const master = rows.find((x) => x.isMaster)?.orig ?? '';
    const row = { name: `Story${n}`, orig: `__new${uid()}`, height, isMaster: false, similarTo: master };
    setRows([...rows.slice(0, index), row, ...rows.slice(index)]);
  };
  return (
    <Modal wide title="Stories" footer={<><button onClick={closeDialog}>Cancel</button><button className="primary" onClick={save}>Save</button></>}>
      <div className="small muted">Top story first. “+ above / + below” inserts a story of the same height next to that one; the stories above it move up. Deleting a story deletes its elements. Renames carry through to elements.</div>
      <table className="grid">
        <thead><tr><th>Name</th><th>Height</th><th>Elevation</th><th>Master</th><th>Similar to</th><th>Insert</th><th></th></tr></thead>
        <tbody>
          {display.map(({ r, i }) => (
            <tr key={r.orig}>
              <td><input type="text" value={r.name} onChange={(e) => up(i, { name: e.target.value })} /></td>
              <td><input type="number" value={r.height} onChange={(e) => up(i, { height: +e.target.value })} /></td>
              <td className="muted">{fmt(el[r.name]?.top ?? 0)}</td>
              <td><input type="checkbox" checked={r.isMaster} onChange={(e) => up(i, { isMaster: e.target.checked, similarTo: e.target.checked ? '' : r.similarTo })} /></td>
              <td>
                <select value={r.similarTo} disabled={r.isMaster} onChange={(e) => up(i, { similarTo: e.target.value })}>
                  <option value="">None</option>
                  {rows.filter((x) => x.isMaster && x !== r).map((x) => <option key={x.orig} value={x.orig}>{x.name}</option>)}
                </select>
              </td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button title={`Insert a story above ${r.name}`} onClick={() => insertAt(i + 1, r.height)}>+ above</button>{' '}
                <button title={`Insert a story below ${r.name}`} onClick={() => insertAt(i, r.height)}>+ below</button>
              </td>
              <td><button className="danger" disabled={rows.length < 2} onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="section">
        <h4>Ground floor elevation</h4>
        <div className="row small">
          <span style={{ width: 110 }}>Founding depth</span>
          <input type="number" placeholder="e.g. 1500" value={fnd.foundingDepth} onChange={(e) => setFoundation({ foundingDepth: e.target.value })} />
          <span className="muted" style={{ width: 'auto' }}>mm</span>
        </div>
        <div className="row small">
          <span style={{ width: 110 }}>Footing thickness</span>
          <input type="number" value={fnd.footingThickness} onChange={(e) => setFoundation({ footingThickness: e.target.value })} />
          <span className="muted" style={{ width: 'auto' }}>mm</span>
        </div>
        <div className="row small">
          <span style={{ width: 110 }}>Plinth height</span>
          <input type="number" placeholder="e.g. 500" value={fnd.plinthHeight} onChange={(e) => setFoundation({ plinthHeight: e.target.value })} />
          <span className="muted" style={{ width: 'auto' }}>mm</span>
        </div>
        <div className="row small">
          <span style={{ width: 110 }}>Base elev.</span>
          <input type="number" value={base} onChange={(e) => setBase(+e.target.value)} />
          <span className="muted" style={{ width: 'auto' }}>mm</span>
        </div>
        <div className="small muted">
          Ground floor level = founding depth − footing thickness + plinth height
          {gf ? ` = ${fmt(gf.foundingDepth - gf.footingThickness + gf.plinthHeight)}` : ''}. Filling these adds a bottom story from the footing top up to ground floor level; your floor-to-floor stories sit above it. Base elev. defaults to 0.
        </div>
      </div>
      <div className="row">
        <span>Add</span>
        <input type="number" min={1} value={addN} onChange={(e) => setAddN(Math.max(1, +e.target.value))} />
        <span className="muted" style={{ width: 'auto' }}>stories of</span>
        <input type="number" value={addH} onChange={(e) => setAddH(+e.target.value)} />
        <button
          onClick={() => {
            const out = [...rows];
            const master = out.find((x) => x.isMaster)?.orig ?? '';
            for (let k = 0; k < addN; k++) {
              let i = out.length + 1;
              while (out.some((x) => x.name === `Story${i}`)) i++;
              out.push({ name: `Story${i}`, orig: `__new${uid()}`, height: addH, isMaster: false, similarTo: master });
            }
            setRows(out);
          }}
        >
          on top
        </button>
      </div>
    </Modal>
  );
}

// ---------------- reference planes ----------------

/** Where an elevation sits relative to the stories, e.g. "Story2 + 1500" or "below base". */
export function levelOf(m: Pick<Model, 'baseElevation' | 'stories'>, z: number): string {
  const el = storyElevations(m as Model);
  let at = 'Base',
    zAt = m.baseElevation;
  for (const s of m.stories) if (el[s.name].top <= z + 1e-6) (at = s.name), (zAt = el[s.name].top);
  if (z < m.baseElevation - 1e-6) return `Base − ${fmt(m.baseElevation - z)}`;
  return Math.abs(z - zAt) < 1e-6 ? `at ${at}` : `${at} + ${fmt(z - zAt)}`;
}

function RefPlanesDialog() {
  const model = useApp((s) => s.model);
  const [rows, setRows] = useState<RefPlane[]>(model.refPlanes);
  const el = storyElevations(model);
  const [from, setFrom] = useState(model.stories[0]?.name ?? 'Base');
  const [offset, setOffset] = useState(1500);
  const up = (i: number, p: Partial<RefPlane>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const nextName = () => {
    let n = rows.length + 1;
    while (rows.some((r) => r.name === `RP${n}`)) n++;
    return `RP${n}`;
  };
  const add = () => {
    const z = (from === 'Base' ? model.baseElevation : el[from]?.top ?? model.baseElevation) + offset;
    setRows([...rows, { id: uid(), name: nextName(), z }].sort((a, b) => a.z - b.z));
  };
  const save = () => {
    const names = rows.map((r) => r.name.trim());
    if (new Set(names).size !== names.length || names.some((n) => !n)) return toast('Reference plane names must be unique and not empty.');
    const zs = rows.map((r) => r.z);
    if (zs.some((z) => !isFinite(z))) return toast('Every reference plane needs an elevation.');
    if (new Set(zs).size !== zs.length) return toast('Two reference planes are at the same elevation.');
    useApp.getState().commit((m) => ({ ...m, refPlanes: rows.map((r) => ({ ...r, name: r.name.trim() })).sort((a, b) => a.z - b.z) }));
    closeDialog();
  };
  const display = [...rows.map((r, i) => ({ r, i }))].sort((a, b) => b.r.z - a.r.z);
  return (
    <Modal title="Reference planes" footer={<><button onClick={closeDialog}>Cancel</button><button className="primary" onClick={save}>Save</button></>}>
      <div className="small muted">
        Horizontal planes at a given elevation, between or beyond the story levels (e.g. a landing or a mezzanine). They are pushed to ETABS as reference planes (Grid Definitions - Reference Planes), where you can draw and snap on them. Highest first.
      </div>
      <table className="grid">
        <thead><tr><th>Name</th><th>Elevation (Z)</th><th>Level</th><th></th></tr></thead>
        <tbody>
          {display.map(({ r, i }) => (
            <tr key={r.id}>
              <td><input type="text" value={r.name} onChange={(e) => up(i, { name: e.target.value })} /></td>
              <td><input type="number" value={r.z} onChange={(e) => up(i, { z: e.target.valueAsNumber })} /></td>
              <td className="muted">{isFinite(r.z) ? levelOf(model, r.z) : ''}</td>
              <td><button className="danger" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button></td>
            </tr>
          ))}
          {!rows.length && (
            <tr><td colSpan={4} className="muted small">No reference planes yet.</td></tr>
          )}
        </tbody>
      </table>
      <div className="row">
        <span>Add at</span>
        <select value={from} onChange={(e) => setFrom(e.target.value)}>
          <option value="Base">Base ({fmt(model.baseElevation)})</option>
          {[...model.stories].reverse().map((s) => <option key={s.name} value={s.name}>{s.name} ({fmt(el[s.name].top)})</option>)}
        </select>
        <span className="muted" style={{ width: 'auto' }}>+</span>
        <input type="number" value={offset} onChange={(e) => setOffset(+e.target.value)} />
        <span className="muted" style={{ width: 'auto' }}>mm</span>
        <button onClick={add}>Add</button>
      </div>
    </Modal>
  );
}

// ---------------- underlay setup ----------------

function UnderlayDialog() {
  const u = useUnderlay();
  const stories = useApp((s) => s.model.stories);
  const setLayers = (visible: (l: DxfLayer, i: number) => boolean) => {
    const layers = u.dxf!.layers.map((l, i) => ({ ...l, visible: visible(l, i) }));
    u.set({ dxf: { ...u.dxf!, layers }, hiddenLayers: layers.filter((l) => !l.visible).map((l) => l.name) });
    saveUnderlayMeta();
  };
  if (u.kind === 'dxf' && u.dxf)
    return (
      <Modal title="DXF underlay" footer={<button className="primary" onClick={closeDialog}>Done</button>}>
        <div className="row">
          <span>Units</span>
          <select value={u.dxfScale} onChange={(e) => rescaleDxf(+e.target.value)}>
            <option value={1}>mm (×1)</option>
            <option value={10}>cm (×10)</option>
            <option value={1000}>m (×1000)</option>
            <option value={25.4}>inch (×25.4)</option>
            <option value={304.8}>feet (×304.8)</option>
            {![1, 10, 1000, 25.4, 304.8].includes(u.dxfScale) && <option value={u.dxfScale}>calibrated (×{fmt(u.dxfScale, 4)})</option>}
          </select>
          <button onClick={() => (closeDialog(), setTool('calibrate'))} title="Click two ends of a known line, then type its real length in mm">
            Calibrate…
          </button>
        </div>
        <div className="small muted">Drawing size: {fmt((u.dxf.bbox.maxX - u.dxf.bbox.minX) / 1000, 1)} m × {fmt((u.dxf.bbox.maxY - u.dxf.bbox.minY) / 1000, 1)} m · {u.dxf.segs.length} segments. Check the measured sizes look right.</div>
        <div className="row small">
          <b style={{ flex: 1 }}>Layers</b>
          <button onClick={() => setLayers(() => true)} title="Show every layer">Select all</button>
          <button onClick={() => setLayers(() => false)} title="Hide every layer">Select none</button>
          <button onClick={() => setLayers((l) => !l.visible)} title="Show the hidden layers and hide the shown ones">Select inverse</button>
        </div>
        <div className="layerlist">
          {u.dxf.layers.map((l, i) => (
            <label key={l.name} className="small">
              <input type="checkbox" checked={l.visible} onChange={() => setLayers((x, j) => (j === i ? !x.visible : x.visible))} />
              {l.name}
            </label>
          ))}
        </div>
        <div className="small"><b>Story regions</b> ({u.regions.length})</div>
        {u.regions.map((r) => (
          <div key={r.id} className="row small">
            <span style={{ width: 'auto', flex: 1 }}>{r.stories.join(', ')}</span>
            <button onClick={() => openDialog({ kind: 'regionStories', regionId: r.id })} title="Change which stories use this region">Stories…</button>
            <button onClick={() => (closeDialog(), redrawRegion(r.id))} title="Pick a new box and reference point, keeping its stories">Redraw</button>
            <button className="danger" onClick={() => (u.set({ regions: u.regions.filter((x) => x.id !== r.id) }), saveUnderlayMeta())}>✕</button>
          </div>
        ))}
        <div className="small muted">All plans are in one model space: use <b>Define story region</b> to box each story's plan and click its reference point (e.g. the A/1 grid intersection). The point maps to the model origin, so every story lines up.</div>
        <div className="chips">
          <button className="primary" onClick={() => (closeDialog(), setTool('region'))}>Define story region</button>
        </div>
      </Modal>
    );
  if (u.kind === 'pdf')
    return (
      <Modal title="PDF underlay" footer={<button className="primary" onClick={closeDialog}>Done</button>}>
        <div className="small muted">{u.pdfPages} page(s). Assign a page to each story, then on each story use <b>Calibrate + origin</b>: click two points of a known distance, type it, then click the reference point (e.g. grid A/1).</div>
        <table className="grid">
          <thead><tr><th>Story</th><th>Page</th><th>mm / pt</th></tr></thead>
          <tbody>
            {[...stories].reverse().map((s) => {
              const sh = u.sheets.find((x) => x.story === s.name);
              return (
                <tr key={s.name}>
                  <td>{s.name}</td>
                  <td>
                    <select
                      value={sh?.page ?? 0}
                      onChange={(e) => {
                        const page = +e.target.value;
                        const others = u.sheets.filter((x) => x.story !== s.name);
                        const copy = u.sheets.find((x) => x.page === page);
                        u.set({ sheets: page ? [...others, { story: s.name, page, s: copy?.s ?? sh?.s ?? 35.2778, ref: copy?.ref ?? sh?.ref ?? { x: 0, y: 0 } }] : others });
                        saveUnderlayMeta();
                      }}
                    >
                      <option value={0}>—</option>
                      {Array.from({ length: u.pdfPages }, (_, i) => <option key={i} value={i + 1}>Page {i + 1}</option>)}
                    </select>
                  </td>
                  <td className="muted">{sh ? fmt(sh.s, 3) : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Modal>
    );
  return null;
}

// ---------------- ETABS ----------------

function EtabsDialog() {
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [busy, setBusy] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [url, setUrl] = useState(bridgeUrl());
  const [imp, setImp] = useState({ sections: true, stories: true, grids: true, refPlanes: true, patterns: true, elements: true });
  const [push, setPush] = useState<{ updateStories: boolean; pushGrids: boolean; pushRefPlanes: boolean; supports: Supports; loads: boolean }>({ updateStories: false, pushGrids: false, pushRefPlanes: false, supports: 'none', loads: true });
  const [unowned, setUnowned] = useState<Unowned[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const model = useApp((s) => s.model);

  const add = (...l: string[]) => {
    l.forEach((x) => sessionLog('etabs', x, x.startsWith('✖') ? 'error' : x.startsWith('⚠') ? 'warn' : 'info'));
    setLog((x) => [...x, ...l]);
  };
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e: any) {
      add('✖ ' + e.message);
    } finally {
      setBusy('');
    }
  };
  const check = () =>
    run('Connecting…', async () => {
      const s = await bridge.status();
      setStatus(s);
      add(s.attached ? `✔ Attached: ${s.model || '(unsaved model)'}` : `Bridge running, ETABS not attached: ${s.message}`);
    });
  useEffect(() => {
    check();
  }, []);

  const doImport = () =>
    run('Importing…', async () => {
      const r = await bridge.import();
      let el: ReturnType<typeof importElements> | null = null;
      useApp.getState().commit((m) => {
        const out = applyImport(m, r, imp);
        if (!imp.elements) return out;
        el = importElements(out, r);
        return el.model;
      });
      const st = useApp.getState();
      if (!st.model.stories.some((s) => s.name === st.activeStory)) st.setActiveStory(st.model.stories[0]?.name ?? '');
      const e = el as ReturnType<typeof importElements> | null;
      const skipped = e ? Object.entries(e.skipped).map(([why, n]) => `${n} skipped: ${why}`) : [];
      add(
        `✔ Imported ${r.stories.length} stories, ${r.grids.length} grids, ${r.refPlanes?.length ?? 0} reference planes, ${r.materials.length} materials, ${r.frameSections.length} frame + ${r.slabSections.length} slab sections, ${r.patterns?.length ?? 0} load patterns` +
          (e ? `, ${e.columns} columns, ${e.beams} beams, ${e.slabs} slabs` : ''),
        ...skipped,
        ...(imp.refPlanes && !r.refPlanes ? ['⚠ The bridge is an older version that does not send reference planes. Restart python bridge/bridge.py and import again.'] : []),
        ...(imp.elements && !r.frames ? ['⚠ The bridge is an older version that does not send columns, beams or slabs. Restart python bridge/bridge.py and import again.'] : []),
        ...r.warnings.map((w) => '⚠ ' + w),
      );
      requestAnimationFrame(() => fitAll());
    });

  const doPush = () =>
    run('Pushing…', async () => {
      const sent = useApp.getState().model;
      const p = toPayload(sent, push);
      add(`→ Pushing ${p.frames.length} frames, ${p.areas.length} slabs, ${p.deleteGuids.length} deletions${p.loads ? `, ${p.patterns.length} load patterns, loads` : ''}…`);
      const r = await bridge.push(p);
      useApp.getState().commit((m) => ({ ...m, pushedIds: r.pushedGuids, ...(p.loads ? { pushedJointKeys: jointKeys(sent) } : {}) }));
      const ld = r.loads ? `; loads rewritten on ${r.loads.frames} frames, ${r.loads.areas} slabs, ${r.loads.joints} joints (${r.loads.unchanged} unchanged)` : '';
      add(`✔ added ${r.added}, updated ${r.updated}, unchanged ${r.unchanged}, deleted ${r.deleted}, failed ${r.failed}` + (r.restrained !== undefined ? `, ${r.restrained} base joints ${p.supports}` : '') + ld, ...r.log);
    });

  const doVerify = () =>
    run('Verifying…', async () => {
      const r = await bridge.verify(toPayload(useApp.getState().model, push));
      add((r.ok ? '✔ ' : '⚠ ') + r.log[0], ...r.log.slice(1, 40));
      if (r.unowned.length) add(`${r.unowned.length} object${r.unowned.length === 1 ? '' : 's'} in ETABS that no app element owns - listed below`);
      setUnowned(r.unowned);
      setPicked(new Set());
    });

  const doRemove = () => {
    const list = unowned.filter((u) => picked.has(unownedKey(u)));
    if (!list.length || !confirm(`Delete ${list.length} object${list.length === 1 ? '' : 's'} from ETABS? This can't be undone from the app.`)) return;
    run('Deleting…', async () => {
      const p = toPayload(useApp.getState().model, push);
      const r = await bridge.remove({
        frames: list.filter((u) => u.obj === 'frame').map((u) => u.name),
        areas: list.filter((u) => u.obj === 'area').map((u) => u.name),
        keepGuids: [...p.frames.map((f) => f.guid), ...p.areas.map((a) => a.guid)],
      });
      add(`✔ Deleted ${r.deleted} object${r.deleted === 1 ? '' : 's'} from ETABS: ${list.map(describeUnowned).join('; ')}`, ...r.log);
      setUnowned((u) => u.filter((x) => !picked.has(unownedKey(x))));
      setPicked(new Set());
    });
  };
  const togglePick = (k: string) =>
    setPicked((s) => {
      const n = new Set(s);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });

  const issues = modelIssues(model).filter((i) => i.kind !== 'section');
  const missingSec = [...new Set([...model.columns, ...model.beams].map((x) => x.section))].filter((n) => !model.frameSections.some((s) => s.name === n));

  return (
    <Modal wide title="ETABS link">
      <div className="row">
        <span className={'dot ' + (status?.attached ? 'ok' : '')} style={{ width: 8 }} />
        <span style={{ width: 'auto', flex: 1 }}>{status?.attached ? `Attached: ${status.model || 'unsaved model'}` : 'Not attached'}</span>
        <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} style={{ maxWidth: 220 }} />
        <button
          onClick={() => {
            try {
              localStorage.setItem('bridgeUrl', url || DEFAULT_BRIDGE);
            } catch {}
            check();
          }}
        >
          Connect
        </button>
      </div>
      <div className="small muted">
        Run the bridge on this PC: <code>python bridge/bridge.py</code>, with ETABS 22 open. Lengths are sent in mm; the bridge switches ETABS to kN-mm while it works and restores your units.
      </div>
      <div className="section">
        <h4>Import from ETABS</h4>
        <div className="chips">
          {(['sections', 'stories', 'grids', 'refPlanes', 'patterns', 'elements'] as const).map((k) => (
            <label
              key={k}
              className="small"
              title={k === 'elements' ? 'Columns, beams and slabs on the story levels, with their frame and slab loads in the app’s patterns. They are then managed by the app: pushes update them and deleting them here deletes them in ETABS.' : undefined}
            >
              <input type="checkbox" checked={imp[k]} onChange={() => setImp({ ...imp, [k]: !imp[k] })} />{' '}
              {k === 'sections' ? 'Materials + sections' : k === 'refPlanes' ? 'Reference planes' : k === 'patterns' ? 'Load patterns' : k === 'elements' ? 'Columns, beams, slabs' : k[0].toUpperCase() + k.slice(1)}
            </label>
          ))}
          <button onClick={doImport} disabled={!!busy}>Import</button>
        </div>
      </div>
      <div className="section">
        <h4>Push to ETABS</h4>
        <div className="small muted" style={{ marginBottom: 6 }}>
          {model.columns.length} columns, {model.beams.length} beams, {model.slabs.length} slabs. Elements are matched by GUID: re-pushing updates them in place; deleting in the app deletes them in ETABS. Objects drawn in ETABS are not touched.
        </div>
        {issues.length > 0 && (
          <div className="small" style={{ color: 'var(--accent2)' }}>
            ⚠ Model check: {issues.length} warning{issues.length === 1 ? '' : 's'} ({[...new Set(issues.map((i) => i.kind))].join(', ')}). Duplicates and overlaps are pushed as they are; see Model check in the right panel.
          </div>
        )}
        {missingSec.length > 0 && <div className="small" style={{ color: 'var(--danger)' }}>Undefined sections used: {missingSec.join(', ')}</div>}
        <div className="chips">
          <label className="small"><input type="checkbox" checked={push.updateStories} onChange={() => setPush({ ...push, updateStories: !push.updateStories })} /> Replace ETABS stories</label>
          <label className="small"><input type="checkbox" checked={push.pushGrids} onChange={() => setPush({ ...push, pushGrids: !push.pushGrids })} /> Replace grids</label>
          <label className="small" title={`Replace the reference planes of the grid system in ETABS with the app's ${model.refPlanes.length}`}>
            <input type="checkbox" checked={push.pushRefPlanes} onChange={() => setPush({ ...push, pushRefPlanes: !push.pushRefPlanes })} /> Replace reference planes
          </label>
          <label className="small" title="Create the load patterns and write the frame, slab and joint loads. In the app's patterns, the app's loads replace what ETABS has on the app's elements.">
            <input type="checkbox" checked={push.loads} onChange={() => setPush({ ...push, loads: !push.loads })} /> Loads
          </label>
          <label className="small" title="Restraint assigned to the bottom joint of every column at the base elevation">
            Supports
            <select value={push.supports} onChange={(e) => setPush({ ...push, supports: e.target.value as Supports })}>
              <option value="fixed">Fixed</option>
              <option value="pinned">Pinned</option>
              <option value="none">None (leave as is)</option>
            </select>
          </label>
          <button className="primary" onClick={doPush} disabled={!!busy || missingSec.length > 0}>Push</button>
          <button onClick={doVerify} disabled={!!busy}>Verify</button>
        </div>
      </div>
      {unowned.length > 0 && (
        <div className="section">
          <h4>In ETABS but not in the app ({unowned.length})</h4>
          <div className="small muted" style={{ marginBottom: 6 }}>
            Objects no app element owns: drawn in ETABS, or left behind by an undone push or an older project file. Tick the ones to delete.
          </div>
          <div className="chips">
            <label className="small">
              <input
                type="checkbox"
                checked={picked.size === unowned.length}
                onChange={() => setPicked(picked.size === unowned.length ? new Set() : new Set(unowned.map(unownedKey)))}
              />{' '}
              All
            </label>
            <button className="danger" onClick={doRemove} disabled={!!busy || picked.size === 0}>
              Delete {picked.size || ''} from ETABS
            </button>
          </div>
          <div style={{ maxHeight: 180, overflowY: 'auto' }}>
            {unowned.map((u) => (
              <label key={unownedKey(u)} className="small" style={{ display: 'block' }}>
                <input type="checkbox" checked={picked.has(unownedKey(u))} onChange={() => togglePick(unownedKey(u))} /> {describeUnowned(u)}
              </label>
            ))}
          </div>
        </div>
      )}
      {busy && <div className="small" style={{ color: 'var(--accent2)' }}>{busy}</div>}
      <div className="log">{log.join('\n') || '—'}</div>
    </Modal>
  );
}

const unownedKey = (u: Unowned) => `${u.obj}:${u.name}`;

function describeUnowned(u: Unowned) {
  const xy = (p: { x: number; y: number }) => `(${fmt(p.x, 0)}, ${fmt(p.y, 0)})`;
  const where =
    u.obj === 'frame'
      ? u.kind === 'column'
        ? `at ${xy(u.pts[0])}`
        : `${xy(u.pts[0])} - ${xy(u.pts[1])}`
      : `${u.pts.length} corners around ${xy({ x: u.pts.reduce((s, p) => s + p.x, 0) / u.pts.length, y: u.pts.reduce((s, p) => s + p.y, 0) / u.pts.length })}`;
  return `${u.kind} ${u.name}, ${u.story || '?'} ${u.section} ${where}`;
}
