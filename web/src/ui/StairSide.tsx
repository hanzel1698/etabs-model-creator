import { useApp, viewModel } from '../model/store';
import { storyElevations } from '../model/types';
import { fmt } from '../model/geom';
import { setTool } from '../plan/tools';
import { deleteStair, renameStair, setTypicals } from '../stair/regions';
import { levelNames, rangeLevels, rangesOf, validateRanges } from '../stair/ranges';
import { uid, type StairRegion } from '../model/types';

/** Left panel list of stair boxes: draw one, open one to design it, rename, delete. */
export function StairsList() {
  const stairs = useApp((s) => s.model.stairs);
  const tool = useApp((s) => s.tool);
  return (
    <div className="section">
      <h4>
        Stairs{' '}
        <button className={tool === 'stairBox' ? 'on' : ''} title="Draw a box around a stair on any plan; it gets a name like STAIR-01" onClick={() => setTool('stairBox')}>
          + Box
        </button>
      </h4>
      {!stairs.length && <div className="small muted">No stairs yet. Draw a box around one on the plan.</div>}
      {stairs.map((r) => (
        <div key={r.id} className="row stair-row">
          <span className="stair-name">{r.name}</span>
          <button className="primary" title="Design this stair" onClick={() => useApp.getState().enterStair(r.id)}>Open</button>
          <button title="Rename" aria-label={`Rename ${r.name}`} onClick={() => renameStair(r.id)}>✎</button>
          <button className="danger" title="Delete this stair and everything drawn in it" aria-label={`Delete ${r.name}`} onClick={() => deleteStair(r.id)}>✕</button>
        </div>
      ))}
    </div>
  );
}

/** Left panel while designing a stair: its stories (read-only building levels in its box) and the way back. */
export function StairSide() {
  const st = useApp.getState();
  const r = useApp((s) => s.model.stairs.find((x) => x.id === s.activeStair));
  const m = useApp(viewModel);
  const active = useApp((s) => s.activeStory);
  const labels = useApp((s) => s.show.sectionLabels);
  if (!r) return null;
  const el = storyElevations(m);
  return (
    <div className="side">
      <div className="section">
        <h4>
          {r.name} <button onClick={st.exitStair}>Back to model</button>
        </h4>
        <div className="small muted">
          Box {fmt(r.x2 - r.x1)} × {fmt(r.y2 - r.y1)} mm. The building's grids, columns and beams in it are shown read-only; edit them in the model.
        </div>
      </div>
      <TypicalRanges r={r} />
      <div className="section">
        <h4>Stories</h4>
        <div className="stories">
          {[...m.stories].reverse().map((s) => (
            <div key={s.name} className={'story ' + (s.name === active ? 'active' : '')} onClick={() => st.setActiveStory(s.name)}>
              {s.name}
              <span className="elev">{fmt(el[s.name].top)}</span>
            </div>
          ))}
          <div className="story muted small">
            Base <span className="elev">{fmt(m.baseElevation)}</span>
          </div>
        </div>
      </div>
      <div className="section">
        <h4>View</h4>
        <label className="small">
          <input type="checkbox" checked={labels} onChange={() => st.toggleShow('sectionLabels')} /> Section labels
        </label>
      </div>
    </div>
  );
}

/** Typical story ranges of the open stair: "all stories same", or From → To rows; the selected row is the one designed. */
function TypicalRanges({ r }: { r: StairRegion }) {
  const model = useApp((s) => s.model);
  const activeRange = useApp((s) => s.activeRange);
  const typ = r.typicals ?? [];
  const levels = levelNames(model);
  const rgs = rangesOf(model, r);
  const cur = rgs.find((x) => x.id === activeRange) ?? rgs[0];
  const issues = validateRanges(model, typ);
  const top = levels[levels.length - 1];
  const add = () => {
    const from = typ.length ? typ[typ.length - 1].to : levels[0];
    setTypicals([...typ, { id: uid(), from: from === top ? levels[0] : from, to: top }]);
  };
  const edit = (id: string, k: 'from' | 'to', v: string) => setTypicals(typ.map((x) => (x.id === id ? { ...x, [k]: v } : x)));
  const pick = (id: string, k: 'from' | 'to', v: string) => (
    <select value={v} title={v} style={{ flex: '1 1 0', minWidth: 0, maxWidth: '45%', padding: '2px 2px', textOverflow: 'ellipsis' }} aria-label={k === 'from' ? 'From level' : 'To level'} onClick={(e) => e.stopPropagation()} onChange={(e) => edit(id, k, e.target.value)}>
      {levels.map((l) => (
        <option key={l}>{l}</option>
      ))}
    </select>
  );
  return (
    <div className="section">
      <h4>Typical stories</h4>
      <label className="small">
        <input type="radio" checked={!typ.length} onChange={() => setTypicals([])} /> All stories same
      </label>
      <label className="small">
        <input type="radio" checked={!!typ.length} onChange={() => !typ.length && add()} /> Typical ranges
      </label>
      {typ.length > 0 && (
        <div className="stories">
          {typ.map((x) => {
            const lv = rangeLevels(model, x);
            return (
              <div key={x.id} className={'story ' + (x.id === cur?.id ? 'active' : '')} style={{ minWidth: 0 }} title="Design this range (its first storey; loads repeat up to To)" onClick={() => useApp.getState().setActiveRange(x.id)}>
                {pick(x.id, 'from', x.from)} → {pick(x.id, 'to', x.to)}
                <span className="elev">{lv ? `×${lv.repeats}` : '—'}</span>
                <button className="danger" aria-label={`Remove ${x.from} to ${x.to}`} onClick={(e) => (e.stopPropagation(), setTypicals(typ.filter((y) => y.id !== x.id)))}>✕</button>
              </div>
            );
          })}
          <button onClick={add}>+ Add typical stories</button>
        </div>
      )}
      {issues.map((t) => (
        <div key={t} className="small" style={{ color: 'var(--danger)', overflowWrap: 'anywhere' }}>{t}</div>
      ))}
      {cur && <div className="small muted" style={{ overflowWrap: 'anywhere' }}>Designing {cur.from} → {cur.to}{rangeLevels(model, cur) ? ` on storey ${rangeLevels(model, cur)!.story}` : ''}.</div>}
    </div>
  );
}
