import { useEffect, useState, type ReactNode } from 'react';
import { useDialog, closeDialog, type Dialog } from './dialogState';
import { useApp, toast } from '../model/store';
import { generateGrids, moveIds, oppositeLabelStart, replicate } from '../model/ops';
import { parseSpacing, fmt } from '../model/geom';
import { uid, storyElevations, type FrameSection, type Model, type SlabSection, type Story } from '../model/types';
import { useUnderlay, saveUnderlayMeta, rescaleDxf } from '../underlay/store';
import { setTool } from '../plan/tools';
import { bridge, bridgeUrl, DEFAULT_BRIDGE, type BridgeStatus } from '../etabs/bridgeClient';
import { toPayload, applyImport } from '../etabs/mapping';
import { fitAll } from '../plan/PlanView';

function Modal({ title, children, footer, wide }: { title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <div className="modal-bg" onPointerDown={(e) => e.target === e.currentTarget && closeDialog()}>
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
    case 'grids':
      return <GridsDialog />;
    case 'replicate':
      return <ReplicateDialog />;
    case 'move':
      return <MoveDialog />;
    case 'sections':
      return <SectionsDialog />;
    case 'stories':
      return <StoriesDialog />;
    case 'underlay':
      return <UnderlayDialog />;
    case 'etabs':
      return <EtabsDialog />;
    default:
      return null;
  }
}

function StoryChecks({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
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
    const rect = { minX: Math.min(d.rect.a.x, d.rect.b.x), minY: Math.min(d.rect.a.y, d.rect.b.y), maxX: Math.max(d.rect.a.x, d.rect.b.x), maxY: Math.max(d.rect.a.y, d.rect.b.y) };
    // a story can belong to one region only
    const regions = u.regions.map((r) => ({ ...r, stories: r.stories.filter((s) => !stories.includes(s)) })).filter((r) => r.stories.length);
    u.set({ regions: [...regions, { id: uid(), stories, rect, ref: d.ref }] });
    saveUnderlayMeta();
    closeDialog();
    setTool('select');
    toast(`Region assigned to ${stories.join(', ')}. Untick “Show whole DXF” to see each story aligned.`);
  };
  return (
    <Modal title="Assign region to stories" footer={<><button onClick={closeDialog}>Cancel</button><button className="primary" disabled={!stories.length} onClick={save}>Assign</button></>}>
      <div className="small muted">The boxed plan will be shown on these stories, with the picked reference point placed at the model origin (0,0). Tick all typical floors that share this plan.</div>
      <StoryChecks value={stories} onChange={setStories} />
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
  const run = () => {
    const st = useApp.getState();
    const ids = sel.filter((id) => !st.model.grids.some((g) => g.id === id));
    let created: string[] = [];
    st.commit((m) => {
      const r = replicate(m, ids, mode === 'linear' ? { dx, dy, n, stories: null } : { dx, dy, n: 1, stories });
      created = r.created;
      return r.model;
    });
    toast(`Created ${created.length} elements.`);
    closeDialog();
  };
  return (
    <Modal title={`Replicate ${sel.length} selected`} footer={<><button onClick={closeDialog}>Cancel</button><button className="primary" onClick={run} disabled={mode === 'stories' && !stories.length}>Replicate</button></>}>
      <div className="chips">
        <button className={mode === 'stories' ? 'on' : ''} onClick={() => setMode('stories')}>To stories (Z)</button>
        <button className={mode === 'linear' ? 'on' : ''} onClick={() => setMode('linear')}>Linear (X / Y)</button>
      </div>
      <div className="row"><span>dx (mm)</span><input type="number" value={dx} onChange={(e) => setDx(+e.target.value)} /></div>
      <div className="row"><span>dy (mm)</span><input type="number" value={dy} onChange={(e) => setDy(+e.target.value)} /></div>
      {mode === 'linear' ? (
        <div className="row"><span>Copies</span><input type="number" min={1} value={n} onChange={(e) => setN(Math.max(1, +e.target.value))} /></div>
      ) : (
        <>
          <div className="small muted">Copies the selection (from {active}) onto the ticked stories, shifted by dx/dy (usually 0). Elements that already exist are skipped.</div>
          <StoryChecks value={stories} onChange={setStories} />
        </>
      )}
    </Modal>
  );
}

function MoveDialog() {
  const sel = useApp((s) => s.selection);
  const [dx, setDx] = useState(0);
  const [dy, setDy] = useState(0);
  return (
    <Modal
      title={`Move ${sel.length} selected`}
      footer={<><button onClick={closeDialog}>Cancel</button><button className="primary" onClick={() => (useApp.getState().commit((m) => moveIds(m, sel, dx, dy)), closeDialog())}>Move</button></>}
    >
      <div className="row"><span>dx (mm)</span><input type="number" value={dx} onChange={(e) => setDx(+e.target.value)} /></div>
      <div className="row"><span>dy (mm)</span><input type="number" value={dy} onChange={(e) => setDy(+e.target.value)} /></div>
    </Modal>
  );
}

// ---------------- sections ----------------

function SectionsDialog() {
  const model = useApp((s) => s.model);
  const [f, setF] = useState<FrameSection[]>(model.frameSections);
  const [sl, setSl] = useState<SlabSection[]>(model.slabSections);
  const mats = model.materials.map((m) => m.name);
  const save = () => {
    const names = new Set(f.map((x) => x.name));
    if (names.size !== f.length) return toast('Frame section names must be unique.');
    useApp.getState().commit((m) => ({ ...m, frameSections: f, slabSections: sl }));
    closeDialog();
  };
  const upF = (i: number, p: Partial<FrameSection>) => setF(f.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const upS = (i: number, p: Partial<SlabSection>) => setSl(sl.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <Modal wide title="Sections" footer={<><button onClick={closeDialog}>Cancel</button><button className="primary" onClick={save}>Save</button></>}>
      <div className="small muted">Sections imported from ETABS are read-only here. Sections you add are created in ETABS when you push. Depth t3 / width t2 in mm.</div>
      <table className="grid">
        <thead>
          <tr><th>Frame section</th><th>Shape</th><th>t3 depth</th><th>t2 width</th><th>Material</th><th></th></tr>
        </thead>
        <tbody>
          {f.map((s, i) => (
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
          ))}
        </tbody>
      </table>
      <div className="chips">
        <button onClick={() => setF([...f, { name: `C${f.length + 1}`, shape: 'Rectangle', t3: 500, t2: 300, material: mats[0] ?? '4000Psi', fromEtabs: false }])}>+ Rectangle</button>
        <button onClick={() => setF([...f, { name: `CIR${f.length + 1}`, shape: 'Circle', t3: 500, t2: 500, material: mats[0] ?? '4000Psi', fromEtabs: false }])}>+ Circle</button>
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
  const setFoundation = (p: Partial<typeof fnd>) => {
    const next = { ...fnd, ...p };
    setFnd(next);
    const fd = parseFloat(next.foundingDepth),
      ft = parseFloat(next.footingThickness),
      ph = parseFloat(next.plinthHeight);
    if ([fd, ft, ph].every(isFinite)) setBase(fd - ft + ph);
  };
  const [rows, setRows] = useState<(Story & { orig: string })[]>(model.stories.map((s) => ({ ...s, orig: s.name })));
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
      return {
        ...m,
        baseElevation: base,
        foundation: fndNums() ?? m.foundation,
        stories: rows.map(({ orig, ...s }) => ({ ...s, name: s.name.trim(), similarTo: s.similarTo ? rename.get(s.similarTo) ?? '' : '' })),
        columns: fix(m.columns),
        beams: fix(m.beams),
        slabs: fix(m.slabs),
      };
    });
    const st = useApp.getState();
    if (!st.model.stories.some((s) => s.name === st.activeStory)) st.setActiveStory(st.model.stories[0]?.name ?? '');
    closeDialog();
  };
  const el = storyElevations({ ...model, baseElevation: base, stories: rows });
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
        <h4>Base elevation</h4>
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
        <div className="small muted">Base elev. = founding depth − footing thickness + plinth height. You can still type a base elevation directly.</div>
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

// ---------------- underlay setup ----------------

function UnderlayDialog() {
  const u = useUnderlay();
  const stories = useApp((s) => s.model.stories);
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
        <div className="small">
          <b>Layers</b>
        </div>
        <div className="layerlist">
          {u.dxf.layers.map((l, i) => (
            <label key={l.name} className="small">
              <input
                type="checkbox"
                checked={l.visible}
                onChange={() => {
                  const layers = u.dxf!.layers.map((x, j) => (j === i ? { ...x, visible: !x.visible } : x));
                  u.set({ dxf: { ...u.dxf!, layers }, hiddenLayers: layers.filter((x) => !x.visible).map((x) => x.name) });
                  saveUnderlayMeta();
                }}
              />
              {l.name}
            </label>
          ))}
        </div>
        <div className="small"><b>Story regions</b> ({u.regions.length})</div>
        {u.regions.map((r) => (
          <div key={r.id} className="row small">
            <span style={{ width: 'auto', flex: 1 }}>{r.stories.join(', ')}</span>
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
  const [imp, setImp] = useState({ sections: true, stories: true, grids: true });
  const [push, setPush] = useState({ updateStories: false, pushGrids: true });
  const model = useApp((s) => s.model);

  const add = (...l: string[]) => setLog((x) => [...x, ...l]);
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
      useApp.getState().commit((m) => applyImport(m, r, imp));
      const st = useApp.getState();
      const names = st.model.frameSections.map((s) => s.name);
      if (!names.includes(st.active.column) && names[0]) st.setActive('column', names[0]);
      if (!names.includes(st.active.beam) && names[0]) st.setActive('beam', names[0]);
      const sn = st.model.slabSections.map((s) => s.name);
      if (!sn.includes(st.active.slab) && sn[0]) st.setActive('slab', sn[0]);
      if (!st.model.stories.some((s) => s.name === st.activeStory)) st.setActiveStory(st.model.stories[0]?.name ?? '');
      add(`✔ Imported ${r.stories.length} stories, ${r.grids.length} grids, ${r.materials.length} materials, ${r.frameSections.length} frame + ${r.slabSections.length} slab sections`, ...r.warnings.map((w) => '⚠ ' + w));
      requestAnimationFrame(() => fitAll());
    });

  const doPush = () =>
    run('Pushing…', async () => {
      const p = toPayload(useApp.getState().model, push);
      add(`→ Pushing ${p.frames.length} frames, ${p.areas.length} slabs, ${p.deleteGuids.length} deletions…`);
      const r = await bridge.push(p);
      useApp.getState().commit((m) => ({ ...m, pushedIds: r.pushedGuids }));
      add(`✔ added ${r.added}, updated ${r.updated}, unchanged ${r.unchanged}, deleted ${r.deleted}, failed ${r.failed}`, ...r.log);
    });

  const doVerify = () =>
    run('Verifying…', async () => {
      const r = await bridge.verify(toPayload(useApp.getState().model, push));
      add((r.ok ? '✔ ' : '⚠ ') + r.log[0], ...r.log.slice(1, 40));
    });

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
          {(['sections', 'stories', 'grids'] as const).map((k) => (
            <label key={k} className="small">
              <input type="checkbox" checked={imp[k]} onChange={() => setImp({ ...imp, [k]: !imp[k] })} /> {k === 'sections' ? 'Materials + sections' : k[0].toUpperCase() + k.slice(1)}
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
        {missingSec.length > 0 && <div className="small" style={{ color: 'var(--danger)' }}>Undefined sections used: {missingSec.join(', ')}</div>}
        <div className="chips">
          <label className="small"><input type="checkbox" checked={push.updateStories} onChange={() => setPush({ ...push, updateStories: !push.updateStories })} /> Replace ETABS stories</label>
          <label className="small"><input type="checkbox" checked={push.pushGrids} onChange={() => setPush({ ...push, pushGrids: !push.pushGrids })} /> Replace grids</label>
          <button className="primary" onClick={doPush} disabled={!!busy || missingSec.length > 0}>Push</button>
          <button onClick={doVerify} disabled={!!busy}>Verify</button>
        </div>
      </div>
      {busy && <div className="small" style={{ color: 'var(--accent2)' }}>{busy}</div>}
      <div className="log">{log.join('\n') || '—'}</div>
    </Modal>
  );
}
